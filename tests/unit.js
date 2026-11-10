'use strict';
/* Unit-Tests: Parser, Prompt-Builder, Schema-Validierung, Sandbox, Prüfung */
const { describe, it, assert } = T;
const AI = CG.ai;

/* ---------- Parser ---------- */
describe('parse.extractCode', () => {
  it('holt den ```js-Block aus Fließtext', () => {
    const c = AI.parse.extractCode('Hier ist der Code:\n```js\nconst params = [];\nfunction draw(){}\n```\nViel Spaß!');
    assert.equal(c, 'const params = [];\nfunction draw(){}\n');
  });
  it('akzeptiert ```javascript und Zaun ohne Sprache', () => {
    assert.match(AI.parse.extractCode('```javascript\nfunction draw(){}\nconst params=[]\n```'), /function draw/);
    assert.match(AI.parse.extractCode('```\nconst params=[];function draw(){}\n```'), /function draw/);
  });
  it('wählt bei mehreren Blöcken den mit draw()', () => {
    const c = AI.parse.extractCode('```js\nconsole.log(1)\n```\n\n```js\nconst params=[];\nfunction draw(ctx){}\n```');
    assert.match(c, /function draw/);
  });
  it('ignoriert JSON-/Bash-Blöcke', () => {
    const c = AI.parse.extractCode('```json\n{"a":1}\n```\n```js\nconst params=[];function draw(){}\n```');
    assert.match(c, /function draw/);
  });
  it('nimmt einen abgeschnittenen Block (fehlender Schluss-Zaun)', () => {
    assert.match(AI.parse.extractCode('```js\nconst params = [];\nfunction draw(ctx) {\n  ctx.fillRect(0,0,1,1);\n}'), /fillRect/);
  });
  it('erkennt Code ohne Zaun', () => {
    assert.match(AI.parse.extractCode('Sure!\nconst params = [];\nfunction draw(ctx, p, t) {}'), /^const params/);
  });
  it('liefert null ohne Code', () => { assert.equal(AI.parse.extractCode('Tut mir leid, das kann ich nicht.'), null); });
});

describe('parse.extractJson', () => {
  it('direktes JSON', () => assert.deepEqual(AI.parse.extractJson('{"a":1}'), { a: 1 }));
  it('JSON im Zaun', () => assert.deepEqual(AI.parse.extractJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] }));
  it('JSON mit Text drumherum', () => assert.deepEqual(AI.parse.extractJson('Analyse: {"x":"y"} fertig'), { x: 'y' }));
  it('ungültig -> null', () => assert.equal(AI.parse.extractJson('{kaputt'), null));
});

/* ---------- Schema ---------- */
describe('schema.validateParams', () => {
  const good = [
    { id: 'count', label: 'Anzahl', type: 'range', min: 1, max: 50, step: 1, default: 10, group: 'Form' },
    { id: 'bg', label: 'Grund', type: 'color', default: '#112233' },
    { id: 'shape', label: 'Form', type: 'select', options: ['A', 'B'], default: 'B' },
    { id: 'lines', label: 'Linien', type: 'toggle', default: true },
    { id: 'seed', label: 'Seed', type: 'seed', default: 3 },
  ];
  it('akzeptiert gültiges Schema', () => {
    const v = AI.schema.validateParams(good);
    assert.ok(v.ok, v.errors.join(';'));
    assert.equal(v.params.length, 5);
    assert.equal(v.params[2].default, 'B');
  });
  it('kein Array -> Fehler', () => assert.ok(!AI.schema.validateParams({}).ok));
  it('doppelte id -> Fehler', () => assert.includes(AI.schema.validateParams([good[0], good[0]]).errors, 'doppelt'));
  it('ungültige id -> Fehler', () => assert.ok(!AI.schema.validateParams([{ ...good[0], id: '2bad' }]).ok));
  it('min >= max -> Fehler', () => assert.ok(!AI.schema.validateParams([{ ...good[0], min: 5, max: 5 }]).ok));
  it('default außerhalb wird begrenzt (Warnung)', () => {
    const v = AI.schema.validateParams([{ ...good[0], default: 999 }]);
    assert.ok(v.ok); assert.equal(v.params[0].default, 50); assert.ok(v.warnings.length);
  });
  it('fehlender step wird ergänzt', () => {
    const v = AI.schema.validateParams([{ id: 'a', type: 'range', min: 0, max: 2, default: 1 }]);
    assert.ok(v.ok); assert.equal(v.params[0].step, 0.02);
  });
  it('Farbe #abc wird zu #aabbcc, ungültige Farbe ist Fehler', () => {
    assert.equal(AI.schema.validateParams([{ id: 'c', type: 'color', default: '#abc' }]).params[0].default, '#aabbcc');
    assert.ok(!AI.schema.validateParams([{ id: 'c', type: 'color', default: 'red' }]).ok);
  });
  it('Typ-Synonyme (number, boolean) werden gelesen', () => {
    const v = AI.schema.validateParams([{ id: 'a', type: 'number', min: 0, max: 1, default: 0 }, { id: 'b', type: 'boolean', default: false }]);
    assert.ok(v.ok); assert.equal(v.params[0].type, 'range'); assert.equal(v.params[1].type, 'toggle');
  });
  it('select ohne Optionen -> Fehler', () => assert.ok(!AI.schema.validateParams([{ id: 's', type: 'select', options: ['x'] }]).ok));
  it('unbekannter Typ -> Fehler', () => assert.ok(!AI.schema.validateParams([{ id: 's', type: 'slider3d' }]).ok));
});

