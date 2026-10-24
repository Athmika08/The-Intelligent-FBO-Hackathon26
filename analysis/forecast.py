"""ArrivalIQ: forecast Super Bowl week arrivals from an analyzed baseline.

Inputs:
    baseline.csv          Normal weekday / 2-hour arrival averages (84 rows)
    superbowl_impact.csv  Assumed Super Bowl weekday multipliers (7 rows)
Outputs:
    dashboard_data.json   Scenario forecasts and preparation metrics for the UI
    forecast_2027.csv     Forecasts in tabular form

The baseline is calculated upstream by baseline_analysis.py. This script reads
that completed summary; it does not retrain a model from baseline_raw.csv.
The forecast is statistical, not machine-learning-based.
"""

import argparse
import csv
import json
import math
from datetime import date, timedelta
from pathlib import Path

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SCENARIOS = ("low", "medium", "high")
START_DATE = date(2027, 2, 10)
INTERVAL_START_HOURS = range(0, 24, 2)
REGULAR_TEAMS = 1
MAX_EXTRA_TEAMS = 2
CAPACITY_PER_TEAM_PER_2H = 4


def read_csv(path):
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"CSV contains no data: {path}")
    return rows


def day_index(day):
    day = str(day).strip().capitalize()
    if day not in DAYS:
        raise ValueError(f"Invalid day_of_week {day!r}")
    return DAYS.index(day)


def hour_index(value):
    hour = int(value)
    if hour not in INTERVAL_START_HOURS:
        raise ValueError(f"Invalid 2-hour interval start: {value}")
    return hour


def load_baseline_profile(folder):
    """Load analyzed weekday/hour averages from baseline.csv."""
    rows = read_csv(folder / "baseline.csv")
    lookup = {}
    for row in rows:
        key = (day_index(row["day_of_week"]), hour_index(row["hour"]))
        if key in lookup:
            raise ValueError(f"Duplicate weekday / 2-hour interval: {key}")
        mean = float(row["avg_arrivals"])
        if not math.isfinite(mean) or mean < 0:
            raise ValueError(f"Invalid avg_arrivals at {key}: {mean}")
        lookup[key] = mean

    expected_keys = {(d, h) for d in range(7) for h in INTERVAL_START_HOURS}
    if set(lookup) != expected_keys:
        missing = sorted(expected_keys - set(lookup))
        raise ValueError(f"baseline.csv must contain all 84 weekday-hour pairs; missing: {missing[:5]}")
    return lookup


def load_event_multipliers(folder):
    rows = read_csv(folder / "superbowl_impact.csv")
    result = {}
    for row in rows:
        d = day_index(row["day_of_week"])
        multiplier = float(row["medium_multiplier"])
        if not math.isfinite(multiplier) or multiplier < 0:
            raise ValueError(f"Invalid medium multiplier for {DAYS[d]}")
        if d in result:
            raise ValueError(f"Duplicate impact multiplier for {DAYS[d]}")
        result[d] = multiplier
    if set(result) != set(range(7)):
        raise ValueError("superbowl_impact.csv must contain every weekday exactly once")
    return result


def adjusted_multiplier(medium_multiplier, scenario):
    factor = {"low": 0.5, "medium": 1.0, "high": 1.5}[scenario]
    return max(0.0, 1.0 + factor * (medium_multiplier - 1.0))


def rounded_aircraft(number):
    """Round expected aircraft to nearest whole aircraft, with .5 rounded up."""
    return int(math.floor(number + 0.5))


def distribute_daily_forecast(expected_intervals):
    """Convert 12 expected interval counts to integers while preserving the daily total.

    Independent interval rounding can falsely increase the day total even if the
    event multiplier is exactly 1.0. Largest-remainder allocation avoids that.
    """
    floors = [int(math.floor(value)) for value in expected_intervals]
    target_total = rounded_aircraft(sum(expected_intervals))
    remainder = target_total - sum(floors)
    ranking = sorted(range(len(expected_intervals)),
                     key=lambda idx: (-(expected_intervals[idx] - floors[idx]), idx))
    for idx in ranking[:remainder]:
        floors[idx] += 1
    return floors


