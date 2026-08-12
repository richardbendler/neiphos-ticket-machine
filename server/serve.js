#!/usr/bin/env node
/**
 * Winziger, abhaengigkeitsfreier lokaler Webserver: liefert das gebaute
 * dist/-Verzeichnis statisch aus UND stellt kleine APIs bereit fuer Feedback
 * sowie (optional, siehe unten) geraeteuebergreifende Synchronisation von
 * Highscores/Statistik/Einstellungen. Alles landet als einzelne
 * JSON-Dateien in Ordnern NEBEN dist/ (nicht darin -- "vite build" leert
 * dist/ bei jedem Lauf, das darf diese Daten nicht mitreissen).
 *
 * Nutzung:
 *   node server/serve.js [Wurzelverzeichnis] [Port]
 *   node server/serve.js dist 8080
 *
 * Kein npm-Paket noetig (kein Express o. ae.) -- nur eingebaute Node-Module,
 * damit auf dem Kiosk-Geraet nichts weiter installiert werden muss ausser
 * Node selbst.
 *
 * ---------------------------------------------------------------------
 * Geraeteuebergreifende Synchronisation (Highscores/Statistik/Einstellungen)
 * ---------------------------------------------------------------------
 * Bewusst per Schalter NTM_SYNC=1 deaktiviert, solange er nicht gesetzt ist
 * -- am bequemsten als eigene Zeile in .env.local (siehe unten, bleibt bei
 * jedem Deployment/git-Pull unangetastet, da .env.local per .gitignore nie
 * eingecheckt wird); alternativ weiterhin auch als echte Umgebungsvariable
 * moeglich. Der urspruengliche, weiterhin unterstuetzte Einsatzzweck
 * dieses Projekts ist ein einzelnes, komplett offline laufendes Kiosk-
 * Geraet (siehe README, Abschnitt "Deployment auf dem Raspberry Pi"), bei
 * dem lokale Speicherung (localStorage) alles ist, was gebraucht wird. Die
 * Synchronisation ist ein rein optionaler Zusatz fuer den Fall, dass diese
 * App stattdessen auf einem echten, oeffentlich erreichbaren Webserver
 * laeuft und mehrere Besucher-Endgeraete denselben Stand teilen sollen
 * (siehe README, Abschnitt "Geraeteuebergreifende Synchronisation"). Ohne
 * NTM_SYNC=1 antworten die entsprechenden Endpunkte mit 404, als gaebe es
 * sie nicht -- das Verhalten fuer den Offline-Kiosk bleibt dadurch exakt
 * so, wie es vor dieser Funktion war.
 *
 * Fuer die admin-geschuetzten Schreibzugriffe (Einstellungen aendern,
 * Highscores/Statistik zuruecksetzen) sowie zum Lesen von Feedback/
 * Statistik wird dasselbe Passwort verwendet, das der Client-Build schon
 * aus .env.local liest (VITE_ADMIN_PASSWORD) -- so gibt es nur ein
 * Passwort zu verwalten. Ohne (lesbare) .env.local bzw. ohne gesetztes
 * Passwort bleiben diese Endpunkte einfach gesperrt (503).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));
const PORT = Number(process.argv[3] || process.env.PORT || 8080);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FEEDBACK_DIR = process.env.FEEDBACK_DIR ? path.resolve(process.env.FEEDBACK_DIR) : path.resolve(ROOT, "..", "feedback");
const HIGHSCORES_DIR = path.resolve(ROOT, "..", "highscores");
const STATS_DIR = path.resolve(ROOT, "..", "stats");
const SETTINGS_FILE = path.resolve(ROOT, "..", "settings.json");
// Zeichen-Geraet des angeschlossenen USB-Bondruckers (siehe Endpunkte unten
// bei "System: Drucker") -- ueber process.env ueberschreibbar, falls das
// Geraet auf einem anderen Pi/Setup unter einem anderen Pfad auftaucht.
const PRINTER_DEVICE = process.env.PRINTER_DEVICE || "/dev/usb/lp0";

/**
 * Serialisiert JEDEN Zugriff auf PRINTER_DEVICE (sowohl die Statusabfrage
 * als auch den eigentlichen Rasterdruck, siehe printRasterJob) ueber eine
 * einzige Promise-Kette -- gemeldeter Vorfall: ein Testdruck ueberschnitt
 * sich zeitlich offenbar mit einer der periodischen Papierstand-Abfragen
 * (siehe /api/system/printer/paper, wird u. a. alle 60s vom Footer eines
 * jeden geoeffneten Browser-Tabs abgefragt, core/Router.ts) -- zwei
 * UNABHAENGIGE Dateihandles auf dasselbe rohe USB-Druckergeraet garantieren
 * keinerlei Reihenfolge zueinander, die 3 Statusabfrage-Bytes koennen
 * dadurch MITTEN in den Bildbyte-Strom eines laufenden Rasterdrucks
 * hineingeraten. Der Drucker verliert dadurch seine Byte-Zaehlung im
 * Rastermodus und interpretiert danach beliebige Folgebytes als Text/
 * Befehle -- druckt dann endlos wirr wirkende Zeichen, bis er manuell vom
 * Strom getrennt wird (genau der gemeldete Vorfall). Ohne diese
 * Serialisierung kann das erneut passieren, sobald zwei Anfragen zeitlich
 * kollidieren, auch wenn die Chance im Normalbetrieb gering ist.
 */
let printerDeviceQueue = Promise.resolve();
function withPrinterDevice(fn) {
  const result = printerDeviceQueue.then(() => fn());
  // Immer weiterlaufen, auch wenn fn() ablehnt -- sonst blockiert ein
  // einzelner Fehler (z. B. "Drucker nicht angeschlossen") die Warteschlange
  // fuer alle folgenden Aufrufe dauerhaft.
  printerDeviceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Fragt den Drucker per ESC/POS-Echtzeit-Statusabfrage (DLE EOT 4 =
 * Papiersensor-Status) nach seinem Papierstand -- am echten Geraet
 * verifiziert, DASS es antwortet (1 Byte zurueck), die genaue Bit-Bedeutung
 * (Bit 2 = "fast leer", Bit 6 = "leer") folgt der verbreiteten Epson-
 * aehnlichen ESC/POS-Konvention, ist fuer dieses konkrete (generische,
 * STM32-basierte) Druckermodell aber NICHT mit einer echten leeren Rolle
 * gegengetestet -- bewusst als best-effort behandelt (siehe available/
 * paper: "unknown" als Fallback ueberall dort, wo dieser Aufruf fehlschlaegt
 * oder kein Byte zurueckkommt), lieber "unbekannt" anzeigen als etwas
 * falsch Sicheres.
 */
/**
 * Unverpackte Kernlogik OHNE withPrinterDevice -- fuer sich alleine per
 * queryPrinterPaperStatus() aufrufen (verpackt die Warteschlange EINMAL).
 * printRasterJob nutzt dagegen DIESE rohe Variante direkt innerhalb seines
 * eigenen, groesseren withPrinterDevice-Blocks (siehe dort) -- ein
 * verschachtelter withPrinterDevice-Aufruf wuerde sonst auf sich selbst
 * warten (Deadlock).
 *
 * BEWUSST mit den ASYNCHRONEN fs.open/write/read (nicht *Sync) --
 * gemeldeter Vorfall: die vorherige *Sync-Fassung blockierte bei einem
 * nicht (mehr) antwortenden Drucker den KOMPLETTEN Node-Hauptthread
 * (fs.readSync ist eine blockierende Systemcall, waehrenddessen kann auch
 * der eigentlich als Sicherheitsnetz gedachte setTimeout unten nie feuern
 * -- Timer laufen nur zwischen Event-Loop-Ticks, ein blockierender Syscall
 * verhindert genau das). Das legte den GESAMTEN Server lahm, nicht nur die
 * Statusabfrage -- server war per systemd zwar "aktiv", antwortete aber auf
 * gar keine Anfrage mehr, auch nicht auf die Startseite. Mit den
 * asynchronen Varianten (laufen im libuv-Threadpool, nicht im Hauptthread)
 * bleibt der Server responsiv, selbst wenn eine einzelne Anfrage haengt --
 * der Timeout unten greift dann zuverlaessig.
 */
function queryPrinterPaperStatusRaw() {
  return new Promise((resolve) => {
    fs.open(PRINTER_DEVICE, "r+", (openErr, fd) => {
      if (openErr) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fs.close(fd, () => {
          /* Geraet ggf. schon zu -- egal, wir wollten nur aufraeumen */
        });
        resolve(result);
      };
      const timer = setTimeout(() => finish(null), 1500);
      fs.write(fd, Buffer.from([0x10, 0x04, 0x04]), (writeErr) => {
        if (writeErr) {
          finish(null);
          return;
        }
        const buf = Buffer.alloc(1);
        fs.read(fd, buf, 0, 1, null, (readErr, bytesRead) => {
          if (readErr || bytesRead < 1) {
            finish(null);
            return;
          }
          const byte = buf[0];
          finish({ empty: (byte & 0x40) !== 0, low: (byte & 0x04) !== 0 });
        });
      });
    });
  });
}

function queryPrinterPaperStatus() {
  return withPrinterDevice(queryPrinterPaperStatusRaw);
}