describe('schema.toGroups / Werte', () => {
  const v = AI.schema.validateParams([
    { id: 'count', label: 'Anzahl', type: 'range', min: 1, max: 50, step: 1, default: 10, group: 'Form' },
    { id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.1, default: 1, group: 'Bewegung' },
    { id: 'bg', label: 'Grund', type: 'color', default: '#112233' },
    { id: 'shape', label: 'Form', type: 'select', options: ['Kreis', 'Quadrat', 'Dreieck', 'Stern'], default: 'Kreis' },
    { id: 'lines', label: 'Linien', type: 'toggle', default: true },
    { id: 'seed', label: 'Seed', type: 'seed', default: 3 },
  ]).params;
  const groups = AI.schema.toGroups('ai-x', v);
  it('Gruppen nach group, Farben als Palette', () => {
    assert.deepEqual(groups.map(g => g.title), ['Form', 'Bewegung', 'Farbe']);
    assert.ok(groups[2].palette); assert.equal(groups[2].palettes[0].c.g_bg, '#112233');
  });
  it('Regler-Typen passend zum App-System', () => {
    const all = groups.flatMap(g => g.params);
    const by = id => all.find(p => p.key === 'g_' + id);
    assert.equal(by('count').min, 1);
    assert.equal(by('shape').type, 'select');                 // 4 Optionen -> Liste
    assert.equal(by('lines').type, 'segment');
    assert.equal(by('lines').def, 1);
    assert.equal(by('seed').action, 'random');
  });
  it('Zustand <-> Generator-Werte', () => {
    const vals = AI.schema.toGenValues(v, { g_count: '7', g_lines: 0, g_shape: 'Stern', g_seed: 12.4 });
    assert.equal(vals.count, 7); assert.equal(vals.lines, false); assert.equal(vals.shape, 'Stern'); assert.equal(vals.seed, 12);
    assert.equal(vals.bg, '#112233');                         // fehlender Wert -> default
    assert.deepEqual(AI.schema.fromGenValues(v, { lines: true, count: 3 }), { g_count: 3, g_lines: 1 });
  });
  it('cleanAnalysis ergänzt fehlende Felder', () => {
    const a = AI.schema.cleanAnalysis({ title: 'X', colors: [{ hex: 'fff', role: 'bg' }, { hex: 'nope' }], techniques: ['noise', 'magic'] });
    assert.deepEqual(a.colors, [{ hex: '#ffffff', role: 'bg' }]);
    assert.deepEqual(a.techniques, ['noise']);
    assert.ok(Array.isArray(a.shapes)); assert.equal(a.summary, '');
  });
});

