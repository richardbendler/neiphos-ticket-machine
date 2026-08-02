import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { SOUND_DEFS } from "./sounds";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";

const GAME_ID = "dj-mixer";
const STEP_COUNT = 16;
const LOOKAHEAD_S = 0.12;
const MIN_BPM = 60;
const MAX_BPM = 160;
const DEFAULT_BPM = 100;

interface ScheduledStep {
  step: number;
  time: number;
}

function createDjMixerGame(): MinigameModule {
  let audioCtx: AudioContext | null = null;
  let closeIntro: (() => void) | null = null;
  let masterGain: GainNode | null = null;

  let grid: boolean[][] = SOUND_DEFS.map(() => new Array(STEP_COUNT).fill(false));
  let playing = false;
  let currentSchedulerStep = 0;
  let nextStepTime = 0;
  let bpm = DEFAULT_BPM;
  let stepQueue: ScheduledStep[] = [];
  let visualStep = -1;

  let panel: HTMLDivElement;
  let seqHost: HTMLDivElement;
  let playBtn: HTMLButtonElement;
  let bpmLabel: HTMLSpanElement;
  let cellEls: HTMLButtonElement[][] = [];

  function ensureAudio(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      const compressor = audioCtx.createDynamicsCompressor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.85;
      masterGain.connect(compressor).connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }

  function secondsPerStep(): number {
    return 60 / bpm / 4; // 16tel-Noten
  }

  function scheduleStep(step: number, time: number): void {
    const ctx = audioCtx!;
    grid.forEach((row, trackIndex) => {
      if (row[step]) SOUND_DEFS[trackIndex].play(ctx, time, masterGain!);
    });
    stepQueue.push({ step, time });
  }

  function togglePlay(): void {
    if (playing) {
      playing = false;
      playBtn.textContent = "▶ Abspielen";
      visualStep = -1;
      syncPlayheadVisuals();
      return;
    }
    const ctx = ensureAudio();
    playing = true;
    playBtn.textContent = "⏸ Stopp";
    currentSchedulerStep = 0;
    nextStepTime = ctx.currentTime + 0.05;
    stepQueue = [];
  }

  function clearGrid(): void {
    grid = SOUND_DEFS.map(() => new Array(STEP_COUNT).fill(false));
    syncCellVisuals();
  }

  function toggleCell(row: number, step: number): void {
    grid[row][step] = !grid[row][step];
    syncCellVisuals();
  }

  function previewSound(row: number): void {
    const ctx = ensureAudio();
    SOUND_DEFS[row].play(ctx, ctx.currentTime + 0.01, masterGain!);
  }

  function syncCellVisuals(): void {
    grid.forEach((row, r) => {
      row.forEach((active, s) => {
        const el = cellEls[r]?.[s];
        if (!el) return;
        el.classList.toggle("seq-cell--active", active);
      });
    });
  }

  function syncPlayheadVisuals(): void {
    for (let r = 0; r < cellEls.length; r++) {
      for (let s = 0; s < STEP_COUNT; s++) {
        cellEls[r][s]?.classList.toggle("seq-cell--playhead", s === visualStep);
      }
    }
  }

  function buildGridDom(): void {
    seqHost.innerHTML = "";
    cellEls = [];
    SOUND_DEFS.forEach((sound, r) => {
      const rowEl = document.createElement("div");
      rowEl.className = "seq-row";

      const label = document.createElement("button");
      label.type = "button";
      label.className = "seq-row__label";
      label.textContent = sound.label;
      label.title = sound.hint;
      label.addEventListener("click", () => previewSound(r));
      rowEl.appendChild(label);

      const cellsWrap = document.createElement("div");
      cellsWrap.className = "seq-row__cells";
      const rowCells: HTMLButtonElement[] = [];
      for (let s = 0; s < STEP_COUNT; s++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "seq-cell" + (s % 4 === 0 ? " seq-cell--downbeat" : "");
        cell.addEventListener("click", () => toggleCell(r, s));
        cellsWrap.appendChild(cell);
        rowCells.push(cell);
      }
      cellEls.push(rowCells);
      rowEl.appendChild(cellsWrap);
      seqHost.appendChild(rowEl);
    });
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      panel = document.createElement("div");
      panel.className = "stage-center-panel";
      panel.style.justifyContent = "flex-start";
      panel.style.paddingTop = "8px";

      const intro = document.createElement("div");
      intro.style.textAlign = "center";
      intro.style.fontSize = "0.8rem";
      intro.style.color = "var(--text-muted)";
      intro.style.marginBottom = "4px";
      intro.textContent = "Tippe Felder an, um einen Beat aus Zuggeräuschen zu bauen.";
      panel.appendChild(intro);

      seqHost = document.createElement("div");
      seqHost.className = "seq";
      panel.appendChild(seqHost);
      buildGridDom();

      const controls = document.createElement("div");
      controls.className = "seq-controls";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.className = "btn btn--ghost";
      minusBtn.textContent = "−";
      minusBtn.addEventListener("click", () => {
        bpm = Math.max(MIN_BPM, bpm - 10);
        bpmLabel.textContent = `${bpm} BPM`;
      });

      bpmLabel = document.createElement("span");
      bpmLabel.className = "seq-controls__bpm";
      bpmLabel.textContent = `${bpm} BPM`;

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.className = "btn btn--ghost";
      plusBtn.textContent = "+";
      plusBtn.addEventListener("click", () => {
        bpm = Math.min(MAX_BPM, bpm + 10);
        bpmLabel.textContent = `${bpm} BPM`;
      });

      controls.append(minusBtn, bpmLabel, plusBtn);
      panel.appendChild(controls);

      const controls2 = document.createElement("div");
      controls2.className = "seq-controls";

      playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn--accent";
      playBtn.style.minWidth = "140px";
      playBtn.textContent = "▶ Abspielen";
      playBtn.addEventListener("click", togglePlay);

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn btn--ghost";
      clearBtn.textContent = "Leeren";
      clearBtn.addEventListener("click", clearGrid);

      controls2.append(playBtn, clearBtn);
      panel.appendChild(controls2);

      env.overlay.appendChild(panel);

      closeIntro = showGameIntro({
        title: "DJ-Mischer",
        description:
          "Tippe im Raster Felder an: jede Zeile ist ein Zuggeräusch, jede Spalte ein Taktschritt. Mit „Abspielen” läuft dein Muster in einer Dauerschleife.",
        onStart: () => {
          closeIntro = null;
        },
      });
    },

    update() {
      if (!playing || !audioCtx) return;
      while (nextStepTime < audioCtx.currentTime + LOOKAHEAD_S) {
        scheduleStep(currentSchedulerStep, nextStepTime);
        nextStepTime += secondsPerStep();
        currentSchedulerStep = (currentSchedulerStep + 1) % STEP_COUNT;
      }
      while (stepQueue.length > 0 && stepQueue[0].time <= audioCtx.currentTime) {
        const next = stepQueue.shift()!;
        visualStep = next.step;
        syncPlayheadVisuals();
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);
    },

    cleanup() {
      closeIntro?.();
      closeIntro = null;
      playing = false;
      if (audioCtx) {
        void audioCtx.close();
        audioCtx = null;
      }
      panel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "DJ-Mischer",
  subtitle: "Baue einen Beat aus Zuggeräuschen",
  icon: "sliders",
  accent: "#f3791d",
  create: createDjMixerGame,
});
