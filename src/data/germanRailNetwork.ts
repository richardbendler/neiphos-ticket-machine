/**
 * Stark vereinfachtes, aber an echten Fernverkehrsverbindungen orientiertes
 * Streckennetz zwischen 36 grossen deutschen Staedten (angelehnt an reale
 * ICE-/IC-Linien). Entfernungen sind grobe Bahnkilometer-Naeherungen, keine
 * exakten Werte -- fuer den Kilometerzaehler im Spiel reicht das.
 */

export interface RailCity {
  id: string;
  name: string;
  /** Grobe echte Koordinaten (WGS84) -- nicht fuer exakte Kartografie
      gedacht, sondern nur damit die Zugfahrt-Animation die ungefaehr
      richtige Himmelsrichtung anzeigen kann (siehe train-sim/index.ts). */
  lat: number;
  lon: number;
  /** Kleiner Startort ("Kaff") statt grosser Stadt -- siehe randomStartCity. */
  smallTown?: boolean;
}

export interface RailEdge {
  from: string;
  to: string;
  km: number;
}

export const RAIL_CITIES: RailCity[] = [
  { id: "berlin", name: "Berlin", lat: 52.52, lon: 13.405 },
  { id: "hamburg", name: "Hamburg", lat: 53.55, lon: 9.99 },
  { id: "bremen", name: "Bremen", lat: 53.08, lon: 8.81 },
  { id: "hannover", name: "Hannover", lat: 52.37, lon: 9.73 },
  { id: "dortmund", name: "Dortmund", lat: 51.51, lon: 7.47 },
  { id: "essen", name: "Essen", lat: 51.46, lon: 7.01 },
  { id: "duesseldorf", name: "Düsseldorf", lat: 51.23, lon: 6.78 },
  { id: "koeln", name: "Köln", lat: 50.94, lon: 6.96 },
  { id: "frankfurt", name: "Frankfurt", lat: 50.11, lon: 8.68 },
  { id: "mannheim", name: "Mannheim", lat: 49.49, lon: 8.47 },
  { id: "stuttgart", name: "Stuttgart", lat: 48.78, lon: 9.18 },
  { id: "karlsruhe", name: "Karlsruhe", lat: 49.01, lon: 8.4 },
  { id: "muenchen", name: "München", lat: 48.14, lon: 11.58 },
  { id: "nuernberg", name: "Nürnberg", lat: 49.45, lon: 11.08 },
  { id: "leipzig", name: "Leipzig", lat: 51.34, lon: 12.37 },
  { id: "dresden", name: "Dresden", lat: 51.05, lon: 13.74 },
  { id: "neustadtDosse", name: "Neustadt (Dosse)", lat: 52.85, lon: 12.4 },
  { id: "breddin", name: "Breddin", lat: 52.94, lon: 12.4 },
  // 20 weitere Staedte, auf ausdruecklichen Wunsch ergaenzt -- dichteres,
  // groesseres Netz mit mehr Routen-Varianz.
  { id: "kiel", name: "Kiel", lat: 54.32, lon: 10.14 },
  { id: "luebeck", name: "Lübeck", lat: 53.87, lon: 10.68 },
  { id: "rostock", name: "Rostock", lat: 54.09, lon: 12.14 },
  { id: "schwerin", name: "Schwerin", lat: 53.63, lon: 11.42 },
  { id: "magdeburg", name: "Magdeburg", lat: 52.13, lon: 11.63 },
  { id: "braunschweig", name: "Braunschweig", lat: 52.27, lon: 10.52 },
  { id: "osnabrueck", name: "Osnabrück", lat: 52.28, lon: 8.05 },
  { id: "muenster", name: "Münster", lat: 51.96, lon: 7.63 },
  { id: "bielefeld", name: "Bielefeld", lat: 52.02, lon: 8.53 },
  { id: "kassel", name: "Kassel", lat: 51.32, lon: 9.5 },
  { id: "erfurt", name: "Erfurt", lat: 50.98, lon: 11.03 },
  { id: "halle", name: "Halle (Saale)", lat: 51.48, lon: 11.97 },
  { id: "chemnitz", name: "Chemnitz", lat: 50.83, lon: 12.92 },
  { id: "bonn", name: "Bonn", lat: 50.74, lon: 7.1 },
  { id: "aachen", name: "Aachen", lat: 50.78, lon: 6.08 },
  { id: "mainz", name: "Mainz", lat: 49.99, lon: 8.27 },
  { id: "freiburg", name: "Freiburg", lat: 47.99, lon: 7.85 },
  { id: "augsburg", name: "Augsburg", lat: 48.37, lon: 10.9 },
  { id: "regensburg", name: "Regensburg", lat: 49.02, lon: 12.1 },
  { id: "wuerzburg", name: "Würzburg", lat: 49.79, lon: 9.93 },
  // Kleine Startorte ("Kaffs") -- jeweils per kurzer Stichstrecke an genau
  // eine groessere Stadt angebunden (siehe RAIL_EDGES unten). Die eigentliche
  // Fahrt startet IMMER an einem dieser Orte, nie direkt in einer Grossstadt
  // (siehe randomStartCity).
  //
  // Auf ausdruecklichen Wunsch haengt jeder dieser 32 Startorte an einer
  // Stadt, die selbst genau 4 Kanten (Zuege) von Breddin entfernt liegt --
  // durch die zusaetzliche Stichstrecke ist damit JEDER Startort exakt 5
  // Zuege von Breddin entfernt (der Startort ist ein reiner Blattknoten mit
  // nur dieser einen Kante, es gibt also keinen kuerzeren Weg). Vorher
  // variierte die optimale Zuganzahl je nach zufaelligem Startort stark
  // (3 bis 8, z. B. Buchholz nahe Hamburg vs. Bruchsal ganz im Sueden) --
  // Runden waren dadurch unterschiedlich schwer (gemeldet). Dazu wurden auf
  // ausdruecklichen Wunsch 20 weitere Startorte ergaenzt (12 -> 32), damit
  // man sich die moeglichen Startpunkte nicht einfach auswendig merken kann.
  { id: "unna", name: "Unna", lat: 51.54, lon: 7.69, smallTown: true },
  { id: "bruehl", name: "Brühl", lat: 50.83, lon: 6.91, smallTown: true },
  { id: "schwabach", name: "Schwabach", lat: 49.33, lon: 10.99, smallTown: true },
  { id: "badDoberan", name: "Bad Doberan", lat: 54.11, lon: 11.9, smallTown: true },
  { id: "guestrow", name: "Güstrow", lat: 53.8, lon: 12.18, smallTown: true },
  { id: "wolfenbuettel", name: "Wolfenbüttel", lat: 52.16, lon: 10.54, smallTown: true },
  { id: "peine", name: "Peine", lat: 52.32, lon: 10.24, smallTown: true },
  { id: "salzgitter", name: "Salzgitter", lat: 52.15, lon: 10.33, smallTown: true },
  { id: "melle", name: "Melle", lat: 52.2, lon: 8.34, smallTown: true },
  { id: "bramsche", name: "Bramsche", lat: 52.41, lon: 7.99, smallTown: true },
  { id: "herford", name: "Herford", lat: 52.12, lon: 8.67, smallTown: true },
  { id: "guetersloh", name: "Gütersloh", lat: 51.91, lon: 8.38, smallTown: true },
  { id: "baunatal", name: "Baunatal", lat: 51.27, lon: 9.4, smallTown: true },
  { id: "melsungen", name: "Melsungen", lat: 51.13, lon: 9.56, smallTown: true },
  { id: "hofgeismar", name: "Hofgeismar", lat: 51.49, lon: 9.38, smallTown: true },
  { id: "apolda", name: "Apolda", lat: 51.02, lon: 11.51, smallTown: true },
  { id: "soemmerda", name: "Sömmerda", lat: 51.16, lon: 11.12, smallTown: true },
  { id: "merseburg", name: "Merseburg", lat: 51.35, lon: 11.99, smallTown: true },
  { id: "bitterfeld", name: "Bitterfeld", lat: 51.62, lon: 12.32, smallTown: true },
  { id: "glauchau", name: "Glauchau", lat: 50.82, lon: 12.54, smallTown: true },
  { id: "freiberg", name: "Freiberg", lat: 50.91, lon: 13.34, smallTown: true },
  { id: "northeim", name: "Northeim", lat: 51.71, lon: 9.99, smallTown: true },
  { id: "duderstadt", name: "Duderstadt", lat: 51.51, lon: 10.26, smallTown: true },
  { id: "gifhorn", name: "Gifhorn", lat: 52.48, lon: 10.55, smallTown: true },
  { id: "helmstedt", name: "Helmstedt", lat: 52.23, lon: 11.01, smallTown: true },
  { id: "schleswig", name: "Schleswig", lat: 54.52, lon: 9.56, smallTown: true },
  { id: "niebuell", name: "Niebüll", lat: 54.79, lon: 8.83, smallTown: true },
  { id: "delmenhorst", name: "Delmenhorst", lat: 53.05, lon: 8.63, smallTown: true },
  { id: "wilhelmshaven", name: "Wilhelmshaven", lat: 53.53, lon: 8.11, smallTown: true },
  { id: "alfeld", name: "Alfeld (Leine)", lat: 51.98, lon: 9.83, smallTown: true },
  { id: "sarstedt", name: "Sarstedt", lat: 52.23, lon: 9.86, smallTown: true },
  { id: "elze", name: "Elze", lat: 52.12, lon: 9.75, smallTown: true },
  // 30 weitere Staedte, auf ausdruecklichen Wunsch ergaenzt -- noch dichteres
  // Netz mit noch mehr Routen-Varianz.
  { id: "wiesbaden", name: "Wiesbaden", lat: 50.08, lon: 8.24 },
  { id: "darmstadt", name: "Darmstadt", lat: 49.87, lon: 8.65 },
  { id: "heidelberg", name: "Heidelberg", lat: 49.41, lon: 8.69 },
  { id: "ulm", name: "Ulm", lat: 48.4, lon: 9.99 },
  { id: "trier", name: "Trier", lat: 49.75, lon: 6.64 },
  { id: "saarbruecken", name: "Saarbrücken", lat: 49.23, lon: 6.99 },
  { id: "koblenz", name: "Koblenz", lat: 50.35, lon: 7.59 },
  { id: "wuppertal", name: "Wuppertal", lat: 51.26, lon: 7.18 },
  { id: "bochum", name: "Bochum", lat: 51.48, lon: 7.22 },
  { id: "duisburg", name: "Duisburg", lat: 51.43, lon: 6.76 },
  { id: "moenchengladbach", name: "Mönchengladbach", lat: 51.2, lon: 6.44 },
  { id: "paderborn", name: "Paderborn", lat: 51.72, lon: 8.75 },
  { id: "goettingen", name: "Göttingen", lat: 51.53, lon: 9.94 },
  { id: "wolfsburg", name: "Wolfsburg", lat: 52.42, lon: 10.79 },
  { id: "potsdam", name: "Potsdam", lat: 52.4, lon: 13.06 },
  { id: "cottbus", name: "Cottbus", lat: 51.76, lon: 14.33 },
  { id: "frankfurtOder", name: "Frankfurt (Oder)", lat: 52.35, lon: 14.55 },
  { id: "neubrandenburg", name: "Neubrandenburg", lat: 53.56, lon: 13.26 },
  { id: "stralsund", name: "Stralsund", lat: 54.31, lon: 13.09 },
  { id: "flensburg", name: "Flensburg", lat: 54.78, lon: 9.44 },
  { id: "oldenburg", name: "Oldenburg", lat: 53.14, lon: 8.21 },
  { id: "hildesheim", name: "Hildesheim", lat: 52.15, lon: 9.95 },
  { id: "fulda", name: "Fulda", lat: 50.55, lon: 9.68 },
  { id: "giessen", name: "Gießen", lat: 50.58, lon: 8.68 },
  { id: "bamberg", name: "Bamberg", lat: 49.89, lon: 10.89 },
  { id: "bayreuth", name: "Bayreuth", lat: 49.95, lon: 11.58 },
  { id: "ingolstadt", name: "Ingolstadt", lat: 48.76, lon: 11.42 },
  { id: "passau", name: "Passau", lat: 48.57, lon: 13.46 },
  { id: "konstanz", name: "Konstanz", lat: 47.66, lon: 9.18 },
  { id: "kaiserslautern", name: "Kaiserslautern", lat: 49.44, lon: 7.77 },
];

