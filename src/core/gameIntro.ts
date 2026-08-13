import { openModal } from "./modal";

/**
 * Kurzer Anleitungs-Dialog, den jedes Spiel beim Start zeigt: Titel + ein
 * paar knappe Stichpunkte, was zu tun ist, dann ein "Los geht's"-Button.
 * Erst danach beginnt das eigentliche Spiel (Timer/Countdown/Loop-Start
 * liegt in onStart). Einheitlich fuer alle Minigames, damit man nicht raten
 * muss, was zu tun ist. Stichpunkte statt Fliesstext, damit man die
 * Anleitung auf dem Kiosk-Bildschirm schnell ueberfliegen kann statt einen
 * ganzen Absatz lesen zu muessen.
 */
export function showGameIntro(opts: { title: string; description: string[]; startLabel?: string; onStart: () => void }): () => void {
  return openModal((panel, close) => {
    panel.classList.add("game-intro-panel");
    const h2 = document.createElement("h2");
    h2.textContent = opts.title;
    panel.appendChild(h2);

    const list = document.createElement("ul");
    list.className = "game-intro-list";
    for (const point of opts.description) {
      const li = document.createElement("li");
      li.textContent = point;
      list.appendChild(li);
    }
    panel.appendChild(list);

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "btn btn--accent";
    startBtn.style.width = "100%";
    startBtn.style.marginTop = "clamp(4px, 1.6vh, 12px)";
    startBtn.textContent = opts.startLabel ?? "Los geht's";
    startBtn.addEventListener("click", () => {
      close();
      opts.onStart();
    });
    panel.appendChild(startBtn);
  });
}
