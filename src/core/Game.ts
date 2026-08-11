/**
 * Gemeinsames Interface, das jedes Minigame implementiert. Der Router
 * (siehe Router.ts) kuemmert sich um Canvas-Setup, die rAF-Loop und
 * Pointer-Events -- ein Minigame-Modul muss sich nur um init/update/render/
 * cleanup kuemmern und bekommt dafuer ein GameEnv gereicht.
 */

export interface GameSize {
  /** CSS-Pixel (nicht Device-Pixel -- die DPR-Skalierung macht das Canvas-Setup) */
  width: number;
  height: number;
  dpr: number;
}

export interface GameEnv {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: GameSize;
  /** DOM-Layer oberhalb des Canvas fuer HTML-Steuerelemente (On-Screen-Tastatur, Buttons, ...) */
  overlay: HTMLElement;
  /** Beendet das Spiel sauber und kehrt ins Hauptmenue zurueck. */
  exit: () => void;
  /**
   * Optional: "board"-Schluessel (siehe games/registry.ts#HighscoreCategory),
   * mit dem dieses Spiel gestartet wurde -- gesetzt vom "Jetzt spielen"-
   * Button im Highscore-Board (siehe menu/HighscoreBoard.ts), damit ein
   * Spiel mit mehreren Varianten (z. B. Geschwindigkeitsstufen) direkt in
   * GENAU diese Variante springen kann, statt erst wieder die eigene
   * Auswahl anzuzeigen. Spiele ohne Varianten (nur "default"-Board) oder
   * Spiele, die einen normalen Menue-Start nicht unterscheiden, ignorieren
   * das Feld einfach.
   */
  initialBoard?: string;
}

export interface PointerPoint {
  x: number;
  y: number;
  id: number;
}

/**
 * Minimaler Vertrag fuer ein Minigame. `id` muss mit der jeweiligen
 * GameMeta.id in games/registry.ts uebereinstimmen.
 */
export interface MinigameModule {
  readonly id: string;

  /** Einmalig beim Start aufgerufen. Darf async sein (z. B. Datenaufbereitung). */
  init(env: GameEnv): void | Promise<void>;

  /** Wird jeden Frame vor render() aufgerufen. dt in Sekunden, geclamped. */
  update(dt: number, env: GameEnv): void;

  /** Zeichnet den aktuellen Zustand. Canvas ist bereits geleert/vorbereitet. */
  render(env: GameEnv): void;

  /** Optional: Canvas-Groesse hat sich geaendert (Rotation, Resize). */
  onResize?(env: GameEnv): void;

  onPointerDown?(p: PointerPoint, env: GameEnv): void;
  onPointerMove?(p: PointerPoint, env: GameEnv): void;
  onPointerUp?(p: PointerPoint, env: GameEnv): void;

  /** Loops stoppen, Timer/Events entfernen -- wird beim Verlassen garantiert aufgerufen. */
  cleanup(env: GameEnv): void;
}
