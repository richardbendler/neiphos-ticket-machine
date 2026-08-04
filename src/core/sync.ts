/**
 * Optionale geraeteuebergreifende Synchronisation von Highscores/Statistik/
 * Einstellungen ueber die (ebenfalls optionalen, per NTM_SYNC=1
 * freigeschalteten) Endpunkte in server/serve.js -- siehe README, Abschnitt
 * "Geraeteuebergreifende Synchronisation".
 *
 * Alles hier ist bewusst "best effort"/fire-and-forget: ist kein Server
 * erreichbar (Pi-Kiosk offline, `npm run dev`, reines statisches Hosting
 * ohne server/serve.js) oder ist die Synchronisation server-seitig nicht
 * per NTM_SYNC=1 aktiviert, antwortet der Server entweder gar nicht
 * (Netzwerkfehler) oder schnell mit 404 -- die App faellt in beiden Faellen
 * lautlos auf rein lokale Speicherung zurueck (siehe core/storage.ts,
 * core/stats.ts), genau wie beim laengst bestehenden Feedback-Fallback
 * (core/feedback.ts). Der Offline-Kiosk-Betrieb (siehe README) ist von all
 * dem unberuehrt: ohne NTM_SYNC=1 verhaelt sich der Server exakt so, als
 * gaebe es diese Datei nicht.
 */
import { gameRegistry } from "../games/registry";
import { getAdminSession } from "./adminSession";
// Zirkulaerer Import (storage.ts importiert umgekehrt pushHighscoreAttempt/
// pushSettings von hier) -- in ES-Modulen unproblematisch, da beide Seiten
// die importierten Namen nur INNERHALB von Funktionsruempfen verwenden, nie
// auf oberster Modulebene (siehe core/storage.ts, Datei-Kommentar).
import { mergeHighscoreEntry, getDisabledGameIds, applyDisabledGameIds, type HighscoreDirection, type HighscoreEntry } from "./storage";
import type { PlaySession } from "./stats";

function adminHeaders(): HeadersInit {
  const password = getAdminSession();
  return password ? { "X-Admin-Password": password } : {};
}

// ------------------------------------------------------------- Highscores

export function pushHighscoreAttempt(gameId: string, board: string, entry: HighscoreEntry, direction: HighscoreDirection): void {
  void fetch("./api/highscores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, board, direction, ...entry }),
  }).catch(() => {
    // Kein Server/kein Sync aktiv -- bleibt rein lokal, siehe Datei-Kommentar oben.
  });
}

/**
 * Holt ALLE auf dem Server bekannten Highscore-Boards und speist jeden
 * Eintrag durch dieselbe Merge-Logik wie ein frisch erspielter lokaler
 * Highscore (siehe core/storage.ts, mergeHighscoreEntry) -- danach liefert
 * jedes normale getHighscoreBoard()/getHighscoreOutcome() automatisch den
 * abgeglichenen Stand, ohne dass Spiel-Code irgendetwas davon wissen muss.
 */
export async function pullHighscoresFromServer(): Promise<void> {
  try {
    const res = await fetch("./api/highscores");
    if (!res.ok) return;
    const boards = (await res.json()) as Record<string, { value: number; entries: HighscoreEntry[] }>;
    for (const game of gameRegistry) {
      for (const category of game.highscoreCategories ?? []) {
        const board = boards[`${game.id}__${category.board}`];
        if (!board) continue;
        for (const entry of board.entries) {
          mergeHighscoreEntry(game.id, category.board, entry, category.direction);
        }
      }
    }
  } catch {
    // Kein Server/kein Sync aktiv -- bleibt rein lokal, siehe Datei-Kommentar oben.
  }
}

export async function resetHighscoresOnServer(): Promise<void> {
  try {
    await fetch("./api/highscores/reset", { method: "POST", headers: adminHeaders() });
  } catch {
    // Kein Server erreichbar -- lokales Zuruecksetzen (siehe storage.ts) bleibt trotzdem wirksam.
  }
}

// ------------------------------------------------------------------ Statistik

export function pushStatsSession(session: PlaySession): void {
  void fetch("./api/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(session),
  }).catch(() => {
    // Kein Server/kein Sync aktiv -- bleibt rein lokal, siehe Datei-Kommentar oben.
  });
}

/**
 * Admin-only: holt die serverseitig gesammelten Sessions ALLER Geraete fuer
 * die aktuelle Admin-Ansicht -- anders als bei Highscores wird das NICHT in
 * localStorage gemergt (jedes Besucher-Geraet muesste sonst dauerhaft die
 * Statistik aller anderen Geraete mitschleppen), sondern nur einmalig fuer
 * die gerade offene Statistik-Ansicht angefordert (siehe admin/AdminPanel.ts).
 * Gibt null zurueck, wenn kein Server/keine Sync-Freischaltung/keine
 * gueltige Admin-Session vorliegt.
 */
export async function pullStatsFromServer(): Promise<PlaySession[] | null> {
  try {
    const res = await fetch("./api/stats", { headers: adminHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as PlaySession[];
  } catch {
    return null;
  }
}

export async function resetStatsOnServer(): Promise<void> {
  try {
    await fetch("./api/stats/reset", { method: "POST", headers: adminHeaders() });
  } catch {
    // Kein Server erreichbar -- lokales Zuruecksetzen bleibt trotzdem wirksam.
  }
}

// --------------------------------------------------------------- Einstellungen

export function pushSettings(disabledGameIds: string[]): void {
  void fetch("./api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminHeaders() },
    body: JSON.stringify({ disabledGameIds }),
  }).catch(() => {
    // Kein Server/keine Admin-Session/kein Sync aktiv -- lokale Aenderung (siehe storage.ts) bleibt trotzdem wirksam.
  });
}

/**
 * Holt die aktuell serverseitig hinterlegte Liste ausgeblendeter Spiele und
 * uebernimmt sie 1:1 lokal (OHNE erneuten Push, siehe
 * core/storage.ts#applyDisabledGameIds) -- so sehen alle Besucher-Geraete
 * (nicht nur der Admin) dieselbe Menue-Auswahl. Gibt true zurueck, wenn sich
 * dadurch etwas geaendert hat (fuer core/Router.ts, um bei Bedarf neu zu
 * rendern).
 */
export async function pullSettingsFromServer(): Promise<boolean> {
  try {
    const res = await fetch("./api/settings");
    if (!res.ok) return false;
    const data = (await res.json()) as { disabledGameIds: unknown };
    if (!Array.isArray(data.disabledGameIds)) return false;
    const next = data.disabledGameIds.filter((id): id is string => typeof id === "string");
    const current = getDisabledGameIds();
    const changed = current.length !== next.length || current.some((id) => !next.includes(id));
    if (changed) applyDisabledGameIds(next);
    return changed;
  } catch {
    return false;
  }
}

/** Buendelt die beiden "jeder Besucher"-Abgleiche (nicht die Admin-only-Statistik) -- siehe main.ts (einmalig) und core/Router.ts (bei jedem Menuebesuch). */
export async function syncPublicDataFromServer(): Promise<{ settingsChanged: boolean }> {
  const [settingsChanged] = await Promise.all([pullSettingsFromServer(), pullHighscoresFromServer()]);
  return { settingsChanged };
}
