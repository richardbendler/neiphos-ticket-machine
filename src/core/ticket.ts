import { theme } from "./theme";

/**
 * Bar-Freigetraenk-Ticket im "ZORNTRAIN"-Design (Vorlage von der Orga) --
 * wird komplett im Client als Bild gerendert (Canvas), dann als 1-Bit-
 * Bitmap gepackt und an den Server geschickt (POST /api/system/printer/
 * raster, siehe server/serve.js). Der Server selbst weiss nichts vom
 * Layout, nur von Breite/Hoehe/Bytes -- die gesamte Gestaltung lebt
 * bewusst hier an einer Stelle.
 *
 * Querformat-Druck: der Bondrucker kann nur 384 Dots BREIT drucken (58mm
 * Thermopapier), dafuer beliebig LANG -- das Ticket ist aber breiter als
 * hoch (wie die Vorlage). Deshalb wird es hier in normaler (breiter)
 * Ausrichtung gezeichnet und danach um 90 Grad gedreht, bevor es gepackt
 * wird: die (feste) Bildhoehe von 384px wird dadurch zur Druckbreite, die
 * (beliebige) Bildbreite zur Drucklaenge in Vorschubrichtung.
 */

const TICKET_W = 700;
const TICKET_H = 384; // == PRINTER_WIDTH_DOTS, siehe unten
const PRINTER_WIDTH_DOTS = 384;

// Lokomotive aus core/icons.ts wiederverwendet (dieselbe Silhouette wie im
// Rest der App) -- als Path2D aus dem SVG-"d"-Attribut, lässt sich direkt
// mit ctx.fill() auf dem Ticket-Canvas zeichnen, viewBox war 0 0 24 24.
const LOCOMOTIVE_PATH = "M4 10a4 4 0 0 1 4-4h5a8 8 0 0 1 8 8v2H4v-6Z";

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, points = 5): void {
  const innerR = outerR * 0.42;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export interface TicketFields {
  /** Undefined/leer = Platzhalterlinie (Admin-Testdruck ohne echten Namen). */
  name?: string;
  game?: string;
  score?: string;
}

function drawTicketDesign(ctx: CanvasRenderingContext2D, fields: TicketFields): void {
  const ink = "#241f14"; // theme.paperText -- dunkle "Druckfarbe" auf hellem Papier
  const redInk = "#8a1f1a"; // gedeckter Rotton, thresholdet sauber zu schwarz

  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, TICKET_W, TICKET_H);

  // Aeusserer Doppelrahmen.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, TICKET_W - 20, TICKET_H - 20);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(16, 16, TICKET_W - 32, TICKET_H - 32);

  // Kleine Sterne in den vier Ecken -- dezente Anlehnung an die Vorlage.
  ctx.fillStyle = ink;
  drawStar(ctx, 30, 30, 6);
  drawStar(ctx, TICKET_W - 30, 30, 6);
  drawStar(ctx, 30, TICKET_H - 30, 6);
  drawStar(ctx, TICKET_W - 30, TICKET_H - 30, 6);

  // ---------------------------------------------------------- Links: Badge
  const badgeCx = 128;
  const badgeCy = TICKET_H / 2 + 6;
  const badgeR = 104;

  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(badgeCx, badgeCy, badgeR - 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = redInk;
  drawStar(ctx, badgeCx, badgeCy - badgeR - 4, 13);

  // Lokomotive, mittig-oben im Kreis -- dieselbe Silhouette wie core/icons.ts
  // (LOCOMOTIVE_PATH), viewBox war 0 0 24 24, hier per Path2D+Skalierung
  // solide gefuellt statt als duenne Kontur. Raeder separat dazugezeichnet,
  // sonst liest sich die gefuellte Kontur allein nicht als Zug.
  const locoScale = 3.1;
  ctx.save();
  ctx.translate(badgeCx - 12.5 * locoScale, badgeCy - 44);
  ctx.scale(locoScale, locoScale);
  ctx.fillStyle = ink;
  ctx.fill(new Path2D(LOCOMOTIVE_PATH));
  ctx.beginPath();
  ctx.arc(8, 19, 2, 0, Math.PI * 2);
  ctx.arc(17, 19, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Namensband quer durchs untere Kreisdrittel.
  ctx.save();
  ctx.translate(badgeCx, badgeCy + 46);
  ctx.rotate(0);
  ctx.fillStyle = redInk;
  ctx.beginPath();
  ctx.roundRect(-86, -19, 172, 38, 6);
  ctx.fill();
  ctx.strokeStyle = theme.paper;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(-82, -15, 164, 30, 5);
  ctx.stroke();
  ctx.fillStyle = "#f6ecc9";
  ctx.font = "800 22px 'Barlow Semi Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "1px";
  ctx.fillText("ZORNTRAIN", 0, 1);
  ctx.restore();

  // -------------------------------------------------------- Rechts: Inhalt
  const rx = 262;
  const rw = TICKET_W - rx - 30;

  ctx.fillStyle = redInk;
  ctx.font = "800 46px 'Barlow Semi Condensed', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = "1px";
  ctx.fillText("ZORNTRAIN", rx, 62);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(rx, 72);
  ctx.lineTo(rx + rw, 72);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = "700 22px 'Barlow Semi Condensed', sans-serif";
  ctx.letterSpacing = "2px";
  ctx.fillText("NEIPHOS FESTIVAL", rx, 100);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rx, 112);
  ctx.lineTo(rx + rw, 112);
  ctx.stroke();

  const rows: Array<{ label: string; value: string }> = [
    { label: "NAME", value: fields.name?.trim() || "……………………" },
    { label: "SPIEL", value: fields.game?.trim() || "……………………" },
    { label: "HIGHSCORE", value: fields.score?.trim() || "……………………" },
    {
      label: "DATUM",
      value: new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" }),
    },
  ];

  const labelX = rx;
  const dividerX = rx + 92;
  const valueX = rx + 108;
  let rowY = 148;
  const rowGap = 56;

  ctx.letterSpacing = "0px";
  for (const row of rows) {
    ctx.fillStyle = ink;
    ctx.font = "700 14px 'Barlow Semi Condensed', sans-serif";
    ctx.letterSpacing = "1px";
    ctx.fillText(row.label, labelX, rowY);

    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dividerX, rowY - 22);
    ctx.lineTo(dividerX, rowY + 8);
    ctx.stroke();

    ctx.fillStyle = redInk;
    ctx.font = "800 21px 'Barlow Semi Condensed', sans-serif";
    ctx.letterSpacing = "0px";
    // Lange Namen/Spieltitel nicht ueber den Rahmen hinaus laufen lassen.
    const maxValueW = rx + rw - valueX;
    let text = row.value;
    while (ctx.measureText(text).width > maxValueW && text.length > 1) {
      text = text.slice(0, -1);
    }
    if (text !== row.value) text = text.slice(0, -1) + "…";
    ctx.fillText(text, valueX, rowY);

    rowY += rowGap;
  }

  // Kleiner Rundstempel-Platzhalter unten rechts -- wird von echt vom
  // Schaffner abgestempelt (siehe Aufrufer), hier nur die Kontur als
  // Orientierung.
  const stampCx = rx + rw - 34;
  const stampCy = TICKET_H - 54;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(stampCx, stampCy, 32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = "700 9px 'Barlow Semi Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.letterSpacing = "1px";
  ctx.fillText("ZORNTRAIN", stampCx, stampCy - 2);
  ctx.font = "700 7px 'Barlow Semi Condensed', sans-serif";
  ctx.fillText("HIER STEMPELN", stampCx, stampCy + 10);
}

/** Rendert das Ticket in normaler (breiter) Ausrichtung, dreht danach um 90° fuers Querformat auf dem schmalen Thermopapier (siehe Datei-Kommentar). */
export async function renderTicketCanvas(fields: TicketFields): Promise<HTMLCanvasElement> {
  await document.fonts.ready;

  const design = document.createElement("canvas");
  design.width = TICKET_W;
  design.height = TICKET_H;
  const dctx = design.getContext("2d")!;
  drawTicketDesign(dctx, fields);

  const rotated = document.createElement("canvas");
  rotated.width = TICKET_H; // == PRINTER_WIDTH_DOTS
  rotated.height = TICKET_W;
  const rctx = rotated.getContext("2d")!;
  rctx.translate(TICKET_H / 2, TICKET_W / 2);
  rctx.rotate(Math.PI / 2);
  rctx.drawImage(design, -TICKET_W / 2, -TICKET_H / 2);

  return rotated;
}

/** Schwellwert-basierte 1-Bit-Packung (MSB zuerst, 1 = schwarz) -- passendes Format fuer ESC/POS "GS v 0", siehe server/serve.js. */
function packMonochrome(canvas: HTMLCanvasElement): Uint8Array<ArrayBuffer> {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const bytesPerRow = Math.ceil(width / 8);
  const packed = new Uint8Array(new ArrayBuffer(bytesPerRow * height));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const alpha = data[i + 3];
      const black = alpha > 30 && luminance < 150;
      if (black) {
        const byteIdx = y * bytesPerRow + (x >> 3);
        packed[byteIdx] |= 0x80 >> (x & 7);
      }
    }
  }
  return packed;
}

