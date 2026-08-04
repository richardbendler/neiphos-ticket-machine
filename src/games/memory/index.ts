import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { fitAspectToContainer } from "../../core/squareFit";
import { registerGame } from "../registry";

const GAME_ID = "memory";
const MISMATCH_DELAY = 0.8;
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer

function formatMoves(value: number): string {
  return `${value} Züge`;
}

type Mode = "solo" | "duo";
type ContentTheme = "trains" | "hoppers";

interface BoardSize {
  key: string;
  cols: number;
  rows: number;
  label: string;
}

// "Schwer" ist bewusst kein Quadrat (5x8 statt z.B. 8x8): so werden alle
// verfuegbaren Zugfotos genutzt, ohne echte Zuege durch spielfremde
// Ablenkerbilder (Auto, Flugzeug, ...) auffuellen zu muessen.
const TRAIN_BOARD_SIZES: BoardSize[] = [
  { key: "4x4", cols: 4, rows: 4, label: "4 × 4 (leicht)" },
  { key: "6x6", cols: 6, rows: 6, label: "6 × 6 (mittel)" },
  { key: "5x8", cols: 5, rows: 8, label: "5 × 8 (schwer)" },
];

// Nur 2 Stufen statt 3: es gibt (noch) nicht so viele unterschiedliche
// Huepftier-Fotos wie Zugfotos -- eigene, von den Zug-Boardgroessen
// getrennte "key"s, damit sich Highscores der beiden Themen nicht
// gegenseitig in localStorage ueberschreiben (siehe registerGame unten).
// "schwer" nutzt bewusst ALLE aktuell verfuegbaren Huepftierbilder als
// Paare aus (hopperAnimalCards.length) -- bei weiterem Bildausbau darf/soll
// diese Zahl mitwachsen.
const HOPPER_BOARD_SIZES: BoardSize[] = [
  { key: "hopper-4x4", cols: 4, rows: 4, label: "4 × 4 (leicht)" },
  { key: "hopper-4x6", cols: 4, rows: 6, label: "4 × 6 (schwer)" },
];

function boardSizesFor(t: ContentTheme): BoardSize[] {
  return t === "trains" ? TRAIN_BOARD_SIZES : HOPPER_BOARD_SIZES;
}

/**
 * Passt cols/rows eines nicht-quadratischen Spielfelds an die tatsaechliche
 * Geraete-Ausrichtung an -- ein Feld, das "hochformatig" definiert ist
 * (mehr Zeilen als Spalten, z. B. 5x8), wird auf einem Querformat-
 * Bildschirm gespiegelt (8x5) angezeigt, und umgekehrt. Quadratische Felder
 * (4x4, 6x6) sind davon nicht betroffen.
 */
function orientedCols(size: BoardSize): { cols: number; rows: number } {
  const viewportIsLandscape = window.innerWidth > window.innerHeight;
  const sizeIsPortraitShaped = size.rows > size.cols;
  const sizeIsLandscapeShaped = size.cols > size.rows;
  if ((viewportIsLandscape && sizeIsPortraitShaped) || (!viewportIsLandscape && sizeIsLandscapeShaped)) {
    return { cols: size.rows, rows: size.cols };
  }
  return { cols: size.cols, rows: size.rows };
}

function imagesFor(t: ContentTheme): string[] {
  return t === "trains" ? trainCards.map((c) => c.image) : hopperAnimalCards.map((c) => c.image);
}

// Bildausschnitt (object-position) je Zugfoto beim quadratischen Zuschnitt --
// siehe TrainCard.focus in data/trains.ts, Default ist Bildmitte. Huepftier-
// Fotos brauchen das nicht (bereits mittig freigestellte Produktfotos),
// tauchen hier also einfach nicht auf und fallen auf den Default zurueck.
const FOCUS_BY_IMAGE = new Map(trainCards.map((c) => [c.image, c.focus ?? "50% 50%"]));

interface Card {
  image: string;
  matched: boolean;
}

type Phase = "theme-select" | "mode-select" | "size-select" | "playing" | "resolving" | "done";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildBoard(pairCount: number, t: ContentTheme): Card[] {
  const images = shuffle(imagesFor(t)).slice(0, pairCount);
  const cards: Card[] = shuffle([...images, ...images]).map((image) => ({ image, matched: false }));
  return cards;
}

