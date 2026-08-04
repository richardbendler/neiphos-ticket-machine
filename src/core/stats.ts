import { loadJSON, saveJSON } from "./storage";
import { pushStatsSession } from "./sync";

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
  const session: PlaySession = {
    gameId,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    durationMs: Math.max(0, Math.round(endedAtMs - startedAtMs)),
  };
  sessions.push(session);
  saveJSON(STATS_PATH, sessions.slice(-MAX_SESSIONS));
  // Fire-and-forget: bleibt bei fehlendem/deaktiviertem Server lautlos
  // wirkungslos, siehe core/sync.ts. Bewusst NICHT zusaetzlich in
  // localStorage anderer Geraete gemergt (anders als bei Highscores) -- die
  // Statistik ist reine Admin-Ansicht, siehe pullStatsFromServer/
  // admin/AdminPanel.ts, die den Server-Stand nur fuer die aktuelle Ansicht
  // dazuholt, statt jedes Besucher-Geraet mit fremden Sessions vollzustopfen.
  pushStatsSession(session);
}

export function getAllSessions(): PlaySession[] {
  return loadJSON<PlaySession[]>(STATS_PATH, []);
}

export function getSessionsForGame(gameId: string): PlaySession[] {
  return filterSessionsForGame(getAllSessions(), gameId);
}

/** Reine Filter-/Sortierfunktion, wiederverwendbar auch auf einem lokal+Server gemergten Session-Array (siehe admin/AdminPanel.ts). */
export function filterSessionsForGame(sessions: PlaySession[], gameId: string): PlaySession[] {
  return sessions.filter((s) => s.gameId === gameId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface GameSummary {
  gameId: string;
  count: number;
  totalMs: number;
  lastPlayedAt: string | null;
}

/** Reine Zusammenfassungsfunktion, wiederverwendbar auch auf einem lokal+Server gemergten Session-Array (siehe admin/AdminPanel.ts). */
export function summarizeSessions(sessions: PlaySession[]): GameSummary[] {
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

export function getSummaryByGame(): GameSummary[] {
  return summarizeSessions(getAllSessions());
}

export function clearAllStats(): void {
  saveJSON(STATS_PATH, []);
}
