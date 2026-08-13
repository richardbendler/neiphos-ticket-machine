import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";
import path from "node:path";

// Admin-Passwort bewusst NICHT im Quellcode/Repo, sondern per .env.local
// (siehe .env.local.example + README-Abschnitt "Admin-Passwort einrichten")
// -- ".local"-Dateien sind per .gitignore ausgeschlossen, landen also nie im
// (oeffentlichen) Repo. Ohne diese Datei bricht der Build/Dev-Server hier
// bewusst laut ab, statt z.B. mit einem unsicheren Default-Passwort
// weiterzumachen.

/**
 * Fortlaufende Build-Nummer fuer die kleine Versionsanzeige unten links im
 * Footer (siehe core/Router.ts#buildChromeFooterBar) -- auf ausdruecklichen
 * Wunsch, damit auf einen Blick erkennbar ist, ob der Automat schon den
 * neuesten Stand faehrt. In build-version.json (git-versioniert, NICHT in
 * .gitignore) gespeichert statt z.B. rein aus package.json/git-Commits
 * abgeleitet -- so bleibt die Zahl unabhaengig davon stabil UND fortlaufend,
 * ob mehrere Commits in einem Build landen oder umgekehrt. Wird NUR bei
 * einem echten Produktions-Build ("vite build") hochgezaehlt, nicht bei
 * jedem Speichern im Dev-Server (sonst waere die Zahl fuer Endnutzer:innen
 * bedeutungslos, weil sie sich staendig aendert, ohne dass je ein neuer
 * Stand deployt wurde).
 */
function nextBuildVersion(command: "build" | "serve"): number {
  const versionFile = path.resolve(process.cwd(), "build-version.json");
  let current = 0;
  try {
    current = (JSON.parse(fs.readFileSync(versionFile, "utf-8")) as { build: number }).build;
  } catch {
    // Datei fehlt/kaputt -- bei 0 neu anfangen statt den Build abzubrechen.
  }
  const next = command === "build" ? current + 1 : current;
  if (command === "build") {
    fs.writeFileSync(versionFile, JSON.stringify({ build: next }, null, 2) + "\n");
  }
  return next;
}

function formatBuildTime(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}, ${hh}:${min}`;
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (!env.VITE_ADMIN_PASSWORD || !env.VITE_ADMIN_PASSWORD.trim()) {
    throw new Error(
      "\n\n" +
        "FEHLT: VITE_ADMIN_PASSWORD ist nicht gesetzt.\n" +
        "Bitte im Projekt-Wurzelverzeichnis eine Datei '.env.local' anlegen\n" +
        "(wird per .gitignore nie eingecheckt) mit der Zeile:\n\n" +
        "  VITE_ADMIN_PASSWORD=DeinPasswortHier\n\n" +
        "Vorlage: .env.local.example kopieren und anpassen.\n" +
        "Details siehe README, Abschnitt 'Admin-Passwort einrichten'.\n",
    );
  }

  const buildVersion = nextBuildVersion(command);
  const buildTime = formatBuildTime(new Date());

  return {
    // Relativer Base-Pfad: das gebaute dist/ laeuft dadurch sowohl von einem
    // lokalen Webserver auf dem Pi (z. B. http://localhost:PORT/) als auch
    // von einer Unterseite/Unterordner einer normalen Domain aus, ohne
    // Anpassung.
    base: "./",
    // Zur Kompilierzeit fest eingesetzte Konstanten (siehe core/Router.ts#
    // buildChromeFooterBar) -- kein import.meta.env, weil das (per .env.local)
    // pro Umgebung unterschiedlich waere, hier soll es aber exakt DIESEN
    // konkreten Build identifizieren, unabhaengig davon, wo/wie er laeuft.
    define: {
      __APP_BUILD__: JSON.stringify(buildVersion),
      __APP_BUILD_TIME__: JSON.stringify(buildTime),
    },
    build: {
      target: "es2020",
      outDir: "dist",
      assetsInlineLimit: 8192,
      sourcemap: false,
    },
    server: {
      host: true,
    },
  };
});
