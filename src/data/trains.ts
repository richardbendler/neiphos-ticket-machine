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
import sbbRe460 from "../assets/images/trains/sbb-re460.jpg";
import rhbGe44iii from "../assets/images/trains/rhb-ge44iii.jpg";
import etr1000 from "../assets/images/trains/etr1000.jpg";
import fsE656 from "../assets/images/trains/fs-e656.jpg";
import aveS103 from "../assets/images/trains/ave-s103.jpg";
import cr400af from "../assets/images/trains/cr400af.jpg";
import sapsan from "../assets/images/trains/sapsan.jpg";
import p36 from "../assets/images/trains/p36.jpg";
import acela from "../assets/images/trains/acela.jpg";
import emdF7 from "../assets/images/trains/emd-f7.jpg";
import sjX2000 from "../assets/images/trains/sj-x2000.jpg";
import nsbEl17 from "../assets/images/trains/nsb-el17.jpg";
import oebb1216 from "../assets/images/trains/oebb-1216.jpg";
import oebbNightjet from "../assets/images/trains/oebb-nightjet.jpg";
import class800 from "../assets/images/trains/class-800.jpg";
import tubeSStock from "../assets/images/trains/tube-s-stock.jpg";
import nsSlt from "../assets/images/trains/ns-slt.jpg";
import ratpMf01 from "../assets/images/trains/ratp-mf01.jpg";
import cp2816 from "../assets/images/trains/cp-2816.jpg";
import wap5 from "../assets/images/trains/wap-5.jpg";

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
    // War ein Luftbild eines Viadukts (Cize-Bolozon) MIT einem TGV, der darauf
    // aber winzig und kaum zu erkennen war -- auf ausdruecklichen Wunsch
    // ("das Bild ist nicht gut") gegen ein Foto getauscht, auf dem der Zug
    // selbst gross/deutlich im Bild ist (siehe CREDITS.md fuer die neue
    // Quellenangabe).
    image: tgvDuplex,
    // Zug steht etwas rechts der Bildmitte und weiter unten (Landschaft
    // nimmt den oberen Bildteil ein) -- ohne das schnitte ein zentrierter
    // quadratischer Zuschnitt (Zug-Spotter/-Memory) den Zug seitlich an.
    focus: "68% 62%",
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
  {
    id: "sbb-re460",
    name: "SBB Re 460",
    subtitle: 'Die "Lok 2000" im Schweizer Fernverkehr',
    category: "Elektrolokomotive",
    image: sbbRe460,
    stats: { baujahr: 1992, hoechstgeschwindigkeitKmh: 200, leistungKw: 6100, laengeM: 18.5, gewichtT: 84 },
  },
  {
    id: "rhb-ge44iii",
    name: "RhB Ge 4/4 III",
    subtitle: "Schmalspur-Zugpferd von Glacier Express und Bernina",
    category: "Elektrolokomotive",
    image: rhbGe44iii,
    stats: { baujahr: 1993, hoechstgeschwindigkeitKmh: 100, leistungKw: 2400, laengeM: 16.0, gewichtT: 62 },
  },
  {
    id: "etr1000",
    name: "Frecciarossa 1000",
    subtitle: "Italiens schnellster Hochgeschwindigkeitszug",
    category: "Hochgeschwindigkeitszug",
    image: etr1000,
    stats: { baujahr: 2014, hoechstgeschwindigkeitKmh: 300, leistungKw: 9800, laengeM: 202, gewichtT: 500 },
  },
  {
    id: "fs-e656",
    name: 'FS-Baureihe E.656 "Caimano"',
    subtitle: 'Der "Kaiman" im italienischen Fernverkehr',
    category: "Elektrolokomotive",
    image: fsE656,
    stats: { baujahr: 1975, hoechstgeschwindigkeitKmh: 150, leistungKw: 4200, laengeM: 18.3, gewichtT: 120 },
  },
  {
    id: "ave-s103",
    name: "RENFE AVE S-103",
    subtitle: "Deutsche Velaro-Technik unter spanischer Sonne",
    category: "Hochgeschwindigkeitszug",
    image: aveS103,
    stats: { baujahr: 2007, hoechstgeschwindigkeitKmh: 310, leistungKw: 8800, laengeM: 200, gewichtT: 425 },
  },
  {
    id: "cr400af",
    name: 'China Railway CR400AF "Fuxing"',
    subtitle: "Chinas eigenentwickelter 350-km/h-Standardzug",
    category: "Hochgeschwindigkeitszug",
    image: cr400af,
    stats: { baujahr: 2016, hoechstgeschwindigkeitKmh: 350, leistungKw: 13000, laengeM: 209, gewichtT: 500 },
  },
  {
    id: "sapsan",
    name: "RZD Sapsan",
    subtitle: "Russlands Schnellzug zwischen Moskau und St. Petersburg",
    category: "Hochgeschwindigkeitszug",
    image: sapsan,
    stats: { baujahr: 2009, hoechstgeschwindigkeitKmh: 250, leistungKw: 8000, laengeM: 250, gewichtT: 667 },
  },
  {
    id: "p36",
    name: 'Sowjetische Baureihe П36 "Pobeda"',
    subtitle: "Die letzte sowjetische Neubau-Schnellzugdampflok",
    category: "Dampflokomotive",
    image: p36,
    stats: { baujahr: 1950, hoechstgeschwindigkeitKmh: 125, leistungKw: 2260, laengeM: 16.7, gewichtT: 133 },
  },
  {
    id: "acela",
    name: "Amtrak Acela Express",
    subtitle: "Amerikas erster echter Hochgeschwindigkeitszug",
    category: "Hochgeschwindigkeitszug",
    image: acela,
    stats: { baujahr: 2000, hoechstgeschwindigkeitKmh: 240, leistungKw: 4600, laengeM: 202.3, gewichtT: 565 },
  },
  {
    id: "emd-f7",
    name: "EMD F7",
    subtitle: "Meistgebaute US-Diesellok des goldenen Eisenbahnzeitalters",
    category: "Diesellokomotive",
    image: emdF7,
    stats: { baujahr: 1949, hoechstgeschwindigkeitKmh: 164, leistungKw: 1100, laengeM: 15.4, gewichtT: 112.2 },
  },
  {
    id: "sj-x2000",
    name: "SJ X2000",
    subtitle: "Schwedischer Neigezug für Tempo auf alten Kurven",
    category: "Hochgeschwindigkeitszug",
    image: sjX2000,
    stats: { baujahr: 1990, hoechstgeschwindigkeitKmh: 200, leistungKw: 3260, laengeM: 165, gewichtT: 365 },
  },
  {
    id: "nsb-el17",
    name: "NSB El 17",
    subtitle: "Norwegische Ellok, bekannt von der Flåmsbana",
    category: "Elektrolokomotive",
    image: nsbEl17,
    stats: { baujahr: 1982, hoechstgeschwindigkeitKmh: 150, leistungKw: 3000, laengeM: 16.3, gewichtT: 64 },
  },
  {
    id: "oebb-1216",
    name: 'ÖBB-Baureihe 1216 "Taurus 3"',
    subtitle: "Weltrekord-Lok mit 357 km/h auf der Schiene",
    category: "Elektrolokomotive",
    image: oebb1216,
    stats: { baujahr: 2006, hoechstgeschwindigkeitKmh: 230, leistungKw: 6400, laengeM: 19.58, gewichtT: 87 },
  },
  {
    id: "oebb-nightjet",
    name: "ÖBB Nightjet",
    subtitle: "Europas modernes Nachtzug-Comeback",
    category: "Nachtzug",
    image: oebbNightjet,
    stats: { baujahr: 2023, hoechstgeschwindigkeitKmh: 230, leistungKw: 6400, laengeM: 204, gewichtT: 409 },
  },
  {
    id: "class-800",
    name: "British Rail Class 800 (Azuma)",
    subtitle: "Bimodaler Intercity zwischen Fahrdraht und Diesel",
    category: "Hochgeschwindigkeitszug",
    image: class800,
    stats: { baujahr: 2017, hoechstgeschwindigkeitKmh: 200, leistungKw: 3750, laengeM: 129.7, gewichtT: 243 },
  },
  {
    id: "tube-s-stock",
    name: "London Underground S Stock",
    subtitle: "Erste klimatisierte Zugflotte der Londoner U-Bahn",
    category: "U-Bahn-Triebzug",
    image: tubeSStock,
    stats: { baujahr: 2010, hoechstgeschwindigkeitKmh: 100, leistungKw: 1800, laengeM: 117, gewichtT: 213.7 },
  },
  {
    id: "ns-slt",
    name: "NS Sprinter Lighttrain",
    subtitle: "Niederländischer Nahverkehrs-Leichtbautriebzug",
    category: "S-Bahn-Triebzug",
    image: nsSlt,
    stats: { baujahr: 2007, hoechstgeschwindigkeitKmh: 140, leistungKw: 1680, laengeM: 100.5, gewichtT: 176 },
  },
  {
    id: "ratp-mf01",
    name: "RATP MF 01",
    subtitle: "Modernste Zuggeneration der Pariser Métro",
    category: "U-Bahn-Triebzug",
    image: ratpMf01,
    // Zug steht links im Bild, rechts viel Gleis/Umgebung -- ohne Fokus
    // wuerde ein zentrierter quadratischer Zuschnitt die Zugfront (links)
    // anschneiden.
    focus: "30% 55%",
    stats: { baujahr: 2007, hoechstgeschwindigkeitKmh: 70, leistungKw: 1800, laengeM: 90, gewichtT: 185 },
  },
  {
    id: "cp-2816",
    name: 'Canadian Pacific 2816 "Empress"',
    subtitle: "Kanadische Hudson-Dampflok, bis heute fahrtüchtig",
    category: "Dampflokomotive",
    image: cp2816,
    stats: { baujahr: 1930, hoechstgeschwindigkeitKmh: 160, leistungKw: 3500, laengeM: 27.76, gewichtT: 291.7 },
  },
  {
    id: "wap-5",
    name: "Indian Railways WAP-5",
    subtitle: "Schnelle indische Elektrolok für den Fernverkehr",
    category: "Elektrolokomotive",
    image: wap5,
    // Lok steht rechts der Bildmitte -- ohne Fokus wuerde ein zentrierter
    // quadratischer Zuschnitt die Zugspitze rechts anschneiden.
    focus: "62% 55%",
    stats: { baujahr: 1995, hoechstgeschwindigkeitKmh: 160, leistungKw: 4474, laengeM: 18.2, gewichtT: 78 },
  },
];
