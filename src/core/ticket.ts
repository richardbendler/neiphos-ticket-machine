import ticketBasicUrl from "../assets/tickets/ticket-basic.png";
import ticketHighscoreUrl from "../assets/tickets/ticket-highscore.png";
import ticketDailyHighscoreUrl from "../assets/tickets/ticket-daily-highscore.png";
import ticketMilestoneUrl from "../assets/tickets/ticket-milestone.png";

/**
 * Bar-Freigetraenk-Ticket im "ZORNTRAIN"-Design -- vier fertige Bild-
 * Vorlagen von der Orga (siehe src/assets/tickets/), die 1:1 unveraendert
 * uebernommen werden (auf ausdruecklichen Wunsch: "designmaessig nicht mehr
 * veraendern"). Diese Datei zeichnet nur noch die vier Textfelder (Name/
 * Spiel/Errungenschaft-Wert/Kaufdatum) an exakt vermessenen Pixelpositionen
 * ueber die jeweilige Vorlage, dreht das Ergebnis fuers Querformat um 90
 * Grad und packt es als ESC/POS-Rastergrafik (siehe server/serve.js).
 *
 * Welche der drei beschrifteten Vorlagen gedruckt wird, folgt derselben
 * Rangfolge wie die Dialog-Nachricht (siehe core/ticketMethods.ts#
 * primaryTicketReason): Highscore vor Tagesbestwert vor Meilenstein.
 *
 * Querformat-Druck: der Bondrucker kann nur 384 Dots BREIT drucken (58mm
 * Thermopapier), dafuer beliebig LANG -- die Vorlagen sind aber breiter als
 * hoch. Deshalb wird die Vorlage zunaechst in ihrer normalen (breiten)
 * Ausrichtung mit den Textfeldern beschriftet, dann so skaliert, dass ihre
 * Hoehe genau 384px betraegt, und erst danach um 90 Grad gedreht: die
 * (jetzt exakt 384px kleine) Bildhoehe wird dadurch zur Druckbreite, die
 * (beliebig lange) Bildbreite zur Drucklaenge in Vorschubrichtung.
 */

const PRINTER_WIDTH_DOTS = 384;

export type TicketVariant = "basic" | "highscore" | "dailyHighscore" | "milestone";

interface TicketTemplate {
  url: string;
  /** Label des dritten Feldes (nur zur Doku -- der Text selbst steht schon fest in der Bild-Vorlage). */
  fieldLabel: string | null;
}

const TEMPLATES: Record<TicketVariant, TicketTemplate> = {
  basic: { url: ticketBasicUrl, fieldLabel: null },
  highscore: { url: ticketHighscoreUrl, fieldLabel: "HIGHSCORE" },
  dailyHighscore: { url: ticketDailyHighscoreUrl, fieldLabel: "TAGES-HIGHSCORE" },
  milestone: { url: ticketMilestoneUrl, fieldLabel: "ERRUNGENSCHAFT" },
};

// Pixelkoordinaten der vier Beschriftungslinien, per Bildanalyse an der
// Vorlage (1537x1023px, "Version Highscore.png" u. ae.) vermessen -- NAME/
// SPIEL/[dynamisches Feld]/KAUFDATUM & UHRZEIT sitzen bei allen drei
// beschrifteten Vorlagen an identischer Position, nur das Label-Wort des
// dritten Feldes unterscheidet sich (schon Teil der jeweiligen Bilddatei).
// x: 73 bis 657 ist die Linie selbst, Text faengt mit etwas Einzug bei 95
// an und schreibt sich auf die Linie (wie handschriftlich ausgefuellt).
const FIELD_X = 95;
const FIELD_MAX_X = 640;
const FIELD_LINES_Y = { name: 558, game: 640, dynamic: 723, purchasedAt: 810 };
const FIELD_FONT = "700 34px 'Barlow Semi Condensed', sans-serif";
const FIELD_COLOR = "#7a1400";

