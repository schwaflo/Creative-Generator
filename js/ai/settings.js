'use strict';
/* KI: Einstellungen – alles im Browser, kein Server dazwischen.
   - Vorgaben aus config.json (liegt neben der App, funktioniert auch auf GitHub Pages)
   - eigene Änderungen (Server, Adresse, Modelle) im localStorage dieses Browsers
   - Zugangsschlüssel nur auf diesem Gerät, nie in Generatoren, Designs oder Exporten */
CG.ai = CG.ai || {};
CG.ai.settings = (() => {
  const { store } = CG.util;

  // Bekannte Server: Typ der Schnittstelle + übliche Adresse
  const SERVERS = [
    { id: 'ollama',   label: 'Ollama',      api: 'ollama', url: 'http://localhost:11434' },
    { id: 'lmstudio', label: 'LM Studio',   api: 'openai', url: 'http://localhost:1234' },
    { id: 'llamacpp', label: 'llama.cpp',   api: 'openai', url: 'http://localhost:8080' },
    { id: 'jan',      label: 'Jan',         api: 'openai', url: 'http://localhost:1337' },
    { id: 'vllm',     label: 'vLLM',        api: 'openai', url: 'http://localhost:8000' },
    { id: 'openai',   label: 'OpenAI-kompatibel', api: 'openai', url: 'https://' },
  ];

  const DEFAULTS = {
    server: 'ollama',
    url: 'http://localhost:11434',
    visionModel: 'gemma4:12b-mlx',
    codeModel: 'gemma4:12b-mlx',
    temperature: { vision: 0.2, code: 0.4, repair: 0.2 },
    numCtx: { vision: 4096, code: 12288 },
    think: false,
    timeouts: { analysisSec: 240, generationSec: 900, renderMs: 4000 },
    repairAttempts: 3,
    refineRounds: 2,
    mode: 'layers',
    candidates: 2,
    maxImageSide: 1024,
  };

  const merge = (a, b) => {
    const o = { ...a };
    for (const k in b || {}) {
      if (!(k in a)) continue;
      o[k] = a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object' ? merge(a[k], b[k]) : b[k];
    }
    return o;
  };

  let base = DEFAULTS;                              // DEFAULTS + config.json
  let cfg = merge(base, store.get('ai.settings', {}));

  // config.json laden (falls vorhanden), danach gelten lokale Änderungen weiter
  async function load() {
    try {
      const r = await fetch('config.json', { cache: 'no-cache' });
      if (r.ok) {
        const j = await r.json();
        if (j.ollamaUrl && !j.url) j.url = j.ollamaUrl;     // ältere config.json
        base = merge(DEFAULTS, j);
      }
    } catch (e) { /* ohne config.json: eingebaute Vorgaben */ }
    cfg = merge(base, store.get('ai.settings', {}));
    CG.ai.config = cfg;
    return cfg;
  }

  // Änderungen dieses Browsers speichern (nur Abweichungen relevant)
  function set(patch) {
    const own = { ...store.get('ai.settings', {}), ...patch };
    store.set('ai.settings', own);
    cfg = merge(base, own);
    CG.ai.config = cfg;
    return cfg;
  }

  const server = () => SERVERS.find(s => s.id === cfg.server) || SERVERS[0];
  const api = () => server().api;
  const url = () => String(cfg.url || server().url).trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  const key = () => store.get('ai.key', '');
  const setKey = k => store.set('ai.key', String(k || '').trim());

  CG.ai.config = cfg;
  return { SERVERS, DEFAULTS, load, set, get: () => cfg, server, api, url, key, setKey };
})();
