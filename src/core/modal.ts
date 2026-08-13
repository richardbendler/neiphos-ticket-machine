/**
 * Kleiner Modal-Helfer fuer Overlays (Admin-Login, Highscore-Namenseingabe,
 * Spielfeld-Groesse waehlen, ...). Klick auf den Scrim schliesst NICHT
 * automatisch -- auf einem Kiosk ohne Escape-Taste soll ein Dialog nur ueber
 * einen expliziten Button verlassen werden koennen, sonst tippt man sich
 * versehentlich raus.
 *
 * Alle offenen Modals werden in einem kleinen Stack verfolgt, damit der
 * permanente "Zurueck zum Menue"-Button (siehe Router.ts) jederzeit --
 * auch waehrend z. B. ein Spiel-Anleitungs- oder Highscore-Dialog offen ist
 * -- wirklich alles schliessen kann, bevor er ins Hauptmenue wechselt.
 */

const openModals: Array<() => void> = [];

export function openModal(
  build: (panel: HTMLDivElement, close: () => void) => void,
  opts: { wide?: boolean; keyboard?: boolean; onClose?: () => void } = {},
): () => void {
  const scrim = document.createElement("div");
  scrim.className = "modal-scrim";

  const panel = document.createElement("div");
  // keyboard: eigene, responsive (vw-basierte statt fest 720px) Breite fuer
  // Modals mit Bildschirmtastatur (Highscore-Namenseingabe, Admin-Login,
  // Feedback) -- siehe .modal-panel--keyboard in style.css. Schliesst sich
  // mit wide gegenseitig aus, keyboard gewinnt, falls beide gesetzt waeren.
  panel.className = "modal-panel" + (opts.keyboard ? " modal-panel--keyboard" : opts.wide ? " modal-panel--wide" : "");
  scrim.appendChild(panel);

  document.body.appendChild(scrim);

  let fitObservers: { resize: ResizeObserver; mutation: MutationObserver } | null = null;
  const close = () => {
    scrim.remove();
    fitObservers?.resize.disconnect();
    fitObservers?.mutation.disconnect();
    const idx = openModals.indexOf(close);
    if (idx !== -1) openModals.splice(idx, 1);
    // Feuert auch, wenn ueber closeAllModals() (z.B. globaler "Menü"-Button
    // waehrend das Modal offen ist) statt ueber einen eigenen Zurueck-
    // Button geschlossen wird -- Aufrufer sollen sich darauf verlassen
    // koennen, unabhaengig vom Schliessweg.
    opts.onClose?.();
  };
  openModals.push(close);

  build(panel, close);

  // Fuer Tastatur-Modals (Highscore-Namenseingabe, Admin-Login, ...) UND
  // Spielanleitungen (game-intro, siehe core/gameIntro.ts): beides bewusst
  // kurzer, von Natur aus BEGRENZTER Inhalt (ein paar Stichpunkte bzw. eine
  // Tastatur + etwas Text), der auf ausdruecklichen Wunsch nie gescrollt
  // werden soll -- anders als z. B. lange Admin-Einstellungslisten oder
  // Feedback-Listen, die absichtlich scrollbar bleiben sollen. Bei
  // Tastatur-Modals schrumpft OnScreenKeyboard.fitLetterKeys() die Tastatur
  // SELBST bereits bis zu ihrer technischen Untergrenze, kennt aber weder
  // die Groesse des Icons/der Ueberschrift/des Fliesstexts DAVOR noch
  // etwaiger Buttons DANACH (die je nach Dialog variieren, siehe core/
  // highscorePrompt.ts vs. admin/AdminPanel.ts). Als letzte Sicherung wird
  // deshalb hier das GESAMTE Panel per transform:scale() (gleiches Prinzip
  // wie bei der Verbindungssuche-Linienauswahl, siehe games/connection-
  // puzzle/ui.ts#fitBuildingContent) verkleinert, falls trotz aller
  // Einzel-Fixe noch Rest-Ueberlauf bleibt. Pruefung ueber die CSS-Klasse
  // statt nur ueber opts.keyboard: einige Admin-Dialoge (siehe admin/
  // AdminPanel.ts) haengen "modal-panel--keyboard" direkt selbst im
  // build()-Callback an, statt die opts.keyboard-Option zu nutzen -- die
  // Klasse ist damit die einzige zuverlaessige, einheitliche Erkennung.
  if (opts.keyboard || panel.classList.contains("modal-panel--keyboard") || panel.classList.contains("game-intro-panel")) {
    // WICHTIG: transform:scale() darf NICHT auf panel SELBST angewendet
    // werden -- panel ist zugleich der Container MIT der Hoehenbegrenzung
    // (max-height/overflow-y:auto). Skaliert man ein Element UND seine
    // eigene Begrenzung gemeinsam um denselben Faktor, bleibt das
    // Ueberlauf-VERHAELTNIS (Inhalt/Box) unveraendert -- das Panel blieb
    // dadurch trotz "passendem" Skalierungsfaktor weiterhin im GENAU
    // gleichen Verhaeltnis scrollbar (per Playwright-Messung belegt: Inhalt
    // ragte weiterhin ueber den sichtbaren Rand). Der Transform muss
    // stattdessen auf einen INNEREN Wrapper wirken, dessen Elternknoten
    // (panel) seine eigene Groesse UNVERAENDERT (durch max-height gedeckelt)
    // behaelt -- exakt das Prinzip aus games/connection-puzzle/ui.ts#
    // fitBuildingContent, hier verallgemeinert fuer jedes Tastatur-Modal.
    // Alle von build() erzeugten Kinder (die echte Panel-Klasse/-Breite
    // wurde von build() bereits VORHER auf panel selbst gesetzt) werden
    // dafuer einmalig in diesen Wrapper umgehaengt.
    const fitWrap = document.createElement("div");
    while (panel.firstChild) fitWrap.appendChild(panel.firstChild);
    panel.appendChild(fitWrap);

    const fitPanel = () => {
      fitWrap.style.transform = "";
      const cs = getComputedStyle(panel);
      const verticalPadding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const available = panel.clientHeight - verticalPadding;
      const natural = fitWrap.scrollHeight;
      if (available > 0 && natural > available) {
        const scale = Math.max(0.5, (available / natural) * 0.97);
        fitWrap.style.transform = `scale(${scale})`;
        fitWrap.style.transformOrigin = "top center";
      }
    };
    fitPanel();
    // Web-Fonts laden asynchron nach -- die allererste, synchrone
    // fitPanel()-Messung oben laeuft dadurch oft noch mit der (meist
    // schmaleren/kompakteren) Fallback-Schrift, bevor die eigentliche
    // Schrift eintrifft und den tatsaechlichen Inhalt (scrollHeight) danach
    // nachtraeglich vergroessert -- OHNE dass das eine Groessenaenderung von
    // fitWrap SELBST ausloest (ResizeObserver bleibt still, solange fitWrap
    // durch panels max-height ohnehin schon effektiv gedeckelt ist) und ohne
    // DOM-Mutation (MutationObserver bleibt ebenfalls still). Ohne diesen
    // Nachschlag blieb der Skalierungsfaktor auf dem (zu grosszuegigen)
    // Fallback-Schrift-Wert stehen, das Panel blieb trotzdem noch ein Stueck
    // scrollbar (per Playwright-Messung belegt).
    if (panel.isConnected) void document.fonts.ready.then(() => panel.isConnected && fitPanel());
    const resize = new ResizeObserver(fitPanel);
    resize.observe(panel);
    resize.observe(fitWrap);
    const mutation = new MutationObserver(fitPanel);
    mutation.observe(fitWrap, { childList: true, subtree: true, characterData: true });
    fitObservers = { resize, mutation };
  }

  return close;
}

/** Schliesst alle aktuell offenen Modals (unabhaengig davon, welches Spiel/welcher Dialog sie geoeffnet hat). */
export function closeAllModals(): void {
  for (const close of [...openModals]) close();
}

/**
 * Ob gerade mindestens ein Modal offen ist -- genutzt vom GameLoop (siehe
 * Router.ts), um Canvas-update()/render() zu pausieren, waehrend z. B. die
 * Highscore-Namenseingabe mit Bildschirmtastatur offen ist. Auf dem
 * Raspberry Pi 3 zeigte eine Live-Messung (top waehrend des Tippens), dass
 * Renderer- UND GPU-Prozess auf ueber 90% CPU sprangen, weil das darunter-
 * liegende Spiel unveraendert mit 60fps weiterrenderte (der Scrim ist
 * halbtransparent, das Spielfeld bleibt sichtbar) und so mit der Tastatur-
 * Eingabeverarbeitung um denselben Hauptthread konkurrierte -- spuerbar als
 * "schwerfaelliges" Tippen/Tippen mit Verzoegerung.
 */
export function hasOpenModal(): boolean {
  return openModals.length > 0;
}
