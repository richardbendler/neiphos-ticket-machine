import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { showGameIntro } from "../../core/gameIntro";
import { guardedClick } from "../../core/guardedClick";
import { playSwitchCrashSound, playPartyShuttleJingle } from "../../core/sound";
import { FESTIVAL_SETLIST, getAllRealActs, type SetlistAct } from "../../data/festivalSetlist";

const GAME_ID = "setlist";
const BLANK_COUNT = 5;

/**
 * Setlist-Puzzle: die komplette Festival-Setlist (siehe data/
 * festivalSetlist.ts) ist immer vollstaendig sichtbar, bis auf
 * BLANK_COUNT zufaellig ausgewaehlte Acts -- deren Name fehlt, nur die
 * Uhrzeit bleibt stehen. Die fehlenden Namen liegen als antippbar-
 * verschiebbare "Chips" in einer eigenen Spalte links und muessen per
 * Drag&Drop an die richtige Stelle gezogen werden. Bewusst KEIN natives
 * HTML5-Drag&Drop (funktioniert auf Touch-Geraeten nicht zuverlaessig,
 * ist im Kern eine Maus-Technologie) -- stattdessen eigenes Pointer-Event-
 * basiertes Dragging (siehe startDrag/onDragMove/onDragEnd unten), das auf
 * Touch UND Maus gleich funktioniert.
 *
 * "Pruefen" wird erst antippbar, wenn alle BLANK_COUNT Chips irgendwo
 * platziert sind (nicht zwingend schon richtig) -- passend zum
 * Nutzerwunsch "erst wenn man alle 5 reingeschoben hat, kann man
 * ueberpruefen". Ein Chip laesst sich jederzeit wieder verschieben (auch
 * aus einem Feld heraus zurueck in die Seitenleiste, oder direkt in ein
 * anderes/bereits belegtes Feld -- dann tauschen die beiden Chips die
 * Plaetze).
 */
