'use strict';
/* Seite „KI“: Der Generator ist das Interface – das Modell baut die Funktion (Regler + Shader).
   Aufgabe aus Bild (Modell sieht es selbst), aus der Beschreibung eines zweiten Modells oder nur aus Text.
   Gespeicherte Generatoren lassen sich per Prompt ändern („Verbessern“).
   Der Browser spricht direkt mit dem KI-Server (Ollama oder OpenAI-kompatibel) – kein Server dazwischen. */
CG.aiPage = (() => {
  const { el, esc, toast, store } = CG.util;
  const H = CG.haptics;
  const AI = () => CG.ai;
  let R = null;                                  // DOM-Referenzen
  const S = { image: null, imageName: '', prompt: '', promptDirty: false, run: null, health: null, edit: null };   // edit: Generator, der per Prompt geändert wird

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
          <label class="m-pick" title="Dieses Modell baut die Funktion"><span>Modell</span><select data-m="model"></select></label>
          <label class="m-pick" data-w="describe" title="Beschreibt das Referenzbild, wenn das Modell links keine Bilder lesen kann" hidden><span>Bild lesen</span><select data-m="describe"></select></label>
        </div>
        <div class="ai-hint" hidden></div>
      </div>
      <div class="ai-steps">
        <section class="ai-card">
          <header><span class="num">1</span><h3 class="card-title">Auftrag</h3>
            <button class="act" type="button" data-a="editoff" title="Verbessern beenden" hidden>${CG.icon('x')}</button></header>
          <div class="drop" tabindex="0" role="button" aria-label="Referenzbild wählen (optional)">
            <img alt="" hidden>
            <div class="drop-empty">${CG.icon('upload')}<span>Bild ablegen oder wählen (optional)</span></div>
            <button class="act drop-x" type="button" data-a="noimage" title="Bild entfernen" hidden>${CG.icon('x')}</button>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          </div>
          <div class="ai-mode"></div>
          <textarea class="ai-text ai-wishes" rows="3" spellcheck="false"></textarea>
          <div class="ai-row">
            <label class="ai-check"><input type="checkbox" data-a="review"><span>Prompt erst prüfen</span></label>
            <button class="btn primary" type="button" data-a="go">Generator erzeugen</button>
          </div>
        </section>
        <section class="ai-card">
          <header><span class="num">2</span><h3>Prompt</h3>
            <button class="act" type="button" data-a="rebuild" title="Zurücksetzen">${CG.icon('reset')}</button></header>
          <textarea class="ai-text ai-prompt" spellcheck="false" placeholder="Entsteht, sobald ein Bild gewählt ist"></textarea>
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
      mSel: q('[data-m=model]'), dSel: q('[data-m=describe]'), dWrap: q('[data-w=describe]'), mode: q('.ai-mode'),
      title: q('.card-title'), editOff: q('[data-a=editoff]'), noImage: q('[data-a=noimage]'),
      drop: q('.drop'), img: q('.drop img'), file: q('.drop input'), wishes: q('.ai-wishes'), review: q('[data-a=review]'),
      go: q('[data-a=go]'), send: q('[data-a=send]'), prompt: q('.ai-prompt'),
      promptMeta: q('.prompt-meta'), run: q('.ai-run'), runTitle: q('.run-title'), runMeta: q('.run-meta'), bar: q('.run-bar i'),
      log: q('.run-log'), result: q('.run-result'), cancel: q('[data-a=cancel]'), grid: q('.gen-grid'),
      server: q('[data-c=server]'), url: q('[data-c=url]'), key: q('[data-c=key]') };

    R.wishes.value = store.get('ai.wishes', '');
    R.noImage.onclick = e => { e.stopPropagation(); clearImage(); };
    R.editOff.onclick = () => setEdit(null);
    R.review.checked = store.get('ai.review', false);
    R.wishes.addEventListener('input', () => { if (!S.edit) store.set('ai.wishes', R.wishes.value); if (!S.promptDirty) rebuildPrompt(); });
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
    R.go.onclick = () => runFlow(!R.review.checked);
    R.send.onclick = () => runFlow(true);
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
    R.mSel.addEventListener('change', () => { st.set({ model: R.mSel.value }); H.tick(); S.promptDirty = false; refreshHealth(); });
    R.dSel.addEventListener('change', () => { st.set({ describeModel: R.dSel.value }); H.tick(); S.promptDirty = false; updateMode(); });
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
    const vis = h.models.find(m => m.name === cfg.model);
    if (h.missing.length) {
      const cmds = h.missing.map(m => m.cmd).filter(Boolean);
      hint(cmds.length ? 'Fehlende Modelle installieren:' : `Modell nicht auf dem Server: ${h.missing.map(m => '„' + esc(m.model) + '“').join(', ')}. Bitte oben ein vorhandenes Modell wählen oder es im Server laden.`, cmds);
    } else if (srv.api === 'openai' && /:11434$/.test(url)) {
      hint('Das ist Ollama. Mit dem Server-Typ „Ollama“ stehen Kontextgröße (num_ctx) und das automatische Entladen der Modelle zur Verfügung – über die OpenAI-Schnittstelle nutzt Ollama nur 4096 Token Kontext.');
    } else hint(null);
    updateMode();
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
      hint(`Keine Verbindung zu <code>${esc(url)}</code>. Läuft Ollama (App starten oder <code>ollama serve</code>)?` +
        (local ? '' : ` Diese Seitenadresse muss freigegeben sein – danach Ollama neu starten:`) +
        ' Test: bei <code>200 OK</code> passt alles, bei <code>403</code> fehlt die Freigabe.',
        [...(local ? [] : [`launchctl setenv OLLAMA_ORIGINS "${origin}"`, `OLLAMA_ORIGINS="${origin}" ollama serve`]), test]);
      if (!local) R.hint.insertAdjacentHTML('beforeend', '<span class="sub">Erster Befehl: dauerhaft für die Ollama-App (danach die App beenden und neu öffnen). Zweiter: wenn du Ollama im Terminal startest. Chrome fragt einmal nach dem Zugriff auf das lokale Netzwerk – „Zulassen“.</span>');
      return;
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
    R.mSel.innerHTML = opts(cfg.model); R.mSel.value = cfg.model || '';
    // zweites Modell nur zum Lesen des Bildes: Modelle mit Bildverständnis (bei unbekannten Fähigkeiten alle)
    const knownCaps = h.models.some(m => Array.isArray(m.capabilities));
    const readers = h.models.filter(m => m.name !== cfg.model && (!knownCaps || (Array.isArray(m.capabilities) && m.capabilities.includes('vision')))).map(m => m.name);
    if (cfg.describeModel && !readers.includes(cfg.describeModel) && cfg.describeModel !== cfg.model) readers.unshift(cfg.describeModel);
    R.dSel.innerHTML = '<option value="">– aus –</option>' + readers.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    R.dSel.value = readers.includes(cfg.describeModel) ? cfg.describeModel : '';
  }

  /* Welcher Weg gilt gerade? Zeigt es in der Auftragskarte und passt Platzhalter, Knopf und Prompt an. */
  function updateMode() {
    if (!R) return;
    const pl = AI().pipeline.plan(!!S.image), m = esc(pl.model || 'Modell');
    R.dWrap.hidden = pl.vision && !AI().config.describeModel;         // nur nötig, wenn das Modell keine Bilder liest
    R.root.classList.toggle('editing', !!S.edit);
    R.title.textContent = S.edit ? `Verbessern: ${S.edit.name}` : 'Auftrag';
    R.editOff.hidden = !S.edit;
    R.go.textContent = S.edit ? 'Verbessern' : 'Generator erzeugen';
    R.noImage.hidden = !S.image;
    let msg;
    if (S.edit) msg = pl.vision ? `${m} bekommt die aktuelle Funktion und ein Bild des Ergebnisses.` : `${m} bekommt die aktuelle Funktion (Regler und Code).`;
    else if (pl.source === 'image') msg = `${m} liest das Bild selbst.`;
    else if (pl.source === 'description') msg = `${m} kann keine Bilder lesen – ${esc(pl.describer)} beschreibt das Bild.`;
    else if (pl.imageUnused) msg = `${m} kann keine Bilder lesen. Wähle oben bei „Bild lesen“ ein Modell – sonst zählt nur dein Text.`;
    else msg = 'Ohne Bild: Die Funktion entsteht nur aus deinem Text.';
    R.mode.innerHTML = msg; R.mode.classList.toggle('warn', !S.edit && pl.imageUnused);
    R.wishes.placeholder = S.edit ? 'Was soll sich ändern? Z. B. dünnere Linien, ein Dropdown für drei Farbstimmungen, langsamere Bewegung'
      : pl.source === 'text' ? 'Was soll die Funktion zeigen? Z. B. fließende Tintenwolken in Blau und Gold mit Regler für Dichte und Tempo'
      : 'Wünsche zum Bild, z. B. sanfte Bewegung, Farben einstellbar';
    if (!S.promptDirty) rebuildPrompt();
  }

  /* Verbessern: bestehenden Generator wählen (null = zurück zum normalen Auftrag) */
  function setEdit(gen) {
    if (S.run) return;
    S.edit = gen || null; S.promptDirty = false;
    R.wishes.value = S.edit ? '' : store.get('ai.wishes', '');
    updateMode();
    if (S.edit) { R.wishes.focus(); R.root.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  function edit(genId) {
    init();
    const fn = AI().registry.list().find(f => f.gen.id === genId);
    if (!fn) return;
    if (fn.gen.kind !== 'shader') return toast('Dieser ältere Generator lässt sich nicht per Prompt ändern');
    CG.showPage('ai'); setEdit(fn.gen);
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
      S.promptDirty = false; updateMode();
      H.tick();
    } catch (e) { toast('Bild konnte nicht gelesen werden'); }
  }
  function clearImage() {
    S.image = null; S.imageName = ''; R.img.hidden = true; R.img.removeAttribute('src'); R.drop.classList.remove('has');
    S.promptDirty = false; updateMode();
  }


  /* ---------- Prompt ---------- */
  function rebuildPrompt() {
    if (!R) return;
    const P = AI().prompt, w = R.wishes.value;
    if (S.edit) S.prompt = w.trim() ? P.improveText({ gen: S.edit, request: w }) : '';
    else { const src = AI().pipeline.plan(!!S.image).source; S.prompt = src === 'text' && !w.trim() ? '' : P.text({ wishes: w, format: CG.state.format, source: src }); }
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

  // Protokoll: Ereignisse aus dem Ablauf anzeigen
  function logger(model) {
    let askLi = null, stepLi = null, auxLi = null, fixLi = null, fails = [], corrected = [];
    const setFix = (text, cls) => {
      fixLi.className = cls;
      fixLi.innerHTML = `<details class="notes"><summary>${esc(text)}</summary><div>${fails.map((f, i) => `<b>Versuch ${i + 1}</b><br>${f.map(esc).join('<br>')}`).join('<br><br>')}</div></details>`;
    };
    return ev => {
      if (ev.type === 'describe') { auxLi = logItem(`${ev.model} beschreibt das Bild …`, 'act'); meta(''); }
      if (ev.type === 'described') { setLi(auxLi, `${ev.model} hat das Bild beschrieben`, 'ok');
        const li = logItem('', 'note'); li.innerHTML = `<details class="notes"><summary>Bildbeschreibung</summary><div>${esc(ev.text)}</div></details>`; }
      if (ev.type === 'critique') { auxLi = logItem(`${ev.model} vergleicht Ergebnis und Referenz …`, 'act'); meta(''); }
      if (ev.type === 'critiqued') { setLi(auxLi, `${ev.model} hat verglichen`, 'ok');
        if (ev.text) { const li = logItem('', 'note'); li.innerHTML = `<details class="notes"><summary>Vergleich</summary><div>${esc(ev.text)}</div></details>`; } }
      if (ev.type === 'ask') {
        if (ev.fixing) { askLi = fixLi || logItem('Modell bessert nach …', 'act'); }
        else askLi = logItem(ev.improve ? `${model} ändert die Funktion …` : ev.round ? `Runde ${ev.round + 1}/${ev.rounds}: ${model} verbessert nach dem Vergleich …` : `${model} baut die Funktion …`, 'act');
        stepLi = null; meta('');
      }
      if (ev.type === 'tokens') meta(`${ev.n} Tokens`);
      if (ev.type === 'notes') {
        if (askLi !== fixLi) {
          setLi(askLi, askLi.textContent.replace(' …', ''), 'ok');
          if (ev.notes) {
            const li = logItem('', 'note');
            li.innerHTML = `<details class="notes"><summary>Notizen des Modells${ev.title ? ' · ' + esc(ev.title) : ''}</summary><div>${esc(ev.notes)}</div></details>`;
          }
        }
        if (ev.fixes && ev.fixes.length) corrected = ev.fixes;
        if (!fixLi) stepLi = logItem('Prüfung …', 'act');
      }
      if (ev.type === 'step' && stepLi) setLi(stepLi, `Prüfung: ${ev.step} …`, 'act');
      if (ev.type === 'ok') {
        if (ev.fixes && ev.fixes.length) corrected = [...corrected, ...ev.fixes];
        const line = 'Prüfung bestanden' + (fixLi ? ` nach ${fails.length} Nachbesserung${fails.length === 1 ? '' : 'en'}` : '');
        if (fixLi) { setFix(line, 'ok'); fixLi = null; fails = []; } else if (stepLi) setLi(stepLi, line, 'ok');
        const notes = [...(corrected.length ? ['von der App korrigiert: ' + corrected.join(', ')] : []), ...ev.warnings];
        if (notes.length) { const li = logItem('', 'note'); li.innerHTML = `<details class="notes"><summary>${notes.length} Hinweis${notes.length === 1 ? '' : 'e'}</summary><div>${notes.map(esc).join('<br>')}</div></details>`; }
        corrected = [];
      }
      if (ev.type === 'look') logItem('Ergebnis dem Modell neben der Referenz gezeigt', 'ok');
      // Fehler: eine einzige Zeile, die mitzählt – die Fehlertexte stehen aufklappbar dahinter
      if (ev.type === 'failed') {
        fails.push(ev.errors);
        if (!fixLi) { fixLi = stepLi || logItem('', 'act'); stepLi = null; }
        setFix(ev.last && ev.round ? 'Die Überarbeitung läuft nicht – die vorige Fassung bleibt' : ev.last ? `Die Funktion läuft nicht – nach ${fails.length - 1} Nachbesserung${fails.length === 2 ? '' : 'en'} aufgegeben` : `Die Funktion läuft noch nicht – Modell bessert nach (${ev.attempt}/${ev.max})`, ev.last && ev.round ? 'note' : ev.last ? 'bad' : 'act');
      }
      if (ev.type === 'stuck') setFix(ev.kept ? 'Modell hängt am selben Fehler – die letzte funktionierende Fassung bleibt' : 'Modell hängt am selben Fehler – neuer Anlauf', ev.kept ? 'note' : 'act');
    };
  }

  async function runFlow(generate) {
    if (S.run) return;
    const P = AI().prompt, aspect = CG.state.format.w / CG.state.format.h;
    if (!(R.prompt.value || '').trim()) { toast(S.edit ? 'Bitte schreiben, was sich ändern soll' : S.image ? 'Prompt ist leer' : 'Bitte ein Bild wählen oder schreiben, was entstehen soll'); R.wishes.focus(); return; }
    const pl = AI().pipeline.plan(!!S.image);
    const needsDescription = !S.edit && pl.source === 'description' && R.prompt.value.includes(P.SLOT);
    if (!generate && !needsDescription) { R.prompt.focus(); toast('Prompt prüfen und „Senden“ wählen'); return; }
    const ok = await refreshHealth();
    if (!S.health || !S.health.ok) { toast('Keine Verbindung zum KI-Server'); return; }
    if (!ok) { toast('Das gewählte Modell ist nicht verfügbar'); return; }

    const signal = startRun(S.edit ? 'Verbessern' : 'Generator');
    const model = AI().config.model, log = logger(model);
    try {
      // „Prompt erst prüfen“ mit zweitem Modell: erst beschreiben lassen, Beschreibung in den Prompt setzen, dann anhalten
      if (!generate) {
        const text = await AI().pipeline.describe(S.image.base64, { signal, onEvent: log });
        R.prompt.value = S.prompt = R.prompt.value.split(P.SLOT).join(text); S.promptDirty = true;
        R.runTitle.textContent = 'Beschreibung fertig'; endRun('done');
        R.prompt.focus(); toast('Beschreibung steht im Prompt – prüfen und „Senden“ wählen');
        return;
      }
      const promptText = R.prompt.value;
      if (S.edit) {
        const gen = S.edit, request = R.wishes.value;
        // der Prompt enthält die aktuelle Funktion; wurde er von Hand bearbeitet, gilt die bearbeitete Fassung
        const res = await AI().pipeline.improve(gen, request, { signal, aspect, onEvent: log, promptText: S.promptDirty ? promptText : null });
        if (AI().settings.api() === 'ollama') logItem(`${model} entladen`, 'ok');
        const fn = await AI().pipeline.applyImprove(gen, res, request);
        logItem(`„${fn.name}“ geändert · ${res.params.length} Regler`, 'ok');
        R.runTitle.textContent = 'Fertig'; endRun('done');
        S.edit = fn.gen; R.wishes.value = ''; S.promptDirty = false; updateMode();
        refreshActive(fn);
        showResult(fn, res, true); renderLibrary(); CG.panel.build(); CG.markDirty();
        return;
      }
      const res = await AI().pipeline.generate(promptText, { signal, aspect, reference: S.image ? S.image.base64 : null, onEvent: log });
      if (AI().settings.api() === 'ollama') logItem(`${model} entladen`, 'ok');
      const fn = await AI().pipeline.save({ name: res.title || 'KI-Funktion', code: res.code, params: res.params, prompt: res.prompt,
        repairs: res.repairs, thumb: res.thumb, aspect, source: res.source });
      logItem(`Gespeichert als „${fn.name}“ · ${res.params.length} Regler`, 'ok');
      R.runTitle.textContent = 'Fertig';
      endRun('done');
      showResult(fn, res);
      renderLibrary();
      CG.panel.build();
      if (!R.review.checked) setTimeout(() => open(fn.id), 900);            // ohne Eingriff direkt in der Sandbox öffnen
    } catch (e) {
      const aborted = e && (e.name === 'AbortError' || (signal.aborted && e.code !== 'timeout'));
      R.runTitle.textContent = aborted ? 'Abgebrochen' : 'Fehler';
      if (!aborted) {
        logItem(e.message || String(e), 'bad');
      } else logItem('Vom Nutzer abgebrochen – Modell wird entladen', 'note');
      endRun('failed');
      R.result.hidden = false;
      R.result.innerHTML = `<button class="btn primary" type="button" data-a="retry">${CG.icon('refresh')}<span>Nochmal versuchen</span></button>`;
      R.result.querySelector('[data-a=retry]').onclick = () => runFlow(true);
    }
  }

  function showResult(fn, res, improved) {
    R.result.hidden = false;
    const canUndo = improved && (fn.gen.history || []).length;
    R.result.innerHTML = `${res.thumb ? `<img src="${res.thumb}" alt="">` : ''}
      <div class="res-meta"><b>${esc(fn.name)}</b><small>${res.params.length} Regler · ${res.repairs ? res.repairs + ' Reparatur(en)' : 'ohne Reparatur'}</small>
      ${res.warnings.length ? `<small class="warn">${res.warnings.map(esc).join(' · ')}</small>` : ''}</div>
      ${canUndo ? `<button class="btn" type="button" data-a="undo">${CG.icon('undo')}<span>Rückgängig</span></button>` : ''}
      <button class="btn primary" type="button" data-a="open">In Sandbox öffnen</button>`;
    R.result.querySelector('[data-a=open]').onclick = () => open(fn.id);
    const u = R.result.querySelector('[data-a=undo]');
    if (u) u.onclick = () => undo(fn.gen);
  }

  // läuft der geänderte Generator gerade in der Sandbox: neu übersetzen und Regler neu aufbauen
  function refreshActive(fn) { if (CG.state.fn === fn.id && CG.loadState) CG.loadState(fn.id, {}); }

  // letzte Änderung per Prompt zurücknehmen
  async function undo(gen) {
    try {
      const fn = await AI().pipeline.undoImprove(gen);
      if (!fn) return toast('Keine frühere Fassung');
      if (S.edit && S.edit.id === gen.id) { S.edit = fn.gen; S.promptDirty = false; updateMode(); }
      refreshActive(fn);
      R.result.hidden = true; renderLibrary(); CG.panel.build(); CG.markDirty(); toast('Vorige Fassung wiederhergestellt');
    } catch (e) { toast(e.message); }
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
            <span class="meta"><b>${esc(g.name)}</b><small>${new Date(g.created).toLocaleDateString('de-DE')} · ${esc((g.models && (g.models.model || g.models.code)) || '')}${g.kind === 'shader' ? ' · Shader' : ''}</small></span>
          </button>
          <div class="gen-acts">
            ${g.kind === 'shader' ? `<button class="act" type="button" data-a="edit" title="Per Prompt verbessern">${CG.icon('spark')}</button>` : ''}
            ${(g.history || []).length ? `<button class="act" type="button" data-a="undo" title="Letzte Änderung zurücknehmen">${CG.icon('undo')}</button>` : ''}
            <button class="act" type="button" data-a="tpl" title="Prompt übernehmen">${CG.icon('reset')}</button>
            <button class="act" type="button" data-a="code" title="Code herunterladen">${CG.icon('download')}</button>
            <button class="act" type="button" data-a="file" title="Generator sichern (.json)">${CG.icon('copy')}</button>
            <button class="act danger" type="button" data-a="del" title="Löschen">${CG.icon('trash')}</button>
          </div></div>`);
      card.querySelector('.gen-open').onclick = () => open(fn.id);
      card.querySelector('[data-a=code]').onclick = () => fn.downloadCode();
      const eb = card.querySelector('[data-a=edit]'); if (eb) eb.onclick = () => { H.tick(); setEdit(g); };
      const ub = card.querySelector('[data-a=undo]'); if (ub) ub.onclick = () => undo(g);
      card.querySelector('[data-a=file]').onclick = () => CG.util.download(new Blob([AI().store.toFile(g)], { type: 'application/json' }), `${g.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.cg-generator.json`);
      card.querySelector('[data-a=tpl]').onclick = () => {
        if (S.edit) setEdit(null);
        S.prompt = g.prompt || ''; R.prompt.value = S.prompt; S.promptDirty = true; promptMeta();
        H.tick(); toast('Prompt übernommen');
      };
      card.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm(`„${g.name}“ endgültig löschen?`)) return;
        try { await AI().store.remove(g.id); AI().registry.unregister(g.id); if (S.edit && S.edit.id === g.id) setEdit(null); renderLibrary(); toast('Gelöscht'); }
        catch (e) { toast(e.message); }
      };
      R.grid.appendChild(card);
    }
  }

  return { init, show, refreshHealth, edit };
})();
