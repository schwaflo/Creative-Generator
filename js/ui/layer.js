'use strict';
/* Bild-Ebene: Hochladen (JPG/PNG/WebP/SVG, auch per Drag & Drop), Dekodieren,
   Textur aktualisieren und das Bild direkt im Viewport verschieben, skalieren, drehen. */
CG.layer = (() => {
  const { $, el, esc, toast, clamp } = CG.util;
  const H = CG.haptics;
  const MAX_SIDE = 4096;                       // begrenzt Speicherbedarf der Textur
  let currentId = null, curName = '', thumbUrl = null, hasAlpha = false;
  let ui = null;                               // Elemente der Upload-Zeile
  let box = null, drag = null;

  /* ---------- Laden & Dekodieren ---------- */
  async function decode(blob, name) {
    const max = Math.min(MAX_SIDE, CG.R.maxTex);
    const opts = { imageOrientation: 'flipY', premultiplyAlpha: 'premultiply' };
    if (blob.type === 'image/svg+xml' || /\.svg$/i.test(name)) {
      // Vektorgrafik in hoher Auflösung rastern
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image(); img.src = url; await img.decode();
        let w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
        const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const bmp = await createImageBitmap(c, opts);
        c.width = c.height = 0;
        return bmp;
      } finally { URL.revokeObjectURL(url); }
    }
    const probe = await createImageBitmap(blob);
    const s = Math.min(1, max / Math.max(probe.width, probe.height));
    const w = Math.round(probe.width * s), h = Math.round(probe.height * s);
    probe.close();
    return createImageBitmap(blob, { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }

  async function load(id) {
    if (!CG.R) return;
    if (!id) { clear(); return; }
    if (id === currentId) return;
    const rec = await CG.assets.get(id);
    if (!rec) { clear(); return; }
    const bmp = await decode(rec.blob, rec.name);
    hasAlpha = detectAlpha(bmp);
    CG.R.setImage(bmp);
    bmp.close();
    currentId = id; curName = rec.name;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(rec.blob);
    CG.markDirty(); updateUpload();
  }

  // Hat das Bild transparente Bereiche? (kleine Stichprobe)
  function detectAlpha(bmp) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data;
    c.width = c.height = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  function clear() {
    if (CG.R) CG.R.clearImage();
    currentId = null; curName = '';
    if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = null; }
    CG.markDirty(); updateUpload();
  }

  const sync = () => load(CG.state.params.imgId).catch(e => { console.error(e); toast('Bild konnte nicht geladen werden'); });

  async function fromFile(file) {
    if (!file || !/^image\//.test(file.type) && !/\.svg$/i.test(file.name)) return toast('Bitte eine Bilddatei wählen');
    try {
      const id = await CG.assets.put(file, file.name);
      await load(id);
      CG.panel.setMany({ imgId: id, imgX: 0, imgY: 0, imgScale: fitScale(), imgRot: 0 });
      CG.panel.openGroup('image');
      CG.assets.gc();
    } catch (e) { console.error(e); toast('Bild konnte nicht geladen werden'); }
  }

  /* Startgröße: Fotos füllen bei Fragment das Format; freigestellte Bilder und Ebenen sitzen mit Rand darin */
  function fitScale() {
    const { w, h } = CG.state.format, mn = Math.min(w, h), ex = w / mn, ey = h / mn, a = CG.R.img.aspect;
    const s = CG.fn().usesImage && !hasAlpha ? Math.max(ey, ex / a) : Math.min(ey, ex / a) * 0.9;
    return +s.toFixed(3);
  }

  function remove() {
    CG.panel.setMany({ imgId: null });
    clear();
    CG.assets.gc();
  }

  /* ---------- Upload-Zeile im Panel ---------- */
  function buildUpload(body) {
    const row = el(`<div class="pill upload-pill">
        <span class="up-thumb"></span><span class="up-name"></span>
        <button class="act" type="button" data-a="up" title="Bild laden">${CG.icon('upload')}</button>
        <button class="act danger" type="button" data-a="rm" title="Entfernen">${CG.icon('trash')}</button>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg" hidden>
      </div>`);
    const file = row.querySelector('input');
    row.querySelector('[data-a=up]').onclick = () => file.click();
    row.querySelector('[data-a=rm]').onclick = remove;
    file.onchange = () => { if (file.files[0]) fromFile(file.files[0]); file.value = ''; };
    ui = { thumb: row.querySelector('.up-thumb'), name: row.querySelector('.up-name'), rm: row.querySelector('[data-a=rm]') };
    body.appendChild(row);
    updateUpload();
  }

  function updateUpload() {
    if (!ui) return;
    const has = !!currentId;
    ui.thumb.style.backgroundImage = has && thumbUrl ? `url("${thumbUrl}")` : '';
    ui.thumb.classList.toggle('empty', !has);
    ui.name.textContent = has ? curName : 'Bild hochladen';
    ui.rm.hidden = !has;
  }

  /* ---------- Bearbeiten im Viewport ---------- */
  function initViewport() {
    const vp = $('#viewport');
    box = el(`<div class="img-box"><i data-h="s" class="tl"></i><i data-h="s" class="tr"></i><i data-h="s" class="bl"></i><i data-h="s" class="br"></i><i data-h="r" class="rot"></i></div>`);
    vp.appendChild(box);

    box.addEventListener('pointerdown', e => {
      e.preventDefault();
      const P = CG.state.params, g = geom();
      const c = center(g, P);
      drag = { mode: e.target.dataset.h || 'm', x: e.clientX, y: e.clientY, P: { ...P }, c,
               d0: Math.hypot(e.clientX - c.x, e.clientY - c.y),
               a0: Math.atan2(-(e.clientY - c.y), e.clientX - c.x), mn: g.mn, snapped: {} };
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', e => {
      if (!drag) return;
      const D = drag, o = {};
      if (D.mode === 'm') {
        let x = D.P.imgX + (e.clientX - D.x) / D.mn, y = D.P.imgY - (e.clientY - D.y) / D.mn;
        x = snap(x, 0, 0.012, 'x'); y = snap(y, 0, 0.012, 'y');   // Raste: Bildmitte
        o.imgX = +x.toFixed(4); o.imgY = +y.toFixed(4);
      } else if (D.mode === 's') {
        const d = Math.hypot(e.clientX - D.c.x, e.clientY - D.c.y);
        o.imgScale = +clamp(D.P.imgScale * d / Math.max(D.d0, 1), 0.05, 4).toFixed(4);
      } else {
        const a = Math.atan2(-(e.clientY - D.c.y), e.clientX - D.c.x);
        let deg = ((D.P.imgRot + (a - D.a0) * 180 / Math.PI) % 360 + 360) % 360;
        for (const t of [0, 90, 180, 270, 360]) deg = snap(deg, t, 2, 'r' + t);
        o.imgRot = Math.round(deg) % 360;
      }
      CG.panel.setMany(o);
    });
    const end = () => { drag = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('dblclick', () => { CG.panel.setMany({ imgX: 0, imgY: 0, imgRot: 0, imgScale: fitScale() }); H.tick(); });
    // Mausrad / Trackpad-Pinch skaliert
    vp.addEventListener('wheel', e => {
      if (!box.classList.contains('on')) return;
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      CG.panel.setMany({ imgScale: +clamp(CG.state.params.imgScale * k, 0.05, 4).toFixed(4) });
    }, { passive: false });
    // Drag & Drop von Dateien auf den Viewport
    vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drop'); });
    vp.addEventListener('dragleave', () => vp.classList.remove('drop'));
    vp.addEventListener('drop', e => {
      e.preventDefault(); vp.classList.remove('drop');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      // Pencil mit offener Gruppe „Inhalt“: SVG wird als Strichvorlage übernommen
      if (CG.state.fn === 'pencil' && CG.panel.openId === 'pc-content' && (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml')) CG.sketch.importSvg(f);
      else fromFile(f);
    });
  }

  // Raste mit Haptik beim Einrasten
  function snap(v, target, r, key) {
    if (Math.abs(v - target) < r) {
      if (!drag.snapped[key]) { drag.snapped[key] = true; H.tick(); }
      return target;
    }
    drag.snapped[key] = false;
    return v;
  }

  function geom() {
    const cv = CG.R.cv, vp = $('#viewport');
    const r = cv.getBoundingClientRect(), v = vp.getBoundingClientRect();
    return { r, v, mn: Math.min(r.width, r.height) };
  }
  const center = (g, P) => ({ x: g.r.left + g.r.width / 2 + P.imgX * g.mn, y: g.r.top + g.r.height / 2 - P.imgY * g.mn });

  /* Rahmen nur zeigen, wenn die Gruppe „Bild“ offen ist und ein Bild geladen ist */
  function updateBox() {
    if (!box) return;
    const show = CG.state.page === 'sandbox' && !!currentId && CG.panel.openId === 'image' && !CG.exporter.recording;
    box.classList.toggle('on', show);
    if (!show) return;
    const P = CG.state.params, g = geom(), c = center(g, P);
    const h = P.imgScale * g.mn, w = h * CG.R.img.aspect;
    box.style.width = w + 'px'; box.style.height = h + 'px';
    box.style.transform = `translate(${c.x - g.v.left - w / 2}px, ${c.y - g.v.top - h / 2}px) rotate(${-P.imgRot}deg)`;
  }

  return { buildUpload, sync, fromFile, remove, initViewport, updateBox, get id() { return currentId; } };
})();
