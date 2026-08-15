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
// Auf ausdruecklichen Wunsch NUR deutsche oder englische Bahnansagen -- zwei
// urspruenglich mit recherchierte russischsprachige Ansage-Clips (St.
// Petersburg Metro bzw. "Tueren schliessen" auf Russisch) wurden deshalb
// wieder entfernt.
import zughornKurzUrl from "../assets/sounds/zughorn-kurz.ogg";
import ansageChimeUrl from "../assets/sounds/ansage-chime.ogg";
import zielanzeigeKlapperUrl from "../assets/sounds/zielanzeige-klappern.ogg";
import tuerenSchliessenUrl from "../assets/sounds/tueren-schliessen.ogg";
import bahnhofsglockeUrl from "../assets/sounds/bahnhofsglocke.ogg";
import naechsterHaltUrl from "../assets/sounds/naechster-halt.ogg";
import bahnansageKurzUrl from "../assets/sounds/bahnansage-kurz.mp3";
// Ersatz fuer den bisherigen "zurueckbleiben"-Clip NUR in dieser Rotation
// (siehe STATION_ANNOUNCEMENT_CLIPS-Kommentar) -- auf ausdruecklichen Wunsch
// "der ist viel zu doll" recherchiert: derselbe Ansagetext, aber eine
// ruhigere/leisere Originalaufnahme (Berliner U-Bahn statt der bisherigen,
// deutlich lauteren/schrilleren Quelle). games/dj-mixer/sounds.ts nutzt
// weiterhin den bisherigen zurueckbleiben.mp3-Clip unveraendert -- die beiden
// Stellen sind bewusst unabhaengig (siehe dortiger Kommentar).
import zurueckbleibenRuhigUrl from "../assets/sounds/zurueckbleiben-ruhig.ogg";
// Auf ausdruecklichen Wunsch ("noch mal wirklich so zwanzig neue Dinge")
// nochmals deutlich erweitert: 13 weitere echte Sample-Clips, diesmal gezielt
// nach konkreten deutschen Verkehrsbetrieben/Staedten recherchiert (BVG
// Berlin, Dresden, Rostock, "DB"/"Zugbetrieb" allgemein) statt generischer
// Suchbegriffe -- dadurch eindeutiger deutschen Ursprungs als z. B. ein
// schlicht "Gong" oder "U-Bahn" benannter Clip unbekannter Herkunft (genau
// solche wurden bewusst NICHT aufgenommen). Quellen (jeweils Instant-Sound-
// Button auf myinstants.com):
//  - bvgStandardgong: myinstants.com/en/instant/bvg-standardgong-39783
//                     (der klassische BVG-Tuerschliess-Gong)
//  - bvgInfogong:     myinstants.com/en/instant/bvg-infogong-29302
//  - bvgSondergong:   myinstants.com/en/instant/bvg-sondergong-5090
//  - bvgAlexanderplatz: myinstants.com/en/instant/bvg-alexanderplatz-68341
//  - bvgEndhaltestelle: myinstants.com/en/instant/bvg-endhaltestelle-76312
//  - dresdenHauptbahnhofS1: myinstants.com/en/instant/dresden-hauptbahnhof-s1-61233
//  - bahnhofsszene:   myinstants.com/en/instant/bahnhofsszene-80547
//  - bahnhofsatmo:    myinstants.com/en/instant/bahnhof-54632
//  - dbGongNeu:       myinstants.com/en/instant/db-gong-neu-29978
//  - achtungZugbetrieb: myinstants.com/en/instant/achtung-zugbetrieb-2674
//  - rostockLinie25Ostseestadion: myinstants.com/en/instant/rostock-25-hauptbahnhof-sud-ostseestadion-98998
//  - rostockLinie25Schwimmhalle: myinstants.com/en/instant/rostock-25-hauptbahnhof-sud-schwimmhalle-52049
//  - sbahnAmbiente:   myinstants.com/en/instant/s-bahn-90921
import bvgStandardgongUrl from "../assets/sounds/bvg-standardgong.mp3";
import bvgInfogongUrl from "../assets/sounds/bvg-infogong.mp3";
import bvgSondergongUrl from "../assets/sounds/bvg-sondergong.mp3";
import bvgAlexanderplatzUrl from "../assets/sounds/bvg-alexanderplatz.mp3";
import bvgEndhaltestelleUrl from "../assets/sounds/bvg-endhaltestelle.mp3";
import dresdenHauptbahnhofS1Url from "../assets/sounds/dresden-hauptbahnhof-s1.mp3";
import bahnhofsszeneUrl from "../assets/sounds/bahnhofsszene.mp3";
import bahnhofsatmoUrl from "../assets/sounds/bahnhofsatmo.mp3";
import dbGongNeuUrl from "../assets/sounds/db-gong-neu.mp3";
import achtungZugbetriebUrl from "../assets/sounds/achtung-zugbetrieb.mp3";
import rostockLinie25OstseestadionUrl from "../assets/sounds/rostock-linie25-ostseestadion.mp3";
import rostockLinie25SchwimmhalleUrl from "../assets/sounds/rostock-linie25-schwimmhalle.mp3";
import sbahnAmbienteUrl from "../assets/sounds/sbahn-ambiente.mp3";

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
 * zufaellige, typische Bahnansage/-Gong. Zwei Arten von Eintraegen:
 * "sample" sind echte, kurze Bahn-/Bahnhofs-Clips (teils dieselben wie im
 * DJ-Mischer, siehe games/dj-mixer/sounds.ts fuer Quellenangaben/
 * Lizenzhinweis, teils nur hier verwendet, siehe Quellenangaben beim
 * jeweiligen Import oben). "phrase" sind stattdessen per Web Speech API
 * (SpeechSynthesis, siehe speakStationPhrase unten) gesprochene, an echten
 * deutschen Bahn-/Nahverkehrsansagen orientierte Saetze -- auf ausdruecklichen
 * Wunsch ergaenzt, KEIN Lizenzrisiko (keine Audiodatei, nur Text), und laesst
 * sich beliebig erweitern, ohne erst eine passende Aufnahme finden zu muessen.
 */
