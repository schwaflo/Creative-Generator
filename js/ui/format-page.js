'use strict';
/* Seite 1 – Ausgabeformat */
CG.formatPage = (() => {
  const { $, $$, clamp, store, esc } = CG.util;
  const H = CG.haptics;

  const PRESETS = [
    { id: 'square', name: 'Quadratisch', w: 1080, h: 1080, main: 'square' },
    { id: '16:9',   name: '16 : 9',      w: 1920, h: 1080, main: 'landscape' },
    { id: 'a4',     name: 'DIN A4',      w: 2480, h: 3508, main: 'portrait' },
    { id: '4k',     name: '4K UHD',      w: 3840, h: 2160 },
    { id: 'story',  name: '9 : 16',      w: 1080, h: 1920 },
    { id: 'post45', name: '4 : 5',       w: 1080, h: 1350 },
    { id: 'a4-150', name: 'A4 · 150 dpi', w: 1240, h: 1754 },
    { id: 'a3',     name: 'A3 · 300 dpi', w: 3508, h: 4961 },
  ];
  let locked = store.get('lock', false);

  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  function ratioText(w, h) {
    const g = gcd(w, h), a = w / g, b = h / g;
    if (a <= 32 && b <= 32) return `${a} : ${b}`;
    return w >= h ? `${(w / h).toFixed(3).replace('.', ',')} : 1` : `1 : ${(h / w).toFixed(3).replace('.', ',')}`;
  }

  function init() {
    const bar = $('#aspectBar');
    PRESETS.filter(p => p.main).forEach((p, i) => {
      if (i) bar.insertAdjacentHTML('beforeend', '<span class="sep"></span>');
      bar.insertAdjacentHTML('beforeend',
        `<button type="button" data-preset="${p.id}" title="${p.w} × ${p.h} px">${CG.icon(p.main)}<span>${esc(p.name)}</span></button>`);
    });
    bar.insertAdjacentHTML('beforeend', `<span class="sep"></span><button type="button" id="moreBtn">${CG.icon('more')}<span>Weitere</span></button>`);
    const chips = $('#moreChips');
    PRESETS.filter(p => !p.main).forEach(p =>
      chips.insertAdjacentHTML('beforeend', `<button type="button" class="chip" data-preset="${p.id}">${esc(p.name)}<em>${p.w}×${p.h}</em></button>`));

    $$('[data-preset]').forEach(b => b.addEventListener('click', () => {
      const p = PRESETS.find(x => x.id === b.dataset.preset);
      H.tick(); set(p.w, p.h, p.id);
    }));
    $('#moreBtn').onclick = () => { chips.hidden = !chips.hidden; $('#moreBtn').classList.toggle('on', !chips.hidden); };
    if (!PRESETS.find(p => p.id === CG.state.format.preset && p.main)) chips.hidden = false;
    else chips.hidden = true;

    const inW = $('#inW'), inH = $('#inH');
    const onDim = which => {
      let w = parseInt(inW.value, 10), h = parseInt(inH.value, 10);
      if (!(w > 0) || !(h > 0)) return update();
      if (locked) {
        const r = CG.state.format.w / CG.state.format.h;
        if (which === 'w') h = Math.round(w / r); else w = Math.round(h * r);
      }
      set(w, h);
    };
    inW.addEventListener('change', () => onDim('w'));
    inH.addEventListener('change', () => onDim('h'));
    [inW, inH].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); }));
    $('#lockBtn').onclick = () => { locked = !locked; store.set('lock', locked); H.tick(); update(); };
    $('#swapBtn').onclick = () => { H.tick(); set(CG.state.format.h, CG.state.format.w, CG.state.format.preset); };
    $('#toSandbox').onclick = () => CG.showPage('sandbox');
    update();
  }

  function set(w, h, preset) {
    w = clamp(Math.round(w), 16, 16384); h = clamp(Math.round(h), 16, 16384);
    if (!preset) {
      const m = PRESETS.find(p => (p.w === w && p.h === h) || (p.w === h && p.h === w));
      preset = m ? m.id : 'custom';
    }
    CG.state.format = { w, h, preset };
    store.set('format', CG.state.format);
    update();
    CG.fitPreview && CG.fitPreview();
    CG.exporter && CG.exporter.updateInfo();
  }

  function update() {
    const { w, h, preset } = CG.state.format;
    $('#inW').value = w; $('#inH').value = h;
    $$('[data-preset]').forEach(b => b.classList.toggle('on', b.dataset.preset === preset));
    const lb = $('#lockBtn');
    lb.innerHTML = CG.icon(locked ? 'lock' : 'unlock');
    lb.classList.toggle('on', locked);
    lb.title = locked ? 'Seitenverhältnis gesperrt' : 'Seitenverhältnis frei';
    const box = 300, s = box / Math.max(w, h), sh = $('#fmtShape');
    sh.style.width = (w * s) + 'px'; sh.style.height = (h * s) + 'px';
    const cm = px => (px / 300 * 2.54).toFixed(1).replace('.', ',');
    $('#fmtInfo').innerHTML = `
      <div><dt>Verhältnis</dt><dd>${ratioText(w, h)}</dd></div>
      <div><dt>Megapixel</dt><dd>${(w * h / 1e6).toFixed(2).replace('.', ',')}</dd></div>
      <div><dt>@ 300 dpi</dt><dd>${cm(w)} × ${cm(h)} cm</dd></div>`;
  }

  return { init, set, update, PRESETS };
})();
