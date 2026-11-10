'use strict';
/* UI-Bausteine: Wertregler, Verlaufsregler, Stufenregler, Drehregler (Lineal),
   Segment-Umschalter und Farbpalette. Alle liefern { el, set(v) }. */
CG.controls = (() => {
  const { clamp, el, esc } = CG.util;
  const H = CG.haptics;

  const decimals = p => { const s = p.step ?? 0.01; return s >= 1 ? 0 : s >= 0.1 ? 1 : 2; };
  // Ein gemeinsamer ResizeObserver für alle Drehregler; release() gibt alte Regler frei,
  // damit beim Neuaufbau des Panels nichts im Speicher hängen bleibt.
  const drawers = new WeakMap();
  const ro = new ResizeObserver(entries => entries.forEach(e => { const f = drawers.get(e.target); if (f) f(); }));
  function release(root) { if (root) root.querySelectorAll('.ruler').forEach(r => { ro.unobserve(r); drawers.delete(r); }); }

  const fmt = (p, v) => p.format ? p.format(v) : (+v).toFixed(decimals(p)).replace('.', ',') + (p.unit ? ' ' + p.unit : '');
  const parse = s => parseFloat(String(s).replace(',', '.'));

  // Kompakte Zeile: Name · Regler · Wert
  function shell(p, editable = true) {
    const node = el(`<div class="ctl row" data-key="${esc(p.key)}">
      <span class="name">${esc(p.label)}</span>
      <div class="slot"></div>${
        editable ? `<input class="val" type="text" inputmode="decimal" spellcheck="false" aria-label="${esc(p.label)}">`
                 : `<span class="val ro"></span>`}</div>`);
    return { node, pill: node.querySelector('.slot'), val: node.querySelector('.val') };
  }

  function actionButton(icon, title) {
    return el(`<button class="act" type="button" title="${esc(title)}">${CG.icon(icon)}</button>`);
  }

  /* ---------- Wertregler & Verlaufsregler ---------- */
  function range(p, value, onChange, opts) {
    const { node, pill, val } = shell(p);
    const inp = el(`<input type="range" class="vs${p.type === 'gradient' ? ' grad' : ''}" min="${p.min}" max="${p.max}" step="${p.step}">`);
    if (p.gradient) inp.style.setProperty('--grad', p.gradient);
    pill.appendChild(inp);
    let cur = value;
    const set = v => {
      cur = +v; inp.value = cur;
      if (document.activeElement !== val) val.value = fmt(p, cur);
      inp.style.setProperty('--p', ((cur - p.min) / (p.max - p.min) * 100) + '%');
    };
    const commit = (v, drag) => {
      v = clamp(+v, p.min, p.max);
      if (isNaN(v)) return set(cur);
      if (p.detent && drag && Math.abs(v - p.def) < (p.max - p.min) * 0.015) v = p.def;   // Raste
      if (p.detent && v === p.def && cur !== p.def) { H.tick(); H.flash(node); }
      if (v === cur) return set(v);
      set(v); onChange(v);
    };
    inp.addEventListener('input', () => commit(inp.value, true));
    val.addEventListener('change', () => commit(parse(val.value)));
    val.addEventListener('blur', () => set(cur));
    val.addEventListener('keydown', e => { if (e.key === 'Enter') val.blur(); });
    const reset = () => commit(p.def);
    node.querySelector('.name').addEventListener('dblclick', reset);
    inp.addEventListener('dblclick', reset);
    if (p.action === 'random') {
      const b = actionButton('shuffle', 'Zufällig');
      b.onclick = () => { H.tick(); commit(Math.round(p.min + Math.random() * (p.max - p.min))); };
      pill.appendChild(b);
    }
    set(value);
    return { el: node, set };
  }

  /* ---------- Stufenregler (Punkte) ---------- */
  function step(p, value, onChange) {
    const { node, pill, val } = shell(p, false);
    const n = Math.round((p.max - p.min) / p.step) + 1;
    const pos = i => `calc(11px + (100% - 22px) * ${n > 1 ? i / (n - 1) : 0})`;
    pill.innerHTML = `<div class="stepper">
        <div class="dots">${Array.from({ length: n }, (_, i) => `<i style="left:${pos(i)}"></i>`).join('')}</div>
        <input type="range" class="vs st" min="${p.min}" max="${p.max}" step="${p.step}" aria-label="${esc(p.label)}">
      </div>`;
    const inp = pill.querySelector('input');
    let cur = value;
    const set = v => { cur = +v; inp.value = cur; val.textContent = fmt(p, cur); };
    const commit = v => {
      v = clamp(Math.round(+v), p.min, p.max);
      if (v === cur) return;
      H.tick(); H.flash(node);
      set(v); onChange(v);
    };
    inp.addEventListener('input', () => commit(inp.value));
    node.querySelector('.name').addEventListener('dblclick', () => commit(p.def));
    set(value);
    return { el: node, set };
  }

  /* ---------- Drehregler (Lineal) ---------- */
  function angle(p, value, onChange) {
    const wrap = p.wrap !== false;
    const min = wrap ? 0 : p.min, max = wrap ? 360 : p.max;
    const detents = p.detents || (wrap ? [0, 90, 180, 270] : [min, max]);
    const PPD = 2.4;                                    // Pixel pro Grad
    const { node, pill, val } = shell(p);
    pill.classList.add('pill-ruler');
    pill.innerHTML = `<div class="ruler" tabindex="0" role="slider" aria-label="${esc(p.label)}" aria-valuemin="${min}" aria-valuemax="${max}">
        <div class="ruler-strip"></div><div class="ruler-mark"></div></div>`;
    const ruler = pill.querySelector('.ruler'), strip = pill.querySelector('.ruler-strip');
    let cur = value;
    const norm = v => wrap ? ((v % 360) + 360) % 360 : clamp(v, min, max);
    const draw = () => {
      const x = (ruler.clientWidth || 280) / 2 - cur * PPD;
      strip.style.backgroundPosition = `${x - 1}px 50%, ${x - 0.5}px 50%`;
    };
    const set = v => {
      cur = norm(+v);
      if (document.activeElement !== val) val.value = Math.round(cur) + '°';
      ruler.setAttribute('aria-valuenow', Math.round(cur));
      draw();
    };
    const apply = v => { const prev = cur; set(v); if (cur !== prev) onChange(cur); };
    // Bewegung mit Rastpunkten: Haptik beim Überqueren, leichtes Einrasten
    let rawPrev = cur;
    const move = raw => {
      let v = raw;
      for (const d0 of detents) {
        const d = wrap ? d0 + 360 * Math.round((raw - d0) / 360) : d0;
        if ((rawPrev - d) * (raw - d) < 0 || (raw === d && rawPrev !== d)) { H.tick(); H.flash(node); }
        if (Math.abs(raw - d) < 1.2) v = d;
      }
      rawPrev = raw;
      apply(v);
    };
    let drag = null;
    ruler.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, v: cur }; rawPrev = cur;
      ruler.setPointerCapture(e.pointerId); ruler.classList.add('drag');
    });
    ruler.addEventListener('pointermove', e => { if (drag) move(drag.v - (e.clientX - drag.x) / PPD); });
    const end = () => { drag = null; ruler.classList.remove('drag'); };
    ruler.addEventListener('pointerup', end);
    ruler.addEventListener('pointercancel', end);
    ruler.addEventListener('wheel', e => {
      e.preventDefault(); rawPrev = cur;
      move(cur + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 0.12);
    }, { passive: false });
    ruler.addEventListener('keydown', e => {
      const s = e.shiftKey ? 15 : 1;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); rawPrev = cur; move(cur - s); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); rawPrev = cur; move(cur + s); }
    });
    const reset = () => { H.tick(); apply(p.def); };
    ruler.addEventListener('dblclick', reset);
    node.querySelector('.name').addEventListener('dblclick', reset);
    val.addEventListener('change', () => { const n = parse(val.value); if (!isNaN(n)) apply(n); val.blur(); });
    val.addEventListener('blur', () => set(cur));
    val.addEventListener('keydown', e => { if (e.key === 'Enter') val.blur(); });
    drawers.set(ruler, draw); ro.observe(ruler);
    set(value);
    return { el: node, set };
  }

  /* ---------- Segment-Umschalter ---------- */
  function segBar(options, value, onChange, cls = '') {
    const bar = el(`<div class="seg ${cls}">${options.map(o => `<button type="button" data-v="${esc(o.v)}">${o.icon ? CG.icon(o.icon) : ''}${o.label ? `<span>${esc(o.label)}</span>` : ''}</button>`).join('')}</div>`);
    let cur = value;
    const set = v => { cur = v; bar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', options[i].v === v)); };
    bar.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => {
      const v = options[i].v;
      if (v === cur) return;
      H.tick(); set(v); onChange(v);
    }));
    set(value);
    return { el: bar, set };
  }

  function segment(p, value, onChange, opts = {}) {
    const node = p.label
      ? el(`<div class="ctl row seg-row" data-key="${esc(p.key)}"><span class="name">${esc(p.label)}</span><div class="slot"></div></div>`)
      : el(`<div class="ctl" data-key="${esc(p.key)}"><div class="pill pill-seg"></div></div>`);
    const pill = node.querySelector('.slot, .pill');
    const bar = segBar(p.options, value, onChange);
    pill.appendChild(bar.el);
    if (opts.action) {
      const b = actionButton(opts.action.icon, opts.action.title);
      b.onclick = opts.action.run;
      pill.appendChild(b);
    }
    return { el: node, set: bar.set };
  }

  /* ---------- Auswahlliste (viele Optionen) ---------- */
  function select(p, value, onChange) {
    const node = el(`<div class="ctl row" data-key="${esc(p.key)}"><span class="name">${esc(p.label)}</span>
      <div class="slot"><select class="pill-select row-select" aria-label="${esc(p.label)}">${p.options.map(o =>
        `<option value="${esc(o.v)}">${esc(o.label)}</option>`).join('')}</select></div></div>`);
    const sel = node.querySelector('select');
    const set = v => { sel.value = v; };
    sel.addEventListener('change', () => { H.tick(); onChange(sel.value); sel.blur(); });
    node.querySelector('.name').addEventListener('dblclick', () => { set(p.def); onChange(p.def); });
    set(value);
    return { el: node, set };
  }

  /* ---------- Farbpalette ----------
     - Farbfelder (Slots) der Funktion: Klick = Farbwähler, Ziehen auf anderen Slot = tauschen
     - Farbflächen-Sammlung (global): hinzufügen, auf Slots ziehen
     - Mischen: verteilt die Farben der aktuellen Variante neu auf die Slots
     - Varianten: jede Änderung wird in der aktiven Variante gespeichert */
  const SWATCH_DEFAULTS = ['#ffffff', '#f7f3f1', '#e9a2b6', '#f3a04c', '#ffd24d', '#7a3264', '#5a2a48', '#0d0a13', '#3f6ef0', '#1fa37a'];
  const lc = v => String(v).toLowerCase();

  function palette(g, getParams, onChange, onMany) {
    const { store } = CG.util;
    const KEY = 'pal.' + g.id;
    const keys = g.params.map(p => p.key);
    const loadState = () => {
      const st = store.get(KEY, null);
      if (st && Array.isArray(st.variants) && st.variants.length) return st;
      return { variants: g.palettes.map(pl => ({ c: { ...pl.c } })), active: -1 };
    };
    let st = loadState();
    const saveState = () => store.set(KEY, st);
    const current = () => { const P = getParams(), o = {}; keys.forEach(k => o[k] = P[k]); return o; };
    const same = (c1, c2) => keys.every(k => lc(c1[k]) === lc(c2[k]));

    const node = el(`<div class="ctl palette-ctl">
      <div class="pill">
        <div class="palette">${g.params.map(p => `<label class="sw" data-k="${esc(p.key)}" title="${esc(p.label)}"><input type="color" aria-label="${esc(p.label)}"></label>`).join('')}</div>
        <button class="act" type="button" data-a="mix" title="Farben mischen">${CG.icon('shuffle')}</button>
      </div>
      <div class="sw-labels">${g.params.map(p => `<span>${esc(p.label)}</span>`).join('')}</div>
      <div class="chips-row"></div>
      <div class="pal-presets"></div>
    </div>`);
    const chipsRow = node.querySelector('.chips-row'), varHost = node.querySelector('.pal-presets');
    const sw = {};
    node.querySelectorAll('.sw').forEach(l => { sw[l.dataset.k] = { l, inp: l.querySelector('input') }; });
    const set = (k, v) => { if (!sw[k]) return; sw[k].l.style.background = v; sw[k].inp.value = v; };

    // Änderung übernehmen und in der aktiven Variante speichern (ohne aktive Variante: neue anlegen)
    function commitColors(obj) {
      const next = { ...current(), ...obj };
      if (st.active < 0 || !st.variants[st.active]) { st.variants.push({ c: next }); st.active = st.variants.length - 1; }
      else st.variants[st.active].c = next;
      saveState();
      Object.keys(obj).length === 1 ? onChange(Object.keys(obj)[0], obj[Object.keys(obj)[0]]) : onMany(obj);
      renderVariants();
    }

    // Slots: Farbwähler
    for (const k of keys) sw[k].inp.addEventListener('input', () => { set(k, sw[k].inp.value); commitColors({ [k]: sw[k].inp.value }); });

    // Mischen innerhalb der Variante
    node.querySelector('[data-a=mix]').onclick = () => {
      const cur = current(), vals = keys.map(k => cur[k]);
      if (new Set(vals.map(lc)).size < 2) return;
      let perm;
      do { perm = [...vals]; for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } }
      while (perm.every((v, i) => lc(v) === lc(vals[i])));
      const o = {}; keys.forEach((k, i) => o[k] = perm[i]);
      H.tick(); commitColors(o);
    };

    /* --- Ziehen (Zeiger-basiert, funktioniert mit Maus, Trackpad und Touch) --- */
    function dragFrom(e, color, src, onClickOnly) {
      const x0 = e.clientX, y0 = e.clientY;
      let ghost = null, target = null;
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        if (!ghost) { ghost = el(`<div class="drag-ghost" style="background:${color}"></div>`); document.body.appendChild(ghost); }
        ghost.style.transform = `translate(${ev.clientX - 14}px, ${ev.clientY - 14}px)`;
        const hit = document.elementFromPoint(ev.clientX, ev.clientY);
        const t = hit && (hit.closest('.sw') || hit.closest('.chips-row'));
        const ok = t && node.contains(t) && t !== src ? t : null;
        if (ok !== target) { target && target.classList.remove('drop-on'); target = ok; target && target.classList.add('drop-on'); if (target) H.tick(); }
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (!ghost) { onClickOnly && onClickOnly(); return; }
        ghost.remove();
        // Klick nach dem Ziehen unterdrücken (sonst öffnet sich der Farbwähler)
        const swallow = ev => { ev.preventDefault(); ev.stopPropagation(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        if (!target) return;
        target.classList.remove('drop-on');
        if (target.classList.contains('sw')) {
          const k = target.dataset.k;
          if (src && src.classList.contains('sw')) {          // Slot auf Slot: tauschen
            const sk = src.dataset.k, cur = current();
            commitColors({ [k]: cur[sk], [sk]: cur[k] });
          } else commitColors({ [k]: color });
        } else if (target.classList.contains('chips-row')) addSwatch(color);   // Slot in Sammlung ziehen
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    for (const k of keys) sw[k].l.addEventListener('pointerdown', e => dragFrom(e, current()[k], sw[k].l));

    /* --- Farbflächen-Sammlung (für alle Funktionen gemeinsam) --- */
    const swatches = () => store.get('swatches', SWATCH_DEFAULTS);
    function addSwatch(c) {
      const list = swatches().filter(x => lc(x) !== lc(c));
      list.push(c); store.set('swatches', list); renderChips();
    }
    function renderChips() {
      chipsRow.innerHTML = '';
      for (const c of swatches()) {
        const chip = el(`<span class="chip-c" style="background:${c}" title="${c}"><b title="Entfernen">×</b></span>`);
        chip.addEventListener('pointerdown', e => { if (e.target.tagName !== 'B') dragFrom(e, c, null); });
        chip.querySelector('b').onclick = () => { store.set('swatches', swatches().filter(x => lc(x) !== lc(c))); renderChips(); };
        chipsRow.appendChild(chip);
      }
      const add = el(`<label class="chip-add" title="Farbfläche hinzufügen">${CG.icon('plus')}<input type="color" value="#8b5cf6"></label>`);
      add.querySelector('input').addEventListener('change', e => addSwatch(e.target.value));
      chipsRow.appendChild(add);
    }

    /* --- Varianten --- */
    function renderVariants() {
      varHost.innerHTML = '';
      st.variants.forEach((v, i) => {
        const b = el(`<button type="button" class="pal-preset${i === st.active ? ' on' : ''}">
            <span class="strip">${keys.map(k => `<i style="background:${v.c[k]}"></i>`).join('')}</span>
            ${st.variants.length > 1 ? '<b class="del" title="Variante löschen">×</b>' : ''}</button>`);
        b.onclick = e => {
          if (e.target.classList.contains('del')) {
            st.variants.splice(i, 1);
            if (st.active === i) st.active = -1; else if (st.active > i) st.active--;
            saveState(); renderVariants(); return;
          }
          st.active = i; saveState(); onMany({ ...v.c }); renderVariants();
        };
        varHost.appendChild(b);
      });
      const add = el(`<button type="button" class="pal-preset pal-add" title="Neue Variante aus aktuellen Farben">${CG.icon('plus')}</button>`);
      add.onclick = () => { st.variants.push({ c: current() }); st.active = st.variants.length - 1; saveState(); H.tick(); renderVariants(); };
      varHost.appendChild(add);
    }

    // Bei Änderungen von außen (Preset, Design laden): passende Variante markieren
    function sync() {
      const cur = current();
      keys.forEach(k => set(k, cur[k]));
      const a = st.variants[st.active] && same(st.variants[st.active].c, cur) ? st.active : st.variants.findIndex(v => same(v.c, cur));
      if (a !== st.active) { st.active = a; saveState(); }
      renderVariants();
    }

    renderChips();
    sync();
    return { el: node, set, sync };
  }

  function create(p, value, onChange, opts) {
    switch (p.type) {
      case 'angle': return angle(p, value, onChange);
      case 'step': return step(p, value, onChange);
      case 'segment': return segment(p, value, onChange, opts);
      case 'select': return select(p, value, onChange);
      default: return range(p, value, onChange, opts);
    }
  }

  return { create, segBar, segment, palette, fmt, release };
})();
