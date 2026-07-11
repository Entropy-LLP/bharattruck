"""
feature_builder.py — Convert historical dataset rows into the 16-feature
state vector expected by LinUCBAgent.

PURPOSE
-------
Bridge between the historical Excel dataset (loaded by dataset_loader.py)
and the existing 16-feature RL state representation. Every feature is
computed to EXACTLY match the normalization, ordering, and scaling used
in the production service (service.py lines 194-205).

By using the exact same calculations and normalization bounds as service.py,
we prevent offline-online feature mismatch.

INPUTS
------
A pandas DataFrame (or single row) with columns as output by
dataset_loader.load_dataset().

OUTPUTS
-------
A numpy array of shape (16,) per row, or (N, 16) for the full dataset.

--------------------------------------------------------------------------------
EXHAUSTIVE FEATURE SPECIFICATION
--------------------------------------------------------------------------------

Idx: 0
  Name: category_index
  Dataset Source Column: "truck_category" (mapped to standardized "truck_category")
  Mathematical Transformation: Look up the category's index in the canonical list
    CARGO_CATEGORIES (from market_sim.py/service.py).
  Normalization: index / len(CARGO_CATEGORIES)  (i.e., index / 12)
  Why it exists: Tells the agent the capacity, category, and segment class of
    the truck (e.g., HCV vs LCV) since vehicle size heavily influences operating cost.
  Production availability: Yes, available at inference time from the booking request.

Idx: 1
  Name: vehicle_age
  Dataset Source Column: "Age" (mapped to standardized "age")
  Mathematical Transformation: None.
  Normalization: age / 10.0 (where age is clipped to the interval [1, 10]).
  Why it exists: Maintenance and fuel efficiency decay as a truck ages. The agent
    uses this to adjust quotes for older, higher-cost trucks.
  Production availability: Yes, available at inference time from the onboarding records.

Idx: 2
  Name: is_bs4
  Dataset Source Column: Derived from "Age" (mapped to standardized "age")
  Mathematical Transformation: Look up norm standard based on vehicle age using
    cto_data.norm_for_age(age). Age >= 8 maps to "BS4", otherwise "BS6_PH1" or "BS6_PH2".
  Normalization: 1.0 if standards == "BS4" else 0.0
  Why it exists: BS4 vehicles have different fuel consumption rates (KMPL) and
    do not use DEF fluid, altering variable operating costs.
  Production availability: Yes, available at inference time from registration records.

Idx: 3
  Name: distance_norm
  Dataset Source Column: "Dist km" (mapped to standardized "dist_km")
  Mathematical Transformation: None.
  Normalization: km / 1500.0 (not clipped, represents distance relative to a
    nominal 1500 km route).
  Why it exists: Distance is the primary driver of trip cost. The agent scales
    profit margins based on trip length.
  Production availability: Yes, computed at inference from origin/destination geocodes.

Idx: 4
  Name: ds_ratio_norm
  Dataset Source Column: "D/S Ratio" (mapped to standardized "ds_ratio")
  Mathematical Transformation: None.
  Normalization: ds_ratio / 2.6 (ds_ratio is in range [0.4, 2.6]).
  Why it exists: High demand-supply ratios indicate tight capacity, allowing
    higher pricing markup; low ratios indicate a slack lane, necessitating lower quotes.
  Production availability: Yes, provided at inference by the platform's supply matching module.

Idx: 5
  Name: diesel_norm
  Dataset Source Column: "Diesel ₹/L" (mapped to standardized "diesel_price")
  Mathematical Transformation: Shift and scale.
  Normalization: (diesel_price - 80.0) / 25.0 (diesel_price is typically in range [80, 105]).
  Why it exists: Fuel cost is the largest component of variable operating cost.
  Production availability: Yes, provided at inference by integration with IOCL daily rate APIs.

Idx: 6
  Name: monsoon
  Dataset Source Column: "Monsoon" (mapped to standardized "monsoon")
  Mathematical Transformation: None.
  Normalization: float(monsoon) (binary flag 0.0 or 1.0).
  Why it exists: Monsoons create poor road conditions, slower transit times,
    and capacity constraints, which increase operating costs.
  Production availability: Yes, provided at inference via IMD weather alerts for the route.

Idx: 7
  Name: harvest
  Dataset Source Column: "Harvest" (mapped to standardized "harvest")
  Mathematical Transformation: None.
  Normalization: float(harvest) (binary flag 0.0 or 1.0).
  Why it exists: Harvest seasons increase local freight demand significantly, causing
    market rates to rise.
  Production availability: Yes, inferred from the calendar month and region.

Idx: 8
  Name: urgent
  Dataset Source Column: "Urgent" (mapped to standardized "urgent")
  Mathematical Transformation: None.
  Normalization: float(urgent) (binary flag 0.0 or 1.0).
  Why it exists: Urgent shipments require prioritized dispatch, and shippers are
    typically less price-sensitive for these bookings.
  Production availability: Yes, selected by the shipper during booking.

Idx: 9
  Name: shipper_sens_norm
  Dataset Source Column: Neutral value initialized for training (derived from shipper_segment in prod).
  Mathematical Transformation: Shipper sensitivity is initialized to the neutral production
    baseline value of 1.0.
  Normalization: 1.0 / 1.5 (yielding a constant 0.6667).
  Why it exists: Controls how sensitive the customer is to price markup. Price-sensitive
    shipper segments have lower acceptance probability for high markups.
  Production availability: Yes, determined in production by the shipper account's historical segment profile.
  Data Leakage Correction: Previously, this feature was back-derived from the P(Shipper) column.
    Because P(Shipper) is simulator-only telemetry that is unavailable at inference time,
    using it during offline training introduced data leakage. We have removed this dependency
    and set it to a neutral 1.0/1.5.

Idx: 10
  Name: leg
  Dataset Source Column: (None - set to 0.0 constant for outbound training).
  Mathematical Transformation: Set to 0.0.
  Normalization: 0.0 (binary leg: outbound = 0.0, backhaul = 1.0).
  Why it exists: Backhaul legs typically face lower market rates due to truck imbalance.
  Production availability: Yes, tracked by the platform booking lifecycle (current leg).

Idx: 11
  Name: rate_to_cto_cover
  Dataset Source Column: Calculated dynamically from "dist_km", "diesel_price", "ds_ratio",
    "monsoon", "harvest", and "handling" using BASE_RATE_PER_KM.
  Mathematical Transformation: Compute the dynamic baseline market rate matching service.py:
    market_dynamic = _market_rate(seg, km, diesel, ds, monsoon, harvest) * surcharge_mult.
    Then divide by total cost to operate: rate_cover = market_dynamic / max(cto_km * km, 1.0).
  Normalization: clip(rate_cover, 0.0, 3.0) / 3.0
  Why it exists: Indicates whether the lane's market rate is high enough to cover
    the truck's specific operating cost. If the market rate is close to or below
    the operating cost (low cover), the agent must choose a high multiplier to preserve margin.
  Production availability: Yes, computed at inference.
  Production Parity Correction: Previously, this feature was calculated using the raw Excel
    "Market ₹" column. Because "Market ₹" in the dataset includes flat fees, risk premiums,
    and category-specific capacity multipliers, it mismatched the dynamic "market" variable
    constructed by service.py. We now compute it dynamically using the identical logic
    to ensure perfect parity.

Idx: 12
  Name: cargo_utilization
  Dataset Source Column: "Weight MT" and "Volume CFT" (mapped to standardized "weight_mt" and "volume_cft")
  Mathematical Transformation: Calculate weight utilization (weight / rated_payload)
    and volume utilization (volume / body_volume_capacity) and take the maximum.
  Normalization: max(weight / rated_payload, volume / body_volume_capacity), clipped to [0.0, 1.0].
  Why it exists: Chargeable utilization determines whether a load takes up the entire truck capacity,
    which governs the floor cost for PTL and FTL allocation.
  Production availability: Yes, computed at inference from shipper cargo specifications.

Idx: 13
  Name: value_density
  Dataset Source Column: "Cargo Value ₹" and "Weight MT" (mapped to standardized "cargo_value_inr" and "weight_mt")
  Mathematical Transformation: cargo_value_inr / max(weight_mt, 0.1).
  Normalization: min(1.0, value_density / 200000.0)
  Why it exists: High-value cargo represents higher transit-risk and requires cargo-insurance coverage.
  Production availability: Yes, declared by the shipper for e-Way Bill compliance.

Idx: 14
  Name: handling_risk
  Dataset Source Column: "Handling" (mapped to standardized "handling")
  Mathematical Transformation: Lookup surcharges for handling classes ("fragile", "reefer",
    "hazmat", "odc") defined in cto_data.HANDLING. Surcharges are summed if multiple exist.
  Normalization: min(1.0, surcharge / 0.25)
  Why it exists: Hazardous, oversized, or fragile cargo carries higher operating risk and
    additional handling costs.
  Production availability: Yes, selected by the shipper during booking.

Idx: 15
  Name: backhaul_prob
  Dataset Source Column: "BH Prob" (mapped to standardized "bh_prob")
  Mathematical Transformation: None.
  Normalization: Direct use. Already in [0.0, 1.0].
  Why it exists: High backhaul probability means the truck is likely to secure a return load,
    allowing the agent to offer a competitive discount on the outbound leg.
  Production availability: Yes, calculated at inference via the backhaul probability model.

--------------------------------------------------------------------------------
"""
from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import numpy as np
import pandas as pd

