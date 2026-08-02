import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import { distractorImages } from "../../data/distractors";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { fitSquareToContainer } from "../../core/squareFit";
import { registerGame } from "../registry";

const GAME_ID = "memory";
const MISMATCH_DELAY = 0.8;

function formatMoves(value: number): string {
  return `${value} Züge`;
}

interface BoardSize {
  key: string;
  cols: number;
  label: string;
}

const BOARD_SIZES: BoardSize[] = [
  { key: "4x4", cols: 4, label: "4 × 4 (leicht)" },
  { key: "6x6", cols: 6, label: "6 × 6 (mittel)" },
  { key: "8x8", cols: 8, label: "8 × 8 (schwer)" },
];

const ALL_IMAGES: string[] = [...trainCards.map((c) => c.image), ...distractorImages];

interface Card {
  image: string;
  matched: boolean;
}

type Phase = "size-select" | "playing" | "resolving" | "done";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildBoard(pairCount: number): Card[] {
  const images = shuffle(ALL_IMAGES).slice(0, pairCount);
  const cards: Card[] = shuffle([...images, ...images]).map((image) => ({ image, matched: false }));
  return cards;
}

function createMemoryGame(): MinigameModule {
  let phase: Phase = "size-select";
  let boardSize: BoardSize | null = null;
  let cards: Card[] = [];
  let flipped: number[] = [];
  let moves = 0;
  let resolveTimer = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let panel: HTMLDivElement;
  let cellButtons: HTMLButtonElement[] = [];
  let gridWrap: HTMLDivElement;
  let gridHost: HTMLDivElement;
  let stopSquareFit: (() => void) | null = null;

  function renderPanel(): void {
    panel.innerHTML = "";

    // Waehrend des eigentlichen Spiels (playing/resolving) braucht es kein
    // Panel -- und ein leeres, aber weiterhin volle Flaeche einnehmendes
    // Panel wuerde sonst Klicks auf das Raster darunter abfangen.
    panel.style.display = phase === "playing" || phase === "resolving" ? "none" : "flex";

    if (phase === "size-select") {
      const title = document.createElement("div");
      title.className = "stage-sheet__title";
      title.style.fontSize = "1rem";
      title.style.color = "var(--text)";
      title.textContent = "Finde alle Zugpaare";
      panel.appendChild(title);

      const desc = document.createElement("p");
      desc.style.color = "var(--text-muted)";
      desc.style.fontSize = "0.85rem";
      desc.style.margin = "0 0 4px";
      desc.textContent = "Decke immer zwei Karten auf. Zeigen beide denselben Zug, bleiben sie offen. Wähle zuerst eine Spielfeldgröße:";
      panel.appendChild(desc);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "8px";
      row.style.width = "100%";
      row.style.maxWidth = "260px";
      for (const size of BOARD_SIZES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.textContent = size.label;
        btn.addEventListener("click", () => selectSize(size));
        row.appendChild(btn);
      }
      panel.appendChild(row);
    } else if (phase === "done") {
      const title = document.createElement("div");
      title.style.fontFamily = "var(--font-display)";
      title.style.fontWeight = "800";
      title.style.fontSize = "1.2rem";
      title.style.color = theme.accent;
      title.textContent = `Geschafft in ${moves} Zügen!`;
      panel.appendChild(title);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "10px";

      const again = document.createElement("button");
      again.type = "button";
      again.className = "btn btn--accent";
      again.textContent = "Nochmal";
      again.addEventListener("click", () => boardSize && selectSize(boardSize));

      const change = document.createElement("button");
      change.type = "button";
      change.className = "btn btn--ghost";
      change.textContent = "Andere Größe";
      change.addEventListener("click", () => {
        phase = "size-select";
        gridHost.style.visibility = "hidden";
        renderPanel();
      });

      actions.append(again, change);
      panel.appendChild(actions);
    } else {
      panel.innerHTML = "";
    }
  }

  function selectSize(size: BoardSize): void {
    boardSize = size;
    highscoreBanner.update(getHighscoreBoard(GAME_ID, size.key));
    cards = buildBoard((size.cols * size.cols) / 2);
    flipped = [];
    moves = 0;
    phase = "playing";
    renderGrid();
    gridHost.style.visibility = "visible";
    renderPanel();
  }

  function renderGrid(): void {
    if (!boardSize) return;
    gridHost.innerHTML = "";
    gridHost.style.setProperty("--cols", String(boardSize.cols));
    cellButtons = cards.map((_, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile-grid__cell tile-grid__cell--hidden";
      const img = document.createElement("img");
      img.draggable = false;
      btn.appendChild(img);

      const back = document.createElement("div");
      back.className = "memory-back";
      btn.appendChild(back);

      btn.addEventListener("click", () => handleFlip(i));
      gridHost.appendChild(btn);
      return btn;
    });
    syncGridVisuals();
  }

  function syncGridVisuals(): void {
    cards.forEach((card, i) => {
      const btn = cellButtons[i];
      if (!btn) return;
      const img = btn.querySelector("img")!;
      const isRevealed = flipped.includes(i) || card.matched;
      img.src = card.image;
      btn.classList.toggle("tile-grid__cell--hidden", !isRevealed);
      btn.classList.toggle("tile-grid__cell--matched", card.matched);
      const back = btn.querySelector<HTMLDivElement>(".memory-back");
      if (back) back.style.display = isRevealed ? "none" : "flex";
    });
  }

  function handleFlip(index: number): void {
    if (phase !== "playing") return;
    if (flipped.includes(index) || cards[index].matched) return;
    if (flipped.length >= 2) return;

    flipped.push(index);
    syncGridVisuals();

    if (flipped.length === 2) {
      moves += 1;
      const [a, b] = flipped;
      if (cards[a].image === cards[b].image) {
        cards[a].matched = true;
        cards[b].matched = true;
        flipped = [];
        syncGridVisuals();
        if (cards.every((c) => c.matched)) finish();
      } else {
        phase = "resolving";
        resolveTimer = 0;
      }
    }
  }

  function finish(): void {
    if (!boardSize) return;
    phase = "done";
    const outcome = getHighscoreOutcome(GAME_ID, moves, "lower-better", boardSize.key);
    renderPanel();
    if (outcome !== "none") {
      const size = boardSize;
      closeHighscoreModal = promptHighscoreName({
        message: `${moves} Züge auf ${size.label} — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
        onDone: (name) => {
          closeHighscoreModal = null;
          highscoreBanner.update(recordHighscore(GAME_ID, name, moves, "lower-better", size.key));
        },
      });
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      panel = document.createElement("div");
      panel.className = "stage-center-panel";

      // Wrapper definiert die verfuegbare Flaeche (oben/unten von Kopf- bzw.
      // Fussleiste begrenzt); gridHost wird darin per fitSquareToContainer
      // quadratisch UND garantiert passend skaliert, statt wie zuvor rein
      // ueber die Breite (per aspect-ratio) -- das konnte auf niedrigen
      // Bildschirmen ueber den verfuegbaren Platz hinauswachsen.
      gridWrap = document.createElement("div");
      gridWrap.style.position = "absolute";
      gridWrap.style.left = "0";
      gridWrap.style.right = "0";
      gridWrap.style.top = "calc(var(--header-h) + 96px + var(--safe-top))";
      gridWrap.style.bottom = "calc(var(--footer-h) + 16px + var(--safe-bottom))";
      gridWrap.style.display = "flex";
      gridWrap.style.alignItems = "center";
      gridWrap.style.justifyContent = "center";
      gridWrap.style.zIndex = "10";

      gridHost = document.createElement("div");
      gridHost.className = "tile-grid";
      gridHost.style.visibility = "hidden";
      gridWrap.appendChild(gridHost);

      env.overlay.appendChild(gridWrap);
      env.overlay.appendChild(panel);

      stopSquareFit = fitSquareToContainer(gridHost, gridWrap, 460);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatMoves);

      renderPanel();
    },

    update(dt: number) {
      if (phase === "resolving") {
        resolveTimer += dt;
        if (resolveTimer >= MISMATCH_DELAY) {
          flipped = [];
          phase = "playing";
          syncGridVisuals();
        }
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      if ((phase === "playing" || phase === "resolving") && boardSize) {
        ctx.textAlign = "center";
        ctx.fillStyle = theme.textMuted;
        ctx.font = `600 13px ${theme.font}`;
        ctx.fillText(`${boardSize.label} · ${moves} Züge`, size.width / 2, 150);
      }
    },

    cleanup() {
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      stopSquareFit?.();
      gridWrap?.remove();
      panel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Zug-Memory",
  subtitle: "Finde alle Zugpaare",
  icon: "memory",
  badge: "ZM",
  accent: "#e2007a",
  create: createMemoryGame,
  highscoreCategories: BOARD_SIZES.map((size) => ({
    board: size.key,
    label: size.label,
    direction: "lower-better",
    formatValue: formatMoves,
  })),
});
