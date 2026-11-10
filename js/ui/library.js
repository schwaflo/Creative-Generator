'use strict';
/* Bibliothek: Designs speichern, laden, exportieren, importieren (localStorage + JSON) */
CG.library = (() => {
  const { $, store, toast, download, stamp, el, esc } = CG.util;
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function buildPanel(body) {
    body.innerHTML = '';
    body.appendChild(el('<h2>Bibliothek</h2>'));
    body.appendChild(el(`<div class="lib-tools">
        <div class="pill save-pill">
          <input class="pill-input" id="dName" placeholder="Aktuelles Design speichern als …" maxlength="60" spellcheck="false">
          <button class="act" type="button" id="dSave" title="Speichern">${CG.icon('plus')}</button>
        </div>
        <button class="btn" type="button" id="dExport" title="Alle Designs als Datei sichern">${CG.icon('download')}</button>
        <button class="btn" type="button" id="dImport" title="Designs aus Datei importieren">${CG.icon('upload')}</button>
        <input type="file" id="dFile" accept=".json,application/json" hidden>
      </div>`));
    body.appendChild(el('<div class="designs" id="dList"></div>'));

    const name = body.querySelector('#dName');
    body.querySelector('#dSave').onclick = () => save(name.value.trim());
    name.addEventListener('keydown', e => { if (e.key === 'Enter') save(name.value.trim()); });
    body.querySelector('#dExport').onclick = async () => {
      const list = store.get('designs', []);
      if (!list.length) return toast('Keine Designs vorhanden');
      // verwendete Bilder als Data-URL mitsichern, damit die Datei vollständig ist
      const assets = {};
      for (const d of list) {
        const id = d.params && d.params.imgId;
        if (!id || assets[id]) continue;
        const rec = await CG.assets.get(id);
        if (rec) assets[id] = { name: rec.name, data: await blobToDataUrl(rec.blob) };
      }
      download(new Blob([JSON.stringify({ app: 'creative-generator', version: 2, designs: list, assets }, null, 2)], { type: 'application/json' }), `designs_${stamp()}.json`);
    };
    const file = body.querySelector('#dFile');
    body.querySelector('#dImport').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        let items = Array.isArray(data) ? data : data.designs ? data.designs : [data];
        items = items.filter(d => d && d.params && d.fn);
        if (!items.length) throw new Error('keine Designs gefunden');
        const assets = (data && data.assets) || {};
        for (const id in assets) {
          const blob = await (await fetch(assets[id].data)).blob();
          await CG.assets.put(blob, assets[id].name, id);
        }
        const list = store.get('designs', []);
        items.forEach(d => { if (!d.id || list.some(x => x.id === d.id)) d.id = uid(); list.unshift(d); });
        store.set('designs', list); render();
        toast(`${items.length} Design(s) importiert`);
      } catch (e) { toast('Import fehlgeschlagen: ' + e.message); }
      file.value = '';
    };
    render();
  }

  const blobToDataUrl = blob => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });

  function thumb() {
    if (!CG.R) return '';
    const { w, h } = CG.state.format, s = 160 / Math.max(w, h);
    const tw = Math.max(16, Math.round(w * s)), th = Math.max(16, Math.round(h * s));
    CG.R.draw(CG.fn(), CG.state.params, CG.view.phase, tw, th);
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    c.getContext('2d').drawImage(CG.R.cv, 0, 0);
    CG.fitPreview(); CG.markDirty();
    const url = c.toDataURL('image/jpeg', 0.8);
    c.width = c.height = 0;
    return url;
  }

  function save(name) {
    const list = store.get('designs', []);
    if (!name) name = `${CG.fn().name} ${list.length + 1}`;
    const existing = list.find(d => d.name === name);
    if (existing && !confirm(`„${name}“ überschreiben?`)) return;
    const d = { id: existing ? existing.id : uid(), name, fn: CG.state.fn, params: { ...CG.state.params },
                format: { ...CG.state.format }, created: Date.now(), thumb: thumb() };
    const i = list.findIndex(x => x.id === d.id);
    if (i >= 0) list.splice(i, 1);
    list.unshift(d);
    if (store.set('designs', list)) { CG.haptics.tick(); toast(`„${name}“ gespeichert`); const n = $('#dName'); if (n) n.value = ''; }
    render();
  }

  function load(d) {
    CG.loadState(d.fn, d.params);
    if (d.format) CG.formatPage.set(d.format.w, d.format.h, d.format.preset);
    CG.showPage('sandbox');
    toast(`„${d.name}“ geladen`);
  }

  function render() {
    const host = $('#dList'); if (!host) return;
    const list = store.get('designs', []);
    host.innerHTML = '';
    list.forEach(d => {
      const fn = CG.fnById(d.fn);
      const row = el(`<div class="design">
          <button type="button" class="d-load" title="Laden"><img alt=""><span class="meta"><b></b><small>${esc(fn.name)}${d.format ? ` · ${d.format.w}×${d.format.h}` : ''}</small></span></button>
          <button type="button" class="act danger" data-a="del" title="Löschen">${CG.icon('trash')}</button>
        </div>`);
      row.querySelector('b').textContent = d.name;
      if (d.thumb) row.querySelector('img').src = d.thumb;
      row.querySelector('.d-load').onclick = () => load(d);
      row.querySelector('[data-a=del]').onclick = () => {
        if (!confirm(`„${d.name}“ löschen?`)) return;
        store.set('designs', store.get('designs', []).filter(x => x.id !== d.id)); render();
        CG.assets.gc();
      };
      host.appendChild(row);
    });
  }

  return { buildPanel };
})();
