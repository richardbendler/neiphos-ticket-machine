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
import dbAnkuendigungUrl from "../assets/sounds/db-ankuendigung.mp3";
import ansageDbUrl from "../assets/sounds/ansage-db.mp3";
import einsteigenBitteUrl from "../assets/sounds/einsteigen-bitte.mp3";
import haltestellengongUrl from "../assets/sounds/haltestellengong.mp3";
// Auf ausdruecklichen Wunsch ca. zehn weitere Clips fuer die Huepftier-Metro-
// Bahnhofskulisse recherchiert (siehe STATION_ANNOUNCEMENT_CLIPS unten) --
// echte kurze Bahn-/Bahnhofs-Sample-Clips, aus denselben Quellen-Kategorien
// wie die bereits vorhandenen (oeffentlich frei verfuegbare Wikimedia-
// Commons- bzw. Pixabay-Aufnahmen), unter demselben bereits dokumentierten
// Lizenzrisiko-Vorbehalt wie die uebrigen echten Sample-Clips im Projekt
// (siehe games/dj-mixer/sounds.ts, Datei-Kommentar oben).
import zughornKurzUrl from "../assets/sounds/zughorn-kurz.ogg";
import ansageChimeUrl from "../assets/sounds/ansage-chime.ogg";
import zielanzeigeKlapperUrl from "../assets/sounds/zielanzeige-klappern.ogg";
import tuerenSchliessenUrl from "../assets/sounds/tueren-schliessen.ogg";
import bahnhofsglockeUrl from "../assets/sounds/bahnhofsglocke.ogg";
import metroAnsageLangUrl from "../assets/sounds/metro-ansage-lang.ogg";
import naechsterHaltUrl from "../assets/sounds/naechster-halt.ogg";
import tuerenSchliessenAnsageUrl from "../assets/sounds/tueren-schliessen-ansage.ogg";
import bahnansageKurzUrl from "../assets/sounds/bahnansage-kurz.mp3";
// Ersatz fuer den bisherigen "zurueckbleiben"-Clip NUR in dieser Rotation
// (siehe STATION_ANNOUNCEMENT_CLIPS-Kommentar) -- auf ausdruecklichen Wunsch
// "der ist viel zu doll" recherchiert: derselbe Ansagetext, aber eine
// ruhigere/leisere Originalaufnahme (Berliner U-Bahn statt der bisherigen,
// deutlich lauteren/schrilleren Quelle). games/dj-mixer/sounds.ts nutzt
// weiterhin den bisherigen zurueckbleiben.mp3-Clip unveraendert -- die beiden
// Stellen sind bewusst unabhaengig (siehe dortiger Kommentar).
import zurueckbleibenRuhigUrl from "../assets/sounds/zurueckbleiben-ruhig.ogg";

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

