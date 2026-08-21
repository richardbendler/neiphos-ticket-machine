import { openModal } from "./modal";
import paperRollOrientationUrl from "../assets/printer/paper-roll-orientation.png";
import paperHatchLocationUrl from "../assets/printer/paper-hatch-location.jpg";

/**
 * Kleine Anleitung zum Papierwechsel am Bondrucker -- aufrufbar sowohl aus
 * dem Fehler-Dialog nach einem fehlgeschlagenen Ticket-Druck (siehe core/
 * highscorePrompt.ts, nur bei error==="paper_empty") als auch aus dem
 * Admin-Testdruck (siehe admin/AdminPanel.ts). Zwei Bilder: ein echtes Foto
 * des Automaten mit Pfeil auf die kleine Klappe unten am roten Gehaeuse (an
 * der Schnur zu erkennen), in der die Ersatzrollen liegen, und danach die
 * Skizze mit der korrekten Einlegerichtung der Rolle (Papier kommt UNTEN an
 * der Rolle heraus) -- von der Orga bereitgestellt.
 */
export function openPaperChangeInstructions(): void {
  openModal((panel, close) => {
    const h2 = document.createElement("h2");
    h2.textContent = "Papier wechseln";
    panel.appendChild(h2);

    const p1 = document.createElement("p");
    p1.style.fontSize = "0.92rem";
    p1.textContent = "Die Ersatzrollen liegen in der kleinen Klappe unten am Automaten (an der Schnur zu erkennen, siehe Foto):";
    panel.appendChild(p1);

    const hatchImg = document.createElement("img");
    hatchImg.src = paperHatchLocationUrl;
    hatchImg.alt = "Foto: Pfeil zeigt auf die Klappe mit den Ersatz-Papierrollen unten am Automaten";
    hatchImg.style.width = "100%";
    hatchImg.style.maxWidth = "260px";
    hatchImg.style.display = "block";
    hatchImg.style.margin = "12px auto";
    hatchImg.style.borderRadius = "var(--radius-sm)";
    hatchImg.style.border = "1px solid var(--panel-border)";
    panel.appendChild(hatchImg);

    const p = document.createElement("p");
    p.style.fontSize = "0.92rem";
    p.textContent =
      "Schnapp dir eine Rolle von dort und pack sie hinter die rote Klappe im Ticketdrucker. Die Rolle muss so eingelegt werden, dass das Papier UNTEN an der Rolle herauskommt (siehe Skizze) -- andersherum eingelegt druckt der Drucker nicht.";
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
