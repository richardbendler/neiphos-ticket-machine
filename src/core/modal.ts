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
  opts: { wide?: boolean; onClose?: () => void } = {},
): () => void {
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";

  const panel = document.createElement("div");
  panel.className = "modal-panel" + (opts.wide ? " modal-panel--wide" : "");
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
