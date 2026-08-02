import { icons } from "../core/icons";
import type { GameMeta } from "../games/registry";

const GRID_GAP = 12;
// Seitenverhaeltnis der Kacheln -- muss mit .menu-tile { aspect-ratio: ... }
// in style.css uebereinstimmen. Die Hoehe wird trotzdem zusaetzlich explizit
// per grid-auto-rows gesetzt (nicht nur aus aspect-ratio abgeleitet): bei
// sehr kurzen Kachelhoehen kollidierte reines CSS aspect-ratio mit der
// flex-basierten Zentrierung des Kachelinhalts (align-items:center) in
// Kombination mit overflow:hidden -- Titel/Icon wurden dann ausserhalb der
// sichtbaren Kachel gerendert und wirkten wie fehlender Text.
const TILE_ASPECT = 2.35;
const MAX_TILE_WIDTH = 620;
const MIN_TILE_WIDTH = 40;
// Querformat (Breite >= Hoehe): immer 3 Spalten (bei aktuell 9 Spielen
// also ein 3x3-Raster). Hochformat: bevorzugt 2 Spalten, faellt aber auf 1
// zurueck, wenn selbst 2 Spalten die Kacheln unangenehm schmal machen wuerden
// -- Kacheln UND Schrift werden ansonsten per Skalierungsfaktor kleiner/
// groesser, statt bei wenig Platz auf noch mehr Spalten umzuspringen.
const LANDSCAPE_COLS = 3;
const PORTRAIT_PREFERRED_COLS = 2;
const PORTRAIT_MIN_TILE_WIDTH_FOR_TWO_COLS = 170;
// Kachelbreite, bei der Schrift/Icon in style.css ihre "normale" Groesse
// (1.08rem/0.76rem/46px) haben -- der Skalierungsfaktor ist relativ dazu.
const REFERENCE_TILE_WIDTH = 280;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.2;

export interface MainMenuResult {
  element: HTMLElement;
  /** Muss beim Verlassen des Menues aufgerufen werden (stoppt den ResizeObserver). */
  destroy: () => void;
}

/**
 * Kachelbreite fuer eine gegebene Spaltenzahl -- haengt bewusst NUR von der
 * verfuegbaren Breite ab, nicht von der Hoehe. Ein fruehere Version bezog
 * auch die Hoehe mit ein (um ohne Scrollen auszukommen), das liess Kacheln
 * bei vielen Zeilen (z. B. eine einzelne schmale Spalte mit 9 Kacheln
 * untereinander) aber absurd schmal werden -- mit Buchstabe-fuer-Buchstabe-
 * Zeilenumbruch. .menu-grid ist ohnehin scrollbar, also darf die Liste
 * bei Bedarf einfach laenger werden, statt in der Breite zu schrumpfen.
 */
function tileWidthForCols(containerWidth: number, cols: number): number {
  const tileWidth = (containerWidth - GRID_GAP * (cols - 1)) / cols;
  return Math.max(MIN_TILE_WIDTH, Math.min(tileWidth, MAX_TILE_WIDTH));
}

function computeGridLayout(containerWidth: number, containerHeight: number, count: number): { cols: number; tileWidth: number } {
  const isPortrait = containerHeight > containerWidth;

  if (!isPortrait) {
    const cols = Math.min(LANDSCAPE_COLS, Math.max(1, count));
    return { cols, tileWidth: Math.floor(tileWidthForCols(containerWidth, cols)) };
  }

  const preferredCols = Math.min(PORTRAIT_PREFERRED_COLS, Math.max(1, count));
  const preferredWidth = tileWidthForCols(containerWidth, preferredCols);
  if (preferredCols <= 1 || preferredWidth >= PORTRAIT_MIN_TILE_WIDTH_FOR_TWO_COLS) {
    return { cols: preferredCols, tileWidth: Math.floor(preferredWidth) };
  }
  // 2 Spalten waeren zu schmal -- lieber eine breite Spalte mit groesserer
  // Schrift als zwei knapp lesbare.
  return { cols: 1, tileWidth: Math.floor(tileWidthForCols(containerWidth, 1)) };
}

/**
 * Rendert das Hauptmenue (reines DOM/CSS, kein Canvas -- die Kacheln sind
 * grosse Touch-Ziele, das laesst sich mit HTML/CSS einfacher und zugaenglicher
 * bauen als mit manuellem Canvas-Hit-Testing).
 */
export function renderMainMenu(games: GameMeta[], onSelect: (id: string) => void): MainMenuResult {
  const screen = document.createElement("div");
  screen.className = "menu-screen";

  const card = document.createElement("div");
  card.className = "menu-card";

  const header = document.createElement("div");
  header.className = "menu-header";
  header.innerHTML = `<h1>Bitte Spiel wählen.</h1>`;
  card.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "menu-grid";

  for (const game of games) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "menu-tile";
    tile.style.setProperty("--tile-accent", game.accent);
    tile.innerHTML = `
      <span class="menu-tile__text">
        <span class="menu-tile__title">${game.title}</span>
        <span class="menu-tile__subtitle">${game.subtitle}</span>
      </span>
      <span class="menu-tile__icon">${icons[game.icon]}</span>
    `;
    tile.addEventListener("click", () => onSelect(game.id));
    grid.appendChild(tile);
  }

  card.appendChild(grid);
  screen.appendChild(card);

  // Spaltenzahl bleibt fest (3), aber Kachelgroesse UND Schrift-/Icon-
  // Skalierung passen sich an die tatsaechlich verfuegbare Breite UND Hoehe
  // an (nicht nur an die Breite wie bei reinem CSS-Grid) -- dadurch fuellen
  // die Kacheln den Bildschirm wirklich aus, egal ob Hochformat, Querformat
  // oder Browserfenster in Entwicklergroesse.
  const applyLayout = () => {
    const rect = grid.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || games.length === 0) return;
    const { cols, tileWidth } = computeGridLayout(rect.width, rect.height, games.length);
    const tileHeight = Math.floor(tileWidth / TILE_ASPECT);
    grid.style.gridTemplateColumns = `repeat(${cols}, ${tileWidth}px)`;
    grid.style.gridAutoRows = `${tileHeight}px`;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, tileWidth / REFERENCE_TILE_WIDTH));
    grid.style.setProperty("--menu-tile-scale", String(scale));
  };

  const resizeObserver = new ResizeObserver(applyLayout);
  resizeObserver.observe(grid);

  return {
    element: screen,
    destroy: () => resizeObserver.disconnect(),
  };
}
