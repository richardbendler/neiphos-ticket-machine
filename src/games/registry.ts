import type { MinigameModule } from "../core/Game";
import type { IconName } from "../core/icons";
import type { HighscoreDirection } from "../core/storage";

export interface HighscoreCategory {
  /** Highscore-"board"-Schluessel, siehe core/storage.ts (z. B. Spielfeldgroesse oder Geschwindigkeitsstufe). "default" fuer Spiele ohne Varianten. */
  board: string;
  /** Anzeigename der Variante, z. B. "4 × 4" oder "60 km/h". */
  label: string;
  direction: HighscoreDirection;
  formatValue: (value: number) => string;
}

export interface GameMeta {
  id: string;
  title: string;
  subtitle: string;
  /** Kurzer Zusatzhinweis auf der Menu-Kachel, separat von der Beschreibung in eigener Schriftart dargestellt (z. B. "auch mit Hüpftieren spielbar"). */
  note?: string;
  /** Zeigt ein gelbes "Neu"-Badge neben dem Titel der Menu-Kachel -- fuer frisch hinzugefuegte Spiele, von Hand wieder zu entfernen, sobald das Spiel nicht mehr neu ist. */
  isNew?: boolean;
  icon: IconName;
  /** Kurzcode fuer das Farb-Badge der Menu-Kachel (2 Grossbuchstaben, angelehnt an die Zonen-Schilder "AB"/"BC" echter Fahrkartenautomaten). */
  badge: string;
  /** Akzentfarbe der Menu-Kachel (CSS-Farbwert). */
  accent: string;
  /**
   * Factory statt Singleton -- jedes Spiel bekommt bei jedem Start eine
   * frische Instanz ohne Altzustand. Darf ein Promise liefern: die meisten
   * Spiele laden ihre (teils sehr umfangreiche) Implementierung erst per
   * dynamischem import() nach, wenn sie wirklich geoeffnet werden (siehe
   * games/index.ts) -- nur die hier auf dieser Seite stehenden, leichten
   * Metadaten sind von Anfang an geladen (fuers Hauptmenue).
   */
  create: () => MinigameModule | Promise<MinigameModule>;
  /** Fuer das globale Highscore-Board (Hauptmenue): leer/weggelassen bei Spielen ohne Highscore (z. B. Zug-Quartett, DJ-Mischer). */
  highscoreCategories?: HighscoreCategory[];
}

/**
 * Zentrale Spiele-Registry. Ein neues Minigame anzudocken heisst: Modul unter
 * src/games/<name>/ anlegen, das MinigameModule implementiert, und hier einen
 * Eintrag ergaenzen. Menue und Router lesen ausschliesslich aus dieser Liste.
 */
export const gameRegistry: GameMeta[] = [];

export function registerGame(meta: GameMeta): void {
  gameRegistry.push(meta);
}
