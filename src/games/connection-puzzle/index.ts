import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { getAllStations, transitLines, type TransitLine } from "../../data/berlinNetwork";
import { getHighscore, isNewHighscore, setHighscore, type HighscoreEntry } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { registerGame } from "../registry";
import { costOf, linesAt, pickRandomPair, type RouteResult, type RouteSegment } from "./graph";
import { renderHud, renderSheet, type SheetState } from "./ui";

const GAME_ID = "connection-puzzle";
const TOTAL_ROUNDS = 5;
const TOTAL_ATTEMPTS = 3;
const POINTS_BY_ATTEMPT = [100, 60, 30];

interface RoundState {
  start: string;
  target: string;
  optimal: RouteResult;
  attempt: number;
  currentStation: string;
  segments: RouteSegment[];
}

type Phase = SheetState["phase"];

function lineById(id: string): TransitLine {
  const line = transitLines.find((l) => l.id === id);
  if (!line) throw new Error(`Unbekannte Linie: ${id}`);
  return line;
}

function createConnectionPuzzleGame(): MinigameModule {
  let allStations: string[] = [];
  let highscore: HighscoreEntry | null = null;

  let round = 1;
  let totalScore = 0;
  let phase: Phase = "choosing-line";
  let roundState: RoundState | null = null;
  let activeLineId: string | null = null;
  let feedback: SheetState["feedback"] = undefined;
  let summary: SheetState["summary"] = undefined;

  let time = 0;
  let closeHighscoreModal: (() => void) | null = null;

  let topBar: HTMLDivElement;
  let sheet: HTMLDivElement;

  function startNewRound(): RoundState {
    const { start, end, optimal } = pickRandomPair(allStations);
    return { start, target: end, optimal, attempt: 1, currentStation: start, segments: [] };
  }

  function resetGame(): void {
    round = 1;
    totalScore = 0;
    roundState = startNewRound();
    activeLineId = null;
    feedback = undefined;
    summary = undefined;
    phase = "choosing-line";
  }

  function render(): void {
    if (!roundState) return;

    renderHud(topBar, {
      round,
      totalRounds: TOTAL_ROUNDS,
      attempt: roundState.attempt,
      totalAttempts: TOTAL_ATTEMPTS,
      start: roundState.start,
      target: roundState.target,
      highscore,
    });

    const base: SheetState = {
      phase,
      segments: roundState.segments,
      currentStation: roundState.currentStation,
      target: roundState.target,
    };

    if (phase === "choosing-line") {
      base.availableLines = linesAt(roundState.currentStation)
        .map(lineById)
        .sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true }));
    } else if (phase === "choosing-station") {
      base.activeLine = lineById(activeLineId!);
    } else if (phase === "round-feedback") {
      base.feedback = feedback;
    } else if (phase === "game-summary") {
      base.summary = summary;
    }

    renderSheet(sheet, base, {
      onSelectLine: handleSelectLine,
      onSelectStation: handleSelectStation,
      onCancelLineChoice: () => {
        activeLineId = null;
        phase = "choosing-line";
        render();
      },
      onReset: () => {
        if (!roundState) return;
        roundState.segments = [];
        roundState.currentStation = roundState.start;
        activeLineId = null;
        phase = "choosing-line";
        render();
      },
      onContinue: handleContinue,
      onPlayAgain: () => {
        resetGame();
        render();
      },
    });
  }

  function handleSelectLine(lineId: string): void {
    activeLineId = lineId;
    phase = "choosing-station";
    render();
  }

  function handleSelectStation(station: string): void {
    if (!roundState || !activeLineId) return;
    const line = lineById(activeLineId);
    const from = roundState.currentStation;
    const idxFrom = line.stations.indexOf(from);
    const idxTo = line.stations.indexOf(station);
    const stops = Math.abs(idxTo - idxFrom);

    roundState.segments.push({ lineId: line.id, from, to: station, stops });
    roundState.currentStation = station;
    activeLineId = null;

    if (station === roundState.target) {
      finalizeRound();
    } else {
      phase = "choosing-line";
      render();
    }
  }

  function finalizeRound(): void {
    if (!roundState) return;
    const playerCost = costOf(roundState.segments);
    const optimalCost = roundState.optimal.cost;
    const transfers = Math.max(0, roundState.segments.length - 1);

    if (playerCost <= optimalCost) {
      const gained = POINTS_BY_ATTEMPT[roundState.attempt - 1] ?? 0;
      totalScore += gained;
      feedback = {
        success: true,
        message: `Perfekt! Das ist die schnellste Verbindung (${roundState.segments.reduce((s, seg) => s + seg.stops, 0)} Stationen, ${transfers} Umstiege).`,
        scoreGained: gained,
        roundOver: true,
      };
    } else if (roundState.attempt < TOTAL_ATTEMPTS) {
      feedback = {
        success: false,
        message: `Das funktioniert, ist aber nicht die schnellste Verbindung. Deine Route braucht mehr Zeit als die beste Verbindung. Versuch's noch einmal!`,
        scoreGained: 0,
        roundOver: false,
      };
    } else {
      feedback = {
        success: false,
        message: `Leider auch im dritten Versuch nicht die schnellste Verbindung gefunden.`,
        scoreGained: 0,
        revealed: roundState.optimal,
        roundOver: true,
      };
    }

    phase = "round-feedback";
    render();
  }

  function handleContinue(): void {
    if (!roundState || !feedback) return;

    if (!feedback.roundOver) {
      roundState.attempt += 1;
      roundState.segments = [];
      roundState.currentStation = roundState.start;
      phase = "choosing-line";
      render();
      return;
    }

    if (round >= TOTAL_ROUNDS) {
      const newRecord = isNewHighscore(GAME_ID, totalScore, "higher-better");
      summary = { totalScore, isNewHighscore: newRecord };
      phase = "game-summary";
      render();
      if (newRecord) {
        closeHighscoreModal = promptHighscoreName({
          message: `Du hast ${totalScore} Punkte erreicht — neuer Bestwert für die Verbindungssuche!`,
          onDone: (name) => {
            closeHighscoreModal = null;
            highscore = setHighscore(GAME_ID, name, totalScore);
            render();
          },
        });
      }
    } else {
      round += 1;
      roundState = startNewRound();
      activeLineId = null;
      feedback = undefined;
      phase = "choosing-line";
      render();
    }
  }

  function drawSchematic(env: GameEnv): void {
    const { ctx, size } = env;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, size.width, size.height);

    if (!roundState) return;

    const nodes = [roundState.start, ...roundState.segments.map((s) => s.to)];
    const y = Math.max(150, size.height * 0.3);
    const marginX = 44;
    const usableWidth = Math.max(40, size.width - marginX * 2);
    const n = nodes.length;
    const step = n > 1 ? usableWidth / Math.max(1, n - 1) : 0;

    for (let i = 0; i < roundState.segments.length; i++) {
      const x1 = marginX + step * i;
      const x2 = marginX + step * (i + 1);
      ctx.strokeStyle = lineById(roundState.segments[i].lineId).color;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    }

    for (let i = 0; i < n; i++) {
      const x = n > 1 ? marginX + step * i : size.width / 2;
      const isEnd = i === n - 1;
      ctx.beginPath();
      ctx.fillStyle = i === 0 ? theme.accent : isEnd ? theme.primaryLight : theme.text;
      ctx.arc(x, y, isEnd ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pulsierender Marker an der aktuellen Position -- einzige "echte" Animation
    // dieses Spiels, laeuft ueber die gemeinsame rAF-Loop (update(dt)).
    const curX = n > 1 ? marginX + step * (n - 1) : size.width / 2;
    const pulse = 11 + Math.sin(time * 3.2) * 3.5;
    ctx.beginPath();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.arc(curX, y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ziel-Stern, falls noch nicht erreicht
    if (roundState.currentStation !== roundState.target) {
      ctx.font = "600 13px 'Barlow', sans-serif";
      ctx.fillStyle = theme.textMuted;
      ctx.textAlign = "center";
      ctx.fillText(`Ziel: ${roundState.target}`, size.width / 2, y + 34);
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      allStations = getAllStations();
      highscore = getHighscore(GAME_ID);

      topBar = document.createElement("div");
      topBar.className = "stage-top-bar";
      topBar.style.gap = "8px";
      env.overlay.appendChild(topBar);

      sheet = document.createElement("div");
      sheet.className = "stage-sheet";
      env.overlay.appendChild(sheet);

      resetGame();
      render();
    },

    update(dt: number) {
      time += dt;
    },

    render(env: GameEnv) {
      drawSchematic(env);
    },

    cleanup() {
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      topBar?.remove();
      sheet?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Verbindungssuche",
  subtitle: "Finde die schnellste Route",
  icon: "route",
  accent: "#0f7a86",
  create: createConnectionPuzzleGame,
});
