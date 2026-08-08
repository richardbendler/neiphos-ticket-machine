import { icons } from "./icons";

/**
 * Baut einen Button im EXAKT gleichen Design wie der permanente
 * "Menü"-Button oben links (.chrome-menu-btn, siehe Router.ts) -- zum
 * Wiederverwenden auf den Spielende-Bildschirmen ("Nochmal spielen"/andere
 * Geschwindigkeit/Schwierigkeit wählen), die vorher keinen eigenen Weg
 * zurück ins Hauptmenü hatten (gemeldet, man musste dafür immer den
 * kleineren, weiter entfernten Kopfleisten-Button treffen). Die Klasse
 * .chrome-menu-btn selbst setzt keine Position (das macht nur ihr
 * Kopfleisten-Elternelement), laesst sich also gefahrlos auch mitten in
 * einem normalen Spielende-Panel einsetzen.
 */
export function buildMenuButton(onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chrome-menu-btn";
  btn.innerHTML = `${icons.exit}<span>Menü</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}
