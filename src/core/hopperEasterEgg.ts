import { hopperAnimalCards } from "../data/hopperAnimals";
import { openModal, hasOpenModal } from "./modal";

/**
 * Kleines Easter Egg auf ausdruecklichen Wunsch: in unregelmaessigen
 * Abstaenden (1-5 Minuten) laeuft ein zufaelliges Huepftier quer ueber den
 * Bildschirm entlang -- entweder an der Unterkante der Kopfleiste, an der
 * Unterkante der Fussleiste (aber vollstaendig sichtbar, nicht am echten
 * Bildschirmrand abgeschnitten), oder (nur im Hauptmenue) entlang der
 * duennen Trennlinie unter "Bitte Spiel wählen." (siehe .menu-header in
 * style.css). Tippt man es an, ist es "gefangen" -- verschwindet sofort und
 * zeigt eine kleine Glueckwunsch-Meldung, ohne echten Spielwert.
 */

const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 5 * 60_000;
const WALK_DURATION_S = 9;
// Auf ausdruecklichen Wunsch prozentual zur Bildschirmgroesse statt eines
// festen Pixelwerts (war 40) -- an der Kopfleisten-Hoehe orientiert (die ist
// bereits selbst prozentual zur Bildschirmhoehe, siehe --header-h), "soll
// schon relativ klein sein, ein Fuenftel so hoch wie der Header".
const HOPPER_SIZE_RATIO = 0.2;
const MIN_HOPPER_SIZE_PX = 14;

function measureHopperSize(): number {
  const header = document.querySelector(".chrome-bar");
  const headerHeight = header ? header.getBoundingClientRect().height : 60;
  return Math.max(MIN_HOPPER_SIZE_PX, Math.round(headerHeight * HOPPER_SIZE_RATIO));
}

type PathChoice = { centerY: number };

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNext(delayMs: number = randomDelay()): void {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  scheduledTimer = setTimeout(trySpawn, delayMs);
}

function trySpawn(): void {
  // Waehrend ein Dialog/eine Tastatur offen ist, lieber kurz zurueckstellen
  // statt ueber dem Dialog entlangzulaufen (verwirrend/ablenkend) -- ein
  // paar Sekunden frueher oder spaeter macht bei einem reinen Easter Egg
  // ohnehin keinen Unterschied.
  if (hasOpenModal()) {
    scheduleNext(10_000);
    return;
  }
  spawnHopper();
  scheduleNext();
}

/** Waehlt zufaellig eine der aktuell verfuegbaren Linien -- die Menue-Trennlinie existiert nur, wenn gerade das Hauptmenue angezeigt wird. */
function pickPath(hopperSize: number): PathChoice | null {
  const candidates: PathChoice[] = [];

  const header = document.querySelector(".chrome-bar");
  if (header) {
    const r = header.getBoundingClientRect();
    candidates.push({ centerY: r.bottom - hopperSize / 2 - 2 });
  }

  const footer = document.querySelector(".chrome-footer-bar");
  if (footer) {
    const r = footer.getBoundingClientRect();
    // Etwas mehr Abstand zur Unterkante als beim Header (siehe hopperSize/
    // -Abzug oben) -- soll komplett INNERHALB der Fussleiste sichtbar bleiben,
    // nicht am echten Bildschirmrand ueberstehen (auf ausdruecklichen Wunsch).
    candidates.push({ centerY: r.bottom - hopperSize / 2 - 6 });
  }

  const menuHeader = document.querySelector(".menu-header");
  if (menuHeader) {
    const r = menuHeader.getBoundingClientRect();
    candidates.push({ centerY: r.bottom - hopperSize / 2 });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function showCaughtModal(): void {
  openModal((panel, close) => {
    const iconWrap = document.createElement("div");
    iconWrap.style.fontSize = "clamp(20px, 6vh, 48px)";
    iconWrap.style.marginBottom = "clamp(2px, 1vh, 8px)";
    iconWrap.textContent = "🎉";
    panel.appendChild(iconWrap);

    const h2 = document.createElement("h2");
    h2.textContent = "Hüpftier gefangen!";
    panel.appendChild(h2);

    const p = document.createElement("p");
    p.textContent = "Herzlichen Glückwunsch, du hast das Hüpftier gefangen. Das bringt dir zwar nichts, aber trotzdem: Glückwunsch!";
    panel.appendChild(p);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn--accent";
    okBtn.style.width = "100%";
    okBtn.style.marginTop = "12px";
    okBtn.textContent = "Yay!";
    okBtn.addEventListener("click", close);
    panel.appendChild(okBtn);
  });
}

function spawnHopper(): void {
  const hopperSize = measureHopperSize();
  const choice = pickPath(hopperSize);
  if (!choice) return;

  const card = hopperAnimalCards[Math.floor(Math.random() * hopperAnimalCards.length)];
  const leftToRight = Math.random() < 0.5;

  const el = document.createElement("button");
  el.type = "button";
  el.className = `hopper-easter-egg ${leftToRight ? "hopper-easter-egg--ltr" : "hopper-easter-egg--rtl"}`;
  el.style.top = `${Math.round(choice.centerY - hopperSize / 2)}px`;
  el.style.width = `${hopperSize}px`;
  el.style.height = `${hopperSize}px`;
  el.style.setProperty("--hopper-duration", `${WALK_DURATION_S}s`);
  el.setAttribute("aria-label", "Verstecktes Hüpftier");

  const img = document.createElement("img");
  img.src = card.image;
  img.alt = "";
  el.appendChild(img);

  const catchHopper = (): void => {
    el.remove();
    showCaughtModal();
  };
  el.addEventListener("click", catchHopper);
  // Ist die Laufzeit einmal abgelaufen (nicht gefangen), einfach entfernen --
  // animation-fill-mode:forwards (siehe style.css) liesse es sonst am
  // jenseitigen Bildschirmrand einfach "stehen" bleiben.
  el.addEventListener("animationend", () => el.remove());

  document.body.appendChild(el);
}

/** Einmalig beim App-Start aufzurufen (siehe main.ts). */
export function initHopperEasterEgg(): void {
  scheduleNext();
}
