import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { OnScreenKeyboard } from "../../core/OnScreenKeyboard";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";

const GAME_ID = "count-passengers";

const WINDOW_WIDTH = 40;
const WINDOW_GAP = 12;
const WINDOW_PITCH = WINDOW_WIDTH + WINDOW_GAP;
const CAR_GAP_EVERY = 4; // zusaetzlicher Spalt alle N Fenster (Wagenuebergang)
const CAR_GAP_EXTRA = 20;
const SPEED_PX_S = 145;
const COUNTDOWN_START = 3;

type Phase = "countdown" | "running" | "input" | "result";

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

function createCountPassengersGame(): MinigameModule {
  let windows: number[] = [];
  let actualTotal = 0;
  let trainOffsetX = 0;
  let phase: Phase = "countdown";
  let countdown = COUNTDOWN_START;
  let started = false;

  let panel: HTMLDivElement;
  let promptEl: HTMLDivElement;
  let keyboardHost: HTMLDivElement;
  let keyboard: OnScreenKeyboard | null = null;
  let closeIntro: (() => void) | null = null;

  function resetRound(): void {
    windows = generateWindows();
    actualTotal = windows.reduce((a, b) => a + b, 0);
    trainOffsetX = -trainWidth(windows);
    phase = "countdown";
    countdown = COUNTDOWN_START;
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
  }

  function renderPanel(diff?: number, guess?: number): void {
    panel.innerHTML = "";
    keyboard?.destroy();
    keyboard = null;

    if (phase === "countdown" || phase === "running") {
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

      const again = document.createElement("button");
      again.type = "button";
      again.className = "btn btn--accent";
      again.textContent = "Nochmal";
      again.addEventListener("click", resetRound);
      panel.appendChild(again);
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
      panel = document.createElement("div");
      panel.className = "stage-sheet";
      panel.style.alignItems = "center";
      panel.style.textAlign = "center";
      panel.style.gap = "8px";
      env.overlay.appendChild(panel);

      resetRound();
      closeIntro = showGameIntro({
        title: "Passagiere zählen",
        description:
          "Ein Zug fährt an dir vorbei. Zähle, wie viele Passagiere du hinter den Fenstern siehst, und gib deine Schätzung danach über die Tastatur ein.",
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
      } else if (phase === "running") {
        trainOffsetX += SPEED_PX_S * dt;
        if (trainOffsetX > 20000) return; // Sicherheitsnetz, sollte nie erreicht werden
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const trackY = size.height * 0.6;
      drawTrack(ctx, size, trackY);

      if (!started) {
        // Warten, bis der Anleitungs-Dialog bestaetigt wurde.
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
      closeIntro?.();
      closeIntro = null;
      keyboard?.destroy();
      panel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Passagiere zählen",
  subtitle: "Zähle, wer durchs Fenster fährt",
  icon: "trainWindow",
  accent: "#0a545c",
  create: createCountPassengersGame,
});
