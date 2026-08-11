import { openModal } from "./modal";
import paperRollOrientationUrl from "../assets/printer/paper-roll-orientation.png";

/**
 * Kleine Anleitung zum Papierwechsel am Bondrucker -- aufrufbar sowohl aus
 * dem Fehler-Dialog nach einem fehlgeschlagenen Ticket-Druck (siehe core/
 * highscorePrompt.ts, nur bei error==="paper_empty") als auch aus dem
 * Admin-Testdruck (siehe admin/AdminPanel.ts). Die Skizze zeigt die
 * korrekte Einlegerichtung der Rolle (Papier kommt UNTEN an der Rolle
 * heraus) -- von der Orga bereitgestellt.
 */
export function openPaperChangeInstructions(): void {
  openModal((panel, close) => {
    const h2 = document.createElement("h2");
    h2.textContent = "Papier wechseln";
    panel.appendChild(h2);

    const p = document.createElement("p");
    p.style.fontSize = "0.92rem";
    p.textContent =
      "Schnapp dir eine Rolle, die im Kartenterminal steht, und pack sie hinter die rote Klappe im Ticketdrucker. Die Rolle muss so eingelegt werden, dass das Papier UNTEN an der Rolle herauskommt (siehe Skizze) -- andersherum eingelegt druckt der Drucker nicht.";
    panel.appendChild(p);

    const img = document.createElement("img");
    img.src = paperRollOrientationUrl;
    img.alt = "Skizze: Papierrolle richtig herum einlegen";
    img.style.width = "100%";
    img.style.maxWidth = "260px";
    img.style.display = "block";
    img.style.margin = "12px auto";
    img.style.borderRadius = "var(--radius-sm)";
    img.style.border = "1px solid var(--panel-border)";
    panel.appendChild(img);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn--accent";
    okBtn.style.width = "100%";
    okBtn.style.marginTop = "8px";
    okBtn.textContent = "Alles klar";
    okBtn.addEventListener("click", close);
    panel.appendChild(okBtn);
  });
}
