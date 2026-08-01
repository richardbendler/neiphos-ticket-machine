import { transitLines } from "../../data/berlinNetwork";

/**
 * Sehr einfaches Graph-/Routing-Modell ueber src/data/berlinNetwork.ts:
 * Knoten sind (Station, Linie)-Paare, damit ein Umstieg als eigener,
 * zusaetzlich "teurer" Schritt modelliert werden kann (Dijkstra ueber den
 * sogenannten Liniengraphen). Reicht fuer ein Netz dieser Groesse locker aus,
 * es braucht keine Priority-Queue-Bibliothek.
 */

export const TRANSFER_PENALTY = 3;

interface Edge {
  to: string;
  lineId: string;
}

let adjacency: Map<string, Edge[]> | null = null;
let stationLines: Map<string, string[]> | null = null;

function ensureIndexes(): { adjacency: Map<string, Edge[]>; stationLines: Map<string, string[]> } {
  if (adjacency && stationLines) return { adjacency, stationLines };

  adjacency = new Map();
  stationLines = new Map();

  const addEdge = (from: string, to: string, lineId: string) => {
    const list = adjacency!.get(from) ?? [];
    list.push({ to, lineId });
    adjacency!.set(from, list);
  };

  for (const line of transitLines) {
    const stations = line.stations;
    for (const s of stations) {
      const lines = stationLines.get(s) ?? [];
      if (!lines.includes(line.id)) lines.push(line.id);
      stationLines.set(s, lines);
    }
    for (let i = 0; i < stations.length - 1; i++) {
      addEdge(stations[i], stations[i + 1], line.id);
      addEdge(stations[i + 1], stations[i], line.id);
    }
    // Kein Rundum-Kante fuer die Ringbahn: S41 (im Uhrzeigersinn) und S42
    // (gegen den Uhrzeigersinn) sind bereits als zwei separate, gegenlaeufige
    // Linien hinterlegt. Ohne echte Wraparound-Kante bleibt die im UI
    // gezeigte Stationsanzahl (einfache Indexdifferenz) immer konsistent mit
    // der tatsaechlich vom Spieler gewaehlten Fahrtrichtung.
  }

  return { adjacency, stationLines };
}

export function linesAt(station: string): string[] {
  const { stationLines: sl } = ensureIndexes();
  return sl.get(station) ?? [];
}

export interface RouteSegment {
  lineId: string;
  from: string;
  to: string;
  stops: number;
}

export interface RouteResult {
  segments: RouteSegment[];
  totalStops: number;
  transfers: number;
  cost: number;
}

/** Kosten einer beliebigen (auch suboptimalen) Segmentliste -- fuer den Vergleich mit der Spieler-Route. */
export function costOf(segments: RouteSegment[]): number {
  const totalStops = segments.reduce((sum, s) => sum + s.stops, 0);
  const transfers = Math.max(0, segments.length - 1);
  return totalStops + transfers * TRANSFER_PENALTY;
}

/** Dijkstra ueber dem (Station, Linie)-Liniengraphen. Liefert die guenstigste Verbindung. */
export function findOptimalRoute(start: string, end: string): RouteResult | null {
  const { adjacency: adj } = ensureIndexes();
  if (start === end) return { segments: [], totalStops: 0, transfers: 0, cost: 0 };

  const keyOf = (station: string, lineId: string) => `${station}::${lineId}`;

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const queue: Array<{ key: string; station: string; lineId: string; dist: number }> = [];
  const visited = new Set<string>();

  for (const lineId of linesAt(start)) {
    const k = keyOf(start, lineId);
    dist.set(k, 0);
    prev.set(k, null);
    queue.push({ key: k, station: start, lineId, dist: 0 });
  }

  while (queue.length > 0) {
    queue.sort((a, b) => a.dist - b.dist);
    const current = queue.shift()!;
    if (visited.has(current.key)) continue;
    visited.add(current.key);

    if (current.station === end) {
      return reconstruct(current.key, prev, dist);
    }

    for (const edge of adj.get(current.station) ?? []) {
      if (edge.lineId !== current.lineId) continue;
      const nk = keyOf(edge.to, edge.lineId);
      const nd = current.dist + 1;
      if (!dist.has(nk) || nd < dist.get(nk)!) {
        dist.set(nk, nd);
        prev.set(nk, current.key);
        queue.push({ key: nk, station: edge.to, lineId: edge.lineId, dist: nd });
      }
    }

    for (const lineId of linesAt(current.station)) {
      if (lineId === current.lineId) continue;
      const nk = keyOf(current.station, lineId);
      const nd = current.dist + TRANSFER_PENALTY;
      if (!dist.has(nk) || nd < dist.get(nk)!) {
        dist.set(nk, nd);
        prev.set(nk, current.key);
        queue.push({ key: nk, station: current.station, lineId, dist: nd });
      }
    }
  }

  return null;
}

function reconstruct(
  endKey: string,
  prev: Map<string, string | null>,
  dist: Map<string, number>,
): RouteResult {
  const chain: string[] = [];
  let cur: string | null = endKey;
  while (cur) {
    chain.push(cur);
    cur = prev.get(cur) ?? null;
  }
  chain.reverse();

  const segments: RouteSegment[] = [];
  for (let i = 1; i < chain.length; i++) {
    const [prevStation, prevLine] = chain[i - 1].split("::");
    const [curStation, curLine] = chain[i].split("::");
    if (prevLine === curLine) {
      const last = segments[segments.length - 1];
      if (last && last.lineId === curLine && last.to === prevStation) {
        last.to = curStation;
        last.stops += 1;
      } else {
        segments.push({ lineId: curLine, from: prevStation, to: curStation, stops: 1 });
      }
    }
  }

  return { segments, totalStops: segments.reduce((s, seg) => s + seg.stops, 0), transfers: Math.max(0, segments.length - 1), cost: dist.get(endKey) ?? 0 };
}

/** Waehlt ein zufaelliges, loesbares und nicht-triviales Start/Ziel-Paar. */
export function pickRandomPair(
  allStations: string[],
  rng: () => number = Math.random,
  minCost = 5,
  maxCost = 26,
): { start: string; end: string; optimal: RouteResult } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const start = allStations[Math.floor(rng() * allStations.length)];
    let end = allStations[Math.floor(rng() * allStations.length)];
    if (end === start) continue;
    const optimal = findOptimalRoute(start, end);
    if (!optimal) continue;
    if (optimal.cost < minCost || optimal.cost > maxCost) continue;
    return { start, end, optimal };
  }
  // Fallback (sollte praktisch nie noetig sein): irgendein loesbares Paar akzeptieren.
  for (let attempt = 0; attempt < 500; attempt++) {
    const start = allStations[Math.floor(rng() * allStations.length)];
    const end = allStations[Math.floor(rng() * allStations.length)];
    if (end === start) continue;
    const optimal = findOptimalRoute(start, end);
    if (optimal) return { start, end, optimal };
  }
  throw new Error("Kein loesbares Start/Ziel-Paar gefunden -- Netzwerkdaten pruefen.");
}
