/**
 * Alle Sounds sind rein prozedural per Web Audio API synthetisiert (Oszillatoren
 * + gefiltertes Rauschen) -- keine Audiodateien noetig, dadurch garantiert
 * offline-tauglich und lizenzfrei. Jede Funktion plant ihren Klang exakt zum
 * uebergebenen AudioContext-Zeitpunkt (fuer sample-genaues Sequencer-Timing,
 * siehe index.ts).
 */

export type SoundId = "doorBeep" | "doorThud" | "switchClack" | "brakeHiss" | "horn" | "chime";

type PlayFn = (ctx: AudioContext, time: number, destination: AudioNode) => void;

let sharedNoiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!sharedNoiseBuffer || sharedNoiseBuffer.sampleRate !== ctx.sampleRate) {
    const length = ctx.sampleRate; // 1 Sekunde Rauschen, wird bei Bedarf fruehzeitig gestoppt
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    sharedNoiseBuffer = buffer;
  }
  return sharedNoiseBuffer;
}

function envGain(ctx: AudioContext, time: number, attack: number, decay: number, peak: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, time + attack + decay);
  return gain;
}

const playDoorBeep: PlayFn = (ctx, time, destination) => {
  for (const offset of [0, 0.16]) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1050;
    const gain = envGain(ctx, time + offset, 0.005, 0.09, 0.22);
    osc.connect(gain).connect(destination);
    osc.start(time + offset);
    osc.stop(time + offset + 0.13);
  }
};

const playDoorThud: PlayFn = (ctx, time, destination) => {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(60, time + 0.12);
  const gain = envGain(ctx, time, 0.002, 0.16, 0.5);
  osc.connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + 0.2);
};

const playSwitchClack: PlayFn = (ctx, time, destination) => {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2200;
  filter.Q.value = 3;
  const gain = envGain(ctx, time, 0.001, 0.05, 0.6);
  src.connect(filter).connect(gain).connect(destination);
  src.start(time);
  src.stop(time + 0.08);
};

const playBrakeHiss: PlayFn = (ctx, time, destination) => {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const gain = envGain(ctx, time, 0.02, 0.32, 0.35);
  src.connect(filter).connect(gain).connect(destination);
  src.start(time);
  src.stop(time + 0.4);
};

const playHorn: PlayFn = (ctx, time, destination) => {
  const gain = envGain(ctx, time, 0.01, 0.22, 0.3);
  gain.connect(destination);
  for (const freq of [311, 415]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(time);
    osc.stop(time + 0.26);
  }
};

const playChime: PlayFn = (ctx, time, destination) => {
  const notes: Array<[number, number]> = [
    [880, 0],
    [659, 0.18],
  ];
  for (const [freq, offset] of notes) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = envGain(ctx, time + offset, 0.01, 0.28, 0.28);
    osc.connect(gain).connect(destination);
    osc.start(time + offset);
    osc.stop(time + offset + 0.32);
  }
};

export interface SoundDef {
  id: SoundId;
  label: string;
  hint: string;
  play: PlayFn;
}

export const SOUND_DEFS: SoundDef[] = [
  { id: "doorBeep", label: "Türsignal", hint: "Piep-piep beim Türschließen", play: playDoorBeep },
  { id: "doorThud", label: "Tür zu", hint: "Dumpfes Schließgeräusch", play: playDoorThud },
  { id: "switchClack", label: "Weiche", hint: "Klacken beim Überfahren", play: playSwitchClack },
  { id: "brakeHiss", label: "Bremse", hint: "Pneumatisches Zischen", play: playBrakeHiss },
  { id: "horn", label: "Signalhorn", hint: "Zweiklang-Signal", play: playHorn },
  { id: "chime", label: "Ankunft", hint: "Ding-Dong-Ansage-Chime", play: playChime },
];
