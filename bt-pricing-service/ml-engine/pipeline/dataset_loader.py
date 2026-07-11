"""
dataset_loader.py — Historical dataset loader for BharatTruck Pricing Engine.

PURPOSE
-------
Load the BharatTruck historical pricing dataset from Excel, validate its
schema, handle missing values, and return a clean pandas DataFrame ready
for feature engineering.

This module performs **no feature engineering** — it only cleans and
validates the raw data.

INPUTS
------
Excel file: BharatTruck_Test_Dataset.xlsx (or user-specified path)
  - Row 1: Group headers (CONTEXT, CARGO, NETWORK, PRICING, …) — skipped.
  - Row 2: Column headers (53 columns).
  - Row 3+: Data rows (≈4,917 records).

OUTPUTS
-------
A pandas DataFrame with:
  - Standardised snake_case column names (via COLUMN_MAP).
  - Validated column types (numerics coerced, booleans cast).
  - Rows with unsupported truck categories filtered out (see ASSUMPTIONS).
  - A metadata dict with row counts, filtered rows, and any warnings.

ASSUMPTIONS
-----------
  A1. The Excel file has a single data sheet (first sheet used).
  A2. Row 1 contains merged group headers — read with `header=1` to skip.
  A3. Truck categories must be in CARGO_CATEGORIES (12 freight categories
      from market_sim.py).  Rows with bus/passenger categories ("ILCV
      Buses", "MHCV Buses", "SCV Pass") are excluded because the
      production service (service.py) does not support them.
  A4. Binary columns (Monsoon, Harvest, Urgent, Manual, Matched, etc.)
      are stored as 0/1 floats in the Excel.
"""
from __future__ import annotations

import os
import warnings
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Import the canonical category list used by service.py and the simulator.
# This is the single source of truth for which truck categories are valid.
# ---------------------------------------------------------------------------
from market_sim import CARGO_CATEGORIES

# ---------------------------------------------------------------------------
# Column name mapping: Excel header → clean Python identifier.
#
# The keys are the exact Unicode strings pandas reads from the Excel header
# row.  The values are the snake_case names used throughout the pipeline.
# ---------------------------------------------------------------------------
COLUMN_MAP: dict[str, str] = {
    "Quote ID":         "quote_id",
    "Date":             "date",
    "Origin":           "origin",
    "Destination":      "destination",
    "Dist km":          "dist_km",
    "Truck Category":   "truck_category",
    "Age":              "age",
    "Diesel \u20b9/L":      "diesel_price",
    "D/S Ratio":        "ds_ratio",
    "Monsoon":          "monsoon",
    "Harvest":          "harvest",
    "Urgent":           "urgent",
    "Weight MT":        "weight_mt",
    "Volume CFT":       "volume_cft",
    "Cargo Value \u20b9":    "cargo_value_inr",
    "Handling":         "handling",
    "Manual":           "manual_loading",
    "Shippers@Dest":    "shippers_at_dest",
    "Open Loads":       "open_loads",
    "BH Prob":          "bh_prob",
    "Quoted \u20b9":         "quoted_inr",
    "Market \u20b9":         "market_inr",
    "P(Shipper)":       "p_shipper",
    "P(Operator)":      "p_operator",
    "Acc.Shipper":      "acc_shipper",
    "Acc.Operator":     "acc_operator",
    "Matched":          "matched",
    "NH":               "nh",
    "Scenario":         "scenario",
    "Trip Days":        "trip_days",
    "Crew Model":       "crew_model",
    "Crew \u20b9/mo":       "crew_cost_monthly",
    "Fuel \u20b9":           "fuel_cost",
    "DEF \u20b9":            "def_cost",
    "Eng.Oil \u20b9":        "engine_oil_cost",
    "Gear Oil \u20b9":       "gear_oil_cost",
    "Lub. \u20b9":           "lub_cost",
    "Service \u20b9":        "service_cost",
    "Crew \u20b9":           "crew_cost",
    "Running \u20b9":        "running_cost",
    "Toll \u20b9":           "toll_cost",
    "Allow \u20b9":          "allowance_cost",
    "Handling \u20b9":       "handling_cost",
    "Total Direct \u20b9":   "total_direct_cost",
    "Floor \u20b9 (\u00d71.07)":  "floor_inr",
    "\u2265 Floor?":         "above_floor",
    "Margin \u20b9":         "margin_inr",
    "Margin %":         "margin_pct",
    "vs Market \u20b9":      "vs_market_inr",
    "vs Market %":      "vs_market_pct",
    "Fuel %":           "fuel_pct",
    "Crew %":           "crew_pct",
    "Profitability":    "profitability",
}

