"""Tests for the ArrivalIQ pipeline.

Run from the project folder:
    python -m pytest tests -v

Each test checks one promise the pipeline makes. If a teammate changes
something and a test fails, the test name tells you which promise broke.

Tests marked `xfail` are KNOWN issues we haven't fixed yet. They are
expected to fail; pytest reports them as "xfailed" rather than as errors.
Once someone fixes the issue, pytest will say "XPASS" (strict mode turns
that into a failure) as a reminder to delete the xfail marker.
"""

import importlib.util
import io
import contextlib
import json
import math
import re
import shutil
from datetime import date

import pandas as pd
import pytest

import forecast
from conftest import (ROOT, ANALYSIS, DATA, FULL_SITE, JSON_SITE, SIMPLE_SITE,
                      DASHBOARD_JSON_COPIES)

DAYS = forecast.DAYS
HOURS = list(range(0, 24, 2))
SCENARIOS = ["low", "medium", "high"]


def half_up(x):
    return int(math.floor(x + 0.5))


# ---------------------------------------------------------------------------
# 1. Reproducibility: are the committed files up to date?
# ---------------------------------------------------------------------------

COMMITTED_OUTPUTS = {
    "data/baseline_raw.csv": DATA / "baseline_raw.csv",
    "data/baseline.csv": DATA / "baseline.csv",
    "data/forecast_2027.csv": DATA / "forecast_2027.csv",
    **{str(p.relative_to(ROOT)): p for p in DASHBOARD_JSON_COPIES},
}


@pytest.mark.parametrize("label", COMMITTED_OUTPUTS)
def test_committed_outputs_match_a_fresh_run(fresh, label):
    """If this fails, someone changed a script or input but didn't re-run
    run_all.py, so the files in the repo are stale."""
    path = COMMITTED_OUTPUTS[label]
    committed = path.read_bytes().replace(b"\r\n", b"\n")
    regenerated = (fresh["dir"] / path.name).read_bytes().replace(b"\r\n", b"\n")
    assert committed == regenerated, f"{label} is stale - run `python3 run_all.py`"


# ---------------------------------------------------------------------------
# 2. Baseline: raw data shape, and baseline.csv really is its average
# ---------------------------------------------------------------------------

def test_raw_has_28_days_of_12_slots(fresh):
    raw = fresh["raw"]
    assert len(raw) == 28 * 12
    assert raw["date"].nunique() == 28
    assert sorted(raw["hour"].unique()) == HOURS
    assert (raw.groupby("day_of_week").size() == 4 * 12).all()  # 4 of each weekday


def test_raw_arrivals_are_whole_nonnegative_numbers(fresh):
    arrivals = fresh["raw"]["arrivals"]
    assert (arrivals >= 0).all()
    assert (arrivals == arrivals.round()).all()


def test_raw_day_names_match_dates(fresh):
    raw = fresh["raw"]
    actual = pd.to_datetime(raw["date"]).dt.day_name()
    assert (actual == raw["day_of_week"]).all()


def test_baseline_is_average_of_raw(fresh):
    expected = (fresh["raw"].groupby(["day_of_week", "hour"])["arrivals"]
                .mean().round(2))
    got = fresh["baseline"].set_index(["day_of_week", "hour"])["avg_arrivals"]
    assert len(got) == 84
    pd.testing.assert_series_equal(
        got.sort_index(), expected.sort_index(), check_names=False, atol=0.005
    )


# ---------------------------------------------------------------------------
# 3. Forecast: dates, totals, scenarios
# ---------------------------------------------------------------------------

def test_forecast_covers_game_week(fresh):
    days = fresh["dashboard"]["scenarios"]["medium"]["daily"]
    dates = [d["date"] for d in days]
    assert dates[0] == "2027-02-10" and dates[-1] == "2027-02-16"
    # Super Bowl LXI is Sunday Feb 14, 2027
    sunday = next(d for d in days if d["day_of_week"] == "Sunday")
    assert sunday["date"] == "2027-02-14"
    for d in days:
        assert date.fromisoformat(d["date"]).strftime("%A") == d["day_of_week"]


