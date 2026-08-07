/**
 * Kleiner Modal-Helfer fuer Overlays (Admin-Login, Highscore-Namenseingabe,
 * Spielfeld-Groesse waehlen, ...). Klick auf den Scrim schliesst NICHT
 * automatisch -- auf einem Kiosk ohne Escape-Taste soll ein Dialog nur ueber
 * einen expliziten Button verlassen werden koennen, sonst tippt man sich
 * versehentlich raus.
 *
 * Alle offenen Modals werden in einem kleinen Stack verfolgt, damit der
 * permanente "Zurueck zum Menue"-Button (siehe Router.ts) jederzeit --
 * auch waehrend z. B. ein Spiel-Anleitungs- oder Highscore-Dialog offen ist
 * -- wirklich alles schliessen kann, bevor er ins Hauptmenue wechselt.
 */

const openModals: Array<() => void> = [];

export function openModal(
  build: (panel: HTMLDivElement, close: () => void) => void,
  opts: { wide?: boolean; keyboard?: boolean; onClose?: () => void } = {},
): () => void {
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";

  const panel = document.createElement("div");
  // keyboard: eigene, responsive (vw-basierte statt fest 720px) Breite fuer
  // Modals mit Bildschirmtastatur (Highscore-Namenseingabe, Admin-Login,
  // Feedback) -- siehe .modal-panel--keyboard in style.css. Schliesst sich
  // mit wide gegenseitig aus, keyboard gewinnt, falls beide gesetzt waeren.
  panel.className = "modal-panel" + (opts.keyboard ? " modal-panel--keyboard" : opts.wide ? " modal-panel--wide" : "");
  scrim.appendChild(panel);

  document.body.appendChild(scrim);

  const close = () => {
    scrim.remove();
    const idx = openModals.indexOf(close);
    if (idx !== -1) openModals.splice(idx, 1);
    // Feuert auch, wenn ueber closeAllModals() (z.B. globaler "Menü"-Button
    // waehrend das Modal offen ist) statt ueber einen eigenen Zurueck-
    // Button geschlossen wird -- Aufrufer sollen sich darauf verlassen
    // koennen, unabhaengig vom Schliessweg.
    opts.onClose?.();
  };
  openModals.push(close);

  build(panel, close);
  return close;
}

/** Schliesst alle aktuell offenen Modals (unabhaengig davon, welches Spiel/welcher Dialog sie geoeffnet hat). */
export function closeAllModals(): void {
  for (const close of [...openModals]) close();
}

/**
 * Ob gerade mindestens ein Modal offen ist -- genutzt vom GameLoop (siehe
 * Router.ts), um Canvas-update()/render() zu pausieren, waehrend z. B. die
 * Highscore-Namenseingabe mit Bildschirmtastatur offen ist. Auf dem
 * Raspberry Pi 3 zeigte eine Live-Messung (top waehrend des Tippens), dass
 * Renderer- UND GPU-Prozess auf ueber 90% CPU sprangen, weil das darunter-
 * liegende Spiel unveraendert mit 60fps weiterrenderte (der Scrim ist
 * halbtransparent, das Spielfeld bleibt sichtbar) und so mit der Tastatur-
 * Eingabeverarbeitung um denselben Hauptthread konkurrierte -- spuerbar als
 * "schwerfaelliges" Tippen/Tippen mit Verzoegerung.
 */
export function hasOpenModal(): boolean {
  return openModals.length > 0;
}
