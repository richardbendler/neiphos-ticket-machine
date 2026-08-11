import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { OnScreenKeyboard } from "../../core/OnScreenKeyboard";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { buildMenuButton } from "../../core/menuButton";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { startTrainChug, stopTrainChug, preloadTrainChug } from "../../core/sound";
import { registerGame } from "../registry";

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

const GAME_ID = "count-passengers";
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer

const WINDOW_WIDTH = 40;
const WINDOW_GAP = 12;
const WINDOW_PITCH = WINDOW_WIDTH + WINDOW_GAP;
const CAR_GAP_EVERY = 4; // zusaetzlicher Spalt alle N Fenster (Wagenuebergang)
const CAR_GAP_EXTRA = 20;
const COUNTDOWN_START = 3;

interface SpeedLevel {
  key: string;
  label: string;
  speedPxS: number;
}

// 10 Geschwindigkeitsstufen, von gut zaehlbar bis kaum noch zu erfassen --
// jede Stufe hat ihren eigenen Highscore (kleinste Abweichung), siehe
// highscoreCategories unten.
const SPEED_LEVELS: SpeedLevel[] = [110, 140, 180, 230, 290, 370, 470, 600, 760, 970].map((speedPxS, i) => ({
  key: String(i + 1),
  label: `Stufe ${i + 1}`,
  speedPxS,
}));

type Phase = "speed-select" | "countdown" | "running" | "input" | "result";

/** Jedes Fenster haelt die Bilder der Huepftiere, die gerade darin sitzen (0-3 Stueck, leeres Array = leeres Fenster). */
type WindowContent = string[];

function randomHopperImage(): string {
  return hopperAnimalCards[Math.floor(Math.random() * hopperAnimalCards.length)].image;
}

// Gesamtzahl Huepftiere bewusst direkt als Zielwert vorgegeben (statt wie
// vorher nur ueber unabhaengige Pro-Fenster-Wahrscheinlichkeiten emergent zu
// ergeben) -- letzteres pendelte sich durchs Gesetz der grossen Zahlen fast
// immer um denselben Mittelwert (~30) ein und war dadurch vorhersehbar.
const MIN_TOTAL = 20;
const MAX_TOTAL = 40;
const MAX_PER_WINDOW = 3;

function generateWindows(): WindowContent[] {
  const count = 16 + Math.floor(Math.random() * 9); // 16-24 Fenster
  const targetTotal = MIN_TOTAL + Math.floor(Math.random() * (MAX_TOTAL - MIN_TOTAL + 1));
  const occupants = new Array(count).fill(0);
  let remaining = Math.min(targetTotal, count * MAX_PER_WINDOW);
  // Zufaellig auf Fenster verteilen (max 3 pro Fenster), bis der Zielwert
  // erreicht ist -- so ist die tatsaechliche Gesamtzahl direkt steuerbar.
  while (remaining > 0) {
    const idx = Math.floor(Math.random() * count);
    if (occupants[idx] < MAX_PER_WINDOW) {
      occupants[idx] += 1;
      remaining -= 1;
    }
  }
  return occupants.map((n) => Array.from({ length: n }, () => randomHopperImage()));
}

function trainWidth(windows: WindowContent[]): number {
  const gaps = Math.floor(windows.length / CAR_GAP_EVERY) * CAR_GAP_EXTRA;
  return windows.length * WINDOW_PITCH + gaps + 40;
}

function classifyResult(diff: number): { text: string; color: string } {
  if (diff === 0) return { text: "Volltreffer! Genau richtig gezählt.", color: theme.success };
  if (diff <= 2) return { text: "Sehr nah dran!", color: theme.success };
  if (diff <= 5) return { text: "Nicht schlecht!", color: theme.accent };
  return { text: "Uff, das war schwer zu zählen, oder?", color: theme.textMuted };
}

function formatDiff(value: number): string {
  return value === 0 ? "genau richtig" : `${value} daneben`;
}

