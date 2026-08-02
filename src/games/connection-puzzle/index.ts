import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { getAllStations } from "../../data/berlinNetwork";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";
import { pickRandomPair, validateLineSequence, type LineRoute } from "./graph";
import { renderScreen, type Phase, type ScreenState } from "./ui";

const GAME_ID = "connection-puzzle";
const TOTAL_ROUNDS = 5;
const TOTAL_ATTEMPTS = 3;
const POINTS_BY_ATTEMPT = [100, 60, 30];
// Erst das Endergebnis in Ruhe zeigen, das Highscore-Popup kommt bewusst
// erst etwas spaeter -- sonst ueberlagern sich beide sofort.
const HIGHSCORE_POPUP_DELAY_MS = 2000;

function formatPoints(value: number): string {
  return `${value} Punkte`;
}

interface RoundState {
  start: string;
  target: string;
  optimal: LineRoute;
  attempt: number;
}

function createConnectionPuzzleGame(): MinigameModule {
  let allStations: string[] = [];
  let highscoreBanner: HighscoreBannerHandle;

  let round = 1;
  let totalScore = 0;
  let phase: Phase = "building";
  let roundState: RoundState | null = null;
  let selectedLines: string[] = [];
  let error: string | null = null;
  let feedback: ScreenState["feedback"] = undefined;
  let summary: ScreenState["summary"] = undefined;

  let closeHighscoreModal: (() => void) | null = null;
  let closeIntro: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let panel: HTMLDivElement;

  function startNewRound(): RoundState {
    const { start, end, optimal } = pickRandomPair(allStations);
    return { start, target: end, optimal, attempt: 1 };
  }

  function resetGame(): void {
    round = 1;
    totalScore = 0;
    roundState = startNewRound();
    selectedLines = [];
    error = null;
    feedback = undefined;
    summary = undefined;
    phase = "building";
  }

  function render(): void {
    if (!roundState) return;
    const base: ScreenState = {
      phase,
      start: roundState.start,
      target: roundState.target,
      round,
      totalRounds: TOTAL_ROUNDS,
      attempt: roundState.attempt,
      totalAttempts: TOTAL_ATTEMPTS,
      selectedLines,
      error,
      feedback,
      summary,
      // Beim letzten Versuch schon eine Linie verraten, statt die Aufloesung
      // erst nach dem (dann meist erwarteten) Scheitern zu zeigen.
      hint: phase === "building" && roundState.attempt === TOTAL_ATTEMPTS ? roundState.optimal.lineIds[0] : undefined,
    };

    renderScreen(panel, base, {
      onSelectLine: (lineId) => {
        selectedLines.push(lineId);
        error = null;
        render();
      },
      onRemoveLast: () => {
        selectedLines.pop();
        render();
      },
      onReset: () => {
        selectedLines = [];
        error = null;
        render();
      },
      onSubmit: handleSubmit,
      onContinue: handleContinue,
      onPlayAgain: () => {
        resetGame();
        render();
      },
    });
  }

  function handleSubmit(): void {
    if (!roundState) return;
    const result = validateLineSequence(roundState.start, roundState.target, selectedLines);
    if (!result.valid) {
      error = result.reason ?? "Diese Auswahl verbindet Start und Ziel nicht.";
      render();
      return;
    }

    const playerLines = selectedLines.length;
    const optimalLines = roundState.optimal.lineIds.length;

    if (playerLines <= optimalLines) {
      const gained = POINTS_BY_ATTEMPT[roundState.attempt - 1] ?? 0;
      totalScore += gained;
      feedback = {
        success: true,
        message: `Klasse! Das ist eine der direktesten Verbindungen (${playerLines} Linie${playerLines === 1 ? "" : "n"}).`,
        scoreGained: gained,
        roundOver: true,
      };
    } else if (roundState.attempt < TOTAL_ATTEMPTS) {
      feedback = {
        success: false,
        message: `Diese Verbindung funktioniert, es geht aber mit weniger Umstiegen. Versuch's noch einmal!`,
        scoreGained: 0,
        roundOver: false,
      };
    } else {
      feedback = {
        success: false,
        message: `Auch im dritten Versuch nicht die direkteste Verbindung gefunden.`,
        scoreGained: 0,
        revealed: roundState.optimal,
        roundOver: true,
      };
    }

    phase = "feedback";
    render();
  }

  function handleContinue(): void {
    if (!roundState || !feedback) return;

    if (!feedback.roundOver) {
      roundState.attempt += 1;
      selectedLines = [];
      error = null;
      phase = "building";
      render();
      return;
    }

    if (round >= TOTAL_ROUNDS) {
      const outcome = getHighscoreOutcome(GAME_ID, totalScore, "higher-better");
      summary = { totalScore, isNewHighscore: outcome !== "none" };
      phase = "summary";
      render();
      if (outcome !== "none") {
        highscoreTimer = setTimeout(() => {
          highscoreTimer = null;
          closeHighscoreModal = promptHighscoreName({
            message: `Du hast ${totalScore} Punkte erreicht — ${outcome === "tied-best" ? "eingestellter Bestwert" : "neuer Bestwert"} für die Verbindungssuche!`,
            onDone: (name) => {
              closeHighscoreModal = null;
              highscoreBanner.update(recordHighscore(GAME_ID, name, totalScore, "higher-better"));
              render();
            },
          });
        }, HIGHSCORE_POPUP_DELAY_MS);
      }
    } else {
      round += 1;
      roundState = startNewRound();
      selectedLines = [];
      error = null;
      feedback = undefined;
      phase = "building";
      render();
    }
  }

  function drawSchematic(env: GameEnv): void {
    const { ctx, size } = env;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, size.width, size.height);
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      allStations = getAllStations();

      panel = document.createElement("div");
      panel.className = "stage-center-panel";
      panel.style.top = "calc(var(--header-h) + 54px + var(--safe-top))";
      panel.style.justifyContent = "flex-start";
      env.overlay.appendChild(panel);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatPoints);
      highscoreBanner.update(getHighscoreBoard(GAME_ID));

      resetGame();
      render();

      closeIntro = showGameIntro({
        title: "Verbindungssuche",
        description:
          "Oben stehen Start und Ziel. Tippe unten alle Linien in der richtigen Reihenfolge an, mit denen du (halbwegs direkt) von Start nach Ziel kommst — es zählt nur die Reihenfolge der Linien, keine einzelnen Stationen. Aufeinanderfolgende Linien müssen sich irgendwo begegnen, um umsteigen zu können.",
        onStart: () => {
          closeIntro = null;
        },
      });
    },

    update() {
      // Keine laufzeitabhaengige Logik -- reine Eingabesteuerung ueber Taps.
    },

    render(env: GameEnv) {
      drawSchematic(env);
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      closeIntro?.();
      closeIntro = null;
      highscoreBanner?.destroy();
      panel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  // Weiches Trennzeichen (U+00AD) an der Wortfuge -- ohne das bricht der
  // Browser das lange, zusammengesetzte Wort in der schmalen Menu-Kachel
  // an einer zufaelligen Stelle statt an der Silbengrenze um.
  title: "Verbindungs­suche",
  subtitle: "Finde die schnellste Route",
  icon: "route",
  badge: "VS",
  accent: "#0f7a86",
  create: createConnectionPuzzleGame,
  highscoreCategories: [{ board: "default", label: "Bestwert", direction: "higher-better", formatValue: formatPoints }],
});
