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

export type SoundId =
  | "kick"
  | "snare"
  | "hiHat"
  | "horn"
  | "dbAnkuendigung"
  | "ansageDb"
  | "sBahnNeu"
  | "railroadBell"
  | "steamBrake"
  | "trainRumble"
  | "tramBell"
  | "hornParis"
  | "hornChina"
  | "hornJapan"
  | "hornUk"
  | "steamWhistle"
  | "hopperSqueak"
  | "zurueckbleiben"
  | "einsteigenBitte"
  | "haltestellengong"
  | "bvgStandardgong"
  | "bvgInfogong"
  | "bvgSondergong"
  | "bvgAlexanderplatz"
  | "bvgEndhaltestelle"
  | "dbGongNeu"
  | "xWagenTuer"
  | "achtungZugbetrieb"
  | "aufzugDing"
  | "bahnsteigPfiff";

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

/**
 * Kick: tiefer Radaufschlag auf der Schiene statt klassischer Bassdrum.
 * Zielfrequenz am Ende des Sweeps auf ausdruecklichen Lautstaerke-Wunsch von
 * 42 auf 60 Hz angehoben -- Amplitude war hier schon nahe der Decke (0.9),
 * konnte also kaum lauter gestellt werden; 42 Hz liegt aber ausserhalb dessen,
 * was kleine Kiosk-Lautsprecher ueberhaupt ordentlich wiedergeben (Bass-
 * Frequenzen brauchen bei gleicher Lautstaerke-Wahrnehmung deutlich mehr
 * Pegel als Mitten/Hoehen), 60 Hz wird auf typischen Kleinlautsprechern
 * hoerbar praesenter. Decay etwas laenger (mehr Energie/RMS ohne hoeheren
 * Spitzenpegel), Peak an die (per Lautstaerke-Messung ermittelte) sichere
 * Decke von 0.95 angehoben.
 */
const playKick: PlayFn = (ctx, time, destination) => {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(130, time);
  osc.frequency.exponentialRampToValueAtTime(60, time + 0.09);
  const gain = envGain(ctx, time, 0.002, 0.25, 0.95);
  osc.connect(gain).connect(destination);
  osc.start(time);
  osc.stop(time + 0.29);
};

/**
 * Snare: Kupplungsklacken -- kurzer Rauschimpuls plus tonaler Kern fuer Punch.
 * Peaks knapp verdoppelt (Lautstaerke-Messung: Snare war mit ca. -27dB RMS
 * eines der leisesten Elemente im ganzen Board, deutlich unter Kick/anderen
 * Sample-Clips) -- reichlich Headroom war vorhanden (alter Peak nur ca. 0.48
 * von maximal 1.0), daher ohne Verzerrungsrisiko moeglich.
 */
const playSnare: PlayFn = (ctx, time, destination) => {
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1400;
  filter.Q.value = 1.2;
  const noiseGain = envGain(ctx, time, 0.001, 0.09, 0.95);
  noise.connect(filter).connect(noiseGain).connect(destination);
  noise.start(time);
  noise.stop(time + 0.12);

  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.value = 210;
  const bodyGain = envGain(ctx, time, 0.001, 0.06, 0.65);
  body.connect(bodyGain).connect(destination);
  body.start(time);
  body.stop(time + 0.08);
};

/**
 * Hi-Hat: kurzer Druckluft-Tick, wie ein knappes Bremsluft-Zischen. Peak von
 * 0.3 auf 0.75 angehoben (Lautstaerke-Messung: mit ca. -30dB RMS das
 * leiseste Element im ganzen Board) -- bewusst knapp unter der sicheren
 * Decke (0.93) belassen statt bis ans Maximum, damit das hochfrequente
 * Zischen nicht unangenehm schrill wird.
 */
const playHiHat: PlayFn = (ctx, time, destination) => {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 7500;
  const gain = envGain(ctx, time, 0.001, 0.035, 0.75);
  src.connect(filter).connect(gain).connect(destination);
  src.start(time);
  src.stop(time + 0.05);
};

