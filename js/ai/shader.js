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

  const uniformName = id => 'u_' + id;
  const decl = params => params.map(p => `uniform ${p.type === 'color' ? 'vec3' : 'float'} ${uniformName(p.id)};`).join('\n');

  // Rumpf für die Funktion (wird von CG.glsl.build um Kopf, Rauschen und Finish ergänzt)
  const body = (params, code) => `${decl(params)}\n${PRELUDE}\n${MARK}\n${code}\n${EFFECT}`;
  const source = (params, code) => CG.glsl.build({ glsl: body(params, code) });

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
      if (und) hint = und[1].toLowerCase() === 'u_res' || und[1] === 'iResolution' ? ' (heißt uRes)' : und[1] === 'iTime' ? ' (heißt t)' : ' (nicht definiert – nur uv, p, t, uRes, deine u_<id> und die genannten Helfer gibt es)';
      return `Zeile ${n}: ${m[2]}${hint}${code ? `  →  ${code}` : ''}`;
    });
  }

  // Werte der Regler -> Uniform-Liste für den Worker
  function uniforms(params, values) {
    return params.map(p => {
      let v = values && p.id in values ? values[p.id] : p.default;
      if (p.type === 'color') return [uniformName(p.id), 'vec3', CG.util.hexToRgb(v)];
      if (p.type === 'toggle') v = v ? 1 : 0;
      else if (p.type === 'select') v = Math.max(0, p.options.indexOf(String(v)));
      return [uniformName(p.id), 'float', +v || 0];
    });
  }

  /* Statische Prüfung: Funktion vorhanden, keine Texturen, Schleifen mit fester Obergrenze (sonst kann die GPU hängen) */
  function staticCheck(code) {
    const e = [];
    const c = String(code || '').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    if (!c.trim()) return ['Das Feld "shader" ist leer.'];
    if (!/vec3\s+image\s*\(\s*vec2\s+\w+\s*,\s*vec2\s+\w+\s*,\s*float\s+\w+\s*\)/.test(c)) e.push('Es fehlt die Funktion  vec3 image(vec2 uv, vec2 p, float t).');
    if (/\b(?:texture|texelFetch|textureLod)\s*\(/.test(c)) e.push('Texturen sind nicht erlaubt.');
    if (/\bwhile\s*\(/.test(c)) e.push('while-Schleifen sind nicht erlaubt – nur for-Schleifen mit fester Obergrenze.');
    if (/^\s*#\s*version/m.test(c)) e.push('Keine #version-Zeile – die App setzt sie selbst.');
    if (/\buniform\s+\w+\s+u_/.test(c)) e.push('Die Regler-Uniforms (u_…) nicht selbst deklarieren – die App erzeugt sie.');
    if (/\bvoid\s+main\s*\(/.test(c)) e.push('Keine main()-Funktion – nur image() und eigene Hilfsfunktionen.');
    for (const m of c.matchAll(/for\s*\(([^;]*);([^;]*);/g)) {
      const cond = m[2].trim(), lit = cond.match(/^\w+\s*<=?\s*(\d+)(?:\.0*)?$/);
      if (!lit) { e.push(`Schleife „for (${m[1].trim()}; ${cond}; …)“: Obergrenze muss eine feste Zahl sein, z. B. for (int i = 0; i < 32; i++) { if (float(i) >= u_count) break; }`); break; }
      if (+lit[1] > 256) { e.push(`Schleife mit ${lit[1]} Durchläufen ist zu teuer (höchstens 256, besser ≤ 64).`); break; }
    }
    return e;
  }

  return { PRELUDE, body, source, uniforms, uniformName, staticCheck, localizeLog, codeLineOffset };
})();
