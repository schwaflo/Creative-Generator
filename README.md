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

Das Modell ist **Art Director, nicht Programmierer**: Es schreibt keinen Code, sondern beschreibt das Bild als Rezept.
Das Rendern übernimmt die App mit eigenen, geprüften Shader-Bausteinen (`js/ai/recipe.js`) – es gibt keine
Kompilierfehler und keine Reparaturrunden.

1. **Referenzbild** ablegen oder wählen (wird auf max. `maxImageSide` px verkleinert), optional Wünsche.
2. **Prompt** (`js/ai/prompt.js`, aktuell `rezept-v1`) – angezeigt und editierbar („Prompt erst prüfen“).
3. **Rezept**: Das Modell (mit Bildverständnis, z. B. `gemma4:12b-mlx`) beschreibt das Bild als JSON – Hintergrund,
   Kamera (Neigung, Fokus, Tiefenunschärfe), Licht und 1–5 **Ebenen** aus zwölf Typen: Netz, Zellen, Blasen, Punkte,
   Fasern, Höhenlinien, Streifen, Ringe, Nebel, Fluid, Kristall, Lichter. Jede Ebene hat Farben und Werte 0..1
   (Größe, Fülle, Unregelmäßigkeit, Detail, Relief, Glanz, Glas, Weichheit, Deckkraft) sowie eine Bewegung.
   Unvollständige oder unlesbare Angaben bekommen Vorgaben – ein Rezept führt nie zu einem Fehler.
4. **Angleichen** (ohne Modell, auf der Grafikkarte, etwa 1 s): Die App rechnet die Farben aus, die der Referenz am
   nächsten kommen, sucht passende Werte für Bildaufbau und Größen (`fitSteps` Schritte) und entfernt Ebenen, ohne die
   das Bild mindestens so gut passt. Verglichen wird Statistik auf einem 8×8-Raster (Farbe, Kontrast, Kanten,
   Formgrößen), kein Pixelvergleich. Die angezeigte „Übereinstimmung“ ist dieses Maß in Prozent.
5. **Eigener Vergleich** (`refineRounds`): Das Modell sieht das angeglichene Ergebnis neben der Referenz und ändert das
   Rezept. Gespeichert wird die Fassung mit der besseren Übereinstimmung; die anderen Runden stehen zur Auswahl.
6. Speichern im Browser, Regler automatisch (Kamera, Licht, je Ebene eine Gruppe, Farben als Palette).

Ein Durchlauf dauert mit gemma4 etwa 40–60 s. Der Generator läuft danach in derselben WebGL-Pipeline wie Feuer und
Grounddata (Finish, Bild-Ebene, Export, Video, nahtloser Loop).

**Grenzen**: Es geht, was sich aus den Ebenen-Typen kombinieren lässt. Welche Ebenen das Modell wählt, schwankt von
Lauf zu Lauf; die Messung erkennt Farben und Aufbau gut, aber nicht, ob eine helle Fläche Loch oder Körper ist.
Neue Motive brauchen ggf. einen neuen Ebenen-Typ in `TYPES` (ein GLSL-Baustein und eine Zeile im Auftrag).

### Konfiguration – `config.json` + Seite „KI“

`config.json` enthält die Vorgaben; Server, Adresse und Modelle stellst du auf der Seite **KI** ein (gespeichert in diesem Browser).

| Schlüssel | Bedeutung |
|---|---|
| `server` | `ollama`, `lmstudio`, `llamacpp`, `jan`, `vllm` oder `openai` (OpenAI-kompatibel) |
| `url` | Adresse des KI-Servers mit Port |
| `model` | Modell mit Bildverständnis (exakter Name, siehe `ollama list`) |
| `temperature` | Temperatur |
| `numCtx` | Kontextgröße (`num_ctx`, nur Ollama) |
| `maxTokens` | maximale Antwortlänge (`num_predict` bzw. `max_tokens`) |
| `think` | Denkmodus (aus = schneller) |
| `timeouts.generationSec` | Zeitlimit pro Modellaufruf |
| `timeouts.renderMs` | Zeitlimit pro Bild in der Sandbox (Watchdog gegen Endlosschleifen) |
| `refineRounds` | Runden, in denen das Modell das Rezept nach eigenem Vergleich ändert (0 = aus) |
| `fitSteps` | Schritte beim automatischen Angleichen an die Referenz |
| `maxImageSide` | längste Bildseite vor dem Senden |

### Rezept (Antwort des Modells)

```json
{
  "title": "Organisches Netz",
  "notes": "Sehe: … Ebenen: …",
  "background": { "top": "#e8e0e8", "bottom": "#405068", "glow": "#fff0e8", "glowX": 0.1, "glowY": 0.2, "glowSize": 0.6, "glowStrength": 0.8 },
  "camera": { "tilt": 0.6, "roll": -20, "zoom": 0.5, "focus": 0.4, "blur": 0.6, "haze": 0.5 },
  "light": { "angle": 140 },
  "layers": [
    { "type": "mesh", "colorA": "#e8d8e0", "colorB": "#8088a8", "size": 0.45, "fill": 0.3, "chaos": 0.7, "detail": 0.6,
      "relief": 0.8, "gloss": 0.3, "motion": "flow", "move": 0.4, "speed": 1 }
  ]
}
```

Daraus erzeugt die App Regler (`toParams`) und einen Shader (`toCode`); gespeichert wird beides zusammen mit dem Rezept.
Ältere Generatoren (vom Modell geschriebene Shader, Canvas 2D) laufen weiter.

### Sicherheit

Shader werden vor dem Einsatz im Worker kompiliert und probegerendert. Generierter JavaScript-Code (ältere Generatoren) läuft nie in der App selbst, sondern in einem `iframe sandbox="allow-scripts"` (leerer Ursprung,
CSP ohne Netzwerk) und dort in einem Worker mit OffscreenCanvas – ohne Zugriff auf DOM, Speicher oder Netzwerk der App.
Hängt der Code, beendet der Watchdog den Worker nach `renderMs`; die App friert nicht ein. Laufzeitfehler erscheinen
mit Zeilennummer im Viewport.

### Speichern, Presets, Export

- Generatoren liegen im Browser (IndexedDB) mit Rezept, Shader, Parameter-Schema, Prompt, Modellen, Datum, Vorlagen-Version und Thumbnail.
  Über die Karten auf der Seite **KI**: als `.cg-generator.json` sichern bzw. **Importieren** (anderes Gerät/Browser).
- Presets: in der Sandbox über **+** neben der Preset-Auswahl (pro Generator gespeichert).
- Export: PNG/JPG in Format-Auflösung (inkl. Finish), **SVG** (nur ältere Canvas-Generatoren), **Video** (MP4),
  **Shader-Code** als `.glsl`.
- Alle bisherigen Funktionen und Designs bleiben unverändert.

## Tests

```bash
python3 -m unittest tests/test_server.py -v     # Dateiserver
```

- `http://localhost:8765/tests/index.html` – Unit-Tests: Parser, Prompt, Rezept (Ebenen-Typen, Angleichen), Schema, Shader, Sandbox, Prüfung, Client (Ollama/OpenAI, Ausweichstufen, Fehler), Speicher
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
| Ergebnis trifft das Bild nicht | andere Fassung unter dem Ergebnis wählen, „Nochmal versuchen“ (die Ebenen-Auswahl schwankt), Regler nachstellen (Neigung, Größe) |
| Generator „hängt oder ist zu langsam“ | Regler mit hoher Anzahl verringern oder `timeouts.renderMs` erhöhen |
