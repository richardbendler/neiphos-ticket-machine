import { loadJSON, saveJSON } from "./storage";
import type { HighscoreDirection, HighscoreOutcome } from "./storage";

/**
 * Ticket-Verdienstwege (Admin-Panel, Abschnitt "Ticket-Verdienstwege") --
 * unabhaengig voneinander per Checkbox an-/ausschaltbar (nicht "entweder
 * oder"), auf ausdruecklichen Wunsch: mit steigendem Highscore-Niveau im
 * Festivalverlauf wird der reine Highscore-Weg immer seltener erreichbar,
 * die beiden Zusatzwege gleichen das aus.
 *
 * - highscore: der bisherige, einzige Weg -- neuer/eingestellter Bestwert.
 * - milestone: fester, admin-editierbarer Schwellwert JE SPIEL (nicht je
 *   Spielvariante/Feldgroesse -- bewusst vereinfacht: derselbe Wert gilt
 *   unabhaengig von einer evtl. gewaehlten Schwierigkeitsstufe), bleibt ueber
 *   die ganze Festivaldauer gleich schwer.
 * - dailyBoard: Tagesbestwert JE SPIEL+BOARD (Feldgroesse/Level zaehlen hier
 *   schon eigenstaendig, da sonst z. B. Memory auf leicht vs. schwer nicht
 *   fair vergleichbar waeren), setzt sich taeglich um 6 Uhr zurueck.
 */
export interface TicketMethodSettings {
  highscore: boolean;
  milestone: boolean;
  dailyBoard: boolean;
}

const METHODS_KEY = ["settings", "ticketMethods"];
// highscore=true erhaelt das bisherige Verhalten (jeder Highscore konnte
// schon vorher als Ticket gedruckt werden) unveraendert als Standard bei,
// die beiden neuen Wege starten bewusst deaktiviert, bis die Orga sie
// gezielt aktiviert.
const DEFAULT_METHODS: TicketMethodSettings = { highscore: true, milestone: false, dailyBoard: false };

export function getTicketMethods(): TicketMethodSettings {
  return { ...DEFAULT_METHODS, ...loadJSON<Partial<TicketMethodSettings>>(METHODS_KEY, {}) };
}

export function setTicketMethod(method: keyof TicketMethodSettings, enabled: boolean): void {
  saveJSON(METHODS_KEY, { ...getTicketMethods(), [method]: enabled });
}

// ------------------------------------------------------- Ticketdruck an/aus
//
// Globaler Not-Aus fuer den kompletten Ticketdruck (Admin-Panel, direkt
// neben dem Testdruck-Button) -- auf ausdruecklichen Wunsch, z. B. falls der
// Bondrucker/das Papier fuer laengere Zeit ausfaellt oder das Festival ganz
// ohne Ticket-Bar-Aktion laufen soll. Bewusst EIGENSTAENDIG von
// TicketMethodSettings oben (die regeln nur, WELCHES Ereignis ueberhaupt als
// Ticket-wuerdig gilt) -- dieser Schalter wirkt UNABHAENGIG davon: ist er
// aus, gibt es im Highscore-Dialog (core/highscorePrompt.ts) nur noch den
// normalen "Speichern"-Button, ganz ohne Ticket-Option, egal welcher
// Verdienstweg sonst aktiv waere. Der Admin-Testdruck bleibt davon bewusst
// unberuehrt (siehe admin/AdminPanel.ts) -- der soll auch bei global
// abgeschaltetem Besucher-Ticketdruck weiterhin fuers Pruefen der
// Drucker-Hardware nutzbar sein.
const PRINTING_ENABLED_KEY = ["settings", "ticketPrintingEnabled"];

export function isPrintingEnabled(): boolean {
  return loadJSON<boolean>(PRINTING_ENABLED_KEY, true);
}

export function setPrintingEnabled(enabled: boolean): void {
  saveJSON(PRINTING_ENABLED_KEY, enabled);
}

// --------------------------------------------------------------- Meilensteine

/** Je Spiel mit Geschwindigkeits-/Schwierigkeitsstufen (siehe MilestoneGameDef.levels) -- key/label identisch zu den SPEED_LEVELS der jeweiligen Spiele (games/train-photo, games/count-passengers), hier absichtlich dupliziert statt importiert, um keinen Import von core/ auf games/ einzugehen. */
export interface MilestoneLevelDef {
  key: string;
  label: string;
}

const TEN_STAGE_LEVELS: MilestoneLevelDef[] = Array.from({ length: 10 }, (_, i) => ({ key: String(i + 1), label: `Stufe ${i + 1}` }));

