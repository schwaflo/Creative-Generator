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
  const decl = params => params.map(p => `uniform ${p.type === 'color' ? 'vec3' : 'float'} ${uniformName(p.id)};`).join('\n');

  // Rumpf für die Funktion (wird von CG.glsl.build um Kopf, Rauschen und Finish ergänzt)
  const body = (params, code) => isToy(code)
    ? `${TOY_HEAD}\n${decl(params)}\n${MARK}\n${code}\n${TOY_EFFECT}`
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
      const code = (lines[+m[1] - 1] || '').trim().slice(0, 140);
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
  function tidy(params, code) {
    const fixes = [];
    let src = String(code || '');
    const out = (Array.isArray(params) ? params : []).map(p => {
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || /^[A-Za-z_]\w*$/.test(p.id)) return p;
      const id = p.id.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '_').replace(/^(\d)/, '_$1') || 'p';
      const esc = p.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      src = src.replace(new RegExp('\\bu_' + esc + '(?![\\wäöüÄÖÜß])', 'g'), 'u_' + id);
      fixes.push(`${p.id} → ${id}`);
      return { ...p, id };
    });
    const before = src;
    src = src.replace(/^[ \t]*uniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+u_\w+(?:\s*,\s*u_\w+)*\s*;[ \t]*\n?/gm, '');
    if (src !== before) fixes.push('eigene Uniform-Deklarationen entfernt');
    return { params: out, code: src, fixes };
  }

  return { PRELUDE, body, source, pre, isToy, tidy, uniforms, uniformName, staticCheck, localizeLog, codeLineOffset };
})();
