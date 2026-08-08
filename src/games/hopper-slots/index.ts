import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { buildMenuButton } from "../../core/menuButton";
import { guardedClick } from "../../core/guardedClick";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { registerGame } from "../registry";

/**
 * "Hüpftier-Glücksspiel" -- klassischer Ein-Arm-Bandit (drei Walzen statt
 * Kirschen/Glocken/Sieben eben Hüpftiere), rein mit Spielpunkten statt
 * echtem Geld (siehe Datei-Kommentar unten zum Highscore-Modell). Bewusst
 * fast komplett per DOM/CSS statt Canvas umgesetzt (aehnlich games/dj-mixer)
 * -- fuer Walzen-Bildersymbole und die Dreh-Animation (CSS-Transition) ist
 * das einfacher und zuverlaessiger als eigenes Canvas-Sprite-Scrolling.
 */

const GAME_ID = "hopper-slots";

interface Symbol {
  id: string;
  image: string;
  payout: number; // Gewinn bei drei Gleichen
  weight: number; // Hoehere Zahl = haeufiger auf den Walzen
}

function symbolFor(id: string, payout: number, weight: number): Symbol {
  const card = hopperAnimalCards.find((c) => c.id === id);
  if (!card) throw new Error(`Unbekanntes Huepftier-Symbol: ${id}`);
  return { id, image: card.image, payout, weight };
}

// Sechs Symbole, von haeufig/kleiner Gewinn bis selten/grosser Gewinn --
// klassisches Slot-Prinzip (das seltene Symbol ist der "Jackpot").
const SYMBOLS: Symbol[] = [
  symbolFor("dog-teal", 8, 30),
  symbolFor("horse-brown", 10, 25),
  symbolFor("dino-green", 15, 18),
  symbolFor("giraffe-yellow", 20, 14),
  symbolFor("unicorn-purple", 35, 9),
  symbolFor("elephant-gray", 80, 4),
];
const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
const PAIR_PAYOUT = 3; // zwei Gleiche (egal welche) -- kleiner Troestungsgewinn

const CREDITS_START = 15;
const SPIN_COST = 1;
const REEL_COUNT = 3;
const REEL_STRIP_LENGTH = 22; // zusaetzliche Symbole vor dem Zielsymbol, fuer den Dreh-Effekt
const REEL_STOP_DELAYS_MS = [900, 1300, 1750]; // je Walze -- klassisches nacheinander-Stoppen

