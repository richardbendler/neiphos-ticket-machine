import type { MinigameModule } from "../core/Game";
import type { IconName } from "../core/icons";

export interface GameMeta {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  /** Akzentfarbe der Menu-Kachel (CSS-Farbwert). */
  accent: string;
  /** Factory statt Singleton -- jedes Spiel bekommt bei jedem Start eine frische Instanz ohne Altzustand. */
  create: () => MinigameModule;
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