def build_baseline_summary(baseline):
    profile = []
    daily = []
    for d in range(7):
        day_total = 0.0
        for hour in INTERVAL_START_HOURS:
            value = baseline[(d, hour)]
            day_total += value
            profile.append({
                "day_of_week": DAYS[d],
                "start_hour": hour,
                "avg_arrivals": round(value, 2),
            })
        daily.append({"day_of_week": DAYS[d], "average_arrivals": round(day_total, 2)})
    weekly_total = sum(x["average_arrivals"] for x in daily)
    peak = max(profile, key=lambda r: r["avg_arrivals"])
    return {
        "description": "Analyzed synthetic weekday-by-2-hour averages used directly for forecasting.",
        "profile": profile,
        "daily": daily,
        "ordinary_week_expected_arrivals": round(weekly_total, 2),
        "average_daily_arrivals": round(weekly_total / 7, 2),
        "highest_average_interval": peak,
        "source_file": "baseline.csv",
    }


def forecast(baseline, medium_multipliers):
    dashboard = {
        "metadata": {
            "project": "ArrivalIQ",
            "airport": "Los Angeles International Airport (KLAX / LAX)",
            "fbo": "Valley Jet FBO (fictional)",
            "timezone": "America/Los_Angeles",
            "forecast_start": "2027-02-10",
            "forecast_end": "2027-02-16",
            "interval_hours": 2,
            "data_type": "synthetic baseline + historically informed synthetic event adjustments",
            "warning": "Planning support only. No landing, aircraft movement, or safety authorization.",
        },
        "model": {
            "method": "Statistical baseline-profile forecast with historical-event-informed scenario multipliers",
            "baseline_source": "baseline.csv (output of baseline_analysis.py)",
            "event_source": "superbowl_impact.csv (daily demand multipliers)",
            "baseline_test_mae_aircraft_per_2h": None,
            "note": "No Random Forest is trained; analyzed baseline averages are used directly. This is a statistical scenario model, not a trained ML model. Model accuracy against actual 2027 arrivals is not available.",
        },
        "assumptions": {
            "regular_service_teams": REGULAR_TEAMS,
            "maximum_extra_teams": MAX_EXTRA_TEAMS,
            "aircraft_per_team_per_2h": CAPACITY_PER_TEAM_PER_2H,
            "short_stay_share": 0.7,
            "short_stay_mean_hours": 3,
            "long_stay_share": 0.3,
            "long_stay_mean_hours": 18,
            "fuel_purchase_share": 0.7,
            "fuel_gallons_per_purchasing_aircraft": 250,
            "parking_and_fuel_usage": "Disclosed assumptions only; not used by arrival forecast.",
            "uplift_source": "Research-informed synthetic planning assumptions; see historical_sources.md.",
            "scenario_definition": "low=1+0.5*(medium-1); medium=medium; high=1+1.5*(medium-1)",
            "rounding": "Expected arrivals are allocated to 2-hour intervals using largest remainder, preserving each daily total rounded half-up.",
        },
        "baseline_analysis": build_baseline_summary(baseline),
        "research_context": {
            "historical_references_from_team_research": [
                {
                    "event": "Phoenix 2023",
                    "reported_arrival_ratio": 1.9,
                    "source": "https://www.ainonline.com/aviation-news/business-aviation/2024-02-13/super-bowl-draws-flocks-aircraft-numbers-down-previous",
                },
                {
                    "event": "Las Vegas 2024",
                    "reported_arrival_ratio": 1.5,
                    "source": "https://www.ainonline.com/aviation-news/business-aviation/2024-02-13/super-bowl-draws-flocks-aircraft-numbers-down-previous",
                },
            ],
            "daily_medium_multipliers": [
                {"day_of_week": DAYS[d], "multiplier": medium_multipliers[d]}
                for d in range(7)
            ],
            "evidence_warning": "Historical metro-area ratios are research anchors; weekday-specific multipliers are planning assumptions, not observed traffic at this FBO.",
        },
        "scenarios": {},
    }
    csv_rows = []
    for scenario in SCENARIOS:
        intervals, daily = [], []
        for offset in range(7):
            current = START_DATE + timedelta(days=offset)
            d = current.weekday()
            multiplier = adjusted_multiplier(medium_multipliers[d], scenario)
            current_day_intervals = []
            expected_by_hour = [baseline[(d, hour)] * multiplier for hour in INTERVAL_START_HOURS]
            allocated_by_hour = distribute_daily_forecast(expected_by_hour)
            for hour, arrivals in zip(INTERVAL_START_HOURS, allocated_by_hour):
                baseline_expected = baseline[(d, hour)]
                capacity_before = REGULAR_TEAMS * CAPACITY_PER_TEAM_PER_2H
                teams_needed = max(0, math.ceil(arrivals / CAPACITY_PER_TEAM_PER_2H) - REGULAR_TEAMS)
                extra = min(MAX_EXTRA_TEAMS, teams_needed)
                capacity_after = (REGULAR_TEAMS + extra) * CAPACITY_PER_TEAM_PER_2H
                row = {
                    "date": current.isoformat(),
                    "day_of_week": DAYS[d],
                    "start_hour": hour,
                    "end_hour": hour + 2,
                    "time_label": f"{hour:02d}:00-{hour+2:02d}:00",
                    "baseline_arrivals": round(baseline_expected, 2),
                    "predicted_arrivals": arrivals,
                    "capacity_before": capacity_before,
                    "recommended_extra_teams": extra,
                    "capacity_after": capacity_after,
                    "uncovered_before": max(0, arrivals - capacity_before),
                    "uncovered_after": max(0, arrivals - capacity_after),
                }
                current_day_intervals.append(row)
                intervals.append(row)
                csv_rows.append({"scenario": scenario, **row})
            daily.append({
                "date": current.isoformat(),
                "day_of_week": DAYS[d],
                "baseline_arrivals": round(sum(r["baseline_arrivals"] for r in current_day_intervals), 2),
                "predicted_arrivals": sum(r["predicted_arrivals"] for r in current_day_intervals),
                "multiplier": round(multiplier, 4),
            })
        total = sum(row["predicted_arrivals"] for row in intervals)
        peak = max(intervals, key=lambda r: r["predicted_arrivals"])
        before_served = sum(min(r["predicted_arrivals"], r["capacity_before"]) for r in intervals)
        after_served = sum(min(r["predicted_arrivals"], r["capacity_after"]) for r in intervals)
        dashboard["scenarios"][scenario] = {
            "summary": {
                "baseline_weekly_arrivals": round(sum(r["baseline_arrivals"] for r in daily), 2),
                "predicted_weekly_arrivals": total,
                "peak_date": peak["date"],
                "peak_time": peak["time_label"],
                "peak_arrivals": peak["predicted_arrivals"],
                "coverage_before_pct": round(100 * before_served / total, 1) if total else 100,
                "coverage_after_pct": round(100 * after_served / total, 1) if total else 100,
                "intervals_with_shortage_before": sum(r["uncovered_before"] > 0 for r in intervals),
                "intervals_with_shortage_after": sum(r["uncovered_after"] > 0 for r in intervals),
                "intervals_requiring_extra_teams": sum(r["recommended_extra_teams"] > 0 for r in intervals),
            },
            "daily": daily,
            "intervals": intervals,
        }
    return dashboard, csv_rows


