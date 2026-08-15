# Neiphos Ticket Machine

Offline-Kiosk-Spielesammlung für einen umgebauten Fahrkartenautomaten. Ein
Touch-Display (Querformat) wird von einem Raspberry Pi 5 angesteuert, Chromium
läuft im Kiosk-Modus, komplett ohne Internetverbindung. Die App ist bewusst
nur im Querformat nutzbar (siehe .orientation-lock in style.css) -- bei
Hochformat blockiert ein "Bitte Gerät drehen"-Hinweis die Bedienung.

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
6. **Zug-Memory** – klassisches Memory mit Zugbildern (auch mit
   Hüpftier-Motiven spielbar), wählbare Spielfeldgröße (4×2 / 4×3 / 4×4).
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
  - [`server/serve.js` dauerhaft auf einem eigenen VPS laufen lassen](#serverservejs-dauerhaft-auf-einem-eigenen-vps-laufen-lassen)
- [Geräteübergreifende Synchronisation (optional)](#geräteübergreifende-synchronisation-optional)
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

**Erneut hochladen (Update):** In diesem einfachen Fall (reines statisches
Hosting, kein eigener `server/serve.js`-Prozess) genügt es, exakt denselben
Befehl noch einmal auszuführen – `npm run build` gefolgt vom erneuten
`scp -r dist/* ...`. Vorhandene Dateien werden dabei überschrieben, ein
Neustart oder sonst irgendein weiterer Schritt ist nicht nötig, der
Webserver liefert beim nächsten Seitenaufruf automatisch den neuen Stand
aus. (Läuft stattdessen `server/serve.js` auf einem eigenen VPS, gilt
stattdessen der eigene Update-Ablauf weiter unten, der zusätzlich einen
Neustart des Server-Prozesses braucht.)

Es reicht ein beliebiger Webserver, der statische Dateien mit korrekten
MIME-Types ausliefert (Apache, Nginx, GitHub Pages, Netlify, ein einfacher
Shared-Hosting-Webspace, ...) – für die Spiele selbst wird kein
PHP/Datenbank/Backend benötigt. Einzige Ausnahme: Die
[Feedback-Funktion](#feedback-funktion) braucht für die dauerhafte
Dateispeicherung den kleinen mitgelieferten `server/serve.js`-Server (siehe
unten); läuft die App auf reinem statischen Hosting ohne den, greift dafür
automatisch ein `localStorage`-Fallback, alles andere funktioniert
unverändert.

### `server/serve.js` dauerhaft auf einem eigenen VPS laufen lassen

**Nur relevant, wenn Feedback wirklich zentral (nicht nur pro Gerät als
`localStorage`-Fallback) gespeichert werden soll, oder für die
[geräteübergreifende Synchronisation](#geräteübergreifende-synchronisation-optional)
weiter unten.** Reines Hochladen von `dist/*` in ein normales Webspace-
Verzeichnis (z. B. per WinSCP/FTP) reicht dafür **nicht** – dabei läuft kein
eigener Prozess, der die kleinen APIs (`/api/feedback`, `/api/highscores`, …)
beantworten könnte, jede Anfrage dorthin läuft ins Leere und die App fällt
automatisch auf den lokalen `localStorage`-Fallback zurück (unauffällig,
aber eben nicht geräteübergreifend). Auf einem eigenen VPS mit SSH-Zugriff:

**0. Node.js auf dem VPS installieren, falls noch nicht vorhanden** (`node
--version` zeigt, ob und welche Version schon da ist; meldet die Shell
„Kommando nicht gefunden", fehlt es komplett):

```bash
sudo apt update
sudo apt install -y nodejs npm
node --version
```

(Debian/Ubuntu – bei anderen Distributionen `dnf`/`yum`/`pacman` statt `apt`.
`server/serve.js` nutzt nur eingebaute Node-Module und stellt daher keine
besonderen Anforderungen an die genaue Node-Version.)

**1. Projekt (inkl. `server/`, nicht nur `dist/`) auf den VPS bringen** – am
einfachsten das ganze Repository klonen oder `dist/` UND den `server/`-Ordner
gemeinsam hochladen:

```bash
scp -r dist server user@dein-vps:/pfad/zu/neiphos-ticket-machine/
```

`server/serve.js` braucht dafür kein `npm install` – nur eingebaute
Node-Module, siehe Datei-Kommentar oben drin. Auf dem VPS sollten `server/`
und `dist/` danach nebeneinander in einem gemeinsamen Projektordner liegen:

```
/pfad/zu/neiphos-ticket-machine/
├── server/
│   └── serve.js
├── dist/
│   └── index.html, assets/, …
└── .env.local          ← kommt in Schritt 2 GENAU hierhin, NICHT in server/ oder dist/
```

**2. `.env.local` direkt auf dem VPS anlegen** (per SSH, **nicht** über einen
erneuten Upload aus dem lokalen Projektordner – dort ist die Datei absichtlich
nie eingecheckt, siehe [Admin-Passwort einrichten](#admin-passwort-einrichten)):
auf **derselben Ebene wie `server/` und `dist/`**, also als deren
gemeinsames Geschwister-Element (`server/serve.js` sucht sie automatisch
genau dort, einen Ordner oberhalb von sich selbst):

```bash
ssh user@dein-vps
cd /pfad/zu/neiphos-ticket-machine
nano .env.local
```

Inhalt (Passwort muss **exakt** dem entsprechen, mit dem `dist/` lokal gebaut
wurde – es steckt schon fest im hochgeladenen JS-Bundle):

```
VITE_ADMIN_PASSWORD=DasGleichePasswortWieBeimBuild
```

(Optional zusätzlich `NTM_SYNC=1` für die Synchronisation, siehe unten.)

**3. Kurz manuell testen:**

```bash
node server/serve.js dist 8080
# in einem zweiten Terminal/Fenster:
curl -I http://localhost:8080
```

Mit Strg+C wieder beenden, sobald das funktioniert.

**4. Dauerhaft laufen lassen, per systemd** (übersteht Neustarts und einen
Absturz – identisches Muster wie beim Raspberry Pi, siehe
[Autostart einrichten](#5-autostart-einrichten-linuxraspberry-pi-os), hier
nur ohne den Kiosk-Browser-Teil):

`/etc/systemd/system/ticketmachine-server.service`:

```ini
[Unit]
Description=Neiphos Ticket Machine - Server
After=network.target

[Service]
ExecStart=/usr/bin/node /pfad/zu/neiphos-ticket-machine/server/serve.js /pfad/zu/neiphos-ticket-machine/dist 8080
WorkingDirectory=/pfad/zu/neiphos-ticket-machine
Restart=always
User=dein-linux-benutzer

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ticketmachine-server
```

**5. Die eigentliche Domain auf diesen Prozess zeigen lassen.** `serve.js`
lauscht nur auf einem eigenen Port (hier `8080`), nicht auf Port 80/443 –
ein bereits laufender Apache/Nginx auf dem VPS muss die öffentliche Domain
also per **Reverse Proxy** dorthin weiterleiten, statt (wie bisher) direkt
ein statisches Verzeichnis auszuliefern. **Nginx und Apache sind
Alternativen zueinander – nur den Abschnitt für den Webserver befolgen, der
auf dem eigenen VPS tatsächlich läuft** (meist am vorhandenen
`sites-available`/`sites-enabled`-Ordner bzw. an `mod_ssl`/`a2ensite`-Befehlen
in bestehenden Configs erkennbar – Apache).

*Apache* – in der bestehenden vHost-Datei (meist unter
`/etc/apache2/sites-available/`, für **beide** Varianten falls sowohl ein
`:80`- als auch ein `:443`-VirtualHost existieren, siehe Let's-Encrypt/SSL-
Setup) die vorhandene `DocumentRoot ...`-Zeile komplett durch die drei
`Proxy...`-Zeilen ersetzen:

```apache
<VirtualHost *:443>
    ServerName deine-domain.de
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8080/
    ProxyPassReverse / http://127.0.0.1:8080/
    # ... SSL-Zeilen (SSLEngine/SSLCertificateFile/...) bleiben unveraendert stehen
</VirtualHost>
```

```bash
sudo a2enmod proxy proxy_http
sudo apache2ctl configtest
sudo systemctl reload apache2
```

*Nginx* – Beispiel (`/etc/nginx/sites-available/deine-domain.de`):

```nginx
server {
    listen 80;
    server_name deine-domain.de;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/deine-domain.de /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Läuft auf dem VPS noch gar kein eigener Webserver und die Domain zeigt
bereits direkt auf den Server, kann `serve.js` alternativ auch direkt an
Port 80 gebunden werden (`node server/serve.js dist 80`) – dafür sind aber
Root-Rechte nötig, ein Reverse Proxy vor einem bestehenden Apache/Nginx ist
der robustere Standardweg (insbesondere mit bereits eingerichtetem
Let's-Encrypt-SSL wie oben, das unabhängig vom Proxy-Ziel weiterläuft).

Nach diesem Umbau übernimmt `server/serve.js` das komplette Ausliefern von
`dist/` (nicht mehr das bisherige direkte Hochladen von `dist/*` ins
Webspace-Verzeichnis).

#### Updates auf diesen VPS einspielen

**Nur relevant, wenn Schritte 0–5 oben schon einmal erledigt sind** (der
Server läuft bereits dauerhaft per systemd) **und du nur neuen Code hochladen
willst:**

```bash
# Auf dem Entwicklungsrechner:
npm run build
scp -r dist server user@dein-vps:/pfad/zu/neiphos-ticket-machine/
```

(`server/` nur nötig, wenn sich dort etwas geändert hat – schadet aber
nicht, immer mitzuschicken. `.env.local` wird dabei nie angefasst, das liegt
ja gar nicht im lokalen Projektordner, siehe Schritt 2 oben.)

Danach den Server-Prozess neu starten, damit er das neue `dist/` wirklich
ausliefert (ein bereits laufender `serve.js`-Prozess merkt von sich aus
nichts von neu hochgeladenen Dateien):

```bash
ssh user@dein-vps "sudo systemctl restart ticketmachine-server"
```

Das war's – kein erneutes `npm install`, keine Änderungen an der
systemd-Unit oder am Reverse-Proxy nötig, solange sich nur der
Anwendungscode (nicht z. B. der Server-Port) geändert hat. Ein Reverse
Proxy (Nginx/Apache, siehe Schritt 5) merkt vom Neustart des dahinterliegenden
Node-Prozesses nichts und muss dafür nicht selbst neu gestartet werden.

## Geräteübergreifende Synchronisation (optional)

> **Wichtig, bevor du weiterliest:** Dieser Abschnitt ist ein rein
> optionales Extra für den Fall, dass die App auf einem echten,
> öffentlich erreichbaren Webserver läuft und mehrere Besucher-Endgeräte
> (Handys, Laptops – nicht der eine Kiosk-Automat) denselben Stand teilen
> sollen. Er hat **nichts** mit dem normalen Kiosk-Betrieb zu tun und
> ändert an dessen Verhalten nichts: Ohne den unten beschriebenen Schalter
> verhält sich der Server exakt so, als gäbe es diesen Abschnitt nicht.
> Setzt außerdem voraus, dass `server/serve.js` dort überhaupt als
> dauerhafter Prozess läuft, siehe
> [„server/serve.js dauerhaft auf einem eigenen VPS laufen lassen"](#serverservejs-dauerhaft-auf-einem-eigenen-vps-laufen-lassen)
> weiter oben. Für die Einrichtung des eigentlichen, dauerhaft
> offline laufenden Automaten bitte direkt zu
> [Deployment auf dem Raspberry Pi (Kiosk)](#deployment-auf-dem-raspberry-pi-kiosk)
> springen – der kommt komplett ohne das hier aus.

Im Grundzustand ist jedes Gerät für sich: Highscores, Spielstatistik und die
Einstellung, welche Spiele im Hauptmenü erscheinen, liegen ausschließlich in
`localStorage` des jeweiligen Browsers (nur Feedback landet ohnehin schon
immer serverseitig, siehe [Feedback-Funktion](#feedback-funktion)). Läuft die
App aber dauerhaft auf einem eigenen Webserver mit einem laufenden
Node.js-Prozess (nicht nur reines statisches Hosting), kann sie stattdessen
so tun, als würden alle Besucher:innen dasselbe Gerät benutzen: Highscores
werden geräteübergreifend zusammengeführt, die Spielstatistik lässt sich im
Admin-Bereich geräteübergreifend einsehen, und wenn der Admin z. B. ein Spiel
im Hauptmenü aus-/einblendet, gilt das sofort für alle.

### Aktivieren

**Empfohlen: eine Zeile in `.env.local`** (dieselbe Datei, die schon das
Admin-Passwort enthält, siehe
[Admin-Passwort einrichten](#admin-passwort-einrichten)) – im
Projekt-Wurzelverzeichnis auf dem Webserver, **neben** `dist/`, nicht darin:

```
NTM_SYNC=1
```

Das ist bewusst der empfohlene Weg und keine Umgebungsvariable: `.env.local`
liegt außerhalb von `dist/` und ist per `.gitignore` (`*.local`) von Git
ausgeschlossen – ein erneutes `npm run build` **auf dem Entwicklungsrechner**
und anschließendes Hochladen von nur `dist/*` (siehe
[Deployment auf einen normalen Webserver](#deployment-auf-einen-normalen-webserver))
rührt diese Datei auf dem Server also nie an. Einmal auf dem Server angelegt,
bleibt die Synchronisation dauerhaft aktiv, ganz unabhängig davon, wie oft
danach neuer Code hochgeladen wird.

Alternativ (z. B. wenn ein systemd-Service die Variable ohnehin schon setzt)
funktioniert weiterhin auch die klassische Umgebungsvariable beim Start von
`server/serve.js`:

```bash
# Linux/macOS/Pi:
NTM_SYNC=1 node server/serve.js dist 8080
```

```powershell
# Windows (PowerShell):
$env:NTM_SYNC = "1"
node server/serve.js dist 8080
```

Ohne `NTM_SYNC=1` (der Standard – insbesondere auf dem Kiosk-Pi, siehe oben,
wo diese Zeile in `.env.local` deshalb einfach wegzulassen ist) antworten
alle unten genannten Sync-Endpunkte mit `404`, als gäbe es sie nicht; die App
fällt dann automatisch und lautlos auf rein lokale Speicherung zurück. Es ist
also unbedenklich, denselben, unveränderten `server/serve.js` sowohl auf dem
Offline-Kiosk (ohne den Schalter) als auch auf einem Sync-Webserver (mit dem
Schalter) einzusetzen.

### Was wird synchronisiert, und wo landet es

Genau wie beim Feedback (siehe oben) legt der Server alles als einzelne
JSON-Dateien/-Ordner **neben** `dist/` ab, nicht darin (ein `npm run build`
leert `dist/` bei jedem Lauf):

- `highscores/` – ein Datei pro Highscore-Brett (`<Spiel>__<Board>.json`),
  Inhalt identisch zum lokalen `localStorage`-Format. Ein neu erspielter
  Highscore wird an den Server geschickt und dort mit dem bestehenden Brett
  zusammengeführt (bei Gleichstand reihen sich mehrere Namen ein, siehe
  `getHighscoreOutcome` in `core/storage.ts`); umgekehrt zieht jedes Gerät
  beim Start und bei jedem Besuch des Hauptmenüs den aktuellen Serverstand,
  merged ihn mit dem eigenen und zeigt so automatisch die
  geräteübergreifende Bestenliste.
- `stats/` – eine Datei pro Spielsitzung (wie beim Feedback, um
  Schreibkonflikte bei gleichzeitigen Einsendungen verschiedener Geräte zu
  vermeiden). Wird **nicht** in `localStorage` der Besucher-Geräte
  zurückgemischt (das würde jedes Gerät dauerhaft mit fremden Sitzungen
  aufblähen), sondern nur für die Admin-Statistik-Ansicht bei Bedarf vom
  Server dazugeholt und dort mit den lokalen Sitzungen dieses Geräts
  zusammengeführt angezeigt.
- `settings.json` – aktuell nur `disabledGameIds` (welche Spiele im
  Hauptmenü ausgeblendet sind). Wird vom Admin-Bereich aus geschrieben und
  von jedem Gerät (nicht nur dem Admin-Gerät) gelesen, damit die
  Menü-Sichtbarkeit wirklich für alle gleich ist.

### Wie zuverlässig ist das?

Bewusst "best effort", nicht wie eine klassische Datenbank mit Transaktionen:
Jedes Schreiben (ein Highscore, eine Spielsitzung, eine Einstellungsänderung)
wird lokal **zuerst und unabhängig vom Server** in `localStorage` abgelegt,
der Versand an den Server passiert nur als zusätzlicher Hintergrund-Vorgang
("fire and forget") und wird bei einem Netzwerkfehler oder nicht erreichbarem
Server einfach stillschweigend übersprungen – kein Ladebildschirm, kein
Fehlerdialog, kein blockierter Spielstart. Genauso lesen alle bestehenden
Codepfade in den einzelnen Minispielen unverändert synchron aus
`localStorage`; der Sync-Code (`core/sync.ts`) klinkt sich nur zusätzlich als
Nebeneffekt ein, kein einziges Minigame musste dafür angepasst werden.

### Zugriffsschutz

Lesend öffentlich (jede:r Besucher:in braucht das für die Anzeige während des
Spielens): `GET /api/highscores`, `GET /api/settings`, sowie das (rate-
limitierte) Einsenden `POST /api/highscores` und `POST /api/stats`. Admin-
geschützt per `X-Admin-Password`-Header (dasselbe Passwort wie
`VITE_ADMIN_PASSWORD` in `.env.local`, siehe
[Admin-Passwort einrichten](#admin-passwort-einrichten)): das Lesen der
Statistik (`GET /api/stats`), Ändern der Einstellungen
(`POST /api/settings`) sowie beide Zurücksetzen-Buttons im Admin-Bereich
(`POST /api/highscores/reset`, `POST /api/stats/reset`). Ohne konfiguriertes
Passwort bleiben diese Endpunkte serverseitig grundsätzlich gesperrt (`503`),
nicht offen. Der Admin-Bereich zeigt oben einen kleinen Hinweis an, ob die
Synchronisation gerade aktiv/erreichbar ist.

Einsendungen bei den öffentlichen Highscore-/Statistik-Endpunkten werden nur
grob auf Plausibilität geprüft (Zahlenformat, sinnvolle Wertegrenzen, keine
absurd langen Namen) und pro IP-Adresse rate-limitiert – das ist **kein**
echter Schutz vor absichtlichem Cheaten (dafür bräuchte es serverseitige
Spiellogik oder echte Benutzerkonten), sondern fängt nur offensichtlichen
Unsinn/Spam ab. Für den vorgesehenen Einsatzzweck (Festival-Aufsteller mit
überschaubarem, bekanntem Publikum) ist das ausreichend.

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
   - Hostname setzen (z. B. `neiphos-ticket-machine`) – lässt sich später
     jederzeit per SSH mit `sudo hostnamectl set-hostname <name>` und
     anschließendem `sudo reboot` ändern (der Reboot sorgt dafür, dass auch
     die mDNS-Ankündigung für `<name>.local`, siehe unten, den neuen Namen
     übernimmt)
   - „SSH aktivieren" anhaken, Passwort-Authentifizierung wählen
   - Benutzername/Passwort festlegen (in den Befehlen unten wird als
     Beispiel `flipper` verwendet – der Benutzername ist frei wählbar,
     bei einem anderen gewählten Namen dort einfach entsprechend ersetzen)
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
3. **Nur falls ein Monitor angeschlossen ist**, kann beim allerersten Start
   trotzdem noch der grafische Einrichtungsassistent „Welcome to Raspberry
   Pi" erscheinen, obwohl Benutzer/Passwort/WLAN schon per Imager gesetzt
   wurden (bekannte Eigenart aktueller Raspberry Pi OS-Versionen
   „Bookworm" – die Imager-Einstellungen werden trotzdem übernommen, der
   Assistent fragt aber sicherheitshalber noch mal nach). Einfach
   durchklicken:
   - Wird erneut nach einem Benutzernamen/Passwort gefragt: irgendeinen
     memorierbaren Namen vergeben (muss nicht zwingend mit dem im Imager
     übereinstimmen) – **dieser** Name/Passwort ist danach der
     maßgebliche für den Login und die SSH-Befehle unten, nicht mehr der
     ursprünglich im Imager eingetragene.
   - Bei der Frage nach dem Standardbrowser **unbedingt Chromium wählen,
     nicht Firefox** – die komplette Kiosk-Einrichtung unten (Schritt 4/5)
     baut auf Chromium auf; bei „Firefox" wird Chromium anschließend sogar
     deinstalliert (siehe Hinweis unten bei Schritt c).
   - Bei rein headless per SSH eingerichteten Pis (kein Monitor
     angeschlossen) taucht dieser Assistent nicht auf; dann einfach mit
     Schritt 4 weitermachen.
4. Vom Entwicklungsrechner aus per SSH verbinden:

   ```bash
   ssh flipper@neiphos-ticket-machine.local
   ```

   (Hostname wie im Imager gesetzt; funktioniert dank mDNS/Bonjour auf
   macOS/Linux meist auch ohne bekannte IP-Adresse. **Unter Windows
   klappt `<name>.local` dagegen oft nicht ohne Weiteres** – der
   eingebaute OpenSSH-Client von Windows unterstützt mDNS-Auflösung nur
   eingeschränkt, das ist kein Zeichen für einen Fehler in der
   Pi-Einrichtung. Fehlermeldungen wie „Unknown error“ oder „Could not
   resolve hostname“ auf Port 22 deuten darauf hin.

   **Dauerhafte Abhilfe (einmalig, funktioniert danach in praktisch jedem
   WLAN, nicht nur zu Hause):** [Bonjour Print
   Services](https://support.apple.com/kb/DL999) auf dem Windows-Rechner
   installieren (kostenloser, kleiner Download von Apple) – rüstet
   Windows um vollwertige mDNS-Auflösung nach, danach funktioniert
   `<name>.local` genau wie unter macOS/Linux. Einzige Ausnahme: WLANs mit
   aktivierter "Client-/AP-Isolation" (bei manchen öffentlichen/Festival-
   Netzen der Fall) blockieren die dafür nötige Multicast-Kommunikation
   zwischen Geräten grundsätzlich – dagegen hilft auch das nicht.

   **Übergangsweise/ohne Installation:** die IP-Adresse des Pi über die
   jeweilige Router-Oberfläche nachschauen (bei einer FritzBox z. B. unter
   `http://fritz.box` → „Heimnetz" → „Netzwerk" in der Geräteliste, dort
   taucht der Pi unter seinem Hostnamen auf) und sich stattdessen per
   `ssh flipper@<IP-Adresse>` verbinden – funktioniert aber nur in
   Netzwerken mit einer erreichbaren Router-Oberfläche, also z. B. nicht
   in einem unbekannten Festival-WLAN.

   **Garantierter Fallback, unabhängig von jedem Netzwerk (empfohlen für
   unterwegs/das Festival):** eine gewöhnliche USB-Tastatur an den Pi
   anschließen und direkt am angeschlossenen Kiosk-Display ein Terminal
   öffnen (Taskleiste bzw. Rechtsklick auf den Desktop → „Terminal öffnen“
   je nach Desktop-Umgebung) – das braucht überhaupt kein WLAN/Router/SSH
   und funktioniert dadurch garantiert, egal wie das Netzwerk vor Ort
   aussieht oder ob überhaupt eins vorhanden ist.

   **Falls das Gerät im Netzwerk erreichbar ist (Ping/Namensauflösung
   funktioniert), Port 22 aber trotzdem nicht antwortet:** Dann läuft der
   SSH-Dienst auf dem Pi selbst nicht, obwohl „SSH aktivieren“ im Imager
   angehakt war – das passiert insbesondere dann, wenn beim Erststart
   (siehe Schritt 3 oben) zusätzlich noch der grafische
   Ersteinrichtungsassistent durchlaufen und dort erneut ein
   Benutzer/Passwort vergeben wurde: Dieser Assistent übernimmt dabei
   offenbar nicht zuverlässig alle Imager-Einstellungen, insbesondere
   nicht die SSH-Aktivierung. Abhilfe direkt am Pi (über das angeschlossene
   Display/Tastatur, siehe Fallback oben):

   ```bash
   sudo systemctl status ssh
   ```

   Steht der Dienst auf `inactive`/`disabled`, dauerhaft aktivieren und
   sofort starten (kein Neustart nötig):

   ```bash
   sudo systemctl enable --now ssh
   ```)

**c) System aktualisieren, Grundlagen installieren:**

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y nodejs npm
sudo reboot
```

Chromium ist auf „Raspberry Pi OS mit Desktop" normalerweise schon
vorinstalliert (aktuelle Versionen fragen beim allerersten Start sogar, ob
Chromium oder Firefox der Standardbrowser sein soll – bei „Firefox" fehlt
Chromium danach). Das eigentliche Kommando/Paket heißt auf aktuellem
Raspberry Pi OS (Bookworm/Trixie-Basis) **`chromium`**, nicht
`chromium-browser` – Letzteres existiert zwar teils noch als winziges
Uralt-Kompatibilitätspaket (installiert dann aber keinen echten Browser,
`which chromium-browser` bleibt danach leer). Prüfen/nachinstallieren:

```bash
which chromium || sudo apt install -y chromium
```
Das Node.js aus den Standard-Paketquellen reicht für den mitgelieferten
`server/serve.js` locker aus (nutzt nur eingebaute Node-Module, siehe
[Projektstruktur](#projektstruktur)) – der eigentliche Build (`npm run
build`) läuft ohnehin auf dem Entwicklungsrechner, nicht auf dem Pi selbst
(siehe Schritt 2 unten, ein Vite-Build auf der vergleichsweise schwachen
Pi-3-CPU wäre unnötig langsam).

**Emoji-Schriftart nachinstallieren** – ein frisches Raspberry Pi OS bringt
oft keine Farb-Emoji-Schriftart mit; die App nutzt an einigen Stellen (z. B.
Admin-Statusmeldungen, kleine Hinweistexte) einzelne Emoji als Symbol – ohne
passende Schriftart bleiben die als leere Fläche sichtbar. Die
funktional wichtigsten Symbole (z. B. Zug-/Hüpftier-Auswahl bei Memory und
Zug-Spotter) sind bewusst als eigene, schriftartunabhängige Icons gebaut
(siehe `core/icons.ts`) und daher davon nicht betroffen – für den Rest:

```bash
sudo apt install -y fonts-noto-color-emoji
```

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

### 2. `dist/` und `server/` auf den Pi bringen

Auf dem Entwicklungsrechner bauen (braucht Internet), dann **beide** Ordner
z. B. per `scp` oder USB-Stick auf den Pi kopieren – `server/` nicht
vergessen, siehe Schritt 3 unten:

```bash
npm run build
scp -r dist server flipper@neiphos-ticket-machine.local:/home/flipper/neiphos-ticket-machine
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
cd /home/flipper/neiphos-ticket-machine
node server/serve.js dist 8080
```

Dafür reichen **genau diese beiden Ordner** (`dist/` + `server/`, siehe
Schritt 2) – kein komplettes Repository/`git clone`, kein `npm install`
nötig. `server/package.json` (liegt bereits im `server/`-Ordner) sorgt
dafür, dass Node die `import`-Syntax in `serve.js` versteht, auch ohne die
Projekt-Wurzel-`package.json`.

Alternativ genügt für reines Ausprobieren ohne Feedback-Funktion auch jeder
andere statische Webserver (z. B. `python3 -m http.server` oder ein
minimaler `nginx`-vHost auf `localhost`) – dann greift für abgeschicktes
Feedback automatisch der lokale `localStorage`-Fallback (siehe unten), es
landet dann aber keine Datei im Dateisystem.

Für den Autostart des Servers siehe [Autostart einrichten](#5-autostart-einrichten-linuxraspberry-pi-os)
weiter unten.

### 3b. WLAN-Verwaltung im Admin-Bereich freischalten (polkit)

Der Admin-Bereich kann WLAN scannen/verbinden/trennen (siehe
[Admin-Bereich](#admin-bereich)) – dafür ruft `server/serve.js` im
Hintergrund `nmcli` auf. Läuft der Server als systemd-Dienst (siehe Schritt 5)
statt in einer interaktiven Desktop-Sitzung, verweigert NetworkManager diese
Aktionen standardmäßig mit `not authorized` – auch wenn der Nutzer `flipper`
bereits Mitglied der `netdev`-Gruppe ist (polkit prüft dafür meist eine
*aktive lokale Sitzung*, die ein Hintergrund-Dienst nicht hat). Ohne die
folgende Regel scheitern WLAN-Scan/-Trennen im Admin-Bereich unsichtbar,
genau wie admin-geschützte Aktionen ohne gesetzte `.env.local` (siehe
[Admin-Passwort einrichten](#admin-passwort-einrichten)) – beides leicht zu
übersehen, wenn ein neuer Pi aufgesetzt wird.

Einmalig auf dem Pi einrichten:

```bash
sudo tee /etc/polkit-1/rules.d/50-flipper-networkmanager.rules > /dev/null <<'EOF'
polkit.addRule(function(action, subject) {
    if (action.id.indexOf("org.freedesktop.NetworkManager.") === 0 &&
        subject.user == "flipper") {
        return polkit.Result.YES;
    }
});
EOF
sudo systemctl restart polkit
```

(Läuft der Server unter einem anderen Linux-Benutzer als `flipper`, dessen
Namen entsprechend anpassen.)

### 3c. Emoji-Schriftart installieren (Bildschirmschoner)

Der [Bildschirmschoner](#admin-bereich) zeigt eine Lok-Emoji-Glyphe ("🚂").
Ein frisch aufgesetztes Raspberry Pi OS bringt dafür standardmäßig **keine**
Farb-Emoji-Schriftart mit (`fc-list | grep -i emoji` liefert nichts) – ohne
sie zeigt Chromium nur ein leeres Kästchen statt der Lok. Einmalig auf dem
Pi einrichten:

```bash
sudo apt-get install -y fonts-noto-color-emoji
```

Chromium danach einmal neu starten (siehe [Autostart einrichten](#5-autostart-einrichten-linuxraspberry-pi-os)
bzw. für einen laufenden Kiosk `pkill chromium`, der Autostart übernimmt den
Rest), damit die neue Schriftart erkannt wird.

### 4. Chromium im Kiosk-Modus starten (manuell)

Chromium mit dem `--kiosk`-Flag zeigt keine Adressleiste, keine Tabs, kein
Browser-Chrome – nur die Seite selbst im Vollbild. Empfohlene Flags für einen
dauerhaft laufenden Touch-Kiosk:

```bash
chromium \
  --kiosk \
  --user-data-dir=/home/flipper/.config/ticketmachine-chromium \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --password-store=basic \
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
- `--password-store=basic`: verhindert, dass Chromium versucht, den
  System-Schlüsselbund (GNOME Keyring) für gespeicherte Passwörter zu
  verwenden – ohne dieses Flag fragt Chromium beim allerersten Start (bzw.
  bei jedem Start, falls der Schlüsselbund nie eingerichtet wird) auf dem
  Pi-Bildschirm nach einem Keyring-Passwort und blockiert dort auf eine
  Eingabe, die es beim Kiosk-Betrieb nie geben wird.

**Hinweis zur GPU-Beschleunigung:** Meldet Chromium beim Start
`MESA-LOADER: failed to open dri: ... Keine Berechtigung` (sichtbar z. B. in
den systemd-Logs, `journalctl -u ticketmachine-server` bzw. beim manuellen
Testen im Terminal), fehlt dem verwendeten Benutzer die Berechtigung für die
GPU-Gerätedateien – Chromium fällt dann auf (spürbar langsameres)
Software-Rendering zurück. Fix:

```bash
sudo usermod -aG render,video flipper
sudo reboot
```

### 5. Autostart einrichten (Linux/Raspberry Pi OS)

Ziel: Pi einschalten → ohne jeden manuellen Klick landet man im laufenden
Kiosk. Dafür müssen zwei Dinge automatisch starten: der lokale Server (kann
schon vor jedem Login laufen, braucht keine grafische Oberfläche) und
Chromium im Kiosk-Modus (braucht eine laufende Desktop-Sitzung).

**a) Automatischen Desktop-Login aktivieren** – bereits in Schritt 1d
erledigt (`sudo raspi-config` → „System Options" → „Boot / Auto Login" →
„Desktop Autologin"), falls nicht: dort nachholen.

**b) Server als systemd-Service** (startet schon beim Booten, unabhängig vom Login):

`/etc/systemd/system/ticketmachine-server.service`:

```ini
[Unit]
Description=Neiphos Ticket Machine - lokaler Server
After=network.target

[Service]
ExecStart=/usr/bin/node /home/flipper/neiphos-ticket-machine/server/serve.js /home/flipper/neiphos-ticket-machine/dist 8080
WorkingDirectory=/home/flipper/neiphos-ticket-machine
Restart=always
User=flipper

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

Kleines Startskript `/home/flipper/neiphos-ticket-machine/start-kiosk.sh` anlegen:

```bash
#!/bin/bash
# Aktiv warten, bis der Server-Service wirklich Anfragen beantwortet,
# statt einer festen Wartezeit -- ein fester "sleep 3" reichte nicht
# zuverlaessig: auf einem realen Pi hat der Server-Start nach einem Reboot
# einmal ueber 7 Sekunden gedauert (offenbar durch andere Boot-Vorgaenge,
# die kurz nach dem Start noch um SD-Karten-I/O konkurrieren). Chromium
# bekam dann eine fehlgeschlagene allererste Ladeanfrage (localhost:8080
# war noch nicht erreichbar) und zeigt seitdem dauerhaft einen leeren
# weissen Bildschirm -- im --kiosk-Modus laedt Chromium eine einmal
# fehlgeschlagene Seite nie von selbst neu (gemeldeter Bug). 30 Versuche im
# Sekundentakt sind grosszuegig genug fuer jeden realistischen Boot-Fall;
# antwortet der Server auch danach noch nicht, startet Chromium trotzdem
# (besser ein Ladefehler als endlos zu warten).
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:8080 && break
  sleep 1
done
chromium \
  --kiosk \
  --user-data-dir=/home/flipper/.config/ticketmachine-chromium \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --password-store=basic \
  http://localhost:8080
```

```bash
chmod +x /home/flipper/neiphos-ticket-machine/start-kiosk.sh
```

Autostart-Eintrag `~/.config/autostart/ticketmachine-kiosk.desktop` anlegen
(der Ordner `~/.config/autostart` existiert auf einem frischen Pi meist noch
nicht, `mkdir -p` legt ihn bei Bedarf mit an):

```bash
mkdir -p ~/.config/autostart
```

```ini
[Desktop Entry]
Type=Application
Name=Neiphos Ticket Machine Kiosk
Exec=/home/flipper/neiphos-ticket-machine/start-kiosk.sh
X-GNOME-Autostart-enabled=true
```

Nach einem Neustart (`sudo reboot`) sollte der Pi jetzt direkt im laufenden
Kiosk starten. Zum manuellen Beenden/Neustarten während der Entwicklung
reicht `pkill chromium` per SSH.

> **Hinweis (aktuelle Raspberry Pi OS-Versionen, "Bookworm" und neuer):** Der
> Standard-Desktop nutzt inzwischen den Wayland-Compositor `labwc` statt des
> alten X11/Openbox-Unterbaus. Der obige `.desktop`-Autostart-Eintrag
> funktioniert dort in der Regel weiterhin (labwc unterstützt den
> XDG-Autostart-Standard), falls nicht, ist die von Raspberry Pi selbst
> empfohlene Alternative, den obigen `chromium`-Aufruf stattdessen an
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

### 6b. Deployment vor Ort (Festival, ohne festes WLAN)

Der Pi braucht während der eigentlichen Vorbereitung/eines Updates vor Ort
irgendein gemeinsames Netzwerk mit dem Entwicklungsrechner (für Schritt 7
unten). Ohne Festival-WLAN bietet sich dafür der **Mobile Hotspot eines
Handys** an, oder – zuverlässiger, siehe unten – ein kleiner
**batteriebetriebener Reise-Router** (braucht selbst kein Internet, nur ein
gemeinsames lokales Netz für Pi und Laptop).

**Wichtig beim Handy-Hotspot: unbedingt das 2,4-GHz-Band aktiv lassen.**
Das WLAN-Modul des Raspberry Pi 3 (BCM43438) empfängt **ausschließlich
2,4 GHz** – kein 5 GHz, unabhängig von Software-/Regulierungsdomain-
Einstellungen (das WLAN-Land ist bereits korrekt auf `DE` gesetzt, siehe
`iw reg get` bei Bedarf zur Kontrolle). Viele aktuelle Android-Handys
(u. a. Samsung) stellen den Mobile Hotspot standardmäßig auf **„5 GHz"**
oder **„Automatisch"** – dann sieht der Pi das Netz überhaupt nicht, egal
wie oft neu gescannt wird (kein Cache-/Boot-Problem, ein WLAN-Scan im
Admin-Bereich stößt bei jedem Klick auf „Netzwerke suchen"/„Aktualisieren"
serverseitig einen echten `nmcli ... --rescan yes` an, siehe
`server/serve.js`).

Konkret getestet (Samsung Galaxy S24, Mobiler Hotspot → Konfigurieren →
Band):

- ✅ **„2,4 GHz und 5 GHz"** (beide Bänder gleichzeitig) – funktioniert, der
  Pi findet und verbindet sich zuverlässig.
- ❌ **„Nur 5 GHz"** – der Pi sieht das Netz gar nicht erst in der
  Scan-Liste.

Im Admin-Bereich (WLAN → „Netzwerke suchen") lässt sich das Ergebnis direkt
per **„Aktualisieren"**-Button im sich öffnenden Netzwerke-Fenster erneut
prüfen, ohne das Fenster dafür schließen zu müssen.

Für den eigentlichen Dateitransfer (Build hochladen) siehe Schritt 7 (per
Netzwerk) bzw. Schritt 8 (per USB-Stick, falls doch kein gemeinsames Netz
zustande kommt).

### 7. Updates auf einem bereits eingerichteten Pi einspielen

**Nur relevant, wenn Schritte 1–6 oben schon einmal erledigt sind** (Pi
läuft bereits als Kiosk) **und du nur neuen Code hochladen willst** – die
Schritte 1–6 sind reine Ersteinrichtung, für ein Update davon nichts mehr
nötig.

```bash
# Auf dem Entwicklungsrechner:
npm run build
scp -r dist server flipper@neiphos-ticket-machine.local:/home/flipper/neiphos-ticket-machine/
```

(`server/` nur nötig, wenn sich dort etwas geändert hat – schadet aber
nicht, immer mitzuschicken. `.env.local` wird dabei nie angefasst, siehe
oben.)

Danach den Pi einmal neu starten, damit sowohl der Server (neues `dist/`)
als auch Chromium (zeigt sonst weiter die alte, bereits geladene Seite) den
neuen Stand übernehmen. Wichtig: **`-t`** nicht vergessen – ohne dieses Flag
alloziert `ssh` kein Pseudo-Terminal für den entfernt ausgeführten Befehl,
`sudo` kann dann nicht sicher nach dem Passwort fragen und bricht mit
„sudo: Zum Lesen des Passworts ist ein Terminal erforderlich" ab:

```bash
ssh -t flipper@neiphos-ticket-machine.local "sudo reboot"
```

(Danach ganz normal wie bei einem lokalen `sudo`-Aufruf das Passwort
eintippen, wenn danach gefragt wird.)

Das war's – kein erneutes `npm install`, keine Änderungen an
systemd-Service oder Autostart-Eintrag nötig, solange sich nur der
Anwendungscode (nicht z. B. der Server-Port oder Dateipfade) geändert hat.

### 8. Update per USB-Stick (ohne WLAN/Netzwerk)

**Alternative zu Schritt 7**, falls kein gemeinsames WLAN zwischen
Entwicklungsrechner und Pi verfügbar ist (z. B. unterwegs, Festival-WLAN
gesperrt/nicht vorhanden). Ein direktes USB-**Kabel** zwischen Laptop und
Pi allein reicht dafür beim Pi 3 nicht aus – seine USB-Anschlüsse
unterstützen (anders als z. B. beim Pi Zero) nur den "Host"-Modus, können
sich also nicht selbst als Netzwerkgerät am Laptop anmelden. Der
praktikable Ersatz dafür ist ein gewöhnlicher **USB-Stick** als
Zwischenträger:

1. Auf dem Entwicklungsrechner bauen und auf einen (FAT32- oder
   exFAT-formatierten, das liest sowohl Windows als auch Linux direkt ohne
   Zusatztreiber) USB-Stick kopieren:

   ```bash
   npm run build
   ```

   Dann `dist/` und `server/` einfach im Explorer auf den USB-Stick
   kopieren (z. B. in einen Ordner `neiphos-update` auf dem Stick).

2. USB-Stick am Pi einstecken. Direkt am Gerät (Monitor/Tastatur, siehe
   auch den Notausgang-Hinweis weiter unten) ein Terminal öffnen. Der Stick
   wird unter Raspberry Pi OS meist automatisch eingehängt, üblicherweise
   unter `/media/flipper/<Name-des-Sticks>/` (`lsblk` zeigt bei Bedarf den
   genauen Pfad).

3. Von dort in den Projektordner kopieren (Pfad zum Stick ggf. anpassen):

   ```bash
   cp -r /media/flipper/*/neiphos-update/dist /home/flipper/neiphos-ticket-machine/
   cp -r /media/flipper/*/neiphos-update/server /home/flipper/neiphos-ticket-machine/
   sudo reboot
   ```

   (Hier läuft `sudo reboot` direkt lokal am Gerät, nicht per SSH – das
   Terminal-Problem von Schritt 7 betrifft nur den Fernzugriff und tritt
   hier nicht auf.)

### 9. USB-Debugging (SSH/Konsole ohne WLAN)

**Wichtig vorweg:** Ein einfaches USB-Kabel zwischen Laptop und einem der
regulären USB-A-Anschlüsse des Pi kann dafür **nicht** genutzt werden. Der
Raspberry Pi 3 hat (anders als ein Pi Zero/Zero 2 W oder ein Pi 4/5 mit
USB-C) **keinen USB-OTG/Gadget-Modus** – seine USB-Ports können sich einem
angeschlossenen Rechner gegenüber nicht als Netzwerk- oder serielles Gerät
ausgeben, sie funktionieren ausschließlich als USB-**Host** (wie sie hier
ja auch schon für Touchscreen-Controller/Tastatur genutzt werden). Es gibt
technisch keinen Weg, darüber eine SSH-Verbindung o. Ä. aufzubauen – das
ist eine feste Hardware-Grenze dieses Pi-Modells, keine Software-
Einschränkung.

**Die tatsächliche Alternative für einen Konsolenzugang ganz ohne
Netzwerk** ist ein **USB-zu-TTL-Serial-Adapter** (günstiges Zubehörteil,
z. B. mit CP2102- oder CH340-Chip, wenige Euro) an den GPIO-Pins des Pi:

1. **Seriellen Login auf dem Pi aktivieren** (einmalig, am besten direkt
   bei der Ersteinrichtung in Schritt 1 miterledigen):

   ```bash
   sudo raspi-config
   ```

   → „Interface Options" → „Serial Port" → Frage nach einer Login-Shell
   über Serial mit **Ja** beantworten, Frage nach aktivierter Serial-
   Hardware ebenfalls mit **Ja**. Danach `sudo reboot`.

2. **Adapter verkabeln** – nur drei Kabel, an die Pi-GPIO-Leiste (Zählung
   wie auf der Platine aufgedruckt, nicht die GPIO-Nummer):

   | Adapter | Pi-Pin | Bedeutung |
   |---|---|---|
   | GND | Pin 6 | Masse |
   | RXD | Pin 8 (GPIO14, TXD) | Adapter empfängt, was der Pi sendet |
   | TXD | Pin 10 (GPIO15, RXD) | Adapter sendet, was der Pi empfängt |

   (Bewusst **über Kreuz** – TXD auf RXD und umgekehrt, wie bei einer
   seriellen Verbindung üblich. **Nicht** die 5V-/3.3V-Versorgungspins des
   Adapters anschließen, wenn der Pi ohnehin schon über sein eigenes
   Netzteil läuft – sonst speisen sich zwei Spannungsquellen gegenseitig.)

3. **Adapter am Laptop einstecken** – erscheint unter Windows als neuer
   COM-Port (Geräte-Manager → „Anschlüsse (COM & LPT)" zeigt die genaue
   Nummer, ggf. erst den passenden Treiber für den jeweiligen Chip
   installieren). Mit dem bereits für SSH genutzten PuTTY verbinden, aber
   mit Verbindungsart **„Serial"** statt „SSH": COM-Port eintragen,
   Baudrate **115200**. Nach Enter erscheint ein ganz normaler Login-Prompt
   des Pi, unabhängig von WLAN/Netzwerk.

**Für reinen Datei-Transfer** (kein Live-Debugging, sondern z. B. ein neues
`dist/` auf den Pi bringen) reicht dagegen weiterhin der deutlich
einfachere Weg über einen normalen **USB-Stick**, siehe Schritt 8 oben.

### 10. Performance-Tuning für den Pi 3 (spürbares Ruckeln, verzögerte Eingaben)

**Symptom:** Der Zug im Zugfoto-Spiel ruckelt sichtbar, Tastatureingaben auf
der Bildschirmtastatur erscheinen erst mit spürbarer Verzögerung, Buttons
reagieren mit kleinem Delay. Die App selbst ist bereits auf schwache
Hardware hin optimiert (30fps-Deckelung in `core/GameLoop.ts`,
Canvas-Auflösungsabschlag `RENDER_SCALE` in `core/Canvas.ts`,
Offscreen-Canvas-Caching in `games/train-photo`) – die vier Punkte hier
setzen stattdessen auf **System-Ebene** an einem frischen Pi 3 an, wo der
eigentliche Engpass lag (per SSH auf einem realen Gerät nachgemessen: RAM
lag bei 1 GB bereits unter Druck, 114 MB im zram-Swap, CPU taktete im
Leerlauf herunter). Alle vier Änderungen liegen **außerhalb** dieses Repos
direkt auf dem Pi und müssen bei jeder Neueinrichtung eines Pi 3 (Schritte
1–9 oben) erneut vorgenommen werden.

**a) CPU-Governor von `ondemand` auf `performance`.** Der Pi 3 taktet im
Leerlauf standardmäßig auf 600 MHz herunter und braucht bei jeder neuen
Touch-/Tastatur-Interaktion erst einen Moment, um wieder auf 1,2 GHz
hochzutakten – genau in diesem Hochtakt-Fenster liegt ein guter Teil der
gefühlten Eingabeverzögerung. Der Pi 3 läuft dabei thermisch weit im
grünen Bereich (typisch ~40 °C bei Zimmertemperatur), Dauerbetrieb auf
vollem Takt ist unproblematisch:

```bash
sudo tee /usr/local/sbin/set-cpu-performance.sh > /dev/null <<'EOF'
#!/bin/sh
for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  echo performance > "$f"
done
EOF
sudo chmod +x /usr/local/sbin/set-cpu-performance.sh

sudo tee /etc/systemd/system/cpu-performance.service > /dev/null <<'EOF'
[Unit]
Description=CPU-Governor auf performance setzen (Neiphos Ticket Machine, Pi 3)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/set-cpu-performance.sh

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now cpu-performance.service
```

**b) `--force-renderer-accessibility` aus der Chromium-Konfiguration
entfernen.** Raspberry Pi OS setzt dieses Flag standardmäßig über
`/etc/chromium.d/00-rpi-vars` (nicht über `start-kiosk.sh` oben – das Flag
taucht dort nie auf, es wird von Chromium selbst beim Start aus allen
Dateien in `/etc/chromium.d/` eingelesen). Es zwingt den Renderer, bei
**jeder** DOM-Änderung den kompletten Accessibility-Baum neu zu berechnen –
und genau das passiert bei jedem Tastendruck auf der Bildschirmtastatur
(`core/OnScreenKeyboard.ts` schreibt bei jedem Tastendruck ins DOM). Ohne
Screenreader/assistive Technologie im Einsatz bringt das Flag nichts,
kostet auf dem Pi 3 aber spürbar Leistung:

```bash
sudo sed -i 's/ --force-renderer-accessibility//' /etc/chromium.d/00-rpi-vars
```

> ⚠️ **Falle beim manuellen Bearbeiten:** Chromiums Start-Wrapper liest
> **alle** Dateien in `/etc/chromium.d/` außer `README` ein (auch `.bak`-
> o. Ä. Kopien!). Ein Backup der Original-Datei gehört deshalb NICHT in
> dasselbe Verzeichnis, sonst wird das entfernte Flag darüber wieder
> hereingezogen – Backup z. B. nach `/root/` legen, falls gewünscht.
> Dieses Flag kann außerdem bei einem Chromium-Paket-Update erneut
> auftauchen (falls `apt upgrade` die Datei überschreibt) – im Zweifel
> nach einem Update `cat /etc/chromium.d/00-rpi-vars` prüfen.

**c) Taskleiste und Desktopsymbole aus dem Autostart entfernen.** Unterhalb
des Kiosk-Chromiums läuft auf einem frischen Pi 3 standardmäßig die
komplette Desktop-Oberfläche mit (`wf-panel-pi` = Taskleiste, `pcmanfm-pi`
= Desktopsymbole) – für einen Kiosk, der nie eine Taskleiste oder
Desktopsymbole zeigt, reine RAM-/CPU-Verschwendung auf einem 1-GB-Gerät.
Die Zeilen stehen in der System-Autostart-Datei
`/etc/xdg/labwc/autostart`:

```bash
sudo sed -i '/pcmanfm-pi\|wf-panel-pi/d' /etc/xdg/labwc/autostart
```

> ⚠️ **Nicht** stattdessen eine eigene `~/.config/labwc/autostart` anlegen,
> um die System-Datei zu "überschreiben" – der Session-Wrapper
> `/usr/bin/labwc-pi` startet labwc mit dem Flag `-m`
> („merge-config"), wodurch System- **und** Benutzer-Autostart-Datei
> **zusammengeführt** (nicht: Benutzerdatei ersetzt System-Datei) werden.
> Eine zusätzliche Datei unter `~/.config/labwc/` würde `pcmanfm-pi`/
> `wf-panel-pi` also weiterhin aus der System-Datei starten. Die Zeile
> `/usr/bin/lxsession-xdg-autostart` in derselben Datei **muss** erhalten
> bleiben – darüber wird u. a. der eigene
> `~/.config/autostart/ticketmachine-kiosk.desktop`-Eintrag (siehe Schritt
> 5) überhaupt erst gestartet.

**d) Optional: nicht benötigte Systemdienste deaktivieren** (Drucken,
Bluetooth – auf einem reinen Touch-Kiosk ohne angeschlossenen Drucker/
Bluetooth-Zubehör ungenutzt, sparen etwas RAM):

```bash
sudo systemctl disable --now cups.service cups.path cups.socket bluetooth.service
```

**Danach neu starten**, damit Autostart- und Chromium-Änderungen greifen:

```bash
sudo reboot
```

Zur Kontrolle nach dem Neustart (`ps aux | grep -E 'wf-panel-pi|pcmanfm'`
sollte leer sein, `cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor`
sollte `performance` zeigen, `free -h` sollte spürbar mehr „verfügbar" und
0 B Swap-Nutzung zeigen als vor den Änderungen).

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

- **Touchscreen-Test** – Vollbild-Raster aus antippbaren Feldern (ungefähr
  Button-große Kacheln), zum Aufspüren von Touch-Todzonen auf dem
  Kiosk-Bildschirm. Getestete Felder werden grün, bleiben aber weiter
  antippbar (kurze Puls-Animation statt erneutem Farbwechsel). "Test beenden"
  führt zurück in den Admin-Bereich.
- **Lautstärke** – steuert die echte Betriebssystem-Lautstärke (über
  PipeWire/`wpctl`), nicht nur eine App-interne Lautstärke – dafür muss der
  Kiosk-Modus nicht verlassen werden. Nur auf einem echten Pi mit laufendem
  `server/serve.js` verfügbar.
- **Audioausgabe** – Liste der auf dem Gerät vorhandenen PipeWire-Sinks (z. B.
  Klinke und HDMI), antippen wechselt den Standard-Ausgang (`wpctl
  set-default`). Nützlich, wenn z. B. der Ton über HDMI statt über die Klinke
  laufen soll. Wird beim Öffnen des Admin-Bereichs automatisch abgerufen;
  zusätzlich gibt es einen eigenen "Aktualisieren"-Button daneben – nützlich,
  falls ein HDMI-Bildschirm erst NACH dem Hochfahren des Pi angeschlossen
  wurde und der zugehörige Audioausgang deshalb zunächst nicht in der Liste
  auftaucht.
- **WLAN** – Verbindungsstatus, Netzwerksuche und Verbinden/Trennen direkt im
  Admin-Bereich (siehe [WLAN-Verwaltung freischalten](#3b-wlan-verwaltung-im-admin-bereich-freischalten-polkit)
  für die einmalige Voraussetzung auf dem Pi). Netzwerke, für die `nmcli`
  bereits ein gespeichertes Verbindungsprofil hat (z. B. weil man sich schon
  einmal erfolgreich verbunden hatte, auch nach zwischenzeitlichem
  „Trennen“), sind in der Liste mit „(bekannt)“ markiert und verbinden per
  Antippen sofort ohne erneute Passworteingabe – die Zugangsdaten bleiben in
  NetworkManager gespeichert, „Trennen“ löscht nur die aktive Verbindung,
  nicht das Profil. Klappt das ausnahmsweise nicht mehr (z. B. Passwort beim
  Access Point geändert), fragt der Dialog automatisch als Fallback nach dem
  Passwort.
- **Kiosk-Modus starten/beenden** – schaltet nur den Browser-Vollbildmodus
  (Fullscreen API) dieser Webseite um. Das ist *nicht* dasselbe wie Chromium
  komplett im `--kiosk`-Modus zu beenden – eine Webseite kann aus
  Sicherheitsgründen grundsätzlich nicht zuverlässig erkennen, ob sie gerade
  in einem `--kiosk`-Browser läuft, daher zeigt dieser Button unabhängig
  davon immer nur den Fullscreen-API-Status.
- **Kiosk-Browser jetzt beenden (Notausgang)** – eigener, davon getrennter
  Button: beendet den `--kiosk`-Chromium-Prozess auf dem Gerät wirklich
  (`POST /api/kiosk/exit`, admin-geschützt, `pkill -f
  "ticketmachine-chromium"` über den lokal laufenden Server) und legt damit
  den darunterliegenden Desktop frei – gedacht für den Notfall, dass ohne
  funktionierendes WLAN weder SSH noch ein anderer Fernzugriff möglich ist,
  der Desktop aber z. B. für eine WLAN-Neueinrichtung erreichbar sein muss.
  Braucht dafür zwingend einen laufenden `server/serve.js`-Prozess (siehe
  [Deployment auf dem Raspberry Pi](#deployment-auf-dem-raspberry-pi-kiosk)).
  Der darunterliegende labwc-Compositor startet normalerweise ohne jede
  Bedienoberflaeche (kein Panel, keine Taskleiste, kein Hintergrund) – das
  System bootet direkt in den Kiosk-Browser, ohne je eine vollstaendige
  Desktop-Sitzung aufzubauen. Deshalb startet der Notausgang zusaetzlich den
  ECHTEN, auf diesem Geraet bereits vorinstallierten Raspberry-Pi-Desktop:
  `wf-panel-pi` (offizielle Taskleiste fuer Wayland-Compositors wie labwc –
  Startmenü, Netzwerk-Applet, Lautstärke, Uhr) und `pcmanfm --desktop`
  (Hintergrundbild, Desktop-Icons, Rechtsklick-Menü mit "Terminal hier
  öffnen" etc.), siehe `openRecoveryDesktop()` in `server/serve.js`. Zudem
  startet `server/serve.js` automatisch nach 3 Minuten den Kiosk-Chromium
  neu, falls bis dahin kein neuer Kiosk-Prozess laeuft. Waehrend der
  Wartezeit oeffnet sich zusaetzlich ein kleines, normales Fenster
  (`server/kiosk-timer.html`, per `file://` geladen – bewusst NICHT im
  Vollbild, sonst wuerde es den echten Desktop darunter komplett verdecken)
  mit Countdown, "+5 Min." (verlaengert die Frist um 5 Minuten, `POST
  /api/kiosk/exit-extend`) und "Zurück in den Kiosk" (startet sofort neu,
  `POST /api/kiosk/exit-return`, Status via `GET /api/kiosk/exit-status`),
  plus zwei Schnellzugriff-Buttons "Terminal öffnen" und "Dateimanager
  öffnen" (`POST /api/kiosk/launch-terminal` bzw. `/launch-filemanager`,
  starten `lxterminal`/`pcmanfm`) fuer den direkten Zugriff ohne Maus (z. B.
  `nmtui` fuer eine WLAN-Neueinrichtung). Eine feste Fensterposition (z. B.
  oben rechts) laesst sich unter Wayland/labwc technisch nicht erzwingen –
  ein Client darf anders als frueher unter X11 seine eigene
  Bildschirmposition nicht mehr selbst bestimmen –, dank des echten
  Desktops darunter (Taskleiste/Fensterliste ueber wf-panel-pi) laesst sich
  das Fenster bei Bedarf aber ganz normal verschieben. Die Status-/
  Verlaengern-/Zurueck-Endpunkte sind bewusst NICHT admin-geschützt, da
  diese Seite keine eigene Admin-Sitzung hat und diese drei ohnehin nur
  einen bereits laufenden Timer beeinflussen koennen; die beiden Programm-
  Starter-Endpunkte sind dagegen ueber ein einmaliges, nur serverseitig
  erzeugtes Token geschützt (als `?token=…` in der Fenster-URL mitgegeben,
  siehe `requireKioskExitToken` in `server/serve.js`) – ohne das koennte
  sonst jedes andere Geraet im gleichen WLAN ohne jede Anmeldung beliebige
  Programme auf dem Pi starten. Beim Rueckkehren in den Kiosk (automatisch
  oder per Button) werden Desktop, Timer-Fenster und ein evtl. geoeffnetes
  Terminal/Dateimanager wieder vollstaendig geschlossen.
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

Feedback **absenden** (`POST /api/feedback`) bleibt bewusst ohne
Authentifizierung – das soll jede:r Besucher:in tun können. Feedback
**lesen** (`GET /api/feedback`) und **als gelesen markieren** verlangen
serverseitig dasselbe Admin-Passwort wie unten bei der [geräteübergreifenden
Synchronisation](#geräteübergreifende-synchronisation-optional) beschrieben
(`X-Admin-Password`-Header) – ohne gültige Admin-Sitzung im Browser (also
außerhalb des Admin-Bereichs) bleiben diese beiden Endpunkte gesperrt.

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
