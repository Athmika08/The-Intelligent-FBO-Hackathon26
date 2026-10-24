/* Runway Operations: ADVISORY planning data only.
   Nothing here assigns a runway, clears an aircraft or controls any movement. Air traffic control,
   airport authorities and certified aviation personnel make all final runway and aircraft-movement decisions. */
(function () {
  'use strict';
  const D = Model.DAYS, fmt = Model.fmt;
  const A = App, $ = A.$, UI = window.UI;
  const RW_COL = ['#4c1d95', '#8b5cf6', '#c4b5fd', '#d946ef'];
  const rf = { sel: null };
  const STATE_LABEL = { open: 'Open', reduced: 'Reduced', restricted: 'Restricted', closed: 'Closed' };
  const STATE_CLS = { open: 'st-ok', reduced: 'st-warn', restricted: 'st-warn', closed: 'st-bad' };

  function mount() {
    $('#body-runway').innerHTML =
      '<div class="advisory advisory-lg" role="note">' + A.icon('shield', 24) + '<div><b>Advisory planning data.</b> ' + A.ADVISORY + ' This page does not assign runways, issue taxi instructions or authorize any aircraft movement.</div></div>' +
      '<div class="tl-summary" id="rw-sum"></div>' +
      '<div class="sec-sub"><h3>Runways in the planning flow</h3><p>Planning assumption for <span id="rw-flow"></span>. Select a runway to see the aircraft estimated to use it.</p></div>' +
      '<div class="rwy-grid" id="rw-cards"></div>' +
      '<div class="grid g-2-1" style="margin-top:16px"><article class="card"><div class="card-head"><div><h3>Expected arrival periods by planning runway</h3><p class="card-sub" id="rw-csub"></p></div><span id="rw-cconf"></span></div><div id="ch-rwy"></div><p class="note">Planning estimate of how arrivals could spread across the runways in use. Click an hour to move the operations clock.</p></article>' +
      '<div class="stack"><article class="card"><div class="card-head"><h3>Weather &amp; operational notes</h3><span class="ai-tag warn">Synthetic</span></div><div id="rw-wx"></div></article></div></div>' +
      '<div class="grid g-2" style="margin-top:16px"><article class="card"><div class="card-head"><div><h3>Recommended arrival windows</h3><p class="card-sub">Advisory windows to spread demand, with a confidence level</p></div></div><div id="rw-winstrip"></div><div class="table-scroll" id="rw-wins"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Potential arrival conflicts</h3><p class="card-sub" id="rw-csub2"></p></div></div><div id="rw-conf"></div></article></div>' +
      '<article class="card" style="margin-top:16px"><div class="card-head"><div><h3 id="rw-ltitle">Aircraft expected to use the planning runways</h3><p class="card-sub">Anonymous synthetic aircraft · planning estimate only</p></div><div class="chips" id="rw-chips" role="group" aria-label="Filter by runway"></div></div><div id="rw-list"></div></article>' +
      '<div class="callout-adv" style="margin-top:16px">' + A.ADVISORY + '</div>';
    $('#meta-runway').innerHTML = '<span class="ai-tag warn">Advisory only</span> ' + A.dataChip('Synthetic · GET /api/v1/runway/advisory');
    $('#rw-cards').addEventListener('click', function (e) {
      const id = e.target.closest('.idchip[data-aid]');
      if (id) { UI.openAircraft(id.dataset.aid); return; }
      const c = e.target.closest('.rwy-card[data-rwy]'); if (!c) return;
      rf.sel = rf.sel === c.dataset.rwy ? null : c.dataset.rwy; update(true);
    });
    $('#rw-cards').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.rwy-card')) { e.preventDefault(); e.target.click(); } });
    $('#rw-chips').addEventListener('click', function (e) { const b = e.target.closest('button[data-r]'); if (b) { rf.sel = b.dataset.r === 'all' ? null : b.dataset.r; update(true); } });
    const open = function (e) { const el = e.target.closest('[data-aid]'); if (el) UI.openAircraft(el.dataset.aid); };
    $('#rw-list').addEventListener('click', open); $('#rw-conf').addEventListener('click', open);
    $('#rw-list').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-aid]')) { e.preventDefault(); open(e); } });
  }

  function lights(n) { let s = ''; for (let i = 0; i < n; i++) s += '<i style="--k:' + i + '"></i>'; return s; }

  function windows(rd, s, as, d) {
    const n = s.hourlyArr, out = [];
    const closedCount = function (h) { return rd.flow.rwys.filter(function (r) { return rd.avail[r][h].s === 'closed'; }).length; };
    const denseHours = {}; rd.conflicts.forEach(function (c) { if (c.dense) denseHours[c.h] = 1; });
    const cls = [];
    for (let h = 0; h < 24; h++) {
      const cap = as.capCur[h] || 1;
      const reduced = rd.flow.rwys.some(function (r) { return rd.avail[r][h].s !== 'open'; });
      let c = 'good', why = 'Light load; runways open';
      if (n[h] > cap || closedCount(h) >= 2 || denseHours[h]) { c = 'avoid'; why = n[h] > cap ? 'Arrivals exceed ground-service capacity' : closedCount(h) >= 2 ? 'Several runways unavailable' : 'Dense arrival period'; }
      else if (n[h] >= 0.7 * cap || reduced) { c = 'busy'; why = reduced ? 'Runway restriction or reduced visibility' : 'Approaching capacity'; }
      cls.push({ c: c, why: why, n: n[h] });
    }
    let i = 0;
    while (i < 24) {
      let j = i; while (j + 1 < 24 && cls[j + 1].c === cls[i].c) j++;
      const sum = cls.slice(i, j + 1).reduce(function (a, x) { return a + x.n; }, 0), avg = sum / (j - i + 1);
      out.push({ from: i, to: j + 1, c: cls[i].c, why: cls[i].why, n: sum, conf: Model.confidenceHourly(Math.round(avg), A.SC().ci) });
      i = j + 1;
    }
    return { cls: cls, wins: out };
  }

  function update(quiet) {
    if (!$('#rw-cards')) mount();
    const k = A.state.scen, d = A.state.date, h = A.state.hour, M = A.M(), s = A.sm(), as = M.assistant(k, d);
    const rd = Sim.runwayDay(M, k, d), fl = rd.flow, wx = Model.WEATHER[d];
    const T = UI.nowT();
    $('#rw-flow').textContent = fl.label + ' (' + fl.rwys.join(', ') + ') · ' + A.dayLabel(d);
    const nConf = rd.conflicts.filter(function (c) { return c.sev !== 'info'; }).length;
    const W = windows(rd, s, as, d);
    const best = W.wins.filter(function (x) { return x.c === 'good' && x.n > 0; }).sort(function (a, b) { return (b.to - b.from) - (a.to - a.from); })[0];
    $('#rw-sum').innerHTML =
      '<div class="kpi accent"><span>Planning flow</span><b>' + fl.label + '</b><small>' + (/East/.test(wx.flow) ? 'Offshore wind pattern (synthetic)' : 'Typical onshore pattern (synthetic)') + '</small></div>' +
      '<div class="kpi"><span>Expected arrivals</span><b>' + s.arrivals + '</b><small>' + A.dayLabel(d) + '</small></div>' +
      '<div class="kpi"><span>Busiest period</span><b>' + fmt.hourLong(s.peakWin.start) + '–' + fmt.hourLong(s.peakWin.end) + '</b><small>' + s.peakWin.count + ' arrivals</small></div>' +
      '<div class="kpi' + (nConf ? ' bad' : '') + '"><span>Potential conflicts</span><b>' + nConf + '</b><small>spacing / dense hours</small></div>' +
      '<div class="kpi"><span>Best open window</span><b>' + (best ? fmt.hourLong(best.from) + '–' + fmt.hourLong(best.to) : 'None') + '</b><small>' + (best ? best.n + ' arrivals · ' + best.conf.label : 'Demand is high all day') + '</small></div>';

    // runway cards
    const dayConf = s.ci.conf;
    const cards = fl.rwys.map(function (r, i) {
      const arr = rd.by[r], stNow = rd.avail[r][h], cnt = arr.length;
      const peakH = rd.hourly[r].indexOf(Math.max.apply(null, rd.hourly[r]));
      const hrN = rd.hourly[r][h];
      const closedHrs = rd.avail[r].filter(function (x) { return x.s === 'closed'; }).length;
      const ids = arr.slice(0, 14).map(function (a) { return '<button type="button" class="idchip" data-aid="' + a.id + '" title="' + a.id + ' · ' + UI.eta(a) + '">' + a.id.replace('AC-', '') + '</button>'; }).join('') + (arr.length > 14 ? '<span class="idchip" style="cursor:default">+' + (arr.length - 14) + '</span>' : '');
      return '<article class="rwy-card rs-' + stNow.s + '" role="button" tabindex="0" aria-pressed="' + (rf.sel === r) + '" data-rwy="' + r + '" style="--i:' + i + ';' + (rf.sel === r ? 'outline:3px solid var(--brand);outline-offset:2px;' : '') + '">' +
        '<div class="rwy-top"><div class="rwy-id">' + r + '<small>' + Sim.RW_ROLE[i] + '</small></div><span class="st ' + STATE_CLS[stNow.s] + '">' + STATE_LABEL[stNow.s] + ' at ' + fmt.hourLong(h) + '</span></div>' +
        '<div class="rw-strip" aria-hidden="true"><div class="rw-lrow top">' + lights(26) + '</div><div class="rw-lrow bot">' + lights(26) + '</div></div>' +
        '<div class="rwy-stats"><div><span>Expected today</span><b>' + cnt + '</b></div><div><span>This hour</span><b>' + hrN + '</b></div><div><span>Peak hour</span><b>' + (cnt ? UI.hourShort(peakH) : '—') + '</b></div></div>' +
        '<div><div class="avail-row" role="img" aria-label="Hourly planning availability for ' + r + '">' + rd.avail[r].map(function (x, hh) { return '<i class="' + (x.s === 'open' ? '' : x.s) + '" title="' + fmt.hourLong(hh) + ': ' + STATE_LABEL[x.s] + (x.note ? ' · ' + x.note : '') + '"></i>'; }).join('') + '</div><div class="avail-lab"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div>' +
        (stNow.note ? '<p class="note" style="margin:0">' + stNow.note + '</p>' : closedHrs ? '<p class="note" style="margin:0">Unavailable ' + closedHrs + ' h today (see notes).</p>' : '<p class="note" style="margin:0">No closures in the synthetic data today.</p>') +
        '<div class="rwy-ids">' + (ids || '<span class="muted">No aircraft expected</span>') + '</div>' +
        '<div class="chips" style="margin-top:2px"><span class="chip">Confidence ' + A.confBadge(dayConf, true) + ' ' + dayConf.label + '</span></div></article>';
    });
    const rotor = rd.by.Rotor;
    if (rotor.length) {
      cards.push('<article class="rwy-card" role="button" tabindex="0" aria-pressed="' + (rf.sel === 'Rotor') + '" data-rwy="Rotor" style="--i:4;border-top-color:#64748b"><div class="rwy-top"><div class="rwy-id">Rotor<small>Helicopter arrival route</small></div><span class="st st-ok">Coordinated by ATC</span></div><p class="note" style="margin:0">' + rotor.length + ' rotorcraft arrivals expected today (planning estimate). Rotorcraft routes and helipad use are decided by ATC and airport personnel.</p><div class="rwy-ids">' + rotor.slice(0, 14).map(function (a) { return '<button type="button" class="idchip" data-aid="' + a.id + '">' + a.id.replace('AC-', '') + '</button>'; }).join('') + '</div></article>');
    }
    const cw = $('#rw-cards');
    cw.classList.toggle('no-anim', !!quiet);
    cw.innerHTML = cards.join('');

    // chart
    $('#rw-csub').textContent = A.dayLabel(d) + ' · ' + A.SC().label + ' demand · stacked by planning runway';
    $('#rw-cconf').innerHTML = A.confBadge(Model.confidenceHourly(s.peakHourN, A.SC().ci));
    const series = fl.rwys.map(function (r, i) { return { name: r, type: 'bar', stack: 's', color: RW_COL[i], data: rd.hourly[r] }; });
    if (rotor.length) series.push({ name: 'Rotor', type: 'bar', stack: 's', color: '#64748b', data: rd.hourly.Rotor });
    Charts.render($('#ch-rwy'), {
      animate: !quiet, height: 280, x: UI.HOUR_LABELS, labelW: 30, yTitle: 'Arrivals / hour', selected: h, ariaLabel: 'Planning estimate of arrivals per hour by runway',
      bands: [{ from: s.peakWin.start, to: s.peakWin.end, color: 'rgba(220,38,38,.08)', label: 'Busiest period' }],
      series: series, onSelect: function (i) { A.setHour(i); },
      tooltip: function (i) {
        const c = Model.confidenceHourly(s.hourlyArr[i], A.SC().ci);
        return UI.tt(UI.longDay(d), UI.hourRange(i), series.map(function (x) { return { c: x.color, l: x.name, v: x.data[i] }; }), 'Total ' + s.hourlyArr[i] + ' · range ' + c.lo + '–' + c.hi + ' · ' + c.label + '<br><i>Advisory planning estimate</i>');
      }
    });

    // weather
    const cl = Model.CLOSURES[d];
    $('#rw-wx').innerHTML = '<div class="wx-grid"><div class="wx"><span>Wind</span><b>' + wx.wind + '</b></div><div class="wx"><span>Visibility</span><b>' + wx.vis + '</b></div><div class="wx"><span>Ceiling</span><b>' + wx.ceiling + '</b></div><div class="wx"><span>Flow outlook</span><b>' + wx.flow + '</b></div></div>' +
      '<p class="note" style="margin:0 0 8px">' + wx.note + '</p>' +
      (cl.length ? '<h4 class="mini-h">Closures &amp; restrictions (synthetic)</h4><ul class="plain">' + cl.map(function (c) { return '<li><b>' + c.rwy + '</b> · ' + c.win + ' · ' + c.note + '</li>'; }).join('') + '</ul>' : '<p class="note">No closures or airspace restrictions in the synthetic data for this day.</p>') +
      '<p class="note">Illustrative values, not real METAR/NOTAM data.</p>';

    // windows
    const lab = { good: ['st-ok', 'Recommended'], busy: ['st-warn', 'Busy'], avoid: ['st-bad', 'Avoid new bookings'] };
    $('#rw-winstrip').innerHTML = '<div class="avail-row" role="img" aria-label="Hourly recommended-window strip" style="margin-bottom:4px">' + W.cls.map(function (x, hh) { return '<i style="background:' + (x.c === 'good' ? '#22c55e' : x.c === 'busy' ? '#facc15' : '#ef4444') + '" title="' + fmt.hourLong(hh) + ': ' + lab[x.c][1] + ' · ' + x.why + '"></i>'; }).join('') + '</div><div class="avail-lab" style="margin-bottom:10px"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>';
    const wins = W.wins.filter(function (x) { return x.n > 0 || x.c !== 'good'; });
    $('#rw-wins').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>Window</th><th>Arrivals</th><th>Advisory</th><th>Confidence</th></tr></thead><tbody>' + wins.slice(0, 12).map(function (x) {
      const sug = x.c === 'avoid' ? 'Offer flexible arrivals a different window; add handlers (human decision)' : x.c === 'busy' ? 'Hold current slots; limit new bookings' : 'Open for additional arrivals';
      return '<tr><td><b>' + fmt.hourLong(x.from) + '–' + fmt.hourLong(x.to % 24) + '</b></td><td>' + x.n + '</td><td><span class="st ' + lab[x.c][0] + '">' + lab[x.c][1] + '</span> <small>' + x.why + '. ' + sug + '</small></td><td>' + A.confBadge(x.conf) + '</td></tr>';
    }).join('') + '</tbody></table>' + (wins.length > 12 ? '<p class="note">Showing the first 12 of ' + wins.length + ' windows.</p>' : '') + '<p class="note">Suggestions for planners only; they do not clear or sequence any aircraft.</p>';

    // conflicts
    const cf = rd.conflicts;
    $('#rw-csub2').textContent = nConf + ' potential conflict' + (nConf === 1 ? '' : 's') + ' · ' + cf.filter(function (c) { return c.sev === 'info'; }).length + ' reassignment note' + ' · ' + A.dayLabel(d);
    $('#rw-conf').innerHTML = cf.length ? '<ul class="conf-list">' + cf.slice(0, 12).map(function (c) {
      const aid = c.b ? c.b.id : c.a ? c.a.id : null;
      return '<li class="' + (c.sev === 'high' ? '' : c.sev === 'warning' ? 'w' : 'i') + '"' + (aid ? ' data-aid="' + aid + '" tabindex="0" style="cursor:pointer"' : '') + '><b>' + (c.sev === 'info' ? 'Note' : c.sev === 'high' ? 'High' : 'Watch') + '</b> ' + c.text + '<small>' + (c.sev === 'info' ? 'Planning note only; ATC decides runway use.' : 'Suggestion: widen spacing or shift a flexible arrival. ATC and airport personnel decide actual sequencing.') + '</small></li>';
    }).join('') + '</ul>' + (cf.length > 12 ? '<p class="note">Showing the first 12 of ' + cf.length + '.</p>' : '') : '<p class="empty">No potential arrival conflicts in the planning estimate.</p>';

    // aircraft list
    const sel = rf.sel, list = rd.list.filter(function (a) { return !sel || a.sim.rwy.code === sel; }).sort(function (a, b) { return a.t - b.t; });
    $('#rw-chips').innerHTML = ['all'].concat(fl.rwys).concat(rotor.length ? ['Rotor'] : []).map(function (r) { const on = (r === 'all' && !sel) || r === sel; return '<button type="button" class="chip chip-btn' + (on ? ' on' : '') + '" data-r="' + r + '" aria-pressed="' + on + '">' + (r === 'all' ? 'All' : r) + '</button>'; }).join('');
    $('#rw-ltitle').textContent = sel ? 'Aircraft expected to use ' + (sel === 'Rotor' ? 'the rotorcraft route' : 'the ' + sel + ' planning reference') : 'Aircraft expected to use the planning runways';
    const shown = list.slice(0, 60);
    $('#rw-list').innerHTML = list.length ? '<div class="table-scroll"><table class="tbl tbl-sm"><thead><tr><th>Aircraft ID</th><th>Est. arrival</th><th>Category</th><th>Planning reference</th><th>Note</th></tr></thead><tbody>' + shown.map(function (a) {
      return '<tr tabindex="0" data-aid="' + a.id + '" class="row-click"><td><b>' + a.id + '</b></td><td>' + UI.eta(a) + '</td><td>' + a.catName + '</td><td><span class="pos">' + a.sim.rwy.code + '</span></td><td><small>' + (a.sim.rwy.note || 'Primary planning reference') + '</small></td></tr>';
    }).join('') + '</tbody></table></div>' + (list.length > shown.length ? '<p class="note">Showing the first 60 of ' + list.length + ' aircraft.</p>' : '') : '<p class="empty">No aircraft in this selection.</p>';
  }

  A.register('runway', function () { update(false); }, { page: 'runway' });
  A.onHour(function () { if ($('#rw-cards')) update(true); });
})();
