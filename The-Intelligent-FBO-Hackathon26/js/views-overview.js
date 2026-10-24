/* Dashboard (executive overview + safety strip) and Arrival Forecast page */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt, CATS = Model.CATS;
  const A = App, $ = A.$;

  const tt = function (title, sub, rows, foot) {
    return '<div class="tt-title">' + title + '</div>' + (sub ? '<div class="tt-sub">' + sub + '</div>' : '') +
      rows.map(function (r) { return '<div class="tt-row' + (r.on ? ' on' : '') + '"><span class="dot" style="background:' + r.c + '"></span>' + r.l + '<b>' + r.v + '</b></div>'; }).join('') +
      (foot ? '<div class="tt-foot">' + foot + '</div>' : '');
  };
  const hourShort = function (h) { return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; };
  const HOUR_LABELS = Array.from({ length: 24 }, function (_, h) { return hourShort(h); });
  const dayTick = function (d) { return D[d].dow + ' ' + D[d].date; };
  const longDay = function (d) { return D[d].dowLong + ', February ' + D[d].date + ', 2027'; };
  const hourRange = function (h) { return fmt.hourLong(h) + '–' + fmt.clock(h + 59 / 60); };
  /* absolute time (hours since Feb 10 00:00) of the simulated operations clock */
  const nowT = function () { return A.state.date * 24 + A.state.hour + 0.5; };
  window.UI = window.UI || {};
  Object.assign(window.UI, { tt: tt, hourShort: hourShort, HOUR_LABELS: HOUR_LABELS, longDay: longDay, hourRange: hourRange, dayTick: dayTick, nowT: nowT });

  /* animated number count-up (real-time-style updates when the scenario / clock changes) */
  const prevVals = {};
  function countUp(el, from, to, fmtFn) {
    const dur = 650, t0 = performance.now();
    const f = fmtFn || function (v) { return Math.round(v); };
    if (from === to || isNaN(from)) { el.textContent = f(to); return; }
    (function step(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ======================= DASHBOARD ======================= */
  const AIRFIELD_SVG = '<svg class="map-bg" viewBox="0 0 640 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
    '<defs><pattern id="mapgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1"/></pattern></defs>' +
    '<rect width="640" height="170" fill="url(#mapgrid)"/>' +
    '<g fill="#3b2a78" stroke="#7b63c9" stroke-width="1"><rect x="120" y="34" width="470" height="12" rx="2"/><rect x="120" y="54" width="470" height="12" rx="2"/><rect x="150" y="108" width="440" height="12" rx="2"/><rect x="150" y="128" width="440" height="12" rx="2"/></g>' +
    '<g stroke="#cdb8ff" stroke-width="1.2" stroke-dasharray="10 8" opacity=".8"><path d="M126 40H584M126 60H584M156 114H584M156 134H584"/></g>' +
    '<g fill="#d7c8f5" font-size="8" font-family="ui-monospace,Menlo,monospace"><text x="100" y="44">6L</text><text x="100" y="64">6R</text><text x="130" y="118">7L</text><text x="130" y="138">7R</text><text x="596" y="44">24R</text><text x="596" y="64">24L</text><text x="596" y="118">25R</text><text x="596" y="138">25L</text></g>' +
    '<g stroke="#7b63c9" stroke-width="3" fill="none" opacity=".8"><path d="M250 66V108M380 66V108M470 66V108"/><path d="M380 87H300V150"/></g>' +
    '<g fill="#4c3a94" stroke="#7b63c9"><rect x="268" y="82" width="80" height="12" rx="3"/><rect x="258" y="154" width="100" height="10" rx="3"/></g>' +
    '<g><rect x="296" y="146" width="62" height="18" rx="4" fill="#a78bfa"/><text x="327" y="158" text-anchor="middle" font-size="9" font-weight="700" fill="#1c0b45" font-family="system-ui,sans-serif">LAXY FBO</text></g>' +
    '<g fill="#fff" opacity=".92"><path d="M520 87l14-3-6-8h3l9 8 7-1a2 2 0 011 4l-7 1-9 8h-3l6-8z" transform="translate(0 -4) scale(.9)"/></g>' +
    '</svg>';

  const GO = { arrivals: 'forecast', ground: 'schedule', parking: 'parking', fuel: 'fuel', staff: 'staffing', demand: 'forecast/scenarios', delay: 'schedule', risk: 'dashboard/alerts' };

  function overviewMount() {
    $('#body-overview').innerHTML =
      '<div class="page-head"><div><h2><span class="ph-ico">' + A.icon('grid', 24) + '</span>Operations Dashboard</h2><p>What to expect, how ready the FBO is, and what to do about it — updated instantly when you change the demand level or date.</p></div><div class="sec-meta" id="meta-ov2"></div></div>' +
      '<div class="day-banner"><div class="db-map">' + AIRFIELD_SVG + '</div><div class="db-clock" aria-live="off"><small>Operations clock</small><b id="ov-clock"></b></div><div class="db-main" id="ov-banner"></div></div>' +
      '<div class="cards8" id="ov-cards"></div>' +
      '<div class="grid g-2-1">' +
      '<article class="card"><div class="card-head"><div><h3>Today at a glance: hourly arrivals &amp; ramp utilization</h3><p class="card-sub" id="ov-flow-sub"></p></div><span id="ov-flow-conf"></span></div><div id="ch-flow"></div><p class="note">Click an hour to move the operations clock. Purple bars = arrivals, light bars = departures, line = ramp utilization (right axis).</p></article>' +
      '<article class="card"><div class="card-head"><div><h3>Active alerts &amp; operational risks</h3><p class="card-sub" id="ov-alert-sub"></p></div><a class="link" href="#dashboard/alerts">Alerts Center →</a></div><div id="ov-alerts" class="alert-mini"></div></article>' +
      '</div>' +
      '<article class="card"><div class="card-head"><div><h3>Ordinary week vs. Super Bowl week</h3><p class="card-sub">Private-aircraft arrivals per day, Feb 10–16, 2027</p></div><span id="ov-cmp-conf"></span></div><div id="ov-cmp-kpis" class="kpi-strip"></div><div id="ch-overview"></div><p class="note">Click a day to make it the planning day. Whiskers show the forecast confidence range. Ordinary-week baseline ≈ ' + Math.round(Model.BASELINE_AVG) + ' arrivals/day (provided forecast).</p></article>';
    $('#meta-ov2').innerHTML = A.dataChip('Synthetic · GET /api/v1/forecast');
    $('#ov-cards').addEventListener('click', cardNav);
    $('#ov-cards').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.sum-card')) { e.preventDefault(); cardNav(e); } });
  }
  function cardNav(e) {
    if (e.target.closest('.seg')) return;
    const c = e.target.closest('.sum-card[data-go]'); if (!c) return;
    const g = c.dataset.go.split('/'); A.go(g[0], g[1]);
  }

  function clockUpdate() { const el = $('#ov-clock'); if (el) el.textContent = D[A.state.date].dow + ' ' + fmt.hourLong(A.state.hour); }

  function cardsUpdate() {
    if (!$('#ov-cards')) return;
    const k = A.state.scen, d = A.state.date, h = A.state.hour, s = A.sm(), T = nowT();
    const dl = s.demandLevel.toLowerCase();
    const pk = s.parking, fu = s.fuel, st = s.staff;
    const ramp = Sim.rampAt(A.M(), k, T);
    const onGround = ramp.present.length + F.based;
    const util = ramp.util, ucls = util > 1 ? 'red' : util >= 0.9 ? 'orange' : util >= 0.75 ? 'yellow' : 'green';
    const alerts = A.activeAlerts();
    const recNow = st.recTot[h], curNow = st.curTot[h], gapNow = recNow - curNow;
    const dlyNow = Math.round(s.delay.hourly[h]), dlyPk = Math.round(s.delay.peak);
    const riskCol = A.riskColor[s.risk.cls];
    const cards = [
      { key: 'arrivals', cls: 'purple', ic: 'plane', t: 'Expected Aircraft Arrivals', n: s.arrivals, u: 'aircraft', sub: 'Range ' + s.ci.lo + '–' + s.ci.hi + ' · ' + (Math.round(s.ratio * 10) / 10) + '× ordinary (' + Math.round(Model.BASELINE_AVG) + '/day) · peak ' + fmt.hourLong(s.peakWin.start) + '–' + fmt.hourLong(s.peakWin.end),
        foot: '<span class="demand demand-' + dl + '">' + s.demandLevel + ' demand</span> ' + A.confBadge(s.ci.conf, true) },
      { key: 'ground', cls: 'purple', ic: 'map', t: 'Aircraft on the Ground', n: onGround, u: 'at ' + fmt.hourLong(h), sub: ramp.present.length + ' visiting + ' + F.based + ' based · servicing ' + ramp.st.servicing + ' · ready ' + ramp.st.ready + ' · waiting ' + ramp.st.arrived,
        foot: A.progress(Math.min(util * 100, 100), 100, ucls) + '<span class="muted">Ramp ' + Math.round(util * 100) + '% occupied</span>' },
      { key: 'parking', cls: ucls === 'orange' ? 'orange' : ucls, ic: 'park', t: 'Parking Spaces Available', n: ramp.available, u: 'of ' + F.transientRoom + ' visitor spots', sub: F.reserved + ' reserved · peak ' + Math.round(pk.peakUtil * 100) + '% at ' + fmt.hourLong(pk.peakHour) + (pk.overflowMax ? ' · overflow +' + pk.overflowMax : ''),
        foot: A.progress(F.transientRoom - ramp.available, F.transientRoom, ucls) + (ramp.overflow ? '<span class="warn-txt">' + ramp.overflow + ' in overflow now</span>' : pk.peakUtil > 0.9 ? '<span class="warn-txt">May exceed 90% at peak</span>' : '<span class="muted">Within capacity</span>') },
      { key: 'fuel', cls: fu.readiness < 70 ? 'red' : fu.readiness < 100 ? 'orange' : 'green', ic: 'fuel', t: 'Fuel Readiness', n: fu.readiness, nfmt: '%', u: 'standing plan', sub: 'Demand ' + fmt.int(fu.demand) + ' gal · lowest reserve ' + fmt.int(fu.minInvStanding) + ' gal',
        foot: A.progress(fu.readiness, 100, fu.readiness < 70 ? 'red' : fu.readiness < 100 ? 'orange' : 'green') + '<span class="muted">With recommended delivery: ' + fu.readinessRec + '%</span>' },
      { key: 'staff', cls: gapNow > 0 ? 'orange' : 'green', ic: 'crew', t: 'Required Staff', n: recNow, u: 'needed at ' + fmt.hourLong(h), sub: curNow + ' rostered now' + (gapNow > 0 ? ' · short ' + gapNow : ' · covered') + ' · peak need ' + st.recPeak + ' (' + st.level.label.split(' - ')[0] + ')',
        foot: A.progress(st.coverage, 100, st.coverage < 90 ? 'orange' : 'green') + '<span class="muted">Day coverage ' + st.coverage + '% of recommended</span>' },
      { key: 'demand', cls: dl === 'low' ? 'green' : dl === 'medium' ? 'yellow' : 'red', ic: 'layers', t: 'Current Demand Level', txt: s.demandLevel, sub: s.arrivals + ' arrivals vs ' + Math.round(Model.BASELINE_AVG) + '/day ordinary · scenario: ' + A.SC().label,
        foot: '<div class="seg seg-sm scen-seg" role="radiogroup" aria-label="Demand level">' + ['low', 'medium', 'high'].map(function (x) { return '<button type="button" role="radio" data-s="' + x + '" class="' + (x === k ? 'on' : '') + '" aria-checked="' + (x === k) + '"><i></i>' + x[0].toUpperCase() + x.slice(1) + '</button>'; }).join('') + '</div>' },
      { key: 'delay', cls: dlyPk >= 20 ? 'red' : dlyPk >= 8 ? 'orange' : 'green', ic: 'clock', t: 'Estimated Service Delays', n: dlyPk, u: 'min at peak', sub: 'Now ' + dlyNow + ' min · average ' + Math.round(s.delay.avg) + ' min · peak hour ' + fmt.hourLong(s.delay.peakHour),
        foot: A.progress(Math.min(dlyPk, 30), 30, dlyPk >= 20 ? 'red' : dlyPk >= 8 ? 'orange' : 'green') + '<span class="muted">With recommended staffing: ~' + Math.round(s.delay.peakPlan) + ' min</span>' },
      { key: 'risk', cls: s.risk.cls === 'low' ? 'green' : s.risk.cls === 'moderate' ? 'yellow' : s.risk.cls === 'high' ? 'orange' : 'red', ic: 'risk', t: 'Operational Risk', txt: s.risk.label, gauge: A.gauge(s.risk.score, riskCol), sub: alerts.length + ' active alert' + (alerts.length === 1 ? '' : 's') + ' · ' + s.conflicts.count + ' scheduling conflict' + (s.conflicts.count === 1 ? '' : 's'),
        foot: '<span class="muted">Score ' + s.risk.score + '/100 (parking, staffing, fuel, delay)</span>' }
    ];
    $('#ov-cards').innerHTML = cards.map(function (c, i) {
      const val = c.txt != null ? '<span class="sc-num">' + c.txt + '</span>' : '<span class="sc-num" data-key="' + c.key + '" data-to="' + c.n + '" data-suf="' + (c.nfmt || '') + '">' + c.n + (c.nfmt || '') + '</span>';
      return '<div class="sum-card sc-' + c.cls + '" role="button" tabindex="0" data-go="' + GO[c.key] + '" style="--i:' + i + '" aria-label="' + c.t + ': ' + (c.txt != null ? c.txt : c.n + (c.nfmt || '') + ' ' + (c.u || '')) + '. Press Enter to open details."><span class="go">' + A.icon('arrow', 18) + '</span><div class="sc-top"><span class="sc-ico">' + A.icon(c.ic, 18) + '</span><h3>' + c.t + '</h3></div>' +
        '<div class="sc-val">' + (c.gauge ? '<div class="sc-gauge">' + c.gauge + '</div>' : '') + val + (c.u ? '<span class="sc-unit">' + c.u + '</span>' : '') + '</div>' +
        '<p class="sc-sub">' + c.sub + '</p><div class="sc-foot">' + c.foot + '</div></div>';
    }).join('');
    $('#ov-cards').querySelectorAll('.sc-num[data-to]').forEach(function (el) {
      const key = el.dataset.key, to = +el.dataset.to, suf = el.dataset.suf, from = prevVals[key] == null ? to : prevVals[key];
      prevVals[key] = to;
      countUp(el, from, to, function (v) { return Math.round(v) + suf; });
    });
    clockUpdate();
  }

  function flowChart(animate) {
    const k = A.state.scen, d = A.state.date, s = A.sm(), S = A.S();
    $('#ov-flow-sub').textContent = A.dayLabel(d) + ' · ' + A.SC().label + ' demand · operations clock ' + fmt.hourLong(A.state.hour);
    $('#ov-flow-conf').innerHTML = A.confBadge(Model.confidenceHourly(s.peakHourN, A.SC().ci));
    const util = s.parking.util.map(function (u) { return Math.round(u * 100); });
    Charts.render($('#ch-flow'), {
      animate: animate, height: 300, x: HOUR_LABELS, labelW: 30, yTitle: 'Aircraft / hour', y2Title: 'Ramp utilization', y2Max: 110, y2Format: function (v) { return v + '%'; }, selected: A.state.hour, ariaLabel: 'Hourly arrivals and ramp utilization for ' + A.dayLabel(d),
      bands: [{ from: 6, to: 11, color: 'rgba(124,58,237,.07)', label: 'Normal peak 6–11 AM' }],
      markers: [{ i: s.peakHour, text: 'Peak ' + fmt.hour(s.peakHour), color: '#dc2626' }],
      series: [
        { name: 'Arrivals', type: 'bar', color: '#7c3aed', data: s.hourlyArr },
        { name: 'Departures', type: 'bar', color: '#c4b5fd', data: s.hourlyDep },
        { name: 'Ramp utilization %', type: 'line', color: '#2b1065', axis: 'y2', width: 2.6, dots: false, data: util, fmt: function (v) { return v + '%'; } }
      ],
      onSelect: function (i) { if (A.state.playing) { /* keep playing */ } A.setHour(i); },
      tooltip: function (i) {
        const c = Model.confidenceHourly(s.hourlyArr[i], A.SC().ci);
        return tt(longDay(d), hourRange(i), [{ c: '#7c3aed', l: 'Arrivals', v: s.hourlyArr[i], on: true }, { c: '#c4b5fd', l: 'Departures', v: s.hourlyDep[i] }, { c: '#2b1065', l: 'Ramp utilization', v: util[i] + '%' }],
          'Confidence range ' + c.lo + '–' + c.hi + ' · ' + c.label + '<br><i>Synthetic estimate</i>');
      }
    });
  }

  function overviewUpdate() {
    if (!$('#ov-cards')) overviewMount();
    const k = A.state.scen, d = A.state.date, s = A.sm(), sc = A.SC();
    const dl = s.demandLevel.toLowerCase();
    $('#ov-banner').innerHTML =
      '<div class="db-eyebrow">Selected planning day &middot; Super Bowl LXI week</div>' +
      '<h3>' + longDay(d) + '</h3>' +
      '<div class="db-tags"><span class="tag">' + D[d].tag + '</span>' +
      '<span class="demand demand-' + dl + '" title="Demand level compared with the ordinary-week baseline of ' + Math.round(Model.BASELINE_AVG) + ' arrivals/day">' + s.demandLevel + ' demand</span>' +
      '<span class="tag tag-scen">Scenario: ' + sc.label + '</span>' + A.confBadge(s.ci.conf) + '</div>' +
      '<p class="db-sub">Private &amp; business aviation only &middot; commercial airline flights excluded &middot; LAXY FBO (fictional) &middot; LAX</p>';
    cardsUpdate();
    flowChart(true);

    // comparison
    const tot = function (key) { return A.M().scen[key].dailyArr.reduce(function (a, b) { return a + b; }, 0); };
    const ordTot = tot('ordinary'), sbTot = tot(k);
    const order = D.map(function (_, i) { return i; }).sort(function (a, b) { return A.S().dailyArr[b] - A.S().dailyArr[a]; });
    const best = order[0];
    $('#ov-cmp-kpis').innerHTML =
      '<div class="kpi"><span>Ordinary week</span><b>' + ordTot + '</b><small>arrivals / 7 days</small></div>' +
      '<div class="kpi accent"><span>Super Bowl week (' + A.SC().label + ')</span><b>' + sbTot + '</b><small>arrivals / 7 days</small></div>' +
      '<div class="kpi"><span>Change</span><b>' + (sbTot >= ordTot ? '+' : '') + Math.round((sbTot / ordTot - 1) * 100) + '%</b><small>vs. ordinary week</small></div>' +
      '<div class="kpi"><span>Busiest day</span><b>' + D[best].dow + ' ' + D[best].date + '</b><small>' + A.S().dailyArr[best] + ' vs ' + A.M().scen.ordinary.dailyArr[best] + ' ordinary</small></div>';
    $('#ov-cmp-conf').innerHTML = A.confBadge(s.ci.conf);
    const ci = function (key) { const a = A.M().scen[key].dailyArr; return { lo: a.map(function (v, i) { return Model.dailyCI(key, i, v).lo; }), hi: a.map(function (v, i) { return Model.dailyCI(key, i, v).hi; }) }; };
    Charts.render($('#ch-overview'), {
      height: 290, x: D.map(function (x) { return dayTick(x.idx); }), labelW: 44, yTitle: 'Arrivals / day', selected: d, ariaLabel: 'Ordinary week versus Super Bowl week daily arrivals',
      series: [
        { name: 'Ordinary week (~' + Math.round(Model.BASELINE_AVG) + '/day)', type: 'bar', color: '#cbbfe6', data: A.M().scen.ordinary.dailyArr },
        { name: 'Super Bowl week – ' + A.SC().label + ' demand', type: 'bar', color: '#7c3aed', data: A.S().dailyArr, ci: ci(k), labels: true }
      ],
      onSelect: A.setDate,
      tooltip: function (i) {
        const o = A.M().scen.ordinary.dailyArr[i], v = A.S().dailyArr[i], c = Model.dailyCI(k, i, v);
        return tt(longDay(i), D[i].tag, [{ c: '#cbbfe6', l: 'Ordinary week', v: o }, { c: '#7c3aed', l: A.SC().label + ' scenario', v: v, on: true }],
          'Confidence range ' + c.lo + '–' + c.hi + ' · ' + c.conf.label + '<br>' + (v - o >= 0 ? '+' : '') + (v - o) + ' vs ordinary (' + Math.round((v / o - 1) * 100) + '%)<br><i>Synthetic estimate</i>');
      }
    });

    // alerts
    const all = A.M().alerts(k, d), act = A.activeAlerts(), top = act.slice(0, 4);
    $('#ov-alert-sub').textContent = act.length + ' unacknowledged · ' + all.length + ' total for ' + A.dayLabel(d);
    $('#ov-alerts').innerHTML = top.length ? top.map(function (a, i) {
      return '<a class="am am-' + a.sev + '" href="#dashboard/alerts" style="--i:' + i + '">' + A.sevBadge(a.sev) + '<span class="am-t">' + a.title + '</span><span class="am-m">' + a.time + ' · ' + a.resource + '</span></a>';
    }).join('') : '<p class="empty">No active alerts. Operations within normal planning limits.</p>';
  }

  /* ======================= SAFETY STRIP ======================= */
  function safetyUpdate() {
    if ($('#body-safety').dataset.done) return;
    $('#body-safety').dataset.done = '1';
    const P = [
      ['database', 'Synthetic or backend-generated data', 'Aircraft data on this site is synthetic or comes from the forecasting backend. LAXY FBO is a fictional operator.'],
      ['chart', 'Forecasts are estimates', 'Predictions may be uncertain. Every forecast carries a range and a High / Moderate / Low confidence level.'],
      ['lock', 'Passenger privacy is protected', 'No passenger names or personal data. Aircraft appear only with anonymous IDs.'],
      ['user', 'Humans review every recommendation', 'Operators must review and approve recommendations before anything is acted on.'],
      ['warn', 'No movement authority', 'The tool does not authorize takeoffs, landings, taxiing, runway assignments or any aircraft movement.'],
      ['eye', 'ATC and airport personnel in command', 'Air traffic control, airport authorities and certified personnel remain responsible at all times.']
    ];
    $('#body-safety').innerHTML = '<div class="advisory" role="note">' + A.icon('shield', 22) + '<div><b>Planning support only.</b> ' + A.ADVISORY + '</div></div>' +
      '<div class="safety-strip">' + P.map(function (p) { return '<div class="ss-item">' + A.icon(p[0] === 'database' ? 'layers' : p[0], 20) + '<div><b>' + p[1] + '</b>' + p[2] + '</div></div>'; }).join('') + '</div>' +
      '<p class="note"><a class="link" href="#reports/responsible">Read the full Responsible AI statement →</a></p>';
    $('#meta-safety').innerHTML = '<span class="chip chip-data">' + A.icon('info', 14) + 'Demonstration only</span>';
  }

  /* ======================= 2. FORECAST ======================= */
  const fc = { mode: 'daily', scope: 'week' };

  function forecastMount() {
    $('#body-forecast').innerHTML =
      '<div class="toolbar"><div class="seg" id="fc-modes" role="tablist" aria-label="Forecast view">' +
      '<button type="button" role="tab" data-mode="daily">Daily arrivals</button><button type="button" role="tab" data-mode="hourly">Hourly arrivals</button>' +
      '<button type="button" role="tab" data-mode="category">By aircraft category</button><button type="button" role="tab" data-mode="flow">Arrivals &amp; departures</button></div>' +
      '<div class="seg seg-sm" id="fc-scope" role="radiogroup" aria-label="Chart scope"><button type="button" role="radio" data-scope="week">Whole week</button><button type="button" role="radio" data-scope="day">Selected day (hourly)</button></div></div>' +
      '<div class="chips" id="fc-insights"></div>' +
      '<article class="card"><div class="card-head"><div><h3 id="fc-title"></h3><p class="card-sub" id="fc-sub"></p></div><span id="fc-conf"></span></div><div id="ch-forecast"></div><p class="note" id="fc-note"></p></article>';
    $('#meta-forecast').innerHTML = A.dataChip('Synthetic · GET /api/v1/forecast');
    $('#fc-modes').addEventListener('click', function (e) { const b = e.target.closest('button[data-mode]'); if (b) { fc.mode = b.dataset.mode; forecastUpdate(); } });
    $('#fc-scope').addEventListener('click', function (e) { const b = e.target.closest('button[data-scope]'); if (b) { fc.scope = b.dataset.scope; forecastUpdate(); } });
  }

  function catHourly(k, d) {
    const out = {};
    CATS.forEach(function (c) { out[c.key] = new Array(24).fill(0); });
    A.M().dayAircraft(k, d).forEach(function (a) { out[a.cat][a.h]++; });
    return out;
  }

  function forecastUpdate() {
    if (!$('#fc-modes')) forecastMount();
    const k = A.state.scen, d = A.state.date, M = A.M(), sc = A.SC(), s = A.sm();
    $('#fc-modes').querySelectorAll('button').forEach(function (b) { const on = b.dataset.mode === fc.mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    const scopeOn = fc.mode === 'category' || fc.mode === 'flow';
    $('#fc-scope').hidden = !scopeOn;
    $('#fc-scope').querySelectorAll('button').forEach(function (b) { const on = b.dataset.scope === fc.scope; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });

    // insights: busiest days + peak hours
    const order = D.map(function (_, i) { return i; }).sort(function (a, b) { return A.S().dailyArr[b] - A.S().dailyArr[a]; });
    const top3 = order.slice(0, 3);
    const peakInfo = top3.map(function (i) { const x = A.sm(k, i); return D[i].dow + ' ' + fmt.hourLong(x.peakWin.start).replace(':00', '') + '–' + fmt.hourLong(x.peakWin.end).replace(':00', ''); }).join(' · ');
    $('#fc-insights').innerHTML =
      '<span class="chip chip-hot">' + A.icon('chart', 14) + 'Busiest days: ' + top3.map(function (i, r) { return '#' + (r + 1) + ' ' + D[i].dow + ' ' + D[i].label + ' (' + A.S().dailyArr[i] + ')'; }).join(' · ') + '</span>' +
      '<span class="chip">' + A.icon('clock', 14) + 'Expected peak hours: ' + peakInfo + '</span>' +
      '<span class="chip">Scenario: <b>' + sc.label + '</b></span>';

    const root = $('#ch-forecast');
    const flag = { low: '#1a9a5b', medium: '#d99a00', high: '#dc2626' };
    const arr = function (key) { return M.scen[key].dailyArr; };
    const ciD = function (key) { return { lo: D.map(function (_, i) { return Model.dailyCI(key, i, arr(key)[i]).lo; }), hi: D.map(function (_, i) { return Model.dailyCI(key, i, arr(key)[i]).hi; }) }; };
    const hr = function (key) { return Model.daySlice(M.scen[key].hourlyArr, d); };
    const ciH = function (key) { const a = hr(key); return { lo: a.map(function (v) { return Model.confidenceHourly(v, Model.SCEN[key].ci).lo; }), hi: a.map(function (v) { return Model.confidenceHourly(v, Model.SCEN[key].ci).hi; }) }; };

    if (fc.mode === 'daily') {
      $('#fc-title').textContent = 'Daily private-aircraft arrivals – ordinary week vs. three demand scenarios';
      $('#fc-sub').textContent = 'Feb 10–16, 2027 · bars = scenario forecasts (' + sc.label + ' shown with confidence whiskers), dashed line = ordinary-week baseline';
      $('#fc-conf').innerHTML = A.confBadge(s.ci.conf);
      Charts.render(root, {
        height: 360, x: D.map(function (x) { return dayTick(x.idx); }), labelW: 44, yTitle: 'Arrivals / day', selected: d, highlight: top3, ariaLabel: 'Daily arrivals by scenario',
        markers: top3.map(function (i, r) { return { i: i, text: '#' + (r + 1), color: r === 0 ? '#dc2626' : '#f59e0b' }; }),
        series: [
          { name: 'Low demand', type: 'bar', color: flag.low, data: arr('low'), opacity: k === 'low' ? 1 : 0.5, ci: k === 'low' ? ciD('low') : null },
          { name: 'Medium demand', type: 'bar', color: flag.medium, data: arr('medium'), opacity: k === 'medium' ? 1 : 0.5, ci: k === 'medium' ? ciD('medium') : null },
          { name: 'High demand', type: 'bar', color: flag.high, data: arr('high'), opacity: k === 'high' ? 1 : 0.5, ci: k === 'high' ? ciD('high') : null },
          { name: 'Ordinary week (~' + Math.round(Model.BASELINE_AVG) + '/day)', type: 'line', color: '#4a5d78', dash: '6 4', data: arr('ordinary'), dots: true }
        ],
        onSelect: A.setDate,
        tooltip: function (i) {
          const c = Model.dailyCI(k, i, arr(k)[i]);
          return tt(longDay(i), 'All day · 12:00 AM–11:59 PM · ' + D[i].tag, [
            { c: flag.high, l: 'High demand', v: arr('high')[i], on: k === 'high' }, { c: flag.medium, l: 'Medium demand', v: arr('medium')[i], on: k === 'medium' },
            { c: flag.low, l: 'Low demand', v: arr('low')[i], on: k === 'low' }, { c: '#4a5d78', l: 'Ordinary week', v: arr('ordinary')[i] }],
            'Predicted aircraft (' + sc.label + '): <b>' + arr(k)[i] + '</b><br>Confidence range ' + c.lo + '–' + c.hi + ' · ' + c.conf.label + '<br>Peak hour ' + fmt.hourLong(A.sm(k, i).peakHour) + '<br><i>Synthetic estimate</i>');
        }
      });
      $('#fc-note').textContent = '#1–#3 mark the busiest days for the selected scenario. Click a bar to change the planning day. Highest demand is expected Friday through Sunday (Feb 12–14).';
    } else if (fc.mode === 'hourly') {
      $('#fc-title').textContent = 'Hourly arrivals – ' + A.dayLabel(d);
      $('#fc-sub').textContent = 'Lines compare scenarios; shaded band = ' + sc.label + ' confidence range; orange zone = normal peak period 6:00–11:00 AM';
      $('#fc-conf').innerHTML = A.confBadge(Model.confidenceHourly(s.peakHourN, sc.ci));
      Charts.render(root, {
        height: 360, x: HOUR_LABELS, labelW: 30, yTitle: 'Arrivals / hour', ariaLabel: 'Hourly arrivals by scenario for ' + A.dayLabel(d),
        bands: [{ from: 6, to: 11, color: 'rgba(124,58,237,.09)', label: 'Normal peak 6–11 AM' }],
        markers: [{ i: s.peakHour, text: 'Peak ' + fmt.hour(s.peakHour), color: '#d9342b' }],
        series: [
          { name: 'Ordinary week', type: 'line', color: '#4a5d78', dash: '6 4', data: hr('ordinary'), dots: false, width: 2 },
          { name: 'Low demand', type: 'line', color: flag.low, data: hr('low'), dots: false, ci: k === 'low' ? ciH('low') : null },
          { name: 'Medium demand', type: 'line', color: flag.medium, data: hr('medium'), dots: false, ci: k === 'medium' ? ciH('medium') : null },
          { name: 'High demand', type: 'line', color: flag.high, data: hr('high'), dots: false, ci: k === 'high' ? ciH('high') : null }
        ],
        tooltip: function (i) {
          const c = Model.confidenceHourly(hr(k)[i], sc.ci);
          return tt(longDay(d), hourRange(i), [
            { c: flag.high, l: 'High demand', v: hr('high')[i], on: k === 'high' }, { c: flag.medium, l: 'Medium demand', v: hr('medium')[i], on: k === 'medium' },
            { c: flag.low, l: 'Low demand', v: hr('low')[i], on: k === 'low' }, { c: '#4a5d78', l: 'Ordinary week', v: hr('ordinary')[i] }],
            'Predicted aircraft (' + sc.label + '): <b>' + hr(k)[i] + '</b><br>Confidence range ' + c.lo + '–' + c.hi + ' · ' + c.label + '<br><i>Synthetic estimate</i>');
        }
      });
      $('#fc-note').textContent = 'Expected peak hours for ' + A.dayLabel(d) + ': ' + fmt.hourLong(s.peakWin.start) + '–' + fmt.hourLong(s.peakWin.end) + ' (' + s.peakWin.count + ' of ' + s.arrivals + ' arrivals). Hourly forecasts carry wider uncertainty than daily totals.';
    } else if (fc.mode === 'category') {
      const wk = fc.scope === 'week';
      $('#fc-title').textContent = 'Arrivals by aircraft category – ' + (wk ? 'whole week' : A.dayLabel(d) + ' (hourly)');
      $('#fc-sub').textContent = sc.label + ' demand scenario · stacked by category (large-cabin and ultra-long-range mix rises on Fri–Sun)';
      $('#fc-conf').innerHTML = A.confBadge(s.ci.conf);
      const ch = catHourly(k, d);
      Charts.render(root, {
        height: 360, x: wk ? D.map(function (x) { return dayTick(x.idx); }) : HOUR_LABELS, labelW: wk ? 44 : 30, yTitle: wk ? 'Arrivals / day' : 'Arrivals / hour', selected: wk ? d : -1, ariaLabel: 'Arrivals by aircraft category',
        series: CATS.map(function (c) { return { name: c.name, type: 'bar', stack: 's', color: c.color, data: wk ? M.scen[k].catDaily[c.key] : ch[c.key] }; }),
        onSelect: wk ? A.setDate : null,
        tooltip: function (i) {
          const tot = wk ? arr(k)[i] : hr(k)[i];
          const cc = wk ? Model.dailyCI(k, i, tot) : Model.confidenceHourly(tot, sc.ci);
          return tt(wk ? longDay(i) : longDay(d), wk ? 'All day' : hourRange(i), CATS.map(function (c) { return { c: c.color, l: c.name, v: wk ? M.scen[k].catDaily[c.key][i] : ch[c.key][i] }; }),
            'Total predicted aircraft: <b>' + tot + '</b> (' + sc.label + ')<br>Confidence range ' + cc.lo + '–' + cc.hi + (cc.conf ? ' · ' + cc.conf.label : ' · ' + cc.label) + '<br><i>Synthetic estimate</i>');
        }
      });
      $('#fc-note').textContent = 'Category mix is a synthetic assumption: light jets 22%, midsize 27%, large-cabin 28%, ultra-long-range 10%, turboprop 7%, helicopter 6% (large-cabin/ULR boosted ×1.25 Fri–Sun).';
    } else {
      const wk = fc.scope === 'week';
      $('#fc-title').textContent = 'Arrival and departure volume – ' + (wk ? 'whole week' : A.dayLabel(d) + ' (hourly)');
      $('#fc-sub').textContent = sc.label + ' demand scenario · departures follow modeled stay durations (many event guests leave Sunday night / Monday)';
      $('#fc-conf').innerHTML = A.confBadge(s.ci.conf);
      const S_ = M.scen[k];
      const arrS = wk ? S_.dailyArr : Model.daySlice(S_.hourlyArr, d), depS = wk ? S_.dailyDep : Model.daySlice(S_.hourlyDep, d);
      const onS = wk ? D.map(function (_, i) { return S_.occ[i * 24 + 23]; }) : Model.daySlice(S_.occ, d);
      Charts.render(root, {
        height: 360, x: wk ? D.map(function (x) { return dayTick(x.idx); }) : HOUR_LABELS, labelW: wk ? 44 : 30, yTitle: wk ? 'Aircraft / day' : 'Aircraft / hour', selected: wk ? d : -1, ariaLabel: 'Arrival and departure volume',
        series: [
          { name: 'Arrivals', type: 'bar', color: '#7c3aed', data: arrS },
          { name: 'Departures', type: 'bar', color: '#c4b5fd', data: depS },
          { name: wk ? 'Ramp positions in use (11 PM)' : 'Ramp positions in use', type: 'line', color: '#2b1065', width: 2.4, data: onS, dots: wk }
        ],
        onSelect: wk ? A.setDate : null,
        tooltip: function (i) {
          const c = wk ? Model.dailyCI(k, i, arrS[i]) : Model.confidenceHourly(arrS[i], sc.ci);
          return tt(wk ? longDay(i) : longDay(d), wk ? 'All day' : hourRange(i), [
            { c: '#7c3aed', l: 'Arrivals', v: arrS[i] }, { c: '#c4b5fd', l: 'Departures', v: depS[i] }, { c: '#2b1065', l: 'Ramp positions in use', v: Math.round(onS[i]) }],
            sc.label + ' scenario · arrival range ' + c.lo + '–' + c.hi + ' · ' + (c.conf ? c.conf.label : c.label) + '<br><i>Synthetic estimate</i>');
        }
      });
      $('#fc-note').textContent = 'Departure surge is expected Sunday evening after the game and Monday morning (Feb 15), when fuel, ramp and crew-transport demand peak again.';
    }
  }

  A.register('overview', overviewUpdate, { page: 'dashboard' });
  A.register('safety', safetyUpdate, { page: 'dashboard' });
  A.register('forecast', forecastUpdate, { page: 'forecast' });
  /* operations-clock changes only refresh the time-dependent parts of the dashboard */
  A.onHour(function () { cardsUpdate(); if ($('#ch-flow')) flowChart(false); });
})();