# ---------------------------------------------------------------------------
# Columns required at each stage of the pipeline.
# ---------------------------------------------------------------------------
REQUIRED_FOR_FEATURES: list[str] = [
    "truck_category", "age", "dist_km", "ds_ratio", "diesel_price",
    "monsoon", "harvest", "urgent", "weight_mt", "volume_cft",
    "cargo_value_inr", "handling", "bh_prob", "market_inr",
    "quoted_inr", "p_shipper",
]

REQUIRED_FOR_TRAINING: list[str] = REQUIRED_FOR_FEATURES + [
    "acc_shipper", "acc_operator", "matched", "margin_inr",
]

# Numeric columns that must be coerced to float.
_NUMERIC_COLS: list[str] = [
    "dist_km", "age", "diesel_price", "ds_ratio", "weight_mt",
    "volume_cft", "cargo_value_inr", "bh_prob", "quoted_inr",
    "market_inr", "p_shipper", "p_operator", "monsoon", "harvest",
    "urgent", "manual_loading", "shippers_at_dest", "open_loads",
    "acc_shipper", "acc_operator", "matched", "margin_inr",
    "total_direct_cost", "floor_inr", "margin_pct", "toll_cost",
    "allowance_cost", "handling_cost", "fuel_cost", "def_cost",
]

