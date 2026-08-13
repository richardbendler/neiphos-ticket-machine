import type { TransitLine } from "../../data/berlinNetwork";
import { transitLines } from "../../data/berlinNetwork";
import type { LineRoute } from "./graph";
import { buildMenuButton } from "../../core/menuButton";

const MODE_LABEL: Record<TransitLine["mode"], string> = {
  "u-bahn": "U-Bahn",
  "s-bahn": "S-Bahn",
  tram: "Tram",
};

/**
 * Fuer die Auswahl-Buttons (renderLinePicker): bewusst NICHT die echte,
 * individuelle Linienfarbe jeder Linie (die bleibt der Streckenkarte
 * vorbehalten, siehe core/berlinMap.ts) -- stattdessen einheitlich nach
 * Verkehrsmittel-Typ eingefaerbt (S-Bahn gruen, U-Bahn blau, Tram rot), auf
 * ausdruecklichen Wunsch. Innerhalb einer Zeile (schon nach Typ gruppiert,
 * siehe renderLinePicker) sah es vorher inkonsistent aus, wenn z. B. eine
 * einzelne U-Bahn-Linie zufaellig genauso rot eingefaerbt war wie eine
 * Tram-Linie, nur weil das zufaellig ihre echte Linienfarbe war.
 */
const MODE_COLOR: Record<TransitLine["mode"], string> = {
  "s-bahn": "#1f8a4c",
  "u-bahn": "#1565c0",
  tram: "#c62828",
};

function lineById(id: string): TransitLine {
  return transitLines.find((l) => l.id === id)!;
}

export type Phase = "building" | "feedback" | "summary";

export interface ScreenState {
  phase: Phase;
  start: string;
  target: string;
  round: number;
  totalRounds: number;
  attempt: number;
  totalAttempts: number;
  selectedLines: string[];
  error?: string | null;
  hint?: string;
  feedback?: {
    success: boolean;
    message: string;
    scoreGained: number;
    revealed?: LineRoute;
    roundOver: boolean;
  };
  summary?: {
    totalScore: number;
    isNewHighscore: boolean;
  };
}

export interface ScreenActions {
  onSelectLine: (lineId: string) => void;
  onRemoveLast: () => void;
  /** Entfernt eine einzelne bereits gewaehlte Linie per Index -- geht auch waehrend "feedback" (nicht rundenentscheidend). */
  onRemoveLine: (index: number) => void;
  onReset: () => void;
  onSubmit: () => void;
  onContinue: () => void;
  onPlayAgain: () => void;
  onExit: () => void;
}

/**
 * Fuellt die eigene, feste Zone (20% von --game-area-h, siehe
 * .connection-puzzle-start-target-zone in style.css) komplett aus, statt
 * wie vorher nur so gross wie unbedingt noetig zu sein -- auf groesseren
 * Bildschirmen blieb sonst viel Platz frei (gemeldet). Schriftgroessen sind
 * deshalb direkt als Anteil von --game-area-h berechnet (nicht nur vh),
 * damit sie mit der tatsaechlichen Zonengroesse mitwachsen.
 */
