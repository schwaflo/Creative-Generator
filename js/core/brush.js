'use strict';
/* Pinsel: Der Nutzer malt direkt im Bild eine Maske, die KI-Shader über iBrush(fragCoord) lesen.
   Die Striche liegen als Daten im Zustand (params.brush, Format-Koordinaten 0..1, y nach oben, Radius in Einheiten
   der kürzeren Seite) und werden zu einer Graustufen-Textur gerastert – unabhängig von der Ausgabeauflösung,
   Vorschau und Export sehen also gleich aus. Radieren malt schwarz. */
CG.brush = (() => {
  const { el } = CG.util;
  const H = CG.haptics;
  const SIDE = 2048;                 // längste Seite der Masken-Textur
  let canvas = null, ctx = null;
  let tex = null, texGl = null, last = { list: null, ver: -1, w: 0, h: 0 };
  let cur = null, live = null, ver = 0;

  const strokes = () => (CG.state && Array.isArray(CG.state.params.brush)) ? CG.state.params.brush : [];

  /* Striche -> Canvas (weiß = gemalt). fw/fh: Seitenverhältnis des Formats */
  function raster(list, fw, fh, side = SIDE, target = null) {
    const k = side / Math.max(fw, fh);
    const w = Math.max(1, Math.round(fw * k)), h = Math.max(1, Math.round(fh * k));
    let c = target, g;
    if (!c) { if (!canvas) { canvas = document.createElement('canvas'); ctx = canvas.getContext('2d'); } c = canvas; g = ctx; }
    else g = c.getContext('2d');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const mn = Math.min(w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of list) {
      const p = s && s.p; if (!p || p.length < 2) continue;
      const col = s.e ? '#000' : '#fff', lw = Math.max(1, 2 * (+s.r || 0.05) * mn);
      g.fillStyle = g.strokeStyle = col; g.lineWidth = lw;
      if (p.length === 2) { g.beginPath(); g.arc(p[0] * w, (1 - p[1]) * h, lw / 2, 0, Math.PI * 2); g.fill(); continue; }
      g.beginPath(); g.moveTo(p[0] * w, (1 - p[1]) * h);
      for (let i = 2; i + 1 < p.length; i += 2) g.lineTo(p[i] * w, (1 - p[i + 1]) * h);
      g.stroke();
    }
    return c;
  }

  /* Vom Renderer bei jedem Zeichnen: Textur auf Einheit 5, nur neu rastern, wenn sich etwas geändert hat */
  function bind(gl, loc) {
    const fn = CG.fn && CG.fn();
    const list = live || strokes();
    const on = !!(fn && fn.usesBrush && list.length);
    if (!tex || texGl !== gl) { tex = gl.createTexture(); texGl = gl; last = { list: null, ver: -1, w: 0, h: 0 }; }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const F = CG.state.format;
    if (on && (list !== last.list || ver !== last.ver || F.w !== last.w || F.h !== last.h)) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster(list, F.w, F.h));
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      last = { list, ver, w: F.w, h: F.h };
    } else if (!on && last.list === null) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      last = { list: [], ver: -1, w: 0, h: 0 };
    }
    gl.uniform1i(loc('uBrush'), 5);
    gl.uniform1f(loc('uBrushOn'), on ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  /* ---------- Malen (vom Viewport-Werkzeug, Koordinaten 0..1, y nach oben) ---------- */
  function begin(x, y) {
    const P = CG.state.params;
    cur = { e: +P.brushMode === 1 ? 1 : 0, r: +P.brushSize || 0.05, p: [+x.toFixed(4), +y.toFixed(4)] };
    live = [...strokes(), cur]; ver++;
    CG.markDirty();
  }
  function move(x, y) {
    if (!cur) return;
    const p = cur.p, n = p.length;
    if (Math.hypot(x - p[n - 2], y - p[n - 1]) < 0.0025) return;
    p.push(+x.toFixed(4), +y.toFixed(4)); ver++;
    CG.markDirty();
  }
  function end() {
    if (!cur) return;
    const s = cur; cur = null; live = null; ver++;
    CG.panel.setMany({ brush: [...strokes(), s] });
  }

  /* Gruppe „Pinsel“: Hinweis, Rückgängig, Leeren */
  function buildPanel(body) {
    const bar = el(`<div class="pill brush-bar">
        <span class="brush-hint">Im Bild malen</span>
        <button class="act" type="button" data-a="undo" title="Rückgängig">${CG.icon('undo')}</button>
        <button class="act danger" type="button" data-a="clear" title="Leeren">${CG.icon('trash')}</button>
      </div>`);
    bar.querySelector('[data-a=undo]').onclick = () => { const l = strokes(); if (!l.length) return; H.tick(); CG.panel.setMany({ brush: l.slice(0, -1) }); };
    bar.querySelector('[data-a=clear]').onclick = () => { if (!strokes().length) return; H.tick(); CG.panel.setMany({ brush: [] }); };
    body.appendChild(bar);
  }

  return { bind, raster, begin, move, end, buildPanel, get drawing() { return !!cur; } };
})();
