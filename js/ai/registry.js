'use strict';
/* KI: gespeicherte Generatoren als Funktionen der App bereitstellen.
   Ein KI-Generator ist eine normale Funktion (Regler aus seinem Schema, Presets, Finish, Bild-Ebene, Export).
   Er zeichnet in der Sandbox; das fertige Bild kommt als Textur in den WebGL-Renderer.
   Dadurch funktionieren Vorschau, PNG/JPG (inkl. Finish) und MP4-Export ohne Sonderwege. */
CG.ai = CG.ai || {};
CG.ai.registry = (() => {
  const { toast, download, esc } = CG.util;
  const S = () => CG.ai.schema;

  const HOST_GLSL = `
uniform sampler2D uFrame;
uniform float uFrameOn;
vec3 effect(vec2 fc, vec2 uv){
  if (uFrameOn < 0.5) return vec3(0.07);
  return texture(uFrame, vec2(uv.x, 1.0 - uv.y)).rgb;
}`;

  let available = false;           // Generator-Speicher (IndexedDB) erreichbar?
  let box = null;                   // Sandbox der Vorschau
  let tex = null, texGl = null, texFn = '';
  let pending = null, inflight = false, lastKey = '', errKey = '';
  let errEl = null;

  const renderMs = () => (CG.ai.config && CG.ai.config.timeouts && CG.ai.config.timeouts.renderMs) || 4000;
  const sandbox = () => box || (box = new CG.ai.Sandbox({ timeout: renderMs() }));
  const seedOf = v => Math.round(+(v.seed ?? 1)) || 1;
  const valuesOf = (fn, P) => S().toGenValues(fn.gen.params, P);

  /* ---------- Fehlermeldung im Viewport ---------- */
  function showError(fn, e) {
    const vp = document.getElementById('viewport');
    if (!vp) return;
    if (!errEl) { errEl = CG.util.el('<div class="ai-err" role="alert"></div>'); vp.appendChild(errEl); }
    const what = e.kind === 'timeout' ? 'hängt oder ist zu langsam' : 'meldet einen Fehler';
    errEl.innerHTML = `<b>${esc(fn.name)} ${what}</b><span>${esc(e.message)}${e.line ? ` (Zeile ${e.line})` : ''}</span>`;
    errEl.hidden = false;
  }
  const hideError = () => { if (errEl) errEl.hidden = true; };

  /* ---------- Textur ---------- */
  function texture(gl) {
    if (!tex || texGl !== gl) {
      tex = gl.createTexture(); texGl = gl; texFn = '';
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([18, 18, 18, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return tex;
  }
  function upload(gl, fnId, bitmap) {
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, texture(gl));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.activeTexture(gl.TEXTURE0);
    texFn = fnId;
  }

  /* Vom Renderer bei jedem Zeichnen aufgerufen (this = Funktion) */
  function bind(gl, loc, P, phase, R, res) {
    if (pending && pending.fn === this.id) { upload(gl, this.id, pending.bitmap); pending.bitmap.close(); pending = null; }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, texture(gl));
    gl.uniform1i(loc('uFrame'), 4);
    gl.uniform1f(loc('uFrameOn'), texFn === this.id ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    if (!CG.exporter.frame()) request(this, P, phase, res[0], res[1]);
  }

  /* Vorschau: nächstes Bild in der Sandbox anfordern (immer nur eines gleichzeitig) */
  function request(fn, P, phase, w, h) {
    const vals = valuesOf(fn, P);
    const pkey = fn.id + JSON.stringify(vals) + w + 'x' + h;
    const key = pkey + '|' + phase.toFixed(5);
    if (inflight || key === lastKey || errKey === pkey) return;
    inflight = true; lastKey = key;
    (async () => {
      try {
        const b = sandbox();
        await b.ensure(fn.gen.code);
        const r = await b.render({ values: vals, t: phase, w, h, seed: seedOf(vals) });
        if (pending) pending.bitmap.close();
        pending = { fn: fn.id, bitmap: r.bitmap };
        errKey = '';
        hideError();
        CG.markDirty();
      } catch (e) {
        errKey = pkey;                        // erst nach Regleränderung erneut versuchen
        if (CG.fn() === fn) showError(fn, e);
      } finally { inflight = false; }
    })();
  }

  /* Export: Bild in Zielauflösung rendern und sofort als Textur setzen */
  async function prepare(P, phase, W, H) {
    const vals = valuesOf(this, P);
    const max = Math.min(8192, CG.R.maxTex);
    const k = Math.min(1, max / Math.max(W, H));
    const b = sandbox();
    await b.ensure(this.gen.code);
    const r = await b.render({ values: vals, t: phase, w: Math.round(W * k), h: Math.round(H * k), seed: seedOf(vals), timeout: Math.max(renderMs() * 4, 15000) });
    upload(CG.R.gl, this.id, r.bitmap);
    r.bitmap.close();
  }

  async function exportSvg() {
    const { w, h } = CG.state.format;
    const vals = valuesOf(this, CG.state.params);
    toast('Erzeuge SVG …');
    try {
      const b = sandbox();
      await b.ensure(this.gen.code);
      const svg = await b.svg({ values: vals, t: CG.view.phase, w, h, seed: seedOf(vals) });
      download(new Blob([svg], { type: 'image/svg+xml' }), `${slug(this.name)}_${w}x${h}_${CG.util.stamp()}.svg`);
      toast('SVG exportiert');
    } catch (e) { toast(e.message); }
  }

  function downloadCode() {
    const g = this.gen;
    const head = `/* ${g.name} – KI-Generator (Creative Generator)\n   erzeugt ${new Date(g.created || Date.now()).toLocaleString('de-DE')} mit ${(g.models && g.models.code) || '?'} · Vorlage ${g.templateVersion || '?'}\n   Vertrag: const params = [...]; function setup(ctx, p, rng); function draw(ctx, p, t, rng) – t = 0..1 (Loop) */\n\n`;
    download(new Blob([head + g.code], { type: 'text/javascript' }), `${slug(g.name)}.js`);
  }

  async function savePreset(name) {
    const g = this.gen;
    const values = valuesOf(this, CG.state.params);
    const list = (g.presets || []).filter(p => p.name !== name);
    list.push({ name, values });
    try {
      await CG.ai.store.put({ ...g, presets: list });
      g.presets = list;
      this.presets = presetsOf(g);
      toast('Preset gespeichert');
      return true;
    } catch (e) { toast('Preset konnte nicht gespeichert werden: ' + e.message); return false; }
  }

  const slug = s => String(s || 'generator').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '') || 'generator';
  const presetsOf = g => [{ name: 'Standard', p: {} },
    ...(g.presets || []).map(pr => ({ name: pr.name, p: S().fromGenValues(g.params, pr.values) }))];

  /* ---------- Verwaltung ---------- */
  function register(gen) {
    const id = 'ai-' + gen.id;
    const fn = {
      id, name: gen.name, ai: true, gen, glsl: HOST_GLSL,
      groups: S().toGroups(id, gen.params),
      presets: presetsOf(gen),
      overrides: { loopLen: 10, grain: 0 },
      bind, prepare, exportSvg, downloadCode, savePreset,
    };
    const i = CG.functions.findIndex(f => f.id === id);
    if (i >= 0) CG.functions[i] = fn; else CG.functions.push(fn);
    if (CG.R && CG.R.progs) delete CG.R.progs[id];
    return fn;
  }

  function unregister(genId) {
    const id = 'ai-' + genId;
    const i = CG.functions.findIndex(f => f.id === id);
    if (i >= 0) CG.functions.splice(i, 1);
    if (CG.state && CG.state.fn === id) CG.switchFn(CG.functions[0].id);
    else if (CG.panel && CG.state.page === 'sandbox') CG.panel.build();
  }

  // Einstellungen (config.json + lokal) und gespeicherte Generatoren aus dem Browser laden
  async function preload() {
    await CG.ai.settings.load();
    try {
      const list = await Promise.race([CG.ai.store.list(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
      list.forEach(register);
      available = true;
    } catch (e) { available = false; }
  }

  const list = () => CG.functions.filter(f => f.ai);

  return { preload, register, unregister, list, get available() { return available; }, HOST_GLSL };
})();
