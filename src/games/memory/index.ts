import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { fitAspectToContainer } from "../../core/squareFit";
import { registerGame } from "../registry";

const GAME_ID = "memory";
const MISMATCH_DELAY = 0.8;
const HIGHSCORE_POPUP_DELAY_MS = 2000;

function formatMoves(value: number): string {
  return `${value} Züge`;
}

type Mode = "solo" | "duo";

interface BoardSize {
  key: string;
  cols: number;
  rows: number;
  label: string;
}

// "Schwer" ist bewusst kein Quadrat (5x8 statt z.B. 8x8): so werden alle
// verfuegbaren Zugfotos genutzt, ohne echte Zuege durch spielfremde
// Ablenkerbilder (Auto, Flugzeug, ...) auffuellen zu muessen.
const BOARD_SIZES: BoardSize[] = [
  { key: "4x4", cols: 4, rows: 4, label: "4 × 4 (leicht)" },
  { key: "6x6", cols: 6, rows: 6, label: "6 × 6 (mittel)" },
  { key: "5x8", cols: 5, rows: 8, label: "5 × 8 (schwer)" },
];

const ALL_IMAGES: string[] = trainCards.map((c) => c.image);
// Bildausschnitt (object-position) je Zugfoto beim quadratischen Zuschnitt --
// siehe TrainCard.focus in data/trains.ts, Default ist Bildmitte.
const FOCUS_BY_IMAGE = new Map(trainCards.map((c) => [c.image, c.focus ?? "50% 50%"]));

interface Card {
  image: string;
  matched: boolean;
}

