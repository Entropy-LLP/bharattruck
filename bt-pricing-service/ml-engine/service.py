"""
service.py — BharatTruck Pricing Engine microservice (v1.1).

v1.1 adds: tonnage/volume chargeable-basis pricing with payload fit checks,
cargo-value risk premium + eWB flag, handling surcharges, FTL/PTL pricing
with a PTL consolidation endpoint, and the variable backhaul model
(lane prior x operator shipper base x demand pipeline).

  POST /v1/quote                  FTL or single-consignment PTL quote
  POST /v1/quote/ptl-aggregate    consolidate N PTL consignments on one truck
  POST /v1/quote/{id}/feedback    accept/reject -> online LinUCB update
  GET  /v1/cto                    Layer-1 Rs/km breakdown
  GET  /v1/meta                   categories, corridors, handling classes
  GET  /health · GET /            console UI

Run:  uvicorn service:app --host 0.0.0.0 --port 8090
"""
from __future__ import annotations
import json, os, threading, time, uuid

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

import cto_data as D
from cto_engine import CTOEngine
from load_models import backhaul_probability, fit_check, handling_pricing, ptl_allocate
from market_sim import BASE_RATE_PER_KM, CARGO_CATEGORIES, CORRIDORS
from rl_agent import ACTIONS, LinUCBAgent

STATE_FILE = os.path.join(os.path.dirname(__file__), "agent_state.npz")
QUOTE_LOG = os.path.join(os.path.dirname(__file__), "rate_quote.jsonl")
DIESEL_MU = 92.0
N_FEATURES = 16

app = FastAPI(title="BharatTruck Pricing Engine", version="1.1")
_lock = threading.Lock()
_pending: dict[str, dict] = {}

agent = LinUCBAgent(n_features=N_FEATURES, alpha=0.35)
if os.path.exists(STATE_FILE):
    z = np.load(STATE_FILE)
    if z["b"].shape[1] == N_FEATURES:
        agent.A, agent.b, agent.A_inv = z["A"], z["b"], z["A_inv"]


def _persist_agent():
    np.savez(STATE_FILE, A=agent.A, b=agent.b, A_inv=agent.A_inv)


SENS = {"price_insensitive": 0.7, "standard": 1.0, "price_sensitive": 1.5}


class QuoteRequest(BaseModel):
    model_category: str
    vehicle_age: int = Field(ge=1, le=10)
    corridor: str | None = None
    distance_km: float | None = Field(default=None, gt=0)
    diesel_price: float = DIESEL_MU
    demand_supply: float = Field(default=1.0, ge=0.4, le=2.6)
    urgent: bool = False
    monsoon: bool = False
    harvest: bool = False
    shipper_segment: str = Field(default="standard",
                                 pattern="^(price_insensitive|standard|price_sensitive)$")
    toll_inr: float | None = None
    driver_allowance_inr: float | None = None
    loading_inr: float = 0.0
    # ---- v1.1 cargo ----
    load_type: str = Field(default="FTL", pattern="^(FTL|PTL)$")
    cargo_weight_mt: float | None = Field(default=None, gt=0)
    cargo_volume_cft: float | None = Field(default=None, ge=0)
    cargo_value_inr: float = Field(default=0.0, ge=0)
    handling: list[str] = []                       # fragile|hazmat|reefer|odc
    manual_loading: bool = False
    # ---- v1.1 backhaul network ----
    operator_shippers_at_destination: int = Field(default=0, ge=0)
    open_return_loads: int = Field(default=0, ge=0)
    backhaul_probability: float | None = Field(default=None, ge=0, le=1)


def _market_rate(seg, km, diesel, ds, monsoon, harvest):
    r = BASE_RATE_PER_KM[seg] * km
    r *= (diesel / DIESEL_MU) ** 0.55
    r *= 1.0 + 0.35 * np.tanh(ds - 1.0)
    if monsoon:
        r *= 1.06
    if harvest:
        r *= 1.09
    return float(r)


def _resolve_lane(req) -> tuple[float, float]:
    imbalance = 1.0
    km = req.distance_km
    if req.corridor:
        match = [c for c in CORRIDORS if c[0] == req.corridor]
        if not match:
            raise HTTPException(404, f"unknown corridor '{req.corridor}'")
        _, default_km, imbalance, _ = match[0]
        if km is None:
            km = default_km
    if km is None:
        raise HTTPException(422, "provide corridor or distance_km")
    return float(km), imbalance


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.1",
            "agent_state": os.path.exists(STATE_FILE),
            "pending_quotes": len(_pending)}


