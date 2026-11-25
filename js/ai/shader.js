'use strict';
/* KI: Shader-Generatoren.
   Das Modell schreibt einen GLSL-Fragment-Shader mit  vec3 image(vec2 uv, vec2 p, float t)  und legt seine Regler selbst fest.
   Jeder Regler wird zur Uniform  u_<id>.  Der Shader läuft danach in derselben WebGL-Pipeline wie Feuer/Grounddata
   (Finish, Bild-Ebene, Supersampling-Export, Video, nahtloser Loop). Geprüft wird vorher in der Sandbox (Worker). */
CG.ai = CG.ai || {};
CG.ai.shader = (() => {
  // Hilfsfunktionen für die Modelle (zusätzlich zu snoise, fbm, hash12, hash11 aus js/gl/common.js)
  const PRELUDE = `
#define TAU 6.28318530718
float loopNoise(vec2 x, float t, float r){ float a = TAU * t; return snoise(vec4(x, r * cos(a), r * sin(a))); }
float loopFbm(vec2 x, float t, float r, float oct){ float a = TAU * t; return fbm(x, vec2(cos(a), sin(a)) * r, oct); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdCircle(vec2 p, float r){ return length(p) - r; }
float sdSegment(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
`;
  const EFFECT = `
vec3 effect(vec2 fc, vec2 uv0){
  float mn = min(uRes.x, uRes.y);
  vec2 uv = fc / uRes;
  vec2 p = (fc - 0.5 * uRes) / mn;
  return clamp(image(uv, p, uPhase), 0.0, 1.0);
}`;
  const MARK = '// ---- KI-SHADER ----';

  /* Shadertoy-Stil: void mainImage(out vec4 fragColor, in vec2 fragCoord) mit iResolution, iTime …
     Das Modell schreibt frei, ohne vorgegebene Helfer. Damit seine eigenen Funktionen (hash12, fbm, snoise …)
     nicht mit der Bibliothek der App kollidieren, bekommt die Bibliothek per #define andere Namen. */
  const LIB = ['mod289', 'permute', 'taylorInvSqrt', 'grad4', 'snoise', 'fbm', 'hash12', 'hash11', 'aaSharp', 'seedOffset'];
  const isToy = code => /\bvoid\s+mainImage\s*\(/.test(String(code || ''));
  const PRE = LIB.map(n => `#define ${n} cg_${n}`).join('\n') + '\n';
  const pre = code => isToy(code) ? PRE : '';
  const TOY_HEAD = `${LIB.map(n => `#undef ${n}`).join('\n')}
uniform float uLoopSec;
#define iResolution vec3(uRes, 1.0)
#define iTime (uPhase * uLoopSec)
#define iLoop uPhase
#define iTimeDelta (1.0 / 60.0)
#define iFrame int(uPhase * uLoopSec * 60.0)
#define iFrameRate 60.0
#define iMouse vec4(0.0)
#define iDate vec4(2026.0, 1.0, 1.0, uPhase * uLoopSec)
// Eingaben des Nutzers: eingefügtes Bild (Bild-Ebene, vom Nutzer platziert) und Pinsel-Maske.
// blur 0..6 (Mip-Stufen) ist auflösungsunabhängig: bezogen auf 512 px der kürzeren Seite – Vorschau und 4K-Export sehen gleich aus.
float cg_blurLod(float blur){ return blur > 0.0 ? max(blur + log2(min(uRes.x, uRes.y) / 512.0), 0.0) : 0.0; }
vec4 iImage(vec2 fc, float blur){ vec4 L = layerAt((fc - 0.5 * uRes) / min(uRes.x, uRes.y), cg_blurLod(blur)); return vec4(L.a > 0.001 ? L.rgb / L.a : vec3(0.0), L.a); }
vec4 iImage(vec2 fc){ return iImage(fc, 0.0); }
float iBrush(vec2 fc, float blur){
  if (uBrushOn < 0.5) return 0.0;
  float lod = log2(max(float(textureSize(uBrush, 0).y) / uRes.y, 1.0)) + cg_blurLod(blur);
  return textureLod(uBrush, vec2(fc.x / uRes.x, 1.0 - fc.y / uRes.y), lod).r;
}
float iBrush(vec2 fc){ return iBrush(fc, 0.0); }`;
  // Welche Eingaben nutzt der Code des Modells? (Kommentare zählen nicht)
  const inputsOf = code => {
    const c = String(code || '').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    return { image: /\biImage\s*\(/.test(c), brush: /\biBrush\s*\(/.test(c) };
  };
  const TOY_EFFECT = `
${LIB.map(n => `#define ${n} cg_${n}`).join('\n')}
vec3 effect(vec2 fc, vec2 uv0){
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(c, fc);
  return clamp(c.rgb, 0.0, 1.0);
}`;

  const uniformName = id => 'u_' + id;
  /* Hilfsfunktionen, die Modelle ständig aufrufen, ohne sie (passend) zu definieren.
     Eingefügt wird nur, was der Shader benutzt und nicht selbst mit diesen Argumenten definiert –
     so funktioniert noise(vec3), auch wenn das Modell nur noise(vec2) geschrieben hat. */
  const HELPERS = [
    ['hash', 'float', 'float hash(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }'],
    ['hash', 'vec2', 'float hash(vec2 p){ return cg_h2(p); }'],
    ['hash', 'vec3', 'float hash(vec3 p){ return cg_h3(p); }'],
    ['rand', 'vec2', 'float rand(vec2 p){ return cg_h2(p); }'],
    ['random', 'vec2', 'float random(vec2 p){ return cg_h2(p); }'],
    ['noise', 'float', 'float noise(float p){ return cg_n2(vec2(p, 0.5)); }'],
    ['noise', 'vec2', 'float noise(vec2 p){ return cg_n2(p); }'],
    ['noise', 'vec3', 'float noise(vec3 p){ return cg_n3(p); }'],
    ['snoise', 'vec2', 'float snoise(vec2 p){ return cg_n2(p) * 2.0 - 1.0; }'],
    ['snoise', 'vec3', 'float snoise(vec3 p){ return cg_n3(p) * 2.0 - 1.0; }'],
    ['fbm', 'vec2', 'float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * cg_n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s / 0.96875; }'],
    ['fbm', 'vec3', 'float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * cg_n3(p); p = p * 2.02 + 7.1; a *= 0.5; } return s / 0.96875; }'],
    ['fbm', 'vec2', 'float fbm(vec2 p, float oct){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 10; i++){ if (float(i) >= oct) break; s += a * cg_n2(p); n += a; p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s / max(n, 1e-4); }\nfloat fbm(vec2 p, int oct){ return fbm(p, float(oct)); }'],
    ['fbm', 'vec3', 'float fbm(vec3 p, float oct){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 10; i++){ if (float(i) >= oct) break; s += a * cg_n3(p); n += a; p = p * 2.02 + 7.1; a *= 0.5; } return s / max(n, 1e-4); }\nfloat fbm(vec3 p, int oct){ return fbm(p, float(oct)); }'],
    ['rot', 'float', 'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }'],
    ['rotate', 'float', 'mat2 rotate(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }'],
    ['rotate2d', 'float', 'mat2 rotate2d(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }'],
    ['hash', 'int', 'float hash(int p){ return hash(float(p)); }'],
    ['noise', 'int', 'float noise(int p){ return cg_n2(vec2(float(p), 0.5)); }'],
    ['smin', 'float', 'float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-5), 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }'],
    ['palette', 'float', 'vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b * cos(6.28318530718 * (c * t + d)); }\n' +
      'vec3 palette(float t, vec3 a, vec3 b, vec3 c, float d){ return palette(t, a, b, c, vec3(d)); }\nvec3 palette(float t, vec3 a, vec3 b, vec3 c){ return palette(t, a, b, c, vec3(0.0)); }\n' +
      'vec3 palette(float t, vec3 a, vec3 b){ return mix(a, b, 0.5 + 0.5 * cos(6.28318530718 * t)); }'],
  ];
  const HELPER_BASE = `float cg_h2(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float cg_h3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float cg_n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cg_h2(i), cg_h2(i + vec2(1.0, 0.0)), f.x), mix(cg_h2(i + vec2(0.0, 1.0)), cg_h2(i + vec2(1.0, 1.0)), f.x), f.y); }
float cg_n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cg_h3(i), cg_h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(cg_h3(i + vec3(0.0, 1.0, 0.0)), cg_h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(cg_h3(i + vec3(0.0, 0.0, 1.0)), cg_h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(cg_h3(i + vec3(0.0, 1.0, 1.0)), cg_h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }`;
  function helpers(code) {
    const c = String(code || '').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    const used = n => new RegExp('\\b' + n + '\\s*\\(').test(c);
    const own = (n, arg) => new RegExp('\\b\\w+\\s+' + n + '\\s*\\(\\s*(?:in\\s+)?(?:const\\s+)?' + arg + '\\b').test(c) || new RegExp('#\\s*define\\s+' + n + '\\b').test(c);
    const list = [...new Set(HELPERS.filter(([n, arg]) => used(n) && !own(n, arg)).map(h => h[2]))];
    return list.length ? HELPER_BASE + '\n' + list.join('\n') : '';
  }

  const decl = params => params.map(p => `uniform ${p.type === 'color' ? 'vec3' : 'float'} ${uniformName(p.id)};`).join('\n');

  // Rumpf für die Funktion (wird von CG.glsl.build um Kopf, Rauschen und Finish ergänzt)
  const body = (params, code) => isToy(code)
    ? `${TOY_HEAD}\n${decl(params)}\n${helpers(code)}\n${MARK}\n${code}\n${TOY_EFFECT}`
    : `${decl(params)}\n${PRELUDE}\n${MARK}\n${code}\n${EFFECT}`;            // ältere Shader mit image(uv, p, t)
  const source = (params, code) => CG.glsl.build({ glsl: body(params, code), pre: pre(code) });

  // Zeile im Gesamtquelltext -> Zeile im Shader des Modells
  function codeLineOffset(src) {
    const i = src.indexOf(MARK);
    return i < 0 ? 0 : src.slice(0, i).split('\n').length;       // Zeile des Markers; danach beginnt der Code
  }
  // kurze Lösungshinweise zu typischen Compiler-Meldungen (für das Modell)
  const BUILTIN = /^'(smoothstep|mix|pow|clamp|step|max|min|mod|sin|cos|tan|fract|floor|ceil|abs|exp|log|sqrt|atan|sign|exp2|log2|inversesqrt)'/;
  const VECFN = /^'(dot|cross|distance|reflect|normalize|length|faceforward|refract)'/;
  const HELPER_SIGS = { hash: 'hash(float | vec2 | vec3) -> float', noise: 'noise(float | vec2 | vec3) -> float 0..1', fbm: 'fbm(vec2 | vec3) -> float 0..1',
    rot: 'rot(float angle) -> mat2', smin: 'smin(float a, float b, float k) -> float', palette: 'palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) -> vec3', snoise: 'snoise(vec2 | vec3) -> float -1..1' };
  const HINTS = [
    [/^'(hash|noise|fbm|rot|smin|palette|snoise)' : no matching overloaded function found/, e => `hint: the app's helper is ${HELPER_SIGS[e.match(/^'(\w+)'/)[1]]} – use exactly these argument types (or define your own version above)`],
    [VECFN, e => `hint: ${e.match(VECFN)[1]}() needs vectors of the same size (vec2 with vec2, vec3 with vec3) – check which variable is a vec2 and which a vec3; convert with vec3(v, 0.0) or v.xy`],
    [/no matching overloaded function found/, e => BUILTIN.test(e) ? `hint: all arguments of ${e.match(BUILTIN)[1]}() must be float or the same vecN type – write 2.0 not 2, use float(i), no bool` : 'hint: number and types of the arguments must match the declaration, and the function must be defined above its first use'],
    [/wrong operand types.*\bint\b|wrong operand types.*\bfloat\b.*\bint\b/, 'hint: int and float never mix – write 1.0 instead of 1 or use float(i)'],
    [/wrong operand types.*component vector.*component vector/, 'hint: vector sizes must match – a vec2 and a vec3 cannot be combined; use vec3(v, 0.0) to extend or v.xy to shorten'],
    [/wrong operand types/, 'hint: both operands need matching types – float with float, vec3 with vec3 or vec3 with float'],
    [/cannot convert from|dimension mismatch/, 'hint: both sides need the same type – vec3(x) turns a float into a vec3, .xy shortens a vector'],
    [/constructor.*too many arguments|not enough data provided for construction/, 'hint: vec2/vec3/vec4(…) needs exactly 2/3/4 float components in total'],
    [/function return is not matching type/, 'hint: return a value of the declared return type'],
    [/l-value required/, 'hint: uniforms (u_…, iTime, iResolution) and expressions cannot be assigned – copy into a local variable first'],
    [/field selection|vector field selection/, 'hint: .x/.y/.z only exist on vectors – a float has no fields'],
    [/redefinition/, 'hint: this name is already defined – rename one of them'],
    [/built-in function cannot be redeclared/, 'hint: rename your function, e.g. myMod – built-in names are taken'],
    [/reserved/, 'hint: this word is reserved in GLSL – rename it'],
    [/syntax error/, 'hint: look for a missing ; ) or }, a function defined inside another function, or a reserved word (smooth, flat, sample, input, output, filter) used as a name'],
  ];
  function localizeLog(log, src) {
    const off = codeLineOffset(src), lines = String(src || '').split('\n');
    const seen = new Set();
    return String(log || '').replace(/\u0000/g, '').split('\n').map(s => s.trim()).filter(Boolean).filter(l => !seen.has(l) && seen.add(l)).slice(0, 6).map(line => {
      const m = line.match(/^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/);
      if (!m) return line;
      const n = +m[1] - off;
      if (n <= 0) return m[2];
      let code = (lines[+m[1] - 1] || '').trim().slice(0, 140);
      // bei Syntaxfehlern liegt die Ursache oft in der Zeile davor (fehlendes Semikolon, abgebrochener Ausdruck)
      if (/syntax error/.test(m[2]) && n > 1) {
        const prev = (lines[+m[1] - 2] || '').trim().slice(0, 140);
        if (prev) code = `Zeile ${n - 1}: ${prev}  ⏎  Zeile ${n}: ${code}`;
      }
      let hint = '';
      const und = m[2].match(/'(\w+)'\s*:\s*undeclared identifier/);
      if (und) hint = /^(u_?res|uresolution|resolution)$/i.test(und[1]) ? ' (heißt iResolution)' : /^(u_?time|time)$/i.test(und[1]) ? ' (heißt iTime)'
        : ' (nicht definiert – vorhanden sind nur iResolution, iTime, iLoop, deine u_<id> und Funktionen, die du selbst schreibst)';
      if (!hint) hint = HINTS.reduce((h, [re, t]) => h || (re.test(m[2]) ? ` (${typeof t === 'function' ? t(m[2]) : t})` : ''), '');
      return `Zeile ${n}: ${m[2]}${hint}${code ? `  →  ${code}` : ''}`;
    });
  }

  // Werte der Regler -> Uniform-Liste für den Worker
  function uniforms(params, values, loopSec = 10) {
    return params.map(p => {
      let v = values && p.id in values ? values[p.id] : p.default;
      if (p.type === 'color') return [uniformName(p.id), 'vec3', CG.util.hexToRgb(v)];
      if (p.type === 'toggle') v = v ? 1 : 0;
      else if (p.type === 'select') v = Math.max(0, p.options.indexOf(String(v)));
      return [uniformName(p.id), 'float', +v || 0];
    }).concat([['uLoopSec', 'float', loopSec]]);
  }

  /* Statische Prüfung: Funktion vorhanden, keine Texturen, Schleifen mit fester Obergrenze (sonst kann die GPU hängen) */
  function staticCheck(code) {
    const e = [];
    const c = String(code || '').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    if (!c.trim()) return ['Das Feld "shader" ist leer.'];
    if (!isToy(c) && !/vec3\s+image\s*\(/.test(c)) e.push('Es fehlt  void mainImage(out vec4 fragColor, in vec2 fragCoord).');
    if (/\biChannel\d|\b(?:texture|texelFetch|textureLod)\s*\(/.test(c)) e.push('Es gibt keine Texturen/iChannel – Bild und Pinsel des Nutzers kommen über iImage(fragCoord) und iBrush(fragCoord), alles andere entsteht prozedural.');
    if (/^\s*#\s*version/m.test(c)) e.push('Keine #version-Zeile – die App setzt sie selbst.');
    if (/\buniform\s+\w+\s+u_/.test(c)) e.push('Die Regler-Uniforms (u_…) nicht selbst deklarieren – die App erzeugt sie.');
    if (/\bvoid\s+main\s*\(/.test(c)) e.push('Keine main()-Funktion – nur mainImage() und eigene Funktionen.');
    if (/\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*[^;]*;\s*;/.test(c)) e.push('Endlosschleife – jede Schleife braucht eine Abbruchbedingung.');
    return e;
  }

  /* Kleinigkeiten selbst korrigieren statt eine Reparaturrunde zu verlangen:
     - ungültige Regler-ids (Umlaute, Leerzeichen, Bindestriche) -> gültige ids, auch im Shader ersetzt
     - selbst deklarierte Regler-Uniforms (uniform float u_x;) -> entfernt, die App deklariert sie */
  function tidy(params, code, prev) {
    const fixes = [];
    let src = String(code || '');
    const prevById = new Map((Array.isArray(prev) ? prev : []).map(p => [p.id, p]));
    const out = (Array.isArray(params) ? params : []).map(p => {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string') return p;
      // verrutschte Werte: "group": "Form, min, max, step, default, 0.5, 2, 0.01, 0.5" -> zurück in die Felder
      if (typeof p.group === 'string' && /,\s*(?:min|max|step|default|options)\b/.test(p.group)) {
        const parts = p.group.split(',').map(x => x.trim());
        const names = [], vals = [];
        for (const x of parts.slice(1)) (/^(?:min|max|step|default|options)$/.test(x) ? names : vals).push(x);
        p = { ...p, group: parts[0] };
        names.forEach((n, i) => { if (p[n] === undefined && vals[i] !== undefined && n !== 'options') p[n] = /^-?[\d.]+$/.test(vals[i]) ? +vals[i] : vals[i] === 'true' ? true : vals[i] === 'false' ? false : vals[i]; });
        fixes.push(`${p.id}: verrutschte Werte zurückgeholt`);
      }
      // fehlende Angaben aus der vorigen Runde übernehmen (gleicher Regler, gleicher Typ)
      const old = prevById.get(p.id);
      if (old && String(p.type || old.type) === old.type) {
        const miss = ['min', 'max', 'step', 'default', 'options', 'label'].filter(k => p[k] === undefined && old[k] !== undefined);
        if (miss.length) { p = { ...p }; miss.forEach(k => { p[k] = old[k]; }); }
      }
      if (/^[A-Za-z_]\w*$/.test(p.id)) return p;
      const id = p.id.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '_').replace(/^(\d)/, '_$1') || 'p';
      const esc = p.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      src = src.replace(new RegExp('\\bu_' + esc + '(?![\\wäöüÄÖÜß])', 'g'), 'u_' + id);
      fixes.push(`${p.id} → ${id}`);
      return { ...p, id };
    });
    // Zeilen, die in der App nichts zu suchen haben
    const b0 = src;
    src = src.replace(/^[ \t]*#\s*(?:extension|version)[^\n]*\n?/gm, '').replace(/^[ \t]*precision\s+\w+\s+\w+\s*;[ \t]*\n?/gm, '')
             .replace(/^[ \t]*(?:layout\s*\([^)]*\)\s*)?out\s+vec4\s+\w+\s*;[ \t]*\n?/gm, '');
    if (src !== b0) fixes.push('überflüssige Kopfzeilen entfernt');
    // void main() mit gl_FragColor/gl_FragCoord -> mainImage
    if (!isToy(src) && !/vec3\s+image\s*\(/.test(src) && /\bvoid\s+main\s*\(\s*(?:void)?\s*\)/.test(src)) {
      src = src.replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, 'void mainImage(out vec4 fragColor, in vec2 fragCoord)')
               .replace(/\bgl_FragColor\b/g, 'fragColor').replace(/\bgl_FragCoord\.xy\b/g, 'fragCoord').replace(/\bgl_FragCoord\b/g, 'vec4(fragCoord, 0.0, 1.0)');
      fixes.push('main() → mainImage()');
    }
    // übliche andere Namen für Zeit und Größe (nur wenn der Shader sie nicht selbst anlegt)
    const ids = new Set(out.map(p => p && p.id));
    const declared = n => new RegExp('\\b(?:float|int|vec[234]|mat[234]|bool)\\s+(?:\\w+\\s*,\\s*)*' + n + '\\b').test(src) || new RegExp('#\\s*define\\s+' + n + '\\b').test(src);
    const alias = [['u_time', 'iTime'], ['uTime', 'iTime'], ['iGlobalTime', 'iTime'], ['time', 'iTime'], ['u_resolution', 'iResolution.xy'], ['uResolution', 'iResolution.xy'], ['resolution', 'iResolution.xy'], ['u_mouse', 'vec2(0.0)']];
    const defs = [];
    for (const [n, v] of alias) if (new RegExp('\\b' + n + '\\b').test(src) && !declared(n) && !ids.has(n.replace(/^u_/, ''))) defs.push(`#define ${n} ${v}`);
    if (defs.length) { src = defs.join('\n') + '\n' + src; fixes.push(defs.map(d => d.split(' ')[1]).join(', ') + ' zugeordnet'); }
    // float x = 2;  ->  float x = 2.0;  (GLSL ES wandelt Ganzzahlen nicht automatisch um)
    const b1 = src;
    src = src.replace(/\b(float\s+\w+\s*=\s*-?\d+)(\s*[;,])/g, '$1.0$2');
    if (src !== b1) fixes.push('Ganzzahlen bei float ergänzt');
    // typische Verwechsler aus HLSL/anderen Sprachen (nur wenn das Modell sie nicht selbst definiert)
    const defined = n => new RegExp('\\b(?:float|int|vec[234]|void|bool|mat[234])\\s+' + n + '\\s*\\(').test(src);
    const swaps = [['frac', 'fract'], ['lerp', 'mix'], ['fmod', 'mod'], ['atan2', 'atan'], ['float2', 'vec2'], ['float3', 'vec3'], ['float4', 'vec4']];
    for (const [a, b] of swaps) {
      const re = new RegExp('\\b' + a + '\\b(?=\\s*\\()', 'g');
      if (re.test(src) && !defined(a)) { src = src.replace(re, b); fixes.push(`${a} → ${b}`); }
    }
    if (/\bsaturate\s*\(/.test(src) && !defined('saturate')) {
      src = ['float', 'vec2', 'vec3', 'vec4'].map(t => `${t} saturate(${t} x){ return clamp(x, 0.0, 1.0); }`).join('\n') + '\n' + src;
      fixes.push('saturate ergänzt');
    }
    // globale Variablen mit Uniforms/iTime im Initialisierer sind in GLSL verboten -> als #define
    let depth = 0;
    src = src.split('\n').map(line => {
      const atTop = depth === 0;
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (!atTop) return line;
      const m = line.match(/^\s*(?:const\s+)?(?:float|int|vec[234]|mat[234])\s+(\w+)\s*=\s*([^;]+);\s*(\/\/.*)?$/);
      if (!m || !/\b(?:u_\w+|iTime|iResolution|iLoop|iFrame|iDate)\b/.test(m[2])) return line;
      const assigned = new RegExp('\\b' + m[1] + '\\s*(?:[-+*/]?=(?!=)|\\+\\+|--)', 'g');
      if ((src.match(assigned) || []).length > 1) return line;          // wird später verändert -> so lassen
      fixes.push(`globale Variable ${m[1]} als #define`);
      return `#define ${m[1]} (${m[2].trim()})`;
    }).join('\n');
    const before = src;
    src = src.replace(/^[ \t]*uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+u_\w+(?:\s*,\s*u_\w+)*\s*;[ \t]*\n?/gm, '');
    src = src.replace(/^[ \t]*uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+i[A-Z]\w*(?:\s*\[\s*\d+\s*\])?\s*;[ \t]*\n?/gm, '');   // iResolution, iTime … gibt es schon
    if (src !== before) fixes.push('eigene Uniform-Deklarationen entfernt');
    // Regler, die der Shader benutzt, die aber in der Liste fehlen: selbst anlegen (Farbe oder Schieberegler)
    const have = new Set(out.filter(p => p && typeof p.id === 'string').map(p => p.id));
    const local = n => new RegExp('\\b(?:float|int|vec[234]|mat[234]|bool)\\s+(?:\\w+\\s*,\\s*)*' + n + '\\b').test(src.replace(/^[ \t]*uniform[^\n]*$/gm, '')) || new RegExp('#\\s*define\\s+' + n + '\\b').test(src);
    const missing = [...new Set((src.match(/\bu_[A-Za-z]\w*/g) || []))].filter(n => !have.has(n.slice(2)) && !local(n) && !/^u_(time|resolution|mouse)$/.test(n));
    for (const n of missing) {
      const id = n.slice(2), label = id.replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase());
      // als Farbe benutzt? (Name oder Verwendung als vec3)
      const isColor = /col|farb|tint|ink|paint/i.test(id) || new RegExp('\\b' + n + '\\.(?:rgb|r|g|b|xyz)\\b').test(src) || new RegExp('mix\\s*\\(\\s*(?:u_\\w+\\s*,\\s*)?' + n + '\\s*,\\s*u_\\w*(?:col|farb)', 'i').test(src);
      out.push(isColor ? { id, label, type: 'color', default: '#808080' } : { id, label, type: 'range', min: 0, max: 2, step: 0.01, default: 1 });
      have.add(id);
    }
    if (missing.length) fixes.push('fehlende Regler angelegt: ' + missing.map(n => n.slice(2)).join(', '));
    return { params: out, code: src, fixes };
  }

  /* ---------- Rettung bei Kompilierfehlern ----------
     Mechanische Fehler, an denen kleine Modelle oft scheitern, ohne Rückfrage beheben. Jede Variante wird nur übernommen,
     wenn der Shader danach wirklich kompiliert (validate.runShader prüft das) – ein funktionierender Shader wird nie verändert. */
  const TY = '(?:void|float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234](?:x[234])?)';
  // Kommentare durch Leerzeichen ersetzen (Positionen und Zeilen bleiben gleich)
  const mask = c => c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
  function closeOf(m, open) { let d = 0; for (let i = open; i < m.length; i++) { if (m[i] === '{') d++; else if (m[i] === '}' && --d === 0) return i; } return -1; }
  const depthAt = (m, pos) => { let d = 0; for (let i = 0; i < pos; i++) { if (m[i] === '{') d++; else if (m[i] === '}') d--; } return d; };
  // Funktionsdefinitionen: { start, open, end, name, sig, depth }
  function functions(code) {
    const m = mask(code), out = [];
    const re = new RegExp('(?:^|(?<=[;{}\\s]))(?:(?:highp|mediump|lowp)\\s+)?(' + TY + ')\\s+([A-Za-z_]\\w*)\\s*\\(([^(){};]*)\\)\\s*\\{', 'g');
    let r;
    while ((r = re.exec(m))) {
      const open = re.lastIndex - 1, end = closeOf(m, open);
      if (end < 0) continue;
      out.push({ start: r.index, open, end: end + 1, name: r[2], sig: `${r[1]} ${r[2]}(${r[3].trim().replace(/\s+/g, ' ')})`, depth: depthAt(m, r.index) });
      re.lastIndex = open + 1;                               // auch verschachtelte Definitionen finden
    }
    return out;
  }
  // 1. Funktionen vor ihrer Definition benutzt -> Prototypen an den Anfang
  function prototypes(code) {
    const sigs = [...new Set(functions(code).filter(f => f.depth === 0 && !/^(mainImage|main|image)$/.test(f.name)).map(f => f.sig + ';'))];
    return sigs.length ? sigs.join('\n') + '\n' + code : code;
  }
  // 2. Funktionen innerhalb von Funktionen (in GLSL verboten) -> davor setzen
  function hoist(code) {
    const fs = functions(code), nested = fs.filter(f => f.depth > 0 && !fs.some(g => g !== f && g.depth > 0 && g.start < f.start && f.end <= g.end));
    if (!nested.length) return code;
    let out = code;
    for (const f of nested.slice().reverse()) {
      const host = fs.filter(g => g.depth === 0 && g.start < f.start && f.end <= g.end)[0];
      if (!host) continue;
      const text = out.slice(f.start, f.end);
      out = out.slice(0, f.start) + out.slice(f.end);
      out = out.slice(0, host.start) + text + '\n' + out.slice(host.start);
    }
    return out;
  }
  // 3. fehlende schließende Klammern am Ende ergänzen
  function braces(code) {
    const m = mask(code), n = (m.match(/\{/g) || []).length - (m.match(/\}/g) || []).length;
    return n > 0 ? code + '\n' + '}\n'.repeat(n) : code;
  }
  // 4. for (int i …) -> for (float i …): i darf dann in Rechnungen mit Kommazahlen stehen (pow(0.5, i), i * 0.3)
  function floatLoops(code) {
    return code.replace(/\bfor\s*\(\s*int\s+(\w+)\s*=\s*([^;]*?)\s*;\s*\1\s*(<=|>=|<|>|!=)\s*([^;]*?)\s*;\s*(\+\+\s*\1|\1\s*\+\+|\1\s*\+=\s*1|--\s*\1|\1\s*--|\1\s*-=\s*1)\s*\)/g,
      (all, v, a, op, b, inc) => `for (float ${v} = float(${a}); ${v} ${op} float(${b}); ${v} ${/-/.test(inc) ? '-' : '+'}= 1.0)`);
  }
  // 5. Ganzzahlen in Rechnungen mit Kommazahlen -> 2 wird 2.0 (nicht in int-Anweisungen, Array-Indizes, #define, for-Köpfen mit int)
  function floatLiterals(code) {
    const m = mask(code), skip = new Uint8Array(m.length);
    const mark = (a, b) => { for (let i = Math.max(0, a); i < Math.min(m.length, b); i++) skip[i] = 1; };
    for (const r of m.matchAll(/^[ \t]*#[^\n]*/gm)) mark(r.index, r.index + r[0].length);
    for (const r of m.matchAll(/\[[^\[\]\n]*\]/g)) mark(r.index, r.index + r[0].length);
    for (const r of m.matchAll(/\bfor\s*\(/g)) {                                   // for-Köpfe mit int
      let d = 0, j = r.index + r[0].length - 1;
      for (; j < m.length; j++) { if (m[j] === '(') d++; else if (m[j] === ')' && --d === 0) break; }
      if (/\b(?:int|uint)\b/.test(m.slice(r.index, j))) mark(r.index, j);
    }
    // Anweisungen mit int-Typen oder Ganzzahl-Operatoren
    let st = 0;
    for (let i = 0; i <= m.length; i++) {
      if (i === m.length || m[i] === ';' || m[i] === '{' || m[i] === '}') {
        const seg = m.slice(st, i);
        if (/\b(?:int|uint|ivec[234]|uvec[234]|case|switch)\b|[%^]|<<|>>|&(?!&)|\|(?!\|)/.test(seg)) mark(st, i);
        st = i + 1;
      }
    }
    let out = '', last = 0;
    for (const r of m.matchAll(/(?<![\w.])(?<![\d.][eE][+-])\d+(?![\w.])/g)) {          // nicht im Exponenten (1.5e+2)
      if (skip[r.index]) continue;
      out += code.slice(last, r.index) + r[0] + '.0'; last = r.index + r[0].length;
    }
    return out + code.slice(last);
  }
  // 6. fragColor bekommt vec3/float statt vec4 -> umwandeln (Überladungen erledigen jeden Typ)
  function fragColor(code) {
    if (!/\bfragColor\s*=(?!=)/.test(code) || /\bcg_v4\b/.test(code)) return code;
    const out = code.replace(/\bfragColor\s*=(?!=)\s*([^;]+);/g, 'fragColor = cg_v4($1);');
    return 'vec4 cg_v4(vec4 c){ return c; }\nvec4 cg_v4(vec3 c){ return vec4(c, 1.0); }\nvec4 cg_v4(float c){ return vec4(vec3(c), 1.0); }\n' + out;
  }
  // 7. reservierte Wörter als eigene Namen (float sample = …, vec3 input …) -> umbenennen
  const RESERVED = ['smooth', 'flat', 'sample', 'input', 'output', 'filter', 'common', 'partition', 'active', 'half', 'fixed', 'long', 'short', 'double', 'unsigned',
    'superp', 'resource', 'patch', 'subroutine', 'union', 'enum', 'typedef', 'template', 'this', 'goto', 'inline', 'public', 'static', 'extern', 'external', 'interface', 'cast', 'namespace', 'using', 'sizeof', 'class', 'asm', 'volatile', 'coherent', 'restrict', 'readonly', 'writeonly', 'varying', 'attribute', 'noperspective', 'centroid'];
  function reserved(code) {
    const m = mask(code); let out = code;
    for (const w of RESERVED) {
      if (!new RegExp('\\b' + TY + '\\s+' + w + '\\b|,\\s*' + w + '\\s*[=;,]').test(m)) continue;     // nur, wenn das Modell den Namen selbst anlegt
      out = out.replace(new RegExp('\\b' + w + '\\b', 'g'), w + '_');
    }
    return out;
  }
  // Varianten in sinnvoller Reihenfolge (einzeln und kombiniert), ohne Dubletten und ohne unveränderte
  function rescue(code) {
    const steps = { prototypes: ['Prototypen ergänzt', prototypes], hoist: ['verschachtelte Funktionen herausgelöst', hoist], braces: ['Klammern ergänzt', braces],
      loops: ['Schleifenzähler als Kommazahl', floatLoops], literals: ['Ganzzahlen als Kommazahlen', floatLiterals] };
    const plans = [['literals'], ['loops'], ['loops', 'literals'], ['prototypes'], ['hoist'], ['hoist', 'prototypes'], ['braces'], ['prototypes', 'loops', 'literals'],
      ['hoist', 'prototypes', 'loops', 'literals'], ['braces', 'hoist', 'prototypes', 'loops', 'literals']];
    const seen = new Set([code]), out = [];
    for (const plan of plans) {
      let c = code; const fixes = [];
      for (const k of plan) { const n = steps[k][1](c); if (n !== c) { c = n; fixes.push(steps[k][0]); } }
      if (fixes.length && !seen.has(c)) { seen.add(c); out.push({ code: c, fixes }); }
    }
    return out;
  }

  /* Korrekturen anhand der Compiler-Meldung (Zeile + Typen sind bekannt):
     - „cannot convert from float to N-component vector“: rechte Seite in vecN(…) packen (float wird auf alle Kanäle verteilt)
     - „wrong operand types … int … float“: in dieser Zeile Ganzzahlen zu Kommazahlen, int-Variablen in float(…) */
  const lineFix = (code, line, f) => { const L = code.split('\n'); if (line < 1 || line > L.length) return code; const n = f(L[line - 1]); if (n === L[line - 1]) return code; L[line - 1] = n; return L.join('\n'); };
  function toVec(code, errs) {
    let out = code;
    for (const e of errs) {
      const m = e.msg.match(/cannot convert from '(?:\w+ )*float' to '(?:\w+ )*(\d)-component vector of float'/);
      if (!m) continue;
      out = lineFix(out, e.line, l => l.replace(/((?:^|[;{(\s])[\w.\[\]]+\s*(?:[-+*/]?=)(?!=))\s*([^;]+);/, (all, lhs, rhs) => /^\s*vec\d\s*\(/.test(rhs) ? all : `${lhs} vec${m[1]}(${rhs.trim()});`)
                              .replace(/\breturn\s+([^;]+);/, (all, rhs) => /function return/.test(e.msg) ? `return vec${m[1]}(${rhs.trim()});` : all));
    }
    return out;
  }
  // Vektorgrößen gemischt (vec2 − vec3): in der Fehlerzeile die größeren Variablen kürzen (.xy) bzw. bei Zuweisungen anpassen
  function vecMix(code, errs) {
    const m0 = mask(code), dims = new Map();
    for (const d of m0.matchAll(/\b(float|vec[234])\s+([A-Za-z_]\w*)\s*(?=[=;,)\[])/g)) {
      const n = d[1] === 'float' ? 1 : +d[1][3], had = dims.get(d[2]);
      dims.set(d[2], had === undefined || had === n ? n : -1);              // -1 = mehrdeutig (verschiedene Typen)
    }
    dims.set('iResolution', 3);                                      // Shadertoy: vec3 – fragCoord / iResolution ist der häufigste Fall
    const sw = ['', 'x', 'xy', 'xyz'];
    let out = code;
    for (const e of errs) {
      let m = e.msg.match(/wrong operand types.*'(?:\w+ )*(\d)-component vector of float'.*'(?:\w+ )*(\d)-component vector of float'/);
      if (m) {
        const big = Math.max(+m[1], +m[2]), small = Math.min(+m[1], +m[2]);
        if (big === small) continue;
        out = lineFix(out, e.line, l => l.replace(/(?<![\w.])([A-Za-z_]\w*)(?![\w.(])/g, (all, n, off) => {
          if (dims.get(n) !== big) return all;
          if (/^\s*(?:[-+*/]?=(?!=))/.test(l.slice(off + n.length)) && !/[-+*/(,]\s*$/.test(l.slice(0, off))) return all;   // Ziel einer Zuweisung
          return `${n}.${sw[small]}`;
        }));
        continue;
      }
      m = e.msg.match(/cannot convert from '(?:\w+ )*(\d)-component vector of float' to '(?:\w+ )*(\d)-component vector of float'/);
      if (m) {
        const from = +m[1], to = +m[2];
        out = lineFix(out, e.line, l => l.replace(/((?:^|[;{(\s])[\w.\[\]]+\s*(?:[-+*/]?=)(?!=))\s*([^;]+);/, (all, lhs, rhs) =>
          `${lhs} ${from > to ? `(${rhs.trim()}).${sw[to]}` : `vec${to}(${rhs.trim()}${', 0.0'.repeat(to - from - (to === 4 ? 1 : 0))}${to === 4 ? ', 1.0' : ''})`};`));
      }
    }
    return out;
  }
  function intMix(code, errs) {
    const ints = [...new Set([...mask(code).matchAll(/\bint\s+([A-Za-z_]\w*)\s*(?=[=;,)])/g)].map(m => m[1]))];
    let out = code;
    for (const e of errs) {
      if (!/wrong operand types.*\bint\b|no matching overloaded function found/.test(e.msg)) continue;
      out = lineFix(out, e.line, l => {
        if (/\bfor\s*\(/.test(l)) return l;
        let n = floatLiterals(l);
        for (const v of ints) n = n.replace(new RegExp('(?<![\\w.]|int\\s|float\\()\\b' + v + '\\b(?!\\s*(?:\\+\\+|--|[-+*/%]?=(?!=)|\\[|\\]))', 'g'), `float(${v})`);
        return n;
      });
    }
    return out;
  }

  // 8. eigene (kaputte) Rausch-/Zufallsfunktionen des Modells entfernen – die der App springen ein (helpers)
  const OWN_HELPERS = ['noise', 'snoise', 'fbm', 'hash', 'rand', 'random', 'palette'];
  function replaceHelpers(code) {
    const fs = functions(code).filter(f => f.depth === 0 && OWN_HELPERS.includes(f.name));
    if (!fs.length) return code;
    let out = code;
    for (const f of fs.slice().sort((a, b) => b.start - a.start)) out = out.slice(0, f.start) + out.slice(f.end);
    // auch Prototypen dieser Namen entfernen
    return out.replace(new RegExp('^[ \\t]*' + TY + '\\s+(?:' + OWN_HELPERS.join('|') + ')\\s*\\([^(){};]*\\)\\s*;[ \\t]*\\n?', 'gm'), '');
  }

  /* Gierig retten: jede Korrektur wird übernommen, sobald sie Fehler beseitigt – auch wenn noch andere übrig bleiben.
     compile(code) liefert null (kompiliert) oder { log, offset } (offset = Zeile, ab der der Code des Modells beginnt).
     Ergebnis: { code, log, fixes } – log null = kompiliert. */
  async function rescueGreedy(code, compile, first) {
    const parse = r => r ? String(r.log).split('\n').map(x => x.match(/^(?:ERROR):\s*\d+:(\d+):\s*(.*)$/)).filter(Boolean).map(m => ({ line: +m[1] - r.offset, msg: m[2] })) : [];
    const count = r => parse(r).length || 1;
    const first1 = r => parse(r)[0] || { line: 0, msg: '' };
    const lines = c => c.split('\n').length;
    const steps = [['Typen in der Fehlerzeile angepasst', toVec], ['Vektorgrößen in der Fehlerzeile angepasst', vecMix], ['Ganzzahlen in der Fehlerzeile', intMix],
      ['Prototypen ergänzt', prototypes], ['verschachtelte Funktionen herausgelöst', hoist], ['Klammern ergänzt', braces],
      ['Ganzzahlen als Kommazahlen', floatLiterals], ['Schleifenzähler als Kommazahl', c => floatLiterals(floatLoops(c))], ['Schleifenzähler als Kommazahl', floatLoops],
      ['fragColor als vec4', fragColor], ['reservierte Namen umbenannt', reserved], ['eigene Rauschfunktion durch die der App ersetzt', replaceHelpers]];
    let cur = code, res = first === undefined ? await compile(code) : first;
    const fixes = [];
    for (let pass = 0; pass < 3 && res; pass++) {
      let moved = false;
      for (const [name, f] of steps) {
        const c2 = f(cur, parse(res));
        if (c2 === cur) continue;
        const r2 = await compile(c2);
        // Fortschritt: kompiliert oder weniger Fehler. Syntaxfehler meldet der Compiler einzeln – dort zählt auch, wenn der erste
        // Fehler danach weiter hinten liegt (oben eingefügte Zeilen herausgerechnet)
        const a = first1(res), b = r2 && first1(r2), shift = Math.max(0, lines(c2) - lines(cur));
        // ein neuer Syntaxfehler verdeckt die übrigen Meldungen – das ist kein Fortschritt
        const newSyntax = r2 && /syntax error/.test(b.msg) && !/syntax error/.test(a.msg);
        if (!newSyntax && (!r2 || count(r2) < count(res) || (count(r2) === count(res) && /syntax error/.test(a.msg) && b.line - shift > a.line))) {
          cur = c2; res = r2; moved = true; if (!fixes.includes(name)) fixes.push(name);
          if (!res) break;
        }
      }
      if (!moved) break;
    }
    return { code: cur, log: res ? res.log : null, fixes };
  }

  return { PRELUDE, body, source, pre, isToy, tidy, helpers, rescue, rescueGreedy, _t: { prototypes, hoist, braces, floatLoops, floatLiterals, functions, fragColor, reserved, toVec, vecMix, intMix, replaceHelpers }, uniforms, uniformName, inputsOf, staticCheck, localizeLog, codeLineOffset };
})();
