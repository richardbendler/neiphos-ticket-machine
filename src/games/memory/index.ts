import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, measurePlayAreaTop, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { fitAspectToContainer } from "../../core/squareFit";
import { icons } from "../../core/icons";
import { buildMenuButton } from "../../core/menuButton";
import { registerGame } from "../registry";

const GAME_ID = "memory";
const MISMATCH_DELAY = 0.8;
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer
// Feste Breite der beiden Spieler-Panels im Duo-Modus (siehe
// updateDuoLayout) -- das Kartenraster ruemt entsprechend ein, damit links
// und rechts sichtbar Platz fuer "Spieler 1"/"Spieler 2" bleibt.
const DUO_PANEL_WIDTH = 148;
const DUO_PANEL_GAP = 14;
const TURN_TOAST_MS = 1900;

function formatMoves(value: number): string {
  return `${value} Züge`;
}

type Mode = "solo" | "duo";
type ContentTheme = "trains" | "hoppers";

interface BoardSize {
  key: string;
  cols: number;
  rows: number;
  difficulty: string;
}

// Beide Themen (Zuege/Huepftiere) bieten bewusst EXAKT dieselben drei
// Spielfeldgroessen an (explizite Vorgabe) -- "schwer" (4x8 = 16 Paare)
// braucht dafuer mindestens 16 klar unterscheidbare Bilder je Thema, siehe
// data/trains.ts (21 Bilder) und data/hopperAnimals.ts.
const SHARED_BOARD_SIZES: Array<Pick<BoardSize, "cols" | "rows" | "difficulty">> = [
  { cols: 4, rows: 3, difficulty: "leicht" },
  { cols: 4, rows: 6, difficulty: "mittel" },
  { cols: 4, rows: 8, difficulty: "schwer" },
];

// Eigene, von den Zug-Boardgroessen getrennte "key"s fuer die Huepftier-
// Varianten, damit sich Highscores der beiden Themen nicht gegenseitig in
// localStorage ueberschreiben (siehe registerGame unten), obwohl cols/rows
// jetzt identisch sind.
const TRAIN_BOARD_SIZES: BoardSize[] = SHARED_BOARD_SIZES.map((s) => ({ ...s, key: `${s.cols}x${s.rows}` }));
const HOPPER_BOARD_SIZES: BoardSize[] = SHARED_BOARD_SIZES.map((s) => ({ ...s, key: `hopper-${s.cols}x${s.rows}` }));

function boardSizesFor(t: ContentTheme): BoardSize[] {
  return t === "trains" ? TRAIN_BOARD_SIZES : HOPPER_BOARD_SIZES;
}

/**
 * Passt cols/rows eines nicht-quadratischen Spielfelds an die tatsaechliche
 * Geraete-Ausrichtung an -- ein Feld, das "hochformatig" definiert ist
 * (mehr Zeilen als Spalten, z. B. 5x8), wird auf einem Querformat-
 * Bildschirm gespiegelt (8x5) angezeigt, und umgekehrt. Quadratische Felder
 * (4x4, 6x6) sind davon nicht betroffen. Standard ist Querformat: nur ein
 * WIRKLICH hochkantiger Bildschirm (Hoehe > Breite) loest die Spiegelung
 * aus, ein (seltener) exakt quadratischer Viewport bleibt beim
 * Querformat-Standard.
 */
function orientedCols(size: BoardSize): { cols: number; rows: number } {
  const viewportIsPortrait = window.innerHeight > window.innerWidth;
  const sizeIsPortraitShaped = size.rows > size.cols;
  const sizeIsLandscapeShaped = size.cols > size.rows;
  if ((viewportIsPortrait && sizeIsLandscapeShaped) || (!viewportIsPortrait && sizeIsPortraitShaped)) {
    return { cols: size.rows, rows: size.cols };
  }
  return { cols: size.cols, rows: size.rows };
}

