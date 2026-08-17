import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { SOUND_DEFS, speakPhrase, stopSpeech, preloadSamples } from "./sounds";
import { MELODY_INSTRUMENTS, MELODY_NOTE_ROW_COUNT, noteRowsForInstrument, preloadMelodySamples } from "./melody";
import { showGameIntro } from "../../core/gameIntro";

const GAME_ID = "dj-mixer";
// Anzahl der Melodiespuren (Piano-Roll statt reiner Ein/Aus-Zeilen wie beim
// Rhythmus-Raster, siehe MelodyTrackState/buildMelodyDom unten) -- auf
// ausdruecklichen Wunsch drei Stueck.
const MELODY_TRACK_COUNT = 3;
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

/**
 * Startmuster statt eines komplett leeren Rasters: ein einfacher Grundbeat
 * aus den ersten drei (synthetisierten) Zeilen -- Kick ("Tür zu"), Snare
 * ("Weiche"), Hi-Hat ("Bremse"). Alle anderen Zeilen bleiben leer, man soll
 * ja selbst weitermischen. Klassischer Backbeat: Kick auf Schlag 1+3, Snare
 * auf Schlag 2+4, Hi-Hat auf jeder Achtel -- "Schlag" bezogen auf
 * STEPS_PER_BAR (ein "Takt" im Sinn dieses Reglers, siehe oben).
 */
function buildDefaultGrid(stepCount: number): boolean[][] {
  return SOUND_DEFS.map((_, row) => {
    const line = new Array(stepCount).fill(false);
    if (row > 2) return line;
    for (let s = 0; s < stepCount; s++) {
      const beatIndex = Math.floor(s / STEPS_PER_BAR);
      const isDownbeat = s % STEPS_PER_BAR === 0;
      const beatInMeasure = beatIndex % 4;
      if (row === 0) line[s] = isDownbeat && (beatInMeasure === 0 || beatInMeasure === 2);
      else if (row === 1) line[s] = isDownbeat && (beatInMeasure === 1 || beatInMeasure === 3);
      else line[s] = s % 2 === 0;
    }
    return line;
  });
}

/**
 * Eine Melodiespur: waehlbares Instrument (siehe melody.ts) + pro Taktschritt
 * hoechstens EINE Note (Zeilen-Index im per noteRowsForInstrument() erzeugten
 * Piano-Roll des jeweiligen Instruments, oder null = keine Note -- bewusst
 * monophon, nicht mehrere Toene gleichzeitig pro Spur, das haelt den
 * Piano-Roll einfach antippbar). "expanded" steuert, ob die Spur gerade als
 * kompakte Kopfzeile oder als ausgeklappter Piano-Roll gezeichnet wird (siehe
 * buildMelodyDom).
 */
interface MelodyTrackState {
  instrumentIndex: number;
  notes: (number | null)[];
  expanded: boolean;
}

function buildEmptyMelodyTracks(stepCount: number): MelodyTrackState[] {
  return Array.from({ length: MELODY_TRACK_COUNT }, (_, i) => ({
    instrumentIndex: i % MELODY_INSTRUMENTS.length,
    notes: new Array(stepCount).fill(null),
    expanded: false,
  }));
}

