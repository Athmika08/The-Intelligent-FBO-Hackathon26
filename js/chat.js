/* AI Operations Assistant (chat).
   A rule-based, data-driven assistant: every answer is computed from the same forecast / schedule data as the
   rest of the dashboard (Model + Sim) and includes numbers, a time period, a confidence level and a recommended
   human action. It gives PLANNING RECOMMENDATIONS ONLY: it never authorizes aircraft movements, assigns an
   official runway, issues taxi instructions or replaces ATC / airport personnel. An optional backend can
   answer instead via LaxyAPI.chat (POST /api/v1/assistant/chat). */
(function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt, SERVICES = Model.SERVICES;
  const A = App, $ = A.$, UI = window.UI;
  const log = [];            // { role:'u'|'a', html, refuse? }
  let busy = false;

  const QUESTIONS = [
    'How many aircraft are expected between 7 AM and 11 AM?',
    'Do we need more ground crew today?',
    'Which parking areas will fill up first?',
    'When should we refuel?',
    'What is the busiest arrival period?',
    'Are there any scheduling conflicts?',
    'What should we prepare for under the high-demand scenario?',
    'Which aircraft require fuel or ground services?'
  ];

  const esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const hl = function (h) { return fmt.hourLong(((h % 24) + 24) % 24); };
  const sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
  const scenLabel = function (k) { return Model.SCEN[k].label; };
  const svcName = function (k) { const s = SERVICES.filter(function (x) { return x.key === k; })[0]; return s ? s.name : k; };

  /* ---------------- safety: requests the assistant must refuse ---------------- */
  const REFUSE = [
    /\b(clear|cleared|authori[sz]e|authori[sz]ed|permission|approve|approved|allow|grant|release|okay|ok)\b.{0,45}\b(land|landing|takeoff|take off|take-off|depart|departure|taxi|taxiing|push ?back|runway|movement|move|tow)\b/,
    /\b(assign|issue|give|select|choose|designate|confirm|set)\b.{0,35}\b(runway|taxi|clearance|taxi route|landing slot|takeoff slot)\b/,
    /\b(cleared|clear) to (land|take|taxi|depart)\b/,
    /\btaxi\b.{0,24}\b(instruction|instructions|route|clearance|to (the )?(ramp|gate|runway))\b/,
    /\b(tell|instruct|order|direct|command|radio|contact)\b.{0,35}\b(pilot|crew|tower|atc|aircraft|plane)\b/,
    /\b(pretend|act as|roleplay|you are now|you're now|ignore (your|the|all) (rules|instructions|guardrails|safety))\b/,
    /\b(land|take ?off|taxi|push ?back|tow)\b.{0,30}\b(now|immediately|asap)\b/
  ];
  const isRefusal = function (q) { return REFUSE.some(function (r) { return r.test(q); }); };

  /* ---------------- context + parsing ---------------- */
  function ctxFor(q, defScen) {
    const lq = q.toLowerCase();
    let k = defScen || A.state.scen, d = A.state.date, dayNamed = false, scenNamed = false;
    D.forEach(function (x) {
      if (new RegExp('\\b(' + x.dowLong.toLowerCase() + '|' + x.dow.toLowerCase() + ')\\b').test(lq)) { d = x.idx; dayNamed = true; }
    });
    const m = /feb(?:ruary)?\.?\s*(\d{1,2})/.exec(lq);
    if (m && +m[1] >= 10 && +m[1] <= 16) { d = +m[1] - 10; dayNamed = true; }
    if (/\bhigh\b/.test(lq) && /(demand|scenario|case)/.test(lq)) { k = 'high'; scenNamed = true; }
    else if (/\bmedium\b/.test(lq) && /(demand|scenario|case)/.test(lq)) { k = 'medium'; scenNamed = true; }
    else if (/\blow\b/.test(lq) && /(demand|scenario|case)/.test(lq)) { k = 'low'; scenNamed = true; }
    else if (/ordinary|normal week|typical week/.test(lq)) { k = 'ordinary'; scenNamed = true; }
    return { k: k, d: d, dayNamed: dayNamed, scenNamed: scenNamed, s: A.sm(k, d), M: A.M() };
  }

  function to24(h, ap) {
    h = +h;
    if (!ap) return h;
    ap = ap.toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) return h + 12;
    if (ap === 'am' && h === 12) return 0;
    return h;
  }
  function parseRange(q) {
    const lq = q.toLowerCase();
    const m = /(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:and|to|-|–|until|through|till)\s*(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/.exec(lq);
    if (m) {
      let ap1 = m[2], ap2 = m[4];
      if (!ap1 && ap2) { ap1 = ap2; if (to24(m[1], ap1) > to24(m[3], ap2) && ap2.replace(/\./g, '') === 'pm') ap1 = 'am'; }
      if (!ap2 && ap1) ap2 = ap1;
      let s = to24(m[1], ap1), e = to24(m[3], ap2);
      if (s >= 0 && s <= 24 && e >= 0 && e <= 24) { if (e <= s) e += 24; return { s: s, e: e, label: hl(s) + ' and ' + hl(e) }; }
    }
    if (/morning/.test(lq)) return { s: 6, e: 11, label: 'the morning peak (6:00 AM–11:00 AM)', soft: true };
    if (/afternoon/.test(lq)) return { s: 12, e: 17, label: 'the afternoon (12:00 PM–5:00 PM)', soft: true };
    if (/evening/.test(lq)) return { s: 17, e: 22, label: 'the evening (5:00 PM–10:00 PM)', soft: true };
    if (/overnight|night/.test(lq)) return { s: 22, e: 30, label: 'overnight (10:00 PM–6:00 AM)', soft: true };
    const one = /\b(?:at|around|about)\s+(\d{1,2})(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/.exec(lq);
    if (one) { const h = to24(one[1], one[2]); return { s: h, e: h + 1, label: hl(h) + ' hour', single: true }; }
    return null;
  }
  const dayText = function (x) { return D[x.d].dow + ', ' + D[x.d].label; };
  const periodChip = function (txt) { return '<span class="chip">' + A.icon('clock', 14) + txt + '</span>'; };

  /* ---------------- answer builder ---------------- */
  function answer(o) {
    return '<div class="head">' + o.head + '</div>' + (o.body || '') +
      '<div class="meta">' + (o.period ? periodChip(o.period) : '') + '<span class="chip">Scenario: <b>' + scenLabel(o.k) + '</b></span>' + (o.conf ? A.confBadge(o.conf) : '') + '<span class="chip chip-data">Synthetic estimate</span></div>' +
      (o.rec && o.rec.length ? '<div class="rec-act"><b>Recommended action' + (o.rec.length > 1 ? 's' : '') + ':</b>' + (o.rec.length > 1 ? '<ul>' + o.rec.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' : ' ' + o.rec[0]) + '</div>' : '') +
      '<div class="foot">' + A.icon('shield', 14) + 'Planning recommendation only · human review required · ATC and airport personnel remain in command</div>';
  }
  const table = function (heads, rows, clickable) {
    return '<div class="table-scroll"><table><thead><tr>' + heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr' + (clickable && r.aid ? ' data-aid="' + r.aid + '" tabindex="0" class="row-click"' : '') + '>' + r.cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  };

  /* ---------------- intents ---------------- */
  function ansArrivals(q) {
    const x = ctxFor(q), r = parseRange(q) || { s: 7, e: 11, label: hl(7) + ' and ' + hl(11) };
    const hours = []; for (let h = r.s; h < r.e; h++) hours.push(h % 24);
    const S = x.M.scen[x.k], base = x.M.scen.ordinary;
    const arr = hours.map(function (h) { return S.hourlyArr[x.d * 24 + h]; });
    const tot = sum(arr), conf = Model.confidenceHourly(tot, Model.SCEN[x.k].ci);
    const ordTot = sum(hours.map(function (h) { return base.hourlyArr[x.d * 24 + h]; }));
    const dayTot = x.s.arrivals, share = dayTot ? Math.round(tot / dayTot * 100) : 0;
    const pk = arr.indexOf(Math.max.apply(null, arr));
    const as = x.M.assistant(x.k, x.d);
    const capTot = sum(hours.map(function (h) { return as.capCur[h]; }));
    const grd = S.staff.ground;
    let gShort = 0; hours.forEach(function (h) { gShort = Math.max(gShort, grd.rec[x.d * 24 + h] - grd.cur[x.d * 24 + h]); });
    const label = r.soft ? r.label : 'between ' + r.label;
    const rec = [];
    if (gShort > 0) rec.push('Add ' + gShort + ' ground handler' + (gShort === 1 ? '' : 's') + ' for this period (recommended roster ' + (grd.rec[x.d * 24 + hours[pk]]) + ' vs. ' + grd.cur[x.d * 24 + hours[pk]] + ' scheduled at ' + hl(hours[pk]) + '). The operations manager must approve roster changes.');
    else rec.push('The current roster covers this period. Keep monitoring the next forecast refresh.');
    if (tot > capTot * 0.85) rec.push('Arrivals are close to ground-service capacity (about ' + capTot + ' services in this period). Offer flexible arrivals a later window and keep spacing at ' + as.spacingMin + '+ minutes.');
    return answer({
      k: x.k, conf: conf, period: label.replace(/^between /, '').replace(' and ', '–') + ' · ' + dayText(x),
      head: 'About ' + tot + ' aircraft expected ' + (r.single ? 'in the ' + label : label.replace(/^the /, 'in the ')),
      body: '<p>For <b>' + dayText(x) + '</b> under the <b>' + scenLabel(x.k) + '</b> scenario the model expects <b>' + tot + ' arrivals</b> (likely range ' + conf.lo + '–' + conf.hi + '), which is <b>' + share + '%</b> of the day\'s ' + dayTot + ' arrivals and ' + (tot - ordTot >= 0 ? (ordTot ? Math.round((tot / ordTot - 1) * 100) + '% above' : 'well above') : Math.round((1 - tot / Math.max(ordTot, 1)) * 100) + '% below') + ' an ordinary week (' + ordTot + ').</p>' +
        '<div class="chips">' + hours.map(function (h, i) { return '<span class="chip' + (i === pk && tot ? ' on' : '') + '"><b>' + UI.hourShort(h) + '</b> ' + arr[i] + '</span>'; }).join('') + '</div>' +
        '<p class="note">Busiest hour in this period: <b>' + hl(hours[pk]) + '</b> with ' + arr[pk] + ' arrivals.</p>',
      rec: rec
    });
  }

  function ansCrew(q) {
    const x = ctxFor(q), S = x.M.scen[x.k], g = S.staff.ground, d0 = x.d * 24;
    const sh = []; for (let h = 0; h < 24; h++) sh.push(g.rec[d0 + h] - g.cur[d0 + h]);
    const mx = Math.max.apply(null, sh), from = sh.findIndex(function (v) { return v > 0; });
    let to = from; while (to + 1 < 24 && sh[to + 1] > 0) to++;
    const hrs = sh.filter(function (v) { return v > 0; }).length;
    const peakH = sh.indexOf(mx);
    const st = x.s.staff, conf = x.s.ci.conf;
    const top = st.shortages.slice(0, 4);
    const yes = mx > 0;
    return answer({
      k: x.k, conf: conf, period: dayText(x) + (yes ? ' · ' + hl(from) + '–' + hl(to + 1) : ''),
      head: yes ? 'Yes, add about ' + mx + ' ground handler' + (mx === 1 ? '' : 's') + ' at the peak' : 'The ground roster looks sufficient',
      body: yes ? '<p>On <b>' + dayText(x) + '</b> (' + scenLabel(x.k) + ' demand) the recommended ground-handling roster exceeds the current schedule for <b>' + hrs + ' hour' + (hrs === 1 ? '' : 's') + '</b>, mostly <b>' + hl(from) + '–' + hl(to + 1) + '</b>. The biggest gap is <b>+' + mx + '</b> at ' + hl(peakH) + ' (' + g.rec[d0 + peakH] + ' recommended vs. ' + g.cur[d0 + peakH] + ' scheduled). Across all roles the day is covered at <b>' + st.coverage + '%</b> of recommended staffing; surge level: <b>' + st.level.label + '</b>.</p>' +
        (top.length ? table(['Role', 'Short by', 'Window'], top.map(function (t) { return { cells: [t.roleName, '+' + t.n, hl(t.from) + '–' + hl(t.to)] }; })) : '') :
        '<p>On <b>' + dayText(x) + '</b> (' + scenLabel(x.k) + ' demand) the scheduled ground handlers meet the recommendation all day. Overall coverage is <b>' + st.coverage + '%</b> of recommended staffing (peak need ' + st.recPeak + ' people vs. ' + st.curPeak + ' scheduled).</p>',
      rec: yes ? ['Add ' + (mx >= 2 ? 'two' : 'one') + ' ground handler' + (mx >= 2 ? 's' : '') + ' during the peak (' + hl(from) + '–' + hl(to + 1) + ') and consider an on-call pair for ' + hl(peakH) + '.', 'Ask the operations manager to approve the roster change; this tool does not change any schedule.'] : ['No change needed. Re-check after the next forecast refresh.']
    });
  }

  function ansParking(q) {
    const x = ctxFor(q), zf = Sim.zoneFill(x.M, x.k, x.d);
    const why = { A: 'Large-cabin and ultra-long-range jets need wide, paired spots and stay longest.', B: 'Midsize and light jets are the largest group of arrivals.', C: 'Turboprops and helicopters are few and short-stay.' };
    const rows = Sim.ZONES.map(function (z) {
      const a = zf[z.key], mx = Math.max.apply(null, a), ph = a.indexOf(mx);
      const first = a.findIndex(function (v) { return v >= 0.9 * z.n; });
      const f80 = a.findIndex(function (v) { return v >= 0.8 * z.n; });
      return { z: z, mx: mx, ph: ph, first: first, f80: f80, key: first >= 0 ? first : f80 >= 0 ? 100 + f80 : 200 - mx / z.n * 100 };
    }).sort(function (a, b) { return a.key - b.key; });
    const t = rows[0], conf = x.s.ci.conf, p = x.s.parking;
    const ovMax = Math.max.apply(null, zf.O);
    return answer({
      k: x.k, conf: conf, period: dayText(x) + ' · peak ' + hl(p.peakHour),
      head: t.first >= 0 ? t.z.name + ' is expected to fill first (around ' + hl(t.first) + ')' : t.z.name + ' is the most heavily used area (peak ' + Math.round(t.mx / t.z.n * 100) + '%)',
      body: '<p>Ramp usage by area on <b>' + dayText(x) + '</b> (' + scenLabel(x.k) + ' demand). Overall visitor-ramp utilization peaks at <b>' + Math.round(p.peakUtil * 100) + '%</b> around ' + hl(p.peakHour) + (p.firstOver !== null ? ', and demand may exceed the ' + F.sellable + ' sellable positions from <b>' + hl(p.firstOver) + '</b>' : '') + '.</p>' +
        table(['Order', 'Area', 'Spots', '≥90% full', 'Peak use', 'Why'], rows.map(function (r, i) {
          return { cells: [i + 1, r.z.name, r.z.n, r.first >= 0 ? '<b>' + hl(r.first) + '</b>' : '<span class="muted">not reached</span>', Math.round(r.mx / r.z.n * 100) + '% at ' + hl(r.ph), '<small>' + why[r.z.key] + '</small>'] };
        })) + (ovMax ? '<p class="note"><b>Overflow:</b> up to ' + ovMax + ' aircraft may need the overflow apron, which requires airport-operations approval.</p>' : ''),
      rec: ['Hold the ' + F.reserved + ' reserved positions flexible and pre-plan placements for large-cabin aircraft in Apron A first.', p.firstOver !== null || p.peakUtil > 0.9 ? 'Review the overflow parking plan with airport operations and offer flexible arrivals later windows. Final placement needs human approval.' : 'No overflow is expected; keep a few positions free for unscheduled arrivals.']
    });
  }

  function ansRefuel(q) {
    const x = ctxFor(q), f = x.s.fuel, conf = x.s.ci.conf;
    const dh = f.demandHourly.length === 24 ? f.demandHourly : Model.daySlice(f.demandHourly, x.d);
    const order = dh.map(function (v, h) { return { h: h, v: v }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 3);
    const dl = f.deliveries[0], low = f.minInvStanding < F.safety;
    const pkJobs = order[0];
    return answer({
      k: x.k, conf: conf, period: dayText(x) + (dl ? ' · delivery by ' + fmt.abs(dl.at) : ''),
      head: dl ? 'Refuel the FBO fuel farm with an extra delivery arriving by ' + fmt.abs(dl.at) : 'The standing 2:00 AM delivery should cover demand',
      body: '<p>Estimated fuel demand on <b>' + dayText(x) + '</b> is <b>' + fmt.int(f.demand) + ' gal</b> across <b>' + f.aircraftFueled + ' aircraft fuel services</b> (about ' + fmt.int(f.avgGal) + ' gal each). The busiest fueling hours are <b>' + order.map(function (o) { return hl(o.h) + ' (' + fmt.int(o.v) + ' gal)'; }).join(', ') + '</b>.</p>' +
        '<p>With only the standing delivery, the lowest projected inventory is <b>' + fmt.int(f.minInvStanding) + ' gal</b> vs. a ' + fmt.int(F.safety) + ' gal safety threshold' + (low ? (f.breachHour !== null ? ', dropping below it from about <b>' + hl(f.breachHour) + '</b>' : '') + '.' : ', so reserves stay above the threshold.') + (dl ? ' Fuel readiness is <b>' + f.readiness + '%</b> now and <b>' + f.readinessRec + '%</b> with the recommended delivery.' : '') + '</p>',
      rec: dl ? ['Order an extra ' + fmt.int(dl.gal) + ' gal delivery by ' + fmt.abs(dl.order) + ' so it arrives by ' + fmt.abs(dl.at) + ' (before the demand peak).', 'Stage fuel trucks 30 minutes before ' + hl(pkJobs.h) + ' and keep the busiest hours\' service windows free. The fuel supervisor approves orders; this tool places none.'] : ['Keep the standing delivery and stage trucks before ' + hl(pkJobs.h) + '.', 'Re-check after each forecast refresh. The fuel supervisor decides on any extra order.']
    });
  }

  function ansBusiest(q) {
    const x = ctxFor(q), s = x.s, S = x.M.scen[x.k];
    const hrs = s.hourlyArr.map(function (v, h) { return { h: h, v: v }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 3);
    const days = S.dailyArr.map(function (v, i) { return { d: i, v: v }; }).sort(function (a, b) { return b.v - a.v; });
    const share = s.arrivals ? Math.round(s.peakWin.count / s.arrivals * 100) : 0;
    const conf = Model.confidenceHourly(s.peakWin.count, Model.SCEN[x.k].ci);
    const as = x.M.assistant(x.k, x.d);
    return answer({
      k: x.k, conf: conf, period: hl(s.peakWin.start) + '–' + hl(s.peakWin.end) + ' · ' + dayText(x),
      head: 'Busiest arrival period: ' + hl(s.peakWin.start) + '–' + hl(s.peakWin.end),
      body: '<p>On <b>' + dayText(x) + '</b> (' + scenLabel(x.k) + ' demand) about <b>' + s.peakWin.count + ' of ' + s.arrivals + ' arrivals (' + share + '%)</b> fall in this five-hour window (likely range ' + conf.lo + '–' + conf.hi + '). The single busiest hour is <b>' + hl(s.peakHour) + '</b> with <b>' + s.peakHourN + '</b> arrivals; the next busiest are ' + hrs.slice(1).map(function (o) { return hl(o.h) + ' (' + o.v + ')'; }).join(' and ') + '.</p>' +
        '<p class="note">Across the week the busiest day is <b>' + D[days[0].d].dowLong + ', Feb ' + D[days[0].d].date + '</b> with ' + days[0].v + ' arrivals' + (days[0].d !== x.d ? '; the selected day is ' + dayText(x) + '.' : '.') + '</p>',
      rec: ['Staff and fuel for the peak at ' + hl(s.peakHour) + ' and keep arrivals spaced at least ' + as.spacingMin + ' minutes apart.', s.peakHourN > (as.capCur[s.peakHour] || 0) ? 'Offer flexible arrivals a window outside ' + hl(s.peakWin.start) + '–' + hl(s.peakWin.end) + ' (humans decide).' : 'Peak demand is within ground-service capacity at the current roster.']
    });
  }

  function ansConflicts(q) {
    const x = ctxFor(q), s = x.s, list = x.M.dayAircraft(x.k, x.d).filter(function (a) { return a.conflict; }).sort(function (a, b) { return a.t - b.t; });
    const rd = Sim.runwayDay(x.M, x.k, x.d), rc = rd.conflicts.filter(function (c) { return c.sev !== 'info'; });
    const n = s.conflicts.count, conf = x.s.ci.conf;
    const rows = list.slice(0, 6).map(function (a) {
      const w = a.warnings.filter(function (v) { return v.level === 'conflict'; })[0] || a.warnings[0];
      return { aid: a.id, cells: ['<b>' + a.id + '</b>', UI.eta(a), a.catName, '<span class="pos' + (a.sim.pos.overflow ? ' pos-ovf' : '') + '">' + a.sim.pos.code + '</span>', '<small>' + (w ? w.text : 'Overlapping service window') + '</small>'] };
    });
    return answer({
      k: x.k, conf: conf, period: dayText(x),
      head: n ? n + ' scheduling conflict' + (n === 1 ? '' : 's') + ' detected' : 'No scheduling conflicts detected',
      body: n ? '<p>On <b>' + dayText(x) + '</b> (' + scenLabel(x.k) + ' demand) <b>' + n + ' aircraft</b> have overlapping service windows, unassigned handlers or no free ramp position. <b>' + Math.max(0, n - s.conflicts.planCount) + '</b> of them would be resolved if the recommended staffing, spacing and overflow plans are approved. There ' + (rc.length === 1 ? 'is' : 'are') + ' also <b>' + rc.length + '</b> possible runway-planning spacing note' + (rc.length === 1 ? '' : 's') + ' (advisory only).</p>' + table(['Aircraft', 'ETA', 'Type', 'Ramp', 'Issue'], rows, true) + (n > rows.length ? '<p class="note">Showing the first ' + rows.length + '. Open the Live Schedule and filter “Conflicts only” for the rest.</p>' : '<p class="note">Click a row for the full aircraft detail panel.</p>') :
        '<p>On <b>' + dayText(x) + '</b> (' + scenLabel(x.k) + ' demand) no overlapping service windows or ramp conflicts are expected. Overflow parking is ' + (s.parking.overflowMax ? 'possible (up to +' + s.parking.overflowMax + ')' : 'not expected') + '.</p>',
      rec: n ? ['Approve the recommended staffing and spacing so conflicting service windows can be staggered.', 'Review the overflow parking plan for aircraft without a free ramp position. <a href="#schedule">Open Live Schedule →</a>'] : ['No action needed now. Re-check after each forecast refresh.']
    });
  }

  function ansPrepare(q) {
    const x = ctxFor(q, 'high'), s = x.s, k = x.k, d = x.d;
    const sc = Model.SCEN[k], cur = A.sm(A.state.scen, d);
    const alerts = x.M.alerts(k, d), crit = alerts.filter(function (a) { return a.sev === 'critical' || a.sev === 'high'; });
    const f = s.fuel, dl = f.deliveries[0], st = s.staff, p = s.parking;
    const as = x.M.assistant(k, d);
    const lines = [
      ['Arrivals', '<b>' + s.arrivals + '</b> expected (range ' + s.ci.lo + '–' + s.ci.hi + '), peak ' + hl(s.peakWin.start) + '–' + hl(s.peakWin.end) + ', busiest hour ' + hl(s.peakHour) + ' (' + s.peakHourN + ')'],
      ['Parking', 'Utilization up to <b>' + Math.round(p.peakUtil * 100) + '%</b> at ' + hl(p.peakHour) + (p.overflowMax ? '; overflow up to <b>+' + p.overflowMax + '</b> aircraft' : '; no overflow expected')],
      ['Staffing', 'Peak need <b>' + st.recPeak + '</b> people vs. ' + st.curPeak + ' scheduled (' + st.level.label.replace(' - ', ': ') + ')' + (st.shortages[0] ? '; largest gap +' + st.shortages[0].n + ' ' + st.shortages[0].roleName.toLowerCase() + ' ' + hl(st.shortages[0].from) + '–' + hl(st.shortages[0].to) : '')],
      ['Fuel', '<b>' + fmt.int(f.demand) + ' gal</b> demand; lowest standing reserve ' + fmt.int(f.minInvStanding) + ' gal (threshold ' + fmt.int(F.safety) + ')'],
      ['Delays', 'Service delay up to <b>~' + Math.round(s.delay.peak) + ' min</b> at ' + hl(s.delay.peakHour) + '; ' + s.conflicts.count + ' scheduling conflicts'],
      ['Risk', '<b>' + s.risk.label + '</b> (score ' + s.risk.score + '/100) · ' + alerts.length + ' alerts, ' + crit.length + ' urgent']
    ];
    const steps = [];
    if (st.shortages[0]) steps.push('<b>Staffing:</b> add ' + (st.shortages[0].n >= 2 ? 'two' : 'one') + ' ' + st.shortages[0].one + (st.shortages[0].n >= 2 ? 's' : '') + ' ' + hl(st.shortages[0].from) + '–' + hl(st.shortages[0].to) + '; plan a surge roster for ' + hl(s.peakWin.start) + '–' + hl(s.peakWin.end) + '.');
    if (dl) steps.push('<b>Fuel:</b> order an extra ' + fmt.int(dl.gal) + ' gal by ' + fmt.abs(dl.order) + ' (arriving ' + fmt.abs(dl.at) + ').');
    steps.push('<b>Parking:</b> ' + (p.overflowMax || p.peakUtil > 0.9 ? 'confirm the overflow apron plan and keep reserved positions flexible.' : 'keep a few positions free for unscheduled arrivals.'));
    steps.push('<b>Arrival spacing:</b> keep at least ' + as.spacingMin + ' minutes between arrivals around ' + hl(s.peakHour) + '; offer flexible arrivals later windows.');
    steps.push('<b>Communication:</b> brief handlers and operators on expected waits of ~' + Math.round(s.delay.peak) + ' minutes at the peak.');
    return answer({
      k: k, conf: s.ci.conf, period: dayText(x),
      head: 'Preparing for the ' + sc.label + '-demand scenario on ' + dayText(x),
      body: '<p>If demand follows the <b>' + sc.label + '</b> scenario' + (A.state.scen !== k ? ' (the dashboard is currently set to ' + scenLabel(A.state.scen) + ': ' + cur.arrivals + ' arrivals)' : '') + ', expect:</p><ul>' + lines.map(function (l) { return '<li><b>' + l[0] + ':</b> ' + l[1] + '</li>'; }).join('') + '</ul>',
      rec: steps
    });
  }

  function ansServices(q) {
    const x = ctxFor(q), T = x.d === A.state.date ? UI.nowT() : x.d * 24, k = x.k;
    const all = Sim.dayRamp(x.M, k, x.d);
    const fuelAll = all.filter(function (a) { return a.fuel.need; }), svcAll = all.filter(function (a) { return a.svcs.length; });
    const next = function (a) { const s = a.sim, c = []; if (s.svcEnd > T) c.push(Math.max(s.svcStart, T)); if (a.fuel.need && s.fuelEnd > T) c.push(Math.max(s.fuelStart, T)); return c.length ? Math.min.apply(null, c) : null; };
    const pend = all.filter(function (a) { return a.dep > T && (a.fuel.need || a.svcs.length) && next(a) !== null; }).sort(function (a, b) { return next(a) - next(b); });
    const rows = pend.slice(0, 8).map(function (a) {
      return { aid: a.id, cells: ['<b>' + a.id + '</b>', UI.eta(a), a.catName, a.fuel.need ? 'Fuel ~' + fmt.int(a.fuel.gal) + ' gal<br><small>' + UI.fuelWin(a) + '</small>' : '<span class="muted">No fuel</span>', a.svcs.length ? '<small>' + a.svcs.map(svcName).join(', ') + '</small>' : '<small>Standard handling</small>', Sim.teamShort(a), UI.pill(Sim.statusAt(a, T))] };
    });
    const conf = x.s.ci.conf, next2 = pend.filter(function (a) { return next(a) < T + 2; });
    return answer({
      k: k, conf: conf, period: dayText(x) + (x.d === A.state.date ? ' · from ' + fmt.hourLong(A.state.hour) : ''),
      head: pend.length + ' aircraft still need fuel or ground services',
      body: '<p>For <b>' + dayText(x) + '</b> (' + scenLabel(k) + ' demand): <b>' + fuelAll.length + '</b> of ' + all.length + ' aircraft on the ramp plan are expected to buy fuel (~' + fmt.int(sum(fuelAll.map(function (a) { return a.fuel.gal; }))) + ' gal) and <b>' + svcAll.length + '</b> request add-on ground services (lavatory, catering, GPU, crew transport and similar). Standard handling applies to every aircraft. As of ' + (x.d === A.state.date ? fmt.hourLong(A.state.hour) : 'the start of the day') + ', <b>' + pend.length + '</b> still have service ahead, <b>' + next2.length + '</b> of them within two hours.</p>' +
        (rows.length ? table(['Aircraft', 'ETA', 'Type', 'Fuel', 'Ground services', 'Team', 'Status'], rows, true) + (pend.length > rows.length ? '<p class="note">Showing the next ' + rows.length + ' of ' + pend.length + ' by service start. Click a row for details.</p>' : '<p class="note">Click a row for details.</p>') : '<p class="empty">No pending fuel or add-on services at this time.</p>'),
      rec: ['Stage ' + Math.min(3, Math.max(1, Math.ceil(next2.filter(function (a) { return a.fuel.need; }).length / 2))) + ' fuel truck(s) and the handler teams listed above before the next service windows.', 'Sequence service starts at least ' + x.M.assistant(k, x.d).spacingMin + ' minutes apart during busy hours. <a href="#schedule">Open Live Schedule →</a>']
    });
  }

  function ansAircraft(id) {
    const a = UI.aircraftOf(id.toUpperCase());
    if (!a) return '<div class="head">I can\'t find ' + esc(id.toUpperCase()) + '</div><p>That ID is not in the current scenario\'s schedule. Aircraft IDs are anonymous (for example AC-0412) and change between scenarios.</p>';
    const T = UI.nowT(), st = Sim.statusAt(a, T);
    return answer({
      k: A.state.scen, conf: A.sm().ci.conf, period: D[a.d].dow + ' · est. arrival ' + UI.eta(a),
      head: a.id + ' · ' + a.catName,
      body: '<ul><li>Estimated arrival <b>' + UI.eta(a) + '</b>, departure <b>' + UI.tod(a.dep) + '</b> (' + fmt.dur(a.dur) + ' on the ramp)</li><li>Suggested ramp position <b>' + a.sim.pos.code + '</b>' + (a.sim.pos.overflow ? ' (overflow, needs airport-ops approval)' : '') + '</li><li>Fuel: ' + (a.fuel.need ? '~' + fmt.int(a.fuel.gal) + ' gal, window ' + UI.fuelWin(a) : 'none') + ' · Ground services: ' + (a.svcs.length ? a.svcs.map(svcName).join(', ') : 'standard handling') + ' · ' + Sim.teamShort(a) + '</li><li>Status now: ' + UI.pill(st) + '</li>' + (a.warnings.length ? '<li>⚠ ' + a.warnings.map(function (w) { return w.text; }).join('; ') + '</li>' : '') + '</ul><p><button type="button" class="btn btn-ghost btn-sm" data-aid="' + a.id + '">Open full detail panel</button></p>',
      rec: ['Review the suggested position and service windows with the shift supervisor; final placement needs human approval.']
    });
  }

  function ansRunway(q) {
    const x = ctxFor(q), rd = Sim.runwayDay(x.M, x.k, x.d), fl = rd.flow;
    const rows = fl.rwys.map(function (r, i) { const arr = rd.by[r], pk = Math.max.apply(null, rd.hourly[r]); return { cells: [r, Sim.RW_ROLE[i], arr.length, pk ? UI.hourShort(rd.hourly[r].indexOf(pk)) + ' (' + pk + ')' : '—'] }; });
    const rc = rd.conflicts.filter(function (c) { return c.sev !== 'info'; });
    return answer({
      k: x.k, conf: x.s.ci.conf, period: dayText(x),
      head: 'Runway planning view (advisory only)',
      body: '<p>I can share a <b>planning estimate</b> only. For ' + dayText(x) + ' the synthetic weather suggests <b>' + fl.label.toLowerCase() + '</b> (' + fl.rwys.join(', ') + '). The estimated spread of arrivals is below; ' + rc.length + ' possible spacing note' + (rc.length === 1 ? '' : 's') + ' were found.</p>' + table(['Runway', 'Planning role', 'Arrivals', 'Peak hour'], rows) +
        '<p class="note"><b>' + A.ADVISORY + '</b></p>',
      rec: ['Use the Runway Operations page for availability, notes and recommended arrival windows. Share only as planning input with airport operations. <a href="#runway">Open Runway Operations →</a>']
    });
  }

  function ansAlerts(q) {
    const x = ctxFor(q), list = x.M.alerts(x.k, x.d), act = list.filter(function (a) { return !A.state.ack[a.id]; });
    const top = act.slice(0, 4);
    return answer({
      k: x.k, conf: x.s.ci.conf, period: dayText(x),
      head: act.length + ' active alert' + (act.length === 1 ? '' : 's') + ' · risk ' + x.s.risk.label.toLowerCase(),
      body: '<p>Operational risk is <b>' + x.s.risk.label + '</b> (' + x.s.risk.score + '/100). Estimated service delay peaks near <b>' + Math.round(x.s.delay.peak) + ' min</b> at ' + hl(x.s.delay.peakHour) + ' (about ' + Math.round(x.s.delay.peakPlan) + ' min with recommended staffing).</p>' +
        (top.length ? '<ul>' + top.map(function (a) { return '<li><b>' + A.sevLabel[a.sev] + ':</b> ' + a.title + ' <small>(' + a.time + ')</small></li>'; }).join('') + '</ul>' : '<p>No unacknowledged alerts.</p>'),
      rec: top.length ? ['Acknowledge or assign each alert to a supervisor in the Alerts Center. <a href="#dashboard/alerts">Open Alerts Center →</a>'] : ['No action needed now.']
    });
  }

  function ansPlacement(q) {
    const m = /ac-\d{3,5}/i.exec(q), a = m && UI.aircraftOf(m[0].toUpperCase());
    return '<div class="head">I can suggest, but people decide</div><p>I can suggest a ramp position and service plan as a <b>planning recommendation</b>, but final aircraft placement always needs approval from FBO and airport operations. ' +
      (a ? 'For <b>' + a.id + '</b> the planner currently suggests <b>' + a.sim.pos.code + '</b>' + (a.sim.pos.overflow ? ' (overflow, needs airport-ops approval)' : '') + '. <button type="button" class="btn btn-ghost btn-sm" data-aid="' + a.id + '">Open detail panel</button>' : 'Give me an aircraft ID (for example AC-0412) to see its suggested position, or open Parking &amp; Ramp.') + '</p>' +
      '<div class="foot">' + A.icon('shield', 14) + 'Planning recommendation only · human approval required</div>';
  }

  function refusal() {
    return '<div class="head">' + A.icon('warn', 18) + ' I can\'t do that</div>' +
      '<p>I\'m a planning assistant. I <b>can\'t authorize or clear</b> takeoffs, landings or taxiing, <b>assign an official runway</b>, issue taxi instructions, or direct any aircraft movement. Air traffic control, airport authorities and certified personnel make those decisions.</p>' +
      '<p><b>What I can do instead:</b></p><ul><li>Share forecast arrival counts and busy periods</li><li>Suggest planning windows, spacing, parking, fuel and staffing actions for humans to review</li><li>Show advisory runway planning estimates</li></ul>' +
      '<div class="rec-act"><b>' + A.ADVISORY + '</b></div>' +
      '<div class="foot">' + A.icon('shield', 14) + 'Planning recommendation only · human review required</div>';
  }

  function welcome() {
    const x = ctxFor('');
    return '<div class="head">Hello, I\'m the LAXY Operations Assistant</div><p>I answer questions about Super Bowl LXI week using the forecast and schedule data on this dashboard: arrivals, parking, fuel, staffing, delays and conflicts. Right now I\'m looking at <b>' + dayText(x) + '</b> under the <b>' + scenLabel(x.k) + '</b> scenario (' + x.s.arrivals + ' expected arrivals).</p><p>Try a suggested question below or type your own. You can name a time (“between 6 and 9 AM”), a day (“on Saturday”) or a scenario (“under the low-demand scenario”).</p>' +
      '<div class="foot">' + A.icon('shield', 14) + 'I give planning recommendations only. Humans review everything; ATC and airport personnel remain in command.</div>';
  }
  function helpText() {
    return '<div class="head">Here\'s what I can help with</div><ul><li>Arrival counts for any time window (“How many aircraft between 7 AM and 11 AM?”)</li><li>Ground crew, staffing gaps and surge levels</li><li>Parking areas that fill first and overflow</li><li>Fuel demand and when to replenish</li><li>Busiest periods, scheduling conflicts and delays</li><li>What to prepare under the high-, medium- or low-demand scenarios</li><li>Which aircraft need fuel or ground services, or details for an ID like AC-0412</li></ul><div class="foot">' + A.icon('shield', 14) + 'Planning recommendations only · human review required</div>';
  }

  /* ---------------- router ---------------- */
  function respond(q) {
    const lq = q.toLowerCase().replace(/\s+/g, ' ').trim();
    if (isRefusal(lq)) return { html: refusal(), refuse: true };
    const id = /ac-\d{3,5}/i.exec(q);
    if (/\b(assign|place|park|put|position|spot)\b/.test(lq) && /\b(spot|stand|position|apron|parking|ramp)\b/.test(lq) && id) return { html: ansPlacement(q) };
    if (id && !/\b(fuel|service|conflict)s?\b/.test(lq.replace(id[0].toLowerCase(), ''))) return { html: ansAircraft(id[0]) };
    if (/^(hi|hello|hey|help|what can you do|who are you)\b/.test(lq) || /what can you (do|help)/.test(lq)) return { html: helpText() };
    if (/(prepare|preparation|get ready|plan for|readiness).*(scenario|demand|high|medium|low)|(scenario|high[- ]demand|worst[- ]case).*(prepare|plan|ready|happen|look like)|what if demand/.test(lq)) return { html: ansPrepare(q) };
    if (/(which|what|list|show).*(aircraft|jets?|planes?).*(fuel|service|handling|gpu|lav|cater)|(fuel|ground service|services).*(aircraft|require|need)/.test(lq) && !/when|refuel|fuel farm|reserve|inventory/.test(lq)) return { html: ansServices(q) };
    if (/\bconflicts?\b|overlap|double[- ]book|clash/.test(lq)) return { html: ansConflicts(q) };
    if (/(how many|number of|count|expected|arrivals?|arriving|coming in).*(between|from|\d\s*(am|pm)|morning|afternoon|evening|overnight|\d{1,2}\s*(to|-|and)\s*\d{1,2})|between \d/.test(lq) && !/busiest|peak period|busy/.test(lq)) return { html: ansArrivals(q) };
    if (/ground crew|ground handler|handlers?|crew|staff|roster|personnel|manpower|headcount/.test(lq)) return { html: ansCrew(q) };
    if (/park|ramp|apron|overflow|spots?|stands?|fill up/.test(lq)) return { html: ansParking(q) };
    if (/refuel|fuel|jet-?a|gallon|tanker|truck|reserve|inventory/.test(lq)) return { html: ansRefuel(q) };
    if (/busiest|peak|rush|busy|crowded|heaviest|most arrivals/.test(lq)) return { html: ansBusiest(q) };
    if (/runway|24r|25l|6l|7r|flow|wind/.test(lq)) return { html: ansRunway(q) };
    if (/alert|risk|delay|wait|warning|problem|issue/.test(lq)) return { html: ansAlerts(q) };
    if (/how many|arrivals?|expected|forecast|aircraft/.test(lq)) return { html: ansArrivals(q) };
    return { html: '<div class="head">I\'m not sure I understood</div><p>I answer planning questions from the forecast and schedule data. Try one of the suggested questions, or ask about arrivals, parking, fuel, staffing, conflicts or the high-demand scenario.</p><div class="foot">' + A.icon('shield', 14) + 'Planning recommendations only · human review required</div>' };
  }

  /* ---------------- UI ---------------- */
  function msgHtml(m) {
    return '<div class="msg msg-' + m.role + '"><div class="av" aria-hidden="true">' + (m.role === 'u' ? 'You' : 'AI') + '</div><div class="bubble' + (m.refuse ? ' refuse' : '') + '">' + m.html + '</div></div>';
  }
  function render() {
    const el = $('#chat-log');
    el.innerHTML = log.map(msgHtml).join('') + (busy ? '<div class="msg msg-a"><div class="av" aria-hidden="true">AI</div><div class="bubble"><span class="typing" aria-label="Assistant is typing"><i></i><i></i><i></i></span></div></div>' : '');
    el.scrollTop = el.scrollHeight;
  }
  async function ask(q) {
    q = String(q || '').trim().slice(0, 240);
    if (!q || busy) return;
    log.push({ role: 'u', html: esc(q) });
    busy = true; render();
    const started = Date.now();
    let res = null;
    try {
      const x = ctxFor(q);
      const remote = await LaxyAPI.chat(q, { date: D[x.d].label, scenario: x.k, hour: A.state.hour });
      if (remote && remote.text && !isRefusal(q.toLowerCase())) res = { html: '<p>' + esc(remote.text) + '</p><div class="foot">' + A.icon('shield', 14) + 'Backend response · planning recommendation only · human review required</div>' };
    } catch (e) { res = null; }
    if (!res) { try { res = respond(q); } catch (e) { console.error(e); res = { html: '<div class="head">Something went wrong</div><p>I couldn\'t compute that answer. Please try rephrasing.</p>' }; } }
    const wait = Math.max(0, 650 - (Date.now() - started));
    setTimeout(function () { log.push({ role: 'a', html: res.html, refuse: res.refuse }); busy = false; render(); const inp = $('#chat-input'); if (inp) inp.focus({ preventScroll: true }); }, wait);
  }

  function context() {
    const s = A.sm(), x = { d: A.state.date };
    $('#chat-ctx').innerHTML =
      '<li>' + A.icon('calendar', 16) + '<span><b>' + A.dayLabel(A.state.date) + '</b><br><small>Planning day (change with the date pills)</small></span></li>' +
      '<li>' + A.icon('layers', 16) + '<span><b>' + A.SC().label + ' demand</b> · ' + s.arrivals + ' arrivals<br><small>Scenario (change in the header)</small></span></li>' +
      '<li>' + A.icon('clock', 16) + '<span><b>Operations clock ' + fmt.hourLong(A.state.hour) + '</b><br><small>Used for “now” answers</small></span></li>' +
      '<li>' + A.icon('info', 16) + '<span><b>Synthetic data</b><br><small>Forecasts are uncertain estimates; every answer shows a confidence level</small></span></li>';
  }

  function mount() {
    $('#body-chat').innerHTML =
      '<div class="chat-shell"><section class="card chat-card" aria-label="AI Operations Assistant chat">' +
      '<div class="chat-head"><span class="sc-ico" style="background:rgba(255,255,255,.16);color:#fff">' + A.icon('spark', 20) + '</span><div><h3>AI Operations Assistant</h3><p>Answers from the forecast &amp; schedule data</p></div><span class="ai-tag" style="margin-left:auto;background:rgba(255,255,255,.16);color:#fff">Planning only</span></div>' +
      '<div class="chat-guard" role="note">' + A.icon('shield', 18) + '<div><b>Planning recommendations only.</b> I can\'t authorize aircraft movements, assign an official runway, issue taxi instructions or replace ATC and airport personnel. A human must review every recommendation.</div></div>' +
      '<div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Conversation"></div>' +
      '<form class="chat-form" id="chat-form" autocomplete="off"><input id="chat-input" type="text" maxlength="240" placeholder="Ask about arrivals, parking, fuel, staffing, conflicts…" aria-label="Ask the AI Operations Assistant"><button type="submit" class="btn btn-primary">' + A.icon('send', 16) + 'Send</button></form>' +
      '<div class="chat-sugg"><h4>Suggested questions</h4><div class="chips" id="chat-chips">' + QUESTIONS.map(function (q) { return '<button type="button" class="chip chip-btn" data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div></div></section>' +
      '<aside class="stack"><article class="card"><div class="card-head"><h3>What I\'m looking at</h3></div><ul class="ctx-list" id="chat-ctx"></ul></article>' +
      '<article class="card"><div class="card-head"><h3>How answers work</h3></div><ul class="ctx-list"><li>' + A.icon('chart', 16) + '<span>Numbers come from the same forecast and schedule shown on the other tabs.</span></li><li>' + A.icon('check', 16) + '<span>Each answer lists the time period, a confidence level and a recommended human action.</span></li><li>' + A.icon('user', 16) + '<span>You decide. Nothing is sent to real systems.</span></li></ul></article>' +
      '<div class="cant"><b>What I can\'t do</b><ul><li>Authorize or clear takeoffs, landings or taxiing</li><li>Assign an official runway or issue taxi instructions</li><li>Direct any aircraft or vehicle movement</li><li>Replace air traffic control or airport personnel</li><li>Show passenger names or personal data</li></ul></div></aside></div>';
    $('#meta-chat').innerHTML = A.dataChip('Synthetic · POST /api/v1/assistant/chat');
    $('#chat-form').addEventListener('submit', function (e) { e.preventDefault(); const i = $('#chat-input'); const v = i.value; i.value = ''; ask(v); });
    $('#chat-chips').addEventListener('click', function (e) { const b = e.target.closest('button[data-q]'); if (b) ask(b.dataset.q); });
    $('#chat-log').addEventListener('click', function (e) { const el = e.target.closest('[data-aid]'); if (el) UI.openAircraft(el.dataset.aid); });
    $('#chat-log').addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-aid]')) { e.preventDefault(); UI.openAircraft(e.target.dataset.aid); } });
    log.push({ role: 'a', html: welcome() });
    render();
  }

  function update() { if (!$('#chat-log')) mount(); context(); }

  A.register('chat', update, { page: 'assistant' });
  A.onHour(function () { if ($('#chat-ctx')) context(); });
  window.Chat = { ask: ask, respond: respond, isRefusal: isRefusal };
})();
