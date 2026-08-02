import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import { distractorImages } from "../../data/distractors";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { showGameIntro } from "../../core/gameIntro";
import { fitSquareToContainer } from "../../core/squareFit";
import { registerGame } from "../registry";

const GAME_ID = "train-spotter";
const HIGHSCORE_POPUP_DELAY_MS = 2000;
const GRID_SIZE = 4;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const MIN_TRAINS = 6;
const MAX_TRAINS = 9;
const WRONG_TAP_PENALTY = 1.5;

interface Cell {
  image: string;
  isTrain: boolean;
  found: boolean;
}

type Phase = "intro" | "playing" | "done";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildGrid(): Cell[] {
  const trainCount = MIN_TRAINS + Math.floor(Math.random() * (MAX_TRAINS - MIN_TRAINS + 1));
  const trainImages = shuffle(trainCards.map((c) => c.image)).slice(0, trainCount);
  const distractorCount = CELL_COUNT - trainCount;
  const distractors: string[] = [];
  for (let i = 0; i < distractorCount; i++) {
    distractors.push(distractorImages[Math.floor(Math.random() * distractorImages.length)]);
  }
  const cells: Cell[] = [
    ...trainImages.map((image) => ({ image, isTrain: true, found: false })),
    ...distractors.map((image) => ({ image, isTrain: false, found: false })),
  ];
  return shuffle(cells);
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

function createTrainSpotterGame(): MinigameModule {
  let phase: Phase = "intro";
  let elapsed = 0;
  let cells: Cell[] = [];
  let remainingTrains = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let closeIntro: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let gridHost: HTMLDivElement;
  let doneOverlay: HTMLDivElement;
  let cellButtons: HTMLButtonElement[] = [];
  let stopSquareFit: (() => void) | null = null;

  function renderGrid(): void {
    gridHost.innerHTML = "";
    gridHost.style.setProperty("--cols", String(GRID_SIZE));
    cellButtons = cells.map((cell, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile-grid__cell";
      const img = document.createElement("img");
      img.src = cell.image;
      img.draggable = false;
      btn.appendChild(img);
      btn.addEventListener("click", () => handleTap(i));
      gridHost.appendChild(btn);
      return btn;
    });
  }

  function handleTap(index: number): void {
    if (phase !== "playing") return;
    const cell = cells[index];
    if (cell.found) return;

    if (cell.isTrain) {
      cell.found = true;
      cellButtons[index].classList.add("tile-grid__cell--found");
      remainingTrains -= 1;
      if (remainingTrains === 0) finish();
    } else {
      elapsed += WRONG_TAP_PENALTY;
      cellButtons[index].classList.add("tile-grid__cell--wrong");
      setTimeout(() => cellButtons[index]?.classList.remove("tile-grid__cell--wrong"), 350);
    }
  }

  function finish(): void {
    phase = "done";
    const outcome = getHighscoreOutcome(GAME_ID, elapsed, "lower-better");
    renderDone();
    if (outcome !== "none") {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatTime(elapsed)} — ${outcome === "tied-best" ? "eingestellte Bestzeit" : "neue Bestzeit"} für den Zug-Spotter!`,
          onDone: (name) => {
            closeHighscoreModal = null;
            highscoreBanner.update(recordHighscore(GAME_ID, name, elapsed, "lower-better"));
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  function renderDone(): void {
    doneOverlay.style.display = "flex";
    doneOverlay.innerHTML = "";
    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.4rem";
    title.style.color = theme.accent;
    title.textContent = formatTime(elapsed);
    const sub = document.createElement("div");
    sub.style.color = "var(--text-muted)";
    sub.style.margin = "4px 0 14px";
    sub.textContent = "Alle Züge gefunden!";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", restart);
    doneOverlay.append(title, sub, again);
  }

  function restart(): void {
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    cells = buildGrid();
    remainingTrains = cells.filter((c) => c.isTrain).length;
    elapsed = 0;
    phase = "intro";
    doneOverlay.style.display = "none";
    renderGrid();
    gridHost.style.visibility = "hidden";

    closeIntro = showGameIntro({
      title: "Zug-Spotter",
      description: "Tippe im Raster so schnell wie möglich alle Bilder mit Zügen an. Falsche Tipps kosten Zeit.",
      startLabel: "Los geht's",
      onStart: () => {
        closeIntro = null;
        phase = "playing";
        gridHost.style.visibility = "visible";
      },
    });
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      gridHost = document.createElement("div");
      gridHost.className = "tile-grid";

      doneOverlay = document.createElement("div");
      doneOverlay.style.display = "none";
      doneOverlay.style.flexDirection = "column";
      doneOverlay.style.alignItems = "center";
      doneOverlay.style.textAlign = "center";
      doneOverlay.style.marginTop = "10px";

      const wrap = document.createElement("div");
      wrap.className = "stage-center-panel";
      wrap.style.top = "calc(var(--header-h) + 96px + var(--safe-top))";
      wrap.appendChild(gridHost);
      wrap.appendChild(doneOverlay);
      env.overlay.appendChild(wrap);

      // Haelt das Raster quadratisch UND garantiert, dass es komplett in
      // die verfuegbare Flaeche passt -- auf niedrigen Bildschirmen wuerde
      // reines CSS (Breite bestimmt ueber aspect-ratio die Hoehe) sonst zum
      // Scrollen zwingen, obwohl das Spiel eigentlich ohne Scrollen passen soll.
      stopSquareFit = fitSquareToContainer(gridHost, wrap);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatTime);

      restart();
    },

    update(dt: number) {
      if (phase === "playing") {
        elapsed += dt;
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      if (phase === "playing" || phase === "done") {
        ctx.textAlign = "center";
        ctx.fillStyle = phase === "playing" ? theme.accent : theme.textFaint;
        ctx.font = `700 22px ${theme.fontDisplay}`;
        ctx.fillText(formatTime(elapsed), size.width / 2, 150);
      }

      if (phase === "playing") {
        ctx.font = `500 11px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(`Tippe alle Züge an${remainingTrains > 0 ? ` (noch ${remainingTrains})` : ""}`, size.width / 2, 172);
      }
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      closeIntro?.();
      closeIntro = null;
      stopSquareFit?.();
      gridHost?.parentElement?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Zug-Spotter",
  subtitle: "Finde alle Züge im Raster",
  icon: "searchGrid",
  badge: "ZS",
  accent: "#0059a4",
  create: createTrainSpotterGame,
  highscoreCategories: [{ board: "default", label: "Bestzeit", direction: "lower-better", formatValue: formatTime }],
});
