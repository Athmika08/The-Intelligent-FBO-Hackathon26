# LAXY Intelligent FBO

**AI-powered business aviation planning for Super Bowl LXI at Los Angeles International Airport (LAX).**

LAXY Intelligent FBO is a hackathon prototype that helps a fictional FBO at LAX prepare for increased private and business aviation demand during **Super Bowl LXI week, February 10–16, 2027**.

The project combines a synthetic normal-week FBO baseline with historically informed Super Bowl demand multipliers to produce Low, Medium, and High demand scenarios. The dashboard turns those forecasts into human-reviewed preparation guidance for staffing, parking, fuel, ground services, and other operational resources.

> **Planning support only.** This prototype does not authorize aircraft movements, runway use, landings, taxiing, or any other safety-critical action. Final operational decisions remain with ATC, airport authorities, and qualified aviation personnel.

## Challenge

The project was built for the **SpartHill Hacks Aviation Track: “The Intelligent FBO: Ready for the Big Game?”**

Our selected focus is **Aircraft Arrivals**:

> When should the FBO expect its busiest periods during Super Bowl week?

The prototype is designed around four required planning views:

- An ordinary-week baseline
- A seven-day Super Bowl week forecast
- Low, Medium, and High demand scenarios
- A recommended preparation plan

## What the Prototype Does

### Arrival Forecasting

- Models a seven-day planning window from **February 10–16, 2027**
- Uses 2-hour arrival intervals
- Compares ordinary-week demand with Super Bowl week demand
- Supports Low, Medium, and High demand scenarios
- Identifies peak arrival periods

### Operations Dashboard

The interactive dashboard includes:

- Operations overview
- Seven-day arrival forecast
- Scenario comparison
- Simulated operations clock
- Live-style arrival schedule
- Parking and ramp planning
- Advisory runway planning views
- Fuel planning
- Staffing recommendations
- Alerts and preparation actions
- Forecast / impact reporting
- Responsible AI and human-oversight guidance
- Exportable daily schedule and preparation plan

### Human-in-the-Loop Recommendations

The prototype converts forecasted demand into planning recommendations. For example, staffing recommendations use an assumed service capacity of **4 aircraft per ground-service team per 2-hour interval**, with up to two additional teams recommended when needed.

These recommendations are advisory only and always require human review.

## Forecasting Approach

The current forecasting pipeline is **statistical and scenario-based**, not a trained machine-learning model.

1. `baseline_analysis.py` generates four weeks of synthetic normal FBO arrival data.
2. The raw data is aggregated into average arrivals by weekday and 2-hour interval.
3. Historical Super Bowl research provides event-demand anchor ratios.
4. Seven-day planning multipliers are applied to the normal baseline.
5. Low, Medium, and High scenarios scale the event uplift.
6. Forecasted arrivals are translated into resource-preparation recommendations.

Scenario multipliers are calculated as:

```text
Low    = 1 + 0.5 × (M - 1)
Medium = M
High   = 1 + 1.5 × (M - 1)
```

where `M` is the Medium daily demand multiplier.

## Data and Assumptions

This project intentionally distinguishes observed historical evidence from synthetic planning assumptions.

### Synthetic baseline

The fictional FBO baseline contains:

- 28 days of synthetic arrival data
- 12 two-hour intervals per day
- 336 total records
- Approximately 25 arrivals per normal day, with weekday and time-of-day variation

### Historical Super Bowl anchors

The historical-impact analysis uses published business-aviation research as planning anchors, including:

- **Phoenix 2023:** reported event-period average daily business-jet arrivals of approximately **1.9×** the February daily average
- **Las Vegas 2024:** reported event-period average daily business-jet arrivals of approximately **1.5×** the February-to-date daily average

These metro-area historical ratios do **not** directly represent traffic at an individual FBO.

### Seven-day multipliers

The weekday-specific multipliers in `data/superbowl_impact.csv` are **research-informed synthetic planning assumptions**, not observed daily historical percentages.

## Repository Structure

```text
.
├── analysis/
│   ├── baseline_analysis.py      # Generate and analyze normal-week synthetic data
│   ├── historical_impact.py     # Historical Super Bowl impact calculations
│   └── forecast.py              # Scenario forecast and staffing-capacity calculations
├── data/
│   ├── baseline_raw.csv         # 4 weeks of synthetic normal arrivals
│   ├── baseline.csv             # Average arrivals by weekday / 2-hour interval
│   ├── superbowl_impact.csv     # Medium daily demand multipliers
│   └── forecast_2027.csv        # Generated scenario forecasts
├── css/                         # Main dashboard styles
├── js/                          # Dashboard logic, simulation, views, and mock API layer
├── full-website/                # Standalone full-site build / demo assets
├── simple-website/              # Simplified dashboard build
└── index.html                   # Main LAXY dashboard entry point
```

## Run the Dashboard Locally

Because the dashboard is static HTML/CSS/JavaScript, no build step is required.

From the project root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

A local HTTP server is recommended instead of opening `index.html` directly from the filesystem.

## Regenerate the Analysis Data

Install the Python analysis dependencies:

```bash
pip install pandas numpy matplotlib
```

Generate the synthetic baseline:

```bash
python3 analysis/baseline_analysis.py --output-dir data
```

Run the historical-impact summary:

```bash
python3 analysis/historical_impact.py
```

Generate the seven-day forecast:

```bash
python3 analysis/forecast.py --input-dir data --output-dir data
```

This produces / updates:

- `data/baseline_raw.csv`
- `data/baseline.csv`
- `data/baseline_visualization.png`
- `data/forecast_2027.csv`
- `data/dashboard_data.json`

## Responsible AI

LAXY is designed around a simple principle:

**AI assists. People decide.**

The system may:

- Forecast demand
- Highlight peak periods
- Compare scenarios
- Recommend resource preparation
- Explain assumptions and uncertainty

The system must never:

- Authorize aircraft movements
- Issue landing or taxi clearances
- Override ATC or airport operations personnel
- Replace certified aviation safety procedures
- Make safety-critical decisions autonomously

The prototype uses aggregate / anonymized operational information and does not require passenger personal data.

## Limitations

- The FBO and its normal operating baseline are fictional.
- Much of the dashboard operational detail is synthetic for demonstration.
- Historical Super Bowl ratios are metro-area research anchors, not FBO-specific measurements.
- Weekday-specific event multipliers are planning assumptions.
- The current forecast is statistical rather than a trained ML model.
- Actual 2027 arrivals are not yet available, so real-world forecast accuracy cannot be measured.
- Parking, fuel, runway, and staffing modules are planning demonstrations and should not be treated as operational authority.

## Hackathon Goal

The goal is not to automate aviation safety decisions. It is to give FBO staff an earlier, clearer view of possible demand so they can prepare resources before peak periods occur.

---

Built for **SpartHill Hacks – Aviation Track**.
