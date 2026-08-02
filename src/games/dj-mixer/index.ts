import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { SOUND_DEFS, speakPhrase, stopSpeech, preloadSamples } from "./sounds";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";

const GAME_ID = "dj-mixer";
// Ein "Takt" (im Sinn dieses Reglers) entspricht einer Gruppe von 4
// Sechzehntel-Feldern -- der bisherige feste Standard von 16 Feldern
// entsprach also 4 Takten.
const STEPS_PER_BAR = 4;
const DEFAULT_BARS = 8;
const MIN_BARS = 4;
const MAX_BARS = 16;
const LOOKAHEAD_S = 0.12;
const MIN_BPM = 60;
const MAX_BPM = 160;
const DEFAULT_BPM = 100;
const DEFAULT_VOLUME = 0.8;

interface ScheduledStep {
  step: number;
  time: number;
}

function createDjMixerGame(): MinigameModule {
  let audioCtx: AudioContext | null = null;
  let closeIntro: (() => void) | null = null;
  let masterGain: GainNode | null = null;

  let bars = DEFAULT_BARS;
  let grid: boolean[][] = SOUND_DEFS.map(() => new Array(bars * STEPS_PER_BAR).fill(false));
  let playing = false;
  let currentSchedulerStep = 0;
  let nextStepTime = 0;
  let bpm = DEFAULT_BPM;
  let volume = DEFAULT_VOLUME;
  let stepQueue: ScheduledStep[] = [];
  let visualStep = -1;

  let panel: HTMLDivElement;
  let seqHost: HTMLDivElement;
  let playBtn: HTMLButtonElement;
  let bpmLabel: HTMLSpanElement;
  let volumeLabel: HTMLSpanElement;
  let barsLabel: HTMLSpanElement;
  let cellEls: HTMLButtonElement[][] = [];
  let gridResizeObserver: ResizeObserver | null = null;

  function totalSteps(): number {
    return bars * STEPS_PER_BAR;
  }

  function ensureAudio(): AudioContext {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      const compressor = audioCtx.createDynamicsCompressor();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(compressor).connect(audioCtx.destination);
      preloadSamples(audioCtx);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }

  function setVolume(next: number): void {
    volume = Math.min(1, Math.max(0, next));
    if (masterGain) masterGain.gain.value = volume;
    if (volumeLabel) volumeLabel.textContent = `${Math.round(volume * 100)}%`;
  }

  function secondsPerStep(): number {
    return 60 / bpm / 4; // 16tel-Noten
  }

  function triggerSound(trackIndex: number, time: number): void {
    const ctx = audioCtx!;
    const sound = SOUND_DEFS[trackIndex];
    if (sound.play) {
      // Die Sample-Clips werden relativ zum Referenztempo gestreckt/gestaucht,
      // damit sie beim Aendern des Tempos im Takt bleiben (siehe sounds.ts).
      sound.play(ctx, time, masterGain!, bpm / DEFAULT_BPM);
    } else if (sound.text) {
      const delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
      setTimeout(() => speakPhrase(sound.text!), delayMs);
    }
  }

  function scheduleStep(step: number, time: number): void {
    grid.forEach((row, trackIndex) => {
      if (row[step]) triggerSound(trackIndex, time);
    });
    stepQueue.push({ step, time });
  }

  function togglePlay(): void {
    if (playing) {
      playing = false;
      playBtn.textContent = "▶ Abspielen";
      visualStep = -1;
      syncPlayheadVisuals();
      stopSpeech();
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
    grid = SOUND_DEFS.map(() => new Array(totalSteps()).fill(false));
    syncCellVisuals();
  }

  function setBars(next: number): void {
    const clamped = Math.min(MAX_BARS, Math.max(MIN_BARS, next));
    if (clamped === bars) return;
    bars = clamped;
    barsLabel.textContent = `${bars} Takte`;
    if (playing) togglePlay();

    // Bestehendes Muster bleibt erhalten: beim Verkleinern werden die
    // ueberzaehligen Felder rechts abgeschnitten, beim Vergroessern kommen
    // leere neue Felder rechts dazu -- kein Neubeginn wie bei "Leeren".
    const newStepCount = totalSteps();
    grid = grid.map((row) => {
      const trimmed = row.slice(0, newStepCount);
      while (trimmed.length < newStepCount) trimmed.push(false);
      return trimmed;
    });
    buildGridDom();
  }

  function toggleCell(row: number, step: number): void {
    grid[row][step] = !grid[row][step];
    syncCellVisuals();
  }

  function previewSound(row: number): void {
    const ctx = ensureAudio();
    triggerSound(row, ctx.currentTime + 0.01);
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
      for (let s = 0; s < totalSteps(); s++) {
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
      cellsWrap.style.gridTemplateColumns = `repeat(${totalSteps()}, 1fr)`;
      const rowCells: HTMLButtonElement[] = [];
      for (let s = 0; s < totalSteps(); s++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "seq-cell" + (s % STEPS_PER_BAR === 0 ? " seq-cell--downbeat" : "");
        cell.addEventListener("click", () => toggleCell(r, s));
        cellsWrap.appendChild(cell);
        rowCells.push(cell);
      }
      cellEls.push(rowCells);
      rowEl.appendChild(cellsWrap);
      seqHost.appendChild(rowEl);
    });
    fitGridToContainer();
  }

  /**
   * Berechnet aus der tatsaechlich verfuegbaren Hoehe von seqHost eine
   * gemeinsame Zeilenhoehe, damit alle 16 Sound-Zeilen ohne vertikales
   * Scrollen auf den Bildschirm passen -- die Breite folgt automatisch der
   * CSS-Grid-Spaltenzahl (repeat(totalSteps(), 1fr)), reagiert also von
   * selbst auf mehr/weniger Takte.
   */
  function fitGridToContainer(): void {
    const rows = SOUND_DEFS.length;
    if (rows === 0) return;
    const rowGap = 4;
    const available = seqHost.clientHeight - (rows - 1) * rowGap;
    const rowHeight = Math.max(18, Math.floor(available / rows));
    seqHost.style.setProperty("--seq-row-height", `${rowHeight}px`);
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      panel = document.createElement("div");
      panel.className = "stage-center-panel";
      panel.style.justifyContent = "flex-start";
      panel.style.paddingTop = "8px";

      // Bewusst VOR dem Sound-Raster: Tempo, Lautstaerke und Transport sind
      // die Bedienelemente, die man am haeufigsten braucht, waehrend man
      // unten durch die (mittlerweile recht lange) Sound-Liste scrollt.
      // Die einzelnen Gruppen stehen in einer umbrechenden Leiste, damit sie
      // bei genug Platz nebeneinander stehen, statt jede eine eigene Zeile
      // zu beanspruchen -- aber ueber Rahmen/Hintergrund klar voneinander
      // abgegrenzt bleiben.
      const controlsBar = document.createElement("div");
      controlsBar.className = "seq-controls-bar";
      panel.appendChild(controlsBar);

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
      controlsBar.appendChild(controls);

      const barsRow = document.createElement("div");
      barsRow.className = "seq-controls";

      const barsMinusBtn = document.createElement("button");
      barsMinusBtn.type = "button";
      barsMinusBtn.className = "btn btn--ghost";
      barsMinusBtn.textContent = "−";
      barsMinusBtn.addEventListener("click", () => setBars(bars - 1));

      barsLabel = document.createElement("span");
      barsLabel.className = "seq-controls__bpm";
      barsLabel.textContent = `${bars} Takte`;

      const barsPlusBtn = document.createElement("button");
      barsPlusBtn.type = "button";
      barsPlusBtn.className = "btn btn--ghost";
      barsPlusBtn.textContent = "+";
      barsPlusBtn.addEventListener("click", () => setBars(bars + 1));

      barsRow.append(barsMinusBtn, barsLabel, barsPlusBtn);
      controlsBar.appendChild(barsRow);

      const volumeRow = document.createElement("div");
      volumeRow.className = "seq-controls";

      const volumeIcon = document.createElement("span");
      volumeIcon.textContent = "🔊";
      volumeIcon.style.fontSize = "1rem";

      const volumeSlider = document.createElement("input");
      volumeSlider.type = "range";
      volumeSlider.min = "0";
      volumeSlider.max = "100";
      volumeSlider.value = String(Math.round(DEFAULT_VOLUME * 100));
      volumeSlider.className = "seq-controls__volume";
      volumeSlider.setAttribute("aria-label", "Lautstärke");
      volumeSlider.addEventListener("input", () => setVolume(Number(volumeSlider.value) / 100));

      volumeLabel = document.createElement("span");
      volumeLabel.className = "seq-controls__bpm";
      volumeLabel.textContent = `${Math.round(DEFAULT_VOLUME * 100)}%`;

      volumeRow.append(volumeIcon, volumeSlider, volumeLabel);
      controlsBar.appendChild(volumeRow);

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
      controlsBar.appendChild(controls2);

      // Kein Scrollen mehr noetig -- seqHost bekommt per Flex den kompletten
      // restlichen Platz unter der Controls-Leiste, buildGridDom/
      // fitGridToContainer verteilen die Sound-Zeilen dann exakt darauf.
      panel.style.overflowY = "hidden";

      seqHost = document.createElement("div");
      seqHost.className = "seq";
      panel.appendChild(seqHost);
      buildGridDom();

      env.overlay.appendChild(panel);

      gridResizeObserver = new ResizeObserver(() => fitGridToContainer());
      gridResizeObserver.observe(seqHost);

      closeIntro = showGameIntro({
        title: "DJ-Mischer",
        description: [
          "Jede Zeile ist ein Zuggeräusch",
          "Jede Spalte ist ein Taktschritt",
          "Tippe Felder an, um sie ein- oder auszuschalten",
          "„Abspielen” lässt dein Muster in Dauerschleife laufen",
        ],
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
        currentSchedulerStep = (currentSchedulerStep + 1) % totalSteps();
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
      gridResizeObserver?.disconnect();
      gridResizeObserver = null;
      playing = false;
      stopSpeech();
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
  badge: "DJ",
  accent: "#f3791d",
  create: createDjMixerGame,
});