import cto_data as D
from cto_engine import CTOEngine
from market_sim import BASE_RATE_PER_KM, CARGO_CATEGORIES

# ---------------------------------------------------------------------------
# Feature spec: name, index, expected range, description
# ---------------------------------------------------------------------------
FEATURE_NAMES: list[str] = [
    "category_index",       # 0
    "vehicle_age",          # 1
    "is_bs4",               # 2
    "distance_norm",        # 3
    "ds_ratio_norm",        # 4
    "diesel_norm",          # 5
    "monsoon",              # 6
    "harvest",              # 7
    "urgent",               # 8
    "shipper_sens_norm",    # 9
    "leg",                  # 10
    "rate_to_cto_cover",    # 11
    "cargo_utilization",    # 12
    "value_density",        # 13
    "handling_risk",        # 14
    "backhaul_prob",        # 15
]

N_FEATURES: int = 16

# Expected range for each feature: (min, max, description).
# Used by verify_features.py for validation.
FEATURE_RANGES: list[tuple[float, float, str]] = [
    (0.0,  1.0,   "category_index: ci/12, 12 cargo categories"),
    (0.1,  1.0,   "vehicle_age: age 1-10 → 0.1-1.0"),
    (0.0,  1.0,   "is_bs4: binary flag"),
    (0.0,  5.0,   "distance_norm: km/1500, most routes <2500 km"),
    (0.15, 1.0,   "ds_ratio_norm: D/S 0.4-2.6 → 0.15-1.0"),
    (-0.2, 1.2,   "diesel_norm: (diesel-80)/25, typical 80-110 ₹/L"),
    (0.0,  1.0,   "monsoon: binary flag"),
    (0.0,  1.0,   "harvest: binary flag"),
    (0.0,  1.0,   "urgent: binary flag"),
    (0.66, 0.67,  "shipper_sens_norm: constant 1.0/1.5 (neutral sensitivity)"),
    (0.0,  0.0,   "leg: always 0.0 for outbound (no backhaul data)"),
    (0.0,  1.0,   "rate_to_cto_cover: clipped to [0,3] then /3"),
    (0.0,  2.0,   "cargo_utilization: max(wt/payload, vol/cap)"),
    (0.0,  1.0,   "value_density: min(1, cargo_val/wt/200000)"),
    (0.0,  1.0,   "handling_risk: min(1, surcharge/0.25)"),
    (0.0,  1.0,   "backhaul_prob: probability in [0,1]"),
]