function renderStartTarget(container: HTMLElement, state: ScreenState): void {
  const card = document.createElement("div");
  card.className = "ticket-card";
  card.style.textAlign = "center";
  card.style.width = "100%";
  card.style.height = "100%";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.alignItems = "center";
  card.style.justifyContent = "center";
  card.style.padding = "clamp(6px, 1.8vh, 16px) clamp(16px, 3vw, 32px)";
  card.style.boxSizing = "border-box";
  // Auf sehr kurzen Bildschirmen ist die feste Untergrenze der Schriften
  // darunter (siehe roundInfo/startValue/... unten) manchmal trotzdem noch
  // zu gross fuer die feste 20%-Zone (siehe .connection-puzzle-start-target-
  // zone) -- overflow:hidden als Sicherheitsnetz, damit der Inhalt im
  // Zweifel sauber abgeschnitten wird statt sichtbar in die Streckenkarten-
  // Zone darueber bzw. die Linienauswahl darunter hineinzuragen (gemeldeter/
  // per Screenshot belegter Bug: die Runden-/Versuchszeile ueberlagerte den
  // gestreiften Kartenrand).
  card.style.overflow = "hidden";

  const roundInfo = document.createElement("div");
  roundInfo.style.fontSize = "clamp(0.4rem, calc(var(--game-area-h) * 0.032), 1.6rem)";
  roundInfo.style.fontWeight = "700";
  roundInfo.style.color = "var(--paper-text)";
  roundInfo.style.letterSpacing = "0.06em";
  roundInfo.style.textTransform = "uppercase";
  roundInfo.textContent = `Runde ${state.round}/${state.totalRounds} · Versuch ${state.attempt}/${state.totalAttempts}`;
  card.appendChild(roundInfo);

  // Start/Ziel nebeneinander statt untereinander (mit -> statt v dazwischen)
  // -- spart auf Handy-Hochkant deutlich Hoehe gegenueber der vorherigen
  // gestapelten Anordnung, bei der das Ergebnis zusammen mit der
  // Linienauswahl darunter kaum noch ohne Scrollen auf den Bildschirm passte.
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.justifyContent = "center";
  row.style.width = "100%";
  row.style.gap = "clamp(10px, 2.4vw, 28px)";
  row.style.marginTop = "clamp(4px, 1.2vh, 14px)";

  const startCol = document.createElement("div");
  startCol.style.flex = "1";
  startCol.style.minWidth = "0";
  const startLabel = document.createElement("div");
  startLabel.style.fontSize = "clamp(0.32rem, calc(var(--game-area-h) * 0.018), 1.1rem)";
  startLabel.style.color = "var(--paper-muted)";
  startLabel.style.letterSpacing = "0.1em";
  startLabel.style.textTransform = "uppercase";
  startLabel.textContent = "Start";
  startCol.appendChild(startLabel);
  const startValue = document.createElement("div");
  startValue.style.fontFamily = "var(--font-display)";
  startValue.style.fontWeight = "800";
  startValue.style.fontSize = "clamp(0.5rem, calc(var(--game-area-h) * 0.075), 3rem)";
  startValue.style.overflow = "hidden";
  startValue.style.textOverflow = "ellipsis";
  startValue.style.whiteSpace = "nowrap";
  startValue.textContent = state.start;
  startCol.appendChild(startValue);
  row.appendChild(startCol);

  const arrow = document.createElement("div");
  arrow.style.color = "var(--accent-dark)";
  arrow.style.fontSize = "clamp(0.55rem, calc(var(--game-area-h) * 0.06), 2.4rem)";
  arrow.style.flexShrink = "0";
  arrow.textContent = "→";
  row.appendChild(arrow);

  const targetCol = document.createElement("div");
  targetCol.style.flex = "1";
  targetCol.style.minWidth = "0";
  const targetLabel = document.createElement("div");
  targetLabel.style.fontSize = "clamp(0.32rem, calc(var(--game-area-h) * 0.018), 1.1rem)";
  targetLabel.style.color = "var(--paper-muted)";
  targetLabel.style.letterSpacing = "0.1em";
  targetLabel.style.textTransform = "uppercase";
  targetLabel.textContent = "Ziel";
  targetCol.appendChild(targetLabel);
  const targetValue = document.createElement("div");
  targetValue.style.fontFamily = "var(--font-display)";
  targetValue.style.fontWeight = "800";
  targetValue.style.fontSize = "clamp(0.5rem, calc(var(--game-area-h) * 0.075), 3rem)";
  targetValue.style.overflow = "hidden";
  targetValue.style.textOverflow = "ellipsis";
  targetValue.style.whiteSpace = "nowrap";
  targetValue.textContent = state.target;
  targetCol.appendChild(targetValue);
  row.appendChild(targetCol);

  card.appendChild(row);
  container.appendChild(card);
}

