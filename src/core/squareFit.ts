/**
 * Haelt ein Element auf einem festen Seitenverhaeltnis UND garantiert, dass
 * es komplett in seinen Container passt -- sowohl in der Breite als auch in
 * der Hoehe.
 *
 * Reines CSS (width: min(100%, 480px); aspect-ratio: w/h) kennt nur die
 * Breite: auf einem niedrigen/kurzen Bildschirm wird die daraus abgeleitete
 * Hoehe leicht groesser als der tatsaechlich verfuegbare Platz, und der
 * Container muss dann scrollen -- genau das soll bei Spiel-Rastern (Zug-
 * Spotter, Zug-Memory, ...) nicht noetig sein.
 */
export function fitAspectToContainer(
  el: HTMLElement,
  container: HTMLElement,
  aspectW: number,
  aspectH: number,
  maxWidth = 480,
): () => void {
  const ratio = aspectW / aspectH;
  const apply = () => {
    let width = Math.min(container.clientWidth, maxWidth);
    let height = width / ratio;
    if (height > container.clientHeight) {
      height = container.clientHeight;
      width = height * ratio;
    }
    el.style.width = `${Math.max(0, width)}px`;
    el.style.height = `${Math.max(0, height)}px`;
  };
  apply();
  const resizeObserver = new ResizeObserver(apply);
  resizeObserver.observe(container);
  return () => resizeObserver.disconnect();
}

export function fitSquareToContainer(el: HTMLElement, container: HTMLElement, maxSize = 480): () => void {
  return fitAspectToContainer(el, container, 1, 1, maxSize);
}