# Default search paths relative to *this file's* directory.
_DEFAULT_PATHS: list[str] = [
    "data/BharatTruck_Test_Dataset.xlsx",
    "../BharatTruck_Test_Dataset.xlsx",
    "../../BharatTruck_Test_Dataset.xlsx",
]


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------
class DatasetValidationError(Exception):
    """Raised when the dataset fails schema validation."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def load_dataset(
    path: str | Path | None = None,
    *,
    filter_cargo_only: bool = True,
    validate_training_cols: bool = False,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Load and clean the historical pricing dataset.

    Parameters
    ----------
    path : str or Path, optional
        Explicit path to the Excel file.  If *None*, searches the default
        locations relative to this module.
    filter_cargo_only : bool, default True
        If True, exclude rows whose ``truck_category`` is not in the
        production ``CARGO_CATEGORIES`` list (removes bus/passenger
        categories).
    validate_training_cols : bool, default False
        If True, also validate that columns needed for RL training
        (acceptance, matched, margin) are present.

    Returns
    -------
    df : pd.DataFrame
        Cleaned DataFrame with snake_case column names.
    meta : dict
        Metadata about the loaded dataset::

            {
                "source_path":       str,
                "total_rows":        int,   # rows in raw Excel
                "filtered_rows":     int,   # rows removed (bad category)
                "valid_rows":        int,   # rows in returned DataFrame
                "filtered_categories": list[str],
                "warnings":          list[str],
            }

    Raises
    ------
    FileNotFoundError
        If the Excel file cannot be found at any of the searched paths.
    DatasetValidationError
        If required columns are missing or the data format is unexpected.
    """
    # -- Resolve path --
    resolved = _resolve_path(path)

    # -- Load Excel --
    # header=1 tells pandas that row index 1 (Excel row 2) is the header,
    # which skips the merged group-header row.
    df = pd.read_excel(resolved, header=1, engine="openpyxl")

    # Drop fully empty rows (trailing rows in Excel).
    df = df.dropna(how="all")

    meta: dict[str, Any] = {
        "source_path": str(resolved),
        "total_rows": len(df),
        "filtered_rows": 0,
        "valid_rows": 0,
        "filtered_categories": [],
        "warnings": [],
    }

    # -- Rename columns --
    rename_map = {}
    matched_excel_cols = set()
    for excel_name, py_name in COLUMN_MAP.items():
        if excel_name in df.columns:
            rename_map[excel_name] = py_name
            matched_excel_cols.add(excel_name)

    # Check for unmapped columns (warn, don't fail — dataset may evolve).
    unmapped = set(df.columns) - matched_excel_cols
    if unmapped:
        meta["warnings"].append(
            f"Unmapped Excel columns (kept with original names): "
            f"{sorted(unmapped)}"
        )

    df = df.rename(columns=rename_map)

    # -- Validate required columns --
    required = (REQUIRED_FOR_TRAINING if validate_training_cols
                else REQUIRED_FOR_FEATURES)
    missing = [c for c in required if c not in df.columns]
    if missing:
        available = sorted(df.columns.tolist())
        raise DatasetValidationError(
            f"Missing required columns: {missing}\n"
            f"Available columns: {available}\n"
            f"Check that the Excel file has the expected header row."
        )

    # -- Type coercion --
    for col in _NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Parse date column if present.
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce")

    # Normalise handling column: lowercase, strip whitespace.
    if "handling" in df.columns:
        df["handling"] = (
            df["handling"]
            .astype(str)
            .str.strip()
            .str.lower()
        )

    # -- Filter to supported cargo categories --
    if filter_cargo_only:
        valid_mask = df["truck_category"].isin(CARGO_CATEGORIES)
        excluded = df.loc[~valid_mask, "truck_category"].unique().tolist()
        n_excluded = int((~valid_mask).sum())
        if n_excluded > 0:
            meta["filtered_rows"] = n_excluded
            meta["filtered_categories"] = excluded
            meta["warnings"].append(
                f"Excluded {n_excluded} rows with unsupported categories "
                f"(not in production CARGO_CATEGORIES): {excluded}"
            )
            df = df.loc[valid_mask].reset_index(drop=True)

    # -- Validate truck categories against canonical list --
    if filter_cargo_only:
        bad_cats = set(df["truck_category"].unique()) - set(CARGO_CATEGORIES)
        if bad_cats:
            raise DatasetValidationError(
                f"Unknown truck categories after filtering: {bad_cats}"
            )

    # -- Detect rows with critical NaN values --
    feature_nulls = df[REQUIRED_FOR_FEATURES].isnull().sum()
    cols_with_nulls = feature_nulls[feature_nulls > 0]
    if len(cols_with_nulls) > 0:
        meta["warnings"].append(
            f"Null values in feature columns: "
            f"{dict(cols_with_nulls)}"
        )

    meta["valid_rows"] = len(df)
    return df, meta


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------
def _resolve_path(path: str | Path | None) -> Path:
    """Resolve the Excel file path, searching defaults if needed."""
    if path is not None:
        p = Path(path)
        if p.exists():
            return p
        raise FileNotFoundError(f"Dataset not found at specified path: {p}")

    base = Path(__file__).parent
    for rel in _DEFAULT_PATHS:
        candidate = base / rel
        if candidate.exists():
            return candidate

    raise FileNotFoundError(
        f"Dataset not found.  Searched:\n"
        + "\n".join(f"  {base / r}" for r in _DEFAULT_PATHS)
        + "\nProvide an explicit path via load_dataset(path=...)."
    )


# ---------------------------------------------------------------------------
# CLI entry-point for quick testing
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    df, meta = load_dataset()
    print(f"Loaded dataset from: {meta['source_path']}")
    print(f"  Total rows in Excel:   {meta['total_rows']}")
    print(f"  Filtered (bad cat):    {meta['filtered_rows']}")
    print(f"  Valid rows returned:   {meta['valid_rows']}")
    if meta["warnings"]:
        print("  Warnings:")
        for w in meta["warnings"]:
            print(f"    - {w}")
    print(f"\nDataFrame shape: {df.shape}")
    print(f"Columns: {df.columns.tolist()}")
    print(f"\nTruck categories: {sorted(df['truck_category'].unique())}")
    print(f"\nFirst 3 rows:")
    print(df[["quote_id", "truck_category", "age", "dist_km",
              "diesel_price", "ds_ratio", "handling"]].head(3).to_string())
