"""Shared test setup.

pytest loads this file automatically before the tests run. It:
  * records where everything lives in the repo (change the paths below if
    the team reorganizes folders again)
  * makes the analysis/ folder importable (so tests can `import forecast`)
  * regenerates every output into a temporary folder ONCE per test run,
    so tests never overwrite the real files in the repo.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

# ---- Where things live. Update these if folders move. ----
ROOT = Path(__file__).resolve().parent.parent
ANALYSIS = ROOT / "analysis"          # Python scripts
DATA = ROOT / "data"                  # CSV inputs and outputs
FULL_SITE = ROOT                      # big dashboard: index.html + js/ + css/
JSON_SITE = ROOT / "full-website"     # ArrivalIQ page that loads dashboard_data.json
SIMPLE_SITE = ROOT / "simple-website" # single-page summary
DASHBOARD_JSON_COPIES = [JSON_SITE / "dashboard_data.json", SIMPLE_SITE / "dashboard_data.json"]

sys.path.insert(0, str(ANALYSIS))


@pytest.fixture(scope="session")
def fresh(tmp_path_factory):
    """Run the full pipeline into a temp folder and return its outputs."""
    out = tmp_path_factory.mktemp("pipeline")
    shutil.copy(DATA / "superbowl_impact.csv", out / "superbowl_impact.csv")

    for script, args in [
        ("baseline_analysis.py", ["--output-dir", str(out)]),
        ("forecast.py", ["--input-dir", str(out), "--output-dir", str(out)]),
    ]:
        subprocess.run(
            [sys.executable, str(ANALYSIS / script), *args],
            check=True, capture_output=True, text=True,
        )

    return {
        "dir": out,
        "raw": pd.read_csv(out / "baseline_raw.csv"),
        "baseline": pd.read_csv(out / "baseline.csv"),
        "impact": pd.read_csv(out / "superbowl_impact.csv"),
        "forecast_csv": pd.read_csv(out / "forecast_2027.csv"),
        "dashboard": json.loads((out / "dashboard_data.json").read_text()),
    }
