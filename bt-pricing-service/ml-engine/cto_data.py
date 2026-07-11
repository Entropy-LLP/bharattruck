"""
cto_data.py — Vehicle operating-cost reference data for BharatTruck Pricing Engine.

All tables below are extracted from the four uploaded TMCV vehicle-parc images:
  1. Vehicle_Model_Wise_Mileage___DEF_Usage.jpeg
  2. Vehicle_Model_Wise_Annual_Service_Cost.jpeg
  3. Vehicle_Model_Wise_Engine_Oil_Consumption.jpeg
  4. Vehicle_Model_Wise_Gear_Oil_Consumption.jpeg

DATA FLAGS (assumptions made, documented for review):
  [F1] Oil-file swap: the file *named* "Engine Oil" carries 160k/160k/120k km
       intervals with 9.75-13.2 L/change (gearbox-like), while the file *named*
       "Gear Oil" carries 120k/120k/80k intervals with 20-25 L/change
       (engine-sump-like). Physically, HCV engine sumps are ~20-25 L drained at
       shorter intervals; gearboxes hold ~9-13 L drained at longer intervals.
       => The tables below are assigned by PHYSICAL meaning, not filename.
  [F2] Tippers show "2400 kms per year" in the source — interpreted as engine
       HOURS, not km. Road-CTO uses TIPPER_ANNUAL_KM_OVERRIDE instead.
  [F3] BS4 KMPL / DEF% cells blank for some ICV/LCV/SCV rows in image 1 —
       backfilled with the BS6 value (conservative).
"""

# ---------------------------------------------------------------------------
# Model categories (rows common to all four images) T mentioned in each is the weight of the truck.
# ---------------------------------------------------------------------------
MODEL_CATEGORIES = [
    "HCV Cargo 25-31T", "HCV Cargo 35-40T", "HCV Cargo 42-48T",
    "HCV Cargo 49-55T", "HCV Tippers >25T", "ICV Cargo (Upto 14T)",
    "ILCV Buses", "ILCV Tippers", "LCV (4-7T)", "MCV Cargo (15-19T)",
    "MHCV Buses", "MHCV Tippers Upto 25T", "Pickups", "SCV Cargo", "SCV Pass",
]

# ---------------------------------------------------------------------------
# Image 1 — Mileage & DEF usage
#   kms_per_year, KMPL (BS6), DEF % of diesel (BS6), KMPL (BS4), DEF % (BS4)
# ---------------------------------------------------------------------------
MILEAGE_DEF = {
    #  category                : (km/yr,  kmpl6, def6,   kmpl4, def4)
    "HCV Cargo 25-31T":          (72000,  4.03, 0.0464,  4.13, 0.0315),
    "HCV Cargo 35-40T":          (72000,  3.22, 0.0526,  3.54, 0.0319),
    "HCV Cargo 42-48T":          (72000,  3.36, 0.0545,  2.90, 0.0320),
    "HCV Cargo 49-55T":          (72000,  2.54, 0.0556,  2.60, 0.0337),
    "HCV Tippers >25T":          (2400,   9.68, 0.0600, 10.10, 0.0322),  # [F2] hours
    "ICV Cargo (Upto 14T)":      (56000,  6.23, 0.0324,  6.23, 0.0324),  # [F3]
    "ILCV Buses":                (60000,  6.23, 0.0324,  6.23, 0.0324),  # [F3]
    "ILCV Tippers":              (46000,  6.23, 0.0324,  6.23, 0.0324),  # [F3]
    "LCV (4-7T)":                (40000,  7.31, 0.0196,  7.31, 0.0196),  # [F3]
    "MCV Cargo (15-19T)":        (66000,  4.98, 0.0508,  5.00, 0.0197),
    "MHCV Buses":                (80000,  4.98, 0.0508,  4.98, 0.0508),
    "MHCV Tippers Upto 25T":     (2400,   9.28, 0.0417,  7.21, 0.0550),  # [F2]
    "Pickups":                   (30000, 14.92, 0.0346, 14.92, 0.0346),  # [F3]
    "SCV Cargo":                 (24000, 14.92, 0.0346, 14.92, 0.0346),  # [F3]
    "SCV Pass":                  (30000, 14.92, 0.0600, 14.92, 0.0600),  # [F3]
}

