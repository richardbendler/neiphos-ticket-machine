import { icons } from "../core/icons";
import { guardedClick } from "../core/guardedClick";
import type { GameMeta } from "../games/registry";

// War ein fester Wert (12px) -- auf ausdruecklichen Wunsch (Vorlage: mehr
// Luecke zwischen den Kacheln) jetzt an die tatsaechliche Containerbreite
// gekoppelt (aehnlich einem CSS clamp(14px, 1.6vw, 30px), nur in JS
// nachgebaut, weil der Gap-Wert HIER exakt mit dem tatsaechlich in
// .menu-grid gesetzten CSS-Gap uebereinstimmen MUSS, sonst passt die
// berechnete Kachelbreite nicht mehr zur wirklich verfuegbaren Breite).
function gapForContainer(containerWidth: number): number {
  return Math.max(14, Math.min(30, containerWidth * 0.016));
}
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
// also ein 3x3-Raster) -- auf ausdruecklichen Wunsch fest beibehalten.
// Hochformat: keine feste Praeferenz mehr, siehe computeGridLayout unten.
const LANDSCAPE_COLS = 3;
const PORTRAIT_MAX_COLS = 3;
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

interface TileLayout {
  cols: number;
  tileWidth: number;
  tileHeight: number;
}

/** Kachelbreite fuer eine gegebene Spaltenzahl -- haengt nur von der Breite ab. */
function tileWidthForCols(containerWidth: number, cols: number): number {
  const gap = gapForContainer(containerWidth);
  const tileWidth = (containerWidth - gap * (cols - 1)) / cols;
  return Math.max(MIN_TILE_WIDTH, Math.min(tileWidth, MAX_TILE_WIDTH));
}

/**
 * Kachelgroesse (Breite UND Hoehe) fuer eine feste Spaltenzahl, so dass alle
 * resultierenden Zeilen garantiert ohne Scrollen in containerHeight passen
 * (auf ausdruecklichen Wunsch -- das Hauptmenue darf nie scrollbar sein).
 * Die Luecken (gap) zwischen den Zeilen bleiben dabei bewusst FEST (nicht
 * mitgeschrumpft) -- sonst wuerden sie bei vielen Zeilen einen wachsenden
 * Anteil des Platzes wegfressen, weil sie anders als die Kachelhoehe nicht
 * mitschrumpfen wuerden. Bindend ist die kleinere der beiden Vorgaben (aus
 * Breite bzw. aus Hoehe berechnet), die Kachelbreite folgt danach wieder aus
 * dem festen TILE_ASPECT-Verhaeltnis.
 */
function fitTilesForCols(containerWidth: number, containerHeight: number, count: number, cols: number): TileLayout {
  const c = Math.max(1, Math.min(cols, count));
  const gap = gapForContainer(containerWidth);
  const widthTileWidth = tileWidthForCols(containerWidth, c);
  const rows = Math.ceil(count / c);
  const heightForTiles = Math.max(rows, containerHeight - (rows - 1) * gap);
  const heightTileHeight = Math.floor(heightForTiles / rows);
  const widthTileHeight = Math.floor(widthTileWidth / TILE_ASPECT);
  const tileHeight = Math.max(1, Math.min(widthTileHeight, heightTileHeight));
  const tileWidth = Math.max(MIN_TILE_WIDTH, Math.min(widthTileWidth, Math.floor(tileHeight * TILE_ASPECT)));
  return { cols: c, tileWidth, tileHeight };
}

