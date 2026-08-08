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

function buildWheels(count: number): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "screensaver-train__wheels";
  for (let i = 0; i < count; i++) {
    const wheel = document.createElement("div");
    wheel.className = "screensaver-train__wheel";
    wrap.appendChild(wheel);
  }
  return wrap;
}

/**
 * Lok + ein Wagen statt einer schlichten Box mit weissen Quadraten (erste
 * Fassung, auf Nutzer-Feedback hin ueberarbeitet) -- Kabine, Schlot,
 * Scheinwerfer mit Glow, Fensterreihe mit Glas-Farbverlauf, Akzentstreifen
 * und Raeder je Wagen. Weiterhin reine CSS-Formen (kein SVG/Bild), bleibt
 * also genauso billig zu animieren wie vorher.
 */
function buildTrain(): HTMLDivElement {
  const train = document.createElement("div");
  train.className = "screensaver-train";

  const engine = document.createElement("div");
  engine.className = "screensaver-train__engine";
  const cab = document.createElement("div");
  cab.className = "screensaver-train__cab";
  const stack = document.createElement("div");
  stack.className = "screensaver-train__stack";
  const headlight = document.createElement("div");
  headlight.className = "screensaver-train__headlight";
  engine.append(cab, stack, headlight, buildWheels(2));
  train.appendChild(engine);

  const car = document.createElement("div");
  car.className = "screensaver-train__car";
  const stripe = document.createElement("div");
  stripe.className = "screensaver-train__stripe";
  car.appendChild(stripe);
  for (let i = 0; i < 3; i++) {
    const win = document.createElement("div");
    win.className = "screensaver-train__window";
    car.appendChild(win);
  }
  const label = document.createElement("div");
  label.className = "screensaver-train__label";
  label.textContent = "NEIPHOS EXPRESS";
  car.append(label, buildWheels(3));
  train.appendChild(car);

  return train;
}

function buildOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "screensaver-overlay";

  const track = document.createElement("div");
  track.className = "screensaver-track";
  track.appendChild(buildTrain());
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

/** Fuer den "Bildschirmschoner jetzt aktivieren"-Testknopf im Admin-Bereich -- zeigt ihn sofort, unabhaengig vom Inaktivitaets-Timer/der An/Aus-Einstellung. */
export function previewScreensaver(): void {
  showScreensaver();
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
