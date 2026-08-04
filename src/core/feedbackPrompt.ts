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
        multiline: true,
        rows: 5,
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
    // wide: breiteres Modal-Panel (siehe modal.ts) -- die Tastatur soll fuer
    // laengere Freitext-Eingaben mehr Breite nutzen duerfen als z. B. bei
    // der kurzen Highscore-Namenseingabe.
    { wide: true },
  );
}
