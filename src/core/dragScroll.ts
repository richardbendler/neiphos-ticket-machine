/**
 * Manuelles Drag-to-Scroll fuer den ganzen Kiosk: natives Touch-Scrollen
 * (touch-action:pan-y + Browser-eigene Gestenerkennung, siehe style.css)
 * scheint auf diesem optischen/Infrarot-Touchscreen nicht zuverlaessig
 * auszuloesen (gemeldet: "kann nicht per Finger-Wisch scrollen, nur ueber
 * Scrollbalken/Mausrad") -- vermutlich, weil die kontinuierliche Bewegungs-
 * verfolgung waehrend eines Drags bei dieser Touch-Technik nicht fein genug
 * ist, damit Chromium das zuverlaessig als Scroll-Geste erkennt (verwandt
 * mit den frueher gefundenen Ghost-Touches nahe den Ecken-Sensoren, siehe
 * Git-Historie). Statt weiter auf die native Gestenerkennung zu hoffen,
 * hier komplett selbst nachgebaut: verfolgt jede Pointer-Bewegung direkt
 * und setzt scrollTop von Hand.
 *
 * EIN global delegierter Listener statt einzeln pro Element -- deckt
 * dadurch automatisch JEDEN scrollbaren Bereich ab (Admin-Bereich,
 * Feedback, Highscores, Spiel-Anleitungen, ...), auch zukuenftig neu
 * hinzukommende, ohne dass man jede Stelle eigens verdrahten muesste.
 *
 * Sobald ein Scroll-Drag erkannt wurde (siehe "moved" im pointermove-
 * Handler), wird zusaetzlich e.preventDefault() aufgerufen. Das genuegt
 * aber NICHT zuverlaessig: dank touch-action:pan-y (siehe style.css) darf
 * der Browser die Scroll-Geste bereits nach dem ERSTEN touchmove nativ
 * uebernehmen -- ab dann ist die Geste laut Spezifikation nicht mehr
 * abbrechbar, unser spaeteres preventDefault() kommt zu spaet. Auf einem
 * ECHTEN Handy-Touchscreen (anders als auf dem Kiosk-Panel, wo natives
 * Scrollen ueberhaupt nicht zuverlaessig anspringt) laeuft das native
 * Scrollen also parallel weiter. Wuerde dieser manuelle Mechanismus dabei
 * scrollTop bei jedem pointermove ABSOLUT ab einem beim pointerdown
 * gespeicherten Startwert neu setzen, wuerde er das native Scrollen bei
 * jedem Tick wieder zurueckdrehen -- beide Mechanismen heben sich
 * gegenseitig auf, es wirkt komplett wie "gar kein Scrollen" (gemeldeter
 * Bug: "ich kann auf meinem Handy nicht mit dem Finger scrollen"). Deshalb
 * INKREMENTELL: jede Bewegung wird relativ zur vorherigen Pointer-Position
 * auf den JEWEILS AKTUELLEN scrollTop-Wert addiert, statt ihn zu
 * ueberschreiben -- so summiert sich das mit parallelem nativen Scrollen
 * (statt es zu bekaempfen), waehrend es auf dem Kiosk-Panel weiterhin ganz
 * allein die volle Arbeit uebernimmt.
 */

const DRAG_THRESHOLD_PX = 6;

function isNativeDragControl(el: Element | null): boolean {
  // Eigene Drag-Semantik (z. B. Lautstaerke-Regler in AdminPanel.ts/
  // games/dj-mixer) -- die soll ein ueberlagerter Scroll-Drag nicht kapern.
  return el instanceof HTMLInputElement && el.type === "range";
}

function findScrollableAncestor(el: Element | null): HTMLElement | null {
  let node = el;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      const canScrollY = (style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight;
      if (canScrollY) return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function installDragScroll(): void {
  let target: HTMLElement | null = null;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let moved = false;

  document.addEventListener(
    "pointerdown",
    (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (isNativeDragControl(e.target as Element)) return;
      const scrollable = findScrollableAncestor(e.target as Element);
      if (!scrollable) return;
      target = scrollable;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      lastY = e.clientY;
      moved = false;
    },
    { passive: true },
  );

  document.addEventListener(
    "pointermove",
    (e: PointerEvent) => {
      if (!target || e.pointerId !== pointerId) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      if (!moved) {
        // Erst ab einer Mindestbewegung UND wenn sie ueberwiegend vertikal
        // ist committen -- sonst wuerde z. B. ein horizontaler Wisch
        // (falls spaeter mal irgendwo relevant) faelschlich scrollen.
        if (Math.abs(deltaY) < DRAG_THRESHOLD_PX || Math.abs(deltaY) < Math.abs(deltaX)) return;
        moved = true;
      }
      // Ab hier NICHT mehr passiv (siehe Datei-Kommentar). preventDefault()
      // ist nur erlaubt, weil dieser Listener unten bewusst NICHT mehr
      // passive ist -- bringt auf Geraeten mit touch-action:pan-y zwar oft
      // nichts mehr (siehe Datei-Kommentar), schadet dort aber auch nicht.
      e.preventDefault();
      // Inkrementell ab der ZULETZT gesehenen Pointer-Position auf den
      // AKTUELLEN scrollTop-Wert addieren (statt absolut ab dem
      // Drag-Start neu zu setzen) -- kooperiert dadurch mit eventuell
      // parallel laufendem nativen Scrollen, siehe Datei-Kommentar oben.
      const stepDelta = e.clientY - lastY;
      lastY = e.clientY;
      target.scrollTop -= stepDelta;
    },
    { passive: false },
  );

  const endDrag = (e: PointerEvent) => {
    if (!target || e.pointerId !== pointerId) return;
    if (moved) {
      // Den durch das Loslassen ausgeloesten synthetischen Klick auf dem
      // getroffenen Element unterdruecken -- sonst wuerde das Ende eines
      // Scroll-Drags ueber einem Button (z. B. einer Spiele-Checkbox im
      // Admin-Bereich) den versehentlich mit ausloesen.
      const consumeClick = (ce: MouseEvent) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      document.addEventListener("click", consumeClick, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", consumeClick, { capture: true }), 0);
    }
    target = null;
    pointerId = null;
    moved = false;
  };
  document.addEventListener("pointerup", endDrag, { passive: true });
  document.addEventListener("pointercancel", endDrag, { passive: true });
}
