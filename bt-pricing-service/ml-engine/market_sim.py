"""
market_sim.py — LAYER 2 environment: India freight market simulator (v1.1).

v1.1 adds cargo realism: tonnage/volume utilisation, cargo value & handling
class, and the variable backhaul model (lane prior x operator network).
State is 16 features; episodes remain 2-step round trips.
"""
from __future__ import annotations
import numpy as np
import cto_data as D
from cto_engine import CTOEngine
from load_models import backhaul_probability, handling_pricing

CORRIDORS = [
    ("Mumbai-Delhi",        1400, 1.10, 0.05),
    ("Mumbai-Bengaluru",    980,  1.25, 0.20),
    ("Delhi-Kolkata",       1500, 0.95, 0.10),
    ("Chennai-Hyderabad",   630,  1.05, 0.05),
    ("Mumbai-Ahmedabad",    530,  0.90, 0.10),
    ("Pune-Nagpur",         720,  1.30, 0.15),
    ("Delhi-Jaipur",        280,  1.00, 0.02),
    ("Kolkata-Guwahati",    1030, 1.45, 0.35),
]

BASE_RATE_PER_KM = {"HCV": 62.0, "MHCV": 52.0, "MCV": 46.0, "ICV": 38.0,
                    "ILCV": 34.0, "LCV": 28.0, "SCV": 19.0, "PU": 17.0}

CARGO_CATEGORIES = [c for c in D.MODEL_CATEGORIES
                    if "Bus" not in c and "Pass" not in c]

HANDLING_CLASSES = ["general", "fragile", "reefer", "hazmat", "odc"]
HANDLING_P = [0.70, 0.12, 0.07, 0.06, 0.05]


