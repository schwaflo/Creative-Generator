'use strict';
/* KI: Generatoren im Browser speichern (IndexedDB) – funktioniert ohne Server, auch auf GitHub Pages.
   Datensatz: { id, name, created, code, params, analysis, prompt, presets, models, templateVersion, repairs, aspect, thumb }
   Export/Import als .json-Datei, damit Generatoren zwischen Geräten/Browsern wandern können. */
CG.ai = CG.ai || {};
CG.ai.store = (() => {
  let dbp = null;
  const mem = new Map();                          // Ausweichspeicher, falls IndexedDB fehlt

  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('cg-ai', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('generators', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  }
  async function run(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('generators', mode), req = fn(t.objectStore('generators'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }

  const slug = s => String(s || 'generator').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'generator';
  const newId = name => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + slug(name) + '-' + Math.random().toString(36).slice(2, 6);

  async function list() {
    let items;
    try { items = await run('readonly', s => s.getAll()); } catch (e) { items = [...mem.values()]; }
    return (items || []).sort((a, b) => (a.created || 0) - (b.created || 0));
  }
  async function get(id) {
    try { return await run('readonly', s => s.get(id)); } catch (e) { return mem.get(id) || null; }
  }
  async function put(g) {
    try { await run('readwrite', s => s.put(g)); } catch (e) { mem.set(g.id, g); }
    return g;
  }
  async function create(data) {
    if (!data || typeof data.code !== 'string' || !data.code.trim()) throw new Error('Code fehlt');
    const g = { presets: [], ...data, id: newId(data.name), name: String(data.name || 'Generator').slice(0, 60), created: Date.now() };
    return put(g);
  }
  async function remove(id) {
    try { await run('readwrite', s => s.delete(id)); } catch (e) { /* ignorieren */ }
    mem.delete(id);
  }

  /* ---------- Datei ---------- */
  function toFile(g) {
    const { id, ...rest } = g;                    // ID wird beim Import neu vergeben
    return JSON.stringify({ app: 'creative-generator', type: 'generator', version: 1, generator: rest }, null, 2);
  }
  async function fromFile(text) {
    const j = JSON.parse(text);
    const list = j && j.type === 'generator' && j.generator ? [j.generator] : Array.isArray(j && j.generators) ? j.generators : null;
    if (!list || !list.length) throw new Error('Keine Generator-Datei');
    const out = [];
    for (const g of list) {
      if (typeof g.code !== 'string' || !Array.isArray(g.params)) throw new Error('Generator unvollständig');
      const v = CG.ai.schema.validateParams(g.params);
      if (!v.ok) throw new Error('Ungültiges Parameter-Schema: ' + v.errors[0]);
      const rec = await create({ ...g, params: v.params });
      rec.created = g.created || rec.created;
      out.push(await put(rec));
    }
    return out;
  }

  return { list, get, put, create, remove, toFile, fromFile };
})();
