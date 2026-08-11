import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { checkTicketEligibility, isTicketEligible, describeTicketReason, primaryTicketReason, recordDailyBestIfApplicable } from "../../core/ticketMethods";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { buildMenuButton } from "../../core/menuButton";
import { guardedClick } from "../../core/guardedClick";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { registerGame } from "../registry";

/**
 * "Hüpftier-Glück" -- klassischer Ein-Arm-Bandit (drei Walzen statt
 * Kirschen/Glocken/Sieben eben Hüpftiere), rein mit Spielpunkten statt
 * echtem Geld (siehe Datei-Kommentar unten zum Highscore-Modell). Bewusst
 * fast komplett per DOM/CSS statt Canvas umgesetzt (aehnlich games/dj-mixer)
 * -- fuer Walzen-Bildersymbole und die Dreh-Animation (CSS-Transition) ist
 * das einfacher und zuverlaessiger als eigenes Canvas-Sprite-Scrolling.
 *
 * Spielmechanik/Balancing (zweite Fassung, nach Nutzerfeedback "wirkt nicht
 * gebalanced" -- war vorher: JEDE Zwei-Gleiche-Kombination (irgendwo unter
 * den drei Walzen, nicht nur nebeneinander) zahlte das Dreifache des
 * Einsatzes bei ~49% Trefferwahrscheinlichkeit):
 *
 * - Gewinnregel wie bei echten Automaten ueblich: nur eine von links
 *   beginnende, ZUSAMMENHAENGENDE Kette zaehlt (Walze 1 = Walze 2, optional
 *   auch Walze 3). Das ergibt eine Trefferquote von ca. 21% (realistische
 *   "hit frequency" echter Slots liegt laut Recherche meist bei 20-35%).
 * - Auszahlungstabelle (siehe SYMBOLS) so gerechnet, dass die
 *   Gesamt-Auszahlungsquote (RTP) im Basisspiel bei ca. 77-78% liegt --
 *   vergleichbar mit klassischen Spielautomaten. Seltene Symbole zahlen bei
 *   drei Gleichen ueberproportional mehr (bis zum "Jackpot" beim seltenen
 *   Elefanten), haeufige Symbole entsprechend wenig ("Volatilitaet").
 *
 * Dritte Fassung (Nutzerwunsch): vor jeder Runde gibt es jetzt eine
 * Investitionsphase (siehe INVEST_OPTIONS) -- 100 "Credits" (eine von den
 * in der Runde erspielten "Punkten" bewusst GETRENNTE Waehrung, siehe
 * unten) lassen sich frei auf fuenf Kategorien verteilen, die die
 * kommende Runde unterschiedlich beeinflussen. Das gibt eine taktische
 * Vorbereitungs-Ebene ("wo investiere ich, um mein Drehen zu optimieren"),
 * ohne die eigentliche Walzen-Mechanik anzutasten.
 *
 * Bewusst NICHT als Investitionsoption enthalten: direkte Extra-Startpunkte
 * ("Credits gegen Punkte eintauschen"). Das wuerde die Highscore-Bestenliste
 * (Basis: hoechster erreichter Punktestand) aushebeln -- wer alles in
 * Startpunkte steckt, haette sofort einen hohen Wert ganz ohne Drehen. Alle
 * fuenf Kategorien unten wirken stattdessen nur INDIREKT (bessere Chancen,
 * hoehere Auszahlung, mehr Versuche) -- der Punktestand muss weiterhin
 * durch tatsaechliches Spielen entstehen.
 */

const GAME_ID = "hopper-slots";

