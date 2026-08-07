import { openModal } from "./modal";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { submitFeedback } from "./feedback";

/** Freitext-Feedback-Dialog, ueber Bildschirmtastatur bedienbar (kein Verlassen des Kiosk-Modus fuer eine Hardware-Tastatur noetig). */
export function openFeedbackDialog(): void {
  openModal(
    (panel, close) => {
      const h2 = document.createElement("h2");
      h2.textContent = "Feedback geben";

      const p = document.createElement("p");
      p.textContent = "Was können wir besser machen?";

      const status = document.createElement("div");
      status.style.minHeight = "1.2em";
      status.style.fontSize = "0.85rem";
      status.style.color = "var(--text-muted)";

      panel.append(h2, p, status);

      let sending = false;

      const kb = new OnScreenKeyboard({
        layout: "alphanumeric",
        maxLength: 240,
        placeholder: "Deine Nachricht",
        submitLabel: "Senden",
        // Mehrzeiliges, umbrechendes Eingabefeld statt der sonst einzeiligen
        // Anzeige -- Feedback-Texte sind oft laenger als ein Highscore-Name
        // und liefen vorher ohne Umbruch seitlich aus dem Feld heraus.
        // War 5 Zeilen -- seit die Tastatur selbst deutlich groesser ist
        // (siehe .osk__key), liess das die untere Tastenreihe (Leerzeichen/
        // Senden) aus dem sichtbaren Bereich rutschen, ohne dass auf den
        // ersten Blick klar war, dass man dafuer erst scrollen muesste.
        multiline: true,
        rows: 3,
        onSubmit: (value) => {
          if (sending) return;
          if (!value.trim()) {
            status.textContent = "Bitte erst etwas eintippen.";
            status.style.color = "var(--danger)";
            return;
          }
          sending = true;
          status.textContent = "Wird gespeichert …";
          status.style.color = "var(--text-muted)";
          submitFeedback(value).then(() => {
            status.textContent = "Danke für dein Feedback!";
            status.style.color = "var(--success)";
            setTimeout(close, 1100);
          });
        },
      });
      kb.mount(panel);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn--ghost";
      cancelBtn.style.width = "100%";
      cancelBtn.style.marginTop = "8px";
      cancelBtn.textContent = "Abbrechen";
      cancelBtn.addEventListener("click", close);
      panel.appendChild(cancelBtn);
    },
    // keyboard: responsives, breiteres Modal-Panel (siehe modal.ts/
    // .modal-panel--keyboard) -- dieselbe Breite wie Highscore-/Admin-Login-
    // Tastatur, auf ausdruecklichen Wunsch. Fuer laengere Freitext-Eingaben
    // ohnehin sinnvoll, mehr Breite zu nutzen als bei der kurzen Highscore-
    // Namenseingabe.
    { keyboard: true },
  );
}
