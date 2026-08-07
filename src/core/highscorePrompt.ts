import { openModal } from "./modal";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { icons } from "./icons";
import { playHighscoreOpenSound } from "./sound";

/**
 * Zeigt einen Modal-Dialog mit Bildschirmtastatur zur Namenseingabe an,
 * wenn ein neuer Highscore aufgestellt wurde. Wird von allen Spielen mit
 * Highscore-Funktion genutzt (Verbindungssuche, Weichenspiel, Zug-Spotter,
 * Memory).
 */
export function promptHighscoreName(opts: {
  title?: string;
  message: string;
  /** null bedeutet: Nutzer hat keinen Namen eingetragen -- dann darf gar kein Highscore gespeichert werden. */
  onDone: (name: string | null) => void;
}): () => void {
  return openModal(
    (panel, close) => {
      // Direkt beim Aufploppen dieses Dialogs, nicht erst beim Speichern/
      // Schliessen -- der Dialog erscheint ohnehin nur, wenn wirklich ein
      // neuer/eingestellter Highscore erzielt wurde (siehe Aufrufer, die alle
      // vorher getHighscoreOutcome() != "none" pruefen), das Ereignis selbst
      // ist also schon beim Erscheinen feststehend (gemeldeter Wunsch: Sound
      // soll den Moment "Highscore erzielt" markieren, nicht "Name gespeichert").
      // Dieselbe DB-Ansage wie beim Oeffnen des Highscore-Boards (siehe
      // Router.ts) -- der vorherige eigens komponierte Chime wurde als
      // unpassend empfunden ("dieser komische Sound").
      playHighscoreOpenSound();

      const iconWrap = document.createElement("div");
      iconWrap.style.width = "40px";
      iconWrap.style.height = "40px";
      iconWrap.style.color = "var(--accent)";
      iconWrap.style.marginBottom = "8px";
      iconWrap.innerHTML = icons.trophy;

      const h2 = document.createElement("h2");
      h2.textContent = opts.title ?? "Neuer Highscore!";
      // Deutlich groesser als der generische Modal-Titel (1.3rem) -- das ist
      // der aufregende Teil dieses speziellen Dialogs, soll auf den ersten
      // Blick auffallen.
      h2.style.fontSize = "1.6rem";

      const p = document.createElement("p");
      p.textContent = opts.message;
      // Groesser als ein generischer Modal-Absatz (0.9rem), aber weiterhin
      // klar kleiner als die Ueberschrift oben -- enthaelt den eigentlichen
      // erzielten Wert, soll also deutlich lesbarer sein als bisher, ohne die
      // Ueberschrift zu ueberragen.
      p.style.fontSize = "1.15rem";
      p.style.fontWeight = "700";
      p.style.color = "var(--text)";

      panel.append(iconWrap, h2, p);

      const kb = new OnScreenKeyboard({
        layout: "alphanumeric",
        maxLength: 16,
        placeholder: "Dein Name",
        submitLabel: "Speichern",
        onSubmit: (value) => {
          close();
          const trimmed = value.trim();
          opts.onDone(trimmed || null);
        },
      });
      kb.mount(panel);

      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "btn btn--ghost";
      skipBtn.style.width = "100%";
      skipBtn.style.marginTop = "8px";
      skipBtn.textContent = "Nicht speichern";
      skipBtn.addEventListener("click", () => {
        close();
        opts.onDone(null);
      });
      panel.appendChild(skipBtn);
    },
    // War als einziger der drei Tastatur-Dialoge (Highscore/Admin-Login/
    // Feedback) OHNE eigene Breiten-Option unterwegs, wirkte dadurch
    // spuerbar kleiner als die anderen beiden (gemeldet) -- jetzt dieselbe
    // responsive Breite wie Admin-Login/Feedback, siehe .modal-panel--keyboard.
    { keyboard: true },
  );
}