/** Zielbahnhof des Zugsimulators -- hier wartet das Shuttle zum Neiphos Festival. */
export const FESTIVAL_CITY_ID = "breddin";

// Ungerichtet gemeint -- gilt in beide Richtungen (siehe neighborsOf).
export const RAIL_EDGES: RailEdge[] = [
  // Original direkte Berlin-Hamburg-Strecke ist hier ueber den echten
  // Zwischenhalt Neustadt (Dosse) aufgesplittet, von dem aus die kurze
  // Stichstrecke nach Breddin abzweigt (70+220 ≈ die alten 290 km).
  { from: "berlin", to: "neustadtDosse", km: 70 },
  { from: "neustadtDosse", to: "hamburg", km: 220 },
  { from: "neustadtDosse", to: "breddin", km: 20 },
  { from: "berlin", to: "hannover", km: 250 },
  { from: "berlin", to: "leipzig", km: 190 },
  { from: "berlin", to: "dresden", km: 180 },
  { from: "hamburg", to: "bremen", km: 120 },
  { from: "hamburg", to: "hannover", km: 155 },
  { from: "bremen", to: "hannover", km: 120 },
  { from: "bremen", to: "dortmund", km: 190 },
  { from: "hannover", to: "dortmund", km: 180 },
  { from: "hannover", to: "koeln", km: 265 },
  { from: "dortmund", to: "essen", km: 35 },
  { from: "essen", to: "duesseldorf", km: 35 },
  { from: "duesseldorf", to: "koeln", km: 40 },
  { from: "koeln", to: "frankfurt", km: 180 },
  { from: "frankfurt", to: "mannheim", km: 80 },
  { from: "frankfurt", to: "nuernberg", km: 225 },
  { from: "mannheim", to: "stuttgart", km: 100 },
  { from: "mannheim", to: "karlsruhe", km: 65 },
  { from: "stuttgart", to: "karlsruhe", km: 90 },
  { from: "stuttgart", to: "muenchen", km: 250 },
  { from: "nuernberg", to: "muenchen", km: 170 },
  { from: "nuernberg", to: "leipzig", km: 280 },
  { from: "leipzig", to: "dresden", km: 115 },
  // Strecken zu/zwischen den 20 neu ergaenzten Staedten.
  { from: "hamburg", to: "kiel", km: 90 },
  { from: "hamburg", to: "luebeck", km: 65 },
  { from: "luebeck", to: "rostock", km: 100 },
  { from: "rostock", to: "schwerin", km: 70 },
  { from: "schwerin", to: "hamburg", km: 100 },
  { from: "berlin", to: "magdeburg", km: 150 },
  { from: "magdeburg", to: "hannover", km: 140 },
  { from: "braunschweig", to: "hannover", km: 65 },
  { from: "braunschweig", to: "magdeburg", km: 90 },
  { from: "hannover", to: "bielefeld", km: 100 },
  { from: "bielefeld", to: "dortmund", km: 90 },
  { from: "hannover", to: "osnabrueck", km: 110 },
  { from: "osnabrueck", to: "bremen", km: 100 },
  { from: "osnabrueck", to: "muenster", km: 50 },
  { from: "muenster", to: "dortmund", km: 60 },
  { from: "hannover", to: "kassel", km: 150 },
  { from: "kassel", to: "frankfurt", km: 190 },
  { from: "frankfurt", to: "erfurt", km: 220 },
  { from: "erfurt", to: "leipzig", km: 120 },
  { from: "leipzig", to: "halle", km: 35 },
  { from: "leipzig", to: "chemnitz", km: 80 },
  { from: "chemnitz", to: "dresden", km: 75 },
  { from: "koeln", to: "bonn", km: 30 },
  { from: "koeln", to: "aachen", km: 70 },
  { from: "frankfurt", to: "mainz", km: 40 },
  { from: "mainz", to: "mannheim", km: 55 },
  { from: "karlsruhe", to: "freiburg", km: 130 },
  { from: "stuttgart", to: "augsburg", km: 130 },
  { from: "augsburg", to: "muenchen", km: 65 },
  { from: "nuernberg", to: "regensburg", km: 100 },
  { from: "regensburg", to: "muenchen", km: 120 },
  { from: "frankfurt", to: "wuerzburg", km: 120 },
  { from: "wuerzburg", to: "nuernberg", km: 110 },
  // Kurze Stichstrecken zu den kleinen Startorten -- jede fuehrt zu einer
  // Stadt, die selbst 4 Kanten von Breddin entfernt ist (siehe Kommentar bei
  // den Kaff-Eintraegen oben), damit jeder Startort exakt 5 Zuege von
  // Breddin entfernt ist.
  { from: "dortmund", to: "unna", km: 20 },
  { from: "koeln", to: "bruehl", km: 15 },
  { from: "nuernberg", to: "schwabach", km: 15 },
  { from: "rostock", to: "badDoberan", km: 20 },
  { from: "rostock", to: "guestrow", km: 25 },
  { from: "braunschweig", to: "wolfenbuettel", km: 15 },
  { from: "braunschweig", to: "peine", km: 25 },
  { from: "braunschweig", to: "salzgitter", km: 20 },
  { from: "osnabrueck", to: "melle", km: 25 },
  { from: "osnabrueck", to: "bramsche", km: 20 },
  { from: "bielefeld", to: "herford", km: 15 },
  { from: "bielefeld", to: "guetersloh", km: 20 },
  { from: "kassel", to: "baunatal", km: 15 },
  { from: "kassel", to: "melsungen", km: 25 },
  { from: "kassel", to: "hofgeismar", km: 25 },
  { from: "erfurt", to: "apolda", km: 30 },
  { from: "erfurt", to: "soemmerda", km: 25 },
  { from: "halle", to: "merseburg", km: 15 },
  { from: "halle", to: "bitterfeld", km: 25 },
  { from: "chemnitz", to: "glauchau", km: 30 },
  { from: "chemnitz", to: "freiberg", km: 35 },
  { from: "goettingen", to: "northeim", km: 20 },
  { from: "goettingen", to: "duderstadt", km: 30 },
  { from: "wolfsburg", to: "gifhorn", km: 20 },
  { from: "wolfsburg", to: "helmstedt", km: 30 },
  { from: "flensburg", to: "schleswig", km: 30 },
  { from: "flensburg", to: "niebuell", km: 40 },
  { from: "oldenburg", to: "delmenhorst", km: 25 },
  { from: "oldenburg", to: "wilhelmshaven", km: 45 },
  { from: "hildesheim", to: "alfeld", km: 30 },
  { from: "hildesheim", to: "sarstedt", km: 15 },
  { from: "hildesheim", to: "elze", km: 20 },
  // Strecken zu/zwischen den 30 neu ergaenzten Staedten.
  { from: "frankfurt", to: "wiesbaden", km: 40 },
  { from: "wiesbaden", to: "mainz", km: 15 },
  { from: "frankfurt", to: "darmstadt", km: 30 },
  { from: "darmstadt", to: "heidelberg", km: 40 },
  { from: "heidelberg", to: "mannheim", km: 20 },
  { from: "stuttgart", to: "ulm", km: 90 },
  { from: "ulm", to: "augsburg", km: 80 },
  { from: "koeln", to: "koblenz", km: 90 },
  { from: "koblenz", to: "mainz", km: 90 },
  { from: "koblenz", to: "trier", km: 110 },
  { from: "trier", to: "saarbruecken", km: 90 },
  { from: "saarbruecken", to: "kaiserslautern", km: 70 },
  { from: "kaiserslautern", to: "mannheim", km: 60 },
  { from: "duesseldorf", to: "wuppertal", km: 30 },
  { from: "wuppertal", to: "bochum", km: 30 },
  { from: "essen", to: "bochum", km: 15 },
  { from: "essen", to: "duisburg", km: 15 },
  { from: "duisburg", to: "duesseldorf", km: 25 },
  { from: "duesseldorf", to: "moenchengladbach", km: 30 },
  { from: "bielefeld", to: "paderborn", km: 45 },
  { from: "kassel", to: "paderborn", km: 90 },
  { from: "kassel", to: "goettingen", km: 45 },
  { from: "goettingen", to: "hannover", km: 100 },
  { from: "hannover", to: "hildesheim", km: 30 },
  { from: "hannover", to: "wolfsburg", km: 90 },
  { from: "braunschweig", to: "wolfsburg", km: 30 },
  { from: "berlin", to: "potsdam", km: 25 },
  { from: "berlin", to: "cottbus", km: 130 },
  { from: "berlin", to: "frankfurtOder", km: 90 },
  { from: "rostock", to: "stralsund", km: 70 },
  { from: "rostock", to: "neubrandenburg", km: 90 },
  { from: "kiel", to: "flensburg", km: 90 },
  { from: "bremen", to: "oldenburg", km: 45 },
  { from: "kassel", to: "fulda", km: 60 },
  { from: "fulda", to: "wuerzburg", km: 100 },
  { from: "frankfurt", to: "giessen", km: 60 },
  { from: "giessen", to: "kassel", km: 100 },
  { from: "wuerzburg", to: "bamberg", km: 90 },
  { from: "bamberg", to: "bayreuth", km: 60 },
  { from: "bamberg", to: "nuernberg", km: 60 },
  { from: "bayreuth", to: "nuernberg", km: 80 },
  { from: "nuernberg", to: "ingolstadt", km: 90 },
  { from: "ingolstadt", to: "muenchen", km: 80 },
  { from: "regensburg", to: "passau", km: 120 },
  { from: "freiburg", to: "konstanz", km: 130 },
];

