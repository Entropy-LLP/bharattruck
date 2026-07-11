"""
parameters.py — Complete parameter registry for BharatTruck Pricing Engine v2.0

Every parameter that enters the pricing model is defined here with:
  - its value / formula
  - its data source (image-grounded, platform-captured, or configurable default)
  - the lever used to collect it from shippers / fleet operators
"""
import cto_data as D

CAPACITY = D.CAPACITY
ANNUAL_KM = {cat: D.MILEAGE_DEF[cat][0] for cat in D.MODEL_CATEGORIES}
TIPPER_ANNUAL_KM = D.TIPPER_ANNUAL_KM_OVERRIDE
KMPL = {cat: {"BS6": D.MILEAGE_DEF[cat][1], "BS4": D.MILEAGE_DEF[cat][3]}
        for cat in D.MODEL_CATEGORIES}
DEF_PCT = {cat: {"BS6": D.MILEAGE_DEF[cat][2], "BS4": D.MILEAGE_DEF[cat][4]}
           for cat in D.MODEL_CATEGORIES}

def emission_norm(age): return D.norm_for_age(age)

VEHICLE_PARC_FY25 = D.VEHICLE_PARC_FY25
VOLUMETRIC_KG_PER_CFT = D.VOLUMETRIC_KG_PER_CFT

def chargeable_mt(weight_mt, volume_cft):
    return max(weight_mt, volume_cft * VOLUMETRIC_KG_PER_CFT / 1000.0)

UTIL_TIERS = {"min_modelled": 0.50, "target": 0.65, "optimal": 0.80}
HANDLING = D.HANDLING
EWB_THRESHOLD_INR = D.EWB_VALUE_THRESHOLD_INR
MANUAL_LOADING_INR_MT = D.MANUAL_LOADING_INR_PER_MT
ODC_PERMIT_FEE = D.ODC_PERMIT_FEE_INR
PTL_PREMIUM = D.PTL_PREMIUM

DIESEL_PRICE_DEFAULT = D.DEFAULTS["diesel_price_inr_l"]
DEF_PRICE = D.DEFAULTS["def_price_inr_l"]

FASTTAG_RATE_PER_KM = {"HCV": 2.0, "MHCV": 2.0, "MCV": 1.7, "ICV": 1.5,
                        "ILCV": 1.4, "LCV": 1.2, "SCV": 0.7, "PU": 0.6}
MONSOON_UPLIFT  = 0.06
HARVEST_UPLIFT  = 0.09

DRIVER_WAGE_MONTHLY = D.DEFAULTS["driver_wage_month_inr"]

def driver_allowance_inr(distance_km):
    return 600 + 0.45 * distance_km

HELPER_WAGE_PER_TRIP = 500

FLEET_OVERHEAD_PER_VEHICLE_YEAR = {
    "1-5 trucks":   48000,
    "6-20 trucks":  72000,
    "21-50 trucks": 96000,
    "50+ trucks":  130000,
}

PLATFORM_COMMISSION = 0.04
BROKER_COMMISSION = {"none": 0.0, "local": 0.03, "national": 0.05}

SERVICE_COST_BY_AGE = D.SERVICE_COST_BY_AGE
SERVICE_MAP = D.SERVICE_MAP

def service_cost_per_km(category, age):
    annual_km = max(ANNUAL_KM.get(category, 40000),
                    TIPPER_ANNUAL_KM if "Tipper" in category else 40000)
    return D.SERVICE_COST_BY_AGE[D.SERVICE_MAP[category]][min(age, 10) - 1] / annual_km

ENGINE_OIL = D.ENGINE_OIL
ENGINE_OIL_PRICE = D.DEFAULTS["engine_oil_price_inr_l"]
GEAR_OIL = D.GEAR_OIL
GEAR_OIL_PRICE = D.DEFAULTS["gear_oil_price_inr_l"]
TYRE_COST_PER_KM = D.DEFAULTS["tyre_cost_per_km"]
FIXED_COST_YEAR = D.DEFAULTS["fixed_cost_year_inr"]