/** Anzeige-Infos je Spiel fuers Meilenstein-Untermenue (admin/AdminPanel.ts) -- Titel/Richtung/Einheit, damit die Zahl dort sinnvoll beschriftet werden kann. levels (optional): Spiele mit mehreren Schwierigkeitsstufen bekommen je Stufe einen EIGENEN Schwellwert statt eines einzigen fuer das ganze Spiel (siehe getMilestones/setMilestone). */
export interface MilestoneGameDef {
  gameId: string;
  title: string;
  direction: HighscoreDirection;
  unit: string;
  levels?: MilestoneLevelDef[];
}

export const MILESTONE_GAMES: MilestoneGameDef[] = [
  { gameId: "connection-puzzle", title: "Verbindungssuche", direction: "higher-better", unit: "Punkte" },
  { gameId: "switch-run", title: "Weichenspiel", direction: "higher-better", unit: "Weichen" },
  { gameId: "train-spotter", title: "Zug-Spotter", direction: "lower-better", unit: "Sekunden" },
  { gameId: "memory", title: "Zug-Memory", direction: "lower-better", unit: "Züge" },
  { gameId: "hopper-slots", title: "Hüpftier-Glück", direction: "higher-better", unit: "Punkte" },
  { gameId: "train-photo", title: "Zugfoto", direction: "higher-better", unit: "Punkte", levels: TEN_STAGE_LEVELS },
  { gameId: "train-sim", title: "Zugsimulator", direction: "lower-better", unit: "Züge" },
  { gameId: "count-passengers", title: "Passagiere zählen", direction: "lower-better", unit: "Differenz", levels: TEN_STAGE_LEVELS },
  { gameId: "mini-metro", title: "Hüpftier-Metro", direction: "higher-better", unit: "Passagiere" },
  { gameId: "train-quartet", title: "Zug-Quartett", direction: "higher-better", unit: "Karten" },
];

function milestoneStorageKey(gameId: string, board?: string | null): string {
  const def = MILESTONE_GAMES.find((g) => g.gameId === gameId);
  return def?.levels && board ? `${gameId}:${board}` : gameId;
}

// Startwerte, gedacht als echte, aber schaffbare Herausforderung -- deutlich
// unter dem jeweiligen theoretischen Maximum, aber ueber dem, was rein durch
// Glueck/eine einzelne schwache Runde erreicht wird. Ueber das Untermenue im
// Admin-Panel jederzeit anpassbar.
//
// train-photo/count-passengers haben STATT eines einzelnen Werts einen
// eigenen Schwellwert JE STUFE (Key "gameId:stufe") -- auf ausdruecklichen
// Wunsch, da beide Spiele ueber zehn spuerbar unterschiedlich schwere
// Geschwindigkeitsstufen haben. Die Progression ist bewusst so gestaffelt,
// dass die SCHWERSTE Stufe den NACHSICHTIGSTEN Schwellwert bekommt (leichter
// erreichbar), die leichteste den strengsten -- sonst waere ein Ticket bei
// hoher Geschwindigkeit praktisch unerreichbar.
const TRAIN_PHOTO_LEVEL_MILESTONES = [85, 80, 75, 70, 65, 60, 55, 50, 45, 40];
const COUNT_PASSENGERS_LEVEL_MILESTONES = [1, 1, 2, 2, 3, 3, 4, 5, 5, 6];

const DEFAULT_MILESTONES: Record<string, number> = {
  "connection-puzzle": 240,
  "switch-run": 5,
  "train-spotter": 3,
  memory: 20,
  "hopper-slots": 25,
  "train-sim": 5,
  "mini-metro": 70,
  "train-quartet": 15,
  ...Object.fromEntries(TRAIN_PHOTO_LEVEL_MILESTONES.map((v, i) => [`train-photo:${i + 1}`, v])),
  ...Object.fromEntries(COUNT_PASSENGERS_LEVEL_MILESTONES.map((v, i) => [`count-passengers:${i + 1}`, v])),
};

const MILESTONES_KEY = ["settings", "ticketMilestones"];

export function getMilestones(): Record<string, number> {
  return { ...DEFAULT_MILESTONES, ...loadJSON<Record<string, number>>(MILESTONES_KEY, {}) };
}

