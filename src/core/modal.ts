/**
 * Kleiner Modal-Helfer fuer Overlays (Admin-Login, Highscore-Namenseingabe,
 * Spielfeld-Groesse waehlen, ...). Klick auf den Scrim schliesst NICHT
 * automatisch -- auf einem Kiosk ohne Escape-Taste soll ein Dialog nur ueber
 * einen expliziten Button verlassen werden koennen, sonst tippt man sich
 * versehentlich raus.
 */
export function openModal(
  build: (panel: HTMLDivElement, close: () => void) => void,
  opts: { wide?: boolean } = {},
): () => void {
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";

  const panel = document.createElement("div");
  panel.className = "modal-panel" + (opts.wide ? " modal-panel--wide" : "");
  scrim.appendChild(panel);

  document.body.appendChild(scrim);

  const close = () => scrim.remove();
  build(panel, close);
  return close;
}
