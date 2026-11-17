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
#define iDate vec4(2026.0, 1.0, 1.0, uPhase * uLoopSec)`;
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
    ['rot', 'float', 'mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }'],
    ['rotate', 'float', 'mat2 rotate(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }'],
    ['rotate2d', 'float', 'mat2 rotate2d(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }'],
    ['smin', 'float', 'float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-5), 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }'],
    ['palette', 'float', 'vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b * cos(6.28318530718 * (c * t + d)); }'],
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
    const list = HELPERS.filter(([n, arg]) => used(n) && !own(n, arg)).map(h => h[2]);
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
    if (/\biChannel\d|\b(?:texture|texelFetch|textureLod)\s*\(/.test(c)) e.push('Es gibt keine Texturen/iChannel – alles muss prozedural entstehen.');
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

  return { PRELUDE, body, source, pre, isToy, tidy, helpers, uniforms, uniformName, staticCheck, localizeLog, codeLineOffset };
})();