/* ---------- Prompt-Builder ---------- */
describe('prompt', () => {
  const analysis = AI.schema.cleanAnalysis({ title: 'Kreisringe', summary: 'Konzentrische Ringe', colors: [{ hex: '#14213d', role: 'Hintergrund' }, { hex: '#fca311', role: 'Akzent' }],
    shapes: ['Kreise'], motion: 'langsames Pulsieren', techniques: ['circles'] });
  const p = AI.prompt.build({ analysis, wishes: 'Geschwindigkeitsregler\nSVG-Export', format: { w: 1920, h: 1080 } });
  it('enthält Analyse, Farben, Format und Wünsche', () => {
    assert.match(p, /Kreisringe/); assert.match(p, /#14213d, #fca311/); assert.match(p, /1920 × 1080/);
    assert.match(p, /Geschwindigkeitsregler/); assert.match(p, /langsames Pulsieren/);
  });
  it('enthält Vertrag und Beispiel', () => {
    assert.match(p, /function draw\(ctx, p, t, rng\)/); assert.match(p, /LOOPS SEAMLESSLY/); assert.match(p, /```js\nconst params = \[/);
  });
  it('ohne Wünsche kein Wunsch-Abschnitt', () => assert.ok(!/Additional wishes/.test(AI.prompt.build({ analysis, wishes: '', format: null }))));
  it('Reparatur-Prompt: Basis + Code + Fehler (konstante Länge)', () => {
    const base = AI.prompt.messages(p);
    const m = AI.prompt.repair(base, 'function draw(){}', ['Fehler A', 'Fehler B']);
    assert.equal(m.length, 4); assert.equal(m[2].role, 'assistant'); assert.match(m[3].content, /- Fehler A\n- Fehler B/);
  });
  it('Version ist gesetzt', () => assert.match(AI.prompt.VERSION, /^generator-v\d+$/));
  it('Analyse-Nachricht trägt das Bild', () => assert.deepEqual(AI.prompt.analysisMessages('QUJD')[1].images, ['QUJD']));
});

/* ---------- Sandbox & Prüfung ---------- */
describe('sandbox + validate', () => {
  const box = new AI.Sandbox({ timeout: 2500 });
  it('Beispiel-Generator besteht die Prüfung', async () => {
    const v = await AI.validate.run(AI.prompt.EXAMPLE, { sandbox: box, aspect: 16 / 9 });
    assert.ok(v.ok, v.errors.join(';')); assert.equal(v.params.length, 12);
  });
  it('rendert deterministisch (gleicher Seed -> gleiches Bild)', async () => {
    const vals = { blades: 120, height: 0.55, width: 1.6, layers: 3, curl: 0.8, glow: true, sway: 0.45, flow: 1.2, bg: '#0b1a22', body: '#3fa37a', light: '#f4e9c8', seed: 7 };
    await box.load(AI.prompt.EXAMPLE);
    const a = await box.render({ values: vals, t: 0.3, w: 64, h: 36, seed: 7, stats: true });
    const b = await box.render({ values: vals, t: 0.3, w: 64, h: 36, seed: 7, stats: true });
    a.bitmap.close(); b.bitmap.close();
    assert.deepEqual(a.stats.grid, b.stats.grid);
  });
  it('Syntaxfehler wird erkannt (ohne Ausführung)', async () => {
    const v = await AI.validate.run('const params = [;\nfunction draw(){}', { sandbox: box });
    assert.match(v.errors[0], /Syntaxfehler/);
  });
  it('verbotene APIs werden gemeldet', () => {
    const e = AI.validate.staticCheck('const params=[];function draw(){ fetch("x"); document.body; }');
    assert.includes(e, 'fetch'); assert.includes(e, 'document');
  });
  it('Endlosschleife -> Timeout, Sandbox erholt sich', async () => {
    const code = 'const params=[{id:"a",type:"range",min:0,max:1,step:0.1,default:0.5}];\nfunction draw(ctx){ while(1>0){} }';
    const v = await AI.validate.run(code, { sandbox: box, renderMs: 800 });
    assert.match(v.errors[0], /hängt/);
    const ok = await AI.validate.run(AI.prompt.EXAMPLE, { sandbox: box });
    assert.ok(ok.ok, 'nach Timeout wieder nutzbar');
  });
  it('Laufzeitfehler mit Zeilennummer', async () => {
    const v = await AI.validate.run('const params=[{id:"a",type:"range",min:0,max:1,step:0.1,default:0.5}];\nfunction draw(ctx){\n  ctx.fillRect(0,0,9,9);\n  undefinedThing();\n}', { sandbox: box });
    assert.match(v.errors[0], /Zeile 4/);
  });
  it('leeres Bild wird erkannt', async () => {
    const v = await AI.validate.run('const params=[{id:"a",type:"range",min:0,max:1,step:0.1,default:0.5}];\nfunction draw(ctx){ ctx.fillStyle="#123456"; ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height); }', { sandbox: box });
    assert.match(v.errors[0], /leer/);
  });
  it('Absturz bei Extremwerten der Regler wird gemeldet', async () => {
    const code = 'const params=[{id:"n",type:"range",min:0,max:10,step:1,default:5}];\nfunction draw(ctx,p){ ctx.fillStyle="#fff"; ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height); ctx.fillStyle="#000"; ctx.fillRect(0,0,ctx.canvas.width/2,ctx.canvas.height/2); if (p.n === 0) throw new Error("n ist 0"); }';
    const v = await AI.validate.run(code, { sandbox: box });
    assert.match(v.errors[0], /Minimalwerte/);
  });
  it('kein Netzwerk, kein Speicher der App in der Sandbox', async () => {
    await box.load('const params=[];\nconst probe = [typeof fetch, typeof XMLHttpRequest, typeof indexedDB, typeof importScripts].join(",");\nfunction draw(){ throw new Error(probe); }');
    const e = await T.assert.rejects(box.render({ values: {}, t: 0, w: 8, h: 8 }));
    assert.equal(e.message, 'undefined,undefined,undefined,undefined');
  });
  it('SVG-Export zeichnet Vektoren', async () => {
    await box.load(AI.prompt.EXAMPLE);
    const svg = await box.svg({ values: { blades: 10, height: 0.5, width: 2, layers: 2, curl: 0.5, glow: true, sway: 0.3, flow: 1, bg: '#000000', body: '#00ff00', light: '#ffffff', seed: 1 }, t: 0, w: 200, h: 100, seed: 1 });
    assert.match(svg, /^<svg[^>]+viewBox="0 0 200 100"/); assert.match(svg, /<path d="M/);
  });
  it('SVG-Export meldet nicht unterstützte Befehle', async () => {
    await box.load('const params=[];\nfunction draw(ctx){ ctx.getImageData(0,0,1,1); }');
    await T.assert.rejects(box.svg({ values: {}, t: 0, w: 10, h: 10 }), /SVG-Export nicht möglich/);
  });
});

/* ---------- Client (Netzwerk durch Attrappen ersetzt) ---------- */
describe('client', () => {
  const S = AI.settings;
  // Einstellungen nur im Speicher verändern (nichts im localStorage)
  async function withServer(conf, fn) {
    const saved = { api: S.api, url: S.url, key: S.key, server: S.server }, realFetch = window.fetch;
    S.api = () => conf.api; S.url = () => conf.url; S.key = () => conf.key || ''; S.server = () => ({ id: conf.api, label: conf.api, api: conf.api });
    const calls = [];
    window.fetch = async (url, init = {}) => {
      calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
      const r = conf.reply(calls.length, calls[calls.length - 1]);
      if (r instanceof Error) throw r;
      return new Response(r.body, { status: r.status || 200, headers: { 'Content-Type': r.type || 'application/json' } });
    };
    try { return await fn(calls); } finally { Object.assign(S, saved); window.fetch = realFetch; }
  }
  const sse = (...parts) => parts.map(p => 'data: ' + JSON.stringify(p) + '\n\n').join('') + 'data: [DONE]\n\n';
  const delta = (content, extra = {}) => ({ choices: [{ delta: { content, ...extra } }] });
  const schema = { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] };

  it('OpenAI: json_schema, Bilder als image_url, Schlüssel, SSE inkl. Denk-Teilen', () => withServer({
    api: 'openai', url: 'http://x:1234', key: 'geheim',
    reply: () => ({ body: sse(delta('', { reasoning: 'hm' }), delta('{"code":'), delta('"a"}')), type: 'text/event-stream' }),
  }, async calls => {
    let ticks = 0;
    const r = await AI.client.chat({ model: 'm', schema, noThink: true, messages: [{ role: 'user', content: 'Bild', images: ['QUJD'] }] }, { onChunk: () => ticks++ });
    assert.equal(r.text, '{"code":"a"}'); assert.equal(ticks, 3);
    const c = calls[0];
    assert.equal(c.url, 'http://x:1234/v1/chat/completions');
    assert.equal(c.init.headers.Authorization, 'Bearer geheim');
    assert.equal(c.body.response_format.type, 'json_schema');
    assert.deepEqual(c.body.response_format.json_schema.schema, schema);
    assert.equal(c.body.reasoning_effort, 'none');
    assert.equal(c.body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
  }));

  it('OpenAI: Ausweichstufen json_schema -> json_object -> Text', () => withServer({
    api: 'openai', url: 'http://fallback:1',
    reply: n => n < 3 ? { status: 400, body: '{"error":{"message":"response_format not supported"}}' } : { body: sse(delta('{"code":"x"}')) },
  }, async calls => {
    const r = await AI.client.chat({ model: 'm2', schema, messages: [{ role: 'user', content: 'Aufgabe' }] });
    assert.equal(r.text, '{"code":"x"}');
    assert.equal(calls[0].body.response_format.type, 'json_schema');
    assert.equal(calls[1].body.response_format.type, 'json_object');
    assert.equal(calls[2].body.response_format, undefined);
    assert.match(calls[2].body.messages[0].content, /JSON-Schema/);
    // die funktionierende Stufe wird gemerkt
    await AI.client.chat({ model: 'm2', schema, messages: [{ role: 'user', content: 'nochmal' }] });
    assert.equal(calls[3].body.response_format, undefined);
  }));

  it('OpenAI: unbekanntes reasoning_effort -> ohne erneut, Format bleibt', () => withServer({
    api: 'openai', url: 'http://noreason:1',
    reply: n => n === 1 ? { status: 400, body: '{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}' } : { body: sse(delta('{"code":"y"}')) },
  }, async calls => {
    await AI.client.chat({ model: 'm', schema, noThink: true, messages: [{ role: 'user', content: 'x' }] });
    assert.equal(calls[1].body.reasoning_effort, undefined);
    assert.equal(calls[1].body.response_format.type, 'json_schema');
  }));

  it('Ollama: /api/chat mit format, NDJSON', () => withServer({
    api: 'ollama', url: 'http://localhost:11434',
    reply: () => ({ body: '{"message":{"content":"{\\"a\\""}}\n{"message":{"content":":1}"}}\n{"done":true}\n', type: 'application/x-ndjson' }),
  }, async calls => {
    const r = await AI.client.chat({ model: 'g', schema, numCtx: 8192, keepAlive: 0, think: false, messages: [{ role: 'user', content: 'x' }] });
    assert.equal(r.text, '{"a":1}');
    assert.equal(calls[0].url, 'http://localhost:11434/api/chat');
    assert.deepEqual(calls[0].body.format, schema);
    assert.equal(calls[0].body.options.num_ctx, 8192); assert.equal(calls[0].body.keep_alive, 0); assert.equal(calls[0].body.think, false);
  }));

  it('Fehler: Modell fehlt -> ollama pull …', () => withServer({
    api: 'ollama', url: 'http://localhost:11434', reply: () => ({ status: 404, body: '{"error":"model \'abc\' not found"}' }),
  }, async () => {
    const e = await T.assert.rejects(AI.client.chat({ model: 'abc', messages: [{ role: 'user', content: 'x' }] }));
    assert.equal(e.code, 'model_missing'); assert.match(e.message, /ollama pull abc/);
  }));

  it('Fehler: keine Verbindung (CORS/Server aus) und 401', async () => {
    await withServer({ api: 'openai', url: 'http://localhost:1234', reply: () => new TypeError('Failed to fetch') }, async () => {
      const e = await T.assert.rejects(AI.client.models());
      assert.equal(e.code, 'unreachable'); assert.equal(e.detail.reason, 'cors');
    });
    await withServer({ api: 'openai', url: 'https://cloud.example', reply: () => ({ status: 401, body: '{"error":{"message":"bad key"}}' }) }, async () => {
      const e = await T.assert.rejects(AI.client.models());
      assert.equal(e.code, 'auth');
    });
  });

  it('Modelle: Ollama /api/tags bzw. OpenAI /v1/models', async () => {
    await withServer({ api: 'openai', url: 'http://l:1', reply: () => ({ body: '{"data":[{"id":"qwen"},{"id":"llava"}]}' }) }, async calls => {
      assert.deepEqual((await AI.client.models()).map(m => m.name), ['qwen', 'llava']);
      assert.equal(calls[0].url, 'http://l:1/v1/models');
    });
    await withServer({ api: 'ollama', url: 'http://l:2', reply: () => ({ body: '{"models":[{"name":"g:1","capabilities":["vision"]}]}' }) }, async calls => {
      const m = await AI.client.models();
      assert.equal(m[0].name, 'g:1'); assert.deepEqual(m[0].capabilities, ['vision']);
      assert.equal(calls[0].url, 'http://l:2/api/tags');
    });
  });

  it('Code-Antwort: {"code": …} und Ausweichstufe Freitext', () => {
    assert.equal(AI.parse.extractGenerated('{"code":"const params=[];\\nfunction draw(){}"}'), 'const params=[];\nfunction draw(){}\n');
    assert.match(AI.parse.extractGenerated('{"code":"```js\\nconst params=[];function draw(){}\\n```"}'), /^const params/);
    assert.match(AI.parse.extractGenerated('Hier:\n```js\nconst params=[];\nfunction draw(){}\n```'), /function draw/);
  });
});

/* ---------- Generator-Speicher (Browser) ---------- */
describe('store', () => {
  it('Datei-Export ohne ID, Import mit neuer ID und geprüftem Schema', async () => {
    const g = { id: 'alt', name: 'Test-Import', code: 'const params=[];function draw(){}', params: [{ id: 'a', type: 'range', min: 0, max: 1, default: 2 }], presets: [] };
    const txt = AI.store.toFile(g);
    assert.ok(!/"id": "alt"/.test(txt));
    const [r] = await AI.store.fromFile(txt);
    assert.ok(r.id && r.id !== 'alt');
    assert.equal(r.params[0].default, 1);                         // auf max begrenzt
    assert.equal((await AI.store.get(r.id)).name, 'Test-Import');
    await AI.store.remove(r.id);
    assert.equal(await AI.store.get(r.id), undefined);
  });
  it('kaputte Datei wird abgelehnt', async () => {
    await T.assert.rejects(AI.store.fromFile('{"type":"generator","generator":{"name":"x"}}'), /unvollständig/);
    await T.assert.rejects(AI.store.fromFile('{"foo":1}'), /Keine Generator-Datei/);
  });
});


/* ---------- Zeichenhilfen in der Sandbox ---------- */
describe('Zeichenhilfen', () => {
  const box = new AI.Sandbox({ timeout: 2500 });
  it('noise, loopNoise (nahtlos), smoothPath, Farben stehen bereit', async () => {
    await box.load(`const params=[];
const r = [noise(0.3, 0.7, 0.1), fbm(1.2, 3.4, 0, 4), loopNoise(0.5, 0.5, 0, 1, 3) - loopNoise(0.5, 0.5, 1, 1, 3), mix('#000000', '#ffffff', 0.5), rgba('#ff0000', 0.5), shade('#808080', 1), typeof smoothPath, TAU];
function draw(ctx){ throw new Error(JSON.stringify(r)); }`);
    const e = await T.assert.rejects(box.render({ values: {}, t: 0, w: 8, h: 8 }));
    const r = JSON.parse(e.message);
    assert.ok(Math.abs(r[0]) <= 1.5 && r[0] !== 0); assert.ok(Math.abs(r[1]) <= 1.5);
    assert.ok(Math.abs(r[2]) < 1e-9, 'loopNoise bei t=0 und t=1 gleich');
    assert.equal(r[3], 'rgb(128,128,128)'); assert.equal(r[4], 'rgba(255,0,0,0.5)'); assert.equal(r[5], 'rgb(255,255,255)');
    assert.equal(r[6], 'function'); assert.ok(Math.abs(r[7] - Math.PI * 2) < 1e-12);
  });
  it('Prompt v3 enthält Hilfen, Qualitätsregeln und Bildvergleich', () => {
    assert.match(AI.prompt.CONTRACT, /smoothPath\(ctx, points, closed\)/);
    assert.match(AI.prompt.CONTRACT, /QUALITY/);
    const m = AI.prompt.reviewMessages('CMP', { title: 'X' });
    assert.deepEqual(m[1].images, ['CMP']); assert.match(m[1].content, /LINKS[\s\S]*REFERENZ[\s\S]*RECHTS/);
    assert.deepEqual(AI.prompt.messages('p', 'IMG')[1].images, ['IMG']);
    assert.equal(AI.prompt.messages('p')[1].images, undefined);
    const r = AI.prompt.refine([{ role: 'user', content: 'p' }], 'code', { score: 3, matches: [], problems: ['A'], improvements: ['B'] }, 'CMP');
    assert.equal(r.length, 3); assert.deepEqual(r[2].images, ['CMP']); assert.match(r[2].content, /3\/10[\s\S]*- A[\s\S]*- B/);
  });
});