function pickWeightedSymbol(): Symbol {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SYMBOLS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

function formatPoints(value: number): string {
  return value === 1 ? "1 Punkt" : `${value} Punkte`;
}

function createHopperSlotsGame(): MinigameModule {
  let balance = CREDITS_START;
  let peakBalance = CREDITS_START;
  let spinning = false;
  let gameOver = false;
  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;
  let exitGame: () => void = () => {};
  let spinTimers: ReturnType<typeof setTimeout>[] = [];

  let machine: HTMLDivElement;
  let balanceEl: HTMLDivElement;
  let messageEl: HTMLDivElement;
  let spinBtn: HTMLButtonElement;
  let reelStrips: HTMLDivElement[] = [];
  let gameOverPanel: HTMLDivElement;
  let symbolHeight = 90;

  function buildStripSymbols(finalSymbol: Symbol): Symbol[] {
    const strip: Symbol[] = [];
    for (let i = 0; i < REEL_STRIP_LENGTH; i++) strip.push(pickWeightedSymbol());
    strip.push(finalSymbol);
    return strip;
  }

  function renderReel(reelIndex: number, symbols: Symbol[]): void {
    const strip = reelStrips[reelIndex];
    strip.innerHTML = "";
    for (const s of symbols) {
      const img = document.createElement("img");
      img.src = s.image;
      img.alt = "";
      img.className = "hs-symbol";
      strip.appendChild(img);
    }
  }

  function updateBalanceUI(): void {
    balanceEl.textContent = formatPoints(balance);
    spinBtn.disabled = spinning || balance < SPIN_COST;
  }

  function clearSpinTimers(): void {
    for (const t of spinTimers) clearTimeout(t);
    spinTimers = [];
  }

  function spin(): void {
    if (spinning || balance < SPIN_COST || gameOver) return;
    spinning = true;
    balance -= SPIN_COST;
    updateBalanceUI();
    messageEl.textContent = "";
    messageEl.classList.remove("hs-message--win");

    const targets = Array.from({ length: REEL_COUNT }, () => pickWeightedSymbol());

    reelStrips.forEach((strip, i) => {
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      renderReel(i, buildStripSymbols(targets[i]));
    });

    // Erzwungenes Reflow, damit der Browser die Reset-Position (transform:
    // translateY(0), transition:none) wirklich ERST anwendet, bevor gleich
    // die Ziel-Transition gesetzt wird -- sonst wuerden beide Aenderungen
    // zu einem einzigen Frame zusammengefasst und die Walze spraenge ohne
    // sichtbaren Dreheffekt direkt zum Ergebnis.
    void machine.offsetHeight;

    reelStrips.forEach((strip, i) => {
      // Der Streifen hat REEL_STRIP_LENGTH Zufallssymbole PLUS das Zielsymbol
      // (Index REEL_STRIP_LENGTH, siehe buildStripSymbols) -- um genau
      // dieses letzte Symbol im Fenster zu zeigen, muss um REEL_STRIP_LENGTH
      // (nicht +1) Symbolhoehen verschoben werden. War vorher um eine
      // Symbolhoehe zu viel, wodurch die Walze am Ende leer/weiss stehen
      // blieb (gemeldeter Bug -- kein Symbol nach dem Dreh sichtbar).
      const distance = REEL_STRIP_LENGTH * symbolHeight;
      strip.style.transition = `transform ${REEL_STOP_DELAYS_MS[i]}ms cubic-bezier(0.15, 0.85, 0.25, 1)`;
      strip.style.transform = `translateY(-${distance}px)`;
    });

    const totalWait = Math.max(...REEL_STOP_DELAYS_MS);
    spinTimers.push(
      setTimeout(() => {
        resolveSpin(targets);
      }, totalWait + 80),
    );
  }

  function resolveSpin(targets: Symbol[]): void {
    spinning = false;
    const [a, b, c] = targets;
    let win = 0;
    if (a.id === b.id && b.id === c.id) {
      win = a.payout;
      messageEl.textContent = `🎉 Drei ${a.id.split("-")[0] === "elephant" ? "Elefanten" : "Gleiche"}! +${win} Punkte`;
    } else if (a.id === b.id || b.id === c.id || a.id === c.id) {
      win = PAIR_PAYOUT;
      messageEl.textContent = `Zwei Gleiche! +${win} Punkte`;
    } else {
      messageEl.textContent = "Kein Gewinn -- nochmal!";
    }
    if (win > 0) {
      balance += win;
      peakBalance = Math.max(peakBalance, balance);
      messageEl.classList.add("hs-message--win");
    }
    updateBalanceUI();

    if (balance < SPIN_COST) {
      triggerGameOver();
    }
  }

  function triggerGameOver(): void {
    if (gameOver) return;
    gameOver = true;
    gameOverPanel.style.display = "flex";
    gameOverPanel.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.3rem";
    title.style.color = theme.danger;
    title.textContent = "Keine Punkte mehr!";
    gameOverPanel.appendChild(title);

    const detail = document.createElement("div");
    detail.style.color = "var(--text-muted)";
    detail.style.margin = "6px 0 14px";
    detail.textContent = `Höchststand in dieser Runde: ${formatPoints(peakBalance)}.`;
    gameOverPanel.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", () => resetGame());
    gameOverPanel.appendChild(again);

    const menuBtn = buildMenuButton(exitGame);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";
    gameOverPanel.appendChild(menuBtn);

    const outcome = getHighscoreOutcome(GAME_ID, peakBalance, "higher-better");
    if (outcome !== "none") {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatPoints(peakBalance)} erreicht — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, peakBalance, "higher-better"));
          },
        });
      }, 900);
    }
  }

  function resetGame(): void {
    clearSpinTimers();
    balance = CREDITS_START;
    peakBalance = CREDITS_START;
    spinning = false;
    gameOver = false;
    gameOverPanel.style.display = "none";
    messageEl.textContent = "Viel Glück!";
    messageEl.classList.remove("hs-message--win");
    reelStrips.forEach((strip, i) => {
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      renderReel(i, [pickWeightedSymbol()]);
    });
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    updateBalanceUI();
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      exitGame = env.exit;

      machine = document.createElement("div");
      machine.className = "hs-machine";

      const reelsRow = document.createElement("div");
      reelsRow.className = "hs-reels";
      reelStrips = [];
      for (let i = 0; i < REEL_COUNT; i++) {
        const window_ = document.createElement("div");
        window_.className = "hs-reel-window";
        const strip = document.createElement("div");
        strip.className = "hs-reel-strip";
        window_.appendChild(strip);
        reelsRow.appendChild(window_);
        reelStrips.push(strip);
      }
      machine.appendChild(reelsRow);

      balanceEl = document.createElement("div");
      balanceEl.className = "hs-balance";
      machine.appendChild(balanceEl);

      messageEl = document.createElement("div");
      messageEl.className = "hs-message";
      machine.appendChild(messageEl);

      spinBtn = document.createElement("button");
      spinBtn.type = "button";
      spinBtn.className = "hs-spin-btn";
      spinBtn.textContent = "🎰 Drehen!";
      guardedClick(spinBtn, () => spin(), 400);
      machine.appendChild(spinBtn);

      env.overlay.appendChild(machine);

      gameOverPanel = document.createElement("div");
      gameOverPanel.className = "stage-center-panel";
      gameOverPanel.style.display = "none";
      env.overlay.appendChild(gameOverPanel);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatPoints);
      highscoreBanner.update(getHighscoreBoard(GAME_ID));

      // Symbolhoehe erst nach dem Einhaengen ins DOM messen (CSS bestimmt
      // die tatsaechliche Groesse responsiv, siehe .hs-symbol in style.css).
      requestAnimationFrame(() => {
        const first = reelStrips[0]?.querySelector<HTMLImageElement>(".hs-symbol");
        if (first) symbolHeight = first.getBoundingClientRect().height;
      });

      resetGame();

      closeIntro = showGameIntro({
        title: "Hüpftier-Glücksspiel",
        description: [
          "Jeder Dreh kostet 1 Punkt",
          "Drei gleiche Hüpftiere = großer Gewinn",
          "Zwei gleiche Hüpftiere = kleiner Trostgewinn",
          "Das seltene Elefanten-Symbol zahlt am meisten",
        ],
        onStart: () => {
          closeIntro = null;
        },
      });
    },

    update() {
      // Reine Eingabe-/Timer-Steuerung, keine laufzeitabhaengige Logik hier.
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);
    },

    cleanup() {
      clearSpinTimers();
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      closeIntro?.();
      closeIntro = null;
      highscoreBanner?.destroy();
      machine?.remove();
      gameOverPanel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Hüpftier-Glücksspiel",
  subtitle: "Drei Hüpftiere in einer Reihe?",
  icon: "hopper",
  badge: "GS",
  accent: "#a53a97",
  create: createHopperSlotsGame,
  highscoreCategories: [{ board: "default", label: "Höchststand", direction: "higher-better", formatValue: formatPoints }],
});