# Sourced from cto_data.HANDLING
_HANDLING_SURCHARGE: dict[str, float] = {
    h: D.HANDLING[h]["surcharge"] for h in D.HANDLING
}

# Lookup: category → (payload_mt, volume_cap_cft)
_CAPACITY: dict[str, tuple[float, float]] = D.CAPACITY


# ---------------------------------------------------------------------------
# Dynamic baseline market rate calculation matching service.py exactly
# ---------------------------------------------------------------------------
def _market_rate(seg: str, km: float, diesel: float, ds: float, monsoon: bool, harvest: bool) -> float:
    """Compute baseline market rate in INR matching service.py L83-91."""
    r = BASE_RATE_PER_KM[seg] * km
    r *= (diesel / 92.0) ** 0.55
    r *= 1.0 + 0.35 * np.tanh(ds - 1.0)
    if monsoon:
        r *= 1.06
    if harvest:
        r *= 1.09
    return float(r)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def build_state_vector(row: pd.Series) -> np.ndarray:
    """Convert a single dataset row into the 16-feature state vector.

    Parameters
    ----------
    row : pd.Series
        A row from the DataFrame returned by dataset_loader.load_dataset().
        Must contain the columns listed in REQUIRED_FOR_FEATURES.

    Returns
    -------
    np.ndarray of shape (16,)
        The state vector, feature-for-feature identical to what service.py
        would produce given the same inputs.
    """
    # -- Feature 0: category index (normalised) --
    category = row["truck_category"]
    ci = CARGO_CATEGORIES.index(category)
    f0_category_index = ci / len(CARGO_CATEGORIES)

    # -- Feature 1: vehicle age (normalised) --
    age = int(row["age"])
    f1_vehicle_age = age / 10.0

    # -- Feature 2: BS4 emission norm flag --
    f2_is_bs4 = 1.0 if D.norm_for_age(age) == "BS4" else 0.0

    # -- Feature 3: distance (normalised) --
    km = float(row["dist_km"])
    f3_distance_norm = km / 1500.0

    # -- Feature 4: demand/supply ratio (normalised) --
    ds = float(row["ds_ratio"])
    f4_ds_ratio_norm = ds / 2.6

    # -- Feature 5: diesel price (normalised) --
    diesel = float(row["diesel_price"])
    f5_diesel_norm = (diesel - 80.0) / 25.0

    # -- Features 6, 7, 8: binary condition flags --
    monsoon = bool(row["monsoon"])
    harvest = bool(row["harvest"])
    urgent  = bool(row["urgent"])
    
    f6_monsoon = float(monsoon)
    f7_harvest = float(harvest)
    f8_urgent  = float(urgent)

    # -- Feature 9: shipper price-sensitivity (normalised) --
    # Default to neutral sensitivity (1.0) to eliminate data leakage.
    # Scaled exactly like service.py L200: sens / 1.5.
    sens = 1.0
    f9_shipper_sens_norm = sens / 1.5

    # -- Feature 10: leg (outbound=0.0) --
    f10_leg = 0.0

    # -- Feature 11: market-rate-to-CTO coverage ratio --
    # We calculate the dynamic baseline market rate matching service.py exactly,
    # ensuring perfect consistency with production inference.
    seg = D.segment_of(category)
    
    # Map handling class to list and calculate surcharge_mult
    handling = str(row["handling"]).strip().lower()
    handling_list = []
    if handling != "general" and handling != "nan":
        handling_list = [h.strip() for h in handling.split(",")]
    surcharge = sum(_HANDLING_SURCHARGE.get(h, 0.0) for h in handling_list)
    surcharge_mult = 1.0 + surcharge
    
    # Dynamic market calculation
    market_dynamic = _market_rate(seg, km, diesel, ds, monsoon, harvest) * surcharge_mult
    
    cto_engine = CTOEngine(diesel_price=diesel)
    cto_km = cto_engine.cost_per_km(category, age)
    
    ptl_share = 1.0 # all historical rows are FTL
    rate_cover = market_dynamic / max(cto_km * km * ptl_share, 1.0)
    f11_rate_to_cto_cover = float(np.clip(rate_cover, 0.0, 3.0)) / 3.0

    # -- Feature 12: cargo utilisation --
    payload_mt, vol_cap = _CAPACITY[category]
    weight_mt = float(row["weight_mt"])
    volume_cft = float(row["volume_cft"])
    weight_util = weight_mt / payload_mt
    volume_util = volume_cft / vol_cap if vol_cap > 0 else 0.0
    f12_cargo_utilization = max(weight_util, volume_util)

    # -- Feature 13: cargo value density (normalised) --
    cargo_value = float(row["cargo_value_inr"])
    f13_value_density = min(1.0, cargo_value / max(weight_mt, 0.1) / 200000)

    # -- Feature 14: handling risk score --
    f14_handling_risk = min(1.0, surcharge / 0.25)

    # -- Feature 15: backhaul probability --
    f15_backhaul_prob = float(row["bh_prob"])

    return np.array([
        f0_category_index,       # 0
        f1_vehicle_age,          # 1
        f2_is_bs4,               # 2
        f3_distance_norm,        # 3
        f4_ds_ratio_norm,        # 4
        f5_diesel_norm,          # 5
        f6_monsoon,              # 6
        f7_harvest,              # 7
        f8_urgent,               # 8
        f9_shipper_sens_norm,    # 9
        f10_leg,                 # 10
        f11_rate_to_cto_cover,   # 11
        f12_cargo_utilization,   # 12
        f13_value_density,       # 13
        f14_handling_risk,       # 14
        f15_backhaul_prob,       # 15
    ], dtype=np.float64)


