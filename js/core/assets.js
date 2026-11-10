'use strict';
/* Ablage für hochgeladene Bilder (IndexedDB). Designs speichern nur die ID,
   damit der kleine localStorage nicht mit großen Bilddaten volläuft.
   Falls IndexedDB nicht verfügbar ist, bleiben Bilder nur für diese Sitzung erhalten. */
CG.assets = (() => {
  const mem = new Map();
  let dbp = null;

  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('cg-assets', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('blobs');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    return dbp;
  }

  async function run(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('blobs', mode), req = fn(t.objectStore('blobs'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }

  const newId = () => 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function put(blob, name, id = newId()) {
    const rec = { blob, name: name || 'Bild', type: blob.type };
    mem.set(id, rec);
    try { await run('readwrite', s => s.put(rec, id)); mem.delete(id); } catch (e) { /* nur Sitzung */ }
    return id;
  }
  async function get(id) {
    if (!id) return null;
    if (mem.has(id)) return mem.get(id);
    try { return (await run('readonly', s => s.get(id))) || null; } catch (e) { return null; }
  }
  async function del(id) {
    mem.delete(id);
    try { await run('readwrite', s => s.delete(id)); } catch (e) {}
  }
  async function keys() {
    let k = [];
    try { k = (await run('readonly', s => s.getAllKeys())) || []; } catch (e) {}
    return [...new Set([...k, ...mem.keys()])];
  }

  /* Löscht Bilder, die weder im aktuellen Zustand noch in einem Design verwendet werden. */
  async function gc() {
    const used = new Set([CG.state.params.imgId, ...CG.util.store.get('designs', []).map(d => d.params && d.params.imgId)].filter(Boolean));
    for (const k of await keys()) if (!used.has(k)) await del(k);
  }

  return { put, get, del, keys, gc };
})();
