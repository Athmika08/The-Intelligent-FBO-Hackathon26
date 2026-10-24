/* =========================================================================
   LAXY Intelligent FBO - operations layer (synthetic)
   -------------------------------------------------------------------------
   Sits on top of Model (forecast + aircraft) and adds the per-aircraft
   operational detail the Live Schedule, Parking & Ramp, Runway Operations
   and AI assistant views need:
     - ramp position assignment (first-fit, wide spots for large aircraft)
     - ground-handler team / fuel-truck assignment
     - service + fuel windows and lifecycle status at any clock time
     - ADVISORY runway planning estimates, runway availability, conflicts

   Everything is a SYNTHETIC PLANNING ESTIMATE. Nothing here assigns a
   runway, authorizes a movement or places an aircraft: humans and air
   traffic control decide. In production the same fields would be returned
   by the Python forecasting service (see js/api.js endpoints).
   ========================================================================= */
(function (global) {
  'use strict';
  const F = Model.FACILITY, fmt = Model.fmt;
  const pad2 = function (n) { return String(n).padStart(2, '0'); };

  /* ---------- ramp layout ---------- */
  const ZONES = [
    { key: 'A', name: 'Apron A', sub: 'Large-cabin & ultra-long-range', n: F.aprons.A },
    { key: 'B', name: 'Apron B', sub: 'Midsize & light jets', n: F.aprons.B },
    { key: 'C', name: 'Apron C', sub: 'Turboprop & rotorcraft', n: F.aprons.C }
  ];
  const ZONE_BY = {}; ZONES.forEach(function (z) { ZONE_BY[z.key] = z; });

  /* ---------- lifecycle status ---------- */
  const STATUS = {
    scheduled: { key: 'scheduled', label: 'Scheduled', cls: 'ps-scheduled' },
    arrived: { key: 'arrived', label: 'Arrived', cls: 'ps-arrived' },
    servicing: { key: 'servicing', label: 'Servicing', cls: 'ps-servicing' },
    ready: { key: 'ready', label: 'Ready', cls: 'ps-ready' },
    departed: { key: 'departed', label: 'Departed', cls: 'ps-departed' }
  };
  const STATUS_KEYS = ['scheduled', 'arrived', 'servicing', 'ready', 'departed'];

  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; }

  /* ---------- runway planning reference (advisory only) ---------- */
  const FLOW = {
    west: { label: 'West flow', rwys: ['24R', '25L', '24L', '25R'] },
    east: { label: 'East flow', rwys: ['6L', '7R', '6R', '7L'] }
  };
  const RW_WEIGHTS = [0.40, 0.30, 0.20, 0.10];
  const RW_ROLE = ['Primary planning reference', 'Secondary planning reference', 'Alternate', 'Alternate'];
  const flowOf = function (d) { return /East/.test(Model.WEATHER[d].flow) ? FLOW.east : FLOW.west; };

  function parseWin(win) {
    const m = /(\d{1,2}):(\d{2}) (AM|PM)\s*-\s*(\d{1,2}):(\d{2}) (AM|PM)/.exec(win || '');
    if (!m) return null;
    const cv = function (h, mi, ap) { h = +h % 12; if (ap === 'PM') h += 12; return h + (+mi) / 60; };
    return { s: cv(m[1], m[2], m[3]), e: cv(m[4], m[5], m[6]) };
  }
  const inWin = function (w, h) { return w.e > w.s ? (h >= w.s && h < w.e) : (h >= w.s || h < w.e); };

  /* Advisory runway availability for runway code `r` at (fractional) hour-of-day `h` on day `d`. */
  function runwayState(d, r, h) {
    const wx = Model.WEATHER[d];
    let st = { s: 'open', note: '' };
    Model.CLOSURES[d].forEach(function (c) {
      const w = parseWin(c.win); if (!w) return;
      if (c.rwy === 'Airspace') { if (inWin(w, h)) st = { s: 'restricted', note: c.note + ' (' + c.win + ')' }; }
      else if (c.rwy === r && inWin(w, h)) st = { s: 'closed', note: c.rwy + ' ' + c.note + ' (' + c.win + ')' };
    });
    if (st.s === 'open' && d === 2 && h < 10 && /Marine/.test(wx.note)) st = { s: 'reduced', note: 'Marine layer: reduced visibility, lower arrival rate expected' };
    if (st.s === 'open' && d === 1 && h >= 14 && h < 20) st = { s: 'reduced', note: 'Light rain showers: wet-runway spacing may apply' };
    return st;
  }

  function pickRunway(ac) {
    if (ac.cat === 'heli') return { code: 'Rotor', note: 'Rotorcraft arrival route (helipad / rotorcraft procedures), coordinated by ATC', alt: false };
    const fl = flowOf(ac.d), hod = ac.h + ac.min / 60;
    const u = hash(ac.id + 'rwy');
    let idx = u < RW_WEIGHTS[0] ? 0 : u < RW_WEIGHTS[0] + RW_WEIGHTS[1] ? 1 : u < RW_WEIGHTS[0] + RW_WEIGHTS[1] + RW_WEIGHTS[2] ? 2 : 3;
    let note = '', alt = false;
    for (let k = 0; k < 4; k++) {
      const code = fl.rwys[(idx + k) % 4];
      const st = runwayState(ac.d, code, hod);
      if (st.s !== 'closed') { if (k > 0) { note = fl.rwys[idx] + ' unavailable in this window; ' + code + ' used as planning reference'; alt = true; } return { code: code, note: note, alt: alt, state: st }; }
    }
    return { code: fl.rwys[idx], note: '', alt: false };
  }

  /* ---------- scenario sweep: positions, teams, windows ---------- */
  function prepare(model, k) {
    const ck = 'sim:' + k;
    if (model._cache[ck]) return model._cache[ck];
    const S = model.scen[k];
    const until = { A: new Array(F.aprons.A).fill(-1), B: new Array(F.aprons.B).fill(-1), C: new Array(F.aprons.C).fill(-1) };
    const ovf = [];

    S.aircraft.forEach(function (ac) {
      const sv = ac.t + 0.13 + ac.wait / 60;
      const fs = ac.fuel.need ? ac.fuel.at + ac.fuelWait / 60 : null;
      const fe = fs != null ? fs + 0.25 + ac.fuel.gal / 6000 : null;
      const order = ac.fp === 2 ? ['A', 'B', 'C'] : (ac.cat === 'turbo' || ac.cat === 'heli') ? ['C', 'B', 'A'] : ['B', 'A', 'C'];
      let placed = null;
      for (let o = 0; o < order.length && !placed; o++) {
        const z = order[o], arr = until[z];
        if (ac.fp === 2) { for (let i = 0; i + 1 < arr.length; i += 2) { if (arr[i] <= ac.t && arr[i + 1] <= ac.t) { placed = { zone: z, idx: i }; break; } } }
        else if (z === 'A') { for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] <= ac.t) { placed = { zone: z, idx: i }; break; } } }
        else { for (let i = 0; i < arr.length; i++) { if (arr[i] <= ac.t) { placed = { zone: z, idx: i }; break; } } }
      }
      let pos;
      if (placed) {
        until[placed.zone][placed.idx] = ac.dep;
        if (ac.fp === 2) until[placed.zone][placed.idx + 1] = ac.dep;
        pos = { zone: placed.zone, idx: placed.idx, span: ac.fp, code: placed.zone + '-' + pad2(placed.idx + 1), overflow: false };
      } else {
        let oi = ovf.findIndex(function (u) { return u <= ac.t; });
        if (oi < 0) { ovf.push(ac.dep); oi = ovf.length - 1; } else ovf[oi] = ac.dep;
        pos = { zone: 'O', idx: oi, span: 1, code: 'O-' + pad2(oi + 1), overflow: true };
      }
      const rw = pickRunway(ac);
      ac.sim = {
        pos: pos, svcStart: sv, svcEnd: sv + ac.svcH, fuelStart: fs, fuelEnd: fe,
        rwy: rw, team: 0, truck: null
      };
    });

    // ground-handler teams (2 people each)
    const teamBusy = new Array(8).fill(-1);
    S.aircraft.slice().sort(function (a, b) { return a.sim.svcStart - b.sim.svcStart; }).forEach(function (ac) {
      const sv = ac.sim.svcStart, h = Math.min(167, Math.floor(sv));
      const cap = Math.max(1, Math.min(8, Math.floor(S.staff.ground.cur[h] / 2)));
      let ti = -1;
      for (let i = 0; i < cap; i++) { if (teamBusy[i] <= sv + 1e-9) { ti = i; break; } }
      if (ti < 0) { ti = 0; for (let i = 1; i < cap; i++) if (teamBusy[i] < teamBusy[ti]) ti = i; }
      teamBusy[ti] = Math.max(sv, teamBusy[ti]) + ac.svcH;
      ac.sim.team = ti;
    });
    // fuel trucks
    const truckBusy = [-1, -1, -1];
    S.aircraft.filter(function (a) { return a.fuel.need; }).sort(function (a, b) { return a.sim.fuelStart - b.sim.fuelStart; }).forEach(function (ac) {
      const fs = ac.sim.fuelStart;
      let ti = -1;
      for (let i = 0; i < truckBusy.length; i++) { if (truckBusy[i] <= fs + 1e-9) { ti = i; break; } }
      if (ti < 0) { ti = 0; for (let i = 1; i < truckBusy.length; i++) if (truckBusy[i] < truckBusy[ti]) ti = i; }
      truckBusy[ti] = Math.max(fs, truckBusy[ti]) + (ac.sim.fuelEnd - fs);
      ac.sim.truck = ti;
    });

    model._cache[ck] = true;
    return true;
  }

  const teamName = function (ac) { const i = ac.sim.team; return 'Team G' + (i + 1) + ' (GH-' + pad2(2 * i + 1) + ' & GH-' + pad2(2 * i + 2) + ')'; };
  const teamShort = function (ac) { return 'G' + (ac.sim.team + 1); };
  const truckName = function (ac) { return ac.sim.truck == null ? '—' : 'Truck F' + (ac.sim.truck + 1) + ' (FS-' + pad2(ac.sim.truck + 1) + ')'; };

  /* ---------- status at absolute time T (hours since Feb 10 00:00) ---------- */
  function statusAt(ac, T) {
    const s = ac.sim;
    if (T < ac.t) return STATUS.scheduled;
    if (T >= ac.dep) return STATUS.departed;
    if ((T >= s.svcStart && T < s.svcEnd) || (s.fuelStart != null && T >= s.fuelStart && T < s.fuelEnd)) return STATUS.servicing;
    if (T < s.svcStart) return STATUS.arrived;
    return STATUS.ready;
  }
  /* Ground-service status text for the selected clock time. */
  function serviceText(ac, T) {
    const s = ac.sim;
    const fuelPart = ac.fuel.need ? (T >= s.fuelEnd ? 'fuel complete' : (T >= s.fuelStart ? 'fueling now' : 'fuel at ' + fmt.clock(s.fuelStart % 24))) : 'no fuel';
    let g;
    if (T < ac.t) g = 'Not yet arrived';
    else if (T < s.svcStart) g = ac.wait >= 5 ? 'Waiting for crew (~' + Math.round(ac.wait) + ' min)' : 'Awaiting handler team';
    else if (T < s.svcEnd) g = 'In progress (' + teamShort(ac) + ')';
    else g = 'Complete';
    return g + ' · ' + fuelPart;
  }

  const presentAt = function (model, k, T) { prepare(model, k); return model.scen[k].aircraft.filter(function (a) { return a.t <= T && a.dep > T; }); };
  /* Aircraft whose time on the ramp overlaps day d (arrivals that day + carry-over). */
  const dayRamp = function (model, k, d) { prepare(model, k); return model.scen[k].aircraft.filter(function (a) { return a.t < (d + 1) * 24 && a.dep > d * 24; }); };

  /* Ramp snapshot at absolute time T: units per zone, availability (excludes the 8 reserved positions). */
  function rampAt(model, k, T) {
    const pres = presentAt(model, k, T), u = { A: 0, B: 0, C: 0, O: 0 };
    pres.forEach(function (a) { u[a.sim.pos.zone] += a.fp; });
    const used = u.A + u.B + u.C;
    const st = { arrived: 0, servicing: 0, ready: 0 };
    pres.forEach(function (a) { st[statusAt(a, T).key]++; });
    return { present: pres, units: u, usedTransient: used, available: Math.max(0, F.transientRoom - used), overflow: u.O, totalUnits: F.based + used + u.O, util: (F.based + used + u.O) / F.sellable, st: st };
  }

  /* units used per ramp zone for each hour of a day (used by assistant answers) */
  function zoneFill(model, k, d) {
    prepare(model, k);
    const out = { A: [], B: [], C: [], O: [] };
    for (let h = 0; h < 24; h++) {
      const T = d * 24 + h + 0.5, c = { A: 0, B: 0, C: 0, O: 0 };
      model.scen[k].aircraft.forEach(function (a) { if (a.t <= T && a.dep > T) c[a.sim.pos.zone] += a.fp; });
      ['A', 'B', 'C', 'O'].forEach(function (z) { out[z].push(c[z]); });
    }
    return out;
  }

  /* ---------- runway day view (advisory) ---------- */
  function runwayDay(model, k, d) {
    prepare(model, k);
    const fl = flowOf(d), list = model.dayAircraft(k, d);
    const by = {}, hourly = {}, avail = {};
    fl.rwys.concat(['Rotor']).forEach(function (r) { by[r] = []; hourly[r] = new Array(24).fill(0); });
    list.forEach(function (a) { const r = a.sim.rwy.code; by[r].push(a); hourly[r][a.h]++; });
    fl.rwys.forEach(function (r) { avail[r] = []; for (let h = 0; h < 24; h++) avail[r].push(runwayState(d, r, h + 0.5)); });

    const conflicts = [];
    fl.rwys.forEach(function (r) {
      const arr = by[r].slice().sort(function (a, b) { return a.t - b.t; });
      for (let i = 1; i < arr.length; i++) {
        const gap = (arr[i].t - arr[i - 1].t) * 60;
        if (gap < 4) conflicts.push({ sev: gap < 2 ? 'high' : 'warning', rwy: r, a: arr[i - 1], b: arr[i], gap: gap, t: arr[i].t, text: arr[i - 1].id + ' and ' + arr[i].id + ' are estimated only ' + Math.max(0, Math.round(gap)) + ' min apart on the ' + r + ' planning reference (suggested spacing 4+ min)' });
      }
      for (let h = 0; h < 24; h++) { if (hourly[r][h] >= 6) conflicts.push({ sev: 'warning', rwy: r, t: d * 24 + h, text: hourly[r][h] + ' arrivals estimated on the ' + r + ' planning reference during ' + fmt.hourLong(h) + ' (dense period)', dense: true, h: h }); }
    });
    list.filter(function (a) { return a.sim.rwy.alt; }).forEach(function (a) { conflicts.push({ sev: 'info', rwy: a.sim.rwy.code, a: a, t: a.t, text: a.id + ' (' + fmt.clock(a.h + a.min / 60) + '): ' + a.sim.rwy.note }); });
    conflicts.sort(function (x, y) { return x.t - y.t; });
    return { flow: fl, by: by, hourly: hourly, avail: avail, conflicts: conflicts, list: list };
  }

  global.Sim = {
    ZONES: ZONES, ZONE_BY: ZONE_BY, STATUS: STATUS, STATUS_KEYS: STATUS_KEYS, FLOW: FLOW, RW_ROLE: RW_ROLE,
    prepare: prepare, statusAt: statusAt, serviceText: serviceText, presentAt: presentAt, rampAt: rampAt, dayRamp: dayRamp, zoneFill: zoneFill, runwayDay: runwayDay,
    runwayState: runwayState, flowOf: flowOf, teamName: teamName, teamShort: teamShort, truckName: truckName, parseWin: parseWin
  };
})(window);
