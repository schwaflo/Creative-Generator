'use strict';
/* Pencil-Oberfläche: Zeichenfläche bzw. Texteingabe (Gruppe „Inhalt“) und Werkzeugwahl */
CG.sketch = (() => {
  const { el, esc, store, clamp } = CG.util;
  const H = CG.haptics;
  const P = () => CG.state.params;
  const set = o => CG.panel.setMany(o);
  const defOf = key => CG.allParams(CG.fn()).find(p => p.key === key);
  let C = null, B = null;
  let ink = store.get('pc.ink', 0);
  const history = [];

  /* ---------- Inhalt ---------- */
  function content(body) {
    if (C && C.ro) C.ro.disconnect();
    const src = CG.controls.segment({ key: 'src', options: defOf('src').options }, P().src, v => set({ src: v }));
    const pad = el('<div class="sketch"><canvas></canvas></div>');
    const bar = el(`<div class="pill sketch-bar">
        <div class="inks">${[0, 1, 2].map(i => `<button type="button" class="ink" data-i="${i}" title="Farbe ${i + 1}"></button>`).join('')}</div>
        <button class="act" type="button" data-a="undo" title="Rückgängig">${CG.icon('undo')}</button>
        <button class="act danger" type="button" data-a="clear" title="Leeren">${CG.icon('trash')}</button>
      </div>`);
    const svgPill = el(`<div class="pill upload-pill">
        <span class="up-name"></span>
        <button class="act" type="button" data-a="up" title="SVG laden">${CG.icon('upload')}</button>
        <input type="file" accept=".svg,image/svg+xml" hidden>
      </div>`);
    const svgFile = svgPill.querySelector('input');
    svgPill.querySelector('[data-a=up]').onclick = () => svgFile.click();
    svgFile.onchange = () => { if (svgFile.files[0]) importSvg(svgFile.files[0]); svgFile.value = ''; };
    const textBox = el('<div class="pill text-pill"><textarea rows="2" maxlength="160" spellcheck="false" aria-label="Text"></textarea></div>');
    const font = CG.controls.segment({ key: 'font', options: defOf('font').options }, P().font, v => set({ font: v }));
    font.el.classList.add('seg-compact');
    const size = CG.controls.create(defOf('csize'), P().csize, v => set({ csize: v }));
    body.append(src.el, pad, bar, svgPill, textBox, font.el, size.el);

    const cv = pad.querySelector('canvas'), ta = textBox.querySelector('textarea');
    C = { src, pad, bar, svgPill, textBox, font, size, cv, ta, sig: '' };

    // Text
    let tT;
    ta.addEventListener('input', () => { clearTimeout(tT); tT = setTimeout(() => set({ text: ta.value }), 280); });
    ta.addEventListener('keydown', e => e.stopPropagation());

    // Werkzeugleiste
    bar.querySelectorAll('.ink').forEach(b => b.onclick = () => { ink = +b.dataset.i; store.set('pc.ink', ink); H.tick(); syncContent(); });
    bar.querySelector('[data-a=undo]').onclick = () => {
      const prev = history.length ? history.pop() : (P().strokes || []).slice(0, -1);
      set({ strokes: prev });
    };
    bar.querySelector('[data-a=clear]').onclick = () => {
      if (!(P().strokes || []).length) return;
      history.push(P().strokes); set({ strokes: [] }); H.tick();
    };

    // Zeichnen
    let cur = null, last = null;
    const frame = () => {
      const r = cv.getBoundingClientRect();
      return { r, m: Math.min(r.width, r.height) };
    };
    const addPt = (ev, f) => {
      const px = ev.clientX - f.r.left, py = ev.clientY - f.r.top;
      if (last && Math.hypot(px - last.px, py - last.py) < 1.2) return;
      let pr;
      if (ev.pointerType === 'pen' && ev.pressure > 0) pr = 0.3 + 0.7 * ev.pressure;
      else {
        const v = last ? Math.hypot(px - last.px, py - last.py) / Math.max(1, ev.timeStamp - last.t) : 0;
        pr = clamp(1.12 - v * 0.22, 0.45, 1);
        if (last) pr = last.pr * 0.7 + pr * 0.3;
      }
      last = { px, py, t: ev.timeStamp, pr };
      cur.p.push(+((px - f.r.width / 2) / f.m).toFixed(4), +(-(py - f.r.height / 2) / f.m).toFixed(4), +pr.toFixed(3));
    };
    cv.addEventListener('pointerdown', e => {
      if (e.button !== 0 || +P().src !== 0) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      cur = { i: ink, p: [] }; last = null;
      const f = frame(); addPt(e, f); drawPad(cur);
    });
    cv.addEventListener('pointermove', e => {
      if (!cur) return;
      const f = frame();
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) addPt(ev, f);
      drawPad(cur);
    });
    const end = () => {
      if (!cur) return;
      const s = { i: cur.i, p: simplify(cur.p, 0.0012) };
      cur = null;
      history.push(P().strokes || []);
      if (history.length > 40) history.shift();
      set({ strokes: [...(P().strokes || []), s] });
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    C.ro = new ResizeObserver(() => { C.sig = ''; drawPad(); });
    C.ro.observe(pad);
    syncContent();
  }

  // Ramer-Douglas-Peucker auf [x,y,p]-Tripeln
  function simplify(p, eps) {
    const n = p.length / 3;
    if (n < 3) return p;
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      const ax = p[a * 3], ay = p[a * 3 + 1], bx = p[b * 3], by = p[b * 3 + 1];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((p[i * 3] - ax) * dy - (p[i * 3 + 1] - ay) * dx) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    return out;
  }

  function drawPad(live) {
    if (!C || C.pad.hidden) return;
    const cv = C.cv, Pr = P();
    const aw = C.pad.clientWidth - 12;
    if (aw <= 0) return;
    const { w, h } = CG.state.format, ar = w / h;
    let cw = aw, ch = aw / ar;
    if (ch > 140) { ch = 140; cw = ch * ar; }
    const dpr = window.devicePixelRatio || 1;
    let strokes = Pr.strokes || [];
    if (+Pr.src === 2) {       // SVG: so einpassen wie im Bild (ohne Größe/Position)
      const ex = Math.max(ar, 1), ey = Math.max(1 / ar, 1);
      const list = CG.fn().sourceStrokes ? CG.fn().sourceStrokes({ ...Pr, csize: 1, cx: 0, cy: 0 }, ex, ey) || [] : [];
      strokes = list.map(st => ({ i: st.ink, p: st.pts.flat() }));
    }
    const sig = [cw, ch, Pr.bg, Pr.ink1, Pr.ink2, Pr.ink3, Pr.width, +Pr.src, strokes.length, Pr.src == 2 ? Pr.svgStrokes : strokes].join('|');
    if (!live && sig === C.sig) return;
    C.sig = live ? '' : sig;
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    if (cv.width !== Math.round(cw * dpr)) cv.width = Math.round(cw * dpr);
    if (cv.height !== Math.round(ch * dpr)) cv.height = Math.round(ch * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = Pr.bg; g.fillRect(0, 0, cw, ch);
    const m = Math.min(cw, ch), inks = [Pr.ink1, Pr.ink2, Pr.ink3];
    const X = x => cw / 2 + x * m, Y = y => ch / 2 - y * m;
    const base = Math.max(1.2, Pr.width / 1000 * m);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of live ? [...strokes, live] : strokes) {
      const p = s.p;
      g.strokeStyle = inks[s.i] || inks[0];
      if (p.length < 6) { g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(X(p[0]), Y(p[1]), base / 2, 0, 7); g.fill(); continue; }
      for (let i = 3; i < p.length; i += 3) {
        g.lineWidth = Math.max(1, base * (p[i - 1] + p[i + 2]) / 2);
        g.beginPath(); g.moveTo(X(p[i - 3]), Y(p[i - 2])); g.lineTo(X(p[i]), Y(p[i + 1])); g.stroke();
      }
    }
  }

  /* SVG laden -> Striche */
  async function importSvg(file) {
    if (!file || !(/\.svg$/i.test(file.name) || file.type === 'image/svg+xml')) return CG.util.toast('Bitte eine SVG-Datei wählen');
    try {
      const strokes = await CG.strokes.fromSvg(await file.text());
      H.tick();
      set({ svgStrokes: strokes, svgName: file.name, src: 2, cx: 0, cy: 0 });
    } catch (e) { console.error(e); CG.util.toast(e.message || 'SVG konnte nicht gelesen werden'); }
  }

  function syncContent() {
    if (!C || !C.pad.isConnected) return;
    const Pr = P(), txt = +Pr.src === 1, svg = +Pr.src === 2;
    C.src.set(+Pr.src);
    C.pad.hidden = txt;
    C.bar.hidden = txt || svg;
    C.svgPill.hidden = !svg;
    C.svgPill.querySelector('.up-name').textContent = Pr.svgName || 'SVG hochladen';
    C.cv.style.cursor = svg ? 'default' : '';
    C.textBox.hidden = C.font.el.hidden = !txt;
    C.font.set(+Pr.font);
    C.size.set(Pr.csize);
    if (document.activeElement !== C.ta) C.ta.value = Pr.text || '';
    const inks = [Pr.ink1, Pr.ink2, Pr.ink3];
    C.bar.querySelectorAll('.ink').forEach((b, i) => { b.style.background = inks[i]; b.classList.toggle('on', i === ink); });
    drawPad();
  }

  /* ---------- Werkzeugwahl ---------- */
  function brushes(body) {
    const list = CG.fn().BRUSHES;
    const row = el(`<div class="brush-row">${list.map((b, i) =>
      `<button type="button" class="brush" data-i="${i}" title="${esc(b.name)}"><canvas width="88" height="40"></canvas><span>${esc(b.name)}</span></button>`).join('')}</div>`);
    row.querySelectorAll('.brush').forEach((btn, i) => {
      preview(btn.querySelector('canvas'), i);
      btn.onclick = () => { H.tick(); set({ brush: i, ...list[i].p }); };
    });
    body.appendChild(row);
    B = { row };
    syncBrushes();
  }
  function syncBrushes() {
    if (!B || !B.row.isConnected) return;
    B.row.querySelectorAll('.brush').forEach((b, i) => b.classList.toggle('on', i === +P().brush));
  }

  // Kleine Strichvorschau je Werkzeug (Pixel für Pixel, ähnlich dem Shader)
  function preview(cv, kind) {
    const W = cv.width, Hh = cv.height, g = cv.getContext('2d'), img = g.createImageData(W, Hh), d = img.data;
    const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, k = y - j, u = f * f * (3 - 2 * f), v = k * k * (3 - 2 * k);
      return (hash(i, j) * (1 - u) + hash(i + 1, j) * u) * (1 - v) + (hash(i, j + 1) * (1 - u) + hash(i + 1, j + 1) * u) * v; };
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const t = (x - 10) / (W - 20);
      if (t < 0 || t > 1) continue;
      const yc = Hh / 2 + 6 * Math.sin(t * Math.PI * 1.7 + 0.3), sl = 6 * Math.PI * 1.7 / (W - 20) * Math.cos(t * Math.PI * 1.7 + 0.3);
      const dist = (y - yc) / Math.sqrt(1 + sl * sl);
      const taper = Math.pow(Math.min(1, t * 6, (1 - t) * 6), 0.7);
      let hw, a = 0;
      switch (kind) {
        case 0: hw = 1.4; a = Math.abs(dist) < hw ? (hash(x, y) > 0.35 ? 0.85 : 0.25) : 0; break;
        case 1: hw = 1.6; a = clamp(hw + 0.5 - Math.abs(dist), 0, 1); break;
        case 2: hw = 0.6 + 4.8 * Math.pow(Math.sin(Math.PI * t), 0.9); a = clamp(hw + 0.5 - Math.abs(dist), 0, 1); break;
        case 3: { hw = 8 * (0.3 + 0.7 * taper); const x01 = Math.abs(dist) / hw, e = 1 - 0.4 * vn(t * 14, dist > 0 ? 3 : 7);
          const br = vn(dist / hw * 4 + 9, t * 2.5); a = x01 < e && br > 0.15 + 0.55 * t * (0.6 + 0.5 * x01) ? 1 : 0;
          if (!a && x01 < 1.8 && hash(Math.floor(t * 30), Math.floor(dist / 3)) > 0.93 && hash(x, y) > 0.3) a = 1; break; }
        case 4: hw = 4.5 * (0.4 + 0.6 * taper); a = Math.abs(dist) < hw * (1 - 0.3 * vn(t * 20, dist)) && hash(x, y) > 0.42 ? 0.95 : 0; break;
        case 5: { hw = 13 * (0.4 + 0.6 * taper); const x01 = Math.abs(dist) / hw;
          const u = (x + y) * 0.7071 / 5, v = (x - y) * 0.7071 / 5, du = u - Math.round(u), dv = v - Math.round(v);
          a = x01 < 1 - 0.3 * vn(t * 10, 1) && Math.hypot(du, dv) * 5 < 1.9 - 0.8 * x01 ? 1 : 0; break; }
      }
      if (a > 0) { const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = 240; d[o + 3] = a * 255; }
    }
    g.putImageData(img, 0, 0);
  }

  return { content, syncContent, brushes, syncBrushes, importSvg };
})();