type StationAnnouncementClip = { kind: "sample"; url: string; volume: number } | { kind: "phrase"; text: string };

const STATION_ANNOUNCEMENT_CLIPS: StationAnnouncementClip[] = [
  { kind: "sample", url: ansageDbUrl, volume: 0.6 },
  { kind: "sample", url: dbAnkuendigungUrl, volume: 0.6 },
  { kind: "sample", url: einsteigenBitteUrl, volume: 0.6 },
  { kind: "sample", url: haltestellengongUrl, volume: 0.6 },
  { kind: "sample", url: zurueckbleibenRuhigUrl, volume: 0.6 },
  { kind: "sample", url: zughornKurzUrl, volume: 0.5 },
  { kind: "sample", url: ansageChimeUrl, volume: 0.6 },
  { kind: "sample", url: zielanzeigeKlapperUrl, volume: 0.6 },
  { kind: "sample", url: tuerenSchliessenUrl, volume: 0.6 },
  { kind: "sample", url: bahnhofsglockeUrl, volume: 0.6 },
  { kind: "sample", url: naechsterHaltUrl, volume: 0.6 },
  { kind: "sample", url: bahnansageKurzUrl, volume: 0.6 },
  // 13 weitere echte Clips, siehe Quellenangaben bei den Imports oben --
  // gezielt nach konkreten deutschen Verkehrsbetrieben/Staedten recherchiert.
  { kind: "sample", url: bvgStandardgongUrl, volume: 0.6 },
  { kind: "sample", url: bvgInfogongUrl, volume: 0.6 },
  { kind: "sample", url: bvgSondergongUrl, volume: 0.6 },
  { kind: "sample", url: bvgAlexanderplatzUrl, volume: 0.55 },
  { kind: "sample", url: bvgEndhaltestelleUrl, volume: 0.6 },
  { kind: "sample", url: dresdenHauptbahnhofS1Url, volume: 0.55 },
  { kind: "sample", url: bahnhofsszeneUrl, volume: 0.5 },
  { kind: "sample", url: bahnhofsatmoUrl, volume: 0.5 },
  { kind: "sample", url: dbGongNeuUrl, volume: 0.6 },
  { kind: "sample", url: achtungZugbetriebUrl, volume: 0.55 },
  { kind: "sample", url: rostockLinie25OstseestadionUrl, volume: 0.55 },
  { kind: "sample", url: rostockLinie25SchwimmhalleUrl, volume: 0.55 },
  { kind: "sample", url: sbahnAmbienteUrl, volume: 0.5 },
  // 10 gesprochene Ansagen (siehe Typkommentar oben) -- an typischen echten
  // Ansagen von DB/S-Bahn Berlin/BVG orientiert, u. a. mit den auf
  // ausdruecklichen Wunsch genannten Beispielen "S1" und "Ringbahn".
  { kind: "phrase", text: "Bitte einsteigen und die Türen selbstständig schließen." },
  { kind: "phrase", text: "Wir bitten um Ihr Verständnis." },
  { kind: "phrase", text: "Dieser Zug endet hier. Bitte alle aussteigen." },
  { kind: "phrase", text: "Vorsicht bei der Einfahrt des Zuges." },
  { kind: "phrase", text: "Bitte beachten Sie den Abstand zwischen Zug und Bahnsteigkante." },
  { kind: "phrase", text: "Wegen einer Signalstörung kommt es zu Verspätungen im S-Bahn-Verkehr." },
  { kind: "phrase", text: "Diese S-Bahn verkehrt als Ringbahn in Richtung Südkreuz." },
  { kind: "phrase", text: "Die S1 nach Wannsee fährt in Kürze auf Gleis 2 ein." },
  { kind: "phrase", text: "Fahrausweise bitte bereithalten, es finden Kontrollen statt." },
  { kind: "phrase", text: "Meine Damen und Herren, wir erreichen in Kürze den Hauptbahnhof." },
];