class FreightMarketSim:
    N_FEATURES = 16

    def __init__(self, seed: int = 7, diesel_mu: float = 92.0):
        self.rng = np.random.default_rng(seed)
        self.cto = CTOEngine()
        self.diesel_mu = diesel_mu
        parc = {c: np.array(D.VEHICLE_PARC_FY25[c], dtype=float) for c in CARGO_CATEGORIES}
        tot = sum(p.sum() for p in parc.values())
        self.cat_prob = np.array([parc[c].sum() / tot for c in CARGO_CATEGORIES])
        self.age_prob = {c: parc[c] / parc[c].sum() for c in CARGO_CATEGORIES}

    def _sample_truck(self):
        ci = self.rng.choice(len(CARGO_CATEGORIES), p=self.cat_prob)
        cat = CARGO_CATEGORIES[ci]
        age = int(self.rng.choice(np.arange(1, 11), p=self.age_prob[cat]))
        return ci, cat, age

    def market_rate(self, seg, km, monsoon, harvest, ds_ratio,
                    backhaul_leg, imbalance):
        r = BASE_RATE_PER_KM[seg] * km
        r *= (self.diesel / self.diesel_mu) ** 0.55
        r *= 1.0 + 0.35 * np.tanh(ds_ratio - 1.0)
        if monsoon:
            r *= 1.06
        if harvest:
            r *= 1.09
        if backhaul_leg:
            r *= max(0.55, 1.0 / imbalance) * 0.92
        return r

    # ------------------------------------------------------------------ #
    def reset(self):
        self.diesel = float(np.clip(self.rng.normal(self.diesel_mu, 4.0), 80, 105))
        self.cto.p["diesel_price_inr_l"] = self.diesel
        self.kidx = self.rng.integers(len(CORRIDORS))
        _, km, imb, mon_p = CORRIDORS[self.kidx]
        self.km, self.imbalance = float(km), imb
        self.monsoon = self.rng.random() < mon_p
        self.harvest = self.rng.random() < 0.18
        self.urgent = self.rng.random() < 0.22
        self.ds_ratio = float(np.clip(self.rng.lognormal(0.0, 0.30), 0.4, 2.6))
        self.ci, self.cat, self.age = self._sample_truck()
        self.seg = D.segment_of(self.cat)
        self.shipper_sens = self.rng.choice([0.7, 1.0, 1.5], p=[0.25, 0.5, 0.25])
        # --- v1.1 cargo ---
        payload, vol_cap = D.CAPACITY[self.cat]
        self.util = float(np.clip(self.rng.beta(5, 2), 0.3, 1.0))
        self.weight_mt = self.util * payload
        self.volume_cft = float(np.clip(self.rng.beta(4, 2), 0.3, 1.0)) * vol_cap
        self.handling = self.rng.choice(HANDLING_CLASSES, p=HANDLING_P)
        self.manual_loading = self.rng.random() < 0.25
        value_density = float(self.rng.lognormal(np.log(55000), 0.7))  # Rs/MT
        self.cargo_value = value_density * self.weight_mt
        self.h = handling_pricing([self.handling] if self.handling != "general" else [],
                                  self.cargo_value, self.weight_mt, self.manual_loading)
        # --- v1.1 backhaul network ---
        self.shippers_at_dest = int(self.rng.poisson(2.0))
        self.open_return_loads = int(self.rng.poisson(3.0 * self.ds_ratio))
        self.backhaul_p = backhaul_probability(self.imbalance, self.shippers_at_dest,
                                               self.open_return_loads)["p"]
        self.leg = 0
        return self._state()

    def _state(self) -> np.ndarray:
        cto_km = self.cto.cost_per_km(self.cat, self.age)
        mr = self.market_rate(self.seg, self.km, self.monsoon, self.harvest,
                              self.ds_ratio, self.leg == 1, self.imbalance)
        mr *= self.h["surcharge_mult"]
        self._mr, self._cto_km = mr, cto_km
        value_density_norm = min(1.0, self.cargo_value / max(self.weight_mt, .1) / 200000)
        return np.array([
            self.ci / len(CARGO_CATEGORIES), self.age / 10.0,
            1.0 if D.norm_for_age(self.age) == "BS4" else 0.0,
            self.km / 1500.0, self.ds_ratio / 2.6,
            (self.diesel - 80) / 25.0,
            float(self.monsoon), float(self.harvest), float(self.urgent),
            self.shipper_sens / 1.5, float(self.leg),
            np.clip(mr / max(cto_km * self.km, 1.0), 0, 3) / 3.0,
            self.util,                      # 12 chargeable utilisation
            value_density_norm,             # 13 cargo value density
            self.h["risk_score"],           # 14 handling risk
            self.backhaul_p,                # 15 backhaul probability (variable)
        ])

    # ------------------------------------------------------------------ #
    def step(self, mult: float):
        toll = 1.9 * self.km
        allowance = 600 + 0.45 * self.km
        floor = self.cto.trip_floor(self.cat, self.age, self.km, toll, allowance)
        floor += self.h["flat_handling_inr"] + self.h["risk_premium_inr"]
        quote = max(self._mr * mult, floor)
        quote += self.h["flat_handling_inr"] + self.h["risk_premium_inr"]

        z = -self.shipper_sens * 6.0 * (quote / max(self._mr, 1) - 1.0) \
            + (0.8 if self.urgent else 0.0)
        p_ship = 1.0 / (1.0 + np.exp(-z))
        op_cost = (self._cto_km * self.km + toll + allowance
                   + self.h["flat_handling_inr"] + self.h["risk_premium_inr"])
        margin = quote - op_cost
        p_op = 1.0 / (1.0 + np.exp(-(margin / max(op_cost, 1.0) - 0.04) * 18.0))

        matched = self.rng.random() < p_ship and self.rng.random() < p_op
        reward = ((0.04 * quote + 0.25 * max(margin, 0.0)) / 1000.0
                  if matched else -0.05)
        info = {"quote": quote, "market": self._mr, "floor": floor,
                "margin": margin if matched else 0.0, "matched": matched,
                "op_cost": op_cost}
        if self.leg == 0 and matched and self.rng.random() < self.backhaul_p:
            self.leg = 1
            return self._state(), reward, False, info
        return self._state(), reward, True, info
