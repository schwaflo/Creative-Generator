'use strict';
/* Strich-Werkzeuge für „Pencil“:
   - Text -> Mittellinien (Skelett der Schrift), damit Text wie geschrieben entsteht
   - Standard-Zeichnung
   Ergebnis: [{ i: Farbindex, p: [x, y, druck, x, y, druck, …] }] in Einheiten der Schriftgröße bzw. des Formats */
CG.strokes = (() => {
  const FONTS = [
    { label: 'Schreibschrift', font: s => `600 ${s}px "Dancing Script"` },
    { label: 'Handschrift',    font: s => `600 ${s}px Caveat` },
    { label: 'Grotesk',        font: s => `500 ${s}px Inter` },
  ];
  const cache = new Map(), pending = new Set();

  /* Text-Striche aus dem Cache – oder im Hintergrund erzeugen (dann null) */
  function text(str, fi) {
    const key = fi + '|' + str;
    if (cache.has(key)) return cache.get(key);
    if (!pending.has(key)) {
      pending.add(key);
      fromText(str, fi).then(r => {
        if (cache.size > 24) cache.delete(cache.keys().next().value);
        cache.set(key, r); pending.delete(key); CG.markDirty();
      }).catch(e => { console.error(e); pending.delete(key); cache.set(key, []); });
    }
    return null;
  }

  async function fromText(str, fi) {
    const F = FONTS[fi] || FONTS[0];
    const lines = String(str || '').replace(/\r/g, '').split('\n');
    if (!lines.some(l => l.trim())) return [];
    let S = 150;
    try { await document.fonts.load(F.font(S), str); } catch (e) { /* Systemschrift */ }
    const c = document.createElement('canvas');
    let g = c.getContext('2d', { willReadFrequently: true });
    const LH = 1.3;
    const measure = () => { g.font = F.font(S); return Math.max(1, ...lines.map(l => g.measureText(l).width)); };
    let mw = measure();
    let W = mw + S * 0.8, H = lines.length * S * LH + S * 0.8;
    const k = Math.min(1, Math.sqrt(2.2e6 / (W * H)));
    if (k < 1) { S = Math.max(40, Math.floor(S * k)); mw = measure(); W = mw + S * 0.8; H = lines.length * S * LH + S * 0.8; }
    W = Math.ceil(W); H = Math.ceil(H);
    c.width = W; c.height = H;
    g = c.getContext('2d', { willReadFrequently: true });
    g.font = F.font(S); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
    lines.forEach((l, i) => g.fillText(l, W / 2, S * 0.4 + S * LH * (i + 0.5)));
    const d = g.getImageData(0, 0, W, H).data;
    c.width = c.height = 0;
    const b = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) b[i] = d[i * 4 + 3] > 110 ? 1 : 0;
    // Rand frei halten
    for (let x = 0; x < W; x++) { b[x] = 0; b[(H - 1) * W + x] = 0; }
    for (let y = 0; y < H; y++) { b[y * W] = 0; b[y * W + W - 1] = 0; }
    thin(b, W, H);
    const chains = trace(b, W, H, S);
    // Schreibreihenfolge: Zeile, dann von links nach rechts
    const lineOf = ch => { let y = 0; for (const p of ch) y += p[1]; return Math.floor((y / ch.length - S * 0.4) / (S * LH)); };
    const minX = ch => Math.min(...ch.map(p => p[0]));
    chains.forEach(ch => { ch.line = lineOf(ch); ch.mx = minX(ch); });
    chains.sort((a, b) => a.line - b.line || a.mx - b.mx);
    return chains.map(ch => {
      const p = [];
      for (const q of ch) p.push((q[0] - W / 2) / S, -(q[1] - H / 2) / S, 1);
      return { i: 0, p };
    });
  }

  /* Zhang-Suen-Verdünnung + Entfernen von Treppenstufen (1 px breites, 8-verbundenes Skelett) */
  function thin(b, W, H) {
    let fg = [];
    for (let i = 0; i < b.length; i++) if (b[i]) fg.push(i);
    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        const del = [];
        for (const i of fg) {
          if (!b[i]) continue;
          const p2 = b[i - W], p3 = b[i - W + 1], p4 = b[i + 1], p5 = b[i + W + 1],
                p6 = b[i + W], p7 = b[i + W - 1], p8 = b[i - 1], p9 = b[i - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (pass === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
          del.push(i);
        }
        for (const i of del) b[i] = 0;
        if (del.length) changed = true;
      }
      fg = fg.filter(i => b[i]);
    }
    for (const i of fg) {
      const N = b[i - W], E = b[i + 1], S = b[i + W], Wt = b[i - 1];
      const NE = b[i - W + 1], SE = b[i + W + 1], SW = b[i + W - 1], NW = b[i - W - 1];
      if ((N && E && !SW) || (E && S && !NW) || (S && Wt && !NE) || (Wt && N && !SE)) b[i] = 0;
    }
  }

  /* Skelett -> Graph -> zusammenhängende Linienzüge */
  function trace(b, W, H, S) {
    const OFF = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    const fg = [];
    for (let i = 0; i < b.length; i++) if (b[i]) fg.push(i);
    const deg = new Uint8Array(W * H);
    for (const i of fg) { let n = 0; for (const o of OFF) n += b[i + o]; deg[i] = n; }
    const xy = i => [i % W, (i / W) | 0];

    // Knoten: Endpunkte, Einzelpunkte und (zusammengefasste) Verzweigungen
    const nodeOf = new Int32Array(W * H).fill(-1);
    const nodes = [];
    for (const i of fg) {
      if (deg[i] === 2 || nodeOf[i] >= 0) continue;
      const id = nodes.length, pix = [], st = [i];
      nodeOf[i] = id;
      while (st.length) {
        const j = st.pop(); pix.push(j);
        if (deg[j] < 3) continue;
        for (const o of OFF) { const r = j + o; if (b[r] && deg[r] >= 3 && nodeOf[r] < 0) { nodeOf[r] = id; st.push(r); } }
      }
      let sx = 0, sy = 0; for (const j of pix) { const [x, y] = xy(j); sx += x; sy += y; }
      nodes.push({ id, pix, x: sx / pix.length, y: sy / pix.length, ends: [] });
    }

    const edges = [];
    const visited = new Uint8Array(W * H);
    const linked = new Set();
    const addEdge = (a, bb, pix) => {
      const pts = pix.map(xy);
      if (a >= 0) pts.unshift([nodes[a].x, nodes[a].y]);
      if (bb >= 0) pts.push([nodes[bb].x, nodes[bb].y]);
      let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      edges.push({ a, b: bb, pts, len, alive: true });
    };
    for (const n of nodes) {
      for (const np of n.pix) for (const o of OFF) {
        const q = np + o;
        if (!b[q] || nodeOf[q] === n.id) continue;
        if (nodeOf[q] >= 0) {
          const key = Math.min(n.id, nodeOf[q]) + ':' + Math.max(n.id, nodeOf[q]);
          if (!linked.has(key)) { linked.add(key); addEdge(n.id, nodeOf[q], []); }
          continue;
        }
        if (visited[q]) continue;
        const path = [q]; visited[q] = 1;
        let prev = np, cur = q, end = -1;
        for (let guard = 0; guard < 1e6; guard++) {
          let next = -1, hit = -1;
          for (const o2 of OFF) {
            const r = cur + o2;
            if (!b[r] || r === prev) continue;
            if (nodeOf[r] >= 0) { hit = r; continue; }
            if (!visited[r]) next = r;
          }
          if (next < 0) { if (hit >= 0) end = nodeOf[hit]; break; }
          visited[next] = 1; path.push(next); prev = cur; cur = next;
        }
        addEdge(n.id, end, path);
      }
    }
    // geschlossene Ringe ohne Knoten (z. B. „o“)
    for (const i of fg) {
      if (deg[i] !== 2 || visited[i] || nodeOf[i] >= 0) continue;
      const path = [i]; visited[i] = 1;
      let prev = -1, cur = i;
      for (let guard = 0; guard < 1e6; guard++) {
        let next = -1;
        for (const o of OFF) { const r = cur + o; if (b[r] && r !== prev && !visited[r]) { next = r; break; } }
        if (next < 0) break;
        visited[next] = 1; path.push(next); prev = cur; cur = next;
      }
      path.push(i);
      addEdge(-1, -1, path);
      edges[edges.length - 1].closed = true;
    }

    // Kanten an Knoten registrieren
    const rebuildEnds = () => {
      nodes.forEach(n => n.ends = []);
      edges.forEach((e, k) => { if (!e.alive) return; if (e.a >= 0) nodes[e.a].ends.push({ e: k, end: 0 }); if (e.b >= 0) nodes[e.b].ends.push({ e: k, end: 1 }); });
    };
    rebuildEnds();
    // Sporne entfernen (kurze Äste an Verzweigungen)
    const spur = S * 0.11;
    for (let it = 0; it < 2; it++) {
      let removed = false;
      edges.forEach(e => {
        if (!e.alive || e.closed || e.len > spur || e.a < 0 || e.b < 0) return;
        const da = nodes[e.a].ends.length, db = nodes[e.b].ends.length;
        if ((da === 1 && db >= 3) || (db === 1 && da >= 3)) { e.alive = false; removed = true; }
      });
      if (!removed) break;
      rebuildEnds();
    }

    // Richtung einer Kante vom Knoten weg
    const dirAt = (e, end) => {
      const P = e.pts, n = P.length, look = Math.max(2, Math.min(n - 1, Math.round(S * 0.12)));
      const a = end === 0 ? P[0] : P[n - 1], c = end === 0 ? P[Math.min(look, n - 1)] : P[Math.max(n - 1 - look, 0)];
      const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    // An Knoten möglichst gerade Fortsetzungen paaren
    const pair = new Map();
    const key = (e, end) => e * 2 + end;
    for (const n of nodes) {
      const ends = n.ends.slice();
      if (ends.length === 2 && ends[0].e !== ends[1].e) {
        pair.set(key(ends[0].e, ends[0].end), ends[1]); pair.set(key(ends[1].e, ends[1].end), ends[0]); continue;
      }
      if (ends.length < 3) continue;
      const dirs = ends.map(x => dirAt(edges[x.e], x.end));
      const cand = [];
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
        if (ends[i].e === ends[j].e) continue;
        cand.push({ i, j, d: dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] });
      }
      cand.sort((a, b) => a.d - b.d);
      const used = new Set();
      for (const c of cand) {
        if (c.d > -0.35 || used.has(c.i) || used.has(c.j)) continue;
        used.add(c.i); used.add(c.j);
        pair.set(key(ends[c.i].e, ends[c.i].end), ends[c.j]); pair.set(key(ends[c.j].e, ends[c.j].end), ends[c.i]);
      }
    }

    // Linienzüge verketten
    const done = new Uint8Array(edges.length);
    const chains = [];
    const walk = (e0, end0) => {
      const out = [];
      let e = e0, end = end0;
      while (e >= 0 && !done[e]) {
        done[e] = 1;
        const P = end === 0 ? edges[e].pts : edges[e].pts.slice().reverse();
        for (let k = out.length ? 1 : 0; k < P.length; k++) out.push(P[k]);
        const nx = pair.get(key(e, 1 - end));
        if (!nx) break;
        e = nx.e; end = nx.end;
      }
      return out;
    };
    edges.forEach((e, k) => {
      if (!e.alive || done[k] || e.closed) return;
      if (!pair.has(key(k, 0))) chains.push(walk(k, 0));
      else if (!pair.has(key(k, 1))) chains.push(walk(k, 1));
    });
    edges.forEach((e, k) => { if (e.alive && !done[k]) chains.push(walk(k, 0)); });
    // Einzelpunkte (i-Punkte)
    nodes.forEach(n => { if (n.pix.length && !n.ends.length && deg[n.pix[0]] === 0) chains.push([[n.x, n.y], [n.x + 0.5, n.y]]); });

    return chains.filter(c => c.length >= 2).map(c => orient(smooth(c)));
  }

  // Gleitender Mittelwert (Endpunkte bleiben)
  function smooth(P) {
    const closed = P.length > 3 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1.5;
    let A = P;
    for (let it = 0; it < 3; it++) {
      const B = A.map(p => p.slice());
      for (let i = 0; i < A.length; i++) {
        if (!closed && (i < 1 || i > A.length - 2)) continue;
        let sx = 0, sy = 0, n = 0;
        for (let k = -2; k <= 2; k++) {
          let j = i + k;
          if (closed) j = (j + A.length - 1) % (A.length - 1);
          else if (j < 0 || j >= A.length) continue;
          sx += A[j][0]; sy += A[j][1]; n++;
        }
        B[i] = [sx / n, sy / n];
      }
      if (closed) B[B.length - 1] = B[0].slice();
      A = B;
    }
    A.closed = closed;
    return A;
  }

  // Startpunkt wie beim Schreiben: oben links; Ringe oben rechts gegen den Uhrzeigersinn
  function orient(P) {
    if (P.closed) {
      const Q = P.slice(0, -1);
      let bi = 0, bv = -Infinity;
      Q.forEach((p, i) => { const v = -p[1] + 0.35 * p[0]; if (v > bv) { bv = v; bi = i; } });
      let R = [...Q.slice(bi), ...Q.slice(0, bi)];
      if (R.length > 3 && R[Math.min(3, R.length - 1)][0] > R[0][0]) R = [R[0], ...R.slice(1).reverse()];
      R.push(R[0]);
      return R;
    }
    const a = P[0], z = P[P.length - 1];
    const score = p => p[0] + 0.7 * p[1];
    return score(z) < score(a) ? P.slice().reverse() : P;
  }

  /* ---------- SVG -> Striche ----------
     Konturen (stroke) werden entlang ihrer Pfade in Original-Reihenfolge gezogen.
     Reine Flächen (nur fill) werden gerastert und – wie Text – auf ihre Mittellinie reduziert. */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const GEOM = 'path,line,polyline,polygon,rect,circle,ellipse';
  const SKIP = 'defs,clipPath,mask,symbol,pattern,marker,metadata';

  function sanitize(root) {
    root.querySelectorAll('script,foreignObject,image,iframe,audio,video,a').forEach(n => n.remove());
    root.querySelectorAll('*').forEach(n => {
      for (const a of [...n.attributes]) {
        const v = a.value.trim().toLowerCase();
        if (/^on/i.test(a.name) || (/href$/i.test(a.name) && !v.startsWith('#'))) n.removeAttribute(a.name);
      }
    });
    root.querySelectorAll('style').forEach(st => { st.textContent = st.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\([^)]*\)/gi, 'none'); });
    [root, ...root.querySelectorAll('*')].forEach(n => { for (const a of ['onload', 'onerror']) n.removeAttribute && n.removeAttribute(a); });
  }

  async function fromSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Keine gültige SVG-Datei');
    sanitize(root);
    const svg = document.importNode(root, true);
    // Größe festlegen, damit viewBox und Transformationen eindeutig sind
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    let W = parseFloat(svg.getAttribute('width')), H = parseFloat(svg.getAttribute('height'));
    if (vb.length === 4 && vb.every(isFinite)) { if (!(W > 0)) W = vb[2]; if (!(H > 0)) H = vb[3]; }
    if (!(W > 0)) W = 1000; if (!(H > 0)) H = 1000;
    const k0 = 1000 / Math.max(W, H); W *= k0; H *= k0;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
    host.appendChild(svg);
    document.body.appendChild(host);
    try {
      const els = [...svg.querySelectorAll(GEOM)].filter(e => !e.closest(SKIP));
      const info = els.map(e => { const cs = getComputedStyle(e);
        return { e, stroke: cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0, fill: cs.fill !== 'none', hidden: cs.display === 'none' }; })
        .filter(x => !x.hidden);
      const stroked = info.filter(x => x.stroke);
      let chains;
      if (stroked.length || !info.some(x => x.fill)) chains = samplePaths(stroked.length ? stroked.map(x => x.e) : info.map(x => x.e), Math.max(W, H));
      else chains = await skeletonSvg(svg, W, H);
      if (!chains.length) throw new Error('Keine Pfade gefunden');
      // auf ±0,5 der längeren Seite normieren, y nach oben
      const M = Math.max(W, H);
      return chains.map(ch => {
        const p = [];
        for (const q of ch) p.push(+((q[0] - W / 2) / M).toFixed(4), +(-(q[1] - H / 2) / M).toFixed(4), 1);
        return { i: 0, p: simplifyP(p, 0.0006) };
      });
    } finally { host.remove(); }
  }

  // Pfade gleichmäßig abtasten; Sprünge (neue Teilpfade) trennen Striche
  function samplePaths(els, M) {
    const step = M / 700, out = [];
    for (const e of els) {
      let L = 0;
      try { L = e.getTotalLength(); } catch (err) { continue; }
      if (!(L > 0)) continue;
      const m = e.getCTM();
      const sc = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1 : 1;     // Maßstab Elementraum -> Bild
      const n = Math.min(6000, Math.max(2, Math.ceil(L * sc / step)));
      const jump = Math.max(step * 4, (L * sc / n) * 3);
      let cur = [], prev = null;
      for (let i = 0; i <= n; i++) {
        let pt = e.getPointAtLength(L * i / n);
        if (m) pt = new DOMPoint(pt.x, pt.y).matrixTransform(m);
        const q = [pt.x, pt.y];
        if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > jump) { if (cur.length > 1) out.push(cur); cur = []; }
        cur.push(q); prev = q;
      }
      if (cur.length > 1) out.push(cur);
    }
    return out;
  }

  // Flächen rastern und auf Mittellinien reduzieren
  async function skeletonSvg(svg, W, H) {
    const R = 1400 / Math.max(W, H), cw = Math.ceil(W * R) + 40, ch = Math.ceil(H * R) + 40;
    const src = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
    try {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 20, 20, W * R, H * R);
      const d = g.getImageData(0, 0, cw, ch).data;
      c.width = c.height = 0;
      const b = new Uint8Array(cw * ch);
      let ink = 0;
      for (let i = 0; i < cw * ch; i++) if ((b[i] = d[i * 4 + 3] > 110 ? 1 : 0)) ink++;
      thin(b, cw, ch);
      let skel = 0; for (let i = 0; i < b.length; i++) skel += b[i];
      const thick = ink / Math.max(1, skel);                    // mittlere Strichstärke in px
      const chains = trace(b, cw, ch, Math.max(20, thick / 0.12));
      chains.sort((a, b2) => Math.min(...a.map(p => p[1])) - Math.min(...b2.map(p => p[1])) || Math.min(...a.map(p => p[0])) - Math.min(...b2.map(p => p[0])));
      return chains.map(ch2 => ch2.map(p => [(p[0] - 20) / R, (p[1] - 20) / R]));
    } finally { URL.revokeObjectURL(url); }
  }

  function simplifyP(p, eps) {
    const n = p.length / 3;
    if (n < 3) return p;
    const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
    const st = [[0, n - 1]];
    while (st.length) {
      const [a, b] = st.pop();
      const ax = p[a * 3], ay = p[a * 3 + 1], dx = p[b * 3] - ax, dy = p[b * 3 + 1] - ay, L = Math.hypot(dx, dy);
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const d = L > 1e-9 ? Math.abs((p[i * 3] - ax) * dy - (p[i * 3 + 1] - ay) * dx) / L : Math.hypot(p[i * 3] - ax, p[i * 3 + 1] - ay);
        if (d > md) { md = d; mi = i; }
      }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    return out;
  }

  /* Standard-Zeichnung: Kreuz und Bogen (Koordinaten im Format, Einheit = kürzere Seite) */
  function defaultDrawing() {
    const pts = (f, n) => { const p = []; for (let i = 0; i <= n; i++) { const t = i / n, [x, y] = f(t); p.push(+x.toFixed(4), +y.toFixed(4), +(0.75 + 0.25 * Math.sin(t * Math.PI)).toFixed(3)); } return p; };
    return [
      { i: 0, p: pts(t => [0.012 - 0.022 * t + 0.006 * Math.sin(t * 5), 0.38 - 0.44 * t], 24) },
      { i: 0, p: pts(t => [-0.2 + 0.43 * t, 0.175 + 0.022 * t + 0.008 * Math.sin(t * 4)], 24) },
      { i: 0, p: pts(t => {
          // Bogen: hoch – Halbkreis – runter
          if (t < 0.3) { const u = t / 0.3; return [-0.105, -0.52 + 0.27 * u]; }
          if (t < 0.7) { const u = (t - 0.3) / 0.4, a = Math.PI * (1 - u); return [0.105 * Math.cos(a), -0.25 + 0.105 * Math.sin(a)]; }
          const u = (t - 0.7) / 0.3; return [0.105, -0.25 - 0.27 * u];
        }, 48) },
    ];
  }

  return { FONTS, text, fromSvg, defaultDrawing };
})();
