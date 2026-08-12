import { gameRegistry } from "../games/registry";
import type { GameMeta } from "../games/registry";
import { getHighscoreBoard } from "../core/storage";
import { getTicketMethods, getDailyBestBoard, type DailyBestEntry } from "../core/ticketMethods";

function formatAchievedAt(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}. · ${hh}:${min}`;
}

type BoardMode = "all" | "daily";

// ------------------------------------------------- Tetris-artige Saeulen-Verteilung
//
// Die Spiele haben SEHR unterschiedlich viele Highscore-Kategorien (die
// meisten nur 1, aber z. B. Zugfoto/Passagiere zaehlen je 10 -- eine pro
// Geschwindigkeitsstufe -- und Memory 6 -- je Brettgroesse). Auf
// ausdruecklichen Wunsch soll die Seite trotzdem IMMER ohne Scrollen
// auskommen, den verfuegbaren Platz gut ausnutzen und keine einzelne
// Spiel-Kachel hoeher als die Seite werden lassen. Dafuer werden die Spiele
// -- analog zu den Kachel-Clustern im Hauptmenue, siehe MainMenu.ts#
// assignClustersToColumns -- per Greedy-Bin-Packing auf Saeulen verteilt
// (groesste Spiele zuerst, landen immer in der aktuell "leichtesten"
// Saeule), und die Zeilen-Einheit (UNIT) wird pro Bildschirmgroesse/-inhalt
// so gross gewaehlt, wie es gerade noch in die verfuegbare Hoehe passt --
// dieselbe Fixpunkt-Idee wie solveTileHeight dort, nur mit variablem
// Gewicht je Spiel statt gleich grosser Kacheln.
const TITLE_WEIGHT = 1.15;
const ROW_WEIGHT = 2.1;
const GAME_GAP_WEIGHT = 0.55;
// UNIT-Wert, bei dem Schrift/Abstaende ihre "normale" Groesse erreichen --
// der tatsaechliche UNIT-Wert wird live aus verfuegbarer Breite/Hoehe und
// der Spielmenge berechnet (siehe computeLayout), der Skalierungsfaktor
// (--hb-scale) daraus abgeleitet.
const REFERENCE_UNIT = 30;
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.7;
const MIN_COL_WIDTH = 190;
const MAX_COLS = 6;
const COL_GAP = 14;

function gameWeight(game: GameMeta): number {
  return TITLE_WEIGHT + (game.highscoreCategories?.length ?? 0) * ROW_WEIGHT;
}

/** Groesste Spiele zuerst, jedes landet in der Saeule mit aktuell dem geringsten Gesamtgewicht ("Longest Processing Time"-Bin-Packing). Reihenfolge der Spiele auf der Seite folgt dadurch bewusst NICHT mehr der Registrierungsreihenfolge -- fuer eine reine Uebersichtsseite ohne inhaltliche Notwendigkeit einer festen Reihenfolge unproblematisch. */
function assignGamesToColumns(games: GameMeta[], cols: number): GameMeta[][] {
  const sorted = [...games].sort((a, b) => gameWeight(b) - gameWeight(a));
  const columns: GameMeta[][] = Array.from({ length: cols }, () => []);
  const columnWeights = new Array(cols).fill(0);
  for (const game of sorted) {
    let target = 0;
    for (let i = 1; i < cols; i++) {
      if (columnWeights[i] < columnWeights[target]) target = i;
    }
    columns[target].push(game);
    columnWeights[target] += gameWeight(game);
  }
  return columns;
}

function columnWeight(column: GameMeta[]): number {
  if (column.length === 0) return 0;
  return column.reduce((sum, g) => sum + gameWeight(g), 0) + GAME_GAP_WEIGHT * (column.length - 1);
}

interface BoardLayout {
  cols: number;
  /** Saeulenbreite als Prozentsatz der verfuegbaren Breite (siehe Datei-Kommentar oben: soll responsiv per Prozentangabe statt fester Pixelbreite arbeiten). */
  colWidthPercent: number;
  unit: number;
  scale: number;
  columns: GameMeta[][];
}

/** Probiert 1..MAX_COLS Saeulen durch und waehlt die Variante mit der groessten resultierenden Zeilen-Einheit (UNIT) -- analog zu MainMenu.ts#computeGridLayout/fitColumnsLayout, hier mit variablem Gewicht je Spiel statt gleich grosser Kacheln. Faellt eine Spaltenzahl unter MIN_COL_WIDTH, werden keine weiteren (noch schmaleren) Spalten mehr probiert. */
function computeLayout(containerWidth: number, containerHeight: number, games: GameMeta[]): BoardLayout {
  const maxCols = Math.max(1, Math.min(MAX_COLS, games.length));
  let best: { cols: number; colWidthPercent: number; unit: number; columns: GameMeta[][] } | null = null;
  for (let cols = 1; cols <= maxCols; cols++) {
    const colWidthPx = (containerWidth - COL_GAP * (cols - 1)) / cols;
    if (cols > 1 && colWidthPx < MIN_COL_WIDTH) break;
    const columns = assignGamesToColumns(games, cols);
    const maxWeight = Math.max(...columns.map(columnWeight), 0.001);
    const unit = containerHeight / maxWeight;
    if (!best || unit > best.unit) {
      best = { cols, colWidthPercent: (colWidthPx / containerWidth) * 100, unit, columns };
    }
  }
  const chosen = best ?? { cols: 1, colWidthPercent: 100, unit: containerHeight, columns: [games] };
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, chosen.unit / REFERENCE_UNIT));
  return { ...chosen, scale };
}

export interface HighscoreBoardResult {
  element: HTMLElement;
  /** Muss beim Verlassen des Boards aufgerufen werden (stoppt den ResizeObserver, analog zu MainMenu.ts#MainMenuResult). */
  destroy: () => void;
}

/**
 * Statische Uebersichtsseite ueber alle Highscores jedes Spiels (inkl.
 * Varianten wie Spielfeldgroesse oder Geschwindigkeitsstufe). Rein lesend,
 * kein Canvas/GameLoop noetig.
 *
 * Zweiter Modus "Tagesbestenliste" (nur sichtbar, wenn dieser Ticket-
 * Verdienstweg im Admin-Panel aktiviert ist, siehe core/ticketMethods.ts)
 * -- eigener Umschalt-Button oben, zeigt statt der Allzeit-Bestwerte die
 * seit dem letzten 6-Uhr-Reset erspielten Tagesbestwerte.
 *
 * onPlay: fuer den "Jetzt spielen"-Button je Schwierigkeitsstufe/Variante
 * (siehe renderGameCard unten) -- startet auf ausdruecklichen Wunsch direkt
 * GENAU dieses Spiel in GENAU dieser Variante (board), statt nur ins
 * Hauptmenue zu fuehren. board entspricht dabei 1:1 GameEnv#initialBoard,
 * das einzelne Spiele mit mehreren Varianten (z. B. Geschwindigkeitsstufen)
 * auswerten koennen, um ihre eigene Auswahl zu ueberspringen.
 */
export function renderHighscoreBoard(onPlay: (gameId: string, board: string) => void): HighscoreBoardResult {
  const screen = document.createElement("div");
  screen.className = "menu-screen";

  const card = document.createElement("div");
  card.className = "menu-card";

  const header = document.createElement("div");
  header.className = "menu-header";
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.flexWrap = "wrap";
  header.style.gap = "10px";
  const h1 = document.createElement("h1");
  h1.textContent = "Highscores";
  header.appendChild(h1);
  card.appendChild(header);

  const board = document.createElement("div");
  board.className = "highscore-board";
  card.appendChild(board);

  const gamesWithScores = gameRegistry.filter((g) => g.highscoreCategories && g.highscoreCategories.length > 0);
  let mode: BoardMode = "all";

  // Umschalt-Button nur, wenn der Tagesbestenliste-Weg ueberhaupt aktiviert
  // ist (siehe Admin-Panel, Abschnitt "Ticket-Verdienstwege") -- sonst gibt
  // es schlicht keine Tagesbestwerte zu zeigen.
  if (getTicketMethods().dailyBoard) {
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn--ghost";
    toggleBtn.style.fontSize = "0.82rem";
    const setToggleLabel = () => {
      toggleBtn.textContent = mode === "all" ? "🗓️ Tagesbestenliste anzeigen" : "🏆 Allzeit-Highscores anzeigen";
    };
    setToggleLabel();
    toggleBtn.addEventListener("click", () => {
      mode = mode === "all" ? "daily" : "all";
      setToggleLabel();
      h1.textContent = mode === "all" ? "Highscores" : "Tagesbestenliste";
      refreshMode();
    });
    header.appendChild(toggleBtn);
  }

  /** Baut die komplette Karte (Titel + alle Kategorie-Zeilen) EINES Spiels fuer den aktuellen `mode` neu auf -- unabhaengig von der Saeulen-Aufteilung, damit ein Moduswechsel (siehe refreshMode) nicht jedesmal die komplette Saeulen-Geometrie neu berechnen muss. */
  function renderGameCard(game: GameMeta): HTMLElement {
    const section = document.createElement("div");
    section.className = "highscore-board__game";

    const title = document.createElement("div");
    title.className = "highscore-board__game-title";
    title.style.setProperty("--tile-accent", game.accent);
    title.textContent = game.title;
    section.appendChild(title);

    for (const category of game.highscoreCategories!) {
      const row = document.createElement("div");
      row.className = "highscore-board__row";

      // Label + Bestwerte bleiben eine eigene Unterzeile (nebeneinander) --
      // der "Jetzt spielen"-Button kommt auf ausdruecklichen Wunsch IMMER in
      // eine eigene, neue Zeile DARUNTER (waechst dadurch in die Hoehe statt
      // in die Breite), statt sich die Zeile mit Label/Werten zu teilen.
      const mainRow = document.createElement("div");
      mainRow.className = "highscore-board__row-main";
      row.appendChild(mainRow);

      const label = document.createElement("span");
      label.className = "highscore-board__label";
      label.textContent = category.label;
      mainRow.appendChild(label);

      const boardData = mode === "all" ? getHighscoreBoard(game.id, category.board) : getDailyBestBoard(game.id, category.board);

      if (boardData && boardData.entries.length > 0) {
        const valueWrap = document.createElement("span");
        valueWrap.className = "highscore-board__values";
        // Bei Gleichstand stehen alle Halter des Bestwerts einzeln
        // untereinander, statt zu einer einzigen Zeile zusammengefasst zu
        // werden -- so ist auf einen Blick klar, wer sich den Highscore
        // teilt.
        for (const entry of boardData.entries) {
          const value = document.createElement("span");
          value.className = "highscore-board__value";
          // Wert+Einheit und Name je in einer eigenen "white-space:
          // nowrap"-Spanne (siehe style.css) -- verhindert, dass bei wenig
          // Platz (z. B. sehr lange Namen) MITTEN im Wert ("5 Karten") oder
          // MITTEN im Namen umgebrochen wird. Faellt der Inhalt insgesamt zu
          // breit aus, bricht die Zeile stattdessen sauber ZWISCHEN Wert und
          // Namen um (der "—" bleibt dabei beim Namen, wirkt dadurch wie ein
          // Aufzaehlungspunkt vor der zweiten Zeile).
          const timeLine = "achievedAt" in entry ? `<span class="highscore-board__value-time">${formatAchievedAt((entry as { achievedAt: string }).achievedAt)}</span>` : "";
          value.innerHTML = `
            <span class="highscore-board__value-main"><span class="highscore-board__value-num"><strong>${category.formatValue(boardData.value)}</strong></span> <span class="highscore-board__value-name">— ${(entry as DailyBestEntry).name}</span></span>
            ${timeLine}
          `;
          valueWrap.appendChild(value);
        }
        mainRow.appendChild(valueWrap);
      } else {
        const value = document.createElement("span");
        value.className = "highscore-board__value highscore-board__value--empty";
        value.textContent = mode === "all" ? "Noch kein Highscore" : "Heute noch kein Versuch";
        mainRow.appendChild(value);
      }

      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn--ghost highscore-board__play-btn";
      playBtn.textContent = "▶ Jetzt spielen";
      playBtn.addEventListener("click", () => onPlay(game.id, category.board));
      row.appendChild(playBtn);

      section.appendChild(row);
    }

    return section;
  }

  let builtCols = -1;
  let gameEls = new Map<string, HTMLElement>();

  function buildColumns(layout: BoardLayout): void {
    board.innerHTML = "";
    gameEls = new Map();
    for (const column of layout.columns) {
      const columnEl = document.createElement("div");
      columnEl.className = "highscore-board__column";
      columnEl.style.width = `${layout.colWidthPercent}%`;
      for (const game of column) {
        const gameEl = renderGameCard(game);
        columnEl.appendChild(gameEl);
        gameEls.set(game.id, gameEl);
      }
      board.appendChild(columnEl);
    }
    builtCols = layout.cols;
  }

  /** Ersetzt nur den INHALT jeder bereits platzierten Spiel-Karte (siehe buildColumns) -- fuer den Umschalt-Button Allzeit/Tagesbestenliste, der die Saeulen-Geometrie nicht veraendert (jedes Spiel behaelt exakt so viele Kategorie-Zeilen wie zuvor). */
  function refreshMode(): void {
    for (const game of gamesWithScores) {
      const oldEl = gameEls.get(game.id);
      if (!oldEl) continue;
      const newEl = renderGameCard(game);
      oldEl.replaceWith(newEl);
      gameEls.set(game.id, newEl);
    }
  }

  const applyLayout = () => {
    // clientWidth/-Height statt getBoundingClientRect(): schliesst Rundungs-
    // Unschaerfe bei Border/Padding korrekt aus (siehe MainMenu.ts#applyLayout).
    const width = board.clientWidth;
    const height = board.clientHeight;
    if (width < 1 || height < 1 || gamesWithScores.length === 0) return;
    const layout = computeLayout(width, height, gamesWithScores);

    if (layout.cols !== builtCols) {
      buildColumns(layout);
    } else {
      // Spaltenzahl unveraendert -- Saeulenzuteilung ist eine reine Funktion
      // von Spielmenge+Spaltenzahl (beide unveraendert), nur Breiten/
      // Abstaende/Skalierung muessen aktualisiert werden, kein DOM-Neuaufbau
      // noetig.
      for (const columnEl of Array.from(board.children) as HTMLDivElement[]) {
        columnEl.style.width = `${layout.colWidthPercent}%`;
      }
    }

    board.style.gap = `${COL_GAP}px`;
    const gameGapPx = Math.round(GAME_GAP_WEIGHT * layout.unit);
    for (const columnEl of Array.from(board.children) as HTMLDivElement[]) {
      columnEl.style.gap = `${gameGapPx}px`;
    }
    board.style.setProperty("--hb-scale", String(layout.scale));
  };

  const resizeObserver = new ResizeObserver(applyLayout);
  resizeObserver.observe(board);

  screen.appendChild(card);
  return {
    element: screen,
    destroy: () => resizeObserver.disconnect(),
  };
}
