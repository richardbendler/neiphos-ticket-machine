/**
 * Alle Sounds sind rein prozedural per Web Audio API synthetisiert (Oszillatoren
 * + gefiltertes Rauschen) -- keine Audiodateien noetig, dadurch garantiert
 * offline-tauglich und lizenzfrei. Jede Funktion plant ihren Klang exakt zum
 * uebergebenen AudioContext-Zeitpunkt (fuer sample-genaues Sequencer-Timing,
 * siehe index.ts).
 */

export type SoundId = "doorChime" | "doorThud" | "switchClack" | "brakeHiss" | "horn" | "chime" | "announcement";

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

/**
 * Das klassische Berliner S-Bahn-Tuerschliesssignal "Da-Duu-Da": drei Toene
 * C5-E5-C5 (c-moll... genauer: C-Dur-Dreiklangston C-E-C), electronisch/
 * schnarrend statt weich -- daher Rechteckwelle statt Sinus.
 */
const DOOR_CHIME_NOTES = [523.25, 659.25, 523.25];

const playDoorChime: PlayFn = (ctx, time, destination) => {
  const noteDuration = 0.15;
  const gap = 0.03;
  DOOR_CHIME_NOTES.forEach((freq, i) => {
    const t = time + i * (noteDuration + gap);
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const gain = envGain(ctx, t, 0.004, noteDuration - 0.02, 0.2);
    osc.connect(gain).connect(destination);
    osc.start(t);
    osc.stop(t + noteDuration + 0.02);
  });
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
  /** Web-Audio-Sounds haben play(); die gesprochene Ansage nutzt stattdessen text (siehe speakPhrase). */
  play?: PlayFn;
  text?: string;
}

export const SOUND_DEFS: SoundDef[] = [
  { id: "doorChime", label: "Da-Düü-Da", hint: "Das klassische S-Bahn-Türschließsignal", play: playDoorChime },
  { id: "doorThud", label: "Tür zu", hint: "Dumpfes Schließgeräusch", play: playDoorThud },
  { id: "switchClack", label: "Weiche", hint: "Klacken beim Überfahren", play: playSwitchClack },
  { id: "brakeHiss", label: "Bremse", hint: "Pneumatisches Zischen", play: playBrakeHiss },
  { id: "horn", label: "Signalhorn", hint: "Zweiklang-Signal", play: playHorn },
  { id: "chime", label: "Ankunft", hint: "Ding-Dong-Ansage-Chime", play: playChime },
  { id: "announcement", label: "Ansage", hint: '„Bitte die Fahrkarten bereithalten" (Sprachausgabe)', text: "Bitte die Fahrkarten bereithalten." },
];

/**
 * Gesprochene Ansage per Web Speech API (SpeechSynthesis) -- keine Audiodatei,
 * dadurch keine Lizenzfrage. Braucht eine lokal installierte deutsche
 * TTS-Stimme im Browser/System; ist die keine vorhanden, bleibt der Track
 * einfach stumm (kein Fehler, kein Absturz).
 */
let cachedGermanVoice: SpeechSynthesisVoice | null | undefined;

// Chrome laedt Stimmen teils asynchron nach -- der erste getVoices()-Aufruf
// kommt oft mit leerer Liste zurueck. Sobald "voiceschanged" feuert, den
// Cache einmalig verwerfen, damit die naechste Anfrage die echte Stimme findet.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.addEventListener(
    "voiceschanged",
    () => {
      cachedGermanVoice = undefined;
    },
    { once: true },
  );
}

function getGermanVoice(): SpeechSynthesisVoice | null {
  if (cachedGermanVoice !== undefined) return cachedGermanVoice;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    cachedGermanVoice = null;
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  cachedGermanVoice = voices.find((v) => v.lang.toLowerCase().startsWith("de")) ?? voices[0] ?? null;
  return cachedGermanVoice;
}

export function speakPhrase(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE";
    const voice = getGermanVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Keine Sprachausgabe verfuegbar -- Track bleibt einfach stumm.
  }
}

export function stopSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