export function createDjMixerGame(): MinigameModule {
  let audioCtx: AudioContext | null = null;
  let closeIntro: (() => void) | null = null;
  let masterGain: GainNode | null = null;

  let bars = DEFAULT_BARS;
  let grid: boolean[][] = buildDefaultGrid(bars * STEPS_PER_BAR);
  let melodyTracks: MelodyTrackState[] = buildEmptyMelodyTracks(bars * STEPS_PER_BAR);
  let playing = false;
  let currentSchedulerStep = 0;
  let nextStepTime = 0;
  let bpm = DEFAULT_BPM;
  let volume = DEFAULT_VOLUME;
  let stepQueue: ScheduledStep[] = [];
  let visualStep = -1;
  let lastPlayheadStep = -1;

  let panel: HTMLDivElement;
  let seqHost: HTMLDivElement;
  let melodyHost: HTMLDivElement;
  let playBtn: HTMLButtonElement;
  let bpmLabel: HTMLSpanElement;
  let volumeLabel: HTMLSpanElement;
  let barsLabel: HTMLSpanElement;
  let cellEls: HTMLButtonElement[][] = [];
  // Pro Melodiespur entweder die Piano-Roll-Zellen (Zeile x Schritt, nur wenn
  // ausgeklappt) oder null (eingeklappt -- dann gibt es stattdessen nur die
  // nicht antippbaren Vorschau-Striche in melodyPreviewEls).
  let melodyCellEls: (HTMLButtonElement[][] | null)[] = [];
  let melodyPreviewEls: HTMLDivElement[][] = [];
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
      preloadMelodySamples(audioCtx);
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

  function triggerMelodyNote(trackIndex: number, rowIndex: number, time: number): void {
    const ctx = audioCtx!;
    const instrument = MELODY_INSTRUMENTS[melodyTracks[trackIndex].instrumentIndex];
    const rows = noteRowsForInstrument(instrument);
    instrument.play(ctx, time, masterGain!, rows[rowIndex].playbackRate);
  }

  function scheduleStep(step: number, time: number): void {
    grid.forEach((row, trackIndex) => {
      if (row[step]) triggerSound(trackIndex, time);
    });
    melodyTracks.forEach((track, trackIndex) => {
      const rowIndex = track.notes[step];
      if (rowIndex !== null) triggerMelodyNote(trackIndex, rowIndex, time);
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
    melodyTracks.forEach((track) => track.notes.fill(null));
    syncCellVisuals();
    syncMelodyVisuals();
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
    melodyTracks.forEach((track) => {
      const trimmed = track.notes.slice(0, newStepCount);
      while (trimmed.length < newStepCount) trimmed.push(null);
      track.notes = trimmed;
    });
    buildGridDom();
    buildMelodyDom();
  }

  function toggleCell(row: number, step: number): void {
    const active = !grid[row][step];
    grid[row][step] = active;
    // Nur die EINE angetippte Zelle aktualisieren, nicht das komplette
    // Gitter neu durchlaufen (syncCellVisuals() -- vorher hier ebenfalls
    // aufgerufen) -- auf einem schwachen Geraet (Pi 3, Software-Rendering)
    // fuehlte sich das bei jedem einzelnen Antippen spuerbar verzoegert an,
    // weil dabei JEDE Zelle im Gitter angefasst wurde, obwohl sich nur eine
    // einzige tatsaechlich geaendert hat.
    cellEls[row]?.[step]?.classList.toggle("seq-cell--active", active);
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

  /**
   * Faerbt nur die ZWEI betroffenen Spalten um (alte + neue Playhead-
   * Position), statt bei jedem Taktschritt das komplette Gitter
   * durchzugehen (vorher: alle Zeilen x alle Spalten, mehrmals pro
   * Sekunde) -- auf einem schwachen Geraet (Pi 3, Software-Rendering) trug
   * das spuerbar zum allgemeinen Ruckeln bei, weil es exakt im Takt der
   * Audio-Planung im selben Funktionsaufruf laeuft (siehe update()).
   */
  function syncPlayheadVisuals(): void {
    if (lastPlayheadStep !== -1) {
      for (let r = 0; r < cellEls.length; r++) {
        cellEls[r][lastPlayheadStep]?.classList.remove("seq-cell--playhead");
      }
      melodyCellEls.forEach((rows) => rows?.forEach((row) => row[lastPlayheadStep]?.classList.remove("melody-cell--playhead")));
      melodyPreviewEls.forEach((ticks) => ticks[lastPlayheadStep]?.classList.remove("melody-preview__tick--playhead"));
    }
    if (visualStep !== -1) {
      for (let r = 0; r < cellEls.length; r++) {
        cellEls[r][visualStep]?.classList.add("seq-cell--playhead");
      }
      melodyCellEls.forEach((rows) => rows?.forEach((row) => row[visualStep]?.classList.add("melody-cell--playhead")));
      melodyPreviewEls.forEach((ticks) => ticks[visualStep]?.classList.add("melody-preview__tick--playhead"));
    }
    lastPlayheadStep = visualStep;
  }

  /**
   * Setzt (oder entfernt, wenn dieselbe Tonhoehe erneut angetippt wird) die
   * Note einer Melodiespur an einem Taktschritt -- monophon, eine neue Note
   * ersetzt automatisch eine bereits vorhandene an diesem Schritt. Aktualisiert
   * gezielt nur die betroffene Spalte (gleiches Prinzip wie toggleCell).
   */
  function setMelodyNote(trackIndex: number, step: number, rowIndex: number): void {
    const track = melodyTracks[trackIndex];
    const isSame = track.notes[step] === rowIndex;
    track.notes[step] = isSame ? null : rowIndex;
    const rows = melodyCellEls[trackIndex];
    if (rows) {
      for (const row of rows) row[step]?.classList.remove("melody-cell--active");
      if (!isSame) rows[rowIndex]?.[step]?.classList.add("melody-cell--active");
    }
    const preview = melodyPreviewEls[trackIndex];
    if (preview) preview[step]?.classList.toggle("melody-preview__tick--active", !isSame);
    if (!isSame) previewMelodyNote(trackIndex, rowIndex);
  }

  function clearMelodyTrack(trackIndex: number): void {
    const track = melodyTracks[trackIndex];
    track.notes.fill(null);
    melodyCellEls[trackIndex]?.forEach((row) => row.forEach((cell) => cell.classList.remove("melody-cell--active")));
    melodyPreviewEls[trackIndex]?.forEach((tick) => tick.classList.remove("melody-preview__tick--active"));
  }

  function syncMelodyVisuals(): void {
    melodyTracks.forEach((track, trackIndex) => {
      const rows = melodyCellEls[trackIndex];
      if (rows) {
        rows.forEach((row, r) => row.forEach((cell, s) => cell.classList.toggle("melody-cell--active", track.notes[s] === r)));
      }
      const preview = melodyPreviewEls[trackIndex];
      if (preview) preview.forEach((tick, s) => tick.classList.toggle("melody-preview__tick--active", track.notes[s] !== null));
    });
  }

  function previewMelodyNote(trackIndex: number, rowIndex: number): void {
    const ctx = ensureAudio();
    triggerMelodyNote(trackIndex, rowIndex, ctx.currentTime + 0.01);
  }

  /** Beim Instrumentenwechsel eine mittlere Note anspielen, damit man den neuen Klang sofort hoert (analog zu previewSound bei den Rhythmus-Zeilen). */
  function previewMelodyInstrument(trackIndex: number): void {
    previewMelodyNote(trackIndex, Math.floor(MELODY_NOTE_ROW_COUNT / 2));
  }

  function toggleMelodyExpanded(trackIndex: number): void {
    melodyTracks[trackIndex].expanded = !melodyTracks[trackIndex].expanded;
    buildMelodyDom();
  }

  /**
   * Baut die drei Melodiespuren neu auf -- jede entweder als kompakte
   * Kopfzeile mit nicht antippbarem Vorschau-Streifen (eingeklappt) oder als
   * volle Piano-Roll mit MELODY_NOTE_ROW_COUNT antippbaren Tonhoehen-Zeilen
   * (ausgeklappt, siehe toggleMelodyExpanded). melodyHost selbst ist per CSS
   * hoehenbegrenzt und bei Bedarf eigenstaendig scrollbar (siehe .melody-tracks
   * in style.css) -- das Rhythmus-Raster darueber behaelt dadurch sein
   * bestehendes "passt immer ohne Scrollen"-Verhalten unveraendert bei.
   */
  function buildMelodyDom(): void {
    melodyHost.innerHTML = "";
    melodyCellEls = [];
    melodyPreviewEls = [];

    melodyTracks.forEach((track, trackIndex) => {
      const trackEl = document.createElement("div");
      trackEl.className = "melody-track" + (track.expanded ? " melody-track--expanded" : "");

      const header = document.createElement("div");
      header.className = "melody-track__header";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "melody-track__toggle";
      // Auf ausdruecklichen Wunsch NICHT mehr ein nach rechts zeigendes
      // Dreieck (sah wie ein zweiter/separater Play-Button neben "▶
      // Abspielen" aus, gemeldet) -- stattdessen ein klassisches Akkordeon-
      // Chevron (runter = "hier klappt was auf", hoch = "hier klappt was
      // zu"), eindeutig als Ausklapp-Pfeil statt Wiedergabe-Symbol erkennbar.
      toggleBtn.textContent = track.expanded ? "▲" : "▼";
      toggleBtn.setAttribute("aria-label", track.expanded ? "Melodiespur einklappen" : "Melodiespur ausklappen");
      toggleBtn.addEventListener("click", () => toggleMelodyExpanded(trackIndex));
      header.appendChild(toggleBtn);

      const label = document.createElement("span");
      label.className = "melody-track__label";
      label.textContent = `Melodie ${trackIndex + 1}`;
      header.appendChild(label);

      const select = document.createElement("select");
      select.className = "melody-track__instrument";
      MELODY_INSTRUMENTS.forEach((inst, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = inst.label;
        if (i === track.instrumentIndex) opt.selected = true;
        select.appendChild(opt);
      });
      select.title = MELODY_INSTRUMENTS[track.instrumentIndex].hint;
      select.addEventListener("change", () => {
        track.instrumentIndex = Number(select.value);
        previewMelodyInstrument(trackIndex);
        // Neu aufbauen statt nur select.title zu aktualisieren -- ein
        // Instrumentenwechsel aendert bei ausgeklappter Spur auch die
        // Notennamen-Beschriftung jeder Zeile (siehe noteRowsForInstrument
        // in melody.ts), die muss mit neu gezeichnet werden.
        buildMelodyDom();
      });
      header.appendChild(select);

      const clearTrackBtn = document.createElement("button");
      clearTrackBtn.type = "button";
      clearTrackBtn.className = "btn btn--ghost melody-track__clear";
      clearTrackBtn.textContent = "Leeren";
      clearTrackBtn.addEventListener("click", () => clearMelodyTrack(trackIndex));
      header.appendChild(clearTrackBtn);

      trackEl.appendChild(header);

      if (track.expanded) {
        const roll = document.createElement("div");
        roll.className = "melody-roll";
        const rowEls: HTMLButtonElement[][] = [];
        const noteRows = noteRowsForInstrument(MELODY_INSTRUMENTS[track.instrumentIndex]);
        noteRows.forEach((noteRow, rowIndex) => {
          const rollRow = document.createElement("div");
          rollRow.className = "melody-roll__row" + (noteRow.isBlackKey ? " melody-roll__row--black" : "");

          const rowLabel = document.createElement("span");
          rowLabel.className = "melody-roll__label";
          rowLabel.textContent = noteRow.label;
          rollRow.appendChild(rowLabel);

          const cellsWrap = document.createElement("div");
          cellsWrap.className = "melody-roll__cells";
          cellsWrap.style.gridTemplateColumns = `repeat(${totalSteps()}, 1fr)`;
          const rowCells: HTMLButtonElement[] = [];
          for (let s = 0; s < totalSteps(); s++) {
            const cell = document.createElement("button");
            cell.type = "button";
            cell.className = "melody-cell" + (s % STEPS_PER_BAR === 0 ? " melody-cell--downbeat" : "");
            if (track.notes[s] === rowIndex) cell.classList.add("melody-cell--active");
            cell.addEventListener("click", () => setMelodyNote(trackIndex, s, rowIndex));
            cellsWrap.appendChild(cell);
            rowCells.push(cell);
          }
          rollRow.appendChild(cellsWrap);
          roll.appendChild(rollRow);
          rowEls.push(rowCells);
        });
        melodyCellEls.push(rowEls);
        melodyPreviewEls.push([]);
        trackEl.appendChild(roll);
      } else {
        const preview = document.createElement("div");
        preview.className = "melody-preview";
        preview.style.gridTemplateColumns = `repeat(${totalSteps()}, 1fr)`;
        const previewTicks: HTMLDivElement[] = [];
        for (let s = 0; s < totalSteps(); s++) {
          const tick = document.createElement("div");
          tick.className = "melody-preview__tick" + (s % STEPS_PER_BAR === 0 ? " melody-preview__tick--downbeat" : "");
          if (track.notes[s] !== null) tick.classList.add("melody-preview__tick--active");
          preview.appendChild(tick);
          previewTicks.push(tick);
        }
        melodyCellEls.push(null);
        melodyPreviewEls.push(previewTicks);
        trackEl.appendChild(preview);
      }

      melodyHost.appendChild(trackEl);
    });
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
    // Neu erzeugte Zellen starten alle ohne "aktiv"-Klasse -- das bestehende
    // Muster (grid) muss nach jedem Neuaufbau (z.B. beim Aendern der
    // Taktzahl) explizit wieder auf die DOM-Zellen uebertragen werden,
    // sonst SIEHT es so aus, als waere alles geloescht worden, obwohl die
    // Daten in "grid" tatsaechlich erhalten blieben.
    syncCellVisuals();
    fitGridToContainer();
  }

  /**
   * Berechnet aus der tatsaechlich verfuegbaren Hoehe von seqHost eine
   * gemeinsame Zeilenhoehe, damit alle Sound-Zeilen (Anzahl siehe
   * SOUND_DEFS) ohne vertikales Scrollen auf den Bildschirm passen -- die
   * Breite folgt automatisch der CSS-Grid-Spaltenzahl
   * (repeat(totalSteps(), 1fr)), reagiert also von selbst auf mehr/weniger
   * Takte.
   */
  function fitGridToContainer(): void {
    const rows = SOUND_DEFS.length;
    if (rows === 0) return;
    const rowGap = 4;
    const available = seqHost.clientHeight - (rows - 1) * rowGap;
    const rowHeight = Math.max(18, Math.floor(available / rows));
    seqHost.style.setProperty("--seq-row-height", `${rowHeight}px`);
    // Zeilenbeschriftung (teils zweizeilig, z.B. "Bahnübergang") skaliert mit
    // der Zeilenhoehe -- bei niedrigen Zeilen (viele Takte/kleiner Bildschirm)
    // sonst nicht genug Platz fuer zwei Zeilen, Text ragte dann sichtbar in
    // die naechste Zeile hinein.
    const labelFont = Math.max(8, Math.min(11, Math.floor(rowHeight * 0.3)));
    seqHost.style.setProperty("--seq-label-font", `${labelFont}px`);
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
      playBtn.textContent = "▶ Abspielen";
      playBtn.addEventListener("click", togglePlay);

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "btn btn--ghost";
      clearBtn.textContent = "Leeren";
      clearBtn.addEventListener("click", clearGrid);

      controls2.append(playBtn, clearBtn);
      controlsBar.appendChild(controls2);

      // War hier auf "hidden" gesetzt (seqHost fuellte per Flex:1 den
      // kompletten restlichen Platz, kein Scrollen noetig) -- jetzt hat
      // seqHost ein eigenes, vom Viewport abgeleitetes Hoehenbudget (siehe
      // .seq in style.css) und panel behaelt stattdessen die geerbte
      // .stage-center-panel-Grundeinstellung (overflow-y:auto), damit die
      // GESAMTE Seite scrollt, wenn die Melodiespuren (siehe .melody-tracks)
      // durch Ausklappen mehr Platz brauchen als der Bildschirm hergibt --
      // auf ausdruecklichen Wunsch, statt einer eigenen Scrollbar nur fuer
      // den Melodiebereich.

      seqHost = document.createElement("div");
      seqHost.className = "seq";
      panel.appendChild(seqHost);
      buildGridDom();

      // Melodiespuren unter dem Rhythmus-Raster -- eigener, hoehenbegrenzter
      // und bei Bedarf selbst scrollbarer Bereich (siehe .melody-tracks in
      // style.css), damit seqHost sein bestehendes "passt ohne Scrollen"-
      // Verhalten unveraendert behaelt, egal ob/wie viele Melodiespuren
      // gerade ausgeklappt sind.
      melodyHost = document.createElement("div");
      melodyHost.className = "melody-tracks";
      panel.appendChild(melodyHost);
      buildMelodyDom();

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
          "Unten warten drei Melodiespuren zum Ausklappen für eigene Melodien",
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

