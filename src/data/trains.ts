import rocket from "../assets/images/trains/rocket.jpg";
import flyingScotsman from "../assets/images/trains/flying-scotsman.jpg";
import mallard from "../assets/images/trains/mallard.jpg";
import drg05 from "../assets/images/trains/drg-05.jpg";
import br01 from "../assets/images/trains/br-01.jpg";
import br44 from "../assets/images/trains/br-44.jpg";
import br52 from "../assets/images/trains/br-52.jpg";
import bigBoy from "../assets/images/trains/big-boy.jpg";
import br103 from "../assets/images/trains/br-103.jpg";
import br218 from "../assets/images/trains/br-218.jpg";
import tgvDuplex from "../assets/images/trains/tgv-duplex.jpg";
import ice1 from "../assets/images/trains/ice1.jpg";
import ice3 from "../assets/images/trains/ice3.jpg";
import ice4 from "../assets/images/trains/ice4.jpg";
import transrapid09 from "../assets/images/trains/transrapid09.jpg";
import shinkansen0 from "../assets/images/trains/shinkansen0.jpg";
import shinkansenN700 from "../assets/images/trains/shinkansen-n700.png";
import eurostarE320 from "../assets/images/trains/eurostar-e320.jpg";
import sbahn481 from "../assets/images/trains/sbahn-481.jpg";
import bvgF from "../assets/images/trains/bvg-f.jpg";

/**
 * Zug-Quartett-Datensatz. Recherchiert ueber die (meist deutsch- oder
 * englischsprachige) Wikipedia-Infobox der jeweiligen Baureihe/Klasse (Stand
 * der Recherche: 2026). Bei historischen Fahrzeugen sind einige Werte
 * (v. a. Leistung sehr frueher Dampflokomotiven) historische Schaetzungen --
 * exakte Werksangaben existieren dafuer teils nicht mehr.
 *
 * Fotos: Wikimedia Commons, freie Lizenz -- siehe
 * src/assets/images/trains/CREDITS.md fuer alle Einzelnachweise.
 */

export interface TrainStats {
  baujahr: number;
  hoechstgeschwindigkeitKmh: number;
  leistungKw: number;
  laengeM: number;
  gewichtT: number;
}

export interface TrainCard {
  id: string;
  name: string;
  subtitle: string;
  category: string;
  image: string;
  /**
   * CSS object-position fuer das Foto bei quadratischem Zuschnitt (Zug-
   * Spotter, Zug-Memory). Die meisten Fotos sind breiter als hoch und der
   * Zug steht dabei mittig -- Default (50% 50%) reicht dann. Ein paar
   * Hochformat-Fotos zeigen den Zug aber nur in einem schmalen Streifen
   * (z. B. der Koelner Dom ueber dem ICE3), da muss der Ausschnitt gezielt
   * dorthin verschoben werden, sonst faellt der Zug beim Zuschneiden raus.
   */
  focus?: string;
  stats: TrainStats;
}

export const STAT_LABELS: Record<keyof TrainStats, { label: string; unit: string }> = {
  baujahr: { label: "Baujahr", unit: "" },
  hoechstgeschwindigkeitKmh: { label: "Höchstgeschwindigkeit", unit: "km/h" },
  leistungKw: { label: "Leistung", unit: "kW" },
  laengeM: { label: "Länge", unit: "m" },
  gewichtT: { label: "Gewicht", unit: "t" },
};

