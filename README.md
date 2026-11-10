# Creative Generator

Organische, nahtlos loopende Visuals im Browser (WebGL2) – mit Format-Seite, Sandbox mit Reglern, Bibliothek
und Export (PNG/JPG in hoher Auflösung, MP4 bis UHD). Funktionen: **Feuer**, **Grounddata**, **Fragment**, **Pencil**
und beliebig viele **KI-Generatoren**, die die App lokal aus einem Referenzbild erzeugt.

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
Browser (Creative Generator)  ──HTTP──▶  KI-Server auf deinem Rechner (z. B. localhost:11434)
```

Es gibt keinen Server dazwischen. Jeder Schritt ist eine Anfrage mit erzwungenem Antwortformat (JSON-Schema) –
Bildanalyse und Code kommen immer als verwertbares JSON zurück. Die Antwort wird gestreamt (Live-Fortschritt, Abbrechen).

**Ollama**
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

**Zugangsschlüssel**: Ist einer eingetragen, geht er als `Authorization: Bearer <schlüssel>` mit. Er bleibt nur im
Browser dieses Geräts – nie in Generatoren, Designs oder Exporten.

**Von GitHub Pages aus**
- Eine HTTPS-Seite darf `http://localhost` aufrufen, aber keine unverschlüsselte Adresse eines anderen Rechners – dafür `https://`.
- Chrome fragt einmal, ob die Seite auf Geräte im lokalen Netzwerk zugreifen darf → „Zulassen“.
- Safari blockiert solche Verbindungen; Chrome, Edge und Firefox funktionieren.

**Kurz-Checkliste**
1. Server starten und ein Modell laden (`ollama pull gemma4:12b-mlx`).
2. Seitenadresse freigeben (`OLLAMA_ORIGINS` bzw. „Enable CORS“) – für `localhost` bei Ollama nicht nötig.
3. Auf der Seite **KI**: Server wählen, Adresse mit Port prüfen, „Verbinden“.
4. Freigabe testen: `curl -i -H "Origin: <seitenadresse>" http://localhost:11434/api/tags` → `200 OK` passt, `403` = Freigabe fehlt.
   Die App zeigt diesen Befehl bei Verbindungsproblemen fertig zum Kopieren an.

### Ablauf

1. **Referenzbild** ablegen oder wählen (wird auf max. `maxImageSide` px verkleinert), optional Zusatzwünsche.
2. **Analyse** (Vision-Modell, JSON-Schema): Farben, Formen, Muster, Komposition, Texturen, Bewegung, passende Techniken – als JSON bearbeitbar.
3. **Prompt** aus fester, versionierter Vorlage (`js/ai/prompt.js`, aktuell `generator-v3`) – angezeigt und editierbar („Prompt erst prüfen“).
   Kann das Code-Modell Bilder lesen, bekommt es die Referenz zusätzlich direkt zu sehen.
4. **Code** (Code-Modell, Antwort `{"code": "…"}`), automatisch geprüft: Syntax, Vertrag, Parameter-Schema, Probe-Render,
   leeres Bild, Extremwerte aller Regler. Bei Fehlern bis zu `repairAttempts` Reparaturen durch das Modell.
5. **Bildvergleich** (`refineRounds`): Ein Einzelbild wird neben die Referenz gelegt (links „REFERENZ“, rechts „ERGEBNIS“);
   das Vision-Modell bewertet die Ähnlichkeit (1–10) und nennt konkrete Unterschiede, das Code-Modell überarbeitet.
   Übernommen wird eine Überarbeitung nur, wenn sie die Prüfung besteht und mindestens gleich gut bewertet wird.
6. Speichern im Browser, Regler automatisch aus dem Schema; ohne „Prompt erst prüfen“ öffnet sich am Ende die Sandbox.

**Bildqualität**: Im Generator stehen Zeichenhilfen bereit – `noise`, `fbm`, `loopNoise` (nahtlos loopendes Rauschen),
`smoothPath` (weiche Kurven), `mix`/`rgba`/`shade` (Farben), `lerp`, `clamp`, `smoothstep`, `TAU`. Der Prompt enthält
Qualitätsregeln (weiche Kurven statt Zickzack, viele feine halbtransparente Linien, Volumen über Verläufe, Tiefe).
Die Qualität hängt trotzdem stark vom Code-Modell ab – Empfehlungen für 24 GB: `gpt-oss:20b` (Code), `devstral-small-2`
(Code und Bild), `qwen3.5:9b-mlx` (Bildanalyse).

### Konfiguration – `config.json` + Seite „KI“

`config.json` enthält die Vorgaben; Server, Adresse und Modelle stellst du auf der Seite **KI** ein (gespeichert in diesem Browser).

