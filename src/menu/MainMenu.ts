import { icons } from "../core/icons";
import { guardedClick } from "../core/guardedClick";
import type { GameMeta } from "../games/registry";

// Abstand INNERHALB eines Clusters -- auf ausdruecklichen Wunsch nicht mehr
// nur von der Containerbreite abhaengig, sondern im Verhaeltnis zur
// tatsaechlichen Kachelhoehe (an die VBB-Vorlage angelehnt). War 0.34, dann
// auf ausdruecklichen Wunsch halbiert ("Luecken innerhalb der Cluster
// halbieren, Buttons dadurch groesser") -- schrumpft ueber
// clusterGapForTileHeight automatisch auch die Zwischen-Cluster-Luecken mit.
// Haengt zirkulaer von der erst noch zu berechnenden Kachelhoehe ab -- siehe
// solveTileHeight (Fixpunkt-Iteration).
const GAP_TO_TILE_RATIO = 0.17;

// Abstand ZWISCHEN Kachel-Clustern (siehe TILE_CLUSTERS unten) -- auf
// ausdruecklichen Wunsch soll das genau so wirken, "als waer ein Button
// ausgelassen": die Luecke, die vor UND nach einer weggelassenen Kachel
// verbleiben wuerde (kleine Luecke + Kachelhoehe + kleine Luecke), siehe
// clusterGapForTileHeight. Wird sowohl vertikal (zwischen Cluster-Bloecken
// innerhalb einer Spalte) als auch horizontal (zwischen den Spalten selbst)
// verwendet, siehe renderMainMenu.
function gapForTileHeight(tileHeight: number): number {
  return tileHeight * GAP_TO_TILE_RATIO;
}
function clusterGapForTileHeight(tileHeight: number): number {
  return tileHeight + 2 * gapForTileHeight(tileHeight);
}

// Seitenverhaeltnis der Kacheln -- muss mit .menu-tile { aspect-ratio: ... }
// in style.css uebereinstimmen. War 2.35 -- auf ausdruecklichen Wunsch
// deutlich flacher ("oben und unten unnoetigen Platz weg"), naeher an den
// eher schmalen Tasten der VBB-Vorlage.
const TILE_ASPECT = 3.3;
// War 620 -- auf grossen Bildschirmen blieb dadurch spuerbar Breite
// ungenutzt (Kacheln stiessen an diese Obergrenze, bevor der verfuegbare
// Platz ausgeschoepft war). Haengt mit REFERENCE_TILE_WIDTH/MAX_SCALE
// unten zusammen: bei 840px ist die Inhaltsskalierung (Schrift/Icon)
// gerade bei ihrem Maximum angekommen.
const MAX_TILE_WIDTH = 840;
const MIN_TILE_WIDTH = 40;
// Querformat (Breite >= Hoehe): immer 3 Spalten -- auf ausdruecklichen
// Wunsch fest beibehalten. Hochformat: keine feste Praeferenz, siehe
// computeGridLayout unten. Eine "Spalte" ist hier NICHT mehr wie fruehers
// eine Reihe von bis zu 3 Kacheln nebeneinander, sondern eine eigene
// Saeule, in der ganze Cluster (ihre Kacheln UNTEREINANDER) uebereinander
// gestapelt werden -- siehe assignClustersToColumns.
const LANDSCAPE_COLS = 3;
const PORTRAIT_MAX_COLS = 3;
// Kachelbreite, bei der Schrift/Icon in style.css ihre "normale" Groesse
// (1.08rem/0.76rem/46px) haben -- der Skalierungsfaktor ist relativ dazu.
const REFERENCE_TILE_WIDTH = 280;
// War 0.5 -- auf sehr kleinen/flachen Bildschirmen (z.B. 800x480, ein
// gaengiges 5"-Kiosk-Display) konnten die Kacheln durch viele Spiele/
// Cluster so schmal werden, dass die per 0.5 nach unten gedeckelte Schrift
// nicht mehr in die Kachel passte -- Titel liefen oben/unten über den
// eigenen (overflow:hidden) Rahmen hinaus (gemeldeter/beobachteter Bug).
// Die Schrift MUSS proportional zur tatsaechlichen Kachelbreite bleiben,
// damit sie auf JEDER Bildschirmgroesse in die Kachel passt -- ein
// zusaetzlicher fixer Deckel widerspricht dem. Der neue, deutlich
// niedrigere Wert ist nur noch eine Notbremse gegen Schriftgroesse 0.
const MIN_SCALE = 0.22;
// War 2.2 -- passend zur neuen MAX_TILE_WIDTH (840 = 280 * 3.0) angehoben,
// damit Schrift/Icon auf sehr grossen Bildschirmen weiter mitwachsen statt
// vorzeitig einzufrieren, waehrend die Kachel selbst noch breiter wird.
const MAX_SCALE = 3.0;

