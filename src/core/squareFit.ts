/**
 * Haelt ein Element quadratisch UND garantiert, dass es komplett in seinen
 * Container passt -- sowohl in der Breite als auch in der Hoehe.
 *
 * Reines CSS (width: min(100%, 480px); aspect-ratio: 1/1) kennt nur die
 * Breite: auf einem niedrigen/kurzen Bildschirm wird die daraus abgeleitete
 * Hoehe leicht groesser als der tatsaechlich verfuegbare Platz, und der
 * Container muss dann scrollen -- genau das soll bei Spiel-Rastern (Zug-
 * Spotter, Zug-Memory, ...) nicht noetig sein.
 */
export function fitSquareToContainer(el: HTMLElement, container: HTMLElement, maxSize = 480): () => void {
  const apply = () => {
    const size = Math.max(0, Math.min(container.clientWidth, container.clientHeight, maxSize));
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  };
  apply();
  const resizeObserver = new ResizeObserver(apply);
  resizeObserver.observe(container);
  return () => resizeObserver.disconnect();
}
