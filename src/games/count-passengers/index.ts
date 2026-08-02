import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { OnScreenKeyboard } from "../../core/OnScreenKeyboard";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { registerGame } from "../registry";

const GAME_ID = "count-passengers";
const HIGHSCORE_POPUP_DELAY_MS = 2000;

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

function generateWindows(): number[] {
  const count = 16 + Math.floor(Math.random() * 9); // 16-24 Fenster
  const windows: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    if (r < 0.22) windows.push(0);
    else if (r < 0.5) windows.push(1);
    else if (r < 0.8) windows.push(2);
    else windows.push(3);
  }
  return windows;
}

function trainWidth(windows: number[]): number {
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
  let windows: number[] = [];
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
    desc.textContent = "Je höher die Stufe, desto schwerer lässt sich die Anzahl der Passagiere noch erfassen.";
    speedPanel.appendChild(desc);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(5, 1fr)";
    grid.style.gap = "8px";
    grid.style.width = "100%";
    grid.style.maxWidth = "320px";
    for (const level of SPEED_LEVELS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.style.padding = "10px 4px";
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
    actualTotal = windows.reduce((a, b) => a + b, 0);
    trainOffsetX = -trainWidth(windows);
    phase = "countdown";
    countdown = COUNTDOWN_START;
    renderSpeedPanel();
    renderPanel();
  }

  function startInputPhase(): void {
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
          onDone: (name) => {
            closeHighscoreModal = null;
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
      promptEl.textContent = "Wie viele Passagiere hast du gezählt?";
      panel.appendChild(promptEl);

      keyboardHost = document.createElement("div");
      panel.appendChild(keyboardHost);
      keyboard = new OnScreenKeyboard({
        layout: "numeric",
        maxLength: 3,
        placeholder: "Anzahl",
        submitLabel: "Prüfen",
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
          ? `Es waren tatsächlich ${actualTotal} Passagiere.`
          : `Tatsächlich waren es ${actualTotal} Passagiere. Du warst ${diff} daneben (deine Schätzung: ${guess}).`;
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
    windows.forEach((passengers, i) => {
      ctx.fillStyle = "#0d2b30";
      roundRect(ctx, x, winY, WINDOW_WIDTH, winH, 5);
      ctx.fill();

      const dotR = 5.5;
      const positions: Array<[number, number]> = [];
      if (passengers === 1) positions.push([0, 0]);
      else if (passengers === 2) positions.push([-9, 0], [9, 0]);
      else if (passengers >= 3) positions.push([-9, -6], [9, -6], [0, 9]);
      ctx.fillStyle = "#f4d9a0";
      for (const [dx, dy] of positions) {
        ctx.beginPath();
        ctx.arc(x + WINDOW_WIDTH / 2 + dx, winY + winH / 2 + dy, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

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
      speedPanel = document.createElement("div");
      speedPanel.className = "stage-center-panel";
      speedPanel.style.alignItems = "center";
      speedPanel.style.textAlign = "center";
      speedPanel.style.gap = "10px";
      env.overlay.appendChild(speedPanel);

      panel = document.createElement("div");
      panel.className = "stage-sheet";
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
          "Zähle die Passagiere hinter den Fenstern",
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
        if (countdown <= 0) phase = "running";
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
        ctx.fillText("Zähle die Passagiere hinter den Fenstern!", size.width / 2, trackY - 150);
        ctx.font = `600 15px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText("Der Zug kommt gleich...", size.width / 2, trackY - 120);
        ctx.font = `800 48px ${theme.fontDisplay}`;
        ctx.fillStyle = theme.accent;
        ctx.fillText(`${Math.max(1, Math.ceil(countdown))}`, size.width / 2, trackY - 60);
      } else if (phase === "running") {
        drawTrain(ctx, trainOffsetX, trackY);
        if (trainOffsetX > size.width) {
          startInputPhase();
        }
      } else {
        ctx.fillStyle = theme.textFaint;
        ctx.textAlign = "center";
        ctx.font = `500 13px ${theme.font}`;
        ctx.fillText(phase === "input" ? "Der Zug ist durchgefahren." : "", size.width / 2, trackY - 100);
      }
    },

    cleanup() {
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
  subtitle: "Zähle, wer durchs Fenster fährt",
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
