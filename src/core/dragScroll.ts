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
 * WICHTIG: Dieser Listener ruft bewusst KEIN e.preventDefault() mehr auf
 * (frueher hier vorhanden -- gemeldeter Bug "auf dem Handy kann ich weder
 * im Hauptmenue noch im Highscoreboard scrollen" trat trotz allem
 * weiterhin auf). Der Grund: dank touch-action:pan-y (siehe style.css)
 * darf der Browser die Scroll-Geste schon nach dem ERSTEN touchmove nativ
 * uebernehmen, OHNE vorher auf einen JS-Handler zu warten (genau dafuer
 * wurde touch-action erfunden) -- ein preventDefault() hier waere dann
 * wirkungslos, kommt zu spaet. ABER: sobald irgendwo im Dokument ein
 * NICHT-passiver pointermove-Listener haengt (wie es dieser hier vorher
 * war), koennen manche Browser/WebViews aus Vorsicht auf den langsameren,
 * synchronen Weg zurueckfallen (erst JS fragen, ob es preventDefault()
 * aufruft, BEVOR ueberhaupt gescrollt wird) -- und in genau diesem Fall
 * HAT unser preventDefault() (sobald "moved" true wird) das native
 * Scrollen tatsaechlich abgewuergt, dauerhaft fuer die gesamte Geste, nicht
 * nur fuer den einen Frame. Auf dem Kiosk-Panel faellt das nicht auf, weil
 * dort ohnehin nie natives Scrollen zustande kommt (das ist ja der Grund
 * fuer diese Datei) -- der manuelle scrollTop-Mechanismus unten bleibt
 * dort die einzige wirksame Kraft, mit oder ohne preventDefault(). Auf
 * einem echten Handy dagegen war preventDefault() vermutlich genau die
 * Bremse, die jedes Scrollen verhinderte. Der Listener ist deshalb auch
 * wieder passive:true (kein Grund mehr, non-passive zu sein), was dem
 * Browser zusaetzlich erlaubt, den schnellen nativen Scroll-Pfad ohne
 * Umweg ueber JS zu nehmen.
 *
 * Der manuelle scrollTop-Mechanismus bleibt trotzdem bestehen (fuer den
 * Kiosk weiterhin noetig) -- INKREMENTELL: jede Bewegung wird relativ zur
 * vorherigen Pointer-Position auf den JEWEILS AKTUELLEN scrollTop-Wert
 * addiert statt ihn zu ueberschreiben, damit er sich mit eventuell
 * parallel laufendem nativen Scrollen auf einem echten Handy addiert
 * (verstaerkt es hoechstens etwas), statt dagegen anzukaempfen.
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
      // KEIN e.preventDefault() mehr hier (siehe Datei-Kommentar oben) --
      // Listener bleibt deshalb auch passive:true.
      // Inkrementell ab der ZULETZT gesehenen Pointer-Position auf den
      // AKTUELLEN scrollTop-Wert addieren (statt absolut ab dem
      // Drag-Start neu zu setzen) -- kooperiert dadurch mit eventuell
      // parallel laufendem nativen Scrollen, siehe Datei-Kommentar oben.
      const stepDelta = e.clientY - lastY;
      lastY = e.clientY;
      target.scrollTop -= stepDelta;
    },
    { passive: true },
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