export function cityName(id: string): string {
  return RAIL_CITIES.find((c) => c.id === id)?.name ?? id;
}

/**
 * Alle Nachbarstaedte einer Stadt, optional ohne die Richtung, aus der man
 * gerade gekommen ist -- die Fahrt soll immer vorwaerts durchs Netz gehen,
 * nicht auf der gleichen Strecke sofort wieder zurueck.
 */
export function neighborsOf(cityId: string, excludeCityId?: string | null): RailEdge[] {
  const result: RailEdge[] = [];
  for (const edge of RAIL_EDGES) {
    if (edge.from === cityId && edge.to !== excludeCityId) result.push(edge);
    else if (edge.to === cityId && edge.from !== excludeCityId) result.push({ from: cityId, to: edge.from, km: edge.km });
  }
  return result;
}

/**
 * Zufaelliger Startbahnhof fuer eine neue Fahrt -- immer einer der kleinen
 * Startorte ("Kaffs"), nie direkt eine der grossen Staedte. Faellt auf alle
 * Staedte zurueck, falls aus irgendeinem Grund kein kleiner Startort
 * verfuegbar waere (kann bei den aktuellen Daten nicht vorkommen).
 */
export function randomStartCity(excludeCityId: string): string {
  const smallTowns = RAIL_CITIES.filter((c) => c.smallTown && c.id !== excludeCityId);
  const options = smallTowns.length > 0 ? smallTowns : RAIL_CITIES.filter((c) => c.id !== excludeCityId);
  return options[Math.floor(Math.random() * options.length)].id;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Kompass-Peilung (0 = Nord, 90 = Ost, 180 = Sued, 270 = West) von Stadt a
 * nach Stadt b, anhand der groben Koordinaten in RAIL_CITIES. Fuer die
 * Fahrt-Animation im Zugsimulator (siehe train-sim/index.ts) -- die Karte
 * soll sich in etwa in die richtige Himmelsrichtung "bewegen".
 */
export function bearingBetween(aId: string, bId: string): number {
  const a = RAIL_CITIES.find((c) => c.id === aId);
  const b = RAIL_CITIES.find((c) => c.id === bId);
  if (!a || !b) return 0;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}
