/* =========================================================================
   Minimal dependency-free SVG chart engine (bars, stacked bars, lines,
   steps, areas, confidence bands/whiskers, bands, thresholds).
   Interactive: hover/touch tooltips, keyboard arrows, click-to-select.
   ========================================================================= */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  let tip = null;

  function S(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(html, x, y) {
    const t = ensureTip();
    t.innerHTML = html;
    t.hidden = false;
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    if (top < 8) top = 8;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return n * p;
  }
  function niceScale(min, max, ticks) {
    if (max === min) { max = min + 1; }
    const step = niceStep((max - min) / ticks);
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    const out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
    return { min: lo, max: hi, ticks: out };
  }

  function render(container, spec) {
    container.__spec = spec;
    container.classList.add('chart');
    if (!container.__hidden) container.__hidden = new Set();
    const hidden = container.__hidden;

    // legend (persistent between redraws)
    container.innerHTML = '';
    if (spec.legend !== false) {
      const lg = document.createElement('div');
      lg.className = 'chart-legend';
      spec.series.forEach(function (s) {
        if (s.noLegend) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'legend-item';
        b.setAttribute('aria-pressed', hidden.has(s.name) ? 'false' : 'true');
        b.title = 'Toggle ' + s.name;
        const sw = document.createElement('span');
        sw.className = 'swatch ' + (s.type === 'line' || s.type === 'step' ? 'swatch-line' : '');
        sw.style.background = s.color;
        if (s.dash) sw.style.background = 'repeating-linear-gradient(90deg,' + s.color + ' 0 4px,transparent 4px 7px)';
        b.appendChild(sw);
        b.appendChild(document.createTextNode(s.name));
        b.addEventListener('click', function () {
          if (hidden.has(s.name)) hidden.delete(s.name); else hidden.add(s.name);
          b.setAttribute('aria-pressed', hidden.has(s.name) ? 'false' : 'true');
          draw(container, false);
        });
        lg.appendChild(b);
      });
      container.appendChild(lg);
    }
    const host = document.createElement('div');
    host.className = 'chart-host';
    container.appendChild(host);
    container.__host = host;
    draw(container, spec.animate !== false);

    if (!container.__ro && 'ResizeObserver' in window) {
      container.__lastW = container.clientWidth;
      container.__ro = new ResizeObserver(function () {
        const w = container.clientWidth;
        if (Math.abs(w - container.__lastW) > 2) {
          container.__lastW = w;
          cancelAnimationFrame(container.__raf);
          container.__raf = requestAnimationFrame(function () { draw(container, false); });
        }
      });
      container.__ro.observe(container);
    }
  }

  function draw(container, animate) {
    const spec = container.__spec, host = container.__host, hidden = container.__hidden;
    host.innerHTML = '';
    const W = Math.max(280, container.clientWidth || 600);
    const H = spec.height || 280;
    const hasY2 = spec.series.some(function (s) { return s.axis === 'y2' && !hidden.has(s.name); });
    const m = { l: spec.yTitle ? 52 : 42, r: hasY2 ? 50 : 14, t: spec.markers && spec.markers.length ? 26 : 12, b: spec.xTitle ? 46 : 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = spec.x.length;
    const slot = pw / n;
    const xc = function (i) { return m.l + slot * (i + 0.5); };
    const vis = spec.series.filter(function (s) { return !hidden.has(s.name); });

    // ----- domains -----
    function domain(axis) {
      let lo = Infinity, hi = -Infinity;
      const stacks = {};
      vis.forEach(function (s) {
        if ((s.axis || 'y') !== axis) return;
        s.data.forEach(function (v, i) {
          if (v == null) return;
          if (s.type === 'bar' && s.stack) {
            const st = stacks[s.stack] || (stacks[s.stack] = { pos: new Array(n).fill(0), neg: new Array(n).fill(0) });
            if (v >= 0) st.pos[i] += v; else st.neg[i] += v;
          } else { lo = Math.min(lo, v); hi = Math.max(hi, v); }
          if (s.ci) { lo = Math.min(lo, s.ci.lo[i]); hi = Math.max(hi, s.ci.hi[i]); }
        });
        if (s.type === 'bar' || s.type === 'area') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      });
      Object.keys(stacks).forEach(function (k) { stacks[k].pos.forEach(function (v) { hi = Math.max(hi, v); lo = Math.min(lo, 0); }); stacks[k].neg.forEach(function (v) { lo = Math.min(lo, v); }); });
      (spec.hlines || []).forEach(function (h) { if ((h.axis || 'y') === axis) { hi = Math.max(hi, h.y); lo = Math.min(lo, h.y); } });
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (axis === 'y') { if (spec.yMin != null) lo = spec.yMin; else if (lo > 0) lo = 0; if (spec.yMax != null) hi = Math.max(hi, spec.yMax); }
      else { if (spec.y2Min != null) lo = spec.y2Min; else if (lo > 0) lo = 0; if (spec.y2Max != null) hi = Math.max(hi, spec.y2Max); }
      return niceScale(lo, hi * 1.04, 5);
    }
    const dy = domain('y');
    const dy2 = hasY2 ? domain('y2') : null;
    const yS = function (v) { return m.t + ph * (1 - (v - dy.min) / (dy.max - dy.min)); };
    const y2S = function (v) { return m.t + ph * (1 - (v - dy2.min) / (dy2.max - dy2.min)); };
    const yFor = function (s, v) { return s.axis === 'y2' ? y2S(v) : yS(v); };

    const svg = S('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': spec.ariaLabel || 'Chart' }, host);
    svg.setAttribute('class', 'chart-svg' + (animate ? ' chart-anim' : ''));
    if (spec.ariaLabel) S('title', {}, svg).textContent = spec.ariaLabel;

    // ----- bands / highlights (behind) -----
    (spec.bands || []).forEach(function (b) {
      const x0 = m.l + slot * b.from, x1 = m.l + slot * b.to;
      S('rect', { x: x0, y: m.t, width: x1 - x0, height: ph, fill: b.color || 'rgba(124,58,237,.09)' }, svg);
      if (b.label) {
        const t = S('text', { x: x0 + 4, y: m.t + 11, 'class': 'chart-band-label' }, svg);
        t.textContent = b.label;
      }
    });
    (spec.highlight || []).forEach(function (i) {
      S('rect', { x: m.l + slot * i, y: m.t, width: slot, height: ph, fill: 'rgba(124,58,237,.09)' }, svg);
    });
    if (spec.selected != null && spec.selected >= 0) {
      S('rect', { x: m.l + slot * spec.selected, y: m.t, width: slot, height: ph, fill: 'rgba(124,58,237,.10)', stroke: 'rgba(124,58,237,.55)', 'stroke-dasharray': '3 3' }, svg);
    }

    // ----- grid + axes -----
    dy.ticks.forEach(function (v) {
      const y = yS(v);
      S('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, 'class': v === 0 ? 'chart-axis' : 'chart-grid' }, svg);
      const t = S('text', { x: m.l - 7, y: y + 4, 'text-anchor': 'end', 'class': 'chart-tick' }, svg);
      t.textContent = spec.yFormat ? spec.yFormat(v) : v;
    });
    if (dy2) dy2.ticks.forEach(function (v) {
      const t = S('text', { x: W - m.r + 7, y: y2S(v) + 4, 'text-anchor': 'start', 'class': 'chart-tick' }, svg);
      t.textContent = spec.y2Format ? spec.y2Format(v) : v;
    });
    if (spec.yTitle) {
      const t = S('text', { x: 12, y: m.t + ph / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + ph / 2) + ')', 'class': 'chart-axis-title' }, svg);
      t.textContent = spec.yTitle;
    }
    if (dy2 && spec.y2Title) {
      const t = S('text', { x: W - 10, y: m.t + ph / 2, 'text-anchor': 'middle', transform: 'rotate(90 ' + (W - 10) + ' ' + (m.t + ph / 2) + ')', 'class': 'chart-axis-title' }, svg);
      t.textContent = spec.y2Title;
    }
    const lw = spec.labelW || 46;
    const step = spec.xStep || Math.max(1, Math.ceil(lw / slot));
    spec.x.forEach(function (lab, i) {
      if (i % step !== 0) return;
      const t = S('text', { x: xc(i), y: m.t + ph + 18, 'text-anchor': 'middle', 'class': 'chart-tick' }, svg);
      t.textContent = lab;
    });
    if (spec.xTitle) {
      const t = S('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle', 'class': 'chart-axis-title' }, svg);
      t.textContent = spec.xTitle;
    }

    // ----- bars -----
    const barSeries = vis.filter(function (s) { return s.type === 'bar'; });
    const groups = [];
    barSeries.forEach(function (s) { const g = s.stack || ('__' + s.name); if (groups.indexOf(g) < 0) groups.push(g); });
    const gap = groups.length > 1 ? 2 : 0;
    const barW = Math.min((slot * 0.78) / Math.max(1, groups.length), spec.maxBar || 38);
    const stackAcc = {};
    barSeries.forEach(function (s) {
      const g = s.stack || ('__' + s.name), gi = groups.indexOf(g);
      s.data.forEach(function (v, i) {
        if (v == null) return;
        const x = xc(i) - (barW * groups.length) / 2 + gi * barW + gap / 2;
        let y0, y1;
        if (s.stack) {
          const key = g + ':' + i;
          const acc = stackAcc[key] || (stackAcc[key] = { pos: 0, neg: 0 });
          if (v >= 0) { y0 = acc.pos; acc.pos += v; y1 = acc.pos; } else { y0 = acc.neg; acc.neg += v; y1 = acc.neg; }
        } else { y0 = 0; y1 = v; }
        const yt = yFor(s, Math.max(y0, y1)), yb = yFor(s, Math.min(y0, y1));
        const col = s.colors ? s.colors[i] : s.color;
        const r = S('rect', { x: x, y: yt, width: Math.max(1, barW - gap), height: Math.max(0.5, yb - yt), fill: col, rx: s.stack ? 0 : 2, 'class': 'cb', style: '--d:' + Math.round(i * 22) }, svg);
        if (s.opacity) r.setAttribute('opacity', s.opacity);
        if (s.outline) { r.setAttribute('stroke', s.outline); r.setAttribute('stroke-width', 1); }
        if (s.ci && !s.stack) {
          const cx = x + (barW - gap) / 2;
          S('line', { x1: cx, x2: cx, y1: yFor(s, s.ci.lo[i]), y2: yFor(s, s.ci.hi[i]), 'class': 'chart-whisker cf' }, svg);
          S('line', { x1: cx - 4, x2: cx + 4, y1: yFor(s, s.ci.hi[i]), y2: yFor(s, s.ci.hi[i]), 'class': 'chart-whisker' }, svg);
          S('line', { x1: cx - 4, x2: cx + 4, y1: yFor(s, s.ci.lo[i]), y2: yFor(s, s.ci.lo[i]), 'class': 'chart-whisker' }, svg);
        }
        if (s.labels && (slot * 0.78 / groups.length) > 20 && yb - yt > 12) {
          const t = S('text', { x: x + (barW - gap) / 2, y: yt + 12, 'text-anchor': 'middle', 'class': 'chart-barlabel' }, svg);
          t.textContent = v;
        }
      });
    });

    // ----- diff shading (e.g. shortage vs surplus) -----
    if (spec.diff && !hidden.has('__diff')) {
      const d = spec.diff;
      d.a.forEach(function (va, i) {
        const vb = d.b[i];
        if (va === vb) return;
        const hi = Math.max(va, vb), lo = Math.min(va, vb);
        S('rect', { x: m.l + slot * i, y: yS(hi), width: slot, height: Math.max(0.5, yS(lo) - yS(hi)), fill: va > vb ? (d.posColor || 'rgba(217,52,43,.22)') : (d.negColor || 'rgba(26,154,91,.16)') }, svg);
      });
    }

    // ----- areas / lines -----
    vis.forEach(function (s) {
      if (s.type === 'bar') return;
      const pts = [];
      s.data.forEach(function (v, i) {
        if (v == null) return;
        if (s.type === 'step') { pts.push([m.l + slot * i, yFor(s, v)]); pts.push([m.l + slot * (i + 1), yFor(s, v)]); }
        else pts.push([xc(i), yFor(s, v)]);
      });
      if (!pts.length) return;
      if (s.ci && s.type !== 'bar') {
        const up = s.data.map(function (v, i) { return [xc(i), yFor(s, s.ci.hi[i])]; });
        const dn = s.data.map(function (v, i) { return [xc(i), yFor(s, s.ci.lo[i])]; }).reverse();
        S('path', { d: 'M' + up.concat(dn).map(function (p) { return p[0] + ' ' + p[1]; }).join('L') + 'Z', fill: s.color, 'fill-opacity': 0.13, 'class': 'cf' }, svg);
      }
      const d = 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L');
      if (s.type === 'area' || s.fill) {
        const base = yFor(s, Math.max(dy.min, 0));
        S('path', { d: d + 'L' + pts[pts.length - 1][0] + ' ' + base + 'L' + pts[0][0] + ' ' + base + 'Z', fill: s.color, 'fill-opacity': s.fillOpacity || 0.16, 'class': 'cf' }, svg);
      }
      const p = S('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: 1, 'class': s.dash ? 'cf' : 'cl' }, svg);
      if (s.dash) { p.setAttribute('stroke-dasharray', s.dash); p.removeAttribute('pathLength'); }
      if (s.dots || (n <= 12 && s.type === 'line' && s.dots !== false)) {
        s.data.forEach(function (v, i) { if (v != null) S('circle', { cx: xc(i), cy: yFor(s, v), r: 3.4, fill: '#fff', stroke: s.color, 'stroke-width': 2, 'class': 'cf' }, svg); });
      }
    });

    // ----- horizontal reference lines -----
    (spec.hlines || []).forEach(function (h) {
      const y = (h.axis === 'y2' ? y2S : yS)(h.y);
      S('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: h.color || '#d9342b', 'stroke-width': 1.6, 'stroke-dasharray': h.dash || '6 4' }, svg);
      if (h.label) {
        const t = S('text', { x: W - m.r - 4, y: y - 5, 'text-anchor': 'end', 'class': 'chart-ref-label' }, svg);
        t.setAttribute('fill', h.color || '#d9342b');
        t.textContent = h.label;
      }
    });

    // ----- markers -----
    (spec.markers || []).forEach(function (mk) {
      const w = Math.max(30, mk.text.length * 6 + 12);
      const cx = Math.min(Math.max(xc(mk.i), m.l + w / 2), W - m.r - w / 2);
      S('rect', { x: cx - w / 2, y: 3, width: w, height: 17, rx: 8.5, fill: mk.color || '#7c3aed' }, svg);
      const t = S('text', { x: cx, y: 15, 'text-anchor': 'middle', 'class': 'chart-marker' }, svg);
      t.textContent = mk.text;
    });

    // ----- interaction -----
    const guide = S('rect', { x: 0, y: m.t, width: slot, height: ph, 'class': 'chart-guide', visibility: 'hidden' }, svg);
    const overlay = S('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent', tabindex: 0, 'class': 'chart-overlay', role: 'group', 'aria-label': (spec.ariaLabel || 'Chart') + '. Use left and right arrow keys to read values; press Enter to select.' }, svg);
    let cur = -1;
    function tooltipHtml(i) {
      if (spec.tooltip) return spec.tooltip(i);
      let h = '<div class="tt-title">' + spec.x[i] + '</div>';
      vis.forEach(function (s) { if (s.data[i] != null && !s.noTip) h += '<div class="tt-row"><span class="dot" style="background:' + s.color + '"></span>' + s.name + '<b>' + (s.fmt ? s.fmt(s.data[i]) : s.data[i]) + '</b></div>'; });
      return h;
    }
    function focusIdx(i, cx, cy) {
      cur = i;
      guide.setAttribute('x', m.l + slot * i);
      guide.setAttribute('visibility', 'visible');
      const html = tooltipHtml(i);
      if (html) showTip(html, cx, cy); else hideTip();
    }
    function idxFromEvent(e) {
      const r = svg.getBoundingClientRect();
      const x = e.clientX - r.left - m.l;
      return Math.max(0, Math.min(n - 1, Math.floor(x / slot)));
    }
    overlay.addEventListener('pointermove', function (e) { focusIdx(idxFromEvent(e), e.clientX, e.clientY); });
    overlay.addEventListener('pointerdown', function (e) { focusIdx(idxFromEvent(e), e.clientX, e.clientY); });
    overlay.addEventListener('pointerleave', function () { guide.setAttribute('visibility', 'hidden'); hideTip(); cur = -1; });
    overlay.addEventListener('click', function (e) { if (spec.onSelect) spec.onSelect(idxFromEvent(e)); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = Math.max(0, Math.min(n - 1, (cur < 0 ? (e.key === 'ArrowRight' ? -1 : n) : cur) + (e.key === 'ArrowRight' ? 1 : -1)));
        const r = svg.getBoundingClientRect();
        focusIdx(i, r.left + xc(i), r.top + m.t + ph * 0.3);
      } else if (e.key === 'Enter' && cur >= 0 && spec.onSelect) { spec.onSelect(cur); }
      else if (e.key === 'Escape') { guide.setAttribute('visibility', 'hidden'); hideTip(); }
    });
    overlay.addEventListener('blur', function () { guide.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  /* Re-run the entrance animation for every chart inside `root` (used when a tab becomes visible). */
  function replay(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.chart'), function (c) { if (c.__spec && c.__host) draw(c, true); });
  }

  global.Charts = { render: render, hideTip: hideTip, showTip: showTip, replay: replay };
})(window);
