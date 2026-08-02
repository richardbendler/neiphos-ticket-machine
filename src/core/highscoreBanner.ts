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
        <span class="stage-highscore-banner__label">Bestwert</span>
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
