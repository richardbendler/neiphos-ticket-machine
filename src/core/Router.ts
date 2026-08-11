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
import { renderHighscoreBoard } from "../menu/HighscoreBoard";
import { openAdminPanel } from "../admin/AdminPanel";
import { openFeedbackDialog } from "./feedbackPrompt";
import { fetchUnreadFeedbackCount } from "./feedback";
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
        openAdminPanel(() => {
          if (this.screenEl?.classList.contains("menu-screen")) this.showMenu();
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
    refreshUnreadBadge();
    // Feedback kommt waehrend eines Festivals unregelmaessig rein -- ein
    // gelegentliches Nachfragen reicht, keine aufwendigere Live-Loesung
    // (z. B. Websocket) noetig fuer eine reine Kiosk-Randnotiz. War 60s --
    // dieser Footer wird nur EINMAL beim App-Start gebaut (siehe Aufrufer
    // oben), der Hinweis aktualisierte sich also bis zu eine ganze Minute
    // lang gar nicht, was sich wie eine verschluckte Meldung anfuehlte
    // (gemeldet). Der Endpunkt ist trivial billig, daher deutlich kuerzer.
    window.setInterval(refreshUnreadBadge, 15_000);

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
    refreshPaperWarning();
    window.setInterval(refreshPaperWarning, 60_000);

    const rightCol = document.createElement("div");
    rightCol.style.display = "flex";
    rightCol.style.flexDirection = "column";
    rightCol.style.alignItems = "flex-end";
    rightCol.style.gap = "3px";
    rightCol.append(paperWarn, unreadBadge);

    bar.append(feedbackBtn, credit, rightCol);
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
    const element = renderHighscoreBoard();
    this.root.appendChild(element);
    this.screenEl = element;
    playHighscoreOpenSound();
  }

  private startGame(id: string): void {
    const meta = gameRegistry.find((g) => g.id === id);
    if (!meta) {
      console.error(`Unbekanntes Spiel: ${id}`);
      return;
    }

    this.clearScreen();
    this.startClock();
    this.chromeGameTitle.textContent = meta.title;
    this.setNavMode("elsewhere");

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

        const game = meta.create();
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

        this.sessionStartedAt = performance.now();

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
      recordSession(this.activeGame.id, this.sessionStartedAt, performance.now());
    }

    this.activeGame = null;
    this.activeEnv = null;
  }
}