/** Spielt einen Sample-Clip einmal komplett ab (kein Loop) -- fuer kurze, einmalige Hinweistoene. */
function playSampleOnce(url: string, volume = 1): void {
  const ctx = getAudioContext();
  void loadSampleBuffer(ctx, url).then((buffer) => {
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
  });
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

// -------------------------------------------------- Party-Shuttle (Finale)
//
// Kurzer, selbst komponierter "Party"-Jingle -- laeuft, waehrend am Ende
// des Zugsimulators das kleine Shuttle zum Neiphos Festival ins Bild
// faehrt (siehe games/train-sim/index.ts). Wie Highscore-Chime/
// Weichenspiel-Sounds komplett synthetisiert, kein Sample -- aus demselben
// Grund wie die urspruenglich gewuenschte, dann verworfene Champions-
// League-Fanfare (siehe Highscore-Chime-Kommentar weiter unten): echte
// Musik waere urheberrechtlich riskant.

export function playPartyShuttleJingle(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  // Treibende Basslinie im Viertel-Puls.
  const bassNotes = [65.41, 65.41, 98.0, 87.31]; // C2-C2-G2-F2
  bassNotes.forEach((freq, i) => {
    const start = now + i * 0.3;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const gain = envGain(ctx, start, 0.005, 0.22, 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.28);
  });
  // Froehliches Arpeggio obendrauf, zweimal durchlaufen.
  const arp = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25]; // C-E-G-C-G-E
  for (let rep = 0; rep < 2; rep++) {
    arp.forEach((freq, i) => {
      const start = now + rep * 1.2 + i * 0.1;
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      const gain = envGain(ctx, start, 0.005, 0.14, 0.11);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }
}

// --------------------------------------------- Highscore-Board: Oeffnen-Sound
//
// War zunaechst eine in Schleife laufende, selbst komponierte Fanfare
// (siehe Git-Historie) -- auf ausdruecklichen Wunsch wieder entfernt ("die
// mag ich gar nicht"). Stattdessen einmalig beim Oeffnen der Ansicht die
// bereits vorhandene DB-Ansage abspielen (siehe games/dj-mixer/sounds.ts
// fuer Quellenangabe/Lizenzhinweis zu diesem Sample). Dieselbe Funktion
// laeuft jetzt auch beim Erzielen eines neuen Highscores (siehe
// core/highscorePrompt.ts) -- der dafuer urspruenglich eigens komponierte
// Chime (aufsteigender Dreiklang) wurde als unpassend empfunden ("dieser
// komische Sound").
export function playHighscoreOpenSound(): void {
  playSampleOnce(dbAnkuendigungUrl, 0.8);
}

// ------------------------------------------------------ Huepftier-Metro

/** Ganz kurzer, unaufdringlicher "Plopp" -- laeuft jedes Mal, wenn eine neue Haltestelle spawnt (siehe games/mini-metro/index.ts#spawnStation). Bewusst leise/kurz, da das mehrfach pro Runde passiert. */
export function playStationPopSound(): void {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
  const gain = envGain(ctx, now, 0.005, 0.11, 0.14);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.14);
}

/**
 * Optionale Bahnhofs-Geraeuschkulisse (an/aus per Button, siehe
 * games/mini-metro/index.ts) -- spielt in unregelmaessigen Abstaenden eine
 * zufaellige, typische Bahnansage/-Gong aus dem bereits vorhandenen Sample-
 * Set (dieselben Clips wie im DJ-Mischer, siehe games/dj-mixer/sounds.ts
 * fuer Quellenangaben/Lizenzhinweis). Bewusst eine kleine, feste Auswahl statt
 * eines einzelnen Clips, damit es sich nach ein paar Ansagen nicht repetitiv
 * anfuehlt.
 */
const STATION_ANNOUNCEMENT_CLIPS: Array<{ url: string; volume: number }> = [
  { url: ansageDbUrl, volume: 0.6 },
  { url: dbAnkuendigungUrl, volume: 0.6 },
  { url: einsteigenBitteUrl, volume: 0.6 },
  { url: haltestellengongUrl, volume: 0.6 },
  { url: zurueckbleibenRuhigUrl, volume: 0.6 },
  { url: zughornKurzUrl, volume: 0.5 },
  { url: ansageChimeUrl, volume: 0.6 },
  { url: zielanzeigeKlapperUrl, volume: 0.6 },
  { url: tuerenSchliessenUrl, volume: 0.6 },
  { url: bahnhofsglockeUrl, volume: 0.6 },
  { url: metroAnsageLangUrl, volume: 0.6 },
  { url: naechsterHaltUrl, volume: 0.6 },
  { url: tuerenSchliessenAnsageUrl, volume: 0.6 },
  { url: bahnansageKurzUrl, volume: 0.6 },
];

// Merkt sich den zuletzt gespielten Clip-Index, damit nicht zweimal
// hintereinander genau derselbe Sound laeuft (auf ausdruecklichen Wunsch) --
// bei zufaelliger Auswahl aus jetzt 14 Clips waere eine Wiederholung selten,
// aber eben nicht ausgeschlossen.
let lastAnnouncementIndex = -1;

// Manche der recherchierten Clips sind echte, laengere Ansagen (bis zu ca.
// 22s) -- laenger als der kuerzeste Abstand zwischen zwei geplanten
// Ansage-Zeitpunkten (7s, siehe ANNOUNCEMENT_INTERVAL_MIN_S). Ohne diese
// Sperre koennte deshalb ein neuer Clip starten, waehrend der vorherige noch
// laeuft -- zwei gleichzeitige Ansagen uebereinander waeren genau die Art
// von aufdringlichem Krach, die hier ausdruecklich vermieden werden soll.
// Ein uebersprungener Zeitpunkt (weil noch "busy") wird einfach ausgelassen,
// der naechste kommt regulaer 7-13s spaeter.
let stationAnnouncementBusy = false;

export function playRandomStationAnnouncement(): void {
  if (stationAnnouncementBusy) return;
  let index = Math.floor(Math.random() * STATION_ANNOUNCEMENT_CLIPS.length);
  if (index === lastAnnouncementIndex) {
    index = (index + 1 + Math.floor(Math.random() * (STATION_ANNOUNCEMENT_CLIPS.length - 1))) % STATION_ANNOUNCEMENT_CLIPS.length;
  }
  lastAnnouncementIndex = index;
  const clip = STATION_ANNOUNCEMENT_CLIPS[index];
  const ctx = getAudioContext();
  stationAnnouncementBusy = true;
  void loadSampleBuffer(ctx, clip.url).then(
    (buffer) => {
      const gain = ctx.createGain();
      gain.gain.value = clip.volume;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.onended = () => {
        stationAnnouncementBusy = false;
      };
      source.start();
    },
    () => {
      stationAnnouncementBusy = false; // Ladefehler soll die Kulisse nicht dauerhaft blockieren
    },
  );
}
