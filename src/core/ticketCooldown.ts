import { loadJSON, saveJSON } from "./storage";
import { openModal } from "./modal";

/**
 * Ticket-Cooldown: verhindert, dass nach einem gedruckten Ticket sofort das
 * naechste gedruckt werden kann -- auf ausdruecklichen Wunsch, damit niemand
 * (hat man den Dreh raus, z. B. per Meilenstein-/Tagesbestwert-Weg) beliebig
 * viele Freigetraenk-Tickets hintereinander zieht. Rein lokale Geraete-
 * Einstellung (wie z. B. auch Ticket-Verdienstwege/Meilensteine, siehe
 * core/ticketMethods.ts) -- kein Server-Sync noetig, der Automat steht
 * ohnehin nur an einem Ort.
 */
export interface TicketCooldownSettings {
  enabled: boolean;
  /** In Minuten, Kommazahlen erlaubt (z. B. 1.5). */
  minutes: number;
}

const SETTINGS_KEY = ["settings", "ticketCooldown"];
const LAST_PRINTED_KEY = ["ticketCooldown", "lastPrintedAt"];

// Auf ausdruecklichen Wunsch: 3 Minuten, aktiviert.
const DEFAULT_SETTINGS: TicketCooldownSettings = { enabled: true, minutes: 3 };

export function getTicketCooldownSettings(): TicketCooldownSettings {
  return { ...DEFAULT_SETTINGS, ...loadJSON<Partial<TicketCooldownSettings>>(SETTINGS_KEY, {}) };
}

export function setTicketCooldownEnabled(enabled: boolean): void {
  saveJSON(SETTINGS_KEY, { ...getTicketCooldownSettings(), enabled });
}

/** minutes muss > 0 sein -- wird von den Aufrufstellen (Admin-Panel) bereits geprueft, hier nur nochmal defensiv abgesichert. */
export function setTicketCooldownMinutes(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  saveJSON(SETTINGS_KEY, { ...getTicketCooldownSettings(), minutes });
}

/** Muss NACH jedem erfolgreich gedruckten Ticket aufgerufen werden (siehe core/highscorePrompt.ts) -- startet den Cooldown neu, unabhaengig davon, ob er gerade schon lief. */
export function recordTicketPrinted(): void {
  saveJSON(LAST_PRINTED_KEY, Date.now());
}

function getLastPrintedAt(): number | null {
  return loadJSON<number | null>(LAST_PRINTED_KEY, null);
}

/** 0, wenn der Cooldown deaktiviert ist oder gerade nicht laeuft. */
export function getTicketCooldownRemainingMs(): number {
  const settings = getTicketCooldownSettings();
  if (!settings.enabled) return 0;
  const last = getLastPrintedAt();
  if (last === null) return 0;
  const remaining = last + settings.minutes * 60_000 - Date.now();
  return Math.max(0, remaining);
}

export function isTicketCooldownActive(): boolean {
  return getTicketCooldownRemainingMs() > 0;
}

/** "M:SS" -- fuer den Countdown in der Fussleiste (siehe core/Router.ts). */
export function formatCooldownCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Etwas kompakterer Text als formatCooldownCountdown fuer die Erklaerung im Highscore-Dialog (siehe core/highscorePrompt.ts) -- "noch X Minuten" statt einer laufenden Uhr, da dieser Text nur einmal beim Oeffnen des Dialogs gesetzt wird. */
export function formatCooldownRemainingRough(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes <= 1) return "noch etwa 1 Minute";
  return `noch etwa ${totalMinutes} Minuten`;
}

/**
 * Erklaerungs-Dialog, aufrufbar durch Antippen des Countdown-Hinweises unten
 * links in der Fussleiste (siehe core/Router.ts).
 */
export function openTicketCooldownInfo(): void {
  openModal((panel, close) => {
    const h2 = document.createElement("h2");
    h2.textContent = "Ticket-Cooldown";
    panel.appendChild(h2);

    const p = document.createElement("p");
    p.style.fontSize = "0.92rem";
    p.textContent =
      "Nach jedem gedruckten Freigetränk-Ticket gibt es eine kurze Pause, bevor das nächste gedruckt werden kann -- so kann niemand, der den Dreh raushat, sich am Stück beliebig viele Tickets ziehen. Weiterspielen kannst du in der Zwischenzeit ganz normal, dein Highscore/Meilenstein wird trotzdem gespeichert.";
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