type Phase = "mode-select" | "size-select" | "playing" | "resolving" | "done";

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
  let phase: Phase = "mode-select";
  let mode: Mode = "solo";
  let boardSize: BoardSize | null = null;
  let cards: Card[] = [];
  let flipped: number[] = [];
  let moves = 0;
  let currentPlayer: 1 | 2 = 1;
  let playerScores: [number, number] = [0, 0];
  let resolveTimer = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let panel: HTMLDivElement;
  let cellButtons: HTMLButtonElement[] = [];
  let gridWrap: HTMLDivElement;
  let gridHost: HTMLDivElement;
  let stopGridFit: (() => void) | null = null;

  function renderPanel(): void {
    panel.innerHTML = "";

    // Waehrend des eigentlichen Spiels (playing/resolving) braucht es kein
    // Panel -- und ein leeres, aber weiterhin volle Flaeche einnehmendes
    // Panel wuerde sonst Klicks auf das Raster darunter abfangen.
    panel.style.display = phase === "playing" || phase === "resolving" ? "none" : "flex";

    if (phase === "mode-select") {
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
      desc.textContent = "Wie möchtet ihr spielen?";
      panel.appendChild(desc);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "8px";
      row.style.width = "100%";
      row.style.maxWidth = "280px";

      const soloBtn = document.createElement("button");
      soloBtn.type = "button";
      soloBtn.className = "btn";
      soloBtn.textContent = "Freies Spiel (möglichst wenig Züge)";
      soloBtn.addEventListener("click", () => selectMode("solo"));
      row.appendChild(soloBtn);

      const duoBtn = document.createElement("button");
      duoBtn.type = "button";
      duoBtn.className = "btn";
      duoBtn.textContent = "1 gegen 1";
      duoBtn.addEventListener("click", () => selectMode("duo"));
      row.appendChild(duoBtn);

      panel.appendChild(row);
    } else if (phase === "size-select") {
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

      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn btn--ghost";
      back.style.marginTop = "4px";
      back.textContent = "← Andere Spielart";
      back.addEventListener("click", () => {
        phase = "mode-select";
        renderPanel();
      });
      panel.appendChild(back);
    } else if (phase === "done") {
      const title = document.createElement("div");
      title.style.fontFamily = "var(--font-display)";
      title.style.fontWeight = "800";
      title.style.fontSize = "1.2rem";
      title.style.color = theme.accent;
      title.textContent =
        mode === "solo"
          ? `Geschafft in ${moves} Zügen!`
          : playerScores[0] === playerScores[1]
            ? "Unentschieden!"
            : `Spieler ${playerScores[0] > playerScores[1] ? 1 : 2} gewinnt!`;
      panel.appendChild(title);

      if (mode === "duo") {
        const detail = document.createElement("div");
        detail.style.color = "var(--text-muted)";
        detail.style.fontSize = "0.9rem";
        detail.style.marginTop = "4px";
        detail.textContent = `Spieler 1: ${playerScores[0]} Paare · Spieler 2: ${playerScores[1]} Paare`;
        panel.appendChild(detail);
      }

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

  function selectMode(next: Mode): void {
    mode = next;
    phase = "size-select";
    renderPanel();
  }

  function selectSize(size: BoardSize): void {
    boardSize = size;
    highscoreBanner.update(mode === "solo" ? getHighscoreBoard(GAME_ID, size.key) : null);
    cards = buildBoard((size.cols * size.rows) / 2);
    flipped = [];
    moves = 0;
    currentPlayer = 1;
    playerScores = [0, 0];
    phase = "playing";
    renderGrid();
    stopGridFit?.();
    stopGridFit = fitAspectToContainer(gridHost, gridWrap, size.cols, size.rows, 460);
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
      img.style.objectPosition = FOCUS_BY_IMAGE.get(card.image) ?? "50% 50%";
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
        if (mode === "duo") playerScores[currentPlayer - 1] += 1;
        syncGridVisuals();
        if (cards.every((c) => c.matched)) finish();
        // Bei einem Treffer im 1-vs-1-Modus bleibt derselbe Spieler dran --
        // klassische Memory-Regel.
      } else {
        phase = "resolving";
        resolveTimer = 0;
      }
    }
  }

  function finish(): void {
    if (!boardSize) return;
    phase = "done";
    renderPanel();
    if (mode !== "solo") return;
    const outcome = getHighscoreOutcome(GAME_ID, moves, "lower-better", boardSize.key);
    if (outcome !== "none") {
      const size = boardSize;
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${moves} Züge auf ${size.label} — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            highscoreBanner.update(recordHighscore(GAME_ID, name, moves, "lower-better", size.key));
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      panel = document.createElement("div");
      panel.className = "stage-center-panel";

      // Wrapper definiert die verfuegbare Flaeche (oben/unten von Kopf- bzw.
      // Fussleiste begrenzt); gridHost wird darin per fitAspectToContainer
      // passend zum jeweiligen Seitenverhaeltnis der Spielfeldgroesse UND
      // garantiert passend skaliert, statt wie zuvor rein ueber die Breite
      // (per aspect-ratio) -- das konnte auf niedrigen Bildschirmen ueber
      // den verfuegbaren Platz hinauswachsen.
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

      highscoreBanner = mountHighscoreBanner(env.overlay, formatMoves);

      renderPanel();
    },

    update(dt: number) {
      if (phase === "resolving") {
        resolveTimer += dt;
        if (resolveTimer >= MISMATCH_DELAY) {
          flipped = [];
          phase = "playing";
          if (mode === "duo") currentPlayer = currentPlayer === 1 ? 2 : 1;
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
        if (mode === "solo") {
          ctx.fillStyle = theme.textMuted;
          ctx.font = `600 13px ${theme.font}`;
          ctx.fillText(`${boardSize.label} · ${moves} Züge`, size.width / 2, 150);
        } else {
          ctx.fillStyle = theme.textMuted;
          ctx.font = `600 12px ${theme.font}`;
          ctx.fillText(`Spieler 1: ${playerScores[0]} · Spieler 2: ${playerScores[1]}`, size.width / 2, 150);
          ctx.fillStyle = theme.accent;
          ctx.font = `700 14px ${theme.fontDisplay}`;
          ctx.fillText(`Spieler ${currentPlayer} ist dran`, size.width / 2, 172);
        }
      }
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      stopGridFit?.();
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