/**
 * Gruppiert thematisch zusammengehoerige Spiele zu "Clustern" (siehe
 * clusterGapForContainer oben) -- auf ausdruecklichen Wunsch, angelehnt an
 * die VBB-Vorlage, wo z. B. alle Tarifkarten-Tasten dicht beieinander
 * stehen, getrennt von den Ausflugs-/Touristen-Tasten durch eine sichtbar
 * groessere Luecke. Reihenfolge INNERHALB eines Clusters UND der Cluster
 * selbst bestimmt die Kachel-Reihenfolge im Menue (ersetzt die vorherige,
 * reine Registrierungsreihenfolge). Ein Spiel, das hier (z. B. weil neu
 * hinzugefuegt) nicht auftaucht, landet automatisch in einem eigenen
 * Cluster ganz am Ende -- verschwindet also nie einfach aus dem Menue,
 * siehe clusterGames().
 */
const TILE_CLUSTERS: string[][] = [
  // Reaktionsspiele: rechtzeitig den richtigen Moment treffen.
  ["count-passengers", "train-photo", "train-spotter"],
  // Sammeln/Vergleichen mit Karten bzw. Gedaechtnis.
  ["memory", "train-quartet", "setlist"],
  // Gluecks-/Kurzentscheidungsspiele.
  ["hopper-slots", "switch-run"],
  // Streckennetz-/Aufbauspiele.
  ["train-sim", "connection-puzzle", "mini-metro"],
  // Auf ausdruecklichen Wunsch bewusst ein eigener, abseits stehender
  // Cluster fuer sich allein (kein Spiel im eigentlichen Sinn, sondern das
  // freie Sound-Bastel-Tool).
  ["dj-mixer"],
];

function clusterGames(games: GameMeta[]): GameMeta[][] {
  const byId = new Map(games.map((g) => [g.id, g] as const));
  const used = new Set<string>();
  const clusters: GameMeta[][] = [];
  for (const ids of TILE_CLUSTERS) {
    const cluster: GameMeta[] = [];
    for (const id of ids) {
      const game = byId.get(id);
      if (game) {
        cluster.push(game);
        used.add(id);
      }
    }
    if (cluster.length > 0) clusters.push(cluster);
  }
  const leftover = games.filter((g) => !used.has(g.id));
  if (leftover.length > 0) clusters.push(leftover);
  return clusters;
}

/**
 * Verteilt ganze Cluster (nie einzelne Kacheln eines Clusters getrennt
 * voneinander) auf `cols` Saeulen -- immer die Saeule mit aktuell den
 * wenigsten Kacheln bekommt den naechsten Cluster ("Longest Processing
 * Time"-artiges Greedy-Bin-Packing). Dadurch werden die Saeulen ohne feste
 * Zuordnung automatisch ausbalanciert: ein Cluster steht immer komplett
 * UNTEREINANDER in einer Saeule, und passt noch ein weiterer Cluster
 * darunter, landet er (mit dem groesseren Zwischen-Cluster-Abstand) in
 * derselben Saeule, siehe renderMainMenu.
 */
