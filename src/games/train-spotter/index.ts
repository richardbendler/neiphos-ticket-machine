import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import tramImage from "../../assets/images/trains/tram.jpg";
import { distractorImages } from "../../data/distractors";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { realAnimalImages } from "../../data/realAnimals";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { checkTicketEligibility, isTicketEligible, describeTicketReason, primaryTicketReason, recordDailyBestIfApplicable } from "../../core/ticketMethods";
import { mountHighscoreBanner, measurePlayAreaTop, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { showGameIntro } from "../../core/gameIntro";
import { fitSquareToContainer } from "../../core/squareFit";
import { icons } from "../../core/icons";
import { buildMenuButton } from "../../core/menuButton";

const GAME_ID = "train-spotter";
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer
const GRID_SIZE = 4;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;
const MIN_TRAINS = 6;
const MAX_TRAINS = 9;
// Bewusst eine feste Zahl (nicht wie bei den Zuegen ein Zufallsbereich): so
// angefragt, damit die Anleitung konkret "5 Huepftiere" sagen kann.
const HOPPER_TARGET_COUNT = 5;
const WRONG_TAP_PENALTY = 1.5;

type ContentTheme = "trains" | "hoppers";

// Bildausschnitt (object-position) je Zugfoto beim quadratischen Zuschnitt --
// siehe TrainCard.focus in data/trains.ts, Default ist Bildmitte. Huepftier-
// Fotos brauchen das nicht (bereits mittig freigestellte Produktfotos).
const FOCUS_BY_IMAGE = new Map(trainCards.map((c) => [c.image, c.focus ?? "50% 50%"]));

interface Cell {
  image: string;
  /** true = gesuchtes Motiv (Zug bzw. Huepftier), false = Ablenker. */
  isTarget: boolean;
  found: boolean;
}

type Phase = "theme-select" | "intro" | "playing" | "done";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildGrid(contentTheme: ContentTheme): Cell[] {
  // Strassenbahn zaehlt wie die S-Bahn (bereits Teil von trainCards) als
  // Bahn/Zug -- war vorher faelschlich nur als Ablenker einsortiert (siehe
  // data/distractors.ts), Leute verwechseln beim Spielen sonst leicht
  // Bahnen/Zuege.
  const targetPool = contentTheme === "trains" ? [...trainCards.map((c) => c.image), tramImage] : hopperAnimalCards.map((c) => c.image);
  const distractorPool = contentTheme === "trains" ? distractorImages : realAnimalImages;
  const targetCount =
    contentTheme === "trains" ? MIN_TRAINS + Math.floor(Math.random() * (MAX_TRAINS - MIN_TRAINS + 1)) : HOPPER_TARGET_COUNT;
  const targetImages = shuffle(targetPool).slice(0, targetCount);
  const distractorCount = CELL_COUNT - targetCount;
  const distractors: string[] = [];
  for (let i = 0; i < distractorCount; i++) {
    distractors.push(distractorPool[Math.floor(Math.random() * distractorPool.length)]);
  }
  const cells: Cell[] = [
    ...targetImages.map((image) => ({ image, isTarget: true, found: false })),
    ...distractors.map((image) => ({ image, isTarget: false, found: false })),
  ];
  return shuffle(cells);
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

export function createTrainSpotterGame(): MinigameModule {
  let phase: Phase = "theme-select";
  let contentTheme: ContentTheme = "trains";
  let elapsed = 0;
  let cells: Cell[] = [];
  let remainingTargets = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let closeIntro: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;
  let exitGame: () => void = () => {};
  // Echt gemessen (siehe core/highscoreBanner.ts#measurePlayAreaTop) --
  // gleiches Muster wie games/count-passengers.
  let cachedPlayAreaTop = 60;
  // Fuer den vh-proportionalen Reserve-Abstand in beginRound() -- muss exakt
  // zur Timer-/Hinweistext-Position in render() passen (dort ueber size.height
  // berechnet), siehe dortigen Kommentar.
  let cachedCanvasHeight = 800;

  let gridHost: HTMLDivElement;
  let gridWrap: HTMLDivElement;
  let doneOverlay: HTMLDivElement;
  let themeOverlay: HTMLDivElement;
  let cellButtons: HTMLButtonElement[] = [];
  let stopSquareFit: (() => void) | null = null;

  function highscoreBoardKey(): string | undefined {
    return contentTheme === "trains" ? undefined : "hopper";
  }

  function renderGrid(): void {
    gridHost.innerHTML = "";
    gridHost.style.setProperty("--cols", String(GRID_SIZE));
    cellButtons = cells.map((cell, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tile-grid__cell";
      const img = document.createElement("img");
      img.src = cell.image;
      img.style.objectPosition = FOCUS_BY_IMAGE.get(cell.image) ?? "50% 50%";
      img.draggable = false;
      btn.appendChild(img);
      btn.addEventListener("click", () => handleTap(i));
      gridHost.appendChild(btn);
      return btn;
    });
  }

  function handleTap(index: number): void {
    if (phase !== "playing") return;
    const cell = cells[index];
    if (cell.found) return;

    if (cell.isTarget) {
      cell.found = true;
      cellButtons[index].classList.add("tile-grid__cell--found");
      remainingTargets -= 1;
      if (remainingTargets === 0) finish();
    } else {
      elapsed += WRONG_TAP_PENALTY;
      cellButtons[index].classList.add("tile-grid__cell--wrong");
      setTimeout(() => cellButtons[index]?.classList.remove("tile-grid__cell--wrong"), 350);
      showPenaltyBadge(cellButtons[index]);
    }
  }

  /**
   * Macht die Zeitstrafe fuer einen Fehltipp sichtbar (statt nur den roten
   * Rahmen) -- sonst wirkt der spuerbare Zeitsprung beim naechsten Blick auf
   * die Uhr wie eine Verzoegerung/ein Bug, war in Tester-Feedback so
   * missverstanden worden (WRONG_TAP_PENALTY ist eine echte Spielmechanik,
   * kein Input-Lag).
   */
  function showPenaltyBadge(cellBtn: HTMLButtonElement): void {
    const badge = document.createElement("span");
    badge.className = "tile-grid__penalty-badge";
    badge.textContent = `+${WRONG_TAP_PENALTY.toString().replace(".", ",")} s`;
    cellBtn.appendChild(badge);
    setTimeout(() => badge.remove(), 700);
  }

  function finish(): void {
    phase = "done";
    const board = highscoreBoardKey();
    const outcome = getHighscoreOutcome(GAME_ID, elapsed, "lower-better", board);
    const ticketResult = checkTicketEligibility({ gameId: GAME_ID, board, value: elapsed, direction: "lower-better", highscoreOutcome: outcome });
    renderDone();
    if (outcome !== "none" || isTicketEligible(ticketResult)) {
      const gameName = contentTheme === "trains" ? "den Zug-Spotter" : "den Hüpftierspotter";
      const gameTitle = contentTheme === "trains" ? "Zug-Spotter" : "Hüpftierspotter";
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        const scoreText = formatTime(elapsed);
        const { title, message } = describeTicketReason(
          ticketResult,
          `${scoreText} — ${outcome === "tied-best" ? "eingestellte Bestzeit" : "neue Bestzeit"} für ${gameName}!`,
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
            highscoreBanner.update(recordHighscore(GAME_ID, name, elapsed, "lower-better", board));
            recordDailyBestIfApplicable(GAME_ID, board, name, elapsed, "lower-better");
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  function renderDone(): void {
    // War hier zwischenzeitlich zurueckgesetzt (gridWrap.style.top/bottom =
    // "") -- doneOverlay teilt sich denselben gridWrap-Container wie das
    // Kachelraster, dessen Groesse per fitSquareToContainer(gridHost, wrap,
    // ...) an genau diesen Container gekoppelt ist. Ein Zuruecksetzen liess
    // "wrap" ploetzlich groesser werden (der waehrend des Spielens reservierte
    // Platz fuer Highscore-Banner/Timer-Text faellt weg), wodurch sich beim
    // Fertigstellen einer Runde sichtbar die Kachelgroesse aenderte
    // (gemeldeter Bug: "sobald der Timer verschwindet, werden die Bilder
    // ploetzlich groesser"). Jetzt bewusst UNVERAENDERT gelassen -- der
    // reservierte Bereich bleibt ueber eine ganze Runde hinweg konstant,
    // "Alle Zuege gefunden!" wirkt dadurch zwar nicht mehr exakt
    // bildschirmmittig, aber die Groessenkonstanz hat auf ausdruecklichen
    // Wunsch Vorrang.
    doneOverlay.style.display = "flex";
    doneOverlay.innerHTML = "";
    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.4rem";
    title.style.color = theme.accent;
    title.textContent = formatTime(elapsed);
    const sub = document.createElement("div");
    sub.style.color = "var(--text-muted)";
    sub.style.margin = "4px 0 14px";
    sub.textContent = contentTheme === "trains" ? "Alle Züge gefunden!" : "Alle Hüpftiere gefunden!";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", beginRound);

    const change = document.createElement("button");
    change.type = "button";
    change.className = "btn";
    change.style.marginTop = "8px";
    change.textContent = "Anderes Thema";
    change.addEventListener("click", showThemeSelect);

    // Gleiches Design wie der permanente "Menü"-Button oben links (siehe
    // core/menuButton.ts) -- auf ausdruecklichen Wunsch, damit man nach
    // Spielende nicht extra den kleineren, weiter entfernten Kopfleisten-
    // Button treffen muss.
    const menuBtn = buildMenuButton(exitGame);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";

    doneOverlay.append(title, sub, again, change, menuBtn);
  }

  function showThemeSelect(): void {
    phase = "theme-select";
    // Setzt einen etwaigen, waehrend des Spielens gemessenen top-Versatz
    // zurueck (siehe beginRound()/renderDone()-Kommentar) -- themeOverlay
    // teilt sich denselben gridWrap-Container, braucht die dortige Reserve
    // fuer Highscore-Banner/Timer-Text aber nicht und wirkte dadurch
    // spuerbar zu tief statt echt vertikal zentriert (gemeldeter/per
    // Screenshot belegter Bug).
    gridWrap.style.top = "";
    gridWrap.style.bottom = "";
    doneOverlay.style.display = "none";
    // display:none statt nur visibility:hidden -- gridHost hat durch
    // fitSquareToContainer eine feste, oft grosse Breite/Hoehe gesetzt und
    // wuerde als Geschwisterelement von themeOverlay in derselben Flex-
    // Spalte (wrap) sonst weiterhin Platz beanspruchen und die
    // Themen-Auswahl aus dem sichtbaren Bereich schieben.
    gridHost.style.display = "none";
    themeOverlay.style.display = "flex";
    themeOverlay.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.2rem";
    title.style.color = "var(--text)";
    title.textContent = "Womit möchtest du spielen?";
    themeOverlay.appendChild(title);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.gap = "10px";
    row.style.width = "100%";
    row.style.maxWidth = "min(92%, 420px)";
    row.style.marginTop = "12px";

    const trainsBtn = document.createElement("button");
    trainsBtn.type = "button";
    trainsBtn.className = "btn btn--choice";
    trainsBtn.innerHTML = `<span class="btn__icon">${icons.locomotive}</span>Züge`;
    trainsBtn.addEventListener("click", () => {
      contentTheme = "trains";
      themeOverlay.style.display = "none";
      beginRound();
    });
    row.appendChild(trainsBtn);

    const hoppersBtn = document.createElement("button");
    hoppersBtn.type = "button";
    hoppersBtn.className = "btn btn--choice";
    hoppersBtn.innerHTML = `<span class="btn__icon">${icons.hopper}</span>Hüpftiere`;
    hoppersBtn.addEventListener("click", () => {
      contentTheme = "hoppers";
      themeOverlay.style.display = "none";
      beginRound();
    });
    row.appendChild(hoppersBtn);

    themeOverlay.appendChild(row);
  }

  function beginRound(): void {
    themeOverlay.style.display = "none";
    gridHost.style.display = "";
    highscoreBanner.update(getHighscoreBoard(GAME_ID, highscoreBoardKey()));
    cachedPlayAreaTop = measurePlayAreaTop();
    // Ersetzt den anfaenglichen vh-Schaetzwert (siehe init()) durch die jetzt
    // bekannte echte Banner-Position + Reserve fuer Timer/Hinweistext (siehe
    // render(), timerY/instructionY dort) -- praeziser als eine reine
    // vh-Vermutung. Beide Summanden sind bewusst proportional zur
    // Canvas-Hoehe (nicht mehr feste px-Werte) und rechnen exakt dieselbe
    // Formel wie render() nach -- vorher fixe "+26+55"-Zuschlaege, die auf
    // hohen Bildschirmen (grosser timerFont/instructionFont, siehe render())
    // nicht mehr reichten: Raster ueberdeckte dann sichtbar Timer UND
    // Hinweistext darunter (gemeldeter Bug).
    const timerY = Math.max(cachedCanvasHeight * 0.22, cachedPlayAreaTop + 26);
    const instructionFont = Math.max(11, Math.min(18, cachedCanvasHeight * 0.022));
    const instructionY = timerY + cachedCanvasHeight * 0.055;
    gridWrap.style.top = `${Math.round(instructionY + instructionFont * 1.3)}px`;
    cells = buildGrid(contentTheme);
    remainingTargets = cells.filter((c) => c.isTarget).length;
    elapsed = 0;
    phase = "intro";
    doneOverlay.style.display = "none";
    renderGrid();
    gridHost.style.visibility = "hidden";

    closeIntro = showGameIntro({
      title: contentTheme === "trains" ? "Zug-Spotter" : "Hüpftierspotter",
      description:
        contentTheme === "trains"
          ? ["Tippe alle Bilder mit Zügen oder Bahnen an", "So schnell wie möglich", "Falsche Tipps kosten Zeit"]
          : [
              `Tippe alle ${HOPPER_TARGET_COUNT} Hüpftiere an`,
              "Nicht mit den echten Tieren verwechseln!",
              "So schnell wie möglich",
              "Falsche Tipps kosten Zeit",
            ],
      startLabel: "Los geht's",
      onStart: () => {
        closeIntro = null;
        phase = "playing";
        gridHost.style.visibility = "visible";
      },
    });
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      exitGame = env.exit;
      cachedCanvasHeight = env.size.height;
      gridHost = document.createElement("div");
      gridHost.className = "tile-grid";

      doneOverlay = document.createElement("div");
      doneOverlay.style.display = "none";
      doneOverlay.style.flexDirection = "column";
      doneOverlay.style.alignItems = "center";
      doneOverlay.style.textAlign = "center";
      doneOverlay.style.marginTop = "10px";

      themeOverlay = document.createElement("div");
      themeOverlay.style.display = "none";
      themeOverlay.style.flexDirection = "column";
      themeOverlay.style.alignItems = "center";
      themeOverlay.style.textAlign = "center";
      themeOverlay.style.marginTop = "10px";

      const wrap = document.createElement("div");
      gridWrap = wrap;
      wrap.className = "stage-center-panel";
      // Extra Abstand oben, damit das Raster nicht unter die Highscore-
      // Banner-Pille + den auf dem Canvas gezeichneten Timer/Hinweistext
      // rutscht (siehe render(), timerY/instructionFont dort). War ein
      // fixer 136px-Zuschlag -- kollidierte auf kleinen Bildschirmen, weil
      // Banner/Timer/Hinweistext inzwischen selbst prozentual (vh-basiert)
      // positioniert sind, ein fixer px-Zuschlag hier aber nicht mitwuchs/
      // -schrumpfte (gemeldeter/per Screenshot belegter Bug). Jetzt ebenfalls
      // vh-basiert, etwas grosszuegiger als die tatsaechliche Textposition
      // (siehe render()) als Sicherheitsabstand. Unten proportional dazu
      // etwas mehr Luft als der .stage-center-panel-Standard, damit der
      // Kasten fuer die Themen-/Fertig-Ansicht (teilt sich denselben Wrap,
      // braucht diese Reserve aber nicht) nicht sichtbar zu tief wirkt.
      wrap.style.top = "calc(var(--header-h) + 30vh + var(--safe-top))";
      wrap.style.bottom = "calc(var(--footer-h) + 6vh + var(--safe-bottom))";
      wrap.appendChild(gridHost);
      wrap.appendChild(doneOverlay);
      wrap.appendChild(themeOverlay);
      env.overlay.appendChild(wrap);

      // Haelt das Raster quadratisch UND garantiert, dass es komplett in
      // die verfuegbare Flaeche passt -- auf niedrigen Bildschirmen wuerde
      // reines CSS (Breite bestimmt ueber aspect-ratio die Hoehe) sonst zum
      // Scrollen zwingen, obwohl das Spiel eigentlich ohne Scrollen passen soll.
      // maxSize explizit angehoben (Standard waere 480px) -- auf grossen
      // Kiosk-Bildschirmen blieb das Raster sonst deutlich kleiner, als der
      // tatsaechlich verfuegbare Platz hergab (gemeldeter Bug), gleicher
      // Wert wie games/memory verwendet.
      stopSquareFit = fitSquareToContainer(gridHost, wrap, 2000);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatTime);

      // "Jetzt spielen" bei einer bestimmten Variante aus dem Highscore-
      // Board (siehe GameEnv#initialBoard) -- ueberspringt die eigene
      // Themenauswahl und startet direkt mit "default" -> Zuege bzw.
      // "hopper" -> Huepftiere (siehe highscoreBoardKey()).
      if (env.initialBoard === "default" || env.initialBoard === "hopper") {
        contentTheme = env.initialBoard === "hopper" ? "hoppers" : "trains";
        beginRound();
      } else {
        showThemeSelect();
      }
    },

    update(dt: number) {
      if (phase === "playing") {
        elapsed += dt;
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);
      cachedCanvasHeight = size.height;

      // Schriftgroesse UND Y-Position waren hier frueher feste px-Werte
      // (40/15px, y=175/208) -- auf einem kurzen Canvas (kleiner Bildschirm)
      // war die Highscore-Banner-Pille (sitzt jetzt selbst prozentual knapp
      // unter dem Header) an einer anderen Stelle als hier fest angenommen,
      // wodurch Timer/Hinweistext sichtbar mit dem darunter liegenden
      // Kachelraster kollidierten (gemeldeter/per Screenshot belegter Bug).
      // Jetzt relativ zur tatsaechlichen Canvas-Hoehe -- muss zur Formel in
      // beginRound() (Startposition des Kachelrasters darunter) passen.
      const timerFont = Math.max(22, Math.min(48, size.height * 0.058));
      // Math.max mit measurePlayAreaTop() -- jeden Frame frisch gemessen
      // (nicht der bei beginRound() zwischengespeicherte Wert), siehe
      // games/count-passengers-Kommentar.
      const timerY = Math.max(size.height * 0.22, measurePlayAreaTop() + 26);
      if (phase === "playing" || phase === "done") {
        ctx.textAlign = "center";
        ctx.fillStyle = phase === "playing" ? theme.accent : theme.textFaint;
        ctx.font = `700 ${timerFont}px ${theme.fontDisplay}`;
        ctx.fillText(formatTime(elapsed), size.width / 2, timerY);
      }

      if (phase === "playing") {
        const instructionFont = Math.max(11, Math.min(18, size.height * 0.022));
        ctx.font = `700 ${instructionFont}px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        const label = contentTheme === "trains" ? "Tippe Züge und Bahnen an" : "Tippe alle Hüpftiere an";
        ctx.fillText(`${label}${remainingTargets > 0 ? ` (noch ${remainingTargets})` : ""}`, size.width / 2, timerY + size.height * 0.055);
      }
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      closeIntro?.();
      closeIntro = null;
      stopSquareFit?.();
      gridHost?.parentElement?.remove();
    },
  };
}

