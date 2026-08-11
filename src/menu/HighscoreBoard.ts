import { gameRegistry } from "../games/registry";
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

/**
 * Statische Uebersichtsseite ueber alle Highscores jedes Spiels (inkl.
 * Varianten wie Spielfeldgroesse oder Geschwindigkeitsstufe). Rein lesend,
 * kein Canvas/GameLoop noetig -- reguliert sich also selbst ueber normales
 * DOM-Scrolling wie das Hauptmenue.
 *
 * Zweiter Modus "Tagesbestenliste" (nur sichtbar, wenn dieser Ticket-
 * Verdienstweg im Admin-Panel aktiviert ist, siehe core/ticketMethods.ts)
 * -- eigener Umschalt-Button oben, zeigt statt der Allzeit-Bestwerte die
 * seit dem letzten 6-Uhr-Reset erspielten Tagesbestwerte.
 *
 * onPlay: fuer den "Jetzt spielen"-Button je Schwierigkeitsstufe/Variante
 * (siehe renderList unten) -- startet auf ausdruecklichen Wunsch direkt
 * GENAU dieses Spiel in GENAU dieser Variante (board), statt nur ins
 * Hauptmenue zu fuehren. board entspricht dabei 1:1 GameEnv#initialBoard,
 * das einzelne Spiele mit mehreren Varianten (z. B. Geschwindigkeitsstufen)
 * auswerten koennen, um ihre eigene Auswahl zu ueberspringen.
 */
export function renderHighscoreBoard(onPlay: (gameId: string, board: string) => void): HTMLElement {
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

  const list = document.createElement("div");
  list.className = "highscore-board";
  card.appendChild(list);

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
      renderList();
    });
    header.appendChild(toggleBtn);
  }

  function renderList(): void {
    list.innerHTML = "";
    for (const game of gamesWithScores) {
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

        // Label + Bestwerte bleiben eine eigene Unterzeile (bisheriges
        // Layout, nebeneinander) -- der "Jetzt spielen"-Button kommt auf
        // ausdruecklichen Wunsch IMMER in eine eigene, neue Zeile DARUNTER
        // (waechst dadurch in die Hoehe statt in die Breite), statt sich
        // die Zeile mit Label/Werten zu teilen.
        const mainRow = document.createElement("div");
        mainRow.className = "highscore-board__row-main";
        row.appendChild(mainRow);

        const label = document.createElement("span");
        label.className = "highscore-board__label";
        label.textContent = category.label;
        mainRow.appendChild(label);

        const board = mode === "all" ? getHighscoreBoard(game.id, category.board) : getDailyBestBoard(game.id, category.board);

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
            // Wert+Einheit und Name je in einer eigenen "white-space:
            // nowrap"-Spanne (siehe style.css) -- verhindert, dass bei wenig
            // Platz (z. B. sehr lange Namen) MITTEN im Wert ("5 Karten")
            // oder MITTEN im Namen umgebrochen wird. Faellt der Inhalt
            // insgesamt zu breit aus, bricht die Zeile stattdessen sauber
            // ZWISCHEN Wert und Namen um (der "—" bleibt dabei beim Namen,
            // wirkt dadurch wie ein Aufzaehlungspunkt vor der zweiten Zeile).
            const timeLine = "achievedAt" in entry ? `<span class="highscore-board__value-time">${formatAchievedAt((entry as { achievedAt: string }).achievedAt)}</span>` : "";
            value.innerHTML = `
              <span class="highscore-board__value-main"><span class="highscore-board__value-num"><strong>${category.formatValue(board.value)}</strong></span> <span class="highscore-board__value-name">— ${(entry as DailyBestEntry).name}</span></span>
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

      list.appendChild(section);
    }
  }
  renderList();

  screen.appendChild(card);
  return screen;
}
