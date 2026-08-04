import type { HighscoreBoard, HighscoreEntry } from "./storage";

export interface HighscoreBannerHandle {
  /** Aktualisiert die Anzeige; board=null blendet die Anzeige komplett aus. */
  update: (board: HighscoreBoard | null) => void;
  destroy: () => void;
}

function formatNames(entries: HighscoreEntry[]): string {
  const names = entries.map((e) => e.name);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
}

/**
 * Kleine, dauerhaft sichtbare Anzeige des aktuellen Bestwerts, mittig direkt
 * unter der Kopfleiste -- ersetzt die fruehere Erwaehnung des Highscores in
 * der Spiel-Anleitung (siehe core/gameIntro.ts), die beim naechsten Blick
 * schon wieder verschwunden war.
 */
export function mountHighscoreBanner(container: HTMLElement, formatValue: (value: number) => string): HighscoreBannerHandle {
  const el = document.createElement("div");
  el.className = "stage-highscore-banner";
  el.style.display = "none";
  container.appendChild(el);

  function update(board: HighscoreBoard | null): void {
    if (!board || board.entries.length === 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    el.innerHTML = `
      <span class="stage-highscore-banner__pill">
        <span class="stage-highscore-banner__label">Highscore</span>
        <span class="stage-highscore-banner__value">${formatValue(board.value)}</span>
        <span class="stage-highscore-banner__names">${formatNames(board.entries)}</span>
      </span>
    `;
  }

  return {
    update,
    destroy: () => el.remove(),
  };
}

/**
 * Misst, wo unterhalb der Kopfleiste (und eines ggf. gerade sichtbaren
 * Highscore-Banners) tatsaechlich Platz fuer Spielinhalt beginnt --
 * per getBoundingClientRect(), NICHT ueber einen geschaetzten/fest
 * verdrahteten Pixel-Wert. Ein geschaetzter Wert reichte auf manchen
 * Bildschirmen/Aufloesungen nicht aus, sobald der Banner wirklich Inhalt
 * zeigt, und ueberlappte dann sichtbar mit dem Spielfeld/den Kartentexten
 * (in mehreren Spielen unabhaengig voneinander gemeldeter Bug, siehe
 * games/memory/index.ts und games/train-quartet/index.ts). Am besten direkt
 * NACH einem highscoreBanner.update()-Aufruf verwenden, wenn dessen
 * Sichtbarkeit/Inhalt schon feststeht.
 */
export function measurePlayAreaTop(): number {
  const header = document.querySelector(".chrome-bar");
  const headerBottom = header ? header.getBoundingClientRect().bottom : 60;
  const banner = document.querySelector(".stage-highscore-banner");
  if (banner && getComputedStyle(banner).display !== "none") {
    return banner.getBoundingClientRect().bottom;
  }
  return headerBottom + 8;
}
