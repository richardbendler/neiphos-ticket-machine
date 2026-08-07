/**
 * Zielt bewusst auf 30fps statt der vollen Bildschirm-Bildwiederholrate --
 * auf schwacher Hardware (Raspberry Pi 3, siehe games/train-photo,
 * games/switch-run fuer die dortigen Einzel-Optimierungen) reicht das fuer
 * die hier verwendeten, eher langsamen/deliberate Bewegungen (fahrender
 * Zug, Timer-Text) voellig aus, halbiert aber die Canvas-Zeichenlast und
 * damit CPU/GPU-Zeit pro Sekunde spuerbar. update()/render() bekommen nach
 * wie vor die tatsaechlich vergangene Zeit (dt) statt eines fixen Werts,
 * die Spiellogik-Geschwindigkeit bleibt also exakt gleich -- nur wie oft
 * neu gezeichnet wird, sinkt.
 */
const TARGET_FRAME_INTERVAL_MS = 1000 / 30;

/**
 * Duenner requestAnimationFrame-Wrapper. Clamped das Delta, damit ein Tab-
 * Wechsel oder ein Ruckler nicht zu einem riesigen Zeitsprung in update()
 * fuehrt (z. B. ein Zug, der ploetzlich durchs halbe Feld teleportiert).
 */
export class GameLoop {
  private rafId: number | null = null;
  // Zeitpunkt des letzten TATSAECHLICHEN onFrame()-Aufrufs (nicht des
  // letzten rAF-Ticks) -- dt muss die seitdem vergangene Zeit sein, sonst
  // liefe die Spiellogik bei uebersprungenen Ticks unbemerkt in Zeitlupe
  // (jeder Tick haette nur die kurze Ticks-untereinander-Zeitspanne als dt
  // bekommen, nicht die laengere Spanne zwischen zwei echten Frames).
  private lastTime = 0;

  constructor(private readonly onFrame: (dtSeconds: number) => void) {}

  start(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (t: number) => {
      if (t - this.lastTime >= TARGET_FRAME_INTERVAL_MS) {
        const dt = Math.min(0.05, Math.max(0, (t - this.lastTime) / 1000));
        this.lastTime = t;
        this.onFrame(dt);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  get running(): boolean {
    return this.rafId !== null;
  }
}