/**
 * Zeigt die bereits gewaehlten Linien als Kette von antippbaren Chips --
 * ein Tipp entfernt genau diese eine Linie (statt nur "alles loeschen" oder
 * "letzte entfernen" anzubieten). Wird sowohl waehrend "building" als auch
 * (bei nicht rundenentscheidendem Fehlversuch) waehrend "feedback" genutzt,
 * damit man eine falsche Auswahl gezielt korrigieren kann, statt komplett
 * neu anfangen zu muessen.
 */
function renderChipsRow(container: HTMLElement, lines: string[], onRemove: (index: number) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "breadcrumb";
  wrap.style.justifyContent = "center";
  wrap.style.minHeight = "28px";

  if (lines.length === 0) {
    const hint = document.createElement("span");
    hint.textContent = "Noch keine Linie gewählt.";
    wrap.appendChild(hint);
  } else {
    lines.forEach((id, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip chip--removable";
      chip.style.setProperty("--chip-color", lineById(id).color);
      // Kein fixer Klein-Wert mehr (war 0.78rem) -- die .chip-Klasse skaliert
      // selbst schon responsiv mit (siehe style.css), die feste Ueberschreibung
      // liess die AUSGEWAEHLTEN Linien-Chips bisher winzig gegenueber den viel
      // groesseren Auswahl-Chips darunter wirken (gemeldet: sollen mehr
      // "hervorstechen").
      chip.textContent = id;
      chip.setAttribute("aria-label", `${id} entfernen`);
      chip.addEventListener("click", () => onRemove(i));
      wrap.appendChild(chip);
      if (i < lines.length - 1) {
        const sep = document.createElement("span");
        sep.className = "breadcrumb__sep";
        sep.textContent = "→";
        wrap.appendChild(sep);
      }
    });
  }
  container.appendChild(wrap);
  return wrap;
}

function renderBreadcrumb(container: HTMLElement, state: ScreenState, actions: ScreenActions): void {
  renderChipsRow(container, state.selectedLines, actions.onRemoveLine);

  if (state.error) {
    const err = document.createElement("div");
    err.className = "field-error";
    err.style.textAlign = "center";
    // Extra Abstand nach oben (zusaetzlich zum ohnehin vorhandenen Gap der
    // Eltern-Zone) -- seit die Chips darueber deutlich groesser sind (siehe
    // renderChipsRow), rueckten beide sonst zu dicht aneinander (gemeldet:
    // wirkte wie eine Ueberlappung).
    err.style.marginTop = "clamp(4px, 1vh, 10px)";
    err.textContent = state.error;
    container.appendChild(err);
  }

  if (state.hint) {
    const hint = document.createElement("div");
    hint.style.textAlign = "center";
    hint.style.fontSize = "0.8rem";
    hint.style.fontWeight = "700";
    hint.style.color = "var(--accent-dark)";
    hint.style.margin = "4px 0";
    hint.textContent = `💡 Tipp: Eine der Linien ist ${state.hint}.`;
    container.appendChild(hint);
  }

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.justifyContent = "center";
  btnRow.style.margin = "6px 0 4px";

  // Groesse auf ausdruecklichen Wunsch angehoben (war fix 0.82rem/8px 16px)
  // -- passend zu den ebenfalls vergroesserten ausgewaehlten Linien-Chips
  // darueber vh-basiert, damit beide zusammen mit der Zone mitwachsen.
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn--ghost";
  resetBtn.style.fontSize = "clamp(0.55rem, 2.2vh, 1.25rem)";
  resetBtn.style.padding = "clamp(10px, 1.8vh, 18px) clamp(16px, 3vw, 28px)";
  resetBtn.textContent = "Auswahl leeren";
  resetBtn.disabled = state.selectedLines.length === 0;
  resetBtn.addEventListener("click", actions.onReset);
  btnRow.appendChild(resetBtn);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "btn btn--accent";
  submitBtn.style.fontSize = "clamp(0.55rem, 2.2vh, 1.25rem)";
  submitBtn.style.padding = "clamp(10px, 1.8vh, 18px) clamp(16px, 3vw, 28px)";
  submitBtn.textContent = "Fertig, prüfen";
  submitBtn.disabled = state.selectedLines.length === 0;
  submitBtn.addEventListener("click", actions.onSubmit);
  btnRow.appendChild(submitBtn);

  container.appendChild(btnRow);
}

