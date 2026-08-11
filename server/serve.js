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
    if (url.pathname === "/api/system/printer/status" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      fs.access(PRINTER_DEVICE, fs.constants.W_OK, (err) => {
        sendJson(res, 200, { available: !err });
      });
      return;
    }

    if (url.pathname === "/api/system/printer/test" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const ESC = "\x1B";
      const payload =
        `${ESC}@` + // ESC @ = Drucker-Initialisierung (setzt Formatierung/Puffer zurueck)
        "Neiphos Ticket Machine\n" +
        "Drucker-Testdruck\n" +
        "Wenn Du das lesen kannst,\n" +
        "funktioniert es!\n\n\n\n\n";
      fs.writeFile(PRINTER_DEVICE, Buffer.from(payload, "binary"), (err) => {
        if (err) {
          sendJson(res, 500, { ok: false, error: String(err.message || err) });
          return;
        }
        sendJson(res, 200, { ok: true });
      });
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