TIPPER_ANNUAL_KM_OVERRIDE = 50000  # [F2] assumed road-km/year for tipper CTO

# ---------------------------------------------------------------------------
# Image 1 — FY25 vehicle parc by age (Age 1 .. Age 10). Used as supply prior
# in the market simulator (relative truck availability by category).
# ---------------------------------------------------------------------------
VEHICLE_PARC_FY25 = {
    "HCV Cargo 25-31T":      [7119, 5405, 7545, 6423, 3577, 10311, 25862, 22879, 36731, 49986],
    "HCV Cargo 35-40T":      [6365, 6189, 8331, 5933, 3571, 16708, 49429, 50103, 32145, 30124],
    "HCV Cargo 42-48T":      [21098, 27531, 29599, 19481, 9163, 12102, 1915, 0, 0, 0],
    "HCV Cargo 49-55T":      [34997, 36204, 30588, 15818, 5332, 7382, 13120, 14241, 4587, 2595],
    "HCV Tippers >25T":      [36071, 39178, 36193, 26345, 17693, 7754, 9221, 3578, 2344, 1840],
    "ICV Cargo (Upto 14T)":  [14088, 12483, 14651, 17148, 10959, 15645, 19531, 13132, 14345, 15780],
    "ILCV Buses":            [21395, 18148, 17236, 4585, 2233, 19034, 19286, 15826, 18804, 16942],
    "ILCV Tippers":          [4973, 4653, 4402, 4058, 4361, 5327, 5850, 4317, 3573, 2782],
    "LCV (4-7T)":            [16138, 14918, 17315, 16979, 13468, 21288, 24340, 21897, 20393, 19642],
    "MCV Cargo (15-19T)":    [24838, 24752, 27759, 25654, 11543, 19697, 18686, 12149, 16527, 14900],
    "MHCV Buses":            [6772, 3999, 3840, 2028, 941, 7683, 6962, 6144, 11358, 7717],
    "MHCV Tippers Upto 25T": [2437, 2110, 2147, 3037, 2819, 22046, 34091, 22751, 26586, 20833],
    "Pickups":               [55921, 62068, 66626, 60081, 43436, 40590, 50935, 52239, 40262, 27717],
    "SCV Cargo":             [81616, 94958, 115940, 103264, 76619, 142830, 148563, 104064, 84775, 87282],
    "SCV Pass":              [21508, 16812, 13677, 7600, 3232, 18379, 28513, 25794, 24767, 29074],
}

# Emission-norm transition by age (FY25 view, from image 1 header):
#   Age 1-4 -> BS6 Phase 2 ; Age 5-7 -> BS6 Phase 1 ; Age 8-10 -> BS4
def norm_for_age(age: int) -> str:
    if age <= 4:
        return "BS6_PH2"
    if age <= 7:
        return "BS6_PH1"
    return "BS4"

# ---------------------------------------------------------------------------
# Image 2 — Total service cost (Rs) per vehicle per year, by age 1..10
# ---------------------------------------------------------------------------
SERVICE_COST_BY_AGE = {
    "MHCV Cargo": [108313, 186542, 209098, 195710, 140402, 107454, 79837, 72365, 86298, 60789],
    "Tippers":    [224923, 366491, 355859, 312640, 166580, 100785, 85474, 87204, 85525, 80190],
    "ICV Cargo":  [58330, 89101, 87613, 66368, 62049, 43898, 33648, 32583, 32245, 28532],
    "ILCV Buses": [125328, 187810, 160358, 103609, 105448, 67585, 53675, 49217, 46622, 38525],
    "MHCV Buses": [154899, 274612, 227214, 112949, 96698, 70648, 58739, 54351, 54499, 44956],
    "LCV Cargo":  [31414, 41418, 38910, 32763, 31828, 20882, 19099, 18985, 18569, 16384],
    "SCV and PU": [24376, 36998, 35193, 41608, 43066, 32228, 21082, 21285, 27095, 27376],
    "SCV Pass":   [14804, 68080, 147194, 58844, 106849, 21376, 21365, 19146, 21089, 21985],
}

