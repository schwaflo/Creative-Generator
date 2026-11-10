'use strict';
/* Minimaler Test-Runner für den Browser (keine Abhängigkeiten). */
window.T = (() => {
  const tests = [];
  let group = '';
  const describe = (name, fn) => { group = name; fn(); group = ''; };
  const it = (name, fn) => tests.push({ name: (group ? group + ' › ' : '') + name, fn });
  class AssertError extends Error {}
  const fmt = v => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
  const assert = {
    ok: (v, msg) => { if (!v) throw new AssertError(msg || `erwartet wahr, ist ${fmt(v)}`); },
    equal: (a, b, msg) => { if (a !== b) throw new AssertError(msg || `erwartet ${fmt(b)}, ist ${fmt(a)}`); },
    deepEqual: (a, b, msg) => { if (fmt(a) !== fmt(b)) throw new AssertError(msg || `erwartet ${fmt(b)}, ist ${fmt(a)}`); },
    match: (s, re, msg) => { if (!re.test(String(s))) throw new AssertError(msg || `${fmt(s)} passt nicht zu ${re}`); },
    includes: (arr, v, msg) => { if (!(arr || []).some(x => typeof v === 'string' ? String(x).includes(v) : x === v)) throw new AssertError(msg || `${fmt(v)} nicht enthalten in ${fmt(arr)}`); },
    rejects: async (p, re) => { try { await p; } catch (e) { if (re && !re.test(e.message)) throw new AssertError(`falscher Fehler: ${e.message}`); return e; } throw new AssertError('kein Fehler geworfen'); },
  };
  async function run(out) {
    let pass = 0, fail = 0;
    const results = [];
    for (const t of tests) {
      const t0 = performance.now();
      try { await t.fn(); pass++; results.push({ name: t.name, ok: true, ms: performance.now() - t0 }); }
      catch (e) { fail++; results.push({ name: t.name, ok: false, error: e.message, ms: performance.now() - t0 }); console.error(t.name, e); }
    }
    if (out) {
      out.innerHTML = `<h2 class="${fail ? 'bad' : 'good'}">${pass} bestanden · ${fail} fehlgeschlagen</h2>` +
        results.map(r => `<div class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'} ${r.name} <small>${Math.round(r.ms)} ms</small>${r.ok ? '' : `<pre>${r.error.replace(/</g, '&lt;')}</pre>`}</div>`).join('');
    }
    window.__testResult = { pass, fail, results };
    return window.__testResult;
  }
  return { describe, it, assert, run };
})();