def test_csv_has_every_scenario_day_and_slot(fresh):
    df = fresh["forecast_csv"]
    assert len(df) == 3 * 7 * 12
    assert sorted(df["scenario"].unique()) == sorted(SCENARIOS)
    assert not df.duplicated(["scenario", "date", "start_hour"]).any()


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_slots_add_up_to_rounded_daily_total(fresh, scenario):
    """The largest-remainder rounding promises each day's slot counts add up
    to (baseline day total x multiplier), rounded half-up."""
    sc = fresh["dashboard"]["scenarios"][scenario]
    base = fresh["baseline"]
    for day in sc["daily"]:
        slots = [r for r in sc["intervals"] if r["date"] == day["date"]]
        assert len(slots) == 12
        assert sum(r["predicted_arrivals"] for r in slots) == day["predicted_arrivals"]

        base_total = base.loc[base["day_of_week"] == day["day_of_week"], "avg_arrivals"].sum()
        assert day["predicted_arrivals"] == half_up(base_total * day["multiplier"])


def test_multiplier_one_returns_baseline(fresh):
    """Tuesday's multiplier is 1.0, so the forecast should equal normal traffic."""
    tue = next(d for d in fresh["dashboard"]["scenarios"]["medium"]["daily"]
               if d["day_of_week"] == "Tuesday")
    assert tue["multiplier"] == 1.0
    assert tue["predicted_arrivals"] == half_up(tue["baseline_arrivals"])


def test_daily_totals_low_le_medium_le_high(fresh):
    sc = fresh["dashboard"]["scenarios"]
    for lo, med, hi in zip(sc["low"]["daily"], sc["medium"]["daily"], sc["high"]["daily"]):
        assert lo["predicted_arrivals"] <= med["predicted_arrivals"] <= hi["predicted_arrivals"], lo["date"]


def test_scenario_multipliers_follow_formula(fresh):
    impact = dict(zip(fresh["impact"]["day_of_week"], fresh["impact"]["medium_multiplier"]))
    factor = {"low": 0.5, "medium": 1.0, "high": 1.5}
    for scenario in SCENARIOS:
        for day in fresh["dashboard"]["scenarios"][scenario]["daily"]:
            expected = 1 + factor[scenario] * (impact[day["day_of_week"]] - 1)
            assert day["multiplier"] == pytest.approx(expected, abs=1e-4)


# ---------------------------------------------------------------------------
# 4. Staffing math
# ---------------------------------------------------------------------------

def test_staffing_numbers_are_consistent(fresh):
    cap = forecast.CAPACITY_PER_TEAM_PER_2H
    for _, r in fresh["forecast_csv"].iterrows():
        assert r.capacity_before == forecast.REGULAR_TEAMS * cap
        assert 0 <= r.recommended_extra_teams <= forecast.MAX_EXTRA_TEAMS
        assert r.capacity_after == (forecast.REGULAR_TEAMS + r.recommended_extra_teams) * cap
        assert r.uncovered_before == max(0, r.predicted_arrivals - r.capacity_before)
        assert r.uncovered_after == max(0, r.predicted_arrivals - r.capacity_after)
        assert r.uncovered_after <= r.uncovered_before
        # never add crews you don't need
        if r.recommended_extra_teams > 0:
            assert r.predicted_arrivals > r.capacity_after - cap
        # if planes are still unserved, we must already be at max crews
        if r.uncovered_after > 0:
            assert r.recommended_extra_teams == forecast.MAX_EXTRA_TEAMS


