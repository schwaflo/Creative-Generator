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
  it('fehlende/ungültige Grenzen werden aus dem Standardwert ergänzt, ganz ohne Werte 0 … 1', () => {
    const v = AI.schema.validateParams([{ id: 'a', label: 'A', type: 'range', default: 0.4 }]);
    assert.ok(v.ok); assert.equal(v.params[0].min, 0); assert.equal(v.params[0].max, 0.8);
    const n = AI.schema.validateParams([{ id: 'a', type: 'range' }]);
    assert.ok(n.ok); assert.deepEqual([n.params[0].min, n.params[0].max, n.params[0].default], [0, 1, 0.5]);
  });
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
    const r = AI.schema.validateParams([{ id: 'c', type: 'color', default: 'red' }]);
    assert.ok(r.ok); assert.equal(r.params[0].default, '#808080');
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
});

/* ---------- Prompt-Builder ---------- */
/* ---------- Sandbox & Prüfung ---------- */
describe('sandbox + validate', () => {
  const box = new AI.Sandbox({ timeout: 2500 });
  it('Beispiel-Generator besteht die Prüfung', async () => {
    const v = await AI.validate.run(CANVAS_EXAMPLE, { sandbox: box, aspect: 16 / 9 });
    assert.ok(v.ok, v.errors.join(';')); assert.equal(v.params.length, 12);
  });
  it('rendert deterministisch (gleicher Seed -> gleiches Bild)', async () => {
    const vals = { blades: 120, height: 0.55, width: 1.6, layers: 3, curl: 0.8, glow: true, sway: 0.45, flow: 1.2, bg: '#0b1a22', body: '#3fa37a', light: '#f4e9c8', seed: 7 };
    await box.load(CANVAS_EXAMPLE);
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
    const ok = await AI.validate.run(CANVAS_EXAMPLE, { sandbox: box });
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
    await box.load(CANVAS_EXAMPLE);
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
});

/* ---------- Ebenen-Modus ---------- */
/* ---------- Modus „Direkt“ ---------- */
describe('Sandbox-Größen', () => {
  it('W, H, S stehen in setup() und draw() bereit', async () => {
    const box = new AI.Sandbox({ timeout: 2500 });
    await box.load(`const params = [];
let v = null;
function setup(ctx, p) { v = [W, H, S]; }
function draw(ctx) { throw new Error(JSON.stringify([v, W, H, S])); }`);
    const e = await T.assert.rejects(box.render({ values: {}, t: 0, w: 40, h: 30 }));
    assert.equal(e.message, '[[40,30,30],40,30,30]');
    box.destroy();
  });
});

/* ---------- Auftrag (Interface für das Modell) ---------- */
describe('Prompt', () => {
  const P = AI.prompt;
  it('Auftrag erklärt das Interface: Regler, Dropdown (Index), Schalter, Seed, Gruppen, Shader-Einstieg', () => {
    const t = P.text({ wishes: 'die Blops bewegen sich', format: { w: 2480, h: 3508 }, source: 'image' });
    assert.match(t, /die Blops bewegen sich/); assert.match(t, /portrait/);
    assert.match(t, /"type": "range"/); assert.match(t, /"type": "color"/); assert.match(t, /"type": "toggle"/); assert.match(t, /"type": "seed"/); assert.match(t, /"type": "select"/);
    assert.ok(!/"id": "|Tempo|Tinte|Leuchten/.test(t), 'keine fertigen Beispiel-Regler – die übernehmen die Modelle sonst wörtlich');
    assert.match(t, /iResolution \(vec3 – use iResolution\.xy/);
    assert.match(t, /index of the chosen option/);
    assert.match(t, /"group"/); assert.match(t, /u_<id>/);
    assert.match(t, /void mainImage\(out vec4 fragColor, in vec2 fragCoord\)/); assert.match(t, /iTime/); assert.match(t, /iLoop/);
    assert.match(P.VERSION, /^funktion-v\d+$/);
  });
  it('Drei Wege: Bild, Beschreibung (Platzhalter), nur Text', () => {
    assert.match(P.text({ wishes: 'w', source: 'image' }), /Here is a reference image/);
    const d = P.text({ wishes: 'w', source: 'description' });
    assert.ok(d.includes(P.SLOT)); assert.match(d, /You cannot see the image/);
    const t = P.text({ wishes: 'Tintenwolken in Blau', source: 'text' });
    assert.match(t, /^Build a generative function: an animated shader\. Tintenwolken in Blau/); assert.ok(!t.includes(P.SLOT)); assert.ok(!/reference image/.test(t));
    assert.deepEqual(P.messages('T', null)[1].images, undefined);
    assert.deepEqual(P.messages('T', 'IMG')[1].images, ['IMG']);
    assert.deepEqual(P.describeMessages('IMG')[0].images, ['IMG']);
  });
  it('Nächste Runde: Fehlerliste, eigener Bildvergleich oder Text-Kritik des zweiten Modells', () => {
    const base = P.messages('T', 'IMG'), a = { title: 'X', notes: 'n', params: [], shader: 's' };
    const look = P.feedback(base, a, { compareBase64: 'CMP' });
    assert.match(look[2].content, /^TITLE: X\nNOTES: n\n```json/); assert.match(look[3].content, /same format/);
    assert.equal(look.length, 4); assert.deepEqual(look[3].images, ['CMP']); assert.match(look[3].content, /LEFT the reference/);
    const err = P.feedback(base, a, { errors: ['Fehler A'], compareBase64: 'CMP' });
    assert.equal(err[3].images, undefined); assert.match(err[3].content, /- Fehler A/);
    const cr = P.feedback(base, a, { critique: 'Stränge zu dick', compareBase64: 'CMP' });
    assert.equal(cr[3].images, undefined); assert.match(cr[3].content, /Stränge zu dick/);
  });
  it('Verbessern: aktuelle Funktion (Regler + Code) und Änderungswunsch im Auftrag, Bild nur für Bild-Modelle', () => {
    const gen = { name: 'Wolken', params: [{ id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.01, default: 1 }], code: 'void mainImage(out vec4 f, in vec2 c){ f = vec4(u_speed); }' };
    const t = P.improveText({ gen, request: 'füge ein Dropdown für drei Farbstimmungen hinzu' });
    assert.match(t, /"id": "speed"/); assert.match(t, /void mainImage/); assert.match(t, /Dropdown für drei Farbstimmungen/);
    assert.match(t, /keep the ids of existing controls/); assert.match(t, /index of the chosen option/);
    assert.deepEqual(P.improveMessages(t, 'SHOT')[1].images, ['SHOT']);
    assert.equal(P.improveMessages(t, null)[1].images, undefined);
  });
  it('Auftrag ist knapp: keine Regelliste, keine Hilfsfunktions-Liste, kein Beispiel (prägt sonst den Stil)', () => {
    const t = P.text({ wishes: 'x', source: 'image', format: { w: 1000, h: 1500 } });
    assert.ok(t.length < 2200, 'Länge ' + t.length);
    assert.ok(!/Example|GLSL ES is strict|Helpers you may call|Farbwolken|recreate it as closely/.test(t));
    assert.match(t, /How you translate it is up to you/); assert.match(t, /you decide which controls fit your idea/);
  });
  it('Antwortform: TITLE/NOTES + json-Block + glsl-Block, kein JSON-Zwang', () => {
    const t = P.text({ wishes: 'x', source: 'text' });
    assert.match(t, /Answer like this:/); assert.match(t, /TITLE: <short German name>/);
    assert.ok(!/Answer with one JSON object/.test(t)); assert.ok(!/JSON object/.test(P.SYSTEM));
    const a = { title: 'Wolken', notes: 'zwei\nZeilen', params: [{ id: 'a', type: 'range' }], shader: 'void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }' };
    const back = AI.parse.extractFunction(P.format(a));
    assert.equal(back.title, 'Wolken'); assert.equal(back.notes, 'zwei Zeilen'); assert.deepEqual(back.params, a.params); assert.equal(back.shader.trim(), a.shader);
  });
  it('Antwort lesen: Varianten der Modelle (fett, deutsch, Block ohne Sprache, abgeschnitten, doch JSON)', () => {
    const X = AI.parse.extractFunction;
    const a = X('**TITLE:** "Tinte"\n**NOTES:** fließt\n\n```json\n[{"id": "s", "type": "range"}]\n```\n\nHier der Code:\n```\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }\n```');
    assert.equal(a.title, 'Tinte'); assert.equal(a.notes, 'fließt'); assert.equal(a.params.length, 1); assert.match(a.shader, /^void mainImage/);
    const b = X('Titel: Wellen\n```glsl\nfloat w(vec2 p){ return p.x; }\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(w(c));');
    assert.equal(b.title, 'Wellen'); assert.match(b.shader, /float w\(vec2 p\)/); assert.deepEqual(b.params, []);
    const c = X('{"title": "Alt", "notes": "n", "params": [{"id": "k", "type": "toggle"}], "shader": "void mainImage(out vec4 f, in vec2 c){ f = vec4(0.5); }"}');
    assert.equal(c.format, 'json'); assert.equal(c.title, 'Alt'); assert.equal(c.params[0].id, 'k'); assert.match(c.shader, /mainImage/);
    const d = X('TITLE: A\n```json\n{"params": [{"id": "z", "type": "seed"}]}\n```\n```glsl\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(0.0); }\n```');
    assert.equal(d.params[0].id, 'z');
  });
});

/* ---------- Ablauf: welcher Weg gilt ---------- */
describe('Ablauf', () => {
  const PL = AI.pipeline, set = o => Object.assign(AI.config, o), saved = { model: AI.config.model, describeModel: AI.config.describeModel };
  it('Bild-Modell sieht selbst; Text-Modell nutzt Beschreibung oder nur Text', () => {
    PL.setModels([{ name: 'seher', capabilities: ['completion', 'vision'] }, { name: 'coder', capabilities: ['completion'] }]);
    set({ model: 'seher', describeModel: '' });
    assert.equal(PL.plan(true).source, 'image'); assert.equal(PL.plan(false).source, 'text');
    set({ model: 'coder', describeModel: 'seher' });
    const d = PL.plan(true); assert.equal(d.source, 'description'); assert.equal(d.describer, 'seher'); assert.equal(d.vision, false);
    set({ model: 'coder', describeModel: '' });
    const t = PL.plan(true); assert.equal(t.source, 'text'); assert.equal(t.imageUnused, true);
  });
  it('Wiederholungsschleifen in der Antwort werden erkannt, normaler Code nicht', () => {
    const L = PL._looping;
    const code = AI.prompt.format(JSON.parse(AI.prompt.EXAMPLE));
    assert.equal(L(code + code.slice(0, 400)), false);
    const rep = 'col += vec3(0.1, 0.2, 0.3) * smoothstep(0.0, 1.0, length(uv - vec2(0.5, 0.5))) * sin(iTime * 2.0);\n';
    assert.equal(L(code + rep.repeat(4)), true);
    const counting = Array.from({ length: 30 }, (_, i) => `    vec3 layer${i} = mix(base, accent, smoothstep(0.${i % 9 + 1}, 0.9, noise(uv * ${i + 2}.0 + vec2(${i}.5, 1.25))));\n`).join('');
    assert.equal(L(code + counting), true, 'hochzählende Wiederholung');
    assert.equal(L('x'.repeat(25000)), true, 'Längengrenze');
  });
  it('Unbekannte Fähigkeiten (OpenAI-kompatibel): Bild direkt, außer ein Beschreibungs-Modell ist gewählt', () => {
    PL.setModels([{ name: 'x' }, { name: 'y' }]);
    set({ model: 'x', describeModel: '' }); assert.equal(PL.plan(true).source, 'image');
    set({ model: 'x', describeModel: 'y' }); assert.equal(PL.plan(true).source, 'description');
    set(saved); PL.setModels([]);
  });
});

/* ---------- Shader ---------- */
describe('Shader', () => {
  const box = new AI.Sandbox({ timeout: 4000 });
  // so, wie es der Auftrag beschreibt: Regler, Dropdown (Index), Schalter, Seed, Farbe
  const ex = { params: [
      { id: 'mode', label: 'Muster', type: 'select', options: ['Wellen', 'Kreise', 'Linien'], default: 'Wellen', group: 'Form' },
      { id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.01, default: 1, group: 'Bewegung' },
      { id: 'glow', label: 'Leuchten', type: 'toggle', default: true },
      { id: 'ink', label: 'Tinte', type: 'color', default: '#2ec4b6' },
      { id: 'seed', label: 'Seed', type: 'seed', default: 7 }],
    shader: ['void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
      '  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;',
      '  float t = iTime * u_speed, v;',
      '  if (u_mode < 0.5) v = sin(uv.x * 20.0 + sin(uv.y * 6.0 + t) * 2.0 + u_seed);',
      '  else if (u_mode < 1.5) v = sin(length(uv) * 40.0 - t * 3.0);',
      '  else v = sin((uv.x + uv.y) * 30.0 + t);',
      '  vec3 col = mix(vec3(0.05), u_ink, smoothstep(-0.2, 0.2, v));',
      '  col += u_glow * 0.25 * u_ink * (1.0 - length(uv));',
      '  fragColor = vec4(col, 1.0);', '}'].join('\n') };
  it('Funktion nach Auftrag (Dropdown, Regler, Schalter, Seed, Farbe) besteht die Prüfung', async () => {
    const v = await AI.validate.runShader(ex.params, ex.shader, { sandbox: box, aspect: 16 / 9 });
    assert.ok(v.ok, v.errors.join(' | ')); assert.equal(v.params.length, 5);
    assert.ok(!/Ohne sichtbare Wirkung/.test(v.warnings.join(' ')), v.warnings.join(' '));
  });
  it('Beispiel aus dem Auftrag besteht die Prüfung', async () => {
    const e = JSON.parse(AI.prompt.EXAMPLE), v = await AI.validate.runShader(e.params, e.shader, { sandbox: box, aspect: 16 / 9 });
    assert.ok(v.ok, v.errors.join(' | ')); assert.ok(!/Ohne sichtbare Wirkung/.test(v.warnings.join(' ')), v.warnings.join(' '));
  });
  it('Hilfsfunktionen: fehlende noise/fbm/hash werden ergänzt, eigene Fassungen bleiben, fehlende Überladung kommt dazu', async () => {
    const H = AI.shader.helpers;
    assert.equal(H('void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }'), '');
    assert.match(H('void mainImage(out vec4 f, in vec2 c){ f = vec4(fbm(c)); }'), /float fbm\(vec2 p\)/);
    const own = 'float noise(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; fragColor = vec4(vec3(noise(floor(uv * 9.0)) * noise(vec3(uv * 5.0, iTime))), 1.0); }';
    assert.ok(!/float noise\(vec2 p\)/.test(H(own)), 'eigene noise(vec2) bleibt'); assert.match(H(own), /float noise\(vec3 p\)/);
    const v = await AI.validate.runShader([], own, { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | '));
    const v2 = await AI.validate.runShader([], 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.y; uv *= rot(0.4); fragColor = vec4(palette(fbm(vec3(uv * 4.0, iTime)) + hash(floor(uv * 3.0)), vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)), 1.0); }', { sandbox: box });
    assert.ok(v2.ok, v2.errors.join(' | '));
  });
  it('Rettung: Ganzzahlen in Rechnungen, int-Schleifen, Funktionen vor Definition, verschachtelte Funktionen', async () => {
    const run = c => AI.validate.runShader([], c, { sandbox: box });
    const M = b => 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; ' + b + ' }';
    // pow(0.5, i) mit int-Schleife
    const a = await run(M('float v = 0.0; for (int i = 0; i < 5; i++) { v += pow(0.5, i) * sin(uv.x * 9.0 + float(i)); } fragColor = vec4(vec3(0.5 + 0.5 * v), 1.0);'));
    assert.ok(a.ok, a.errors.join(' | ')); assert.match(a.code, /for \(float i = float\(0(\.0)?\); i < float\(5(\.0)?\); i \+= 1\.0\)/); assert.ok(a.fixes.length);
    // Ganzzahl mal Kommazahl
    const b = await run(M('float k = uv.x * 2 + uv.y * 3; fragColor = vec4(vec3(fract(k)), 1.0);'));
    assert.ok(b.ok, b.errors.join(' | ')); assert.match(b.code, /uv\.x \* 2\.0 \+ uv\.y \* 3\.0/);
    // Funktion benutzt, bevor sie definiert ist
    const c = await run(M('fragColor = vec4(vec3(wave(uv)), 1.0);') + '\nfloat wave(vec2 p){ return 0.5 + 0.5 * sin(p.x * 20.0 + iTime); }');
    assert.ok(c.ok, c.errors.join(' | ')); assert.match(c.code, /^float wave\(vec2 p\);/);
    // Funktion innerhalb von mainImage
    const d = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  float ring(vec2 p){ return fract(length(p) * 8.0); }\n  vec2 uv = fragCoord / iResolution.y;\n  fragColor = vec4(vec3(ring(uv - 0.5)), 1.0);\n}');
    assert.ok(d.ok, d.errors.join(' | ')); assert.match(d.code, /^\s*float ring\(vec2 p\)/);
    // int-Anweisungen und Array-Indizes bleiben unverändert
    const L = AI.shader._t.floatLiterals('int n = 3; float a[4]; a[2] = 1; float x = y * 2; for (int i = 0; i < 4; i++) { x += a[i]; } int m = n % 2;');
    assert.equal(L, 'int n = 3; float a[4]; a[2] = 1.0; float x = y * 2.0; for (int i = 0; i < 4; i++) { x += a[i]; } int m = n % 2;');
    assert.equal(AI.shader._t.floatLiterals('float h = fract(sin(x) * 43758.5453e+2 * 3);'), 'float h = fract(sin(x) * 43758.5453e+2 * 3.0);', 'Exponent bleibt');
  });
  it('Rettung: fragColor mit vec3, reservierte Namen; Teilrettung gibt nur den Restfehler ans Modell', async () => {
    const run = c => AI.validate.runShader([], c, { sandbox: box });
    const a = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; vec3 col = vec3(uv, 0.5); fragColor = col; }');
    assert.ok(a.ok, a.errors.join(' | ')); assert.ok(a.fixes.includes('fragColor als vec4'));
    const b = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; float sample = fract(uv.x * 7.0); vec3 input = vec3(sample); fragColor = vec4(input, 1.0); }');
    assert.ok(b.ok, b.errors.join(' | ')); assert.match(b.code, /float sample_ = /); assert.match(b.code, /vec3 input_ = vec3\(sample_\)/);
    // zwei Fehler: Funktion vor Definition (rettbar) + unbekannter Name (nicht rettbar)
    const c = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; fragColor = vec4(vec3(wave(uv) * gibtsnicht), 1.0); }\nfloat wave(vec2 p){ return sin(p.x * 9.0); }');
    assert.equal(c.ok, false); assert.ok(c.fixes.includes('Prototypen ergänzt'), c.fixes.join());
    assert.match(c.errors[0], /gibtsnicht/); assert.ok(!/'wave'/.test(c.errors[0]), 'gerettete Fehler werden nicht mehr gemeldet: ' + c.errors[0]);
    assert.ok(!/cg_v4/.test(c.code), 'keine Korrektur ohne Fortschritt');
    assert.match(c.code, /^float wave\(vec2 p\);/, 'das Modell bekommt den teilweise korrigierten Code');
  });
  it('Rettung anhand der Fehlerzeile: float an vec3 zugewiesen, int-Variable in Kommazahl-Rechnung', async () => {
    const run = c => AI.validate.runShader([], c, { sandbox: box });
    const a = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  vec2 uv = fragCoord / iResolution.xy;\n  vec3 glow = vec3(0.0);\n  glow = smoothstep(0.0, 1.0, uv.x) * 0.8;\n  fragColor = vec4(glow, 1.0);\n}');
    assert.ok(a.ok, a.errors.join(' | ')); assert.match(a.code, /glow = vec3\(smoothstep\(0\.0, 1\.0, uv\.x\) \* 0\.8\);/);
    const b = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  vec2 uv = fragCoord / iResolution.xy;\n  int bands = 6;\n  float v = fract(uv.x * bands + 0.5);\n  fragColor = vec4(vec3(v), 1.0);\n}');
    assert.ok(b.ok, b.errors.join(' | ')); assert.match(b.code, /uv\.x \* float\(bands\)/); assert.match(b.code, /int bands = 6;/);
  });
  it('Kaputte eigene Rauschfunktion wird durch die der App ersetzt (auch fbm mit Oktaven)', async () => {
    const code = 'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }\n' +
      'float noise(vec2 p){ vec2 i = floor(p), f = fract(p);\n  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0))), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);\n}\n' +
      'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.y * 6.0; float v = noise(uv + iTime) * fbm(uv, 4); fragColor = vec4(vec3(v), 1.0); }';
    const v = await AI.validate.runShader([], code, { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | ')); assert.ok(v.fixes.includes('eigene Rauschfunktion durch die der App ersetzt'), v.fixes.join());
    assert.ok(!/float noise\(vec2 p\)\{ vec2 i/.test(v.code));
  });
  it('Hilfsfunktion palette verzeiht einen float statt vec3 als letzten Wert', async () => {
    const v = await AI.validate.runShader([{ id: 'a', label: 'A', type: 'color', default: '#203040' }, { id: 'b', label: 'B', type: 'color', default: '#f0a050' }],
      'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; vec3 col = palette(uv.x + iTime * 0.1, u_a, u_b, vec3(1.0), 0.0); fragColor = vec4(col, 1.0); }', { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | '));
    const l = AI.shader.localizeLog("ERROR: 0:3: 'palette' : no matching overloaded function found", 'x\n// ---- KI-SHADER ----\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(palette(1.0)); }');
    assert.match(l[0], /the app's helper is palette\(float t, vec3 a, vec3 b, vec3 c, vec3 d\)/);
  });
  it('Rettung: vec2 und vec3 gemischt (Differenz und Zuweisung)', async () => {
    const run = c => AI.validate.runShader([], c, { sandbox: box });
    const a = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  vec2 uv = fragCoord / iResolution.y;\n  vec3 center = vec3(0.6, 0.5, 0.0);\n  float d = length(uv - center);\n  fragColor = vec4(vec3(smoothstep(0.3, 0.29, d)), 1.0);\n}');
    assert.ok(a.ok, a.errors.join(' | ')); assert.match(a.code, /length\(uv - center\.xy\)/);
    const b = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  vec2 uv = fragCoord / iResolution.xy;\n  vec3 col = uv;\n  fragColor = vec4(col, 1.0);\n}');
    assert.ok(b.ok, b.errors.join(' | ')); assert.match(b.code, /vec3 col = vec3\(uv, 0\.0\);/);
    const c = await run('void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  vec2 uv = fragCoord / iResolution;\n  fragColor = vec4(uv, 0.5, 1.0);\n}');
    assert.ok(c.ok, c.errors.join(' | ')); assert.match(c.code, /fragCoord \/ iResolution\.xy;/);
  });
  it('Fehlermeldungen bekommen kurze Lösungshinweise', () => {
    const src = 'x\n// ---- KI-SHADER ----\nvoid mainImage(out vec4 f, in vec2 c){\n  f = vec4(smoothstep(0, 1, c.x > 1.0));\n}';
    const l = AI.shader.localizeLog("ERROR: 0:4: 'smoothstep' : no matching overloaded function found\nERROR: 0:4: '+' : wrong operand types - no operation '+' exists that takes a left-hand operand of type 'mediump int'", src);
    assert.match(l[0], /hint: all arguments of smoothstep\(\) must be float/); assert.match(l[1], /hint: int and float never mix/);
    const l2 = AI.shader.localizeLog("ERROR: 0:4: 'dot' : no matching overloaded function found\nERROR: 0:4: '+' : wrong operand types - no operation '+' exists that takes a left-hand operand of type 'highp 2-component vector of float' and a right operand of type 'highp 3-component vector of float'", src);
    assert.match(l2[0], /dot\(\) needs vectors of the same size/); assert.match(l2[1], /a vec2 and a vec3 cannot be combined/); assert.ok(!/float\(i\)/.test(l2.join(' ')));
  });
  it('Rettung greift nur bei Fehlern – lauffähiger Code bleibt unverändert, unrettbarer meldet den Originalfehler', async () => {
    const ok = 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }';
    const v = await AI.validate.runShader([], ok, { sandbox: box });
    assert.ok(v.ok); assert.equal(v.code, ok); assert.deepEqual(v.fixes, []);
    const bad = 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(nichtda(fragCoord), 1.0); }';
    const w = await AI.validate.runShader([], bad, { sandbox: box });
    assert.equal(w.ok, false); assert.match(w.errors[0], /nichtda/);
  });
  it('Im Shader benutzte, aber nicht angelegte Regler werden ergänzt (Schieberegler oder Farbe)', async () => {
    const code = 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; fragColor = vec4(mix(vec3(0.0), u_ink_color, fract(uv.x * 6.0 * u_scale + iTime * u_speed)), 1.0); }';
    const r = AI.shader.tidy([{ id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.01, default: 1 }], code);
    assert.deepEqual(r.params.map(p => p.id + ':' + p.type), ['speed:range', 'ink_color:color', 'scale:range']);
    const v = await AI.validate.runShader(r.params, r.code, { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | '));
  });
  it('Selbstkorrektur: main() mit gl_FragColor, u_time/u_resolution, #extension, float x = 2', async () => {
    const raw = '#extension GL_OES_standard_derivatives : enable\nprecision highp float;\nout vec4 outColor;\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution;\n  float k = 3;\n  gl_FragColor = vec4(uv, 0.5 + 0.5 * sin(u_time * k), 1.0);\n}';
    const r = AI.shader.tidy([], raw);
    assert.match(r.code, /void mainImage\(out vec4 fragColor, in vec2 fragCoord\)/); assert.ok(!/#extension|precision|gl_Frag/.test(r.code)); assert.match(r.code, /float k = 3\.0;/);
    const v = await AI.validate.runShader([], r.code, { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | '));
    assert.ok(!/#define time/.test(AI.shader.tidy([], 'void mainImage(out vec4 f, in vec2 c){ float time = iTime; f = vec4(time); }').code), 'eigene Variable time bleibt');
  });
  it('Dropdown kommt als Index im Shader an: jede Option ergibt ein anderes Bild', async () => {
    const P = AI.schema.validateParams(ex.params).params, frag = AI.shader.source(P, ex.shader), grids = [];
    for (const opt of ['Wellen', 'Kreise', 'Linien']) {
      const r = await box.shader({ frag, uniforms: AI.shader.uniforms(P, { mode: opt }), t: 0.3, w: 96, h: 54, stats: true });
      r.bitmap.close(); grids.push(r.stats.grid);
    }
    const diff = (a, b) => a.reduce((s2, x, i) => s2 + Math.abs(x - b[i]), 0) / a.length;
    assert.ok(diff(grids[0], grids[1]) > 0.02 && diff(grids[1], grids[2]) > 0.02 && diff(grids[0], grids[2]) > 0.02);
    const ctl = AI.schema.toGroups('f', P, true).flatMap(g => g.params).find(c => c.genId === 'mode');
    assert.equal(ctl.u, 'u_mode'); assert.equal(ctl.map('Linien'), 2); assert.equal(ctl.options.length, 3);
  });
  it('GLSL-Fehler mit Zeile des Modell-Shaders', async () => {
    const code = 'vec3 image(vec2 uv, vec2 p, float t) {\n  float a = 1.0;\n  return vec3(a, b, 0.0);\n}';
    const v = await AI.validate.runShader([{ id: 'seed', label: 'Seed', type: 'seed', default: 1 }], code, { sandbox: box });
    assert.match(v.errors[0], /GLSL-Fehler – Zeile 3:.*'b'/);
    assert.match(v.errors[0], /→  return vec3\(a, b, 0\.0\);/);
  });
  it('Statische Prüfung: nur Texturen, Endlosschleifen, eigene u_-Uniforms und fehlendes mainImage', () => {
    const S = AI.shader.staticCheck, M = b => 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ ' + b + ' }';
    assert.equal(S(M('for (int i = 0; i < int(u_n); i++) {} fragColor = vec4(1.0);')).length, 0, 'freie Schleifen erlaubt');
    assert.match(S(M('while (true) {}'))[0], /Endlosschleife/);
    assert.match(S('uniform float u_x; ' + M('fragColor = texture(iChannel0, fragCoord);')).join(' '), /Texturen/);
    assert.match(S('vec4 foo(vec2 uv){ return vec4(0.0); }')[0], /mainImage/);
  });
  it('Eigene Funktionen namens hash12/fbm/snoise kollidieren nicht mit der App-Bibliothek; iTime läuft in Sekunden', async () => {
    const code = 'float hash12(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }\nfloat fbm(vec2 p){ return hash12(floor(p)); }\n' +
      'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; fragColor = vec4(vec3(fbm(uv * 8.0 + floor(iTime))), 1.0); }';
    const v = await AI.validate.runShader([{ id: 'seed', label: 'Seed', type: 'seed', default: 1 }], code, { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | '));
  });
  it('Kleinigkeiten werden selbst korrigiert: Umlaut-ids (auch im Shader), eigene Uniform-Deklarationen', () => {
    const r = AI.shader.tidy([{ id: 'wellen_intensität', type: 'range' }, { id: 'ok', type: 'range' }],
      'uniform float u_ok;\nuniform vec3 u_x, u_y;\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(u_wellen_intensität * u_ok); }');
    assert.equal(r.params[0].id, 'wellen_intensitaet'); assert.equal(r.params[1].id, 'ok');
    assert.ok(!/uniform/.test(r.code)); assert.match(r.code, /u_wellen_intensitaet \* u_ok/);
    assert.equal(r.fixes.length, 2);
  });
  it('HLSL-Verwechsler und globale Uniform-Zuweisungen werden selbst korrigiert und kompilieren', async () => {
    const params = [{ id: 'c', label: 'Farbe', type: 'color', default: '#c08040' }];
    const code = 'vec3 base = u_c;\nfloat hash(vec2 p){ return frac(sin(dot(p, float2(12.9, 78.2))) * 43758.5); }\n' +
      'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; fragColor = vec4(lerp(base, vec3(1.0), saturate(hash(floor(uv * 9.0)))), 1.0); }';
    const r = AI.shader.tidy(params, code);
    assert.match(r.code, /#define base \(u_c\)/); assert.ok(!/\bfrac\(|float2|lerp/.test(r.code));
    const v = await AI.validate.runShader(r.params, r.code, { sandbox: box });
    assert.ok(v.ok, v.errors.join(' | '));
    assert.equal(AI.shader.tidy([], 'float frac(float x){ return x; }\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(frac(1.0)); }').fixes.length, 0, 'eigene frac bleibt');
  });
  it('Verrutschte Reglerwerte im Feld group und fehlende Angaben werden wiederhergestellt', () => {
    const prev = [{ id: 'speed', label: 'Tempo', type: 'range', min: 0, max: 2, step: 0.01, default: 0.5 }, { id: 'c', label: 'Farbe', type: 'color', default: '#112233' }];
    const r = AI.shader.tidy([
      { id: 'dichte', label: 'Dichte', type: 'range', group: 'Geometrie, min, max, step, default, 1.0, 15.0, 0.1, 4.0' },
      { id: 'c', label: 'Farbe', type: 'color', group: 'Farben, default, #f7d1e0' },
      { id: 'speed', type: 'range' }], 'uniform vec2 iResolution;\nuniform float iTime;\nvoid mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }', prev);
    assert.deepEqual([r.params[0].group, r.params[0].min, r.params[0].max, r.params[0].step, r.params[0].default], ['Geometrie', 1, 15, 0.1, 4]);
    assert.equal(r.params[1].default, '#f7d1e0'); assert.equal(r.params[1].group, 'Farben');
    assert.deepEqual([r.params[2].min, r.params[2].max, r.params[2].label], [0, 2, 'Tempo']);
    assert.ok(!/uniform/.test(r.code));
    const v = AI.schema.validateParams(r.params);
    assert.ok(v.ok, v.errors.join(' | ')); assert.deepEqual(Object.keys(v.params[0]).slice(-2), ['default', 'group'], 'group steht zuletzt (Schema-Reihenfolge)');
  });
  it('Syntaxfehler zeigen auch die Zeile davor', async () => {
    const code = 'void mainImage(out vec4 fragColor, in vec2 fragCoord){\n  float a = 1.0 +\n  ;\n  fragColor = vec4(a);\n}';
    const v = await AI.validate.runShader([], code, { sandbox: box });
    assert.match(v.errors[0], /Zeile 2: float a = 1\.0 \+  ⏎  Zeile 3: ;/);
  });
  it('Fast schwarzes Bild mit einem Ausreißer-Pixel gilt als leer', async () => {
    const v = await AI.validate.runShader([{ id: 'seed', label: 'Seed', type: 'seed', default: 1 }],
      'void mainImage(out vec4 f, in vec2 c){ f = vec4(vec3(c.x < 1.0 && c.y < 1.0 ? 1.0 : 0.004 * fract(c.x * 0.37)), 1.0); }', { sandbox: box });
    assert.match(v.errors[0], /einfarbig: 100,0 % der Pixel haben dieselbe Farbe \(#040404\)/);
  });
  it('Blasser Schleier auf Weiß gilt als fast leer', async () => {
    const v = await AI.validate.runShader([], 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.xy; float b = 0.075 * smoothstep(0.7, 0.0, length(uv - 0.5)); fragColor = vec4(vec3(0.98 - b), 1.0); }', { sandbox: box });
    assert.equal(v.ok, false); assert.match(v.errors[0], /fast leer: nur 0,0 % der Fläche/);
  });
  it('Kleine helle Formen auf schwarzem Grund gelten nicht als leer', async () => {
    const dots = 'void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.y; vec2 g = fract(uv * 6.0) - 0.5;\n  float d = smoothstep(0.1, 0.07, length(g)) * (0.6 + 0.4 * sin(iTime)); fragColor = vec4(vec3(d) * vec3(1.0, 0.8, 0.4), 1.0); }';
    const v = await AI.validate.runShader([], dots, { sandbox: box, aspect: 16 / 9 });
    assert.ok(v.ok, v.errors.join(' | '));
  });
  it('Einfarbiges Bild wird erkannt', async () => {
    const v = await AI.validate.runShader([{ id: 'c', label: 'C', type: 'color', default: '#336699' }], 'vec3 image(vec2 uv, vec2 p, float t) { return u_c; }', { sandbox: box });
    assert.match(v.errors[0], /einfarbig/);
  });
  it('Regler ohne Wirkung (z. B. Farbe bei Schwarz/Weiß) sind nur ein Hinweis', async () => {
    const params = [
      { id: 'amber', label: 'Bernstein', type: 'color', default: '#c06010' },
      { id: 'size', label: 'Größe', type: 'range', min: 0.1, max: 0.5, step: 0.01, default: 0.3 },
      { id: 'seed', label: 'Seed', type: 'seed', default: 1 }];
    const bw = 'vec3 image(vec2 uv, vec2 p, float t) { float m = step(length(p + 0.05 * sin(TAU * t)), u_size); return vec3(m); }';
    const v = await AI.validate.runShader(params, bw, { sandbox: box, aspect: 16 / 9 });
    assert.ok(v.ok, v.errors.join(' | ')); assert.match(v.warnings.join(' '), /Ohne sichtbare Wirkung: „Bernstein“ \(u_amber\)/);
    const ok = await AI.validate.runShader(params, bw.replace('return vec3(m);', 'return mix(vec3(0.95), u_amber, m);'), { sandbox: box, aspect: 16 / 9 });
    assert.ok(ok.ok, ok.errors.join(' | ')); assert.ok(!/Bernstein/.test(ok.warnings.join(' ')));
  });
  it('Regler werden zu Uniforms (Farbe vec3, Auswahl als Index, Schalter 0/1)', async () => {
    const params = AI.schema.validateParams([
      { id: 'c', label: 'Farbe', type: 'color', default: '#ff0000' },
      { id: 'mode', label: 'Modus', type: 'select', options: ['A', 'B', 'C'], default: 'C' },
      { id: 'on', label: 'An', type: 'toggle', default: true }]).params;
    assert.deepEqual(AI.shader.uniforms(params, {}), [['u_c', 'vec3', [1, 0, 0]], ['u_mode', 'float', 2], ['u_on', 'float', 1], ['uLoopSec', 'float', 10]]);
    const code = 'vec3 image(vec2 uv, vec2 p, float t) { return uv.x < 0.5 ? u_c * u_on : vec3(u_mode / 2.0); }';
    const r = await box.shader({ frag: AI.shader.source(params, code), uniforms: AI.shader.uniforms(params, {}), t: 0, w: 8, h: 4, stats: true });
    r.bitmap.close();
    assert.ok(r.stats.nonUniform > 0.3);
    const g = AI.schema.toGroups('ai-x', params, true).flatMap(x => x.params);
    assert.equal(g.find(p => p.genId === 'mode').u, 'u_mode'); assert.equal(g.find(p => p.genId === 'mode').map('B'), 1);
  });
  it('Shader aus Zaun/Freitext wird herausgelöst', () => {
    assert.equal(AI.parse.extractShader('void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }"}'), 'void mainImage(out vec4 f, in vec2 c){ f = vec4(1.0); }\n');
    assert.equal(AI.parse.extractShader('vec3 image(vec2 uv, vec2 p, float t) {\\n  return vec3(1.0);\\n}'), 'vec3 image(vec2 uv, vec2 p, float t) {\n  return vec3(1.0);\n}\n');
    assert.match(AI.parse.extractShader('```glsl\n#version 300 es\nvec3 image(vec2 uv, vec2 p, float t){ return vec3(1.0); }\n```'), /^vec3 image/);
  });
});
