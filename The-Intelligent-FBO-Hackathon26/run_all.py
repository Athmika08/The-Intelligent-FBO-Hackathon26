"""Run the whole ArrivalIQ pipeline in order, then the tests.

Usage:
    python3 run_all.py            # regenerate all outputs + run tests
    python3 run_all.py --no-tests # just regenerate outputs

What it does:
  1. analysis/baseline_analysis.py -> data/baseline_raw.csv, data/baseline.csv
  2. analysis/forecast.py          -> data/forecast_2027.csv, plus
                                      dashboard_data.json copied into
                                      full-website/ and simple-website/
  3. analysis/historical_impact.py -> prints a sanity check
  4. pytest                        -> checks everything is consistent

NOT updated automatically (the tests will tell you if they're out of date):
  js/forecast-data.js, full-website/offline_demo.html,
  simple-website/dashboard_summary.json and simple-website/index.html
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANALYSIS, DATA = ROOT / "analysis", ROOT / "data"
JSON_COPIES = [ROOT / "full-website" / "dashboard_data.json",
               ROOT / "simple-website" / "dashboard_data.json"]


def run(title, args):
    print(f"\n=== {title} ===", flush=True)
    result = subprocess.run([sys.executable, *args], cwd=ROOT)
    if result.returncode != 0:
        print(f"\nFAILED at step: {title}")
        sys.exit(result.returncode)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        shutil.copy(DATA / "superbowl_impact.csv", tmp)
        run("1/3 Build synthetic baseline",
            [str(ANALYSIS / "baseline_analysis.py"), "--output-dir", str(tmp)])
        run("2/3 Forecast Super Bowl week",
            [str(ANALYSIS / "forecast.py"), "--input-dir", str(tmp), "--output-dir", str(tmp)])

        for name in ["baseline_raw.csv", "baseline.csv", "forecast_2027.csv"]:
            shutil.copy(tmp / name, DATA / name)
        for dest in JSON_COPIES:
            shutil.copy(tmp / "dashboard_data.json", dest)

    run("3/3 Historical sanity check", [str(ANALYSIS / "historical_impact.py")])

    if "--no-tests" not in sys.argv:
        run("Tests", ["-m", "pytest", "tests", "-q"])

    print("\nAll done.")


if __name__ == "__main__":
    main()