function assignClustersToColumns(clusters: GameMeta[][], cols: number): GameMeta[][][] {
  const columns: GameMeta[][][] = Array.from({ length: cols }, () => []);
  const columnSizes = new Array(cols).fill(0);
  for (const cluster of clusters) {
    let target = 0;
    for (let i = 1; i < cols; i++) {
      if (columnSizes[i] < columnSizes[target]) target = i;
    }
    columns[target].push(cluster);
    columnSizes[target] += cluster.length;
  }
  return columns;
}

export interface MainMenuResult {
  element: HTMLElement;
  /** Muss beim Verlassen des Menues aufgerufen werden (stoppt den ResizeObserver). */
  destroy: () => void;
}

interface ColumnsLayout {
  cols: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  clusterGap: number;
  columns: GameMeta[][][];
}

/**
 * Kachelhoehe (Breite UND Hoehe daraus im festen TILE_ASPECT), fuer die ALLE
 * Saeulen (inkl. der zwischen-cluster-Abstaende darin) garantiert ohne
 * Scrollen in containerHeight passen (auf ausdruecklichen Wunsch -- das
 * Hauptmenue darf nie scrollbar sein) UND die (horizontal per Saeulen-
 * Abstand) in containerWidth passen. Die Abstaende selbst haengen wiederum
 * von der Kachelhoehe ab (siehe gapForTileHeight/clusterGapForTileHeight) --
 * das wird per einfacher Fixpunkt-Iteration aufgeloest: beide Schranken
 * (aus Breite bzw. Hoehe berechnet) sind monoton fallend in der Kachelhoehe,
 * ein paar Iterationen genuegen zur Konvergenz.
 */
function solveTileHeight(containerWidth: number, containerHeight: number, columns: GameMeta[][][], cols: number): number {
  let tileHeight = MAX_TILE_WIDTH / TILE_ASPECT;
  for (let i = 0; i < 8; i++) {
    const gap = gapForTileHeight(tileHeight);
    const clusterGap = clusterGapForTileHeight(tileHeight);

    const rawWidthTileWidth = (containerWidth - clusterGap * (cols - 1)) / cols;
    const widthTileWidth = Math.max(MIN_TILE_WIDTH, Math.min(rawWidthTileWidth, MAX_TILE_WIDTH));
    const widthTileHeight = widthTileWidth / TILE_ASPECT;

    let heightTileHeight = Infinity;
    for (const column of columns) {
      if (column.length === 0) continue;
      const rows = column.reduce((sum, cluster) => sum + cluster.length, 0);
      const smallGapCount = column.reduce((sum, cluster) => sum + Math.max(0, cluster.length - 1), 0);
      const largeGapCount = Math.max(0, column.length - 1);
      const totalGapHeight = smallGapCount * gap + largeGapCount * clusterGap;
      const heightForTiles = Math.max(rows, containerHeight - totalGapHeight);
      heightTileHeight = Math.min(heightTileHeight, heightForTiles / rows);
    }

    tileHeight = Math.max(1, Math.min(widthTileHeight, heightTileHeight));
  }
  return tileHeight;
}

function fitColumnsLayout(containerWidth: number, containerHeight: number, clusters: GameMeta[][], cols: number): ColumnsLayout {
  const c = Math.max(1, Math.min(cols, clusters.length));
  const columns = assignClustersToColumns(clusters, c);

  const solvedTileHeight = solveTileHeight(containerWidth, containerHeight, columns, c);
  const gap = gapForTileHeight(solvedTileHeight);
  const clusterGap = clusterGapForTileHeight(solvedTileHeight);

  const tileHeight = Math.max(1, Math.floor(solvedTileHeight));
  const rawWidthTileWidth = (containerWidth - clusterGap * (c - 1)) / c;
  const widthTileWidth = Math.max(MIN_TILE_WIDTH, Math.min(rawWidthTileWidth, MAX_TILE_WIDTH));
  const tileWidth = Math.max(MIN_TILE_WIDTH, Math.min(widthTileWidth, Math.floor(tileHeight * TILE_ASPECT)));
  return { cols: c, tileWidth, tileHeight, gap, clusterGap, columns };
}

