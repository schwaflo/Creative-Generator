'use strict';
/* Linkes Einstellungs-Panel der Sandbox */
CG.panel = (() => {
  const { $, store, el, esc } = CG.util;
  const H = CG.haptics;
  const ctrls = {};
  let conditional = [];
  let palettes = [];
  let syncers = [];
  let openId = store.get('openGroup', 'anim');

  function build() {
    const host = $('#groups');
    CG.controls.release(host);
    buildHead();
    host.innerHTML = '';
    for (const k in ctrls) delete ctrls[k];
    conditional = []; palettes = []; syncers = [];
    const fn = CG.fn();
    const groups = [...CG.groupsFor(fn), { id: 'export', title: 'Export', custom: b => CG.exporter.buildPanel(b) }];

    // Akkordeon: alle Überschriften bleiben sichtbar, nur der Inhalt der
    // offenen Gruppe scrollt.
    for (const g of groups) {
      const grp = el(`<section class="group" data-id="${esc(g.id)}">
          <button type="button" class="ghead"><span>${esc(g.title)}</span>${CG.icon('chevron', 'chev')}</button>
          <div class="gbody"></div></section>`);
      grp.querySelector('.ghead').addEventListener('click', () => openGroup(openId === g.id ? null : g.id));
      const body = grp.querySelector('.gbody');
      if (g.sync) syncers.push(g.sync);
      if (g.pre) g.pre(body);
      if (g.custom) g.custom(body);
      else if (g.palette) buildPalette(g, body);
      else g.params.forEach(p => add(p, body));
      host.appendChild(grp);
    }
    if (!groups.some(g => g.id === openId)) openId = null;
    openGroup(openId);
    refresh();
  }

  function openGroup(id) {
    openId = id;
    store.set('openGroup', id);
    if (CG.vptools) CG.vptools.update();
    $('#groups').querySelectorAll('.group').forEach(g => {
      const on = g.dataset.id === id;
      g.classList.toggle('open', on);
      if (on) g.querySelector('.gbody').scrollTop = 0;
    });
    syncers.forEach(f => f());
  }

  function add(p, body) {
    if (p.hidden) return;
    const c = CG.controls.create(p, CG.state.params[p.key], v => commit(p.key, v));
    ctrls[p.key] = c;
    if (p.showIf) conditional.push({ p, el: c.el });
    body.appendChild(c.el);
  }

  function buildPalette(g, body) {
    const pal = CG.controls.palette(g, () => CG.state.params, (k, v) => commit(k, v), obj => setMany(obj));
    g.params.forEach(p => ctrls[p.key] = { set: v => pal.set(p.key, v) });
    palettes.push(pal);
    body.appendChild(pal.el);
  }

  function commit(key, v) {
    CG.state.params[key] = v;
    CG.markDirty(); CG.persist(); refresh();
  }

  function refresh() {
    conditional.forEach(({ p, el }) => { el.hidden = !p.showIf(CG.state.params); });
    palettes.forEach(p => p.sync());
    syncers.forEach(f => f());
  }

  function setMany(obj) {
    const P = CG.state.params;
    for (const k in obj) if (k in P) { P[k] = obj[k]; ctrls[k] && ctrls[k].set(obj[k]); }
    refresh(); CG.markDirty(); CG.persist();
  }

  function applyPreset(pr) { setMany({ ...CG.defaults(CG.fn()), ...pr.p }); }

  function randomize() {
    const fn = CG.fn(), o = {};
    for (const g of [...fn.groups, { params: fn.animParams || [] }]) {
      if (g.palette) continue;
      for (const p of g.params) {
        if (p.keep || p.type === 'segment' || p.type === 'select' || p.type === 'color') continue;
        if (p.type === 'angle') {
          if (p.wrap === false) continue;
          o[p.key] = Math.round(p.def + (Math.random() - 0.5) * 90 + 360) % 360; continue;
        }
        let v = p.action === 'random' ? p.min + Math.random() * (p.max - p.min)
                                      : p.def + (Math.random() - 0.5) * (p.max - p.min) * 0.5;
        v = Math.min(p.max, Math.max(p.min, v));
        o[p.key] = +(Math.round(v / p.step) * p.step).toFixed(4);
      }
    }
    setMany(o);
  }

  function buildHead() {
    const host = $('#panelHead');
    host.innerHTML = '';
    // Funktionsauswahl als Segment-Buttons (eingebaute Funktionen) …
    const fnSeg = CG.controls.segBar(CG.functions.filter(f => !f.ai).map(f => ({ v: f.id, label: f.name })), CG.state.fn,
      id => CG.switchFn(id), 'seg-fn');
    const fnPill = el('<div class="pill pill-seg"></div>');
    fnPill.appendChild(fnSeg.el);
    host.appendChild(fnPill);
    // … und KI-Generatoren als Liste darunter
    const ai = CG.functions.filter(f => f.ai);
    if (ai.length) {
      const aiPill = el(`<div class="pill preset-pill ai-pick${CG.fn().ai ? ' on' : ''}">
          <select class="pill-select" aria-label="KI-Generator">
            <option value="">KI-Generator</option>${ai.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}
          </select></div>`);
      const s2 = aiPill.querySelector('select');
      s2.value = CG.fn().ai ? CG.state.fn : '';
      s2.onchange = () => { if (s2.value) CG.switchFn(s2.value); s2.blur(); };
      host.appendChild(aiPill);
    }

    // Presets
    const fn = CG.fn();
    const row = el(`<div class="pill preset-pill">
        <select class="pill-select" aria-label="Preset">
          <option value="">Preset</option>${fn.presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}
        </select>
        ${fn.savePreset ? `<button class="act" type="button" data-a="save" title="Reglerstand als Preset speichern">${CG.icon('plus')}</button>` : ''}
        <button class="act" type="button" data-a="rand" title="Variation">${CG.icon('shuffle')}</button>
        <button class="act" type="button" data-a="reset" title="Zurücksetzen">${CG.icon('reset')}</button>
      </div>`);
    const sel = row.querySelector('select');
    const rand = row.querySelector('[data-a=rand]'), reset = row.querySelector('[data-a=reset]');
    const saveBtn = row.querySelector('[data-a=save]');
    if (saveBtn) saveBtn.onclick = async () => {
      const name = (prompt('Name des Presets', `Preset ${fn.presets.length}`) || '').trim();
      if (name && await fn.savePreset(name)) { H.tick(); buildHead(); }
    };
    sel.onchange = () => { if (sel.value === '') return; H.tick(); applyPreset(fn.presets[+sel.value]); sel.value = ''; sel.blur(); };
    rand.onclick = () => { H.tick(); randomize(); };
    reset.onclick = () => { if (confirm('Alle Werte dieser Funktion zurücksetzen?')) applyPreset({ p: {} }); };
    host.appendChild(row);
  }

  return { build, setMany, refresh, openGroup, get openId() { return openId; } };
})();