# Map model categories -> service-cost rows
SERVICE_MAP = {
    "HCV Cargo 25-31T": "MHCV Cargo", "HCV Cargo 35-40T": "MHCV Cargo",
    "HCV Cargo 42-48T": "MHCV Cargo", "HCV Cargo 49-55T": "MHCV Cargo",
    "MCV Cargo (15-19T)": "MHCV Cargo",
    "HCV Tippers >25T": "Tippers", "MHCV Tippers Upto 25T": "Tippers",
    "ILCV Tippers": "Tippers",
    "ICV Cargo (Upto 14T)": "ICV Cargo",
    "ILCV Buses": "ILCV Buses", "MHCV Buses": "MHCV Buses",
    "LCV (4-7T)": "LCV Cargo",
    "Pickups": "SCV and PU", "SCV Cargo": "SCV and PU",
    "SCV Pass": "SCV Pass",
}

# ---------------------------------------------------------------------------
# Oil consumption  [F1: assigned by physical meaning, see header]
# ENGINE oil  <- file named "Gear Oil":  intervals (BS6PH2, BS6PH1, BS4, old)
#                and litres per change.
# GEAR oil    <- file named "Engine Oil": longer intervals, smaller volumes.
# Tipper rows use the 2500/2500/2000/1500 figures (engine-hours based) —
# normalised here to km using TIPPER_ANNUAL_KM_OVERRIDE elsewhere.
# ---------------------------------------------------------------------------
ENGINE_OIL = {  # category: (km_int_BS6PH2, km_int_BS6PH1, km_int_BS4, litres/change)
    "HCV Cargo 25-31T":      (120000, 120000, 80000, 24.5),
    "HCV Cargo 35-40T":      (120000, 120000, 80000, 25.0),
    "HCV Cargo 42-48T":      (120000, 120000, 80000, 25.0),
    "HCV Cargo 49-55T":      (120000, 120000, 80000, 25.0),
    "HCV Tippers >25T":      (60000,  60000,  48000, 25.0),   # hours->km normalised
    "ICV Cargo (Upto 14T)":  (100000, 80000,  60000, 12.0),
    "ILCV Buses":            (100000, 60000,  40000, 12.0),
    "ILCV Tippers":          (100000, 80000,  60000, 13.0),
    "LCV (4-7T)":            (100000, 80000,  60000, 11.0),
    "MCV Cargo (15-19T)":    (120000, 80000,  60000, 22.5),
    "MHCV Buses":            (100000, 80000,  60000, 22.5),
    "MHCV Tippers Upto 25T": (60000,  60000,  48000, 22.5),   # hours->km normalised
    "Pickups":               (20000,  20000,  10000, 7.5),
    "SCV Cargo":             (20000,  20000,  10000, 4.5),
    "SCV Pass":              (20000,  20000,  10000, 7.5),
}

GEAR_OIL = {  # category: (km_int_BS6PH2, km_int_BS6PH1, km_int_BS4, litres/change)
    "HCV Cargo 25-31T":      (160000, 160000, 120000, 9.75),
    "HCV Cargo 35-40T":      (160000, 160000, 120000, 11.2),
    "HCV Cargo 42-48T":      (160000, 160000, 120000, 13.2),
    "HCV Cargo 49-55T":      (160000, 160000, 120000, 13.2),
    "HCV Tippers >25T":      (75000,  75000,  62500, 13.2),   # hours->km normalised
    "ICV Cargo (Upto 14T)":  (160000, 160000, 120000, 12.0),
    "ILCV Buses":            (160000, 160000, 120000, 6.8),
    "ILCV Tippers":          (160000, 160000, 120000, 6.5),
    "LCV (4-7T)":            (120000, 120000, 80000,  6.3),
    "MCV Cargo (15-19T)":    (160000, 160000, 120000, 9.6),
    "MHCV Buses":            (160000, 160000, 120000, 7.6),
    "MHCV Tippers Upto 25T": (62500,  62500,  50000,  11.9),  # hours->km normalised
    "Pickups":               (120000, 120000, 80000,  4.1),
    "SCV Cargo":             (120000, 120000, 80000,  2.4),
    "SCV Pass":              (120000, 120000, 80000,  4.1),
}

