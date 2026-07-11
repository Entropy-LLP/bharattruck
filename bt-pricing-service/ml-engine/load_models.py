"""
load_models.py — v1.1 cargo & load economics shared by service and simulator.

  * chargeable weight (tonnage vs volumetric), payload/volume fit checks
  * handling surcharges + cargo-value transit-risk premium + eWB flag
  * variable backhaul probability: lane prior x operator network effect
  * PTL consolidation: fit check + cost allocation + per-consignment pricing
"""
from __future__ import annotations
import math
from dataclasses import dataclass

import cto_data as D


# ----------------------------------------------------------- chargeable ----
def chargeable_mt(weight_mt: float, volume_cft: float) -> float:
    vol_mt = volume_cft * D.VOLUMETRIC_KG_PER_CFT / 1000.0
    return max(weight_mt, vol_mt)


@dataclass
class FitCheck:
    fits: bool
    overweight: bool
    overvolume: bool
    weight_util: float
    volume_util: float
    chargeable_mt: float

    @property
    def utilization(self) -> float:
        return max(self.weight_util, self.volume_util)


def fit_check(category: str, weight_mt: float, volume_cft: float) -> FitCheck:
    payload, vol_cap = D.CAPACITY[category]
    wu, vu = weight_mt / payload, volume_cft / vol_cap
    return FitCheck(fits=wu <= 1.0 and vu <= 1.0, overweight=wu > 1.0,
                    overvolume=vu > 1.0, weight_util=wu, volume_util=vu,
                    chargeable_mt=chargeable_mt(weight_mt, volume_cft))


# ------------------------------------------------------------- handling ----
def handling_pricing(handling: list[str], cargo_value_inr: float,
                     weight_mt: float, manual_loading: bool) -> dict:
    handling = handling or []
    surcharge = sum(D.HANDLING[h]["surcharge"] for h in handling)
    risk_rate = max([D.HANDLING[h]["risk_rate"] for h in handling]
                    or [D.HANDLING["general"]["risk_rate"]])
    flat = (D.MANUAL_LOADING_INR_PER_MT * weight_mt if manual_loading else 0.0)
    flat += D.ODC_PERMIT_FEE_INR if "odc" in handling else 0.0
    return {
        "surcharge_mult": 1.0 + surcharge,
        "risk_premium_inr": cargo_value_inr * risk_rate,
        "flat_handling_inr": flat,
        "ewb_required": cargo_value_inr > D.EWB_VALUE_THRESHOLD_INR,
        "risk_score": min(1.0, surcharge / 0.25),   # 0..1 feature for RL state
    }


# -------------------------------------------------------------- backhaul ---
def backhaul_probability(lane_imbalance: float,
                         operator_shippers_at_destination: int,
                         open_return_loads: int) -> dict:
    """Lane prior + operator network effect.

    p_lane    : structural prior from lane imbalance (out:back demand)
    network   : 1 - exp(-(0.12*shipper_base + 0.05*demand_pipeline))
                — operator's own shipper base at the destination converts
                  better than anonymous marketplace pipeline, hence weights
    p         : p_lane + (1 - p_lane) * network, clipped to [0.05, 0.95]
    """
    p_lane = min(0.85, max(0.15, 0.85 / lane_imbalance))
    network = 1.0 - math.exp(-(0.12 * max(0, operator_shippers_at_destination)
                               + 0.05 * max(0, open_return_loads)))
    p = min(0.95, max(0.05, p_lane + (1.0 - p_lane) * network))
    return {"p": p, "lane_prior": round(p_lane, 3), "network_effect": round(network, 3)}


# ------------------------------------------------------------------ PTL ----
def ptl_allocate(category: str, trip_total_inr: float,
                 consignments: list[dict]) -> dict:
    """Allocate a consolidated truck's price across PTL consignments.

    consignments: [{id, weight_mt, volume_cft, cargo_value_inr, handling[],
                    manual_loading}]
    Allocation basis: chargeable weight share. Each consignment then carries
    its own handling surcharge, risk premium and the PTL premium.
    """
    payload, vol_cap = D.CAPACITY[category]
    tw = sum(c["weight_mt"] for c in consignments)
    tv = sum(c["volume_cft"] for c in consignments)
    fits = tw <= payload and tv <= vol_cap
    total_ch = sum(chargeable_mt(c["weight_mt"], c["volume_cft"]) for c in consignments)

    lines, revenue = [], 0.0
    for c in consignments:
        ch = chargeable_mt(c["weight_mt"], c["volume_cft"])
        share = ch / total_ch if total_ch else 0.0
        h = handling_pricing(c.get("handling", []), c.get("cargo_value_inr", 0.0),
                             c["weight_mt"], c.get("manual_loading", False))
        base = trip_total_inr * share * (1 + D.PTL_PREMIUM)
        price = base * h["surcharge_mult"] + h["risk_premium_inr"] + h["flat_handling_inr"]
        revenue += price
        lines.append({
            "id": c.get("id"), "chargeable_mt": round(ch, 2),
            "allocation_share": round(share, 3),
            "price_inr": round(price), "ewb_required": h["ewb_required"],
            "rate_per_chargeable_mt": round(price / ch) if ch else None,
        })
    return {
        "fits": fits, "overweight": tw > payload, "overvolume": tv > vol_cap,
        "weight_util": round(tw / payload, 3), "volume_util": round(tv / vol_cap, 3),
        "consignments": lines,
        "consolidated_revenue_inr": round(revenue),
        "ftl_equivalent_inr": round(trip_total_inr),
        "consolidation_gain_pct": round(100 * (revenue / trip_total_inr - 1), 1)
        if trip_total_inr else None,
    }
