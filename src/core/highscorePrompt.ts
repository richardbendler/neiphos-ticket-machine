import { openModal } from "./modal";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { icons } from "./icons";
import { playHighscoreOpenSound } from "./sound";
import { printTicket } from "./ticket";

/**
 * Zeigt einen Modal-Dialog mit Bildschirmtastatur zur Namenseingabe an,
 * wenn ein neuer Highscore aufgestellt wurde. Wird von allen Spielen mit
 * Highscore-Funktion genutzt (Verbindungssuche, Weichenspiel, Zug-Spotter,
 * Memory, ...).
 *
 * Zwei Wege zum Speichern, auf ausdruecklichen Wunsch: der normale
 * "Speichern"-Weg (Tastatur-eigener Button) speichert nur den Namen wie
 * bisher. Der zusaetzliche "Speichern und als Ticket drucken"-Button
 * (eigenes, auffaelliges Element MIT Ticket-Symbol, damit klar ist, dass es
 * ein zweiter, eigenstaendiger Weg ist) speichert GENAUSO den Namen, druckt
 * aber zusaetzlich ein Bar-Freigetraenk-Ticket (siehe core/ticket.ts) und
 * zeigt danach noch einen Hinweis auf den Shot an der Bar.
 */
export function promptHighscoreName(opts: {
  title?: string;
  message: string;
  /** Fuer den Ticket-Druck: Spielname und formatierter Punktestand (siehe core/ticket.ts#TicketFields). */
  gameTitle: string;
  scoreText: string;
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

      // Zweiter, gleichwertig grosser Weg: Name UND Ticket -- eigenes,
      // farblich abgesetztes Element mit Ticket-Symbol, direkt unter der
      // Tastatur, damit auf den ersten Blick klar ist, dass es zusaetzlich
      // zum normalen "Speichern" (in der Tastatur) noch diese zweite
      // Moeglichkeit gibt.
      const printBtn = document.createElement("button");
      printBtn.type = "button";
      printBtn.className = "btn hs-print-btn";
      printBtn.style.width = "100%";
      printBtn.style.marginTop = "10px";
      printBtn.innerHTML = `<span class="btn__icon">${icons.ticket}</span>Speichern und als Ticket drucken`;
      printBtn.addEventListener("click", () => {
        const trimmed = kb.getValue().trim();
        close();
        opts.onDone(trimmed || null);
        void printTicket({ name: trimmed, game: opts.gameTitle, score: opts.scoreText }).then((result) => {
          showTicketPrintResult(result);
        });
      });
      panel.appendChild(printBtn);

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

/** Eigener kleiner Folge-Dialog NUR nach "Speichern und als Ticket drucken" (siehe promptHighscoreName) -- meldet entweder den Bar-Hinweis oder, falls der Druck fehlschlug, eine kurze Fehlermeldung. */
function showTicketPrintResult(result: { ok: boolean; error?: string }): void {
  openModal((panel, close) => {
    const iconWrap = document.createElement("div");
    iconWrap.style.width = "40px";
    iconWrap.style.height = "40px";
    iconWrap.style.color = result.ok ? "var(--accent)" : "var(--danger)";
    iconWrap.style.marginBottom = "8px";
    iconWrap.innerHTML = result.ok ? icons.ticket : icons.close;

    const h2 = document.createElement("h2");
    h2.textContent = result.ok ? "Dein Ticket wird gedruckt!" : "Ticket konnte nicht gedruckt werden";
    panel.appendChild(iconWrap);
    panel.appendChild(h2);

    const p = document.createElement("p");
    p.style.fontSize = "0.95rem";
    p.textContent = result.ok
      ? "Mit diesem Ticket kannst du dir nun einen Shot an der Bar abholen. Lass es vorher noch beim Schaffner stempeln."
      : `Bitte am Automaten melden. ${result.error ? `(${result.error})` : ""}`.trim();
    panel.appendChild(p);

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn--accent";
    okBtn.style.width = "100%";
    okBtn.style.marginTop = "12px";
    okBtn.textContent = "Alles klar";
    okBtn.addEventListener("click", close);
    panel.appendChild(okBtn);
  });
}
