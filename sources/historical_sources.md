# Historical Super Bowl Impact Analysis

## Purpose
Estimate how much business-aviation arrival demand may increase during Super Bowl week, and convert the historical evidence into a seven-day planning multiplier for the Intelligent FBO prototype.

## Important distinction
The figures below mix **verified historical observations** and **synthetic planning assumptions**. They are intentionally labeled separately.

Airport-wide or metro-wide business-aviation traffic does **not** directly equal traffic at one individual FBO. The seven-day multipliers are therefore planning assumptions informed by historical research, not claimed FBO-specific historical measurements.

---

## 1. Verified historical evidence

### Super Bowl LVII — Phoenix / Glendale, Arizona — Feb. 12, 2023

**Verified event traffic:**
- AIN, citing FlightAware, reported **more than 1,700 business-aircraft arrivals** across eight Phoenix-area airports during the five-day span from the Thursday before the game through the Monday after it.
- Scottsdale Airport (KSDL) recorded **623 arrivals** in that period.
- Phoenix Sky Harbor (KPHX) recorded **533 arrivals**.
- AIN also reported more than **900 departures between 9 p.m. and midnight after the game**, showing a concentrated post-game departure surge.

**Comparable normal-vs-event ratio:**
- AIN later reported WINGX data showing that average daily arrivals during the 2023 Super Bowl event period were approximately **1.9x the February 2023 daily average**.
- Interpreted as an arrival uplift, that is approximately **+90% above normal February daily arrivals**.

**FAA / NBAA operational evidence:**
- FAA required a ramp reservation program at Phoenix-area airports from Feb. 9 through Feb. 13 because of anticipated high traffic.
- NBAA noted heavy demand and traffic-management initiatives were possible from Feb. 8 through Feb. 13, with special turbojet arrival routes enforced from Friday through game day.

Sources:
- https://backend-staging.ainonline.com/aviation-news/business-aviation/2023-02-14/arizona-fbos-score-super-bowl-traffic
- https://www.ainonline.com/aviation-news/business-aviation/2024-02-13/super-bowl-draws-flocks-aircraft-numbers-down-previous
- https://www.faa.gov/newsroom/ready-kickoff-what-ga-pilots-need-know-about-super-bowl-lvii
- https://nbaa.org/aircraft-operations/airspace/regional/super-bowl-lvii/

### Super Bowl LVIII — Las Vegas, Nevada — Feb. 11, 2024

**Verified event traffic:**
- AIN reported that WINGX counted roughly **1,700 arrivals** for the 2024 Super Bowl period, versus about 2,400 for Phoenix in 2023.
- The Las Vegas Review-Journal reported FlightAware averages of approximately **135 arrivals/day at Henderson Executive (HND)** and **265 arrivals/day at North Las Vegas (VGT)** from Friday through Sunday.
- Flightradar24 estimated **525 business-jet departures** from LAS, HND and VGT on Sunday and Monday after the game.

**Comparable normal-vs-event ratio:**
- AIN reported WINGX data showing that average daily arrivals during the 2024 event weekend were approximately **1.5x the February-to-date daily average**.
- Interpreted as an arrival uplift, that is approximately **+50% above normal February daily arrivals**.

**FAA / NBAA operational evidence:**
- NBAA reported that a reservation program for non-scheduled general aviation arrivals and departures was required from Feb. 7 through Feb. 13 because of anticipated high traffic.

Sources:
- https://www.ainonline.com/aviation-news/business-aviation/2024-02-13/super-bowl-draws-flocks-aircraft-numbers-down-previous
- https://www.reviewjournal.com/business/tourism/hundreds-of-private-jets-head-home-after-arriving-for-super-bowl-weekend-3001206/
- https://nbaa.org/aircraft-operations/airspace/regional/super-bowl-lviii-las-vegas-nv-feb-11-2024/

### Supporting timing evidence — Super Bowl LVI — Los Angeles — Feb. 13, 2022

This source is used only to inform the **shape** of the synthetic seven-day demand curve, not to create a historical percentage.

NBAA listed anticipated peak arrival periods as:
- Wednesday Feb. 9 through Saturday Feb. 12, especially **10 a.m.–6 p.m.**
- Game day Sunday Feb. 13, **9 a.m.–2 p.m.**

Peak departure periods were expected:
- Sunday Feb. 13, **8 p.m.–3 a.m.**
- Monday Feb. 14, **7 a.m.–8 p.m.**

Source:
- https://nbaa.org/aircraft-operations/airspace/regional/super-bowl-lvi/

---

## 2. Verified percentage increases

Using the WINGX event-to-normal ratios reported by AIN:

| Event | Event / Normal Arrival Ratio | Verified Increase vs. Normal |
|---|---:|---:|
| Phoenix 2023 | 1.9x | +90% |
| Las Vegas 2024 | 1.5x | +50% |
| Simple mean | 1.7x | +70% |

Formula:

`Percent Increase = ((Event Arrivals - Normal Arrivals) / Normal Arrivals) * 100`

When the source provides a ratio directly, `1.9x` means event arrivals are 190% of normal, or **90% above normal**.

---

## 3. Seven-day medium-scenario multipliers

These values are **synthetic planning assumptions**, not directly observed daily historical percentages.

They were designed to:
1. Reflect the historical evidence that Super Bowl business-aviation arrivals can average roughly **1.5x to 1.9x normal** during the core event period.
2. Put the largest arrival pressure before and on game day, consistent with FAA/NBAA peak-arrival guidance.
3. Reduce arrival demand after the game, when the dominant pressure shifts toward departures.
4. Produce a Friday-Sunday average multiplier of **1.70x**, matching the simple midpoint of the verified 2023 (1.9x) and 2024 (1.5x) event ratios.

| Day | Medium Multiplier | Increase vs. Baseline | Status |
|---|---:|---:|---|
| Wednesday | 1.10 | +10% | Synthetic assumption |
| Thursday | 1.25 | +25% | Synthetic assumption |
| Friday | 1.55 | +55% | Synthetic assumption |
| Saturday | 2.00 | +100% | Synthetic assumption |
| Sunday | 1.55 | +55% | Synthetic assumption |
| Monday | 1.05 | +5% | Synthetic assumption |
| Tuesday | 1.00 | 0% | Synthetic assumption |

Friday-Sunday average = `(1.55 + 2.00 + 1.55) / 3 = 1.70x`.

---

## 4. Limitations

- Published figures cover metro-area or airport-level business aviation, not one individual FBO.
- Different sources may define event windows differently (for example, five days versus Friday-Sunday).
- Some sources count business jets, while others refer more broadly to business aircraft or general aviation.
- Airport operations can include both arrivals and departures; they should not be treated as arrival counts unless the source explicitly reports arrivals.
- The seven-day multiplier curve is therefore a **planning model assumption informed by history**, not a historical reconstruction.

## Recommended statement for the prototype

> Historical business-aviation data from the 2023 Phoenix and 2024 Las Vegas Super Bowls indicates that average daily event-period arrivals were approximately 1.9x and 1.5x normal February levels, respectively. We use these verified ratios as anchors for a synthetic seven-day demand curve. The daily multipliers are planning assumptions and do not represent measured traffic at our selected FBO.
