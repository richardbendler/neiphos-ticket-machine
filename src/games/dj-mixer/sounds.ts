/**
 * Der Grossteil der Sounds ist rein prozedural per Web Audio API synthetisiert
 * (Oszillatoren + gefiltertes Rauschen) -- keine Audiodatei noetig, dadurch
 * garantiert offline-tauglich und lizenzfrei. Jede Funktion plant ihren Klang
 * exakt zum uebergebenen AudioContext-Zeitpunkt (fuer sample-genaues
 * Sequencer-Timing, siehe index.ts).
 *
 * Zusaetzlich enthaelt das Board ein paar echte, kurze Bahn-Sample-Clips
 * (Ansagen/Atmo, s. SAMPLE_SOUND_DEFS unten) -- auf ausdruecklichen Wunsch
 * trotz Lizenzrisiko eingebunden, da die App nur lokal/privat laeuft und
 * nicht oeffentlich verteilt wird. Anders als die synthetisierten Sounds sind
 * das keine eigenen Kompositionen, siehe Quellenangaben dort.
 */

export type SoundId = "kick" | "snare" | "hiHat" | "horn" | "chime" | "announcement" | "dbAnkuendigung" | "ansageDb" | "sBahnNeu" | "zugbetrieb";

/**
 * playbackRate ist nur fuer die Sample-Clips relevant (siehe
 * makeSamplePlayFn) -- die synthetisierten Sounds sind ohnehin kurze,
 * exakt zum Takt geplante Huellkurven und muessen dafuer nicht gestreckt
 * werden.
 */
type PlayFn = (ctx: AudioContext, time: number, destination: AudioNode, playbackRate: number) => void;

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

// --------------------------------------------------- Klassische Beat-Basis
//
// Jeder Beat braucht im Kern drei Elemente: Kick (Bassdrum), Snare und
// Hi-Hat. Hier bahn-thematisch nachgebaut, damit sich damit ein richtiger
// Rhythmus bauen laesst, der trotzdem nach Zug klingt.

/** Kick: tiefer Radaufschlag auf der Schiene statt klassischer Bassdrum. */
const playKick: PlayFn = (ctx, time, destination) => {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(130, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);
  const gain = envGain(ctx, time, 0.002, 0.22, 0.9);
  osc.connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + 0.26);
};

/** Snare: Kupplungsklacken -- kurzer Rauschimpuls plus tonaler Kern fuer Punch. */
const playSnare: PlayFn = (ctx, time, destination) => {
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1400;
  filter.Q.value = 1.2;
  const noiseGain = envGain(ctx, time, 0.001, 0.09, 0.5);
  noise.connect(filter).connect(noiseGain).connect(destination);
  noise.start(time);
  noise.stop(time + 0.12);

  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.value = 210;
  const bodyGain = envGain(ctx, time, 0.001, 0.06, 0.35);
  body.connect(bodyGain).connect(destination);
  body.start(time);
  body.stop(time + 0.08);
};

/** Hi-Hat: kurzer Druckluft-Tick, wie ein knappes Bremsluft-Zischen. */
const playHiHat: PlayFn = (ctx, time, destination) => {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7500;
  const gain = envGain(ctx, time, 0.001, 0.035, 0.3);
  src.connect(filter).connect(gain).connect(destination);
  src.start(time);
  src.stop(time + 0.05);
};

// -------------------------------------------------------------- Sample-Clips
//
// Kurze, echte Bahn-Sound-Clips (Ansagen/Signalhorn/Atmo), per
// fetch()+decodeAudioData() als AudioBuffer geladen und wie die
// synthetisierten Sounds sample-genau zum Sequencer-Takt abgespielt --
// inkl. BPM-abhaengiger Wiedergabegeschwindigkeit (siehe makeSamplePlayFn),
// damit sie sich beim Aendern des Tempos mit dehnen/stauchen statt aus dem
// Takt zu laufen. Herkunft (jeweils Instant-Sound-Button auf myinstants.com):
//  - dbAnkuendigung: myinstants.com/en/instant/deutsche-bahn-ankundigung-45554
//  - ansageDb:       myinstants.com/en/instant/ansage-db-72287
//  - sBahnNeu:       myinstants.com/en/instant/s-bahn-neu-85653
//  - zugbetrieb:     myinstants.com/en/instant/achtung-zugbetrieb-2674
//  - horn:           myinstants.com/en/instant/train-horn (echtes Signalhorn
//                     statt der vorherigen, zu kuenstlich klingenden
//                     Web-Audio-Synthese)
//  - chime:          myinstants.com/en/instant/ankunft-1-32312
import dbAnkuendigungUrl from "../../assets/sounds/db-ankuendigung.mp3";
import ansageDbUrl from "../../assets/sounds/ansage-db.mp3";
import sBahnNeuUrl from "../../assets/sounds/s-bahn-neu.mp3";
import zugbetriebUrl from "../../assets/sounds/achtung-zugbetrieb.mp3";
import hornUrl from "../../assets/sounds/train-horn.mp3";
import chimeUrl from "../../assets/sounds/ankunft.mp3";

