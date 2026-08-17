/**
 * Instrumente + Tonhoehen fuer die drei Melodiespuren des DJ-Mischers (siehe
 * index.ts).
 *
 * Erste Version war komplett synthetisiert (Oszillatoren) -- auf
 * ausdruecklichen Wunsch verworfen ("klingen alle total gleich und super
 * KI-generiert"), stattdessen jetzt drei echte, sehr bekannte Sound-Clips
 * (myinstants.com), unter demselben bereits dokumentierten Lizenzrisiko-
 * Vorbehalt wie die uebrigen echten Sample-Clips im Projekt (siehe
 * sounds.ts, Datei-Kommentar dort): rein lokaler/privater Betrieb, Rechte
 * ausdruecklich zweitrangig.
 *  - mario-coin.mp3:            myinstants.com/en/instant/mario-coin-sound
 *  - minecraft-noteblock-pling.mp3: myinstants.com/en/instant/minecraft-note-block-sound-69344
 *  - vine-boom.mp3:              myinstants.com/en/instant/vine-boom-sound-70972
 *
 * Anders als die perkussiven Bahn-Sounds in sounds.ts brauchen diese hier
 * eine frei waehlbare Tonhoehe (fuer den Piano-Roll) -- ein fertiger Sample-
 * Clip hat aber nur EINE natuerliche Tonhoehe. Geloest per Pitch-Shifting
 * ueber AudioBufferSourceNode.playbackRate: jedes Instrument kennt seine
 * per Autokorrelation gemessene Grundfrequenz (baseFreq), der Piano-Roll
 * zeigt dazu relative Halbtonschritte (-6 bis +6, siehe MELODY_SEMITONE_SPAN)
 * an -- das haelt den Pitch-Shift in einem Bereich, der noch nach dem
 * Original-Instrument klingt statt nach Chipmunk- oder Zeitlupen-Effekt.
 * Row-Index <-> Halbtonversatz ist dadurch instrumentenunabhaengig: wechselt
 * man auf einer Spur das Instrument, bleibt die "Form" der Melodie (welche
 * Zeile= wie viele Halbtoene ueber/unter der Grundtonhoehe) erhalten, nur
 * die Klangfarbe und die tatsaechliche Frequenz aendern sich.
 */
import marioCoinUrl from "../../assets/sounds/mario-coin.mp3";
import minecraftNoteblockUrl from "../../assets/sounds/minecraft-noteblock-pling.mp3";
import vineBoomUrl from "../../assets/sounds/vine-boom.mp3";

const sampleBufferCache = new Map<string, Promise<AudioBuffer>>();

function loadSampleBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let cached = sampleBufferCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    sampleBufferCache.set(url, cached);
  }
  return cached;
}

/** Einmalig frueh aufrufen, damit die Clips beim ersten Antippen/Abspielen schon bereitliegen (analog zu sounds.ts#preloadSamples). */
export function preloadMelodySamples(ctx: AudioContext): void {
  for (const inst of MELODY_INSTRUMENTS) void loadSampleBuffer(ctx, inst.url);
}

type MelodyPlayFn = (ctx: AudioContext, time: number, destination: AudioNode, playbackRate: number) => void;

/**
 * gainBoost/startOffset/maxDuration wie bei sounds.ts#makeSamplePlayFn --
 * startOffset schneidet stille Vorlaufzeit vor dem eigentlichen Klang weg
 * (per Wellenformanalyse ermittelt), maxDuration kappt lange Auskling-
 * schweife, damit eine einzelne Note nicht zu weit in nachfolgende
 * Taktschritte hineinklingt.
 */
function makeMelodySamplePlayFn(url: string, gainBoost: number, startOffset: number, maxDuration: number): MelodyPlayFn {
  return (ctx, time, destination, playbackRate) => {
    void loadSampleBuffer(ctx, url).then((buffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = playbackRate;
      const gain = ctx.createGain();
      gain.gain.value = gainBoost;
      src.connect(gain).connect(destination);
      const startAt = Math.max(time, ctx.currentTime);
      src.start(startAt, startOffset);
      src.stop(startAt + maxDuration);
    });
  };
}

export interface MelodyInstrument {
  id: string;
  label: string;
  hint: string;
  url: string;
  /** Per Autokorrelation gemessene Grundfrequenz des Original-Clips (Hz), siehe Datei-Kommentar oben. */
  baseFreq: number;
  play: MelodyPlayFn;
}

export const MELODY_INSTRUMENTS: MelodyInstrument[] = [
  {
    id: "marioCoin",
    label: "Mario-Münze",
    hint: "Der Mario-Münzen-Ding",
    url: marioCoinUrl,
    baseFreq: 1316.5,
    play: makeMelodySamplePlayFn(marioCoinUrl, 0.9, 0.3, 0.8),
  },
  {
    id: "minecraftPling",
    label: "Minecraft-Pling",
    hint: "Minecraft-Notenblock",
    url: minecraftNoteblockUrl,
    baseFreq: 495,
    play: makeMelodySamplePlayFn(minecraftNoteblockUrl, 3.2, 0.22, 0.7),
  },
  {
    id: "vineBoom",
    label: "Vine Boom",
    hint: "Der Vine-Boom-Meme-Sound",
    url: vineBoomUrl,
    baseFreq: 49,
    play: makeMelodySamplePlayFn(vineBoomUrl, 0.45, 0.06, 0.9),
  },
];

export interface MelodyNoteRow {
  /** Relativer Halbtonversatz zur Grundfrequenz des Instruments -- instrumentenunabhaengig, siehe Datei-Kommentar oben. */
  semitone: number;
  playbackRate: number;
  label: string;
  isBlackKey: boolean;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEY_NAMES = new Set(["C#", "D#", "F#", "G#", "A#"]);

/** Wie weit der Piano-Roll ueber/unter die natuerliche Tonhoehe hinaus verschieben darf (siehe Datei-Kommentar oben). */
const MELODY_SEMITONE_SPAN = 6;

function nearestNoteLabel(freq: number): { label: string; isBlackKey: boolean } {
  // MIDI-Notennummer (gerundet) rein zur huebschen Beschriftung -- die
  // tatsaechlich gespielte Frequenz kommt weiterhin aus playbackRate, nicht
  // aus dieser Rundung.
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { label: `${name}${octave}`, isBlackKey: BLACK_KEY_NAMES.has(name) };
}

/**
 * Zeilen fuer den Piano-Roll EINER Melodiespur, abhaengig vom aktuell
 * gewaehlten Instrument -- hoechste Note oben, wie bei einem echten Piano
 * Roll. Row-Index 0 = +6 Halbtoene, letzter Index = -6 Halbtoene (siehe
 * MELODY_SEMITONE_SPAN).
 */
export function noteRowsForInstrument(instrument: MelodyInstrument): MelodyNoteRow[] {
  const rows: MelodyNoteRow[] = [];
  for (let semitone = MELODY_SEMITONE_SPAN; semitone >= -MELODY_SEMITONE_SPAN; semitone--) {
    const playbackRate = 2 ** (semitone / 12);
    const { label, isBlackKey } = nearestNoteLabel(instrument.baseFreq * playbackRate);
    rows.push({ semitone, playbackRate, label, isBlackKey });
  }
  return rows;
}

/** Anzahl Zeilen im Piano-Roll -- unabhaengig vom Instrument immer gleich (2 * Span + 1). */
export const MELODY_NOTE_ROW_COUNT = MELODY_SEMITONE_SPAN * 2 + 1;