export const trainCards: TrainCard[] = [
  {
    id: "rocket",
    name: "Stephenson's Rocket",
    subtitle: "Die Urahnin der modernen Lokomotive",
    category: "Dampflokomotive",
    image: rocket,
    stats: { baujahr: 1829, hoechstgeschwindigkeitKmh: 48, leistungKw: 7, laengeM: 7.0, gewichtT: 4.3 },
  },
  {
    id: "flying-scotsman",
    name: "Flying Scotsman",
    subtitle: "Erste offiziell 100-mph-schnelle Dampflok der Welt",
    category: "Dampflokomotive",
    image: flyingScotsman,
    stats: { baujahr: 1923, hoechstgeschwindigkeitKmh: 161, leistungKw: 1650, laengeM: 21.3, gewichtT: 97.8 },
  },
  {
    id: "mallard",
    name: "LNER Mallard",
    subtitle: "Bis heute Weltrekordhalterin unter den Dampfloks",
    category: "Dampflokomotive",
    image: mallard,
    stats: { baujahr: 1938, hoechstgeschwindigkeitKmh: 203, leistungKw: 1600, laengeM: 21.3, gewichtT: 167.6 },
  },
  {
    id: "drg-05",
    name: "DRG-Baureihe 05",
    subtitle: "Stromlinien-Schnellzuglok der Reichsbahn",
    category: "Dampflokomotive",
    image: drg05,
    stats: { baujahr: 1935, hoechstgeschwindigkeitKmh: 175, leistungKw: 2500, laengeM: 26.3, gewichtT: 130 },
  },
  {
    id: "br-01",
    name: "DB-Baureihe 01",
    subtitle: "Die klassische Einheits-Schnellzuglok",
    category: "Dampflokomotive",
    image: br01,
    stats: { baujahr: 1926, hoechstgeschwindigkeitKmh: 120, leistungKw: 1650, laengeM: 23.6, gewichtT: 108.9 },
  },
  {
    id: "br-44",
    name: "DB-Baureihe 44",
    subtitle: "Schwere Güterzug-Dampflok",
    category: "Dampflokomotive",
    image: br44,
    stats: { baujahr: 1926, hoechstgeschwindigkeitKmh: 80, leistungKw: 1405, laengeM: 22.6, gewichtT: 110.2 },
  },
  {
    id: "br-52",
    name: 'DR-Baureihe 52 "Kriegslok"',
    subtitle: "Über 7.000 Mal gebaute Kriegsdampflok",
    category: "Dampflokomotive",
    image: br52,
    stats: { baujahr: 1942, hoechstgeschwindigkeitKmh: 80, leistungKw: 1192, laengeM: 23.0, gewichtT: 84.0 },
  },
  {
    id: "big-boy",
    name: "Union Pacific Big Boy",
    subtitle: "Die größte je gebaute Dampflok",
    category: "Dampflokomotive",
    image: bigBoy,
    stats: { baujahr: 1941, hoechstgeschwindigkeitKmh: 130, leistungKw: 5220, laengeM: 40.5, gewichtT: 548 },
  },
  {
    id: "br-103",
    name: "DB-Baureihe 103",
    subtitle: "Ikone der bundesdeutschen Schnellzug-Elloks",
    category: "Elektrolokomotive",
    image: br103,
    stats: { baujahr: 1970, hoechstgeschwindigkeitKmh: 200, leistungKw: 7440, laengeM: 19.5, gewichtT: 114.0 },
  },
  {
    id: "br-218",
    name: "DB-Baureihe 218",
    subtitle: "Die meistgebaute deutsche Diesellok",
    category: "Diesellokomotive",
    image: br218,
    stats: { baujahr: 1968, hoechstgeschwindigkeitKmh: 140, leistungKw: 2060, laengeM: 16.4, gewichtT: 79 },
  },
  {
    id: "tgv-duplex",
    name: "TGV Duplex",
    subtitle: "Doppelstöckiger französischer Hochgeschwindigkeitszug",
    category: "Hochgeschwindigkeitszug",
    image: tgvDuplex,
    stats: { baujahr: 1996, hoechstgeschwindigkeitKmh: 320, leistungKw: 8800, laengeM: 200, gewichtT: 380 },
  },
  {
    id: "ice1",
    name: "ICE 1",
    subtitle: "Der erste deutsche Hochgeschwindigkeitszug",
    category: "Hochgeschwindigkeitszug",
    image: ice1,
    // Hochformat-Foto, Zugfront sitzt im unteren Bilddrittel.
    focus: "50% 80%",
    stats: { baujahr: 1991, hoechstgeschwindigkeitKmh: 280, leistungKw: 9580, laengeM: 358, gewichtT: 782 },
  },
  {
    id: "ice3",
    name: "ICE 3",
    subtitle: "Angetrieben über den ganzen Zug verteilt",
    category: "Hochgeschwindigkeitszug",
    image: ice3,
    // Sehr hohes Hochformat-Foto (Koelner Dom) -- der Zug ist nur ganz unten
    // im Bild zu sehen, ohne diesen Fokus wuerde er beim quadratischen
    // Zuschnitt komplett rausfallen.
    focus: "50% 96%",
    stats: { baujahr: 2000, hoechstgeschwindigkeitKmh: 330, leistungKw: 8000, laengeM: 200.8, gewichtT: 496 },
  },
  {
    id: "ice4",
    name: "ICE 4",
    subtitle: "Die neueste ICE-Generation der DB",
    category: "Hochgeschwindigkeitszug",
    image: ice4,
    stats: { baujahr: 2016, hoechstgeschwindigkeitKmh: 265, leistungKw: 9900, laengeM: 346, gewichtT: 819 },
  },
  {
    id: "transrapid09",
    name: "Transrapid 09",
    subtitle: "Magnetschwebebahn im Linienbetrieb Shanghai",
    category: "Magnetschwebebahn",
    image: transrapid09,
    stats: { baujahr: 2002, hoechstgeschwindigkeitKmh: 431, leistungKw: 6000, laengeM: 75.8, gewichtT: 170 },
  },
  {
    id: "shinkansen0",
    name: "Shinkansen Serie 0",
    subtitle: "Der allererste japanische Shinkansen",
    category: "Hochgeschwindigkeitszug",
    image: shinkansen0,
    stats: { baujahr: 1964, hoechstgeschwindigkeitKmh: 220, leistungKw: 11840, laengeM: 400.3, gewichtT: 970 },
  },
  {
    id: "shinkansen-n700",
    name: "Shinkansen N700",
    subtitle: "Modernste japanische Neigetechnik-Baureihe",
    category: "Hochgeschwindigkeitszug",
    image: shinkansenN700,
    stats: { baujahr: 2007, hoechstgeschwindigkeitKmh: 300, leistungKw: 17080, laengeM: 400, gewichtT: 715 },
  },
  {
    id: "eurostar-e320",
    name: "Eurostar e320",
    subtitle: "Längster Siemens-Velaro-Zug, durch den Kanaltunnel",
    category: "Hochgeschwindigkeitszug",
    image: eurostarE320,
    stats: { baujahr: 2015, hoechstgeschwindigkeitKmh: 320, leistungKw: 16000, laengeM: 400, gewichtT: 900 },
  },
  {
    id: "sbahn-481",
    name: "S-Bahn Berlin BR 481",
    subtitle: "Rückgrat des Berliner S-Bahn-Netzes",
    category: "S-Bahn-Triebzug",
    image: sbahn481,
    stats: { baujahr: 1996, hoechstgeschwindigkeitKmh: 100, leistungKw: 600, laengeM: 35.8, gewichtT: 59 },
  },
  {
    id: "bvg-f",
    name: "BVG-Baureihe F",
    subtitle: "Großprofil-U-Bahn seit den 1970ern",
    category: "U-Bahn-Triebzug",
    image: bvgF,
    stats: { baujahr: 1973, hoechstgeschwindigkeitKmh: 72, leistungKw: 540, laengeM: 32.1, gewichtT: 38.1 },
  },
];
