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

export type HighscoreDirection = "higher-better" | "lower-better";

export function getHighscore(gameId: string, board = "default"): HighscoreEntry | null {
  return loadJSON<HighscoreEntry | null>(["highscore", gameId, board], null);
}

export function isNewHighscore(
  gameId: string,
  value: number,
  direction: HighscoreDirection,
  board = "default",
): boolean {
  const current = getHighscore(gameId, board);
  if (!current) return true;
  return direction === "higher-better" ? value > current.value : value < current.value;
}

export function setHighscore(
  gameId: string,
  name: string,
  value: number,
  board = "default",
): HighscoreEntry {
  const entry: HighscoreEntry = {
    name: name.trim().slice(0, 16) || "Anonym",
    value,
    achievedAt: new Date().toISOString(),
  };
  saveJSON(["highscore", gameId, board], entry);
  return entry;
}
