/**
 * Duenner Wrapper um localStorage: alle Keys sind unter "ntm:" (Neiphos
 * Ticket Machine) genamespaced, JSON (de)serialisierung inklusive.
 * localStorage ist geraetegebunden -- genau das will der Kiosk (Highscores
 * und Statistik ueberleben Neuladen/Neustart des Browsers, aber nichts
 * verlaesst das Geraet, da komplett offline).
 */

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
  return next;
}