export interface TicketFields {
  name?: string;
  game?: string;
  score?: string;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function formatPurchasedAt(): string {
  const now = new Date();
  const date = now.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time} Uhr`;
}

function drawFieldValue(ctx: CanvasRenderingContext2D, y: number, value: string): void {
  ctx.fillStyle = FIELD_COLOR;
  ctx.font = FIELD_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const maxW = FIELD_MAX_X - FIELD_X;
  let text = value;
  while (ctx.measureText(text).width > maxW && text.length > 1) {
    text = text.slice(0, -1);
  }
  if (text !== value) text = text.slice(0, -1) + "…";
  ctx.fillText(text, FIELD_X, y);
}

/** Rendert das Ticket in normaler (breiter) Ausrichtung auf die vermessene Bild-Vorlage, skaliert auf 384px Hoehe, dreht danach um 90° fuers Querformat (siehe Datei-Kommentar). */
export async function renderTicketCanvas(variant: TicketVariant, fields: TicketFields): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const template = TEMPLATES[variant];
  const img = await loadImage(template.url);

  const design = document.createElement("canvas");
  design.width = img.naturalWidth;
  design.height = img.naturalHeight;
  const dctx = design.getContext("2d")!;
  dctx.drawImage(img, 0, 0);

  if (variant !== "basic") {
    drawFieldValue(dctx, FIELD_LINES_Y.name, fields.name?.trim() || "");
    drawFieldValue(dctx, FIELD_LINES_Y.game, fields.game?.trim() || "");
    drawFieldValue(dctx, FIELD_LINES_Y.dynamic, fields.score?.trim() || "");
    drawFieldValue(dctx, FIELD_LINES_Y.purchasedAt, formatPurchasedAt());
  }

  // Auf exakt 384px Hoehe skalieren -- das wird nach der Drehung die feste
  // Druckbreite (siehe Datei-Kommentar).
  const scale = PRINTER_WIDTH_DOTS / design.height;
  const scaledW = Math.round(design.width * scale);
  const scaled = document.createElement("canvas");
  scaled.width = scaledW;
  scaled.height = PRINTER_WIDTH_DOTS;
  const sctx = scaled.getContext("2d")!;
  sctx.drawImage(design, 0, 0, scaledW, PRINTER_WIDTH_DOTS);

  const rotated = document.createElement("canvas");
  rotated.width = PRINTER_WIDTH_DOTS;
  rotated.height = scaledW;
  const rctx = rotated.getContext("2d")!;
  rctx.translate(PRINTER_WIDTH_DOTS / 2, scaledW / 2);
  rctx.rotate(Math.PI / 2);
  rctx.drawImage(scaled, -scaledW / 2, -PRINTER_WIDTH_DOTS / 2);

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
 * Verstaendliche deutsche Meldung statt eines rohen Fehlercodes (siehe
 * server/serve.js#printRasterJob fuer die Codes) -- deckt insbesondere zwei
 * haeufige, harmlose Faelle ab: die Papierrolle ist leer, oder es haengt
 * (z. B. weil diese Instanz gerade auf einem normalen Webserver ohne
 * angeschlossene Druckerhardware laeuft) gar kein Drucker dran. Beides ist
 * kein "richtiger" Fehler, den man alarmierend melden muesste. Genutzt vom
 * Highscore-Ticket-Dialog (core/highscorePrompt.ts) UND vom Admin-Testdruck
 * (admin/AdminPanel.ts), damit beide Stellen dieselbe Formulierung zeigen.
 */
export function friendlyPrintErrorMessage(error?: string): string {
  switch (error) {
    case "paper_empty":
      return "Leider ist das Druckerpapier gerade alle -- das Ticket kann deshalb im Moment nicht gedruckt werden.";
    case "printer_not_found":
      return "Gerade ist kein Drucker angeschlossen -- das Ticket kann deshalb im Moment nicht gedruckt werden.";
    case "rate_limited":
      return "Gerade wurden schon sehr viele Tickets gedruckt -- bitte in ein paar Minuten nochmal versuchen.";
    default:
      return "Bitte am Automaten melden.";
  }
}

/**
 * Rendert + druckt das Ticket.
 *
 * adminHeaders (optional): dieselben Header wie fuer alle anderen
 * /api/system/*-Aufrufe (siehe admin/AdminPanel.ts#systemAdminHeaders) --
 * NUR fuer den Admin-Testdruck gedacht (laeuft dann ueber den Admin-
 * geschuetzten /raster-Endpunkt, immer variant="basic"). Ohne adminHeaders
 * (der eigentliche Highscore-Ticket-Druck, siehe core/highscorePrompt.ts)
 * laeuft ueber den eigenen, oeffentlichen aber ratenlimitierten /ticket-
 * Endpunkt -- normale Spieler:innen kennen (und sollen) das Admin-Passwort
 * nicht kennen.
 */
export async function printTicket(variant: TicketVariant, fields: TicketFields, adminHeaders?: HeadersInit): Promise<PrintTicketResult> {
  try {
    const canvas = await renderTicketCanvas(variant, fields);
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
