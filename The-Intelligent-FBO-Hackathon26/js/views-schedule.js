/* Live Schedule: hourly arrival blocks, timeline (Gantt) and table, with a sliding aircraft / hour detail panel.
   Also defines the shared aircraft detail panel (UI.openAircraft) used by Parking & Ramp and Runway Operations.
   All aircraft are anonymous synthetic records. Nothing here authorizes or moves anything. */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt, CATS = Model.CATS, SERVICES = Model.SERVICES;
  const A = App, $ = A.$, UI = window.UI;
  const catBy = {}; CATS.forEach(function (c) { catBy[c.key] = c; });
  const tod = function (T) { return fmt.clock(((T % 24) + 24) % 24); };
  const svcName = function (k) { return SERVICES.filter(function (s) { return s.key === k; })[0].name; };
  const eta = function (a) { return fmt.clock(a.h + a.min / 60); };
  const statusInfo = {
    confirmed: { t: 'Confirmed', c: 'st-ok' },
    proposed: { t: 'AI-proposed · needs approval', c: 'st-prop' },
    unassigned: { t: 'Unassigned · conflict', c: 'st-bad' }
  };
  const pill = function (st) { return '<span class="ps ' + st.cls + '">' + st.label + '</span>'; };
  const stNow = function (a) { return Sim.statusAt(a, UI.nowT()); };
  const aircraftOf = function (id) { return A.M().scen[A.state.scen].aircraft.filter(function (x) { return x.id === id; })[0]; };
  const fuelWin = function (a) { return a.fuel.need ? tod(a.sim.fuelStart) + '–' + tod(a.sim.fuelEnd) : null; };
  const svcWin = function (a) { return tod(a.sim.svcStart) + '–' + tod(a.sim.svcEnd); };

  /* ====================== shared aircraft detail panel ====================== */
  const decided = {};
  function miniTimeline(a) {
    const s = a.sim, T = UI.nowT(), t0 = a.t, t1 = a.dep, len = Math.max(0.5, t1 - t0);
    const pc = function (x) { return clamp((x - t0) / len * 100, 0, 100); };
    const clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
    const seg = function (x0, x1, col) { const l = pc(x0), w = Math.max(1.5, pc(x1) - l); return '<i class="tm-seg" style="left:' + l + '%;width:' + w + '%;background:' + col + '"></i>'; };
    const lab = function (x, txt, top) { return '<span class="tm-lab" style="left:' + clamp(pc(x), 6, 94) + '%;top:' + top + 'px">' + txt + '</span>'; };
    return '<div class="tl-mini" aria-label="Time on ramp: arrives ' + eta(a) + ', departs ' + tod(t1) + '">' +
      '<div class="tm-track"></div>' + seg(s.svcStart, s.svcEnd, '#7c3aed') + (a.fuel.need ? seg(s.fuelStart, s.fuelEnd, '#facc15') : '') +
      (T >= t0 && T <= t1 ? '<i class="tm-now" style="left:' + pc(T) + '%" title="Operations clock"></i>' : '') +
      '<span class="tm-lab" style="left:0;top:4px;transform:none">Arrive ' + tod(t0) + '</span><span class="tm-lab" style="right:0;top:4px;transform:none">Depart ' + tod(t1) + '</span>' + '</div>' +
      '<div class="legend-park" style="margin-top:4px"><span><i style="background:#7c3aed;border-color:#7c3aed"></i>Ground service</span>' + (a.fuel.need ? '<span><i style="background:#facc15;border-color:#d4a60a"></i>Fuel service</span>' : '') + '<span><i style="background:#ef4444;border-color:#ef4444;width:4px"></i>Operations clock</span></div>';
  }

  function aircraftPanelHtml(a) {
    const T = UI.nowT(), st = Sim.statusAt(a, T), rw = a.sim.rwy, key = A.state.scen + '-' + a.id;
    const stat = statusInfo[a.status];
    const kv = function (rows) { return '<dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; };
    const warn = a.warnings.length ? '<div class="dr-sec"><h4>Delays &amp; conflicts</h4><ul class="conf-list">' + a.warnings.map(function (w) { return '<li class="' + (w.level === 'conflict' ? '' : 'w') + '"><b>' + (w.level === 'conflict' ? 'Conflict' : 'Warning') + '</b> ' + w.text + '</li>'; }).join('') + '</ul></div>' : '<div class="dr-sec"><h4>Delays &amp; conflicts</h4><p class="muted">None detected for this aircraft (synthetic estimate).</p></div>';
    const as = A.M().assistant(A.state.scen, a.d);
    const spacing = '<div class="dr-sec"><h4>Recommended spacing</h4><p>Keep at least <b>' + as.spacingMin + ' min</b> between arrivals around ' + fmt.hourLong(a.h) + ' (about ' + (as.capCur[a.h] || 1) + ' services/hour of capacity with the current roster).' + (a.planShift ? ' The planner suggests offering this aircraft a different window (flexible stay) to spread the peak. Human approval needed.' : '') + '</p></div>';
    const dec = decided[key] ? '<span class="approved">' + A.icon('check', 14) + decided[key] + '</span>' : '<button type="button" class="btn btn-primary btn-sm" data-act="approve" data-aid="' + a.id + '">Approve plan</button><button type="button" class="btn btn-ghost btn-sm" data-act="flag" data-aid="' + a.id + '">Flag for review</button>';
    return '<div class="dr-sec"><div class="chips"><span class="chip" style="border-left:4px solid ' + catBy[a.cat].color + '">' + a.catName + '</span>' + pill(st) + '<span class="st ' + stat.c + '">' + stat.t + '</span></div>' + miniTimeline(a) + '</div>' +
      '<div class="dr-sec"><h4>Arrival &amp; stay</h4>' + kv([['Estimated arrival', eta(a) + ' · ' + D[a.d].dow + ' ' + D[a.d].label], ['Estimated departure', tod(a.dep) + (Math.floor(a.dep / 24) !== a.d ? ' · ' + D[Math.min(6, Math.floor(a.dep / 24))].dow : '')], ['Parking duration', fmt.dur(a.dur)], ['Stay type', Model.STAYS[a.stay].name]]) + '</div>' +
      '<div class="dr-sec"><h4>Parking &amp; ramp</h4>' + kv([['Ramp position', '<span class="pos' + (a.sim.pos.overflow ? ' pos-ovf' : '') + '">' + a.sim.pos.code + '</span>'], ['Area', a.sim.pos.overflow ? 'Overflow apron (needs airport-ops approval)' : Sim.ZONE_BY[a.sim.pos.zone].name], ['Footprint', a.fp === 2 ? 'Wide (2 positions)' : 'Standard (1 position)']]) + '</div>' +
      '<div class="dr-sec"><h4>Ground services</h4>' + kv([['Services', a.svcs.length ? a.svcs.map(svcName).join(', ') : 'Standard handling'], ['Handler team', Sim.teamName(a)], ['Service window', svcWin(a) + ' (' + Math.round(a.svcH * 60) + ' min)'], ['Expected wait', a.wait >= 1 ? '~' + Math.round(a.wait) + ' min' : 'None'], ['Status now', Sim.serviceText(a, T)]]) + '</div>' +
      '<div class="dr-sec"><h4>Fuel service</h4>' + (a.fuel.need ? kv([['Requested', 'Jet-A ~' + fmt.int(a.fuel.gal) + ' gal'], ['Fuel window', fuelWin(a)], ['Fuel truck', Sim.truckName(a)], ['Expected wait', a.fuelWait >= 1 ? '~' + Math.round(a.fuelWait) + ' min' : 'None']]) : '<p class="muted">No fuel service planned.</p>') + '</div>' +
      warn + spacing +
      '<div class="dr-sec"><h4>Runway (advisory planning estimate)</h4>' + kv([['Planning reference', rw.code === 'Rotor' ? 'Rotorcraft route' : 'Runway ' + rw.code], ['Flow', Sim.flowOf(a.d).label]]) + (rw.note ? '<p class="note">' + rw.note + '</p>' : '') + '<div class="callout-adv" style="margin-top:8px">' + A.ADVISORY + '</div></div>' +
      '<div class="dr-sec"><h4>Human decision</h4><p class="note" style="margin-bottom:8px">Recommendations only. A person must approve any ramp placement or service plan. Nothing here is sent to real systems.</p><div class="dr-actions">' + dec + '<a class="btn btn-ghost btn-sm" href="#parking" data-focus="' + a.id + '">Show on ramp map</a></div></div>';
  }

  function openAircraft(a) {
    if (typeof a === 'string') a = aircraftOf(a);
    if (!a) return;
    A.drawer.open({
      title: a.id + ' · ' + a.catName, sub: 'Anonymous synthetic aircraft · ' + D[a.d].dow + ' ' + D[a.d].label + ' · est. arrival ' + eta(a),
      html: aircraftPanelHtml(a), kind: 'aircraft', onClick: function (e) { return panelClick(e, a); }
    });
    UI.selectedAc = a.id;
    document.querySelectorAll('.ac-chip.sel').forEach(function (c) { c.classList.remove('sel'); });
    document.querySelectorAll('.ac-chip[data-aid="' + a.id + '"]').forEach(function (c) { c.classList.add('sel'); });
  }

  function panelClick(e, a) {
    const f = e.target.closest('[data-focus]');
    if (f) { UI.focusAc = f.dataset.focus; return false; }
    const row = e.target.closest('[data-aid]:not([data-act])');
    if (row && !e.target.closest('button[data-act]')) { openAircraft(row.dataset.aid); return true; }
    const b = e.target.closest('button[data-act]'); if (!b) return false;
    const x = aircraftOf(b.dataset.aid) || a, key = A.state.scen + '-' + x.id;
    const ok = b.dataset.act === 'approve';
    decided[key] = ok ? 'Approved by human (demo)' : 'Flagged for review';
    A.logDecision((ok ? 'Approved ramp & service plan for ' : 'Flagged for review: ') + x.id);
    A.toast((ok ? 'Recorded: human approved plan for ' : 'Recorded: flagged ') + x.id + '. Demo only, no systems were changed.', 'ok');
    A.drawer.refresh(aircraftPanelHtml(x));
    return true;
  }
  UI.openAircraft = openAircraft;
  UI.aircraftOf = aircraftOf;
  UI.catBy = catBy; UI.pill = pill; UI.tod = tod; UI.eta = eta; UI.statusInfo = statusInfo; UI.fuelWin = fuelWin; UI.svcWin = svcWin; UI.svcName = svcName;
  UI.panelClick = panelClick;

  /* ====================== hour detail panel ====================== */
  function openHour(d, h) {
    const k = A.state.scen, s = A.sm(k, d), as = A.M().assistant(k, d);
    const list = A.M().dayAircraft(k, d).filter(function (a) { return a.h === h; }).sort(function (x, y) { return x.t - y.t; });
    const n = s.hourlyArr[h], c = Model.confidenceHourly(n, A.SC().ci);
    const cap = as.capCur[h], capR = as.capRec[h];
    const teams = {};
    list.forEach(function (a) { (teams[a.sim.team] = teams[a.sim.team] || []).push(a); });
    const fuelList = list.filter(function (a) { return a.fuel.need; });
    const conf = list.filter(function (a) { return a.conflict; });
    const kv = function (rows) { return '<dl class="kv">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; };
    const html =
      '<div class="dr-sec"><h4>Hour summary</h4>' + kv([['Expected arrivals', n + ' <small>(range ' + c.lo + '–' + c.hi + ')</small>'], ['Confidence', A.confBadge(c)], ['Ground-service capacity', cap + '/hr now · ' + capR + '/hr with recommended staff'], ['Estimated service delay', Math.round(s.delay.hourly[h]) + ' min'], ['Recommended spacing', '≥ ' + as.spacingMin + ' min between arrivals'], ['Average gap this hour', n ? (Math.round(60 / n * 10) / 10) + ' min' : '—']]) +
      (n > cap ? '<p class="note"><b class="neg">Over capacity by ' + (n - cap) + '.</b> Offer flexible arrivals a later window or add ground handlers (human decision).</p>' : '') + '</div>' +
      '<div class="dr-sec"><h4>Aircraft arriving (' + list.length + ')</h4>' + (list.length ? '<table class="tbl tbl-sm"><tbody>' + list.map(function (a) { return '<tr tabindex="0" data-aid="' + a.id + '" class="row-click"><td><b>' + a.id + '</b></td><td>' + eta(a) + '</td><td>' + a.catName + '</td><td><span class="pos' + (a.sim.pos.overflow ? ' pos-ovf' : '') + '">' + a.sim.pos.code + '</span></td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">No arrivals forecast this hour.</p>') + '</div>' +
      '<div class="dr-sec"><h4>Ground-handler assignments</h4>' + (Object.keys(teams).length ? Object.keys(teams).map(function (ti) { const arr = teams[ti]; return '<div class="slot-row"><div class="slot-h"><b>Team G' + (+ti + 1) + '</b><small>2 handlers</small></div><div class="slot-chips">' + arr.map(function (a) { return '<span class="slot" title="' + svcWin(a) + '">' + a.id.replace('AC-', '') + ' · ' + tod(a.sim.svcStart) + '</span>'; }).join('') + '</div></div>'; }).join('') : '<p class="muted">None this hour.</p>') + '</div>' +
      '<div class="dr-sec"><h4>Fuel-service windows</h4>' + (fuelList.length ? '<table class="tbl tbl-sm"><tbody>' + fuelList.map(function (a) { return '<tr tabindex="0" data-aid="' + a.id + '" class="row-click"><td><b>' + a.id + '</b></td><td>' + fuelWin(a) + '</td><td>~' + fmt.int(a.fuel.gal) + ' gal</td><td>' + Sim.truckName(a).split(' ')[0] + ' ' + Sim.truckName(a).split(' ')[1] + '</td></tr>'; }).join('') + '</tbody></table><p class="note">Windows are when these aircraft are expected to be fueled (usually before departure).</p>' : '<p class="muted">No fuel services start from arrivals this hour.</p>') + '</div>' +
      (conf.length ? '<div class="dr-sec"><h4>Conflicts</h4><ul class="conf-list">' + conf.map(function (a) { return '<li><b>' + a.id + '</b> ' + a.warnings.filter(function (w) { return w.level === 'conflict'; }).map(function (w) { return w.text; }).join('; ') + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="callout-adv">' + A.ADVISORY + '</div>';
    A.drawer.open({ title: hourBlockTitle(h), sub: A.dayLabel(d) + ' · ' + A.SC().label + ' demand · planning data only', html: html, kind: 'hour', onClick: function (e) { return panelClick(e, null); } });
  }
  const hourBlockTitle = function (h) { return fmt.hourLong(h) + '–' + fmt.hourLong((h + 1) % 24); };

  /* ====================== page ====================== */
  const sf = { from: 0, to: 24, cat: 'all', svc: 'all', status: 'all', q: '', view: 'blocks', limit: 40, quiet: false };

  function mount() {
    const hourOpts = function (a, b) { let o = ''; for (let h = a; h <= b; h++) o += '<option value="' + h + '">' + (h === 24 ? '12:00 AM (end)' : fmt.hourLong(h)) + '</option>'; return o; };
    $('#body-schedule').innerHTML =
      '<div class="card filters" role="group" aria-label="Schedule filters">' +
      '<label>Aircraft ID<input id="sf-q" type="search" placeholder="e.g. AC-0412" autocomplete="off" maxlength="12"></label>' +
      '<label>From<select id="sf-from">' + hourOpts(0, 23) + '</select></label>' +
      '<label>To<select id="sf-to">' + hourOpts(1, 24) + '</select></label>' +
      '<label>Aircraft type<select id="sf-cat"><option value="all">All types</option>' + CATS.map(function (c) { return '<option value="' + c.key + '">' + c.name + '</option>'; }).join('') + '</select></label>' +
      '<label>Service<select id="sf-svc"><option value="all">Any service</option><option value="fuel">Fuel required</option><option value="nofuel">No fuel</option>' + SERVICES.map(function (s) { return '<option value="' + s.key + '">' + s.name + '</option>'; }).join('') + '</select></label>' +
      '<label>Show<select id="sf-status"><option value="all">All aircraft</option><option value="conflict">Conflicts only</option><option value="warn">Any delay / conflict</option><option value="unassigned">Unassigned service</option></select></label>' +
      '<div class="f-actions"><button type="button" class="btn btn-ghost btn-sm" id="sf-peak">Morning peak</button><button type="button" class="btn btn-ghost btn-sm" id="sf-reset">Reset</button></div></div>' +
      '<div class="tl-summary" id="sf-sum"></div>' +
      '<div class="tl-top"><div class="legend-traffic" id="sf-legend" aria-label="Color legend"></div><div class="seg seg-sm" id="sf-views" role="tablist" aria-label="Schedule view"><button type="button" role="tab" data-v="blocks">Hourly blocks</button><button type="button" role="tab" data-v="timeline">Timeline</button><button type="button" role="tab" data-v="table">Table</button></div></div>' +
      '<div id="sf-view"></div>';
    $('#meta-schedule').innerHTML = A.dataChip('Synthetic · GET /api/v1/arrivals/schedule');
    $('#sf-legend').innerHTML = [['t-low', 'Green · low traffic'], ['t-mod', 'Yellow · moderate'], ['t-high', 'Orange · high traffic'], ['t-red', 'Red · conflict']].map(function (c) { return '<span class="lg"><i class="sw ' + c[0] + '"></i>' + c[1] + '</span>'; }).join('') + '<span class="lg"><i class="sw sw-wait"></i>Hatched · expected wait</span>';
    const bind = function (id, fn, ev) { $(id).addEventListener(ev || 'change', function (e) { fn(e.target.value); }); };
    bind('#sf-q', function (v) { sf.q = v.trim().toUpperCase(); sf.limit = 40; update(true); }, 'input');
    bind('#sf-from', function (v) { sf.from = +v; if (sf.to <= sf.from) sf.to = Math.min(24, sf.from + 1); update(true); });
    bind('#sf-to', function (v) { sf.to = +v; if (sf.from >= sf.to) sf.from = Math.max(0, sf.to - 1); update(true); });
    bind('#sf-cat', function (v) { sf.cat = v; sf.limit = 40; update(true); });
    bind('#sf-svc', function (v) { sf.svc = v; sf.limit = 40; update(true); });
    bind('#sf-status', function (v) { sf.status = v; sf.limit = 40; update(true); });
    $('#sf-peak').addEventListener('click', function () { sf.from = 6; sf.to = 11; update(true); });
    $('#sf-reset').addEventListener('click', function () { sf.from = 0; sf.to = 24; sf.cat = 'all'; sf.svc = 'all'; sf.status = 'all'; sf.q = ''; $('#sf-q').value = ''; sf.limit = 40; update(true); });
    $('#sf-views').addEventListener('click', function (e) { const b = e.target.closest('button[data-v]'); if (b) { sf.view = b.dataset.v; update(false); } });
    const v = $('#sf-view');
    v.addEventListener('click', function (e) {
      if (e.target.id === 'sf-more') { sf.limit += 40; update(true); return; }
      const hb = e.target.closest('[data-hour]');
      const ac = e.target.closest('[data-aid]');
      if (ac) { openAircraft(ac.dataset.aid); return; }
      if (hb) openHour(A.state.date, +hb.dataset.hour);
    });
    v.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target.closest('[data-hour],[data-aid]');
      if (t && t.tagName !== 'BUTTON') { e.preventDefault(); t.click(); }
    });
    v.addEventListener('mouseover', rowTip); v.addEventListener('mousemove', function (e) { if (e.target.closest('.g-row[data-aid]')) rowTip(e); });
    v.addEventListener('mouseleave', Charts.hideTip);
  }

  function filtered() {
    return A.M().dayAircraft(A.state.scen, A.state.date).filter(function (a) {
      if (a.h < sf.from || a.h >= sf.to) return false;
      if (sf.cat !== 'all' && a.cat !== sf.cat) return false;
      if (sf.svc === 'fuel' && !a.fuel.need) return false;
      if (sf.svc === 'nofuel' && a.fuel.need) return false;
      if (sf.svc !== 'all' && sf.svc !== 'fuel' && sf.svc !== 'nofuel' && a.svcs.indexOf(sf.svc) < 0) return false;
      if (sf.status === 'conflict' && !a.conflict) return false;
      if (sf.status === 'warn' && !a.warnings.length) return false;
      if (sf.status === 'unassigned' && a.status !== 'unassigned') return false;
      if (sf.q && a.id.toUpperCase().indexOf(sf.q) < 0) return false;
      return true;
    });
  }

  function tipHtml(a) {
    const st = statusInfo[a.status];
    return '<div class="tt-title">' + a.id + ' · ' + a.catName + '</div><div class="tt-sub">' + UI.longDay(a.d) + '</div>' +
      '<div class="tt-row">Estimated arrival<b>' + eta(a) + '</b></div><div class="tt-row">Ramp position<b>' + a.sim.pos.code + '</b></div>' +
      '<div class="tt-row">Parking duration<b>' + fmt.dur(a.dur) + '</b></div>' +
      '<div class="tt-row">Fuel service<b>' + (a.fuel.need ? fuelWin(a) : 'None') + '</b></div>' +
      '<div class="tt-row">Handler team<b>' + Sim.teamShort(a) + '</b></div><div class="tt-row">Status<b>' + st.t + '</b></div>' +
      (a.warnings.length ? '<div class="tt-foot">' + a.warnings.map(function (w) { return (w.level === 'conflict' ? '⛔ ' : '⚠ ') + w.text; }).join('<br>') + '</div>' : '<div class="tt-foot">No delay or conflict warnings. Click for details.</div>');
  }
  function rowTip(e) {
    const r = e.target.closest('.g-row[data-aid]'); if (!r) return;
    const a = aircraftOf(r.dataset.aid); if (!a) return;
    const rect = r.getBoundingClientRect();
    Charts.showTip(tipHtml(a), e.clientX || rect.left + 120, e.clientY || rect.top + 10);
  }

  const cls = function (a, perHour) { return a.conflict ? 't-red' : A.trafficClass(perHour[a.h]); };

  function chipHtml(a, perHour) {
    const st = stNow(a), c = catBy[a.cat].color;
    const warn = a.warnings.length ? '<span class="ac-w' + (a.conflict ? '' : ' warn') + '">' + (a.conflict ? '⛔ Conflict' : '⚠ ' + a.warnings[0].text.replace(/^Possible /, '')) + '</span>' : '';
    return '<button type="button" class="ac-chip' + (a.conflict ? ' conflict' : '') + (UI.selectedAc === a.id ? ' sel' : '') + '" style="--c:' + c + '" data-aid="' + a.id + '" aria-label="' + a.id + ', ' + a.catName + ', arrives ' + eta(a) + ', ramp ' + a.sim.pos.code + (a.conflict ? ', conflict' : '') + '. Open details.">' +
      '<span class="ac-id">' + a.id + ' <span class="ac-t">' + eta(a) + '</span></span>' +
      '<span class="ac-l">' + a.catName + ' · <b class="pos' + (a.sim.pos.overflow ? ' pos-ovf' : '') + '">' + a.sim.pos.code + '</b></span>' +
      '<span class="ac-l">' + (a.fuel.need ? 'Fuel ' + fuelWin(a).split('–')[0] : 'No fuel') + ' · Team ' + Sim.teamShort(a) + '</span>' +
      '<span class="ac-l">' + pill(st) + '</span>' + warn + '</button>';
  }

  function blocksHtml(rows, perHour) {
    const k = A.state.scen, d = A.state.date, s = A.sm(), as = A.M().assistant(k, d);
    const byH = {};
    rows.forEach(function (a) { (byH[a.h] = byH[a.h] || []).push(a); });
    const hours = Object.keys(byH).map(Number).sort(function (a, b) { return a - b; });
    let i = 0;
    return '<div class="hb-list">' + hours.map(function (h) {
      const list = byH[h].sort(function (a, b) { return a.t - b.t; });
      const n = perHour[h], conf = list.filter(function (a) { return a.conflict; }).length;
      const tc = conf ? 't-red' : A.trafficClass(n);
      const cap = as.capCur[h] || 1, load = n / cap;
      const fuelN = list.filter(function (a) { return a.fuel.need; }).length;
      const teams = {}; list.forEach(function (a) { teams[a.sim.team] = 1; });
      const dly = Math.round(s.delay.hourly[h]);
      let note = '';
      if (n > cap) note = '<div class="hb-note bad"><b>Over capacity by ' + (n - cap) + '.</b> Recommended spacing ≥ ' + as.spacingMin + ' min; offer flexible arrivals a later window or add ground handlers (human decision).</div>';
      else if (n >= 0.85 * cap && n >= 4) note = '<div class="hb-note warn"><b>Tight hour.</b> Hold current slots and keep spacing ≥ ' + as.spacingMin + ' min between arrivals.</div>';
      else if (conf) note = '<div class="hb-note warn">' + conf + ' aircraft with overlapping or unassigned service. See flagged chips.</div>';
      return '<section class="hb' + (h === A.state.hour ? ' now' : '') + '" style="--i:' + (i++) + '" aria-label="' + fmt.hourLong(h) + ' block">' +
        '<div class="hb-time ' + tc + '" role="button" tabindex="0" data-hour="' + h + '" title="Open hour details"><b>' + fmt.hourLong(h) + '</b><span>' + (h === A.state.hour ? 'Operations clock' : 'Arrival block') + '</span><span class="hb-n">' + n + (n === 1 ? ' arrival' : ' arrivals') + '</span></div>' +
        '<div class="hb-body"><div class="hb-meta"><span>Ground capacity <b>' + cap + '/hr</b></span><span>Fuel services <b>' + fuelN + '</b></span><span>Handler teams <b>' + Object.keys(teams).length + '</b></span><span>Est. delay <b>' + dly + ' min</b></span><span class="hb-load">' + A.progress(Math.min(load, 1.2) * 100, 120, load > 1 ? 'red' : load >= 0.85 ? 'orange' : 'green') + '<b>' + Math.round(load * 100) + '%</b></span></div>' +
        '<div class="ac-chips">' + list.map(function (a) { return chipHtml(a, perHour); }).join('') + '</div>' + note + '</div></section>';
    }).join('') + '</div>';
  }

  function ganttHtml(rows, perHour) {
    const d = A.state.date, dayStart = d * 24;
    const hourCells = Array.from({ length: 24 }, function (_, h) { return '<span class="g-h">' + (h % 2 === 0 ? UI.hourShort(h) : '') + '</span>'; }).join('');
    const byHour = new Array(24).fill(0), conf = new Array(24).fill(0);
    rows.forEach(function (a) { byHour[a.h]++; if (a.conflict) conf[a.h]++; });
    const dens = byHour.map(function (n, h) {
      const c = conf[h] >= 2 ? 't-red' : n === 0 ? 't-none' : A.trafficClass(perHour[h]);
      return '<span class="g-d ' + c + '" title="' + fmt.hourLong(h) + ': ' + n + ' arrivals">' + (n || '') + '</span>';
    }).join('');
    const nowPos = (A.state.hour + 0.5) / 24 * 100;
    const body = rows.slice(0, 120).map(function (a) {
      const c = cls(a, perHour), s0 = a.t - dayStart, w0 = Math.max(0.01, Math.min(a.dep, dayStart + 24) - a.t);
      const ss = a.sim.svcStart - dayStart, wait = a.wait / 60;
      const fuelPos = a.fuel.need && Math.floor(a.sim.fuelStart / 24) === d ? a.sim.fuelStart - dayStart : null;
      const pc = function (x) { return (x / 24 * 100).toFixed(3) + '%'; };
      return '<div class="g-row" tabindex="0" data-aid="' + a.id + '" aria-label="' + a.id + ', ' + a.catName + ', arrives ' + eta(a) + (a.conflict ? ', conflict' : '') + '">' +
        '<div class="g-label"><span class="g-id">' + a.id + '</span><span class="g-cat">' + a.catName + ' · ' + a.sim.pos.code + '</span><span class="g-eta">' + eta(a) + '</span></div>' +
        '<div class="g-track"><i class="g-park" style="left:' + pc(s0) + ';width:' + pc(w0) + '"></i>' +
        (wait > 0.02 ? '<i class="g-wait" style="left:' + pc(s0 + 0.13) + ';width:' + pc(wait) + '"></i>' : '') +
        '<i class="g-svc ' + c + '" style="left:' + pc(ss) + ';width:' + pc(a.svcH) + '"></i><i class="g-arr ' + c + '" style="left:' + pc(s0) + '"></i>' +
        (fuelPos !== null ? '<i class="g-fuel" style="left:' + pc(fuelPos) + '"></i>' : '') + '<i class="g-now" style="left:' + nowPos + '%"></i></div></div>';
    }).join('');
    return '<div class="gantt-wrap card" role="region" aria-label="Arrival timeline, scrollable" tabindex="0"><div class="gantt">' +
      '<div class="g-head"><div class="g-label g-corner">Aircraft · type · ramp · ETA</div><div class="g-track g-hours">' + hourCells + '</div></div>' +
      '<div class="g-row g-density-row"><div class="g-label"><span class="g-id">Arrivals / hour</span><span class="g-cat">filtered</span></div><div class="g-track g-density">' + dens + '</div></div>' + body + '</div></div>' +
      '<p class="note">Thick bar = ground-service window; hatched = expected wait; thin line = time on ramp; purple pill = fuel service; red line = operations clock. ' + (rows.length > 120 ? 'Showing the first 120 of ' + rows.length + ' aircraft; narrow the filters to see more. ' : '') + 'Click a row for details. IDs are anonymous.</p>';
  }

  function tableHtml(rows, perHour) {
    const shown = rows.slice(0, sf.limit);
    return '<div class="card table-card"><div class="table-scroll"><table class="tbl"><caption class="sr-only">Anonymized arrival schedule</caption><thead><tr><th>Aircraft ID</th><th>Est. arrival</th><th>Type</th><th>Ramp</th><th>Fuel window</th><th>Handler team</th><th>Status now</th><th>Delay / conflict</th></tr></thead><tbody>' +
      shown.map(function (a) {
        return '<tr data-aid="' + a.id + '" tabindex="0" class="row-click"><td><span class="dot-t ' + cls(a, perHour) + '"></span><b>' + a.id + '</b></td><td>' + eta(a) + '</td><td>' + a.catName + '</td><td><span class="pos' + (a.sim.pos.overflow ? ' pos-ovf' : '') + '">' + a.sim.pos.code + '</span></td>' +
          '<td>' + (a.fuel.need ? fuelWin(a) + '<small> · ' + fmt.int(a.fuel.gal) + ' gal</small>' : '<span class="muted">None</span>') + '</td><td>' + Sim.teamShort(a) + '</td><td>' + pill(stNow(a)) + '</td>' +
          '<td>' + (a.warnings.length ? a.warnings.map(function (w) { return '<span class="w w-' + w.level + '">' + (w.level === 'conflict' ? 'Conflict: ' : 'Warning: ') + w.text + '</span>'; }).join('') : '<span class="muted">None</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (rows.length > shown.length ? '<button type="button" class="btn btn-ghost" id="sf-more">Show more (' + (rows.length - shown.length) + ' remaining)</button>' : '') + '</div>';
  }

  function update(quiet) {
    if (!$('#sf-q')) mount();
    const k = A.state.scen, d = A.state.date, S = A.S(), s = A.sm();
    $('#sf-from').value = sf.from; $('#sf-to').value = sf.to; $('#sf-cat').value = sf.cat; $('#sf-svc').value = sf.svc; $('#sf-status').value = sf.status;
    $('#sf-views').querySelectorAll('button').forEach(function (b) { const on = b.dataset.v === sf.view; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const all = A.M().dayAircraft(k, d), rows = filtered();
    const perHour = Model.daySlice(S.hourlyArr, d);
    const conflicts = rows.filter(function (a) { return a.conflict; }).length;
    const warns = rows.filter(function (a) { return !a.conflict && a.warnings.length; }).length;
    const fuelN = rows.filter(function (a) { return a.fuel.need; }).length;
    const ramp = Sim.rampAt(A.M(), k, UI.nowT());
    $('#sf-sum').innerHTML =
      '<div class="kpi"><span>Aircraft shown</span><b>' + rows.length + '</b><small>of ' + all.length + ' forecast · ' + D[d].dow + ' ' + D[d].label + '</small></div>' +
      '<div class="kpi' + (conflicts ? ' bad' : '') + '"><span>Conflicts</span><b>' + conflicts + '</b><small>overlap / capacity</small></div>' +
      '<div class="kpi"><span>Delay warnings</span><b>' + warns + '</b><small>wait expected</small></div>' +
      '<div class="kpi"><span>Fuel services</span><b>' + fuelN + '</b><small>planned windows</small></div>' +
      '<div class="kpi accent"><span>On the ground at ' + fmt.hourLong(A.state.hour) + '</span><b>' + (ramp.present.length + F.based) + '</b><small>' + ramp.st.servicing + ' servicing · ' + ramp.st.ready + ' ready</small></div>' +
      '<div class="kpi"><span>Peak hour</span><b>' + fmt.hourLong(s.peakHour) + '</b><small>' + s.peakHourN + ' arrivals</small></div>';
    const view = $('#sf-view');
    view.classList.toggle('no-anim', !!quiet);
    if (!rows.length) { view.innerHTML = '<div class="card"><p class="empty">No aircraft match these filters. Try widening the time range or resetting filters.</p></div>'; return; }
    const keepScroll = view.querySelector('.gantt-wrap') ? view.querySelector('.gantt-wrap').scrollTop : 0;
    view.innerHTML = sf.view === 'blocks' ? blocksHtml(rows, perHour) : sf.view === 'timeline' ? ganttHtml(rows, perHour) : tableHtml(rows, perHour);
    if (keepScroll && view.querySelector('.gantt-wrap')) view.querySelector('.gantt-wrap').scrollTop = keepScroll;
  }

  A.register('schedule', function () { update(false); }, { page: 'schedule' });
  A.onHour(function () { if ($('#sf-q')) update(true); });
})();
