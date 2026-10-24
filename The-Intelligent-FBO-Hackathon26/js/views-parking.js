/* Parking & Ramp: color-coded ramp map, aircraft table, filters, utilization chart and advisory recommendations.
   Positions are synthetic first-fit planning suggestions (Sim.prepare). A human always makes the final placement decision. */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt, CATS = Model.CATS, SERVICES = Model.SERVICES;
  const A = App, $ = A.$, UI = window.UI;
  const pf = { cat: 'all', svc: 'all', status: 'all', limit: 40 };
  const pad2 = function (n) { return String(n).padStart(2, '0'); };
  const decided = {};
  const clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  function mount() {
    const hourOpts = Array.from({ length: 24 }, function (_, h) { return '<option value="' + h + '">' + fmt.hourLong(h) + '</option>'; }).join('');
    $('#body-parking').innerHTML =
      '<div class="advisory" role="note">' + A.icon('shield', 22) + '<div><b>Planning view.</b> Ramp positions are suggested by the planner from forecast stay times. Final aircraft placement always needs human approval by FBO and airport operations.</div></div>' +
      '<div class="card filters" role="group" aria-label="Parking filters">' +
      '<label>Date<select id="pk-date">' + D.map(function (d) { return '<option value="' + d.idx + '">' + d.dow + ', ' + d.label + '</option>'; }).join('') + '</select></label>' +
      '<label>Time<select id="pk-hour">' + hourOpts + '</select></label>' +
      '<label>Aircraft type<select id="pk-cat"><option value="all">All types</option>' + CATS.map(function (c) { return '<option value="' + c.key + '">' + c.name + '</option>'; }).join('') + '</select></label>' +
      '<label>Service requirement<select id="pk-svc"><option value="all">Any service</option><option value="fuel">Fuel required</option><option value="nofuel">No fuel</option>' + SERVICES.map(function (s) { return '<option value="' + s.key + '">' + s.name + '</option>'; }).join('') + '</select></label>' +
      '<label>Status<select id="pk-status"><option value="all">All statuses</option>' + Sim.STATUS_KEYS.map(function (k) { return '<option value="' + k + '">' + Sim.STATUS[k].label + '</option>'; }).join('') + '<option value="conflict">Conflict only</option></select></label>' +
      '<div class="f-actions"><button type="button" class="btn btn-ghost btn-sm" id="pk-reset">Reset filters</button></div></div>' +
      '<div class="grid g-2-1"><article class="card"><div class="card-head"><div><h3>Ramp map</h3><p class="card-sub" id="pk-sub"></p></div><div class="legend-park" id="pk-legend" aria-label="Map legend"></div></div><div class="pmap" id="pk-map"></div><div class="stat-grid" id="pk-stats"></div></article>' +
      '<div class="stack"><article class="card"><div class="card-head"><div><h3>Utilization by hour</h3><p class="card-sub">Visitor positions in use (A + B + C + overflow)</p></div></div><div id="ch-park"></div></article>' +
      '<article class="card"><div class="card-head"><div><h3>Parking recommendations</h3><p class="card-sub">Advisory · needs human approval</p></div><div id="pk-dec"></div></div><div id="pk-recs"></div></article></div></div>' +
      '<article class="card" style="margin-top:16px"><div class="card-head"><div><h3>Aircraft on the ramp plan</h3><p class="card-sub" id="pk-tsub"></p></div><div class="chips" id="pk-chips" role="group" aria-label="Filter by status"></div></div><div id="pk-table"></div></article>';
    $('#meta-parking').innerHTML = A.dataChip('Synthetic · GET /api/v1/ramp/assignments');
    $('#pk-legend').innerHTML = [['sc-free', 'Available'], ['sc-occ', 'Occupied'], ['sc-res', 'Reserved'], ['sc-svc', 'Service in progress'], ['sc-conf', 'Conflict / unavailable']].map(function (l) { return '<span><i class="' + l[0] + '"></i>' + l[1] + '</span>'; }).join('');
    const bind = function (id, fn) { $(id).addEventListener('change', function (e) { fn(e.target.value); }); };
    bind('#pk-date', function (v) { A.setDate(+v); });
    bind('#pk-hour', function (v) { A.setHour(+v); });
    bind('#pk-cat', function (v) { pf.cat = v; pf.limit = 40; update(true); });
    bind('#pk-svc', function (v) { pf.svc = v; pf.limit = 40; update(true); });
    bind('#pk-status', function (v) { pf.status = v; pf.limit = 40; update(true); });
    $('#pk-reset').addEventListener('click', function () { pf.cat = 'all'; pf.svc = 'all'; pf.status = 'all'; pf.limit = 40; update(true); });
    $('#pk-chips').addEventListener('click', function (e) { const b = e.target.closest('button[data-st]'); if (b) { pf.status = b.dataset.st; pf.limit = 40; update(true); } });
    const act = function (e) {
      const el = e.target.closest('[data-aid]');
      if (e.target.id === 'pk-more') { pf.limit += 40; update(true); return; }
      if (el) UI.openAircraft(el.dataset.aid);
    };
    $('#pk-map').addEventListener('click', act); $('#pk-table').addEventListener('click', act);
    $('#pk-table').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-aid]')) { e.preventDefault(); act(e); } });
    $('#pk-dec').addEventListener('click', function (e) {
      if (!e.target.closest('button[data-dec]')) return;
      const key = A.state.scen + '-' + A.state.date, ok = e.target.closest('button').dataset.dec === 'approve';
      decided[key] = ok ? 'Approved by human (demo)' : 'Deferred for review';
      A.logDecision((ok ? 'Approved ' : 'Deferred ') + 'parking & overflow recommendations');
      A.toast((ok ? 'Recorded: human approved' : 'Recorded: deferred') + ' parking recommendations. Demo only, no systems were changed.', 'ok');
      recs();
    });
  }

  function matches(a, T) {
    if (pf.cat !== 'all' && a.cat !== pf.cat) return false;
    if (pf.svc === 'fuel' && !a.fuel.need) return false;
    if (pf.svc === 'nofuel' && a.fuel.need) return false;
    if (pf.svc !== 'all' && pf.svc !== 'fuel' && pf.svc !== 'nofuel' && a.svcs.indexOf(pf.svc) < 0) return false;
    if (pf.status === 'conflict') return !!a.conflict;
    if (pf.status !== 'all' && Sim.statusAt(a, T).key !== pf.status) return false;
    return true;
  }
  const filtersOn = function () { return pf.cat !== 'all' || pf.svc !== 'all' || pf.status !== 'all'; };

  function standHtml(code, cls, label, sub, opts) {
    opts = opts || {};
    const tag = opts.aid ? 'button type="button"' : 'div';
    const end = opts.aid ? 'button' : 'div';
    return '<' + tag + ' class="stand ' + cls + (opts.sel ? ' sel' : '') + (opts.dim ? ' dim' : '') + (opts.incoming ? ' incoming' : '') + '"' + (opts.aid ? ' data-aid="' + opts.aid + '"' : '') + ' title="' + (opts.title || code) + '" aria-label="' + (opts.title || code) + '"><span class="si">' + label + '</span><span class="sp">' + sub + '</span></' + end + '>';
  }

  function mapHtml(T) {
    const k = A.state.scen, M = A.M(), ramp = Sim.rampAt(M, k, T), present = ramp.present;
    const d = A.state.date;
    const bySlot = {};
    present.forEach(function (a) { const p = a.sim.pos; for (let i = 0; i < p.span; i++) bySlot[p.zone + (p.idx + i)] = { a: a, second: i === 1 }; });
    const incoming = {};
    Sim.dayRamp(M, k, d).forEach(function (a) { if (a.t > T && a.t <= T + 1) { const p = a.sim.pos; for (let i = 0; i < p.span; i++) incoming[p.zone + (p.idx + i)] = a; } });
    const zoneHtml = function (z, cls) {
      let cells = '', used = 0;
      for (let i = 0; i < z.n; i++) {
        const slot = bySlot[z.key + i], inc = incoming[z.key + i], code = z.key + '-' + pad2(i + 1);
        if (slot) {
          const a = slot.a, st = Sim.statusAt(a, T), isConf = !!a.conflict;
          const sc = isConf ? 'sc-conf' : st.key === 'servicing' ? 'sc-svc' : 'sc-occ';
          const dim = filtersOn() && !matches(a, T);
          used++;
          cells += standHtml(code, sc, slot.second ? '◂' : a.id.replace('AC-', ''), slot.second ? 'wide' : st.label.toLowerCase(), { aid: a.id, sel: UI.selectedAc === a.id, dim: dim, title: code + ' · ' + a.id + ' · ' + a.catName + ' · ' + st.label + (isConf ? ' · conflict' : '') });
        } else {
          cells += standHtml(code, 'sc-free', pad2(i + 1), inc ? 'soon' : 'free', { incoming: !!inc, dim: filtersOn() && pf.status !== 'conflict' ? true : false, title: code + ' · Available' + (inc ? ' · ' + inc.id + ' expected within the hour' : ''), aid: inc ? inc.id : null });
        }
      }
      return '<div class="zone ' + cls + '"><h4>' + z.name + ' <small>' + used + '/' + z.n + ' in use</small></h4><div class="stands">' + cells + '</div><p class="note" style="margin:6px 0 0">' + z.sub + '</p></div>';
    };
    let based = '', res = '', ovf = '';
    for (let i = 0; i < F.based; i++) based += standHtml('Based ' + (i + 1), 'sc-occ', 'B' + pad2(i + 1), 'based', { title: 'Based aircraft position ' + (i + 1) + ' (long-term, occupied)' });
    for (let i = 0; i < F.reserved; i++) res += standHtml('Reserved ' + (i + 1), 'sc-res', 'R' + pad2(i + 1), 'reserved', { title: 'Reserved position ' + (i + 1) + ' (airport / event hold)' });
    const ov = present.filter(function (a) { return a.sim.pos.overflow; });
    ov.forEach(function (a) { ovf += standHtml(a.sim.pos.code, a.conflict ? 'sc-conf' : Sim.statusAt(a, T).key === 'servicing' ? 'sc-svc' : 'sc-occ', a.id.replace('AC-', ''), a.sim.pos.code, { aid: a.id, sel: UI.selectedAc === a.id, dim: filtersOn() && !matches(a, T), title: a.sim.pos.code + ' · overflow · ' + a.id + ' (needs airport-ops approval)' }); });
    return zoneHtml(Sim.ZONES[0], 'zone-a') + zoneHtml(Sim.ZONES[1], 'zone-b') + zoneHtml(Sim.ZONES[2], 'zone-c') +
      '<div class="zone"><h4>Based aircraft <small>' + F.based + ' fixed</small></h4><div class="stands">' + based + '</div></div>' +
      '<div class="zone"><h4>Reserved <small>' + F.reserved + ' held</small></h4><div class="stands">' + res + '</div></div>' +
      '<div class="zone zone-wide"><h4>Overflow apron <small>' + ov.length + ' in use</small></h4>' + (ovf ? '<div class="stands">' + ovf + '</div><p class="note" style="margin:6px 0 0">Overflow use needs airport-operations approval.</p>' : '<p class="note" style="margin:0">No overflow parking needed at this time.</p>') + '</div>';
  }

  function recs() {
    const s = A.sm(), p = s.parking, key = A.state.scen + '-' + A.state.date;
    const items = [];
    if (p.peakUtil > 0.9) items.push(['risk', 'Utilization may exceed 90%', 'Peak ' + Math.round(p.peakUtil * 100) + '% at ' + fmt.hourLong(p.peakHour) + (p.first90 !== null ? ' (first above 90% around ' + fmt.hourLong(p.first90) + ')' : '') + '. Keep the reserved positions flexible and confirm the overflow plan.']);
    else items.push(['check', 'Within capacity', 'Peak utilization ' + Math.round(p.peakUtil * 100) + '% at ' + fmt.hourLong(p.peakHour) + ' with ' + p.availAtPeak + ' visitor positions free.']);
    if (p.firstOver !== null) items.push(['warn', 'Review the overflow parking plan', 'Demand may exceed ' + F.sellable + ' positions from ' + fmt.hourLong(p.firstOver) + ' (up to +' + p.overflowMax + '). Ask airport operations about apron space and offer flexible arrivals a later window.']);
    items.push(['plane', 'Large-cabin aircraft use wide spots', 'Apron A pairs positions for large and ultra-long-range aircraft; plan these first.']);
    if (s.conflicts.count) items.push(['warn', s.conflicts.count + ' scheduling conflict' + (s.conflicts.count === 1 ? '' : 's'), 'Red positions show overlap or unassigned service. Open an aircraft for details.']);
    $('#pk-recs').innerHTML = items.map(function (x) { return '<div class="rec"><span class="ico-wrap">' + A.icon(x[0], 20) + '</span><div><b>' + x[1] + '</b><small>' + x[2] + '</small></div></div>'; }).join('');
    $('#pk-dec').innerHTML = decided[key] ? '<span class="approved">' + A.icon('check', 14) + decided[key] + '</span>' : '<div class="decide"><button type="button" class="btn btn-sm btn-primary" data-dec="approve">Approve</button><button type="button" class="btn btn-sm btn-ghost" data-dec="defer">Defer</button></div>';
  }

  function tableHtml(T) {
    const k = A.state.scen, d = A.state.date;
    const rows = Sim.dayRamp(A.M(), k, d).filter(function (a) { return matches(a, T); }).sort(function (a, b) { return a.t - b.t; });
    const shown = rows.slice(0, pf.limit);
    return { n: rows.length, html: rows.length ? '<div class="table-scroll"><table class="tbl"><caption class="sr-only">Aircraft ramp plan with positions and status</caption><thead><tr><th>Aircraft ID</th><th>Category</th><th>Arrival</th><th>Est. departure</th><th>Position</th><th>Duration</th><th>Fuel service</th><th>Ground service</th><th>Status</th></tr></thead><tbody>' +
      shown.map(function (a) {
        const st = Sim.statusAt(a, T), sv = Sim.serviceText(a, T).split(' · ');
        const depDay = Math.floor(a.dep / 24), dep = UI.tod(a.dep) + (depDay !== a.d ? ' <small>' + D[Math.min(6, depDay)].dow + '</small>' : '');
        return '<tr tabindex="0" data-aid="' + a.id + '" class="row-click' + (UI.selectedAc === a.id ? ' sel' : '') + '"><td><span class="dot-t" style="--c:' + UI.catBy[a.cat].color + '"></span><b>' + a.id + '</b></td><td>' + a.catName + '</td><td>' + UI.eta(a) + (a.d !== d ? ' <small>' + D[a.d].dow + '</small>' : '') + '</td><td>' + dep + '</td>' +
          '<td><span class="pos' + (a.sim.pos.overflow ? ' pos-ovf' : '') + '">' + a.sim.pos.code + '</span></td><td>' + fmt.dur(a.dur) + '</td>' +
          '<td>' + (a.fuel.need ? '<b>Yes</b> <small>' + sv[1] + ' · ~' + fmt.int(a.fuel.gal) + ' gal</small>' : '<span class="muted">None</span>') + '</td><td><small>' + sv[0] + '</small>' + (a.svcs.length ? '<small class="muted"> · ' + a.svcs.length + ' add-on' + (a.svcs.length === 1 ? '' : 's') + '</small>' : '') + '</td>' +
          '<td>' + UI.pill(st) + (a.conflict ? ' <span class="st st-bad">Conflict</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (rows.length > shown.length ? '<button type="button" class="btn btn-ghost" id="pk-more">Show more (' + (rows.length - shown.length) + ' remaining)</button>' : '') : '<p class="empty">No aircraft match these filters for this day.</p>' };
  }

  function update(quiet) {
    if (!$('#pk-map')) mount();
    const k = A.state.scen, d = A.state.date, h = A.state.hour, T = UI.nowT(), M = A.M(), s = A.sm();
    $('#pk-date').value = d; $('#pk-hour').value = h; $('#pk-cat').value = pf.cat; $('#pk-svc').value = pf.svc; $('#pk-status').value = pf.status;
    const ramp = Sim.rampAt(M, k, T);
    $('#pk-sub').textContent = A.dayLabel(d) + ' · ' + fmt.hourLong(h) + ' · ' + A.SC().label + ' demand · click a position for aircraft details';
    $('#pk-map').innerHTML = mapHtml(T);
    const ucls = ramp.util > 1 ? 'red' : ramp.util >= 0.9 ? 'orange' : ramp.util >= 0.75 ? 'yellow' : 'green';
    $('#pk-stats').innerHTML =
      '<div class="stat stat-' + ucls + '"><span>Available now</span><b>' + ramp.available + '</b><small>of ' + F.transientRoom + ' visitor positions</small></div>' +
      '<div class="stat"><span>Visitors on ramp</span><b>' + ramp.present.length + '</b><small>' + ramp.usedTransient + ' positions used</small></div>' +
      '<div class="stat"><span>Servicing now</span><b>' + ramp.st.servicing + '</b><small>' + ramp.st.ready + ' ready · ' + ramp.st.arrived + ' arrived</small></div>' +
      '<div class="stat stat-' + ucls + '"><span>Utilization</span><b>' + Math.round(ramp.util * 100) + '%</b><small>incl. ' + F.based + ' based</small></div>' +
      '<div class="stat"><span>Overflow in use</span><b>' + ramp.overflow + '</b><small>needs ops approval</small></div>';
    // chart
    const zf = Sim.zoneFill(M, k, d), tot = zf.A.map(function (_, i) { return zf.A[i] + zf.B[i] + zf.C[i] + zf.O[i]; });
    Charts.render($('#ch-park'), {
      animate: !quiet, height: 270, x: UI.HOUR_LABELS, labelW: 30, yTitle: 'Positions in use', selected: h, ariaLabel: 'Visitor ramp positions in use by hour',
      hlines: [{ y: F.transientRoom, label: 'Visitor capacity ' + F.transientRoom, color: '#dc2626' }],
      series: [
        { name: 'Apron A', type: 'bar', stack: 's', color: '#4c1d95', data: zf.A }, { name: 'Apron B', type: 'bar', stack: 's', color: '#8b5cf6', data: zf.B },
        { name: 'Apron C', type: 'bar', stack: 's', color: '#c4b5fd', data: zf.C }, { name: 'Overflow', type: 'bar', stack: 's', color: '#ef4444', data: zf.O }
      ],
      onSelect: function (i) { A.setHour(i); },
      tooltip: function (i) { return UI.tt(UI.longDay(d), UI.hourRange(i), [{ c: '#4c1d95', l: 'Apron A', v: zf.A[i] }, { c: '#8b5cf6', l: 'Apron B', v: zf.B[i] }, { c: '#c4b5fd', l: 'Apron C', v: zf.C[i] }, { c: '#ef4444', l: 'Overflow', v: zf.O[i] }], 'Total ' + tot[i] + ' of ' + F.transientRoom + ' visitor positions (' + Math.round((tot[i] + F.based) / F.sellable * 100) + '% with based)<br><i>Synthetic estimate</i>'); }
    });
    recs();
    // table + chips
    const t = tableHtml(T);
    $('#pk-tsub').textContent = t.n + ' aircraft on the plan for ' + A.dayLabel(d) + ' · status as of ' + fmt.hourLong(h);
    $('#pk-table').innerHTML = t.html;
    const cnt = { all: 0 };
    Sim.STATUS_KEYS.forEach(function (x) { cnt[x] = 0; });
    Sim.dayRamp(M, k, d).forEach(function (a) { cnt.all++; cnt[Sim.statusAt(a, T).key]++; });
    $('#pk-chips').innerHTML = ['all'].concat(Sim.STATUS_KEYS).map(function (x) { return '<button type="button" class="chip chip-btn' + (pf.status === x ? ' on' : '') + '" data-st="' + x + '" aria-pressed="' + (pf.status === x) + '">' + (x === 'all' ? 'All' : Sim.STATUS[x].label) + ' <b>' + cnt[x] + '</b></button>'; }).join('');
  }

  /* "Show on ramp map" from the aircraft panel */
  function focus() {
    const id = UI.focusAc; if (!id) return;
    UI.focusAc = null;
    const a = UI.aircraftOf(id); if (!a) return;
    if (a.d !== A.state.date) A.setDate(a.d);
    const base = A.state.date * 24;
    if (!(a.t <= UI.nowT() && a.dep > UI.nowT())) A.setHour(clamp(a.t <= base + a.h + 0.5 ? a.h : a.h + 1, 0, 23));
    UI.selectedAc = id;
    pf.cat = 'all'; pf.svc = 'all'; pf.status = 'all';
    update(true);
    setTimeout(function () { const el = document.querySelector('#pk-map .stand[data-aid="' + id + '"]'); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('sel'); } }, 120);
  }

  A.register('parking', function () { update(false); }, { page: 'parking', onShow: focus });
  A.onHour(function () { if ($('#pk-map')) update(true); });
})();
