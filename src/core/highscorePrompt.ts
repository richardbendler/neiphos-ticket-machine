import { openModal } from "./modal";
import { OnScreenKeyboard } from "./OnScreenKeyboard";
import { icons } from "./icons";
import { playHighscoreOpenSound } from "./sound";
import { printTicket, friendlyPrintErrorMessage, type TicketVariant, type TicketFields, type PrintTicketResult } from "./ticket";
import type { TicketReasonKind } from "./ticketMethods";
import { openPaperChangeInstructions } from "./paperChangeInstructions";
import { getTicketCooldownRemainingMs, formatCooldownRemainingRough, recordTicketPrinted } from "./ticketCooldown";

const TICKET_VARIANT_BY_REASON: Record<Exclude<TicketReasonKind, null>, TicketVariant> = {
  highscore: "highscore",
  dailyBoard: "dailyHighscore",
  milestone: "milestone",
};

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
  /**
   * Welcher Verdienstweg (falls ueberhaupt einer) das Ticket ausloest --
   * null bedeutet: kein Ticket-Button. Bestimmt sowohl, OB der Ticket-
   * Druck-Button ueberhaupt angezeigt wird (der Dialog selbst kann auch
   * OHNE einen aktuellen Highscore erscheinen, z. B. bei einem erreichten
   * Meilenstein oder Tagesbestwert, siehe core/ticketMethods.ts), als auch
   * WELCHE der drei beschrifteten Ticket-Vorlagen gedruckt wird (siehe
   * core/ticket.ts#TicketVariant).
   */
  ticketReason: TicketReasonKind;
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
      // War fix 40x40px/8px -- auf einem kurzen Bildschirm zusammen mit der
      // Tastatur darunter einer der Hauptgruende, warum dieser Dialog
      // gescrollt werden musste (gemeldeter Bug, siehe .hs-name-actions-
      // Kommentar in style.css fuer die gleichartigen Fixe bei den Buttons
      // darunter).
      iconWrap.style.width = "clamp(16px, 5vh, 40px)";
      iconWrap.style.height = "clamp(16px, 5vh, 40px)";
      iconWrap.style.color = "var(--accent)";
      iconWrap.style.marginBottom = "clamp(2px, 1vh, 8px)";
      iconWrap.innerHTML = icons.trophy;

      const h2 = document.createElement("h2");
      h2.textContent = opts.title ?? "Neuer Highscore!";
      // Deutlich groesser als der generische Modal-Titel (1.3rem) -- das ist
      // der aufregende Teil dieses speziellen Dialogs, soll auf den ersten
      // Blick auffallen. War fix 1.6rem -- blieb dadurch (anders als der
      // generische ".modal-panel h2", siehe dort) auf einem kurzen
      // Bildschirm unveraendert riesig und war einer der Hauptgruende, warum
      // dieser Dialog samt Tastatur darunter gescrollt werden musste
      // (gemeldeter Bug, Tastaturen sollen nie scrollen muessen).
      h2.style.fontSize = "clamp(0.5rem, min(2.85vw, 5vh), 1.6rem)";

      const p = document.createElement("p");
      p.textContent = opts.message;
      // Groesser als ein generischer Modal-Absatz (0.9rem), aber weiterhin
      // klar kleiner als die Ueberschrift oben -- enthaelt den eigentlichen
      // erzielten Wert, soll also deutlich lesbarer sein als bisher, ohne die
      // Ueberschrift zu ueberragen. War fix 1.15rem, gleicher Grund/gleiche
      // Loesung wie bei h2 oben.
      p.style.fontSize = "clamp(0.38rem, min(2.05vw, 3.6vh), 1.15rem)";
      p.style.fontWeight = "700";
      p.style.color = "var(--text)";

      panel.append(iconWrap, h2, p);

      // Auf ausdruecklichen Wunsch getauscht: der Tastatur-eigene
      // Bestaetigen-Button (gold, wird von den meisten intuitiv gedrueckt --
      // urspruenglich genau das Problem, das die farbliche Hervorhebung des
      // Ticket-Buttons loesen sollte) macht jetzt selbst "Speichern und
      // Ticket drucken", wenn ein Ticket-Verdienstweg zutrifft. Der reine
      // "nur speichern"-Weg (ohne Ticket) sitzt stattdessen als eigener,
      // bewusst weniger auffaelliger (kein Puls-Effekt mehr noetig, da die
      // Tastatur selbst schon den Ticket-Weg abdeckt) Button DARUNTER.
      const rawTicketVariant = opts.ticketReason !== null ? TICKET_VARIANT_BY_REASON[opts.ticketReason] : null;
      // Cooldown-Sperre (siehe core/ticketCooldown.ts): waehrend der Cooldown
      // laeuft, verhaelt sich dieser Dialog so, als gaebe es gar keinen
      // Ticket-Verdienstweg -- der Name/Highscore wird trotzdem ganz normal
      // gespeichert (siehe onDone unten), nur der Ticket-Druck faellt fuer
      // diese Runde weg. Ein kurzer Hinweis (siehe unten) erklaert, warum.
      const cooldownRemainingMs = rawTicketVariant !== null ? getTicketCooldownRemainingMs() : 0;
      const cooldownActive = cooldownRemainingMs > 0;
      const ticketVariant = cooldownActive ? null : rawTicketVariant;

      if (cooldownActive) {
        const cooldownNote = document.createElement("p");
        cooldownNote.style.fontSize = "0.85rem";
        cooldownNote.style.color = "var(--text-muted)";
        cooldownNote.textContent = `Ticket-Cooldown aktiv (${formatCooldownRemainingRough(cooldownRemainingMs)}) -- diesmal gibt es kein Ticket, dein Ergebnis wird aber trotzdem gespeichert.`;
        panel.appendChild(cooldownNote);
      }

      // Schuetzt vor einem doppelt ausgeloesten Druckauftrag durch einen
      // Ghost-Touch/Doppel-Tipp auf den Bestaetigen-Key (bekanntes Problem
      // auf diesem Touchscreen, siehe core/guardedClick.ts -- dieser Dialog
      // nutzte das bisher NICHT, obwohl genau so ein doppelter Submit
      // innerhalb kurzer Zeit zwei ueberlappende Druckauftraege ausloesen
      // koennte, gemeldeter Verdacht bei wiederholtem Gibberish-Druckfehler).
      let submitted = false;
      const kb = new OnScreenKeyboard({
        layout: "alphanumeric",
        maxLength: 16,
        placeholder: "Dein Name",
        submitLabel: ticketVariant !== null ? "Speichern & Ticket drucken" : "Speichern",
        onSubmit: (value) => {
          if (submitted) return;
          submitted = true;
          close();
          const trimmed = value.trim();
          opts.onDone(trimmed || null);
          if (ticketVariant !== null) {
            const ticketFields = { name: trimmed, game: opts.gameTitle, score: opts.scoreText };
            // printTicket() wird HIER schon gestartet (nicht erst awaited),
            // showTicketPrintResult zeigt seine Meldung dadurch sofort an,
            // waehrend im Hintergrund gedruckt wird -- siehe dortigen
            // Kommentar.
            const printPromise = printTicket(ticketVariant, ticketFields);
            // Startet den Cooldown erst bei WIRKLICH erfolgreichem Druck --
            // ein fehlgeschlagener Versuch (z. B. Papier leer) hat kein
            // Ticket ausgegeben, soll also auch keinen Cooldown auslösen.
            void printPromise.then((result) => {
              if (result.ok) recordTicketPrinted();
            });
            showTicketPrintResult(printPromise, ticketVariant, ticketFields);
          }
        },
      });
      kb.mount(panel);

      // Gemeinsamer Wrapper statt je eigenem festen marginTop (war 10px/8px)
      // -- auf einem kurzen Bildschirm zusammen mit der Tastatur darueber
      // einer der Hauptgruende, warum dieser Dialog gescrollt werden musste
      // (siehe .hs-name-actions in style.css fuer den vh-gekoppelten
      // Abstand/Innenabstand/Schrift beider Buttons hier).
      const actions = document.createElement("div");
      actions.className = "hs-name-actions";

      if (ticketVariant !== null) {
        const saveOnlyBtn = document.createElement("button");
        saveOnlyBtn.type = "button";
        saveOnlyBtn.className = "btn hs-save-only-btn";
        saveOnlyBtn.textContent = "Speichern (ohne Ticket drucken)";
        saveOnlyBtn.addEventListener("click", () => {
          const trimmed = kb.getValue().trim();
          close();
          opts.onDone(trimmed || null);
        });
        actions.appendChild(saveOnlyBtn);
      }

      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "btn btn--ghost";
      skipBtn.textContent = "Nicht speichern";
      skipBtn.addEventListener("click", () => {
        close();
        opts.onDone(null);
      });
      actions.appendChild(skipBtn);
      panel.appendChild(actions);
    },
    // War als einziger der drei Tastatur-Dialoge (Highscore/Admin-Login/
    // Feedback) OHNE eigene Breiten-Option unterwegs, wirkte dadurch
    // spuerbar kleiner als die anderen beiden (gemeldet) -- jetzt dieselbe
    // responsive Breite wie Admin-Login/Feedback, siehe .modal-panel--keyboard.
    { keyboard: true },
  );
}

