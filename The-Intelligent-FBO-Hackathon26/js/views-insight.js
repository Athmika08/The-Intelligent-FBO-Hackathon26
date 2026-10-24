/* Alerts Center, Reports (exports), Forecast Accuracy & Impact, Responsible AI */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt;
  const A = App, $ = A.$, UI = window.UI;

  /* ============================ ALERTS CENTER ============================ */
  const al = { sev: 'all' };
  function alertCards(list, compact) {
    if (!list.length) return '<p class="empty">No alerts at this severity for the selected day and scenario.</p>';
    return list.map(function (a, i) {
      const ack = A.state.ack[a.id];
      const urgent = !ack && (a.sev === 'critical' || a.sev === 'high');
      return '<article class="alert-card al-' + a.sev + (ack ? ' acked' : '') + (urgent && a.sev === 'critical' ? ' al-pulse' : '') + '" style="--i:' + i + '"><div class="al-head">' + A.sevBadge(a.sev) + '<h4>' + a.title + '</h4>' + (ack ? '<span class="approved">' + A.icon('check', 14) + (ack === 'assigned' ? 'Assigned to supervisor' : 'Acknowledged') + '</span>' : '') + '</div>' +
        '<dl class="al-meta"><div><dt>Severity</dt><dd>' + A.sevLabel[a.sev] + '</dd></div><div><dt>Time</dt><dd>' + a.time + '</dd></div><div><dt>Affected resource</dt><dd>' + a.resource + '</dd></div></dl>' +
        '<p class="al-action"><b>Recommended human action:</b> ' + a.action + '</p>' +
        (ack ? '' : '<div class="al-btns"><button type="button" class="btn btn-sm btn-primary" data-act="ack" data-id="' + a.id + '">Acknowledge</button><button type="button" class="btn btn-sm btn-ghost" data-act="assign" data-id="' + a.id + '">Assign to supervisor</button>' + (a.link && !compact ? '' : '') + '</div>') + '</article>';
    }).join('');
  }
  function alertClick(e) {
    const b = e.target.closest('button[data-act]'); if (!b) return false;
    const id = b.dataset.id, a = A.M().alerts(A.state.scen, A.state.date).filter(function (x) { return x.id === id; })[0];
    if (!a) return false;
    if (b.dataset.act === 'ack') {
      A.state.ack[id] = true; A.logDecision('Acknowledged alert: ' + a.title);
      A.toast('Alert acknowledged (demo). Take the recommended human action.', 'ok');
    } else {
      A.state.ack[id] = 'assigned'; A.logDecision('Assigned alert to shift supervisor: ' + a.title);
      A.toast('Assigned to shift supervisor (demo only).', 'ok');
    }
    A.updateAll();
    return true;
  }
  Object.assign(UI, { alertCards: alertCards, alertClick: alertClick });

  function alertsMount() {
    $('#body-alerts').innerHTML = '<div class="toolbar"><div class="chips" id="al-filters" role="group" aria-label="Filter alerts by severity"></div></div><div id="al-list" class="al-list"></div>';
    $('#meta-alerts').innerHTML = A.dataChip('Synthetic · GET /api/v1/alerts');
    $('#al-filters').addEventListener('click', function (e) { const b = e.target.closest('button[data-sev]'); if (b) { al.sev = b.dataset.sev; alertsUpdate(); } });
    $('#al-list').addEventListener('click', alertClick);
  }
  function alertsUpdate() {
    if (!$('#al-list')) alertsMount();
    const k = A.state.scen, d = A.state.date;
    const all = A.M().alerts(k, d);
    const counts = { all: all.length, critical: 0, high: 0, warning: 0, info: 0 };
    all.forEach(function (a) { counts[a.sev]++; });
    $('#al-filters').innerHTML = ['all', 'critical', 'high', 'warning', 'info'].map(function (s) {
      return '<button type="button" class="chip chip-btn sevf sevf-' + s + (al.sev === s ? ' on' : '') + '" data-sev="' + s + '" aria-pressed="' + (al.sev === s) + '">' + (s === 'all' ? 'All' : A.sevLabel[s]) + ' <b>' + counts[s] + '</b></button>';
    }).join('') + '<span class="chip">' + A.dayLabel(d) + ' · ' + A.SC().label + ' scenario</span>';
    $('#al-list').innerHTML = alertCards(all.filter(function (a) { return al.sev === 'all' || a.sev === al.sev; }), false);
  }

  /* ============================ REPORTS / EXPORTS ============================ */
  function reportsUpdate() {
    if (!$('#rp-grid')) {
      $('#body-reports').innerHTML = '<div class="export-grid" id="rp-grid"></div>';
      $('#meta-reports').innerHTML = A.dataChip('Synthetic · exports generated in the browser');
      $('#rp-grid').addEventListener('click', function (e) {
        const b = e.target.closest('button[data-x]'); if (!b) return;
        if (b.dataset.x === 'csv') A.exportSchedule(); else if (b.dataset.x === 'plan') A.exportPlan(); else window.print();
      });
    }
    const s = A.sm(), cards = [
      ['csv', 'file', 'Schedule CSV', 'Anonymized arrivals for ' + A.dayLabel(A.state.date) + ' with parking position, handler team, fuel need and advisory runway estimate (' + s.arrivals + ' rows).', 'Download CSV'],
      ['plan', 'clipboard', 'Operations plan (text)', 'One-page summary: demand, parking, fuel, staffing, delays, risks and recommended actions. Marked planning support only.', 'Download plan'],
      ['print', 'download', 'Print / save as PDF', 'Print-friendly layout of the current page (use the browser’s “Save as PDF”).', 'Print this page']
    ];
    $('#rp-grid').innerHTML = cards.map(function (c, i) {
      return '<article class="card export-card" style="--i:' + i + '"><span class="ec-ico">' + A.icon(c[1] === 'clipboard' ? 'file' : c[1], 22) + '</span><h3>' + c[2] + '</h3><p>' + c[3] + '</p><button type="button" class="btn btn-primary" data-x="' + c[0] + '">' + A.icon('download', 16) + c[4] + '</button></article>';
    }).join('');
  }

  /* ============================ IMPACT ============================ */
  function impactMount() {
    $('#body-impact').innerHTML =
      '<div class="callout callout-info">' + A.icon('info', 20) + '<div><b>Synthetic evaluation.</b> Because Feb 10–16, 2027 has not happened yet, “actual” arrivals below are <b>synthetic replay values</b> generated within each forecast’s uncertainty range. “Without tool” means the current roster, unmanaged arrival bunching and no overflow plan; “with tool” assumes humans approve the recommendations. Assumptions are listed below.</div></div>' +
      '<div class="cards6 cards-impact" id="im-cards"></div>' +
      '<div class="grid g-2"><article class="card"><div class="card-head"><div><h3>Forecasted vs. actual arrivals</h3><p class="card-sub" id="im-sub"></p></div><span class="chip chip-data">' + A.icon('info', 14) + 'Synthetic replay actuals</span></div><div id="ch-impact"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Without tool vs. with tool</h3><p class="card-sub" id="im-sub2"></p></div></div><div id="im-ba"></div></article></div>' +
      '<article class="card"><div class="card-head"><div><h3>Data sources &amp; assumptions</h3><p class="card-sub">Everything on this dashboard is synthetic or backend-generated placeholder data</p></div></div><div class="table-scroll" id="im-src"></div></article>';
    $('#meta-impact').innerHTML = A.dataChip('Synthetic · GET /api/v1/analytics/accuracy');
  }
  function pair(label, a, b, unit, better, fmtv) {
    const mx = Math.max(a, b, 0.0001), f = fmtv || function (v) { return Math.round(v * 10) / 10; };
    return '<div class="ba"><div class="ba-lab"><b>' + label + '</b></div>' +
      '<div class="ba-row"><span>Without tool</span>' + A.progress(a / mx * 100, 100, 'grey') + '<em>' + f(a) + unit + '</em></div>' +
      '<div class="ba-row"><span>With tool</span>' + A.progress(b / mx * 100, 100, 'green') + '<em>' + f(b) + unit + '</em></div></div>';
  }
  function impactUpdate() {
    if (!$('#im-cards')) impactMount();
    const k = A.state.scen, im = A.M().impact(k), sc = A.SC();
    const cards = [
      { c: im.mape <= 8 ? 'green' : 'orange', ic: 'chart', t: 'Forecast error', v: (Math.round(im.mape * 10) / 10) + '%', sub: 'Mean absolute % error over 7 days (' + sc.label + ' scenario, synthetic)' },
      { c: 'green', ic: 'crew', t: 'Staffing coverage', v: '+' + (Math.round((im.covAfter - im.covBefore) * 10) / 10) + ' pts', sub: Math.round(im.covBefore) + '% → ' + Math.round(im.covAfter) + '% of recommended staff-hours covered' },
      { c: 'green', ic: 'clock', t: 'Service delays', v: '−' + Math.round((1 - im.dAfter / Math.max(im.dBefore, 0.01)) * 100) + '%', sub: 'Avg. wait ' + (Math.round(im.dBefore * 10) / 10) + ' → ' + (Math.round(im.dAfter * 10) / 10) + ' min per aircraft' },
      { c: 'green', ic: 'park', t: 'Parking capacity', v: '−' + Math.round((1 - im.overAfter / Math.max(im.overBefore, 1)) * 100) + '%', sub: 'Overflow position-hours ' + Math.round(im.overBefore) + ' → ' + Math.round(im.overAfter) + ' · peak ' + Math.round(im.peakBefore * 100) + '% → ' + Math.round(im.peakAfter * 100) + '%' },
      { c: im.fuelOkR >= 99 ? 'green' : 'orange', ic: 'fuel', t: 'Fuel readiness', v: Math.round(im.fuelOkR) + '%', sub: 'Hours above safety reserve (was ' + Math.round(im.fuelOkS) + '% with standing deliveries only)' },
      { c: 'green', ic: 'shield', t: 'Conflicts avoided', v: im.avoided, sub: 'of ' + im.confBefore + ' scheduling / capacity conflicts (' + im.total + ' aircraft this week)' }
    ];
    $('#im-cards').innerHTML = cards.map(function (c) {
      return '<article class="sum-card sc-' + c.c + '"><div class="sc-top"><span class="sc-ico">' + A.icon(c.ic, 18) + '</span><h3>' + c.t + '</h3></div><div class="sc-val"><span class="sc-num">' + c.v + '</span></div><p class="sc-sub">' + c.sub + '</p></article>';
    }).join('');
    $('#im-sub').textContent = sc.label + ' scenario · bars = forecast vs. synthetic actual · line = absolute error %';
    Charts.render($('#ch-impact'), {
      height: 320, x: D.map(function (x) { return UI.dayTick(x.idx); }), labelW: 44, yTitle: 'Arrivals / day', y2Title: 'Forecast error %', y2Max: 20, y2Format: function (v) { return v + '%'; }, ariaLabel: 'Forecast versus actual arrivals', selected: A.state.date,
      series: [
        { name: 'Forecast', type: 'bar', color: '#7c3aed', data: im.forecast },
        { name: 'Actual (synthetic replay)', type: 'bar', color: '#2b1065', data: im.actual },
        { name: 'Forecast error %', type: 'line', color: '#d946ef', axis: 'y2', width: 2.4, data: im.errPct, fmt: function (v) { return v + '%'; } }
      ],
      onSelect: A.setDate,
      tooltip: function (i) {
        const c = Model.dailyCI(k, i, im.forecast[i]);
        return UI.tt(UI.longDay(i), 'Forecast vs. synthetic actual', [{ c: '#7c3aed', l: 'Forecast', v: im.forecast[i] }, { c: '#2b1065', l: 'Actual (synthetic)', v: im.actual[i] }, { c: '#d946ef', l: 'Absolute error', v: im.errPct[i] + '%' }],
          'Forecast range ' + c.lo + '–' + c.hi + ' · actual ' + (im.actual[i] >= c.lo && im.actual[i] <= c.hi ? 'inside' : 'outside') + ' range');
      }
    });
    $('#im-sub2').textContent = 'Week totals · ' + sc.label + ' scenario · assumes recommendations approved by humans';
    $('#im-ba').innerHTML =
      pair('Crew coverage of recommended staff-hours', im.covBefore, im.covAfter, '%') +
      pair('Average service wait per aircraft', im.dBefore, im.dAfter, ' min') +
      pair('Overflow position-hours (ramp over capacity)', im.overBefore, im.overAfter, '', null, function (v) { return Math.round(v); }) +
      pair('Hours with fuel above safety reserve', im.fuelOkS, im.fuelOkR, '%') +
      pair('Aircraft with scheduling / capacity conflicts', im.confBefore, im.confAfter, '', null, function (v) { return Math.round(v); });
    const rows = [
      ['Arrival forecast', 'Provided forecast data (2-hour intervals)', 'Baseline ≈ ' + Math.round(Model.BASELINE_AVG) + ' private arrivals/day (170 per week); weekly totals low 197, medium 226, high 254; busiest day Friday, Feb 12 (high: 55).'],
      ['“Actual” arrivals', 'Synthetic replay', 'Forecast × (1 ± random error up to 80% of the confidence range). Replace with real FBO logs when available.'],
      ['Staffing roster & workload', 'Synthetic roster template', 'Workload per arrival/departure by role (e.g. ground handlers 1.35 / 0.45 person-hours); recommended = workload × 1.1, minimum = × 0.8.'],
      ['Service delay', 'Synthetic queue simulation', 'Ground-service teams of 2 handlers; ~25–70 min service by aircraft type; fuel trucks limited by fuel-service staff.'],
      ['Parking', 'Synthetic ramp model', F.positions + ' positions (' + F.reserved + ' reserved, ' + F.based + ' based); stay types: drop-and-go, same-day, overnight, event stay (to after the game).'],
      ['Fuel', 'Synthetic inventory model', Math.round(F.fuelAttach * 100) + '% of aircraft fuel; average uplift by category; ' + F.tank.toLocaleString() + ' gal tank, ' + F.safety.toLocaleString() + ' gal safety threshold.'],
      ['Weather / runway constraints', 'Synthetic placeholder', 'Illustrative winds, ceilings and closures; not real METAR/NOTAM data.'],
      ['“With tool” results', 'Assumption', '90% adoption of staffing recommendations; 35% of overnight / same-day stays moved to other windows; all recommendations approved by humans.']
    ];
    $('#im-src').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>Item</th><th>Source type</th><th>Assumption</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td><b>' + r[0] + '</b></td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  /* ============================ RESPONSIBLE AI ============================ */
  function respMount() {
    const P = [
      ['shield', 'Planning support only', 'The system supports planning and does not replace airport safety procedures.'],
      ['chart', 'Estimates, not facts', 'AI predictions are estimates and include uncertainty. Every forecast shows a range and a confidence level.'],
      ['lock', 'Privacy by design', 'Passenger identities and private customer information are not displayed. Aircraft are shown with anonymous IDs only.'],
      ['user', 'Humans approve', 'Human staff must approve operational recommendations before anything is acted on.'],
      ['warn', 'No movement authority', 'The system cannot authorize aircraft movements, runway use, takeoffs, landings, or taxi instructions.'],
      ['eye', 'People stay in command', 'Airport operations, air traffic control, and certified personnel remain in command at all times.']
    ];
    $('#body-responsible').innerHTML =
      '<div class="advisory advisory-lg" role="note">' + A.icon('shield', 24) + '<div><b>Planning support only.</b> ' + A.ADVISORY + '</div></div>' +
      '<div class="rai-grid">' + P.map(function (p) { return '<article class="rai-card"><span class="rai-ico">' + A.icon(p[0], 22) + '</span><h3>' + p[1] + '</h3><p>' + p[2] + '</p></article>'; }).join('') + '</div>' +
      '<div class="grid g-2"><article class="card"><div class="card-head"><h3>How to read confidence</h3></div><div class="conf-legend">' +
      [{ level: 'high', label: 'High confidence', rel: 0.08, t: 'Narrow range (about ±9% or less). Safe to plan against.' }, { level: 'moderate', label: 'Moderate confidence', rel: 0.12, t: 'Medium range (about ±9–15%). Plan with a buffer and re-check after refresh.' }, { level: 'low', label: 'Low confidence', rel: 0.18, t: 'Wide range (above ±15%). Keep flexible resources and decide late.' }].map(function (c) { return '<div class="cl-row">' + A.confBadge(c) + '<span>' + c.t + '</span></div>'; }).join('') +
      '</div><p class="note">Confidence reflects forecast uncertainty only, not operational safety.</p></article>' +
      '<article class="card"><div class="card-head"><h3>Human approval log (this session)</h3></div><div id="rai-log"></div></article></div>' +
      '<article class="card"><div class="card-head"><div><h3>Backend API placeholders</h3><p class="card-sub">Each section is wired to an endpoint. This prototype uses a synthetic mock; no live airport, flight or passenger data is connected.</p></div></div><div class="table-scroll" id="rai-api"></div></article>' +
      '<div class="disclaimer" role="note"><b>Disclaimer:</b> All data in the LAXY Intelligent FBO dashboard is synthetic or backend-generated for demonstration purposes. LAXY FBO is a fictional operator. Nothing here is operational guidance, a clearance, or an instruction to move aircraft.</div>';
    $('#meta-responsible').innerHTML = '<span class="chip chip-data">' + A.icon('info', 14) + 'Demonstration only</span>';
    $('#rai-api').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>Method</th><th>Endpoint</th><th>Feeds</th><th>Status</th></tr></thead><tbody>' + LaxyAPI.ENDPOINTS.map(function (e) {
      return '<tr><td><code class="m m-' + e.method.toLowerCase() + '">' + e.method + '</code></td><td><code>' + e.path.replace(/</g, '&lt;') + '</code><small>' + e.desc + '</small></td><td>' + e.section + '</td><td><span class="st st-prop">Mock · synthetic</span></td></tr>';
    }).join('') + '</tbody></table><p class="note">To connect a backend set <code>window.LAXY_API_BASE</code>; see <code>js/api.js</code>.</p>';
  }
  function respUpdate() {
    if (!$('#rai-log')) respMount();
    const log = A.state.decisions;
    $('#rai-log').innerHTML = log.length ? '<ul class="log">' + log.slice(0, 8).map(function (x) { return '<li><time>' + x.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</time><span>' + x.text + '<small>' + x.ctx + '</small></span></li>'; }).join('') + '</ul>' : '<p class="empty">No approvals yet. Approve, defer or acknowledge a recommendation to see it logged here. Nothing is sent to real systems.</p>';
  }

  A.register('alerts', alertsUpdate, { page: 'dashboard' });
  A.register('reports', reportsUpdate, { page: 'reports' });
  A.register('impact', impactUpdate, { page: 'reports' });
  A.register('responsible', respUpdate, { page: 'reports' });
})();