def main():
    parser = argparse.ArgumentParser(description="Forecast using analyzed baseline statistics")
    parser.add_argument("--input-dir", default=".", help="Folder with baseline.csv and superbowl_impact.csv")
    parser.add_argument("--output-dir", default=".", help="Folder for dashboard_data.json and forecast_2027.csv")
    args = parser.parse_args()
    input_dir, output_dir = Path(args.input_dir), Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    baseline = load_baseline_profile(input_dir)
    multipliers = load_event_multipliers(input_dir)
    dashboard, csv_rows = forecast(baseline, multipliers)

    (output_dir / "dashboard_data.json").write_text(
        json.dumps(dashboard, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with (output_dir / "forecast_2027.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(csv_rows[0]))
        writer.writeheader()
        writer.writerows(csv_rows)
    print("Baseline used: analyzed baseline.csv (not baseline_raw.csv)")
    print(f"Ordinary-week expected arrivals: {dashboard['baseline_analysis']['ordinary_week_expected_arrivals']:.2f}")
    for scenario in SCENARIOS:
        summary = dashboard["scenarios"][scenario]["summary"]
        print(f"{scenario.title():6}: {summary['predicted_weekly_arrivals']} arrivals | peak {summary['peak_date']} {summary['peak_time']}, {summary['peak_arrivals']} arrivals")
    print(f"Output: {output_dir / 'dashboard_data.json'}")
    print(f"Output: {output_dir / 'forecast_2027.csv'}")


if __name__ == "__main__":
    main()
