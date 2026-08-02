#!/usr/bin/env node
/**
 * Winziger, abhaengigkeitsfreier lokaler Webserver: liefert das gebaute
 * dist/-Verzeichnis statisch aus UND stellt eine kleine Feedback-API bereit
 * (POST/GET /api/feedback, POST /api/feedback/:id/read). Feedback landet als
 * einzelne JSON-Dateien in einem feedback/-Ordner NEBEN dist/ (nicht darin --
 * "vite build" leert dist/ bei jedem Lauf, das darf das Feedback nicht
 * mitreissen).
 *
 * Nutzung:
 *   node server/serve.js [Wurzelverzeichnis] [Port]
 *   node server/serve.js dist 8080
 *
 * Kein npm-Paket noetig (kein Express o. ae.) -- nur eingebaute Node-Module,
 * damit auf dem Kiosk-Geraet nichts weiter installiert werden muss ausser
 * Node selbst.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", "dist"));
const PORT = Number(process.argv[3] || process.env.PORT || 8080);
const FEEDBACK_DIR = process.env.FEEDBACK_DIR
  ? path.resolve(process.env.FEEDBACK_DIR)
  : path.resolve(ROOT, "..", "feedback");

fs.mkdirSync(FEEDBACK_DIR, { recursive: true });

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url.pathname === "/api/feedback" && req.method === "GET") {
      sendJson(res, 200, readFeedbackEntries());
      return;
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
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
});
