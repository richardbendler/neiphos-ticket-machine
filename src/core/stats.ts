import { loadJSON, saveJSON } from "./storage";

export interface PlaySession {
  gameId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

const STATS_PATH = ["stats", "sessions"];
// Kiosk laeuft evtl. monatelang durch -- Historie deckeln, damit localStorage
// nicht unbegrenzt waechst. 5000 Sessions reichen fuer sehr viele Spieltage.
const MAX_SESSIONS = 5000;

export function recordSession(gameId: string, startedAtMs: number, endedAtMs: number): void {
  const sessions = loadJSON<PlaySession[]>(STATS_PATH, []);
  sessions.push({
    gameId,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, Math.round(endedAtMs - startedAtMs)),
  });
  saveJSON(STATS_PATH, sessions.slice(-MAX_SESSIONS));
}

export function getAllSessions(): PlaySession[] {
  return loadJSON<PlaySession[]>(STATS_PATH, []);
}

export function getSessionsForGame(gameId: string): PlaySession[] {
  return getAllSessions()
    .filter((s) => s.gameId === gameId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface GameSummary {
  gameId: string;
  count: number;
  totalMs: number;
  lastPlayedAt: string | null;
}

export function getSummaryByGame(): GameSummary[] {
  const sessions = getAllSessions();
  const map = new Map<string, GameSummary>();
  for (const s of sessions) {
    const entry = map.get(s.gameId) ?? { gameId: s.gameId, count: 0, totalMs: 0, lastPlayedAt: null };
    entry.count += 1;
    entry.totalMs += s.durationMs;
    if (!entry.lastPlayedAt || s.startedAt > entry.lastPlayedAt) entry.lastPlayedAt = s.startedAt;
    map.set(s.gameId, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function clearAllStats(): void {
  saveJSON(STATS_PATH, []);
}