# ---------------------------------------------------------------------------
# Parameters NOT present in the images — explicit, overridable defaults
# (industry-typical India CV figures, June 2026)
# ---------------------------------------------------------------------------
DEFAULTS = {
    "diesel_price_inr_l": 92.0,        # IOCL daily price — runtime input
    "def_price_inr_l": 55.0,
    "engine_oil_price_inr_l": 410.0,   # CI-4+/CK-4 CV grade
    "gear_oil_price_inr_l": 350.0,
    # tyre cost Rs/km by gross segment
    "tyre_cost_per_km": {"HCV": 2.6, "MHCV": 2.2, "ICV": 1.5, "ILCV": 1.4,
                         "LCV": 1.1, "MCV": 1.9, "SCV": 0.55, "PU": 0.55},
    "driver_wage_month_inr": {"HCV": 32000, "MHCV": 30000, "ICV": 25000,
                              "ILCV": 24000, "LCV": 22000, "MCV": 28000,
                              "SCV": 18000, "PU": 18000},
    # fixed cost (EMI+insurance+permit+misc) Rs/year by segment
    "fixed_cost_year_inr": {"HCV": 1140000, "MHCV": 960000, "ICV": 600000,
                            "ILCV": 540000, "LCV": 420000, "MCV": 780000,
                            "SCV": 240000, "PU": 220000},
    "platform_take_rate": 0.04,        # 4% marketplace commission
}

def segment_of(category: str) -> str:
    c = category.upper()
    if c.startswith("HCV"):
        return "HCV"
    if c.startswith("MHCV"):
        return "MHCV"
    if c.startswith("ILCV"):
        return "ILCV"
    if c.startswith("ICV"):
        return "ICV"
    if c.startswith("LCV"):
        return "LCV"
    if c.startswith("MCV"):
        return "MCV"
    if c.startswith("PICKUP"):
        return "PU"
    return "SCV"

# ---------------------------------------------------------------------------
# v1.1 — Capacity & cargo-handling configuration
# Rated payload (MT) and body volume (CFT) by category — typical Indian CV
# body specs; override per real fleet data.
# ---------------------------------------------------------------------------
CAPACITY = {  # category: (payload_mt, volume_cft)
    "HCV Cargo 25-31T":      (21.0, 1450),
    "HCV Cargo 35-40T":      (27.0, 1900),
    "HCV Cargo 42-48T":      (33.0, 2300),
    "HCV Cargo 49-55T":      (40.0, 2700),
    "HCV Tippers >25T":      (19.0, 700),
    "ICV Cargo (Upto 14T)":  (9.0,  750),
    "ILCV Buses":            (5.0,  400),
    "ILCV Tippers":          (7.0,  350),
    "LCV (4-7T)":            (4.5,  450),
    "MCV Cargo (15-19T)":    (12.0, 1000),
    "MHCV Buses":            (8.0,  600),
    "MHCV Tippers Upto 25T": (16.0, 600),
    "Pickups":               (1.5,  180),
    "SCV Cargo":             (1.0,  140),
    "SCV Pass":              (0.8,  120),
}

VOLUMETRIC_KG_PER_CFT = 10.0      # Indian road PTL convention: 1 CFT = 10 kg

# Handling surcharges (multiplier on freight) and transit-risk insurance
# rates (fraction of declared cargo value per trip)
HANDLING = {
    "general":  {"surcharge": 0.00, "risk_rate": 0.0005},
    "fragile":  {"surcharge": 0.05, "risk_rate": 0.0012},
    "hazmat":   {"surcharge": 0.12, "risk_rate": 0.0015},
    "reefer":   {"surcharge": 0.18, "risk_rate": 0.0008},
    "odc":      {"surcharge": 0.25, "risk_rate": 0.0010},
}
MANUAL_LOADING_INR_PER_MT = 180.0
ODC_PERMIT_FEE_INR = 4500.0
PTL_PREMIUM = 0.18                # consolidation/handling premium on PTL
EWB_VALUE_THRESHOLD_INR = 50000
