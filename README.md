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
Die Antwort (Beschreibung, Regler, Shader) kommt immer als verwertbares JSON zurück. Die Antwort wird gestreamt (Live-Fortschritt, Abbrechen).

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

Ein Gespräch mit einem Modell, das Bilder lesen kann (z. B. `gemma4:12b-mlx`) – so, wie man einen Coding-Assistenten fragt:

1. **Referenzbild** ablegen oder wählen (wird auf max. `maxImageSide` px verkleinert), optional Wünsche.
2. **Prompt** aus fester, versionierter Vorlage (`js/ai/prompt.js`, aktuell `shader-v1`) – angezeigt und editierbar („Prompt erst prüfen“).
3. Das Modell sieht das Bild, beschreibt zuerst selbst, was es sieht, plant, legt seine Regler fest und schreibt einen
   **GLSL-Fragment-Shader** – alles in einer JSON-Antwort `{title, notes, params, shader}`.
4. **Prüfung** in der Sandbox (Worker mit WebGL2): Regler-Schema, statische Regeln, Kompilieren (Fehlerzeilen bezogen
   auf den Shader des Modells, mit der betroffenen Codezeile), Probe-Render bei mehreren `t`, einfarbiges Bild, Tempo,
   Extremwerte aller Regler und ob jeder Regler sichtbar wirkt (Farbregler, die das Bild nicht färben, gehen als Fehler
   zurück; nach einem erfolglosen Versuch wird der Shader mit Hinweis übernommen).
   Fehler gehen ins selbe Gespräch zurück (bis zu `repairAttempts` Reparaturen).
5. **Eigener Vergleich** (`refineRounds`): Das Modell sieht sein Ergebnis neben der Referenz (links „REFERENZ“, rechts
   „ERGEBNIS“), schreibt die Unterschiede auf und verbessert.
6. Speichern im Browser, Regler automatisch aus dem Schema; ohne „Prompt erst prüfen“ öffnet sich am Ende die Sandbox.

Der Shader läuft danach in derselben WebGL-Pipeline wie Feuer und Grounddata: Finish, Bild-Ebene, Supersampling-Export,
Video und nahtloser Loop funktionieren genauso. `maxTokens` hebt die Antwortlänge an (Ollamas MLX-Motor kappt sonst bei
etwa 2048 Token). Die Qualität hängt stark vom Modell ab; lokale Modelle um 12 B treffen Aufbau und Farben oft nur grob.

### Konfiguration – `config.json` + Seite „KI“

`config.json` enthält die Vorgaben; Server, Adresse und Modelle stellst du auf der Seite **KI** ein (gespeichert in diesem Browser).

| Schlüssel | Bedeutung |
|---|---|
| `server` | `ollama`, `lmstudio`, `llamacpp`, `jan`, `vllm` oder `openai` (OpenAI-kompatibel) |
| `url` | Adresse des KI-Servers mit Port |
| `model` | Modell mit Bildverständnis (exakter Name, siehe `ollama list`) |
| `temperature` | Temperatur (bei Reparaturen mindestens 0,6) |
| `numCtx` | Kontextgröße (`num_ctx`, nur Ollama) |
| `maxTokens` | maximale Antwortlänge (`num_predict` bzw. `max_tokens`) |
| `think` | Denkmodus (aus = schneller) |
| `timeouts.generationSec` | Zeitlimit pro Modellaufruf |
| `timeouts.renderMs` | Zeitlimit pro Bild in der Sandbox (Watchdog gegen Endlosschleifen) |
| `repairAttempts` | maximale Reparaturversuche |
| `refineRounds` | Runden Bildvergleich + Überarbeitung (0 = aus) |
| `maxImageSide` | längste Bildseite vor dem Senden |

### Generator-Vertrag

```json
{
  "title": "Tintentropfen",
  "notes": "Sehe: … Plan: …",
  "params": [
    { "id": "count", "label": "Anzahl", "type": "range", "min": 1, "max": 12, "step": 1, "default": 6, "group": "Form" },
    { "id": "ink", "label": "Tinte", "type": "color", "default": "#2ec4b6" },
    { "id": "seed", "label": "Seed", "type": "seed", "default": 7 }
  ],
  "shader": "vec3 image(vec2 uv, vec2 p, float t) { … }"
}
```

- `uv` 0..1, `p` zentriert und seitenrichtig, `t` Loop-Zeit 0..1, `uRes` Auflösung.
- Jeder Regler ist eine Uniform `u_<id>`: `float` (range, seed, toggle 0/1, select = Index), `vec3` (color).
- Vorhandene Helfer: `snoise`, `fbm`, `loopNoise`, `loopFbm`, `hash11`, `hash12`, `smin`, `rot`, `sdCircle`, `sdSegment`, `TAU`.
- Keine Texturen, kein `while`, Schleifen nur mit fester Obergrenze (≤ 256).
- Ältere Canvas-2D-Generatoren (`function draw(ctx, p, t, rng)`) aus früheren Versionen laufen weiter.

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

- `http://localhost:8765/tests/index.html` – Unit-Tests: Parser, Prompt, Schema, Shader, Sandbox, Prüfung, Client (Ollama/OpenAI, Ausweichstufen, Fehler), Speicher
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
| Generator funktioniert nach den Reparaturen nicht | „Nochmal versuchen“, Prompt anpassen, anderes Modell wählen |
| Generator „hängt oder ist zu langsam“ | Regler mit hoher Anzahl verringern oder `timeouts.renderMs` erhöhen |
