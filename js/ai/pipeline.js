'use strict';
/* KI: Ablauf Bild -> Analyse -> Prompt -> Code -> Prüfung/Reparatur -> Speichern.
   Jeder Schritt ist eine Anfrage mit erzwungenem Antwortformat (JSON-Schema).
   Speicher-Regel (Ollama): immer nur ein Modell geladen – Vision wird vor dem Code-Modell entladen. */
CG.ai = CG.ai || {};
CG.ai.pipeline = (() => {
  const C = () => CG.ai.client;
  const cfg = () => CG.ai.config;
  const fail = (code, msg, detail) => new CG.ai.client.AiError(code, msg, detail);
  let caps = {};                                      // Modell -> Fähigkeiten (nur Ollama bekannt)

  function setModels(models) { caps = {}; (models || []).forEach(m => { caps[m.name] = m.capabilities; }); }
  const supportsThink = m => Array.isArray(caps[m]) && caps[m].includes('thinking');
  const thinkOpt = m => supportsThink(m) ? !!cfg().think : undefined;

  // Abbruch durch Nutzer oder Zeitlimit
  function deadline(signal, sec, what) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(fail('timeout', `${what}: Zeitüberschreitung nach ${sec} s.`)), sec * 1000);
    const onAbort = () => ac.abort(signal.reason || new DOMException('Abgebrochen', 'AbortError'));
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    return { signal: ac.signal, done: () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); } };
  }

  /* Bild verkleinern (längste Seite ≤ maxImageSide) und als Base64-JPEG liefern */
  async function prepareImage(file, maxSide) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);                       // Transparenz -> weiß
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const url = c.toDataURL('image/jpeg', 0.9);
    c.width = c.height = 0;
    return { base64: url.split(',')[1], dataUrl: url, w, h };
  }

  /* 1. Bildanalyse (strukturiertes JSON) */
  async function analyze(imageBase64, { signal, onTokens } = {}) {
    const c = cfg(), model = c.visionModel;
    await C().ensureOnly(model);
    const same = model === c.codeModel;
    const d = deadline(signal, c.timeouts.analysisSec, 'Bildanalyse');
    try {
      const res = await C().chat({
        model, messages: CG.ai.prompt.analysisMessages(imageBase64),
        schema: CG.ai.schema.ANALYSIS, schemaName: 'bildanalyse',
        temperature: c.temperature.vision, numCtx: c.numCtx.vision, think: thinkOpt(model), noThink: !c.think,
        keepAlive: same ? '10m' : 0,                       // anderes Code-Modell -> Vision sofort entladen
      }, { signal: d.signal, onChunk: (t, n) => onTokens && onTokens(n) });
      const json = CG.ai.parse.extractJson(res.text);
      if (!json) throw fail('parse', 'Die Bildanalyse lieferte kein gültiges JSON. Bitte erneut versuchen.', res.text);
      return CG.ai.schema.cleanAnalysis(json);
    } finally {
      d.done();
      if (!same) await C().unload(model);
    }
  }

  /* 2.–4. Code erzeugen, prüfen, bei Fehlern reparieren lassen */
  async function generate(promptText, { signal, aspect = 16 / 9, onEvent = () => {} } = {}) {
    const c = cfg(), model = c.codeModel;
    onEvent({ type: 'models' });
    await C().ensureOnly(model);
    const base = CG.ai.prompt.messages(promptText);
    let messages = base, lastErrors = [], lastCode = null;
    const box = new CG.ai.Sandbox({ timeout: c.timeouts.renderMs });
    const tries = 1 + Math.max(0, c.repairAttempts | 0);
    try {
      for (let attempt = 0; attempt < tries; attempt++) {
        onEvent({ type: 'request', attempt, tries });
        const d = deadline(signal, c.timeouts.generationSec, 'Code-Generierung');
        let res;
        try {
          res = await C().chat({
            model, messages, schema: CG.ai.schema.CODE, schemaName: 'generator',
            temperature: attempt ? c.temperature.repair : c.temperature.code, numCtx: c.numCtx.code,
            think: thinkOpt(model), noThink: !c.think, keepAlive: '10m',
          }, { signal: d.signal, onChunk: (t, n) => onEvent({ type: 'tokens', attempt, n }) });
        } finally { d.done(); }
        const code = CG.ai.parse.extractGenerated(res.text);
        let errors;
        if (!code) errors = ['Die Antwort enthielt keinen Code. Antworte ausschließlich mit {"code": "<vollständige JavaScript-Datei>"}.'];
        else {
          lastCode = code;
          onEvent({ type: 'validate', attempt });
          const v = await CG.ai.validate.run(code, { sandbox: box, aspect, renderMs: c.timeouts.renderMs,
            onStep: step => onEvent({ type: 'step', attempt, step }) });
          if (v.ok) {
            onEvent({ type: 'ok', attempt, warnings: v.warnings });
            const thumb = await thumbnail(box, v.params, aspect);
            return { code, params: v.params, warnings: v.warnings, repairs: attempt, thumb };
          }
          errors = v.errors;
        }
        lastErrors = errors;
        onEvent({ type: 'failed', attempt, errors, last: attempt === tries - 1 });
        messages = CG.ai.prompt.repair(base, code || res.text.slice(0, 6000), errors);
      }
      const err = fail('invalid', `Der Generator funktioniert nach ${tries - 1} Reparaturversuchen noch nicht.`);
      err.errors = lastErrors; err.lastCode = lastCode;
      throw err;
    } finally {
      box.destroy();
      await C().unload(model);                          // Speicher wieder freigeben
    }
  }

  async function thumbnail(box, params, aspect) {
    const vals = {}; params.forEach(p => { vals[p.id] = p.default; });
    const w = 480, h = Math.round(480 / aspect);
    try {
      const r = await box.render({ values: vals, t: 0.25, w, h, seed: Math.round(+(vals.seed ?? 1)) || 1 });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(r.bitmap, 0, 0); r.bitmap.close();
      const url = c.toDataURL('image/png'); c.width = c.height = 0;
      return url;
    } catch (e) { return null; }
  }

  /* Im Browser speichern + als Funktion registrieren */
  async function save({ name, code, params, analysis, prompt, repairs, thumb, aspect }) {
    const c = cfg();
    const gen = await CG.ai.store.create({ name, code, params, analysis, prompt, repairs, thumb, aspect,
      models: { server: CG.ai.settings.server().label, vision: c.visionModel, code: c.codeModel }, templateVersion: CG.ai.prompt.VERSION });
    return CG.ai.registry.register(gen);
  }

  return { setModels, prepareImage, analyze, generate, save };
})();