/** Immer aus den AKTUELL orientierten cols/rows gebildet, nie aus einem statischen Text -- sonst weicht die Anzeige (z.B. Button-Beschriftung) von der tatsaechlich angezeigten Spaltenzahl ab. */
function sizeLabel(size: BoardSize): string {
  const { cols, rows } = orientedCols(size);
  return `${cols} × ${rows} (${size.difficulty})`;
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
  let lastBaseSize: BoardSize | null = null;
  let cards: Card[] = [];
  let flipped: number[] = [];
  let moves = 0;
  let currentPlayer: 1 | 2 = 1;
  let playerScores: [number, number] = [0, 0];
  let resolveTimer = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;
  let exitGame: () => void = () => {};

  let panel: HTMLDivElement;
  let cellButtons: HTMLButtonElement[] = [];
  let gridWrap: HTMLDivElement;
  let gridHost: HTMLDivElement;
  let stopGridFit: (() => void) | null = null;
  let playerPanelLeft: HTMLDivElement;
  let playerPanelRight: HTMLDivElement;
  let turnToastEl: HTMLDivElement;
  let turnToastTimer: ReturnType<typeof setTimeout> | null = null;
  // Y-Position (CSS-Pixel, Canvas-Koordinaten) fuer die "Groesse · Zuege"-
  // Textzeile -- wird in selectSize() ECHT gemessen (siehe measurePlayAreaTop
  // in core/highscoreBanner.ts), nicht mehr fest verdrahtet. Fallback-Wert
  // nur fuer den (nie vorkommenden) Fall, dass render() vor dem ersten
  // selectSize()-Aufruf feuert.
  let moveTextY = 150;

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
      trainsBtn.innerHTML = `<span class="btn__icon">${icons.locomotive}</span>Züge`;
      trainsBtn.addEventListener("click", () => selectTheme("trains"));
      row.appendChild(trainsBtn);

      const hoppersBtn = document.createElement("button");
      hoppersBtn.type = "button";
      hoppersBtn.className = "btn btn--choice";
      hoppersBtn.innerHTML = `<span class="btn__icon">${icons.hopper}</span>Hüpftiere`;
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
        btn.textContent = sizeLabel(size);
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
      again.addEventListener("click", () => lastBaseSize && selectSize(lastBaseSize));

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

      // Gleiches Design wie der permanente "Menü"-Button oben links (siehe
      // core/menuButton.ts) -- auf ausdruecklichen Wunsch, damit man nach
      // Spielende nicht extra den kleineren, weiter entfernten Kopfleisten-
      // Button treffen muss.
      const menuBtn = buildMenuButton(exitGame);
      menuBtn.style.width = "100%";
      menuBtn.style.marginTop = "8px";
      menuBtn.style.justifyContent = "center";
      card.appendChild(menuBtn);
    } else {
      panel.innerHTML = "";
    }
  }

  /**
   * Blendet die beiden Spieler-Panels links/rechts vom Kartenraster ein
   * (Duo-Modus) bzw. wieder aus (Solo-Modus) und rueckt gridWrap
   * entsprechend ein/aus -- auf ausdruecklichen Wunsch: eigene Punktetafel
   * je Spieler statt einer kleinen Textzeile oben, damit auf Anhieb klar
   * ist, wer dran ist (siehe updatePlayerPanels).
   */
  function updateDuoLayout(): void {
    const isDuo = mode === "duo";
    playerPanelLeft.style.display = isDuo ? "flex" : "none";
    playerPanelRight.style.display = isDuo ? "flex" : "none";
    const inset = isDuo ? `${12 + DUO_PANEL_WIDTH + DUO_PANEL_GAP}px` : "12px";
    gridWrap.style.left = inset;
    gridWrap.style.right = inset;
  }

  /** Blendet die Spieler-Panels aus, wenn das Spiel die Spielflaeche verlaesst (Ergebnis-Screen, "Andere Größe"). */
  function hideDuoPanels(): void {
    playerPanelLeft.style.display = "none";
    playerPanelRight.style.display = "none";
  }

  function updatePlayerPanels(): void {
    if (mode !== "duo") return;
    const leftScore = playerPanelLeft.querySelector(".memory-player-panel__score")!;
    const rightScore = playerPanelRight.querySelector(".memory-player-panel__score")!;
    leftScore.textContent = String(playerScores[0]);
    rightScore.textContent = String(playerScores[1]);
    playerPanelLeft.classList.toggle("memory-player-panel--active", currentPlayer === 1);
    playerPanelRight.classList.toggle("memory-player-panel--active", currentPlayer === 2);
  }

  /** Kurzer, selbst verschwindender Hinweis oben, z. B. nach einem Fehlversuch ("Jetzt ist Spieler 2 dran!"). */
  function showTurnToast(text: string): void {
    turnToastEl.textContent = text;
    turnToastEl.classList.add("memory-turn-toast--visible");
    if (turnToastTimer) clearTimeout(turnToastTimer);
    turnToastTimer = setTimeout(() => {
      turnToastTimer = null;
      turnToastEl.classList.remove("memory-turn-toast--visible");
    }, TURN_TOAST_MS);
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
    // Nicht-quadratische Spielfelder (5x8 bzw. 4x5/4x6) sollen zur
    // tatsaechlichen Geraete-Ausrichtung passen -- ein Querformat-Bildschirm
    // (Breite > Hoehe) zeigt sie querformatig (z.B. 8 Spalten x 5 Zeilen)
    // statt wie bisher immer hochformatig, was auf breiten Bildschirmen ein
    // unnoetig schmales, hohes (teils scrollendes) Raster ergab. Auf
    // Hochformat-Geraeten bleibt es beim bisherigen Verhalten. "size" bleibt
    // bewusst die urspruengliche (nicht orientierte) Groesse -- lastBaseSize
    // merkt sie sich fuer den "Nochmal"-Button, der sonst bei einer
    // zwischenzeitlich schon orientierten boardSize erneut orientieren
    // wuerde (bei stabiler Ausrichtung harmlos, aber unsauber).
    lastBaseSize = size;
    boardSize = { ...size, ...orientedCols(size) };
    highscoreBanner.update(mode === "solo" ? getHighscoreBoard(GAME_ID, size.key) : null);
    cards = buildBoard((boardSize.cols * boardSize.rows) / 2, contentTheme);
    flipped = [];
    moves = 0;
    currentPlayer = 1;
    playerScores = [0, 0];
    phase = "playing";
    // Muss VOR fitAspectToContainer() unten passieren -- setzt u.a. die
    // links/rechts-Einrueckung von gridWrap (Platz fuer die Spieler-Panels
    // im Duo-Modus), von der die Groessenberechnung dort ausgeht.
    updateDuoLayout();
    updatePlayerPanels();
    renderGrid();
    stopGridFit?.();
    // Echt gemessen (siehe measurePlayAreaTop) statt fest verdrahtet -- ein
    // geschaetzter Pixel-Wert liess das Spielfeld auf manchen Aufloesungen
    // den Highscore-Banner ueberlappen (gemeldeter Bug). moveTextY sitzt
    // knapp darunter, fuer die "Groesse · Zuege"-Zeile in render() (nur noch
    // im Solo-Modus genutzt -- der Duo-Modus zeigt Punkte/Spielerwechsel
    // jetzt ueber die seitlichen Spieler-Panels, siehe updatePlayerPanels).
    const playAreaTop = measurePlayAreaTop();
    moveTextY = playAreaTop + 26;
    gridWrap.style.top = `${playAreaTop + 44}px`;
    playerPanelLeft.style.top = gridWrap.style.top;
    playerPanelRight.style.top = gridWrap.style.top;
    // Kein kleiner Fest-Deckel mehr (vorher 460px) -- das liess das Raster
    // auf breiteren Bildschirmen winzig in der Mitte haengen, mit riesigen
    // ungenutzten Raendern. 2000px ist grosszuegig genug, um auf jedem
    // realistischen Kiosk-Bildschirm nie selbst zu limitieren -- die
    // tatsaechliche Grenze bleibt der verfuegbare Platz in gridWrap.
    stopGridFit = fitAspectToContainer(gridHost, gridWrap, boardSize.cols, boardSize.rows, 2000);
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
        if (mode === "duo") {
          playerScores[currentPlayer - 1] += 1;
          updatePlayerPanels();
        }
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
    hideDuoPanels();
    renderPanel();
    if (mode !== "solo") return;
    const outcome = getHighscoreOutcome(GAME_ID, moves, "lower-better", boardSize.key);
    if (outcome !== "none") {
      const size = boardSize;
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${moves} Züge auf ${sizeLabel(size)} — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
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
      exitGame = env.exit;
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
      // Kleiner Rand links/rechts (statt 0), damit das Raster nicht bis an
      // die Bildschirmkante reicht -- die eigentliche Groessenbegrenzung
      // (maxWidth bei fitAspectToContainer unten) sorgt dafuer, dass der
      // verfuegbare Platz danach auch wirklich ausgefuellt wird, statt wie
      // zuvor auf 460px gedeckelt zu bleiben.
      gridWrap.style.left = "12px";
      gridWrap.style.right = "12px";
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

      // Spieler-Panels links/rechts vom Kartenraster (nur Duo-Modus, siehe
      // updateDuoLayout/updatePlayerPanels) -- dieselbe vertikale Spanne wie
      // gridWrap (Kopf-/Fusszeile-bewusst), aber feste Breite statt "flex: 1".
      function buildPlayerPanel(playerLabel: string, side: "left" | "right"): HTMLDivElement {
        const el = document.createElement("div");
        el.className = "memory-player-panel";
        el.style.position = "absolute";
        el.style[side] = "12px";
        el.style.top = "calc(var(--header-h) + 96px + var(--safe-top))";
        el.style.bottom = "calc(var(--footer-h) + 16px + var(--safe-bottom))";
        el.style.width = `${DUO_PANEL_WIDTH}px`;
        el.style.display = "none";
        el.innerHTML = `<span class="memory-player-panel__name">${playerLabel}</span><span class="memory-player-panel__score">0</span>`;
        return el;
      }
      playerPanelLeft = buildPlayerPanel("Spieler 1", "left");
      playerPanelRight = buildPlayerPanel("Spieler 2", "right");

      turnToastEl = document.createElement("div");
      turnToastEl.className = "memory-turn-toast";

      env.overlay.appendChild(gridWrap);
      env.overlay.appendChild(playerPanelLeft);
      env.overlay.appendChild(playerPanelRight);
      env.overlay.appendChild(turnToastEl);
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
          if (mode === "duo") {
            currentPlayer = currentPlayer === 1 ? 2 : 1;
            updatePlayerPanels();
            showTurnToast(`Kein Paar -- jetzt ist Spieler ${currentPlayer} dran!`);
          }
          syncGridVisuals();
        }
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      // Duo-Modus zeigt Punkte/Spielerwechsel jetzt ueber die seitlichen
      // DOM-Spieler-Panels (siehe updatePlayerPanels) statt hier auf dem
      // Canvas -- nur die Solo-Zeile bleibt.
      if ((phase === "playing" || phase === "resolving") && boardSize && mode === "solo") {
        ctx.textAlign = "center";
        ctx.fillStyle = theme.textMuted;
        ctx.font = `600 14px ${theme.font}`;
        ctx.fillText(`${sizeLabel(boardSize)} · ${moves} Züge`, size.width / 2, moveTextY);
      }
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      if (turnToastTimer) clearTimeout(turnToastTimer);
      turnToastTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      stopGridFit?.();
      gridWrap?.remove();
      playerPanelLeft?.remove();
      playerPanelRight?.remove();
      turnToastEl?.remove();
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
      label: sizeLabel(size),
      direction: "lower-better" as const,
      formatValue: formatMoves,
    })),
    ...HOPPER_BOARD_SIZES.map((size) => ({
      board: size.key,
      label: `Hüpftiere ${sizeLabel(size)}`,
      direction: "lower-better" as const,
      formatValue: formatMoves,
    })),
  ],
});
