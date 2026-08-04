/**
 * Stark vereinfachtes, aber an echten Fernverkehrsverbindungen orientiertes
 * Streckennetz zwischen 16 grossen deutschen Staedten (angelehnt an reale
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
  // Kleine Startorte ("Kaffs") -- jeweils per kurzer Stichstrecke an eine
  // der grossen Staedte angebunden (siehe RAIL_EDGES unten). Die eigentliche
  // Fahrt startet IMMER an einem dieser Orte, nie direkt in einer Grossstadt
  // (siehe randomStartCity).
  { id: "buchholz", name: "Buchholz i.d.N.", lat: 53.32, lon: 9.87, smallTown: true },
  { id: "verden", name: "Verden (Aller)", lat: 52.92, lon: 9.23, smallTown: true },
  { id: "lehrte", name: "Lehrte", lat: 52.38, lon: 9.98, smallTown: true },
  { id: "unna", name: "Unna", lat: 51.54, lon: 7.69, smallTown: true },
  { id: "bruehl", name: "Brühl", lat: 50.83, lon: 6.91, smallTown: true },
  { id: "badVilbel", name: "Bad Vilbel", lat: 50.18, lon: 8.74, smallTown: true },
  { id: "bruchsal", name: "Bruchsal", lat: 49.12, lon: 8.6, smallTown: true },
  { id: "waiblingen", name: "Waiblingen", lat: 48.83, lon: 9.32, smallTown: true },
  { id: "fuerstenfeldbruck", name: "Fürstenfeldbruck", lat: 48.18, lon: 11.25, smallTown: true },
  { id: "schwabach", name: "Schwabach", lat: 49.33, lon: 10.99, smallTown: true },
  { id: "markkleeberg", name: "Markkleeberg", lat: 51.28, lon: 12.37, smallTown: true },
  { id: "radebeul", name: "Radebeul", lat: 51.1, lon: 13.66, smallTown: true },
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
  // Kurze Stichstrecken zu den kleinen Startorten.
  { from: "hamburg", to: "buchholz", km: 30 },
  { from: "bremen", to: "verden", km: 30 },
  { from: "hannover", to: "lehrte", km: 15 },
  { from: "dortmund", to: "unna", km: 20 },
  { from: "koeln", to: "bruehl", km: 15 },
  { from: "frankfurt", to: "badVilbel", km: 15 },
  { from: "karlsruhe", to: "bruchsal", km: 20 },
  { from: "stuttgart", to: "waiblingen", km: 15 },
  { from: "muenchen", to: "fuerstenfeldbruck", km: 25 },
  { from: "nuernberg", to: "schwabach", km: 15 },
  { from: "leipzig", to: "markkleeberg", km: 10 },
  { from: "dresden", to: "radebeul", km: 10 },
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
