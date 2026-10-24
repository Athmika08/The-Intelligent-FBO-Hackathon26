/* Sections 6 (Fuel Readiness), 7 (Parking & Ramp Capacity), 8 (Demand Scenarios) */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt, CATS = Model.CATS, STAYS = Model.STAYS;
  const A = App, $ = A.$, UI = window.UI;
  const col = { low: '#1a9a5b', medium: '#d99a00', high: '#dc2626', ordinary: '#9a8fb8' };
  const gal = function (n) { return fmt.int(n) + ' gal'; };

  /* ============================ 6. FUEL ============================ */
  function fuelMount() {
    $('#body-fuel').innerHTML =
      '<div class="grid g-2-1">' +
      '<article class="card"><div class="card-head"><div><h3>Fuel inventory &amp; readiness</h3><p class="card-sub" id="fu-sub"></p></div><span id="fu-badge"></span></div><div id="fu-warn"></div><div id="fu-bars"></div><div class="stat-grid" id="fu-stats"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Planning assumptions</h3><p class="card-sub">Average fuel purchase per aircraft (synthetic)</p></div></div><div id="fu-assume"></div></article></div>' +
      '<div class="grid g-2">' +
      '<article class="card"><div class="card-head"><div><h3>Estimated fuel demand by hour</h3><p class="card-sub" id="fu-c1-sub"></p></div></div><div id="ch-fuel1"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Projected inventory – full week</h3><p class="card-sub" id="fu-c2-sub"></p></div></div><div id="ch-fuel2"></div></article></div>' +
      '<article class="card"><div class="card-head"><div><h3>Fuel under low, medium and high scenarios</h3><p class="card-sub">Selected date · inventory carries over day to day under the standing delivery plan</p></div></div><div class="table-scroll" id="fu-scen"></div></article>';
    $('#meta-fuel').innerHTML = A.dataChip('Synthetic · GET /api/v1/fuel/readiness');
  }

  function fuelUpdate() {
    if (!$('#fu-bars')) fuelMount();
    const k = A.state.scen, d = A.state.date, M = A.M(), S = A.S(), s = A.sm(), f = s.fuel;
    const cls = function (v) { return v < F.safety ? 'red' : v < F.safety * 1.5 ? 'orange' : 'green'; };
    $('#fu-sub').textContent = A.dayLabel(d) + ' · ' + A.SC().label + ' demand · tank capacity ' + gal(F.tank) + ' · safety threshold ' + gal(F.safety);
    $('#fu-badge').innerHTML = '<span class="ready ready-' + (f.readiness >= 100 ? 'ok' : f.readiness >= 70 ? 'warn' : 'bad') + '">Readiness ' + f.readiness + '%</span>';
    const dl = f.deliveries[0];
    $('#fu-warn').innerHTML = f.minInvStanding < F.safety ?
      '<div class="callout callout-bad" role="alert">' + A.icon('warn', 20) + '<div><b>Low-fuel warning:</b> with only the standing 2:00 AM delivery, inventory may fall to <b>' + gal(f.minInvStanding) + '</b>' + (f.breachHour !== null ? ' (below the ' + gal(F.safety) + ' safety threshold from about ' + fmt.hourLong(f.breachHour) + ')' : '') + '. ' + (dl ? 'Recommended: approve an extra delivery of ' + gal(dl.gal) + ' arriving ' + fmt.abs(dl.at) + ' (order by ' + fmt.abs(dl.order) + ').' : 'Request an additional delivery.') + ' Fuel supervisor approval required.</div></div>' :
      '<div class="callout callout-ok">' + A.icon('check', 20) + '<div><b>Fuel reserve OK:</b> lowest projected inventory is ' + gal(f.minInvStanding) + ', above the safety threshold.' + (dl ? ' An extra delivery is still suggested to keep a buffer through the next 8 hours.' : ' The standing delivery covers demand.') + '</div></div>';
    $('#fu-bars').innerHTML =
      '<div class="bar-row"><div class="bar-lab"><b>Inventory at start of day</b><span>' + gal(f.startInv) + ' · ' + Math.round(f.startInv / F.tank * 100) + '% of tank</span></div>' + A.progress(f.startInv, F.tank, cls(f.startInv), F.safety) + '</div>' +
      '<div class="bar-row"><div class="bar-lab"><b>Lowest point – standing plan only</b><span>' + gal(f.minInvStanding) + '</span></div>' + A.progress(f.minInvStanding, F.tank, cls(f.minInvStanding), F.safety) + '</div>' +
      '<div class="bar-row"><div class="bar-lab"><b>Lowest point – with recommended delivery</b><span>' + gal(f.minInvRec) + '</span></div>' + A.progress(f.minInvRec, F.tank, cls(f.minInvRec), F.safety) + '</div>' +
      '<div class="bar-row"><div class="bar-lab"><b>Projected end of day – with recommended delivery</b><span>' + gal(f.endInv) + '</span></div>' + A.progress(f.endInv, F.tank, cls(f.endInv), F.safety) + '</div>' +
      '<div class="bar-legend"><i></i> marker = ' + gal(F.safety) + ' safety threshold</div>';
    $('#fu-stats').innerHTML = [
      ['Estimated fuel demand', gal(f.demand), f.aircraftFueled + ' fuel services'],
      ['Projected usage', Math.round(f.demand / F.tank * 100) + '% of tank', 'avg ' + gal(f.avgGal) + ' per fueled aircraft'],
      ['Remaining reserve (day end)', gal(f.endInv), 'above safety: ' + gal(Math.max(0, f.endInv - F.safety))],
      ['Recommended replenishment', dl ? fmt.abs(dl.at) : 'Standing 2:00 AM', dl ? 'order by ' + fmt.abs(dl.order) + ' · ' + gal(dl.gal) : 'no extra delivery needed']
    ].map(function (x) { return '<div class="stat"><span>' + x[0] + '</span><b>' + x[1] + '</b><small>' + x[2] + '</small></div>'; }).join('');

    $('#fu-assume').innerHTML = '<table class="tbl tbl-sm"><thead><tr><th>Aircraft category</th><th>Avg. uplift</th></tr></thead><tbody>' + CATS.map(function (c) { return '<tr><td><span class="dot-t" style="background:' + c.color + '"></span>' + c.name + '</td><td>~' + fmt.int(c.gal) + ' gal</td></tr>'; }).join('') + '</tbody></table>' +
      '<ul class="plain"><li><b>' + Math.round(F.fuelAttach * 100) + '%</b> of aircraft buy fuel at this FBO (synthetic).</li><li>Fuel is uplifted shortly before departure; each purchase varies ±30% around the average.</li><li>Standing delivery: ' + F.standingLoads + ' tanker loads (' + gal(F.standingLoads * F.loadGal) + ') daily at 2:00 AM.</li><li>Recommended extra deliveries: ' + F.extraLoads + ' loads (' + gal(F.extraLoads * F.loadGal) + ') with ' + F.orderLead + '-hour lead time.</li><li>Jet-A only; start-of-week inventory ' + gal(F.startInv) + '.</li></ul>';

    // chart 1: hourly demand by scenario
    const hr = function (key) { return Model.daySlice(M.scen[key].fuelDemand, d); };
    $('#fu-c1-sub').textContent = A.dayLabel(d) + ' · gallons per hour · active: ' + A.SC().label;
    Charts.render($('#ch-fuel1'), {
      height: 300, x: UI.HOUR_LABELS, labelW: 30, yTitle: 'Gallons / hour', yFormat: function (v) { return v >= 1000 ? (v / 1000) + 'k' : v; }, ariaLabel: 'Fuel demand by hour and scenario',
      bands: [{ from: 6, to: 11, color: 'rgba(124,58,237,.07)', label: 'Peak 6–11 AM' }],
      series: [
        { name: 'Ordinary week', type: 'line', color: col.ordinary, dash: '6 4', width: 2, dots: false, data: hr('ordinary') },
        { name: 'Low demand', type: 'line', color: col.low, dots: false, data: hr('low'), width: k === 'low' ? 3.2 : 2 },
        { name: 'Medium demand', type: 'line', color: col.medium, dots: false, data: hr('medium'), width: k === 'medium' ? 3.2 : 2 },
        { name: 'High demand', type: 'line', color: col.high, dots: false, data: hr('high'), width: k === 'high' ? 3.2 : 2 }
      ],
      tooltip: function (i) {
        return UI.tt(UI.longDay(d), UI.hourRange(i), [
          { c: col.high, l: 'High demand', v: gal(hr('high')[i]), on: k === 'high' }, { c: col.medium, l: 'Medium demand', v: gal(hr('medium')[i]), on: k === 'medium' },
          { c: col.low, l: 'Low demand', v: gal(hr('low')[i]), on: k === 'low' }, { c: col.ordinary, l: 'Ordinary week', v: gal(hr('ordinary')[i]) }],
          'Fuel jobs this hour (' + A.SC().label + '): ' + S.fuelJobs[d * 24 + i] + '<br><i>Synthetic estimate</i>');
      }
    });

    // chart 2: week inventory projection
    const labels = Array.from({ length: 168 }, function (_, i) { return i % 24 === 0 ? D[i / 24].dow + ' ' + D[i / 24].date : (i % 12 === 0 ? '12p' : ''); });
    $('#fu-c2-sub').textContent = A.SC().label + ' demand · end-of-hour inventory · shaded = selected day · markers = recommended deliveries';
    Charts.render($('#ch-fuel2'), {
      height: 300, x: labels, xStep: 12, labelW: 40, yTitle: 'Gallons in tank', yMax: F.tank, yFormat: function (v) { return v >= 1000 ? (v / 1000) + 'k' : v; }, ariaLabel: 'Projected fuel inventory over the week',
      bands: [{ from: d * 24, to: d * 24 + 24, color: 'rgba(124,58,237,.09)' }],
      markers: S.fuel.deliveries.map(function (x) { return { i: x.at, text: '+' + Math.round(x.gal / 1000) + 'k', color: '#7c3aed' }; }),
      hlines: [{ y: F.safety, label: 'Safety threshold ' + gal(F.safety), color: '#d9342b' }],
      series: [
        { name: 'Standing deliveries only', type: 'line', color: '#d9342b', dash: '5 4', width: 2, dots: false, data: S.fuel.invS },
        { name: 'With recommended deliveries', type: 'line', color: '#7c3aed', width: 2.8, dots: false, data: S.fuel.invR, fill: true, fillOpacity: 0.1 }
      ],
      onSelect: function (i) { A.setDate(Math.floor(i / 24)); },
      tooltip: function (i) {
        const dd = Math.floor(i / 24), dv = S.fuel.deliveries.filter(function (x) { return x.at === i; })[0];
        return UI.tt(UI.longDay(dd), UI.hourRange(i % 24), [
          { c: '#7c3aed', l: 'With recommended deliveries', v: gal(S.fuel.invR[i]), on: true }, { c: '#d9342b', l: 'Standing deliveries only', v: gal(S.fuel.invS[i]) }],
          'Demand this hour: ' + gal(S.fuelDemand[i]) + (dv ? '<br><b>Extra delivery +' + gal(dv.gal) + '</b>' : '') + (S.fuel.invS[i] < F.safety ? '<br><b class="neg">Standing plan below safety threshold</b>' : '') + '<br><i>Synthetic estimate</i>');
      }
    });

    // scenario table
    const keys = ['low', 'medium', 'high'];
    $('#fu-scen').innerHTML = '<table class="tbl"><thead><tr><th>Scenario</th><th>Fuel demand (day)</th><th>Fuel services</th><th>Lowest reserve (standing)</th><th>Lowest reserve (recommended)</th><th>Extra deliveries (week)</th><th>Status</th></tr></thead><tbody>' +
      keys.map(function (key) {
        const x = A.sm(key).fuel, sc = Model.SCEN[key];
        const bad = x.minInvStanding < F.safety;
        return '<tr class="' + (key === k ? 'row-on' : '') + '"><td><span class="dot-t" style="background:' + col[key] + '"></span><b>' + sc.label + '</b></td><td>' + gal(x.demand) + '</td><td>' + x.aircraftFueled + '</td><td>' + gal(x.minInvStanding) + '</td><td>' + gal(x.minInvRec) + '</td><td>' + M.scen[key].fuel.deliveries.length + '</td><td><span class="st ' + (bad ? 'st-bad' : 'st-ok') + '">' + (bad ? 'Below threshold' : 'Reserve OK') + '</span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ============================ 8. SCENARIOS ============================ */
  const SCEN_DESC = {
    low: ['Lower arrival volume', 'Normal staffing', 'Low parking utilization', 'Normal fuel demand', 'No major service delays'],
    medium: ['Increased arrivals during peak hours', 'Additional ground and fuel staff', 'Higher parking utilization', 'More frequent service coordination', 'Moderate delay risk'],
    high: ['60–75 private arrivals per day at peak', 'Maximum staffing recommendations', 'High parking utilization', 'Increased fuel demand', 'Potential delays and overflow risk', 'Strong alerts to add resources']
  };

  function scenMount() {
    $('#body-scenarios').innerHTML =
      '<div class="scen-cards" id="sc-cards" role="radiogroup" aria-label="Demand scenario"></div>' +
      '<article class="card"><div class="card-head"><div><h3>How each scenario changes the plan</h3><p class="card-sub" id="sc-sub"></p></div></div><div class="table-scroll" id="sc-table"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Scenario impact index</h3><p class="card-sub">Selected date · ordinary week = 100</p></div></div><div id="ch-scen"></div></article>';
    $('#meta-scenarios').innerHTML = A.dataChip('Synthetic · GET /api/v1/forecast?scenario=…');
    const clickScen = function (e) { const b = e.target.closest('[data-s]'); if (b) A.setScenario(b.dataset.s); };
    $('#sc-cards').addEventListener('click', clickScen);
    $('#sc-table').addEventListener('click', clickScen);
  }

  function scenUpdate() {
    if (!$('#sc-cards')) scenMount();
    const k = A.state.scen, d = A.state.date;
    const keys = ['low', 'medium', 'high'];
    $('#sc-sub').textContent = 'Values for ' + A.dayLabel(d) + ' · click a column to apply that scenario to the whole dashboard';
    $('#sc-cards').innerHTML = keys.map(function (key) {
      const s = A.sm(key), sc = Model.SCEN[key];
      return '<button type="button" class="scen-card sc-' + key + (key === k ? ' on' : '') + '" role="radio" aria-checked="' + (key === k) + '" data-s="' + key + '">' +
        '<span class="scen-name"><i></i>' + sc.label + ' demand' + (key === k ? '<em>Active</em>' : '') + '</span><span class="scen-big">' + s.arrivals + '<small> arrivals</small></span>' +
        '<ul>' + SCEN_DESC[key].map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul><span class="scen-risk risk-' + s.risk.cls + '">Risk: ' + s.risk.label + ' (' + s.risk.score + ')</span></button>';
    }).join('');

    const ord = A.sm('ordinary'), sums = { ordinary: ord, low: A.sm('low'), medium: A.sm('medium'), high: A.sm('high') };
    const cols = ['ordinary', 'low', 'medium', 'high'];
    const maxShort = function (s) { let m = 0; s.staff.recTot.forEach(function (r, i) { m = Math.max(m, r - s.staff.curTot[i]); }); return m; };
    const rows = [
      ['Aircraft arrivals', function (s) { return '<b>' + s.arrivals + '</b><small>range ' + s.ci.lo + '–' + s.ci.hi + '</small>'; }, function (s) { return s.arrivals; }],
      ['Peak hours', function (s) { return '<b>' + fmt.hourLong(s.peakWin.start).replace(':00', '') + '–' + fmt.hourLong(s.peakWin.end).replace(':00', '') + '</b><small>peak ' + s.peakHourN + '/hr at ' + fmt.hourLong(s.peakHour) + '</small>'; }, function (s) { return s.peakHourN; }],
      ['Staffing needs', function (s) { return '<b>' + s.staff.recPeak + ' staff at peak</b><small>' + s.staff.level.label + (maxShort(s) > 0 ? ' · up to +' + maxShort(s) + ' vs roster' : '') + '</small>'; }, function (s) { return s.staff.recPeak; }],
      ['Fuel demand', function (s) { return '<b>' + gal(s.fuel.demand) + '</b><small>lowest reserve ' + gal(s.fuel.minInvStanding) + '</small>'; }, function (s) { return s.fuel.demand; }],
      ['Parking capacity', function (s) { return '<b>' + Math.round(s.parking.peakUtil * 100) + '% peak</b><small>' + (s.parking.overflowMax ? 'overflow +' + s.parking.overflowMax + ' positions' : s.parking.availAtPeak + ' positions free') + '</small>'; }, function (s) { return s.parking.peakUtil * 100; }],
      ['Estimated service delays', function (s) { return '<b>avg ' + Math.round(s.delay.avg) + ' min</b><small>peak ~' + Math.round(s.delay.peak) + ' min at ' + fmt.hourLong(s.delay.peakHour) + '</small>'; }, function (s) { return s.delay.peak; }],
      ['Operational risk', function (s) { return '<b class="risk-txt risk-' + s.risk.cls + '">' + s.risk.label + '</b><small>score ' + s.risk.score + '/100</small>'; }, function (s) { return s.risk.score; }]
    ];
    $('#sc-table').innerHTML = '<table class="tbl tbl-scen"><thead><tr><th>Metric</th>' + cols.map(function (c) { return '<th class="' + (c === k ? 'col-on' : '') + '"' + (c !== 'ordinary' ? ' data-s="' + c + '" tabindex="0" role="button"' : '') + '>' + (c === 'ordinary' ? 'Ordinary week' : Model.SCEN[c].label + ' demand') + (c === k ? ' ✓' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        const vals = cols.map(function (c) { return r[2](sums[c]); }), mx = Math.max.apply(null, vals) || 1;
        return '<tr><th scope="row">' + r[0] + '</th>' + cols.map(function (c, i) { return '<td class="' + (c === k ? 'col-on' : '') + '"' + (c !== 'ordinary' ? ' data-s="' + c + '"' : '') + '>' + r[1](sums[c]) + '<span class="mini-bar"><i style="width:' + Math.round(vals[i] / mx * 100) + '%;background:' + col[c] + '"></i></span></td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';

    const idx = function (f) { const base = f(ord) || 1; return keys.map(function (key) { return Math.round(f(sums[key]) / base * 100); }); };
    const m = [['Arrivals', function (s) { return s.arrivals; }], ['Peak staffing', function (s) { return s.staff.recPeak; }], ['Fuel demand', function (s) { return s.fuel.demand; }], ['Parking peak', function (s) { return s.parking.peakUtil; }]];
    const data = m.map(function (x) { return idx(x[1]); });
    Charts.render($('#ch-scen'), {
      height: 280, x: m.map(function (x) { return x[0]; }), labelW: 90, yTitle: 'Index (ordinary = 100)', ariaLabel: 'Scenario impact index',
      hlines: [{ y: 100, label: 'Ordinary week = 100', color: '#9a8fb8', dash: '4 4' }],
      series: keys.map(function (key, si) { return { name: Model.SCEN[key].label + ' demand', type: 'bar', color: col[key], opacity: key === k ? 1 : 0.55, data: data.map(function (row) { return row[si]; }), labels: true, fmt: function (v) { return v + ''; } }; })
    });
  }

  A.register('fuel', fuelUpdate, { page: 'fuel' });
  A.register('scenarios', scenUpdate, { page: 'forecast' });
})();
