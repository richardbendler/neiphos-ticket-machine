import { loadJSON, saveJSON } from "./storage";
import { openModal } from "./modal";

/**
 * Ticket-Zeitfenster: das Freigetraenk-Ticket (bei Highscore/Tagesbestwert/
 * Meilenstein) wird IMMER gedruckt -- dieses Zeitfenster steuert nur noch,
 * ob der abtrennbare "Gratis Shot an der Zornbar"-Streifen mit drauf kommt
 * (siehe core/ticket.ts#drawShotStrip), auf ausdruecklichen Wunsch, da die
 * Zornbar (core/highscorePrompt.ts) nur zu bestimmten Zeiten geoeffnet hat.
 * Rein lokale Geraete-Einstellung (wie z. B. auch Ticket-Cooldown/
 * -Verdienstwege, siehe core/ticketCooldown.ts/ticketMethods.ts) -- kein
 * Server-Sync noetig.
 *
 * start/end als "HH:MM" (24h) -- ein Fenster, das ueber Mitternacht
 * hinausreicht (start > end, z. B. Standard 21:00-04:00), wird von
 * isWithinTicketPrintWindow() korrekt behandelt (siehe dort).
 */
export interface TicketPrintWindowSettings {
  enabled: boolean;
  start: string;
  end: string;
}

const SETTINGS_KEY = ["settings", "ticketPrintWindow"];

// Auf ausdruecklichen Wunsch: standardmaessig aktiv, 21:00-04:00 Uhr (Zeiten
// der Zornbar).
const DEFAULT_SETTINGS: TicketPrintWindowSettings = { enabled: true, start: "21:00", end: "04:00" };

export function getTicketPrintWindowSettings(): TicketPrintWindowSettings {
  return { ...DEFAULT_SETTINGS, ...loadJSON<Partial<TicketPrintWindowSettings>>(SETTINGS_KEY, {}) };
}

export function setTicketPrintWindowEnabled(enabled: boolean): void {
  saveJSON(SETTINGS_KEY, { ...getTicketPrintWindowSettings(), enabled });
}

/** start/end als "HH:MM" -- wird vom Aufrufer (Admin-Panel, <input type="time">) bereits in diesem Format geliefert. */
export function setTicketPrintWindowTimes(start: string, end: string): void {
  saveJSON(SETTINGS_KEY, { ...getTicketPrintWindowSettings(), start, end });
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h || 0) % 24) * 60 + ((m || 0) % 60);
}

export function isWithinTicketPrintWindow(date: Date = new Date()): boolean {
  const settings = getTicketPrintWindowSettings();
  if (!settings.enabled) return true;
  const startMin = toMinutes(settings.start);
  const endMin = toMinutes(settings.end);
  if (startMin === endMin) return true; // Start=Ende -- entartetes Fenster, keine Einschraenkung.
  const nowMin = date.getHours() * 60 + date.getMinutes();
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  // Fenster wrapped ueber Mitternacht (z. B. 21:00-04:00).
  return nowMin >= startMin || nowMin < endMin;
}

/** "21:00 - 04:00 Uhr" -- fuer Hinweistexte (Dialog/Fussleiste, siehe core/highscorePrompt.ts + core/Router.ts). */
export function formatTicketPrintWindow(settings: TicketPrintWindowSettings = getTicketPrintWindowSettings()): string {
  return `${settings.start} - ${settings.end} Uhr`;
}

/**
 * Erklaerungs-Dialog, aufrufbar durch Antippen des Fussleisten-Hinweises
 * unten links (siehe core/Router.ts) -- analog zu core/ticketCooldown.ts#
 * openTicketCooldownInfo.
 */
export function openTicketPrintWindowInfo(): void {
  openModal((panel, close) => {
    const h2 = document.createElement("h2");
    h2.textContent = "Ticket-Zeitfenster";
    panel.appendChild(h2);

    const settings = getTicketPrintWindowSettings();
    const p = document.createElement("p");
    p.style.fontSize = "0.92rem";
    p.textContent = `Dein Ticket bekommst du immer -- den zusätzlichen Gratis-Shot-Streifen an der Zornbar gibt's aber nur zwischen ${formatTicketPrintWindow(settings)}, weil die Zornbar außerhalb dieser Zeit geschlossen hat.`;
    panel.appendChild(p);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn--accent";
    okBtn.style.width = "100%";
    okBtn.style.marginTop = "12px";
    okBtn.textContent = "Alles klar";
    okBtn.addEventListener("click", close);
    panel.appendChild(okBtn);
  });
}
