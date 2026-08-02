import type { GameEnv, MinigameModule, PointerPoint } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards, STAT_LABELS, type TrainCard, type TrainStats } from "../../data/trains";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";

const GAME_ID = "train-quartet";
const STAT_KEYS = Object.keys(STAT_LABELS) as (keyof TrainStats)[];
const REVEAL_DELAY = 0.9;

type Phase = "reveal-player" | "comparing" | "round-result" | "game-over";
type Outcome = "player" | "cpu" | "tie";

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
  let revealTimer = 0;
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
    revealTimer = 0;
    updateOverlay();
  }

  function updateOverlay(): void {
    if (!messageEl || !continueBtn) return;
    if (phase === "round-result" && outcome) {
      const text =
        outcome === "player"
          ? "Du gewinnst diese Runde!"
          : outcome === "cpu"
            ? "Der Computer gewinnt diese Runde."
            : "Unentschieden — die Karten wandern in den Pot.";
      messageEl.textContent = text;
      messageEl.style.display = "block";
      continueBtn.style.display = "block";
      continueBtn.textContent = "Nächste Runde";
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
    chosenStat = stat;
    phase = "comparing";
    revealTimer = 0;
    updateOverlay();
  }

  function resolveRound(): void {
    const playerCard = playerDeck[0];
    const cpuCard = cpuDeck[0];
    if (!playerCard || !cpuCard || !chosenStat) return;

    const pv = playerCard.stats[chosenStat];
    const cv = cpuCard.stats[chosenStat];

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

    phase = playerDeck.length === 0 || cpuDeck.length === 0 ? "game-over" : "round-result";
    updateOverlay();
  }

  function handleContinue(): void {
    if (phase === "game-over") {
      newGame();
      return;
    }
    phase = "reveal-player";
    chosenStat = null;
    outcome = null;
    updateOverlay();
  }

  function drawCardBack(ctx: CanvasRenderingContext2D, rect: Rect): void {
    const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.height);
    grad.addColorStop(0, theme.primaryLight);
    grad.addColorStop(1, theme.primaryDark);
    ctx.fillStyle = grad;
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.fill();
    ctx.strokeStyle = theme.panelBorderLight;
    ctx.lineWidth = 1.5;
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.stroke();

    ctx.fillStyle = "rgba(244,247,246,0.85)";
    ctx.font = `700 ${Math.round(rect.height * 0.28)}px ${theme.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NTM", rect.x + rect.width / 2, rect.y + rect.height / 2);
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

  function drawMiniCard(ctx: CanvasRenderingContext2D, rect: Rect, card: TrainCard, highlightStat: keyof TrainStats | null): void {
    ctx.fillStyle = theme.paper;
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.fill();

    const imgRect: Rect = { x: rect.x + 8, y: rect.y + 8, width: 76, height: rect.height - 16 };
    ctx.save();
    roundRect(ctx, imgRect.x, imgRect.y, imgRect.width, imgRect.height, 6);
    ctx.clip();
    ctx.fillStyle = "#0a1d20";
    ctx.fillRect(imgRect.x, imgRect.y, imgRect.width, imgRect.height);
    const img = getImage(card.image);
    if (img.complete && img.naturalWidth > 0) {
      const scale = Math.max(imgRect.width / img.naturalWidth, imgRect.height / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, imgRect.x + (imgRect.width - dw) / 2, imgRect.y + (imgRect.height - dh) / 2, dw, dh);
    }
    ctx.restore();

    ctx.fillStyle = theme.paperText;
    ctx.textAlign = "left";
    ctx.font = `700 13px ${theme.fontDisplay}`;
    ctx.fillText(card.name, imgRect.x + imgRect.width + 10, rect.y + 20);

    if (highlightStat) {
      ctx.font = `600 11px ${theme.font}`;
      ctx.fillStyle = theme.paperMuted;
      ctx.fillText(STAT_LABELS[highlightStat].label, imgRect.x + imgRect.width + 10, rect.y + 40);
      ctx.font = `700 15px ${theme.fontDisplay}`;
      ctx.fillStyle = theme.paperText;
      ctx.fillText(formatStatValue(highlightStat, card.stats[highlightStat]), imgRect.x + imgRect.width + 10, rect.y + 60);
    }
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
      if (phase === "comparing") {
        revealTimer += dt;
        if (revealTimer >= REVEAL_DELAY) {
          resolveRound();
        }
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const topOffset = 68;
      const cardWidth = Math.min(size.width - 32, 300);
      const cardX = (size.width - cardWidth) / 2;

      ctx.fillStyle = theme.textMuted;
      ctx.font = `600 12px ${theme.font}`;
      ctx.textAlign = "center";
      ctx.fillText(
        `Computer: ${cpuDeck.length} Karten${pot.length > 0 ? `  ·  Pot: ${pot.length}` : ""}  ·  Du: ${playerDeck.length} Karten`,
        size.width / 2,
        topOffset - 12,
      );

      const opponentRect: Rect = { x: cardX, y: topOffset, width: cardWidth, height: 92 };
      const cpuCard = cpuDeck[0];
      if (cpuCard) {
        if (phase === "reveal-player") {
          drawCardBack(ctx, opponentRect);
        } else {
          drawMiniCard(ctx, opponentRect, cpuCard, chosenStat);
        }
      }

      const playerCard = playerDeck[0];
      if (playerCard) {
        const playerRect: Rect = {
          x: cardX,
          y: opponentRect.y + opponentRect.height + 16,
          width: cardWidth,
          height: Math.min(size.height - opponentRect.y - opponentRect.height - 44, 380),
        };
        drawCardFace(ctx, playerRect, playerCard, {
          interactive: phase === "reveal-player",
          opponent: phase !== "reveal-player" ? cpuCard : undefined,
          highlightStat: chosenStat,
        });

        if (phase === "reveal-player") {
          ctx.fillStyle = theme.textFaint;
          ctx.font = `500 11px ${theme.font}`;
          ctx.textAlign = "center";
          ctx.fillText("Tippe eine Eigenschaft an, um sie zu vergleichen", size.width / 2, playerRect.y + playerRect.height + 20);
        }
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