function createMemoryGame(): MinigameModule {
  let phase: Phase = "theme-select";
  let contentTheme: ContentTheme = "trains";
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

    if (phase === "theme-select") {
      const title = document.createElement("div");
      title.className = "stage-sheet__title";
      title.style.fontSize = "1rem";
      title.style.color = "var(--text)";
      title.textContent = "Zug-Memory";
      panel.appendChild(title);

      const desc = document.createElement("p");
      desc.style.color = "var(--text-muted)";
      desc.style.fontSize = "0.85rem";
      desc.style.margin = "0 0 4px";
      desc.textContent = "Womit möchtet ihr spielen?";
      panel.appendChild(desc);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "10px";
      row.style.width = "100%";
      row.style.maxWidth = "min(92%, 480px)";

      const trainsBtn = document.createElement("button");
      trainsBtn.type = "button";
      trainsBtn.className = "btn btn--choice";
      trainsBtn.textContent = "🚂 Züge";
      trainsBtn.addEventListener("click", () => selectTheme("trains"));
      row.appendChild(trainsBtn);

      const hoppersBtn = document.createElement("button");
      hoppersBtn.type = "button";
      hoppersBtn.className = "btn btn--choice";
      hoppersBtn.textContent = "🦘 Hüpftiere";
      hoppersBtn.addEventListener("click", () => selectTheme("hoppers"));
      row.appendChild(hoppersBtn);

      panel.appendChild(row);
    } else if (phase === "mode-select") {
      const title = document.createElement("div");
      title.className = "stage-sheet__title";
      title.style.fontSize = "1rem";
      title.style.color = "var(--text)";
      title.textContent = contentTheme === "trains" ? "Finde alle Zugpaare" : "Finde alle Hüpftier-Paare";
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
      row.style.gap = "10px";
      row.style.width = "100%";
      row.style.maxWidth = "min(92%, 480px)";

      const soloBtn = document.createElement("button");
      soloBtn.type = "button";
      soloBtn.className = "btn btn--choice";
      soloBtn.textContent = "Ein Spieler (möglichst wenig Züge)";
      soloBtn.addEventListener("click", () => selectMode("solo"));
      row.appendChild(soloBtn);

      const duoBtn = document.createElement("button");
      duoBtn.type = "button";
      duoBtn.className = "btn btn--choice";
      duoBtn.textContent = "1 gegen 1";
      duoBtn.addEventListener("click", () => selectMode("duo"));
      row.appendChild(duoBtn);

      panel.appendChild(row);

      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn btn--ghost";
      back.style.marginTop = "4px";
      back.textContent = "← Anderes Thema";
      back.addEventListener("click", () => {
        phase = "theme-select";
        renderPanel();
      });
      panel.appendChild(back);
    } else if (phase === "size-select") {
      const title = document.createElement("div");
      title.className = "stage-sheet__title";
      title.style.fontSize = "1rem";
      title.style.color = "var(--text)";
      title.textContent = contentTheme === "trains" ? "Finde alle Zugpaare" : "Finde alle Hüpftier-Paare";
      panel.appendChild(title);

      const desc = document.createElement("p");
      desc.style.color = "var(--text-muted)";
      desc.style.fontSize = "0.85rem";
      desc.style.margin = "0 0 4px";
      desc.textContent = `Decke immer zwei Karten auf. Zeigen beide ${contentTheme === "trains" ? "denselben Zug" : "dasselbe Hüpftier"}, bleiben sie offen. Wähle zuerst eine Spielfeldgröße:`;
      panel.appendChild(desc);

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "10px";
      row.style.width = "100%";
      row.style.maxWidth = "min(92%, 440px)";
      for (const size of boardSizesFor(contentTheme)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--choice";
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
      // Eigene deckende Karte statt direkt auf dem (weiterhin sichtbaren,
      // bunten) Kartenraster zu stehen -- sonst ist v.a. der transparente
      // "Andere Größe"-Button vor den Zugfotos darunter kaum zu erkennen.
      const card = document.createElement("div");
      card.className = "ticket-card";
      card.style.textAlign = "center";
      card.style.width = "100%";
      card.style.maxWidth = "320px";

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
      card.appendChild(title);

      if (mode === "duo") {
        const detail = document.createElement("div");
        detail.style.color = "var(--paper-muted)";
        detail.style.fontSize = "0.9rem";
        detail.style.marginTop = "4px";
        detail.textContent = `Spieler 1: ${playerScores[0]} Paare · Spieler 2: ${playerScores[1]} Paare`;
        card.appendChild(detail);
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
      change.className = "btn";
      change.textContent = "Andere Größe";
      change.addEventListener("click", () => {
        phase = "size-select";
        gridHost.style.visibility = "hidden";
        renderPanel();
      });

      actions.append(again, change);
      card.appendChild(actions);
      panel.appendChild(card);
    } else {
      panel.innerHTML = "";
    }
  }

  function selectTheme(next: ContentTheme): void {
    contentTheme = next;
    phase = "mode-select";
    renderPanel();
  }

  function selectMode(next: Mode): void {
    mode = next;
    phase = "size-select";
    renderPanel();
  }

  function selectSize(size: BoardSize): void {
    // Nicht-quadratische Spielfelder (aktuell nur "5 x 8 schwer") sollen zur
    // tatsaechlichen Geraete-Ausrichtung passen -- ein Querformat-Bildschirm
    // (Breite > Hoehe) zeigt sie querformatig (8 Spalten x 5 Zeilen) statt
    // wie bisher immer hochformatig (5 x 8), was auf breiten Bildschirmen
    // ein unnoetig schmales, hohes (teils scrollendes) Raster ergab. Auf
    // Hochformat-Geraeten bleibt es beim bisherigen Verhalten.
    boardSize = { ...size, ...orientedCols(size) };
    highscoreBanner.update(mode === "solo" ? getHighscoreBoard(GAME_ID, size.key) : null);
    cards = buildBoard((boardSize.cols * boardSize.rows) / 2, contentTheme);
    flipped = [];
    moves = 0;
    currentPlayer = 1;
    playerScores = [0, 0];
    phase = "playing";
    renderGrid();
    stopGridFit?.();
    stopGridFit = fitAspectToContainer(gridHost, gridWrap, boardSize.cols, boardSize.rows, 460);
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
            if (name === null) return;
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
          ctx.font = `600 14px ${theme.font}`;
          ctx.fillText(`${boardSize.label} · ${moves} Züge`, size.width / 2, 150);
        } else {
          ctx.fillStyle = theme.textMuted;
          ctx.font = `600 14px ${theme.font}`;
          ctx.fillText(`Spieler 1: ${playerScores[0]} · Spieler 2: ${playerScores[1]}`, size.width / 2, 150);

          // Deutlich groesser + eigener Farbklecks dahinter, damit auf
          // Anhieb klar ist, wer gerade dran ist -- vorher war das kaum
          // groesser als die Punktezeile und ging leicht unter.
          const turnText = `Spieler ${currentPlayer} ist dran`;
          ctx.font = `800 22px ${theme.fontDisplay}`;
          const textWidth = ctx.measureText(turnText).width;
          const badgeW = textWidth + 36;
          const badgeH = 36;
          const badgeX = size.width / 2 - badgeW / 2;
          const badgeY = 168;
          ctx.fillStyle = theme.accent;
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2);
          ctx.fill();
          ctx.fillStyle = "#2b2004";
          ctx.textBaseline = "middle";
          ctx.fillText(turnText, size.width / 2, badgeY + badgeH / 2 + 1);
          ctx.textBaseline = "alphabetic";
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
  note: "auch mit Hüpftieren spielbar",
  icon: "memory",
  badge: "ZM",
  accent: "#e2007a",
  create: createMemoryGame,
  // Beide Themen-Boardgroessen zusammen, mit eigenem Praefix bei den
  // Huepftier-Labels -- sonst waeren "4 × 4 (leicht)" (Zuege) und
  // "4 × 4 (leicht)" (Huepftiere) in der Highscore-Uebersicht nicht
  // auseinanderzuhalten, obwohl die Bestwerte (unterschiedliche key-Werte,
  // siehe HOPPER_BOARD_SIZES) tatsaechlich getrennt gefuehrt werden.
  highscoreCategories: [
    ...TRAIN_BOARD_SIZES.map((size) => ({
      board: size.key,
      label: size.label,
      direction: "lower-better" as const,
      formatValue: formatMoves,
    })),
    ...HOPPER_BOARD_SIZES.map((size) => ({
      board: size.key,
      label: `Hüpftiere ${size.label}`,
      direction: "lower-better" as const,
      formatValue: formatMoves,
    })),
  ],
});
