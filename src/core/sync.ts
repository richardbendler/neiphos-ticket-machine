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
import {
  replaceHighscoreBoard,
  getDisabledGameIds,
  applyDisabledGameIds,
  type HighscoreDirection,
  type HighscoreEntry,
  type HighscoreBoard,
} from "./storage";
import type { PlaySession } from "./stats";
import { flushLocalFeedback } from "./feedback";

function adminHeaders(): HeadersInit {
  const password = getAdminSession();
  return password ? { "X-Admin-Password": password } : {};
}

// ------------------------------------------------------- Sync-Aktiv-Status
//
// Wird von pullHighscoresFromServer bei jedem Aufruf aktuell gehalten (eine
// erfolgreiche Antwort von /api/highscores ist gleichzeitig der Beweis, dass
// NTM_SYNC serverseitig aktiv ist -- siehe dortiger Kommentar), OHNE dafuer
// eine eigene Anfrage zu brauchen. core/stats.ts fragt das ab, um bei
// aktiver Synchronisation Sessions NICHT mehr zusaetzlich dauerhaft lokal zu
// speichern (nur noch Server, siehe recordSession) -- unproblematisch, weil
// Statistik reine Admin-Telemetrie ohne Spieler-sichtbare Anzeige ist, siehe
// core/stats.ts. Default false: vor dem allerersten Abgleich (kurz nach
// App-Start) lieber vorsichtshalber lokal mitschreiben als riskieren, eine
// Session zu verlieren, nur weil der erste Check noch nicht durch ist.
let syncActive = false;

