/* =========================================================================
   LAXY Intelligent FBO - synthetic forecast + planning engine
   -------------------------------------------------------------------------
   ALL numbers produced here are SYNTHETIC ESTIMATES generated for a
   hackathon demonstration. Nothing here uses real flight, passenger or
   airport data. The engine simulates private-aircraft arrivals for
   Feb 10-16, 2027 under four demand cases (ordinary / low / medium / high)
   and derives parking, fuel, staffing, delay, conflict and risk metrics.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------- calendar ---------- */
  const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_TAGS = ['Pre-event arrivals', 'Pre-event arrivals', 'Peak arrivals', 'Event weekend', 'Game day', 'Departure surge', 'Wind-down'];
  const DAYS = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(Date.UTC(2027, 1, 10 + i));
    const dow = dt.getUTCDay();
    DAYS.push({ idx: i, dow: DOW_SHORT[dow], dowLong: DOW_LONG[dow], date: 10 + i, label: 'Feb ' + (10 + i), iso: '2027-02-' + (10 + i), tag: DAY_TAGS[i] });
  }
  const HOURS = 168;

  /* ---------- helpers ---------- */
  const sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
  const clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  const mean = function (a) { return a.length ? sum(a) / a.length : 0; };
  const daySlice = function (arr, d) { return arr.slice(d * 24, d * 24 + 24); };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function allocate(total, weights) {
    const s = sum(weights);
    const raw = weights.map(function (w) { return (w / s) * total; });
    const base = raw.map(Math.floor);
    let rem = total - sum(base);
    const order = raw.map(function (r, i) { return [r - base[i], i]; }).sort(function (a, b) { return b[0] - a[0]; });
    for (let k = 0; k < rem; k++) base[order[k][1]]++;
    return base;
  }

  function fmtHour(h) {
    h = ((h % 24) + 24) % 24;
    if (h === 0) return '12 AM';
    if (h < 12) return h + ' AM';
    if (h === 12) return '12 PM';
    return (h - 12) + ' PM';
  }
  function fmtHourLong(h) { // 7:00 AM
    h = ((h % 24) + 24) % 24;
    const ap = h < 12 ? 'AM' : 'PM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return hh + ':00 ' + ap;
  }
  function fmtClock(hf) { // float hours-of-day -> 7:20 AM
    let m = Math.round(hf * 60);
    m = ((m % 1440) + 1440) % 1440;
    const hh = Math.floor(m / 60), mm = m % 60;
    const ap = hh < 12 ? 'AM' : 'PM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return h12 + ':' + String(mm).padStart(2, '0') + ' ' + ap;
  }
  function fmtAbs(t) { // absolute hours since Feb 10 00:00
    const d = Math.floor(t / 24);
    const day = DAYS[clamp(d, 0, 6)];
    const suffix = d > 6 ? ' (after window)' : '';
    return day.dow + ' ' + fmtClock(t - d * 24) + suffix;
  }
  function fmtDur(h) {
    if (h < 1) return Math.round(h * 60) + ' min';
    if (h < 24) return (Math.round(h * 10) / 10) + ' h';
    const d = Math.floor(h / 24), r = Math.round(h - d * 24);
    return d + ' d ' + r + ' h';
  }
  const fmtInt = function (n) { return Math.round(n).toLocaleString('en-US'); };

  /* ---------- facility + assumptions (all synthetic) ---------- */
  const FACILITY = {
    positions: 88, reserved: 8, based: 12,
    tank: 120000, safety: 25000, startInv: 100000,
    loadGal: 8500, standingLoads: 2, standingHour: 2, extraLoads: 3, orderLead: 4,
    trucks: 3, tugs: 4, gpu: 6, lav: 2, catering: 2, crewCars: 4,
    fuelAttach: 0.72, planShare: 0.35,
    aprons: { A: 22, B: 32, C: 14 }
  };
  FACILITY.sellable = FACILITY.positions - FACILITY.reserved;           // 80
  FACILITY.transientRoom = FACILITY.sellable - FACILITY.based;           // 68

  const CATS = [
    { key: 'light', name: 'Light jet', w: 0.22, fp: 1, gal: 350, svc: [25, 40], color: '#c4b5fd' },
    { key: 'mid', name: 'Midsize jet', w: 0.27, fp: 1, gal: 800, svc: [30, 45], color: '#8b5cf6' },
    { key: 'large', name: 'Large-cabin jet', w: 0.28, fp: 2, gal: 1600, svc: [40, 60], color: '#4c1d95' },
    { key: 'ulr', name: 'Ultra-long-range', w: 0.10, fp: 2, gal: 2600, svc: [50, 70], color: '#d946ef' },
    { key: 'turbo', name: 'Turboprop', w: 0.07, fp: 1, gal: 250, svc: [20, 32], color: '#0d9488' },
    { key: 'heli', name: 'Helicopter', w: 0.06, fp: 1, gal: 120, svc: [15, 25], color: '#64748b' }
  ];
  const CAT_BY = {}; CATS.forEach(function (c) { CAT_BY[c.key] = c; });

  const SERVICES = [
    { key: 'gpu', name: 'Ground power (GPU)' },
    { key: 'lav', name: 'Lav & water' },
    { key: 'cater', name: 'Catering' },
    { key: 'cbp', name: 'Customs / CBP coordination' },
    { key: 'crew', name: 'Crew transport' },
    { key: 'hangar', name: 'Hangar / tow' }
  ];
  const SVC_BASE = { gpu: 0.75, lav: 0.45, cater: 0.3, cbp: 0.2, crew: 0.55, hangar: 0.08 };

  const STAYS = {
    dropgo: { name: 'Drop-and-go', note: 'Drops guests, reposition or short turn (1.5-3.5 h)' },
    turn: { name: 'Same-day turn', note: 'Same-day turnaround (4-9 h)' },
    overnight: { name: 'Overnight', note: 'Overnight stay (13-22 h)' },
    event: { name: 'Event stay', note: 'Stays through the game; departs after kickoff-day / Monday' }
  };

  const ROLES = [
    { key: 'ops', one: 'FBO operations manager', name: 'FBO operations managers', short: 'Ops managers', color: '#2e1065' },
    { key: 'ground', one: 'ground handler', name: 'Ground handlers', short: 'Ground handlers', color: '#7c3aed' },
    { key: 'fuel', one: 'fuel-service employee', name: 'Fuel-service personnel', short: 'Fuel service', color: '#c026d3' },
    { key: 'ramp', one: 'ramp agent', name: 'Ramp agents', short: 'Ramp agents', color: '#0d9488' },
    { key: 'park', one: 'parking coordinator', name: 'Parking coordinators', short: 'Parking coord.', color: '#a78bfa' },
    { key: 'csr', one: 'customer-service representative', name: 'Customer-service representatives', short: 'Customer service', color: '#db2777' },
    { key: 'support', one: 'maintenance / support team member', name: 'Maintenance / support staff', short: 'Maint. / support', color: '#7a8aa3' }
  ];
  const ROSTER = { ops: [2, 2, 1], ground: [12, 8, 3], fuel: [2, 2, 2], ramp: [6, 4, 2], park: [2, 2, 1], csr: [3, 3, 1], support: [2, 2, 2] };
  function rosterAt(role, h) {
    const day = h >= 5 && h < 14, eve = h >= 14 && h < 22;
    const r = ROSTER[role];
    return day ? r[0] : eve ? r[1] : r[2];
  }
  const WL = {
    ops: function (c) { return { w: (c.a + c.dep) / 7.5, min: 1, rec: c.day ? 2 : 1 }; },
    ground: function (c) { return { w: 1.35 * c.a + 0.45 * c.dep, min: 2, rec: c.day ? 4 : 2 }; },
    fuel: function (c) { return { w: c.fj / 1.6, min: 1, rec: 1 }; },
    ramp: function (c) { return { w: 0.55 * (c.a + c.dep), min: 2, rec: c.day ? 3 : 2 }; },
    park: function (c) { return { w: c.a / 6 + c.occ / 80, min: 1, rec: c.day ? 2 : 1 }; },
    csr: function (c) { return { w: 0.4 * c.a + 0.1 * c.dep, min: 1, rec: c.day ? 2 : 1 }; },
    support: function (c) { return { w: 0.7 + c.occ / 90 + c.a / 14, min: 1, rec: c.day ? 2 : 1 }; }
  };

  /* ---------- demand definitions ---------- */
  /* Arrival counts come from the provided forecast (js/forecast-data.js): 2-hour intervals per
     scenario. Each 2-hour count is split across its two hours; the ordinary week is the weekday
     baseline, allocated to whole aircraft with largest-remainder rounding (daily total rounded half-up). */
  const FD = global.FORECAST_DATA;
  const splitIntervals = function (iv) { const out = []; iv.forEach(function (n) { out.push(Math.ceil(n / 2), Math.floor(n / 2)); }); return out; };
  const HOURLY_ARR = { ordinary: [], low: [], medium: [], high: [] };
  FD.baseline.forEach(function (prof, d) {
    const total = Math.floor(sum(prof) + 0.5);
    HOURLY_ARR.ordinary.push(splitIntervals(allocate(total, prof)));
    ['low', 'medium', 'high'].forEach(function (k) { HOURLY_ARR[k].push(splitIntervals(FD.predicted[k][d])); });
  });
  const BASELINE_DAILY = HOURLY_ARR.ordinary.map(sum);   // ordinary week: 32, 28, 30, 20, 15, 22, 23 (170)
  const BASELINE_AVG = sum(BASELINE_DAILY) / 7;          // average ordinary day (about 24)
  const SCEN = {
    ordinary: { key: 'ordinary', label: 'Ordinary week', frac: 0, ci: 0.05, color: '#9a8fb8' },
    low: { key: 'low', label: 'Low', frac: 0.22, ci: 0.08, color: '#1a9a5b' },
    medium: { key: 'medium', label: 'Medium', frac: 0.62, ci: 0.11, color: '#d99a00' },
    high: { key: 'high', label: 'High', frac: 1, ci: 0.14, color: '#dc2626' }
  };
  const SCEN_KEYS = ['ordinary', 'low', 'medium', 'high'];
  const DAY_CI_FACTOR = [1, 1, 1, 1.15, 1.15, 1.1, 1];
  const EVENT_P = [0.02, 0.05, 0.11, 0.13, 0.10, 0, 0];
  const EVENT_SCALE = { ordinary: 0, low: 0.4, medium: 0.7, high: 1 };

  /* Daily arrivals per scenario = the sum of the provided hourly/interval counts (fixed; not randomized). */
  function dailyTargets() {
    const out = {};
    SCEN_KEYS.forEach(function (k) { out[k] = HOURLY_ARR[k].map(sum); });
    return out;
  }

  /* ---------- weather / runway constraints (synthetic) ---------- */
  const WEATHER = [
    { wind: '240° at 6 kt', vis: '10 SM', ceiling: 'Clear', flow: 'West flow', note: 'Clear skies, light onshore breeze.' },
    { wind: '250° at 11 kt', vis: '6 SM', ceiling: '1,800 ft', flow: 'West flow', note: 'Light rain showers expected 2:00 PM-8:00 PM.' },
    { wind: '260° at 7 kt', vis: '4 SM', ceiling: '1,200 ft', flow: 'West flow', note: 'Marine layer until about 10:00 AM; reduced visibility on early arrivals.' },
    { wind: '250° at 8 kt', vis: '10 SM', ceiling: 'Clear', flow: 'West flow', note: 'Good visibility; typical onshore winds.' },
    { wind: '070° at 12 kt', vis: '10 SM', ceiling: 'Clear', flow: 'East flow possible', note: 'Offshore (Santa Ana-style) wind pattern: east-flow operations may be used.' },
    { wind: '250° at 9 kt', vis: '8 SM', ceiling: '3,500 ft', flow: 'West flow', note: 'Scattered clouds; departure surge conditions are favorable.' },
    { wind: '240° at 5 kt', vis: '5 SM', ceiling: 'Haze, 4,000 ft', flow: 'West flow', note: 'Hazy; light winds.' }
  ];
  const CLOSURES = [
    [],
    [{ rwy: '24L', win: '1:00 AM-5:00 AM', note: 'Pavement maintenance (synthetic NOTAM placeholder)' }],
    [{ rwy: '25R', win: '10:00 PM-5:00 AM', note: 'Runway lighting work (synthetic NOTAM placeholder)' }],
    [],
    [{ rwy: 'Airspace', win: '2:30 PM-8:30 PM', note: 'Event-day flight restriction area around the stadium (synthetic placeholder)' }],
    [{ rwy: '24R', win: '11:00 PM-4:00 AM', note: 'Runway inspection window (synthetic NOTAM placeholder)' }],
    []
  ];

  /* ---------- confidence ---------- */
  function confidenceFromRel(rel) {
    if (rel <= 0.09) return { level: 'high', label: 'High confidence', rel: rel, bars: 3 };
    if (rel <= 0.15) return { level: 'moderate', label: 'Moderate confidence', rel: rel, bars: 2 };
    return { level: 'low', label: 'Low confidence', rel: rel, bars: 1 };
  }
  function confidenceHourly(n, ci) {
    const half = Math.max(1, Math.round(Math.sqrt(Math.max(n, 1)) * (1 + ci * 3)));
    const rel = half / Math.max(n, 1);
    const level = rel <= 0.3 ? 'high' : rel <= 0.5 ? 'moderate' : 'low';
    return { half: half, lo: Math.max(0, n - half), hi: n + half, level: level, label: level === 'high' ? 'High confidence' : level === 'moderate' ? 'Moderate confidence' : 'Low confidence', bars: level === 'high' ? 3 : level === 'moderate' ? 2 : 1 };
  }
  function dailyCI(key, d, n) {
    const rel = SCEN[key].ci * DAY_CI_FACTOR[d];
    const half = Math.max(2, Math.round(n * rel));
    return { lo: Math.max(0, n - half), hi: n + half, half: half, conf: confidenceFromRel(rel) };
  }

  /* ---------- queue simulation (ground + fuel service) ---------- */
  function queueSim(items, getStart, getDur, capFn) {
    let active = [];
    const waits = new Array(items.length);
    items.forEach(function (it, idx) {
      let start = getStart(it);
      const base = start;
      let a = active.filter(function (e) { return e > start; });
      const cap = Math.max(1, capFn(base));
      while (a.length >= cap) {
        const e = Math.min.apply(null, a);
        start = e;
        a = a.filter(function (x) { return x > start; });
      }
      waits[idx] = start - base;
      a.push(start + getDur(it));
      active = a;
    });
    return waits;
  }

  function overflowSweep(aircraft, excludeShifted) {
    let present = [];
    let count = 0;
    const flags = new Map();
    aircraft.forEach(function (ac) {
      if (excludeShifted && ac.planShift) return;
      present = present.filter(function (p) { return p.dep > ac.t; });
      const cur = FACILITY.based + sum(present.map(function (p) { return p.fp; }));
      if (cur + ac.fp > FACILITY.sellable) { flags.set(ac.id, true); count++; } else { present.push(ac); }
    });
    return { flags: flags, count: count };
  }

  /* ---------- fuel inventory planning ---------- */
  function fuelPlan(demand) {
    const F = FACILITY;
    const stand = new Array(HOURS).fill(0);
    for (let d = 0; d < 7; d++) stand[d * 24 + F.standingHour] = F.standingLoads * F.loadGal;
    let inv = F.startInv;
    const invS = [];
    for (let i = 0; i < HOURS; i++) { inv = Math.min(F.tank, inv + stand[i]); inv -= demand[i]; inv = Math.max(0, inv); invS.push(inv); }
    inv = F.startInv;
    const invR = [], deliveries = [];
    let last = -99;
    for (let i = 0; i < HOURS; i++) {
      inv = Math.min(F.tank, inv + stand[i]);
      let p = inv, minP = inv;
      for (let k = 0; k < 8 && i + k < HOURS; k++) { if (k > 0) p += stand[i + k]; p -= demand[i + k]; if (p < minP) minP = p; }
      if (minP < F.safety * 1.2 && i - last >= 8) {
        const amt = Math.min(F.extraLoads * F.loadGal, F.tank - inv);
        if (amt > 2000) { inv += amt; deliveries.push({ at: i, gal: amt, order: i - F.orderLead }); last = i; }
      }
      inv -= demand[i]; inv = Math.max(0, inv); invR.push(inv);
    }
    return { standing: stand, invS: invS, invR: invR, deliveries: deliveries };
  }

  /* ---------- scenario simulation ---------- */
  function buildScenario(key, run, targets) {
    const sc = SCEN[key];
    const seedOff = { ordinary: 11, low: 23, medium: 37, high: 53 }[key];
    const rng = mulberry32(20270210 + seedOff * 1013 + run * 977);
    const ordinary = key === 'ordinary';
    const dailyArr = targets[key].slice();
    const hourlyArrByDay = [];
    const aircraft = [];
    const usedIds = new Set();
    const idChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    function newId() {
      let id;
      do { id = 'AC-'; for (let i = 0; i < 4; i++) id += idChars[Math.floor(rng() * idChars.length)]; } while (usedIds.has(id));
      usedIds.add(id); return id;
    }

    for (let d = 0; d < 7; d++) {
      const hourly = HOURLY_ARR[key][d].slice();
      hourlyArrByDay.push(hourly);
      for (let h = 0; h < 24; h++) {
        const mins = [];
        for (let k = 0; k < hourly[h]; k++) mins.push(Math.floor(rng() * 60));
        mins.sort(function (a, b) { return a - b; });
        mins.forEach(function (min) {
          const t = d * 24 + h + min / 60;
          // category
          const cw = CATS.map(function (c) { return c.w * ((!ordinary && d >= 2 && d <= 4 && (c.key === 'large' || c.key === 'ulr')) ? 1.25 : 1); });
          let r = rng() * sum(cw), ci = 0;
          for (; ci < cw.length - 1; ci++) { if (r < cw[ci]) break; r -= cw[ci]; }
          const cat = CATS[ci];
          // stay
          const pe = (!ordinary && t < 111) ? EVENT_P[d] * EVENT_SCALE[key] : 0;
          let stay;
          if (rng() < pe) stay = 'event';
          else { const r2 = rng(); stay = r2 < 0.5 ? 'dropgo' : r2 < 0.8 ? 'turn' : 'overnight'; }
          let dur;
          if (stay === 'dropgo') dur = 1.5 + rng() * 2;
          else if (stay === 'turn') dur = 4 + rng() * 5;
          else if (stay === 'overnight') {
            dur = 13 + rng() * 9;
            const hod = (t + dur) % 24;               // few aircraft depart in the small hours: push to early morning
            if (hod < 5.5) dur += (5.5 - hod) + rng() * 3;
          }
          else { const depT = rng() < 0.35 ? 115.5 + rng() * 4.5 : 125.5 + rng() * 7.5; dur = Math.max(2, depT - t); }
          const dep = t + dur;
          // fuel
          const fuelNeed = rng() < FACILITY.fuelAttach;
          const gal = Math.round(cat.gal * (0.7 + rng() * 0.6) / 10) * 10;
          const fuelAt = Math.max(t + 0.4, dep - 0.8);
          // services
          const svcs = [];
          SERVICES.forEach(function (s) {
            let p = SVC_BASE[s.key];
            if ((cat.key === 'large' || cat.key === 'ulr') && (s.key === 'cater' || s.key === 'cbp')) p *= 1.8;
            if ((cat.key === 'turbo' || cat.key === 'heli') && (s.key === 'cater' || s.key === 'cbp' || s.key === 'lav')) p *= 0.3;
            if (cat.key === 'heli' && s.key === 'gpu') p *= 0.2;
            if (rng() < p) svcs.push(s.key);
          });
          let svcMin = cat.svc[0] + rng() * (cat.svc[1] - cat.svc[0]);
          if (svcs.indexOf('cater') >= 0) svcMin += 6;
          if (svcs.indexOf('cbp') >= 0) svcMin += 8;
          const planShift = (stay === 'turn' || stay === 'overnight') && rng() < FACILITY.planShare;
          aircraft.push({
            id: newId(), s: key, d: d, h: h, min: min, t: t, cat: cat.key, catName: cat.name, fp: cat.fp,
            stay: stay, dur: dur, dep: dep, fuel: { need: fuelNeed, gal: fuelNeed ? gal : 0, at: fuelAt },
            svcs: svcs, svcH: svcMin / 60, planShift: planShift, u: rng(), warnings: []
          });
        });
      }
    }

    const hourlyArr = [].concat.apply([], hourlyArrByDay);
    const hourlyDep = new Array(HOURS).fill(0);
    const occTrans = new Array(HOURS).fill(0), occPlanTrans = new Array(HOURS).fill(0);
    const fuelDemand = new Array(HOURS).fill(0), fuelJobs = new Array(HOURS).fill(0);
    aircraft.forEach(function (ac) {
      const di = Math.floor(ac.dep);
      if (di < HOURS) hourlyDep[di]++;
      const i0 = Math.floor(ac.t), i1 = Math.min(HOURS - 1, Math.ceil(ac.dep) - 1);
      for (let i = i0; i <= i1; i++) { occTrans[i] += ac.fp; if (!ac.planShift) occPlanTrans[i] += ac.fp; }
      if (ac.fuel.need) {
        const fi = Math.floor(ac.fuel.at);
        if (fi < HOURS) { fuelDemand[fi] += ac.fuel.gal; fuelJobs[fi]++; }
      }
    });
    const occ = occTrans.map(function (v) { return v + FACILITY.based; });
    const occPlan = occPlanTrans.map(function (v) { return v + FACILITY.based; });

    // category daily
    const catDaily = {};
    CATS.forEach(function (c) { catDaily[c.key] = new Array(7).fill(0); });
    aircraft.forEach(function (ac) { catDaily[ac.cat][ac.d]++; });
    const dailyDep = [0, 1, 2, 3, 4, 5, 6].map(function (d) { return sum(daySlice(hourlyDep, d)); });

    // staffing
    const staff = {};
    ROLES.forEach(function (r) { staff[r.key] = { cur: [], min: [], rec: [], raw: [] }; });
    for (let i = 0; i < HOURS; i++) {
      const hod = i % 24;
      const ctx = { a: hourlyArr[i], dep: hourlyDep[i], occ: occ[i], fj: fuelJobs[i], day: hod >= 5 && hod < 22 };
      ROLES.forEach(function (r) {
        const wl = WL[r.key](ctx);
        staff[r.key].raw.push(wl.w);
        staff[r.key].min.push(Math.max(wl.min, Math.ceil(wl.w * 0.8 - 1e-9)));
        staff[r.key].rec.push(Math.max(wl.rec, Math.ceil(wl.w * 1.1 - 1e-9)));
        staff[r.key].cur.push(rosterAt(r.key, hod));
      });
    }

    // ground-service queue (current roster vs. recommended staffing)
    const SVC_OFFSET = 0.13;
    const gStart = function (ac) { return ac.t + SVC_OFFSET; };
    const gDur = function (ac) { return ac.svcH; };
    const wCur = queueSim(aircraft, gStart, gDur, function (t) { return Math.floor(rosterAt('ground', Math.floor(t) % 24) / 2); });
    const wPlan = queueSim(aircraft, gStart, gDur, function (t) { const i = Math.min(HOURS - 1, Math.floor(t)); return Math.floor(Math.max(staff.ground.rec[i], staff.ground.cur[i]) / 2); });
    // fuel queue
    const fuelAc = aircraft.filter(function (a) { return a.fuel.need; }).sort(function (a, b) { return a.fuel.at - b.fuel.at; });
    const fDur = function (ac) { return 0.25 + ac.fuel.gal / 6000; };
    const fStart = function (ac) { return ac.fuel.at; };
    const fCur = queueSim(fuelAc, fStart, fDur, function (t) { return Math.min(FACILITY.trucks, rosterAt('fuel', Math.floor(t) % 24)); });
    const fPlan = queueSim(fuelAc, fStart, fDur, function (t) { const i = Math.min(HOURS - 1, Math.floor(t)); return Math.min(FACILITY.trucks, Math.max(staff.fuel.rec[i], staff.fuel.cur[i])); });
    aircraft.forEach(function (ac, i) { ac.wait = wCur[i] * 60; ac.waitPlan = wPlan[i] * 60; ac.fuelWait = 0; ac.fuelWaitPlan = 0; });
    fuelAc.forEach(function (ac, i) { ac.fuelWait = fCur[i] * 60; ac.fuelWaitPlan = fPlan[i] * 60; });

    // parking overflow
    const ovCur = overflowSweep(aircraft, false);
    const ovPlan = overflowSweep(aircraft, true);

    // warnings / conflicts
    let prevT = -99;
    aircraft.forEach(function (ac) {
      ac.overflow = ovCur.flags.has(ac.id);
      ac.overflowPlan = ovPlan.flags.has(ac.id);
      const wm = Math.round(ac.wait), fm = Math.round(ac.fuelWait);
      if (wm >= 15) ac.warnings.push({ level: 'conflict', text: 'Ground-service windows overlap; est. wait ' + wm + ' min' });
      else if (wm >= 5) ac.warnings.push({ level: 'warn', text: 'Possible ground-service delay ~' + wm + ' min' });
      if (ac.overflow) ac.warnings.push({ level: 'conflict', text: 'Ramp full at arrival; overflow plan needed' });
      if (fm >= 15) ac.warnings.push({ level: 'conflict', text: 'Fuel-truck overlap near ' + fmtAbs(ac.fuel.at) + ' (wait ~' + fm + ' min)' });
      else if (fm >= 8) ac.warnings.push({ level: 'warn', text: 'Fuel queue near ' + fmtAbs(ac.fuel.at) + ' (~' + fm + ' min)' });
      const gap = (ac.t - prevT) * 60;
      if (gap < 4 && prevT >= 0) ac.warnings.push({ level: 'warn', text: 'Arrives ' + Math.max(0, Math.round(gap)) + ' min after previous aircraft (target >= 5)' });
      prevT = ac.t;
      ac.conflict = ac.warnings.some(function (w) { return w.level === 'conflict'; });
      ac.conflictPlan = ac.waitPlan >= 15 || ac.fuelWaitPlan >= 15 || ac.overflowPlan;
      ac.status = ac.conflict ? 'unassigned' : (ac.u < 0.45 ? 'confirmed' : 'proposed');
    });

    // hourly service delay (minutes)
    const delay = new Array(HOURS).fill(0), delayPlan = new Array(HOURS).fill(0);
    for (let i = 0; i < HOURS; i++) {
      const arrs = aircraft.filter(function (a) { return Math.floor(a.t) === i; });
      const fs = fuelAc.filter(function (a) { return Math.floor(a.fuel.at) === i; });
      const g = arrs.length ? mean(arrs.map(function (a) { return a.wait; })) : 0;
      const gp = arrs.length ? mean(arrs.map(function (a) { return a.waitPlan; })) : 0;
      const f = fs.length ? mean(fs.map(function (a) { return a.fuelWait; })) : 0;
      const fp = fs.length ? mean(fs.map(function (a) { return a.fuelWaitPlan; })) : 0;
      const dampA = Math.min(1, arrs.length / 2), dampF = Math.min(1, fs.length / 3) * 0.7;
      delay[i] = Math.round(Math.max(g * dampA, f * dampF));
      delayPlan[i] = Math.round(Math.max(gp * dampA, fp * dampF));
    }

    const fuel = fuelPlan(fuelDemand);

    return {
      key: key, label: sc.label, aircraft: aircraft, dailyArr: dailyArr, dailyDep: dailyDep, hourlyArr: hourlyArr, hourlyDep: hourlyDep,
      occ: occ, occPlan: occPlan, fuelDemand: fuelDemand, fuelJobs: fuelJobs, fuel: fuel, staff: staff, catDaily: catDaily,
      delay: delay, delayPlan: delayPlan, overflowCount: ovCur.count, overflowCountPlan: ovPlan.count
    };
  }

  /* ---------- model ---------- */
  function build(payload) {
    const run = payload.modelRun || 0;
    const targets = dailyTargets(run);
    const scen = {};
    SCEN_KEYS.forEach(function (k) { scen[k] = buildScenario(k, run, targets); });
    const model = { payload: payload, run: run, scen: scen, targets: targets, _cache: {} };
    model.summary = function (k, d) { const ck = 's' + k + d; return model._cache[ck] || (model._cache[ck] = daySummary(model, k, d)); };
    model.alerts = function (k, d) { const ck = 'a' + k + d; return model._cache[ck] || (model._cache[ck] = buildAlerts(model, k, d)); };
    model.assistant = function (k, d) { const ck = 'x' + k + d; return model._cache[ck] || (model._cache[ck] = buildAssistant(model, k, d)); };
    model.impact = function (k) { const ck = 'i' + k; return model._cache[ck] || (model._cache[ck] = buildImpact(model, k)); };
    model.dayAircraft = function (k, d) { return scen[k].aircraft.filter(function (a) { return a.d === d; }); };
    return model;
  }

  function peakWindow(arr, len) {
    let best = -1, bi = 6;
    for (let s = 0; s + len <= 24; s++) {
      const v = sum(arr.slice(s, s + len));
      if (v > best || (v === best && Math.abs(s - 6) < Math.abs(bi - 6))) { best = v; bi = s; }
    }
    return { start: bi, end: bi + len, count: best };
  }

  function daySummary(M, k, d) {
    const S = M.scen[k], F = FACILITY;
    const arr = daySlice(S.hourlyArr, d), dep = daySlice(S.hourlyDep, d);
    const arrivals = S.dailyArr[d];
    const ord = M.scen.ordinary.dailyArr[d];
    const ci = dailyCI(k, d, arrivals);
    const ratio = arrivals / BASELINE_AVG;
    const demandLevel = ratio < 1.5 ? 'Low' : ratio < 2.3 ? 'Medium' : 'High';
    let peakHour = 0; arr.forEach(function (v, h) { if (v > arr[peakHour]) peakHour = h; });
    const pw = peakWindow(arr, 5);

    // parking
    const occ = daySlice(S.occ, d), occPlan = daySlice(S.occPlan, d);
    const util = occ.map(function (v) { return v / F.sellable; });
    const utilPlan = occPlan.map(function (v) { return v / F.sellable; });
    let pk = 0; util.forEach(function (v, h) { if (v > util[pk]) pk = h; });
    const first90 = util.findIndex(function (v) { return v >= 0.9; });
    const firstOver = util.findIndex(function (v) { return v > 1; });
    const overHours = util.filter(function (v) { return v > 1; }).length;
    const overflowMax = Math.max(0, Math.round(Math.max.apply(null, occ) - F.sellable));
    const dayAc = M.dayAircraft(k, d);

    // fuel
    const demand = daySlice(S.fuelDemand, d);
    const invS = daySlice(S.fuel.invS, d), invR = daySlice(S.fuel.invR, d);
    const startInv = d === 0 ? F.startInv : S.fuel.invR[d * 24 - 1];
    const minS = Math.min.apply(null, invS), minR = Math.min.apply(null, invR);
    const readS = clamp(Math.round(100 * minS / (F.safety * 1.5)), 0, 100);
    const readR = clamp(Math.round(100 * minR / (F.safety * 1.5)), 0, 100);
    const breachIdx = invS.findIndex(function (v) { return v < F.safety; });
    const dayDeliv = S.fuel.deliveries.filter(function (x) { return x.at >= d * 24 && x.at < d * 24 + 24; });
    const fueled = dayAc.filter(function (a) { return a.fuel.need; });
    const weekBreachIdx = S.fuel.invS.findIndex(function (v) { return v < F.safety; });

    // staffing
    const recTot = [], curTot = [], minTot = [];
    for (let h = 0; h < 24; h++) {
      let r = 0, c = 0, m = 0;
      ROLES.forEach(function (ro) { r += S.staff[ro.key].rec[d * 24 + h]; c += S.staff[ro.key].cur[d * 24 + h]; m += S.staff[ro.key].min[d * 24 + h]; });
      recTot.push(r); curTot.push(c); minTot.push(m);
    }
    const recPeak = Math.max.apply(null, recTot);
    const curPeak = Math.max.apply(null, curTot);
    let covNum = 0, covDen = 0;
    ROLES.forEach(function (ro) { for (let h = 0; h < 24; h++) { const r = S.staff[ro.key].rec[d * 24 + h], c = S.staff[ro.key].cur[d * 24 + h]; covNum += Math.min(c, r); covDen += r; } });
    const coverage = Math.round(100 * covNum / covDen);
    const maxRatio = Math.max.apply(null, recTot.map(function (r, h) { return r / curTot[h]; }));
    const level = maxRatio >= 1.2 ? { n: 3, label: 'Level 3 - Maximum surge' } : maxRatio >= 1.05 ? { n: 2, label: 'Level 2 - Enhanced' } : { n: 1, label: 'Level 1 - Normal' };
    const shortages = [];
    ROLES.forEach(function (ro) {
      let h = 0;
      while (h < 24) {
        const sh = S.staff[ro.key].rec[d * 24 + h] - S.staff[ro.key].cur[d * 24 + h];
        if (sh > 0) {
          let e = h, mx = sh, mh = h;
          while (e + 1 < 24 && S.staff[ro.key].rec[d * 24 + e + 1] - S.staff[ro.key].cur[d * 24 + e + 1] > 0) {
            e++;
            const v = S.staff[ro.key].rec[d * 24 + e] - S.staff[ro.key].cur[d * 24 + e];
            if (v > mx) { mx = v; mh = e; }
          }
          shortages.push({ role: ro.key, roleName: ro.name, one: ro.one, n: mx, from: h, to: e + 1, hour: mh });
          h = e + 1;
        } else h++;
      }
    });
    shortages.sort(function (a, b) { return b.n - a.n || a.from - b.from; });
    let shortHours = 0, recDay = 0;
    for (let h = 5; h < 22; h++) { shortHours += Math.max(0, recTot[h] - curTot[h]); recDay += recTot[h]; }

    // delay
    const dl = daySlice(S.delay, d), dlp = daySlice(S.delayPlan, d);
    const avgDelay = dayAc.length ? mean(dayAc.map(function (a) { return a.wait; })) : 0;
    const avgDelayPlan = dayAc.length ? mean(dayAc.map(function (a) { return a.waitPlan; })) : 0;
    let dlPk = 5; dl.forEach(function (v, h) { if (h >= 5 && h < 22 && v > dl[dlPk]) dlPk = h; });

    // risk
    const peakUtil = util[pk];
    const parts = {
      parking: clamp((peakUtil - 0.6) / 0.5, 0, 1),
      staffing: clamp((shortHours / Math.max(recDay, 1)) / 0.2, 0, 1),
      fuel: minS < F.safety ? 1 : clamp((F.safety * 1.5 - minS) / (F.safety * 0.5), 0, 1),
      delay: clamp(dl[dlPk] / 30, 0, 1)
    };
    const score = Math.round(100 * (0.30 * parts.parking + 0.30 * parts.staffing + 0.20 * parts.fuel + 0.20 * parts.delay));
    const rl = score < 25 ? { label: 'Low', cls: 'low' } : score < 45 ? { label: 'Moderate', cls: 'moderate' } : score < 65 ? { label: 'Elevated', cls: 'high' } : { label: 'High', cls: 'critical' };

    const conflictAc = dayAc.filter(function (a) { return a.conflict; });
    const conflictPlan = dayAc.filter(function (a) { return a.conflictPlan; });

    return {
      key: k, d: d, arrivals: arrivals, departures: sum(dep), ordinary: ord, ci: ci, ratio: ratio, demandLevel: demandLevel,
      hourlyArr: arr, hourlyDep: dep, peakHour: peakHour, peakHourN: arr[peakHour], peakWin: pw,
      parking: {
        occ: occ, occPlan: occPlan, util: util, utilPlan: utilPlan, peakUtil: peakUtil, peakHour: pk, peakOcc: occ[pk],
        availAtPeak: Math.max(0, Math.round(F.sellable - occ[pk])), first90: first90 < 0 ? null : first90, firstOver: firstOver < 0 ? null : firstOver,
        overHours: overHours, overflowMax: overflowMax, overflowAircraft: dayAc.filter(function (a) { return a.overflow; }).length,
        peakUtilPlan: Math.max.apply(null, utilPlan)
      },
      fuel: {
        demand: sum(demand), demandHourly: demand, aircraftFueled: fueled.length, startInv: startInv, endInv: invR[23], minInvStanding: minS, minInvRec: minR,
        invS: invS, invR: invR, readiness: readS, readinessRec: readR, breachHour: breachIdx < 0 ? null : breachIdx, deliveries: dayDeliv,
        weekBreachAt: weekBreachIdx < 0 ? null : weekBreachIdx,
        avgGal: fueled.length ? sum(fueled.map(function (a) { return a.fuel.gal; })) / fueled.length : 0
      },
      staff: { recPeak: recPeak, curPeak: curPeak, level: level, coverage: coverage, shortages: shortages, recTot: recTot, curTot: curTot, minTot: minTot, shortHours: shortHours },
      delay: { avg: avgDelay, peak: dl[dlPk], peakHour: dlPk, avgPlan: avgDelayPlan, peakPlan: Math.max.apply(null, dlp), hourly: dl, hourlyPlan: dlp },
      risk: { score: score, label: rl.label, cls: rl.cls, parts: parts },
      conflicts: { count: conflictAc.length, ids: conflictAc.map(function (a) { return a.id; }), planCount: conflictPlan.length }
    };
  }

  /* ---------- alerts ---------- */
  function buildAlerts(M, k, d) {
    const sm = M.summary(k, d), S = M.scen[k], F = FACILITY;
    const day = DAYS[d];
    const list = [];
    const add = function (sev, title, time, resource, action, cat) { list.push({ id: k + '-' + d + '-' + list.length, sev: sev, title: title, time: time, resource: resource, action: action, cat: cat }); };

    // arrival surge
    const arr = sm.hourlyArr;
    const thr = Math.max(5, Math.ceil(0.6 * sm.peakHourN));
    let bestRun = null;
    for (let h = 0; h < 24;) {
      if (arr[h] >= thr) { let e = h; while (e + 1 < 24 && arr[e + 1] >= thr) e++; const tot = sum(arr.slice(h, e + 1)); if (!bestRun || tot > bestRun.tot) bestRun = { s: h, e: e + 1, tot: tot }; h = e + 1; } else h++;
    }
    if (bestRun) {
      add(sm.peakHourN >= 8 ? 'high' : 'warning', 'High arrival volume expected from ' + fmtHourLong(bestRun.s) + '-' + fmtHourLong(bestRun.e) + '.',
        fmtHourLong(bestRun.s) + '-' + fmtHourLong(bestRun.e), 'Ramp, ground handling, fuel', 'Brief shift leads; pre-stage tugs, GPUs and fuel trucks before ' + fmtHourLong(Math.max(0, bestRun.s - 1)) + '.', 'volume');
    } else {
      add('info', 'Normal morning arrival peak (6:00 AM-11:00 AM).', '6:00 AM-11:00 AM', 'Ramp, ground handling', 'Run standard morning briefing; no surge staffing needed.', 'volume');
    }

    // parking
    const pu = sm.parking;
    if (pu.firstOver !== null) {
      add('critical', 'Parking demand may exceed capacity by ' + pu.overflowMax + ' position' + (pu.overflowMax === 1 ? '' : 's') + ' (peak ' + Math.round(pu.peakUtil * 100) + '% at ' + fmtHourLong(pu.peakHour) + ').',
        'From ' + fmtHourLong(pu.firstOver), 'Ramp parking', 'Review overflow parking plan with airport operations; humans approve all aircraft placement.', 'parking');
      add('warning', 'Review overflow parking plan with airport operations.', 'Before ' + fmtHourLong(Math.max(0, pu.firstOver - 2)), 'Overflow apron / alternate airports', 'Confirm overflow apron availability and offer later windows to flexible arrivals.', 'parking');
    } else if (pu.peakUtil >= 0.85) {
      add('high', 'Parking capacity may reach ' + Math.round(pu.peakUtil * 100) + '% by ' + fmtHourLong(pu.first90 !== null ? pu.first90 : pu.peakHour) + '.',
        fmtHourLong(pu.first90 !== null ? pu.first90 : pu.peakHour), 'Ramp parking', 'Prepare overflow plan; prioritize drop-and-go aircraft for early departure slots.', 'parking');
    } else if (pu.peakUtil >= 0.7) {
      add('info', 'Parking utilization will reach ' + Math.round(pu.peakUtil * 100) + '% at ' + fmtHourLong(pu.peakHour) + '.', fmtHourLong(pu.peakHour), 'Ramp parking', 'Monitor occupancy; no overflow action needed yet.', 'parking');
    }

    // staffing
    const top = sm.staff.shortages.slice(0, 4);
    top.forEach(function (s) {
      const win = fmtHourLong(s.from) + ' and ' + fmtHourLong(s.to);
      const sev = s.n >= 3 ? 'high' : 'warning';
      if (s.role === 'fuel') {
        add(sev, 'Fuel-service coverage may be below target at ' + fmtHourLong(s.hour) + '.', fmtHourLong(s.from) + '-' + fmtHourLong(s.to), 'Fuel-service personnel', 'Add ' + s.n + ' fuel-service employee' + (s.n === 1 ? '' : 's') + ' before the morning peak, or stagger fuel orders.', 'staffing');
      } else {
        add(sev, 'Add ' + s.n + ' ' + (s.n === 1 ? s.one : s.roleName.toLowerCase()) + ' between ' + win + '.', fmtHourLong(s.from) + '-' + fmtHourLong(s.to), s.roleName, 'Call in or extend ' + s.n + ' team member' + (s.n === 1 ? '' : 's') + '; supervisor to approve roster change.', 'staffing');
      }
    });

    // delay
    if (sm.delay.peak >= 8) {
      add(sm.delay.peak >= 20 ? 'high' : 'warning', 'High arrival volume may create a ~' + (Math.round(sm.delay.peak / 5) * 5 || sm.delay.peak) + '-minute service delay around ' + fmtHourLong(sm.delay.peakHour) + '.',
        fmtHourLong(sm.delay.peakHour), 'Ground-service queue', 'Share expected wait times with operators; apply recommended arrival spacing.', 'delay');
    }

    // fuel
    if (sm.fuel.minInvStanding < F.safety) {
      const bh = sm.fuel.breachHour;
      add(sm.fuel.minInvStanding <= 0 ? 'critical' : 'critical', 'Fuel reserve may fall below the safety threshold (' + fmtInt(F.safety) + ' gal)' + (bh !== null ? ' by ' + fmtHourLong(bh) : '') + ' under the ' + SCEN[k].label.toLowerCase() + '-demand scenario.',
        bh !== null ? fmtHourLong(bh) : 'This day', 'Fuel farm', sm.fuel.deliveries.length ? 'Approve ' + sm.fuel.deliveries.length + ' extra delivery (' + F.extraLoads + ' loads each); first order by ' + fmtAbs(sm.fuel.deliveries[0].order) + '.' : 'Request an additional delivery from the fuel supplier immediately.', 'fuel');
    } else if (sm.fuel.deliveries.length) {
      add('warning', 'Extra fuel delivery recommended to protect the reserve.', fmtAbs(sm.fuel.deliveries[0].at), 'Fuel farm', 'Order by ' + fmtAbs(sm.fuel.deliveries[0].order) + ' (' + fmtInt(sm.fuel.deliveries[0].gal) + ' gal).', 'fuel');
    } else if (sm.fuel.weekBreachAt !== null && Math.floor(sm.fuel.weekBreachAt / 24) > d) {
      add('info', 'Week-ahead: fuel reserve projected below threshold on ' + DAYS[Math.floor(sm.fuel.weekBreachAt / 24)].label + ' without extra deliveries.', DAYS[Math.floor(sm.fuel.weekBreachAt / 24)].label, 'Fuel farm', 'Schedule additional deliveries during the preceding 48 hours.', 'fuel');
    }

    // conflicts
    if (sm.conflicts.count >= 1) {
      const n = sm.conflicts.count;
      add(n >= 3 ? 'high' : 'warning', (n === 3 ? 'Three' : n) + ' aircraft ' + (n === 1 ? 'has' : 'have') + ' overlapping ground-service windows or capacity conflicts.', 'See timeline', 'Ground service / ramp', 'Open the timeline, filter for red entries, and re-time services with the shift supervisor.', 'conflict');
    }

    // weather and closures
    const wx = WEATHER[d];
    if (wx.ceiling !== 'Clear' && /Marine|Light rain/.test(wx.note)) add('info', wx.note, 'See note', 'Ramp safety / arrival pacing', 'Brief ramp crews on conditions; confirm de-icing is not required (rain only).', 'weather');
    CLOSURES[d].forEach(function (c) {
      add('info', c.rwy + ' constraint ' + c.win + ': ' + c.note + '.', c.win, 'Airfield (advisory only)', 'Information for planning. Runway use is decided only by ATC and airport authorities.', 'airfield');
    });

    const order = { critical: 0, high: 1, warning: 2, info: 3 };
    list.sort(function (a, b) { return order[a.sev] - order[b.sev]; });
    return list;
  }

  /* ---------- AI scheduling assistant (heuristic engine; advisory) ---------- */
  function buildAssistant(M, k, d) {
    const S = M.scen[k], sm = M.summary(k, d);
    const dayAc = M.dayAircraft(k, d);
    const arr = sm.hourlyArr;
    const avgSvc = dayAc.length ? mean(dayAc.map(function (a) { return a.svcH * 60; })) : 42;
    const capCur = [], capRec = [];
    for (let h = 0; h < 24; h++) {
      const tc = Math.max(1, Math.floor(S.staff.ground.cur[d * 24 + h] / 2));
      const tr = Math.max(1, Math.floor(S.staff.ground.rec[d * 24 + h] / 2));
      capCur.push(Math.floor(tc * 60 / avgSvc)); capRec.push(Math.floor(tr * 60 / avgSvc));
    }
    const peakN = Math.max.apply(null, arr);
    const rows = [];
    for (let h = 4; h < 22; h++) {
      if (arr[h] >= Math.ceil(0.5 * peakN) || arr[h] > capCur[h]) {
        const shift = Math.max(0, arr[h] - capCur[h]);
        let target = null;
        for (let off = 1; off <= 4 && !target; off++) {
          [h - off, h + off].forEach(function (c) { if (!target && c >= 4 && c < 22 && arr[c] + 1 <= Math.floor(0.75 * capCur[c])) target = c; });
        }
        rows.push({ h: h, arr: arr[h], capCur: capCur[h], capRec: capRec[h], status: arr[h] > capCur[h] ? 'over' : arr[h] >= 0.85 * capCur[h] ? 'tight' : 'ok', shift: shift, shiftRec: Math.max(0, arr[h] - capRec[h]), target: target });
      }
    }
    const peakCap = capCur[sm.peakHour] || 1;
    const spacingMin = Math.max(5, Math.ceil(60 / peakCap));
    const expectedGap = 60 / Math.max(1, sm.peakHourN);
    const slotHours = rows.slice().sort(function (a, b) { return b.arr - a.arr; }).slice(0, 4).sort(function (a, b) { return a.h - b.h; }).map(function (r) {
      const n = Math.max(1, r.capCur), step = 60 / n;
      return { h: r.h, slots: Array.from({ length: n }, function (_, i) { return Math.round(i * step); }), teams: Math.max(1, Math.floor(S.staff.ground.cur[d * 24 + r.h] / 2)) };
    });

    // parking proposals
    const counters = { A: 0, B: 0, C: 0, O: 0 };
    const aprons = FACILITY.aprons;
    const focus = dayAc.filter(function (a) { return a.h >= sm.peakWin.start && a.h < sm.peakWin.end; }).slice(0, 12);
    const parking = focus.map(function (a) {
      let ap = (a.cat === 'large' || a.cat === 'ulr') ? 'A' : (a.cat === 'turbo' || a.cat === 'heli') ? 'C' : 'B';
      let code, needsOps = false;
      if (a.overflow) { counters.O++; code = 'O-' + String(counters.O).padStart(2, '0'); needsOps = true; }
      else {
        counters[ap]++;
        if (counters[ap] > aprons[ap]) { counters.O++; code = 'O-' + String(counters.O).padStart(2, '0'); needsOps = true; }
        else code = ap + '-' + String(counters[ap]).padStart(2, '0');
      }
      return { id: a.id, cat: a.catName, time: fmtClock(a.h + a.min / 60), code: code, stay: STAYS[a.stay].name, dep: fmtAbs(a.dep), needsOps: needsOps };
    });

    // fuel priority queue
    const fq = S.aircraft.filter(function (a) { return a.fuel.need && Math.floor(a.fuel.at / 24) === d; }).sort(function (a, b) { return a.fuel.at - b.fuel.at; });
    const fuelQueue = fq.slice(0, 8).map(function (a, i) {
      let reason = a.stay === 'dropgo' ? 'Time-critical turn: short ramp stay' : a.fuel.gal >= 1600 ? 'Large uplift: start early to avoid truck overlap' : 'Scheduled departure fueling';
      if (a.fuelWait >= 8) reason = 'Queue risk: stagger with neighboring fuel jobs';
      return { rank: i + 1, id: a.id, cat: a.catName, gal: a.fuel.gal, at: fmtClock(a.fuel.at - d * 24), reason: reason };
    });

    // resource concurrency (10-minute sampling)
    const res = [
      { key: 'ground', one: 'ground handler', name: 'Ground-handling teams (2 people)', cap: Math.max.apply(null, Array.from({ length: 24 }, function (_, h) { return Math.floor(S.staff.ground.cur[d * 24 + h] / 2); })) },
      { key: 'fuel', one: 'fuel-service employee', name: 'Fuel trucks', cap: FACILITY.trucks },
      { key: 'gpu', name: 'Ground power units', cap: FACILITY.gpu },
      { key: 'lav', name: 'Lav / water carts', cap: FACILITY.lav },
      { key: 'cater', name: 'Catering vans', cap: FACILITY.catering },
      { key: 'crew', name: 'Crew transport cars', cap: FACILITY.crewCars },
      { key: 'tug', name: 'Tugs / tow vehicles', cap: FACILITY.tugs }
    ];
    res.forEach(function (r) { r.peak = 0; r.peakAt = 0; });
    for (let m = 0; m < 144; m++) {
      const tt = d * 24 + m / 6;
      const cnt = { ground: 0, fuel: 0, gpu: 0, lav: 0, cater: 0, crew: 0, tug: 0 };
      S.aircraft.forEach(function (a) {
        const ss = a.t + 0.13 + a.wait / 60, se = ss + a.svcH;
        if (tt >= ss && tt < se) {
          cnt.ground++;
          if (a.svcs.indexOf('gpu') >= 0) cnt.gpu++;
          if (a.svcs.indexOf('lav') >= 0) cnt.lav++;
          if (a.svcs.indexOf('cater') >= 0) cnt.cater++;
          if (a.svcs.indexOf('crew') >= 0) cnt.crew++;
        }
        if (a.fuel.need && tt >= a.fuel.at + a.fuelWait / 60 && tt < a.fuel.at + a.fuelWait / 60 + 0.25 + a.fuel.gal / 6000) cnt.fuel++;
        if ((tt >= a.t && tt < a.t + 0.25) || (tt >= a.dep - 0.3 && tt < a.dep - 0.05)) cnt.tug++;
      });
      res.forEach(function (r) { if (cnt[r.key] > r.peak) { r.peak = cnt[r.key]; r.peakAt = m / 6; } });
    }
    res.forEach(function (r) { r.util = r.cap ? r.peak / r.cap : 0; });

    // conflicts list
    const conflicts = dayAc.filter(function (a) { return a.conflict; }).slice(0, 8).map(function (a) {
      return { id: a.id, time: fmtClock(a.h + a.min / 60), cat: a.catName, text: a.warnings.filter(function (w) { return w.level === 'conflict'; }).map(function (w) { return w.text; }).join('; ') };
    });

    // runway observations (advisory only)
    const wx = WEATHER[d];
    const closures = CLOSURES[d];
    const eastFlow = wx.flow !== 'West flow';
    const obs = [
      'Synthetic conditions: winds ' + wx.wind + ', visibility ' + wx.vis + ', ceiling ' + wx.ceiling + '. ' + wx.note,
      eastFlow ? 'Observation: wind pattern may support east-flow operations; expect different taxi routes to the FBO ramp. Plan extra marshaller and tug coverage.' : 'Observation: winds favor west-flow operations, which is typical for this time of year.',
      closures.length ? 'Constraint noted: ' + closures.map(function (c) { return c.rwy + ' ' + c.win + ' (' + c.note + ')'; }).join('; ') + '.' : 'No runway closures or restrictions in the synthetic airfield feed for this date.',
      (eastFlow ? 'Runways that may be discussed in flow planning: 6L, 6R, 7L, 7R (east flow).' : 'Runways that may be discussed in flow planning: 24L, 24R, 25L, 25R (west flow).') + ' These are observations only, not instructions.',
      'Peak-hour taxi times to the ramp may increase when more than ' + Math.max(6, peakCap) + ' arrivals per hour overlap with commercial traffic; keep ramp crews flexible.'
    ];

    // plain-language summary
    const wi = sm.staff.shortages[0];
    const summary = [
      'Expect ' + sm.arrivals + ' private-aircraft arrivals (' + sm.ci.lo + '-' + sm.ci.hi + ' range), peaking ' + fmtHourLong(sm.peakWin.start) + '-' + fmtHourLong(sm.peakWin.end) + ' with up to ' + sm.peakHourN + ' arrivals in ' + fmtHourLong(sm.peakHour) + '.',
      'Recommended spacing: at least ' + spacingMin + ' minutes between arrivals in the peak hour (expected average gap is ' + (Math.round(expectedGap * 10) / 10) + ' min).',
      wi ? 'Largest staffing gap: ' + wi.n + ' ' + (wi.n === 1 ? wi.one : wi.roleName.toLowerCase()) + ' between ' + fmtHourLong(wi.from) + ' and ' + fmtHourLong(wi.to) + '.' : 'Current roster covers the recommended staffing for this day.',
      'Ramp peaks at ' + Math.round(sm.parking.peakUtil * 100) + '% at ' + fmtHourLong(sm.parking.peakHour) + (sm.parking.overflowMax ? '; plan for up to ' + sm.parking.overflowMax + ' overflow positions.' : '; no overflow expected.'),
      sm.fuel.deliveries.length ? 'Fuel: approve ' + sm.fuel.deliveries.length + ' extra delivery on this day to protect the reserve.' : 'Fuel: standing delivery covers expected demand for this day.'
    ];

    return { rows: rows, capCur: capCur, capRec: capRec, spacingMin: spacingMin, expectedGap: expectedGap, slotHours: slotHours, parking: parking, fuelQueue: fuelQueue, resources: res, conflicts: conflicts, runway: { obs: obs, closures: closures, wx: wx }, summary: summary, avgSvc: avgSvc };
  }

  /* ---------- impact analytics ---------- */
  function buildImpact(M, k) {
    const S = M.scen[k];
    const rng = mulberry32(5150 + M.run * 13);
    const errs = DAYS.map(function (_, d) { const ci = SCEN[k].ci * DAY_CI_FACTOR[d]; return (rng() * 2 - 1) * ci * 0.8; });
    const forecast = S.dailyArr.slice();
    const actual = forecast.map(function (f, d) { return Math.max(1, Math.round(f * (1 + errs[d]))); });
    const errPct = actual.map(function (a, d) { return Math.round(1000 * Math.abs(a - forecast[d]) / a) / 10; });
    const mape = mean(errPct);

    const cov = function (adopt) {
      let num = 0, den = 0;
      ROLES.forEach(function (ro) { for (let i = 0; i < HOURS; i++) { const r = S.staff[ro.key].rec[i], c = S.staff[ro.key].cur[i]; const av = c + adopt * Math.max(0, r - c); num += Math.min(av, r); den += r; } });
      return 100 * num / den;
    };
    const covBefore = cov(0), covAfter = cov(0.9);
    const ac = S.aircraft;
    const dBefore = ac.length ? mean(ac.map(function (a) { return a.wait; })) : 0;
    const dAfter = ac.length ? mean(ac.map(function (a) { return a.waitPlan; })) : 0;
    const overBefore = sum(S.occ.map(function (v) { return Math.max(0, v - FACILITY.sellable); }));
    const overAfter = sum(S.occPlan.map(function (v) { return Math.max(0, v - FACILITY.sellable); }));
    const peakBefore = Math.max.apply(null, S.occ) / FACILITY.sellable;
    const peakAfter = Math.max.apply(null, S.occPlan) / FACILITY.sellable;
    const fuelOkS = 100 * S.fuel.invS.filter(function (v) { return v >= FACILITY.safety; }).length / HOURS;
    const fuelOkR = 100 * S.fuel.invR.filter(function (v) { return v >= FACILITY.safety; }).length / HOURS;
    const confBefore = ac.filter(function (a) { return a.conflict; }).length;
    const confAfter = ac.filter(function (a) { return a.conflictPlan; }).length;
    return {
      forecast: forecast, actual: actual, errPct: errPct, mape: mape, covBefore: covBefore, covAfter: covAfter, dBefore: dBefore, dAfter: dAfter,
      overBefore: overBefore, overAfter: overAfter, peakBefore: peakBefore, peakAfter: peakAfter, fuelOkS: fuelOkS, fuelOkR: fuelOkR,
      confBefore: confBefore, confAfter: confAfter, avoided: Math.max(0, confBefore - confAfter), total: ac.length
    };
  }

  /* ---------- exports ---------- */
  global.Model = {
    DAYS: DAYS, HOURS: HOURS, FACILITY: FACILITY, CATS: CATS, CAT_BY: CAT_BY, SERVICES: SERVICES, STAYS: STAYS, ROLES: ROLES, SCEN: SCEN, SCEN_KEYS: SCEN_KEYS,
    WEATHER: WEATHER, CLOSURES: CLOSURES, BASELINE_DAILY: BASELINE_DAILY, BASELINE_AVG: BASELINE_AVG, ROSTER: ROSTER,
    build: build, daySlice: daySlice, confidenceHourly: confidenceHourly, dailyCI: dailyCI, rosterAt: rosterAt,
    fmt: { hour: fmtHour, hourLong: fmtHourLong, clock: fmtClock, abs: fmtAbs, dur: fmtDur, int: fmtInt },
    util: { sum: sum, mean: mean, clamp: clamp }
  };
})(window);
