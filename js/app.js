'use strict';
/* App: Zustand, Render-Schleife, Navigation, Tastatur */
(async () => {
  const { $, $$, store, toast } = CG.util;
  // gespeicherte KI-Generatoren vor dem Wiederherstellen des Zustands registrieren
  if (CG.ai && CG.ai.registry) await CG.ai.registry.preload();

  /* ---------- Zustand ---------- */
  CG.fnById = id => CG.functions.find(f => f.id === id) || CG.functions[0];
  CG.fn = () => CG.fnById(CG.state.fn);
  CG.groupsFor = fn => [
    // KI-Generatoren steuern ihre Bewegung selbst – dort nur die Loop-Dauer
    { ...CG.shared.anim, params: fn.ai ? CG.shared.anim.params.filter(p => p.key === 'loopLen')
                                       : [...CG.shared.anim.params, ...(fn.animParams || [])] },
    CG.shared.image,
    ...fn.groups,
    CG.shared.finish,
  ];
  CG.allParams = fn => fn._all || (fn._all = CG.groupsFor(fn).flatMap(g => g.params));
  CG.defaults = fn => {
    const o = {};
    CG.allParams(fn).forEach(p => { o[p.key] = p.def; });
    return Object.assign(o, fn.overrides || {});
  };

  CG.state = { fn: 'fire', params: {}, format: { w: 1920, h: 1080, preset: '16:9' }, page: 'format' };
  const cur = store.get('current', null);
  CG.state.fn = CG.fnById(cur ? cur.fn : 'fire').id;
  CG.state.params = { ...CG.defaults(CG.fn()), ...(cur ? cur.params : {}) };
  const f = store.get('format', null);
  if (f && f.w && f.h) CG.state.format = f;
  CG.state.page = store.get('page', 'format');
  if (!['format', 'sandbox', 'ai'].includes(CG.state.page)) CG.state.page = 'format';

  let saveT;
  CG.persist = () => { clearTimeout(saveT); saveT = setTimeout(() => store.set('current', { fn: CG.state.fn, params: CG.state.params }), 250); };

  CG.view = { phase: 0, playing: true, dirty: true, prevW: 0, prevH: 0 };
  CG.markDirty = () => { CG.view.dirty = true; };

  /* ---------- Renderer ---------- */
  const cv = $('#cv');
  try { CG.R = new CG.Renderer(cv); CG.R.program(CG.fn()); }
  catch (e) { console.error(e); $('#viewport').insertAdjacentHTML('beforeend', `<div class="err">${CG.util.esc(e.message)}</div>`); }

  function compile(fn) { try { CG.R && CG.R.program(fn); } catch (e) { console.error(e); toast('Shader-Fehler: ' + e.message); } }

  CG.switchFn = id => {
    if (id === CG.state.fn) return;
    // Loop-Dauer und Bild-Ebene bleiben beim Funktionswechsel erhalten
    const keep = { loopLen: CG.state.params.loopLen };
    for (const k in CG.state.params) if (k.startsWith('img')) keep[k] = CG.state.params[k];
    CG.state.fn = id;
    const fn = CG.fn();
    CG.state.params = { ...CG.defaults(fn), ...keep };
    compile(fn);
    CG.panel.build(); CG.persist(); CG.markDirty();
  };

  CG.loadState = (fnId, params) => {
    CG.state.fn = CG.fnById(fnId).id;
    CG.state.params = { ...CG.defaults(CG.fn()), ...params };
    compile(CG.fn());
    CG.panel.build(); CG.persist(); CG.markDirty();
    CG.layer.sync();
  };

  /* ---------- Vorschau ---------- */
  let quality = store.get('qual', '1');
  const qScale = () => quality === 'dpr' ? (window.devicePixelRatio || 1) : +quality;

  CG.fitPreview = () => {
    const vp = $('#viewport');
    if (!vp || CG.exporter.recording) return;
    const cs = getComputedStyle(vp);
    const aw = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = vp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (aw <= 0 || ah <= 0) return;
    const { w, h } = CG.state.format, r = w / h;
    let cw = aw, ch = aw / r;
    if (ch > ah) { ch = ah; cw = ah * r; }
    cv.style.width = Math.floor(cw) + 'px'; cv.style.height = Math.floor(ch) + 'px';
    let bw = Math.min(w, Math.round(cw * qScale()));
    if (CG.R) bw = Math.min(bw, CG.R.maxDim);
    CG.view.prevW = Math.max(16, bw);
    CG.view.prevH = Math.max(16, Math.round(CG.view.prevW / r));
    CG.view.dirty = true;
  };
  new ResizeObserver(() => CG.fitPreview()).observe($('#viewport'));

  /* ---------- Transport ---------- */
  function setPlaying(p) {
    CG.view.playing = p;
    $('#playBtn').innerHTML = CG.icon(p ? 'pause' : 'play');
    $('#playBtn').title = p ? 'Pause (Leertaste)' : 'Abspielen (Leertaste)';
  }
  $('#playBtn').onclick = () => setPlaying(!CG.view.playing);
  const scrub = $('#scrub');
  scrub.addEventListener('input', () => { CG.view.phase = +scrub.value; CG.view.dirty = true; });

  const qSeg = CG.controls.segBar([{ v: '0.5', label: 'Schnell' }, { v: '1', label: 'Normal' }, { v: 'dpr', label: 'Scharf' }],
    quality, v => { quality = v; store.set('qual', v); CG.fitPreview(); }, 'seg-sm');
  qSeg.el.title = 'Vorschauqualität';
  $('#qualSlot').appendChild(qSeg.el);
  $('#quickExp').onclick = () => CG.exporter.run();
  $('#recCancel').onclick = () => CG.exporter.cancel();

  /* ---------- Render-Schleife ---------- */
  let last = performance.now();
  function tick(now) {
    const V = CG.view;
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
    if (CG.R && CG.state.page === 'sandbox') {
      if (!CG.exporter.frame(now)) {
        if (V.playing) { V.phase = (V.phase + dt / CG.state.params.loopLen) % 1; V.dirty = true; }
        if (V.dirty && V.prevW) {
          try { CG.R.draw(CG.fn(), CG.state.params, V.phase, V.prevW, V.prevH); }
          catch (e) { if (!V.err) { V.err = true; console.error(e); } }    // Schleife läuft weiter
          V.dirty = false;
        }
      }
      CG.layer.updateBox();
      scrub.value = V.phase;
      scrub.style.setProperty('--p', (V.phase * 100) + '%');
      const L = +CG.state.params.loopLen;
      $('#timeLbl').textContent = `${(V.phase * L).toFixed(1).replace('.', ',')} / ${L.toFixed(1).replace('.', ',')} s`;
    }
    requestAnimationFrame(tick);
  }

  /* ---------- Navigation ---------- */
  const nav = CG.controls.segBar([{ v: 'format', label: 'Format' }, { v: 'sandbox', label: 'Sandbox' }, { v: 'ai', label: 'KI' }],
    CG.state.page, p => CG.showPage(p), 'seg-nav');
  $('#navSlot').appendChild(nav.el);

  CG.showPage = p => {
    CG.state.page = p; store.set('page', p);
    nav.set(p);
    $$('.page').forEach(el => el.classList.toggle('active', el.id === 'page-' + p));
    if (p === 'sandbox') requestAnimationFrame(CG.fitPreview);
    if (p === 'ai' && CG.aiPage) CG.aiPage.show();
  };
  // Export-Button oben rechts: zur Sandbox, Export-Gruppe öffnen
  $('#exportNav').onclick = () => { CG.showPage('sandbox'); CG.panel.openGroup('export'); };

  /* ---------- Tastatur ---------- */
  document.addEventListener('keydown', e => {
    if (CG.state.page !== 'sandbox') return;
    const t = document.activeElement;
    const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
      (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type)));
    if (typing) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (t && t !== document.body && t.blur) t.blur();
      setPlaying(!CG.view.playing);
    }
  });
  // Leertaste soll keine fokussierten Buttons auslösen
  document.addEventListener('keyup', e => { if (e.code === 'Space' && CG.state.page === 'sandbox' && document.activeElement.tagName === 'BUTTON') e.preventDefault(); });

  // Beim Verlassen/Neuladen GPU-Speicher sofort freigeben
  window.addEventListener('pagehide', () => {
    const ext = CG.R && CG.R.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  });
  window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

  cv.addEventListener('webglcontextlost', e => { e.preventDefault(); toast('Grafikkontext verloren – Seite neu laden'); });

  /* ---------- Start ---------- */
  $('#swapBtn').innerHTML = CG.icon('swap');
  $('#recCancel').innerHTML = CG.icon('x');
  $('#quickIc').outerHTML = CG.icon('download');
  $('#exportNavIc').outerHTML = CG.icon('download');
  $('#toSandbox').insertAdjacentHTML('beforeend', CG.icon('arrow'));
  setPlaying(true);
  CG.formatPage.init();
  CG.panel.build();
  CG.layer.initViewport();
  CG.vptools.init();
  CG.layer.sync();
  CG.library.buildPanel($('#library'));
  if (CG.aiPage) CG.aiPage.init();
  CG.showPage(CG.state.page);
  requestAnimationFrame(tick);
})();
