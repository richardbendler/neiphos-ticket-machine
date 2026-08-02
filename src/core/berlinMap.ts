import { STATION_COORDS } from "../data/berlinStationCoords";
import { transitLines } from "../data/berlinNetwork";
import { openModal } from "./modal";

/**
 * Kleine Mini-Karte fuer die Verbindungssuche: zeigt Start- und Zielstation
 * auf einem echten (wenn auch stark vereinfachten) Ausschnitt des Berliner
 * Liniennetzes. Zusammengeklappt eine kurze, breite Leiste oben im Spiel;
 * ein Tipp darauf oeffnet eine groessere, staerker gezoomte Ansicht als
 * Modal (wiederverwendet core/modal.ts statt eigener Layout-Logik fuer den
 * expandierten Zustand).
 */

interface Point {
  x: number;
  y: number;
}

const VIEW_W = 1000;

// Einmalig berechnete globale Projektion. Laengengrade werden bei gegebener
// Breite auf der Erdkugel gestaucht (Meridiankonvergenz) -- mit
// cos(mittlere Breite) grob ausgeglichen, sonst wirkt die Karte in
// Ost-West-Richtung sichtbar zu breit.
const allCoords = Object.values(STATION_COORDS);
const minLat = Math.min(...allCoords.map((c) => c.lat));
const maxLat = Math.max(...allCoords.map((c) => c.lat));
const minLon = Math.min(...allCoords.map((c) => c.lon));
const maxLon = Math.max(...allCoords.map((c) => c.lon));
const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
const lonScale = Math.cos(avgLatRad);
const lonSpan = (maxLon - minLon) * lonScale;
const latSpan = maxLat - minLat;
const VIEW_H = VIEW_W * (latSpan / lonSpan);

function project(lat: number, lon: number): Point {
  return {
    x: ((lon - minLon) * lonScale) / lonSpan * VIEW_W,
    y: ((maxLat - lat) / latSpan) * VIEW_H,
  };
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

/** Zentriert auf den Mittelpunkt von a/b, mit Rand drumherum, passend zum gewuenschten Seitenverhaeltnis zugeschnitten. */
function computeViewBox(a: Point, b: Point, aspect: number): { x: number; y: number; w: number; h: number } {
  const paddingFactor = 1.8;
  const minSpan = VIEW_W * 0.06;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  let w = Math.max(Math.abs(a.x - b.x), minSpan) * paddingFactor;
  let h = Math.max(Math.abs(a.y - b.y), minSpan) * paddingFactor;
  if (w / h > aspect) {
    h = w / aspect;
  } else {
    w = h * aspect;
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// Liniennetz einmalig in projizierte Punktzuege umgerechnet -- aendert sich
// nie zur Laufzeit, muss also nicht pro Kartenansicht neu berechnet werden.
const projectedLines = transitLines
  .map((line) => ({
    color: line.color,
    points: line.stations.map((s) => STATION_COORDS[s]).filter((c): c is { lat: number; lon: number } => !!c).map((c) => project(c.lat, c.lon)),
  }))
  .filter((l) => l.points.length >= 2);

const projectedStations = Object.entries(STATION_COORDS).map(([name, c]) => ({ name, p: project(c.lat, c.lon) }));

function buildMapSvg(startName: string, targetName: string, aspect: number): SVGSVGElement {
  const a = STATION_COORDS[startName];
  const b = STATION_COORDS[targetName];
  const svg = svgEl("svg");
  svg.setAttribute("class", "berlin-map__svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (!a || !b) return svg;
  const pa = project(a.lat, a.lon);
  const pb = project(b.lat, b.lon);
  const vb = computeViewBox(pa, pb, aspect);
  svg.setAttribute("viewBox", `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);

  const linesLayer = svgEl("g");
  for (const line of projectedLines) {
    const poly = svgEl("polyline");
    poly.setAttribute("points", line.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", line.color);
    poly.setAttribute("stroke-width", "3.5");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("opacity", "0.55");
    linesLayer.appendChild(poly);
  }
  svg.appendChild(linesLayer);

  const dotsLayer = svgEl("g");
  for (const station of projectedStations) {
    const dot = svgEl("circle");
    dot.setAttribute("cx", station.p.x.toFixed(1));
    dot.setAttribute("cy", station.p.y.toFixed(1));
    dot.setAttribute("r", "2.2");
    dot.setAttribute("class", "berlin-map__dot");
    dotsLayer.appendChild(dot);
  }
  svg.appendChild(dotsLayer);

  const markersLayer = svgEl("g");
  const addMarker = (p: Point, label: string, kind: "start" | "target") => {
    const circle = svgEl("circle");
    circle.setAttribute("cx", p.x.toFixed(1));
    circle.setAttribute("cy", p.y.toFixed(1));
    circle.setAttribute("r", "10");
    circle.setAttribute("class", `berlin-map__marker berlin-map__marker--${kind}`);
    markersLayer.appendChild(circle);

    const text = svgEl("text");
    text.setAttribute("x", p.x.toFixed(1));
    text.setAttribute("y", (p.y - 15).toFixed(1));
    text.setAttribute("class", "berlin-map__label");
    text.textContent = label;
    markersLayer.appendChild(text);
  };
  addMarker(pa, startName, "start");
  addMarker(pb, targetName, "target");
  svg.appendChild(markersLayer);

  return svg;
}

export interface BerlinMapHandle {
  el: HTMLDivElement;
  update: (startName: string, targetName: string) => void;
  destroy: () => void;
}

const COLLAPSED_ASPECT = 3.1;
const EXPANDED_ASPECT = 1.05;

export function createBerlinMap(): BerlinMapHandle {
  let currentStart = "";
  let currentTarget = "";

  const el = document.createElement("div");
  el.className = "berlin-map berlin-map--collapsed";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", "Karte vergrößern");

  const hint = document.createElement("div");
  hint.className = "berlin-map__hint";
  hint.textContent = "🔍 Antippen zum Vergrößern";
  el.appendChild(hint);

  function renderCollapsed(): void {
    if (!currentStart || !currentTarget) return;
    const svg = buildMapSvg(currentStart, currentTarget, COLLAPSED_ASPECT);
    el.querySelector(".berlin-map__svg")?.remove();
    el.insertBefore(svg, hint);
  }

  let closeExpanded: (() => void) | null = null;

  el.addEventListener("click", () => {
    if (!currentStart || !currentTarget) return;
    closeExpanded = openModal(
      (panel, close) => {
        const h2 = document.createElement("h2");
        h2.textContent = "Streckenkarte";
        panel.appendChild(h2);

        const mapWrap = document.createElement("div");
        mapWrap.className = "berlin-map berlin-map--expanded";
        mapWrap.appendChild(buildMapSvg(currentStart, currentTarget, EXPANDED_ASPECT));
        panel.appendChild(mapWrap);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "btn btn--accent";
        closeBtn.style.width = "100%";
        closeBtn.style.marginTop = "12px";
        closeBtn.textContent = "Schließen";
        closeBtn.addEventListener("click", () => {
          closeExpanded = null;
          close();
        });
        panel.appendChild(closeBtn);
      },
      { wide: true },
    );
  });

  return {
    el,
    update(startName, targetName) {
      currentStart = startName;
      currentTarget = targetName;
      renderCollapsed();
    },
    destroy() {
      closeExpanded?.();
      closeExpanded = null;
      el.remove();
    },
  };
}