/** board nur bei Spielen mit levels relevant (siehe MilestoneGameDef) -- fuer alle anderen Spiele wird er ignoriert, der Schwellwert bleibt spielweit einheitlich. */
export function setMilestone(gameId: string, value: number, board?: string | null): void {
  const current = loadJSON<Record<string, number>>(MILESTONES_KEY, {});
  saveJSON(MILESTONES_KEY, { ...current, [milestoneStorageKey(gameId, board)]: value });
}

function isMilestoneReached(gameId: string, value: number, direction: HighscoreDirection, board?: string | null): boolean {
  const threshold = getMilestones()[milestoneStorageKey(gameId, board)];
  if (threshold === undefined) return false;
  return direction === "higher-better" ? value >= threshold : value <= threshold;
}

// --------------------------------------------------------------- Tagesbestwert
//
// "Tag" laeuft hier bewusst NICHT um Mitternacht um, sondern erst um 6 Uhr
// morgens -- ein Festivaltag endet uebernachts realistisch erst dann (siehe
// Nutzerwunsch), sonst wuerde ein und dieselbe durchgefeierte Nacht in zwei
// verschiedene "Tage" zerrissen.
const DAILY_RESET_HOUR = 6;

function dailyDateKey(date: Date): string {
  const shifted = new Date(date);
  if (shifted.getHours() < DAILY_RESET_HOUR) shifted.setDate(shifted.getDate() - 1);
  return shifted.toISOString().slice(0, 10);
}

export interface DailyBestEntry {
  name: string;
  value: number;
}

interface DailyBestRecord {
  day: string;
  value: number;
  entries: DailyBestEntry[];
}

function dailyBestKey(gameId: string, board: string): string[] {
  return ["ticketDailyBest", gameId, board];
}

/**
 * Nur PRUEFEN, ob ein Versuch (mit-)Tagesbestwert waere -- OHNE Nebeneffekt,
 * da an dieser Stelle (Rundenende) der Name noch nicht bekannt ist (der
 * Highscore-Dialog fragt erst danach, siehe core/highscorePrompt.ts). Analog
 * zu getHighscoreOutcome() fuer das reguläre Highscore-Brett. Das
 * tatsaechliche Eintragen (mit Namen) passiert erst in recordDailyBest(),
 * aufgerufen aus dem onDone() jedes Spiels -- genau wie recordHighscore().
 */
export function getDailyBestOutcome(gameId: string, board: string, value: number, direction: HighscoreDirection): HighscoreOutcome {
  const current = loadJSON<DailyBestRecord | null>(dailyBestKey(gameId, board), null);
  const today = dailyDateKey(new Date());
  if (!current || current.day !== today) return "new-best";
  if (value === current.value) return "tied-best";
  const better = direction === "higher-better" ? value > current.value : value < current.value;
  return better ? "new-best" : "none";
}

/**
 * Traegt einen Versuch MIT NAMEN in den Tagesbestwert ein -- analog zu
 * recordHighscore() fuers reguläre Highscore-Brett, inkl. Mitnahme aller
 * Namen bei Gleichstand. Setzt sich beim ersten Aufruf nach 6 Uhr des neuen
 * Tages automatisch zurueck (siehe DAILY_RESET_HOUR).
 */
export function recordDailyBest(gameId: string, board: string, name: string, value: number, direction: HighscoreDirection): void {
  const key = dailyBestKey(gameId, board);
  const today = dailyDateKey(new Date());
  const current = loadJSON<DailyBestRecord | null>(key, null);
  const entry: DailyBestEntry = { name: name.trim().slice(0, 16) || "Anonym", value };
  if (!current || current.day !== today) {
    saveJSON(key, { day: today, value, entries: [entry] } satisfies DailyBestRecord);
    return;
  }
  if (value === current.value) {
    saveJSON(key, { day: today, value, entries: [...current.entries, entry] } satisfies DailyBestRecord);
    return;
  }
  const better = direction === "higher-better" ? value > current.value : value < current.value;
  if (better) {
    saveJSON(key, { day: today, value, entries: [entry] } satisfies DailyBestRecord);
  }
}

/** Fuer die Tagesbestenliste-Ansicht (siehe menu/HighscoreBoard.ts) -- null, wenn heute (seit 6 Uhr) noch niemand gespielt hat. */
export function getDailyBestBoard(gameId: string, board: string): { value: number; entries: DailyBestEntry[] } | null {
  const current = loadJSON<DailyBestRecord | null>(dailyBestKey(gameId, board), null);
  if (!current || current.day !== dailyDateKey(new Date())) return null;
  return { value: current.value, entries: current.entries };
}

