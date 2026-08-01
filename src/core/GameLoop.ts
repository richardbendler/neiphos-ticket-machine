/**
 * Duenner requestAnimationFrame-Wrapper. Clamped das Delta, damit ein Tab-
 * Wechsel oder ein Ruckler nicht zu einem riesigen Zeitsprung in update()
 * fuehrt (z. B. ein Zug, der ploetzlich durchs halbe Feld teleportiert).
 */
export class GameLoop {
  private rafId: number | null = null;
  private lastTime = 0;

  constructor(private readonly onFrame: (dtSeconds: number) => void) {}

  start(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - this.lastTime) / 1000));
      this.lastTime = t;
      this.onFrame(dt);
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