@app.get("/v1/meta")
def meta():
    return {"model_categories": CARGO_CATEGORIES,
            "capacity": {c: {"payload_mt": D.CAPACITY[c][0],
                             "volume_cft": D.CAPACITY[c][1]} for c in CARGO_CATEGORIES},
            "corridors": [{"name": n, "km": km, "imbalance": imb, "monsoon_prone": mp}
                          for n, km, imb, mp in CORRIDORS],
            "handling_classes": [h for h in D.HANDLING if h != "general"],
            "action_multipliers": ACTIONS.tolist(),
            "shipper_segments": list(SENS)}


@app.get("/v1/cto")
def cto(category: str, age: int, diesel_price: float = DIESEL_MU):
    if category not in D.MODEL_CATEGORIES:
        raise HTTPException(404, f"unknown category '{category}'")
    b = CTOEngine(diesel_price=diesel_price).breakdown(category, age)
    return {"category": category, "age": age, "emission_norm": b.norm,
            "cost_per_km": round(b.total_per_km, 2),
            "components_per_km": {
                "fuel": round(b.fuel, 2), "def_fluid": round(b.def_fluid, 2),
                "engine_oil": round(b.engine_oil, 3), "gear_oil": round(b.gear_oil, 3),
                "tyres": round(b.tyres, 2), "service": round(b.service, 2),
                "driver": round(b.driver, 2), "fixed": round(b.fixed, 2)}}


