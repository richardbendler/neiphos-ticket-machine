import type { GameSize } from "./Game";

/**
 * Genereller Aufloesungs-Abschlag fuer die interne Canvas-Zeichenflaeche
 * (siehe Kommentar in resize() weiter unten). War zeitweise 0.7, dann 0.85 --
 * auf einem Pi 3 mit korrekt gesetztem CPU-Governor "performance" (siehe
 * README, Abschnitt "Performance-Tuning fuer den Pi 3") wurde selbst bei
 * 0.85 noch sichtbare Verpixelung gemeldet (v. a. bei echten Foto-Assets,
 * z. B. Zug-Quartett-Karten). Jetzt auf 1 (kein Abschlag mehr) -- die
 * urspruengliche Ruckel-Ursache war die Systemebene (CPU-Governor,
 * unnoetige Desktop-Prozesse, siehe README), nicht primaer die Canvas-
 * Aufloesung. Bei erneuten Performance-Problemen auf schwacher Hardware
 * diesen Wert als Erstes wieder senken (0.85 als erster Zwischenschritt).
 */
const RENDER_SCALE = 1;

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
  // Browser-Default fuer imageSmoothingQuality ist "low" (billigster
  // Resampling-Filter) -- faellt v. a. bei drawImage() mit Skalierung
  // (Foto-Assets wie die Zug-Quartett-Karten, siehe games/train-quartet)
  // als unnoetige zusaetzliche Unschaerfe/Blockigkeit auf. "high" kostet auf
  // dem Pi 3 keine spuerbare zusaetzliche Zeit (Bilder werden nur einmal pro
  // Layoutaenderung neu skaliert gezeichnet, nicht jeden Frame).
  ctx.imageSmoothingQuality = "high";

  function resize(): GameSize {
    // DPR auf 2 gedeckelt: der Pi 5 muss nicht jedes Pixel eines 3x-Displays
    // schrubben, das Spiel ist ohnehin nicht grafikintensiv.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    // Zusaetzlich zum DPR-Cap noch ein genereller Aufloesungs-Abschlag: auf
    // dem Kiosk-Zielgeraet (Raspberry Pi 3, VideoCore-IV-GPU, nur GLES2)
    // ist die reine Fuellrate -- wie viele Pixel pro Frame beschrieben
    // werden muessen -- ein spuerbarer Flaschenhals (gemeldetes Ruckeln
    // trotz bereits vorhandener Einzeloptimierungen, siehe games/train-photo,
    // games/switch-run, GameLoop.ts). RENDER_SCALE deckelt die interne
    // Zeichenaufloesung unabhaengig vom DPR; CSS skaliert das Canvas-Element
    // ganz normal auf seine tatsaechliche Anzeigegroesse hoch (billige
    // GPU-Textur-Skalierung statt teurem Pro-Pixel-Zeichnen). Auf einem
    // Touch-Kiosk mit eher grossen, einfachen 2D-Formen faellt der leichte
    // Schaerfeverlust kaum auf.
    const scale = dpr * RENDER_SCALE;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return { width, height, dpr: scale };
  }

  return { ctx, resize };
}
