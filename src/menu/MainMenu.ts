import { icons } from "../core/icons";
import { openFeedbackDialog } from "../core/feedbackPrompt";
import type { GameMeta } from "../games/registry";

/**
 * Rendert das Hauptmenue (reines DOM/CSS, kein Canvas -- die Kacheln sind
 * grosse Touch-Ziele, das laesst sich mit HTML/CSS einfacher und zugaenglicher
 * bauen als mit manuellem Canvas-Hit-Testing).
 */
export function renderMainMenu(games: GameMeta[], onSelect: (id: string) => void): HTMLElement {
  const screen = document.createElement("div");
  screen.className = "menu-screen";

  const header = document.createElement("div");
  header.className = "menu-header";
  header.innerHTML = `
    <span class="menu-header__brand-text">Fahrschein &amp; Freizeit — Automat Nr. 7</span>
    <h1>Neiphos Ticket Machine</h1>
    <p>Spiel auswählen und antippen</p>
  `;
  screen.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "menu-grid";

  for (const game of games) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "menu-tile";
    tile.style.setProperty("--tile-accent", game.accent);
    tile.innerHTML = `
      <span class="menu-tile__icon">${icons[game.icon]}</span>
      <span class="menu-tile__title">${game.title}</span>
      <span class="menu-tile__subtitle">${game.subtitle}</span>
    `;
    tile.addEventListener("click", () => onSelect(game.id));
    grid.appendChild(tile);
  }

  screen.appendChild(grid);

  const feedbackBtn = document.createElement("button");
  feedbackBtn.type = "button";
  feedbackBtn.className = "menu-feedback-btn";
  feedbackBtn.innerHTML = `<span class="menu-feedback-btn__icon">${icons.feedback}</span><span>Feedback geben</span>`;
  feedbackBtn.addEventListener("click", () => openFeedbackDialog());
  screen.appendChild(feedbackBtn);

  const footer = document.createElement("div");
  footer.className = "menu-footer";
  footer.innerHTML = `<span>präsentiert von</span> <strong>DJ Flipper</strong>`;
  screen.appendChild(footer);

  return screen;
}