// Merkt sich den zuletzt gespielten Clip-Index, damit nicht zweimal
// hintereinander genau derselbe Sound laeuft (auf ausdruecklichen Wunsch) --
// bei zufaelliger Auswahl aus jetzt weit ueber 30 Eintraegen waere eine
// Wiederholung ohnehin schon selten, aber eben nicht ausgeschlossen.
let lastAnnouncementIndex = -1;

// Manche der recherchierten Clips sind echte, laengere Ansagen (bis zu ca.
// 22s) -- laenger als der kuerzeste Abstand zwischen zwei geplanten
// Ansage-Zeitpunkten (7s, siehe ANNOUNCEMENT_INTERVAL_MIN_S). Ohne diese
// Sperre koennte deshalb ein neuer Clip starten, waehrend der vorherige noch
// laeuft -- zwei gleichzeitige Ansagen uebereinander waeren genau die Art
// von aufdringlichem Krach, die hier ausdruecklich vermieden werden soll.
// Ein uebersprungener Zeitpunkt (weil noch "busy") wird einfach ausgelassen,
// der naechste kommt regulaer 7-13s spaeter. Gilt fuer beide Clip-Arten
// (Sample UND gesprochene Phrase).
let stationAnnouncementBusy = false;
// Laeuft gerade eine Sample-Ansage, wird sie hier gehalten -- damit
// stopStationAnnouncements() sie beim Verlassen der Huepftier-Metro sofort
// abwuergen kann, statt ueber den Hauptmenue-Bildschirm hinweg
// weiterzulaufen (gemeldeter Bug: "Geraeuschkulisse laeuft nach Rueckkehr
// ins Menue weiter"). activeAnnouncementUtterance ist das Pendant fuer eine
// gerade gesprochene Phrase.
let activeAnnouncementSource: AudioBufferSourceNode | null = null;
let activeAnnouncementUtterance: SpeechSynthesisUtterance | null = null;

// Eigene, bewusst von games/dj-mixer/sounds.ts#getGermanVoice unabhaengige
// Kopie (core/ soll nicht von games/ abhaengen) -- identisches, kleines
// Muster: Chrome laedt Stimmen teils asynchron nach, der erste getVoices()-
// Aufruf kommt oft mit leerer Liste zurueck.
let cachedGermanVoice: SpeechSynthesisVoice | null | undefined;
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

function speakStationPhrase(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    stationAnnouncementBusy = false; // keine Sprachausgabe verfuegbar -- Kulisse nicht dauerhaft blockieren
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "de-DE";
  const voice = getGermanVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95; // etwas ruhiger als die DJ-Mischer-Ansage (1.05) -- soll nach durchsagender Bahnansage klingen, nicht gehetzt
  utterance.volume = 0.8;
  const clearIfCurrent = () => {
    stationAnnouncementBusy = false;
    if (activeAnnouncementUtterance === utterance) activeAnnouncementUtterance = null;
  };
  utterance.onend = clearIfCurrent;
  utterance.onerror = clearIfCurrent;
  activeAnnouncementUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function playRandomStationAnnouncement(): void {
  if (stationAnnouncementBusy) return;
  let index = Math.floor(Math.random() * STATION_ANNOUNCEMENT_CLIPS.length);
  if (index === lastAnnouncementIndex) {
    index = (index + 1 + Math.floor(Math.random() * (STATION_ANNOUNCEMENT_CLIPS.length - 1))) % STATION_ANNOUNCEMENT_CLIPS.length;
  }
  lastAnnouncementIndex = index;
  const clip = STATION_ANNOUNCEMENT_CLIPS[index];
  stationAnnouncementBusy = true;

  if (clip.kind === "phrase") {
    speakStationPhrase(clip.text);
    return;
  }

  const ctx = getAudioContext();
  void loadSampleBuffer(ctx, clip.url).then(
    (buffer) => {
      const gain = ctx.createGain();
      gain.gain.value = clip.volume;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain).connect(ctx.destination);
      source.onended = () => {
        stationAnnouncementBusy = false;
        if (activeAnnouncementSource === source) activeAnnouncementSource = null;
      };
      activeAnnouncementSource = source;
      source.start();
    },
    () => {
      stationAnnouncementBusy = false; // Ladefehler soll die Kulisse nicht dauerhaft blockieren
    },
  );
}

/**
 * Bricht eine gerade laufende Bahnhofsansage sofort ab -- beim Verlassen der
 * Huepftier-Metro aufzurufen (siehe games/mini-metro/index.ts#cleanup), damit
 * eine lange Ansage nicht ueber den Hauptmenue-Bildschirm hinweg weiterlaeuft.
 * Deckt beide Clip-Arten ab (Sample-Wiedergabe UND Sprachausgabe).
 */
export function stopStationAnnouncements(): void {
  if (activeAnnouncementSource) {
    try {
      activeAnnouncementSource.stop();
    } catch {
      // Kann schon von selbst zu Ende gelaufen sein -- kein Problem.
    }
    activeAnnouncementSource = null;
  }
  if (activeAnnouncementUtterance && typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    activeAnnouncementUtterance = null;
  }
  stationAnnouncementBusy = false;
}
