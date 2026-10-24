/* =========================================================================
   LAXY Intelligent FBO - application core: state, shared helpers, tab
   router, sliding panels, alerts bell, operations clock, header controls.
   Page views live in js/views-*.js and register themselves here.
   ALL DATA IS SYNTHETIC / BACKEND-GENERATED FOR DEMONSTRATION.
   ========================================================================= */
window.App = (function () {
  'use strict';
  const D = Model.DAYS, F = Model.FACILITY, fmt = Model.fmt;

  const state = { date: 2, scen: 'high', run: 0, hour: 8, page: 'dashboard', playing: false, model: null, loading: false, decisions: [], ack: {} };
  const views = [];
  const hourHooks = [];
  const UI_ADVISORY = 'Runway suggestions are for planning support only. Air traffic control, airport authorities, and certified aviation personnel make all final runway and aircraft-movement decisions.';

  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- accessors ---------- */
  const M = function () { return state.model; };
  const S = function (k) { return state.model.scen[k || state.scen]; };
  const sm = function (k, d) { return state.model.summary(k || state.scen, d == null ? state.date : d); };
  const day = function () { return D[state.date]; };
  const SC = function (k) { return Model.SCEN[k || state.scen]; };

  /* ---------- icons ---------- */
  const ICONS = {
    plane: '<path d="M2.5 13.5l8-2.2L7 4.5h2.2l5.8 6 4.4-1.2a1.8 1.8 0 011 3.4l-4.4 1.2-5.8 6H8l3.5-6.8-8 2.2z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    park: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9.5 17V7.5h3.2a2.7 2.7 0 010 5.4H9.5"/>',
    fuel: '<path d="M12 3s6 6.2 6 10.5A6 6 0 016 13.5C6 9.2 12 3 12 3z"/>',
    crew: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><path d="M16 5.2a3 3 0 010 5.6M18 14.3c2 .8 3 2.700 3 5.700"/>',
    risk: '<path d="M12 3l9.500 17h-19z"/><path d="M12 10v4.500M12 17.500v.1"/>',
    shield: '<path d="M12 3l8 3v6c0 4.500-3.200 7.800-8 9-4.800-1.200-8-4.500-8-9V6z"/><path d="M8.500 12l2.500 2.500 4.500-5"/>',
    refresh: '<path d="M20 11a8 8 0 00-14-4.500L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0014 4.500L20 15"/><path d="M20 20v-5h-5"/>',
    download: '<path d="M12 4v11"/><path d="M7.500 10.500L12 15l4.500-4.500"/><path d="M4 19.500h16"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.500v.1"/>',
    bell: '<path d="M6 17V11a6 6 0 0112 0v6l1.500 2h-15z"/><path d="M10 21a2 2 0 004 0"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5M12.500 16V8M17 16v-8"/>',
    eye: '<path d="M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="10.500" width="14" height="10" rx="2"/><path d="M8 10.500V8a4 4 0 018 0v2.500"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.400 3.600-7 8-7s8 2.600 8 7"/>',
    warn: '<path d="M12 3l9.500 17h-19z"/><path d="M12 10v4.500M12 17.500v.1"/>',
    runway: '<path d="M8 3l-2 18M16 3l2 18M12 4v3M12 10v4M12 17v3"/>',
    grid: '<rect x="3.500" y="3.500" width="7" height="7" rx="2"/><rect x="13.500" y="3.500" width="7" height="7" rx="2"/><rect x="3.500" y="13.500" width="7" height="7" rx="2"/><rect x="13.500" y="13.500" width="7" height="7" rx="2"/>',
    spark: '<path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900z"/><path d="M19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8z"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    calendar: '<rect x="3.500" y="5" width="17" height="15.500" rx="3"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
    play: '<path d="M8 5.500v13l11-6.500z"/>',
    pause: '<path d="M8 5.500v13M16 5.500v13"/>',
    send: '<path d="M4 12l16-8-6 16-3-6.500z"/>',
    tool: '<path d="M14.500 6.500a4 4 0 005 5L10 21l-4-4zM13 8l3 3"/>',
    map: '<path d="M9 4L3 6.500v13L9 17l6 2.500 6-2.500v-13L15 6.500z"/><path d="M9 4v13M15 6.500v13"/>'
  };
  const icon = function (name, size) {
    return '<svg class="ico" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  };
  const pct = function (v) { return Math.round(v * 100) + '%'; };
  const confBadge = function (c, compact) {
    return '<span class="conf conf-' + c.level + '" title="' + c.label + (c.rel ? ' (about ±' + Math.round(c.rel * 100) + '%)' : '') + '"><span class="conf-bars" aria-hidden="true"><i></i><i></i><i></i></span><span' + (compact ? ' class="sr-only"' : '') + '>' + c.label + '</span></span>';
  };
  const sevLabel = { critical: 'Critical', high: 'High', warning: 'Warning', info: 'Info' };
  const sevBadge = function (s) { return '<span class="sev sev-' + s + '">' + sevLabel[s] + '</span>'; };
  const trafficClass = function (n) { return n <= 3 ? 't-low' : n <= 6 ? 't-mod' : 't-high'; };
  const trafficLabel = { 't-low': 'Low traffic', 't-mod': 'Moderate traffic', 't-high': 'High traffic', 't-red': 'Capacity / scheduling conflict' };
  const progress = function (value, max, cls, marker) {
    const p = Math.max(0, Math.min(100, (value / max) * 100));
    return '<div class="bar ' + (cls || '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + max + '" aria-valuenow="' + Math.round(value) + '"><span style="width:' + p + '%"></span>' + (marker != null ? '<em style="left:' + (marker / max) * 100 + '%"></em>' : '') + '</div>';
  };
  const gauge = function (score, color) {
    const r = 46, cx = 60, cy = 58, a = Math.PI * (1 - score / 100);
    const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
    return '<svg class="gauge" viewBox="0 0 120 68" role="img" aria-label="Operational risk score ' + score + ' out of 100"><path d="M14 58A46 46 0 0 1 106 58" class="gauge-bg"/>' +
      (score > 0 ? '<path d="M14 58A46 46 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + '" class="gauge-fg" stroke="' + color + '"/>' : '') +
      '<text x="60" y="56" text-anchor="middle" class="gauge-num">' + score + '</text></svg>';
  };
  const riskColor = { low: '#1a9a5b', moderate: '#d4a20a', high: '#f97316', critical: '#dc2626' };
  const dayLabel = function (d) { return D[d].dow + ', ' + D[d].label; };
  const dataChip = function (text) { return '<span class="chip chip-data" title="Synthetic / backend-generated placeholder">' + icon('info', 14) + text + '</span>'; };
  const hourLabel = function (h) { return fmt.hourLong(h); };

  /* ---------- logging of human decisions (demo only) ---------- */
  function logDecision(text) {
    state.decisions.unshift({ at: new Date(), text: text, ctx: dayLabel(state.date) + ' / ' + SC().label + ' scenario' });
    if (state.decisions.length > 40) state.decisions.pop();
    views.forEach(function (v) { if (v.name === 'responsible') v.fn(); });
  }
  function toast(msg, kind) {
    const host = $('#toast-host');
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 4200);
  }

  /* ---------- sliding detail panel ---------- */
  const drawer = {
    open: function (o) {
      $('#dr-title').textContent = o.title || '';
      $('#dr-sub').textContent = o.sub || '';
      $('#dr-body').innerHTML = o.html || '';
      $('#dr-body').scrollTop = 0;
      drawer.onClick = o.onClick || null;
      drawer.last = document.activeElement;
      $('#drawer').classList.add('open'); $('#scrim').classList.add('open');
      $('#drawer').setAttribute('aria-hidden', 'false');
      setTimeout(function () { $('#dr-close').focus({ preventScroll: true }); }, 50);
      drawer.kind = o.kind || '';
    },
    refresh: function (html) { $('#dr-body').innerHTML = html; },
    close: function () {
      $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open');
      $('#drawer').setAttribute('aria-hidden', 'true');
      drawer.kind = ''; drawer.onClick = null;
      Charts.hideTip();
      if (drawer.last && drawer.last.focus) { try { drawer.last.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    },
    isOpen: function () { return $('#drawer').classList.contains('open'); }
  };

  /* ---------- pages + router ---------- */
  const PAGES = [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', title: 'Operations Dashboard' },
    { id: 'forecast', label: 'Arrival Forecast', icon: 'chart', title: 'Arrival Forecast' },
    { id: 'schedule', label: 'Live Schedule', icon: 'clock', title: 'Live Schedule' },
    { id: 'parking', label: 'Parking & Ramp', icon: 'park', title: 'Parking & Ramp' },
    { id: 'runway', label: 'Runway Operations', icon: 'runway', title: 'Runway Operations (advisory)' },
    { id: 'fuel', label: 'Fuel Planning', icon: 'fuel', title: 'Fuel Planning' },
    { id: 'staffing', label: 'Staffing', icon: 'crew', title: 'Staffing' },
    { id: 'assistant', label: 'AI Operations Assistant', icon: 'spark', title: 'AI Operations Assistant' },
    { id: 'reports', label: 'Reports', icon: 'file', title: 'Reports' }
  ];
  function buildNav() {
    $('#tabs').innerHTML = PAGES.map(function (p, i) {
      return '<a class="tab" href="#' + p.id + '" data-page="' + p.id + '">' + icon(p.icon, 18) + '<span>' + p.label.replace('&', '&amp;') + '</span><span class="tab-n">' + (i + 1) + '</span></a>';
    }).join('');
    $$('[data-ico]').forEach(function (el) { el.innerHTML = icon(el.dataset.ico, el.classList.contains('ph-ico') ? 24 : 19); });
    $('#bell-ico').innerHTML = icon('bell', 20);
    $('#refresh-ico').innerHTML = icon('refresh', 18);
    $('#export-ico').innerHTML = icon('download', 18);
    $('#btn-play').innerHTML = icon('play', 18);
    $('#tabs').addEventListener('click', function (e) { if (e.target.closest('a.tab')) closeMenu(); });
    $('#menu-btn').addEventListener('click', function () { const o = $('#tabs').classList.toggle('open'); $('#menu-btn').setAttribute('aria-expanded', String(o)); });
  }
  function closeMenu() { $('#tabs').classList.remove('open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); }

  function showPage(id, sub, instant) {
    if (!PAGES.some(function (p) { return p.id === id; })) id = 'dashboard';
    const changed = state.page !== id || !$('#page-' + id).classList.contains('shown');
    state.page = id;
    $$('.page').forEach(function (p) { const on = p.dataset.page === id; p.hidden = !on; p.classList.toggle('shown', on); });
    $$('.tab').forEach(function (t) { const on = t.dataset.page === id; t.classList.toggle('active', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    const pg = $('#page-' + id), meta = PAGES.filter(function (p) { return p.id === id; })[0];
    document.title = meta.title + ' – LAXY Intelligent FBO · Super Bowl LXI Operations';
    if (changed) {
      pg.classList.remove('page-in'); void pg.offsetWidth; pg.classList.add('page-in');
      setTimeout(function () { pg.classList.remove('page-in'); }, 900);
      requestAnimationFrame(function () { Charts.replay(pg); });
    }
    closeMenu();
    Charts.hideTip();
    if (sub && $('#' + sub)) { setTimeout(function () { $('#' + sub).scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' }); }, 60); }
    else if (changed) window.scrollTo({ top: 0, behavior: 'auto' });
    views.forEach(function (v) { if (v.page === id && v.onShow) v.onShow(); });
  }
  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '').split('/');
    return { page: h[0] || 'dashboard', sub: h[1] || '' };
  }
  function go(page, sub) { const t = '#' + page + (sub ? '/' + sub : ''); if (location.hash === t) showPage(page, sub); else location.hash = t; }
  function route() { const r = parseHash(); showPage(r.page, r.sub); }

  /* ---------- view registry ---------- */
  function register(name, fn, opts) { views.push({ name: name, fn: fn, page: opts && opts.page, onShow: opts && opts.onShow }); }
  function onHour(fn) { hourHooks.push(fn); }
  function updateAll() {
    if (!state.model) return;
    document.body.setAttribute('data-scen', state.scen);
    syncControls();
    views.forEach(function (v) { try { v.fn(); } catch (e) { console.error('[view:' + v.name + ']', e); } });
    updateBell();
  }
  function pulseUpdate() {
    const b = $('#updbar'); b.classList.remove('run'); void b.offsetWidth; b.classList.add('run');
  }
  function setDate(d) { state.date = d; pulseUpdate(); updateAll(); }
  function setScenario(k) { if (k === state.scen) return; state.scen = k; pulseUpdate(); updateAll(); toast('Dashboard updated for ' + SC().label + ' demand: ' + sm().arrivals + ' arrivals on ' + dayLabel(state.date) + ', risk ' + sm().risk.label.toLowerCase() + '.', 'ok'); }
  function setHour(h, silent) {
    state.hour = Math.max(0, Math.min(23, h));
    syncClock();
    hourHooks.forEach(function (fn) { try { fn(); } catch (e) { console.error('[hour hook]', e); } });
    if (!silent) updateBell();
  }

  /* ---------- operations clock ---------- */
  let playTimer = null;
  function syncClock() {
    $('#ops-slider').value = state.hour;
    $('#ops-out').textContent = fmt.hourLong(state.hour);
    $('#btn-play').innerHTML = icon(state.playing ? 'pause' : 'play', 18);
    $('#btn-play').classList.toggle('on', state.playing);
    $('#btn-play').setAttribute('aria-label', state.playing ? 'Pause operations clock' : 'Play operations clock');
  }
  function togglePlay() {
    state.playing = !state.playing;
    clearInterval(playTimer);
    if (state.playing) {
      if (state.hour >= 23) state.hour = 0;
      playTimer = setInterval(function () {
        if (state.hour >= 23) { state.playing = false; clearInterval(playTimer); syncClock(); return; }
        setHour(state.hour + 1, true);
      }, 1100);
    }
    syncClock();
  }

  /* ---------- alerts bell + Alerts Center drawer ---------- */
  function activeAlerts() { return state.model.alerts(state.scen, state.date).filter(function (a) { return !state.ack[a.id]; }); }
  function updateBell() {
    if (!state.model) return;
    const list = activeAlerts();
    const urgent = list.filter(function (a) { return a.sev === 'critical' || a.sev === 'high'; });
    const b = $('#bell-badge');
    b.textContent = list.length;
    b.classList.toggle('none', list.length === 0);
    b.classList.toggle('pulse', list.some(function (a) { return a.sev === 'critical'; }));
    $('#bell').setAttribute('aria-label', 'Open Alerts Center, ' + list.length + ' active alert' + (list.length === 1 ? '' : 's') + (urgent.length ? ', ' + urgent.length + ' urgent' : ''));
    if (drawer.kind === 'alerts') drawer.refresh(alertsDrawerHtml());
  }
  function alertsDrawerHtml() {
    const all = state.model.alerts(state.scen, state.date);
    return '<div class="chips"><span class="chip">' + icon('calendar', 14) + dayLabel(state.date) + '</span><span class="chip">Scenario: <b>' + SC().label + '</b></span><span class="chip">' + activeAlerts().length + ' active</span></div>' +
      '<div class="dr-alerts">' + (window.UI && UI.alertCards ? UI.alertCards(all, true) : '') + '</div>' +
      '<a class="btn btn-ghost" href="#dashboard/alerts">Open full Alerts Center ' + icon('arrow', 16) + '</a>';
  }
  function openAlerts() {
    drawer.open({ title: 'Alerts Center', sub: dayLabel(state.date) + ' · ' + SC().label + ' demand · recommended human actions', html: alertsDrawerHtml(), kind: 'alerts', onClick: function (e) { return window.UI && UI.alertClick && UI.alertClick(e); } });
  }

  /* ---------- header controls ---------- */
  function buildControls() {
    const dp = $('#date-pills');
    dp.innerHTML = D.map(function (d) {
      return '<button type="button" class="date-pill" role="radio" data-d="' + d.idx + '"><span class="dp-dow">' + d.dow + '</span><span class="dp-date">' + d.label + '</span><span class="dp-n" data-n></span></button>';
    }).join('');
    dp.addEventListener('click', function (e) { const b = e.target.closest('.date-pill'); if (b) setDate(+b.dataset.d); });
    dp.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const nd = Math.max(0, Math.min(6, state.date + (e.key === 'ArrowRight' ? 1 : -1)));
      setDate(nd);
      const b = $('.date-pill[data-d="' + nd + '"]', dp); if (b) b.focus();
    });
    document.addEventListener('click', function (e) { const b = e.target.closest('.scen-seg button[data-s]'); if (b) setScenario(b.dataset.s); });
    $('#btn-refresh').addEventListener('click', refresh);
    $('#bell').addEventListener('click', openAlerts);
    $('#btn-play').addEventListener('click', togglePlay);
    $('#ops-slider').addEventListener('input', function (e) { if (state.playing) togglePlay(); setHour(+e.target.value); });
    $('#dr-close').addEventListener('click', drawer.close);
    $('#scrim').addEventListener('click', drawer.close);
    $('#dr-body').addEventListener('click', function (e) { if (drawer.onClick && drawer.onClick(e) === true) return; const a = e.target.closest('a[href^="#"]'); if (a) drawer.close(); });
    const ex = $('#btn-export'), menu = $('#export-menu');
    ex.addEventListener('click', function (e) { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; ex.setAttribute('aria-expanded', String(open)); });
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; ex.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { menu.hidden = true; ex.setAttribute('aria-expanded', 'false'); if (drawer.isOpen()) drawer.close(); closeMenu(); }
    });
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button[data-x]'); if (!b) return;
      menu.hidden = true; ex.setAttribute('aria-expanded', 'false');
      if (b.dataset.x === 'csv') exportSchedule(); else if (b.dataset.x === 'plan') exportPlan(); else if (b.dataset.x === 'print') window.print();
    });
    window.addEventListener('hashchange', route);
  }

  function syncControls() {
    $$('.date-pill').forEach(function (b) {
      const d = +b.dataset.d, on = d === state.date;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      const s = sm(state.scen, d);
      $('[data-n]', b).textContent = s.arrivals + ' arr';
    });
    $$('.scen-seg button').forEach(function (b) {
      const on = b.dataset.s === state.scen;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('#ab-date').innerHTML = icon('calendar', 18) + '<div><small>Operations date</small><b>' + D[state.date].dow + ', ' + D[state.date].label + ', 2027</b></div>';
    const p = state.model.payload;
    $('#model-meta').innerHTML = 'Model run <b>' + p.modelId + '</b> &middot; updated ' + new Date(p.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' &middot; source: ' + (p.source === 'backend' ? 'backend API' : 'synthetic mock API');
    syncClock();
  }

  async function refresh() {
    if (state.loading) return;
    const btn = $('#btn-refresh');
    state.loading = true; btn.disabled = true; btn.classList.add('spin');
    $('#btn-refresh .lbl').textContent = 'Refreshing…';
    const before = sm().arrivals, bdate = state.date, bscen = state.scen;
    try {
      const payload = await LaxyAPI.getForecast(state.run + 1);
      state.run += 1;
      state.model = Model.build(payload);
      pulseUpdate();
      updateAll();
      const after = sm(bscen, bdate).arrivals;
      toast('Forecast refreshed (' + payload.modelId + '). ' + dayLabel(bdate) + ' ' + SC(bscen).label + ' arrivals: ' + before + ' → ' + after + (after === before ? ' (no change)' : ' (' + (after > before ? '+' : '') + (after - before) + ')') + '.', 'ok');
    } catch (err) {
      console.error(err);
      toast('Refresh failed. Showing previous forecast.', 'err');
    } finally {
      state.loading = false; btn.disabled = false; btn.classList.remove('spin');
      $('#btn-refresh .lbl').textContent = 'Refresh Forecast';
    }
  }

  /* ---------- exports ---------- */
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const csvCell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function exportSchedule() {
    const rows = M().dayAircraft(state.scen, state.date);
    Sim.prepare(M(), state.scen);
    const hdr = ['Aircraft ID (anonymous)', 'Estimated arrival', 'Category', 'Stay type', 'Estimated departure', 'Est. parking duration', 'Parking position (proposed)', 'Fuel service', 'Ground services', 'Ground-handler team', 'Advisory runway reference (planning only)', 'Service status', 'Warnings'];
    const statusName = { confirmed: 'Confirmed', proposed: 'AI-proposed (awaiting human approval)', unassigned: 'Unassigned (conflict)' };
    const lines = [
      '# LAXY Intelligent FBO - daily arrival schedule (SYNTHETIC DATA - demonstration only)',
      '# Date: ' + D[state.date].dowLong + ', February ' + D[state.date].date + ', 2027 | Scenario: ' + SC().label + ' demand | Model run ' + state.model.payload.modelId,
      '# Planning support only. Not an ATC clearance or movement authorization. Parking and runway fields are proposals/estimates that humans and ATC decide. No passenger or personal data included.',
      hdr.map(csvCell).join(',')
    ];
    rows.forEach(function (a) {
      lines.push([a.id, fmt.clock(a.h + a.min / 60), a.catName, Model.STAYS[a.stay].name, fmt.abs(a.dep), fmt.dur(a.dur), a.sim.pos.code, a.fuel.need ? 'Jet-A ~' + a.fuel.gal + ' gal at ' + fmt.abs(a.fuel.at) : 'None requested',
        a.svcs.map(function (k) { return Model.SERVICES.filter(function (s) { return s.key === k; })[0].name; }).join(' + ') || 'Standard handling', Sim.teamShort(a), a.sim.rwy.code, statusName[a.status], a.warnings.map(function (w) { return w.text; }).join(' | ')].map(csvCell).join(','));
    });
    download('LAXY-FBO-schedule-' + D[state.date].iso + '-' + state.scen + '.csv', lines.join('\n'), 'text/csv');
    toast('Daily schedule exported (' + rows.length + ' aircraft, synthetic data).', 'ok');
  }
  function exportPlan() {
    const k = state.scen, d = state.date, s = sm(), a = M().assistant(k, d), al = M().alerts(k, d);
    const L = [];
    L.push('# LAXY Intelligent FBO - Preparation Plan');
    L.push('**' + D[d].dowLong + ', February ' + D[d].date + ', 2027** | Scenario: **' + SC().label + ' demand** | Model run ' + state.model.payload.modelId);
    L.push('');
    L.push('> SYNTHETIC DATA - demonstration only. Estimates include uncertainty. Humans must approve all operational actions.');
    L.push('> ' + UI_ADVISORY);
    L.push('');
    L.push('## 1. Forecast');
    L.push('- Expected private-aircraft arrivals: **' + s.arrivals + '** (range ' + s.ci.lo + '-' + s.ci.hi + ', ' + s.ci.conf.label.toLowerCase() + ')');
    L.push('- Ordinary-week baseline for this date: ' + s.ordinary + ' arrivals; demand level: ' + s.demandLevel);
    L.push('- Peak window: ' + fmt.hourLong(s.peakWin.start) + '-' + fmt.hourLong(s.peakWin.end) + '; peak hour ' + fmt.hourLong(s.peakHour) + ' (' + s.peakHourN + ' arrivals)');
    L.push('- Expected departures: ' + s.departures);
    L.push('');
    L.push('## 2. Staffing (recommended vs. current roster)');
    L.push('- Staffing level: ' + s.staff.level.label + '; crew coverage with current roster: ' + s.staff.coverage + '%');
    if (s.staff.shortages.length) s.staff.shortages.slice(0, 8).forEach(function (x) { L.push('- Add ' + x.n + ' ' + (x.n === 1 ? x.one : x.roleName.toLowerCase()) + ' between ' + fmt.hourLong(x.from) + ' and ' + fmt.hourLong(x.to)); });
    else L.push('- Current roster meets recommended staffing.');
    L.push('');
    L.push('## 3. Fuel');
    L.push('- Estimated demand: ' + fmt.int(s.fuel.demand) + ' gal across ' + s.fuel.aircraftFueled + ' fuel services (avg ' + fmt.int(s.fuel.avgGal) + ' gal)');
    L.push('- Inventory at start of day: ' + fmt.int(s.fuel.startInv) + ' gal; lowest projected (standing plan): ' + fmt.int(s.fuel.minInvStanding) + ' gal; safety threshold ' + fmt.int(F.safety) + ' gal');
    if (s.fuel.deliveries.length) s.fuel.deliveries.forEach(function (x) { L.push('- Recommended extra delivery: ' + fmt.int(x.gal) + ' gal at ' + fmt.abs(x.at) + ' (order by ' + fmt.abs(x.order) + ')'); });
    else L.push('- No extra delivery required; standing 2:00 AM delivery is sufficient.');
    L.push('');
    L.push('## 4. Parking and ramp');
    L.push('- Peak utilization ' + Math.round(s.parking.peakUtil * 100) + '% at ' + fmt.hourLong(s.parking.peakHour) + '; available positions at peak: ' + s.parking.availAtPeak + ' of ' + F.sellable + ' (+' + F.reserved + ' reserved)');
    L.push('- ' + (s.parking.firstOver !== null ? 'Overflow expected from ' + fmt.hourLong(s.parking.firstOver) + ' (up to ' + s.parking.overflowMax + ' positions). Review overflow plan with airport operations.' : 'No overflow expected.'));
    L.push('');
    L.push('## 5. AI scheduling assistant (advisory)');
    a.summary.forEach(function (x) { L.push('- ' + x); });
    L.push('- Recommended spacing: >= ' + a.spacingMin + ' minutes between arrivals in the peak hour');
    L.push('');
    L.push('## 6. Alerts and recommended human actions');
    al.forEach(function (x) { L.push('- [' + sevLabel[x.sev] + '] ' + x.title + ' (' + x.time + '; ' + x.resource + ') -> ' + x.action); });
    L.push('');
    L.push('## 7. Approvals required');
    L.push('- [ ] FBO operations manager: staffing changes');
    L.push('- [ ] Fuel supervisor: extra delivery order');
    L.push('- [ ] Ramp / parking coordinator: overflow plan, parking assignments');
    L.push('- [ ] Airport operations: overflow apron, any airfield coordination');
    L.push('');
    L.push('_No passenger names or personal information are included. Aircraft IDs are anonymous._');
    download('LAXY-FBO-preparation-plan-' + D[d].iso + '-' + k + '.md', L.join('\n'), 'text/markdown');
    toast('Preparation plan exported (synthetic data).', 'ok');
  }

  /* ---------- boot ---------- */
  async function boot() {
    buildNav();
    buildControls();
    const skipIntro = /[?&]skip=1/.test(location.search);
    if (window.Intro && !skipIntro) Intro.start(); else { document.body.classList.remove('intro-on'); const i = $('#intro'); if (i) i.remove(); }
    const payload = await LaxyAPI.getForecast(0);
    state.model = Model.build(payload);
    state.hour = sm().peakHour;
    updateAll();
    route();
    if (window.Intro && !skipIntro) Intro.dataReady();
  }

  return {
    state: state, register: register, onHour: onHour, updateAll: updateAll, setDate: setDate, setScenario: setScenario, setHour: setHour, boot: boot, refresh: refresh,
    go: go, drawer: drawer, PAGES: PAGES, ADVISORY: UI_ADVISORY, openAlerts: openAlerts, activeAlerts: activeAlerts, exportSchedule: exportSchedule, exportPlan: exportPlan,
    $: $, $$: $$, M: M, S: S, sm: sm, day: day, SC: SC, icon: icon, pct: pct, confBadge: confBadge, sevBadge: sevBadge, sevLabel: sevLabel, trafficClass: trafficClass, trafficLabel: trafficLabel,
    progress: progress, gauge: gauge, riskColor: riskColor, dayLabel: dayLabel, dataChip: dataChip, hourLabel: hourLabel, logDecision: logDecision, toast: toast, download: download, pulseUpdate: pulseUpdate
  };
})();