UNSCHEDULED_PREMIUM = {1: 0.10, 2: 0.15, 3: 0.25, 4: 0.30, 5: 0.25,
                       6: 0.20, 7: 0.18, 8: 0.15, 9: 0.12, 10: 0.10}
DEPRECIATION_YEARS = 8

UTILISATION_RANGE = (0.50, 0.80)

MARKET_RATE_PER_KM = {
    "HCV":  {"low": 50, "mid": 62, "high": 76},
    "MHCV": {"low": 42, "mid": 52, "high": 65},
    "MCV":  {"low": 37, "mid": 46, "high": 58},
    "ICV":  {"low": 30, "mid": 38, "high": 48},
    "ILCV": {"low": 27, "mid": 34, "high": 43},
    "LCV":  {"low": 22, "mid": 28, "high": 35},
    "SCV":  {"low": 15, "mid": 19, "high": 24},
    "PU":   {"low": 13, "mid": 17, "high": 21},
}

OPERATING_DAYS_YEAR = {"long_haul": 280, "regional": 300, "local": 310}

BACKHAUL_CAPTURE_PRIOR = {
    "balanced_lane": 0.65,
    "imbalanced_outbound_heavy": 0.40,
    "imbalanced_return_heavy": 0.75,
}

DATA_LEVERS = {
    "vehicle_category":             "Truck RC scan (VAHAN API) at on-boarding",
    "vehicle_age":                  "RC registration year → age = FY - reg_year",
    "emission_norm":                "Engine number prefix OR reg year + category lookup",
    "fleet_size":                   "Self-declared at on-boarding; verified vs VAHAN RC list",
    "driver_wage":                  "Fleet operator HR profile question; bracket selector",
    "fixed_cost_emi_insurance":     "Loan statement upload OR finance partner API (Shriram, IIFL)",
    "tyre_brand_log":               "Tyre purchase receipt upload; brand → cost/km table",
    "fuel_log":                     "Driver app fuel fill entry (litres + pump + GPS)",
    "actual_kmpl":                  "Odometer reading pairs from AIS-140 + fuel log volume",
    "service_records":              "Workshop invoice upload OCR; maps to service schedule",
    "oil_change_log":               "Workshop invoice OCR; cross-check vs interval table",
    "annual_km_actual":             "AIS-140 odometer delta over 12 months",
    "cargo_weight_mt":              "Shipper booking form: gross weight field (MT)",
    "cargo_volume_cft":             "Shipper booking form: L×W×H (cm) → auto-convert to CFT",
    "cargo_value_inr":              "Shipper booking form: invoice value (mandatory for EWB)",
    "handling_class":               "Shipper booking form: commodity dropdown → handling rule",
    "manual_loading_flag":          "Shipper booking form: loading method selector",
    "load_type_ftl_ptl":            "Shipper booking form: FTL / PTL selector",
    "urgency_flag":                 "Shipper booking form: required pickup date vs today",
    "corridor_or_distance":         "Shipper booking form: origin/destination → routing API km",
    "broker_mediated":              "Order source: marketplace vs broker link vs direct shipper",
    "diesel_price_daily":           "IOCL daily price API (source city)",
    "fastag_toll_actual":           "NHAI FASTag API per toll plaza on route",
    "demand_supply_ratio":          "Platform: open load posts / available trucks per corridor/day",
    "monsoon_flag":                 "IMD zone API: active monsoon on corridor (Jun–Sep)",
    "harvest_flag":                 "Calendar: Oct–Nov (kharif) and Mar–Apr (rabi)",
    "backhaul_history":             "Platform trip log: delivery city → matched return loads, by operator",
    "operator_shippers_at_dest":    "Platform CRM: shipper accounts with pickup at destination city",
    "open_return_loads":            "Platform marketplace: open load posts with origin = delivery city",
    "historical_lane_rates":        "Platform rate_quote table: matched quotes per OD pair per month",
}