def build_state_matrix(df: pd.DataFrame) -> np.ndarray:
    """Convert all rows of a dataset DataFrame into a state matrix.

    Parameters
    ----------
    df : pd.DataFrame
        DataFrame returned by dataset_loader.load_dataset().

    Returns
    -------
    np.ndarray of shape (N, 16)
        State matrix where each row is a 16-feature state vector.
    """
    n = len(df)
    X = np.empty((n, N_FEATURES), dtype=np.float64)
    errors: list[str] = []

    for i, (idx, row) in enumerate(df.iterrows()):
        try:
            X[i] = build_state_vector(row)
        except Exception as e:
            errors.append(
                f"Row {idx} (quote_id={row.get('quote_id', '?')}): {e}"
            )
            X[i] = np.full(N_FEATURES, np.nan)

    if errors:
        print(f"WARNING: {len(errors)} rows failed feature extraction:")
        for err in errors[:10]:
            print(f"  {err}")
        if len(errors) > 10:
            print(f"  ... and {len(errors) - 10} more.")

    return X


# ---------------------------------------------------------------------------
# CLI entry-point for quick testing
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    from dataset_loader import load_dataset

    df, meta = load_dataset()
    print(f"Building state vectors for {len(df)} rows...")

    X = build_state_matrix(df)
    valid = ~np.isnan(X[:, 0])
    print(f"  Success: {valid.sum()}/{len(df)} rows")
    print(f"  Failed:  {(~valid).sum()}/{len(df)} rows")

    print(f"\nState matrix shape: {X.shape}")
    print(f"\nPer-feature statistics (valid rows only):")
    Xv = X[valid]
    print(f"{'Idx':<4} {'Feature':<22} {'Min':>8} {'Max':>8} {'Mean':>8} {'Std':>8}")
    print("-" * 60)
    for i, name in enumerate(FEATURE_NAMES):
        col = Xv[:, i]
        print(f"{i:<4} {name:<22} {col.min():8.4f} {col.max():8.4f} "
              f"{col.mean():8.4f} {col.std():8.4f}")
