/* AI scheduling recommendations (Assistant page) and Staffing & crew planning */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt, CATS = Model.CATS, ROLES = Model.ROLES, SERVICES = Model.SERVICES;
  const A = App, $ = A.$, UI = window.UI;
  const ADVISORY = A.ADVISORY;
  UI.ADVISORY = ADVISORY;
  const svcName = function (k) { return SERVICES.filter(function (s) { return s.key === k; })[0].name; };
  /* ============================ 4. AI SCHEDULING ASSISTANT ============================ */
  const decided = {};
  function decisionBtn(card) {
    const key = A.state.scen + '-' + A.state.date + '-' + card;
    return decided[key] ? '<span class="approved">' + A.icon('check', 14) + decided[key] + '</span>' :
      '<div class="decide"><button type="button" class="btn btn-sm btn-primary" data-dec="approve" data-card="' + card + '">Approve</button><button type="button" class="btn btn-sm btn-ghost" data-dec="defer" data-card="' + card + '">Defer</button></div>';
  }

  function assistantMount() {
    $('#body-assistant').innerHTML =
      '<div class="advisory" role="note">' + A.icon('shield', 22) + '<div><b>Advisory only.</b> ' + ADVISORY + ' This assistant never authorizes takeoffs, landings, taxiing, runway assignments, or aircraft movements.</div></div>' +
      '<div class="grid g-2-1"><article class="card ai-summary"><div class="card-head"><div><h3>AI-generated operational schedule</h3><p class="card-sub" id="as-sub"></p></div><span class="ai-tag">AI · advisory</span></div><ul class="ai-bullets" id="as-summary"></ul></article>' +
      '<article class="card spacing-card"><div class="card-head"><div><h3>Recommended spacing</h3><p class="card-sub">Between arrivals in the peak hour</p></div></div><div id="as-spacing"></div></article></div>' +
      '<div class="grid g-2">' +
      '<article class="card"><div class="card-head"><div><h3>Suggested arrival time windows</h3><p class="card-sub">Expected arrivals vs. ground-service capacity per hour</p></div><div id="dec-windows"></div></div><div class="table-scroll" id="as-windows"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Ground-service time slots</h3><p class="card-sub">Suggested start minutes per busiest hour</p></div></div><div id="as-slots"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Proposed parking assignments</h3><p class="card-sub">Peak-window arrivals · final placement needs human approval</p></div><div id="dec-parking"></div></div><div class="table-scroll" id="as-parking"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Fuel-service priority</h3><p class="card-sub">Suggested order of fueling for the day</p></div><div id="dec-fuel"></div></div><div class="table-scroll" id="as-fuel"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Crew &amp; vehicle availability</h3><p class="card-sub">Peak concurrent demand vs. available resources</p></div></div><div id="as-res"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Possible schedule conflicts</h3><p class="card-sub">Detected by the assistant for this day</p></div></div><div id="as-conf"></div></article>' +
      '</div>';
    $('#meta-assistant').innerHTML = A.dataChip('Backend-generated · POST /api/v1/assistant/recommendation');
    $('#body-assistant').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-dec]');
      if (b) {
        const card = b.dataset.card, key = A.state.scen + '-' + A.state.date + '-' + card;
        const names = { windows: 'arrival-window recommendations', parking: 'parking proposals', fuel: 'fuel-service priority' };
        const ok = b.dataset.dec === 'approve';
        decided[key] = ok ? 'Approved by human (demo)' : 'Deferred for review';
        A.logDecision((ok ? 'Approved ' : 'Deferred ') + names[card]);
        A.toast((ok ? 'Recorded: human approved ' : 'Recorded: deferred ') + names[card] + '. Demo only - no systems were changed.', 'ok');
        assistantUpdate();
        return;
      }
    });
  }

  function assistantUpdate() {
    if (!$('#as-summary')) assistantMount();
    const k = A.state.scen, d = A.state.date, s = A.sm(), a = A.M().assistant(k, d);
    $('#as-sub').textContent = A.dayLabel(d) + ' · ' + A.SC().label + ' demand · all recommendations require human approval';
    $('#as-summary').innerHTML = a.summary.map(function (x) { return '<li>' + x + '</li>'; }).join('');
    $('#as-spacing').innerHTML = '<div class="big-n">≥ ' + a.spacingMin + '<small> min</small></div><p class="sc-sub">Expected average gap at ' + fmt.hourLong(s.peakHour) + ': <b>' + (Math.round(a.expectedGap * 10) / 10) + ' min</b> (' + s.peakHourN + ' arrivals).</p>' +
      '<p class="sc-sub">' + (a.expectedGap < a.spacingMin ? 'Arrivals are bunched closer than the ground-service capacity allows; ask operators with flexible times to shift ' + Math.max(0, s.peakHourN - a.capCur[s.peakHour]) + ' arrival(s).' : 'Expected spacing is within ground-service capacity.') + '</p>';

    $('#dec-windows').innerHTML = decisionBtn('windows');
    $('#as-windows').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>Window</th><th>Expected</th><th>Capacity now</th><th>With rec. staff</th><th>Suggestion</th></tr></thead><tbody>' +
      a.rows.map(function (r) {
        const cls = r.status === 'over' ? 'st-bad' : r.status === 'tight' ? 'st-warn' : 'st-ok';
        const sug = r.status === 'over' ? 'Offer ' + r.shift + ' flexible arrival' + (r.shift === 1 ? '' : 's') + (r.target !== null ? ' a slot near ' + fmt.hourLong(r.target) : ' a later window') + (r.shiftRec < r.shift ? ' (or add staff: only ' + r.shiftRec + ' to shift)' : '')
          : r.status === 'tight' ? 'Hold current slots; no new bookings' : 'Open for additional arrivals';
        return '<tr><td><b>' + fmt.hourLong(r.h) + '–' + fmt.hourLong(r.h + 1) + '</b></td><td>' + r.arr + '</td><td>' + r.capCur + '/hr</td><td>' + r.capRec + '/hr</td><td><span class="st ' + cls + '">' + (r.status === 'over' ? 'Over capacity' : r.status === 'tight' ? 'Tight' : 'OK') + '</span> <small>' + sug + '</small></td></tr>';
      }).join('') + '</tbody></table>' + (a.rows.length ? '' : '<p class="empty">No windows need attention.</p>');
    $('#as-slots').innerHTML = a.slotHours.length ? a.slotHours.map(function (sl) {
      return '<div class="slot-row"><div class="slot-h"><b>' + fmt.hourLong(sl.h) + '</b><small>' + sl.teams + ' team' + (sl.teams === 1 ? '' : 's') + '</small></div><div class="slot-chips">' + sl.slots.map(function (m) { return '<span class="slot">:' + String(m).padStart(2, '0') + '</span>'; }).join('') + '</div></div>';
    }).join('') + '<p class="note">Each chip is a suggested ground-service start minute (handling team of 2). Based on average service time of ~' + Math.round(a.avgSvc) + ' min.</p>' : '<p class="empty">No busy hours for the selected filters.</p>';

    const byId = {}; A.M().dayAircraft(k, d).forEach(function (x) { byId[x.id] = x; });
    $('#dec-parking').innerHTML = decisionBtn('parking');
    $('#as-parking').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>Aircraft</th><th>ETA</th><th>Category</th><th>Proposed position</th><th>Expected stay</th></tr></thead><tbody>' +
      a.parking.map(function (p) { const ac = byId[p.id]; return '<tr><td><b>' + p.id + '</b></td><td>' + p.time + '</td><td>' + p.cat + '</td><td><span class="pos ' + (p.needsOps ? 'pos-ovf' : '') + '">' + (ac && ac.sim ? ac.sim.pos.code : p.code) + '</span>' + (p.needsOps ? '<small> needs airport-ops approval</small>' : '') + '</td><td>' + p.stay + '<small> → ' + p.dep + '</small></td></tr>'; }).join('') + '</tbody></table>' +
      (a.parking.length ? '' : '<p class="empty">No arrivals in the peak window.</p>') + '<p class="note">A/B/C = main aprons (large-cabin → A, midsize/light → B, turboprop/helicopter → C). O = overflow apron.</p>';

    $('#dec-fuel').innerHTML = decisionBtn('fuel');
    $('#as-fuel').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>#</th><th>Aircraft</th><th>Start</th><th>Uplift</th><th>Why</th></tr></thead><tbody>' +
      a.fuelQueue.map(function (f) { return '<tr><td><b>' + f.rank + '</b></td><td>' + f.id + '<small> ' + f.cat + '</small></td><td>' + f.at + '</td><td>' + fmt.int(f.gal) + ' gal</td><td><small>' + f.reason + '</small></td></tr>'; }).join('') + '</tbody></table>' +
      (a.fuelQueue.length ? '' : '<p class="empty">No fuel services scheduled on this date.</p>');

    $('#as-res').innerHTML = a.resources.map(function (r) {
      const cls = r.util > 1 ? 'red' : r.util >= 0.85 ? 'orange' : 'green';
      return '<div class="res-row"><div class="res-name">' + r.name + '<small>peak ' + r.peak + ' of ' + r.cap + (r.peak ? ' at ' + fmt.clock(r.peakAt) : '') + '</small></div>' + A.progress(Math.min(r.util, 1) * 100, 100, cls) + '<span class="res-pct ' + cls + '">' + Math.round(r.util * 100) + '%</span></div>';
    }).join('');
    $('#as-conf').innerHTML = a.conflicts.length ? '<ul class="conf-list">' + a.conflicts.map(function (c) { return '<li><span class="dot-t t-red"></span><b>' + c.id + '</b> · ' + c.time + ' · ' + c.cat + '<small>' + c.text + '</small></li>'; }).join('') + '</ul><p class="note">' + s.conflicts.count + ' conflict' + (s.conflicts.count === 1 ? '' : 's') + ' in total · ' + Math.max(0, s.conflicts.count - s.conflicts.planCount) + ' resolved if recommended staffing, spacing and overflow plans are approved.</p>' : '<p class="empty">No conflicts detected for this day and scenario.</p>';
  }

  /* ============================ 5. STAFFING ============================ */
  const st = { role: 'all' };
  function staffMount() {
    $('#body-staffing').innerHTML =
      '<div class="toolbar"><div class="seg seg-wrap" id="st-roles" role="radiogroup" aria-label="Staff role"></div></div>' +
      '<div class="grid g-2-1"><article class="card"><div class="card-head"><div><h3 id="st-title"></h3><p class="card-sub" id="st-sub"></p></div></div><div id="ch-staff"></div><div class="mini-title">Shortage (+) / surplus (−) vs. recommended</div><div id="ch-staff2"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Staffing alerts</h3><p class="card-sub">Recommended human actions</p></div></div><div id="st-alerts" class="alert-mini"></div><div id="st-level" class="level-box"></div></article></div>' +
      '<article class="card"><div class="card-head"><div><h3>Role summary for the day</h3><p class="card-sub">Current available staff vs. minimum required vs. recommended</p></div></div><div class="table-scroll" id="st-table"></div></article>';
    $('#meta-staffing').innerHTML = A.dataChip('Synthetic · GET /api/v1/staffing/plan');
    $('#st-roles').innerHTML = '<button type="button" role="radio" data-r="all">All roles</button>' + ROLES.map(function (r) { return '<button type="button" role="radio" data-r="' + r.key + '">' + r.short + '</button>'; }).join('');
    $('#st-roles').addEventListener('click', function (e) { const b = e.target.closest('button[data-r]'); if (b) { st.role = b.dataset.r; staffUpdate(); } });
  }

  function staffUpdate() {
    if (!$('#st-roles')) staffMount();
    const k = A.state.scen, d = A.state.date, S = A.S(), s = A.sm();
    $('#st-roles').querySelectorAll('button').forEach(function (b) { const on = b.dataset.r === st.role; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    const sl = function (arr) { return Model.daySlice(arr, d); };
    const role = ROLES.filter(function (r) { return r.key === st.role; })[0];
    const rec = [], cur = [], min = [];
    for (let h = 0; h < 24; h++) {
      let r = 0, c = 0, m = 0;
      (role ? [role] : ROLES).forEach(function (ro) { r += S.staff[ro.key].rec[d * 24 + h]; c += S.staff[ro.key].cur[d * 24 + h]; m += S.staff[ro.key].min[d * 24 + h]; });
      rec.push(r); cur.push(c); min.push(m);
    }
    const gap = rec.map(function (r, i) { return r - cur[i]; });
    $('#st-title').textContent = (role ? role.name : 'All roles') + ' – recommended staff by hour';
    $('#st-sub').textContent = A.dayLabel(d) + ' · ' + A.SC().label + ' demand · step lines show staff on shift each hour';
    const tip = function (i) {
      const g = gap[i];
      let rows = [{ c: '#7c3aed', l: 'Current available staff', v: cur[i] }, { c: '#7a8aa3', l: 'Minimum required', v: min[i] }, { c: '#d946ef', l: 'Recommended', v: rec[i], on: true }];
      let extra = '';
      if (!role) extra = '<br>' + ROLES.map(function (ro) { return ro.short + ': ' + S.staff[ro.key].rec[d * 24 + i] + ' rec. / ' + S.staff[ro.key].cur[d * 24 + i] + ' now'; }).join('<br>');
      return UI.tt(UI.longDay(d), UI.hourRange(i), rows, (g > 0 ? '<b class="neg">Shortage of ' + g + '</b>' : g < 0 ? '<b class="pos-t">Surplus of ' + (-g) + '</b>' : 'Matches recommendation') + (cur[i] < min[i] ? '<br><b class="neg">Below minimum required!</b>' : '') + '<br>Arrivals this hour: ' + s.hourlyArr[i] + ' · departures ' + s.hourlyDep[i] + extra + '<br><i>Synthetic estimate</i>');
    };
    const base = {
      height: 330, x: UI.HOUR_LABELS, labelW: 30, yTitle: 'Staff on shift', ariaLabel: 'Staffing by hour', tooltip: tip,
      bands: [{ from: 6, to: 11, color: 'rgba(124,58,237,.07)', label: 'Peak 6–11 AM' }]
    };
    if (!role) {
      Charts.render($('#ch-staff'), Object.assign({}, base, {
        series: ROLES.map(function (ro) { return { name: ro.short + ' (rec.)', type: 'bar', stack: 'r', color: ro.color, opacity: 0.88, data: sl(S.staff[ro.key].rec) }; }).concat([
          { name: 'Current available (all roles)', type: 'step', color: '#2b1065', width: 2.8, data: cur },
          { name: 'Minimum required', type: 'step', color: '#d9342b', dash: '5 4', width: 2, data: min }])
      }));
    } else {
      Charts.render($('#ch-staff'), Object.assign({}, base, {
        diff: { a: rec, b: cur, posColor: 'rgba(217,52,43,.20)', negColor: 'rgba(26,154,91,.15)' },
        series: [
          { name: 'Current available', type: 'step', color: '#7c3aed', width: 2.8, data: cur },
          { name: 'Minimum required', type: 'step', color: '#7a8aa3', dash: '5 4', width: 2, data: min },
          { name: 'Recommended', type: 'step', color: '#d946ef', width: 2.8, data: rec }]
      }));
    }
    Charts.render($('#ch-staff2'), {
      height: 170, x: UI.HOUR_LABELS, labelW: 30, yTitle: 'Staff', ariaLabel: 'Staff shortage or surplus by hour', legend: false,
      series: [{ name: 'Shortage / surplus', type: 'bar', color: '#d9342b', colors: gap.map(function (g) { return g > 0 ? '#d9342b' : '#1a9a5b'; }), data: gap }],
      tooltip: function (i) { const g = gap[i]; return UI.tt(UI.hourRange(i), A.dayLabel(d), [{ c: g > 0 ? '#d9342b' : '#1a9a5b', l: g > 0 ? 'Shortage' : g < 0 ? 'Surplus' : 'Balanced', v: Math.abs(g) }], 'Recommended ' + rec[i] + ' vs current ' + cur[i]); }
    });

    // alerts
    const al = A.M().alerts(k, d).filter(function (x) { return x.cat === 'staffing' || x.cat === 'delay'; });
    $('#st-alerts').innerHTML = al.length ? al.map(function (a) { return '<a class="am am-' + a.sev + '" href="#dashboard/alerts">' + A.sevBadge(a.sev) + '<span class="am-t">' + a.title + '</span><span class="am-m">' + a.time + ' · ' + a.action + '</span></a>'; }).join('') : '<p class="empty">Current roster meets the recommended staffing all day.</p>';
    $('#st-level').innerHTML = '<div class="lvl lvl-' + s.staff.level.n + '"><span>Recommended staffing level</span><b>' + s.staff.level.label + '</b><small>Peak need ' + s.staff.recPeak + ' staff vs ' + s.staff.curPeak + ' on the roster · coverage ' + s.staff.coverage + '%</small></div>';

    // table
    $('#st-table').innerHTML = '<table class="tbl"><thead><tr><th>Role</th><th>Current (peak)</th><th>Minimum required (peak)</th><th>Recommended (peak)</th><th>Largest shortage</th><th>Window</th><th>Status</th></tr></thead><tbody>' +
      ROLES.map(function (ro) {
        const r = sl(S.staff[ro.key].rec), c = sl(S.staff[ro.key].cur), m = sl(S.staff[ro.key].min);
        const g = r.map(function (v, i) { return v - c[i]; });
        const mx = Math.max.apply(null, g), mn = Math.min.apply(null, g);
        const sh = s.staff.shortages.filter(function (x) { return x.role === ro.key; })[0];
        const stt = mx > 0 ? '<span class="st st-bad">Short ' + mx + '</span>' : mn < -1 ? '<span class="st st-ok">Surplus up to ' + (-mn) + '</span>' : '<span class="st st-ok">Covered</span>';
        return '<tr><td><span class="dot-t" style="background:' + ro.color + '"></span><b>' + ro.name + '</b></td><td>' + Math.max.apply(null, c) + '</td><td>' + Math.max.apply(null, m) + '</td><td>' + Math.max.apply(null, r) + '</td><td>' + (mx > 0 ? '+' + mx : '–') + '</td><td>' + (sh ? fmt.hourLong(sh.from) + '–' + fmt.hourLong(sh.to) : '–') + '</td><td>' + stt + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

    A.register('assistant', assistantUpdate, { page: 'assistant' });
  A.register('staffing', staffUpdate, { page: 'staffing' });
})();
