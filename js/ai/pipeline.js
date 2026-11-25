'use strict';
/* KI: Ablauf – der Generator ist das Interface, das Modell baut die Funktion (Regler + Shader).
   Drei Wege zur Aufgabe:
     Bild          – das Code-Modell kann Bilder lesen und sieht die Referenz selbst
     Beschreibung  – ein zweites Modell (mit Bildverständnis) beschreibt die Referenz als Text für das Code-Modell
     Text          – kein Bild: die Funktion entsteht nur aus dem geschriebenen Auftrag
   Danach: Prüfung in der Sandbox, Fehler gehen ins selbe Gespräch zurück; mit Referenz folgt ein Vergleich
   (selbst per Bild oder als Text vom zweiten Modell). Bestehende Generatoren lassen sich per Prompt ändern (improve).
   Speicher (Ollama): es ist immer nur ein Modell geladen; am Ende wird entladen. */
CG.ai = CG.ai || {};
CG.ai.pipeline = (() => {
  const C = () => CG.ai.client;
  const cfg = () => CG.ai.config;
  const fail = (code, msg, detail) => new CG.ai.client.AiError(code, msg, detail);
  let caps = {};                                      // Modell -> Fähigkeiten (nur bei Ollama bekannt)

  function setModels(models) { caps = {}; (models || []).forEach(m => { caps[m.name] = m.capabilities; }); }
  const known = m => Array.isArray(caps[m]);
  const supportsThink = m => known(m) && caps[m].includes('thinking');
  const supportsVision = m => known(m) && caps[m].includes('vision');
  // Denkmodus: gpt-oss kennt nur Stufen (low/medium/high) – mit false liefert es leere Antworten
  const thinkOpt = m => !supportsThink(m) ? undefined : /gpt-oss/i.test(m) ? (cfg().think ? 'medium' : 'low') : !!cfg().think;

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

  // Welcher Weg gilt für die aktuelle Auswahl? vision: kann das Code-Modell Bilder lesen (bei unbekannten Servern: ja, solange kein Beschreibungs-Modell gewählt ist)
  function plan(hasImage) {
    const c = cfg(), model = c.model, describer = c.describeModel && c.describeModel !== model ? c.describeModel : '';
    const vision = known(model) ? supportsVision(model) : !describer;
    const source = hasImage && vision ? 'image' : hasImage && describer ? 'description' : 'text';
    return { model, describer, vision, source, imageUnused: hasImage && source === 'text' };
  }

  // Freitext-Antwort eines Bild-Modells (Beschreibung oder Vergleich); danach wird es wieder entladen
  async function ask(model, messages, { signal, onEvent, maxTokens = 900 }) {
    const c = cfg();
    await C().ensureOnly(model);
    const d = deadline(signal, c.timeouts.generationSec, 'Bild-Modell');
    try {
      const res = await C().chat({ model, messages, temperature: 0.2, numCtx: Math.min(c.numCtx, 8192), maxTokens, think: thinkOpt(model), noThink: true, keepAlive: '5m' },
        { signal: d.signal, onChunk: (t, n) => onEvent({ type: 'tokens', n }) });
      return String(res.text || '').trim();
    } finally { d.done(); await C().unload(model); }
  }

  /* Referenz von einem zweiten Modell beschreiben lassen (auch einzeln nutzbar: „Prompt erst prüfen“) */
  async function describe(reference, { signal, onEvent = () => {} } = {}) {
    const { describer } = plan(true);
    if (!describer) throw fail('model', 'Kein Modell für die Bildbeschreibung gewählt.');
    onEvent({ type: 'describe', model: describer });
    const text = await ask(describer, CG.ai.prompt.describeMessages(reference), { signal, onEvent });
    if (!text) throw fail('invalid', `„${describer}“ hat keine Beschreibung geliefert.`);
    onEvent({ type: 'described', model: describer, text });
    return text;
  }

  /* Wiederholungsschleife: dieselben ~160 Zeichen mindestens dreimal – oder, mit Zahlen gleichgesetzt, ein 240-Zeichen-Block
     viermal (hochzählende Wiederholung: c1 = …, c2 = …, c3 = …). Dazu eine Längengrenze: ein Shader braucht keine 24 000 Zeichen. */
  // große Cloud-Modelle schreiben auch mal einen langen, aufwendigen Shader – lokale Modelle laufen eher aus dem Ruder
  const maxAnswer = () => CG.ai.settings && CG.ai.settings.api() === 'anthropic' ? 80000 : 24000;
  function looping(t) {
    if (t.length > maxAnswer()) return true;
    if (t.length < 1500) return false;
    const test = (s, len, k) => {
      const tail = s.slice(-len);
      if (tail.replace(/\s+/g, '').length < len * 0.35) return false;
      let n = 0, i = -1;
      while ((i = s.indexOf(tail, i + 1)) !== -1) if (++n >= k) return true;
      return false;
    };
    if (test(t, 160, 3)) return true;
    const norm = t.replace(/\d+(?:\.\d*)?/g, '#');
    return norm.length > 3000 && test(norm, 240, 4);
  }
  const anySignal = list => {
    if (AbortSignal.any) return AbortSignal.any(list);
    const ac = new AbortController();
    list.forEach(sg => { if (sg.aborted) ac.abort(sg.reason); else sg.addEventListener('abort', () => ac.abort(sg.reason), { once: true }); });
    return ac.signal;
  };

  /* Ein Gespräch mit dem Code-Modell bis zu einer Funktion, die die Prüfung besteht (mit Reparaturen).
     Liefert { answer, params, code, warnings } oder null, wenn nichts Lauffähiges entstand. */
  async function solve(st, messages, base, { signal, aspect, onEvent, round, rounds, prevParams }) {
    const c = cfg();
    let fixing = false, fresh = false, lastKey = '';
    for (;;) {
      onEvent({ type: 'ask', round, rounds, fixing, model: st.model, improve: st.improve });
      const d = deadline(signal, c.timeouts.generationSec, 'Generator');
      // ohne Wiederholungsstrafe können Modelle in eine Schleife geraten (derselbe Abschnitt immer wieder) – dann abbrechen
      const loop = new AbortController(), both = anySignal([d.signal, loop.signal]);
      let res = null, looped = false;
      try {
        res = await C().chat({
          model: st.model, messages, code: true,                // freie Antwort (kein JSON-Zwang), keine Wiederholungsstrafe
          // Reparatur: mehr Variation, sonst kommt fast dieselbe Antwort zurück
          temperature: fresh ? Math.max(0.8, c.temperature) : fixing ? Math.max(0.6, c.temperature) : c.temperature,
          numCtx: c.numCtx, maxTokens: c.maxTokens, effort: c.effort, think: thinkOpt(st.model), noThink: !c.think, keepAlive: '10m',
        }, { signal: both, onChunk: (t, n) => { onEvent({ type: 'tokens', n }); if (n % 48 === 0 && looping(t)) loop.abort(); } });
      } catch (e) {
        if (!loop.signal.aborted || (signal && signal.aborted) || d.signal.aborted) throw e;
        looped = true;
      } finally { d.done(); }
      if (looped) {
        const lastTry = --st.fixesLeft < 0;
        onEvent({ type: 'failed', round, errors: ['Die Antwort hing in einer Wiederholungsschleife oder wurde ungewöhnlich lang und wurde abgebrochen.'], attempt: st.repairs + 1, max: st.maxFixes, last: lastTry });
        if (lastTry) return null;
        st.repairs++; messages = base; fresh = true; fixing = true; lastKey = '';
        continue;
      }
      const f = CG.ai.parse.extractFunction(res.text);
      const answer = {
        title: String(f.title || st.title || '').slice(0, 60),
        notes: String(f.notes || '').slice(0, 4000),
        params: Array.isArray(f.params) ? f.params : [],
        shader: CG.ai.parse.extractShader(f.shader) || '',
      };
      const td = CG.ai.shader.tidy(answer.params, answer.shader, prevParams);
      answer.params = td.params; answer.shader = td.code;
      if (answer.title) st.title = answer.title;
      onEvent({ type: 'notes', round, notes: answer.notes, title: answer.title, fixes: td.fixes });
      const v = await CG.ai.validate.runShader(answer.params, answer.shader, { sandbox: st.box, aspect, renderMs: c.timeouts.renderMs,
        onStep: step => onEvent({ type: 'step', step }) });
      if (v.code && v.code !== answer.shader) answer.shader = v.code;    // von der App gerettet (z. B. Ganzzahlen, Prototypen)
      if (v.ok) { onEvent({ type: 'ok', round, warnings: v.warnings, fixes: v.fixes || [] }); return { answer: { ...answer, params: v.params }, params: v.params, code: answer.shader, warnings: v.warnings }; }
      const last = --st.fixesLeft < 0;
      onEvent({ type: 'failed', round, errors: v.errors, attempt: st.repairs + 1, max: st.maxFixes, last });
      if (last) return null;
      st.repairs++; fixing = true;
      // derselbe Fehler wie beim letzten Versuch (ohne Zeilennummern und Code-Ausschnitte verglichen): Das Modell hängt fest
      const key = v.errors.map(e => e.split(' | ').map(x => x.split('  →  ')[0].replace(/Zeile \d+: /g, '').replace(/\(.*?\)/g, '')).join('|')).join('||');
      if (key === lastKey && st.hasBest) { onEvent({ type: 'stuck', kept: true }); return null; }
      if (key === lastKey) { messages = base; fresh = true; onEvent({ type: 'stuck', kept: false }); }
      else messages = CG.ai.prompt.feedback(base, answer, { errors: v.errors });
      lastKey = key;
    }
  }

  /* Neue Funktion bauen. text: der (editierbare) Auftrag; reference: Base64-JPEG oder null */
  async function generate(text, { signal, aspect = 16 / 9, onEvent = () => {}, reference = null } = {}) {
    const c = cfg(), P = CG.ai.prompt, pl = plan(!!reference), model = pl.model;
    if (!model) throw fail('model', 'Bitte zuerst ein Modell wählen.');
    onEvent({ type: 'plan', ...pl });
    // Weg „Beschreibung“: Platzhalter im Auftrag durch die Beschreibung des zweiten Modells ersetzen
    if (pl.source === 'description' && text.includes(P.SLOT)) text = text.split(P.SLOT).join(await describe(reference, { signal, onEvent }));
    else text = text.split(P.SLOT).join('(keine Beschreibung)');
    await C().ensureOnly(model);
    const base = P.messages(text, pl.source === 'image' ? reference : null);
    const box = new CG.ai.Sandbox({ timeout: c.timeouts.renderMs });
    box.setInputs(await testInputs(reference));          // für Funktionen mit iImage()/iBrush(): Referenz als Bild, Test-Pinselstrich
    // Vergleichsrunden nur mit Referenz (selbst per Bild oder als Text vom zweiten Modell)
    const rounds = 1 + (pl.source === 'text' ? 0 : Math.max(0, c.refineRounds | 0));
    const maxFixes = Math.max(1, c.repairAttempts | 0);
    const st = { model, box, title: '', repairs: 0, fixesLeft: maxFixes, maxFixes, hasBest: false };
    let messages = base, best = null;
    try {
      for (let round = 0; round < rounds; round++) {
        const r = await solve(st, messages, base, { signal, aspect, onEvent, round, rounds, prevParams: best && best.params });
        if (!r) break;
        best = r; st.hasBest = true;
        if (round + 1 >= rounds) break;
        const compare = await compareImage(box, best, aspect, reference);
        if (pl.source === 'image') {                        // das Modell vergleicht selbst
          onEvent({ type: 'look', round });
          messages = P.feedback(base, best.answer, { compareBase64: compare, warnings: best.warnings });
        } else {                                            // das zweite Modell vergleicht und schreibt dem Code-Modell
          onEvent({ type: 'critique', model: pl.describer });
          await C().unload(model);
          const critique = await ask(pl.describer, P.critiqueMessages(compare), { signal, onEvent, maxTokens: 500 });
          onEvent({ type: 'critiqued', model: pl.describer, text: critique });
          if (!critique) break;
          await C().ensureOnly(model);
          messages = P.feedback(base, best.answer, { critique, warnings: best.warnings });
        }
      }
      if (!best) throw fail('invalid', 'Das Modell hat keine lauffähige Funktion geliefert. Nochmal versuchen oder ein anderes Modell wählen.');
      const thumb = await thumbnail(box, best, aspect);
      return { code: best.code, params: best.params, warnings: best.warnings, repairs: st.repairs, thumb, title: st.title, source: pl.source, prompt: text };
    } finally {
      box.destroy();
      await C().unload(model);
    }
  }

  /* Bestehenden Generator per Prompt ändern. gen: gespeicherter Shader-Generator; request: Änderungswunsch */
  async function improve(gen, request, { signal, aspect = 16 / 9, onEvent = () => {}, promptText = null } = {}) {
    const c = cfg(), P = CG.ai.prompt, pl = plan(true), model = pl.model;
    if (!model) throw fail('model', 'Bitte zuerst ein Modell wählen.');
    if (gen.kind !== 'shader') throw fail('input', 'Dieser ältere Generator (Canvas) lässt sich nicht per Prompt ändern.');
    if (!(request || '').trim()) throw fail('input', 'Bitte schreiben, was sich ändern soll.');
    await C().ensureOnly(model);
    const box = new CG.ai.Sandbox({ timeout: c.timeouts.renderMs });
    box.setInputs(await testInputs(null));
    const maxFixes = Math.max(1, c.repairAttempts | 0);
    const st = { model, box, title: gen.name, repairs: 0, fixesLeft: maxFixes, maxFixes, hasBest: false, improve: true };
    try {
      // kann das Modell Bilder lesen, sieht es das aktuelle Ergebnis
      let shot = null;
      if (pl.vision) { try { const o = await renderBitmap(box, gen, aspect, 448); const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h;
        cv.getContext('2d').drawImage(o.bitmap, 0, 0); o.bitmap.close(); shot = cv.toDataURL('image/jpeg', 0.88).split(',')[1]; cv.width = cv.height = 0; } catch (e) { shot = null; } }
      const base = P.improveMessages(promptText || P.improveText({ gen, request }), shot);
      const r = await solve(st, base, base, { signal, aspect, onEvent, round: 0, rounds: 1, prevParams: gen.params });
      if (!r) throw fail('invalid', 'Die geänderte Funktion läuft nicht – der Generator bleibt unverändert.');
      const thumb = await thumbnail(box, r, aspect);
      return { code: r.code, params: r.params, warnings: r.warnings, repairs: st.repairs, thumb, title: gen.name };
    } finally {
      box.destroy();
      await C().unload(model);
    }
  }

  /* Eingaben zum Prüfen von Funktionen, die mit dem Bild oder Pinsel des Nutzers arbeiten:
     die Referenz (sonst ein Testbild mit Himmel, Horizont und Formen) und ein geschwungener Test-Pinselstrich.
     Das Bild wird wie in der Bild-Ebene (js/ui/layer.js) gespiegelt hochgeladen, die Pinsel-Maske nicht. */
  async function testInputs(reference) {
    let image = null;
    if (reference) { try { image = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + reference)).blob(), { imageOrientation: 'flipY' }); } catch (e) { image = null; } }
    if (!image) {
      const c = new OffscreenCanvas(1024, 768), g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 768); sky.addColorStop(0, '#7fa8c9'); sky.addColorStop(0.55, '#e9dcc4'); sky.addColorStop(1, '#6d7a4a');
      g.fillStyle = sky; g.fillRect(0, 0, 1024, 768);
      g.fillStyle = '#f4c95d'; g.beginPath(); g.arc(760, 220, 90, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2f3b2f'; g.beginPath(); g.moveTo(0, 560); g.bezierCurveTo(300, 430, 600, 620, 1024, 500); g.lineTo(1024, 768); g.lineTo(0, 768); g.fill();
      g.fillStyle = '#b5523b'; g.beginPath(); g.ellipse(330, 420, 120, 190, -0.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#efe7da'; g.beginPath(); g.ellipse(330, 260, 70, 80, 0, 0, Math.PI * 2); g.fill();
      image = await createImageBitmap(c, { imageOrientation: 'flipY' });
    }
    const b = new OffscreenCanvas(1024, 1024), bg = b.getContext('2d');
    bg.fillStyle = '#000'; bg.fillRect(0, 0, 1024, 1024);
    bg.strokeStyle = '#fff'; bg.lineWidth = 120; bg.lineCap = 'round'; bg.lineJoin = 'round';
    bg.beginPath(); bg.moveTo(140, 960); bg.bezierCurveTo(1100, 760, -80, 380, 860, 110); bg.stroke();
    return { image, brush: await createImageBitmap(b) };
  }

  async function renderBitmap(box, gen, aspect, h, t = 0.25) {
    const SH = CG.ai.shader;
    const w = Math.round(h * aspect);
    const values = {}; gen.params.forEach(p => { values[p.id] = p.default; });
    const r = await box.shader({ frag: SH.source(gen.params, gen.code), uniforms: SH.uniforms(gen.params, values), t, w, h });
    return { bitmap: r.bitmap, w, h };
  }

  // Vergleichsbild: links Referenz, rechts aktuelles Ergebnis, beide beschriftet (Base64-JPEG)
  async function compareImage(box, gen, aspect, reference) {
    const h = 448;
    const out = await renderBitmap(box, gen, aspect, h);
    const ref = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + reference)).blob());
    const rw = Math.round(h * ref.width / ref.height), gap = 16;
    const cv = document.createElement('canvas'); cv.width = rw + gap + out.w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, h);
    g.drawImage(ref, 0, 0, rw, h); g.drawImage(out.bitmap, rw + gap, 0, out.w, h);
    ref.close(); out.bitmap.close();
    const label = (txt, x) => { g.font = 'bold 22px sans-serif'; const tw = g.measureText(txt).width; g.fillStyle = '#e8505b'; g.fillRect(x + 8, 8, tw + 16, 32); g.fillStyle = '#ffffff'; g.fillText(txt, x + 16, 32); };
    label('REFERENZ', 0); label('ERGEBNIS', rw + gap);
    const url = cv.toDataURL('image/jpeg', 0.88); cv.width = cv.height = 0;
    return url.split(',')[1];
  }

  async function thumbnail(box, gen, aspect) {
    try {
      const out = await renderBitmap(box, gen, aspect, Math.round(480 / Math.max(aspect, 1)));
      const c = document.createElement('canvas'); c.width = out.w; c.height = out.h;
      c.getContext('2d').drawImage(out.bitmap, 0, 0); out.bitmap.close();
      const url = c.toDataURL('image/png'); c.width = c.height = 0;
      return url;
    } catch (e) { return null; }
  }

  /* Im Browser speichern + als Funktion registrieren */
  async function save({ name, code, params, prompt, repairs, thumb, aspect, source }) {
    const c = cfg();
    const gen = await CG.ai.store.create({ kind: 'shader', name, code, params, prompt, repairs, thumb, aspect, source,
      models: { server: CG.ai.settings.server().label, model: c.model, describer: source === 'description' ? c.describeModel : undefined }, templateVersion: CG.ai.prompt.VERSION });
    return CG.ai.registry.register(gen);
  }

  /* Geänderte Fassung in denselben Generator schreiben; die vorige Fassung bleibt für „Rückgängig“ erhalten */
  async function applyImprove(gen, res, request) {
    const prev = { code: gen.code, params: gen.params, thumb: gen.thumb, date: Date.now(), request };
    const next = { ...gen, code: res.code, params: res.params, thumb: res.thumb || gen.thumb,
      history: [...(gen.history || []), prev].slice(-10), models: { ...(gen.models || {}), lastEdit: cfg().model } };
    await CG.ai.store.put(next);
    return CG.ai.registry.register(next);
  }
  async function undoImprove(gen) {
    const h = (gen.history || []).slice(), prev = h.pop();
    if (!prev) return null;
    const next = { ...gen, code: prev.code, params: prev.params, thumb: prev.thumb, history: h };
    await CG.ai.store.put(next);
    return CG.ai.registry.register(next);
  }

  return { setModels, prepareImage, plan, describe, generate, improve, save, applyImprove, undoImprove, supportsVision: m => supportsVision(m), _looping: looping };
})();
