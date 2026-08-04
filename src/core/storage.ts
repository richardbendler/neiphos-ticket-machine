/**
 * Duenner Wrapper um localStorage: alle Keys sind unter "ntm:" (Neiphos
 * Ticket Machine) genamespaced, JSON (de)serialisierung inklusive.
 * localStorage bleibt die alleinige, sofort verfuegbare (synchrone) Quelle
 * fuer alle Lesezugriffe im Spielcode -- daran aendert sich auch mit der
 * optionalen geraeteuebergreifenden Synchronisation (siehe core/sync.ts)
 * nichts: recordHighscore/setGameEnabled schreiben weiterhin zuerst und vor
 * allem lokal, ein Server-Abgleich ist nur ein zusaetzlicher, im Hintergrund
 * laufender Nebeneffekt, der bei fehlendem/nicht konfiguriertem Server
 * lautlos wirkungslos bleibt (siehe core/sync.ts fuer Details).
 */
import { pushHighscoreAttempt, pushSettings } from "./sync";

const NAMESPACE = "ntm";

function buildKey(parts: string[]): string {
  return [NAMESPACE, ...parts].join(":");
}

export function loadJSON<T>(parts: string[], fallback: T): T {
  try {
    const raw = localStorage.getItem(buildKey(parts));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(parts: string[], value: unknown): void {
  try {
    localStorage.setItem(buildKey(parts), JSON.stringify(value));
  } catch {
    // Storage evtl. nicht verfuegbar (Private Mode) oder voll -- Kiosk soll
    // trotzdem weiterlaufen, nur eben ohne Persistenz in diesem Fall.
  }
}

export function removeKey(parts: string[]): void {
  try {
    localStorage.removeItem(buildKey(parts));
  } catch {
    /* siehe saveJSON */
  }
}

export interface HighscoreEntry {
  name: string;
  value: number;
  achievedAt: string;
}

/**
 * Ein Highscore-"Brett" haelt nicht mehr nur den einen Bestwert, sondern
 * ALLE Personen, die diesen Bestwert erreicht haben -- bei Gleichstand soll
 * niemand den anderen aus der Liste verdraengen, sondern beide stehen
 * gemeinsam oben (siehe recordHighscore).
 */
export interface HighscoreBoard {
  value: number;
  entries: HighscoreEntry[];
}

export type HighscoreDirection = "higher-better" | "lower-better";
export type HighscoreOutcome = "new-best" | "tied-best" | "none";

export function getHighscoreBoard(gameId: string, board = "default"): HighscoreBoard | null {
  return loadJSON<HighscoreBoard | null>(["highscore", gameId, board], null);
}

function isBetter(value: number, current: number, direction: HighscoreDirection): boolean {
  return direction === "higher-better" ? value > current : value < current;
}

/**
 * Bestimmt, ob ein frisch erzielter Wert das bestehende Brett schlaegt
 * (verdraengt die bisherige Bestmarke) oder nur einholt (reiht sich bei den
 * Gleichstand-Namen ein) -- in beiden Faellen "hat man's geschafft" und darf
 * seinen Namen eintragen, siehe recordHighscore.
 */
export function getHighscoreOutcome(
  gameId: string,
  value: number,
  direction: HighscoreDirection,
  board = "default",
): HighscoreOutcome {
  const current = getHighscoreBoard(gameId, board);
  if (!current) return "new-best";
  if (value === current.value) return "tied-best";
  return isBetter(value, current.value, direction) ? "new-best" : "none";
}

/** Loescht den Highscore-Eintrag eines einzelnen Spiels/Boards (siehe clearAllHighscores). */
export function clearHighscoreBoard(gameId: string, board = "default"): void {
  removeKey(["highscore", gameId, board]);
}

export function recordHighscore(
  gameId: string,
  name: string,
  value: number,
  direction: HighscoreDirection,
  board = "default",
): HighscoreBoard {
  const current = getHighscoreBoard(gameId, board);
  const entry: HighscoreEntry = {
    name: name.trim().slice(0, 16) || "Anonym",
    value,
    achievedAt: new Date().toISOString(),
  };

  let next: HighscoreBoard;
  if (!current) {
    next = { value, entries: [entry] };
  } else if (value === current.value) {
    next = { value: current.value, entries: [...current.entries, entry] };
  } else if (isBetter(value, current.value, direction)) {
    next = { value, entries: [entry] };
  } else {
    next = current;
  }

  saveJSON(["highscore", gameId, board], next);
  // Fire-and-forget: bleibt bei fehlendem/deaktiviertem Server lautlos
  // wirkungslos, siehe core/sync.ts.
  pushHighscoreAttempt(gameId, board, entry, direction);
  return next;
}

/**
 * Wie recordHighscore, nimmt aber einen fertigen Eintrag (samt eigenem
 * achievedAt) statt selbst einen mit "jetzt" zu erzeugen -- fuer den Abgleich
 * mit vom Server empfangenen Eintraegen (siehe core/sync.ts,
 * pullHighscoresFromServer). Loest KEINEN erneuten Server-Push aus (sonst
 * wuerde ein synchronisierter Eintrag gleich wieder zurueckgeschickt).
 * Duplikate (z. B. beim wiederholten Abgleich desselben Servereintrags)
 * werden erkannt und nicht doppelt eingetragen.
 */
export function mergeHighscoreEntry(
  gameId: string,
  board: string,
  entry: HighscoreEntry,
  direction: HighscoreDirection,
): HighscoreBoard {
  const current = getHighscoreBoard(gameId, board);
  let next: HighscoreBoard;
  if (!current) {
    next = { value: entry.value, entries: [entry] };
  } else if (entry.value === current.value) {
    const isDuplicate = current.entries.some(
      (e) => e.name === entry.name && e.value === entry.value && e.achievedAt === entry.achievedAt,
    );
    next = isDuplicate ? current : { value: current.value, entries: [...current.entries, entry] };
  } else if (isBetter(entry.value, current.value, direction)) {
    next = { value: entry.value, entries: [entry] };
  } else {
    next = current;
  }

  if (next !== current) saveJSON(["highscore", gameId, board], next);
  return next;
}

// ------------------------------------------------------- Spiele ein-/ausblenden
//
// Liste der im Hauptmenue AUSGEBLENDETEN Spiel-IDs (nicht der eingeblendeten)
// -- so bleiben neu hinzugefuegte Spiele automatisch sichtbar, ohne die
// gespeicherte Liste migrieren zu muessen.

const DISABLED_GAMES_KEY = ["settings", "disabledGameIds"];

export function getDisabledGameIds(): string[] {
  return loadJSON<string[]>(DISABLED_GAMES_KEY, []);
}

export function isGameEnabled(gameId: string): boolean {
  return !getDisabledGameIds().includes(gameId);
}

export function setGameEnabled(gameId: string, enabled: boolean): void {
  const current = getDisabledGameIds();
  const next = enabled ? current.filter((id) => id !== gameId) : current.includes(gameId) ? current : [...current, gameId];
  saveJSON(DISABLED_GAMES_KEY, next);
  // Admin-geschuetzt server-seitig (siehe core/sync.ts) -- ohne aktive
  // Admin-Session bzw. ohne Server bleibt der Aufruf wirkungslos.
  pushSettings(next);
}

/** Ueberschreibt die lokale Liste ausgeblendeter Spiele 1:1 mit einem vom Server abgeglichenen Stand, OHNE das erneut zurueckzuschicken (siehe core/sync.ts, pullSettingsFromServer). */
export function applyDisabledGameIds(disabledGameIds: string[]): void {
  saveJSON(DISABLED_GAMES_KEY, disabledGameIds);
}