// ------------------------------------------------------------- .env.local
//
// Liest dieselbe .env.local wie Vite (KEY=value pro Zeile, # fuer
// Kommentare) -- absichtlich ein simpler Parser statt eines dotenv-Pakets,
// damit dieser Server weiterhin ganz ohne npm-Abhaengigkeiten auskommt. Liegt
// im Projekt-Wurzelverzeichnis NEBEN dist/ (nicht darin), ist per
// .gitignore ausgeschlossen und wird deshalb von einem erneuten "git pull"
// oder einem "scp -r dist/* ..."-Deployment (das ohnehin nur dist/
// ueberschreibt) nie angetastet -- ideal fuer Einstellungen, die auf dem
// Server dauerhaft gesetzt bleiben sollen, siehe NTM_SYNC unten.

function loadEnvFile(filePath) {
  const result = {};
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return result;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const envFile = loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));
const ADMIN_PASSWORD = process.env.VITE_ADMIN_PASSWORD || envFile.VITE_ADMIN_PASSWORD || "";

// Bevorzugt aus .env.local (siehe oben) -- die Umgebungsvariable NTM_SYNC
// bleibt zusaetzlich unterstuetzt (z. B. fuer einen systemd-Service, der sie
// ohnehin schon setzt), .env.local ist aber der bequemere/dauerhaftere Weg.
function isTruthyFlag(value) {
  return value === "1" || value === "true";
}
const SYNC_ENABLED = isTruthyFlag(process.env.NTM_SYNC) || isTruthyFlag(envFile.NTM_SYNC);

fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
if (SYNC_ENABLED) {
  fs.mkdirSync(HIGHSCORES_DIR, { recursive: true });
  fs.mkdirSync(STATS_DIR, { recursive: true });
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf-8");
  const bufB = Buffer.from(String(b), "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** true = Anfrage traegt das korrekte Admin-Passwort. false auch, wenn serverseitig gar keins konfiguriert ist (sicherer Default). */
function isAdminRequest(req) {
  if (!ADMIN_PASSWORD) return false;
  const provided = req.headers["x-admin-password"];
  if (typeof provided !== "string" || !provided) return false;
  return timingSafeEqual(provided, ADMIN_PASSWORD);
}

function requireAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    sendJson(res, 503, { error: "admin_not_configured" });
    return false;
  }
  if (!isAdminRequest(req)) {
    sendJson(res, 403, { error: "forbidden" });
    return false;
  }
  return true;
}

// --------------------------------------------------------------- Rate-Limit
//
// Simples Sliding-Window pro IP+Endpunkt, rein im Speicher (kein Redis o.
// ae. noetig -- bei einem Neustart des Prozesses faengt es einfach wieder
// bei null an, das ist fuer diesen Zweck voellig ausreichend). Schuetzt die
// oeffentlich (ohne Login) beschreibbaren Endpunkte grob vor Spam-Skripten.

const rateLimitBuckets = new Map();

function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(key) || []).filter((t) => now - t < windowMs);
  timestamps.push(now);
  rateLimitBuckets.set(key, timestamps);
  return timestamps.length > maxRequests;
}

function clientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

// --------------------------------------------------------------------- MIME

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limitBytes = 20_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        req.destroy();
        reject(new Error("Payload zu gross"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Wie readBody, aber liefert den rohen Buffer statt eines UTF-8-Strings -- fuer binaere Uploads (siehe Rasterdruck-Endpunkt unten), bei denen toString("utf-8") die Bytes zerstoeren wuerde. */
function readBodyBuffer(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        req.destroy();
        reject(new Error("Payload zu gross"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isSafeId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ----------------------------------------------------------------- Feedback

function readFeedbackEntries() {
  const files = fs.readdirSync(FEEDBACK_DIR).filter((f) => f.endsWith(".json"));
  const entries = [];
  for (const file of files) {
    try {
      entries.push(JSON.parse(fs.readFileSync(path.join(FEEDBACK_DIR, file), "utf-8")));
    } catch {
      // Beschaedigte/unvollstaendig geschriebene Datei -- einfach ueberspringen.
    }
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

// --------------------------------------------------------------- Highscores
//
// Ein Board = eine Datei (Dateiname aus gameId+board abgeleitet), Inhalt
// exakt das Format, das der Client auch lokal in localStorage haelt ({
// value, entries: [{name, value, achievedAt}] }) -- so kann der Client die
// Server-Antwort 1:1 in seine eigene Merge-Logik einspeisen (siehe
// core/storage.ts, mergeHighscoreEntry).
//
// Wichtig fuer Nebenlaeufigkeit: Lesen+Schreiben passiert hier bewusst rein
// SYNCHRON (readFileSync/writeFileSync, kein await dazwischen) -- Node ist
// single-threaded und wechselt nur bei einem "await"/Callback zu einer
// anderen Anfrage, ein rein synchroner Block ist dadurch automatisch atomar,
// ganz ohne expliziten Locking-Mechanismus.

function highscoreFilePath(gameId, board) {
  return path.join(HIGHSCORES_DIR, `${gameId}__${board}.json`);
}

function readHighscoreBoard(gameId, board) {
  try {
    return JSON.parse(fs.readFileSync(highscoreFilePath(gameId, board), "utf-8"));
  } catch {
    return null;
  }
}

function isBetterScore(value, current, direction) {
  return direction === "higher-better" ? value > current : value < current;
}

/** Spiegelt die Merge-Logik aus core/storage.ts (recordHighscore/mergeHighscoreEntry) -- bei Aenderung dort auch hier nachziehen. */
function mergeHighscoreEntry(existing, entry, direction) {
  if (!existing) return { value: entry.value, entries: [entry] };
  if (entry.value === existing.value) {
    const isDuplicate = existing.entries.some((e) => e.name === entry.name && e.value === entry.value && e.achievedAt === entry.achievedAt);
    return isDuplicate ? existing : { value: existing.value, entries: [...existing.entries, entry] };
  }
  if (isBetterScore(entry.value, existing.value, direction)) return { value: entry.value, entries: [entry] };
  return existing;
}

function readAllHighscores() {
  const files = fs.readdirSync(HIGHSCORES_DIR).filter((f) => f.endsWith(".json"));
  const result = {};
  for (const file of files) {
    try {
      const board = JSON.parse(fs.readFileSync(path.join(HIGHSCORES_DIR, file), "utf-8"));
      const key = file.slice(0, -".json".length);
      result[key] = board;
    } catch {
      // Beschaedigte Datei -- ueberspringen.
    }
  }
  return result;
}

// -------------------------------------------------------------- Statistik
//
// Genau wie Feedback: eine Datei pro Session (Ergaenzung, kein
// Read-Modify-Write auf einer gemeinsamen Datei) -- vermeidet jede Art von
// Schreibkonflikt bei gleichzeitigen Einsendungen unterschiedlicher
// Besucher-Endgeraete.

function readAllStatsSessions() {
  const files = fs.readdirSync(STATS_DIR).filter((f) => f.endsWith(".json"));
  const sessions = [];
  for (const file of files) {
    try {
      sessions.push(JSON.parse(fs.readFileSync(path.join(STATS_DIR, file), "utf-8")));
    } catch {
      // Beschaedigte Datei -- ueberspringen.
    }
  }
  return sessions;
}

// -------------------------------------------------------------- Einstellungen

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return { disabledGameIds: [] };
  }
}

// ------------------------------------------------------------ Statische Dateien

function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);

  // Path-Traversal-Schutz: darf ROOT nicht verlassen.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // Kein Client-Routing in dieser App noetig -- unbekannter Pfad ohne
    // Dateiendung faellt dennoch auf index.html zurueck (robuster bei z. B.
    // trailing slashes), alles andere ist ein echtes 404.
    if (path.extname(relative)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    fs.readFile(path.join(ROOT, "index.html"), (err2, data) => {
      if (err2) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(data);
    });
  });
}

// ------------------------------------------- Kiosk-Notausgang: Selbstheilung
//
// Siehe /api/kiosk/exit weiter unten: nach dem "Notausgang" (Kiosk-Chromium
// beenden, um z. B. an die WLAN-Einstellungen zu kommen) startet der Kiosk
// sich nach dieser Schonfrist automatisch selbst neu, falls er nicht laengst
// von Hand wieder laeuft -- verhindert einen dauerhaften Blackscreen ohne
// jede Bedienmoeglichkeit (gemeldeter Vorfall: ohne Fernzugriff kam man vom
// leeren Compositor aus praktisch nie mehr zurueck in den Kiosk). Dazu ein
// kleines, dauerhaft sichtbares Timer-Fenster oben rechts (server/
// kiosk-timer.html, eigenes schlankes User-Data-Dir statt des Kiosk-Profils,
// damit es sich unabhaengig oeffnen/schliessen laesst) mit Anzeige der
// Restzeit sowie Buttons zum Verlaengern und zum sofortigen manuellen
// Zurueckspringen.
const KIOSK_RELAUNCH_DELAY_MS = 3 * 60 * 1000; // 3 Minuten
const KIOSK_EXTEND_MS = 5 * 60 * 1000; // 5 Minuten pro "Verlaengern"-Klick
const KIOSK_USER_DATA_DIR = "/home/flipper/.config/ticketmachine-chromium";
const KIOSK_TIMER_USER_DATA_DIR = "/home/flipper/.config/ticketmachine-timer";
const KIOSK_TIMER_HTML_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "kiosk-timer.html");
let kioskRelaunchTimer = null;
let kioskRelaunchAt = null;
// Nur waehrend eine Notausgang-Pause aktiv ist gesetzt (siehe
// openKioskTimerWindow) -- schuetzt launch-terminal/launch-filemanager
// weiter unten davor, dass irgendein anderes Geraet im selben WLAN sie ohne
// Admin-Anmeldung aufrufen koennte. Die kiosk-timer.html-Seite selbst hat
// keine eigene Admin-Sitzung (siehe requireAdmin), bekommt das Token aber
// als URL-Parameter mit, wenn der -- bereits admin-geschuetzte --
// /api/kiosk/exit-Aufruf dieses Fenster oeffnet.
let kioskExitToken = null;

function requireKioskExitToken(req, res) {
  const provided = req.headers["x-kiosk-exit-token"];
  if (!kioskExitToken || typeof provided !== "string" || !provided || !timingSafeEqual(provided, kioskExitToken)) {
    sendJson(res, 403, { error: "forbidden" });
    return false;
  }
  return true;
}

function kioskEnv() {
  return {
    ...process.env,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-0",
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/run/user/1000",
    XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE || "wayland",
  };
}

function closeKioskTimerWindow() {
  execFile("pkill", ["-f", "ticketmachine-timer"], () => {
    // Fehler (z. B. "kein passender Prozess") ist hier irrelevant -- Ziel
    // ist nur "falls offen, schliessen".
  });
}

function closeRecoveryDesktop() {
  execFile("pkill", ["-f", "wf-panel-pi"], () => {});
  execFile("pkill", ["-f", "pcmanfm"], () => {});
}

function relaunchKioskChromium() {
  kioskRelaunchTimer = null;
  kioskRelaunchAt = null;
  kioskExitToken = null;
  closeKioskTimerWindow();
  // Den waehrend der Pause gestarteten echten Desktop (siehe
  // openRecoveryDesktop) sowie ein darueber evtl. geoeffnetes Terminal
  // wieder schliessen -- sonst bliebe das alles unsichtbar im Hintergrund
  // bestehen und waere z. B. per Alt+Tab an einer angeschlossenen USB-
  // Tastatur erreichbar. Fehler (kein passender Prozess) sind hier
  // irrelevant, siehe closeKioskTimerWindow().
  closeRecoveryDesktop();
  execFile("pkill", ["-f", "lxterminal"], () => {});
  execFile("pgrep", ["-f", "ticketmachine-chromium"], (error, stdout) => {
    // Laeuft schon wieder (z. B. inzwischen manuell per SSH neu gestartet)
    // -- nicht doppelt starten.
    if (stdout && stdout.trim()) return;
    // Chromiums eigene Instanz-Sperre (SingletonLock/-Socket/-Cookie im
    // --user-data-dir) ueberlebt ein hartes Beenden (pkill) manchmal, obwohl
    // der Prozess laut obigem pgrep laengst weg ist -- ein neuer Chromium
    // startet dann still gar kein Fenster, weil er glaubt, es liefe schon
    // eine Instanz (gemeldeter Bug: "Zurueck in den Kiosk" tat sichtbar
    // nichts). Da pgrep hier bereits bestaetigt hat, dass nichts mehr
    // laeuft, koennen diese Dateien gefahrlos entfernt werden.
    for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      fs.rmSync(path.join(KIOSK_USER_DATA_DIR, name), { force: true });
    }
    const child = spawn(
      "chromium",
      [
        "--kiosk",
        `--user-data-dir=${KIOSK_USER_DATA_DIR}`,
        "--noerrdialogs",
        "--disable-infobars",
        "--disable-session-crashed-bubble",
        "--disable-pinch",
        "--overscroll-history-navigation=0",
        "--check-for-update-interval=31536000",
        "--autoplay-policy=no-user-gesture-required",
        "--password-store=basic",
        "--ozone-platform=wayland",
        "http://localhost:8080",
      ],
      { env: kioskEnv(), detached: true, stdio: "ignore" },
    );
    child.unref();
  });
}