/**
 * Huepftier: quietschendes Gummispielzeug (wie eine Quietscheente, die man
 * zusammendrueckt) -- rein synthetisiert statt Sample-Clip, passt vom
 * Aufbau her zu Kick/Snare/Hi-Hat oben. Saegezahn (fuer die etwas raue,
 * "quiekende" Klangfarbe) plus ein schnelles Vibrato-LFO auf der Frequenz
 * simuliert das typische Zittern eines Gummi-Quietschers; die Grundtonhoehe
 * faellt dabei leicht ab, wie beim Nachlassen des Drucks beim Zusammendruecken.
 */
const playHopperSqueak: PlayFn = (ctx, time, destination) => {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(1500, time);
  osc.frequency.exponentialRampToValueAtTime(950, time + 0.15);

  const vibrato = ctx.createOscillator();
  vibrato.type = "sine";
  vibrato.frequency.value = 60;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 90;
  vibrato.connect(vibratoDepth).connect(osc.frequency);

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1700;
  filter.Q.value = 2.5;

  // Peak schon zweimal erhoeht (zuletzt 0.5 -> 0.85), ging im Mix aber
  // weiterhin unter -- der Bandpass-Filter oben schluckt einen grossen Teil
  // des Rohsignals, der tatsaechliche Ausgangspegel lag laut Lautstaerke-
  // Messung bei nur ca. -24dB RMS (eines der leiseren Elemente). Deutlich
  // hoeher gestellt, damit nach dem Filter wirklich spuerbar mehr ankommt.
  const gain = envGain(ctx, time, 0.008, 0.17, 1.7);
  osc.connect(filter).connect(gain).connect(destination);

  osc.start(time);
  vibrato.start(time);
  osc.stop(time + 0.22);
  vibrato.stop(time + 0.22);
};

