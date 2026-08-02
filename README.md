# Neiphos Ticket Machine

Offline-Kiosk-Spielesammlung für einen umgebauten Fahrkartenautomaten. Ein
Touch-Display (Hochformat, nahe 4:3) wird von einem Raspberry Pi 5 angesteuert,
Chromium läuft im Kiosk-Modus, komplett ohne Internetverbindung.

Aus einem Hauptmenü heraus sind sieben Zug-/Bahn-Minigames erreichbar:

1. **Verbindungssuche** – zwischen zwei Berliner Haltestellen die Linien
   (U-/S-Bahn/Tram) in der richtigen Reihenfolge wählen, um eine möglichst
   direkte Verbindung zu puzzeln.
2. **Zug-Quartett** – Top-Trumps mit 20 recherchierten, echten Zügen.
3. **Passagiere zählen** – ein Zug fährt vorbei, du zählst die Fahrgäste
   hinter den Fenstern und schätzt die Anzahl.
4. **Weichenspiel** – als Zug unterwegs an jeder Weiche rechtzeitig links,
   Mitte oder rechts wählen, bevor die Sackgasse kommt.
5. **Zug-Spotter** – ein Bilderraster, so schnell wie möglich alle Züge
   zwischen ähnlichen Fahrzeugen antippen.
6. **Zug-Memory** – klassisches Memory mit Zugbildern, wählbare
   Spielfeldgröße (4×4 / 6×6 / 8×8).
7. **DJ-Mischer** – ein 16-Step-Sequencer, mit dem sich aus synthetisierten
   Zuggeräuschen ein Beat bauen lässt.

Dazu ein passwortgeschützter Admin-Bereich (Zahnrad oben rechts, überall im
Programm erreichbar) mit Kiosk-/Vollbild-Steuerung und Spielstatistik.

---

## Inhalt