/**
 * Bequemlichkeits-Wrapper fuer den onDone()-Callback jedes Spiels (siehe
 * core/highscorePrompt.ts) -- unconditional aufrufbar direkt neben
 * recordHighscore(), prueft den "Tagesbestenliste"-Schalter selbst und ist
 * ein No-op, wenn der Weg deaktiviert ist oder der Versuch gar nicht
 * (mit-)Tagesbestwert ist.
 */
export function recordDailyBestIfApplicable(gameId: string, board: string | undefined, name: string, value: number, direction: HighscoreDirection): void {
  if (!getTicketMethods().dailyBoard) return;
  const boardKey = board ?? "default";
  if (getDailyBestOutcome(gameId, boardKey, value, direction) === "none") return;
  recordDailyBest(gameId, boardKey, name, value, direction);
}

export interface TicketEligibilityResult {
  viaHighscore: boolean;
  viaMilestone: boolean;
  viaDailyBoard: boolean;
}

/**
 * Kombinierte Pruefung aller aktivierten Ticket-Verdienstwege fuer eine
 * gerade abgeschlossene Runde -- an genau der Stelle aufzurufen, an der ein
 * Spiel bisher nur getHighscoreOutcome() geprueft hat (siehe core/
 * highscorePrompt.ts fuer die Anzeige). Hat einen Nebeneffekt (aktualisiert
 * ggf. den Tagesbestwert), daher bewusst nur EINMAL je Rundenende aufrufen.
 */
export function checkTicketEligibility(opts: {
  gameId: string;
  board?: string;
  value: number;
  direction: HighscoreDirection;
  highscoreOutcome: HighscoreOutcome;
}): TicketEligibilityResult {
  const methods = getTicketMethods();
  const board = opts.board ?? "default";
  return {
    viaHighscore: methods.highscore && opts.highscoreOutcome !== "none",
    viaMilestone: methods.milestone && isMilestoneReached(opts.gameId, opts.value, opts.direction, opts.board),
    viaDailyBoard: methods.dailyBoard && getDailyBestOutcome(opts.gameId, board, opts.value, opts.direction) !== "none",
  };
}

export function isTicketEligible(result: TicketEligibilityResult): boolean {
  return result.viaHighscore || result.viaMilestone || result.viaDailyBoard;
}

export type TicketReasonKind = "highscore" | "dailyBoard" | "milestone" | null;

/**
 * Rangfolge, wenn mehrere Wege gleichzeitig zutreffen (auf ausdruecklichen
 * Wunsch): Highscore vor Tagesbestwert vor Meilenstein -- z. B. wenn sowohl
 * "Highscore" als auch "Tagesbestwert" aktiviert sind UND beide zutreffen,
 * zaehlt/druckt sich das Ticket als Highscore. Bestimmt sowohl die Nachricht
 * im Dialog (describeTicketReason) als auch, welches der vier Ticket-Bilder
 * gedruckt wird (siehe core/ticket.ts#TicketVariant).
 */
export function primaryTicketReason(result: TicketEligibilityResult): TicketReasonKind {
  if (result.viaHighscore) return "highscore";
  if (result.viaDailyBoard) return "dailyBoard";
  if (result.viaMilestone) return "milestone";
  return null;
}

/**
 * Titel/Nachricht fuer promptHighscoreName() aus dem Eligibility-Ergebnis --
 * fuer den regulaeren Highscore-Fall bleibt die vom jeweiligen Spiel selbst
 * gebaute (individuellere) Nachricht unveraendert erhalten, Tagesbestwert/
 * Meilenstein bekommen dagegen eine einheitliche, generische Nachricht aus
 * Spielname + formatiertem Punktestand (beides ohnehin fuer den Ticket-
 * Druck vorhanden), um nicht in jedem der zehn Spiele eigene Formulierungen
 * fuer alle drei Faelle pflegen zu muessen.
 */
export function describeTicketReason(result: TicketEligibilityResult, highscoreMessage: string, gameTitle: string, scoreText: string): { title: string; message: string } {
  const reason = primaryTicketReason(result);
  if (reason === "highscore") return { title: "Neuer Highscore!", message: highscoreMessage };
  if (reason === "dailyBoard") return { title: "Tagesbestwert!", message: `${scoreText} bei ${gameTitle} — heutiger Tagesbestwert!` };
  if (reason === "milestone") return { title: "Meilenstein erreicht!", message: `${scoreText} bei ${gameTitle} — das ist ein Meilenstein!` };
  return { title: "Highscore!", message: highscoreMessage };
}