| Schlüssel | Bedeutung |
|---|---|
| `server` | `ollama`, `lmstudio`, `llamacpp`, `jan`, `vllm` oder `openai` (OpenAI-kompatibel) |
| `url` | Adresse des KI-Servers mit Port |
| `visionModel`, `codeModel` | Modell für Bildanalyse bzw. Code (exakte Namen, siehe `ollama list`) |
| `temperature.vision/code/repair` | Temperaturen |
| `numCtx.vision/code` | Kontextgröße (`num_ctx`, nur Ollama) |
| `think` | Denkmodus (aus = schneller) |
| `timeouts.analysisSec/generationSec` | Zeitlimit pro Modellaufruf |
| `timeouts.renderMs` | Zeitlimit pro Bild in der Sandbox (Watchdog gegen Endlosschleifen) |
| `repairAttempts` | maximale Reparaturversuche |
| `refineRounds` | Runden Bildvergleich + Überarbeitung (0 = aus) |
| `maxImageSide` | längste Bildseite vor dem Senden |

### Generator-Vertrag

```js
const params = [                          // 8–16 Einträge
  { id: "count", label: "Anzahl", type: "range", min: 1, max: 50, step: 1, default: 12, group: "Form" },
  { id: "bg", label: "Hintergrund", type: "color", default: "#101018" },
  { id: "shape", label: "Form", type: "select", options: ["Kreis", "Quadrat"], default: "Kreis" },
  { id: "lines", label: "Linien", type: "toggle", default: true },
  { id: "seed", label: "Seed", type: "seed", default: 7 }
];
function setup(ctx, p, rng) { … }          // optional, läuft bei Größen-/Parameteränderung
function draw(ctx, p, t, rng) { … }        // ein komplettes Bild; t = 0..1, nahtloser Loop
```

Canvas 2D, Größen relativ zu `Math.min(W, H)`, Zufall nur über den geseedeten `rng` (deterministisch), keine Imports,
kein DOM, kein Netzwerk.

### Sicherheit

Generierter Code läuft nie in der App selbst, sondern in einem `iframe sandbox="allow-scripts"` (leerer Ursprung,
CSP ohne Netzwerk) und dort in einem Worker mit OffscreenCanvas – ohne Zugriff auf DOM, Speicher oder Netzwerk der App.
Hängt der Code, beendet der Watchdog den Worker nach `renderMs`; die App friert nicht ein. Laufzeitfehler erscheinen
mit Zeilennummer im Viewport.

### Speichern, Presets, Export

- Generatoren liegen im Browser (IndexedDB) mit Code, Parameter-Schema, Analyse, Prompt, Modellen, Datum, Vorlagen-Version und Thumbnail.
  Über die Karten auf der Seite **KI**: als `.cg-generator.json` sichern bzw. **Importieren** (anderes Gerät/Browser).
- Presets: in der Sandbox über **+** neben der Preset-Auswahl (pro Generator gespeichert).
- Export: PNG/JPG in Format-Auflösung (inkl. Finish), **SVG** (Vektoren; nicht bei Pixelzugriff/Bildern), **Video** (MP4),
  **Generator-Code** als `.js`.
- Alle bisherigen Funktionen und Designs bleiben unverändert.

## Tests

```bash
python3 -m unittest tests/test_server.py -v     # Dateiserver
```

- `http://localhost:8765/tests/index.html` – Unit-Tests: Parser, Prompt-Builder, Schema, Sandbox, Prüfung, Client (Ollama/OpenAI, Ausweichstufen, Fehler), Speicher
- `http://localhost:8765/tests/e2e.html?run=1` – End-to-End gegen das echte lokale Ollama, über beide Schnittstellen (einige Minuten)

## Fehlerbehebung

| Meldung | Lösung |
|---|---|
| „Keine Verbindung“ | Server läuft? Adresse/Port prüfen. Andere Seitenadresse als `localhost`: Freigabe (`OLLAMA_ORIGINS` bzw. „Enable CORS“), dann den angezeigten `curl`-Test |
| „Zugriff verweigert“ / 401 | Zugangsschlüssel eintragen bzw. prüfen |
| Seite auf HTTPS, Server auf anderem Rechner | Adresse muss mit `https://` beginnen |
| Safari verbindet nicht | Chrome, Edge oder Firefox verwenden |
| „Modell … ist nicht installiert“ | angezeigten `ollama pull …`-Befehl ausführen oder anderes Modell wählen |
| „… kann keine Bilder lesen“ | Bild-Modell mit Vision-Fähigkeit wählen (z. B. `gemma4:12b-mlx`, `llama3.2-vision`) |
| Zeitüberschreitung | `timeouts` erhöhen; beim ersten Aufruf lädt der Server das Modell erst |
| Generator funktioniert nach den Reparaturen nicht | „Nochmal versuchen“, Prompt anpassen, stärkeres Code-Modell wählen; „Letzten Code“ lädt den letzten Stand herunter |
| Generator „hängt oder ist zu langsam“ | Regler mit hoher Anzahl verringern oder `timeouts.renderMs` erhöhen |
