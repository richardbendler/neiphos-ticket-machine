/**
 * App-weite Sound-Effekte (nicht die spielspezifische Sound-Engine des
 * DJ-Mischers, siehe games/dj-mixer/sounds.ts) -- geteilter AudioContext,
 * lazy angelegt beim allerersten Aufruf (Browser verlangen dafuer eine
 * User-Geste, ein Tap im Kiosk erfuellt das immer).
 *
 * Zug-Tuckern nutzt den bereits im Projekt vorhandenen echten Sample-Clip
 * (siehe games/dj-mixer/sounds.ts fuer Quellenangabe/Lizenzhinweis).
 * Highscore-Chime und -Fanfare sind dagegen bewusst KOMPLETT selbst per
 * Oszillatoren synthetisiert, keine echten Audiodateien: eine "echte"
 * Fanfare (z. B. die UEFA-Champions-League-Hymne, urspruenglicher Wunsch)
 * ist urheberrechtlich geschuetzt und fuer einen oeffentlichen Festival-
 * Kiosk ein zu hohes Risiko -- anders als die kurzen Bahn-Atmo-Clips im
 * DJ-Mischer (dort ausdruecklich als vom Nutzer akzeptiertes Risiko fuer
 * einen rein lokalen/privaten Betrieb dokumentiert) waere eine bekannte
 * Vereinshymne ungleich eher wiedererkennbar und durchsetzungsstark.
 */
import trainChugUrl from "../assets/sounds/zugsgeraeusch.mp3";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function envGain(ctx: AudioContext, time: number, attack: number, decay: number, peak: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, time + attack + decay);
  return gain;
}

// ------------------------------------------------------------- Zug-Tuckern
//
// Laeuft waehrend einer Zugfahrt-Animation (Verbindungssuche, Weichenspiel,
// Zugfoto, Passagiere zaehlen, Zugsimulator) -- ein Aufrufer startet sie bei
// Fahrtbeginn und stoppt sie garantiert wieder bei Fahrtende/Spielende
// (siehe jeweiliges cleanup()).

let chugBufferPromise: Promise<AudioBuffer> | null = null;
let chugSource: AudioBufferSourceNode | null = null;
let chugGain: GainNode | null = null;

function loadChugBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  if (!chugBufferPromise) {
    chugBufferPromise = fetch(trainChugUrl)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
  }
  return chugBufferPromise;
}

/** Einmalig frueh aufrufen (z. B. Spiel-init), damit der Clip beim ersten startTrainChug() schon bereitliegt. */
export function preloadTrainChug(): void {
  void loadChugBuffer(getAudioContext());
}

export function startTrainChug(volume = 0.35): void {
  stopTrainChug();
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  chugGain = gain;
  void loadChugBuffer(ctx).then((buffer) => {
    // Falls zwischenzeitlich schon wieder gestoppt wurde (sehr kurze Fahrt),
    // nicht mehr starten -- sonst tuckert es nach dem Ankommen weiter.
    if (chugGain !== gain) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.15);
    source.start();
    chugSource = source;
  });
}

/**
 * Kurzer, sich selbst beendender Tucker-Ausschnitt statt einer Dauerschleife
 * -- fuer Spiele ohne eigene, laengere "Zug faehrt gerade"-Phase (z. B.
 * Verbindungssuche: Route waehlen -> sofortiges Ergebnis, kein animierter
 * Fahrtabschnitt dazwischen). Nutzt intern dieselbe Loop-Logik wie
 * startTrainChug()/stopTrainChug(), nur mit eingebautem Timer.
 */
export function playTrainChugBurst(durationMs = 1300, volume = 0.35): void {
  startTrainChug(volume);
  setTimeout(stopTrainChug, durationMs);
}

export function stopTrainChug(): void {
  const ctx = audioCtx;
  const gain = chugGain;
  const source = chugSource;
  chugGain = null;
  chugSource = null;
  if (!ctx || !gain) return;
  // Kurzes Fade-out statt hartem Abschneiden -- klingt beim Ankommen deutlich
  // weniger abgehackt.
  gain.gain.cancelScheduledValues(ctx.currentTime);
  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.12);
  source?.stop(ctx.currentTime + 0.15);
}

// ---------------------------------------------------- Weichenspiel-Ausgang
//
// Eigenes, kurzes akustisches Feedback direkt beim Rundenausgang
// (Weichenspiel) -- unabhaengig vom Highscore-Chime, der nur beim
// tatsaechlichen Highscore-Ereignis greift (also seltener als jede Runde).

export function playSwitchSuccessSound(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const notes = [659.25, 880]; // E5 -> A5, kurz und freundlich
  notes.forEach((freq, i) => {
    const start = now + i * 0.07;
    const dur = 0.16;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = envGain(ctx, start, 0.005, dur, 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  });
}

/** Fuer beide "Runde vorbei, aber nicht geschafft"-Faelle (Sackgasse ODER keine Wahl getroffen) -- der Unterschied ist rein textlich (siehe games/switch-run), akustisch reicht ein gemeinsamer "das war's"-Ton. */
export function playSwitchCrashSound(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.28);
  const gain = envGain(ctx, now, 0.005, 0.3, 0.22);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}

// --------------------------------------------------------- Highscore-Chime
//
// Kurzer aufsteigender Dreiklang beim Erzielen eines neuen/eingestellten
// Highscores -- eigene Komposition, kein Sample.

export function playHighscoreChime(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5-E5-G5-C6
  notes.forEach((freq, i) => {
    const start = now + i * 0.09;
    const dur = 0.35;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = envGain(ctx, start, 0.015, dur, 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  });
}

// ------------------------------------------------------- Highscore-Fanfare
//
// Laeuft in einer Schleife, solange die Highscore-Uebersicht (siehe
// core/Router.ts#showHighscores) geoeffnet ist -- eigene, kurze Fanfaren-
// Phrase statt einer real existierenden Melodie.

let fanfareTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFanfarePhrase(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const phrase: Array<{ freq: number; at: number; dur: number }> = [
    { freq: 523.25, at: 0, dur: 0.22 }, // C5
    { freq: 523.25, at: 0.28, dur: 0.22 }, // C5
    { freq: 659.25, at: 0.56, dur: 0.22 }, // E5
    { freq: 783.99, at: 0.84, dur: 0.65 }, // G5 (lang ausklingend)
  ];
  for (const note of phrase) {
    const start = now + note.at;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = note.freq;
    const gain = envGain(ctx, start, 0.01, note.dur, 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + note.dur + 0.05);
  }
  fanfareTimer = setTimeout(scheduleFanfarePhrase, 2100);
}

export function startHighscoreFanfare(): void {
  if (fanfareTimer) return; // laeuft schon
  scheduleFanfarePhrase();
}

export function stopHighscoreFanfare(): void {
  if (fanfareTimer) clearTimeout(fanfareTimer);
  fanfareTimer = null;
}