/**
 * Eigener kleiner Folge-Dialog NUR nach "Speichern und als Ticket drucken"
 * (siehe promptHighscoreName) -- meldet entweder den Bar-Hinweis oder,
 * falls der Druck fehlschlug, eine konkrete Fehlermeldung MIT "Erneut
 * versuchen"-Button (auf ausdruecklichen Wunsch: variant/fields bleiben
 * dafuer erhalten, ein erneuter Versuch druckt exakt dasselbe Ticket noch
 * einmal). Rendert sich bei einem erneuten Versuch INNERHALB desselben
 * Dialogs neu (kein neues Modal) -- klappt der Nachversuch, verschwindet
 * der "Erneut versuchen"-Button automatisch (die Erfolgs-Ansicht hat gar
 * keinen), man kann also nicht endlos weiterdrucken.
 *
 * resultPromise statt eines bereits vorliegenden Ergebnisses: der
 * eigentliche Druckauftrag dauert inzwischen mehrere Sekunden (siehe
 * server/serve.js#printRasterJob) -- wuerde hier auf das fertige Ergebnis
 * gewartet, erschiene diese Meldung erst NACHDEM das Ticket laengst fertig
 * gedruckt ist, obwohl der Titel "Dein Ticket wird gedruckt!" das Gegenteil
 * suggeriert (gemeldeter Bug: "die Meldung kommt immer noch nachdem das
 * Ticket gedruckt wurde"). Stattdessen wird SOFORT optimistisch die
 * Erfolgs-Ansicht gezeigt (der Normalfall), waehrend im Hintergrund
 * weitergedruckt wird -- nur falls sich resultPromise spaeter als Fehler
 * herausstellt, wird die Ansicht nachtraeglich durch die Fehler-Ansicht
 * ersetzt.
 */
