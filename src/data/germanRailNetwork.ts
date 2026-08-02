/**
 * Stark vereinfachtes, aber an echten Fernverkehrsverbindungen orientiertes
 * Streckennetz zwischen 16 grossen deutschen Staedten (angelehnt an reale
 * ICE-/IC-Linien). Entfernungen sind grobe Bahnkilometer-Naeherungen, keine
 * exakten Werte -- fuer den Kilometerzaehler im Spiel reicht das.
 */

export interface RailCity {
  id: string;
  name: string;
}

export interface RailEdge {
  from: string;
  to: string;
  km: number;
}

export const RAIL_CITIES: RailCity[] = [
  { id: "berlin", name: "Berlin" },
  { id: "hamburg", name: "Hamburg" },
  { id: "bremen", name: "Bremen" },
  { id: "hannover", name: "Hannover" },
  { id: "dortmund", name: "Dortmund" },
  { id: "essen", name: "Essen" },
  { id: "duesseldorf", name: "Düsseldorf" },
  { id: "koeln", name: "Köln" },
  { id: "frankfurt", name: "Frankfurt" },
  { id: "mannheim", name: "Mannheim" },
  { id: "stuttgart", name: "Stuttgart" },
  { id: "karlsruhe", name: "Karlsruhe" },
  { id: "muenchen", name: "München" },
  { id: "nuernberg", name: "Nürnberg" },
  { id: "leipzig", name: "Leipzig" },
  { id: "dresden", name: "Dresden" },
];

// Ungerichtet gemeint -- gilt in beide Richtungen (siehe neighborsOf).
export const RAIL_EDGES: RailEdge[] = [
  { from: "berlin", to: "hamburg", km: 290 },
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