// -------------------------------------------------------------- Sample-Clips
//
// Kurze, echte Bahn-Sound-Clips (Ansagen/Hupen/Atmo), per
// fetch()+decodeAudioData() als AudioBuffer geladen und wie die
// synthetisierten Sounds sample-genau zum Sequencer-Takt abgespielt --
// inkl. BPM-abhaengiger Wiedergabegeschwindigkeit (siehe makeSamplePlayFn),
// damit sie sich beim Aendern des Tempos mit dehnen/stauchen statt aus dem
// Takt zu laufen (Ausnahme: ansageDb, siehe fixedPitch dort). Alle Clips
// wurden ausserdem einmalig per ffmpeg um ihre jeweilige (durch
// silencedetect ermittelte) Anfangsstille gekuerzt, damit sie im Sequencer
// wirklich exakt auf dem Taktschlag einsetzen. Herkunft (jeweils
// Instant-Sound-Button auf myinstants.com):
//  - dbAnkuendigung: myinstants.com/en/instant/deutsche-bahn-ankundigung-45554
//  - ansageDb:       myinstants.com/en/instant/ansage-db-72287
//  - sBahnNeu:       myinstants.com/en/instant/s-bahn-neu-85653
//  - horn:           myinstants.com/en/instant/train-horn (klingt eher nach
//                     rhythmischem Tuckern als nach einem harten
//                     Signalhorn, daher hier als "Choo-Choo" benannt)
//  - railroadBell:   myinstants.com/en/instant/bells-railroad-crossing-18898
//  - steamBrake:     myinstants.com/en/instant/steam-locomotive-brakes-screaming-67672
//  - trainRumble:    myinstants.com/en/instant/anderes-zugsgerausch-7741
//  - tramBell:       myinstants.com/en/instant/tram-bell-45667
//  - hornParis:      myinstants.com/en/instant/paris-train-horn
//  - hornChina:      myinstants.com/en/instant/chinese-diesel-locomotive-horn
//  - hornJapan:      myinstants.com/en/instant/jr-e353-series-horn
//  - hornUk:         myinstants.com/en/instant/british-class-141-horn-sound
//  - steamWhistle:   myinstants.com/en/instant/nkp-765-whistle (Pfeife der
//                     erhaltenen Dampflok Nickel Plate Road 765)
//  - zurueckbleiben: myinstants.com/en/instant/zuruckbleiben-bitte-berlin-95485
//                     ("Zurückbleiben bitte" -- klassische Berliner
//                     U-Bahn-Ansage, passt thematisch zum Festival-Standort)
//  - einsteigenBitte: myinstants.com/en/instant/einsteigen-bitte-792
//  - haltestellengong: myinstants.com/en/instant/rostock-bus-ansagengong-rsag-haltestellengong-349
//                     (Bus-/Straßenbahn-Haltestellengong statt Zug -- fuer
//                     mehr Abwechslung zu den bisher reinen Zug-Sounds)
//
// Auf ausdruecklichen Wunsch nochmals 10 weitere kurze, im deutschen Raum
// (v.a. Berlin, wo die App/das Festival verortet ist) wiedererkennbare
// Bahn-/Nahverkehrs-Signaltoene ergaenzt -- bewusst mit Schwerpunkt auf
// echten BVG-Toenen (Berlin), passend zum bereits vorhandenen
// "zurueckbleiben"-Clip (klassische Berliner U-Bahn-Ansage). Dieselben
// BVG-/DB-Clips werden teils auch in core/sound.ts fuer die
// Huepftier-Metro-Bahnhofskulisse verwendet (dort mit eigenem Import,
// siehe dortiger Quellenkommentar) -- wie bei dbAnkuendigung/ansageDb/
// einsteigenBitte/haltestellengong oben ist das absichtlich dieselbe
// Datei an zwei Stellen, kein Duplikat-Download. Quellen (jeweils
// Instant-Sound-Button auf myinstants.com):
//  - bvgStandardgong: myinstants.com/en/instant/bvg-standardgong-39783
//                     (der klassische BVG-U-Bahn-Tuerschliess-Gong, Berlin)
//  - bvgInfogong:     myinstants.com/en/instant/bvg-infogong-29302
//                     (kurzer Gong vor BVG-Lautsprecherdurchsagen, Berlin)
//  - bvgSondergong:   myinstants.com/en/instant/bvg-sondergong-5090
//                     (BVG-Gong fuer Sonderansagen/Stoerungshinweise, Berlin)
//  - bvgAlexanderplatz: myinstants.com/en/instant/bvg-alexanderplatz-68341
//                     (BVG-Ansagegong + Stationsname "Alexanderplatz", Berlin)
//  - bvgEndhaltestelle: myinstants.com/en/instant/bvg-endhaltestelle-76312
//                     (BVG-Ansagegong "Endstation, bitte alle aussteigen", Berlin)
//  - dbGongNeu:       myinstants.com/en/instant/db-gong-neu-29978 (neuerer
//                     DB-Bahnhofsdurchsage-Gong, bundesweit an DB-Stationen
//                     inkl. Berlin Hauptbahnhof zu hoeren)
//  - xWagenTuer:      myinstants.com/en/instant/x-wagen-tur-72596
//                     (Tuerschliess-Signal der Baureihe "X-Wagen", einer
//                     echten deutschen U-Bahn-/Stadtbahn-Baureihe, u.a.
//                     Nuernberg/NRW -- fuellt die bisherige Luecke im
//                     Bestand an "hornDE"-artigen deutschen Zug-/Bahn-
//                     Tuer-Signaltoenen)
//  - achtungZugbetrieb: myinstants.com/en/instant/achtung-zugbetrieb-2674
//                     (DB-Warnansage "Achtung, Zugbetrieb", bundesweit)
//  - aufzugDing:      myinstants.com/en/instant/elevator-ding-5180 (generischer
//                     Aufzug-Signalton -- steht hier fuer den Aufzug am
//                     Bahnsteig, im weiteren Sinne Bahnhofsthematik)
//  - bahnsteigPfiff:  myinstants.com/en/instant/referee-whistle-70248
//                     (generischer kurzer Pfiff -- steht hier fuer den
//                     klassischen Abfahrts-/Zugabfertigungspfiff auf dem
//                     Bahnsteig)
import dbAnkuendigungUrl from "../../assets/sounds/db-ankuendigung.mp3";
import ansageDbUrl from "../../assets/sounds/ansage-db.mp3";
import sBahnNeuUrl from "../../assets/sounds/s-bahn-neu.mp3";
import hornUrl from "../../assets/sounds/train-horn.mp3";
import railroadBellUrl from "../../assets/sounds/railroad-bell.mp3";
import steamBrakeUrl from "../../assets/sounds/steam-brake.mp3";
import trainRumbleUrl from "../../assets/sounds/zugsgeraeusch.mp3";
import tramBellUrl from "../../assets/sounds/tram-bell.mp3";
import hornParisUrl from "../../assets/sounds/horn-paris.mp3";
import hornChinaUrl from "../../assets/sounds/horn-china.mp3";
import hornJapanUrl from "../../assets/sounds/horn-japan.mp3";
import hornUkUrl from "../../assets/sounds/horn-uk.mp3";
import steamWhistleUrl from "../../assets/sounds/steam-whistle.mp3";
import zurueckbleibenUrl from "../../assets/sounds/zurueckbleiben.mp3";
import einsteigenBitteUrl from "../../assets/sounds/einsteigen-bitte.mp3";
import haltestellengongUrl from "../../assets/sounds/haltestellengong.mp3";
import bvgStandardgongUrl from "../../assets/sounds/bvg-standardgong.mp3";
import bvgInfogongUrl from "../../assets/sounds/bvg-infogong.mp3";
import bvgSondergongUrl from "../../assets/sounds/bvg-sondergong.mp3";
import bvgAlexanderplatzUrl from "../../assets/sounds/bvg-alexanderplatz.mp3";
import bvgEndhaltestelleUrl from "../../assets/sounds/bvg-endhaltestelle.mp3";
import dbGongNeuUrl from "../../assets/sounds/db-gong-neu.mp3";
import xWagenTuerUrl from "../../assets/sounds/u-bahn-x-wagen-tuer.mp3";
import achtungZugbetriebUrl from "../../assets/sounds/achtung-zugbetrieb.mp3";
import aufzugDingUrl from "../../assets/sounds/aufzug-ding.mp3";
import bahnsteigPfiffUrl from "../../assets/sounds/bahnsteig-pfiff.mp3";

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