export function isSyncActive(): boolean {
  return syncActive;
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
 * Holt ALLE auf dem Server bekannten Highscore-Boards und ERSETZT (nicht
 * mehr mergt) damit den lokalen Cache jedes bekannten Spiels/Boards -- siehe
 * core/storage.ts#replaceHighscoreBoard. Eine erfolgreiche Antwort ist
 * gleichzeitig der Beweis, dass Synchronisation gerade aktiv ist (ohne
 * NTM_SYNC antwortet der Server auf /api/highscores mit 404, siehe
 * server/serve.js) -- deshalb ist es hier sicher, fehlende Boards als
 * "wirklich leer" zu behandeln statt als "noch nicht synchronisiert": wurde
 * ein Board serverseitig zurueckgesetzt, verschwindet seine Datei dort
 * komplett, taucht also hier nicht mehr auf. Vorher wurde nur additiv
 * gemergt (nie geloescht) -- ein einmal lokal gemergter Highscore ueberlebte
 * dadurch jeden spaeteren Server-Reset auf JEDEM Geraet, das ihn schon
 * gesehen hatte (gemeldetes Problem). Wird bei jedem Menuebesuch und beim
 * App-Start aufgerufen (siehe core/Router.ts, main.ts) -- ein Reset setzt
 * sich dadurch spaetestens beim naechsten "Verbinden" jedes Geraets durch,
 * ohne dass dafuer ein eigener Zeitstempel-Abgleich noetig waere.
 */
export async function pullHighscoresFromServer(): Promise<void> {
  try {
    const res = await fetch("./api/highscores");
    if (!res.ok) {
      syncActive = false;
      return;
    }
    syncActive = true;
    const boards = (await res.json()) as Record<string, HighscoreBoard>;
    for (const game of gameRegistry) {
      for (const category of game.highscoreCategories ?? []) {
        const board = boards[`${game.id}__${category.board}`] ?? null;
        replaceHighscoreBoard(game.id, category.board, board);
      }
    }
  } catch {
    // Kein Server/kein Sync aktiv -- bleibt rein lokal, siehe Datei-Kommentar oben.
    syncActive = false;
  }
}

/**
 * Gibt zurueck, ob das Server-seitige Zuruecksetzen wirklich geklappt hat --
 * vorher wurde jeder Fehler (auch z. B. 403 bei einer nicht mehr gueltigen
 * Admin-Sitzung) still verschluckt, admin/AdminPanel.ts zeigte trotzdem
 * "Highscores zurückgesetzt." an, obwohl auf dem Server ggf. nichts
 * passiert war (gemeldeter Bug). Das rein lokale Zuruecksetzen (siehe
 * storage.ts) bleibt davon unabhaengig immer wirksam.
 */
export async function resetHighscoresOnServer(): Promise<boolean> {
  try {
    const res = await fetch("./api/highscores/reset", { method: "POST", headers: adminHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Entfernt EINEN einzelnen Highscore-Eintrag auch auf dem Server (siehe
 * core/storage.ts#removeHighscoreEntry fuer die lokale Seite) -- fuer den
 * Admin-Bereich, "bestimmte Highscores loeschen" (z. B. anstoessiger Name).
 * Gibt wie resetHighscoresOnServer zurueck, ob es wirklich geklappt hat.
 */
export async function deleteHighscoreEntryOnServer(gameId: string, board: string, entry: HighscoreEntry): Promise<boolean> {
  try {
    const res = await fetch("./api/highscores/delete-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ gameId, board, ...entry }),
    });
    return res.ok;
  } catch {
    return false;
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

/** Gibt zurueck, ob das Server-seitige Zuruecksetzen wirklich geklappt hat -- siehe resetHighscoresOnServer. */
export async function resetStatsOnServer(): Promise<boolean> {
  try {
    const res = await fetch("./api/stats/reset", { method: "POST", headers: adminHeaders() });
    return res.ok;
  } catch {
    return false;
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

/**
 * Buendelt die "jeder Besucher"-Abgleiche (nicht die Admin-only-Statistik)
 * -- siehe main.ts (einmalig) und core/Router.ts (bei jedem Menuebesuch).
 * flushLocalFeedback() gehoert bewusst mit dazu: bei jedem dieser
 * Gelegenheiten wird auch versucht, noch unversandtes lokales Feedback
 * (siehe core/feedback.ts -- entstanden, weil der Server beim urspruenglichen
 * Absenden nicht erreichbar war) doch noch zum Server nachzureichen. Erst
 * dadurch werden auch AELTERE, vor einer erfolgreichen Verbindung lokal
 * "gestrandete" Feedback-Eintraege ueberhaupt zentral loeschbar (gemeldeter
 * Wunsch) -- ohne das blieben sie sonst fuer immer nur auf dem einen Geraet.
 */
export async function syncPublicDataFromServer(): Promise<{ settingsChanged: boolean }> {
  const [settingsChanged] = await Promise.all([pullSettingsFromServer(), pullHighscoresFromServer(), flushLocalFeedback()]);
  return { settingsChanged };
}

// ------------------------------------------------------------ Status-Anzeige

export type ServerSyncStatus = "no-server" | "server-sync-off" | "sync-active";

/**
 * Fuer die Anzeige im Admin-Bereich (siehe admin/AdminPanel.ts): unterscheidet
 * DREI Faelle, nicht nur "Sync an/aus" -- wichtig, um z. B. "laeuft gerade
 * lokal per npm run dev (kein server/serve.js)" von "server/serve.js laeuft,
 * aber NTM_SYNC ist nicht gesetzt" zu unterscheiden. Trick: bei fehlendem
 * server/serve.js (z. B. Vite-Dev-Server, reines statisches Hosting)
 * antwortet ./api/settings entweder gar nicht (Netzwerkfehler) oder mit
 * einer HTML-Seite (Vite-Fallback auf index.html, Content-Type text/html)
 * -- nur server/serve.js selbst antwortet mit "Content-Type:
 * application/json" (ob mit 200 bei aktivem Sync oder 404 bei
 * "sync_disabled", siehe server/serve.js).
 */
export async function checkServerSyncStatus(): Promise<ServerSyncStatus> {
  try {
    const res = await fetch("./api/settings");
    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    if (!isJson) return "no-server";
    return res.ok ? "sync-active" : "server-sync-off";
  } catch {
    return "no-server";
  }
}