export interface PrintTicketResult {
  ok: boolean;
  error?: string;
}

/**
 * Rendert + druckt das Ticket.
 *
 * adminHeaders (optional): dieselben Header wie fuer alle anderen
 * /api/system/*-Aufrufe (siehe admin/AdminPanel.ts#systemAdminHeaders) --
 * NUR fuer den Admin-Testdruck gedacht (laeuft dann ueber den Admin-
 * geschuetzten /raster-Endpunkt). Ohne adminHeaders (der eigentliche
 * Highscore-Ticket-Druck, siehe core/highscorePrompt.ts) laeuft ueber den
 * eigenen, oeffentlichen aber ratenlimitierten /ticket-Endpunkt -- normale
 * Spieler:innen kennen (und sollen) das Admin-Passwort nicht kennen.
 */
export async function printTicket(fields: TicketFields, adminHeaders?: HeadersInit): Promise<PrintTicketResult> {
  try {
    const canvas = await renderTicketCanvas(fields);
    const packed = packMonochrome(canvas);
    const endpoint = adminHeaders ? "raster" : "ticket";
    const res = await fetch(`./api/system/printer/${endpoint}?width=${PRINTER_WIDTH_DOTS}&height=${canvas.height}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...adminHeaders },
      body: new Blob([packed]),
    });
    const data = await res.json().catch(() => ({}) as { ok?: boolean; error?: string });
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}