/**
 * gainBoost gleicht aus, dass die Original-Clips sehr unterschiedlich laut
 * abgemischt sind (manche Instant-Sound-Buttons sind kaum hoerbar leise,
 * andere fast Vollausschlag) -- Faktoren unten sind anhand des tatsaechlichen
 * Spitzenpegels jedes Clips bestimmt, damit im Mix alle etwa gleich laut sind.
 *
 * maxDuration kappt Clips, die im Original mehrere Sekunden lang sind (z. B.
 * Atmo-Aufnahmen) -- als Sequencer-Schritt soll nur der knackige Anfang
 * antriggern, nicht die ganze Aufnahme durchlaufen und sich mit den
 * naechsten Schritten ueberlagern.
 *
 * fixedPitch ignoriert die BPM-abhaengige playbackRate und spielt den Clip
 * immer mit Originaltonhoehe/-tempo ab -- fuer die gesprochene Ansage, bei
 * der ein per Tempo-Regler beschleunigtes/verlangsamtes Abspielen (technisch
 * bedingt durch AudioBufferSourceNode.playbackRate immer mit Tonhoehen-
 * Verschiebung) wie eine laecherliche "Micky-Maus"-Stimme klang statt wie
 * eine normale Ansage.
 */
function makeSamplePlayFn(url: string, gainBoost = 1, maxDuration?: number, startOffset?: number, fixedPitch = false): PlayFn {
  return (ctx, time, destination, playbackRate) => {
    void loadSampleBuffer(ctx, url).then((buffer) => {
      // Der Sequencer kann bis zur Fertigstellung des Decodings schon
      // weitergelaufen sein -- ein bereits verstrichener Zielzeitpunkt
      // wuerde AudioBufferSourceNode.start() sonst mit einem Fehler abbrechen.
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      // An das aktuelle Tempo angepasst (relativ zum Referenz-BPM in
      // index.ts), damit die Sample-Clips nicht immer gleich lang klingen,
      // egal wie schnell der Beat gerade laeuft -- ausser bei fixedPitch.
      src.playbackRate.value = fixedPitch ? 1 : playbackRate;
      if (gainBoost === 1) {
        src.connect(destination);
      } else {
        const gain = ctx.createGain();
        gain.gain.value = gainBoost;
        src.connect(gain).connect(destination);
      }
      const startAt = Math.max(time, ctx.currentTime);
      // startOffset schneidet minimalen "toten" Vorlauf im Original-Clip ab
      // (in Sekunden, gemessen im unveraenderten Original -- unabhaengig von
      // playbackRate). AudioBufferSourceNode.start(when, offset) interpretiert
      // offset immer relativ zum Original, das passt hier.
      if (startOffset) src.start(startAt, startOffset);
      else src.start(startAt);
      if (maxDuration) src.stop(startAt + maxDuration);
    });
  };
}

