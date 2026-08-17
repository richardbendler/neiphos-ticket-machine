/**
 * Instrumente + Tonhoehen fuer die drei Melodiespuren des DJ-Mischers (siehe
 * index.ts).
 *
 * Erste Version war komplett synthetisiert (Oszillatoren) -- auf
 * ausdruecklichen Wunsch verworfen ("klingen alle total gleich und super
 * KI-generiert"). Zweite Version nutzte drei bekannte Meme-Sounds (Mario-
 * Muenze, Minecraft-Notenblock, Vine Boom) -- ebenfalls verworfen: der
 * Minecraft-Clip war tatsaechlich eine kurze Tonfolge aus mehreren
 * verschiedenen Toenen statt einem einzelnen, und Vine Boom ist gar kein
 * musikalischer Ton, sondern ein reiner Bass-/Wummer-Meme-Effekt ("kein
 * Ton, sondern einfach nur so ein komischer Insta-Sound", gemeldet).
 *
 * Jetzt stattdessen drei echte, aber schlicht NORMALE Einzeltoene, wie man
 * sie auf einem echten DJ-/Sampler-Board erwarten wuerde (myinstants.com,
 * jeweils VOR der Aufnahme in dieses Board per Wellenform-/Pitch-Analyse
 * verifiziert: EIN klarer Attack, EINE stabile Tonhoehe -- keine Tonfolgen,
 * keine unpitched Effektsounds). Unter demselben bereits dokumentierten
 * Lizenzrisiko-Vorbehalt wie die uebrigen echten Sample-Clips im Projekt
 * (siehe sounds.ts, Datei-Kommentar dort): rein lokaler/privater Betrieb,
 * Rechte ausdruecklich zweitrangig.
 *  - piano-c5-note.mp3: myinstants.com/en/instant/c5-piano-note-38128
 *                       (echter Klavieranschlag, Ton C5)
 *  - bell-ding.mp3:     myinstants.com/en/instant/ding-sound-effect
 *                       (heller Glocken-/Ding-Ton)
 *  - 8bit-beep.mp3:     myinstants.com/en/instant/8-bit-beep-19641
 *                       (kurzer, klarer 8-Bit-Retro-Piepton)
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
import pianoC5Url from "../../assets/sounds/piano-c5-note.mp3";
import bellDingUrl from "../../assets/sounds/bell-ding.mp3";
import beep8bitUrl from "../../assets/sounds/8bit-beep.mp3";

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
    id: "piano",
    label: "Klavier",
    hint: "Klavierton (C5)",
    url: pianoC5Url,
    baseFreq: 524,
    play: makeMelodySamplePlayFn(pianoC5Url, 2.2, 0, 0.9),
  },
  {
    id: "bell",
    label: "Glocke",
    hint: "Heller Glockenton",
    url: bellDingUrl,
    baseFreq: 2643,
    play: makeMelodySamplePlayFn(bellDingUrl, 1.3, 0.12, 0.85),
  },
  {
    id: "beep8bit",
    label: "8-Bit-Piepton",
    hint: "Kurzer Retro-Piepton",
    url: beep8bitUrl,
    baseFreq: 743.5,
    play: makeMelodySamplePlayFn(beep8bitUrl, 2.0, 0.07, 0.2),
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
