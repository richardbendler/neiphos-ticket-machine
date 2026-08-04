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
 * Bewusst per Umgebungsvariable NTM_SYNC=1 deaktiviert, solange sie nicht
 * gesetzt ist -- der urspruengliche, weiterhin unterstuetzte Einsatzzweck
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
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));
const PORT = Number(process.argv[3] || process.env.PORT || 8080);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FEEDBACK_DIR = process.env.FEEDBACK_DIR ? path.resolve(process.env.FEEDBACK_DIR) : path.resolve(ROOT, "..", "feedback");
const HIGHSCORES_DIR = path.resolve(ROOT, "..", "highscores");
const STATS_DIR = path.resolve(ROOT, "..", "stats");
const SETTINGS_FILE = path.resolve(ROOT, "..", "settings.json");

const SYNC_ENABLED = process.env.NTM_SYNC === "1" || process.env.NTM_SYNC === "true";

fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
if (SYNC_ENABLED) {
  fs.mkdirSync(HIGHSCORES_DIR, { recursive: true });
  fs.mkdirSync(STATS_DIR, { recursive: true });
}

// ------------------------------------------------------------- Admin-Passwort
//
// Liest dieselbe .env.local wie Vite (KEY=value pro Zeile, # fuer
// Kommentare) -- absichtlich ein simpler Parser statt eines dotenv-Pakets,
// damit dieser Server weiterhin ganz ohne npm-Abhaengigkeiten auskommt.

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Password");
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
    console.log("Geraeteuebergreifende Synchronisation inaktiv (NTM_SYNC=1 setzen, um sie zu aktivieren).");
  }
});
