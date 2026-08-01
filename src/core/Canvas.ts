import type { GameSize } from "./Game";

/**
 * Richtet ein Canvas fuer scharfes Rendering auf Displays mit
 * devicePixelRatio > 1 ein. Der Zeichencode arbeitet danach durchgehend in
 * CSS-Pixeln (ctx ist per setTransform bereits auf den DPR skaliert).
 */
export function setupCanvas(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  resize: () => GameSize;
} {
  const maybeCtx = canvas.getContext("2d", { alpha: false });
  if (!maybeCtx) throw new Error("2D-Canvas-Kontext wird von diesem Browser nicht unterstuetzt.");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  function resize(): GameSize {
    // DPR auf 2 gedeckelt: der Pi 5 muss nicht jedes Pixel eines 3x-Displays
    // schrubben, das Spiel ist ohnehin nicht grafikintensiv.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  }

  return { ctx, resize };
}
