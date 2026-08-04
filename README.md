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
- [Admin-Passwort einrichten](#admin-passwort-einrichten)
- [Lokal entwickeln/testen](#lokal-entwickelntesten)
- [Build](#build)
- [Deployment auf einen normalen Webserver](#deployment-auf-einen-normalen-webserver)
- [Deployment auf dem Raspberry Pi (Kiosk)](#deployment-auf-dem-raspberry-pi-kiosk)
- [Kiosk-Modus unter Windows](#kiosk-modus-unter-windows-zum-testen-oder-als-alternativ-gerät)
- [Admin-Bereich](#admin-bereich)
- [Feedback-Funktion](#feedback-funktion)
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
                    On-Screen-Tastatur, Modal-/Highscore-/Feedback-Helfer, Icons, Theme
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
server/
  serve.js         Abhaengigkeitsfreier Node-Server: liefert dist/ aus + Feedback-API
feedback/          Zur Laufzeit vom Server angelegt (ein JSON-File pro Feedback-Eintrag, nicht im Git)
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

## Admin-Passwort einrichten

**Erforderlich, bevor irgendetwas anderes hier funktioniert** – weder
`npm run dev` noch `npm run build` laufen ohne diesen Schritt, sie brechen
stattdessen mit einer Fehlermeldung ab, die genau hierher zurueckverweist.

Das Admin-Passwort steht bewusst **nicht** im Quellcode (der oeffentlich auf
GitHub liegt), sondern in einer lokalen `.env.local`-Datei, die per
`.gitignore` (`*.local`) nie eingecheckt wird:

1. `.env.local.example` im Projekt-Wurzelverzeichnis kopieren und in
   `.env.local` umbenennen (gleiche Ebene wie `package.json`).
2. Darin die Zeile `VITE_ADMIN_PASSWORD=DeinPasswortHier` mit einem eigenen
   Passwort anpassen, z. B.:

   ```
   VITE_ADMIN_PASSWORD=MeinNeuesPasswort123
   ```
3. Speichern – fertig. `npm run dev`/`npm run build` lesen die Datei
   automatisch (via Vite).

Passwort spaeter aendern: einfach den Wert in `.env.local` bearbeiten und den
Dev-Server neu starten bzw. neu bauen. Da `.env.local` nie im Repo landet,
docht dieser Weg nicht restlos ab, dass das Passwort niemals irgendwo
sichtbar wird (siehe [Admin-Bereich](#admin-bereich) und
[Bekannte Grenzen](#bekannte-grenzen--ideen-für-später) – der fertige
JS-Bundle enthaelt es zwangslaeufig im Klartext, da rein clientseitig ohne
Backend) – er verhindert aber zumindest, dass es beim naechsten Aendern
versehentlich in einen Commit/Pull-Request landet.

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
npm run serve       # dist/ ueber den eigenen Server ausliefern, inkl. Feedback-API (siehe unten)
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
Shared-Hosting-Webspace, ...) – für die Spiele selbst wird kein
PHP/Datenbank/Backend benötigt. Einzige Ausnahme: Die
[Feedback-Funktion](#feedback-funktion) braucht für die dauerhafte
Dateispeicherung den kleinen mitgelieferten `server/serve.js`-Server (siehe
unten); läuft die App auf reinem statischen Hosting ohne den, greift dafür
automatisch ein `localStorage`-Fallback, alles andere funktioniert
unverändert.

## Deployment auf dem Raspberry Pi (Kiosk)

**Betriebssystem-Wahl: Raspberry Pi OS (Linux), nicht Windows.** Für den
Raspberry Pi 3 gibt es kein von Microsoft offiziell unterstütztes Windows –
die inoffiziellen "Windows on Raspberry"-Projekte zielen praktisch nur auf
Pi 4 und neuer, und selbst dort ist der Kiosk-Betrieb deutlich fummeliger
einzurichten als unter Linux. Raspberry Pi OS ist dagegen das offizielle,
von der Raspberry Pi Foundation selbst gepflegte und für jedes Pi-Modell
(inkl. Pi 3) optimierte Betriebssystem – entsprechend ist auch die
Kiosk-Anleitung in diesem README von Anfang an dafür geschrieben (siehe
Schritt 5 unten). Bei nur 1 GB RAM auf dem Pi 3 wäre ein vollwertiges
Windows ohnehin die deutlich schwergewichtigere, unpassendere Wahl.

Die folgenden Schritte führen ein **komplett unbespieltes** Pi 3 von der
leeren SD-Karte bis zum laufenden Kiosk.

### 1. Raspberry Pi OS auf die SD-Karte spielen

**Was du brauchst:**

- Raspberry Pi 3 (Modell B oder B+)
- microSD-Karte, mindestens 8 GB, empfohlen 16–32 GB (Class 10/A1 für
  ordentliche Schreib-/Lesegeschwindigkeit)
- Ein Kartenlesegerät für den Entwicklungsrechner
- Netzteil (Micro-USB, mindestens 2,5 A – ein zu schwaches Netzteil äußert
  sich oft als unerklärliche Abstürze/Reboots unter Last, nicht als
  offensichtlicher Stromfehler)
- Das Touch-Display inkl. Verkabelung (meist HDMI für Bild + USB für Touch;
  bei einem GPIO-Display stattdessen dessen eigene Treiber-Anleitung
  befolgen)
- Optional Maus/Tastatur für die Ersteinrichtung direkt am Gerät – oder
  komplett "headless" per SSH vom Entwicklungsrechner aus (siehe unten,
  spart den Umweg über einen zweiten Monitor)

**a) Image schreiben:**

1. [Raspberry Pi Imager](https://www.raspberrypi.com/software/) auf dem
   Entwicklungsrechner installieren und öffnen.
2. microSD-Karte einstecken, im Imager auswählen.
3. „Raspberry Pi Device" → **Raspberry Pi 3** wählen.
4. „Operating System" → **Raspberry Pi OS (64-bit)** wählen (mit
   Desktop-Oberfläche, **nicht** „Lite" – die Kiosk-Anleitung unten setzt
   einen laufenden Desktop mit Autostart-Ordner voraus). Der Pi 3
   unterstützt 64-bit seit 2022 offiziell; moderne Software (Chromium,
   Node.js) läuft darauf tendenziell etwas runder als auf der
   32-bit-Variante.
5. „Storage" → die microSD-Karte auswählen.
6. **Vor dem Schreiben** unten auf das Zahnrad („Einstellungen bearbeiten",
   alternativ Strg+Umschalt+X) klicken und dort:
   - Hostname setzen (z. B. `neiphos-kiosk`)
   - „SSH aktivieren" anhaken, Passwort-Authentifizierung wählen
   - Benutzername/Passwort festlegen (in den Befehlen unten wird `pi`
     verwendet – falls ein anderer Name gewählt wurde, dort entsprechend
     ersetzen)
   - Falls kein Netzwerkkabel geplant ist: WLAN-SSID/Passwort eintragen
   - Locale/Tastaturlayout auf Deutschland stellen
   - **"Raspberry Pi Connect" nicht aktivieren** – das ist ein separater
     Fernzugriffsdienst über die Cloud von Raspberry Pi selbst (braucht ein
     eigenes Raspberry-Pi-Konto und hält dauerhaft eine Verbindung nach
     außen offen). Für dieses Projekt unnötig: SSH reicht für den Zugriff
     im eigenen Netzwerk völlig aus, und ein bewusst komplett offline
     laufender Kiosk sollte keine zusätzliche, dauerhaft aktive
     Cloud-Abhängigkeit bekommen.
   Diese Einstellungen sorgen dafür, dass der Pi beim ersten Start direkt
   ohne eigenen Monitor/Tastatur per SSH erreichbar ist.
7. „Schreiben" klicken und warten (Herunterladen + Schreiben + Verifizieren
   kann je nach Kartenleser/-geschwindigkeit 10–20 Minuten dauern).

**b) Erststart:**

1. microSD-Karte in den ausgeschalteten Pi stecken, Display und zuletzt das
   Netzteil anschließen.
2. Der erste Start dauert etwas länger als gewohnt (das Dateisystem wird
   automatisch auf die volle Kartengröße vergrößert). Nach 1–2 Minuten
   sollte entweder der Desktop erscheinen oder – bei Headless-Einrichtung –
   der Pi im Netzwerk erreichbar sein.
3. Vom Entwicklungsrechner aus per SSH verbinden:

   ```bash
   ssh pi@neiphos-kiosk.local
   ```

   (Hostname wie im Imager gesetzt; funktioniert dank mDNS/Bonjour meist
   auch ohne bekannte IP-Adresse. Klappt das nicht, die IP-Adresse
   stattdessen über die Router-Oberfläche nachschauen.)

**c) System aktualisieren, Grundlagen installieren:**

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y nodejs npm
sudo reboot
```

Chromium ist auf „Raspberry Pi OS mit Desktop" normalerweise schon
vorinstalliert (aktuelle Versionen fragen beim allerersten Start sogar, ob
Chromium oder Firefox der Standardbrowser sein soll – bei „Firefox" fehlt
Chromium danach). Fehlt es, per `sudo apt install -y chromium-browser`
nachinstallieren (heißt das Paket in den eingebundenen Quellen ausnahmsweise
nur `chromium`, meldet `apt` das von selbst – dann diesen Namen verwenden).
Das Node.js aus den Standard-Paketquellen reicht für den mitgelieferten
`server/serve.js` locker aus (nutzt nur eingebaute Node-Module, siehe
[Projektstruktur](#projektstruktur)) – der eigentliche Build (`npm run
build`) läuft ohnehin auf dem Entwicklungsrechner, nicht auf dem Pi selbst
(siehe Schritt 2 unten, ein Vite-Build auf der vergleichsweise schwachen
Pi-3-CPU wäre unnötig langsam).

**d) Automatischen Desktop-Login aktivieren** (Voraussetzung, damit
Chromium nach jedem Neustart automatisch startet, siehe Schritt 5):

```bash
sudo raspi-config
```

→ „System Options" → „Boot / Auto Login" → „Desktop Autologin" wählen, dann
neu starten.

**Performance-Hinweis speziell für den Pi 3:** Mit nur 1 GB RAM und einer
deutlich schwächeren CPU/GPU als beim Pi 4/5 startet Chromium spürbar
langsamer, und mehrere gleichzeitig laufende Programme können eng werden.
Diese App selbst nutzt reines 2D-Canvas (kein WebGL, keine 3D-Effekte) und
sollte dadurch auch auf einem Pi 3 grundsätzlich flüssig laufen – hilft es
trotzdem, unnötige Autostart-Programme zu deaktivieren und den
GPU-Speicher-Split über `sudo raspi-config` → „Performance Options" →
„GPU Memory" auf einen kleinen Wert wie `128` zu stellen (mehr GPU-Speicher
bringt einem reinen 2D-Canvas ohnehin nichts, kommt aber dem restlichen
System zugute).

### 2. `dist/` auf den Pi bringen

Auf dem Entwicklungsrechner bauen (braucht Internet), dann z. B. per `scp`
oder USB-Stick auf den Pi kopieren:

```bash
npm run build
scp -r dist pi@raspberrypi.local:/home/pi/neiphos-ticket-machine
```

### 3. Lokalen Webserver auf dem Pi einrichten

Wichtig: `index.html` bindet die App als ES-Module ein (`<script type="module">`).
Browser laden ES-Module aus Sicherheitsgründen **nicht** über `file://` –
`dist/index.html` per Doppelklick öffnen funktioniert deshalb nicht. Es
braucht einen (beliebig einfachen) lokalen HTTP-Server, der ausschließlich
auf `localhost` lauscht – dafür ist weiterhin keine Internetverbindung nötig.

Dafür bringt das Projekt einen eigenen, extrem schlanken Server mit
(`server/serve.js`, nur eingebaute Node-Module, keine Installation
zusätzlicher Pakete nötig außer Node selbst). Er liefert `dist/` aus **und**
nimmt Feedback-Nachrichten entgegen (siehe [Feedback-Funktion](#feedback-funktion)):

```bash
cd /home/pi/neiphos-ticket-machine
node server/serve.js dist 8080
```

Das komplette Projekt (inkl. `server/`, `package.json`) muss dafür auf dem Pi
liegen, nicht nur `dist/` – am einfachsten das ganze Repository klonen/kopieren
und dort `npm run build` laufen lassen, dann `npm run serve` (ruft
`node server/serve.js dist 8080` auf).

Alternativ genügt für reines Ausprobieren ohne Feedback-Funktion auch jeder
andere statische Webserver (z. B. `python3 -m http.server` oder ein
minimaler `nginx`-vHost auf `localhost`) – dann greift für abgeschicktes
Feedback automatisch der lokale `localStorage`-Fallback (siehe unten), es
landet dann aber keine Datei im Dateisystem.

Für den Autostart des Servers siehe [Autostart einrichten](#5-autostart-einrichten-linuxraspberry-pi-os)
weiter unten.

### 4. Chromium im Kiosk-Modus starten (manuell)

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

### 5. Autostart einrichten (Linux/Raspberry Pi OS)

Ziel: Pi einschalten → ohne jeden manuellen Klick landet man im laufenden
Kiosk. Dafür müssen zwei Dinge automatisch starten: der lokale Server (kann
schon vor jedem Login laufen, braucht keine grafische Oberfläche) und
Chromium im Kiosk-Modus (braucht eine laufende Desktop-Sitzung).

**a) Automatischen Desktop-Login aktivieren** (falls noch nicht geschehen):

```bash
sudo raspi-config
```

→ „System Options" → „Boot / Auto Login" → „Desktop Autologin" auswählen,
neu starten.

**b) Server als systemd-Service** (startet schon beim Booten, unabhängig vom Login):

`/etc/systemd/system/ticketmachine-server.service`:

```ini
[Unit]
Description=Neiphos Ticket Machine - lokaler Server
After=network.target

[Service]
ExecStart=/usr/bin/node /home/pi/neiphos-ticket-machine/server/serve.js /home/pi/neiphos-ticket-machine/dist 8080
WorkingDirectory=/home/pi/neiphos-ticket-machine
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ticketmachine-server
```

(`which node` zeigt den genauen Pfad zu `node`, falls er von `/usr/bin/node`
abweicht.)

**c) Chromium per Desktop-Autostart** (startet automatisch nach dem
Desktop-Login der PIXEL-/LXDE-Oberfläche):

Kleines Startskript `/home/pi/neiphos-ticket-machine/start-kiosk.sh` anlegen:

```bash
#!/bin/bash
# Kurz warten, bis der Server-Service sicher steht (nach einem Reboot).
sleep 3
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

```bash
chmod +x /home/pi/neiphos-ticket-machine/start-kiosk.sh
```

Autostart-Eintrag `~/.config/autostart/ticketmachine-kiosk.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Neiphos Ticket Machine Kiosk
Exec=/home/pi/neiphos-ticket-machine/start-kiosk.sh
X-GNOME-Autostart-enabled=true
```

Nach einem Neustart (`sudo reboot`) sollte der Pi jetzt direkt im laufenden
Kiosk starten. Zum manuellen Beenden/Neustarten während der Entwicklung
reicht `pkill chromium-browser` per SSH.

> **Hinweis (aktuelle Raspberry Pi OS-Versionen, "Bookworm" und neuer):** Der
> Standard-Desktop nutzt inzwischen den Wayland-Compositor `labwc` statt des
> alten X11/Openbox-Unterbaus. Der obige `.desktop`-Autostart-Eintrag
> funktioniert dort in der Regel weiterhin (labwc unterstützt den
> XDG-Autostart-Standard), falls nicht, ist die von Raspberry Pi selbst
> empfohlene Alternative, den obigen `chromium-browser`-Aufruf stattdessen an
> das Ende von `~/.config/labwc/autostart` anzuhängen (mit `&` am Zeilenende,
> damit die Datei nicht blockiert).

**Sicherheit/Escape-Wege (Linux):** Anders als bei Windows-Touchscreens (siehe
unten) gibt es unter Raspberry Pi OS standardmäßig **keine** Wisch-Geste von
einem Bildschirmrand, die eine System-Oberfläche (Taskleiste,
Benachrichtigungscenter o. Ä.) einblendet – das ist eine Windows-/Tablet-
Eigenheit, keine X11/Wayland-Eigenheit. Ohne physische Tastatur/Maus kommt man
aus einem korrekt mit den obigen Flags gestarteten `--kiosk`-Chromium auf
einem reinen Touchscreen praktisch nicht heraus. Tastenkombinationen
(Alt+Tab, Strg+Alt+F1–F6 für virtuelle Terminals, Alt+F4, …) funktionieren
zwar weiterhin, setzen aber wie gewünscht eine angeschlossene physische
Tastatur voraus – ein reiner Touch-Zugriff hat darauf keinen Zugriff.

### 6. Bildschirm/Touch-Kalibrierung

Kein App-spezifisches Thema, aber falls Touch-Koordinaten am Rand daneben
liegen: `xinput_calibrator` bzw. die Kalibrierungsroutine des jeweiligen
Touch-Controllers verwenden. Die App selbst reagiert responsiv auf jede
Auflösung/Seitenverhältnis (siehe `core/Canvas.ts`, DPR-bewusstes Skalieren).

## Kiosk-Modus unter Windows (zum Testen oder als Alternativ-Gerät)

Der eigentliche Zielort ist der Raspberry Pi, aber Server und Kiosk-Modus
laufen identisch auch unter Windows (z. B. um alles am Entwicklungsrechner
durchzutesten, bevor es auf den Pi kommt, oder falls doch ein Windows-Mini-PC
statt eines Pi im Automaten verbaut wird).

### 1. Server manuell starten

In einer PowerShell im Projektordner (nach `npm run build`):

```powershell
npm run serve
```

Das startet `node server/serve.js dist 8080` — läuft identisch zur
Pi-Variante, inklusive Feedback-Speicherung als Dateien im `feedback/`-Ordner
neben `dist/`.

### 2. Chromium/Edge manuell im Kiosk-Modus starten

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --kiosk `
  --user-data-dir="$env:LOCALAPPDATA\TicketMachineChromium" `
  --noerrdialogs `
  --disable-pinch `
  --overscroll-history-navigation=0 `
  --autoplay-policy=no-user-gesture-required `
  http://localhost:8080
```

(Ist statt Chrome der in Windows vorinstallierte Edge gewünscht, funktioniert
derselbe Aufruf mit `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`.)
Zum Beenden: Alt+F4 funktioniert im `--kiosk`-Modus bewusst nicht ohne
Weiteres — entweder über den Task-Manager (Strg+Umschalt+Esc) den
Chrome/Edge-Prozess beenden, oder vorher im Admin-Bereich der App den
Vollbildmodus verlassen (siehe [Admin-Bereich](#admin-bereich)).

> ⚠️ **Wichtige Einschränkung dieser Methode:** Der `--kiosk`-Befehlszeilen-
> schalter sperrt nur den *Browser* (keine Adressleiste, kein Tab-Umschalten,
> Alt+F4 blockiert). Er sperrt **nicht** die Windows-Shell selbst. Auf einem
> Touchscreen kann man weiterhin durch Wischen vom Bildschirmrand das
> Info-/Action-Center, die Taskleiste oder die Windows-Startfläche einblenden
> und damit die App verlassen bzw. andere Windows-Funktionen erreichen – das
> ist eine dokumentierte Windows-Eigenheit, keine Einschränkung dieser App.
> Für einen wirklich abgesicherten Produktiveinsatz auf einem
> Windows-Touchscreen siehe **Schritt 4 (Windows-Kioskmodus/Assigned
> Access)** unten – die einfache `--kiosk`-Methode hier eignet sich vor allem
> zum Testen am Entwicklungsrechner ohne Touchscreen.

### 3. Autostart einrichten (Windows, einfache Methode)

Am einfachsten über den **Autostart-Ordner** (kein Admin-Rechte nötig):
`Win+R` → `shell:startup` öffnet den Ordner, der beim Login jedes darin
liegende Programm automatisch startet. Dort eine Datei `start-kiosk.bat`
ablegen:

```bat
@echo off
cd /d "C:\Pfad\zur\Neiphos Ticket Machine"
start "" node server\serve.js dist 8080
timeout /t 3 /nobreak >nul
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --user-data-dir="%LOCALAPPDATA%\TicketMachineChromium" --noerrdialogs --disable-pinch --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required http://localhost:8080
```

Dazu am besten einen Windows-Benutzer einrichten, der sich automatisch
anmeldet (`netplwiz` → Benutzerkonto auswählen → Häkchen bei "Benutzer muss
Kennwort eingeben" entfernen), damit der Rechner nach dem Einschalten direkt
bis zum Kiosk durchstartet.

Für mehr Kontrolle (z. B. automatischer Neustart bei einem Absturz) eignet
sich alternativ die **Aufgabenplanung** (`taskschd.msc`): neue Aufgabe
anlegen, Trigger „Bei Anmeldung", Aktion „Programm starten" →
`start-kiosk.bat`, unter „Bedingungen"/„Einstellungen" z. B. „Aufgabe bei
Fehlschlag neu starten" aktivieren.

### 4. Echte Kiosk-Absicherung unter Windows (empfohlen für Touchscreens)

Für einen Touchscreen, den auch fremde Personen bedienen, reicht Schritt 2/3
oben **nicht** aus (siehe Warnung dort) – dafür bringt Windows selbst eine
richtige Kiosk-Funktion mit, die die komplette Shell sperrt (keine
Wisch-Gesten, keine Taskleiste, kein Action Center):

- **Voraussetzung:** Windows **Pro, Enterprise, Education oder IoT
  Enterprise** – die "Kiosk einrichten"-Funktion fehlt in Windows **Home**.
  Falls nur Home verfügbar ist, bleibt nur Schritt 2/3 oben plus optional die
  Registry-/Gruppenrichtlinien-Einschränkung der Wisch-Geste weiter unten.
- **Einrichtung:** *Einstellungen → Konten → Weitere Benutzer* → unter
  „Kiosk einrichten" auf „Los geht's" → neues (oder bestehendes) lokales
  Benutzerkonto wählen → als App **Microsoft Edge** auswählen → Modus
  „Digitale Beschilderung"/"Vollbild" statt „Öffentliches Surfen" wählen →
  als Start-URL `http://localhost:8080` eintragen.
- Windows meldet dieses Kiosk-Konto beim Start **automatisch** an (kein
  zusätzliches `netplwiz`/Aufgabenplanung nötig) und startet Edge direkt im
  wirklich abgesicherten Vollbild – Taskleiste, Info-/Action-Center,
  Startmenü und Wisch-Gesten vom Bildschirmrand sind dabei gesperrt.
- **Verlassen:** Strg+Alt+Entf (Standard-Tastenkombination, in der
  Konfigurationsdatei änderbar) – setzt wie gewünscht eine physische
  Tastatur voraus, über reinen Touch kommt man nicht heraus.
- Der lokale Server (`npm run serve` bzw. der Autostart-Eintrag aus Schritt
  3) muss weiterhin separat laufen, bevor sich das Kiosk-Konto anmeldet.

Alternativ (falls aus irgendeinem Grund bei der einfachen `--kiosk`-Methode
aus Schritt 2/3 geblieben werden soll, z. B. weil nur Windows Home verfügbar
ist, aber `gpedit.msc` z. B. über eine Enterprise-Testversion doch vorhanden
ist): die Wisch-Geste lässt sich separat über die Gruppenrichtlinie
*Computerkonfiguration → Administrative Vorlagen → Windows-Komponenten →
Edge-UI* deaktivieren (danach Neustart nötig) – das blockiert das Einblenden
jeder System-UI per Rand-Wisch-Geste, ohne die volle Assigned-Access-Funktion
einzurichten.

**Was diese App/Anleitung nicht abdecken kann:** physische Tasten am
Monitor-/Display-Gehäuse selbst (z. B. Helligkeit, Eingangsquelle,
Power) – das hängt vollständig vom jeweils verwendeten Bildschirm ab, nicht
von Windows/Linux oder dieser App. Viele für den Dauerbetrieb gedachte
Displays (Infoscreens, manche Touch-Monitore) haben dafür eine eigene
"Tastensperre"/"Key Lock"-Funktion im Bildschirmmenü (OSD) – in der
Bedienungsanleitung des konkreten Geräts nachsehen, ob und wie sich diese
Tasten sperren lassen.

## Admin-Bereich

Zahnrad-Symbol oben rechts, von überall in der App erreichbar (auch während
ein Spiel läuft). Passwort: siehe eigene lokale `.env.local`-Datei, dort
selbst festgelegt (siehe [Admin-Passwort einrichten](#admin-passwort-einrichten) –
steht bewusst nicht mehr hier im öffentlichen Repo). Groß-/Kleinschreibung
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
- **Feedback anschauen** – zeigt, sofern vorhanden, eine Zahl auf gelbem
  Grund mit der Anzahl ungelesener Rückmeldungen. Ein Klick öffnet die Liste
  (neueste zuerst) und markiert alle gerade angezeigten Einträge als
  gelesen – siehe [Feedback-Funktion](#feedback-funktion).

## Feedback-Funktion

Unten im Hauptmenü (unter den Spielkacheln) gibt es einen unauffälligen
"Feedback geben"-Button. Er öffnet einen Freitext-Dialog mit derselben
Bildschirmtastatur wie überall sonst in der App – bewusst **keine
Systemtastatur**, damit niemand über eine Texteingabe versehentlich aus dem
Kiosk-Modus herausgelangt.

Abgeschicktes Feedback wird an den lokalen Server geschickt
(`POST /api/feedback`, siehe `server/serve.js`) und dort als einzelne
JSON-Datei im Ordner `feedback/` abgelegt – **neben** `dist/`, nicht darin
(ein `npm run build` leert `dist/` bei jedem Lauf, das Feedback darf davon
nicht betroffen sein). Das funktioniert identisch, egal ob die App gerade
lokal auf dem Pi oder auf einem Webserver läuft, solange dort `server/serve.js`
das Ausliefern übernimmt.

**Fallback ohne eigenen Server:** Läuft die App auf einem rein statischen
Hosting ohne `server/serve.js` (z. B. `npx serve`, `vite preview`, ein reiner
Shared-Hosting-Webspace, oder einfach beim Testen mit `npm run dev`), gibt es
dort keinen `POST`-Endpunkt. Die App merkt das automatisch (der Request
schlägt fehl) und legt das Feedback stattdessen in `localStorage` auf dem
jeweiligen Gerät ab, damit nichts verloren geht. Im Admin-Bereich werden
Server- und lokal-gespeichertes Feedback gemeinsam angezeigt; rein lokal
gespeicherte Einträge sind mit "· nur lokal" gekennzeichnet.

Die Feedback-API ist bewusst ohne eigene Authentifizierung – sie liegt hinter
demselben Admin-Passwort-Gate wie die Statistik-Ansicht in der Oberfläche,
ein direkter Zugriff auf `/api/feedback` wäre aber technisch ohne Passwort
möglich, sofern der Server von außerhalb des Kiosk-Geräts erreichbar ist. Für
den vorgesehenen Einsatzzweck (ein isoliertes Kiosk-Gerät bzw. ein privater
Testserver) ist das ausreichend, siehe auch die Einschränkung beim
Admin-Passwort unten.

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

- **Admin-Passwort** kommt zwar inzwischen aus einer nicht eingecheckten
  `.env.local` statt fest im Quellcode zu stehen (siehe
  [Admin-Passwort einrichten](#admin-passwort-einrichten)), landet aber als
  reine Client-App ohne Backend zwangsläufig trotzdem im Klartext im
  gebauten JS-Bundle (`dist/`) – wer Zugriff auf das ausgelieferte `dist/`
  hat, kann es dort auslesen. Für den Dauerbetrieb wäre ein änderbares
  Passwort mit echter serverseitiger Prüfung (z. B. über die Admin-UI
  selbst, gehasht, mit einem kleinen Backend-Endpunkt) ein sinnvoller
  nächster Schritt.
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
- **Feedback-API ohne eigene Authentifizierung** – `server/serve.js` prüft
  bei `/api/feedback` kein Passwort (nur die App-Oberfläche selbst gated die
  Ansicht hinter dem Admin-Login). Für ein isoliertes Kiosk-Gerät ohne
  öffentlich erreichbaren Port ist das unkritisch; wird der Server jemals von
  außerhalb erreichbar gemacht, wäre ein Auth-Header/Token ein sinnvoller
  nächster Schritt.