/**
 * Kleines, schwebendes Fenster mit Countdown/Verlaengern/Zurueck-Button PLUS
 * Terminal-/Dateimanager-Buttons -- eigenes Profil, damit
 * closeKioskTimerWindow() es gezielt (und nur es) beenden kann.
 *
 * Bewusst KEIN --kiosk (Vollbild) mehr: das wuerde den in
 * openRecoveryDesktop() gestarteten echten Desktop darunter vollstaendig
 * verdecken (gemeldeter Bug -- "ich lande immer noch nicht auf dem
 * Desktop", obwohl wf-panel-pi/pcmanfm im Hintergrund liefen). Die
 * urspruenglich per --window-position=oben-rechts geplante feste Position
 * funktioniert unter Wayland/labwc ohnehin nicht (ein Client darf seine
 * eigene Bildschirmposition anders als frueher unter X11 nicht selbst
 * bestimmen) -- labwc platziert das Fenster stattdessen selbst (meist
 * zentriert), was jetzt in Ordnung ist: dank des echten Desktops
 * (Taskleiste/Fensterliste über wf-panel-pi) kann man es bei Bedarf wie
 * jedes andere Fenster selbst verschieben.
 */
function openKioskTimerWindow() {
  execFile("pgrep", ["-f", "ticketmachine-timer"], (error, stdout) => {
    if (stdout && stdout.trim()) return; // schon offen
    // Gleicher Grund wie in relaunchKioskChromium(): eine ueberlebende
    // Instanz-Sperre aus einem vorherigen harten Beenden wuerde dieses
    // Fenster sonst still verhindern.
    for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      fs.rmSync(path.join(KIOSK_TIMER_USER_DATA_DIR, name), { force: true });
    }
    if (!kioskExitToken) kioskExitToken = crypto.randomBytes(16).toString("hex");
    const child = spawn(
      "chromium",
      [
        `--app=file://${KIOSK_TIMER_HTML_PATH}?token=${kioskExitToken}`,
        `--user-data-dir=${KIOSK_TIMER_USER_DATA_DIR}`,
        "--window-size=380,260",
        "--noerrdialogs",
        "--disable-infobars",
        "--ozone-platform=wayland",
      ],
      { env: kioskEnv(), detached: true, stdio: "ignore" },
    );
    child.unref();
  });
}

/**
 * Der eigentliche, ECHTE Desktop fuer die Dauer der Notausgang-Pause:
 * wf-panel-pi (offizielle Raspberry-Pi-Taskleiste fuer Wayland-Compositors
 * wie labwc -- Startmenue, Netzwerk-Applet, Lautstaerke, Uhr) plus
 * pcmanfm im Desktop-Modus (Hintergrundbild, Desktop-Icons, Rechtsklick-
 * Menue mit "Terminal hier oeffnen" etc.). Beide sind auf diesem Geraet
 * bereits vorinstalliert (Teil des normalen Raspberry Pi OS), liefen aber
 * bisher nie, weil das System direkt in den Kiosk-Browser startet, ohne
 * je eine vollstaendige Desktop-Sitzung aufzubauen. Ohne das blieb der
 * Notausgang trotz beendetem Kiosk-Browser praktisch unbedienbar
 * (gemeldeter Bug: "ich lande immer noch nicht auf dem Desktop").
 */
function openRecoveryDesktop() {
  execFile("pgrep", ["-f", "wf-panel-pi"], (error, stdout) => {
    if (stdout && stdout.trim()) return; // schon offen
    const panel = spawn("wf-panel-pi", [], { env: kioskEnv(), detached: true, stdio: "ignore" });
    panel.unref();
  });
  execFile("pgrep", ["-f", "pcmanfm --desktop"], (error, stdout) => {
    if (stdout && stdout.trim()) return; // schon offen
    const desktop = spawn("pcmanfm", ["--desktop"], { env: kioskEnv(), detached: true, stdio: "ignore" });
    desktop.unref();
  });
}

function scheduleKioskRelaunch(delayMs) {
  if (kioskRelaunchTimer) clearTimeout(kioskRelaunchTimer);
  kioskRelaunchAt = Date.now() + delayMs;
  kioskRelaunchTimer = setTimeout(relaunchKioskChromium, delayMs);
  openRecoveryDesktop();
  openKioskTimerWindow();
}

/**
 * SSIDs, fuer die NetworkManager bereits ein gespeichertes Verbindungsprofil
 * hat (inkl. Zugangsdaten) -- "nmcli device wifi connect <ssid>" OHNE
 * Passwort aktiviert fuer diese automatisch das vorhandene Profil samt
 * gespeichertem psk, ein erneutes Abfragen ist also unnoetig. nmcli benennt
 * per "device wifi connect" angelegte Profile standardmaessig genau wie die
 * SSID, daher reicht hier ein Namensabgleich statt eines Abgleichs ueber die
 * tatsaechliche 802-11-wireless.ssid-Eigenschaft jedes Profils.
 */
