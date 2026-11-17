'use strict';
/* KI: Antworten der Modelle robust auswerten (Codeblock / JSON herauslösen). */
CG.ai = CG.ai || {};
CG.ai.parse = (() => {
  /* Codeblock aus einer Modellantwort holen.
     - bevorzugt ```js / ```javascript-Blöcke, sonst beliebige ```-Blöcke
     - mehrere Blöcke: der mit `draw` (und der längste)
     - ohne Zaun: ganze Antwort, falls sie nach Code aussieht
     - abgeschnittener Block (fehlender Schluss-Zaun) wird trotzdem genommen */
  function extractCode(text) {
    const s = String(text || '').replace(/\r\n?/g, '\n');
    const blocks = [];
    const re = /```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)(?:```|$(?![\s\S]))/g;
    let m;
    while ((m = re.exec(s))) {
      const lang = (m[1] || '').toLowerCase(), body = m[2].replace(/\s+$/, '');
      if (!body.trim()) continue;
      if (lang && !['js', 'javascript', 'jsx', 'ecmascript', 'mjs', 'ts', 'typescript'].includes(lang)) continue;
      blocks.push(body);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (blocks.length) {
      const score = b => (/\bfunction\s+draw\b|\bdraw\s*=/.test(b) ? 1e6 : 0) + (/\bparams\b/.test(b) ? 1e5 : 0) + b.length;
      return blocks.sort((a, b) => score(b) - score(a))[0].trim() + '\n';
    }
    if (/\bfunction\s+draw\b/.test(s) && /\bparams\b/.test(s)) {
      // Fließtext vor/nach dem Code abschneiden
      const start = s.search(/^(?:const|let|var|function|\/\/|\/\*)/m);
      return (start >= 0 ? s.slice(start) : s).trim() + '\n';
    }
    return null;
  }

  /* JSON-Objekt aus Text holen (auch mit Zaun oder Fließtext drumherum). */
  function extractJson(text) {
    const s = String(text || '').trim();
    try { return JSON.parse(s); } catch (e) { /* weiter */ }
    const fence = s.match(/```(?:json)?\s*\n([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch (e) { /* weiter */ } }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* weiter */ } }
    return null;
  }

  /* Antwort des Code-Schritts: {"code": "..."} – sonst Codeblock aus Freitext (Ausweichstufe) */
  function extractGenerated(text) {
    const j = extractJson(text);
    if (j && typeof j.code === 'string' && j.code.trim()) {
      const inner = /```/.test(j.code) ? extractCode(j.code) : null;
      return (inner || j.code).trim() + '\n';
    }
    return extractCode(text);
  }

  /* GLSL aus dem Feld "shader" (oder Freitext) – Zäune und #version entfernen */
  function extractShader(text) {
    // GLSL kennt keine Zeichenketten: doppelt maskierte Umbrüche/Tabs aus dem JSON sind immer Fehler des Modells
    let s = String(text || '').replace(/\r\n?/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '  ');
    const m = s.match(/```[ \t]*(?:glsl|frag|c|cpp|hlsl)?[^\n]*\n([\s\S]*?)(?:```|$(?![\s\S]))/);
    if (m && /image\s*\(/.test(m[1])) s = m[1];
    s = s.replace(/^\s*#\s*version[^\n]*\n/m, '').replace(/^\s*precision\s+\w+\s+float\s*;\s*$/m, '');
    s = s.replace(/\}\s*["']\s*\}?\s*$/, '}');                      // Rest vom JSON am Ende des Codes:  }"}
    return s.trim() ? s.trim() + '\n' : null;
  }

  return { extractCode, extractJson, extractGenerated, extractShader };
})();
