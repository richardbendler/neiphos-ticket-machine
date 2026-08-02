import type { GameEnv, MinigameModule, PointerPoint } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards, STAT_LABELS, type TrainCard, type TrainStats } from "../../data/trains";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";

const GAME_ID = "train-quartet";
const STAT_KEYS = Object.keys(STAT_LABELS) as (keyof TrainStats)[];
const CARD_GAP = 12;
const SLIDE_DURATION = 0.45;

// "sliding-in": die aufgedeckte Computer-Karte faehrt von rechts herein,
// waehrend beide Karten gemeinsam in die Bildschirmmitte ruecken.
// "comparing": beide Karten stehen in voller Groesse nebeneinander, die
// gewaehlte Eigenschaft ist markiert, das Ergebnis steht fest.
// "sliding-out": nach "Weiter" verschwindet die linke (alte) Karte nach
// links, die rechte wandert in die Mitte und wird zur naechsten Karte.
type Phase = "reveal-player" | "sliding-in" | "comparing" | "sliding-out" | "game-over";
type Outcome = "player" | "cpu" | "tie";

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const imageCache = new Map<string, HTMLImageElement>();
function getImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

function formatStatValue(key: keyof TrainStats, value: number): string {
  const meta = STAT_LABELS[key];
  const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
  return meta.unit ? `${rounded} ${meta.unit}` : `${rounded}`;
}