# ---------------------------------------------------------------------------
# 5. Dashboard JSON agrees with itself and with the CSV
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("scenario", SCENARIOS)
def test_summary_matches_interval_data(fresh, scenario):
    sc = fresh["dashboard"]["scenarios"][scenario]
    s, iv = sc["summary"], sc["intervals"]
    total = sum(r["predicted_arrivals"] for r in iv)
    assert s["predicted_weekly_arrivals"] == total
    assert s["peak_arrivals"] == max(r["predicted_arrivals"] for r in iv)
    served_before = sum(min(r["predicted_arrivals"], r["capacity_before"]) for r in iv)
    assert s["coverage_before_pct"] == pytest.approx(100 * served_before / total, abs=0.05)
    assert s["intervals_with_shortage_before"] == sum(r["uncovered_before"] > 0 for r in iv)


def test_csv_and_json_agree(fresh):
    df = fresh["forecast_csv"]
    for scenario in SCENARIOS:
        json_counts = [r["predicted_arrivals"] for r in fresh["dashboard"]["scenarios"][scenario]["intervals"]]
        csv_counts = df.loc[df["scenario"] == scenario, "predicted_arrivals"].tolist()
        assert json_counts == csv_counts, scenario


def test_dashboard_has_expected_top_level_keys(fresh):
    """The dashboard UI will depend on these. If you rename one, tell the UI person."""
    assert set(fresh["dashboard"]) == {
        "metadata", "model", "assumptions", "baseline_analysis", "research_context", "scenarios",
    }


# ---------------------------------------------------------------------------
# 6. The rounding helper on its own
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("values", [
    [0.0] * 12,
    [0.5] * 12,
    [0.3, 1.7, 2.49, 2.51, 0, 0, 5.5, 0.1, 0.9, 3.3, 1.1, 0.6],
    [10.25] * 12,
])
def test_distribute_keeps_total_and_stays_close(values):
    out = forecast.distribute_daily_forecast(values)
    assert sum(out) == half_up(sum(values))
    assert all(isinstance(x, int) and x >= 0 for x in out)
    assert all(abs(o - v) < 1 for o, v in zip(out, values))


# ---------------------------------------------------------------------------
# 7. Bad input should give a clear error, not garbage output
# ---------------------------------------------------------------------------

def _folder_with_impact(tmp_path, text):
    shutil.copy(DATA / "baseline.csv", tmp_path / "baseline.csv")
    (tmp_path / "superbowl_impact.csv").write_text(text)
    return tmp_path


# A fixed, valid impact file used as the starting point for the bad-input
# tests. It's written out here (not read from the repo) so these tests keep
# working even if the team changes the real multipliers.
GOOD_IMPACT = (
    "day_of_week,medium_multiplier\n"
    "Wednesday,1.10\nThursday,1.25\nFriday,1.55\nSaturday,2.00\n"
    "Sunday,1.55\nMonday,1.05\nTuesday,1.00\n"
)

BAD_IMPACT_FILES = {
    "missing a day": GOOD_IMPACT.replace("Tuesday,1.00\n", ""),
    "duplicate day": GOOD_IMPACT + "Monday,1.05\n",
    "negative multiplier": GOOD_IMPACT.replace("Saturday,2.00", "Saturday,-2"),
    "NaN multiplier": GOOD_IMPACT.replace("Saturday,2.00", "Saturday,nan"),
    "misspelled day": GOOD_IMPACT.replace("Friday", "Fryday"),
    "header only": "day_of_week,medium_multiplier\n",
}


@pytest.mark.parametrize("text", BAD_IMPACT_FILES.values(), ids=BAD_IMPACT_FILES.keys())
def test_bad_impact_file_raises_valueerror(tmp_path, text):
    assert text != GOOD_IMPACT
    folder = _folder_with_impact(tmp_path, text)
    with pytest.raises(ValueError):
        forecast.load_event_multipliers(folder)


def test_lowercase_day_names_are_accepted(tmp_path):
    folder = _folder_with_impact(tmp_path, GOOD_IMPACT.lower())
    assert len(forecast.load_event_multipliers(folder)) == 7


@pytest.mark.xfail(strict=True, raises=KeyError,
                   reason="KNOWN ISSUE: a renamed column crashes with a raw KeyError "
                          "instead of a readable ValueError")
