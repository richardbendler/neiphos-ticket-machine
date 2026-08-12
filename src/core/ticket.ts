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

// Pixelkoordinaten je Feld, per Bildanalyse an der (bereits zugeschnittenen,
// 1506x1003px) Vorlage vermessen -- NAME/SPIEL/[dynamisches Feld]/
// KAUFDATUM & UHRZEIT sitzen bei allen drei beschrifteten Vorlagen an
// identischer Position, nur das Label-Wort des dritten Feldes unterscheidet
// sich (schon Teil der jeweiligen Bilddatei).
//
// Auf ausdruecklichen Wunsch steht der eingetragene Wert jetzt NEBEN dem
// Label (rechts davon, auf derselben Zeile/Linie) statt darunter -- "da ist
// ja genug Freiflaeche". Die verfuegbare Breite unterscheidet sich dabei
// STARK je Zeile: NAME/SPIEL laufen neben der rechten Box (ZUGNUMMER/PREIS/
// HINFAHRT/RUECKFAHRT) und enden deshalb schon bei x~640, waehrend die
// Linien fuer das dynamische Feld und KAUFDATUM & UHRZEIT darunter beginnen
// (die rechte Box endet dort schon) und quer ueber fast die gesamte
// Kartenbreite laufen, nur vom runden ZORNTRAIN-Stempel unten rechts
// begrenzt -- deshalb je Zeile ein eigenes x/maxX-Paar statt einer
// gemeinsamen Konstante. x startet jeweils knapp hinter dem eigenen Label.
//
// dynamic.x war zunaechst bei 580 -- deutlich zu grosszuegig, per erneuter
// Pixelanalyse (Lumineszenz-Scan der drei Vorlagen, y=745-790) endet selbst
// das laengste Label ("TAGES-HIGHSCORE") schon bei x~479, "HIGHSCORE"/
// "ERRUNGENSCHAFT" sogar noch frueher -- der alte Wert liess dadurch eine
// deutlich sichtbare, unerwuenschte Luecke (gemeldeter Bug: "da lässt Du
// eine zu große Lücke... direkt neben den jeweiligen Begriff schreiben").
// Jetzt 497 (knapp hinter dem laengsten Label + etwas Puffer), einheitlich
// fuer alle drei Vorlagen -- der Unterschied zwischen den Labels ist mit
// nur ca. 7px ohnehin kaum wahrnehmbar.
const FIELD_LINES = {
  name: { x: 200, maxX: 640, y: 624 },
  game: { x: 215, maxX: 640, y: 708 },
  dynamic: { x: 497, maxX: 1100, y: 795 },
  purchasedAt: { x: 500, maxX: 1180, y: 879 },
};
const FIELD_FONT_SIZE = 61;
const FIELD_FONT = `700 ${FIELD_FONT_SIZE}px 'Barlow Semi Condensed', sans-serif`;
const FIELD_COLOR = "#7a1400";
// Auf ausdruecklichen Wunsch sitzt der Wert etwas tiefer als die reine
// vertikale Zentrierung (FIELD_ROW_HEIGHT/2) ergeben wuerde -- zunaechst
// 10%, dann nochmal um weitere 5% der eigenen Schrifthoehe ergaenzt (macht
// zusammen 15%).
const FIELD_VERTICAL_NUDGE = FIELD_FONT_SIZE * 0.15;
// Zeilenhoehe je Feld -- der Reihenabstand zwischen den vier Feldern liegt
// (per Bildanalyse) recht einheitlich bei ~84-87px, das jeweilige Label
// sitzt IM Bereich oberhalb der eigenen Linie (field.y markiert die Linie
// selbst, nicht die Zeilenmitte). Fuer die vertikale Zentrierung "in die
// Zeile" (auf ausdruecklichen Wunsch, vorher stand der Wert auf der
// Grundlinie) wird der Wert deshalb nicht mehr AUF field.y gesetzt, sondern
// mittig im Band [field.y - FIELD_ROW_HEIGHT, field.y] platziert.
const FIELD_ROW_HEIGHT = 84;

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

