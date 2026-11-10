'use strict';
/* Seite „KI“: Referenzbild -> Analyse -> Prompt -> Generator.
   Der Browser spricht direkt mit dem KI-Server (Ollama oder OpenAI-kompatibel) – kein Server dazwischen. */
CG.aiPage = (() => {
  const { el, esc, toast, store } = CG.util;
  const H = CG.haptics;
  const AI = () => CG.ai;
  let R = null;                                  // DOM-Referenzen
  const S = { image: null, imageName: '', analysis: null, prompt: '', promptDirty: false, run: null, health: null, last: null };

  /* ---------- Aufbau ---------- */
  function init() {
    const root = document.getElementById('aiRoot');
    if (!root || R) return;
    root.innerHTML = `
      <div class="ai-head">
        <div class="pill ai-conn">
          <label class="m-pick"><span>Server</span><select data-c="server">${AI().settings.SERVERS.map(x => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select></label>
          <label class="m-pick grow"><span>Adresse</span><input data-c="url" type="url" spellcheck="false" autocomplete="off"></label>
          <label class="m-pick key"><span>Schlüssel</span><input data-c="key" type="password" autocomplete="off" placeholder="optional"></label>
          <button class="btn primary" type="button" data-a="connect">Verbinden</button>
        </div>
        <div class="pill ai-status">
          <span class="dot"></span><span class="st-text">Nicht verbunden</span>
          <span class="spacer"></span>
          <label class="m-pick" title="Modell für die Bildanalyse"><span>Bild</span><select data-m="visionModel"></select></label>
          <label class="m-pick" title="Modell für den Code"><span>Code</span><select data-m="codeModel"></select></label>
        </div>
        <div class="ai-hint" hidden></div>
      </div>
      <div class="ai-steps">
        <section class="ai-card">
          <header><span class="num">1</span><h3>Referenz</h3></header>
          <div class="drop" tabindex="0" role="button" aria-label="Referenzbild wählen">
            <img alt="" hidden>
            <div class="drop-empty">${CG.icon('upload')}<span>Bild ablegen oder wählen</span></div>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          </div>
          <textarea class="ai-text ai-wishes" rows="3" spellcheck="false" placeholder="Zusatzwünsche, z. B. Animation mit Geschwindigkeitsregler, Farbpalette tauschbar"></textarea>
          <div class="ai-row">
            <label class="ai-check"><input type="checkbox" data-a="review"><span>Prompt erst prüfen</span></label>
            <button class="btn primary" type="button" data-a="go">Generator erzeugen</button>
          </div>
        </section>
        <section class="ai-card">
          <header><span class="num">2</span><h3>Analyse</h3>
            <button class="act" type="button" data-a="json" title="Als JSON bearbeiten">{ }</button>
            <button class="act" type="button" data-a="analyze" title="Erneut analysieren">${CG.icon('refresh')}</button></header>
          <div class="ana"><div class="ai-empty">Noch keine Analyse</div></div>
          <textarea class="ai-text ana-json" spellcheck="false" hidden></textarea>
        </section>
        <section class="ai-card">
          <header><span class="num">3</span><h3>Prompt</h3>
            <button class="act" type="button" data-a="rebuild" title="Aus Analyse neu aufbauen">${CG.icon('reset')}</button></header>
          <textarea class="ai-text ai-prompt" spellcheck="false" placeholder="Wird aus der Analyse erzeugt"></textarea>
          <div class="ai-row"><span class="meta-line prompt-meta"></span><button class="btn" type="button" data-a="send">Senden</button></div>
        </section>
      </div>
      <section class="ai-run" hidden>
        <div class="run-head"><span class="spin"></span><b class="run-title"></b><span class="run-meta"></span>
          <button class="btn ghost" type="button" data-a="cancel">Abbrechen</button></div>
        <div class="run-bar"><i></i></div>
        <ol class="run-log"></ol>
        <div class="run-result" hidden></div>
      </section>
      <section class="ai-lib"><div class="lib-head"><h2>Generatoren</h2>
          <button class="btn ghost" type="button" data-a="import" title="Generator-Datei (.json) importieren">${CG.icon('upload')}<span>Importieren</span></button>
          <input type="file" data-a="importFile" accept=".json,application/json" multiple hidden></div>
        <div class="gen-grid"></div></section>`;

    const q = s => root.querySelector(s);
    R = { root, status: q('.ai-status'), dot: q('.dot'), stText: q('.st-text'), hint: q('.ai-hint'),
      vSel: q('[data-m=visionModel]'), cSel: q('[data-m=codeModel]'),
      drop: q('.drop'), img: q('.drop img'), file: q('.drop input'), wishes: q('.ai-wishes'), review: q('[data-a=review]'),
      go: q('[data-a=go]'), send: q('[data-a=send]'), ana: q('.ana'), anaJson: q('.ana-json'), prompt: q('.ai-prompt'),
      promptMeta: q('.prompt-meta'), run: q('.ai-run'), runTitle: q('.run-title'), runMeta: q('.run-meta'), bar: q('.run-bar i'),
      log: q('.run-log'), result: q('.run-result'), cancel: q('[data-a=cancel]'), grid: q('.gen-grid'),
      server: q('[data-c=server]'), url: q('[data-c=url]'), key: q('[data-c=key]') };

    R.wishes.value = store.get('ai.wishes', '');
    R.review.checked = store.get('ai.review', false);
    R.wishes.addEventListener('input', () => { store.set('ai.wishes', R.wishes.value); if (!S.promptDirty) rebuildPrompt(); });
    R.review.addEventListener('change', () => store.set('ai.review', R.review.checked));

    // Upload: Klick, Tastatur, Drag & Drop
    R.drop.addEventListener('click', () => R.file.click());
    R.drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); R.file.click(); } });
    R.file.addEventListener('change', () => { if (R.file.files[0]) setImage(R.file.files[0]); R.file.value = ''; });
    R.drop.addEventListener('dragover', e => { e.preventDefault(); R.drop.classList.add('over'); });
    R.drop.addEventListener('dragleave', () => R.drop.classList.remove('over'));
    R.drop.addEventListener('drop', e => {
      e.preventDefault(); R.drop.classList.remove('over');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setImage(f);
    });

    R.prompt.addEventListener('input', () => { S.prompt = R.prompt.value; S.promptDirty = true; promptMeta(); });
    q('[data-a=rebuild]').onclick = () => { S.promptDirty = false; rebuildPrompt(); H.tick(); };
    q('[data-a=analyze]').onclick = () => runFlow({ analyze: true, generate: false });
    q('[data-a=json]').onclick = () => toggleJson();
    R.anaJson.addEventListener('change', () => {
      const j = AI().parse.extractJson(R.anaJson.value);
      if (!j) return toast('Kein gültiges JSON');
      S.analysis = AI().schema.cleanAnalysis(j); renderAnalysis(); if (!S.promptDirty) rebuildPrompt();
    });
    R.go.onclick = () => runFlow({ analyze: !S.analysis, generate: !R.review.checked });
    R.send.onclick = () => runFlow({ analyze: false, generate: true });
    R.cancel.onclick = () => { if (S.run) S.run.abort(); };
    // Verbindung: Server, Adresse, Schlüssel (nur in diesem Browser)
    const st = AI().settings;
    R.server.value = st.server().id; R.url.value = st.url(); R.key.value = st.key();
    R.server.addEventListener('change', () => {
      const prev = st.server(), next = st.SERVERS.find(x => x.id === R.server.value);
      const url = (!R.url.value.trim() || R.url.value.trim() === prev.url) ? next.url : R.url.value.trim();
      st.set({ server: next.id, url }); R.url.value = url;
      H.tick(); if (next.url !== 'https://') refreshHealth(true); else R.url.focus();
    });
    R.url.addEventListener('change', () => st.set({ url: R.url.value.trim() }));
    R.url.addEventListener('keydown', e => { if (e.key === 'Enter') { st.set({ url: R.url.value.trim() }); refreshHealth(true); } });
    R.key.addEventListener('change', () => st.setKey(R.key.value));
    q('[data-a=connect]').onclick = () => { st.set({ url: R.url.value.trim() }); st.setKey(R.key.value); refreshHealth(true); };
    for (const sel of [R.vSel, R.cSel]) sel.addEventListener('change', () => { st.set({ [sel.dataset.m]: sel.value }); H.tick(); refreshHealth(); });
    // Generatoren importieren
    const imp = q('[data-a=importFile]');
    q('[data-a=import]').onclick = () => imp.click();
    imp.addEventListener('change', async () => {
      let n = 0;
      for (const f of imp.files) {
        try { const list = await AI().store.fromFile(await f.text()); list.forEach(g => AI().registry.register(g)); n += list.length; }
        catch (e) { toast(`${f.name}: ${e.message}`); }
      }
      imp.value = '';
      if (n) { renderLibrary(); CG.panel.build(); toast(`${n} Generator(en) importiert`); }
    });
    promptMeta();
  }

  function show() {
    init();
    refreshHealth();
    renderLibrary();
  }

  /* Als Datei geöffnet (Doppelklick, file://): Der Browser meldet die Herkunft „null“.
     Ollama lehnt das immer ab (403) und lässt „null“ auch nicht als Freigabe zu – nur über http(s) geht es. */
  function fileHint(srv) {
    const dir = decodeURIComponent(location.pathname).replace(/\/[^/]*$/, '');
    hint(`Die App ist als Datei geöffnet (<code>file://</code>). Der Browser meldet dann keine Seitenadresse, und ${esc(srv.label)} lehnt die Anfrage ab.` +
      ' Starte die App über den mitgelieferten Server und öffne <code>http://localhost:8765</code>:', [`python3 "${dir}/server.py"`]);
    if (srv.api === 'openai') R.hint.insertAdjacentHTML('beforeend', '<span class="sub">LM Studio mit „Enable CORS“ kann auch Anfragen von Dateien annehmen – dann reicht „Verbinden“.</span>');
  }

  /* ---------- Status / Verbindung ---------- */
  async function refreshHealth(manual) {
    if (!R) return false;
    const st = AI().settings, srv = st.server(), url = st.url();
    R.dot.className = 'dot'; R.stText.textContent = `Verbinde mit ${srv.label} …`;
    const h = await AI().client.status();
    S.health = h;
    if (!h.ok) {
      fillModels({ models: [] });
      R.dot.className = 'dot bad';
      R.stText.textContent = h.error && h.error.code === 'auth' ? 'Zugriff verweigert' : 'Keine Verbindung';
      explain(h.error, srv, url);
      return false;
    }
    AI().pipeline.setModels(h.models);
    fillModels(h);
    const cfg = AI().config;
    R.dot.className = 'dot ' + (h.missing.length ? 'warn' : 'ok');
    const loaded = h.loaded == null ? '' : h.loaded.length ? ` · geladen: ${h.loaded.map(esc).join(', ')}` : ' · kein Modell geladen';
    R.stText.innerHTML = `${esc(srv.label)}${h.version ? ' ' + esc(h.version) : ''} · ${h.models.length} Modelle${loaded}`;
    const vis = h.models.find(m => m.name === cfg.visionModel);
    if (h.missing.length) {
      const cmds = h.missing.map(m => m.cmd).filter(Boolean);
      hint(cmds.length ? 'Fehlende Modelle installieren:' : `Modell nicht auf dem Server: ${h.missing.map(m => '„' + esc(m.model) + '“').join(', ')}. Bitte oben ein vorhandenes Modell wählen oder es im Server laden.`, cmds);
    } else if (vis && Array.isArray(vis.capabilities) && !vis.capabilities.includes('vision')) {
      hint(`„${esc(cfg.visionModel)}“ kann keine Bilder lesen. Wähle ein Bild-Modell oder installiere eines:`, ['ollama pull llama3.2-vision']);
    } else if (srv.api === 'openai' && /:11434$/.test(url)) {
      hint('Das ist Ollama. Mit dem Server-Typ „Ollama“ stehen Kontextgröße (num_ctx) und das automatische Entladen der Modelle zur Verfügung – über die OpenAI-Schnittstelle nutzt Ollama nur 4096 Token Kontext.');
    } else hint(null);
    if (manual) H.tick();
    return !h.missing.length;
  }

  /* Verbindungsfehler erklären: Freigabe (CORS), HTTPS, Safari, Schlüssel */
  function explain(err, srv, url) {
    const origin = AI().client.pageOrigin();
    const d = (err && err.detail) || {};
    if (err && err.code === 'auth') return hint(`${esc(err.message)} Schlüssel oben eintragen und „Verbinden“ wählen.`);
    if (d.reason === 'mixed') return hint(`Diese Seite läuft über HTTPS. Die Adresse eines anderen Rechners muss deshalb mit <code>https://</code> beginnen (<code>http://localhost</code> ist erlaubt).`);
    if (d.reason === 'safari') return hint('Safari blockiert Verbindungen von dieser Seite zum KI-Server auf dem Rechner. Bitte Chrome, Edge oder Firefox verwenden.');
    if (d.reason === 'file') return fileHint(srv);
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const test = `curl -i -H "Origin: ${origin}" ${url}${srv.api === 'ollama' ? '/api/tags' : '/v1/models'}`;
    if (srv.api === 'ollama') {
      return hint(`Keine Verbindung zu <code>${esc(url)}</code>. Läuft Ollama (App starten oder <code>ollama serve</code>)?` +
        (local ? '' : ` Diese Seitenadresse muss freigegeben sein – danach Ollama neu starten:`) +
        ' Test: bei <code>200 OK</code> passt alles, bei <code>403</code> fehlt die Freigabe.',
        [...(local ? [] : [`launchctl setenv OLLAMA_ORIGINS "${origin}"`]), test]);
    }
    hint(`Keine Verbindung zu <code>${esc(url)}</code>. Server starten, ein Modell laden und CORS erlauben` +
      (srv.id === 'lmstudio' ? ' (LM Studio: Developer › Server starten › „Enable CORS“ einschalten).' : '.') +
      ' Test: bei <code>200 OK</code> passt alles.', [test]);
    if (location.protocol === 'https:' && !local) R.hint.insertAdjacentHTML('beforeend', '<span class="sub">Chrome fragt einmal, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf – „Zulassen“ wählen.</span>');
  }

  function fillModels(h) {
    const cfg = AI().config || {};
    const opts = cur => {
      const names = h.models.map(m => m.name);
      if (cur && !names.includes(cur)) names.unshift(cur);
      return names.map(n => {
        const m = h.models.find(x => x.name === n), vis = m && Array.isArray(m.capabilities) && m.capabilities.includes('vision');
        return `<option value="${esc(n)}">${esc(n)}${m ? (vis ? ' · Bild' : '') : (h.models.length ? ' (fehlt)' : '')}</option>`;
      }).join('');
    };
    R.vSel.innerHTML = opts(cfg.visionModel); R.vSel.value = cfg.visionModel || '';
    R.cSel.innerHTML = opts(cfg.codeModel); R.cSel.value = cfg.codeModel || '';
  }

  function hint(html, cmds) {
    if (!html) { R.hint.hidden = true; return; }
    R.hint.hidden = false;
    R.hint.innerHTML = `<span>${html}</span>` + (cmds || []).map(c =>
      `<span class="cmd"><code>${esc(c)}</code><button class="act" type="button" title="Kopieren" data-c="${esc(c)}">${CG.icon('copy')}</button></span>`).join('');
    R.hint.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.c).then(() => toast('Kopiert')); });
  }

  /* ---------- Bild ---------- */
  async function setImage(file) {
    if (!/^image\//.test(file.type)) return toast('Bitte eine Bilddatei wählen');
    try {
      const max = (AI().config && AI().config.maxImageSide) || 1024;
      S.image = await AI().pipeline.prepareImage(file, max);
      S.imageName = file.name;
      R.img.src = S.image.dataUrl; R.img.hidden = false;
      R.drop.classList.add('has');
      S.analysis = null; renderAnalysis();
      S.promptDirty = false; rebuildPrompt();
      H.tick();
    } catch (e) { toast('Bild konnte nicht gelesen werden'); }
  }

  /* ---------- Analyse ---------- */
  const FIELDS = [['shapes', 'Formen'], ['geometry', 'Geometrie'], ['patterns', 'Muster'], ['repetition', 'Wiederholung'], ['symmetry', 'Symmetrie'],
    ['composition', 'Komposition'], ['density', 'Dichte'], ['rhythm', 'Rhythmus'], ['depth', 'Tiefe'], ['textures', 'Texturen'],
    ['lineQuality', 'Linien'], ['contrast', 'Kontrast'], ['motion', 'Bewegung'], ['mood', 'Stimmung']];

  function renderAnalysis() {
    const a = S.analysis;
    R.anaJson.value = a ? JSON.stringify(a, null, 2) : '';
    if (!a) { R.ana.innerHTML = '<div class="ai-empty">Noch keine Analyse</div>'; return; }
    const v = x => Array.isArray(x) ? x.join(', ') : x;
    R.ana.innerHTML = `
      <div class="ana-title">${esc(a.title)}</div>
      <div class="swatches">${a.colors.map(c => `<span style="background:${esc(c.hex)}" title="${esc(c.hex)} · ${esc(c.role)}"></span>`).join('')}
        <em>${esc(a.colorMood)}</em></div>
      <p class="ana-sum">${esc(a.summary)}</p>
      <div class="chips-t">${a.techniques.map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <dl class="ana-dl">${FIELDS.filter(([k]) => a[k] && v(a[k])).map(([k, l]) => `<dt>${l}</dt><dd>${esc(v(a[k]))}</dd>`).join('')}</dl>`;
  }

  function toggleJson() {
    const on = R.anaJson.hidden;
    R.anaJson.hidden = !on; R.ana.hidden = on;
  }

  /* ---------- Prompt ---------- */
  function rebuildPrompt() {
    if (!R) return;
    S.prompt = S.analysis ? AI().prompt.build({ analysis: S.analysis, wishes: R.wishes.value, format: CG.state.format }) : '';
    R.prompt.value = S.prompt;
    promptMeta();
  }
  function promptMeta() {
    const n = (S.prompt || '').length;
    R.promptMeta.textContent = n ? `${AI().prompt.VERSION} · ~${Math.round(n / 3.6)} Tokens${S.promptDirty ? ' · bearbeitet' : ''}` : '';
    R.send.disabled = !n;
  }

  /* ---------- Ablauf ---------- */
  let t0 = 0, timer = null;
  function logItem(text, cls = '') {
    const li = el(`<li class="${cls}"><span>${esc(text)}</span></li>`);
    R.log.appendChild(li); return li;
  }
  const setLi = (li, text, cls) => { li.querySelector('span').textContent = text; if (cls !== undefined) li.className = cls; };

  function startRun(title) {
    S.run = new AbortController();
    R.run.hidden = false; R.result.hidden = true; R.result.innerHTML = '';
    R.log.innerHTML = '';
    R.run.classList.add('busy'); R.run.classList.remove('failed', 'done');
    R.runTitle.textContent = title;
    R.go.disabled = R.send.disabled = true;
    t0 = performance.now();
    clearInterval(timer);
    timer = setInterval(() => meta(), 500);
    R.run.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return S.run.signal;
  }
  let metaExtra = '';
  const meta = (extra) => { if (extra !== undefined) metaExtra = extra; R.runMeta.textContent = `${Math.round((performance.now() - t0) / 1000)} s${metaExtra ? ' · ' + metaExtra : ''}`; };
  function endRun(state) {
    clearInterval(timer); meta();
    R.run.classList.remove('busy'); R.run.classList.add(state);
    R.go.disabled = false; promptMeta();
    S.run = null;
    refreshHealth();
  }

  async function runFlow({ analyze, generate }) {
    if (S.run) return;
    if (analyze && !S.image) { toast('Zuerst ein Referenzbild wählen'); R.drop.focus(); return; }
    if (!analyze && generate && !(R.prompt.value || '').trim()) { toast('Prompt ist leer'); return; }
    const ok = await refreshHealth();
    if (!S.health || !S.health.ok) { toast('Keine Verbindung zum KI-Server'); return; }
    if (!ok) { toast('Ein ausgewähltes Modell ist nicht verfügbar'); return; }

    const signal = startRun(analyze ? 'Bildanalyse' : 'Generator');
    S.last = { analyze, generate };
    try {
      if (analyze) {
        const li = logItem(`Analysiere „${S.imageName}“ mit ${AI().config.visionModel} …`, 'act');
        S.analysis = await AI().pipeline.analyze(S.image.base64, { signal, onTokens: n => meta(`${n} Tokens`) });
        setLi(li, `Analyse fertig: ${S.analysis.title}`, 'ok');
        renderAnalysis();
        if (!S.promptDirty) rebuildPrompt();
        logItem('Prompt erstellt (' + AI().prompt.VERSION + ')', 'ok');
        if (AI().config.visionModel !== AI().config.codeModel && AI().settings.api() === 'ollama') logItem(`${AI().config.visionModel} entladen`, 'ok');
      }
      if (!generate) {
        R.runTitle.textContent = 'Bereit';
        logItem('Prompt prüfen und „Senden“ wählen', 'note');
        endRun('done');
        R.prompt.focus();
        return;
      }
      R.runTitle.textContent = 'Generator';
      const promptText = R.prompt.value;
      let reqLi = null, stepLi = null;
      const res = await AI().pipeline.generate(promptText, {
        signal, aspect: CG.state.format.w / CG.state.format.h,
        onEvent: ev => {
          if (ev.type === 'models' && AI().settings.api() === 'ollama') logItem(`Speicher: nur ${AI().config.codeModel} bleibt geladen`, 'ok');
          if (ev.type === 'request') { reqLi = logItem(ev.attempt ? `Reparatur ${ev.attempt}/${ev.tries - 1} …` : `Code wird geschrieben (${AI().config.codeModel}) …`, 'act'); stepLi = null; meta(''); }
          if (ev.type === 'tokens') meta(`${ev.n} Tokens`);
          if (ev.type === 'validate') { setLi(reqLi, reqLi.textContent.replace(' …', ''), 'ok'); stepLi = logItem('Prüfung …', 'act'); }
          if (ev.type === 'step' && stepLi) setLi(stepLi, `Prüfung: ${ev.step} …`, 'act');
          if (ev.type === 'ok' && stepLi) setLi(stepLi, 'Prüfung bestanden', 'ok');
          if (ev.type === 'failed') {
            if (stepLi) setLi(stepLi, 'Prüfung fehlgeschlagen', 'bad'); else if (reqLi) setLi(reqLi, reqLi.textContent.replace(' …', ''), 'bad');
            const li = logItem('', 'errs');
            li.innerHTML = `<ul>${ev.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
          }
        },
      });
      if (AI().settings.api() === 'ollama') logItem(`${AI().config.codeModel} entladen`, 'ok');
      const name = (S.analysis && S.analysis.title) || 'KI-Generator';
      const fn = await AI().pipeline.save({ name, code: res.code, params: res.params, analysis: S.analysis || {}, prompt: promptText,
        repairs: res.repairs, thumb: res.thumb, aspect: CG.state.format.w / CG.state.format.h });
      logItem(`Gespeichert als „${fn.name}“ · ${res.params.length} Regler`, 'ok');
      R.runTitle.textContent = 'Fertig';
      endRun('done');
      showResult(fn, res);
      renderLibrary();
      CG.panel.build();
      // ohne Eingriff direkt in der Sandbox öffnen
      if (!R.review.checked) setTimeout(() => open(fn.id), 900);
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || (signal.aborted && e.code !== 'timeout'));
      R.runTitle.textContent = aborted ? 'Abgebrochen' : 'Fehler';
      if (!aborted) {
        const li = logItem(e.message || String(e), 'bad');
        if (e.errors && e.errors.length) { const l2 = logItem('', 'errs'); l2.innerHTML = `<ul>${e.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`; }
        if (e.code === 'model_missing') li.classList.add('big');
      } else logItem('Vom Nutzer abgebrochen – Modell wird entladen', 'note');
      endRun('failed');
      R.result.hidden = false;
      R.result.innerHTML = `<button class="btn primary" type="button" data-a="retry">${CG.icon('refresh')}<span>Nochmal versuchen</span></button>` +
        (e.lastCode ? `<button class="btn" type="button" data-a="last">${CG.icon('download')}<span>Letzten Code</span></button>` : '');
      R.result.querySelector('[data-a=retry]').onclick = () => runFlow(S.last);
      const lb = R.result.querySelector('[data-a=last]');
      if (lb) lb.onclick = () => CG.util.download(new Blob([e.lastCode], { type: 'text/javascript' }), 'generator-fehlerhaft.js');
    }
  }

  function showResult(fn, res) {
    R.result.hidden = false;
    R.result.innerHTML = `${res.thumb ? `<img src="${res.thumb}" alt="">` : ''}
      <div class="res-meta"><b>${esc(fn.name)}</b><small>${res.params.length} Regler · ${res.repairs ? res.repairs + ' Reparatur(en)' : 'ohne Reparatur'}</small>
      ${res.warnings.length ? `<small class="warn">${res.warnings.map(esc).join(' · ')}</small>` : ''}</div>
      <button class="btn primary" type="button" data-a="open">In Sandbox öffnen</button>`;
    R.result.querySelector('[data-a=open]').onclick = () => open(fn.id);
  }

  function open(fnId) {
    if (!CG.functions.some(f => f.id === fnId)) return;
    if (CG.state.fn === fnId) CG.panel.build(); else CG.switchFn(fnId);
    CG.showPage('sandbox');
  }

  /* ---------- Bibliothek der Generatoren ---------- */
  function renderLibrary() {
    if (!R) return;
    const list = AI().registry.list();
    R.grid.innerHTML = list.length ? '' : '<div class="ai-empty">Noch keine Generatoren</div>';
    for (const fn of list.slice().reverse()) {
      const g = fn.gen;
      const card = el(`<div class="gen">
          <button class="gen-open" type="button" title="In Sandbox öffnen">
            ${g.thumb ? `<img src="${esc(g.thumb)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
            <span class="meta"><b>${esc(g.name)}</b><small>${new Date(g.created).toLocaleDateString('de-DE')} · ${esc((g.models && g.models.code) || '')}</small></span>
          </button>
          <div class="gen-acts">
            <button class="act" type="button" data-a="tpl" title="Analyse und Prompt übernehmen">${CG.icon('reset')}</button>
            <button class="act" type="button" data-a="code" title="Code herunterladen (.js)">${CG.icon('download')}</button>
            <button class="act" type="button" data-a="file" title="Generator sichern (.json)">${CG.icon('copy')}</button>
            <button class="act danger" type="button" data-a="del" title="Löschen">${CG.icon('trash')}</button>
          </div></div>`);
      card.querySelector('.gen-open').onclick = () => open(fn.id);
      card.querySelector('[data-a=code]').onclick = () => fn.downloadCode();
      card.querySelector('[data-a=file]').onclick = () => CG.util.download(new Blob([AI().store.toFile(g)], { type: 'application/json' }), `${g.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.cg-generator.json`);
      card.querySelector('[data-a=tpl]').onclick = () => {
        S.analysis = AI().schema.cleanAnalysis(g.analysis); renderAnalysis();
        S.prompt = g.prompt || ''; R.prompt.value = S.prompt; S.promptDirty = true; promptMeta();
        H.tick(); toast('Analyse und Prompt übernommen');
      };
      card.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm(`„${g.name}“ endgültig löschen?`)) return;
        try { await AI().store.remove(g.id); AI().registry.unregister(g.id); renderLibrary(); toast('Gelöscht'); }
        catch (e) { toast(e.message); }
      };
      R.grid.appendChild(card);
    }
  }

  return { init, show, refreshHealth };
})();
