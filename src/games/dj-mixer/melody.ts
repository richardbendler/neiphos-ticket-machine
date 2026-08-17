/**
 * Instrumente + Tonhoehen fuer die drei Melodiespuren des DJ-Mischers (siehe
 * index.ts) -- anders als die perkussiven Bahn-Sounds in sounds.ts brauchen
 * diese hier eine frei waehlbare Tonhoehe (fuer den Piano-Roll), koennen also
 * keine echten Sample-Clips sein (deren Tonhoehe liesse sich nur per
 * playbackRate gemeinsam mit dem Tempo verschieben, nicht frei pro Note).
 * Deshalb rein synthetisiert, mit bahnthematisch angelehnter Klangfarbe
 * (Dampfpfeife, Signalhorn, Bahnhofsglocke, Klangstab) statt neutraler
 * Synth-Presets.
 */

type MelodyPlayFn = (ctx: AudioContext, time: number, destination: AudioNode, freq: number, stepDuration: number) => void;

function envGain(ctx: AudioContext, time: number, attack: number, decay: number, peak: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, time + attack + decay);
  return gain;
}

/** Weiche Dampfpfeife: reiner Sinus mit leichtem Vibrato, laenglich ausklingend. */
const playWhistleNote: MelodyPlayFn = (ctx, time, destination, freq, stepDuration) => {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, time);

  const vibrato = ctx.createOscillator();
  vibrato.type = "sine";
  vibrato.frequency.value = 5.5;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = freq * 0.008;
  vibrato.connect(vibratoDepth).connect(osc.frequency);

  const dur = Math.min(stepDuration * 0.92, 0.55);
  const gain = envGain(ctx, time, 0.02, dur, 0.5);
  osc.connect(gain).connect(destination);
  osc.start(time);
  vibrato.start(time);
  osc.stop(time + dur + 0.05);
  vibrato.stop(time + dur + 0.05);
};

/** Warmes Signalhorn: Saegezahn durch Tiefpass gedaempft, kurzer Attack. */
const playHornNote: MelodyPlayFn = (ctx, time, destination, freq, stepDuration) => {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, time);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = freq * 4;
  filter.Q.value = 0.7;

  const dur = Math.min(stepDuration * 0.85, 0.4);
  const gain = envGain(ctx, time, 0.008, dur, 0.38);
  osc.connect(filter).connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + dur + 0.05);
};

/** Metallischer Glockenton: Grundton + verstimmter Oberton (inharmonisch), schnell ausklingend. */
const playBellNote: MelodyPlayFn = (ctx, time, destination, freq, stepDuration) => {
  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(freq, time);
  const overtone = ctx.createOscillator();
  overtone.type = "sine";
  overtone.frequency.setValueAtTime(freq * 2.76, time);

  const dur = Math.min(stepDuration * 0.95, 0.9);
  const bodyGain = envGain(ctx, time, 0.002, dur, 0.4);
  const overtoneGain = envGain(ctx, time, 0.002, dur * 0.6, 0.16);
  body.connect(bodyGain).connect(destination);
  overtone.connect(overtoneGain).connect(destination);
  body.start(time);
  overtone.start(time);
  body.stop(time + dur + 0.1);
  overtone.stop(time + dur * 0.6 + 0.1);
};

/** Perkussiver Klangstab (Xylofon-artig): kurzer, klarer Dreiecks-Ton. */
const playChimeNote: MelodyPlayFn = (ctx, time, destination, freq, stepDuration) => {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, time);
  const dur = Math.min(stepDuration * 0.7, 0.35);
  const gain = envGain(ctx, time, 0.002, dur, 0.48);
  osc.connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + dur + 0.05);
};

export interface MelodyInstrument {
  id: string;
  label: string;
  hint: string;
  play: MelodyPlayFn;
}

export const MELODY_INSTRUMENTS: MelodyInstrument[] = [
  { id: "whistle", label: "Pfeife", hint: "Weiche Dampfpfeife", play: playWhistleNote },
  { id: "horn", label: "Signalhorn", hint: "Warmes Signalhorn", play: playHornNote },
  { id: "bell", label: "Glocke", hint: "Metallischer Glockenton", play: playBellNote },
  { id: "chime", label: "Klangstab", hint: "Perkussiver Xylofon-Ton", play: playChimeNote },
];

export interface MelodyNoteRow {
  freq: number;
  label: string;
  isBlackKey: boolean;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEY_NAMES = new Set(["C#", "D#", "F#", "G#", "A#"]);

function noteFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

// Eine Oktave plus Grundton (C4 bis C5, MIDI 60-72), von hoch nach tief --
// wie bei einem echten Piano Roll steht die hoechste Note oben. Bewusst nur
// eine Oktave (13 Zeilen): mehr Tonumfang wuerde auf dem Kiosk-Bildschirm bei
// ausgeklappter Spur kaum noch Platz fuer die anderen Bedienelemente lassen.
export const MELODY_NOTE_ROWS: MelodyNoteRow[] = (() => {
  const rows: MelodyNoteRow[] = [];
  for (let midi = 72; midi >= 60; midi--) {
    const name = NOTE_NAMES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    rows.push({ freq: noteFreq(midi), label: `${name}${octave}`, isBlackKey: BLACK_KEY_NAMES.has(name) });
  }
  return rows;
})();