function createTrainQuartetGame(): MinigameModule {
  let playerDeck: TrainCard[] = [];
  let cpuDeck: TrainCard[] = [];
  let pot: TrainCard[] = [];
  let phase: Phase = "reveal-player";
  let chosenStat: keyof TrainStats | null = null;
  let outcome: Outcome | null = null;
  let animTimer = 0;
  // Schnappschuss der beiden Karten, die gerade verglichen werden --
  // getrennt vom "lebenden" Deck-Zustand (der schon direkt beim Aufdecken
  // mutiert wird), damit sliding-in/comparing/sliding-out immer noch die
  // richtigen Karten zeigen, auch wenn playerDeck[0]/cpuDeck[0] inzwischen
  // schon die naechste Runde meinen.
  let displayedPlayerCard: TrainCard | null = null;
  let displayedCpuCard: TrainCard | null = null;
  let statRects: Array<{ stat: keyof TrainStats; rect: Rect }> = [];
  let continueBtn: HTMLButtonElement | null = null;
  let messageEl: HTMLDivElement | null = null;
  let closeIntro: (() => void) | null = null;

  function newGame(): void {
    const deck = shuffle(trainCards);
    playerDeck = deck.slice(0, 10);
    cpuDeck = deck.slice(10, 20);
    pot = [];
    phase = "reveal-player";
    chosenStat = null;
    outcome = null;
    displayedPlayerCard = null;
    displayedCpuCard = null;
    updateOverlay();
  }

  function updateOverlay(): void {
    if (!messageEl || !continueBtn) return;
    if (phase === "comparing" && outcome) {
      const text =
        outcome === "player"
          ? "Du gewinnst diese Runde!"
          : outcome === "cpu"
            ? "Der Computer gewinnt diese Runde."
            : "Unentschieden — die Karten wandern in den Pot.";
      messageEl.textContent = text;
      messageEl.style.display = "block";
      continueBtn.style.display = "block";
      continueBtn.textContent = "Weiter";
    } else if (phase === "game-over") {
      const won = playerDeck.length > 0;
      messageEl.textContent = won ? "🏆 Du hast alle Karten gewonnen!" : "Du hast keine Karten mehr übrig.";
      messageEl.style.display = "block";
      continueBtn.style.display = "block";
      continueBtn.textContent = "Nochmal spielen";
    } else {
      messageEl.style.display = "none";
      continueBtn.style.display = "none";
    }
  }

  function handleStatChoice(stat: keyof TrainStats): void {
    if (phase !== "reveal-player") return;
    const playerCard = playerDeck[0];
    const cpuCard = cpuDeck[0];
    if (!playerCard || !cpuCard) return;

    chosenStat = stat;
    displayedPlayerCard = playerCard;
    displayedCpuCard = cpuCard;
    resolveRound(playerCard, cpuCard, stat);

    phase = "sliding-in";
    animTimer = 0;
    updateOverlay();
  }

  /** Mutiert die Decks sofort -- die Animation zeigt weiterhin die per displayedPlayerCard/displayedCpuCard eingefrorenen Karten. */
  function resolveRound(playerCard: TrainCard, cpuCard: TrainCard, stat: keyof TrainStats): void {
    const pv = playerCard.stats[stat];
    const cv = cpuCard.stats[stat];

    playerDeck = playerDeck.slice(1);
    cpuDeck = cpuDeck.slice(1);

    if (pv === cv) {
      outcome = "tie";
      pot.push(playerCard, cpuCard);
    } else if (pv > cv) {
      outcome = "player";
      playerDeck.push(...pot, cpuCard, playerCard);
      pot = [];
    } else {
      outcome = "cpu";
      cpuDeck.push(...pot, playerCard, cpuCard);
      pot = [];
    }
  }

  function finishTransition(): void {
    displayedPlayerCard = null;
    displayedCpuCard = null;
    chosenStat = null;
    outcome = null;
    phase = playerDeck.length === 0 || cpuDeck.length === 0 ? "game-over" : "reveal-player";
    updateOverlay();
  }

  function handleContinue(): void {
    if (phase === "comparing") {
      phase = "sliding-out";
      animTimer = 0;
      updateOverlay();
    } else if (phase === "game-over") {
      newGame();
    }
  }

  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCardFace(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    card: TrainCard,
    opts: { interactive: boolean; opponent?: TrainCard; highlightStat?: keyof TrainStats | null },
  ): void {
    ctx.fillStyle = theme.paper;
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 14);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 14);
    ctx.stroke();

    const padding = 10;
    // Statzeilen bekommen zuerst eine feste, garantiert lesbare Hoehe -- das
    // Bild bekommt nur, was danach uebrig bleibt. So ueberlappt bei wenig
    // Platz (z. B. Querformat mit geringer Bildschirmhoehe) nie der Text,
    // sondern hoechstens das Foto wird kleiner.
    const rowHeight = 24;
    const nameBlockHeight = 34;
    const statsBlockHeight = rowHeight * STAT_KEYS.length;
    const imgHeight = Math.max(36, rect.height - padding * 2 - nameBlockHeight - statsBlockHeight);
    const imgRect: Rect = { x: rect.x + padding, y: rect.y + padding, width: rect.width - padding * 2, height: imgHeight };

    ctx.save();
    roundRect(ctx, imgRect.x, imgRect.y, imgRect.width, imgRect.height, 8);
    ctx.clip();
    ctx.fillStyle = "#0a1d20";
    ctx.fillRect(imgRect.x, imgRect.y, imgRect.width, imgRect.height);
    const img = getImage(card.image);
    if (img.complete && img.naturalWidth > 0) {
      const scale = Math.max(imgRect.width / img.naturalWidth, imgRect.height / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = imgRect.x + (imgRect.width - dw) / 2;
      const dy = imgRect.y + (imgRect.height - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.restore();

    let textY = imgRect.y + imgRect.height + 8;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.paperText;
    ctx.font = `700 15px ${theme.fontDisplay}`;
    ctx.fillText(card.name, rect.x + padding, textY + 12);
    ctx.fillStyle = theme.paperMuted;
    ctx.font = `500 10px ${theme.font}`;
    ctx.fillText(card.category, rect.x + padding, textY + 26);

    textY += nameBlockHeight;
    statRects = opts.interactive ? [] : statRects;

    STAT_KEYS.forEach((key, i) => {
      const rowY = textY + i * rowHeight;
      const rowRect: Rect = { x: rect.x + padding, y: rowY, width: rect.width - padding * 2, height: rowHeight - 4 };
      const isHighlighted = opts.highlightStat === key;

      if (isHighlighted) {
        let bg = "rgba(15,122,134,0.18)";
        if (opts.opponent) {
          const mine = card.stats[key];
          const theirs = opts.opponent.stats[key];
          bg = mine === theirs ? "rgba(169,192,192,0.25)" : mine > theirs ? "rgba(53,196,123,0.22)" : "rgba(239,86,87,0.18)";
        }
        ctx.fillStyle = bg;
        roundRect(ctx, rowRect.x, rowRect.y, rowRect.width, rowRect.height, 6);
        ctx.fill();
      }

      ctx.fillStyle = theme.paperText;
      ctx.font = `600 11px ${theme.font}`;
      ctx.textAlign = "left";
      ctx.fillText(STAT_LABELS[key].label, rowRect.x + 6, rowRect.y + rowRect.height / 2 + 4);

      ctx.font = `700 12px ${theme.fontDisplay}`;
      ctx.textAlign = "right";
      ctx.fillText(formatStatValue(key, card.stats[key]), rowRect.x + rowRect.width - 6, rowRect.y + rowRect.height / 2 + 4);

      if (opts.interactive) {
        statRects.push({ stat: key, rect: rowRect });
      }
    });
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      for (const card of trainCards) getImage(card.image);

      messageEl = document.createElement("div");
      messageEl.className = "ticket-card";
      messageEl.style.textAlign = "center";
      messageEl.style.fontFamily = "var(--font-display)";
      messageEl.style.fontWeight = "700";
      messageEl.style.display = "none";

      continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.className = "btn btn--accent";
      continueBtn.style.display = "none";
      continueBtn.addEventListener("click", handleContinue);

      const wrap = document.createElement("div");
      wrap.className = "stage-sheet";
      wrap.style.alignItems = "center";
      wrap.style.gap = "10px";
      wrap.style.background = "transparent";
      wrap.style.border = "none";
      wrap.style.boxShadow = "none";
      wrap.style.backdropFilter = "none";
      wrap.style.paddingBottom = "calc(20px + var(--safe-bottom))";
      wrap.appendChild(messageEl);
      wrap.appendChild(continueBtn);
      env.overlay.appendChild(wrap);

      newGame();
      closeIntro = showGameIntro({
        title: "Zug-Quartett",
        description:
          "Du und der Computer bekommen je 10 Zugkarten. Wähle bei deiner obersten Karte eine Eigenschaft (z. B. Höchstgeschwindigkeit) — wer den höheren Wert hat, gewinnt die Runde und kassiert beide Karten. Wer alle Karten hat, gewinnt.",
        onStart: () => {
          closeIntro = null;
        },
      });
    },

    update(dt: number) {
      if (phase === "sliding-in") {
        animTimer += dt;
        if (animTimer >= SLIDE_DURATION) {
          animTimer = SLIDE_DURATION;
          phase = "comparing";
          updateOverlay();
        }
      } else if (phase === "sliding-out") {
        animTimer += dt;
        if (animTimer >= SLIDE_DURATION) {
          animTimer = SLIDE_DURATION;
          finishTransition();
        }
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const topOffset = 122;
      const singleCardWidth = Math.min(size.width - 32, 300);
      const pairCardWidth = Math.min((size.width - 32 - CARD_GAP) / 2, 220);
      const cardHeight = Math.min(size.height - topOffset - 70, 420);
      const singleX = (size.width - singleCardWidth) / 2;
      const pairTotalWidth = pairCardWidth * 2 + CARD_GAP;
      const pairLeftX = (size.width - pairTotalWidth) / 2;
      const pairRightX = pairLeftX + pairCardWidth + CARD_GAP;

      ctx.fillStyle = theme.textMuted;
      ctx.font = `600 12px ${theme.font}`;
      ctx.textAlign = "center";
      ctx.fillText(
        `Computer: ${cpuDeck.length} Karten${pot.length > 0 ? `  ·  Pot: ${pot.length}` : ""}  ·  Du: ${playerDeck.length} Karten`,
        size.width / 2,
        topOffset - 12,
      );

      const drawLabel = (text: string, rect: Rect) => {
        ctx.fillStyle = theme.textFaint;
        ctx.font = `700 10px ${theme.font}`;
        ctx.textAlign = "left";
        ctx.fillText(text, rect.x + 4, rect.y - 6);
      };

      if (phase === "reveal-player") {
        const playerCard = playerDeck[0];
        if (playerCard) {
          const rect: Rect = { x: singleX, y: topOffset, width: singleCardWidth, height: cardHeight };
          drawCardFace(ctx, rect, playerCard, { interactive: true, highlightStat: null });
          ctx.fillStyle = theme.textFaint;
          ctx.font = `500 11px ${theme.font}`;
          ctx.textAlign = "center";
          ctx.fillText("Tippe eine Eigenschaft an, um sie zu vergleichen", size.width / 2, rect.y + rect.height + 20);
        }
        return;
      }

      if (phase === "game-over") return;
      if (!displayedPlayerCard || !displayedCpuCard) return;

      if (phase === "sliding-in") {
        const t = easeOutCubic(animTimer / SLIDE_DURATION);
        const playerRect: Rect = {
          x: lerp(singleX, pairLeftX, t),
          y: topOffset,
          width: lerp(singleCardWidth, pairCardWidth, t),
          height: cardHeight,
        };
        const cpuRect: Rect = { x: lerp(size.width, pairRightX, t), y: topOffset, width: pairCardWidth, height: cardHeight };
        drawLabel("DU", playerRect);
        drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, highlightStat: null });
        drawLabel("COMPUTER", cpuRect);
        drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, highlightStat: null });
      } else if (phase === "comparing") {
        const playerRect: Rect = { x: pairLeftX, y: topOffset, width: pairCardWidth, height: cardHeight };
        const cpuRect: Rect = { x: pairRightX, y: topOffset, width: pairCardWidth, height: cardHeight };
        drawLabel("DU", playerRect);
        drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, opponent: displayedCpuCard, highlightStat: chosenStat });
        drawLabel("COMPUTER", cpuRect);
        drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, opponent: displayedPlayerCard, highlightStat: chosenStat });
      } else if (phase === "sliding-out") {
        const t = easeOutCubic(animTimer / SLIDE_DURATION);
        const playerRect: Rect = { x: lerp(pairLeftX, -pairCardWidth - 30, t), y: topOffset, width: pairCardWidth, height: cardHeight };
        const cpuRect: Rect = {
          x: lerp(pairRightX, singleX, t),
          y: topOffset,
          width: lerp(pairCardWidth, singleCardWidth, t),
          height: cardHeight,
        };
        drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, opponent: displayedCpuCard, highlightStat: chosenStat });
        drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, opponent: displayedPlayerCard, highlightStat: chosenStat });
      }
    },

    onPointerDown(p: PointerPoint) {
      if (phase !== "reveal-player") return;
      for (const { stat, rect } of statRects) {
        if (p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height) {
          handleStatChoice(stat);
          return;
        }
      }
    },

    cleanup() {
      closeIntro?.();
      closeIntro = null;
      continueBtn?.removeEventListener("click", handleContinue);
      continueBtn?.parentElement?.remove();
      messageEl = null;
      continueBtn = null;
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Zug-Quartett",
  subtitle: "Top-Trumps mit 20 echten Zügen",
  icon: "cards",
  badge: "ZQ",
  accent: "#7e5330",
  create: createTrainQuartetGame,
});