function computeGridLayout(containerWidth: number, containerHeight: number, clusters: GameMeta[][]): ColumnsLayout {
  const isPortrait = containerHeight > containerWidth;

  if (!isPortrait) {
    const cols = Math.min(LANDSCAPE_COLS, Math.max(1, clusters.length));
    return fitColumnsLayout(containerWidth, containerHeight, clusters, cols);
  }

  // Hochformat: probiert 1..PORTRAIT_MAX_COLS Saeulen durch und waehlt die
  // Variante mit der groessten resultierenden Kachelhoehe (= beste
  // Lesbarkeit).
  let best = fitColumnsLayout(containerWidth, containerHeight, clusters, 1);
  for (let cols = 2; cols <= Math.min(PORTRAIT_MAX_COLS, clusters.length); cols++) {
    const candidate = fitColumnsLayout(containerWidth, containerHeight, clusters, cols);
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

  const clusters = clusterGames(games);

  const grid = document.createElement("div");
  grid.className = "menu-grid";
  card.appendChild(grid);
  screen.appendChild(card);

  function makeTile(game: GameMeta): HTMLButtonElement {
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
    return tile;
  }

  // Die Saeulen-Einteilung (welcher Cluster in welcher Saeule landet) haengt
  // von der aktuellen Spaltenzahl ab (siehe assignClustersToColumns) -- die
  // aendert sich je nach verfuegbarer Breite/Hoehe (Hoch-/Querformat,
  // Fenstergroesse). Das DOM wird deshalb nur bei einer AENDERUNG der
  // Spaltenzahl neu aufgebaut, Kachelgroessen selbst werden bei jedem
  // ResizeObserver-Callback nur per Inline-Style aktualisiert (kein
  // Neuaufbau noetig).
  let builtCols = -1;
  let tileEls: HTMLButtonElement[] = [];

  const buildColumns = (cols: number) => {
    grid.innerHTML = "";
    tileEls = [];
    const columns = assignClustersToColumns(clusters, cols);
    for (const column of columns) {
      const columnEl = document.createElement("div");
      columnEl.className = "menu-column";
      for (const cluster of column) {
        const clusterEl = document.createElement("div");
        clusterEl.className = "menu-cluster";
        for (const game of cluster) {
          const tile = makeTile(game);
          clusterEl.appendChild(tile);
          tileEls.push(tile);
        }
        columnEl.appendChild(clusterEl);
      }
      grid.appendChild(columnEl);
    }
    builtCols = cols;
  };

  const applyLayout = () => {
    // clientWidth/-Height statt getBoundingClientRect(): schliesst Rundungs-
    // Unschaerfe bei Border/Padding korrekt aus.
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    if (width < 1 || height < 1 || games.length === 0) return;
    const { cols, tileWidth, tileHeight, gap, clusterGap } = computeGridLayout(width, height, clusters);
    if (cols !== builtCols) buildColumns(cols);

    // Aeussere Saeulen nebeneinander UND die Cluster-Bloecke innerhalb einer
    // Saeule bekommen denselben, groesseren Abstand -- die einzelnen Kacheln
    // innerhalb eines Clusters den kleineren. Auf ausdruecklichen Wunsch darf
    // das Hauptmenue dabei NIE scrollbar sein, siehe fitColumnsLayout oben.
    grid.style.gap = `${Math.round(clusterGap)}px`;
    for (const columnEl of Array.from(grid.children) as HTMLDivElement[]) {
      columnEl.style.gap = `${Math.round(clusterGap)}px`;
      for (const clusterEl of Array.from(columnEl.children) as HTMLDivElement[]) {
        clusterEl.style.gap = `${Math.round(gap)}px`;
      }
    }
    for (const tile of tileEls) {
      tile.style.width = `${tileWidth}px`;
      tile.style.height = `${tileHeight}px`;
    }
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
