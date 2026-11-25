# Creative Generator

Organische, nahtlos loopende Visuals im Browser (WebGL2) – mit Format-Seite, Sandbox mit Reglern, Bibliothek
und Export (PNG/JPG in hoher Auflösung, MP4 bis UHD). Funktionen: **Feuer**, **Grounddata**, **Fragment**, **Pencil**
und beliebig viele **KI-Generatoren**, die Claude (oder ein lokales Modell) aus einem Referenzbild oder einer Beschreibung baut.

## Start

Die App ist rein statisch (HTML/CSS/JS, kein Build) und läuft komplett im Browser – lokal oder z. B. auf GitHub Pages.

```bash
python3 server.py            # http://localhost:8765  (oder jeder andere statische Server)
```

`server.py` liefert nur die Dateien aus (Standardbibliothek). Ist der Port belegt, meldet er eine laufende Instanz
bzw. nimmt den nächsten freien Port.

## KI-Generator

### So ist die KI verbunden

```
Browser (Creative Generator)  ──HTTPS──▶  api.anthropic.com   (Standard: Claude)
                              ──HTTP───▶  localhost:11434     (optional: lokales Modell)
```

Es gibt keinen Server dazwischen. Jede Antwort wird gestreamt (Live-Fortschritt, Abbrechen).

