'use strict';
/* Export: PNG / JPG (gekachelt, Supersampling) und Video-Loop (WebCodecs → MP4) */
CG.exporter = (() => {
  const { $, store, toast, download, stamp, el } = CG.util;
  let mode = store.get('expMode', 'png');
  // Standard: Video in voller Format-Auflösung (z. B. UHD), Verkleinern nur auf Wunsch
  const vid = Object.assign({ loops: 1, fps: 30, res: 'full' }, store.get('video2', {}));
  let rec = null, busy = false;
  let optsEl = null, infoEl = null;   // direkte Referenzen (Panel ist beim Aufbau noch nicht im DOM)

  // SVG gibt es nur für KI-Generatoren (Canvas-Zeichenbefehle lassen sich als Vektoren aufzeichnen)
  const curMode = () => (mode === 'svg' && !CG.fn().ai) ? 'png' : mode;

  function buildPanel(body) {
    const fn = CG.fn();
    const modes = [{ v: 'png', label: 'PNG' }, { v: 'jpg', label: 'JPG' }, ...(fn.ai ? [{ v: 'svg', label: 'SVG' }] : []), { v: 'video', label: 'Video' }];
    const fmt = CG.controls.segment({ key: '_exp', options: modes },
      curMode(), v => { mode = v; store.set('expMode', v); updateInfo(); },
      { action: { icon: 'download', title: 'Exportieren', run } });
    body.appendChild(fmt.el);
    if (fn.downloadCode) {
      const b = el(`<button class="btn code-btn" type="button">${CG.icon('download')}<span>Generator-Code</span></button>`);
      b.onclick = () => fn.downloadCode();
      body.appendChild(b);
    }

    const opts = optsEl = el('<div class="sub-opts"></div>');
    const seg = (key, label, options) => {
      const c = CG.controls.segment({ key, label, options }, vid[key], v => { vid[key] = v; store.set('video2', vid); updateInfo(); });
      opts.appendChild(c.el);
    };
    seg('loops', 'Wiederholungen', [{ v: 1, label: '1×' }, { v: 2, label: '2×' }, { v: 3, label: '3×' }, { v: 5, label: '5×' }]);
    seg('fps', 'Bildrate', [{ v: 25, label: '25' }, { v: 30, label: '30' }, { v: 60, label: '60' }]);
    seg('res', 'Auflösung', [{ v: 'full', label: 'Format' }, { v: '1080', label: '1080p' }, { v: '720', label: '720p' }]);
    body.appendChild(opts);
    body.appendChild(infoEl = el('<div class="meta-line"></div>'));
    updateInfo();
  }

  function videoSize() {
    let { w, h } = CG.state.format;
    const cap = vid.res === '1080' ? 1080 : vid.res === '720' ? 720 : Infinity;
    const s = Math.min(1, cap / Math.min(w, h), (CG.R ? CG.R.maxDim : 4096) / Math.max(w, h), 8192 / Math.max(w, h));
    return { w: Math.round(w * s / 2) * 2, h: Math.round(h * s / 2) * 2 };
  }

  function updateInfo() {
    const mode = curMode();
    const o = optsEl; if (o) o.hidden = mode !== 'video';
    const i = infoEl;
    if (i) {
      if (mode === 'video') {
        const { w, h } = videoSize();
        i.textContent = `${w} × ${h} · ${(vid.loops * CG.state.params.loopLen).toFixed(1).replace('.', ',')} s`;
      } else i.textContent = `${CG.state.format.w} × ${CG.state.format.h}`;
    }
    const q = $('#quickLbl'); if (q) q.textContent = mode === 'video' ? 'Video' : mode.toUpperCase();
  }

  function run() {
    if (!CG.R || rec || busy) return;
    const m = curMode();
    if (m === 'svg') CG.fn().exportSvg();
    else if (m === 'video') exportVideo(); else exportImage(m);
  }

  async function exportImage(kind) {
    const fn = CG.fn(), { w: W, h: Hh } = CG.state.format;
    toast(`Rendere ${W} × ${Hh} …`);
    busy = true;
    try {
      await new Promise(r => setTimeout(r, 30));
      const out = await renderImage(fn, { ...CG.state.params }, CG.view.phase, W, Hh);
      if (!out) return;
      const b = await new Promise(r => out.toBlob(r, kind === 'jpg' ? 'image/jpeg' : 'image/png', 0.95));
      out.width = out.height = 0;                       // Speicher der Zeichenfläche sofort freigeben
      if (!b) return toast('Export fehlgeschlagen');
      download(b, `${fn.id}_${W}x${Hh}_${stamp()}.${kind === 'jpg' ? 'jpg' : 'png'}`);
      toast(`${kind.toUpperCase()} exportiert`);
    } finally {
      busy = false;
      CG.fitPreview(); CG.markDirty();
    }
  }

  /* Rendert in voller Auflösung mit Supersampling (SS×SS Abtastpunkte pro Pixel).
     Das Bild wird in Kacheln berechnet (beliebig groß, kein GPU-Timeout) und
     im linearen Farbraum exakt heruntergerechnet. */
  const SS = 2;
  const toLin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  const toSrgb = new Uint8Array(4096).map((_, i) => { const l = i / 4095; return Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055)); });

  async function renderImage(fn, params, phase, W, Hh) {
    // Funktionen mit eigenem Zeichenweg (KI-Generatoren) liefern ihr Bild zuerst in Zielauflösung
    if (fn.prepare) {
      try { await fn.prepare(params, phase, W, Hh); }
      catch (e) { toast('Export fehlgeschlagen: ' + e.message); return null; }
    }
    const gl = CG.R.gl;
    const out = document.createElement('canvas'); out.width = W; out.height = Hh;
    const ctx = out.getContext('2d');
    const VW = W * SS, VH = Hh * SS;
    const T = Math.min(1024, CG.R.maxDim) - (Math.min(1024, CG.R.maxDim) % SS);
    const n = SS * SS;
    let buf = null, img = null;                          // Puffer wiederverwenden statt pro Kachel neu anlegen
    for (let ty = 0; ty < VH; ty += T) {
      for (let tx = 0; tx < VW; tx += T) {
        const tw = Math.min(T, VW - tx), th = Math.min(T, VH - ty);
        CG.R.draw(fn, params, phase, tw, th, [VW, VH], [tx, VH - ty - th], SS);
        if (!buf || buf.length !== tw * th * 4) buf = new Uint8Array(tw * th * 4);
        gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const ow = tw / SS, oh = th / SS;
        if (!img || img.width !== ow || img.height !== oh) img = ctx.createImageData(ow, oh);
        const d = img.data;
        for (let y = 0; y < oh; y++) {
          for (let x = 0; x < ow; x++) {
            let r = 0, g = 0, b = 0;
            for (let sy = 0; sy < SS; sy++) {
              const row = (th - 1 - (y * SS + sy)) * tw;          // readPixels liefert von unten nach oben
              for (let sx = 0; sx < SS; sx++) {
                const i = (row + x * SS + sx) * 4;
                r += toLin[buf[i]]; g += toLin[buf[i + 1]]; b += toLin[buf[i + 2]];
              }
            }
            const o = (y * ow + x) * 4;
            d[o] = toSrgb[Math.round(r / n * 4095)];
            d[o + 1] = toSrgb[Math.round(g / n * 4095)];
            d[o + 2] = toSrgb[Math.round(b / n * 4095)];
            d[o + 3] = 255;
          }
        }
        ctx.putImageData(img, tx / SS, ty / SS);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return out;
  }

  /* ---------- Video: Bild für Bild offline rendern (WebCodecs) ----------
     - kein Echtzeit-Zwang: jedes Bild wird exakt berechnet, nichts geht verloren
     - begrenzte Warteschlange: konstanter Speicherbedarf, egal wie lang das Video ist
     - Chrome/Edge: Datei wird direkt auf die Festplatte geschrieben */
  const AVC_LEVELS = [   // [Codec-String, max. Makroblöcke/s, max. Makroblöcke/Bild]
    ['avc1.640028', 245760, 8192], ['avc1.64002a', 522240, 8704], ['avc1.640032', 589824, 22080],
    ['avc1.640033', 983040, 36864], ['avc1.640034', 2073600, 36864], ['avc1.64003c', 4177920, 139264],
  ];

  async function exportVideo() {
    if (!('VideoEncoder' in window)) return toast('Dieser Browser unterstützt keinen Video-Export');
    const fn = CG.fn(), params = { ...CG.state.params };
    let { w, h } = videoSize();
    const fps = vid.fps, loops = vid.loops, loopLen = +params.loopLen;

    // Passende Encoder-Konfiguration suchen; falls die Auflösung zu groß ist, automatisch verkleinern
    const findConfig = async (w, h) => {
      const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
      const bitrate = Math.round(Math.min(160e6, Math.max(8e6, w * h * fps * 0.2)));
      for (const [codec, maxRate, maxFrame] of AVC_LEVELS) {
        if (mbs > maxFrame || mbs * fps > maxRate) continue;
        const c = { codec, width: w, height: h, bitrate, framerate: fps, bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'avc' } };
        try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch (e) {}
      }
      return null;
    };
    const name0 = `${fn.id}_${w}x${h}_${loops}x${loopLen}s_${stamp()}.mp4`;

    // Speicherort zuerst wählen (muss direkt auf den Klick folgen)
    let sink;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name0, types: [{ description: 'MP4-Video', accept: { 'video/mp4': ['.mp4'] } }] });
        sink = await CG.Mp4Muxer.fileSink(handle);
      } catch (e) { if (e.name === 'AbortError') return; sink = null; }
    }
    if (!sink) sink = CG.Mp4Muxer.memorySink();

    let config = await findConfig(w, h);
    for (const cap of [2160, 1440, 1080, 720]) {
      if (config) break;
      const s = cap / Math.min(w, h);
      if (s >= 1) continue;
      const w2 = Math.round(w * s / 2) * 2, h2 = Math.round(h * s / 2) * 2;
      config = await findConfig(w2, h2);
      if (config) { w = w2; h = h2; toast(`Video wird mit ${w} × ${h} exportiert (Encoder-Grenze)`); }
    }
    if (!config) { await sink.abort(); return toast('Diese Auflösung wird vom Video-Encoder nicht unterstützt'); }
    const name = name0;

    const total = Math.round(loops * loopLen * fps);
    const mux = new CG.Mp4Muxer(sink, { width: w, height: h, fps });
    let writing = Promise.resolve(), failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => { writing = writing.then(() => mux.add(chunk, meta)).catch(e => { failure = e; }); },
      error: e => { failure = e; },
    });
    encoder.configure(config);
    await mux.start();

    rec = { cancelled: false };
    $('#recOverlay').classList.add('on');
    const t0 = performance.now();
    try {
      for (let i = 0; i < total; i++) {
        if (rec.cancelled || failure) break;
        const phase = ((i / fps) / loopLen) % 1;
        if (fn.prepare) await fn.prepare(params, phase, w, h);
        CG.R.draw(fn, params, phase, w, h);
        const frame = new VideoFrame(CG.R.cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        // Gegendruck: nie mehr als ein paar Bilder gleichzeitig im Speicher
        while (encoder.encodeQueueSize > 2) await new Promise(r => setTimeout(r, 1));
        if (i % 3 === 0) {
          await writing;
          const pct = (i + 1) / total;
          $('#recBar').style.width = (pct * 100).toFixed(1) + '%';
          const el = (performance.now() - t0) / 1000, eta = el / pct - el;
          $('#recTime').textContent = `${Math.round(pct * 100)} % · noch ${Math.max(0, Math.round(eta))} s`;
          await new Promise(r => setTimeout(r, 0));
        }
      }
      if (!rec.cancelled && !failure) await encoder.flush();
      await writing;
      if (failure) throw failure;
      if (rec.cancelled) { await sink.abort(); toast('Export abgebrochen'); }
      else {
        const blob = await mux.finish();
        if (blob) download(blob, name);
        toast('Video exportiert');
      }
    } catch (e) {
      console.error(e); await sink.abort();
      toast('Video-Export fehlgeschlagen: ' + (e.message || e));
    } finally {
      if (encoder.state !== 'closed') encoder.close();
      rec = null;
      $('#recOverlay').classList.remove('on');
      CG.fitPreview(); CG.markDirty();
    }
  }

  /* Während eines Exports zeichnet die Vorschau nicht in die gemeinsame Zeichenfläche. */
  function frame() { return !!rec || busy; }

  function cancel() { if (rec) rec.cancelled = true; }

  return { buildPanel, run, frame, cancel, updateInfo, renderImage, get recording() { return !!rec; } };
})();