function computeGridLayout(containerWidth: number, containerHeight: number, count: number): TileLayout {
  const isPortrait = containerHeight > containerWidth;

  if (!isPortrait) {
    const cols = Math.min(LANDSCAPE_COLS, Math.max(1, count));
    return fitTilesForCols(containerWidth, containerHeight, count, cols);
  }

  // Hochformat: probiert 1..PORTRAIT_MAX_COLS Spalten durch und waehlt die
  // Variante mit der groessten resultierenden Kachelhoehe (= beste
  // Lesbarkeit). Eine feste Spaltenzahl-Praeferenz (vorher: "2, sonst 1")
  // beruecksichtigte nur die Breite -- bei vielen Kacheln und wenig Hoehe
  // konnte das zu unleserlich winzigen Kacheln fuehren, obwohl mehr Spalten
  // (weniger Zeilen = weniger feste Luecken) eigentlich mehr Platz je
  // Kachel uebrig gelassen haetten.
  let best = fitTilesForCols(containerWidth, containerHeight, count, 1);
  for (let cols = 2; cols <= Math.min(PORTRAIT_MAX_COLS, count); cols++) {
    const candidate = fitTilesForCols(containerWidth, containerHeight, count, cols);
    if (candidate.tileHeight > best.tileHeight) best = candidate;
  }
  return best;
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
        ${game.note ? `<span class="menu-tile__note">${game.note}</span>` : ""}
      </span>
      <span class="menu-tile__icon">${icons[game.icon]}</span>
    `;
    // guardedClick statt addEventListener("click", ...): verhindert mehrfach
    // gestartete Spiel-Setups bei Ghost-Touches/Spam auf dieselbe Kachel
    // (siehe core/guardedClick.ts).
    guardedClick(tile, () => onSelect(game.id));
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
    // clientWidth/-Height statt getBoundingClientRect(): schliesst Rundungs-
    // Unschaerfe bei Border/Padding korrekt aus.
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    if (width < 1 || height < 1 || games.length === 0) return;
    const { cols, tileWidth: widthTileWidth } = computeGridLayout(width, height, games.length);
    const gap = gapForContainer(width);

    // Auf ausdruecklichen Wunsch darf das Hauptmenue NIE scrollbar sein --
    // weder Quer- noch Hochformat, unabhaengig von Bildschirmgroesse oder
    // Spieleanzahl. computeGridLayout() bestimmt Spaltenzahl/Kachelbreite
    // bisher nur anhand der Breite (siehe Kommentar dort); hier wird
    // zusaetzlich die tatsaechlich verfuegbare Hoehe einberechnet: die
    // Luecken (gap) zwischen den Zeilen bleiben dabei bewusst FEST (nicht
    // mitgeschrumpft -- sonst fressen sie bei vielen Zeilen einen wachsenden
    // Anteil des Platzes weg, weil sie anders als die Kachelhoehe nicht mit
    // heruntergerechnet wuerden) -- nur die Kachelhoehe selbst
    // wird an die nach Abzug aller Luecken verbleibende Hoehe angepasst, die
    // Breite folgt daraus im festen TILE_ASPECT-Verhaeltnis. Bindend ist
    // jeweils die kleinere der beiden Vorgaben (aus Breite bzw. aus Hoehe
    // berechnet) -- so passen alle Zeilen garantiert ohne Scrollen hinein.
    const rows = Math.ceil(games.length / cols);
    const heightForTiles = Math.max(rows, height - (rows - 1) * gap);
    const heightTileHeight = Math.floor(heightForTiles / rows);
    const widthTileHeight = Math.floor(widthTileWidth / TILE_ASPECT);
    const tileHeight = Math.max(1, Math.min(widthTileHeight, heightTileHeight));
    const tileWidth = Math.max(MIN_TILE_WIDTH, Math.min(widthTileWidth, Math.floor(tileHeight * TILE_ASPECT)));

    grid.style.gridTemplateColumns = `repeat(${cols}, ${tileWidth}px)`;
    grid.style.gridAutoRows = `${tileHeight}px`;
    // Muss exakt der Gap-Wert sein, mit dem oben schon die Kachelbreite
    // berechnet wurde (siehe gapForContainer) -- sonst driftet die Breite
    // gegenueber dem tatsaechlich verfuegbaren Platz auseinander.
    grid.style.gap = `${Math.round(gap)}px`;
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