interface Symbol {
  id: string;
  label: string; // Pluralform fuer die Gewinn-Meldung, z.B. "Elefanten"
  image: string;
  payout: number; // Gewinn bei drei Gleichen (Basiswert, vor Jackpot-Bonus)
  weight: number; // Hoehere Zahl = haeufiger auf den Walzen (Basiswert, vor Gluecksstufe)
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
// Walze 1 = Walze 2, aber Walze 3 anders -- kleiner Troestungsgewinn.
const PAIR_PAYOUT_BASE = 2;

const STARTING_POINTS = 10;
const SPIN_COST = 1;
const BASE_SPINS = 8;
const REEL_COUNT = 3;
const REEL_STRIP_LENGTH = 22; // zusaetzliche Symbole vor dem Zielsymbol, fuer den Dreh-Effekt
const REEL_STOP_DELAYS_MS = [900, 1300, 1750]; // je Walze -- klassisches nacheinander-Stoppen
const WIN_GLOW_MS = 900;

// -------------------------------------------------------- Investitionsphase

const INVEST_BUDGET = 100;
// Gewichts-Bonus pro Gluecksstufe, je Symbol (gleiche Reihenfolge wie
// SYMBOLS oben) -- negativ fuer haeufige, positiv fuer seltene Tiere. Bei
// maximaler Stufe (10) verschiebt sich die Verteilung spuerbar in Richtung
// der selteneren/wertvolleren Symbole, ohne sie haeufiger als die
// bisherigen Standard-Symbole zu machen (bewusst kein "Elefant wird
// ploetzlich das haeufigste Tier").
const RARITY_BONUS_PER_LEVEL = [-1.5, -1, 0, 0.5, 1, 1.5];

interface InvestOption {
  id: "spins" | "luck" | "pair" | "jackpot" | "safety";
  label: string;
  costPerUnit: number;
  // Obergrenze in CREDITS (nicht Einheiten) -- entspricht der fruehreren
  // maxUnits * costPerUnit, siehe Datei-Kommentar bei adjustInvest.
  maxCredits: number;
  describe: (units: number) => string;
}

const INVEST_OPTIONS: InvestOption[] = [
  {
    id: "spins",
    label: "Mehr Drehs",
    costPerUnit: 5,
    maxCredits: 100,
    describe: (u) => (u === 0 ? `${BASE_SPINS} Drehs` : `${BASE_SPINS + u} Drehs (+${u})`),
  },
  {
    id: "luck",
    label: "Glücksstufe",
    costPerUnit: 3,
    maxCredits: 30,
    describe: (u) => (u === 0 ? "Seltene Tiere: normal häufig" : `Stufe ${u}/10 -- seltene Tiere häufiger`),
  },
  {
    id: "pair",
    label: "Trostgewinn",
    costPerUnit: 10,
    maxCredits: 50,
    describe: (u) => `${PAIR_PAYOUT_BASE + u} Punkte bei zwei Gleichen`,
  },
  {
    id: "jackpot",
    label: "Jackpot-Bonus",
    costPerUnit: 15,
    maxCredits: 75,
    describe: (u) => (u === 0 ? "Normale Jackpot-Gewinne" : `+${u * 20}% auf alle Drei-Gleiche-Gewinne`),
  },
  {
    id: "safety",
    label: "Sicherheitsnetz",
    costPerUnit: 8,
    maxCredits: 80,
    describe: (u) => (u === 0 ? "Kein Trost bei einer Niete" : `${u}× „+1 Punkt“ bei einer Niete`),
  },
];

function formatPoints(value: number): string {
  return value === 1 ? "1 Punkt" : `${value} Punkte`;
}

function formatCredits(value: number): string {
  return value === 1 ? "1 Credit" : `${value} Credits`;
}

function createHopperSlotsGame(): MinigameModule {
  // -------- Investitionsphase-Zustand (vor jeder Runde neu, siehe startInvestPhase)
  // In CREDITS gefuehrt (nicht Einheiten!) -- siehe Datei-Kommentar bei
  // adjustInvest, warum das wichtig ist. Die tatsaechliche Wirkung
  // (Einheiten) wird erst beim Rundenstart aus den investierten Credits
  // berechnet (siehe confirmInvestAndStart).
  let investRemaining = INVEST_BUDGET;
  const investCredits: Record<InvestOption["id"], number> = { spins: 0, luck: 0, pair: 0, jackpot: 0, safety: 0 };

  // -------- Aus der Investitionsphase abgeleitete, fuer die Runde feste Werte
  let roundTotalSpins = BASE_SPINS;
  let roundPairPayout = PAIR_PAYOUT_BASE;
  let roundJackpotMultiplier = 1;
  let roundLuckLevel = 0;
  let safetyNetCharges = 0;

  // -------- Laufender Rundenzustand
  let balance = STARTING_POINTS;
  let peakBalance = STARTING_POINTS;
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
  let paytableEl: HTMLDivElement;
  let balanceEl: HTMLDivElement;
  let spinsEl: HTMLDivElement;
  let messageEl: HTMLDivElement;
  let spinBtn: HTMLButtonElement;
  let reelStrips: HTMLDivElement[] = [];
  let gameOverPanel: HTMLDivElement;
  let symbolHeight = 90;

  let investPanel: HTMLDivElement;
  let investRemainingEl: HTMLDivElement;
  const investEffectEls = {} as Record<InvestOption["id"], HTMLDivElement>;
  const investSpentEls = {} as Record<InvestOption["id"], HTMLDivElement>;
  const investButtonEls = {} as Record<InvestOption["id"], { minus10: HTMLButtonElement; minus5: HTMLButtonElement; plus5: HTMLButtonElement; plus10: HTMLButtonElement }>;

  function effectiveWeight(symbolIndex: number): number {
    return Math.max(1, SYMBOLS[symbolIndex].weight + RARITY_BONUS_PER_LEVEL[symbolIndex] * roundLuckLevel);
  }

  function pickWeightedSymbol(): Symbol {
    const weights = SYMBOLS.map((_, i) => effectiveWeight(i));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < SYMBOLS.length; i++) {
      r -= weights[i];
      if (r <= 0) return SYMBOLS[i];
    }
    return SYMBOLS[SYMBOLS.length - 1];
  }

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

