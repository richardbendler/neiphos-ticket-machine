import type { GameEnv, MinigameModule, PointerPoint } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards, STAT_LABELS, type TrainCard, type TrainStats } from "../../data/trains";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { registerGame } from "../registry";

const GAME_ID = "train-quartet";
const STAT_KEYS = Object.keys(STAT_LABELS) as (keyof TrainStats)[];
const CARD_GAP = 12;
const SLIDE_DURATION = 0.45;
// Festes Seitenverhaeltnis (aus der frueheren Basisgroesse 340x460
// abgeleitet) -- Karten behalten dadurch IMMER dieselbe Breite, egal ob
// gerade eine (reveal-player) oder zwei (comparing) nebeneinander stehen.
// Vorher hatte die Paar-Ansicht eine eigene, schmalere Breite (250px statt
// 340px) -- die Karten "sprangen" beim Umschalten sichtbar in der Groesse,
// was ausdruecklich nicht gewuenscht war.
const CARD_ASPECT = 340 / 460;
const MAX_CARD_WIDTH = 340;
// Dauer des kurzen Aufleucht-Effekts am Zielstapel, nachdem die Karten dort
// "gelandet" sind (siehe drawDeckStack/finishTransition).
const STACK_FLASH_DURATION = 0.5;
// Persistente Kartenstapel-Anzeige links (eigenes Deck) und rechts
// (Computer-Deck) neben der Spielkarte, ersetzt die frühere reine Textzeile.
// Basisgroesse bei scale=1 -- render() berechnet daraus einen Skalierungs-
// faktor, der mit dem verfuegbaren Rand-Platz waechst (nie kleiner als 1),
// damit der Stapel auf breiten Bildschirmen den vielen leeren Platz links/
// rechts der Karte tatsaechlich nutzt statt winzig zu bleiben. Bis maximal
// STACK_MAX_VISUAL gezeichnete Karten -- mehr wuerde optisch ueberladen,
// ab da wird nur noch die Zahl groesser, nicht mehr der Stapel.
const STACK_CARD_W = 30;
const STACK_CARD_H = 42;
const STACK_MAX_VISUAL = 10;
const STACK_STEP_Y = 2.6;
const STACK_FAN_X = 0.9;
const STACK_MAX_SCALE = 2.6;
// Klar begrenztes Rundensystem statt "spiele, bis jemand alle Karten hat"
// (kann sich sonst ueber sehr viele Runden ziehen bzw. theoretisch nie
// enden) -- 10 Runden, eine je Startkarte, macht klar erkennbar, wie lange
// das Spiel noch geht.
const TOTAL_ROUNDS = 10;
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer

