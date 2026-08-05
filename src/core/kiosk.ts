/**
 * Kiosk-Haertung: unterdrueckt Kontextmenue, Textselektion, Pinch-Zoom,
 * Overscroll/Bounce und ein paar gaengige Browser-Tastenkuerzel. Laeuft
 * einmalig beim App-Start (main.ts) und wirkt global auf document/window.
 *
 * Hinweis: Manche Fluchtwege (z. B. Alt+F4, Systemmenues) kann eine Webseite
 * grundsaetzlich nicht verhindern -- dafuer ist auf dem Pi Chromium selbst im
 * echten --kiosk-Modus zu starten (siehe README).
 */
import { getAdminSession } from "./adminSession";

export function installKioskHardening(): void {
  const preventDefault = (e: Event) => e.preventDefault();

  document.addEventListener("contextmenu", preventDefault);
  document.addEventListener("selectstart", preventDefault);
  document.addEventListener("dragstart", preventDefault);
  document.addEventListener("gesturestart", preventDefault as EventListener);
  document.addEventListener("gesturechange", preventDefault as EventListener);

  // Pinch-Zoom per Trackpad/Maus-Wheel+Strg abfangen (touch-action:none deckt
  // echte Touch-Gesten bereits ab, aber nicht Wheel-basiertes Zoomen).
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );

  // Mehrfach-Touch (Pinch) und Overscroll/Bounce global unterbinden.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );

  // Doppel-Tap-Zoom: verhindert schnelles Doppel-Antippen als Zoom-Geste.
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );

  // Gaengige Browser-Shortcuts best-effort unterdruecken (Tab-/Fenster-Wechsel,
  // Drucken, Speichern, Devtools). Chromium im echten --kiosk-Modus blendet die
  // zugehoerige UI ohnehin aus; das hier ist nur ein zusaetzliches Netz.
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    const blockedWithModifier = ["w", "t", "n", "r", "p", "s", "j", "u"];
    if ((e.ctrlKey || e.metaKey) && blockedWithModifier.includes(key)) {
      e.preventDefault();
    }
    if (key === "f5" || (e.ctrlKey && key === "f5")) {
      e.preventDefault();
    }
    if (key === "f12") {
      e.preventDefault();
    }
  });
}

export function isFullscreenActive(): boolean {
  return document.fullscreenElement !== null;
}

export async function enterFullscreen(): Promise<void> {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    try {
      await el.requestFullscreen();
    } catch {
      // Manche Browser verlangen eine direkte User-Geste; Aufrufer sollte
      // das im Rahmen eines Touch-/Klick-Handlers aufrufen.
    }
  }
}

export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement && document.exitFullscreen) {
    try {
      await document.exitFullscreen();
    } catch {
      /* siehe enterFullscreen */
    }
  }
}

export async function toggleFullscreen(): Promise<void> {
  if (isFullscreenActive()) {
    await exitFullscreen();
  } else {
    await enterFullscreen();
  }
}

export interface KioskExitResult {
  /** true = die Anfrage kam beim Server an und wurde dort ausgefuehrt (unabhaengig davon, ob ein Prozess gefunden wurde). false = Server nicht erreichbar/Anfrage fehlgeschlagen. */
  ok: boolean;
  /** true = es wurde wirklich ein passender Kiosk-Prozess gefunden und beendet. */
  killed: boolean;
}

/**
 * Notausgang aus einem echten, per --kiosk gestarteten Chromium (siehe
 * README) -- absichtlich KEIN Umschalter mit Statusanzeige, weil eine
 * Webseite grundsaetzlich nicht zuverlaessig erkennen kann, ob sie gerade in
 * --kiosk laeuft (kein Browser stellt das zur Verfuegung). Ruft stattdessen
 * bedingungslos den admin-geschuetzten Server-Endpunkt auf, der den Prozess
 * beendet (server/serve.js) -- z. B. fuer den Notfall, dass ohne
 * funktionierendes WLAN weder SSH noch ein anderer Fernzugriff moeglich ist,
 * aber der darunterliegende Desktop (fuer WLAN-Neueinrichtung etc.)
 * erreichbar sein muss.
 *
 * Gibt (anders als vorher) zurueck, ob wirklich ein Prozess beendet wurde --
 * admin/AdminPanel.ts muss das auswerten und der Person eine erklaerende
 * Meldung zeigen, wenn nicht (z. B. falscher/kein --user-data-dir-Pfad).
 * Wurde wirklich beendet, beendet sich diese Seite selbst gleich mit, ein
 * weiteres UI-Update ist dann ohnehin hinfaellig.
 */
export async function exitKioskBrowser(): Promise<KioskExitResult> {
  try {
    const password = getAdminSession();
    const res = await fetch("./api/kiosk/exit", {
      method: "POST",
      headers: password ? { "X-Admin-Password": password } : {},
    });
    if (!res.ok) return { ok: false, killed: false };
    const data = (await res.json().catch(() => null)) as { killed?: boolean } | null;
    return { ok: true, killed: data?.killed === true };
  } catch {
    return { ok: false, killed: false };
  }
}