const sampleBufferCache = new Map<string, Promise<AudioBuffer>>();

async function loadSampleBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  let cached = sampleBufferCache.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    sampleBufferCache.set(url, cached);
  }
  return cached;
}

/**
 * Lauffaehiger Sound-Datei-Import (via Vite als URL gebuendelt) noch bevor
 * er gebraucht wird -- vermeidet eine hoerbare Verzoegerung beim allerersten
 * Antippen eines Sample-Sounds waehrend des Spiels.
 */
export function preloadSamples(ctx: AudioContext): void {
  for (const url of SAMPLE_URLS) void loadSampleBuffer(ctx, url);
}

function makeSamplePlayFn(url: string): PlayFn {
  return (ctx, time, destination, playbackRate) => {
    void loadSampleBuffer(ctx, url).then((buffer) => {
      // Der Sequencer kann bis zur Fertigstellung des Decodings schon
      // weitergelaufen sein -- ein bereits verstrichener Zielzeitpunkt
      // wuerde AudioBufferSourceNode.start() sonst mit einem Fehler abbrechen.
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      // An das aktuelle Tempo angepasst (relativ zum Referenz-BPM in
      // index.ts), damit die Sample-Clips nicht immer gleich lang klingen,
      // egal wie schnell der Beat gerade laeuft.
      src.playbackRate.value = playbackRate;
      src.connect(destination);
      src.start(Math.max(time, ctx.currentTime));
    });
  };
}

const SAMPLE_URLS = [dbAnkuendigungUrl, ansageDbUrl, sBahnNeuUrl, zugbetriebUrl, hornUrl, chimeUrl];

export interface SoundDef {
  id: SoundId;
  label: string;
  hint: string;
  /** Web-Audio-Sounds haben play(); die gesprochene Ansage nutzt stattdessen text (siehe speakPhrase). */
  play?: PlayFn;
  text?: string;
}

export const SOUND_DEFS: SoundDef[] = [
  { id: "kick", label: "Tür zu", hint: "Dumpfes Schließgeräusch (Kick)", play: playKick },
  { id: "snare", label: "Weiche", hint: "Kupplungsklacken (Snare)", play: playSnare },
  { id: "hiHat", label: "Bremse", hint: "Druckluft-Tick (Hi-Hat)", play: playHiHat },
  { id: "horn", label: "Signalhorn", hint: "Echtes Zug-Signalhorn (Sample-Clip)", play: makeSamplePlayFn(hornUrl) },
  { id: "chime", label: "Ankunft", hint: "Ankunfts-Ansage-Chime (Sample-Clip)", play: makeSamplePlayFn(chimeUrl) },
  { id: "announcement", label: "Ansage", hint: '„Bitte die Fahrkarten bereithalten" (Sprachausgabe)', text: "Bitte die Fahrkarten bereithalten." },
  { id: "dbAnkuendigung", label: "DB-Ansage", hint: "Bahn-Ansage (Sample-Clip)", play: makeSamplePlayFn(dbAnkuendigungUrl) },
  { id: "ansageDb", label: "Ansage 2", hint: "Bahn-Ansage (Sample-Clip)", play: makeSamplePlayFn(ansageDbUrl) },
  { id: "sBahnNeu", label: "S-Bahn", hint: "S-Bahn-Geräusch (Sample-Clip)", play: makeSamplePlayFn(sBahnNeuUrl) },
  { id: "zugbetrieb", label: "Achtung", hint: '„Achtung am Gleis" (Sample-Clip)', play: makeSamplePlayFn(zugbetriebUrl) },
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