function drawFieldValue(ctx: CanvasRenderingContext2D, field: { x: number; maxX: number; y: number }, value: string): void {
  ctx.fillStyle = FIELD_COLOR;
  ctx.font = FIELD_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const maxW = field.maxX - field.x;
  let text = value;
  while (ctx.measureText(text).width > maxW && text.length > 1) {
    text = text.slice(0, -1);
  }
  if (text !== value) text = text.slice(0, -1) + "…";
  ctx.fillText(text, field.x, field.y - FIELD_ROW_HEIGHT / 2 + FIELD_VERTICAL_NUDGE);
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
    drawFieldValue(dctx, FIELD_LINES.name, fields.name?.trim() || "");
    drawFieldValue(dctx, FIELD_LINES.game, fields.game?.trim() || "");
    drawFieldValue(dctx, FIELD_LINES.dynamic, fields.score?.trim() || "");
    drawFieldValue(dctx, FIELD_LINES.purchasedAt, formatPurchasedAt());
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
 * server/serve.js#printRasterJob fuer die Server-seitigen Codes, "network_error"
 * kommt dagegen aus printTicket() unten selbst) -- deckt zwei haeufige,
 * harmlose Faelle extra freundlich ab: die Papierrolle ist leer, oder es
 * haengt (z. B. weil diese Instanz gerade auf einem normalen Webserver ohne
 * angeschlossene Druckerhardware laeuft) gar kein Drucker dran. Genutzt vom
 * Highscore-Ticket-Dialog (core/highscorePrompt.ts) UND vom Admin-Testdruck
 * (admin/AdminPanel.ts), damit beide Stellen dieselbe Formulierung zeigen.
 *
 * Auf ausdruecklichen Wunsch KONKRET statt nur "bitte am Automaten melden"
 * fuer jeden bekannten Fehlerfall -- vorher fielen alle Faelle ausser den
 * drei haeufigsten (inkl. z. B. "Automat/Server nicht erreichbar") in
 * diesen nichtssagenden Sammel-Fallback.
 */
export function friendlyPrintErrorMessage(error?: string): string {
  switch (error) {
    case "paper_empty":
      return "Druckerpapier ist alle.";
    case "printer_not_found":
      return "Kein Drucker angeschlossen.";
    case "rate_limited":
      return "Gerade wurden schon sehr viele Tickets gedruckt -- bitte in ein paar Minuten nochmal versuchen.";
    case "network_error":
      return "Automat nicht erreichbar (keine Verbindung zum Server).";
    case "permission_denied":
      return "Keine Berechtigung für den Drucker (Automat braucht technische Hilfe).";
    case "write_failed":
      return "Schreibfehler am Drucker (Automat braucht technische Hilfe).";
    case "invalid_dimensions":
    case "size_mismatch":
      return "Ticket-Vorlage fehlerhaft erzeugt (Automat braucht technische Hilfe).";
    case "payload_too_large":
      return "Ticket-Daten zu groß übertragen (Automat braucht technische Hilfe).";
    default:
      return error ? `Unbekannter Fehler (${error}) -- Automat braucht technische Hilfe.` : "Unbekannter Fehler -- Automat braucht technische Hilfe.";
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
    // fetch() selbst wirft (statt eine Antwort mit !res.ok zu liefern) genau
    // dann, wenn die Anfrage gar nicht erst beim Server ankam -- Automat/
    // Server nicht erreichbar (Netzwerk weg, Server abgestuerzt, o.ae.).
    // Chromium meldet das als TypeError ("Failed to fetch" o.ae.), das ist
    // browseruebergreifend zwar nicht 100% garantiert, aber der einzig
    // sinnvolle Anhaltspunkt hier -- auf ausdruecklichen Wunsch trotzdem
    // konkret als "nicht erreichbar" statt als nichtssagender Rohfehler
    // gemeldet (siehe friendlyPrintErrorMessage).
    const isNetworkError = e instanceof TypeError;
    return { ok: false, error: isNetworkError ? "network_error" : String((e as Error).message || e) };
  }
}

/**
 * NUR fuer die Fehlersuche beim wiederholt gemeldeten Gibberish-Vorfall
 * (siehe server/serve.js#printRasterJob-Kommentare): druckt dieselbe
 * "basic"-Vorlage wie der normale Testdruck, aber auf `rows` Bildzeilen
 * gekappt -- soll klaeren, ob ein deutlich KUERZERES Rasterbild
 * zuverlaessig sauber druckt, waehrend die volle Ticketlaenge (~577
 * Zeilen) weiterhin vereinzelt mitten im Bild kippt. Sauber bei kurz +
 * weiterhin kaputt bei lang deutet auf ein Firmware-Problem des Druckers
 * mit LANGEN zusammenhaengenden Rasterbildern hin (unabhaengig von
 * Uebertragungstempo/Baenderung, die schon ausgereizt wurden) statt auf
 * ein Timing-/Pufferproblem beim Senden.
 */
export async function printDiagnosticStrip(rows: number, adminHeaders: HeadersInit): Promise<PrintTicketResult> {
  try {
    const canvas = await renderTicketCanvas("basic", {});
    const packed = packMonochrome(canvas);
    const bytesPerRow = PRINTER_WIDTH_DOTS / 8;
    const croppedHeight = Math.max(1, Math.min(rows, canvas.height));
    const croppedPacked = packed.subarray(0, croppedHeight * bytesPerRow);
    const res = await fetch(`./api/system/printer/raster?width=${PRINTER_WIDTH_DOTS}&height=${croppedHeight}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...adminHeaders },
      body: new Blob([croppedPacked]),
    });
    const data = await res.json().catch(() => ({}) as { ok?: boolean; error?: string });
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const isNetworkError = e instanceof TypeError;
    return { ok: false, error: isNetworkError ? "network_error" : String((e as Error).message || e) };
  }
}