const SAMPLE_URLS = [
  dbAnkuendigungUrl,
  ansageDbUrl,
  sBahnNeuUrl,
  hornUrl,
  railroadBellUrl,
  steamBrakeUrl,
  trainRumbleUrl,
  tramBellUrl,
  hornParisUrl,
  hornChinaUrl,
  hornJapanUrl,
  hornUkUrl,
  steamWhistleUrl,
  zurueckbleibenUrl,
  einsteigenBitteUrl,
  haltestellengongUrl,
  bvgStandardgongUrl,
  bvgInfogongUrl,
  bvgSondergongUrl,
  bvgAlexanderplatzUrl,
  bvgEndhaltestelleUrl,
  dbGongNeuUrl,
  xWagenTuerUrl,
  achtungZugbetriebUrl,
  aufzugDingUrl,
  bahnsteigPfiffUrl,
];

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
  { id: "horn", label: "Choo-Choo", hint: "Klassisches Dampflok-Tuckern (Sample-Clip)", play: makeSamplePlayFn(hornUrl, 0.76, 1) },
  { id: "dbAnkuendigung", label: "DB-Ansage", hint: "Bahn-Ansage (Sample-Clip)", play: makeSamplePlayFn(dbAnkuendigungUrl, 2.3) },
  // War vorher "Ansage 2" -- die dritte, kuenstlich klingende Ansage
  // ("announcement"/bahnhofsansage.mp3) klang identisch zu "DB-Ansage",
  // aber schlechter, und wurde deshalb entfernt; dieser Sound ruecky auf
  // den (jetzt wieder freien) Namen "Ansage" nach.
  // fixedPitch: siehe Kommentar bei makeSamplePlayFn -- ohne das klang die
  // Ansage bei schnellerem Tempo wie eine Micky-Maus-Stimme. Die Datei selbst
  // wurde ausserdem auf nur den ersten Satz gekuerzt (vorher ~8.8s, jetzt
  // ~3.2s) und ihre minimale Anfangsstille weggeschnitten.
  { id: "ansageDb", label: "Ansage", hint: "Bahn-Ansage (Sample-Clip)", play: makeSamplePlayFn(ansageDbUrl, 1.12, undefined, undefined, true) },
  { id: "sBahnNeu", label: "S-Bahn", hint: "S-Bahn-Geräusch (Sample-Clip)", play: makeSamplePlayFn(sBahnNeuUrl, 2.5) },
  // Drei kurze, echte Bahnsteig-/Haltestellen-Ansagen -- auf ausdruecklichen
  // Wunsch ergaenzt, wieder ohne Ruecksicht auf Lizenzfragen (siehe
  // Datei-Kommentar oben).
  { id: "einsteigenBitte", label: "Einsteigen", hint: "„Einsteigen bitte“ (Sample-Clip)", play: makeSamplePlayFn(einsteigenBitteUrl, 0.72) },
  { id: "zurueckbleiben", label: "Zurückbleiben", hint: "„Zurückbleiben bitte“ (Sample-Clip)", play: makeSamplePlayFn(zurueckbleibenUrl, 0.5) },
  { id: "haltestellengong", label: "Halte-Gong", hint: "Haltestellengong Bus/Tram (Sample-Clip)", play: makeSamplePlayFn(haltestellengongUrl, 1.65) },
  { id: "railroadBell", label: "Bahnübergang", hint: "Bahnübergangs-Glocke, rhythmisch (Sample-Clip)", play: makeSamplePlayFn(railroadBellUrl, 4.5, 1.1) },
  { id: "steamBrake", label: "Dampf-Zischen", hint: "Dampflok-Bremse (Sample-Clip)", play: makeSamplePlayFn(steamBrakeUrl, 1.4, 0.8) },
  { id: "trainRumble", label: "Zugrattern", hint: "Rattern auf der Schiene (Sample-Clip)", play: makeSamplePlayFn(trainRumbleUrl, 1.6, 1) },
  // maxDuration von 0.8 auf 2.0: der Glockenklang klingt hoerbar nach, 0.8s
  // schnitt ihn mitten im Ausklingen brutal ab (siehe gemeldeter Bug).
  { id: "tramBell", label: "Tram-Klingel", hint: "Straßenbahn-Klingel (Sample-Clip)", play: makeSamplePlayFn(tramBellUrl, 3.5, 2.0) },
  { id: "hornParis", label: "Horn Paris", hint: "Französisches Zughorn (Sample-Clip)", play: makeSamplePlayFn(hornParisUrl, 0.55, 1.2) },
  { id: "hornChina", label: "Horn China", hint: "Chinesisches Diesellok-Horn (Sample-Clip)", play: makeSamplePlayFn(hornChinaUrl, 0.25, 1.2) },
  { id: "hornJapan", label: "Horn Japan", hint: "Japanisches Zughorn (Sample-Clip)", play: makeSamplePlayFn(hornJapanUrl, 1.14, 1.2) },
  // gainBoost vorher 1, dann 0.65 -- Lautstaerke-Messung zeigte, dass es
  // trotz der vorherigen Reduktion immer noch eines der lautesten Elemente
  // im ganzen Board war, daher nochmals deutlich abgesenkt.
  { id: "hornUk", label: "Horn UK", hint: "Britisches Zughorn (Sample-Clip)", play: makeSamplePlayFn(hornUkUrl, 0.31, 1.2) },
  { id: "steamWhistle", label: "Dampfpfeife", hint: "Pfeife einer echten Dampflok (Sample-Clip)", play: makeSamplePlayFn(steamWhistleUrl, 0.98, 1.3) },
  { id: "hopperSqueak", label: "Hüpftier", hint: "Quietschendes Gummi-Hüpftier", play: playHopperSqueak },
  // 10 weitere kurze Bahn-/Nahverkehrs-Signaltoene, Schwerpunkt Berlin/BVG
  // (siehe Quellenkommentar oben bei den Imports).
  { id: "bvgStandardgong", label: "BVG-Gong", hint: "BVG-U-Bahn-Türschließ-Gong, Berlin (Sample-Clip)", play: makeSamplePlayFn(bvgStandardgongUrl, 1.7, 1.8) },
  { id: "bvgInfogong", label: "BVG-Info", hint: "BVG-Infogong vor Durchsagen, Berlin (Sample-Clip)", play: makeSamplePlayFn(bvgInfogongUrl, 1.7, 1.8) },
  { id: "bvgSondergong", label: "BVG-Sonder", hint: "BVG-Sondergong für Störungshinweise, Berlin (Sample-Clip)", play: makeSamplePlayFn(bvgSondergongUrl, 1.7, 1.8) },
  { id: "bvgAlexanderplatz", label: "Alexanderplatz", hint: "BVG-Ansagegong „Alexanderplatz“, Berlin (Sample-Clip)", play: makeSamplePlayFn(bvgAlexanderplatzUrl, 1.5, 2.2) },
  { id: "bvgEndhaltestelle", label: "Endstation", hint: "BVG-Ansagegong „Endstation“, Berlin (Sample-Clip)", play: makeSamplePlayFn(bvgEndhaltestelleUrl, 1.6, 2.2) },
  { id: "dbGongNeu", label: "DB-Gong", hint: "Neuer DB-Bahnhofsdurchsage-Gong (Sample-Clip)", play: makeSamplePlayFn(dbGongNeuUrl, 1.5, 1.8) },
  { id: "xWagenTuer", label: "U-Bahn-Tür", hint: "Türschließ-Signal U-Bahn-Baureihe X-Wagen (Sample-Clip)", play: makeSamplePlayFn(xWagenTuerUrl, 1.0, 1.3) },
  { id: "achtungZugbetrieb", label: "Achtung!", hint: "DB-Warnansage „Achtung, Zugbetrieb“ (Sample-Clip)", play: makeSamplePlayFn(achtungZugbetriebUrl, 1.4, 1.3) },
  { id: "aufzugDing", label: "Aufzug-Ding", hint: "Aufzug-Signalton am Bahnhof (Sample-Clip)", play: makeSamplePlayFn(aufzugDingUrl, 1.8, 0.8) },
  { id: "bahnsteigPfiff", label: "Pfiff", hint: "Abfahrtspfiff auf dem Bahnsteig (Sample-Clip)", play: makeSamplePlayFn(bahnsteigPfiffUrl, 0.9, 0.9) },
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

export function speakPhrase(text: string, volume = 1): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "de-DE";
    const voice = getGermanVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;
    utterance.pitch = 1;
    utterance.volume = Math.min(1, Math.max(0, volume));
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
