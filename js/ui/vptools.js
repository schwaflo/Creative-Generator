'use strict';
/* Direkte Bedienung im Viewport – abhängig von der offenen Gruppe:
   - Farbe:   Klick auf eine Stelle -> passendes Farbfeld wird gewählt und der Farbwähler geöffnet
   - Gruppen mit vp-Angabe (z. B. Kamera, Inhalt): Ziehen, Mausrad/Pinch, Klick, Doppelklick */
CG.vptools = (() => {
  const { $, clamp, hexToRgb } = CG.util;
  const H = CG.haptics;
  let vp = null, cv = null, mode = null, drag = null;

  const defOf = key => CG.allParams(CG.fn()).find(p => p.key === key);

  function update() {
    if (!vp) return;
    const id = CG.panel.openId;
    const g = id ? CG.groupsFor(CG.fn()).find(x => x.id === id) : null;
    mode = g && g.palette ? { kind: 'color', g } : g && g.vp ? { kind: 'vp', g, vp: g.vp } : null;
    vp.dataset.tool = mode ? (mode.kind === 'color' ? 'pick' : mode.vp.cursor || 'grab') : '';
  }

  // Wert in den Bereich des Parameters bringen; Winkel mit Rasten bei 0/90/180/270°
  function norm(def, v, key) {
    if (def.type === 'angle' && def.wrap !== false) {
      v = ((v % 360) + 360) % 360;
      for (const t of [0, 90, 180, 270, 360]) if (Math.abs(v - t) < 1.5) { v = t % 360; break; }
    } else if (def.min !== undefined) v = clamp(v, def.min, def.max);
    const prev = drag && drag.last[key];
    if (drag && prev !== undefined && prev !== v) {
      const edge = x => def.type === 'angle' && def.wrap !== false ? x % 90 === 0 : (x === def.min || x === def.max);
      if (edge(v) && !edge(prev)) H.tick();
    }
    if (drag) drag.last[key] = v;
    return +(+v).toFixed(4);
  }

  const rect = () => { const r = cv.getBoundingClientRect(); return { r, mn: Math.min(r.width, r.height) }; };

  function init() {
    vp = $('#viewport'); cv = $('#cv');
    vp.addEventListener('pointerdown', e => {
      if (!mode || e.button !== 0 || CG.exporter.recording) return;
      if (e.target !== cv && e.target !== vp) return;           // Bildrahmen & Overlays haben Vorrang
      e.preventDefault();
      vp.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, P: { ...CG.state.params }, moved: false, last: {} };
    });
    vp.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; vp.classList.add('dragging');
      if (mode.kind !== 'vp' || !mode.vp.drag) return;
      const { mn } = rect(), o = {};
      for (const b of mode.vp.drag) {
        const def = defOf(b.key); if (!def) continue;
        let v;
        if (b.unit === 'content') v = drag.P[b.key] + (b.axis === 'x' ? dx : -dy) / mn / Math.max(1, drag.P.zoom || 1);
        else v = drag.P[b.key] + (b.axis === 'x' ? dx : dy) * b.k;
        o[b.key] = norm(def, v, b.key);
      }
      CG.panel.setMany(o);
    });
    const end = e => {
      if (!drag) return;
      const d = drag; drag = null; vp.classList.remove('dragging');
      if (!d.moved && e.type === 'pointerup') click(e);
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', e => {
      if (!mode || mode.kind !== 'vp' || !mode.vp.wheel) return;
      e.preventDefault();
      const key = mode.vp.wheel.key, def = defOf(key);
      const v = CG.state.params[key] * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      drag = drag || { last: {}, tmp: true };
      const n = norm(def, v, key);
      if (drag.tmp) drag = null;
      CG.panel.setMany({ [key]: n });
    }, { passive: false });
    vp.addEventListener('dblclick', e => {
      if (!mode || mode.kind !== 'vp' || !mode.vp.reset || (e.target !== cv && e.target !== vp)) return;
      H.tick(); CG.panel.setMany({ ...mode.vp.reset });
    });
    update();
  }

  function click(e) {
    const { r, mn } = rect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    if (mode.kind === 'color') return pick(e, r);
    if (mode.vp.click) {
      const pt = [(e.clientX - r.left - r.width / 2) / mn, -(e.clientY - r.top - r.height / 2) / mn];
      const o = mode.vp.click(pt);
      if (o) { H.tick(); CG.panel.setMany(o); }
    }
  }

  // Farbe unter dem Zeiger lesen und das nächstliegende Farbfeld der Palette öffnen
  function pick(e, r) {
    if (!CG.R || !CG.view.prevW) return;
    const V = CG.view;
    CG.R.draw(CG.fn(), CG.state.params, V.phase, V.prevW, V.prevH);
    const x = Math.floor((e.clientX - r.left) / r.width * cv.width), y = Math.floor((e.clientY - r.top) / r.height * cv.height);
    const gl = CG.R.gl, px = new Uint8Array(4);
    gl.readPixels(clamp(x, 0, cv.width - 1), clamp(cv.height - 1 - y, 0, cv.height - 1), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    V.dirty = true;
    let best = null, bd = Infinity;
    for (const p of mode.g.params) {
      if (p.type !== 'color') continue;
      const c = hexToRgb(CG.state.params[p.key]);
      const dd = (c[0] * 255 - px[0]) ** 2 + (c[1] * 255 - px[1]) ** 2 + (c[2] * 255 - px[2]) ** 2;
      if (dd < bd) { bd = dd; best = p.key; }
    }
    if (!best) return;
    const lbl = document.querySelector(`.group[data-id="${mode.g.id}"] .sw[data-k="${best}"]`);
    if (!lbl) return;
    H.tick();
    lbl.classList.remove('picked'); void lbl.offsetWidth; lbl.classList.add('picked');
    lbl.querySelector('input').click();
  }

  return { init, update };
})();
