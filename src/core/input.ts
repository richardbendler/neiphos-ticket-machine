import type { PointerPoint } from "./Game";

/**
 * Wandelt ein PointerEvent in Canvas-lokale CSS-Pixel-Koordinaten um.
 * Funktioniert identisch fuer Touch (Pi-Display) und Maus (Entwicklung im
 * Desktop-Browser), da beide ueber die Pointer-Events-API laufen.
 */
export function toCanvasPoint(canvas: HTMLCanvasElement, evt: PointerEvent): PointerPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top,
    id: evt.pointerId,
  };
}

export function pointInRect(
  p: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

export function pointInCircle(p: { x: number; y: number }, c: { x: number; y: number; r: number }): boolean {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy <= c.r * c.r;
}
