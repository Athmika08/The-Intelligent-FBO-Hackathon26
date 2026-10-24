/* =========================================================================
   LAXY Intelligent FBO - landing animation
   A business jet descends across the screen, runway lights switch on as it
   approaches, it touches down smoothly and the dashboard finishes loading.
   Pure canvas, no dependencies. ~4.5 s, skippable at any time.
   Purely decorative: it has nothing to do with real aircraft or ATC.
   ========================================================================= */
(function (global) {
  'use strict';
  const KEY = 'laxy.intro.seen.v1';
  const APPROACH = 3.1, ROLL = 1.9, READY_AT = 4.3;     // seconds
  const $ = function (id) { return document.getElementById(id); };

  let root, cv, ctx, W = 0, H = 0, DPR = 1, raf = 0, t0 = 0, last = 0, t = 0;
  let dataOk = false, finished = false, running = false, reduced = false;
  let puffs = [], touched = false, stars = [], clouds = [], city = [];

  /* deterministic pseudo-random so the scene is identical every run */
  function rng(seed) { let s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  const clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  const lerp = function (a, b, p) { return a + (b - a) * p; };
  const easeOut = function (p) { return 1 - Math.pow(1 - p, 3); };
  const smooth = function (p) { return p * p * (3 - 2 * p); };

  function layout() {
    DPR = Math.min(2, global.devicePixelRatio || 1);
    W = root.clientWidth; H = root.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const r = rng(7);
    stars = Array.from({ length: Math.round(W * H / 9000) }, function () { return { x: r() * W, y: r() * H * 0.62, s: r() * 1.3 + 0.3, p: r() * 6.28 }; });
    clouds = Array.from({ length: 6 }, function (_, i) { return { x: r() * W, y: H * (0.14 + r() * 0.36), w: W * (0.18 + r() * 0.22), a: 0.05 + r() * 0.07, v: 4 + r() * 8 + i }; });
    city = [];
    let x = -10;
    while (x < W + 20) { const w = 10 + r() * 26, h = 8 + r() * (H * 0.07) * (0.35 + 0.65 * Math.abs(Math.sin(x / W * 5))); city.push({ x: x, w: w, h: h, l: r() }); x += w + r() * 5; }
    if (reduced) frame(READY_AT + ROLL);
  }

  /* ------------------------------ scene geometry ------------------------------ */
  function geo() {
    // keep the runway clear of the loading card (card sits at the bottom of the overlay)
    const card = root.querySelector('.intro-bottom');
    const cardTop = card ? card.offsetTop : H * 0.8; // offsetTop ignores the fade-in transform
    const rwH = clamp(H * 0.085, 34, 80);
    const rwBot = Math.min(H * 0.885, cardTop - 44), rwTop = rwBot - rwH;
    const hor = rwTop - H * 0.09;
    const s = clamp(W * 0.00105, 0.62, 1.55);
    return { hor: hor, rwTop: rwTop, rwBot: rwBot, s: s, wheelY: (rwTop + rwBot) / 2 - 2, gear: 34 * s };
  }

  function planeState(g) {
    const x0 = -W * 0.14, x1 = W * 0.50, x2 = W * 0.80;
    const yAir0 = H * 0.14, yG = g.wheelY - g.gear;
    if (t < APPROACH) {
      const p = t / APPROACH;
      const px = lerp(x0, x1, 1 - Math.pow(1 - p, 1.18));
      const py = lerp(yAir0, yG, p * 0.80 + 0.20 * Math.pow(p, 4));
      const eps = 0.001, p2 = Math.min(1, p + eps);
      const dx = lerp(x0, x1, 1 - Math.pow(1 - p2, 1.18)) - px, dy = lerp(yAir0, yG, p2 * 0.80 + 0.20 * Math.pow(p2, 4)) - py;
      let ang = Math.atan2(dy, Math.max(0.0001, dx));
      ang = clamp(ang, 0, 0.13);
      const flare = smooth(clamp((p - 0.82) / 0.18, 0, 1));
      ang = ang * (1 - flare) - 0.045 * flare;
      return { x: px, y: py, ang: ang, ground: false, gear: smooth(clamp((p - 0.35) / 0.25, 0, 1)), spd: 1, air: 1 - p };
    }
    const q = clamp((t - APPROACH) / ROLL, 0, 1);
    const px = lerp(x1, x2, easeOut(q));
    // tiny settle after touchdown
    const settle = Math.sin(clamp(q * 5, 0, 1) * Math.PI) * 1.6 * (1 - q);
    return { x: px, y: yG + settle, ang: lerp(-0.045, 0, smooth(clamp(q * 4, 0, 1))), ground: true, gear: 1, spd: 1 - easeOut(q), air: 0 };
  }

  /* ------------------------------ drawing ------------------------------ */
  function drawSky(g) {
    const sky = ctx.createLinearGradient(0, 0, 0, g.hor);
    sky.addColorStop(0, '#0d0424'); sky.addColorStop(0.45, '#2b1065'); sky.addColorStop(0.85, '#6d34d4'); sky.addColorStop(1, '#c79bff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, g.hor + 1);
    const sun = ctx.createRadialGradient(W * 0.82, g.hor, 0, W * 0.82, g.hor, W * 0.5);
    sun.addColorStop(0, 'rgba(255,196,230,.55)'); sun.addColorStop(0.4, 'rgba(236,150,255,.18)'); sun.addColorStop(1, 'rgba(236,150,255,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, g.hor + 1);
    stars.forEach(function (st) {
      const a = (0.35 + 0.65 * Math.abs(Math.sin(t * 1.6 + st.p))) * (1 - st.y / (g.hor * 0.95));
      ctx.fillStyle = 'rgba(255,255,255,' + clamp(a, 0, 0.9).toFixed(3) + ')';
      ctx.fillRect(st.x, st.y, st.s, st.s);
    });
    clouds.forEach(function (c) {
      const x = ((c.x - t * c.v) % (W + c.w * 2) + (W + c.w * 2)) % (W + c.w * 2) - c.w;
      const gr = ctx.createRadialGradient(x, c.y, 0, x, c.y, c.w * 0.5);
      gr.addColorStop(0, 'rgba(255,255,255,' + c.a + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save(); ctx.translate(x, c.y); ctx.scale(1, 0.22); ctx.translate(-x, -c.y);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, c.y, c.w * 0.5, 0, 6.2832); ctx.fill(); ctx.restore();
    });
  }

  function drawGround(g) {
    // far hills + skyline
    ctx.fillStyle = '#25104f';
    ctx.beginPath(); ctx.moveTo(0, g.hor);
    for (let x = 0; x <= W; x += 24) ctx.lineTo(x, g.hor - 10 - 12 * Math.sin(x / W * 4 + 1) - 6 * Math.sin(x / 40));
    ctx.lineTo(W, g.hor); ctx.closePath(); ctx.fill();
    city.forEach(function (b) {
      ctx.fillStyle = '#1a0a3d'; ctx.fillRect(b.x, g.hor - b.h, b.w, b.h + 1);
      if (b.l > 0.35) { ctx.fillStyle = 'rgba(255,214,140,.5)'; for (let y = g.hor - b.h + 4; y < g.hor - 3; y += 6) if (((y * 7 + b.x * 3) | 0) % 5 < 2) ctx.fillRect(b.x + 3, y, 2, 2); }
    });
    const gr = ctx.createLinearGradient(0, g.hor, 0, H);
    gr.addColorStop(0, '#1a0a3d'); gr.addColorStop(1, '#0c0420');
    ctx.fillStyle = gr; ctx.fillRect(0, g.hor, W, H - g.hor);
    // apron glow
    const gl = ctx.createLinearGradient(0, g.rwTop - 30, 0, g.rwBot + 40);
    gl.addColorStop(0, 'rgba(124,58,237,0)'); gl.addColorStop(0.5, 'rgba(124,58,237,.22)'); gl.addColorStop(1, 'rgba(124,58,237,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, g.rwTop - 30, W, g.rwBot - g.rwTop + 70);
  }

  function drawRunway(g) {
    // surface
    const sf = ctx.createLinearGradient(0, g.rwTop, 0, g.rwBot);
    sf.addColorStop(0, '#2c2150'); sf.addColorStop(1, '#1b1236');
    ctx.fillStyle = sf; ctx.fillRect(0, g.rwTop, W, g.rwBot - g.rwTop);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(0, g.rwTop, W, 1.5); ctx.fillRect(0, g.rwBot - 1.5, W, 1.5);
    // centreline dashes
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    const cy = (g.rwTop + g.rwBot) / 2;
    for (let x = W * 0.06; x < W; x += 54) ctx.fillRect(x, cy - 1.5, 30, 3);
    // threshold bars
    for (let i = 0; i < 6; i++) ctx.fillRect(W * 0.012, g.rwTop + 6 + i * ((g.rwBot - g.rwTop - 12) / 6), 22, 3);
    // lights switch on in a wave ahead of the aircraft (t 0.7s -> 2.6s)
    const wave = clamp((t - 0.7) / 1.9, 0, 1);
    const front = W * 1.05 * easeOut(wave);
    const step = 26;
    for (let x = 8, k = 0; x < W; x += step, k++) {
      const lit = x < front;
      const age = lit ? clamp((front - x) / (W * 0.12), 0, 1) : 0;       // fresh lights flash brighter
      const flick = lit ? (0.82 + 0.18 * Math.sin(t * 7 + k)) : 0;
      [g.rwTop - 5, g.rwBot + 5].forEach(function (y) {
        if (lit) {
          const a = (0.55 + 0.45 * (1 - age * 0.4)) * flick;
          const rg = ctx.createRadialGradient(x, y, 0, x, y, 12);
          rg.addColorStop(0, 'rgba(255,236,150,' + (0.9 * a).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(255,200,80,0)');
          ctx.fillStyle = rg; ctx.fillRect(x - 12, y - 12, 24, 24);
          ctx.fillStyle = 'rgba(255,250,215,' + a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.2832); ctx.fill();
        } else { ctx.fillStyle = 'rgba(180,160,230,.25)'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.2832); ctx.fill(); }
      });
    }
    // approach (green threshold) + taxiway (blue) lights
    for (let x = 14; x < W; x += 52) {
      const lit = t > 1.2 + x / W * 0.8;
      ctx.fillStyle = lit ? 'rgba(80,170,255,.95)' : 'rgba(120,130,200,.2)';
      ctx.beginPath(); ctx.arc(x, g.rwBot + 30, 1.9, 0, 6.2832); ctx.fill();
      if (lit) { ctx.fillStyle = 'rgba(80,170,255,.18)'; ctx.beginPath(); ctx.arc(x, g.rwBot + 30, 7, 0, 6.2832); ctx.fill(); }
    }
    // soft glow along the strip when lit
    if (wave > 0) {
      const gl = ctx.createLinearGradient(0, g.rwTop - 40, 0, g.rwTop + 10);
      gl.addColorStop(0, 'rgba(255,220,130,0)'); gl.addColorStop(1, 'rgba(255,220,130,' + (0.12 * wave).toFixed(3) + ')');
      ctx.fillStyle = gl; ctx.fillRect(0, g.rwTop - 40, Math.min(W, front), 50);
    }
  }

  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* A polished business jet, side view, nose pointing right. Local units ~ 240 long. */
  function drawJet(p, g) {
    const s = g.s * (0.9 + 0.1 * (1 - p.air));
    // runway shadow
    const h = Math.max(0, (g.wheelY - g.gear - p.y)) / (H * 0.6);
    ctx.save();
    ctx.globalAlpha = clamp(0.5 - h * 1.1, 0.12, 0.5);
    ctx.fillStyle = '#000'; ctx.beginPath();
    ctx.ellipse(p.x - 6 * s, g.wheelY + 2, 100 * s * (1 - h * 0.6), 5 * s, 0, 0, 6.2832); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.scale(s, s);

    // landing-light beam (dusk) while airborne
    if (!p.ground || p.spd > 0.4) {
      const bm = ctx.createLinearGradient(110, 4, 340, 40);
      bm.addColorStop(0, 'rgba(255,248,210,.55)'); bm.addColorStop(1, 'rgba(255,248,210,0)');
      ctx.fillStyle = bm; ctx.beginPath(); ctx.moveTo(108, 3); ctx.lineTo(380, 20); ctx.lineTo(380, 66); ctx.closePath(); ctx.fill();
    }

    // far (left) wing + engine behind fuselage
    ctx.fillStyle = '#b9a7ea';
    ctx.beginPath(); ctx.moveTo(22, 5); ctx.lineTo(-22, 5); ctx.lineTo(-58, 27); ctx.lineTo(-40, 27); ctx.closePath(); ctx.fill();

    // landing gear
    if (p.gear > 0.01) {
      const gh = 34 * p.gear;
      ctx.save();
      ctx.strokeStyle = '#d8d0f0'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      [[56, 12], [-18, 12]].forEach(function (gp, i) {
        ctx.beginPath(); ctx.moveTo(gp[0], gp[1] - 2); ctx.lineTo(gp[0] + (i === 0 ? 2 : -2), gp[1] + gh - 8); ctx.stroke();
        ctx.fillStyle = '#18102e'; rr(gp[0] - 6, gp[1] + gh - 11, 12, 11, 4); ctx.fill();
      });
      ctx.restore();
    }

    // tail fin + stabiliser
    const fin = ctx.createLinearGradient(-110, -62, -70, -10);
    fin.addColorStop(0, '#5b21b6'); fin.addColorStop(1, '#8b5cf6');
    ctx.fillStyle = fin; ctx.beginPath(); ctx.moveTo(-62, -14); ctx.lineTo(-104, -66); ctx.lineTo(-121, -66); ctx.lineTo(-108, -14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6d28d9'; ctx.beginPath(); ctx.moveTo(-106, -62); ctx.lineTo(-138, -68); ctx.lineTo(-141, -62); ctx.lineTo(-116, -55); ctx.closePath(); ctx.fill();
    // fin mark
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.moveTo(-96, -46); ctx.lineTo(-104, -46); ctx.lineTo(-100, -33); ctx.lineTo(-86, -33); ctx.lineTo(-88, -28); ctx.lineTo(-104, -28); ctx.closePath(); ctx.fill();

    // rear engine (near side)
    const en = ctx.createLinearGradient(0, -14, 0, 8);
    en.addColorStop(0, '#e9e1ff'); en.addColorStop(1, '#8f7bd0');
    ctx.fillStyle = en; rr(-104, -18, 52, 17, 8); ctx.fill();
    ctx.fillStyle = '#2a1a55'; rr(-107, -16, 7, 13, 3); ctx.fill();

    // fuselage
    const fu = ctx.createLinearGradient(0, -20, 0, 18);
    fu.addColorStop(0, '#ffffff'); fu.addColorStop(0.55, '#ece6ff'); fu.addColorStop(1, '#a08ad8');
    ctx.fillStyle = fu; ctx.beginPath();
    ctx.moveTo(118, 3);
    ctx.bezierCurveTo(110, -10, 84, -19, 52, -20);
    ctx.lineTo(-62, -17);
    ctx.bezierCurveTo(-96, -15, -112, -9, -122, -3);
    ctx.bezierCurveTo(-110, 8, -90, 14, -62, 16);
    ctx.lineTo(54, 18);
    ctx.bezierCurveTo(88, 17, 110, 12, 118, 3);
    ctx.closePath(); ctx.fill();
    // livery stripe
    ctx.save(); ctx.clip();
    const st = ctx.createLinearGradient(-120, 0, 118, 0);
    st.addColorStop(0, '#6d28d9'); st.addColorStop(1, '#a78bfa');
    ctx.fillStyle = st; ctx.beginPath(); ctx.moveTo(-130, 4); ctx.lineTo(130, -2); ctx.lineTo(130, 4); ctx.lineTo(-130, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    // windows + windshield
    ctx.fillStyle = '#1c1240';
    for (let i = 0; i < 9; i++) { rr(-52 + i * 10.5, -10, 6, 5.5, 2.4); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(78, -10); ctx.lineTo(98, -7); ctx.lineTo(100, -3); ctx.lineTo(82, -3.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(78, -10, 10, 1.4);
    // fuselage top highlight
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-50, -17.5); ctx.lineTo(60, -19); ctx.stroke();

    // near wing
    const wg = ctx.createLinearGradient(0, 4, 0, 30);
    wg.addColorStop(0, '#d9ceff'); wg.addColorStop(1, '#8068c7');
    ctx.fillStyle = wg; ctx.beginPath(); ctx.moveTo(30, 6); ctx.lineTo(-30, 6); ctx.lineTo(-72, 32); ctx.lineTo(-50, 32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a78bfa'; ctx.beginPath(); ctx.moveTo(-70, 30); ctx.lineTo(-76, 38); ctx.lineTo(-62, 36); ctx.closePath(); ctx.fill();

    // navigation + strobe lights
    const blink = (Math.sin(t * 9) > 0.35) ? 1 : 0.15;
    [[-72, 33, '255,70,70'], [-52, -64, '255,255,255']].forEach(function (l, i) {
      const a = i === 1 ? blink : 0.95;
      const rg = ctx.createRadialGradient(l[0], l[1], 0, l[0], l[1], 14);
      rg.addColorStop(0, 'rgba(' + l[2] + ',' + a + ')'); rg.addColorStop(1, 'rgba(' + l[2] + ',0)');
      ctx.fillStyle = rg; ctx.fillRect(l[0] - 14, l[1] - 14, 28, 28);
    });
    ctx.restore();
  }

  function drawPuffs(dt, g) {
    puffs.forEach(function (p) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 28 * dt; p.vx *= 0.985;
      const a = clamp(1 - p.life / p.max, 0, 1) * 0.5;
      const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      gr.addColorStop(0, 'rgba(235,225,255,' + a.toFixed(3) + ')'); gr.addColorStop(1, 'rgba(235,225,255,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
    });
    puffs = puffs.filter(function (p) { return p.life < p.max; });
  }

  let prevT = 0;
  function frame(time) {
    // time is either rAF timestamp (ms) or - for the reduced-motion static frame - a seconds value
    const g = geo();
    if (reduced && time < 1000) t = time;
    const dt = Math.max(0, t - prevT); prevT = t;
    ctx.clearRect(0, 0, W, H);
    drawSky(g); drawGround(g); drawRunway(g);
    const p = planeState(g);
    if (p.ground && !touched) {
      touched = true;
      const r = rng(11);
      for (let i = 0; i < 16; i++) puffs.push({ x: p.x - 10, y: g.wheelY - 2, vx: -(30 + r() * 90) * (1 + p.spd), vy: -(r() * 14), r: 4 + r() * 6, life: 0, max: 0.9 + r() * 0.8 });
    }
    drawPuffs(dt, g);
    drawJet(p, g);
    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(8,2,22,.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  /* ------------------------------ progress + lifecycle ------------------------------ */
  function messageFor(pct) {
    return pct < 22 ? 'Approaching LAX…' : pct < 48 ? 'Runway lights on…' : pct < 72 ? 'Touchdown. Loading synthetic forecast data…' : pct < 100 ? 'Preparing the operations dashboard…' : 'Operations center ready';
  }
  function setProgress(pct) {
    pct = Math.round(pct);
    $('intro-fill').style.width = pct + '%';
    $('intro-pct').textContent = pct + '%';
    $('intro-msg').textContent = messageFor(pct);
    root.querySelector('.intro-bar').setAttribute('aria-valuenow', pct);
  }

  function tick(now) {
    if (finished) return;
    if (!t0) { t0 = now; last = now; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    t += dt;
    frame(now);
    const raw = clamp(t / READY_AT, 0, 1);
    const pct = Math.min(raw * 100, dataOk ? 100 : 94);
    setProgress(pct);
    if (pct >= 100) { showEnter(); }
    raf = requestAnimationFrame(tick);   // keeps lights and strobes alive while the button is shown
  }

  function showEnter() {
    const b = $('intro-enter');
    if (b.classList.contains('show')) return;
    b.classList.add('show');
    b.disabled = false;
    try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    try { global.localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
    document.body.classList.remove('intro-on');
    root.classList.add('leaving');
    document.removeEventListener('keydown', onKey);
    global.removeEventListener('resize', onResize);
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 900);
    // replay the page entrance animation now that the dashboard is visible
    const pg = document.querySelector('.page:not([hidden])');
    if (pg) {
      pg.hidden = true; void pg.offsetWidth; pg.hidden = false;      // restarts the CSS entrance animations
      pg.classList.remove('page-in'); void pg.offsetWidth; pg.classList.add('page-in');
      setTimeout(function () { pg.classList.remove('page-in'); }, 900);
      if (global.Charts) requestAnimationFrame(function () { Charts.replay(pg); });
      const h = pg.querySelector('h2');
      if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if ((e.key === 'Enter' || e.key === ' ') && $('intro-enter').classList.contains('show') && document.activeElement !== $('intro-skip')) { e.preventDefault(); finish(); }
  }
  let rzT = 0;
  function onResize() { clearTimeout(rzT); rzT = setTimeout(layout, 120); }

  function start() {
    root = $('intro');
    if (!root) return;
    cv = $('intro-canvas'); ctx = cv.getContext('2d');
    reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    let seen = false;
    try { seen = global.localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }
    if (seen) $('intro-skip').classList.add('returning');
    $('intro-skip').addEventListener('click', finish);
    $('intro-enter').addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
    global.addEventListener('resize', onResize);
    layout();
    running = true;
    if (reduced) {
      // static frame, quick fake load, then the button
      t = APPROACH + ROLL;
      frame(t);
      let p = 0;
      const iv = setInterval(function () { p += 14; setProgress(Math.min(p, dataOk ? 100 : 94)); if (p >= 100 && dataOk) { clearInterval(iv); showEnter(); } }, 80);
      Intro._iv = iv;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function dataReady() {
    dataOk = true;
    if (reduced) { setProgress(100); showEnter(); }
  }

  const Intro = { start: start, dataReady: dataReady, skip: finish, isRunning: function () { return running && !finished; } };
  global.Intro = Intro;
})(window);