// Highscore-Metrik ist die gesammelte Kartenzahl am Spielende, nicht die
// Anzahl gewonnener Runden -- das eigentliche Spielprinzip (Top-Trumps) ist
// "Karten sammeln", nicht "moeglichst viele Einzel-Vergleiche fuer sich
// entscheiden" (bei Unentschieden wandern Karten erstmal nur in den Pot und
// werden erst spaeter von jemand anderem "mitgenommen" -- Rundensiege und
// gesammelte Karten sind also nicht 1:1 dasselbe).
function formatCardCount(value: number): string {
  return value === 1 ? "1 Karte" : `${value} Karten`;
}

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
  // Fuer den auf/ab-huepfenden Pfeil beim allerersten Zug jeder Partie
  // (roundsPlayed === 0, siehe render()) -- laeuft einfach durch, kein
  // Reset noetig (Bounce-Phase beim naechsten Spielstart ist irrelevant).
  let tutorialPulseTimer = 0;
  // Schnappschuss der beiden Karten, die gerade verglichen werden --
  // getrennt vom "lebenden" Deck-Zustand (der schon direkt beim Aufdecken
  // mutiert wird), damit sliding-in/comparing/sliding-out immer noch die
  // richtigen Karten zeigen, auch wenn playerDeck[0]/cpuDeck[0] inzwischen
  // schon die naechste Runde meinen.
  let displayedPlayerCard: TrainCard | null = null;
  let displayedCpuCard: TrainCard | null = null;
  // Kurzer Aufleucht-Effekt am Zielstapel, nachdem die Karten dort beim
  // "sliding-out" gelandet sind -- side legt fest, welcher Stapel leuchtet,
  // timer zaehlt bis STACK_FLASH_DURATION hoch (siehe update()/drawDeckStack()).
  let stackFlashSide: "left" | "right" | null = null;
  let stackFlashTimer = 0;
  let statRects: Array<{ stat: keyof TrainStats; rect: Rect }> = [];
  let continueBtn: HTMLButtonElement | null = null;
  let messageEl: HTMLDivElement | null = null;
  let evaluationEl: HTMLDivElement | null = null;
  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let roundsPlayed = 0;
  let playerRoundWins = 0;
  let cpuRoundWins = 0;
  let tieRoundCount = 0;

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
    stackFlashSide = null;
    stackFlashTimer = 0;
    roundsPlayed = 0;
    playerRoundWins = 0;
    cpuRoundWins = 0;
    tieRoundCount = 0;
    highscoreBanner?.update(getHighscoreBoard(GAME_ID));
    updateOverlay();
  }

  function updateOverlay(): void {
    if (!messageEl || !continueBtn || !evaluationEl) return;
    if (phase === "comparing" && outcome) {
      const text =
        outcome === "player"
          ? "Du gewinnst diese Runde!"
          : outcome === "cpu"
            ? "Der Computer gewinnt diese Runde."
            : "Unentschieden — die Karten wandern in den Pot.";
      messageEl.textContent = text;
      messageEl.style.display = "block";
      evaluationEl.style.display = "none";
      continueBtn.style.display = "block";
      continueBtn.textContent = "Weiter";
    } else if (phase === "game-over") {
      const summary =
        playerRoundWins > cpuRoundWins
          ? `🏆 Du gewinnst mit ${playerRoundWins} zu ${cpuRoundWins} Runden!`
          : playerRoundWins < cpuRoundWins
            ? `Der Computer gewinnt mit ${cpuRoundWins} zu ${playerRoundWins} Runden.`
            : `Unentschieden: ${playerRoundWins} zu ${cpuRoundWins} Runden.`;
      messageEl.textContent = summary;
      messageEl.style.display = "block";
      evaluationEl.textContent = `${roundsPlayed} gespielte Runden — ${playerRoundWins} gewonnen, ${cpuRoundWins} verloren, ${tieRoundCount} unentschieden.`;
      evaluationEl.style.display = "block";
      continueBtn.style.display = "block";
      continueBtn.textContent = "Nochmal spielen";
    } else {
      messageEl.style.display = "none";
      evaluationEl.style.display = "none";
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
    roundsPlayed += 1;

    if (pv === cv) {
      outcome = "tie";
      tieRoundCount += 1;
      pot.push(playerCard, cpuCard);
    } else if (pv > cv) {
      outcome = "player";
      playerRoundWins += 1;
      playerDeck.push(...pot, cpuCard, playerCard);
      pot = [];
    } else {
      outcome = "cpu";
      cpuRoundWins += 1;
      cpuDeck.push(...pot, playerCard, cpuCard);
      pot = [];
    }
  }

  function finishTransition(): void {
    // Zielstapel kurz aufleuchten lassen, wenn die Karten wirklich bei
    // jemandem gelandet sind (bei einem Unentschieden wandern sie in den
    // Pot, keiner der beiden Stapel "gewinnt" also etwas).
    if (outcome === "player") {
      stackFlashSide = "left";
      stackFlashTimer = 0;
    } else if (outcome === "cpu") {
      stackFlashSide = "right";
      stackFlashTimer = 0;
    }
    displayedPlayerCard = null;
    displayedCpuCard = null;
    chosenStat = null;
    outcome = null;
    const gameOver = playerDeck.length === 0 || cpuDeck.length === 0 || roundsPlayed >= TOTAL_ROUNDS;
    phase = gameOver ? "game-over" : "reveal-player";
    if (gameOver) finishGame();
    updateOverlay();
  }

  function finishGame(): void {
    const outcomeResult = getHighscoreOutcome(GAME_ID, playerDeck.length, "higher-better");
    if (outcomeResult === "none") return;
    highscoreTimer = setTimeout(() => {
      highscoreTimer = null;
      closeHighscoreModal = promptHighscoreName({
        message: `${formatCardCount(playerDeck.length)} gesammelt — ${outcomeResult === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
        onDone: (name) => {
          closeHighscoreModal = null;
          if (name === null) return;
          highscoreBanner.update(recordHighscore(GAME_ID, name, playerDeck.length, "higher-better"));
        },
      });
    }, HIGHSCORE_POPUP_DELAY_MS);
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

  /**
   * Zeichnet einen einzelnen Kartenstapel (mehrere leicht versetzt gestapelte
   * Kartenrueckseiten, oberste Karte mit Akzent-Streifen) samt Besitzer-
   * Label und Kartenzahl darueber. anchorX ist die horizontale Mitte des
   * Stapels, centerY die vertikale Mitte der gesamten Anzeige (Label +
   * Stapel zusammen) -- dieselbe vertikale Mitte wie die Spielkarte(n) in
   * der Bildschirmmitte, damit der Stapel nicht mehr nur in einem schmalen
   * Kopfbereich klebt, sondern wirklich auf gleicher Hoehe "steht". scale
   * skaliert Kartengroesse, Versatz UND Schrift gemeinsam -- waechst mit
   * dem verfuegbaren Rand-Platz (siehe render()), schrumpft aber nie unter
   * die urspruengliche Basisgroesse (scale >= 1). side steuert nur die
   * Fächer-Richtung (Stapel faechert leicht nach aussen auf), damit linker
   * und rechter Stapel sich optisch spiegeln statt identisch zu wirken.
   * glowStrength (0-1) zeichnet einen kurzen, verblassenden Leuchtring
   * dahinter -- signalisiert "hier sind die Karten gerade angekommen"
   * (siehe stackFlashSide/-Timer).
   */
  function drawDeckStack(
    ctx: CanvasRenderingContext2D,
    anchorX: number,
    centerY: number,
    scale: number,
    count: number,
    side: "left" | "right",
    glowStrength = 0,
  ): void {
    const owner = side === "left" ? "DU" : "COMPUTER";
    const accent = side === "left" ? theme.accent : "#7e5330";

    const cardW = STACK_CARD_W * scale;
    const cardH = STACK_CARD_H * scale;
    const stepY = STACK_STEP_Y * scale;
    const fanX = STACK_FAN_X * scale;
    const maxStackHeight = cardH + (STACK_MAX_VISUAL - 1) * stepY;
    const labelFont = Math.round(12 * scale);
    const countFont = Math.round(10 * scale);

    // Label + Zahl sitzen als fester Block ueber der maximal moeglichen
    // Stapelhoehe -- so bleibt ihre Position stabil, unabhaengig davon, wie
    // hoch der Stapel gerade tatsaechlich ist (waechst nur nach unten in
    // Richtung baseY).
    const baseY = centerY + maxStackHeight / 2;
    const labelY = baseY - maxStackHeight - 18 * scale;
    const countY = baseY - maxStackHeight - 4 * scale;

    if (glowStrength > 0) {
      const glowCx = anchorX;
      const glowCy = baseY - maxStackHeight / 2;
      const glowR = Math.max(cardW, maxStackHeight) * 0.75;
      const grad = ctx.createRadialGradient(glowCx, glowCy, 0, glowCx, glowCy, glowR);
      grad.addColorStop(0, `rgba(255, 215, 90, ${0.55 * glowStrength})`);
      grad.addColorStop(1, "rgba(255, 215, 90, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(glowCx, glowCy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    if (count <= 0) {
      // Leerer Stapel: gestrichelter Platzhalter statt einer "Karte", die
      // es gar nicht mehr gibt.
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      roundRect(ctx, anchorX - cardW / 2, baseY - cardH, cardW, cardH, 5 * scale);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const visual = Math.min(count, STACK_MAX_VISUAL);
      const fanDir = side === "left" ? -1 : 1;
      for (let i = visual - 1; i >= 0; i--) {
        const cardX = anchorX - cardW / 2 + i * fanX * fanDir;
        const cardY = baseY - cardH - i * stepY;
        const isTop = i === 0;
        ctx.fillStyle = isTop ? theme.paper : "#efe8d8";
        roundRect(ctx, cardX, cardY, cardW, cardH, 5 * scale);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        roundRect(ctx, cardX, cardY, cardW, cardH, 5 * scale);
        ctx.stroke();
        if (isTop) {
          ctx.fillStyle = accent;
          roundRect(ctx, cardX + 5 * scale, cardY + 7 * scale, cardW - 10 * scale, 6 * scale, 3 * scale);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    ctx.fillStyle = theme.textMuted;
    ctx.font = `800 ${labelFont}px ${theme.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.fillText(owner, anchorX, labelY);
    ctx.fillStyle = theme.textFaint;
    ctx.font = `600 ${countFont}px ${theme.font}`;
    ctx.fillText(count === 1 ? "1 Karte" : `${count} Karten`, anchorX, countY);
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
    // Vorher 24 -- auf ausdruecklichen Wunsch etwas groesser, damit klarer
    // erkennbar ist, dass die Zeilen antippbare Ziele sind (nicht nur reiner
    // Datentext).
    const rowHeight = 29;
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
      // Gleicher Bildausschnitt-Fokus wie bei Zug-Spotter/Memory (siehe
      // TrainCard.focus) -- ohne den faellt der Zug bei Hochformat-Fotos
      // (z. B. ICE3 vorm Koelner Dom) auch hier aus dem Zuschnitt.
      const [fxRaw, fyRaw] = (card.focus ?? "50% 50%").split(" ");
      const fx = parseFloat(fxRaw) / 100;
      const fy = parseFloat(fyRaw) / 100;
      const dx = imgRect.x - (dw - imgRect.width) * fx;
      const dy = imgRect.y - (dh - imgRect.height) * fy;
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

      evaluationEl = document.createElement("div");
      evaluationEl.style.textAlign = "center";
      evaluationEl.style.color = "var(--text-muted)";
      evaluationEl.style.fontSize = "0.85rem";
      evaluationEl.style.display = "none";

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
      wrap.appendChild(evaluationEl);
      wrap.appendChild(continueBtn);
      env.overlay.appendChild(wrap);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatCardCount);
      highscoreBanner.update(getHighscoreBoard(GAME_ID));

      newGame();
      closeIntro = showGameIntro({
        title: "Zug-Quartett",
        description: [
          "Du und der Computer bekommt je 10 Zugkarten",
          "Ihr spielt 10 Runden",
          "Wähle bei deiner Karte eine Eigenschaft, z. B. Höchstgeschwindigkeit",
          "Der höhere Wert gewinnt die Runde und kassiert beide Karten",
          "Wer nach 10 Runden mehr gewonnen hat, gewinnt",
        ],
        onStart: () => {
          closeIntro = null;
        },
      });
    },

    update(dt: number) {
      tutorialPulseTimer += dt;
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
      if (stackFlashSide) {
        stackFlashTimer += dt;
        if (stackFlashTimer >= STACK_FLASH_DURATION) stackFlashSide = null;
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      // Kartenblock wird innerhalb des verfuegbaren Platzes (unter der Kopf-
      // zeile, ueber dem unteren Rand) platziert -- bewusst NICHT mehr exakt
      // vertikal zentriert (siehe topBias unten), sondern naeher an der
      // Kopfzeile, damit auf hohen Bildschirmen nicht so viel Platz ueber der
      // Karte ungenutzt bleibt. bottomMargin ist grosszuegig genug bemessen,
      // um die (variabel hohe) Rundenergebnis-Box unten IMMER unterzubringen,
      // egal in welcher Phase -- vorher war das nur ein Schaetzwert (70px),
      // der auf mittelgrossen Bildschirmen von der tatsaechlichen Box-Hoehe
      // (Message + Punktzahl + Weiter-Button) ueberschritten wurde und sich
      // sichtbar mit der Karte ueberlagerte (gemeldeter Bug).
      const headerBottom = 232;
      const bottomMargin = 210;
      const availableHeight = Math.max(120, size.height - headerBottom - bottomMargin);
      // Festes Seitenverhaeltnis (CARD_ASPECT) statt getrennter Breiten fuer
      // Einzel-/Paar-Ansicht -- dieselbe cardWidth gilt fuer beide, damit die
      // Karten beim Umschalten nicht mehr sichtbar schmaler/breiter werden.
      const maxPairCardWidth = (size.width - 32 - CARD_GAP) / 2;
      let cardWidth = Math.min(MAX_CARD_WIDTH, maxPairCardWidth);
      let cardHeight = cardWidth / CARD_ASPECT;
      if (cardHeight > availableHeight) {
        cardHeight = availableHeight;
        cardWidth = cardHeight * CARD_ASPECT;
      }
      // topBias < 0.5: die Karte sitzt naeher an der Kopfzeile als an der
      // (grosszuegig bemessenen) unteren Reserve -- auf hohen Bildschirmen
      // sammelt sich der uebrige Leerraum dadurch eher unten statt oben.
      const topBias = 0.18;
      const topOffset = headerBottom + (availableHeight - cardHeight) * topBias;
      const singleX = (size.width - cardWidth) / 2;
      const pairTotalWidth = cardWidth * 2 + CARD_GAP;
      const pairLeftX = (size.width - pairTotalWidth) / 2;
      const pairRightX = pairLeftX + cardWidth + CARD_GAP;

      // Rundenstand -- klar erkennbar, in welcher Runde man ist und wie
      // lange das Spiel (bis TOTAL_ROUNDS) noch geht. Deutlich tiefer als
      // frueher (150 statt 96), sonst ragte der Text hinter die permanente
      // Highscore-Anzeige oben und wirkte halb abgeschnitten. Groessere
      // Schrift, da das der zentrale "wo stehe ich gerade"-Hinweis ist.
      const roundNumber = Math.min(TOTAL_ROUNDS, roundsPlayed + (phase === "reveal-player" ? 1 : 0));
      ctx.fillStyle = theme.accent;
      ctx.font = `800 34px ${theme.fontDisplay}`;
      ctx.textAlign = "center";
      // y=172 statt 150: die groessere Schrift (34px statt vorher 19px)
      // ragte bei 150 bis in die darueberliegende Highscore-Banner-Pille
      // hinein (die sitzt fix knapp unter dem Header, siehe
      // stage-highscore-banner in style.css).
      ctx.fillText(`Runde ${roundNumber} / ${TOTAL_ROUNDS}`, size.width / 2, 172);

      if (pot.length > 0) {
        ctx.fillStyle = theme.textFaint;
        ctx.font = `600 11px ${theme.font}`;
        ctx.textAlign = "center";
        ctx.fillText(`Pot: ${pot.length}`, size.width / 2, 197);
      }

      // Kartenstapel links (DU) und rechts (Computer) -- persistent in jeder
      // Phase sichtbar, wachsen/schrumpfen visuell mit der Kartenzahl UND
      // (per stackScale) mit dem Rand-Platz neben der Spielkarte: auf
      // schmalen Bildschirmen bleibt die Basisgroesse (scale=1) erhalten,
      // auf breiten Bildschirmen mit viel Luft links/rechts der Karte
      // wachsen die Stapel sichtbar mit -- vertikal auf gleicher Mitte wie
      // die Karte(n) selbst, nicht mehr nur im schmalen Kopfbereich.
      const sideMargin = Math.max(0, (size.width - pairTotalWidth) / 2);
      const stackWidthScale = Math.max(1, (sideMargin - 24) / (STACK_CARD_W + 20));
      const stackHeightScale = Math.max(1, cardHeight / 280);
      const stackScale = Math.min(STACK_MAX_SCALE, Math.min(stackWidthScale, stackHeightScale));
      const stackCenterY = topOffset + cardHeight / 2;
      // Sicherheitsabstand zum echten Bildschirmrand -- auf sehr schmalen
      // Bildschirmen waere sideMargin/2 sonst kleiner als der halbe (schon
      // auf Basisgroesse skalierte) Stapel bzw. als das breitere "COMPUTER"-
      // Label (34px halbe Breite bei scale=1, empirisch) und wuerde beide
      // am Bildschirmrand abschneiden.
      const stackEdgeSafeAnchor = Math.max((STACK_CARD_W * stackScale) / 2, 34 * stackScale) + 8;
      const leftStackX = Math.max(stackEdgeSafeAnchor, sideMargin / 2);
      const rightStackX = size.width - Math.max(stackEdgeSafeAnchor, sideMargin / 2);
      const leftGlow = stackFlashSide === "left" ? 1 - stackFlashTimer / STACK_FLASH_DURATION : 0;
      const rightGlow = stackFlashSide === "right" ? 1 - stackFlashTimer / STACK_FLASH_DURATION : 0;
      drawDeckStack(ctx, leftStackX, stackCenterY, stackScale, playerDeck.length, "left", leftGlow);
      drawDeckStack(ctx, rightStackX, stackCenterY, stackScale, cpuDeck.length, "right", rightGlow);

      const drawLabel = (text: string, rect: Rect) => {
        ctx.fillStyle = theme.textFaint;
        ctx.font = `700 10px ${theme.font}`;
        ctx.textAlign = "left";
        ctx.fillText(text, rect.x + 4, rect.y - 6);
      };

      if (phase === "reveal-player") {
        const playerCard = playerDeck[0];
        if (playerCard) {
          const rect: Rect = { x: singleX, y: topOffset, width: cardWidth, height: cardHeight };
          drawCardFace(ctx, rect, playerCard, { interactive: true, highlightStat: null });

          if (roundsPlayed === 0) {
            // Grosser, sanft huepfender Pfeil + fette Anzeige beim allerersten
            // Zug JEDER Partie (nicht nur beim allerersten Mal ueberhaupt) --
            // auf Anhieb soll klar sein, dass die Statzeilen auf der Karte
            // selbst antippbar sind.
            const bounce = Math.sin(tutorialPulseTimer * 3.4) * 6;
            const arrowCenterX = size.width / 2;
            const arrowTopY = rect.y + rect.height + 14 + bounce;
            ctx.fillStyle = theme.accent;
            ctx.beginPath();
            ctx.moveTo(arrowCenterX, arrowTopY);
            ctx.lineTo(arrowCenterX - 15, arrowTopY + 16);
            ctx.lineTo(arrowCenterX - 6, arrowTopY + 16);
            ctx.lineTo(arrowCenterX - 6, arrowTopY + 28);
            ctx.lineTo(arrowCenterX + 6, arrowTopY + 28);
            ctx.lineTo(arrowCenterX + 6, arrowTopY + 16);
            ctx.lineTo(arrowCenterX + 15, arrowTopY + 16);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = theme.accent;
            ctx.font = `800 19px ${theme.fontDisplay}`;
            ctx.textAlign = "center";
            ctx.fillText("Wähle eine Eigenschaft!", size.width / 2, arrowTopY + 54);
          } else {
            ctx.fillStyle = theme.textMuted;
            ctx.font = `700 15px ${theme.fontDisplay}`;
            ctx.textAlign = "center";
            ctx.fillText("Tippe eine Eigenschaft an, um sie zu vergleichen", size.width / 2, rect.y + rect.height + 24);
          }
        }
        return;
      }

      if (phase === "game-over") return;
      if (!displayedPlayerCard || !displayedCpuCard) return;

      if (phase === "sliding-in") {
        const t = easeOutCubic(animTimer / SLIDE_DURATION);
        const playerRect: Rect = { x: lerp(singleX, pairLeftX, t), y: topOffset, width: cardWidth, height: cardHeight };
        const cpuRect: Rect = { x: lerp(size.width, pairRightX, t), y: topOffset, width: cardWidth, height: cardHeight };
        drawLabel("DU", playerRect);
        drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, highlightStat: null });
        drawLabel("COMPUTER", cpuRect);
        drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, highlightStat: null });
      } else if (phase === "comparing") {
        const playerRect: Rect = { x: pairLeftX, y: topOffset, width: cardWidth, height: cardHeight };
        const cpuRect: Rect = { x: pairRightX, y: topOffset, width: cardWidth, height: cardHeight };
        drawLabel("DU", playerRect);
        drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, opponent: displayedCpuCard, highlightStat: chosenStat });
        drawLabel("COMPUTER", cpuRect);
        drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, opponent: displayedPlayerCard, highlightStat: chosenStat });
      } else if (phase === "sliding-out") {
        const t = easeOutCubic(animTimer / SLIDE_DURATION);
        // Beide Karten fliegen gemeinsam zum Stapel der/des Gewinnenden
        // (links = eigener Stapel, rechts = Computer) statt wie vorher fest
        // "Spielerkarte nach links raus, Computerkarte wird neue Mittelkarte"
        // unabhaengig vom Ergebnis zu animieren. Bei einem Unentschieden
        // (Karten wandern in den Pot, gehoeren also niemandem) bleibt der
        // bisherige neutrale Ablauf erhalten.
        if (outcome === "player" || outcome === "cpu") {
          const winnerX = outcome === "player" ? leftStackX : rightStackX;
          const winnerY = stackCenterY;
          const shrink = lerp(1, 0.1, t);
          const w = cardWidth * shrink;
          const h = cardHeight * shrink;
          const playerCx = lerp(pairLeftX + cardWidth / 2, winnerX, t);
          const playerCy = lerp(topOffset + cardHeight / 2, winnerY, t);
          const cpuCx = lerp(pairRightX + cardWidth / 2, winnerX, t);
          const cpuCy = lerp(topOffset + cardHeight / 2, winnerY, t);
          const playerRect: Rect = { x: playerCx - w / 2, y: playerCy - h / 2, width: w, height: h };
          const cpuRect: Rect = { x: cpuCx - w / 2, y: cpuCy - h / 2, width: w, height: h };
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - t * 1.15);
          drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, opponent: displayedCpuCard, highlightStat: chosenStat });
          drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, opponent: displayedPlayerCard, highlightStat: chosenStat });
          ctx.restore();
        } else {
          const playerRect: Rect = { x: lerp(pairLeftX, -cardWidth - 30, t), y: topOffset, width: cardWidth, height: cardHeight };
          const cpuRect: Rect = { x: lerp(pairRightX, singleX, t), y: topOffset, width: cardWidth, height: cardHeight };
          drawCardFace(ctx, playerRect, displayedPlayerCard, { interactive: false, opponent: displayedCpuCard, highlightStat: chosenStat });
          drawCardFace(ctx, cpuRect, displayedCpuCard, { interactive: false, opponent: displayedPlayerCard, highlightStat: chosenStat });
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
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      closeIntro?.();
      closeIntro = null;
      highscoreBanner?.destroy();
      continueBtn?.removeEventListener("click", handleContinue);
      continueBtn?.parentElement?.remove();
      messageEl = null;
      evaluationEl = null;
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
  highscoreCategories: [{ board: "default", label: "Meiste gesammelte Karten", direction: "higher-better", formatValue: formatCardCount }],
});
