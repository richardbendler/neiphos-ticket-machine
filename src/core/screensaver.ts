import { loadJSON, saveJSON } from "./storage";

/**
 * Bildschirmschoner: zeigt nach einer einstellbaren Zeit ganz ohne Eingabe
 * (Touch/Tastatur) einen ganz simplen, gemuetlich durchfahrenden Zug mit
 * Aufschrift -- rein auf Kiosk-Ebene, deshalb bewusst NICHT ueber den
 * geraeteuebergreifenden Sync (core/sync.ts) verteilt, genau wie
 * Lautstaerke/WLAN/Audioausgabe (siehe admin/AdminPanel.ts) auch reine
 * Geraete-Einstellungen sind, keine "was sehen alle Besucher"-Einstellungen.
 * Ein Tap/Tastendruck irgendwo beendet ihn sofort wieder.
 */

const ENABLED_KEY = ["settings", "screensaverEnabled"];
const TIMEOUT_KEY = ["settings", "screensaverTimeoutMin"];
const DEFAULT_TIMEOUT_MIN = 5;
// Auf ausdruecklichen Wunsch voreingestellt aktiv.
const DEFAULT_ENABLED = true;

export function isScreensaverEnabled(): boolean {
  return loadJSON<boolean>(ENABLED_KEY, DEFAULT_ENABLED);
}

export function setScreensaverEnabled(enabled: boolean): void {
  saveJSON(ENABLED_KEY, enabled);
  applySettingsChanged();
}

export function getScreensaverTimeoutMinutes(): number {
  return loadJSON<number>(TIMEOUT_KEY, DEFAULT_TIMEOUT_MIN);
}

export function setScreensaverTimeoutMinutes(minutes: number): void {
  saveJSON(TIMEOUT_KEY, Math.max(1, Math.round(minutes)));
  applySettingsChanged();
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let overlayEl: HTMLDivElement | null = null;
let initialized = false;

export function isScreensaverActive(): boolean {
  return overlayEl !== null;
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleTimer(): void {
  clearIdleTimer();
  if (!isScreensaverEnabled() || overlayEl) return;
  idleTimer = setTimeout(showScreensaver, getScreensaverTimeoutMinutes() * 60_000);
}

/** Von admin/AdminPanel.ts nach einer Einstellungsaenderung aufzurufen -- wirkt sofort statt erst bei der naechsten Aktivitaet. */
export function applySettingsChanged(): void {
  if (!initialized) return;
  if (overlayEl && !isScreensaverEnabled()) {
    hideScreensaver();
    return;
  }
  scheduleIdleTimer();
}

function buildOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "screensaver-overlay";

  const track = document.createElement("div");
  track.className = "screensaver-track";

  const train = document.createElement("div");
  train.className = "screensaver-train";
  const windowCount = 3;
  for (let i = 0; i < windowCount; i++) {
    const win = document.createElement("div");
    win.className = "screensaver-train__window";
    train.appendChild(win);
  }
  const label = document.createElement("div");
  label.className = "screensaver-train__label";
  label.textContent = "NEIPHOS EXPRESS";
  train.appendChild(label);
  track.appendChild(train);
  overlay.appendChild(track);

  const message = document.createElement("div");
  message.className = "screensaver-message";
  message.textContent = "Tippe irgendwo, um mitzufahren -- am Ticket-Automaten warten Zug-Spiele auf dich!";
  overlay.appendChild(message);

  const hint = document.createElement("div");
  hint.className = "screensaver-hint";
  hint.textContent = "Zum Fortfahren berühren";
  overlay.appendChild(hint);

  return overlay;
}

function showScreensaver(): void {
  if (overlayEl) return;
  clearIdleTimer();
  overlayEl = buildOverlay();
  document.body.appendChild(overlayEl);
}

function hideScreensaver(): void {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
  scheduleIdleTimer();
}

/** Einmalig beim App-Start aufzurufen (siehe main.ts). */
export function initScreensaver(): void {
  if (initialized) return;
  initialized = true;
  const onActivity = () => {
    if (overlayEl) {
      hideScreensaver();
      return;
    }
    scheduleIdleTimer();
  };
  // Kein touchstart zusaetzlich noetig -- pointerdown deckt Touch/Maus/Stift
  // bereits einheitlich ab (siehe core/input.ts, gleiches Muster).
  document.addEventListener("pointerdown", onActivity, { passive: true });
  document.addEventListener("keydown", onActivity);
  scheduleIdleTimer();
}
