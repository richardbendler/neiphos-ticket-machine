import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { trainCards } from "../../data/trains";
import tramImage from "../../assets/images/trains/tram.jpg";
import { distractorImages } from "../../data/distractors";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { realAnimalImages } from "../../data/realAnimals";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { showGameIntro } from "../../core/gameIntro";
import { fitSquareToContainer } from "../../core/squareFit";
import { icons } from "../../core/icons";
import { registerGame } from "../registry";

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

function createTrainSpotterGame(): MinigameModule {
  let phase: Phase = "theme-select";
  let contentTheme: ContentTheme = "trains";
  let elapsed = 0;
  let cells: Cell[] = [];
  let remainingTargets = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let closeIntro: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let gridHost: HTMLDivElement;
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
    renderDone();
    if (outcome !== "none") {
      const gameName = contentTheme === "trains" ? "den Zug-Spotter" : "den Hüpftierspotter";
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatTime(elapsed)} — ${outcome === "tied-best" ? "eingestellte Bestzeit" : "neue Bestzeit"} für ${gameName}!`,
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, elapsed, "lower-better", board));
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  function renderDone(): void {
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

    doneOverlay.append(title, sub, again, change);
  }

  function showThemeSelect(): void {
    phase = "theme-select";
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
      wrap.className = "stage-center-panel";
      // Extra Abstand oben (136px statt der Basis-30px aus .stage-center-panel),
      // damit das Raster nicht unter die fix positionierte Highscore-Banner-
      // Pille rutscht. Unten dieselbe zusaetzliche Luft (136-86=50px ueber die
      // Kopfleiste hinaus, hier ebenso 50px ueber die Fussleiste hinaus) --
      // sonst waere der Kasten wieder asymmetrisch und die Themen-/
      // Fertig-Ansicht (die diese Reserve gar nicht braucht, sich den Kasten
      // aber mit dem Raster teilt) sichtbar zu tief zentriert (gemeldeter Bug).
      wrap.style.top = "calc(var(--header-h) + 136px + var(--safe-top))";
      wrap.style.bottom = "calc(var(--footer-h) + 50px + var(--safe-bottom))";
      wrap.appendChild(gridHost);
      wrap.appendChild(doneOverlay);
      wrap.appendChild(themeOverlay);
      env.overlay.appendChild(wrap);

      // Haelt das Raster quadratisch UND garantiert, dass es komplett in
      // die verfuegbare Flaeche passt -- auf niedrigen Bildschirmen wuerde
      // reines CSS (Breite bestimmt ueber aspect-ratio die Hoehe) sonst zum
      // Scrollen zwingen, obwohl das Spiel eigentlich ohne Scrollen passen soll.
      stopSquareFit = fitSquareToContainer(gridHost, wrap);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatTime);

      showThemeSelect();
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

      if (phase === "playing" || phase === "done") {
        ctx.textAlign = "center";
        ctx.fillStyle = phase === "playing" ? theme.accent : theme.textFaint;
        ctx.font = `700 40px ${theme.fontDisplay}`;
        // y=175 statt 140: bei aktivem Highscore-Banner (sitzt fix knapp
        // unter dem Header) ragte die groessere Schrift sonst in die
        // Banner-Pille hinein.
        ctx.fillText(formatTime(elapsed), size.width / 2, 175);
      }

      if (phase === "playing") {
        // Vorher 11px -- auf ausdruecklichen Wunsch groesser, war kaum lesbar.
        ctx.font = `700 15px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        const label = contentTheme === "trains" ? "Tippe Züge und Bahnen an" : "Tippe alle Hüpftiere an";
        ctx.fillText(`${label}${remainingTargets > 0 ? ` (noch ${remainingTargets})` : ""}`, size.width / 2, 208);
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

registerGame({
  id: GAME_ID,
  title: "Zug-Spotter",
  subtitle: "Finde alle Züge im Raster",
  note: "auch mit Hüpftieren spielbar",
  icon: "searchGrid",
  badge: "ZS",
  accent: "#0059a4",
  create: createTrainSpotterGame,
  highscoreCategories: [
    { board: "default", label: "Bestzeit", direction: "lower-better", formatValue: formatTime },
    { board: "hopper", label: "Hüpftiere Bestzeit", direction: "lower-better", formatValue: formatTime },
  ],
});
