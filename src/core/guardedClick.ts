/**
 * Verhindert, dass ein Button bei schnellem Mehrfach-Antippen ("Spam") --
 * ob absichtlich oder durch Ghost-Touches auf dem Kiosk-Touchscreen (siehe
 * core/kiosk.ts) -- seinen Handler mehrfach kurz hintereinander ausloest.
 *
 * Gemeldeter Bug: mehrfaches schnelles Antippen z. B. des Admin-Buttons
 * stapelte mehrere komplette Admin-Panels uebereinander, jedes mit eigenen
 * Netzwerk-Anfragen (Lautstaerke/WLAN, server/serve.js ruft dafuer wpctl/
 * nmcli auf) -- mehrere gleichzeitige nmcli-Aufrufe (WLAN-Scan hat bis zu
 * 15s Timeout) ueberlasteten die schwache Pi-Hardware fuer sehr lange Zeit.
 */
const lastFired = new WeakMap<Element, number>();

export function guardedClick(el: HTMLElement, handler: (e: MouseEvent) => void, cooldownMs = 700): void {
  el.addEventListener("click", (e) => {
    const now = performance.now();
    const last = lastFired.get(el) ?? 0;
    if (now - last < cooldownMs) return;
    lastFired.set(el, now);
    handler(e as MouseEvent);
  });
}
