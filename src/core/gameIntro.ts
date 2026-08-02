import { openModal } from "./modal";

/**
 * Kurzer Anleitungs-Dialog, den jedes Spiel beim Start zeigt: Titel +
 * ein bis zwei Saetze, was zu tun ist, dann ein "Los geht's"-Button. Erst
 * danach beginnt das eigentliche Spiel (Timer/Countdown/Loop-Start liegt in
 * onStart). Einheitlich fuer alle Minigames, damit man nicht raten muss,
 * was zu tun ist.
 */
export function showGameIntro(opts: { title: string; description: string; startLabel?: string; onStart: () => void }): () => void {
  return openModal((panel, close) => {
    const h2 = document.createElement("h2");
    h2.textContent = opts.title;

    const p = document.createElement("p");
    p.textContent = opts.description;

    panel.append(h2, p);

    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "btn btn--accent";
    startBtn.style.width = "100%";
    startBtn.style.marginTop = "12px";
    startBtn.textContent = opts.startLabel ?? "Los geht's";
    startBtn.addEventListener("click", () => {
      close();
      opts.onStart();
    });
    panel.appendChild(startBtn);
  });
}