- [Tech-Stack](#tech-stack)
- [Projektstruktur](#projektstruktur)
- [Architektur](#architektur)
- [Lokal entwickeln/testen](#lokal-entwickelntesten)
- [Build](#build)
- [Deployment auf einen normalen Webserver](#deployment-auf-einen-normalen-webserver)
- [Deployment auf dem Raspberry Pi (Kiosk)](#deployment-auf-dem-raspberry-pi-kiosk)
- [Admin-Bereich](#admin-bereich)
- [Neues Minigame hinzufügen](#neues-minigame-hinzufügen)
- [Assets, Lizenzen, Credits](#assets-lizenzen-credits)
- [Bekannte Grenzen / Ideen für später](#bekannte-grenzen--ideen-für-später)

---

## Tech-Stack

- **TypeScript + Vite** (kein Framework, kein UI-Kit)
- **HTML5 Canvas** für alle Spiel-Inhalte, ergänzt um DOM-Overlays (Listen,
  Bildschirmtastatur, Buttons) für Bereiche, in denen native Touch-Bedienung
  einfacher/robuster ist als manuelles Canvas-Hit-Testing (Menü, Admin,
  Auswahllisten, Bilderraster)
- **Web Audio API** für den DJ-Mischer (kein Audio-File nötig)
- **localStorage** für Highscores und Spielstatistik (rein geräte-lokal)
- Keine Backend-Anbindung, keine externen Netzwerkaufrufe zur Laufzeit

Alle Schriftarten (Barlow / Barlow Semi Condensed, SIL OFL) und alle Bilder
liegen lokal im Repo (`src/assets/`) – der Build braucht beim Bauen zwar
Internet (npm-Pakete, ursprüngliche Asset-Recherche), das fertige `dist/`
danach nicht mehr.

## Projektstruktur

```
src/
  core/            Router, Game-Loop, Canvas-Setup, Input, Storage, Kiosk-Haertung,
                    On-Screen-Tastatur, Modal-/Highscore-Helfer, Icons, Theme
  menu/            Hauptmenue (DOM-Kacheln)
  admin/           Admin-Bereich (Passwort-Gate, Kiosk-Toggle, Statistik)
  games/
    registry.ts    Zentrale Spiele-Registry (GameMeta[])
    index.ts       Importiert (und registriert damit) alle Minigame-Module
    connection-puzzle/
    train-quartet/
    count-passengers/
    switch-run/
    train-spotter/
    memory/
    dj-mixer/
  data/            Berlin-Nahverkehrsnetz, Zug-Datenbank, Distraktor-Bilder
  assets/
    fonts/         Lokale Barlow-Schriftdateien + Lizenz
    images/trains/ Zugfotos (Wikimedia Commons, freie Lizenz) + CREDITS.md
    images/distractors/  "Kein Zug"-Fotos fuer Spotter/Memory + CREDITS.md
  main.ts          Einstiegspunkt: Kiosk-Haertung + Router starten
  style.css        Gesamtes CSS (Theme-Variablen, Layout, Komponenten)
```

## Architektur

**Router** (`src/core/Router.ts`) ist die einzige Stelle, die zwischen
Hauptmenü und einem laufenden Minigame umschaltet. Er kümmert sich um:

- Canvas erzeugen/entfernen und DPR-Skalierung (`core/Canvas.ts`)
- die gemeinsame `requestAnimationFrame`-Loop (`core/GameLoop.ts`)
- Pointer-Events (Touch **und** Maus, da die Pointer-Events-API verwendet
  wird – dadurch funktioniert alles 1:1 auch im Desktop-Browser beim
  Entwickeln)
- garantiertes Aufräumen: `cleanup()` jedes Spiels wird beim Verlassen immer
  aufgerufen, Event-Listener werden entfernt, die Loop wird gestoppt, offene
  Modals (z. B. eine Highscore-Namenseingabe) werden zwangsweise geschlossen

Jedes Minigame implementiert das `MinigameModule`-Interface
(`src/core/Game.ts`):

```ts
interface MinigameModule {
  id: string;
  init(env: GameEnv): void | Promise<void>;
  update(dt: number, env: GameEnv): void;
  render(env: GameEnv): void;
  onResize?(env: GameEnv): void;
  onPointerDown?(p: PointerPoint, env: GameEnv): void;
  onPointerMove?(p: PointerPoint, env: GameEnv): void;
  onPointerUp?(p: PointerPoint, env: GameEnv): void;
  cleanup(env: GameEnv): void;
}
```

`GameEnv` enthält Canvas, 2D-Context, aktuelle Größe (in CSS-Pixeln), ein
`overlay`-DOM-Element für HTML-Steuerelemente oberhalb des Canvas sowie
`exit()`, um sauber ins Menü zurückzukehren.

Ein Spiel registriert sich selbst beim Import über `registerGame(...)` in
`games/registry.ts`; `games/index.ts` importiert einmalig alle Spiele (rein
für den Registrierungs-Seiteneffekt) und wird von `main.ts` geladen. Menü und
Router kennen nur die Registry, nie ein einzelnes Spiel direkt – dadurch lässt
sich ein neues Spiel andocken, ohne bestehenden Code anzufassen (siehe
[Neues Minigame hinzufügen](#neues-minigame-hinzufügen)).

**Highscores** (`core/storage.ts`) liegen unter `ntm:highscore:<spielId>:<board>`
in `localStorage`, optional pro "Board" (z. B. Memory-Spielfeldgröße).
**Spielstatistik** (`core/stats.ts`) protokolliert pro Sitzung Spiel-ID,
Start-/Endzeit und Dauer unter `ntm:stats:sessions` – das speist die
Admin-Statistikansicht.

## Lokal entwickeln/testen

Voraussetzung: [Node.js](https://nodejs.org/) (getestet mit Node 24), npm.

```bash
npm install
npm run dev
```

Vite startet einen lokalen Dev-Server (Standard: `http://localhost:5173`,
Terminal-Ausgabe beachten) mit Hot-Module-Reload – Code-Änderungen erscheinen
sofort im Browser, **ohne dass jedes Mal manuell gebaut werden muss**. Einfach
im normalen Browser (Chrome/Edge/Firefox) öffnen und mit der Maus statt Touch
testen – alle Eingaben laufen über die Pointer-Events-API, Maus und Touch
verhalten sich identisch.

Nützliche Zusatzbefehle:

```bash
npm run typecheck   # nur TypeScript pruefen, ohne zu bauen
npm run preview     # gebautes dist/ lokal ausliefern (Test des Produktions-Builds)
```

**Touch-Verhalten im Desktop-Browser testen:** Die meisten Browser bieten in
den DevTools einen Geräte-/Touch-Emulationsmodus (Chrome: DevTools → Toggle
Device Toolbar). Für die eigentliche Kiosk-Härtung (Kontextmenü, Pinch-Zoom
etc.) reicht das aus, für "does it feel right on real glass" empfiehlt sich
trotzdem ein kurzer Test auf einem echten Touchscreen vor dem Aufspielen.

## Build

```bash
npm run build
```

Das Ergebnis liegt in `dist/` – eine rein statische Sammlung aus HTML, JS,
CSS und Assets. `vite.config.ts` setzt `base: "./"` (relative Pfade), dadurch
läuft dasselbe `dist/`-Verzeichnis unverändert:

- direkt von einem lokalen Webserver auf dem Pi (`http://localhost:PORT/`)
- von einer Unterseite/einem Unterordner einer normalen Domain
- von einem beliebigen anderen statischen Webserver

`npm run preview` liefert `dist/` lokal aus, um den Produktions-Build vor dem
Deployment zu prüfen.

## Deployment auf einen normalen Webserver

Für einen schnellen Test von unterwegs (eigener Server mit eigener Domain,
z. B. per FTP/SCP erreichbar) reicht es, den Inhalt von `dist/` nach dem
Build hochzuladen:

```bash
npm run build
# Inhalt von dist/ z. B. per scp hochladen:
scp -r dist/* user@dein-server:/pfad/zu/oeffentlichem/ordner/
```

Da `base: "./"` gesetzt ist, funktioniert das **egal in welchem Unterordner**
der Domain die Dateien landen (z. B. `https://deine-domain.de/ticketmachine/`)
– es müssen keine Pfade angepasst werden. Ein Aufruf der URL im Browser zeigt
die App genauso wie lokal; für den eigentlichen Kiosk-Betrieb auf dem Pi ist
das aber nur zum Testen/Vorführen gedacht, nicht der Normalbetrieb (der läuft
komplett offline, siehe unten).

Es reicht ein beliebiger Webserver, der statische Dateien mit korrekten
MIME-Types ausliefert (Apache, Nginx, GitHub Pages, Netlify, ein einfacher
Shared-Hosting-Webspace, ...). Es wird kein PHP/Datenbank/Backend benötigt.

## Deployment auf dem Raspberry Pi (Kiosk)

### 1. `dist/` auf den Pi bringen

Auf dem Entwicklungsrechner bauen (braucht Internet), dann z. B. per `scp`
oder USB-Stick auf den Pi kopieren:

```bash
npm run build
scp -r dist pi@raspberrypi.local:/home/pi/neiphos-ticket-machine
```

### 2. Lokalen Webserver auf dem Pi einrichten

Wichtig: `index.html` bindet die App als ES-Module ein (`<script type="module">`).
Browser laden ES-Module aus Sicherheitsgründen **nicht** über `file://` –
`dist/index.html` per Doppelklick öffnen funktioniert deshalb nicht. Es
braucht einen (beliebig einfachen) lokalen HTTP-Server, der ausschließlich
auf `localhost` lauscht – dafür ist weiterhin keine Internetverbindung nötig.

Am einfachsten mit Node (auf dem Pi einmalig `Node.js` installieren):

```bash
sudo npm install -g serve
serve -s /home/pi/neiphos-ticket-machine/dist -l 8080
```

Alternativ genügt jeder andere statische Webserver (z. B. `python3 -m http.server`
oder ein minimaler `nginx`-vHost auf `localhost`).

Damit das automatisch bei jedem Boot startet, als systemd-Service einrichten
(`/etc/systemd/system/ticketmachine-server.service`):

```ini
[Unit]
Description=Neiphos Ticket Machine - lokaler Webserver
After=network.target

[Service]
ExecStart=/usr/bin/serve -s /home/pi/neiphos-ticket-machine/dist -l 8080
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now ticketmachine-server
```

### 3. Chromium im Kiosk-Modus starten

Chromium mit dem `--kiosk`-Flag zeigt keine Adressleiste, keine Tabs, kein
Browser-Chrome – nur die Seite selbst im Vollbild. Empfohlene Flags für einen
dauerhaft laufenden Touch-Kiosk:

```bash
chromium-browser \
  --kiosk \
  --user-data-dir=/home/pi/.config/ticketmachine-chromium \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  http://localhost:8080
```

Hinweise zu den Flags:

- `--user-data-dir=...`: eigenes, dauerhaftes Profilverzeichnis nur für
  diesen Kiosk. **Bewusst kein `--incognito`**: Highscores und Spielstatistik
  liegen in `localStorage`, das an das Chromium-Profil gebunden ist – ein
  Incognito-Profil wird bei jedem Neustart verworfen und würde alle
  Highscores löschen. Mit einem festen `--user-data-dir` bleibt alles über
  Neustarts hinweg erhalten.
- `--disable-pinch` / `--overscroll-history-navigation=0`: zusätzliches Netz
  neben der App-seitigen Kiosk-Härtung (siehe `core/kiosk.ts`)
- `--autoplay-policy=no-user-gesture-required`: nötig, falls der DJ-Mischer
  ohne vorherigen Tap Ton ausgeben soll (Web Audio API braucht sonst zwingend
  eine Nutzer-Geste – im Spiel selbst reicht der erste Tap auf "Abspielen"
  auch ohne dieses Flag)

Auch das am besten als eigener systemd-User-Service, der nach dem
Desktop-Login (bzw. direkt nach dem Server-Service) startet, oder klassisch
über einen Autostart-Eintrag (`~/.config/autostart/ticketmachine.desktop` bei
einer Desktop-Umgebung wie PIXEL/LXDE).

### 4. Bildschirm/Touch-Kalibrierung

Kein App-spezifisches Thema, aber falls Touch-Koordinaten am Rand daneben
liegen: `xinput_calibrator` bzw. die Kalibrierungsroutine des jeweiligen
Touch-Controllers verwenden. Die App selbst reagiert responsiv auf jede
Auflösung/Seitenverhältnis (siehe `core/Canvas.ts`, DPR-bewusstes Skalieren).

## Admin-Bereich

Zahnrad-Symbol oben rechts, von überall in der App erreichbar (auch während
ein Spiel läuft). Aktuelles Passwort: **`Neiphos`** (Groß-/Kleinschreibung
spielt beim Eingeben keine Rolle – die Bildschirmtastatur kennt ohnehin nur
Großbuchstaben, es gibt keine Umschalttaste, da auf einem Touch-Kiosk ohnehin
niemand zwischen Groß-/Kleinschreibung unterscheiden könnte).

Im Admin-Bereich:

- **Kiosk-Modus starten/beenden** – schaltet den Browser-Vollbildmodus
  (Fullscreen API) dieser Webseite um. Das ist *nicht* dasselbe wie Chromium
  komplett im `--kiosk`-Modus zu beenden (das kann eine Webseite aus
  Sicherheitsgründen grundsätzlich nicht selbst auslösen) – wurde Chromium
  mit `--kiosk` gestartet, hilft zum vollständigen Verlassen nur ein
  Neustart/Beenden des Browserprozesses auf dem Gerät selbst (SSH, Tastatur,
  oder das Deaktivieren des Autostart-Service und Neustart des Pi).
- **Spielstatistik** – pro Spiel, wie oft gespielt und Gesamtspielzeit;
  aufklappbar für die einzelnen Zeitpunkte/Dauern jeder Sitzung.
  "Statistik zurücksetzen" löscht die komplette Historie.

## Neues Minigame hinzufügen

1. Ordner `src/games/<name>/` anlegen, darin ein `index.ts`, das
   `MinigameModule` implementiert (siehe z. B. `games/switch-run/index.ts`
   für ein kompaktes, oder `games/connection-puzzle/` für ein aufgeteiltes
   Beispiel mit eigener `graph.ts`/`ui.ts`).
2. Am Ende der Datei `registerGame({ id, title, subtitle, icon, accent, create })`
   aufrufen. `icon` muss ein Schlüssel aus `core/icons.ts` sein (bei Bedarf
   dort ein neues einfaches Linien-Icon ergänzen).
3. In `src/games/index.ts` einmal `import "./<name>";` ergänzen.
4. Fertig – das Spiel taucht automatisch als Kachel im Hauptmenü auf, Router,
   Highscore-/Statistik-Infrastruktur funktionieren ohne weitere Anpassung.

Gemeinsame Bausteine, die sich jedes neue Spiel einfach mitnehmen kann:

- `core/OnScreenKeyboard.ts` – Bildschirmtastatur (numerisch oder
  alphanumerisch, auch für Passwort-Masken nutzbar)
- `core/highscorePrompt.ts` – fertiger Dialog "Neuer Highscore, gib deinen
  Namen ein"
- `core/storage.ts` – `getHighscore` / `isNewHighscore` / `setHighscore`,
  optional mit `board`-Parameter für mehrere Highscore-Tabellen pro Spiel
- CSS-Bausteine in `style.css`: `.stage-top-bar`, `.stage-sheet`,
  `.stage-center-panel`, `.tile-grid`, `.chip`/`.chip-row`, `.ticket-card`,
  `.btn`/`.btn--accent`/`.btn--ghost`, `.modal-panel`

## Assets, Lizenzen, Credits

- **Schriften:** Barlow / Barlow Semi Condensed, SIL Open Font License 1.1,
  lokal unter `src/assets/fonts/` (inkl. `OFL.txt`)
- **Zugfotos:** `src/assets/images/trains/CREDITS.md` – 20 Fotos von
  Wikimedia Commons, jeweils mit Lizenz und Urheber:in
- **"Kein Zug"-Fotos** (Zug-Spotter/Memory): `src/assets/images/distractors/CREDITS.md`
- **DJ-Mischer-Sounds:** komplett prozedural per Web Audio API synthetisiert
  (`games/dj-mixer/sounds.ts`), keine Audiodateien, keine Lizenzfragen. Das
  Türschließsignal ist bewusst dem echten, ikonischen Berliner
  S-Bahn-"Da-Düü-Da" nachempfunden (Tondreiklang C–E–C). Die Ansage-Spur
  ("Bitte die Fahrkarten bereithalten") nutzt die Web Speech API
  (`speechSynthesis`) statt einer Audiodatei — funktioniert offline, sofern
  auf dem Gerät/im Browser eine deutsche TTS-Stimme installiert ist (bei
  Standard-Raspberry-Pi-OS ggf. nicht der Fall); ist keine Stimme vorhanden,
  bleibt die Spur einfach stumm, es gibt keinen Fehler.
- **Berlin-Nahverkehrsnetz** (`src/data/berlinNetwork.ts`): recherchiert über
  die deutsch-/englischsprachige Wikipedia. Enthält alle U-Bahn-Linien
  (U1–U9, U12) und die wichtigsten S-Bahn-Linien mit echter, stationsgenauer
  Reihenfolge. Ein paar sehr kleine, zum RechercheZeitpunkt unklare/instabile
  Außenäste (u. a. S45/S46/S47 im BER-Umfeld, S85) wurden bewusst
  weggelassen, um keine unsicheren Daten auszuliefern. Die Tram-Linien
  (M1/M2/M4/M5/M6/M8/M10) sind auf ihre wichtigsten Haltestellen reduziert,
  nicht jede einzelne Haltestelle – das komplette Berliner Tramnetz hat über
  20 Linien, hier ist eine repräsentative Auswahl der zentralen
  Metro-Tram-Linien abgebildet.
- **Zug-Datenbank** (`src/data/trains.ts`): 20 Züge, Kennzahlen aus den
  jeweiligen Wikipedia-Infoboxen. Bei sehr alten Dampflokomotiven (u. a.
  Stephenson's Rocket) sind einzelne Werte (v. a. die Leistung) historische
  Schätzungen, da es dafür keine modernen Werksangaben mehr gibt.

## Bekannte Grenzen / Ideen für später

- **Admin-Passwort** ist aktuell ein simpler Klartext-Konstante im Code
  (`admin/AdminPanel.ts`). Für den Start bewusst einfach gehalten wie
  besprochen – für den Dauerbetrieb wäre ein änderbares Passwort (z. B. über
  die Admin-UI selbst, gehasht in `localStorage`) ein sinnvoller nächster
  Schritt.
- **Kiosk-Start/-Stopp aus der App heraus** kann nur den Browser-eigenen
  Vollbildmodus schalten, nicht Chromium selbst neu starten/beenden (siehe
  [Admin-Bereich](#admin-bereich)) – das ist eine grundsätzliche
  Browser-Sicherheitsgrenze, kein Bug. Falls das später wirklich gebraucht
  wird, bräuchte es einen kleinen nativen Helper-Prozess auf dem Pi (z. B.
  ein systemd-Service, den ein winziger lokaler Endpunkt neu starten
  darf) – bewusst nicht gebaut, um keine lokale Shell-Angriffsfläche zu
  öffnen, ohne dass das explizit gewünscht ist.
- **Tram-Netz** ist wie oben beschrieben eine kuratierte Auswahl der
  zentralen Linien, keine vollständige Abbildung aller Berliner Tramlinien.
  Busse sind in der Verbindungssuche bewusst (noch) nicht enthalten — das
  wäre nochmal ein eigener, größerer Rechercheaufwand.
- **DJ-Mischer** hat aktuell sechs synthetisierte Sounds plus eine
  gesprochene Ansage, und ein gemeinsames
  16-Step-Raster für alle Spuren (kein individuelles Tempo pro Spur, keine
  Pattern-Speicherung). Deckt die Kernidee "eigenen Beat aus
  Zuggeräuschen bauen" ab, ließe sich aber gut um Presets, Lautstärke pro
  Spur oder mehrere Patterns erweitern.
- **Statistik/Highscores** liegen in `localStorage` und sind damit an das
  Chromium-Profil (siehe `--user-data-dir` oben) gebunden, nicht an ein
  Server-Backend. Wird das Profilverzeichnis gelöscht oder wechselt das
  Gerät, gehen sie verloren – für diesen Offline-Kiosk mit einem Gerät völlig
  ausreichend, aber kein Ersatz für eine "echte" Datenbank, falls später z. B.
  mehrere Automaten ihre Highscores teilen sollen.
