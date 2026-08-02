import type { GameMeta } from "../games/registry";

const GRID_GAP = 12;
// Breite Tasten statt quadratischer Icon-Kacheln -- angelehnt an die
// Tastenform echter Fahrkartenautomaten-Bildschirme (Text linksbuendig,
// kleines Farb-Icon rechts). Muss mit .menu-tile { aspect-ratio: ... } in
// style.css uebereinstimmen, sonst rechnet computeGridLayout mit einer
// anderen Kachelform, als tatsaechlich gerendert wird.
const TILE_ASPECT = 1.8;
const MIN_TILE_WIDTH = 200;
const MAX_TILE_WIDTH = 460;

export interface MainMenuResult {
  element: HTMLElement;
  /** Muss beim Verlassen des Menues aufgerufen werden (stoppt den ResizeObserver). */
  destroy: () => void;
}

/**
 * Berechnet die Spaltenzahl + Kachelbreite, mit der N Kacheln (festes
 * Seitenverhaeltnis) einen gegebenen Bereich moeglichst vollstaendig
 * ausfuellen -- sowohl in der Breite als auch in der Hoehe. Reines
 * CSS-Grid (auto-fill/minmax) kennt nur die Breite, nicht die verfuegbare
 * Hoehe; das reicht nicht, wenn die Kacheln wirklich einen Grossteil des
 * Bildschirms fuellen sollen, statt oben oder seitlich Luft zu lassen.
 */
function computeGridLayout(containerWidth: number, containerHeight: number, count: number): { cols: number; tileWidth: number } {
  let best: { cols: number; tileWidth: number; area: number } | null = null;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const widthFromCols = (containerWidth - GRID_GAP * (cols - 1)) / cols;
    const heightFromRows = (containerHeight - GRID_GAP * (rows - 1)) / rows;

    let tileWidth = widthFromCols;
    let tileHeight = tileWidth / TILE_ASPECT;
    if (tileHeight > heightFromRows) {
      tileHeight = heightFromRows;
      tileWidth = tileHeight * TILE_ASPECT;
    }
    tileWidth = Math.min(tileWidth, MAX_TILE_WIDTH);
    if (tileWidth < MIN_TILE_WIDTH) continue;

    const area = tileWidth * (tileWidth / TILE_ASPECT);
    if (!best || area > best.area) best = { cols, tileWidth, area };
  }

  if (!best) {
    // Sehr kleiner Bildschirm, bei dem selbst eine Spalte die Mindestbreite
    // unterschreiten wuerde -- dann eben so breit wie moeglich, eine Spalte.
    return { cols: 1, tileWidth: Math.max(60, containerWidth) };
  }
  return { cols: best.cols, tileWidth: Math.floor(best.tileWidth) };
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
      <span class="menu-tile__icon">${game.badge}</span>
    `;
    tile.addEventListener("click", () => onSelect(game.id));
    grid.appendChild(tile);
  }

  card.appendChild(grid);
  screen.appendChild(card);

  // Spaltenzahl/Kachelgroesse an die tatsaechlich verfuegbare Breite UND
  // Hoehe anpassen (nicht nur an die Breite wie bei reinem CSS-Grid) --
  // dadurch fuellen die Kacheln den Bildschirm wirklich aus, egal ob
  // Hochformat, Querformat oder Browserfenster in Entwicklergroesse.
  const applyLayout = () => {
    const rect = grid.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || games.length === 0) return;
    const { cols, tileWidth } = computeGridLayout(rect.width, rect.height, games.length);
    grid.style.gridTemplateColumns = `repeat(${cols}, ${tileWidth}px)`;
  };

  const resizeObserver = new ResizeObserver(applyLayout);
  resizeObserver.observe(grid);

  return {
    element: screen,
    destroy: () => resizeObserver.disconnect(),
  };
}
