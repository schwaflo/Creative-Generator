'use strict';
/* KI: Sandbox für generierten Code.
   Haupt-App ⇄ (postMessage) ⇄ iframe sandbox="allow-scripts" (eigener, leerer Ursprung, CSP ohne Netzwerk)
                                   ⇄ Worker mit OffscreenCanvas – hier läuft der Generator.
   - Der generierte Code sieht weder DOM noch Speicher noch Netz der App.
   - Hängt der Code (Endlosschleife), wird der Worker nach dem Timeout beendet und neu gestartet;
     die Haupt-App läuft ungestört weiter. */
CG.ai = CG.ai || {};
(() => {
  /* ---------- Laufzeit im Worker (wird als Text in den Worker geladen) ---------- */
  function workerMain() {
    const post = self.postMessage.bind(self);
    for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'postMessage']) {
      try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (e) { /* ignorieren */ }
    }
    const HEAD = 2;                                           // new Function: Rumpf beginnt in Zeile 3
    let G = null, canvas = null, ctx = null, setupKey = '';

    function mulberry32(a) {
      return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
    const lineOf = err => { const m = String(err && err.stack || '').match(/<anonymous>:(\d+):(\d+)/); return m ? Math.max(1, +m[1] - HEAD) : null; };

    function resetCtx(c, w, h) {
      if (c.setTransform) c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      if ('filter' in c) c.filter = 'none';
      c.shadowBlur = 0; c.shadowColor = 'rgba(0,0,0,0)'; c.lineWidth = 1; c.lineCap = 'butt'; c.lineJoin = 'miter';
      if (c.setLineDash) c.setLineDash([]);
      c.fillStyle = '#000'; c.strokeStyle = '#000';
      if (c.clearRect) c.clearRect(0, 0, w, h);
    }

    function runSetup(c, p, seed, w, h, force) {
      const key = w + 'x' + h + '|' + JSON.stringify(p);
      if (!force && key === setupKey) return;
      const rng = mulberry32(seed * 7919 + 13);
      Math.random = rng;
      resetCtx(c, w, h);
      if (G.setup) G.setup(c, p, rng);
      setupKey = force ? '' : key;
    }

    function stats(c, w, h) {
      const d = c.getImageData(0, 0, w, h).data;
      const r0 = d[0], g0 = d[1], b0 = d[2];
      let diff = 0, sum = 0;
      const N = 16, grid = new Array(N * N).fill(0), cnt = new Array(N * N).fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 12) diff++;
        sum += l;
        const gi = Math.min(N - 1, (y * N / h) | 0) * N + Math.min(N - 1, (x * N / w) | 0);
        grid[gi] += l; cnt[gi]++;
      }
      return { nonUniform: diff / (w * h), mean: sum / (w * h), grid: grid.map((v, i) => v / Math.max(1, cnt[i])) };
    }

    /* Aufzeichnender 2D-Kontext für den SVG-Export */
    function svgContext(W, H) {
      const out = [], defs = [], stack = [];
      let m = [1, 0, 0, 1, 0, 0], path = '', gid = 0, count = 0;
      const st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
        globalCompositeOperation: 'source-over', font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', dash: [], lineDashOffset: 0 };
      const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const f = v => +(+v).toFixed(2);
      const P = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      const sc = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const no = name => () => { throw new Error(`SVG-Export nicht möglich: Der Generator nutzt ${name}.`); };
      const paint = v => {
        if (v && typeof v === 'object' && v.__grad) {
          const id = 'g' + (++gid);
          const stops = v.stops.map(s => `<stop offset="${f(s[0])}" stop-color="${esc(s[1])}"/>`).join('');
          if (v.type === 'linear') {
            const [x1, y1] = P(v.a[0], v.a[1]), [x2, y2] = P(v.a[2], v.a[3]);
            defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">${stops}</linearGradient>`);
          } else {
            const [cx, cy] = P(v.a[3], v.a[4]), [fx, fy] = P(v.a[0], v.a[1]);
            defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(v.a[5] * sc())}" fx="${f(fx)}" fy="${f(fy)}">${stops}</radialGradient>`);
          }
          return `url(#${id})`;
        }
        return esc(v);
      };
      const blend = () => st.globalCompositeOperation === 'source-over' ? '' :
        ` style="mix-blend-mode:${({ lighter: 'plus-lighter', 'source-atop': 'normal' })[st.globalCompositeOperation] || st.globalCompositeOperation}"`;
      const emit = s => { if (++count > 150000) throw new Error('SVG-Export nicht möglich: zu viele Elemente.'); out.push(s); };
      const arcPts = (cx, cy, rx, ry, rot, a0, a1, ccw) => {
        let da = a1 - a0;
        if (!ccw && da < 0) da = da % (2 * Math.PI) + 2 * Math.PI; if (ccw && da > 0) da = da % (2 * Math.PI) - 2 * Math.PI;
        if (Math.abs(a1 - a0) >= 2 * Math.PI) da = ccw ? -2 * Math.PI : 2 * Math.PI;
        const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2))), step = da / n, k = 4 / 3 * Math.tan(step / 4);
        const cr = Math.cos(rot), sr = Math.sin(rot);
        const pt = (a, dx = 0, dy = 0) => { const x = Math.cos(a) * rx + dx * rx, y = Math.sin(a) * ry + dy * ry; return P(cx + x * cr - y * sr, cy + x * sr + y * cr); };
        const s0 = pt(a0); path += (path ? ` L${f(s0[0])} ${f(s0[1])}` : `M${f(s0[0])} ${f(s0[1])}`);
        for (let i = 0; i < n; i++) {
          const b0 = a0 + i * step, b1 = b0 + step;
          const c1 = pt(b0, -Math.sin(b0) * k, Math.cos(b0) * k), c2 = pt(b1, Math.sin(b1) * k, -Math.cos(b1) * k), e = pt(b1);
          path += ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(e[0])} ${f(e[1])}`;
        }
      };
      const fillAttr = () => `fill="${paint(st.fillStyle)}"${st.globalAlpha < 1 ? ` fill-opacity="${f(st.globalAlpha)}"` : ''}`;
      const strokeAttr = () => `fill="none" stroke="${paint(st.strokeStyle)}" stroke-width="${f(st.lineWidth * sc())}" stroke-linecap="${st.lineCap}" stroke-linejoin="${st.lineJoin}"` +
        (st.globalAlpha < 1 ? ` stroke-opacity="${f(st.globalAlpha)}"` : '') + (st.dash.length ? ` stroke-dasharray="${st.dash.map(d => f(d * sc())).join(' ')}"` : '');
      const rectPath = (x, y, w, h) => { const a = P(x, y), b = P(x + w, y), c = P(x + w, y + h), d = P(x, y + h); return `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])} L${f(c[0])} ${f(c[1])} L${f(d[0])} ${f(d[1])} Z`; };
      const c = {
        canvas: { width: W, height: H },
        save() { stack.push({ m: m.slice(), st: { ...st, dash: st.dash.slice() } }); },
        restore() { const s = stack.pop(); if (s) { m = s.m; Object.assign(st, s.st); } },
        translate(x, y) { m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
        scale(x, y) { m = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]]; },
        rotate(a) { const cs = Math.cos(a), sn = Math.sin(a); m = [m[0] * cs + m[2] * sn, m[1] * cs + m[3] * sn, -m[0] * sn + m[2] * cs, -m[1] * sn + m[3] * cs, m[4], m[5]]; },
        transform(a, b, cc, d, e, ff) { m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * cc + m[2] * d, m[1] * cc + m[3] * d, m[0] * e + m[2] * ff + m[4], m[1] * e + m[3] * ff + m[5]]; },
        setTransform(a, b, cc, d, e, ff) { if (a && typeof a === 'object') m = [a.a, a.b, a.c, a.d, a.e, a.f]; else m = [a, b, cc, d, e, ff].map(v => v ?? 0); },
        resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
        getTransform() { return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; },
        beginPath() { path = ''; },
        closePath() { path += ' Z'; },
        moveTo(x, y) { const p = P(x, y); path += ` M${f(p[0])} ${f(p[1])}`; },
        lineTo(x, y) { const p = P(x, y); path += (path ? ' L' : ' M') + `${f(p[0])} ${f(p[1])}`; },
        bezierCurveTo(a, b, cc, d, e, ff) { const p1 = P(a, b), p2 = P(cc, d), p3 = P(e, ff); path += ` C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}`; },
        quadraticCurveTo(a, b, x, y) { const p1 = P(a, b), p2 = P(x, y); path += ` Q${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])}`; },
        arc(x, y, r, a0, a1, ccw) { arcPts(x, y, r, r, 0, a0, a1, !!ccw); },
        ellipse(x, y, rx, ry, rot, a0, a1, ccw) { arcPts(x, y, rx, ry, rot, a0, a1, !!ccw); },
        rect(x, y, w, h) { path += ' ' + rectPath(x, y, w, h); },
        roundRect(x, y, w, h) { path += ' ' + rectPath(x, y, w, h); },
        arcTo(x1, y1) { c.lineTo(x1, y1); },
        fill(rule) { if (path) emit(`<path d="${path.trim()}" ${fillAttr()}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${blend()}/>`); },
        stroke() { if (path) emit(`<path d="${path.trim()}" ${strokeAttr()}${blend()}/>`); },
        fillRect(x, y, w, h) { emit(`<path d="${rectPath(x, y, w, h)}" ${fillAttr()}${blend()}/>`); },
        strokeRect(x, y, w, h) { emit(`<path d="${rectPath(x, y, w, h)}" ${strokeAttr()}${blend()}/>`); },
        clearRect(x, y, w, h) { if (x <= 0 && y <= 0 && x + w >= W && y + h >= H && m[0] === 1 && m[3] === 1) { out.length = 0; count = 0; } },
        fillText(text, x, y) { emit(`<text transform="matrix(${m.map(f).join(' ')})" x="${f(x)}" y="${f(y)}" style="font:${esc(st.font)}" text-anchor="${({ center: 'middle', right: 'end', end: 'end' })[st.textAlign] || 'start'}" dominant-baseline="${({ middle: 'middle', top: 'hanging', hanging: 'hanging' })[st.textBaseline] || 'auto'}" ${fillAttr()}>${esc(text)}</text>`); },
        strokeText(text, x, y) { emit(`<text transform="matrix(${m.map(f).join(' ')})" x="${f(x)}" y="${f(y)}" style="font:${esc(st.font)}" ${strokeAttr()}>${esc(text)}</text>`); },
        measureText(text) { const px = parseFloat((st.font.match(/(\d+(?:\.\d+)?)px/) || [0, 10])[1]); return { width: String(text).length * px * 0.55, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 }; },
        setLineDash(a) { st.dash = Array.isArray(a) ? a.slice() : []; },
        getLineDash() { return st.dash.slice(); },
        createLinearGradient(x0, y0, x1, y1) { const g = { __grad: true, type: 'linear', a: [x0, y0, x1, y1], stops: [] }; g.addColorStop = (o, col) => g.stops.push([o, col]); return g; },
        createRadialGradient(x0, y0, r0, x1, y1, r1) { const g = { __grad: true, type: 'radial', a: [x0, y0, r0, x1, y1, r1], stops: [] }; g.addColorStop = (o, col) => g.stops.push([o, col]); return g; },
        createConicGradient: no('createConicGradient'), createPattern: no('Muster (createPattern)'), drawImage: no('Bilder (drawImage)'),
        getImageData: no('Pixelzugriff (getImageData)'), putImageData: no('Pixelzugriff (putImageData)'), createImageData: no('Pixelzugriff (createImageData)'),
        isPointInPath() { return false; }, isPointInStroke() { return false; }, clip() { /* Clipping wird ignoriert */ },
        result() { return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${out.join('')}</svg>`; },
      };
      for (const k of Object.keys(st)) if (k !== 'dash') Object.defineProperty(c, k, { get: () => st[k], set: v => { st[k] = v; }, enumerable: true });
      for (const k of ['shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'filter', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'direction', 'letterSpacing'])
        Object.defineProperty(c, k, { get: () => undefined, set: () => {}, enumerable: true });
      return c;
    }

    self.onmessage = e => {
      const msg = e.data;
      try {
        if (msg.type === 'load') {
          const f = new Function(msg.code + '\n;return { params: (typeof params !== "undefined") ? params : undefined, setup: (typeof setup === "function") ? setup : null, draw: (typeof draw === "function") ? draw : null };');
          Math.random = mulberry32(1);
          G = f();
          setupKey = '';
          let params;
          try { params = JSON.parse(JSON.stringify(G.params === undefined ? null : G.params)); } catch (err) { params = null; }
          post({ id: msg.id, type: 'loaded', params, hasDraw: !!G.draw, hasSetup: !!G.setup });
        } else if (msg.type === 'render' || msg.type === 'svg') {
          if (!G || !G.draw) throw new Error('Kein Generator geladen');
          const { w, h, p, t, seed } = msg;
          const t0 = performance.now();
          if (msg.type === 'svg') {
            const sc = svgContext(w, h);
            runSetup(sc, p, seed, w, h, true);
            resetCtx(sc, w, h);
            const rng = mulberry32(seed * 7919 + 101); Math.random = rng;
            G.draw(sc, p, t, rng);
            post({ id: msg.id, type: 'svg', svg: sc.result(), ms: performance.now() - t0 });
            return;
          }
          if (!canvas) { canvas = new OffscreenCanvas(w, h); ctx = canvas.getContext('2d', { willReadFrequently: false }); }
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; setupKey = ''; }
          runSetup(ctx, p, seed, w, h, false);
          resetCtx(ctx, w, h);
          const rng = mulberry32(seed * 7919 + 101); Math.random = rng;
          G.draw(ctx, p, t, rng);
          const s = msg.stats ? stats(ctx, w, h) : null;
          const bitmap = canvas.transferToImageBitmap();
          post({ id: msg.id, type: 'frame', bitmap, stats: s, ms: performance.now() - t0 }, [bitmap]);
        }
      } catch (err) {
        post({ id: msg.id, type: 'error', stage: msg.type, message: String(err && err.message || err), name: err && err.name, line: lineOf(err) });
      }
    };
  }

  /* ---------- Vermittler im iframe ---------- */
  const WORKER_SRC = '(' + workerMain.toString() + ')();';
  const IFRAME_SRC = `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">
<script>
const SRC = ${JSON.stringify(WORKER_SRC).replace(/</g, '\\u003c')};
let worker = null, code = null, url = null;
function spawn() {
  if (worker) worker.terminate();
  if (!url) url = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));
  worker = new Worker(url);
  worker.onmessage = e => parent.postMessage(e.data, '*', e.data && e.data.bitmap ? [e.data.bitmap] : []);
  worker.onerror = e => { e.preventDefault(); parent.postMessage({ type: 'error', id: -2, stage: 'worker', message: e.message, line: e.lineno }, '*'); };
  if (code !== null) worker.postMessage({ type: 'load', code, id: -1 });
}
onmessage = e => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m.type === 'reset') { if (m.clear) code = null; spawn(); return; }
  if (m.type === 'load') code = m.code;
  if (!worker) spawn();
  worker.postMessage(m);
};
parent.postMessage({ type: 'boot' }, '*');
<\/script>`;

  /* ---------- Steuerung in der Haupt-App ---------- */
  class Sandbox {
    constructor({ timeout = 4000 } = {}) {
      this.timeout = timeout;
      this.pending = new Map();
      this.seq = 0;
      this.code = null;
      this.strikes = 0;
      this._onMsg = e => this._message(e);
      window.addEventListener('message', this._onMsg);
      this._create();
    }
    _create() {
      if (this.frame) this.frame.remove();
      const f = this.frame = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:0;visibility:hidden';
      this.ready = new Promise(res => { this._boot = res; });
      f.srcdoc = IFRAME_SRC;
      document.body.appendChild(f);
      this.loadedCode = null;
    }
    _message(e) {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      const m = e.data || {};
      if (m.type === 'boot') { this._boot(); return; }
      const p = this.pending.get(m.id);
      if (!p) { if (m.bitmap) m.bitmap.close(); return; }
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      this.strikes = 0;
      if (m.type === 'error') {
        const err = new Error(m.message);
        Object.assign(err, { kind: 'runtime', stage: m.stage, line: m.line, errName: m.name });
        p.reject(err);
      } else p.resolve(m);
    }
    async _call(msg, timeout = this.timeout) {
      await this.ready;
      return new Promise((resolve, reject) => {
        const id = ++this.seq;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          const err = new Error(`Zeitüberschreitung: „${msg.type === 'load' ? 'Laden' : 'Zeichnen'}“ dauerte länger als ${timeout} ms (Endlosschleife oder zu aufwendig).`);
          err.kind = 'timeout'; err.stage = msg.type;
          this._recover(msg.type === 'load');
          reject(err);
        }, timeout);
        this.pending.set(id, { resolve, reject, timer });
        this.frame.contentWindow.postMessage({ ...msg, id }, '*');
      });
    }
    // Hängenden Worker beenden; reagiert das iframe selbst nicht mehr, wird es ersetzt
    _recover(clear) {
      this.strikes++;
      this.loadedCode = null;
      if (clear) this.code = null;                              // hängender Code wird nicht erneut geladen
      if (this.strikes >= 3) { this._create(); this.strikes = 0; return; }
      try { this.frame.contentWindow.postMessage({ type: 'reset', clear: !!clear }, '*'); } catch (e) { this._create(); }
    }
    async load(code) {
      this.code = code;
      const r = await this._call({ type: 'load', code });
      this.loadedCode = code;
      return { params: r.params, hasDraw: r.hasDraw, hasSetup: r.hasSetup };
    }
    async ensure(code) { if (this.loadedCode !== code) await this.load(code); }
    // Einzelbild; liefert { bitmap, ms, stats }
    async render({ values, t, w, h, seed = 1, stats = false, timeout }) {
      if (this.loadedCode !== this.code && this.code) await this.load(this.code);
      return this._call({ type: 'render', p: values, t, w, h, seed, stats }, timeout);
    }
    async svg({ values, t, w, h, seed = 1, timeout }) {
      if (this.loadedCode !== this.code && this.code) await this.load(this.code);
      return (await this._call({ type: 'svg', p: values, t, w, h, seed }, timeout || this.timeout * 3)).svg;
    }
    destroy() {
      window.removeEventListener('message', this._onMsg);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Sandbox beendet')); }
      this.pending.clear();
      if (this.frame) this.frame.remove();
      this.frame = null;
    }
  }

  CG.ai.Sandbox = Sandbox;
})();