@app.post("/v1/quote")
def quote(req: QuoteRequest):
    if req.model_category not in CARGO_CATEGORIES:
        raise HTTPException(404, f"unknown category '{req.model_category}'")
    for h in req.handling:
        if h not in D.HANDLING or h == "general":
            raise HTTPException(422, f"unknown handling class '{h}'")
    km, imbalance = _resolve_lane(req)
    payload, vol_cap = D.CAPACITY[req.model_category]

    weight = req.cargo_weight_mt if req.cargo_weight_mt is not None else 0.85 * payload
    volume = req.cargo_volume_cft if req.cargo_volume_cft is not None else 0.0
    fit = fit_check(req.model_category, weight, volume)
    if fit.overweight:
        raise HTTPException(409, {
            "error": "overweight_blocked",
            "detail": f"cargo {weight:.1f} MT exceeds rated payload {payload} MT "
                      f"(MV Act overloading) — quote refused",
            "weight_util": round(fit.weight_util, 2)})
    if fit.overvolume and req.load_type == "FTL":
        raise HTTPException(409, {"error": "overvolume_blocked",
                                  "detail": f"cargo {volume:.0f} CFT exceeds body volume {vol_cap} CFT"})

    h = handling_pricing(req.handling, req.cargo_value_inr, weight, req.manual_loading)
    seg = D.segment_of(req.model_category)
    eng = CTOEngine(diesel_price=req.diesel_price)
    cto_km = eng.cost_per_km(req.model_category, req.vehicle_age)
    toll = req.toll_inr if req.toll_inr is not None else 1.9 * km
    allowance = (req.driver_allowance_inr if req.driver_allowance_inr is not None
                 else 600 + 0.45 * km)

    market = _market_rate(seg, km, req.diesel_price, req.demand_supply,
                          req.monsoon, req.harvest) * h["surcharge_mult"]
    floor = eng.trip_floor(req.model_category, req.vehicle_age, km, toll,
                           allowance, req.loading_inr)

    # PTL single consignment: chargeable share of the truck + PTL premium
    ptl_share = 1.0
    if req.load_type == "PTL":
        ptl_share = min(1.0, fit.chargeable_mt / payload) * (1 + D.PTL_PREMIUM)
        market *= ptl_share
        floor *= max(ptl_share, 0.30)            # floor never below 30% of truck

    # variable backhaul probability
    if req.backhaul_probability is not None:
        bh = {"p": req.backhaul_probability, "lane_prior": None, "network_effect": None}
    else:
        bh = backhaul_probability(imbalance, req.operator_shippers_at_destination,
                                  req.open_return_loads)

    sens = SENS[req.shipper_segment]
    ci = CARGO_CATEGORIES.index(req.model_category)
    x = np.array([
        ci / len(CARGO_CATEGORIES), req.vehicle_age / 10.0,
        1.0 if D.norm_for_age(req.vehicle_age) == "BS4" else 0.0,
        km / 1500.0, req.demand_supply / 2.6,
        (req.diesel_price - 80) / 25.0,
        float(req.monsoon), float(req.harvest), float(req.urgent),
        sens / 1.5, 0.0,
        np.clip(market / max(cto_km * km * ptl_share, 1.0), 0, 3) / 3.0,
        fit.utilization if req.cargo_weight_mt is not None else 0.85,
        min(1.0, req.cargo_value_inr / max(weight, .1) / 200000),
        h["risk_score"], bh["p"],
    ])
    with _lock:
        a = agent.act(x)
    mult = float(ACTIONS[a])
    base_quote = max(market * mult, floor)
    rl_quote = base_quote + h["risk_premium_inr"] + h["flat_handling_inr"]

    op_cost = (cto_km * km * (ptl_share if req.load_type == "PTL" else 1.0)
               + toll + allowance + req.loading_inr
               + h["risk_premium_inr"] + h["flat_handling_inr"])
    margin = rl_quote - op_cost

    quote_id = str(uuid.uuid4())[:8]
    _pending[quote_id] = {"x": x.tolist(), "a": a, "quote": rl_quote, "ts": time.time()}

    resp = {
        "quote_id": quote_id, "load_type": req.load_type,
        "band": {"floor": round(floor + h["risk_premium_inr"] + h["flat_handling_inr"]),
                 "target": round(market + h["risk_premium_inr"] + h["flat_handling_inr"]),
                 "ceiling": round(market * 1.20 + h["risk_premium_inr"] + h["flat_handling_inr"])},
        "rl_quote": round(rl_quote), "multiplier": mult,
        "floor_binding": base_quote <= floor + 1,
        "cargo": {"weight_mt": round(weight, 2), "volume_cft": round(volume, 1),
                  "chargeable_mt": round(fit.chargeable_mt, 2),
                  "weight_utilization": round(fit.weight_util, 2),
                  "volume_utilization": round(fit.volume_util, 2),
                  "value_inr": req.cargo_value_inr,
                  "ewb_required": h["ewb_required"],
                  "handling": req.handling,
                  "handling_surcharge_pct": round(100 * (h["surcharge_mult"] - 1), 1),
                  "risk_premium_inr": round(h["risk_premium_inr"]),
                  "flat_handling_inr": round(h["flat_handling_inr"])},
        "cto_per_km": round(cto_km, 2),
        "operator": {"trip_cost": round(op_cost), "margin": round(margin),
                     "margin_pct": round(100 * margin / op_cost, 1)},
        "passthrough": {"fastag_toll": round(toll),
                        "driver_allowance": round(allowance),
                        "loading": round(req.loading_inr)},
        "backhaul": {"probability": round(bh["p"], 2),
                     "lane_prior": bh["lane_prior"],
                     "network_effect": bh["network_effect"],
                     "shippers_at_destination": req.operator_shippers_at_destination,
                     "open_return_loads": req.open_return_loads},
        "gst_note": "Add GTA GST: 5% (no ITC) or 12% (with ITC) on freight; SAC 996511",
    }
    with open(QUOTE_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": quote_id, "req": req.model_dump(), "resp": resp}) + "\n")
    return resp


class Consignment(BaseModel):
    id: str | None = None
    weight_mt: float = Field(gt=0)
    volume_cft: float = Field(default=0.0, ge=0)
    cargo_value_inr: float = Field(default=0.0, ge=0)
    handling: list[str] = []
    manual_loading: bool = False


class PTLAggregateRequest(QuoteRequest):
    consignments: list[Consignment]


@app.post("/v1/quote/ptl-aggregate")
def ptl_aggregate(req: PTLAggregateRequest):
    """Consolidate N PTL consignments on one truck: fit check, FTL-equivalent
    RL quote for the trip, per-consignment allocation + pricing."""
    if not req.consignments:
        raise HTTPException(422, "consignments[] required")
    # price the full truck (FTL, neutral cargo) via the same RL path
    base = req.model_copy(update={
        "load_type": "FTL", "handling": [], "cargo_value_inr": 0.0,
        "cargo_weight_mt": None, "cargo_volume_cft": None, "manual_loading": False})
    trip = quote(base)
    alloc = ptl_allocate(req.model_category, trip["rl_quote"],
                         [c.model_dump() for c in req.consignments])
    if not alloc["fits"]:
        _pending.pop(trip["quote_id"], None)
        raise HTTPException(409, {"error": "consolidation_does_not_fit",
                                  "overweight": alloc["overweight"],
                                  "overvolume": alloc["overvolume"],
                                  "weight_util": alloc["weight_util"],
                                  "volume_util": alloc["volume_util"]})
    return {"trip_quote": trip, "consolidation": alloc}


class Feedback(BaseModel):
    shipper_accepted: bool
    operator_accepted: bool
    final_price_inr: float | None = None


@app.post("/v1/quote/{quote_id}/feedback")
def feedback(quote_id: str, fb: Feedback):
    rec = _pending.pop(quote_id, None)
    if rec is None:
        raise HTTPException(404, "quote_id not found or already closed")
    matched = fb.shipper_accepted and fb.operator_accepted
    price = fb.final_price_inr or rec["quote"]
    r = (0.04 * price) / 1000.0 if matched else -0.05
    with _lock:
        agent.update(np.array(rec["x"]), rec["a"], r)
        _persist_agent()
    return {"learned": True, "matched": matched, "reward": round(r, 4)}


@app.get("/")
def read_root():
    return {"status": "ok", "message": "BharatTruck ML Pricing Engine Active"}

