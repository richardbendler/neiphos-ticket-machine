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
 *
 * Spielmechanik/Balancing (zweite Fassung, nach Nutzerfeedback "wirkt nicht
 * gebalanced" -- war vorher: JEDE Zwei-Gleiche-Kombination (irgendwo unter
 * den drei Walzen, nicht nur nebeneinander) zahlte das Dreifache des
 * Einsatzes bei ~49% Trefferwahrscheinlichkeit, macht rechnerisch im
 * Schnitt satten UEBERSCHUSS pro Dreh -- kein Wunder, dass sich das falsch
 * angefuehlt hat):
 *
 * - Gewinnregel jetzt wie bei echten Automaten ueblich: nur eine von links
 *   beginnende, ZUSAMMENHAENGENDE Kette zaehlt (Walze 1 = Walze 2, optional
 *   auch Walze 3) -- "Walze 2 = Walze 3, aber Walze 1 anders" zaehlt NICHT
 *   mehr. Das senkt die Trefferquote auf ca. 21% (realistische
 *   "hit frequency" echter Slots liegt laut Recherche meist bei 20-35%).
 * - Auszahlungstabelle (siehe SYMBOLS) so gerechnet, dass die
 *   Gesamt-Auszahlungsquote (RTP, "Return to Player") bei ca. 77-78% liegt
 *   -- vergleichbar mit klassischen (nicht-online) Spielautomaten (grob
 *   75-95% laut Recherche). Seltene Symbole zahlen bei drei Gleichen
 *   ueberproportional mehr (bis zum "Jackpot" beim seltenen Elefanten),
 *   haeufige Symbole entsprechend wenig -- das ist die klassische
 *   "Volatilitaet"-Idee: viele kleine, seltene grosse Gewinne, statt
 *   gleichmaessig verteilter Auszahlung.
 * - Klar umrissenes Rundenziel (Nutzerwunsch: "es braucht ein Ziel, auf das
 *   man hinarbeitet"): genau TOTAL_SPINS Drehs pro Durchgang, sichtbar als
 *   Fortschrittsanzeige ("Dreh X/20"). Die Runde endet entweder nach dem
 *   letzten Dreh oder vorzeitig, wenn die Punkte nicht mehr fuer einen
 *   weiteren Dreh reichen -- je nachdem, was zuerst eintritt.
 */

const GAME_ID = "hopper-slots";

interface Symbol {
  id: string;
  label: string; // Pluralform fuer die Gewinn-Meldung, z.B. "Elefanten"
  image: string;
  payout: number; // Gewinn bei drei Gleichen
  weight: number; // Hoehere Zahl = haeufiger auf den Walzen
}

function symbolFor(id: string, label: string, payout: number, weight: number): Symbol {
  const card = hopperAnimalCards.find((c) => c.id === id);
  if (!card) throw new Error(`Unbekanntes Huepftier-Symbol: ${id}`);
  return { id, label, image: card.image, payout, weight };
}

// Sechs Symbole, von haeufig/kleinem Gewinn bis selten/Jackpot -- klassisches
// Slot-Prinzip. Payout-Werte siehe Datei-Kommentar oben (RTP ~77-78%,
// Trefferquote ~21%, gerechnet gegen die Gewichte unten).
const SYMBOLS: Symbol[] = [
  symbolFor("dog-teal", "Hunde", 6, 30),
  symbolFor("horse-brown", "Pferde", 8, 25),
  symbolFor("dino-green", "Dinos", 12, 18),
  symbolFor("giraffe-yellow", "Giraffen", 20, 14),
  symbolFor("unicorn-purple", "Einhörner", 40, 9),
  symbolFor("elephant-gray", "Elefanten", 150, 4),
];
const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
// Walze 1 = Walze 2, aber Walze 3 anders -- kleiner Troestungsgewinn.
const PAIR_PAYOUT = 2;

const CREDITS_START = 10;
const SPIN_COST = 1;
const TOTAL_SPINS = 20;
const REEL_COUNT = 3;
const REEL_STRIP_LENGTH = 22; // zusaetzliche Symbole vor dem Zielsymbol, fuer den Dreh-Effekt
const REEL_STOP_DELAYS_MS = [900, 1300, 1750]; // je Walze -- klassisches nacheinander-Stoppen
const WIN_GLOW_MS = 900;

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
  let spinsUsed = 0;
  let spinning = false;
  let gameOver = false;
  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let glowTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;
  let exitGame: () => void = () => {};
  let spinTimers: ReturnType<typeof setTimeout>[] = [];

  let cabinet: HTMLDivElement;
  let reelsFrame: HTMLDivElement;
  let balanceEl: HTMLDivElement;
  let spinsEl: HTMLDivElement;
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

  function updateStatusUI(): void {
    balanceEl.textContent = formatPoints(balance);
    spinsEl.textContent = `Dreh ${Math.min(spinsUsed + 1, TOTAL_SPINS)}/${TOTAL_SPINS}`;
    spinBtn.disabled = spinning || balance < SPIN_COST || gameOver;
  }

  function clearSpinTimers(): void {
    for (const t of spinTimers) clearTimeout(t);
    spinTimers = [];
  }

  function spin(): void {
    if (spinning || balance < SPIN_COST || gameOver) return;
    spinning = true;
    balance -= SPIN_COST;
    updateStatusUI();
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
    void cabinet.offsetHeight;

    reelStrips.forEach((strip, i) => {
      // Der Streifen hat REEL_STRIP_LENGTH Zufallssymbole PLUS das Zielsymbol
      // (Index REEL_STRIP_LENGTH, siehe buildStripSymbols) -- um genau
      // dieses letzte Symbol im Fenster zu zeigen, muss um REEL_STRIP_LENGTH
      // (nicht +1) Symbolhoehen verschoben werden.
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
    spinsUsed += 1;
    const [a, b, c] = targets;
    let win = 0;
    // Nur eine von links beginnende Kette zaehlt (siehe Datei-Kommentar) --
    // "b === c, aber a anders" ist KEIN Gewinn mehr.
    if (a.id === b.id && b.id === c.id) {
      win = a.payout;
      messageEl.textContent = `🎉 Drei ${a.label}! +${win} Punkte`;
    } else if (a.id === b.id) {
      win = PAIR_PAYOUT;
      messageEl.textContent = `Zwei Gleiche! +${win} Punkte`;
    } else {
      messageEl.textContent = "Kein Gewinn -- nochmal!";
    }
    if (win > 0) {
      balance += win;
      peakBalance = Math.max(peakBalance, balance);
      messageEl.classList.add("hs-message--win");
      cabinet.classList.add("hs-cabinet--win-glow");
      if (glowTimer) clearTimeout(glowTimer);
      glowTimer = setTimeout(() => cabinet.classList.remove("hs-cabinet--win-glow"), WIN_GLOW_MS);
    }
    updateStatusUI();

    if (spinsUsed >= TOTAL_SPINS) {
      triggerGameOver("completed");
    } else if (balance < SPIN_COST) {
      triggerGameOver("busted");
    }
  }

  function triggerGameOver(reason: "completed" | "busted"): void {
    if (gameOver) return;
    gameOver = true;
    updateStatusUI();
    gameOverPanel.style.display = "flex";
    gameOverPanel.innerHTML = "";

    // Eigene, bewusst schmal begrenzte Karte statt der Inhalte direkt im
    // (vollbreiten, nur zentrierenden) .stage-center-panel -- ohne das
    // wurden "Nochmal spielen"/"Menü" via width:100% bildschirmbreit
    // (gemeldetes Aussehen: riesige Balken quer ueber den Automaten).
    const card = document.createElement("div");
    card.className = "ticket-card";
    card.style.textAlign = "center";
    card.style.width = "100%";
    card.style.maxWidth = "340px";
    gameOverPanel.appendChild(card);

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.3rem";
    title.style.color = reason === "busted" ? theme.danger : theme.accentDark;
    title.textContent = reason === "busted" ? "Keine Punkte mehr!" : "Runde geschafft!";
    card.appendChild(title);

    const detail = document.createElement("div");
    detail.style.color = "var(--paper-muted)";
    detail.style.margin = "6px 0 14px";
    detail.textContent =
      reason === "busted"
        ? `Nach ${spinsUsed} von ${TOTAL_SPINS} Drehs leer -- Höchststand: ${formatPoints(peakBalance)}.`
        : `Alle ${TOTAL_SPINS} Drehs gespielt. Höchststand: ${formatPoints(peakBalance)}, am Ende ${formatPoints(balance)}.`;
    card.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", () => resetGame());
    card.appendChild(again);

    const menuBtn = buildMenuButton(exitGame);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";
    card.appendChild(menuBtn);

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
    if (glowTimer) clearTimeout(glowTimer);
    glowTimer = null;
    balance = CREDITS_START;
    peakBalance = CREDITS_START;
    spinsUsed = 0;
    spinning = false;
    gameOver = false;
    cabinet.classList.remove("hs-cabinet--win-glow");
    gameOverPanel.style.display = "none";
    messageEl.textContent = "Viel Glück!";
    messageEl.classList.remove("hs-message--win");
    reelStrips.forEach((strip, i) => {
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      renderReel(i, [pickWeightedSymbol()]);
    });
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    updateStatusUI();
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      exitGame = env.exit;

      cabinet = document.createElement("div");
      cabinet.className = "hs-cabinet";

      // Leuchtreklame-Kopf mit Deko-Lichtern -- soll auf den ersten Blick
      // wie ein echter Automat statt einer schlichten Box wirken (Nutzer-
      // wunsch "muss vom Design her wie ein richtiger Automat aussehen").
      const marquee = document.createElement("div");
      marquee.className = "hs-marquee";
      const lightsTop = document.createElement("div");
      lightsTop.className = "hs-marquee__lights";
      for (let i = 0; i < 9; i++) lightsTop.appendChild(document.createElement("span"));
      const marqueeTitle = document.createElement("div");
      marqueeTitle.className = "hs-marquee__title";
      marqueeTitle.textContent = "HÜPFTIER-GLÜCK";
      marquee.append(lightsTop, marqueeTitle);
      cabinet.appendChild(marquee);

      reelsFrame = document.createElement("div");
      reelsFrame.className = "hs-reels-frame";
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
      const payline = document.createElement("div");
      payline.className = "hs-payline";
      reelsFrame.append(reelsRow, payline);
      cabinet.appendChild(reelsFrame);

      // Kompakte Gewinntabelle: zeigt, was "drei Gleiche" je Symbol bringen
      // -- auf ausdruecklichen Wunsch soll die Auszahlung nachvollziehbar
      // sein statt einer Blackbox (echte Automaten zeigen das immer an).
      const paytable = document.createElement("div");
      paytable.className = "hs-paytable";
      for (const s of SYMBOLS) {
        const item = document.createElement("div");
        item.className = "hs-paytable__item";
        const img = document.createElement("img");
        img.src = s.image;
        img.alt = "";
        const value = document.createElement("span");
        value.textContent = `×3 = ${s.payout}`;
        item.append(img, value);
        paytable.appendChild(item);
      }
      cabinet.appendChild(paytable);

      const panel = document.createElement("div");
      panel.className = "hs-panel";
      balanceEl = document.createElement("div");
      balanceEl.className = "hs-readout";
      spinsEl = document.createElement("div");
      spinsEl.className = "hs-readout";
      panel.append(balanceEl, spinsEl);
      cabinet.appendChild(panel);

      messageEl = document.createElement("div");
      messageEl.className = "hs-message";
      cabinet.appendChild(messageEl);

      spinBtn = document.createElement("button");
      spinBtn.type = "button";
      spinBtn.className = "hs-spin-btn";
      spinBtn.textContent = "🎰 Drehen!";
      guardedClick(spinBtn, () => spin(), 400);
      cabinet.appendChild(spinBtn);

      env.overlay.appendChild(cabinet);

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
        title: "Hüpftier-Glück",
        description: [
          `${TOTAL_SPINS} Drehs pro Runde, jeder kostet 1 Punkt -- schaffe einen möglichst hohen Höchststand`,
          "Zeigen die ersten beiden Walzen dasselbe Tier: kleiner Trostgewinn",
          "Zeigen alle drei Walzen dasselbe Tier: großer Gewinn nach Gewinntabelle",
          "Seltene Tiere (z. B. der Elefant) zahlen deutlich mehr als häufige",
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
      if (glowTimer) clearTimeout(glowTimer);
      glowTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      closeIntro?.();
      closeIntro = null;
      highscoreBanner?.destroy();
      cabinet?.remove();
      gameOverPanel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Hüpftier-Glück",
  subtitle: "Hüpft dir dein Glück",
  icon: "hopper",
  badge: "GS",
  accent: "#a53a97",
  create: createHopperSlotsGame,
  highscoreCategories: [{ board: "default", label: "Höchststand", direction: "higher-better", formatValue: formatPoints }],
});