function renderLinePicker(container: HTMLElement, actions: ScreenActions): void {
  const grouped: Record<TransitLine["mode"], TransitLine[]> = { "u-bahn": [], "s-bahn": [], tram: [] };
  for (const line of transitLines) grouped[line.mode].push(line);

  for (const mode of ["u-bahn", "s-bahn", "tram"] as const) {
    const label = document.createElement("div");
    // War fix 0.72rem -- skalierte dadurch nie mit, siehe fitBuildingContent-
    // Kommentar unten (derselbe Grund, warum die ganze Zone ueberhaupt
    // skaliert werden muss).
    label.className = "connection-puzzle-picker-label";
    label.style.color = "var(--text-faint)";
    label.style.margin = "clamp(3px, 1.2vh, 8px) 0 clamp(2px, 0.8vh, 4px)";
    label.textContent = MODE_LABEL[mode];
    container.appendChild(label);

    const row = document.createElement("div");
    row.className = "chip-row chip-row--picker";
    for (const line of grouped[mode]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip chip--picker";
      btn.style.setProperty("--chip-color", MODE_COLOR[mode]);
      btn.textContent = line.label.split(" ")[0];
      btn.addEventListener("click", () => actions.onSelectLine(line.id));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }
}

/**
 * Die Linienauswahl-Zone (.connection-puzzle-connections-zone) hat eine
 * FESTE Hoehe (50% von --game-area-h, siehe style.css) -- bei vielen Linien
 * (3 Verkehrsmittel-Gruppen mit je eigener Chip-Reihe) reichte reines
 * Schrumpfen einzelner clamp()-Untergrenzen (vorherige Fassung) auf kleinen
 * Bildschirmen nicht aus, die Zone musste gescrollt werden -- auf
 * ausdruecklichen Wunsch soll bei DIESEM Spiel aber nirgends (ausser
 * eventuell der Karte) gescrollt werden muessen. Deshalb wird der komplette
 * "building"-Inhalt (Breadcrumb + gewaehlte Linien-Chips + Fehler/Tipp +
 * Buttons + Linienauswahl) jetzt in einen eigenen Wrapper gerendert und bei
 * Bedarf per CSS-transform:scale() gleichmaessig verkleinert, bis er
 * garantiert in die verfuegbare Hoehe passt -- transform:scale() aendert
 * dabei NUR die visuelle Groesse, nicht die Layout-Box, deshalb bleibt
 * scrollHeight (die "natuerliche" ungestreckte Hoehe) bei jedem Aufruf
 * zuverlaessig messbar, auch nach einer vorherigen Verkleinerung.
 */
function fitBuildingContent(container: HTMLElement, content: HTMLElement): void {
  content.style.transform = "";
  // Reset vor jeder Neumessung -- siehe unten, warum das ueberhaupt
  // umgeschaltet wird (gleiches Prinzip wie core/modal.ts#openModal).
  container.style.overflowY = "auto";
  // container.clientHeight schliesst dessen eigenes (wenn auch kleines)
  // Padding oben/unten mit ein (siehe .connection-puzzle-connections-zone)
  // -- das ist KEIN fuer den Inhalt nutzbarer Platz, muss also von der
  // verfuegbaren Hoehe abgezogen werden, sonst faellt die berechnete
  // Skalierung geringfuegig zu grosszuegig aus und der untere Rand ragt
  // trotzdem noch ein paar Pixel in die Fussleiste hinein (per Playwright-
  // Messung belegt: 4px Ueberlappung bei 528x300 ohne diesen Abzug).
  const cs = getComputedStyle(container);
  const verticalPadding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const available = container.clientHeight - verticalPadding;
  const natural = content.scrollHeight;
  if (available > 0 && natural > available) {
    // Zusaetzlicher 4%-Sicherheitsabstand (0.96 statt exakt 1:1) faengt
    // Rundungs-/Sub-Pixel-Abweichungen zwischen Layout- und Transform-
    // Koordinatenraum ab, die sonst denselben minimalen Ueberlapp-Effekt
    // verursachen koennten. BEWUSST kein hoher Sockel-Wert (war 0.4/0.35) --
    // auf ausdruecklichen Wunsch soll dieses Spiel NIE gescrollt werden
    // muessen, auch nicht auf einem extrem kleinen Testbildschirm mit vielen
    // Linien. Ein Sockel haette genau das auf sehr kurzen Bildschirmen
    // wieder verhindert (per Playwright-Messung belegt: 400x240 und kleiner
    // ragte der Inhalt bei einem 0.35er-Sockel weiterhin in die Fussleiste).
    // 0.12 ist nur eine technische Notbremse gegen einen (praktisch nie
    // erreichten) Skalierungsfaktor von 0.
    const rawScale = (available / natural) * 0.96;
    const scale = Math.max(0.12, rawScale);
    content.style.transform = `scale(${scale})`;
    content.style.transformOrigin = "top center";
    // scrollHeight/clientHeight beziehen sich auf die UNSKALIERTE Layout-
    // Groesse und bleiben dadurch auch nach einer erfolgreichen
    // Verkleinerung weiterhin "technisch" > und damit scrollbar, OBWOHL der
    // Inhalt durch die Skalierung bereits vollstaendig sichtbar ist
    // (gemeldeter Bug: "ich kann schon wieder scrollen", betraf auch die
    // Tastatur-Modals, siehe core/modal.ts#openModal fuer denselben Fix).
    // Nur wenn der 0.12-Sockel NICHT gegriffen hat, ist der Inhalt
    // GARANTIERT vollstaendig sichtbar -- overflow dann komplett abschalten.
    if (rawScale >= 0.12) container.style.overflowY = "hidden";
  }
}

/**
 * headerContainer = eigene Start/Ziel-Zone (20% von --game-area-h), body-
 * Container = Zone fuer Linienauswahl/Feedback/Zusammenfassung (55%) --
 * beide fest positioniert, siehe .connection-puzzle-*-zone in style.css.
 */
export function renderScreen(headerContainer: HTMLElement, container: HTMLElement, state: ScreenState, actions: ScreenActions): void {
  headerContainer.innerHTML = "";
  renderStartTarget(headerContainer, state);

  container.innerHTML = "";

  if (state.phase === "building") {
    const content = document.createElement("div");
    content.className = "connection-puzzle-building-content";
    container.appendChild(content);
    renderBreadcrumb(content, state, actions);
    renderLinePicker(content, actions);
    fitBuildingContent(container, content);
  } else if (state.phase === "feedback" && state.feedback) {
    const fb = state.feedback;
    const msg = document.createElement("p");
    msg.style.textAlign = "center";
    msg.style.color = fb.success ? "var(--success)" : "var(--text)";
    msg.style.fontWeight = "700";
    msg.style.fontSize = "clamp(0.5rem, calc(var(--game-area-h) * 0.032), 1.7rem)";
    msg.style.margin = "10px 0 4px";
    msg.textContent = fb.message;
    container.appendChild(msg);

    if (fb.scoreGained > 0) {
      const score = document.createElement("p");
      score.style.textAlign = "center";
      score.style.color = "var(--accent)";
      score.style.fontFamily = "var(--font-display)";
      score.style.fontWeight = "700";
      score.style.fontSize = "clamp(0.6rem, calc(var(--game-area-h) * 0.045), 2.2rem)";
      score.textContent = `+${fb.scoreGained} Punkte`;
      container.appendChild(score);
    }

    if (!fb.roundOver) {
      // Noch Versuche uebrig: die eben abgegebene (falsche) Auswahl bleibt
      // sichtbar und bleibt antippbar -- so kann man gezielt die falsche
      // Linie rauswerfen statt alles neu zusammenzuklicken. Ein Tipp hier
      // zaehlt wie "Weiter" (der Versuch ist ja schon abgegeben).
      const editHint = document.createElement("p");
      editHint.style.textAlign = "center";
      editHint.style.fontSize = "0.74rem";
      editHint.style.color = "var(--text-faint)";
      editHint.style.margin = "8px 0 2px";
      editHint.textContent = "Tippe eine Linie an, um nur diese zu entfernen:";
      container.appendChild(editHint);
      renderChipsRow(container, state.selectedLines, actions.onRemoveLine);
    }

    if (fb.revealed) {
      const revealTitle = document.createElement("p");
      revealTitle.style.textAlign = "center";
      revealTitle.style.fontSize = "0.78rem";
      revealTitle.style.color = "var(--text-muted)";
      revealTitle.style.margin = "10px 0 6px";
      revealTitle.textContent = "So wäre eine direkte Verbindung gegangen:";
      container.appendChild(revealTitle);

      const row = document.createElement("div");
      row.className = "breadcrumb";
      row.style.justifyContent = "center";
      fb.revealed.lineIds.forEach((id, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.style.setProperty("--chip-color", lineById(id).color);
        chip.textContent = id;
        row.appendChild(chip);
        if (i < fb.revealed!.lineIds.length - 1) {
          const sep = document.createElement("span");
          sep.className = "breadcrumb__sep";
          sep.textContent = "→";
          row.appendChild(sep);
        }
      });
      container.appendChild(row);
    }

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "btn btn--accent";
    continueBtn.style.width = "100%";
    continueBtn.style.marginTop = "14px";
    // "Weiter" nur, solange noch derselbe Versuch/dieselbe Runde laeuft (z. B.
    // nach einem Fehlversuch mit noch uebrigen Versuchen). Ist die Runde
    // hier zu Ende (gewonnen ODER alle Versuche verbraucht) und es folgt
    // noch eine weitere, macht "Nächste Runde" expliziter klar, dass jetzt
    // neu (Start/Ziel, Versuche) begonnen wird -- vorher stand hier
    // unabhaengig davon immer nur "Weiter" (gemeldet, wirkte nach einer
    // verlorenen Runde wie ein einfaches "nochmal versuchen" statt einer
    // neuen Runde). In der letzten Runde bleibt es bei "Weiter", da es dann
    // zur Zusammenfassung fuehrt, nicht zu einer weiteren Runde.
    continueBtn.textContent = fb.roundOver && state.round < state.totalRounds ? "Nächste Runde" : "Weiter";
    continueBtn.addEventListener("click", actions.onContinue);
    container.appendChild(continueBtn);
  } else if (state.phase === "summary" && state.summary) {
    const score = document.createElement("p");
    score.style.textAlign = "center";
    score.style.fontFamily = "var(--font-display)";
    score.style.fontSize = "clamp(0.8rem, calc(var(--game-area-h) * 0.07), 3.4rem)";
    score.style.fontWeight = "800";
    score.style.color = "var(--accent)";
    score.style.margin = "10px 0 4px";
    score.textContent = `${state.summary.totalScore} Punkte`;
    container.appendChild(score);

    if (state.summary.isNewHighscore) {
      const hs = document.createElement("p");
      hs.style.textAlign = "center";
      hs.style.color = "var(--success)";
      hs.style.fontWeight = "600";
      hs.textContent = "Neuer Highscore!";
      container.appendChild(hs);
    }

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.style.marginTop = "10px";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", actions.onPlayAgain);
    container.appendChild(again);

    // Gleiches Design wie der permanente "Menü"-Button oben links (siehe
    // core/menuButton.ts) -- auf ausdruecklichen Wunsch, damit man nach
    // Spielende nicht extra den kleineren, weiter entfernten Kopfleisten-
    // Button treffen muss.
    const menuBtn = buildMenuButton(actions.onExit);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";
    container.appendChild(menuBtn);
  }
}