export function createSetlistPuzzleGame(): MinigameModule {
  // -------- Rundenzustand
  let blankActs: SetlistAct[] = [];
  // slotId (== Act-id) -> Act-id des Chips, der gerade dort liegt (oder null).
  let placement: Record<string, string | null> = {};
  // Reihenfolge der Chips, die aktuell noch in der Seitenleiste liegen.
  let sidebarOrder: string[] = [];
  let checked = false;
  let allCorrect = false;

  // -------- DOM-Referenzen
  let panel: HTMLDivElement;
  let sidebarChips: HTMLDivElement;
  let progressEl: HTMLDivElement;
  let checkBtn: HTMLButtonElement;
  let resultEl: HTMLDivElement;
  let scheduleHost: HTMLDivElement;
  const slotEls: Record<string, HTMLDivElement> = {};
  const actLookup = new Map<string, SetlistAct>();

  // -------- Drag-Zustand (waehrend eines aktiven Zugs)
  let dragging: { actId: string; fromSlotId: string | null; ghost: HTMLDivElement; pointerId: number } | null = null;

  let closeIntro: (() => void) | null = null;

  function shuffled<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function pickBlanks(): SetlistAct[] {
    const all = getAllRealActs();
    return shuffled(all).slice(0, Math.min(BLANK_COUNT, all.length));
  }

  function actName(actId: string): string {
    return actLookup.get(actId)?.name ?? "?";
  }

  // ---------------------------------------------------------------- Rendern

  function renderSidebar(): void {
    sidebarChips.innerHTML = "";
    for (const actId of sidebarOrder) {
      sidebarChips.appendChild(buildChip(actId, null));
    }
    const placedCount = BLANK_COUNT - sidebarOrder.length;
    progressEl.textContent = `${placedCount} von ${BLANK_COUNT} platziert`;
    checkBtn.disabled = sidebarOrder.length > 0;
  }

  function buildChip(actId: string, slotId: string | null): HTMLDivElement {
    const chip = document.createElement("div");
    chip.className = "setlist-chip";
    chip.textContent = actName(actId);
    chip.dataset.actId = actId;
    chip.addEventListener("pointerdown", (e) => startDrag(e, actId, slotId, chip));
    return chip;
  }

  function updateSlot(slotId: string): void {
    const el = slotEls[slotId];
    if (!el) return;
    el.classList.remove("setlist-slot--correct", "setlist-slot--wrong");
    const occupantId = placement[slotId];
    el.innerHTML = "";
    if (occupantId) {
      el.appendChild(buildChip(occupantId, slotId));
      el.classList.add("setlist-slot--filled");
    } else {
      el.classList.remove("setlist-slot--filled");
      const hint = document.createElement("span");
      hint.className = "setlist-slot__hint";
      hint.textContent = "?";
      el.appendChild(hint);
    }
    if (checked) {
      el.classList.add(occupantId === slotId ? "setlist-slot--correct" : "setlist-slot--wrong");
    }
  }

  function clearCheckedState(): void {
    if (!checked) return;
    checked = false;
    allCorrect = false;
    resultEl.textContent = "";
    resultEl.className = "setlist-result";
    for (const act of blankActs) updateSlot(act.id);
  }

  // ------------------------------------------------------------- Drag&Drop

  function startDrag(e: PointerEvent, actId: string, fromSlotId: string | null, sourceEl: HTMLDivElement): void {
    if (dragging) return;
    e.preventDefault();
    clearCheckedState();

    const rect = sourceEl.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "setlist-chip setlist-chip--ghost";
    ghost.textContent = actName(actId);
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);

    // Urspruengliches Element sofort ausblenden (nicht entfernen -- die
    // eigentliche Zustandsaenderung/Neuzeichnen passiert erst bei
    // erfolgreichem Drop, siehe finishDrag) statt es optisch doppelt zu
    // zeigen (einmal an alter Stelle, einmal als Ghost).
    sourceEl.classList.add("setlist-chip--dragged-source");

    dragging = { actId, fromSlotId, ghost, pointerId: e.pointerId };
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    (dragging as unknown as { offsetX: number; offsetY: number }).offsetX = offsetX;
    (dragging as unknown as { offsetX: number; offsetY: number }).offsetY = offsetY;

    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }

  function onDragMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const off = dragging as unknown as { offsetX: number; offsetY: number };
    dragging.ghost.style.left = `${e.clientX - off.offsetX}px`;
    dragging.ghost.style.top = `${e.clientY - off.offsetY}px`;

    // Aktuelles Drop-Ziel optisch hervorheben, waehrend man drueberzieht.
    document.querySelectorAll(".setlist-drop-hover").forEach((el) => el.classList.remove("setlist-drop-hover"));
    const target = dropTargetAt(e.clientX, e.clientY);
    target?.classList.add("setlist-drop-hover");
  }

  function dropTargetAt(x: number, y: number): HTMLElement | null {
    dragging!.ghost.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const slot = el.closest<HTMLElement>("[data-slot-id]");
    if (slot) return slot;
    const sidebar = el.closest<HTMLElement>(".setlist-sidebar");
    if (sidebar) return sidebar;
    return null;
  }

  function onDragEnd(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    const { actId, fromSlotId, ghost } = dragging;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    document.querySelectorAll(".setlist-drop-hover").forEach((el) => el.classList.remove("setlist-drop-hover"));

    const target = dropTargetAt(e.clientX, e.clientY);
    ghost.remove();
    dragging = null;

    const toSlotId = target?.dataset.slotId ?? (target?.classList.contains("setlist-sidebar") ? "SIDEBAR" : null);
    applyDrop(actId, fromSlotId, toSlotId);
  }

  /** toSlotId: eine Act-id (echtes Feld), "SIDEBAR" (zurueck in die Leiste) oder null (kein gueltiges Ziel getroffen -- keine Aenderung). */
  function applyDrop(actId: string, fromSlotId: string | null, toSlotId: string | null): void {
    if (toSlotId === null) {
      redrawSource(fromSlotId);
      return;
    }
    if (toSlotId === fromSlotId) {
      redrawSource(fromSlotId);
      return;
    }

    if (toSlotId === "SIDEBAR") {
      if (fromSlotId !== null) {
        placement[fromSlotId] = null;
        sidebarOrder.push(actId);
        updateSlot(fromSlotId);
        renderSidebar();
      }
      // Kam es schon aus der Seitenleiste, bleibt es dort -- nichts zu tun.
      return;
    }

    // toSlotId ist ein echtes Feld.
    const displaced = placement[toSlotId] ?? null;
    placement[toSlotId] = actId;
    if (fromSlotId !== null) {
      placement[fromSlotId] = displaced;
      updateSlot(fromSlotId);
    } else {
      sidebarOrder = sidebarOrder.filter((id) => id !== actId);
      if (displaced) sidebarOrder.push(displaced);
    }
    updateSlot(toSlotId);
    renderSidebar();
  }

  function redrawSource(fromSlotId: string | null): void {
    if (fromSlotId) updateSlot(fromSlotId);
    else renderSidebar();
  }

  // --------------------------------------------------------------- Pruefen

  function checkPuzzle(): void {
    if (sidebarOrder.length > 0) return;
    checked = true;
    allCorrect = blankActs.every((act) => placement[act.id] === act.id);
    for (const act of blankActs) updateSlot(act.id);

    if (allCorrect) {
      resultEl.textContent = "🎉 Alles richtig! Stark, du kennst dein Line-up.";
      resultEl.className = "setlist-result setlist-result--win";
      playPartyShuttleJingle();
    } else {
      const correctCount = blankActs.filter((act) => placement[act.id] === act.id).length;
      resultEl.textContent = `${correctCount} von ${BLANK_COUNT} richtig -- rot markierte Felder nochmal verschieben und erneut prüfen.`;
      resultEl.className = "setlist-result setlist-result--fail";
      playSwitchCrashSound();
    }
  }

  function startNewRound(): void {
    checked = false;
    allCorrect = false;
    resultEl.textContent = "";
    resultEl.className = "setlist-result";
    blankActs = pickBlanks();
    placement = {};
    for (const act of blankActs) placement[act.id] = null;
    sidebarOrder = shuffled(blankActs.map((a) => a.id));
    // Felder der VORHERIGEN Runde, die diesmal nicht mehr Luecke sind,
    // muessen zurueck auf ihren festen Namen -- sonst bliebe z. B. ein
    // (evtl. sogar falsch) hineingezogener Chip aus der letzten Runde
    // dauerhaft im "fertigen" Zeitplan stehen.
    applyFixedActs();
    for (const act of blankActs) updateSlot(act.id);
    renderSidebar();
  }

  // ---------------------------------------------------------- Aufbau/Setup

  function buildSchedule(): void {
    scheduleHost.innerHTML = "";
    for (const stage of FESTIVAL_SETLIST) {
      const stageEl = document.createElement("div");
      stageEl.className = "setlist-stage";

      const stageTitle = document.createElement("div");
      stageTitle.className = "setlist-stage__title";
      stageTitle.textContent = stage.name;
      stageEl.appendChild(stageTitle);

      const daysRow = document.createElement("div");
      daysRow.className = "setlist-stage__days";
      for (const dayCol of stage.days) {
        const colEl = document.createElement("div");
        colEl.className = "setlist-day-column";

        const dayTitle = document.createElement("div");
        dayTitle.className = "setlist-day-column__title";
        dayTitle.textContent = dayCol.day;
        colEl.appendChild(dayTitle);

        for (const act of dayCol.acts) {
          const row = document.createElement("div");
          row.className = "setlist-act-row" + (act.special ? " setlist-act-row--special" : "");

          const time = document.createElement("span");
          time.className = "setlist-act-row__time";
          time.textContent = act.time;
          row.appendChild(time);

          if (act.special) {
            const name = document.createElement("span");
            name.className = "setlist-act-row__name";
            name.textContent = act.name;
            row.appendChild(name);
          } else {
            const slot = document.createElement("div");
            slot.className = "setlist-slot";
            slot.dataset.slotId = act.id;
            row.appendChild(slot);
            slotEls[act.id] = slot;
            actLookup.set(act.id, act);
          }

          colEl.appendChild(row);
        }
        daysRow.appendChild(colEl);
      }
      stageEl.appendChild(daysRow);
      scheduleHost.appendChild(stageEl);
    }
    applyFixedActs();
  }

  /**
   * Setzt jedes Feld, das in der AKTUELLEN Runde (blankActs) keine Luecke
   * ist, auf seinen festen Namen zurueck -- egal, welcher Chip (aus einer
   * frueheren Runde) evtl. noch darin lag. Wird sowohl beim initialen Aufbau
   * als auch bei jeder neuen Runde aufgerufen.
   */
  function applyFixedActs(): void {
    for (const stage of FESTIVAL_SETLIST) {
      for (const dayCol of stage.days) {
        for (const act of dayCol.acts) {
          if (act.special) continue;
          const el = slotEls[act.id];
          if (!el) continue;
          if (!blankActs.some((a) => a.id === act.id)) {
            el.className = "setlist-slot setlist-slot--fixed";
            el.textContent = act.name;
          }
        }
      }
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      panel = document.createElement("div");
      panel.className = "stage-center-panel setlist-panel";
      panel.style.alignItems = "stretch";
      panel.style.justifyContent = "flex-start";

      const layout = document.createElement("div");
      layout.className = "setlist-layout";
      panel.appendChild(layout);

      // ---------------------------------------------------------- Sidebar
      const sidebar = document.createElement("div");
      sidebar.className = "setlist-sidebar";

      const sidebarTitle = document.createElement("div");
      sidebarTitle.className = "setlist-sidebar__title";
      sidebarTitle.textContent = "Fehlende Artists";
      sidebar.appendChild(sidebarTitle);

      const sidebarHint = document.createElement("p");
      sidebarHint.className = "setlist-sidebar__hint";
      sidebarHint.textContent = "Zieh jeden Namen an seinen Platz im Zeitplan.";
      sidebar.appendChild(sidebarHint);

      sidebarChips = document.createElement("div");
      sidebarChips.className = "setlist-sidebar__chips";
      sidebar.appendChild(sidebarChips);

      progressEl = document.createElement("div");
      progressEl.className = "setlist-sidebar__progress";
      sidebar.appendChild(progressEl);

      checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "btn btn--accent";
      checkBtn.style.width = "100%";
      checkBtn.textContent = "Prüfen";
      checkBtn.disabled = true;
      guardedClick(checkBtn, () => checkPuzzle(), 300);
      sidebar.appendChild(checkBtn);

      resultEl = document.createElement("div");
      resultEl.className = "setlist-result";
      sidebar.appendChild(resultEl);

      const newRoundBtn = document.createElement("button");
      newRoundBtn.type = "button";
      newRoundBtn.className = "btn btn--ghost";
      newRoundBtn.style.width = "100%";
      newRoundBtn.style.marginTop = "auto";
      newRoundBtn.textContent = "🔀 Neue Runde";
      guardedClick(newRoundBtn, () => startNewRound(), 400);
      sidebar.appendChild(newRoundBtn);

      layout.appendChild(sidebar);

      // --------------------------------------------------------- Schedule
      scheduleHost = document.createElement("div");
      scheduleHost.className = "setlist-schedule";
      layout.appendChild(scheduleHost);

      env.overlay.appendChild(panel);

      blankActs = pickBlanks();
      placement = {};
      for (const act of blankActs) placement[act.id] = null;
      sidebarOrder = shuffled(blankActs.map((a) => a.id));

      buildSchedule();
      for (const act of blankActs) updateSlot(act.id);
      renderSidebar();

      closeIntro = showGameIntro({
        title: "Setlist-Puzzle",
        description: [
          `${BLANK_COUNT} Artists fehlen im Zeitplan -- ihre Namen liegen links`,
          "Zieh jeden Namen per Antippen und Ziehen an seine Stelle",
          "Ein Feld lässt sich jederzeit wieder verschieben oder tauschen",
          "Erst wenn alle 5 platziert sind, kannst du „Prüfen” antippen",
        ],
        onStart: () => {
          closeIntro = null;
        },
      });
    },

    update() {
      // Reine Eingabesteuerung ueber Pointer-Events, keine laufzeitabhaengige Logik.
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);
    },

    cleanup() {
      closeIntro?.();
      closeIntro = null;
      if (dragging) {
        dragging.ghost.remove();
        window.removeEventListener("pointermove", onDragMove);
        window.removeEventListener("pointerup", onDragEnd);
        window.removeEventListener("pointercancel", onDragEnd);
        dragging = null;
      }
      panel?.remove();
    },
  };
}
