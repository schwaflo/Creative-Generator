'use strict';
/* Minimaler MP4-Muxer (ISO-BMFF) für einen H.264-Videotrack aus WebCodecs.
   Die Videodaten werden fortlaufend geschrieben (mdat), das Inhaltsverzeichnis
   (moov) am Ende. So muss nie das ganze Video im Arbeitsspeicher liegen. */
(() => {
  const te = new TextEncoder();
  const str = s => te.encode(s);
  const u8 = v => new Uint8Array([v & 255]);
  const u16 = v => new Uint8Array([v >> 8 & 255, v & 255]);
  const u32 = v => new Uint8Array([v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255]);
  const u64 = v => cat(u32(Math.floor(v / 4294967296)), u32(v >>> 0));
  const zeros = n => new Uint8Array(n);

  function cat(...parts) {
    const flat = parts.flat();
    let n = 0; for (const p of flat) n += p.length;
    const out = new Uint8Array(n);
    let o = 0; for (const p of flat) { out.set(p, o); o += p.length; }
    return out;
  }
  const box = (type, ...c) => { const body = cat(...c); return cat(u32(body.length + 8), str(type), body); };
  const fbox = (type, ver, flags, ...c) => box(type, u8(ver), u8(flags >> 16), u8(flags >> 8), u8(flags), ...c);
  const MATRIX = cat(u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000));

  // Tabelle mit festen Feldbreiten effizient (ohne riesige Argumentlisten) bauen
  function table(n, bytes, get) {
    const out = new Uint8Array(n * bytes), dv = new DataView(out.buffer);
    for (let i = 0; i < n; i++) {
      const v = get(i);
      if (bytes === 4) dv.setUint32(i * 4, v >>> 0);
      else { dv.setUint32(i * 8, Math.floor(v / 4294967296)); dv.setUint32(i * 8 + 4, v >>> 0); }
    }
    return out;
  }

  CG.Mp4Muxer = class {
    /* sink: { write(u8), patch(pos, u8), close() -> Blob|null, abort() } */
    constructor(sink, { width, height, fps }) {
      this.sink = sink; this.w = width; this.h = height; this.fps = fps;
      this.sizes = []; this.offsets = []; this.keys = []; this.pts = [];
      this.avcC = null; this.pos = 0;
    }

    async start() {
      const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
      await this.sink.write(ftyp);
      this.mdatStart = ftyp.length;
      await this.sink.write(cat(u32(1), str('mdat'), u64(0)));     // 64-bit-Größe, wird am Ende gesetzt
      this.pos = ftyp.length + 16;
    }

    async add(chunk, meta) {
      const desc = meta && meta.decoderConfig && meta.decoderConfig.description;
      if (desc && !this.avcC) {
        this.avcC = ArrayBuffer.isView(desc)
          ? new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength))
          : new Uint8Array(desc.slice(0));
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const i = this.sizes.length;
      this.sizes.push(data.length); this.offsets.push(this.pos); this.pts.push(chunk.timestamp);
      if (chunk.type === 'key') this.keys.push(i + 1);
      this.pos += data.length;
      await this.sink.write(data);
    }

    async finish() {
      if (!this.avcC) throw new Error('Encoder lieferte keine H.264-Konfiguration');
      await this.sink.write(this.moov());
      await this.sink.patch(this.mdatStart + 8, u64(this.pos - this.mdatStart));
      return this.sink.close();
    }

    moov() {
      const N = this.sizes.length, w = this.w, h = this.h;
      const TS = 90000, dur = Math.round(TS / this.fps);
      const durMs = Math.round(N * 1000 / this.fps);

      // Kompositionsversatz nur falls der Encoder Bilder umsortiert (B-Frames)
      const offs = this.pts.map((p, i) => Math.round(p * TS / 1e6) - i * dur);
      let ctts = null;
      if (offs.some(o => o !== 0)) {
        const runs = [];
        for (const o of offs) { const r = runs[runs.length - 1]; if (r && r[1] === o) r[0]++; else runs.push([1, o]); }
        ctts = fbox('ctts', 1, 0, u32(runs.length), table(runs.length * 2, 4, i => runs[i >> 1][i & 1]));
      }

      const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(w), u16(h), u32(0x00480000), u32(0x00480000),
        u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), box('avcC', this.avcC));
      const stbl = box('stbl',
        fbox('stsd', 0, 0, u32(1), avc1),
        fbox('stts', 0, 0, u32(1), u32(N), u32(dur)),
        fbox('stss', 0, 0, u32(this.keys.length), table(this.keys.length, 4, i => this.keys[i])),
        ctts ? ctts : [],
        fbox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
        fbox('stsz', 0, 0, u32(0), u32(N), table(N, 4, i => this.sizes[i])),
        fbox('co64', 0, 0, u32(N), table(N, 8, i => this.offsets[i])));
      const minf = box('minf',
        fbox('vmhd', 0, 1, zeros(8)),
        box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1))),
        stbl);
      const mdia = box('mdia',
        fbox('mdhd', 0, 0, u32(0), u32(0), u32(TS), u32(N * dur), u16(0x55c4), u16(0)),
        fbox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler'), u8(0)),
        minf);
      const trak = box('trak',
        fbox('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), zeros(8), u16(0), u16(0), u16(0), u16(0),
          MATRIX, u32(w * 65536), u32(h * 65536)),
        mdia);
      return box('moov',
        fbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x00010000), u16(0x0100), zeros(10),
          MATRIX, zeros(24), u32(2)),
        trak);
    }
  };

  /* Ziel: Datei auf der Festplatte (File System Access API, z. B. Chrome/Edge).
     Der Browser schreibt in eine Temp-Datei – der RAM bleibt konstant. */
  CG.Mp4Muxer.fileSink = async handle => {
    const ws = await handle.createWritable();
    let pos = 0;
    return {
      async write(d) { await ws.write({ type: 'write', position: pos, data: d }); pos += d.length; },
      async patch(p, d) { await ws.write({ type: 'write', position: p, data: d }); },
      async close() { await ws.close(); return null; },
      async abort() { try { await ws.abort(); } catch (e) {} },
    };
  };

  /* Ziel: Speicher (Browser ohne Dateizugriff). Daten werden regelmäßig zu Blobs
     zusammengefasst, die der Browser bei Bedarf auf die Festplatte auslagern kann. */
  CG.Mp4Muxer.memorySink = () => {
    const head = [], blobs = [];
    let batch = [], batchSize = 0;
    return {
      async write(d) {
        if (head.length < 2) { head.push(d); return; }          // ftyp + mdat-Kopf bleiben veränderbar
        batch.push(d); batchSize += d.length;
        if (batchSize > 32 * 1024 * 1024) { blobs.push(new Blob(batch)); batch = []; batchSize = 0; }
      },
      async patch(p, d) {
        let o = 0;
        for (const part of head) { if (p < o + part.length) { part.set(d, p - o); return; } o += part.length; }
      },
      async close() { const b = new Blob([...head, ...blobs, ...batch], { type: 'video/mp4' }); batch = []; blobs.length = 0; return b; },
      async abort() { batch = []; blobs.length = 0; },
    };
  };
})();