def test_renamed_column_gives_readable_error(tmp_path):
    folder = _folder_with_impact(tmp_path, GOOD_IMPACT.replace("medium_multiplier", "multiplier"))
    with pytest.raises(ValueError):
        forecast.load_event_multipliers(folder)


def test_baseline_missing_row_raises(tmp_path):
    lines = (DATA / "baseline.csv").read_text().splitlines(keepends=True)
    (tmp_path / "baseline.csv").write_text("".join(lines[:-1]))  # drop last row
    with pytest.raises(ValueError):
        forecast.load_baseline_profile(tmp_path)


def test_baseline_negative_value_raises(tmp_path):
    text = (DATA / "baseline.csv").read_text().replace("Monday,8,3.50", "Monday,8,-3.50")
    (tmp_path / "baseline.csv").write_text(text)
    with pytest.raises(ValueError):
        forecast.load_baseline_profile(tmp_path)


# ---------------------------------------------------------------------------
# 8. Files that drift apart
# ---------------------------------------------------------------------------

def _load_historical_impact():
    spec = importlib.util.spec_from_file_location("historical_impact", ANALYSIS / "historical_impact.py")
    module = importlib.util.module_from_spec(spec)
    with contextlib.redirect_stdout(io.StringIO()):  # it prints on import
        spec.loader.exec_module(module)
    return module


def test_historical_impact_uses_same_multipliers_as_csv(fresh):
    """historical_impact.py has its own hand-typed copy of the multipliers.
    If someone edits superbowl_impact.csv, this catches the mismatch."""
    hi = _load_historical_impact()
    csv = dict(zip(fresh["impact"]["day_of_week"], fresh["impact"]["medium_multiplier"]))
    assert hi.medium_multipliers == pytest.approx(csv)


def test_cited_sources_file_exists():
    """dashboard_data.json cites historical_sources.md, so it must exist."""
    assert any(ROOT.rglob("historical_sources.md"))


def test_peak_is_friday(fresh):
    """Real LA 2022 data (AIN/WingX) shows arrivals peaked the Friday before the game."""
    for scenario in SCENARIOS:
        daily = fresh["dashboard"]["scenarios"][scenario]["daily"]
        busiest = max(daily, key=lambda d: d["predicted_arrivals"])
        assert busiest["day_of_week"] == "Friday", scenario


# ---------------------------------------------------------------------------
# 9. Website: its copies of the data must match dashboard_data.json
#    The site keeps the forecast in three places. If someone re-runs the
#    forecast but forgets to update a copy, the site shows old numbers.
# ---------------------------------------------------------------------------

def test_offline_demo_has_same_data_as_json():
    """offline_demo.html embeds a full copy of dashboard_data.json."""
    html = (JSON_SITE / "offline_demo.html").read_text(encoding="utf-8")
    marker = "const OFFLINE_DATA="
    assert marker in html, "offline_demo.html no longer embeds OFFLINE_DATA"
    embedded, _ = json.JSONDecoder().raw_decode(html[html.index(marker) + len(marker):])
    committed = json.loads(DASHBOARD_JSON_COPIES[0].read_text(encoding="utf-8"))
    assert embedded == committed, "offline_demo.html is out of date - re-embed dashboard_data.json"


def _load_forecast_data_js():
    """Turn js/forecast-data.js (a JS object) into Python data."""
    js = (FULL_SITE / "js" / "forecast-data.js").read_text(encoding="utf-8")
    start = js.index("{", js.index("window.FORECAST_DATA"))
    body = js[start:js.rindex("}") + 1]
    body = re.sub(r"(\w+):", r'"\1":', body).replace("'", '"')
    return json.loads(body)


