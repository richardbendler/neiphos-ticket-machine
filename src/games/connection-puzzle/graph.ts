import { transitLines } from "../../data/berlinNetwork";

/**
 * Liniengraph statt Stationsgraph: Knoten sind Linien (U2, S5, M4, ...),
 * zwei Linien sind "verbunden", wenn sie mindestens eine gemeinsame Station
 * haben (= Umstiegsmoeglichkeit). Das Spiel fragt nur noch nach der
 * richtigen Reihenfolge der Linien, nicht nach einzelnen Stationen/Stops --
 * dafuer reicht ein einfacher Liniengraph, kein gewichteter Stationsgraph.
 */

let stationToLines: Map<string, string[]> | null = null;
let lineAdjacency: Map<string, Set<string>> | null = null;

function ensureIndexes(): { stationToLines: Map<string, string[]>; lineAdjacency: Map<string, Set<string>> } {
  if (stationToLines && lineAdjacency) return { stationToLines, lineAdjacency };

  stationToLines = new Map();
  for (const line of transitLines) {
    for (const station of line.stations) {
      const lines = stationToLines.get(station) ?? [];
      if (!lines.includes(line.id)) lines.push(line.id);
      stationToLines.set(station, lines);
    }
  }

  lineAdjacency = new Map();
  for (const line of transitLines) lineAdjacency.set(line.id, new Set());
  for (const lines of stationToLines.values()) {
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        lineAdjacency.get(lines[i])!.add(lines[j]);
        lineAdjacency.get(lines[j])!.add(lines[i]);
      }
    }
  }

  return { stationToLines, lineAdjacency };
}

export function linesAt(station: string): string[] {
  const { stationToLines: sl } = ensureIndexes();
  return sl.get(station) ?? [];
}

/** Gibt es eine gemeinsame Station, an der man von lineA auf lineB umsteigen kann? */
export function linesConnect(lineAId: string, lineBId: string): boolean {
  const { lineAdjacency: adj } = ensureIndexes();
  return adj.get(lineAId)?.has(lineBId) ?? false;
}

export interface LineRoute {
  lineIds: string[];
}

/** Kuerzeste Linienfolge (wenigste Linien/Umstiege) von einer Start- zu einer Zielstation, per Breitensuche ueber dem Liniengraphen. */
export function findMinimalLineRoute(start: string, end: string): LineRoute | null {
  const { lineAdjacency: adj } = ensureIndexes();
  const startLines = linesAt(start);
  const endLineSet = new Set(linesAt(end));
  if (startLines.length === 0 || endLineSet.size === 0) return null;

  for (const l of startLines) {
    if (endLineSet.has(l)) return { lineIds: [l] };
  }

  const visited = new Set<string>(startLines);
  const queue: string[][] = startLines.map((l) => [l]);
  let qi = 0;
  while (qi < queue.length) {
    const path = queue[qi++];
    const last = path[path.length - 1];
    for (const next of adj.get(last) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const nextPath = [...path, next];
      if (endLineSet.has(next)) return { lineIds: nextPath };
      queue.push(nextPath);
    }
  }
  return null;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/** Prueft, ob eine vom Spieler gewaehlte Linienfolge tatsaechlich Start und Ziel verbindet. */
export function validateLineSequence(start: string, end: string, lineIds: string[]): ValidationResult {
  if (lineIds.length === 0) return { valid: false, reason: "Wähle mindestens eine Linie." };

  const firstLineStations = transitLines.find((l) => l.id === lineIds[0])?.stations ?? [];
  if (!firstLineStations.includes(start)) {
    return { valid: false, reason: `Die Linie ${lineIds[0]} fährt gar nicht durch ${start}.` };
  }

  const lastId = lineIds[lineIds.length - 1];
  const lastLineStations = transitLines.find((l) => l.id === lastId)?.stations ?? [];
  if (!lastLineStations.includes(end)) {
    return { valid: false, reason: `Die Linie ${lastId} fährt gar nicht durch ${end}.` };
  }

  for (let i = 0; i < lineIds.length - 1; i++) {
    if (!linesConnect(lineIds[i], lineIds[i + 1])) {
      return {
        valid: false,
        reason: `Zwischen ${lineIds[i]} und ${lineIds[i + 1]} gibt es keine gemeinsame Station zum Umsteigen.`,
      };
    }
  }

  return { valid: true };
}

/** Waehlt ein zufaelliges, loesbares Start/Ziel-Paar mit einer nicht-trivialen, aber machbaren Linienanzahl. */
export function pickRandomPair(
  allStations: string[],
  rng: () => number = Math.random,
  minLines = 1,
  maxLines = 4,
): { start: string; end: string; optimal: LineRoute } {
  for (let attempt = 0; attempt < 300; attempt++) {
    const start = allStations[Math.floor(rng() * allStations.length)];
    const end = allStations[Math.floor(rng() * allStations.length)];
    if (start === end) continue;
    const optimal = findMinimalLineRoute(start, end);
    if (!optimal) continue;
    if (optimal.lineIds.length < minLines || optimal.lineIds.length > maxLines) continue;
    return { start, end, optimal };
  }
  for (let attempt = 0; attempt < 500; attempt++) {
    const start = allStations[Math.floor(rng() * allStations.length)];
    const end = allStations[Math.floor(rng() * allStations.length)];
    if (start === end) continue;
    const optimal = findMinimalLineRoute(start, end);
    if (optimal) return { start, end, optimal };
  }
  throw new Error("Kein loesbares Start/Ziel-Paar gefunden -- Netzwerkdaten pruefen.");
}
