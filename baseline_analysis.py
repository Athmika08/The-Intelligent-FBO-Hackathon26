"""Generate and analyze a four-week synthetic aircraft-arrival baseline.

Outputs:
    baseline_raw.csv        336 raw records (28 days x 12 intervals)
    baseline.csv            84 day-of-week/interval averages
    baseline_visualization.png

Run:
    python baseline_analysis.py
"""

from pathlib import Path
import argparse

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt


INTERVAL_HOURS = list(range(0, 24, 2))
DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def generate_baseline(start_date: str = "2026-01-05", seed: int = 42) -> pd.DataFrame:
    """Create 28 days of 2-hour arrival counts using a Poisson model."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(start=start_date, periods=28, freq="D")

    # Relative time-of-day pattern. Values are normalized below, so the
    # overall expected total remains approximately 25 arrivals per day.
    time_weights = {
        0: 0.25, 2: 0.15, 4: 0.20, 6: 0.55,
        8: 1.20, 10: 1.45, 12: 1.10, 14: 1.00,
        16: 1.30, 18: 1.20, 20: 0.55, 22: 0.30,
    }

    # Weekday multipliers make weekdays busier while preserving variation.
    day_weights = {
        "Monday": 0.95, "Tuesday": 1.05, "Wednesday": 1.10,
        "Thursday": 1.15, "Friday": 1.20, "Saturday": 0.85, "Sunday": 0.70,
    }

    time_total = sum(time_weights.values())
    rows = []
    for date in dates:
        day_name = date.day_name()
        day_factor = day_weights[day_name]
        for hour in INTERVAL_HOURS:
            expected = 25 * day_factor * time_weights[hour] / time_total
            arrivals = int(rng.poisson(expected))
            rows.append(
                {
                    "date": date.strftime("%Y-%m-%d"),
                    "day_of_week": day_name,
                    "hour": hour,
                    "arrivals": arrivals,
                }
            )

    return pd.DataFrame(rows)


def analyze_baseline(raw: pd.DataFrame) -> pd.DataFrame:
    """Aggregate raw arrivals to the requested day/interval baseline."""
    baseline = (
        raw.groupby(["day_of_week", "hour"], as_index=False)["arrivals"]
        .mean()
        .rename(columns={"arrivals": "avg_arrivals"})
    )
    baseline["day_of_week"] = pd.Categorical(
        baseline["day_of_week"], categories=DAY_ORDER, ordered=True
    )
    return baseline.sort_values(["day_of_week", "hour"]).reset_index(drop=True)


def make_visualization(raw: pd.DataFrame, baseline: pd.DataFrame, output_path: Path) -> None:
    """Create a two-panel baseline visualization."""
    interval_summary = raw.groupby("hour", as_index=False)["arrivals"].mean()
    day_summary = (
        raw.groupby("day_of_week", observed=False)["arrivals"].sum()
        .div(4)
        .reindex(DAY_ORDER)
    )

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(1, 2, figsize=(13, 5), constrained_layout=True)

    axes[0].plot(
        interval_summary["hour"], interval_summary["arrivals"],
        marker="o", linewidth=2.5, color="#1769aa"
    )
    axes[0].set_title("Average arrivals by 2-hour interval")
    axes[0].set_xlabel("Interval beginning (hour)")
    axes[0].set_ylabel("Average arrivals")
    axes[0].set_xticks(INTERVAL_HOURS)

    axes[1].bar(day_summary.index, day_summary.values, color="#f28e2b")
    axes[1].set_title("Average daily arrivals by day of week")
    axes[1].set_xlabel("Day of week")
    axes[1].set_ylabel("Average arrivals per day")
    axes[1].tick_params(axis="x", rotation=35)

    fig.suptitle("Fictional FBO — Normal-Week Aircraft Arrival Baseline", fontsize=15)
    fig.savefig(output_path, dpi=180, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", default="2026-01-05", help="First date, YYYY-MM-DD")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--output-dir", default=".", help="Folder for generated outputs")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    raw = generate_baseline(args.start_date, args.seed)
    baseline = analyze_baseline(raw)

    raw.to_csv(output_dir / "baseline_raw.csv", index=False)
    baseline.to_csv(output_dir / "baseline.csv", index=False, float_format="%.2f")
    make_visualization(raw, baseline, output_dir / "baseline_visualization.png")

    daily = raw.groupby("date")["arrivals"].sum()
    interval = raw.groupby("hour")["arrivals"].mean()
    weekday = raw.groupby("day_of_week", observed=False)["arrivals"].sum().div(4).reindex(DAY_ORDER)

    print(f"Generated {len(raw)} records across {raw['date'].nunique()} days.")
    print(f"Average daily arrivals: {daily.mean():.2f}")
    print("Average arrivals per 2-hour interval:")
    print(interval.round(2).to_string())
    print(f"Busiest interval: {int(interval.idxmax()):02d}:00–{(int(interval.idxmax()) + 2) % 24:02d}:00")
    print(f"Busiest day of week: {weekday.idxmax()} ({weekday.max():.2f} arrivals/day)")
    print(f"Wrote files to: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