  /** Gewinntabelle neu zeichnen -- die Drei-Gleiche-Werte haengen vom Jackpot-Bonus der aktuellen Runde ab. */
  function renderPaytable(): void {
    paytableEl.innerHTML = "";
    for (const s of SYMBOLS) {
      const item = document.createElement("div");
      item.className = "hs-paytable__item";
      const img = document.createElement("img");
      img.src = s.image;
      img.alt = "";
      const value = document.createElement("span");
      value.textContent = `×3 = ${Math.round(s.payout * roundJackpotMultiplier)}`;
      item.append(img, value);
      paytableEl.appendChild(item);
    }
  }

  function updateStatusUI(): void {
    balanceEl.textContent = formatPoints(balance);
    spinsEl.textContent = `Dreh ${Math.min(spinsUsed + 1, roundTotalSpins)}/${roundTotalSpins}`;
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

  function triggerWinGlow(): void {
    cabinet.classList.add("hs-cabinet--win-glow");
    if (glowTimer) clearTimeout(glowTimer);
    glowTimer = setTimeout(() => cabinet.classList.remove("hs-cabinet--win-glow"), WIN_GLOW_MS);
  }

  function resolveSpin(targets: Symbol[]): void {
    spinning = false;
    spinsUsed += 1;
    const [a, b, c] = targets;
    let win = 0;
    // Nur eine von links beginnende Kette zaehlt (siehe Datei-Kommentar) --
    // "b === c, aber a anders" ist KEIN Gewinn mehr.
    if (a.id === b.id && b.id === c.id) {
      win = Math.round(a.payout * roundJackpotMultiplier);
      messageEl.textContent = `🎉 Drei ${a.label}! +${win} Punkte`;
      messageEl.classList.add("hs-message--win");
      triggerWinGlow();
    } else if (a.id === b.id) {
      win = roundPairPayout;
      messageEl.textContent = `Zwei Gleiche! +${win} Punkte`;
      messageEl.classList.add("hs-message--win");
      triggerWinGlow();
    } else if (safetyNetCharges > 0) {
      safetyNetCharges -= 1;
      win = 1;
      messageEl.textContent = `Kein Gewinn -- Sicherheitsnetz: +1 Punkt (noch ${safetyNetCharges}×)`;
      messageEl.classList.add("hs-message--win");
    } else {
      messageEl.textContent = "Kein Gewinn -- nochmal!";
    }
    if (win > 0) {
      balance += win;
      peakBalance = Math.max(peakBalance, balance);
    }
    updateStatusUI();

    if (spinsUsed >= roundTotalSpins) {
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
        ? `Nach ${spinsUsed} von ${roundTotalSpins} Drehs leer -- Höchststand: ${formatPoints(peakBalance)}.`
        : `Alle ${roundTotalSpins} Drehs gespielt. Höchststand: ${formatPoints(peakBalance)}, am Ende ${formatPoints(balance)}.`;
    card.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", () => startInvestPhase());
    card.appendChild(again);

    const menuBtn = buildMenuButton(exitGame);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";
    card.appendChild(menuBtn);

    // Highscore-Metrik ist der ENDSTAND am Rundenende, nicht der
    // zwischenzeitliche Hoechststand (peakBalance dient weiterhin nur der
    // Info-Zeile oben in der Detail-Meldung) -- auf ausdruecklichen Wunsch:
    // ein Zwischenhoch, das man wieder verspielt hat, soll nicht als
    // Bestleistung zaehlen.
    const outcome = getHighscoreOutcome(GAME_ID, balance, "higher-better");
    const ticketResult = checkTicketEligibility({ gameId: GAME_ID, value: balance, direction: "higher-better", highscoreOutcome: outcome });
    if (outcome !== "none" || isTicketEligible(ticketResult)) {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        const gameTitle = "Hüpftier-Glück";
        const scoreText = formatPoints(balance);
        const { title, message } = describeTicketReason(
          ticketResult,
          `${scoreText} erreicht — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          gameTitle,
          scoreText,
        );
        closeHighscoreModal = promptHighscoreName({
          title,
          message,
          gameTitle,
          scoreText,
          ticketReason: primaryTicketReason(ticketResult),
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, balance, "higher-better"));
            recordDailyBestIfApplicable(GAME_ID, undefined, name, balance, "higher-better");
          },
        });
      }, 900);
    }
  }

  // ---------------------------------------------------- Investitionsphase

  function updateInvestUI(): void {
    investRemainingEl.textContent = `${formatCredits(investRemaining)} übrig`;
    for (const opt of INVEST_OPTIONS) {
      const credits = investCredits[opt.id];
      const units = Math.floor(credits / opt.costPerUnit);
      investEffectEls[opt.id].textContent = opt.describe(units);
      investSpentEls[opt.id].textContent = credits > 0 ? formatCredits(credits) : "–";
      const btns = investButtonEls[opt.id];
      const canAfford = investRemaining > 0 && credits < opt.maxCredits;
      btns.minus10.disabled = credits <= 0;
      btns.minus5.disabled = credits <= 0;
      btns.plus5.disabled = !canAfford;
      btns.plus10.disabled = !canAfford;
    }
  }

  /**
   * Investiert/entzieht GENAU die angegebene Credit-Zahl (nicht Einheiten!)
   * -- vorherige Fassung nahm den Button-Wert faelschlich als Einheiten-Delta
   * und multiplizierte ihn zusaetzlich mit costPerUnit, wodurch z. B. ein
   * Klick auf "+5" bei "Mehr Drehs" (5 Credits/Einheit) satte 25 Credits
   * abzog statt der versprochenen 5 (gemeldeter Bug). Bei knappem
   * Budget/Kategorie-Limit wird lieber teilweise investiert/entzogen als
   * komplett verweigert (z. B. "+10" bei nur noch 4 uebrigen Credits
   * investiert dann eben nur 4).
   */
  function adjustInvest(id: InvestOption["id"], creditDelta: number): void {
    const opt = INVEST_OPTIONS.find((o) => o.id === id)!;
    const current = investCredits[id];
    let next = Math.max(0, Math.min(opt.maxCredits, current + creditDelta));
    if (next > current) {
      next = Math.min(next, current + investRemaining);
    }
    if (next === current) return;
    investRemaining -= next - current;
    investCredits[id] = next;
    updateInvestUI();
  }

  /** Setzt Investitionsphase + Rundenzustand komplett zurueck und zeigt den Investitions-Bildschirm (auch fuer "Nochmal spielen" -- jede Runde bekommt frische 100 Credits zum Verteilen). */
  function startInvestPhase(): void {
    clearSpinTimers();
    if (glowTimer) clearTimeout(glowTimer);
    glowTimer = null;
    investRemaining = INVEST_BUDGET;
    for (const opt of INVEST_OPTIONS) investCredits[opt.id] = 0;
    gameOver = false;
    gameOverPanel.style.display = "none";
    cabinet.style.display = "none";
    investPanel.style.display = "flex";
    updateInvestUI();
  }

  /** Rechnet die investierten CREDITS je Kategorie in die tatsaechliche Wirkung (Einheiten) fuer die Runde um -- siehe adjustInvest/Datei-Kommentar dort. */
  function investedUnits(id: InvestOption["id"]): number {
    const opt = INVEST_OPTIONS.find((o) => o.id === id)!;
    return Math.floor(investCredits[id] / opt.costPerUnit);
  }

  function confirmInvestAndStart(): void {
    roundTotalSpins = BASE_SPINS + investedUnits("spins");
    roundLuckLevel = investedUnits("luck");
    roundPairPayout = PAIR_PAYOUT_BASE + investedUnits("pair");
    roundJackpotMultiplier = 1 + investedUnits("jackpot") * 0.2;
    safetyNetCharges = investedUnits("safety");

    balance = STARTING_POINTS;
    peakBalance = STARTING_POINTS;
    spinsUsed = 0;
    spinning = false;
    cabinet.classList.remove("hs-cabinet--win-glow");
    messageEl.textContent = "Viel Glück!";
    messageEl.classList.remove("hs-message--win");
    reelStrips.forEach((strip, i) => {
      strip.style.transition = "none";
      strip.style.transform = "translateY(0)";
      renderReel(i, [pickWeightedSymbol()]);
    });
    renderPaytable();
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    updateStatusUI();

    investPanel.style.display = "none";
    cabinet.style.display = "flex";

    // Symbolhoehe erst messen, wenn das Gehaeuse wirklich sichtbar ist --
    // ein "display:none"-Element hat keine Layout-Box, getBoundingClientRect
    // liefert dann ueberall 0 (die Walzen wuerden beim ersten Dreh optisch
    // gar nicht mehr scrollen).
    requestAnimationFrame(() => {
      const first = reelStrips[0]?.querySelector<HTMLImageElement>(".hs-symbol");
      if (first) symbolHeight = first.getBoundingClientRect().height;
    });
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      exitGame = env.exit;

      // ---------------------------------------------------------- Automat
      cabinet = document.createElement("div");
      cabinet.className = "hs-cabinet";
      cabinet.style.display = "none";

      // Leuchtreklame-Kopf mit Deko-Lichtern -- soll auf den ersten Blick
      // wie ein echter Automat statt einer schlichten Box wirken.
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

      const reelsFrame = document.createElement("div");
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

      // Kompakte Gewinntabelle: zeigt, was "drei Gleiche" je Tier bringen --
      // wird nach jeder Investitionsphase neu gezeichnet (siehe
      // renderPaytable), der Jackpot-Bonus veraendert die Werte.
      paytableEl = document.createElement("div");
      paytableEl.className = "hs-paytable";
      cabinet.appendChild(paytableEl);

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

      // -------------------------------------------------- Investitionsbildschirm
      investPanel = document.createElement("div");
      investPanel.className = "hs-cabinet hs-invest";
      investPanel.style.display = "none";

      const investHeader = document.createElement("div");
      investHeader.className = "hs-invest__header";
      const investTitle = document.createElement("div");
      investTitle.className = "hs-marquee__title";
      investTitle.textContent = "SETZE DEINE CREDITS EIN";
      investRemainingEl = document.createElement("div");
      investRemainingEl.className = "hs-readout hs-invest__remaining";
      investHeader.append(investTitle, investRemainingEl);
      investPanel.appendChild(investHeader);

      const investList = document.createElement("div");
      investList.className = "hs-invest__list";
      for (const opt of INVEST_OPTIONS) {
        const row = document.createElement("div");
        row.className = "hs-invest__row";

        const info = document.createElement("div");
        info.className = "hs-invest__info";
        const label = document.createElement("div");
        label.className = "hs-invest__label";
        label.textContent = opt.label;
        const effect = document.createElement("div");
        effect.className = "hs-invest__effect";
        info.append(label, effect);
        investEffectEls[opt.id] = effect;

        // Bewusst AUSSERHALB von "info" und direkt vor den Buttons -- auf
        // ausdruecklichen Wunsch soll man auf einen Blick sehen, wie viel
        // man in eine Kategorie gesteckt hat, direkt neben den Knoepfen, mit
        // denen man das aendert.
        const spent = document.createElement("div");
        spent.className = "hs-invest__spent";
        investSpentEls[opt.id] = spent;

        const controls = document.createElement("div");
        controls.className = "hs-invest__controls";
        const makeBtn = (text: string, delta: number) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "hs-invest__btn";
          btn.textContent = text;
          guardedClick(btn, () => adjustInvest(opt.id, delta), 120);
          controls.appendChild(btn);
          return btn;
        };
        const minus10 = makeBtn("−10", -10);
        const minus5 = makeBtn("−5", -5);
        const plus5 = makeBtn("+5", 5);
        const plus10 = makeBtn("+10", 10);
        investButtonEls[opt.id] = { minus10, minus5, plus5, plus10 };

        row.append(info, spent, controls);
        investList.appendChild(row);
      }
      investPanel.appendChild(investList);

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "hs-spin-btn";
      confirmBtn.textContent = "Los geht's! 🎰";
      guardedClick(confirmBtn, () => confirmInvestAndStart(), 400);
      investPanel.appendChild(confirmBtn);

      env.overlay.appendChild(investPanel);

      // -------------------------------------------------------------- Rest
      gameOverPanel = document.createElement("div");
      gameOverPanel.className = "stage-center-panel";
      gameOverPanel.style.display = "none";
      env.overlay.appendChild(gameOverPanel);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatPoints);
      highscoreBanner.update(getHighscoreBoard(GAME_ID));

      renderPaytable();

      closeIntro = showGameIntro({
        title: "Hüpftier-Glück",
        description: [
          "Vor jeder Runde verteilst du 100 Credits auf Drehs, Glücksstufe & Boni",
          "Zeigen die ersten beiden Walzen dasselbe Tier: kleiner Trostgewinn",
          "Zeigen alle drei Walzen dasselbe Tier: großer Gewinn nach Gewinntabelle",
          "Seltene Tiere (z. B. der Elefant) zahlen deutlich mehr als häufige",
        ],
        onStart: () => {
          closeIntro = null;
          startInvestPhase();
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
      investPanel?.remove();
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
