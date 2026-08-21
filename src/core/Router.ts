import { setupCanvas } from "./Canvas";
import { GameLoop } from "./GameLoop";
import { toCanvasPoint } from "./input";
import { icons } from "./icons";
import { recordSession } from "./stats";
import { closeAllModals, hasOpenModal } from "./modal";
import { guardedClick } from "./guardedClick";
import { isScreensaverActive } from "./screensaver";
import { gameRegistry } from "../games/registry";
import { isGameEnabled } from "./storage";
import { syncPublicDataFromServer } from "./sync";
import { playHighscoreOpenSound } from "./sound";
import { renderMainMenu } from "../menu/MainMenu";
import { openFeedbackDialog } from "./feedbackPrompt";
import { fetchUnreadFeedbackCount } from "./feedback";
import { getTicketCooldownRemainingMs, formatCooldownCountdown, openTicketCooldownInfo } from "./ticketCooldown";
import { isWithinTicketPrintWindow, getTicketPrintWindowSettings, formatTicketPrintWindow, openTicketPrintWindowInfo } from "./ticketPrintWindow";
import { isPrintingEnabled } from "./ticketMethods";
import brandLogo from "../assets/brand/neiphos-logo.png";
import type { GameEnv, MinigameModule } from "./Game";

function formatClock(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} · ${hh}:${min}:${ss}`;
}

/**
 * Router: einzige Instanz, die zwischen Hauptmenue und einem laufenden
 * Minigame umschaltet. Kuemmert sich um Canvas-Lifecycle, die rAF-Loop,
 * Pointer-Events und garantiert sauberes Aufraeumen (cleanup) beim
 * Verlassen eines Spiels, damit nichts im Hintergrund weiterlaeuft.
 */
export class Router {
  private readonly root: HTMLElement;
  private readonly chromeClock: HTMLElement;
  private readonly chromeGameTitle: HTMLElement;
  private readonly menuBtn: HTMLButtonElement;
  private readonly highscoreBtn: HTMLButtonElement;
  private screenEl: HTMLElement | null = null;
  private screenCleanup: (() => void) | null = null;
  private clockInterval: number | null = null;

  private activeGame: MinigameModule | null = null;
  private activeLoop: GameLoop | null = null;
  private activeEnv: GameEnv | null = null;
  private sessionStartedAt = 0;
  private teardownFns: Array<() => void> = [];

  // Fussleisten-Hintergrundabfragen (ungelesenes Feedback/Papierstand/
  // Ticket-Cooldown, siehe buildChromeFooterBar) -- auf ausdruecklichen
  // Wunsch waehrend eines laufenden Spiels pausiert (siehe pauseFooterPolling/
  // resumeFooterPolling unten): der Footer selbst bleibt sichtbar/erreichbar,
  // aber diese rein informativen Werte muessen waehrend des eigentlichen
  // Spielens (30fps-Canvas-Loop auf schwacher Pi-3-Hardware) nicht auch noch
  // regelmaessig neu abgefragt/neu gezeichnet werden -- sie sind beim naechsten
  // Menuebesuch ohnehin sofort wieder aktuell (resumeFooterPolling fragt
  // einmalig sofort neu ab).
  private footerRefreshers: Array<{ run: () => void; intervalMs: number; id: number | null }> = [];

  private registerFooterPoll(run: () => void, intervalMs: number): void {
    run();
    this.footerRefreshers.push({ run, intervalMs, id: window.setInterval(run, intervalMs) });
  }

  private pauseFooterPolling(): void {
    for (const r of this.footerRefreshers) {
      if (r.id !== null) {
        window.clearInterval(r.id);
        r.id = null;
      }
    }
  }

  private resumeFooterPolling(): void {
    for (const r of this.footerRefreshers) {
      if (r.id === null) {
        r.run();
        r.id = window.setInterval(r.run, r.intervalMs);
      }
    }
  }

  constructor(root: HTMLElement) {
    this.root = root;
    const chromeBar = this.buildChromeBar();
    this.chromeClock = chromeBar.querySelector(".chrome-bar__clock")!;
    this.chromeGameTitle = chromeBar.querySelector(".chrome-bar__game-title")!;
    this.menuBtn = chromeBar.querySelector(".chrome-menu-btn")!;
    this.highscoreBtn = chromeBar.querySelector(".chrome-highscore-btn")!;
    // Bewusst an document.body gehaengt statt an #app: #app ist selbst
    // position:fixed und bildet damit einen eigenen Stacking-Context, in dem
    // kein z-index jemals gegen ein an document.body gehaengtes Modal (siehe
    // core/modal.ts) gewinnen kann. Auf Body-Ebene konkurriert die Kopfleiste
    // z-index-technisch auf Augenhoehe mit jedem Modal-Scrim.
    document.body.appendChild(chromeBar);
    document.body.appendChild(this.buildChromeFooterBar());
    this.showMenu();
  }

  private buildChromeBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "chrome-bar";

    // Permanent oben links (war zwischenzeitlich rechts, siehe Git-Historie:
    // auf dem konkreten Kiosk-Geraet registrierte die obere linke Ecke des
    // optischen/Infrarot-Touchscreens damals teils zwei leicht versetzte
    // "Geister"-Touchpunkte pro Fingertipp, ein bekanntes Symptom dieser
    // Technik nahe der Ecken-Sensoren. Nach genauerer Pruefung funktioniert
    // die Ecke inzwischen zuverlaessig, daher auf ausdruecklichen Wunsch
    // wieder an die urspruengliche, intuitivere Position oben links
    // zurueckgetauscht -- das Logo wandert dafuer zurueck nach rechts), mit
    // hoeherer Stapelreihenfolge als jedes Modal (siehe style.css) -- dadurch
    // kommt man WIRKLICH von ueberall aus sofort zurueck ins Hauptmenue,
    // auch waehrend z. B. gerade ein Spiel-Anleitungs- oder Highscore-Dialog
    // offen ist.
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "chrome-menu-btn";
    menuBtn.setAttribute("aria-label", "Zurück zum Hauptmenü");
    menuBtn.innerHTML = `${icons.exit}<span>Menü</span>`;
    // guardedClick statt addEventListener("click", ...): siehe dortigen
    // Kommentar -- verhindert, dass Spam auf diesen Button (oder Admin/
    // Feedback/Highscores, siehe unten) mehrere teure Vorgaenge gleichzeitig
    // anstoesst und die schwache Pi-Hardware ueberlastet (gemeldeter Bug).
    guardedClick(menuBtn, () => {
      closeAllModals();
      this.showMenu();
    });

    // Golden/pokalfarben statt im silbernen Tasten-Look der uebrigen
    // Kopfleisten-Buttons, damit er als eigene Kategorie ("hier siehst du
    // dir was an" statt "hier navigierst du") sofort ins Auge faellt.
    const highscoreBtn = document.createElement("button");
    highscoreBtn.type = "button";
    highscoreBtn.className = "chrome-highscore-btn";
    highscoreBtn.setAttribute("aria-label", "Highscores");
    highscoreBtn.innerHTML = `${icons.trophy}<span>Highscores</span>`;
    guardedClick(highscoreBtn, () => {
      closeAllModals();
      this.showHighscores();
    });

    const title = document.createElement("div");
    title.className = "chrome-bar__title";
    const clock = document.createElement("div");
    clock.className = "chrome-bar__clock";
    const gameTitle = document.createElement("div");
    gameTitle.className = "chrome-bar__game-title";
    title.append(clock, gameTitle);

    const brand = document.createElement("div");
    brand.className = "chrome-bar__brand";

    const logo = document.createElement("img");
    logo.className = "chrome-bar__logo";
    logo.src = brandLogo;
    logo.alt = "Neiphos";
    brand.appendChild(logo);

    // Geheimer Admin-Zugang: zehnmal auf das Logo tippen, innerhalb von 15
    // Sekunden -- ersetzt den bisherigen, staendig sichtbaren "Admin"-Button
    // in der Fussleiste (auf ausdruecklichen Wunsch entfernt, siehe
    // buildChromeFooterBar). pointer-events ist auf .chrome-bar__brand
    // standardmaessig "none" (siehe style.css), daher hier gezielt wieder
    // aktiviert, nur fuer das Logo selbst.
    logo.style.pointerEvents = "auto";
    logo.style.cursor = "pointer";
    let secretTapTimestamps: number[] = [];
    const SECRET_TAP_COUNT = 10;
    const SECRET_TAP_WINDOW_MS = 15_000;
    logo.addEventListener("click", () => {
      const now = Date.now();
      secretTapTimestamps.push(now);
      secretTapTimestamps = secretTapTimestamps.filter((t) => now - t <= SECRET_TAP_WINDOW_MS);
      if (secretTapTimestamps.length >= SECRET_TAP_COUNT) {
        secretTapTimestamps = [];
        // Dynamischer Import statt statischem -- der Adminbereich (ueber
        // 2000 Zeilen) wird dadurch NICHT mehr in jedes normale Seiten-
        // laden eingebacken, sondern nur noch fuer die seltenen Faelle
        // nachgeladen, in denen wirklich zehnmal aufs Logo getippt wird.
        void import("../admin/AdminPanel").then(({ openAdminPanel }) => {
          openAdminPanel(() => {
            if (this.screenEl?.classList.contains("menu-screen")) this.showMenu();
          });
        });
      }
    });

    // highscoreBtn und menuBtn teilen sich denselben Platz oben links (siehe
    // setNavMode): auf dem Hauptmenue-Bildschirm braucht man keinen
    // "zurueck ins Menü"-Button, dafuer den Highscores-Zugang; ueberall
    // sonst (Spiel, Highscores-Ansicht) ist es umgekehrt. Nur jeweils einer
    // der beiden ist per display:none/flex tatsaechlich im Fluss. Reihen-
    // folge hier bestimmt die visuelle Position (chrome-bar ist ein simples
    // justify-content:space-between-Flex, keine eigenen links/rechts-Klassen)
    // -- die beiden Buttons zuerst, brand/title zuletzt, damit sie links
    // landen (siehe Kommentar bei menuBtn oben fuer den Grund des Tauschs).
    bar.append(highscoreBtn, menuBtn, title, brand);
    return bar;
  }

  /**
   * Fussleiste, ebenfalls dauerhaft an document.body gehaengt (siehe
   * buildChromeBar) -- Feedback und Admin-Zugang sollen auch waehrend eines
   * laufenden Spiels erreichbar bleiben, nicht nur im Hauptmenue.
   */
  private buildChromeFooterBar(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "chrome-footer-bar";

    const feedbackBtn = document.createElement("button");
    feedbackBtn.type = "button";
    feedbackBtn.className = "chrome-footer-btn";
    feedbackBtn.innerHTML = `<span class="chrome-footer-btn__icon">${icons.feedback}</span><span>Feedback geben</span>`;
    guardedClick(feedbackBtn, () => openFeedbackDialog());

    const credit = document.createElement("div");
    credit.className = "chrome-footer-credit";
    credit.innerHTML = `
      <span class="chrome-footer-credit__line chrome-footer-credit__line--main"><span>präsentiert von</span> <strong>DJ Flipper</strong></span>
      <span class="chrome-footer-credit__line chrome-footer-credit__line--sub">Freitag 22:30 Uhr - Trashfloor</span>
      <span class="chrome-footer-credit__line chrome-footer-credit__line--wrap">Du willst im Camp oder in Berlin weiterspielen? Das kannst du auf neiphos.blankiball.de tun</span>
    `;
    // versionLabel (siehe unten) wird erst NACH diesem innerHTML-Aufruf per
    // appendChild angehaengt -- sonst wuerde innerHTML es wieder entfernen.

    // Kleiner, oeffentlich sichtbarer Hinweis auf ungelesenes Feedback --
    // extra schmaler, eigener Endpunkt OHNE Admin-Login (nur die Anzahl,
    // kein Inhalt, siehe core/feedback.ts#fetchUnreadFeedbackCount), damit
    // das auch ohne Admin-Anmeldung auf einen Blick sichtbar ist. Stand
    // vorher unter dem (mittlerweile entfernten, siehe buildChromeBar fuer
    // den neuen geheimen Logo-Zugang) Admin-Button -- bleibt auf
    // ausdruecklichen Wunsch weiterhin unten rechts in der Fussleiste
    // stehen, jetzt eigenstaendig statt in dessen Spalte.
    const unreadBadge = document.createElement("span");
    unreadBadge.className = "chrome-footer-unread-badge";
    unreadBadge.style.display = "none";

    const refreshUnreadBadge = () => {
      void fetchUnreadFeedbackCount().then((count) => {
        if (count <= 0) {
          unreadBadge.style.display = "none";
          return;
        }
        unreadBadge.textContent = count === 1 ? "1 neues Feedback" : `${count} neue Feedbacks`;
        unreadBadge.style.display = "block";
      });
    };
    // Feedback kommt waehrend eines Festivals unregelmaessig rein -- ein
    // gelegentliches Nachfragen reicht, keine aufwendigere Live-Loesung
    // (z. B. Websocket) noetig fuer eine reine Kiosk-Randnotiz. War 60s --
    // dieser Footer wird nur EINMAL beim App-Start gebaut (siehe Aufrufer
    // oben), der Hinweis aktualisierte sich also bis zu eine ganze Minute
    // lang gar nicht, was sich wie eine verschluckte Meldung anfuehlte
    // (gemeldet). Der Endpunkt ist trivial billig, daher deutlich kuerzer.
    this.registerFooterPoll(refreshUnreadBadge, 15_000);

    // Papier-Warnung -- auf ausdruecklichen Wunsch, "falls es geht": der
    // Bondrucker beantwortet eine ESC/POS-Statusabfrage (siehe server/
    // serve.js#queryPrinterPaperStatus), die Bit-Bedeutung ist aber nur
    // best-effort ermittelt (nicht an einer wirklich leeren Rolle
    // gegengetestet). Bleibt deshalb bewusst UNSICHTBAR, ausser bei einer
    // eindeutigen Warnung ("low"/"empty") -- bei "unknown"/Fehler/keinem
    // Drucker lieber gar nichts anzeigen als etwas potenziell Falsches.
    // Stand zunaechst links vom Logo oben, auf ausdruecklichen Wunsch
    // hierher verschoben (unten rechts, wo vorher der Admin-Button war) --
    // UND mit Text ergaenzt statt nur dem Warndreieck allein.
    const paperWarn = document.createElement("div");
    paperWarn.className = "chrome-footer-paper-warn";
    paperWarn.style.display = "none";
    const paperWarnIcon = document.createElement("span");
    paperWarnIcon.className = "chrome-footer-paper-warn__icon";
    paperWarnIcon.innerHTML = icons.warningTriangle;
    const paperWarnText = document.createElement("span");
    paperWarn.append(paperWarnIcon, paperWarnText);

    const refreshPaperWarning = () => {
      fetch("./api/system/printer/paper")
        .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
        .then((data: { available: boolean; paper?: "ok" | "low" | "empty" | "unknown" }) => {
          if (!data.available || data.paper === "ok" || data.paper === "unknown" || !data.paper) {
            paperWarn.style.display = "none";
            return;
          }
          const empty = data.paper === "empty";
          paperWarn.classList.toggle("chrome-footer-paper-warn--empty", empty);
          paperWarnText.textContent = empty ? "Ticketpapier ist alle" : "Ticketpapier wird knapp";
          paperWarn.style.display = "flex";
        })
        // Kein Server/kein Drucker (z. B. lokale Entwicklung) -- lautlos
        // wirkungslos bleiben, wie auch sonst bei allen /api/system/*-Aufrufen
        // ohne echten Pi.
        .catch(() => {
          paperWarn.style.display = "none";
        });
    };
    this.registerFooterPoll(refreshPaperWarning, 60_000);

    // Ticket-Cooldown-Countdown (siehe core/ticketCooldown.ts) -- nur
    // sichtbar, waehrend wirklich einer laeuft. Ein Tippen darauf oeffnet
    // eine kurze Erklaerung, warum es diese Wartezeit gibt.
    const cooldownBadge = document.createElement("button");
    cooldownBadge.type = "button";
    cooldownBadge.className = "chrome-footer-cooldown-badge";
    cooldownBadge.style.display = "none";
    const cooldownIcon = document.createElement("span");
    cooldownIcon.className = "chrome-footer-cooldown-badge__icon";
    cooldownIcon.innerHTML = icons.clock;
    const cooldownText = document.createElement("span");
    cooldownBadge.append(cooldownIcon, cooldownText);
    guardedClick(cooldownBadge, () => openTicketCooldownInfo());

    const refreshCooldownBadge = () => {
      const remaining = getTicketCooldownRemainingMs();
      if (remaining <= 0) {
        cooldownBadge.style.display = "none";
        return;
      }
      cooldownText.textContent = `Ticket-Cooldown: noch ${formatCooldownCountdown(remaining)}`;
      cooldownBadge.style.display = "flex";
    };
    this.registerFooterPoll(refreshCooldownBadge, 1000);

    // Ticket-Zeitfenster-Hinweis (siehe core/ticketPrintWindow.ts, Standard
    // 21:00-04:00 -- Oeffnungszeiten der Zornbar) -- nur sichtbar, waehrend
    // der Ticketdruck gerade wegen der Uhrzeit pausiert. Selbes Muster wie
    // der Cooldown-Badge direkt darueber.
    const printWindowBadge = document.createElement("button");
    printWindowBadge.type = "button";
    printWindowBadge.className = "chrome-footer-cooldown-badge";
    printWindowBadge.style.display = "none";
    const printWindowIcon = document.createElement("span");
    printWindowIcon.className = "chrome-footer-cooldown-badge__icon";
    printWindowIcon.innerHTML = icons.clock;
    const printWindowText = document.createElement("span");
    printWindowBadge.append(printWindowIcon, printWindowText);
    guardedClick(printWindowBadge, () => openTicketPrintWindowInfo());

    const refreshPrintWindowBadge = () => {
      const settings = getTicketPrintWindowSettings();
      if (!isPrintingEnabled() || !settings.enabled || isWithinTicketPrintWindow()) {
        printWindowBadge.style.display = "none";
        return;
      }
      printWindowText.textContent = `Tickets nur ${formatTicketPrintWindow(settings)}`;
      printWindowBadge.style.display = "flex";
    };
    this.registerFooterPoll(refreshPrintWindowBadge, 30_000);

    // Kleine, unaufdringliche Versionsanzeige -- auf ausdruecklichen Wunsch,
    // damit auf einen Blick erkennbar ist, welcher Stand gerade laeuft (fuer
    // Debugging/um zu pruefen, ob ein Deploy wirklich angekommen ist). Ganz
    // gedaempft gehalten (eigene, kleinere Fussleisten-Schriftgroesse). Stand
    // vorher unten LINKS in notifyCol -- auf ausdruecklichen Wunsch jetzt
    // stattdessen als vierte Zeile UNTER dem Credit-Block (siehe credit
    // unten), zusaetzlich doppelt so gross wie zuvor (siehe .chrome-footer-
    // version in style.css). __APP_BUILD__/__APP_BUILD_TIME__ werden erst
    // beim Bauen eingesetzt, siehe vite.config.ts.
    const versionLabel = document.createElement("span");
    versionLabel.className = "chrome-footer-credit__line chrome-footer-version";
    versionLabel.textContent = `Build ${__APP_BUILD__} · ${__APP_BUILD_TIME__}`;
    // Als vierte Zeile ans Ende des Credit-Blocks (siehe credit oben) --
    // appendChild statt Teil des innerHTML-Templates dort, weil versionLabel
    // erst hier (nach __APP_BUILD__/__APP_BUILD_TIME__) entsteht.
    credit.appendChild(versionLabel);

    const notifyCol = document.createElement("div");
    notifyCol.style.display = "flex";
    notifyCol.style.flexDirection = "column";
    // War flex-end (rechtsbuendig, als die Spalte noch rechts stand) -- auf
    // ausdruecklichen Wunsch jetzt links, angelehnt an die VBB-Vorlage
    // (Sprachwaehler links, einzelner Button rechts): linksbuendig, damit
    // der Text natuerlich am selben Rand wie die Fussleiste beginnt.
    notifyCol.style.alignItems = "flex-start";
    notifyCol.style.gap = "3px";
    notifyCol.append(paperWarn, cooldownBadge, printWindowBadge, unreadBadge);

    // Auf ausdruecklichen Wunsch Seiten getauscht (war Feedback-Button
    // links/Meldungen rechts) -- angelehnt an die VBB-Vorlage, wo der
    // einzelne Fussleisten-Button rechts sitzt.
    bar.append(notifyCol, credit, feedbackBtn);

    // Der Credit-Block ist per CSS zur GANZEN Leiste zentriert (nicht mehr
    // nur innerhalb einer Gitter-Luecke, siehe .chrome-footer-credit), auf
    // ausdruecklichen Wunsch ("an der Seite mittig zentrieren, nicht an dem
    // verfuegbaren Platz"). Reines CSS kann dabei aber nicht gleichzeitig
    // "echte Seitenmitte" UND "nie mit den Nachbarn ueberlappen" garantieren,
    // wenn eine Seite (hier: der immer sichtbare Feedback-Button) deutlich
    // breiter ist als die andere (Meldungs-Spalte oft leer) -- ein max-width
    // gross genug fuer die Mitte war dann breit genug, um sichtbar unter den
    // Feedback-Button zu ragen (gemeldeter/reproduzierter Bug). Deshalb hier
    // dynamisch per JS begrenzt: die kleinere der beiden Distanzen
    // Mitte->Meldungsspalten-Kante bzw. Mitte->Button-Kante (minus etwas
    // Sicherheitsabstand) bestimmt die maximale Halbbreite -- ResizeObserver
    // statt nur einmaligem Berechnen, weil sich sowohl die Fensterbreite als
    // auch die Meldungs-Spalte selbst aendern kann (Papier-Warnung/
    // Ungelesen-Hinweis blenden sich unabhaengig voneinander erst
    // nachtraeglich ein).
    const GAP_PX = 16;
    // Nur ein winziger Mindestwert (nicht z. B. 70 oder 24px, beides beim
    // Testen zu hoch): jeder groessere Mindestwert liess den Block bei
    // einem breiten Feedback-Button auf schmalen Bildschirmen weiterhin
    // SICHTBAR ueber ihn hinausragen (per Screenshot verifiziert: "Du
    // willst im" landete hinter "Feedback geben"). "Nie ueberlappen" hat
    // ausdruecklich Vorrang vor einer bestimmten Mindestbreite -- im
    // Zweifel (sehr schmaler Bildschirm + breiter Button) duerfen die
    // Zeilen eben stark umbrechen bzw. die kurzen (nowrap) Zeilen per
    // Ellipsis kuerzen, siehe .chrome-footer-credit__line.
    const MIN_HALF_WIDTH_PX = 8;
    const updateCreditMaxWidth = () => {
      const barRect = bar.getBoundingClientRect();
      if (barRect.width === 0) return; // Leiste (noch) nicht sichtbar/layoutet
      const half = barRect.width / 2;
      // notifyCol steht jetzt LINKS, feedbackBtn RECHTS (siehe bar.append
      // oben) -- die Distanz-Berechnung folgt dem, unabhaengig davon, wie
      // breit die jeweilige Seite gerade tatsaechlich ist.
      const notifyRect = notifyCol.getBoundingClientRect();
      const btnRect = feedbackBtn.getBoundingClientRect();
      const leftHalf = half - (notifyRect.right - barRect.left) - GAP_PX;
      const rightHalf = half - (barRect.right - btnRect.left) - GAP_PX;
      const safeHalf = Math.max(MIN_HALF_WIDTH_PX, Math.min(leftHalf, rightHalf));
      credit.style.maxWidth = `${Math.round(safeHalf * 2)}px`;
    };
    const creditWidthObserver = new ResizeObserver(updateCreditMaxWidth);
    creditWidthObserver.observe(bar);
    creditWidthObserver.observe(feedbackBtn);
    creditWidthObserver.observe(notifyCol);
    updateCreditMaxWidth();

    return bar;
  }

  private startClock(): void {
    if (this.clockInterval !== null) return;
    const tick = () => {
      this.chromeClock.textContent = formatClock(new Date());
    };
    tick();
    this.clockInterval = window.setInterval(tick, 1000);
  }

  private stopClock(): void {
    if (this.clockInterval !== null) {
      window.clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    this.chromeClock.textContent = "";
  }

  private clearScreen(): void {
    this.screenCleanup?.();
    this.screenCleanup = null;
    if (this.screenEl) {
      this.screenEl.remove();
      this.screenEl = null;
    }
  }

  /**
   * highscoreBtn und menuBtn stehen an derselben Stelle oben rechts und
   * schliessen sich gegenseitig aus: auf dem Hauptmenue gibt es nichts,
   * wohin man "zurueck" muesste, dafuer den Highscores-Einstieg; ueberall
   * sonst ist ein Weg zurueck ins Menue wichtiger als der Highscores-Zugang.
   */
  private setNavMode(mode: "menu-screen" | "elsewhere"): void {
    const onMenu = mode === "menu-screen";
    this.highscoreBtn.style.display = onMenu ? "flex" : "none";
    this.menuBtn.style.display = onMenu ? "none" : "flex";
  }

  showMenu(): void {
    this.teardownActiveGame();
    this.clearScreen();
    this.setNavMode("menu-screen");
    this.chromeGameTitle.textContent = "";
    this.startClock();
    this.resumeFooterPolling();
    // Im Admin-Panel deaktivierte Spiele werden im Hauptmenue nicht
    // aufgelistet (bleiben aber ueber ihre ID technisch weiterhin normal
    // spielbar -- "deaktiviert" heisst hier bewusst nur "aus dem Menue
    // ausgeblendet", nicht "gesperrt").
    const visibleGames = gameRegistry.filter((g) => isGameEnabled(g.id));
    const { element, destroy } = renderMainMenu(visibleGames, (id) => this.startGame(id));
    this.root.appendChild(element);
    this.screenEl = element;
    this.screenCleanup = destroy;

    // Erst schnell mit dem lokalen Stand rendern (siehe oben), dann im
    // Hintergrund den Server fragen, ob sich z. B. die Spiele-Sichtbarkeit
    // (vom Admin auf einem ANDEREN Geraet geaendert) inzwischen geaendert
    // hat -- bleibt bei fehlendem/deaktiviertem Server lautlos wirkungslos
    // (siehe core/sync.ts). Nur neu rendern, wenn sich wirklich etwas
    // geaendert hat UND man in der Zwischenzeit nicht schon weitergeklickt
    // hat (sonst wuerde ein spaet eintreffender Sync ein laufendes Spiel
    // unterbrechen).
    void syncPublicDataFromServer().then(({ settingsChanged }) => {
      if (settingsChanged && this.screenEl === element) this.showMenu();
    });
  }

  private showHighscores(): void {
    this.teardownActiveGame();
    this.clearScreen();
    this.stopClock();
    this.chromeGameTitle.textContent = "Highscores";
    this.setNavMode("elsewhere");
    // Dynamischer Import statt statischem -- das Highscore-Board wird dadurch
    // nur noch nachgeladen, wenn diese Ansicht wirklich geoeffnet wird, statt
    // bei jedem App-Start eingebacken zu sein (siehe auch der Admin-Import
    // weiter oben in dieser Datei).
    const placeholder = document.createElement("div");
    placeholder.className = "screen-loading";
    placeholder.innerHTML = `<span>Lädt …</span>`;
    this.root.appendChild(placeholder);
    this.screenEl = placeholder;
    void import("../menu/HighscoreBoard").then(({ renderHighscoreBoard }) => {
      if (this.screenEl !== placeholder) return; // zwischenzeitlich schon wieder verlassen
      const { element, destroy } = renderHighscoreBoard({ onPlay: (gameId, board) => this.startGame(gameId, board) });
      placeholder.replaceWith(element);
      this.screenEl = element;
      this.screenCleanup = destroy;
      playHighscoreOpenSound();
    });
  }

  /** initialBoard: siehe GameEnv#initialBoard -- vom "Jetzt spielen"-Button je Schwierigkeitsstufe im Highscore-Board (menu/HighscoreBoard.ts). */
  private startGame(id: string, initialBoard?: string): void {
    const meta = gameRegistry.find((g) => g.id === id);
    if (!meta) {
      console.error(`Unbekanntes Spiel: ${id}`);
      return;
    }

    this.clearScreen();
    this.startClock();
    this.chromeGameTitle.textContent = meta.title;
    this.setNavMode("elsewhere");
    // Siehe pauseFooterPolling()-Kommentar: waehrend des eigentlichen Spielens
    // (30fps-Canvas-Loop) muessen Feedback-/Papier-/Cooldown-Hinweis nicht
    // auch noch regelmaessig neu abgefragt werden, spart etwas Leistung auf
    // schwacher Pi-3-Hardware. showMenu() holt beim Verlassen sofort wieder
    // den aktuellen Stand nach.
    this.pauseFooterPolling();

    const stage = document.createElement("div");
    stage.className = "game-stage";

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "game-stage__canvas-wrap";
    const canvas = document.createElement("canvas");
    canvasWrap.appendChild(canvas);
    stage.appendChild(canvasWrap);

    const overlay = document.createElement("div");
    overlay.className = "game-stage__overlay";
    canvasWrap.appendChild(overlay);

    // Manche Spiele bauen in init() einiges an DOM/Zustand auf und laden
    // dabei per getImage()/new Image() bewusst erst JETZT ihre Bild-Assets
    // nach (nicht schon beim App-Start alle Spiele auf Vorrat -- wuerde auf
    // dem 1-GB-Pi-3-Kiosk unnoetig Speicher binden). init() selbst laeuft
    // synchron; ohne diesen Ladehinweis blieb der Bildschirm bis dahin
    // einfach das (schon nicht mehr reagierende) alte Menue stehen, was wie
    // ein Haenger wirkte (gemeldeter Bug: "dauert ein paar Sekunden, bis
    // ein Spiel kommt"). Der Ladehinweis wird ÜBER dem noch leeren Canvas
    // eingeblendet, BEVOR init() laeuft.
    const loadingEl = document.createElement("div");
    loadingEl.className = "game-stage__loading";
    loadingEl.innerHTML = `<span class="game-stage__loading-spinner"></span><span>Lädt …</span>`;
    stage.appendChild(loadingEl);

    this.root.appendChild(stage);
    this.screenEl = stage;

    const { ctx, resize } = setupCanvas(canvas);
    const size = resize();

    const env: GameEnv = {
      canvas,
      ctx,
      size,
      overlay,
      exit: () => this.showMenu(),
      initialBoard,
    };
    this.activeEnv = env;

    // Zwei rAF-Runden statt direktem Aufruf: die erste laesst den Browser
    // den oben eingehaengten Ladehinweis WIRKLICH einmal zeichnen (ein
    // einzelnes rAF liefe noch VOR dem Paint desselben Frames, in dem
    // loadingEl eingehaengt wurde), erst die zweite startet das (potenziell
    // laenger blockierende, synchrone) game.init().
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // zwischenzeitlich schon wieder verlassen (z. B. sofort auf Menue
        // getippt, noch bevor game.init() ueberhaupt lief) -- ueber screenEl
        // geprueft statt activeEnv/activeGame: teardownActiveGame() gibt bei
        // noch fehlendem activeGame (genau dieser Fall hier) sofort auf und
        // setzt activeEnv NIE zurueck, screenEl wird dagegen von jeder
        // Navigation (showMenu/showHighscores/startGame) zuverlaessig neu
        // gesetzt.
        if (this.screenEl !== stage) return;

        // meta.create() kann selbst ein Promise liefern (siehe
        // GameMeta.create-Kommentar): die meisten Spiele laden ihre
        // Implementierung erst hier per dynamischem import() nach, statt
        // schon beim App-Start. Derselbe Ladehinweis wie fuer das
        // synchrone init() unten deckt deshalb jetzt BEIDE potenziell
        // langsamen Schritte ab -- Promise.resolve() macht den `await`-losen
        // Pfad fuer synchron bleibende Spiele (noch nicht umgestellte/sehr
        // kleine Module) unveraendert genauso schnell wie zuvor.
        void Promise.resolve(meta.create()).then((game) => {
          // Zwischenzeitlich schon wieder verlassen (z. B. sofort auf Menue
          // getippt, noch WAEHREND der dynamische Import laeuft) -- dann gar
          // nicht erst initialisieren.
          if (this.screenEl !== stage) return;
          this.activeGame = game;

          const onResize = () => {
            env.size = resize();
            game.onResize?.(env);
          };
          window.addEventListener("resize", onResize);
          window.addEventListener("orientationchange", onResize);
          this.teardownFns.push(() => {
            window.removeEventListener("resize", onResize);
            window.removeEventListener("orientationchange", onResize);
          });

          const onDown = (e: PointerEvent) => game.onPointerDown?.(toCanvasPoint(canvas, e), env);
          const onMove = (e: PointerEvent) => game.onPointerMove?.(toCanvasPoint(canvas, e), env);
          const onUp = (e: PointerEvent) => game.onPointerUp?.(toCanvasPoint(canvas, e), env);
          canvas.addEventListener("pointerdown", onDown);
          canvas.addEventListener("pointermove", onMove);
          canvas.addEventListener("pointerup", onUp);
          canvas.addEventListener("pointercancel", onUp);
          this.teardownFns.push(() => {
            canvas.removeEventListener("pointerdown", onDown);
            canvas.removeEventListener("pointermove", onMove);
            canvas.removeEventListener("pointerup", onUp);
            canvas.removeEventListener("pointercancel", onUp);
          });

          // War performance.now() -- das ist die Zeit seit Seitenladung, nicht
          // die echte Uhrzeit. new Date(performance.now()) landet dadurch
          // immer nahe 01.01.1970 (gemeldeter Bug in der Admin-Spielstatistik,
          // siehe recordSession/teardownActiveGame unten -- dort wird aus
          // genau diesem Wert das angezeigte Datum gebaut). Date.now() liefert
          // echte Unix-Millisekunden.
          this.sessionStartedAt = Date.now();

          const loop = new GameLoop((dt) => {
            // Waehrend z. B. die Highscore-Namenseingabe oder der Bildschirmschoner
            // offen ist, bringt Weiterrendern nichts (beide liegen komplett drueber)
            // und kostet auf schwacher Hardware (Pi 3) spuerbar Leistung -- siehe
            // hasOpenModal()-Kommentar in modal.ts.
            if (hasOpenModal() || isScreensaverActive()) return;
            game.update(dt, env);
            game.render(env);
          });
          this.activeLoop = loop;

          void Promise.resolve(game.init(env)).then(() => {
            // Init kann async sein (z. B. Netz-/Datenaufbereitung) -- Loop erst
            // danach starten, damit update()/render() nie auf halbfertigem
            // Zustand laufen.
            if (this.activeGame === game) {
              loadingEl.remove();
              loop.start();
            }
          });
        });
      });
    });
  }

  /** Stoppt Loop, ruft cleanup() des aktiven Spiels auf und entfernt Event-Listener. */
  private teardownActiveGame(): void {
    if (!this.activeGame) return;

    this.activeLoop?.stop();
    this.activeLoop = null;

    for (const fn of this.teardownFns.splice(0)) fn();

    if (this.activeEnv) {
      try {
        this.activeGame.cleanup(this.activeEnv);
      } catch (err) {
        console.error(`Fehler beim Aufraeumen von Spiel "${this.activeGame.id}":`, err);
      }
      recordSession(this.activeGame.id, this.sessionStartedAt, Date.now());
    }

    this.activeGame = null;
    this.activeEnv = null;
  }
}