**Claude (Anthropic) – Standard**
1. API-Schlüssel anlegen: [console.anthropic.com](https://console.anthropic.com) › API Keys (`sk-ant-…`).
2. Seite **KI** › Server „Claude (Anthropic)“ › Schlüssel eintragen › „Verbinden“.
3. Modell wählen: `claude-sonnet-5-5` (Standard, schnell und stark), `claude-opus-5-5` (höchste Qualität),
   `claude-fable-5-2`, `claude-haiku-5-5` (günstig, für einfache Aufträge). Weitere Modelle des Kontos erscheinen automatisch.

Technik: `POST /v1/messages` mit `stream: true`, Bild als Base64, Auftrag als `system`, adaptives Denken
(`thinking: {type: "adaptive"}`, Tiefe über `effort`), Prompt-Caching (Reparatur- und Vergleichsrunden lesen den Anfang
aus dem Cache), `max_tokens` 32 000. Lehnt ein Modell eine Anfrage ab, springt serverseitig ein Ausweichmodell ein
(`fallbacks`). Der Aufruf direkt aus dem Browser braucht den Header `anthropic-dangerous-direct-browser-access` – das
heißt nur: Der Schlüssel liegt im Browser. Er bleibt in diesem Browser (localStorage), nie in Generatoren, Designs oder
Exporten. Nutze am besten einen eigenen Schlüssel mit Ausgabenlimit.

Kosten grob: Ein Generator mit Vergleichsrunde sind 2–4 Anfragen (je ~3 000 Token rein, 3 000–8 000 Token raus inkl. Denken).

**Ollama** (lokal, optional)
- Modelle: `GET /api/tags` · Anfrage: `POST /api/chat` mit `format` (JSON-Schema), `stream: true`, bei Bedarf `think: false`
- Antwort: eine JSON-Zeile pro Textstück
- Speicher: Die App entlädt Modelle selbst (`keep_alive: 0`), damit immer nur eins geladen ist.
- Freigabe: `localhost` ist automatisch erlaubt. Für eine andere Seitenadresse (z. B. GitHub Pages):
  `launchctl setenv OLLAMA_ORIGINS "https://<name>.github.io"` und Ollama neu starten.

**LM Studio, llama.cpp, Jan, vLLM, Cloud-Anbieter** (OpenAI-Schnittstelle)
- Modelle: `GET <adresse>/v1/models` · Anfrage: `POST /v1/chat/completions` mit `response_format` (`json_schema`), `stream: true`
- Antwort: Server-Sent Events (`data: …`)
- Ausweichstufen: Kennt ein Server das strenge Format nicht, nutzt die App `json_object`, notfalls steht das Schema als Anweisung im Text.
  Denkmodus wird mit `reasoning_effort: "none"` abgeschaltet (fällt weg, wenn der Server das Feld nicht kennt).
- Freigabe: LM Studio › Developer › Server starten › **Enable CORS**. Andere Server müssen CORS ebenfalls erlauben.
- Hinweis: Ollama über `/v1` nutzt nur 4096 Token Kontext – für Ollama besser den Server-Typ „Ollama“ wählen.

**Zugangsschlüssel**: Ist einer eingetragen, geht er als `x-api-key` (Claude) bzw. `Authorization: Bearer <schlüssel>` mit.
Er bleibt nur im Browser dieses Geräts – nie in Generatoren, Designs oder Exporten.

**Lokaler Server von GitHub Pages aus** (für Claude nicht nötig)
- Eine HTTPS-Seite darf `http://localhost` aufrufen, aber keine unverschlüsselte Adresse eines anderen Rechners – dafür `https://`.
- Chrome fragt einmal, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf → „Zulassen“.
- Safari blockiert solche Verbindungen; Chrome, Edge und Firefox funktionieren.

**Kurz-Checkliste lokal**
1. Server starten und ein Modell laden (`ollama pull gemma4:12b-mlx`).
2. Seitenadresse freigeben (`OLLAMA_ORIGINS` bzw. „Enable CORS“) – für `localhost` bei Ollama nicht nötig.
3. Auf der Seite **KI**: Server wählen, Adresse mit Port prüfen, „Verbinden“.
4. Freigabe testen: `curl -i -H "Origin: <seitenadresse>" http://localhost:11434/api/tags` → `200 OK` passt, `403` = Freigabe fehlt.
   Die App zeigt diesen Befehl bei Verbindungsproblemen fertig zum Kopieren an.

### Ablauf

Der Generator ist **nur das Interface**: Die KI baut die Funktion – einen animierten Shader samt eigener Regler.
Der System-Auftrag erklärt dem Modell, wie die App funktioniert, und dass die Vorgaben der Oberfläche im jeweiligen Auftrag
immer Vorrang haben; alles andere entscheidet das Modell selbst. Der Auftrag (`js/ai/prompt.js`, aktuell `funktion-v7`) ist bewusst knapp: das Bild, die Aufgabe („schau genau hin – Aufbau,
Vorder-/Hintergrund, Licht, Materialien – und bau etwas, das ein Designer weiter benutzen will“), die Regler-Typen und wie sie im
Shader ankommen, die Antwortform. Keine Technikvorgaben, keine Regelliste, kein Beispiel: Fertige Beispiel-Regler haben Modelle im
Test wörtlich übernommen, statt eigene zu wählen. Welche Regler es gibt, wie viele und wie sie heißen, entscheidet das Modell.

**Drei Wege zur Aufgabe** – es funktioniert mit jedem Modell:

| Weg | Wann | Was passiert |
|---|---|---|
| Bild | Modell kann Bilder lesen (alle Claude-Modelle, `gemma4`) | Das Modell sieht die Referenz selbst |
| Beschreibung | Modell kann keine Bilder lesen, bei „Bild lesen“ ist ein zweites Modell gewählt | Das zweite Modell beschreibt die Referenz als Text; mit „Prompt erst prüfen“ steht die Beschreibung vorher im Prompt |
| Nur Text | kein Bild | Die Funktion entsteht nur aus dem geschriebenen Auftrag |

1. **Auftrag**: optional ein Referenzbild, dazu Wünsche bzw. die Beschreibung, was entstehen soll. Der vollständige Prompt ist editierbar.
2. **Funktion**: Das Modell antwortet frei mit einer `TITLE`- und `NOTES`-Zeile, den Reglern als `json`-Block und dem Shader als
   `glsl`-Block (Shadertoy-Stil: `mainImage`, `iResolution`, `iTime`, `iLoop`). Kein erzwungenes JSON-Objekt: Code als maskierter
   JSON-String schreiben Modelle messbar schlechter. Antwortet ein Modell doch als JSON, liest die App das ebenfalls.
3. **Prüfung** in der Sandbox (Worker mit WebGL2). Zurück ans Modell gehen nur echte Fehler – kompiliert nicht
   (mit Codezeile), Bild leer, viel zu langsam – bis zu `repairAttempts` Mal; hängt das Modell am selben Fehler, bricht die App früher ab.
   Im Protokoll steht dafür eine einzige Zeile („Modell bessert nach (2/3)“), die Fehlertexte sind aufklappbar.

**Damit möglichst wenige Fehler entstehen:**
- Beim Code-Schreiben sind Wiederholungsstrafen aus (`presence_penalty`/`frequency_penalty` 0, `repeat_penalty` 1). Manche
  Modelle bringen z. B. `presence_penalty 1.5` mit – in Code kommen dieselben Wörter ständig vor, das Modell weicht dann auf
  erfundene Namen aus.
- Kompiliert ein Shader nicht, probiert die App zuerst mechanische Korrekturen – jede wird übernommen, sobald sie Fehler
  beseitigt (vom Compiler geprüft): Typen in der gemeldeten Zeile (`vec3 glow = 0.8` → `vec3(0.8)`, int-Variablen in
  Kommazahl-Rechnungen), Ganzzahlen in Rechnungen mit Kommazahlen (`2` → `2.0`), `int`-Schleifenzähler (`pow(0.5, i)`),
  Funktionen, die vor ihrer Definition benutzt werden (Prototypen), Funktionen innerhalb von Funktionen, fehlende Klammern,
  `fragColor` mit `vec3`, reservierte Wörter als Namen (`sample`, `input` …), eine selbst geschriebene, kaputte Rausch- oder
  Zufallsfunktion (`noise`, `fbm`, `hash` …) wird durch die der App ersetzt. Nur was dann noch fehlt, geht ans Modell –
  zusammen mit dem bereits korrigierten Code und einem kurzen Lösungshinweis je Compiler-Meldung.
- Gerät ein Modell in eine Wiederholungsschleife (derselbe Abschnitt immer wieder), bricht die App die Antwort ab und
  startet frisch, statt bis zum Token-Limit zu warten.
- Die App ergänzt übliche Hilfsfunktionen, wenn ein Modell sie aufruft, ohne sie (passend) zu definieren: `hash`, `noise`,
  `fbm` (jeweils für mehrere Argumenttypen), `rot`, `smin`, `palette`. Eigene Fassungen des Modells haben Vorrang. Im Auftrag
  stehen sie nicht – das Modell soll frei schreiben.
- Vieles korrigiert die App selbst, ohne nachzufragen: `main()`/`gl_FragColor` → `mainImage`, `u_time`/`u_resolution`/`time`,
  `frac`/`lerp`/`saturate`/`float3`, `float x = 2`, `#version`/`#extension`/`precision`, selbst deklarierte Uniforms, globale
  Variablen mit Uniforms, Umlaute in ids, fehlende Reglergrenzen – und Regler, die im Shader benutzt, aber nicht angelegt wurden.
4. **Vergleich** (`refineRounds`, nur mit Referenz): Ein Bild-Modell sieht sein Ergebnis neben der Referenz; bei einem Text-Modell
   vergleicht das zweite Modell und schreibt die Unterschiede als Text.
5. Speichern im Browser; Regler entstehen automatisch.

**Verbessern**: Jeder gespeicherte Generator lässt sich nachträglich per Prompt ändern – über das Funken-Symbol in der Sandbox
(Preset-Zeile) oder auf der Karte in der Bibliothek. Das Modell bekommt die aktuelle Funktion (Regler + Code), den Änderungswunsch
und, wenn es Bilder lesen kann, ein Bild des aktuellen Ergebnisses. Die vorige Fassung bleibt für „Rückgängig“ erhalten (bis zu zehn).

Lokal ist immer nur ein Modell geladen; beim Weg „Beschreibung“ wechselt die App zwischen den beiden.
Die Qualität hängt vollständig vom Modell ab – mit Claude laufen die Absicherungen oben meist gar nicht erst an.

### Konfiguration – `config.json` + Seite „KI“

`config.json` enthält die Vorgaben; Server, Adresse und Modelle stellst du auf der Seite **KI** ein (gespeichert in diesem Browser).

| Schlüssel | Bedeutung |
|---|---|
| `server` | `anthropic` (Standard), `ollama`, `lmstudio`, `llamacpp`, `jan`, `vllm` oder `openai` (OpenAI-kompatibel) |
| `url` | Adresse des KI-Servers (`https://api.anthropic.com` bzw. lokal mit Port) |
| `model` | Modell, das die Funktion baut (Standard `claude-sonnet-5-5`) |
| `effort` | nur Claude: Denktiefe `low` / `medium` / `high` (Standard) / `max` |
| `describeModel` | optional: Modell mit Bildverständnis, das die Referenz beschreibt, wenn `model` keine Bilder lesen kann |
| `temperature` | Temperatur, nur lokal (Claude-Modelle mit adaptivem Denken nehmen keine) |
| `numCtx` | Kontextgröße (`num_ctx`, nur Ollama) |
| `maxTokens` | maximale Antwortlänge (`max_tokens` bzw. `num_predict`; Claude: 32 000 inkl. Denken) |
| `think` | Denkmodus lokal (aus = schneller); Claude denkt immer adaptiv |
| `timeouts.generationSec` | Zeitlimit pro Modellaufruf |
| `timeouts.renderMs` | Zeitlimit pro Bild in der Sandbox (Watchdog gegen Endlosschleifen) |
| `repairAttempts` | maximale Reparaturversuche |
| `refineRounds` | Vergleichsrunden mit der Referenz (0 = aus) |
| `maxImageSide` | längste Bildseite vor dem Senden |

### Interface für das Modell (Generator-Vertrag)

```json
{
  "title": "Tintenwolken",
  "notes": "…",
  "params": [
    { "id": "speed", "label": "Tempo", "type": "range", "min": 0, "max": 2, "step": 0.01, "default": 1, "group": "Bewegung" },
    { "id": "ink", "label": "Tinte", "type": "color", "default": "#2ec4b6" },
    { "id": "mode", "label": "Muster", "type": "select", "options": ["Wellen", "Kreise", "Linien"], "default": "Wellen" },
    { "id": "glow", "label": "Leuchten", "type": "toggle", "default": true },
    { "id": "seed", "label": "Seed", "type": "seed", "default": 7 }
  ],
  "shader": "void mainImage(out vec4 fragColor, in vec2 fragCoord) { … }"
}
```

Jeder Eintrag wird ein Regler im Panel **und** eine Uniform `u_<id>` im Shader:

| Typ | Regler | Uniform |
|---|---|---|
| `range` | Schieberegler (`min`, `max`, `step`, `default`) | `float`, aktueller Wert |
| `color` | Farbe in der Palette | `vec3`, rgb 0..1 |
| `select` | Dropdown (bis drei kurze Optionen: Segment-Knöpfe) | `float`, Index der gewählten Option: `if (u_mode < 0.5) … else if (u_mode < 1.5) …` |
| `toggle` | Schalter | `float`, 1 = an, 0 = aus |
| `seed` | Seed mit Würfel | `float` 0..9999 |

`group` fasst Regler zu einem Abschnitt zusammen. Vorhanden im Shader: `iResolution`, `iTime` (Sekunden), `iLoop` (0..1).
Nicht vorhanden: Texturen/`iChannel`, `#version`, `main()`. Ältere Generatoren (`vec3 image(uv, p, t)`, Canvas 2D) laufen weiter.

### Sicherheit

Shader werden vor dem Einsatz im Worker kompiliert und probegerendert. Generierter JavaScript-Code (ältere Generatoren) läuft nie in der App selbst, sondern in einem `iframe sandbox="allow-scripts"` (leerer Ursprung,
CSP ohne Netzwerk) und dort in einem Worker mit OffscreenCanvas – ohne Zugriff auf DOM, Speicher oder Netzwerk der App.
Hängt der Code, beendet der Watchdog den Worker nach `renderMs`; die App friert nicht ein. Laufzeitfehler erscheinen
mit Zeilennummer im Viewport.

### Speichern, Presets, Export

- Generatoren liegen im Browser (IndexedDB) mit Shader, Parameter-Schema, Prompt, Modellen, Datum, Vorlagen-Version und Thumbnail.
  Über die Karten auf der Seite **KI**: als `.cg-generator.json` sichern bzw. **Importieren** (anderes Gerät/Browser).
- Presets: in der Sandbox über **+** neben der Preset-Auswahl (pro Generator gespeichert).
- Export: PNG/JPG in Format-Auflösung (inkl. Finish), **SVG** (nur ältere Canvas-Generatoren), **Video** (MP4),
  **Shader-Code** als `.glsl`.
- Alle bisherigen Funktionen und Designs bleiben unverändert.

## Tests

```bash
python3 -m unittest tests/test_server.py -v     # Dateiserver
```

- `http://localhost:8765/tests/index.html` – Unit-Tests: Parser, Prompt, Schema, Shader, Sandbox, Prüfung, Client (Claude/Ollama/OpenAI, Ausweichstufen, Fehler), Speicher
- `http://localhost:8765/tests/e2e.html?run=1` – End-to-End gegen das echte lokale Ollama, über beide Schnittstellen (einige Minuten)

## Fehlerbehebung

| Meldung | Lösung |
|---|---|
| „Keine Verbindung“ | Server läuft? Adresse/Port prüfen. Andere Seitenadresse als `localhost`: Freigabe (`OLLAMA_ORIGINS` bzw. „Enable CORS“), dann den angezeigten `curl`-Test |
| „Zugriff verweigert“ / 401 | Zugangsschlüssel eintragen bzw. prüfen |
| „Claude-API-Schlüssel fehlt oder ist falsch“ | Schlüssel aus console.anthropic.com oben eintragen (beginnt mit `sk-ant-`) |
| „ausgelastet“ (429/529) | kurz warten und „Nochmal versuchen“; ggf. Ausgabenlimit/Rate-Limit im Konto prüfen |
| Anfrage abgelehnt | Auftrag umformulieren oder anderes Claude-Modell wählen |
| Seite auf HTTPS, Server auf anderem Rechner | Adresse muss mit `https://` beginnen |
| Safari verbindet nicht | Chrome, Edge oder Firefox verwenden |
| „Modell … ist nicht installiert“ | angezeigten `ollama pull …`-Befehl ausführen oder anderes Modell wählen |
| Modell kann keine Bilder lesen | oben bei „Bild lesen“ ein Modell mit Bildverständnis wählen (z. B. `gemma4:12b-mlx`) – oder ohne Bild nur mit Text arbeiten |
| Zeitüberschreitung | `timeouts` erhöhen; beim ersten Aufruf lädt der Server das Modell erst |
| Modell liefert keine lauffähige Funktion | „Nochmal versuchen“, Auftrag vereinfachen oder ein anderes Modell wählen; im Protokoll lassen sich die Fehler aufklappen |
| Generator „hängt oder ist zu langsam“ | Regler mit hoher Anzahl verringern oder `timeouts.renderMs` erhöhen |