function createCountPassengersGame(): MinigameModule {
  let windows: WindowContent[] = [];
  let actualTotal = 0;
  let trainOffsetX = 0;
  let phase: Phase = "speed-select";
  let countdown = COUNTDOWN_START;
  let started = false;
  let selectedLevel: SpeedLevel | null = null;

  let speedPanel: HTMLDivElement;
  let panel: HTMLDivElement;
  let promptEl: HTMLDivElement;
  let keyboardHost: HTMLDivElement;
  let keyboard: OnScreenKeyboard | null = null;
  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;
  let exitGame: () => void = () => {};

  function renderSpeedPanel(): void {
    speedPanel.innerHTML = "";
    speedPanel.style.display = phase === "speed-select" ? "flex" : "none";
    if (phase !== "speed-select") return;

    const title = document.createElement("div");
    title.className = "stage-sheet__title";
    title.style.fontSize = "1rem";
    title.style.color = "var(--text)";
    title.textContent = "Wie schnell soll der Zug fahren?";
    speedPanel.appendChild(title);

    const desc = document.createElement("p");
    desc.style.color = "var(--text-muted)";
    desc.style.fontSize = "0.85rem";
    desc.style.margin = "0 0 4px";
    desc.textContent = "Je höher die Stufe, desto schwerer lässt sich die Anzahl der Hüpftiere noch erfassen.";
    speedPanel.appendChild(desc);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(5, 1fr)";
    grid.style.gap = "10px";
    grid.style.width = "100%";
    grid.style.maxWidth = "460px";
    for (const level of SPEED_LEVELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      // Gleiches Design wie die Auswahl-Buttons bei Zug-Memory (Ein
      // Spieler/1 gegen 1, Spielfeldgroesse) -- .btn--choice statt der
      // kleinen generischen .btn-Groesse.
      btn.className = "btn btn--choice";
      btn.style.padding = "clamp(10px, 2vh, 18px) 4px";
      btn.textContent = level.label.replace("Stufe ", "");
      btn.addEventListener("click", () => selectSpeed(level));
      grid.appendChild(btn);
    }
    speedPanel.appendChild(grid);
  }

  function selectSpeed(level: SpeedLevel): void {
    selectedLevel = level;
    highscoreBanner.update(getHighscoreBoard(GAME_ID, level.key));
    resetRound();
  }

  function resetRound(): void {
    windows = generateWindows();
    actualTotal = windows.reduce((a, w) => a + w.length, 0);
    trainOffsetX = -trainWidth(windows);
    phase = "countdown";
    countdown = COUNTDOWN_START;
    renderSpeedPanel();
    renderPanel();
  }

  function startInputPhase(): void {
    stopTrainChug();
    phase = "input";
    renderPanel();
  }

  function submitGuess(value: string): void {
    const guess = Number.parseInt(value, 10);
    if (Number.isNaN(guess)) return;
    const diff = Math.abs(guess - actualTotal);
    phase = "result";
    renderPanel(diff, guess);

    if (!selectedLevel) return;
    const level = selectedLevel;
    const outcome = getHighscoreOutcome(GAME_ID, diff, "lower-better", level.key);
    if (outcome !== "none") {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatDiff(diff)} bei ${level.label} — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          gameTitle: "Passagiere zählen",
          scoreText: `${formatDiff(diff)} (${level.label})`,
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, diff, "lower-better", level.key));
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  function renderPanel(diff?: number, guess?: number): void {
    panel.innerHTML = "";
    keyboard?.destroy();
    keyboard = null;

    if (phase === "countdown" || phase === "running" || phase === "speed-select") {
      panel.style.display = "none";
      return;
    }
    panel.style.display = "flex";

    if (phase === "input") {
      promptEl = document.createElement("div");
      promptEl.className = "stage-sheet__title";
      // Deutlich groesser als der Standard-Titel (0.85-1rem) -- das ist die
      // zentrale Frage der Eingabephase, soll auf Anhieb ins Auge fallen.
      promptEl.style.fontSize = "1.35rem";
      promptEl.style.fontWeight = "800";
      promptEl.textContent = "Wie viele Hüpftiere hast du gezählt?";
      panel.appendChild(promptEl);

      keyboardHost = document.createElement("div");
      panel.appendChild(keyboardHost);
      keyboard = new OnScreenKeyboard({
        layout: "numeric",
        maxLength: 3,
        placeholder: "Anzahl",
        submitLabel: "Prüfen",
        // Gleiche Farbe/Schriftart wie die Rundenzahl im Canvas (theme.accent
        // + font-display) -- deutlich groesser als die Standard-Feldschrift,
        // damit die eingetippte Zahl auf Anhieb gut lesbar ist.
        displayFontSize: "2.1rem",
        displayColor: "var(--accent)",
        onSubmit: submitGuess,
      });
      keyboard.mount(keyboardHost);
    } else if (phase === "result" && diff !== undefined && guess !== undefined) {
      const { text, color } = classifyResult(diff);

      const resultTitle = document.createElement("div");
      resultTitle.style.fontFamily = "var(--font-display)";
      resultTitle.style.fontWeight = "700";
      resultTitle.style.fontSize = "1.05rem";
      resultTitle.style.color = color;
      resultTitle.textContent = text;
      panel.appendChild(resultTitle);

      const detail = document.createElement("div");
      detail.style.color = "var(--text-muted)";
      detail.style.fontSize = "0.88rem";
      detail.style.margin = "6px 0 12px";
      detail.textContent =
        diff === 0
          ? `Es waren tatsächlich ${actualTotal} Hüpftiere.`
          : `Tatsächlich waren es ${actualTotal} Hüpftiere. Du warst ${diff} daneben (deine Schätzung: ${guess}).`;
      panel.appendChild(detail);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";

      const again = document.createElement("button");
      again.type = "button";
      again.className = "btn btn--accent";
      again.textContent = "Nochmal";
      again.addEventListener("click", resetRound);
      actions.appendChild(again);

      const changeSpeed = document.createElement("button");
      changeSpeed.type = "button";
      changeSpeed.className = "btn btn--ghost";
      changeSpeed.textContent = "Andere Geschwindigkeit";
      changeSpeed.addEventListener("click", () => {
        phase = "speed-select";
        selectedLevel = null;
        highscoreBanner.update(null);
        renderSpeedPanel();
        renderPanel();
      });
      actions.appendChild(changeSpeed);

      panel.appendChild(actions);

      // Gleiches Design wie der permanente "Menü"-Button oben links (siehe
      // core/menuButton.ts) -- auf ausdruecklichen Wunsch, damit man nach
      // Spielende nicht extra den kleineren, weiter entfernten Kopfleisten-
      // Button treffen muss.
      const menuBtn = buildMenuButton(exitGame);
      menuBtn.style.width = "100%";
      menuBtn.style.marginTop = "8px";
      menuBtn.style.justifyContent = "center";
      panel.appendChild(menuBtn);
    }
  }

  function drawTrack(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, trackY: number): void {
    ctx.strokeStyle = theme.panelBorderLight;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, trackY);
    ctx.lineTo(size.width, trackY);
    ctx.stroke();
    ctx.strokeStyle = theme.panelBorder;
    ctx.lineWidth = 1;
    for (let x = 0; x < size.width; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, trackY + 4);
      ctx.lineTo(x + 12, trackY + 4);
      ctx.stroke();
    }
  }

  function drawTrain(ctx: CanvasRenderingContext2D, offsetX: number, trackY: number): void {
    const bodyHeight = 90;
    const bodyY = trackY - bodyHeight;
    const width = trainWidth(windows);

    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    const r = 14;
    ctx.moveTo(offsetX + r, bodyY);
    ctx.arcTo(offsetX + width, bodyY, offsetX + width, bodyY + bodyHeight, r);
    ctx.arcTo(offsetX + width, bodyY + bodyHeight, offsetX, bodyY + bodyHeight, r);
    ctx.arcTo(offsetX, bodyY + bodyHeight, offsetX, bodyY, r);
    ctx.arcTo(offsetX, bodyY, offsetX + width, bodyY, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(offsetX, bodyY + bodyHeight - 10, width, 6);

    let x = offsetX + 20;
    const winY = bodyY + 20;
    const winH = 40;
    windows.forEach((occupants, i) => {
      // Hell statt frueher dunkel (#0d2b30) -- die Huepftier-Fotos sind
      // ueberwiegend dunkel/kraeftig eingefaerbt und gingen auf dunklem
      // Fensterhintergrund kaum zu erkennen unter. Duenner Rahmen sorgt
      // trotzdem noch fuer eine erkennbare Fensterkante auf dem farbigen
      // Wagenkoerper.
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, x, winY, WINDOW_WIDTH, winH, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, winY, WINDOW_WIDTH, winH, 5);
      ctx.stroke();

      // Gleiche Groesse/Positionen wie die vorherigen reinen Punkte (r=5.5)
      // -- nur eben als winzige Huepftier-Gesichter statt als Farbfleck.
      const dotR = 5.5;
      const positions: Array<[number, number]> = [];
      if (occupants.length === 1) positions.push([0, 0]);
      else if (occupants.length === 2) positions.push([-9, 0], [9, 0]);
      else if (occupants.length >= 3) positions.push([-9, -6], [9, -6], [0, 9]);

      occupants.forEach((image, idx) => {
        const [dx, dy] = positions[idx];
        drawHopperFace(ctx, x + WINDOW_WIDTH / 2 + dx, winY + winH / 2 + dy, dotR, image);
      });

      x += WINDOW_PITCH;
      if ((i + 1) % CAR_GAP_EVERY === 0) x += CAR_GAP_EXTRA;
    });

    const wheelY = bodyY + bodyHeight;
    ctx.fillStyle = "#1a1a1a";
    for (let wx = offsetX + 30; wx < offsetX + width - 20; wx += 70) {
      ctx.beginPath();
      ctx.arc(wx, wheelY, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Zeichnet ein winziges, kreisrund freigestelltes Huepftier-Gesicht an (cx, cy) -- Ersatz fuer den frueheren reinen Farbpunkt. */
  function drawHopperFace(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, imageSrc: string): void {
    const img = getImage(imageSrc);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    if (img.complete && img.naturalWidth > 0) {
      const scale = Math.max((radius * 2) / img.naturalWidth, (radius * 2) / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    } else {
      ctx.fillStyle = "#f4d9a0";
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.restore();
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

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      preloadTrainChug();
      exitGame = env.exit;
      for (const card of hopperAnimalCards) getImage(card.image);

      speedPanel = document.createElement("div");
      speedPanel.className = "stage-center-panel";
      speedPanel.style.alignItems = "center";
      speedPanel.style.textAlign = "center";
      speedPanel.style.gap = "10px";
      env.overlay.appendChild(speedPanel);

      panel = document.createElement("div");
      // .stage-center-panel statt .stage-sheet: das Zahlenfeld (numerische
      // Bildschirmtastatur) kann bei kurzen/breiten Bildschirmen deutlich
      // hoeher werden als die Tastenbreite vermuten laesst (fitNumericKeys
      // bemisst die Tastengroesse nur an der Breite, nicht an der
      // verfuegbaren Hoehe) -- als unten angedockte, nicht scrollbare
      // ".stage-sheet" ragte es dann unten aus dem Bildschirm heraus.
      // ".stage-center-panel" zentriert stattdessen und faellt bei Bedarf
      // auf vertikales Scrollen zurueck (wie bereits bei "speedPanel" oben).
      panel.className = "stage-center-panel";
      panel.style.alignItems = "center";
      panel.style.textAlign = "center";
      panel.style.gap = "8px";
      env.overlay.appendChild(panel);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatDiff);

      renderSpeedPanel();
      renderPanel();

      closeIntro = showGameIntro({
        title: "Passagiere zählen",
        description: [
          "Wähle zuerst eine Geschwindigkeitsstufe",
          "Ein Zug fährt an dir vorbei",
          "Zähle, wie viele Hüpftiere mit dem Zug fahren",
          "Tippe deine Schätzung danach ein",
        ],
        onStart: () => {
          closeIntro = null;
          started = true;
        },
      });
    },

    update(dt: number) {
      if (!started) return;
      if (phase === "countdown") {
        countdown -= dt;
        if (countdown <= 0) {
          phase = "running";
          startTrainChug();
        }
      } else if (phase === "running" && selectedLevel) {
        trainOffsetX += selectedLevel.speedPxS * dt;
        if (trainOffsetX > 20000) return; // Sicherheitsnetz, sollte nie erreicht werden
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const trackY = size.height * 0.6;
      drawTrack(ctx, size, trackY);

      if (!started || phase === "speed-select") {
        // Warten, bis der Anleitungs-Dialog bestaetigt bzw. eine
        // Geschwindigkeit gewaehlt wurde.
      } else if (phase === "countdown") {
        ctx.fillStyle = theme.text;
        ctx.textAlign = "center";
        ctx.font = `700 18px ${theme.fontDisplay}`;
        ctx.fillText("Zähle, wie viele Hüpftiere mit dem Zug fahren!", size.width / 2, trackY - 170);
        ctx.font = `600 15px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText("Der Zug kommt gleich...", size.width / 2, trackY - 135);
        ctx.font = `800 86px ${theme.fontDisplay}`;
        ctx.fillStyle = theme.accent;
        ctx.fillText(`${Math.max(1, Math.ceil(countdown))}`, size.width / 2, trackY - 40);
      } else if (phase === "running") {
        drawTrain(ctx, trainOffsetX, trackY);
        if (trainOffsetX > size.width) {
          startInputPhase();
        }
      }
      // Sonst (u. a. "input"): bewusst NICHTS mehr zeichnen -- hier stand
      // frueher "Der Zug ist durchgefahren." in hellgrauer Schrift auf dem
      // Canvas, das aber je nach Bildschirmgroesse teilweise hinter/neben
      // dem DOM-Panel (Frage + Zahlenfeld + Tastatur) hervorschimmerte und
      // wie liegengebliebener "Geister-Text" wirkte (gemeldet). Die Frage
      // "Wie viele Hüpftiere hast du gezählt?" im Panel selbst sagt ohnehin
      // schon alles Noetige, der Canvas-Text war rein redundant.
    },

    cleanup() {
      stopTrainChug();
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeIntro?.();
      closeIntro = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      keyboard?.destroy();
      speedPanel?.remove();
      panel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Passagiere zählen",
  subtitle: "Wie viele Hüpftiere fahren mit?",
  icon: "trainWindow",
  badge: "PZ",
  accent: "#0a545c",
  create: createCountPassengersGame,
  highscoreCategories: SPEED_LEVELS.map((level) => ({
    board: level.key,
    label: level.label,
    direction: "lower-better",
    formatValue: formatDiff,
  })),
});