function getKnownWifiSsids(callback) {
  execFile("nmcli", ["-t", "-f", "NAME,TYPE", "connection", "show"], (error, stdout) => {
    if (error) {
      callback(new Set());
      return;
    }
    const known = new Set(
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(":");
          const type = parts.pop();
          const name = parts.join(":");
          return { name, type };
        })
        .filter((c) => c.type === "802-11-wireless")
        .map((c) => c.name),
    );
    callback(known);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password, X-Kiosk-Exit-Token");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // --------------------------------------------------------- Feedback

    if (url.pathname === "/api/feedback" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, readFeedbackEntries());
      return;
    }

    // Bewusst OHNE requireAdmin -- nur die reine ANZAHL ungelesener
    // Eintraege (kein Inhalt), fuer den kleinen Hinweis in der oeffentlich
    // sichtbaren Fussleiste (siehe core/Router.ts), damit man auch ohne
    // Admin-Login auf einen Blick sieht, ob neues Feedback wartet.
    if (url.pathname === "/api/feedback/unread-count" && req.method === "GET") {
      const count = readFeedbackEntries().filter((e) => !e.read).length;
      sendJson(res, 200, { count });
      return;
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      if (isRateLimited(`feedback:${clientIp(req)}`, 20, 60_000)) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const message = typeof parsed.message === "string" ? parsed.message.trim().slice(0, 2000) : "";
      if (!message) {
        sendJson(res, 400, { error: "empty_message" });
        return;
      }
      const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const entry = { id, message, createdAt: new Date().toISOString(), read: false };
      fs.writeFileSync(path.join(FEEDBACK_DIR, `${id}.json`), JSON.stringify(entry, null, 2));
      sendJson(res, 201, entry);
      return;
    }

    const readMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)\/read$/);
    if (readMatch && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const id = readMatch[1];
      if (!isSafeId(id)) {
        sendJson(res, 400, { error: "invalid_id" });
        return;
      }
      const file = path.join(FEEDBACK_DIR, `${id}.json`);
      if (!fs.existsSync(file)) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      const entry = JSON.parse(fs.readFileSync(file, "utf-8"));
      entry.read = true;
      fs.writeFileSync(file, JSON.stringify(entry, null, 2));
      sendJson(res, 200, entry);
      return;
    }

    if (url.pathname === "/api/feedback/reset" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      for (const file of fs.readdirSync(FEEDBACK_DIR)) {
        if (file.endsWith(".json")) fs.unlinkSync(path.join(FEEDBACK_DIR, file));
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    const deleteMatch = url.pathname.match(/^\/api\/feedback\/([^/]+)$/);
    if (deleteMatch && req.method === "DELETE") {
      if (!requireAdmin(req, res)) return;
      const id = deleteMatch[1];
      if (!isSafeId(id)) {
        sendJson(res, 400, { error: "invalid_id" });
        return;
      }
      const file = path.join(FEEDBACK_DIR, `${id}.json`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      sendJson(res, 200, { ok: true });
      return;
    }

    // ----------------------------------------------- Sync: Highscores/Stats/Settings
    //
    // Alles unterhalb bewusst NUR erreichbar, wenn NTM_SYNC=1 gesetzt ist
    // (siehe Datei-Kommentar oben) -- ansonsten wie ein unbekannter
    // Endpunkt behandelt (404), fuer den Offline-Kiosk-Betrieb also exakt
    // so, als gaebe es diesen ganzen Abschnitt nicht.

    if (url.pathname.startsWith("/api/highscores") || url.pathname.startsWith("/api/stats") || url.pathname.startsWith("/api/settings")) {
      if (!SYNC_ENABLED) {
        sendJson(res, 404, { error: "sync_disabled" });
        return;
      }
    }

    if (url.pathname === "/api/highscores" && req.method === "GET") {
      sendJson(res, 200, readAllHighscores());
      return;
    }

    if (url.pathname === "/api/highscores" && req.method === "POST") {
      if (isRateLimited(`highscore:${clientIp(req)}`, 30, 60_000)) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const { gameId, board, name, value, direction, achievedAt } = parsed;
      if (typeof gameId !== "string" || !isSafeId(gameId) || typeof board !== "string" || !isSafeId(board)) {
        sendJson(res, 400, { error: "invalid_id" });
        return;
      }
      if (direction !== "higher-better" && direction !== "lower-better") {
        sendJson(res, 400, { error: "invalid_direction" });
        return;
      }
      // Grobe Plausibilitaetsgrenze statt echter Anti-Cheat-Pruefung (die ist
      // ohne serverseitige Spiellogik/echte Nutzerkonten nicht moeglich,
      // siehe README) -- faengt zumindest offensichtlichen Unsinn ab.
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e7) {
        sendJson(res, 400, { error: "invalid_value" });
        return;
      }
      const entry = {
        name: (typeof name === "string" ? name.trim().slice(0, 16) : "") || "Anonym",
        value,
        achievedAt: typeof achievedAt === "string" ? achievedAt : new Date().toISOString(),
      };
      const existing = readHighscoreBoard(gameId, board);
      const next = mergeHighscoreEntry(existing, entry, direction);
      if (next !== existing) {
        fs.writeFileSync(highscoreFilePath(gameId, board), JSON.stringify(next, null, 2));
      }
      sendJson(res, 200, next);
      return;
    }

    if (url.pathname === "/api/highscores/reset" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      for (const file of fs.readdirSync(HIGHSCORES_DIR)) {
        if (file.endsWith(".json")) fs.unlinkSync(path.join(HIGHSCORES_DIR, file));
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/stats" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      sendJson(res, 200, readAllStatsSessions());
      return;
    }

    if (url.pathname === "/api/stats" && req.method === "POST") {
      if (isRateLimited(`stats:${clientIp(req)}`, 60, 60_000)) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const { gameId, startedAt, endedAt, durationMs } = parsed;
      if (typeof gameId !== "string" || !isSafeId(gameId)) {
        sendJson(res, 400, { error: "invalid_id" });
        return;
      }
      if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 24 * 60 * 60 * 1000) {
        sendJson(res, 400, { error: "invalid_duration" });
        return;
      }
      const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const session = {
        gameId,
        startedAt: typeof startedAt === "string" ? startedAt : new Date().toISOString(),
        endedAt: typeof endedAt === "string" ? endedAt : new Date().toISOString(),
        durationMs,
      };
      fs.writeFileSync(path.join(STATS_DIR, `${id}.json`), JSON.stringify(session, null, 2));
      sendJson(res, 201, session);
      return;
    }

    if (url.pathname === "/api/stats/reset" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      for (const file of fs.readdirSync(STATS_DIR)) {
        if (file.endsWith(".json")) fs.unlinkSync(path.join(STATS_DIR, file));
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/settings" && req.method === "GET") {
      sendJson(res, 200, readSettings());
      return;
    }

    if (url.pathname === "/api/settings" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      if (!Array.isArray(parsed.disabledGameIds) || !parsed.disabledGameIds.every((id) => typeof id === "string" && isSafeId(id))) {
        sendJson(res, 400, { error: "invalid_settings" });
        return;
      }
      const settings = { disabledGameIds: parsed.disabledGameIds };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      sendJson(res, 200, settings);
      return;
    }

    // ------------------------------------------------------------ Kiosk-Exit
    //
    // Notausgang fuer den Admin-Bereich: beendet den per --kiosk gestarteten
    // Chromium-Prozess auf DIESEM Geraet, damit z. B. bei einem WLAN-Problem
    // ohne SSH-Zugriff (der ja selbst ein funktionierendes Netzwerk
    // voraussetzt) trotzdem an den darunterliegenden Desktop (und damit an
    // die Netzwerk-Einstellungen) herangekommen wird. Absichtlich ein FEST
    // verdrahteter Befehl ohne jeden Teil aus der Anfrage (kein Injection-
    // Risiko) -- passt nur auf das eigene, feste --user-data-dir-Profil
    // (siehe README/Kiosk-Anleitung), trifft also keine fremden Chromium-
    // Prozesse.
    //
    // "killed" im JSON meldet, ob wirklich ein Prozess gefunden+beendet
    // wurde ("pkill"-Exit-Code 0) oder nicht (Exit-Code 1 -- kein Fehler,
    // nur "nichts zu tun", z. B. wenn der Kiosk-Browser gar nicht unter
    // diesem Profilnamen laeuft) -- der Client (core/kiosk.ts,
    // admin/AdminPanel.ts) zeigt bei killed:false eine erklaerende Meldung
    // an, STATT wie zuvor unbegrenzt "Wird beendet..." anzuzeigen, ohne dass
    // je etwas passiert (gemeldeter Bug: die alte Version werten die
    // Antwort auf Client-Seite ueberhaupt nicht aus).
    if (url.pathname === "/api/kiosk/exit" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      execFile("pkill", ["-f", "ticketmachine-chromium"], (error) => {
        if (error && typeof error.code !== "number") {
          // Spawn-Fehler (z. B. "pkill" nicht installiert/nicht im PATH) --
          // error.code ist dann ein String wie "ENOENT", kein Exit-Code.
          sendJson(res, 500, { ok: false, killed: false, error: String(error.code || error.message || "spawn_failed") });
          return;
        }
        const exitCode = error ? error.code : 0;
        if (exitCode > 1) {
          sendJson(res, 500, { ok: false, killed: false, exitCode });
          return;
        }
        const killed = exitCode === 0;
        // Selbstheilung: ohne echten Desktop mit Panel/WLAN-Applet (siehe
        // README, dafuer gibt's ja gerade den WLAN-Bereich im Admin-Panel)
        // blieb der darunterliegende Compositor nach dem Beenden bisher ein
        // dauerhaft leerer, nicht bedienbarer Blackscreen -- ohne Fernzugriff
        // (SSH/Ethernet) kam man von dort aus praktisch NIE wieder in den
        // Kiosk zurueck (gemeldeter Vorfall). Jetzt startet der Kiosk sich
        // nach einer Schonfrist automatisch selbst neu, falls er nicht
        // laengst manuell (z. B. per SSH) wieder laeuft.
        if (killed) scheduleKioskRelaunch(KIOSK_RELAUNCH_DELAY_MS);
        sendJson(res, 200, { ok: true, killed, relaunchInMinutes: killed ? KIOSK_RELAUNCH_DELAY_MS / 60_000 : null });
      });
      return;
    }

    // Absichtlich OHNE requireAdmin: das kleine Timer-Fenster (siehe
    // openKioskTimerWindow) hat keine eigene Admin-Sitzung und soll auch
    // keine brauchen -- es kann ohnehin nur einen bereits laufenden Timer
    // anzeigen/verlaengern/vorzeitig beenden, keine neuen admin-geschuetzten
    // Aktionen ausloesen. Ohne aktiven Timer bleibt es wirkungslos.
    if (url.pathname === "/api/kiosk/exit-status" && req.method === "GET") {
      const active = kioskRelaunchAt !== null;
      sendJson(res, 200, { active, remainingMs: active ? Math.max(0, kioskRelaunchAt - Date.now()) : 0 });
      return;
    }

    if (url.pathname === "/api/kiosk/exit-extend" && req.method === "POST") {
      if (kioskRelaunchAt === null) {
        sendJson(res, 200, { active: false });
        return;
      }
      const remaining = Math.max(0, kioskRelaunchAt - Date.now());
      scheduleKioskRelaunch(remaining + KIOSK_EXTEND_MS);
      sendJson(res, 200, { active: true, remainingMs: kioskRelaunchAt - Date.now() });
      return;
    }

    if (url.pathname === "/api/kiosk/exit-return" && req.method === "POST") {
      if (kioskRelaunchTimer) clearTimeout(kioskRelaunchTimer);
      relaunchKioskChromium();
      sendJson(res, 200, { ok: true });
      return;
    }

    // Terminal/Dateimanager direkt aus der Notausgang-Seite heraus oeffnen
    // (siehe server/kiosk-timer.html) -- der darunterliegende labwc-Desktop
    // hat sonst keinerlei Bedienoberflaeche (kein Panel, keine Taskleiste,
    // kein Rechtsklick-Menue), ohne das blieb der "Notausgang" trotz
    // beendetem Kiosk-Browser praktisch unbedienbar (gemeldeter Bug). Per
    // Token statt requireAdmin geschuetzt, siehe requireKioskExitToken oben
    // -- diese Seite hat keine eigene Admin-Sitzung.
    if (url.pathname === "/api/kiosk/launch-terminal" && req.method === "POST") {
      if (!requireKioskExitToken(req, res)) return;
      const child = spawn("lxterminal", [], { env: kioskEnv(), detached: true, stdio: "ignore" });
      child.unref();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/kiosk/launch-filemanager" && req.method === "POST") {
      if (!requireKioskExitToken(req, res)) return;
      const child = spawn("pcmanfm", [], { env: kioskEnv(), detached: true, stdio: "ignore" });
      child.unref();
      sendJson(res, 200, { ok: true });
      return;
    }

    // ------------------------------------------------- System: Lautstaerke
    //
    // Steuert die ECHTE Betriebssystem-Lautstaerke (PipeWire, ueber wpctl),
    // nicht irgendeine App-interne Lautstaerke -- auf ausdruecklichen
    // Wunsch, damit man dafuer nicht extra den Kiosk-Modus verlassen muss.
    // XDG_RUNTIME_DIR ist noetig, weil dieser Server als systemd-Service
    // laeuft (kein normaler Desktop-Login-Prozess) und wpctl sonst den
    // laufenden PipeWire-Dienst der Desktop-Sitzung nicht findet ("Could
    // not connect to PipeWire") -- 1000 ist die UID des in der README
    // vorausgesetzten einzigen Kiosk-Nutzers "flipper".
    const PIPEWIRE_ENV = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/run/user/1000" };

    if (url.pathname === "/api/system/volume" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      execFile("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"], { env: PIPEWIRE_ENV }, (error, stdout) => {
        if (error) {
          sendJson(res, 500, { error: "wpctl_failed", detail: String(error.message || error) });
          return;
        }
        const match = stdout.match(/Volume:\s*([\d.]+)/);
        if (!match) {
          sendJson(res, 500, { error: "unparseable_output" });
          return;
        }
        sendJson(res, 200, { volume: Math.round(parseFloat(match[1]) * 100) / 100, muted: /\[MUTED\]/.test(stdout) });
      });
      return;
    }

    if (url.pathname === "/api/system/volume" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const volume = Number(parsed.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        sendJson(res, 400, { error: "invalid_volume" });
        return;
      }
      execFile("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", volume.toFixed(2)], { env: PIPEWIRE_ENV }, (error) => {
        if (error) {
          sendJson(res, 500, { ok: false, error: String(error.message || error) });
          return;
        }
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    // ------------------------------------------------ System: Audioausgabe
    //
    // Auf diesem Geraet gibt es zwei PipeWire-Sinks (Klinke + HDMI) -- welcher
    // gerade der Standard ist, laesst sich nur ueber "wpctl status" auslesen
    // (kein --format json in dieser wpctl-Version). Geparst wird deshalb der
    // Text zwischen "Sinks:" und der naechsten Abschnittsueberschrift; jede
    // Zeile sieht z. B. so aus (das "*" markiert den aktuellen Standard):
    //   " │  *   56. Internes Audio Stereo               [vol: 0.85]"
    // Hilfsfunktion fuer beide Endpunkte unten (GET /outputs, POST /rescan)
    // -- parst "wpctl status" wie im Kommentar oben beschrieben.
    function getAudioOutputs(callback) {
      execFile("wpctl", ["status"], { env: PIPEWIRE_ENV }, (error, stdout) => {
        if (error) {
          callback(null);
          return;
        }
        const sinksSection = stdout.split(/^\s*[│─┌└├]*\s*Sinks:\s*$/m)[1] || "";
        const sinksBlock = sinksSection.split(/^\s*[│─┌└├]*\s*Sources:\s*$/m)[0] || "";
        const outputs = sinksBlock
          .split("\n")
          .map((line) => line.replace(/^[\s│─┌└├]+/, ""))
          .map((line) => {
            const match = line.match(/^(\*)?\s*(\d+)\.\s+(.+?)\s+\[vol:\s*([\d.]+)/);
            if (!match) return null;
            return { id: Number(match[2]), name: match[3].trim(), active: match[1] === "*" };
          })
          .filter((entry) => entry !== null);
        callback(outputs);
      });
    }

    if (url.pathname === "/api/system/audio/outputs" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      getAudioOutputs((outputs) => {
        if (outputs === null) {
          sendJson(res, 500, { error: "wpctl_failed" });
          return;
        }
        sendJson(res, 200, { outputs });
      });
      return;
    }

    // Behebt den gemeldeten Fall "HDMI-Bildschirm nachtraeglich angeschlossen,
    // taucht trotz 'Aktualisieren' nicht in der Liste auf": WirePlumber
    // scannt die vorhandenen ALSA-Karten nur EINMALIG beim eigenen Start --
    // die vc4-hdmi-Karte ist zwar (anders als eine echte USB-Karte) auf
    // Kernel-Ebene unabhaengig vom tatsaechlichen Monitor-Anschluss immer
    // vorhanden, WirePlumber uebernimmt sie aber nur, wenn sie beim eigenen
    // Start schon da war. Ein Neustart des WirePlumber-Nutzerdienstes zwingt
    // ihn zu einem erneuten vollstaendigen Scan -- verifiziert am echten
    // Geraet: HDMI-Sink erscheint danach zuverlaessig (und wird von
    // WirePlumber automatisch als neuer Standard gesetzt).
    if (url.pathname === "/api/system/audio/rescan" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      execFile("systemctl", ["--user", "restart", "wireplumber"], { env: PIPEWIRE_ENV }, (error) => {
        if (error) {
          sendJson(res, 500, { error: "wireplumber_restart_failed", detail: String(error.message || error) });
          return;
        }
        // WirePlumber braucht nach dem Neustart einen Moment, bis es die
        // ALSA-Karten fertig neu gescannt hat -- ein sofortiges "wpctl
        // status" liefert sonst noch die alte (leere) Liste.
        setTimeout(() => {
          getAudioOutputs((outputs) => {
            if (outputs === null) {
              sendJson(res, 500, { error: "wpctl_failed" });
              return;
            }
            sendJson(res, 200, { outputs });
          });
        }, 2000);
      });
      return;
    }

    if (url.pathname === "/api/system/audio/output" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const id = Number(parsed.id);
      if (!Number.isInteger(id) || id < 0) {
        sendJson(res, 400, { error: "invalid_id" });
        return;
      }
      execFile("wpctl", ["set-default", String(id)], { env: PIPEWIRE_ENV }, (error) => {
        if (error) {
          sendJson(res, 500, { ok: false, error: String(error.message || error) });
          return;
        }
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    // ------------------------------------------------------- System: WLAN
    //
    // Ueber nmcli (NetworkManager, auf aktuellen Raspberry Pi OS-Versionen
    // bereits vorinstalliert) -- kein zusaetzliches GUI-Tool (nm-applet o.
    // ae.) auf diesem Geraet vorhanden, daher eine eigene, schlanke API
    // statt eines eingebetteten Fremd-Fensters. "wlan0" ist der auf diesem
    // Geraet tatsaechliche WLAN-Geraetename (siehe "nmcli device status"),
    // bei einem anderen Pi-Modell/Setup ggf. anpassen.
    if (url.pathname === "/api/system/wifi/status" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      execFile("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status"], (error, stdout) => {
        if (error) {
          sendJson(res, 500, { error: "nmcli_failed" });
          return;
        }
        const wifiLine = stdout.split("\n").find((l) => l.split(":")[1] === "wifi");
        if (!wifiLine) {
          sendJson(res, 200, { available: false, connected: false, ssid: null });
          return;
        }
        const [, , state, connection] = wifiLine.split(":");
        const connected = state === "connected";
        sendJson(res, 200, { available: true, connected, ssid: connected ? connection : null });
      });
      return;
    }

    if (url.pathname === "/api/system/wifi/scan" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      // Bekannte Netzwerke (bereits per nmcli gespeicherte Zugangsdaten) VOR
      // dem eigentlichen Scan ermitteln, um sie in der Antwort pro SSID zu
      // markieren -- siehe getKnownWifiSsids weiter unten. nmcli benennt
      // per "device wifi connect" angelegte Profile standardmaessig genau
      // wie die SSID, daher reicht ein simpler Namensabgleich.
      getKnownWifiSsids((knownSsids) => {
        execFile(
          "nmcli",
          ["-t", "-f", "SSID,SIGNAL,SECURITY,IN-USE", "device", "wifi", "list", "--rescan", "yes"],
          { timeout: 15_000 },
          (error, stdout) => {
            if (error) {
              sendJson(res, 500, { error: "nmcli_scan_failed" });
              return;
            }
            const seen = new Set();
            const networks = stdout
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                // nmcli-terse-Felder sind ":"-getrennt; die SSID selbst steht
                // vorne und koennte theoretisch selbst ein ":" enthalten,
                // daher von HINTEN (feste Feldanzahl der drei letzten Spalten)
                // statt von vorne zerlegen.
                const parts = line.split(":");
                const inUse = parts.pop();
                const security = parts.pop();
                const signal = parts.pop();
                const ssid = parts.join(":");
                return {
                  ssid,
                  signal: Number(signal) || 0,
                  secured: security !== "" && security !== "--",
                  inUse: inUse === "*",
                  known: knownSsids.has(ssid),
                };
              })
              // Dieselbe SSID kann mehrfach auftauchen (mehrere Access Points
              // desselben Netzwerks) -- nur den ersten (staerksten, da nmcli
              // absteigend sortiert liefert) Treffer behalten.
              .filter((n) => n.ssid && !seen.has(n.ssid) && seen.add(n.ssid));
            sendJson(res, 200, { networks });
          },
        );
      });
      return;
    }

    if (url.pathname === "/api/system/wifi/connect" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      const ssid = typeof parsed.ssid === "string" ? parsed.ssid.trim() : "";
      const password = typeof parsed.password === "string" ? parsed.password : "";
      if (!ssid) {
        sendJson(res, 400, { error: "missing_ssid" });
        return;
      }
      const args = ["device", "wifi", "connect", ssid];
      if (password) args.push("password", password);
      execFile("nmcli", args, { timeout: 25_000 }, (error, stdout, stderr) => {
        if (error) {
          sendJson(res, 500, { ok: false, error: String(stderr || error.message || error).trim() });
          return;
        }
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    if (url.pathname === "/api/system/wifi/disconnect" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      execFile("nmcli", ["device", "disconnect", "wlan0"], (error, stdout, stderr) => {
        if (error) {
          sendJson(res, 500, { ok: false, error: String(stderr || error.message || error).trim() });
          return;
        }
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    // ------------------------------------------------------ System: Drucker
    //
    // Angeschlossener USB-Bondrucker meldet sich beim Kernel als Klasse-7-
    // Druckergeraet (usblp) und landet dadurch als simples Zeichen-Geraet
    // unter /dev/usb/lp0 -- fuer ein Kassenbon-/Ticket-Format reicht rohes
    // Schreiben mit ein paar ESC/POS-Steuerbytes (Initialisierung + Text),
    // ein vollwertiges CUPS-Setup mit PPD-Treiber ist fuer diesen simplen
    // Anwendungsfall nicht noetig. flipper muss dafuer in der Gruppe "lp"
    // sein (siehe deployment/README), sonst schlaegt das Schreiben mit
    // EACCES fehl.
    function sendPrinterStatus(res) {
      fs.access(PRINTER_DEVICE, fs.constants.W_OK, async (err) => {
        if (err) {
          sendJson(res, 200, { available: false, paper: "unknown" });
          return;
        }
        // Siehe printRasterJob-Kommentar zum Logging weiter unten -- diese
        // Statusabfrage lief per withPrinterDevice() durch dieselbe
        // Warteschlange wie ein Druckauftrag, ist also fuer die
        // Ueberlappungs-Diagnose ebenfalls relevant (periodisch alle 60s aus
        // jedem offenen Tab, siehe core/Router.ts).
        const t0 = Date.now();
        const status = await queryPrinterPaperStatus();
        console.log(`[printer] status-query fertig nach ${Date.now() - t0}ms -> ${JSON.stringify(status)}`);
        const paper = !status ? "unknown" : status.empty ? "empty" : status.low ? "low" : "ok";
        sendJson(res, 200, { available: true, paper });
      });
    }

    if (url.pathname === "/api/system/printer/status" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      sendPrinterStatus(res);
      return;
    }

    // Oeffentliche, ungeschuetzte Variante nur des Papierstands -- fuer die
    // kleine Warnanzeige im Kopfleisten-Logo (siehe core/Router.ts), die
    // fuer JEDE:N Besucher:in sichtbar sein soll, nicht nur im Admin-Bereich.
    // Liefert bewusst nur "available"/"paper", keine sonstigen internen
    // Details -- rein lesend und billig, daher kein Rate-Limit noetig.
    if (url.pathname === "/api/system/printer/paper" && req.method === "GET") {
      sendPrinterStatus(res);
      return;
    }

    // Generischer Rasterdruck (ESC/POS "GS v 0"): das Ticket-Design (siehe
    // core/ticket.ts) wird komplett im Client als 1-Bit-Bitmap gerendert
    // (inkl. der 90-Grad-Drehung fuers Querformat-Ticket auf dem
    // schmalen, aber beliebig langen Thermopapier) und hier nur noch roh
    // an den Drucker durchgereicht -- dieser Endpunkt selbst weiss nichts
    // vom Ticket-Layout, nur von Breite/Hoehe/gepackten Bytes, bleibt also
    // fuer jeden kuenftigen Rasterdruck wiederverwendbar. Breite/Hoehe als
    // Query-Parameter, da der Body reine Binaerdaten sind (1 Bit/Pixel, MSB
    // zuerst, 1 = schwarz, byteweise pro Zeile aufgerundet -- Standard-
    // Format fuer GS v 0). Zwei Endpunkte teilen sich dieselbe Logik
    // (printRasterJob): der Admin-Testdruck bleibt hinter dem Passwort,
    // der eigentliche Ticket-Druck bei einem erspielten Highscore laeuft
    // dagegen OHNE Admin-Login (Spieler:innen kennen das Passwort nicht),
    // dafuer straff ratenlimitiert -- schuetzt die Papierrolle vor Spam,
    // ohne echte Highscore-Momente zu blockieren.
    // Grosszuegig ueber der tatsaechlich hoechsten bekannten Ticket-Vorlage
    // (~577 Zeilen bei aktuellem Design, siehe core/ticket.ts) -- auf
    // ausdruecklichen Wunsch als Failsafe: eine Anfrage, die mehr als die
    // DOPPELTE realistische Ticketlaenge verlangt, wird sofort abgelehnt,
    // BEVOR ueberhaupt etwas an den Drucker geschickt wird. Schuetzt gegen
    // einen Client-/Renderfehler, der ein absurd hohes Bild anfordert (war
    // vorher bei 4000 Zeilen, also ueber 6x so grosszuegig wie noetig).
    const MAX_EXPECTED_TICKET_ROWS = 620;
    // Nur fuer die Fehlersuche beim wiederholt gemeldeten Gibberish-Vorfall:
    // protokolliert Start/Ende jedes Druckauftrags MIT Quelle (admin-
    // geschuetzter Testdruck vs. oeffentlicher Highscore-Druck) -- damit sich
    // im Systemd-Journal (journalctl -u ticketmachine-server) nachtraeglich
    // pruefen laesst, ob zwei Auftraege zeitlich ueberlappen (z. B. durch
    // einen Ghost-Touch-Doppel-Tipp), statt nur zu vermuten.
    let printJobCounter = 0;
    async function printRasterJob(req, res, url, source) {
      const jobId = ++printJobCounter;
      const startedAt = Date.now();
      console.log(`[printer] #${jobId} START source=${source} ip=${clientIp(req)}`);
      const width = Number(url.searchParams.get("width"));
      const height = Number(url.searchParams.get("height"));
      if (!Number.isInteger(width) || width <= 0 || width % 8 !== 0 || !Number.isInteger(height) || height <= 0 || height > MAX_EXPECTED_TICKET_ROWS * 2) {
        console.log(`[printer] #${jobId} ENDE: invalid_dimensions (width=${width}, height=${height})`);
        sendJson(res, 400, { error: "invalid_dimensions" });
        return;
      }
      let bodyBuf;
      try {
        bodyBuf = await readBodyBuffer(req, 400_000);
      } catch {
        console.log(`[printer] #${jobId} ENDE: payload_too_large`);
        sendJson(res, 413, { error: "payload_too_large" });
        return;
      }
      const bytesPerRow = width / 8;
      if (bodyBuf.length !== bytesPerRow * height) {
        console.log(`[printer] #${jobId} ENDE: size_mismatch`);
        sendJson(res, 400, { error: "size_mismatch", expected: bytesPerRow * height, got: bodyBuf.length });
        return;
      }
      const xL = bytesPerRow & 0xff;
      const xH = (bytesPerRow >> 8) & 0xff;
      const init = Buffer.from([0x1b, 0x40]);
      // ESC d 5 -- fuenf Zeilen vorschieben zum bequemen Abreissen (Historie:
      // erst 4 Zeilen -- zu wenig, musste von Hand nachgezogen werden --,
      // dann 8 -- zu viel Leerpapier --, dann 5 als Mittelweg).
      //
      // Zwischenzeitlich versuchsweise auf "ESC J n" umgestellt (feinere
      // Einheit als die groben ganzen Zeilen von ESC d, siehe Git-Historie
      // dieser Datei), mit rechnerisch hergeleiteten Millimeterwerten (1/6
      // Zoll Standard-Zeilenabstand, 1/203 Zoll ESC-J-Einheit bei diesem
      // 203dpi-Drucker). Die Rechnung war fuer dieses konkrete (undokumen-
      // tierte) Geraet aber offenbar nicht zutreffend: selbst eine
      // rechnerisch nur ~0.3mm kleinere Kuerzung als das Original wurde
      // live weiterhin als "zu viel gekuerzt" zurueckgemeldet -- der
      // tatsaechliche Effekt auf dem echten Geraet wich also deutlich von
      // der Rechnung ab. Deshalb komplett zurueck auf das literale
      // Original "ESC d 5" (keine Umrechnung mehr noetig/moeglich ohne
      // Datenblatt) statt weiter mit vermutlich falschen Annahmen zu
      // rechnen.
      const feed = Buffer.from([0x1b, 0x64, 0x05]);

      // Der Rasterbefehl "GS v 0" wird NICHT als ein einziger Block mit der
      // vollen Bildhoehe gesendet, sondern in Baendern von je max.
      // RASTER_BAND_HEIGHT Zeilen aufgeteilt (mehrere aufeinanderfolgende
      // "GS v 0"-Befehle in EINEM Schreibvorgang). Grund: die Ticket-Vorlagen
      // sind quer gedreht deutlich hoeher als breit (bis zu ~580 Zeilen bei
      // 48 Byte/Zeile, ueber 27 KB Bilddaten in einem einzigen Befehl) --
      // billige Thermodrucker haben oft nur einen kleinen internen
      // Bildpuffer und laufen bei so grossen Einzelbefehlen ueber, was sich
      // genau als verschobener/zerrissener Ausdruck mit fehlendem Ende
      // aeussert (reproduziertes Symptom trotz korrektem, mehrfach visuell
      // verifiziertem Rendering in core/ticket.ts -- siehe dortige
      // Kommentare). Baenderung behebt das, da der Drucker jedes Band
      // einzeln abarbeiten und den Puffer dazwischen leeren kann.
      //
      // War zunaechst 200 -- trotz Pacing zwischen den Baendern (siehe unten)
      // wurde weiterhin Gibberish gemeldet, und zwar wiederholt "nach
      // ungefaehr der Haelfte des Tickets". Grund: ein einzelnes Band von 200
      // Zeilen sind 200*48 = 9600 Byte, die node fs.write() als EIN
      // Schreibvorgang an den Kernel/USB-Treiber uebergibt -- der liefert
      // diesen Block dem Drucker in wenigen Millisekunden ueber USB aus,
      // WEIT schneller als die anschliessende Pause vor dem naechsten Band
      // greifen kann. Ist der interne Bildpuffer des Druckers kleiner als
      // 9600 Byte (bei diesem generischen Modell nicht dokumentiert, aber
      // plausibel), laeuft er schon WAEHREND dieses einen grossen Schreib-
      // vorgangs ueber -- die Pause DANACH kommt dann zu spaet. Deutlich
      // kleinere Baender (deren einzelner Schreibvorgang dadurch selbst bei
      // voller USB-Geschwindigkeit nur einen kleinen Bruchteil eines
      // realistischen Druckerpuffers fuellen kann) beheben das strukturell,
      // unabhaengig von der genauen (unbekannten) Puffergroesse.
      // Bewusst SEHR klein (3 Zeilen = 144 Byte je Schreibvorgang) -- siehe
      // ausfuehrlicher Kommentar weiter unten bei PRINT_SETTLE_MS: die
      // Pause zwischen den Baendern ist WIEDER da (war kurzzeitig entfernt),
      // aber jetzt auf viele kleine Haeppchen verteilt statt wenige grosse,
      // damit der Papiervorschub gleichmaessig statt in sichtbaren
      // "Haekchen" wirkt.
      const RASTER_BAND_HEIGHT = 3;
      const bands = [];
      for (let rowStart = 0; rowStart < height; rowStart += RASTER_BAND_HEIGHT) {
        const bandHeight = Math.min(RASTER_BAND_HEIGHT, height - rowStart);
        const bandBuf = bodyBuf.subarray(rowStart * bytesPerRow, (rowStart + bandHeight) * bytesPerRow);
        const byL = bandHeight & 0xff;
        const byH = (bandHeight >> 8) & 0xff;
        const bandHeader = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, byL, byH]);
        // Schwaerzungsanteil dieses Bandes (0..1) -- fliesst unten wieder in
        // die Pause nach dem Band ein (siehe PRINT_SETTLE_MS-Kommentar):
        // ein Thermodruckkopf braucht fuer stark schwarze Zeilen (z. B. den
        // runden ZORNTRAIN-Stempel) MERKLICH mehr Energie/Zeit pro Zeile als
        // fuer duennen Text -- eine feste Zeilenpauschale unterschaetzt
        // solche Stellen sonst systematisch (die genau in einer solchen
        // dichten Passage gemeldete "Gibberish mittendrin" passt dazu).
        let blackBits = 0;
        for (let i = 0; i < bandBuf.length; i++) {
          let byte = bandBuf[i];
          byte = byte - ((byte >> 1) & 0x55);
          byte = (byte & 0x33) + ((byte >> 2) & 0x33);
          blackBits += (byte + (byte >> 4)) & 0x0f;
        }
        const blackRatio = bandBuf.length > 0 ? blackBits / (bandBuf.length * 8) : 0;
        bands.push({ buffer: Buffer.concat([bandHeader, bandBuf]), rows: bandHeight, blackRatio });
      }

      // Papierstand-Check UND der eigentliche Rasterdruck laufen ABSICHTLICH
      // gemeinsam in EINEM withPrinterDevice-Block (nicht als zwei getrennte
      // Aufrufe) -- sonst koennte zwischen Check und Schreiben eine ANDERE
      // Anfrage (z. B. eine periodische Papierstand-Abfrage aus core/
      // Router.ts) dazwischenfunken. Nutzt dafuer queryPrinterPaperStatusRaw
      // (OHNE eigene Verpackung), siehe Kommentar dort.
      //
      // WICHTIG (mehrfach erneut gemeldeter Gibberish-Vorfall TROTZ obiger
      // Serialisierung, ausserdem "Ticket wird zu frueh abgeschnitten"):
      // fs.write()/fs.writeFile() liefert seine Callback, sobald der Kernel-
      // Treiber die Bytes per USB an den Drucker UEBERGEBEN hat -- nicht,
      // wenn der Drucker sie fertig AUSGEDRUCKT hat. Ein Thermodruck von
      // ~577 Bildzeilen braucht mechanisch mehrere Sekunden (Kopf fahren,
      // Papier vorschieben), die USB-Uebertragung selbst dauert dagegen nur
      // Millisekunden. PRINT_SETTLE_MS haelt die Warteschlange NACH dem
      // gesamten Druckauftrag deshalb noch zusaetzlich offen, bevor der
      // naechste Auftrag (Druck oder Statusabfrage) drankommt -- verhindert,
      // dass ein zweiter Druckauftrag (z. B. beim wiederholten Testdrucken
      // im Adminbereich kurz hintereinander) mitten in den noch laufenden
      // physischen Druck der Lok hineinschreibt.
      //
      // Das allein reicht aber nicht: werden ALLE Baender EINES Auftrags als
      // EIN einziger fs.writeFile()-Aufruf gesendet, nimmt der Kernel/USB-
      // Treiber so einen mehrere KB grossen Block oft deutlich schneller an,
      // als der Drucker ihn physisch abarbeiten kann -- das war der
      // urspruengliche Puffer-Ueberlauf (siehe RASTER_BAND_HEIGHT-Kommentar
      // oben), den kleine Einzel-Schreibvorgaenge beheben.
      //
      // Die Pause zwischen den Baendern (MS_PER_PRINTED_ROW) wurde
      // zwischenzeitlich versuchsweise KOMPLETT entfernt, in der (falschen)
      // Annahme, fs.write() blockiere bereits von selbst lange genug: eine
      // live beobachtete Testreihe zeigte stattdessen, dass ALLE 49 Baender
      // (das komplette ~577-Zeilen-Ticket) ohne Pause in nur ~1,3-1,8s
      // geschrieben wurden -- der Kernel puffert die Schreibvorgaenge
      // offenbar selbst vor und liefert sie im Hintergrund aus, WEIT
      // schneller als der Drucker physisch mithalten kann (ein Thermodruck
      // von 577 Zeilen braucht mechanisch mehrere Sekunden). Ergebnis war
      // NICHT nur weiterhin Gibberish, sondern der Drucker reagierte danach
      // ueberhaupt nicht mehr auf Statusabfragen (Timeout) -- schlimmer als
      // vorher. Die Pause ist deshalb WIEDER da, jetzt aber auf viele sehr
      // kleine Haeppchen verteilt (RASTER_BAND_HEIGHT=3 statt 12) statt auf
      // wenige grosse -- gleiche Gesamt-Bremswirkung, aber der
      // Papiervorschub sollte dadurch gleichmaessiger wirken statt in
      // sichtbaren "Haekchen" zu stottern (gemeldeter Wunsch). Der
      // Dichte-Zuschlag (siehe blackRatio oben) wurde dabei deutlich
      // verstaerkt (bis zu +150% statt vorher +60%) -- die zuvor trotz
      // Pause weiterhin gemeldete Gibberish-Stelle lag in einer auffaellig
      // dunklen Bildregion (~50% Schwaerze), die feste Zeilenpauschale +
      // milder Zuschlag hat dort vermutlich trotzdem nicht gereicht.
      //
      // MS_PER_PRINTED_ROW=20 (zusammen mit dem staerkeren Dichte-Zuschlag)
      // war die ERSTE Konfiguration, die live nachweislich sauber druckte
      // (~577 Zeilen in ~23s Uebertragungszeit). Seitdem schrittweise
      // gesenkt, JEWEILS live bestaetigt weiterhin sauber (kein Gibberish
      // mehr gemeldet) UND per Log-Zeitstempel objektiv gemessen: 14
      // (~16s), 10 (gemessen 11.6s), 7 (gemessen 8.4s), 5 (gemessen 6.1-6.2s,
      // zweimal hintereinander sauber getestet), jetzt testweise 4 (ca.
      // 5s erwartet). Naehert sich MS_MIN_PER_BAND (10ms) als Untergrenze
      // pro Band an -- ab hier bringt weiteres Senken abnehmenden Ertrag,
      // da duenne (helle) Baender ohnehin schon an der Untergrenze
      // haengen, nur noch dichte/dunkle Baender werden durch eine weitere
      // Senkung spuerbar schneller (und genau dort lag die Gibberish-
      // Stelle beim urspruenglichen Vorfall -- also mit Bedacht weiter
      // senken). RASTER_BAND_HEIGHT und der Dichte-Zuschlag bleiben
      // weiterhin unveraendert (siehe oben). Falls erneut Gibberish
      // auftritt: schrittweise zurueck zur letzten bestaetigt sauberen
      // Stufe (5, dann 7, dann 10, dann 14, dann 20).
      const PRINT_SETTLE_MS = 4000;
      const MS_PER_PRINTED_ROW = 4;
      const MS_MIN_PER_BAND = 10;
      await withPrinterDevice(
        () =>
          new Promise((resolve) => {
            console.log(`[printer] #${jobId} Warteschlange frei, beginnt jetzt (${Date.now() - startedAt}ms gewartet), ${bands.length} Baender, ${height} Zeilen`);
            queryPrinterPaperStatusRaw().then((paperStatus) => {
              if (paperStatus && paperStatus.empty) {
                console.log(`[printer] #${jobId} ENDE: paper_empty`);
                sendJson(res, 200, { ok: false, error: "paper_empty" });
                resolve();
                return;
              }
              fs.open(PRINTER_DEVICE, "r+", (openErr, fd) => {
                if (openErr) {
                  const reason = openErr.code === "ENOENT" ? "printer_not_found" : openErr.code === "EACCES" ? "permission_denied" : "write_failed";
                  console.log(`[printer] #${jobId} ENDE: open-Fehler ${reason}`);
                  sendJson(res, 500, { ok: false, error: reason });
                  resolve();
                  return;
                }
                const writeChunk = (buffer) => new Promise((res2, rej2) => fs.write(fd, buffer, (err) => (err ? rej2(err) : res2())));
                (async () => {
                  await writeChunk(init);
                  // Fortschritts-Log alle 10 Baender (nicht mehr JEDES Band --
                  // bei RASTER_BAND_HEIGHT=3 waeren das ueber 190 Log-Zeilen
                  // pro Druck, unnoetig viel Rauschen/I-O-Overhead) -- rein
                  // zur Fehlersuche beim wiederholt gemeldeten Gibberish-
                  // Vorfall: zeigt im journalctl-Log live, in welchem groben
                  // Zeilenbereich ein Ausdruck tatsaechlich kippt.
                  const sleep = (ms) => new Promise((res2) => setTimeout(res2, ms));
                  for (let i = 0; i < bands.length; i++) {
                    const band = bands[i];
                    await writeChunk(band.buffer);
                    if (i % 10 === 0 || i === bands.length - 1) {
                      console.log(`[printer] #${jobId} Band ${i + 1}/${bands.length} geschrieben (Zeile ~${i * RASTER_BAND_HEIGHT}, Schwaerze ${Math.round(band.blackRatio * 100)}%, ${Date.now() - startedAt}ms seit Start)`);
                    }
                    // Dichte-Zuschlag bis zu +150% Zeit bei nahezu vollflaechig
                    // schwarzen Baendern (blackRatio nahe 1), siehe Kommentar
                    // oben bei PRINT_SETTLE_MS.
                    const densityFactor = 1 + band.blackRatio * 2.5;
                    await sleep(Math.max(MS_MIN_PER_BAND, Math.round(band.rows * MS_PER_PRINTED_ROW * densityFactor)));
                  }
                  await writeChunk(feed);
                })()
                  .then(() => {
                    console.log(`[printer] #${jobId} Baender fertig geschrieben (${Date.now() - startedAt}ms seit Start), Warteschlange bleibt noch ${PRINT_SETTLE_MS}ms offen`);
                    sendJson(res, 200, { ok: true });
                    setTimeout(() => {
                      console.log(`[printer] #${jobId} ENDE: ok, Warteschlange wieder frei (${Date.now() - startedAt}ms gesamt)`);
                      resolve();
                    }, PRINT_SETTLE_MS);
                  })
                  .catch((err) => {
                    const reason = err.code === "ENOENT" ? "printer_not_found" : err.code === "EACCES" ? "permission_denied" : "write_failed";
                    console.log(`[printer] #${jobId} ENDE: Schreibfehler ${reason} (${err.message || err})`);
                    sendJson(res, 500, { ok: false, error: reason });
                    resolve();
                  })
                  .finally(() => {
                    fs.close(fd, () => {
                      /* Geraet ggf. schon zu -- egal, wir wollten nur aufraeumen */
                    });
                  });
              });
            });
          }),
      );
    }

    if (url.pathname === "/api/system/printer/raster" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      await printRasterJob(req, res, url, "admin-testdruck");
      return;
    }

    if (url.pathname === "/api/system/printer/ticket" && req.method === "POST") {
      // Grosszuegiger als die meisten anderen public-Endpunkte (die laufen
      // pro Aktion typischerweise viel oefter auf), aber ein Ticket ist ein
      // physischer Verbrauchsgegenstand (Papier) -- 8 pro 5 Minuten reicht
      // fuer echte Highscore-Momente (auch bei mehreren kurz hintereinander
      // an einem Kiosk) bequem, macht Skript-Spam auf die Papierrolle aber
      // unattraktiv.
      if (isRateLimited(`printer-ticket:${clientIp(req)}`, 8, 5 * 60_000)) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }
      await printRasterJob(req, res, url, "highscore-ticket");
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "unknown_endpoint" });
      return;
    }

    serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "internal_error" });
  }
});

server.listen(PORT, () => {
  console.log(`Neiphos Ticket Machine laeuft auf http://localhost:${PORT}`);
  console.log(`Statische Dateien aus: ${ROOT}`);
  console.log(`Feedback wird gespeichert in: ${FEEDBACK_DIR}`);
  if (SYNC_ENABLED) {
    console.log(`Geraeteuebergreifende Synchronisation AKTIV (NTM_SYNC=1) -- Highscores: ${HIGHSCORES_DIR}, Statistik: ${STATS_DIR}, Einstellungen: ${SETTINGS_FILE}`);
    if (!ADMIN_PASSWORD) {
      console.warn("WARNUNG: Kein VITE_ADMIN_PASSWORD gefunden (.env.local) -- admin-geschuetzte Endpunkte (Einstellungen aendern, Zuruecksetzen, Feedback/Statistik lesen) bleiben gesperrt.");
    }
  } else {
    console.log("Geraeteuebergreifende Synchronisation inaktiv (NTM_SYNC=1 in .env.local setzen, um sie zu aktivieren).");
  }
});