function showTicketPrintResult(resultPromise: Promise<PrintTicketResult>, variant: TicketVariant, fields: TicketFields): void {
  openModal((panel, close) => {
    function render(current: PrintTicketResult): void {
      panel.innerHTML = "";

      const iconWrap = document.createElement("div");
      iconWrap.style.width = "40px";
      iconWrap.style.height = "40px";
      iconWrap.style.color = current.ok ? "var(--accent)" : "var(--danger)";
      iconWrap.style.marginBottom = "8px";
      iconWrap.innerHTML = current.ok ? icons.ticket : icons.close;

      const h2 = document.createElement("h2");
      h2.textContent = current.ok ? "Dein Ticket wird gedruckt!" : "Ticket konnte nicht gedruckt werden";
      panel.appendChild(iconWrap);
      panel.appendChild(h2);

      const p = document.createElement("p");
      p.style.fontSize = "0.95rem";
      p.textContent = current.ok
        ? "Mit diesem Ticket kannst du dir nun einen Shot an der Bar abholen. Lass es vorher noch beim Schaffner stempeln."
        : friendlyPrintErrorMessage(current.error);
      panel.appendChild(p);

      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "btn btn--accent";
      okBtn.style.width = "100%";
      okBtn.style.marginTop = "12px";
      okBtn.textContent = "Alles klar";
      okBtn.addEventListener("click", close);

      if (current.ok) {
        panel.appendChild(okBtn);
        return;
      }

      // Bei leerem Papier zusaetzlich ein auffaelliger, eigenstaendiger Weg
      // direkt zur Wechsel-Anleitung -- auf ausdruecklichen Wunsch, damit man
      // nicht erst rueckwaerts im Admin-Bereich danach suchen muss.
      if (current.error === "paper_empty") {
        const changeBtn = document.createElement("button");
        changeBtn.type = "button";
        changeBtn.className = "btn hs-print-btn";
        changeBtn.style.width = "100%";
        changeBtn.style.marginTop = "10px";
        changeBtn.innerHTML = `<span class="btn__icon">${icons.ticket}</span>Papier wechseln -- Anleitung`;
        changeBtn.addEventListener("click", () => openPaperChangeInstructions());
        panel.appendChild(changeBtn);
      }

      // Egal aus welchem Grund es fehlschlug: nochmal versuchen koennen,
      // OHNE den ganzen Highscore-Dialog erneut durchzugehen -- druckt
      // exakt dasselbe Ticket (gleicher Name/Spiel/Wert) noch einmal.
      const retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "btn hs-save-only-btn";
      retryBtn.style.width = "100%";
      retryBtn.style.marginTop = "10px";
      retryBtn.textContent = "Erneut versuchen";
      retryBtn.addEventListener("click", () => {
        retryBtn.disabled = true;
        retryBtn.textContent = "Versucht erneut …";
        void printTicket(variant, fields).then((retryResult) => {
          if (retryResult.ok) recordTicketPrinted();
          render(retryResult);
        });
      });
      panel.appendChild(retryBtn);
      panel.appendChild(okBtn);
    }

    render({ ok: true });
    void resultPromise.then((result) => {
      if (!result.ok) render(result);
    });
  });
}
