'use strict';
/* KI: direkte Verbindung Browser -> KI-Server (kein Server dazwischen).

   Ollama            GET /api/tags · POST /api/chat (format = JSON-Schema, stream, think) · NDJSON-Antwort
   OpenAI-kompatibel GET /v1/models · POST /v1/chat/completions (response_format json_schema, stream) · SSE-Antwort
   (LM Studio, llama.cpp, Jan, vLLM, Cloud-Anbieter)

   Antwortformat wird erzwungen. Kennt ein Server das strenge Format nicht, weicht der Client aus:
   json_schema -> json_object -> Schema nur als Anweisung im Text.
   Ein Zugangsschlüssel geht als „Authorization: Bearer …“ mit. */
CG.ai = CG.ai || {};
CG.ai.client = (() => {
  const S = () => CG.ai.settings;

  class AiError extends Error {
    constructor(code, message, detail) { super(message); this.code = code; this.detail = detail; }
  }

  const isLocal = u => { try { return /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(new URL(u).hostname); } catch (e) { return false; } };
  // Herkunft, die der Browser mitschickt. Als Datei geöffnet (file://) ist das „null“ – das lehnen KI-Server ab.
  const isFilePage = () => location.protocol === 'file:';
  const pageOrigin = () => location.origin && location.origin !== 'null' ? location.origin : 'null';

  /* Verbindungsfehler verständlich erklären (CORS, HTTPS, Safari …) */
  function netError(url) {
    const https = location.protocol === 'https:';
    const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
    let reason;
    if (isFilePage()) reason = 'file';
    else if (https && /^http:/.test(url) && !isLocal(url)) reason = 'mixed';
    else if (https && safari && isLocal(url)) reason = 'safari';
    else reason = 'cors';
    const e = new AiError('unreachable', `Keine Verbindung zu ${url}.`, { reason, url, origin: pageOrigin(), api: S().api() });
    return e;
  }

  function headers(json = true) {
    const h = json ? { 'Content-Type': 'application/json' } : {};
    const k = S().key();
    if (k) h.Authorization = 'Bearer ' + k;
    return h;
  }

  async function request(path, { method = 'GET', body, signal } = {}) {
    const url = S().url() + path;
    let r;
    try {
      r = await fetch(url, { method, signal, headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      if (e && (e.name === 'AbortError' || (signal && signal.aborted))) throw (signal && signal.reason) || e;
      throw netError(S().url());
    }
    return r;
  }

  async function failure(r, model) {
    let msg = '';
    try { const t = await r.text(); try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error)) || j.message || t; } catch (e) { msg = t; } } catch (e) { /* leer */ }
    msg = String(msg || 'HTTP ' + r.status).slice(0, 400);
    if (r.status === 401 || r.status === 403) return new AiError('auth', r.status === 401 ? 'Zugangsschlüssel fehlt oder ist falsch.' : 'Zugriff verweigert (403). Ist die Seitenadresse freigegeben?', msg);
    if ((r.status === 404 || /not found|does not exist|no such model/i.test(msg)) && /model/i.test(msg)) {
      return new AiError('model_missing', S().api() === 'ollama'
        ? `Modell „${model}“ ist nicht installiert: ollama pull ${model}` : `Modell „${model}“ ist auf dem Server nicht verfügbar (${msg}).`);
    }
    return new AiError('http', msg, { status: r.status });
  }

  /* ---------- Modelle & Status ---------- */
  async function models() {
    if (S().api() === 'ollama') {
      const r = await request('/api/tags');
      if (!r.ok) throw await failure(r);
      const j = await r.json();
      return (j.models || []).map(m => ({ name: m.name, size: m.size, capabilities: m.capabilities || null }));
    }
    const r = await request('/v1/models');
    if (!r.ok) throw await failure(r);
    const j = await r.json();
    return (j.data || j.models || []).map(m => ({ name: m.id || m.name, capabilities: null }));
  }

  async function status() {
    const api = S().api();
    const out = { api, url: S().url(), ok: false, models: [], loaded: null, version: null, missing: [], error: null };
    try {
      out.models = await models();
      out.ok = true;
      if (api === 'ollama') {
        try { const v = await (await request('/api/version')).json(); out.version = v.version; } catch (e) { /* optional */ }
        out.loaded = await loaded();
      }
      const names = out.models.map(m => m.name);
      const has = n => names.includes(n) || names.includes(n + ':latest');
      const c = CG.ai.config;
      for (const role of ['visionModel', 'codeModel']) {
        const m = c[role];
        if (m && !has(m) && !out.missing.some(x => x.model === m)) out.missing.push({ role, model: m, cmd: api === 'ollama' ? 'ollama pull ' + m : null });
      }
    } catch (e) { out.error = e; }
    return out;
  }

  /* ---------- Chat ---------- */
  const schemaHint = schema => `\n\nAntworte ausschließlich mit einem JSON-Objekt (ohne Text davor oder danach), das genau diesem JSON-Schema entspricht:\n${JSON.stringify(schema)}`;
  function withHint(messages, schema) {
    const m = messages.map(x => ({ ...x }));
    const last = m[m.length - 1];
    last.content = (last.content || '') + schemaHint(schema);
    return m;
  }

  // Merkt sich je Server+Modell, welche Format-Stufe funktioniert
  const levels = {};
  const noReasoning = {};                         // Server, die reasoning_effort ablehnen
  const levelKey = model => S().url() + '|' + model;

  /* opts: { model, messages, schema, temperature, numCtx, keepAlive, think, noThink }
     think:   Ollama-Denkmodus (nur bei Modellen, die ihn können)
     noThink: OpenAI-Schnittstelle: reasoning_effort "none" (fällt weg, wenn der Server das Feld nicht kennt)
     cb:   { signal, onChunk(text, tokens) }
     -> { text, tokens } */
  async function chat(opts, cb = {}) {
    return S().api() === 'ollama' ? chatOllama(opts, cb) : chatOpenAI(opts, cb);
  }

  async function chatOllama(o, { signal, onChunk } = {}) {
    const body = { model: o.model, messages: o.messages, stream: true, options: {} };
    if (o.temperature !== undefined) body.options.temperature = o.temperature;
    if (o.numCtx) body.options.num_ctx = o.numCtx;
    if (o.keepAlive !== undefined) body.keep_alive = o.keepAlive;
    if (o.think !== undefined) body.think = o.think;
    let useFormat = !!o.schema && levels[levelKey(o.model)] !== 'text';
    for (;;) {
      const b = useFormat ? { ...body, format: o.schema } : (o.schema ? { ...body, messages: withHint(o.messages, o.schema) } : body);
      const r = await request('/api/chat', { method: 'POST', body: b, signal });
      if (!r.ok) {
        const err = await failure(r, o.model);
        if (useFormat && err.code === 'http' && /format|schema|grammar/i.test(err.message)) { useFormat = false; levels[levelKey(o.model)] = 'text'; continue; }
        if (err.code === 'http' && /think/i.test(err.message) && body.think !== undefined) { delete body.think; continue; }
        throw err;
      }
      const out = await readStream(r, signal, line => {
        let m; try { m = JSON.parse(line); } catch (e) { return null; }
        if (m.error) throw new AiError('server', String(m.error));
        return { text: (m.message && m.message.content) || '', tick: !!(m.message && (m.message.content || m.message.thinking)) };
      }, onChunk);
      // manche Modelle antworten mit think:false leer -> einmal ohne Vorgabe wiederholen
      if (!out.text.trim() && body.think === false) { delete body.think; continue; }
      return out;
    }
  }

  async function chatOpenAI(o, { signal, onChunk } = {}) {
    // Bilder als image_url-Teile
    const messages = o.messages.map(m => {
      if (!m.images || !m.images.length) return { role: m.role, content: m.content };
      return { role: m.role, content: [{ type: 'text', text: m.content },
        ...m.images.map(b64 => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }))] };
    });
    const order = ['json_schema', 'json_object', 'text'];
    let i = o.schema ? Math.max(0, order.indexOf(levels[levelKey(o.model)] || 'json_schema')) : 2;
    let noThink = !!o.noThink && !noReasoning[S().url()];
    for (;;) {
      const level = order[i];
      const body = { model: o.model, stream: true, messages: level === 'text' && o.schema ? withHint(messages, o.schema) : level === 'json_object' ? withHint(messages, o.schema) : messages };
      if (o.temperature !== undefined) body.temperature = o.temperature;
      if (noThink) body.reasoning_effort = 'none';
      if (level === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: o.schemaName || 'antwort', strict: true, schema: o.schema } };
      if (level === 'json_object') body.response_format = { type: 'json_object' };
      const r = await request('/v1/chat/completions', { method: 'POST', body, signal });
      if (!r.ok) {
        const err = await failure(r, o.model);
        // Server kennt reasoning_effort nicht -> ohne erneut versuchen
        if (noThink && err.code === 'http' && /reasoning/i.test(err.message)) { noThink = false; noReasoning[S().url()] = true; continue; }
        // strenges Format unbekannt -> nächste Stufe
        if (o.schema && i < 2 && err.code === 'http' && [400, 404, 415, 422, 500, 501].includes(err.detail && err.detail.status)) { i++; continue; }
        throw err;
      }
      if (o.schema) levels[levelKey(o.model)] = level;
      return readStream(r, signal, line => {
        if (!line.startsWith('data:')) return null;
        const d = line.slice(5).trim();
        if (d === '[DONE]') return { text: '', done: true };
        let m; try { m = JSON.parse(d); } catch (e) { return null; }
        if (m.error) throw new AiError('server', String(m.error.message || m.error));
        const ch = m.choices && m.choices[0];
        const t = (ch && ch.delta && (ch.delta.content || '')) || (ch && ch.message && ch.message.content) || '';
        const think = ch && ch.delta && (ch.delta.reasoning || ch.delta.reasoning_content);
        return { text: t, tick: !!(t || think) };
      }, onChunk);
    }
  }

  // Stream zeilenweise lesen (NDJSON oder SSE)
  async function readStream(r, signal, parse, onChunk) {
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '', tokens = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const p = parse(line);
          if (!p) continue;
          if (p.text) text += p.text;
          if (p.tick) tokens++;
          if (onChunk && p.tick) onChunk(text, tokens);
        }
      }
      if (buf.trim()) { const p = parse(buf.trim()); if (p && p.text) text += p.text; }
    } catch (e) {
      if (signal && signal.aborted) throw signal.reason || e;
      if (e instanceof AiError) throw e;
      throw new AiError('stream', 'Verbindung während der Antwort abgebrochen: ' + e.message);
    }
    return { text, tokens };
  }

  /* ---------- Speicher (nur Ollama steuerbar) ---------- */
  async function loaded() {
    if (S().api() !== 'ollama') return null;
    try { const r = await request('/api/ps'); return ((await r.json()).models || []).map(m => m.name); } catch (e) { return []; }
  }
  async function unload(model) {
    if (S().api() !== 'ollama' || !model) return;
    try { await request('/api/generate', { method: 'POST', body: { model, keep_alive: 0 } }); } catch (e) { /* nicht kritisch */ }
  }
  // alle anderen Modelle entladen, damit nur `model` Speicher belegt
  async function ensureOnly(model) {
    const names = await loaded();
    if (!names) return;
    const norm = n => n.includes(':') ? n : n + ':latest';
    for (const n of names) if (norm(n) !== norm(model)) await unload(n);
  }

  return { AiError, models, status, chat, loaded, unload, ensureOnly, isLocal, pageOrigin, isFilePage, _readStream: readStream, _levels: levels };
})();
