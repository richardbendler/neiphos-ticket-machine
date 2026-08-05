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

  // Doppel-Tap-Zoom war hier frueher zusaetzlich per JS unterbunden (300ms-
  // Timer, der bei jedem touchend per preventDefault() das nachfolgende
  // synthetische "click"-Event unterdrueckte, wenn der vorherige Tap
  // weniger als 300ms her war -- UNABHAENGIG davon, WO auf dem Bildschirm
  // getippt wurde). Das ist echter Ballast: "touch-action: none" auf
  // html/body (siehe style.css) unterbindet Doppel-Tap-/Pinch-Zoom bereits
  // zuverlaessig auf Plattform-Ebene, jeder <button> hat zusaetzlich
  // "touch-action: manipulation" (verhindert die Zoom-Geste UND die
  // klassische Tap-Verzoegerung gezielt fuer genau dieses Element). Der
  // JS-Timer oben war also fuer die Zoom-Verhinderung ueberfluessig,
  // sorgte aber dafuer, dass schnelles, wiederholtes Antippen VERSCHIEDENER
  // Ziele (z. B. beim Zug-/Huepftierspotter oder beim zuegigen Eintippen
  // auf der Bildschirmtastatur) jeden zweiten Tap kommentarlos verschluckte,
  // sobald er innerhalb von 300ms nach dem vorherigen kam -- das deckt sich
  // exakt mit echtem Tester-Feedback ("jeder Klick blockiert den naechsten,
  // ich komme nie unter ~2,9s"), das zunaechst faelschlich als
  // Missverstaendnis der Fehltipp-Zeitstrafe eingeordnet wurde (siehe
  // train-spotter/index.ts, WRONG_TAP_PENALTY). Ersatzlos entfernt.

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
