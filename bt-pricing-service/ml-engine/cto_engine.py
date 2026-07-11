"""
cto_engine.py — Layer 1: Cost-to-Operate engine v2.0

Full parameter set from parameters.py.  Returns a detailed breakdown
of every cost component and a revenue range at 50–80% utilisation.
"""
from __future__ import annotations
from dataclasses import dataclass
import cto_data as D
import parameters as P


@dataclass
class CTOBreakdown:
    category: str; age: int; norm: str; annual_km: float; fleet_size_bracket: str
    fuel: float = 0.0; def_fluid: float = 0.0; engine_oil: float = 0.0
    gear_oil: float = 0.0; tyres: float = 0.0
    service_scheduled: float = 0.0; service_unscheduled: float = 0.0
    driver_wage: float = 0.0; fixed_annual: float = 0.0
    fleet_overhead: float = 0.0; depreciation: float = 0.0

    @property
    def variable_per_km(self):
        return self.fuel + self.def_fluid + self.engine_oil + self.gear_oil + self.tyres

    @property
    def fixed_per_km(self):
        return (self.service_scheduled + self.service_unscheduled +
                self.driver_wage + self.fixed_annual +
                self.fleet_overhead + self.depreciation)

    @property
    def total_per_km(self):
        return self.variable_per_km + self.fixed_per_km

    def trip_cost(self, distance_km, toll_inr, driver_allowance_inr,
                  loading_inr=0.0, risk_premium_inr=0.0, helper_inr=0.0):
        running = self.total_per_km * distance_km
        total = running + toll_inr + driver_allowance_inr + loading_inr + risk_premium_inr + helper_inr
        return {"running_cost": round(running), "fastag_toll": round(toll_inr),
                "driver_allowance": round(driver_allowance_inr),
                "loading_charges": round(loading_inr),
                "risk_premium": round(risk_premium_inr),
                "helper_charges": round(helper_inr),
                "total_trip_cost": round(total)}

    def revenue_range(self, distance_km, toll_inr, driver_allowance_inr,
                      loading_inr=0.0, risk_premium_inr=0.0, helper_inr=0.0,
                      min_margin=0.07):
        trip = self.trip_cost(distance_km, toll_inr, driver_allowance_inr,
                              loading_inr, risk_premium_inr, helper_inr)
        seg = D.segment_of(self.category)
        mkt = P.MARKET_RATE_PER_KM[seg]
        payload, _ = D.CAPACITY[self.category]
        floor = trip["total_trip_cost"] * (1 + min_margin)
        rows = {}
        for label, util in [("50%", 0.50), ("65%", 0.65), ("80%", 0.80)]:
            ch_mt = payload * util
            floor_u = max(floor * util, floor * 0.30)
            rows[label] = {
                "chargeable_mt": round(ch_mt, 1),
                "floor_inr": round(floor_u),
                "market_low_inr": round(mkt["low"] * distance_km * util),
                "market_mid_inr": round(mkt["mid"] * distance_km * util),
                "market_high_inr": round(mkt["high"] * distance_km * util),
                "margin_at_mid_pct": round(
                    100 * (mkt["mid"] * distance_km * util - floor_u) / max(floor_u, 1), 1),
            }
        return {"trip_cost": trip, "utilisation_scenarios": rows}


class CTOEngine:
    def __init__(self, diesel_price=None, fleet_size_bracket="1-5 trucks", params=None):
        self.p = dict(D.DEFAULTS)
        if params:
            self.p.update(params)
        if diesel_price is not None:
            self.p["diesel_price_inr_l"] = diesel_price
        self.fleet_bracket = fleet_size_bracket

    def _annual_km(self, category):
        km = D.MILEAGE_DEF[category][0]
        return float(D.TIPPER_ANNUAL_KM_OVERRIDE if "Tipper" in category and km < 10000 else km)

    def _kmpl_def(self, category, norm):
        _, kmpl6, def6, kmpl4, def4 = D.MILEAGE_DEF[category]
        return (kmpl4, def4) if norm == "BS4" else (kmpl6, def6)

    def _oil_per_km(self, table, category, norm, price):
        i_ph2, i_ph1, i_bs4, litres = table[category]
        interval = {"BS6_PH2": i_ph2, "BS6_PH1": i_ph1, "BS4": i_bs4}[norm]
        return litres * price / interval

    def breakdown(self, category, age):
        age = max(1, min(10, age))
        norm = D.norm_for_age(age)
        seg = D.segment_of(category)
        annual_km = self._annual_km(category)
        kmpl, def_pct = self._kmpl_def(category, norm)
        diesel = self.p["diesel_price_inr_l"]

        fuel = diesel / kmpl
        def_fluid = def_pct * (1.0 / kmpl) * self.p["def_price_inr_l"]
        eng_oil = self._oil_per_km(D.ENGINE_OIL, category, norm, self.p["engine_oil_price_inr_l"])
        gear_oil = self._oil_per_km(D.GEAR_OIL, category, norm, self.p["gear_oil_price_inr_l"])
        tyres = self.p["tyre_cost_per_km"][seg]

        sched_cost = D.SERVICE_COST_BY_AGE[D.SERVICE_MAP[category]][age - 1]
        unsched = P.UNSCHEDULED_PREMIUM.get(age, 0.15)
        svc_sched = sched_cost / annual_km
        svc_unsched = svc_sched * unsched

        driver = self.p["driver_wage_month_inr"][seg] * 12 / annual_km
        fixed = self.p["fixed_cost_year_inr"][seg] / annual_km
        overhead = P.FLEET_OVERHEAD_PER_VEHICLE_YEAR[self.fleet_bracket] / annual_km
        vehicle_value = self.p["fixed_cost_year_inr"][seg] * 4.5
        depreciation = vehicle_value / P.DEPRECIATION_YEARS / annual_km

        return CTOBreakdown(
            category=category, age=age, norm=norm, annual_km=annual_km,
            fleet_size_bracket=self.fleet_bracket,
            fuel=fuel, def_fluid=def_fluid, engine_oil=eng_oil, gear_oil=gear_oil,
            tyres=tyres, service_scheduled=svc_sched, service_unscheduled=svc_unsched,
            driver_wage=driver, fixed_annual=fixed, fleet_overhead=overhead,
            depreciation=depreciation)

    def cost_per_km(self, category, age):
        return self.breakdown(category, age).total_per_km

    def trip_floor(self, category, age, distance_km, toll_inr=0.0,
                   driver_allowance_inr=0.0, loading_inr=0.0,
                   risk_premium_inr=0.0, helper_inr=0.0, min_margin=0.07):
        b = self.breakdown(category, age)
        tc = b.trip_cost(distance_km, toll_inr, driver_allowance_inr,
                         loading_inr, risk_premium_inr, helper_inr)
        return tc["total_trip_cost"] * (1 + min_margin)
