/**
 * Steuert den (auf ausdruecklichen Wunsch nur noch wegklickbaren statt
 * hart blockierenden) Querformat-Hinweis, siehe style.css#orientation-lock
 * fuer die eigentliche Anzeige-/Verstecklogik per Media-Query. Diese Datei
 * kuemmert sich nur um das eine bisschen JS-Zustand, das reines CSS nicht
 * leisten kann: sich merken, dass "Trotzdem im Hochformat weiter" angetippt
 * wurde.
 */
export function initOrientationHint(): void {
  const dismissBtn = document.getElementById("orientation-lock-dismiss");
  dismissBtn?.addEventListener("click", () => {
    document.documentElement.classList.add("orientation-dismissed");
  });

  // Sobald das Geraet zurueck ins Querformat gedreht wird, den Hinweis
  // wieder "scharf" schalten -- dreht man spaeter erneut zurueck ins
  // Hochformat, soll der Hinweis frisch erscheinen (statt dauerhaft fuer den
  // Rest der Sitzung unterdrueckt zu bleiben, nur weil er mal weggeklickt
  // wurde).
  window.matchMedia("(orientation: landscape)").addEventListener("change", (e) => {
    if (e.matches) document.documentElement.classList.remove("orientation-dismissed");
  });
}
