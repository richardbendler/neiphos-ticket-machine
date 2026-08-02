import { setupCanvas } from "./Canvas";
import { GameLoop } from "./GameLoop";
import { toCanvasPoint } from "./input";
import { icons } from "./icons";
import { recordSession } from "./stats";
import { closeAllModals } from "./modal";
import { gameRegistry } from "../games/registry";
import { renderMainMenu } from "../menu/MainMenu";
import { openAdminPanel } from "../admin/AdminPanel";
import { openFeedbackDialog } from "./feedbackPrompt";
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
  private readonly chromeTitle: HTMLElement;
  private readonly menuBtn: HTMLButtonElement;
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
    this.chromeTitle = chromeBar.querySelector(".chrome-bar__title")!;
    this.menuBtn = chromeBar.querySelector(".chrome-menu-btn")!;
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

    // Permanent oben links, mit hoeherer Stapelreihenfolge als jedes Modal
    // (siehe style.css) -- dadurch kommt man WIRKLICH von ueberall aus sofort
    // zurueck ins Hauptmenue, auch waehrend z. B. gerade ein Spiel-Anleitungs-
    // oder Highscore-Dialog offen ist.
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "chrome-menu-btn";
    menuBtn.setAttribute("aria-label", "Zurück zum Hauptmenü");
    menuBtn.innerHTML = `${icons.exit}<span>Menü</span>`;
    menuBtn.addEventListener("click", () => {
      closeAllModals();
      this.showMenu();
    });

    const title = document.createElement("div");
    title.className = "chrome-bar__title";

    const brand = document.createElement("div");
    brand.className = "chrome-bar__brand";
    const logo = document.createElement("img");
    logo.className = "chrome-bar__logo";
    logo.src = brandLogo;
    logo.alt = "Neiphos";
    brand.appendChild(logo);

    bar.append(menuBtn, title, brand);
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
    feedbackBtn.addEventListener("click", () => openFeedbackDialog());

    const credit = document.createElement("div");
    credit.className = "chrome-footer-credit";
    credit.innerHTML = `<span>präsentiert von</span> <strong>DJ Flipper</strong>`;

    // Design bewusst an den "Tarifinfo"-Button der Vorlage angelehnt (silbern
    // umrandete Taste), aber deutlich kleiner -- es ist nur der Einstieg
    // hinter dem Passwortschutz, kein prominentes Hauptfeature.
    const adminBtn = document.createElement("button");
    adminBtn.type = "button";
    adminBtn.className = "chrome-footer-btn chrome-footer-admin-btn";
    adminBtn.setAttribute("aria-label", "Admin-Bereich");
    adminBtn.innerHTML = `<span class="chrome-footer-btn__icon">${icons.gear}</span><span>Admin</span>`;
    adminBtn.addEventListener("click", () => openAdminPanel());

    bar.append(feedbackBtn, credit, adminBtn);
    return bar;
  }

  private startClock(): void {
    if (this.clockInterval !== null) return;
    const tick = () => {
      this.chromeTitle.textContent = formatClock(new Date());
    };
    tick();
    this.clockInterval = window.setInterval(tick, 1000);
  }

  private stopClock(): void {
    if (this.clockInterval !== null) {
      window.clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
  }

  private clearScreen(): void {
    this.screenCleanup?.();
    this.screenCleanup = null;
    if (this.screenEl) {
      this.screenEl.remove();
      this.screenEl = null;
    }
  }

  showMenu(): void {
    this.teardownActiveGame();
    this.clearScreen();
    this.menuBtn.style.visibility = "hidden";
    this.startClock();
    const { element, destroy } = renderMainMenu(gameRegistry, (id) => this.startGame(id));
    this.root.appendChild(element);
    this.screenEl = element;
    this.screenCleanup = destroy;
  }

  private startGame(id: string): void {
    const meta = gameRegistry.find((g) => g.id === id);
    if (!meta) {
      console.error(`Unbekanntes Spiel: ${id}`);
      return;
    }

    this.clearScreen();
    this.stopClock();
    this.chromeTitle.textContent = meta.title;
    this.menuBtn.style.visibility = "visible";

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
      game.update(dt, env);
      game.render(env);
    });
    this.activeLoop = loop;

    void Promise.resolve(game.init(env)).then(() => {
      // Init kann async sein (z. B. Netz-/Datenaufbereitung) -- Loop erst
      // danach starten, damit update()/render() nie auf halbfertigem
      // Zustand laufen.
      if (this.activeGame === game) loop.start();
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
