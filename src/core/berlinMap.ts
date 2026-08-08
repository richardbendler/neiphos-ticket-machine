import { STATION_COORDS } from "../data/berlinStationCoords";
import { transitLines } from "../data/berlinNetwork";
import { BERLIN_BOUNDARY } from "../data/berlinBoundary";
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

// Stadtgrenze als Hintergrund-Silhouette -- gibt der Karte einen festen
// Bezugsrahmen ("bin ich mittig in der Stadt oder eher am Rand?"), den
// reine Linien/Punkte ohne jede Flaeche/Kontur nicht liefern.
const projectedBoundary = BERLIN_BOUNDARY.map(([lat, lon]) => project(lat, lon));
const boundaryPathD = projectedBoundary.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";

function setViewBox(svg: SVGSVGElement, vb: { x: number; y: number; w: number; h: number }): void {
  svg.setAttribute("viewBox", `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
}

function buildMapSvg(startName: string, targetName: string, aspect: number): SVGSVGElement {
  const a = STATION_COORDS[startName];
  const b = STATION_COORDS[targetName];
  const svg = svgEl("svg");
  svg.setAttribute("class", "berlin-map__svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  if (!a || !b) return svg;
  const pa = project(a.lat, a.lon);
  const pb = project(b.lat, b.lon);
  setViewBox(svg, computeViewBox(pa, pb, aspect));

  const boundaryPath = svgEl("path");
  boundaryPath.setAttribute("d", boundaryPathD);
  boundaryPath.setAttribute("class", "berlin-map__boundary");
  svg.appendChild(boundaryPath);

  const linesLayer = svgEl("g");
  for (const line of projectedLines) {
    const poly = svgEl("polyline");
    poly.setAttribute("points", line.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", line.color);
    // War 3.5 -- bei den vielen sich ueberkreuzenden Linien im dichten
    // Berliner Netz wirkte das zu wuchtig/unuebersichtlich (gemeldet).
    // Etwas duenner, dafuer etwas kraeftiger eingefaerbt (Opazitaet leicht
    // erhoeht), damit die einzelnen Linien trotz geringerer Breite weiter
    // gut unterscheidbar bleiben.
    poly.setAttribute("stroke-width", "2");
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute("opacity", "0.65");
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
    // Tatsaechliches Seitenverhaeltnis des Containers verwenden statt des
    // festen COLLAPSED_ASPECT-Werts -- der passte nur zur frueheren festen
    // Balkenhoehe. Seit die Kartenzone bei der Verbindungssuche einen
    // festen Prozentanteil der Bildschirmhoehe bekommt (siehe
    // .connection-puzzle-map-zone), kann das reale Verhaeltnis je nach
    // Bildschirmgroesse stark abweichen -- ohne Anpassung fuehrte "meet"
    // sonst zu einer falsch skalierten Karte samt abgeschnittener
    // Beschriftung (gemeldet). Fallback auf den festen Wert nur, falls der
    // Container noch keine Groesse hat (ganz erster Render-Tick).
    const aspect = el.clientWidth > 0 && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : COLLAPSED_ASPECT;
    const svg = buildMapSvg(currentStart, currentTarget, aspect);
    el.querySelector(".berlin-map__svg")?.remove();
    el.insertBefore(svg, hint);
  }

  let closeExpanded: (() => void) | null = null;

  // Zoom-Grenzen relativ zur vollen Kartenbreite (VIEW_W): mehr als ca.
  // 25x reinzoomen macht die Strecke nicht mehr lesbar (Stationsabstaende
  // im projizierten Koordinatensystem), weiter als die volle Netzbreite
  // rauszoomen bringt nichts, weil dann ohnehin nur noch Leerraum drumherum
  // sichtbar waere.
  const ZOOM_MIN_W = VIEW_W * 0.04;
  const ZOOM_MAX_W = VIEW_W * 1.3;

  el.addEventListener("click", () => {
    if (!currentStart || !currentTarget) return;
    const a = STATION_COORDS[currentStart];
    const b = STATION_COORDS[currentTarget];
    if (!a || !b) return;
    const pa = project(a.lat, a.lon);
    const pb = project(b.lat, b.lon);
    let vb = computeViewBox(pa, pb, EXPANDED_ASPECT);
    // Beim Oeffnen bewusst etwas weiter herausgezoomt starten als die enge
    // Bar-Vorschau -- sonst sieht man beim ersten Blick oft nur eine
    // kontextlose Nahaufnahme der Route, ohne jede Orientierung, wo in der
    // Stadt man sich gerade befindet (siehe auch die neue Stadtgrenze unten).
    const initialSpread = Math.min(ZOOM_MAX_W / vb.w, 1.8);
    vb = {
      x: vb.x - (vb.w * (initialSpread - 1)) / 2,
      y: vb.y - (vb.h * (initialSpread - 1)) / 2,
      w: vb.w * initialSpread,
      h: vb.h * initialSpread,
    };

    closeExpanded = openModal(
      (panel, close) => {
        // Eigene Layout-Klasse NUR fuer dieses Modal (siehe CSS) -- die
        // Karte bekam vorher unabhaengig von der tatsaechlich verfuegbaren
        // Hoehe immer bis zu min(60vh, 480px) zugewiesen, wodurch auf einem
        // Kiosk-Hochformat-Bildschirm oft kein Platz mehr fuer die +/−-
        // Zoom-Buttons und den Schliessen-Button blieb, ohne im Modal selbst
        // erst runterzuscrollen (gemeldet). Als Flex-Spalte schrumpft die
        // Karte jetzt automatisch auf den Rest-Platz, waehrend Titel und
        // Buttons IMMER in voller Groesse sichtbar bleiben.
        panel.classList.add("berlin-map-modal-panel");

        const h2 = document.createElement("h2");
        h2.textContent = "Streckenkarte";
        panel.appendChild(h2);

        const mapWrap = document.createElement("div");
        mapWrap.className = "berlin-map berlin-map--expanded";
        const svg = buildMapSvg(currentStart, currentTarget, EXPANDED_ASPECT);
        setViewBox(svg, vb); // ueberschreibt die enge Standard-viewBox mit der weiter herausgezoomten Start-Ansicht (siehe initialSpread oben)
        mapWrap.appendChild(svg);
        panel.appendChild(mapWrap);

        function zoom(factor: number): void {
          const cx = vb.x + vb.w / 2;
          const cy = vb.y + vb.h / 2;
          const newW = Math.min(ZOOM_MAX_W, Math.max(ZOOM_MIN_W, vb.w * factor));
          const newH = newW / EXPANDED_ASPECT;
          vb = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
          setViewBox(svg, vb);
        }

        const zoomRow = document.createElement("div");
        zoomRow.className = "berlin-map__zoom-row";

        const zoomOutBtn = document.createElement("button");
        zoomOutBtn.type = "button";
        zoomOutBtn.className = "btn btn--ghost";
        zoomOutBtn.textContent = "−";
        zoomOutBtn.setAttribute("aria-label", "Karte verkleinern");
        zoomOutBtn.addEventListener("click", () => zoom(1.3));

        const zoomInBtn = document.createElement("button");
        zoomInBtn.type = "button";
        zoomInBtn.className = "btn btn--ghost";
        zoomInBtn.textContent = "+";
        zoomInBtn.setAttribute("aria-label", "Karte vergrößern");
        zoomInBtn.addEventListener("click", () => zoom(1 / 1.3));

        zoomRow.append(zoomOutBtn, zoomInBtn);
        panel.appendChild(zoomRow);

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
