import { openModal } from "./modal";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { icons } from "./icons";

/**
 * Zeigt einen Modal-Dialog mit Bildschirmtastatur zur Namenseingabe an,
 * wenn ein neuer Highscore aufgestellt wurde. Wird von allen Spielen mit
 * Highscore-Funktion genutzt (Verbindungssuche, Weichenspiel, Zug-Spotter,
 * Memory).
 */
export function promptHighscoreName(opts: {
  title?: string;
  message: string;
  onDone: (name: string) => void;
}): () => void {
  return openModal((panel, close) => {
    const iconWrap = document.createElement("div");
    iconWrap.style.width = "40px";
    iconWrap.style.height = "40px";
    iconWrap.style.color = "var(--accent)";
    iconWrap.style.marginBottom = "8px";
    iconWrap.innerHTML = icons.trophy;

    const h2 = document.createElement("h2");
    h2.textContent = opts.title ?? "Neuer Highscore!";

    const p = document.createElement("p");
    p.textContent = opts.message;

    panel.append(iconWrap, h2, p);

    const kb = new OnScreenKeyboard({
      layout: "alphanumeric",
      maxLength: 16,
      placeholder: "Dein Name",
      submitLabel: "Speichern",
      onSubmit: (value) => {
        close();
        opts.onDone(value.trim() || "Anonym");
      },
    });
    kb.mount(panel);
  });
}
