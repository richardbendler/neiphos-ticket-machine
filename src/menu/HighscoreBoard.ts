import { gameRegistry } from "../games/registry";
import { getHighscoreBoard } from "../core/storage";

/**
 * Statische Uebersichtsseite ueber alle Highscores jedes Spiels (inkl.
 * Varianten wie Spielfeldgroesse oder Geschwindigkeitsstufe). Rein lesend,
 * kein Canvas/GameLoop noetig -- reguliert sich also selbst ueber normales
 * DOM-Scrolling wie das Hauptmenue.
 */
export function renderHighscoreBoard(): HTMLElement {
  const screen = document.createElement("div");
  screen.className = "menu-screen";

  const card = document.createElement("div");
  card.className = "menu-card";

  const header = document.createElement("div");
  header.className = "menu-header";
  header.innerHTML = `<h1>Highscores</h1>`;
  card.appendChild(header);

  const list = document.createElement("div");
  list.className = "highscore-board";

  const gamesWithScores = gameRegistry.filter((g) => g.highscoreCategories && g.highscoreCategories.length > 0);

  for (const game of gamesWithScores) {
    const section = document.createElement("div");
    section.className = "highscore-board__game";

    const title = document.createElement("div");
    title.className = "highscore-board__game-title";
    title.style.setProperty("--tile-accent", game.accent);
    title.textContent = game.title;
    section.appendChild(title);

    for (const category of game.highscoreCategories!) {
      const board = getHighscoreBoard(game.id, category.board);

      const row = document.createElement("div");
      row.className = "highscore-board__row";

      const label = document.createElement("span");
      label.className = "highscore-board__label";
      label.textContent = category.label;
      row.appendChild(label);

      if (board && board.entries.length > 0) {
        const valueWrap = document.createElement("span");
        valueWrap.className = "highscore-board__values";
        // Bei Gleichstand stehen alle Halter des Bestwerts einzeln
        // untereinander, statt zu einer einzigen Zeile zusammengefasst zu
        // werden -- so ist auf einen Blick klar, wer sich den Highscore
        // teilt.
        for (const entry of board.entries) {
          const value = document.createElement("span");
          value.className = "highscore-board__value";
          value.innerHTML = `<strong>${category.formatValue(board.value)}</strong> — ${entry.name}`;
          valueWrap.appendChild(value);
        }
        row.appendChild(valueWrap);
      } else {
        const value = document.createElement("span");
        value.className = "highscore-board__value highscore-board__value--empty";
        value.textContent = "Noch kein Highscore";
        row.appendChild(value);
      }

      section.appendChild(row);
    }

    list.appendChild(section);
  }

  card.appendChild(list);
  screen.appendChild(card);
  return screen;
}