def test_forecast_data_js_matches_json():
    """js/forecast-data.js holds a hand-copied version of the forecast."""
    js = _load_forecast_data_js()
    dash = json.loads(DASHBOARD_JSON_COPIES[0].read_text(encoding="utf-8"))
    for scenario in SCENARIOS:
        intervals = dash["scenarios"][scenario]["intervals"]
        for i, day in enumerate(js["days"]):
            expected = [r["predicted_arrivals"] for r in intervals if r["day_of_week"] == day]
            assert js["predicted"][scenario][i] == expected, f"{scenario} {day}"
    base = {(r["day_of_week"], r["start_hour"]): r["avg_arrivals"]
            for r in dash["baseline_analysis"]["profile"]}
    for i, day in enumerate(js["days"]):
        assert js["baseline"][i] == [base[(day, h)] for h in HOURS], day


def _simple_site_embedded():
    html = (SIMPLE_SITE / "index.html").read_text(encoding="utf-8")
    start = html.index(">", html.index('id="forecastDataset"')) + 1
    return json.loads(html[start:html.index("</script>", start)])


def test_simple_site_embedded_data_matches_summary_file():
    summary = json.loads((SIMPLE_SITE / "dashboard_summary.json").read_text(encoding="utf-8"))
    assert _simple_site_embedded() == summary, "simple-website/index.html is out of date"


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_simple_site_summary_agrees_with_forecast(scenario):
    """dashboard_summary.json is a hand-made summary, so check its numbers
    against the real forecast output."""
    s = json.loads((SIMPLE_SITE / "dashboard_summary.json").read_text(encoding="utf-8"))
    dash = json.loads(DASHBOARD_JSON_COPIES[0].read_text(encoding="utf-8"))
    S, D = s["scenarios"][scenario], dash["scenarios"][scenario]
    m = D["summary"]
    assert s["baseline_weekly"] == dash["baseline_analysis"]["ordinary_week_expected_arrivals"]
    assert S["weekly_arrivals"] == m["predicted_weekly_arrivals"]
    assert S["coverage_before_pct"] == m["coverage_before_pct"]
    assert S["coverage_after_pct"] == m["coverage_after_pct"]
    pw = S["peak_window"]
    assert (pw["date"], pw["label"], pw["arrivals"]) == (m["peak_date"], m["peak_time"], m["peak_arrivals"])
    assert [d["forecast"] for d in S["daily"]] == [d["predicted_arrivals"] for d in D["daily"]]
    assert S["peak_day_arrivals"] == max(d["predicted_arrivals"] for d in D["daily"])
    assert S["extra_teams"] == max(r["recommended_extra_teams"] for r in D["intervals"])


# ---------------------------------------------------------------------------
# 10. Website links: every local file a page points to must exist
# ---------------------------------------------------------------------------

def _local_links(html_path):
    html = html_path.read_text(encoding="utf-8")
    for ref in re.findall(r'(?:href|src)="([^"]+)"', html):
        if ref.startswith(("http:", "https:", "data:", "#", "mailto:", "//")):
            continue
        yield ref


PAGES = [FULL_SITE / "index.html", JSON_SITE / "index.html",
         JSON_SITE / "offline_demo.html", SIMPLE_SITE / "index.html"]


# Links that are allowed to point at a file that doesn't exist, because
# JavaScript handles the click instead. Keep this list short.
BUILT_IN_BROWSER = {
    # 'Download data' button: full-website/app.js builds the CSV from
    # dashboard_data.json when clicked ("download fix" commit). Checked by hand:
    # the downloaded file is identical to data/forecast_2027.csv.
    (JSON_SITE / "index.html", "forecast_2027.csv"),
}


@pytest.mark.parametrize("page", PAGES, ids=lambda p: str(p.relative_to(ROOT)))
def test_page_links_point_to_real_files(page):
    missing = [ref for ref in _local_links(page)
               if not (page.parent / ref).exists() and (page, ref) not in BUILT_IN_BROWSER]
    assert not missing, f"{page.name} links to missing files: {missing}"


def test_download_button_script_is_still_there():
    """If someone deletes the download code in app.js, the button breaks again."""
    js = (JSON_SITE / "app.js").read_text(encoding="utf-8")
    assert "forecast_2027.csv" in js and "new Blob(" in js, \
        "full-website/app.js no longer builds the CSV download - the button will 404"
