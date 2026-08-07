/**
 * Touchscreen-Test fuer den Admin-Bereich: deckt den KOMPLETTEN Bildschirm
 * (auch den Bereich der sonst festen Kopf-/Fussleiste) mit einem Raster
 * antippbarer Felder ab, damit sich beim Erstanschluss eines neuen
 * Touch-Displays pruefen laesst, ob wirklich JEDE Stelle reagiert (Anlass:
 * gemeldeter Verdacht auf eine tote Zone oben links). Bewusst NICHT ueber
 * core/modal.ts (dessen Scrim spart Kopf-/Fussleiste absichtlich aus) --
 * dieser Test soll ausdruecklich auch genau diese Bereiche mit abdecken.
 */

const CELL_TARGET_PX = 80;

function buildCell(): HTMLButtonElement {
  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "touch-test-cell";
  cell.setAttribute("aria-label", "Testfeld");
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  cell.addEventListener("click", () => {
    cell.classList.add("touch-test-cell--tested");
    // Auch bei einem bereits gruenen Feld soll jeder weitere Tap sichtbar
    // reagieren (z. B. um mehrere Unterbereiche desselben Felds zu pruefen)
    // -- Klasse kurz entfernen+neu setzen erzwingt einen Reflow, damit die
    // CSS-Animation bei schnell aufeinanderfolgenden Taps jedes Mal neu
    // von vorne beginnt statt beim zweiten Tap auszubleiben.
    if (tapTimer) clearTimeout(tapTimer);
    cell.classList.remove("touch-test-cell--tap");
    void cell.offsetWidth;
    cell.classList.add("touch-test-cell--tap");
    tapTimer = setTimeout(() => cell.classList.remove("touch-test-cell--tap"), 260);
  });
  return cell;
}

/** Baut/ersetzt das Raster passend zur aktuellen Fenstergroesse -- Zellen sind ungefaehr button-gross (siehe CELL_TARGET_PX) und fuellen den Bildschirm ohne Rest lueckenlos aus. */
function buildGrid(grid: HTMLDivElement): void {
  grid.innerHTML = "";
  const cols = Math.max(1, Math.round(window.innerWidth / CELL_TARGET_PX));
  const rows = Math.max(1, Math.round(window.innerHeight / CELL_TARGET_PX));
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  for (let i = 0; i < cols * rows; i++) grid.appendChild(buildCell());
}

export function openTouchTest(): () => void {
  const overlay = document.createElement("div");
  overlay.className = "touch-test-overlay";

  const grid = document.createElement("div");
  grid.className = "touch-test-grid";
  overlay.appendChild(grid);
  buildGrid(grid);

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "btn btn--accent touch-test-done";
  doneBtn.textContent = "Test beenden";
  doneBtn.addEventListener("click", () => close());
  overlay.appendChild(doneBtn);

  document.body.appendChild(overlay);

  function close(): void {
    overlay.remove();
  }

  return close;
}
