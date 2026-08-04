import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { icons } from "../../core/icons";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { registerGame } from "../registry";

const imageCache = new Map<string, HTMLImageElement>();
function getImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

const GAME_ID = "train-photo";
const COUNTDOWN_START = 3;
const MIN_WAIT_S = 3;
const MAX_WAIT_S = 7;
const SPEED_PX_S = 1900; // absurd schnell -- nochmal doppelt so schnell wie zuvor
const TRAIN_WIDTH = 260;
const TRAIN_HEIGHT = 84;
// Ergebnis (Foto + Punktzahl) erscheint jetzt sofort zusammen -- nur der
// Highscore-Dialog (Namenseingabe) wartet noch kurz, wie bei allen anderen
// Spielen (siehe HIGHSCORE_POPUP_DELAY_MS dort). Vorher gab's hier eine
// eigene 2-Sekunden-Verzoegerung, die sogar die Punktzahl selbst erst nach
// dem Foto einblendete -- auf ausdruecklichen Wunsch entfernt: Ergebnisse
// sollen immer sofort angezeigt werden, nur der Highscore-Dialog wartet.
const HIGHSCORE_POPUP_DELAY_MS = 1000;
// Etwas breiter als der Zug selbst (TRAIN_WIDTH) -- ein wirklich mittiges
// Foto zeigt den kompletten Zug mit ein wenig Luft, ein daneben ausgeloestes
// Foto schneidet ihn sichtbar am Fotorand ab.
const PHOTO_WIDTH = 300;
const PHOTO_HEIGHT = 150;
const POLAROID_BORDER = 12;
const POLAROID_BOTTOM_BORDER = 44;
// Nicht jedes Fenster besetzt -- wirkt sonst zu "voll"/gleichfoermig, ein
// paar leere Fenster dazwischen sehen natuerlicher aus.
const WINDOW_HOPPER_CHANCE = 0.7;
// Grosszuegig bemessen: bei TRAIN_WIDTH=260 passen ca. 5 Fenster in den Zug
// (siehe drawTrain), mehr Eintraege schaden nicht, sie werden dann einfach
// nicht alle verbraucht.
const WINDOW_SLOT_COUNT = 8;

type Phase = "countdown" | "waiting" | "running" | "result";

function formatScore(value: number): string {
  return `${value.toFixed(2)} Punkte`;
}

function classifyScore(score: number): { text: string; color: string } {
  if (score >= 95) return { text: "Perfekt getroffen!", color: theme.success };
  if (score >= 75) return { text: "Sehr gut zentriert!", color: theme.success };
  if (score >= 45) return { text: "Ganz ordentlich.", color: theme.accent };
  if (score > 0) return { text: "Der Zug war ziemlich aus der Mitte.", color: theme.textMuted };
  return { text: "Verpasst!", color: theme.danger };
}

function generateWindowHoppers(): (string | null)[] {
  return Array.from({ length: WINDOW_SLOT_COUNT }, () =>
    Math.random() < WINDOW_HOPPER_CHANCE ? hopperAnimalCards[Math.floor(Math.random() * hopperAnimalCards.length)].image : null,
  );
}

function createTrainPhotoGame(): MinigameModule {
  let phase: Phase = "countdown";
  let countdown = COUNTDOWN_START;
  let waitTimer = 0;
  let started = false;
  let trainOffsetX = 0;
  let capturedOffsetX = 0;
  let score = 0;
  let missed = false;
  let flashTimer = 0;
  let windowHoppers: (string | null)[] = generateWindowHoppers();
  let currentSize = { width: 480, height: 800 };
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;

  let sheet: HTMLDivElement;
  let shutterHost: HTMLDivElement;
  let shutterBtn: HTMLButtonElement;
  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  function trackY(size: { height: number }): number {
    return size.height * 0.58;
  }

  function resetRound(): void {
    phase = "countdown";
    countdown = COUNTDOWN_START;
    trainOffsetX = -TRAIN_WIDTH;
    missed = false;
    score = 0;
    windowHoppers = generateWindowHoppers();
    renderSheet();
    updateShutterVisibility();
  }

  function updateShutterVisibility(): void {
    // Der Ausloeser ist von Anfang an (schon waehrend Countdown/Wartephase)
    // sichtbar, nicht erst wenn der Zug tatsaechlich zu sehen ist -- man
    // soll die ganze Zeit wissen, wo man hintippen muss.
    const visible = started && (phase === "countdown" || phase === "waiting" || phase === "running");
    shutterHost.style.display = visible ? "flex" : "none";
  }

  /** Zufaellige Wartezeit -- bewusst kein fixer Rhythmus, damit man nicht einfach mitzaehlen kann. */
  function randomWait(): number {
    return MIN_WAIT_S + Math.random() * (MAX_WAIT_S - MIN_WAIT_S);
  }

  function computeScore(offsetX: number, size: { width: number }): number {
    const trainCenter = offsetX + TRAIN_WIDTH / 2;
    const screenCenter = size.width / 2;
    // maxDist ist der Abstand, ab dem der Zug ueberhaupt kein einziges
    // Pixel mehr im tatsaechlichen Polaroid-Ausschnitt hat (PHOTO_WIDTH,
    // mittig zentriert -- siehe drawPolaroid) -- vorher war das die halbe
    // BILDSCHIRM-Breite, wodurch der Zug noch Punkte gab, obwohl er im
    // fertigen Foto laengst gar nicht mehr zu sehen war. 0 Punkte gibt es
    // jetzt GENAU dann, wenn der Zug komplett ausserhalb des Fotos liegt.
    const maxDist = PHOTO_WIDTH / 2 + TRAIN_WIDTH / 2;
    const dist = Math.abs(trainCenter - screenCenter);
    const normalized = Math.min(1, dist / maxDist);
    // Zwei Nachkommastellen statt ganzer Punkte -- 100 gibt es dadurch nur
    // noch bei wirklich EXAKT mittigem Foto, vorher reichte "ungefaehr
    // mittig" schon fuer die volle Punktzahl durch Rundung. Macht die volle
    // Punktzahl absichtlich extrem schwer, der Highscore soll immer wieder
    // knackbar bleiben.
    return Math.round((1 - normalized) * 10000) / 100;
  }

  function capture(): void {
    if (phase !== "running") return;
    capturedOffsetX = trainOffsetX;
    score = computeScore(capturedOffsetX, currentSize);
    missed = false;
    flashTimer = 0;
    finishRound();
  }

  function finishRound(): void {
    phase = "result";
    updateShutterVisibility();
    renderSheet();

    const outcome = getHighscoreOutcome(GAME_ID, score, "higher-better");
    if (outcome !== "none" && score > 0) {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatScore(score)} — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, score, "higher-better"));
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  function renderSheet(): void {
    sheet.innerHTML = "";
    if (phase !== "result") {
      sheet.style.display = "none";
      return;
    }
    sheet.style.display = "flex";

    const { text, color } = classifyScore(score);

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.1rem";
    title.style.color = color;
    title.textContent = missed ? "Verpasst!" : `${formatScore(score)} — ${text}`;
    sheet.appendChild(title);

    const detail = document.createElement("div");
    detail.style.color = "var(--text-muted)";
    detail.style.fontSize = "0.85rem";
    detail.style.margin = "6px 0 12px";
    detail.textContent = missed
      ? "Der Zug ist durchgefahren, ohne dass du ausgelöst hast."
      : "Je mittiger der Zug im Foto steht, desto mehr Punkte gibt es.";
    sheet.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.textContent = "Nochmal";
    again.addEventListener("click", resetRound);
    sheet.appendChild(again);
  }

  function drawTrain(ctx: CanvasRenderingContext2D, offsetX: number, y: number): void {
    const bodyY = y - TRAIN_HEIGHT;
    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    const r = 14;
    ctx.moveTo(offsetX + r, bodyY);
    ctx.arcTo(offsetX + TRAIN_WIDTH, bodyY, offsetX + TRAIN_WIDTH, bodyY + TRAIN_HEIGHT, r);
    ctx.arcTo(offsetX + TRAIN_WIDTH, bodyY + TRAIN_HEIGHT, offsetX, bodyY + TRAIN_HEIGHT, r);
    ctx.arcTo(offsetX, bodyY + TRAIN_HEIGHT, offsetX, bodyY, r);
    ctx.arcTo(offsetX, bodyY, offsetX + TRAIN_WIDTH, bodyY, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(offsetX, bodyY + TRAIN_HEIGHT - 10, TRAIN_WIDTH, 6);

    const winY = bodyY + 18;
    const winW = 30;
    const winH = 34;
    const winGap = 14;
    let x = offsetX + 18;
    let winIndex = 0;
    while (x + winW < offsetX + TRAIN_WIDTH - 14) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(x, winY, winW, winH, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, winY, winW, winH, 5);
      ctx.stroke();

      // Groesser als bei "Passagiere zaehlen" -- hier ist es reine Deko
      // (kein Zaehl-Spiel), darf also ruhig deutlich als Huepftier-Gesicht
      // erkennbar sein, das aus dem Fenster guckt, statt nur ein winziger
      // Farbpunkt zu sein.
      const hopperImage = windowHoppers[winIndex % windowHoppers.length];
      if (hopperImage) {
        const cx = x + winW / 2;
        const cy = winY + winH / 2 + 2;
        const radius = 13;
        const img = getImage(hopperImage);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();
        if (img.complete && img.naturalWidth > 0) {
          const scale = Math.max((radius * 2) / img.naturalWidth, (radius * 2) / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;
          ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        }
        ctx.restore();
      }

      winIndex += 1;
      x += winW + winGap;
    }

    ctx.fillStyle = "#1a1a1a";
    for (let wx = offsetX + 30; wx < offsetX + TRAIN_WIDTH - 20; wx += 70) {
      ctx.beginPath();
      ctx.arc(wx, bodyY + TRAIN_HEIGHT, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Zeigt das gerade "entwickelte" Foto als Polaroid: weisser Rahmen (unten
   * dicker, wie beim echten Vorbild), Motiv exakt auf den Rahmen zugeschnitten
   * -- steht der Zug nicht mittig genug, wird er am Fotorand sichtbar
   * abgeschnitten, statt weiterhin ueber den ganzen Bildschirm zu laufen.
   */
  function drawPolaroid(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const cardW = PHOTO_WIDTH + POLAROID_BORDER * 2;
    const cardH = PHOTO_HEIGHT + POLAROID_BORDER + POLAROID_BOTTOM_BORDER;
    const cardX = (size.width - cardW) / 2;
    const cardY = (size.height - cardH) / 2;
    const photoX = cardX + POLAROID_BORDER;
    const photoY = cardY + POLAROID_BORDER;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#fdfdfa";
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(photoX, photoY, PHOTO_WIDTH, PHOTO_HEIGHT);
    ctx.clip();

    const skyGrad = ctx.createLinearGradient(0, photoY, 0, photoY + PHOTO_HEIGHT);
    skyGrad.addColorStop(0, "#bcd7e6");
    skyGrad.addColorStop(0.62, "#dce6e0");
    skyGrad.addColorStop(0.62, "#8b9a90");
    skyGrad.addColorStop(1, "#5f6d64");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(photoX, photoY, PHOTO_WIDTH, PHOTO_HEIGHT);

    // Die Foto-Mitte liegt (weil beides mittig zum Bildschirm ausgerichtet
    // ist) exakt auf der Bildschirmmitte -- der Zug wird darum einfach mit
    // seiner tatsaechlichen Ausloese-Position gezeichnet, der Zuschnitt
    // ergibt sich automatisch aus dem clip() oben.
    const localTrackY = photoY + PHOTO_HEIGHT * 0.78;
    if (!missed) {
      drawTrain(ctx, capturedOffsetX, localTrackY);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(photoX + 0.5, photoY + 0.5, PHOTO_WIDTH - 1, PHOTO_HEIGHT - 1);
  }

  /**
   * Dunkle Vignette an den Raendern plus Sucher-Ecken -- soll den Eindruck
   * erwecken, man blicke durch einen Kamerasucher. Am Rand bleibt bewusst
   * noch ein Rest der Szene erkennbar (Vignette statt hartem Ausschnitt),
   * damit man z. B. den Zug von der Seite hereinkommen sieht.
   */
  function drawCameraLens(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, focusY: number): void {
    const cx = size.width / 2;
    const innerR = Math.min(size.width, size.height) * 0.34;
    const outerR = Math.max(size.width, size.height) * 0.8;
    const grad = ctx.createRadialGradient(cx, focusY, innerR, cx, focusY, outerR);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size.width, size.height);

    const inset = 18;
    const armLen = 26;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    const corners: Array<[number, number, number, number]> = [
      [inset, inset, 1, 1],
      [size.width - inset, inset, -1, 1],
      [inset, size.height - inset, 1, -1],
      [size.width - inset, size.height - inset, -1, -1],
    ];
    for (const [ccx, ccy, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(ccx, ccy + armLen * dy);
      ctx.lineTo(ccx, ccy);
      ctx.lineTo(ccx + armLen * dx, ccy);
      ctx.stroke();
    }

    // Mittellinie als Ausrichtungshilfe.
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(size.width / 2, 0);
    ctx.lineTo(size.width / 2, size.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Fadenkreuz-Markierung genau in der Bildmitte -- wie der Fokuspunkt
    // eines echten Kamerasuchers, damit sofort klar ist, wo "mittig" liegt.
    // Dunkel statt weiss: die radiale Vignette laesst die Bildmitte hell/
    // transparent, dort sass ein weisses Fadenkreuz kaum sichtbar auf dem
    // hellen theme.bg-Hintergrund.
    const reticleR = 22;
    const tick = 9;
    ctx.strokeStyle = "rgba(24,27,29,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, focusY, reticleR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - reticleR - tick, focusY);
    ctx.lineTo(cx - reticleR + tick, focusY);
    ctx.moveTo(cx + reticleR - tick, focusY);
    ctx.lineTo(cx + reticleR + tick, focusY);
    ctx.moveTo(cx, focusY - reticleR - tick);
    ctx.lineTo(cx, focusY - reticleR + tick);
    ctx.moveTo(cx, focusY + reticleR - tick);
    ctx.lineTo(cx, focusY + reticleR + tick);
    ctx.stroke();
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      for (const card of hopperAnimalCards) getImage(card.image);

      sheet = document.createElement("div");
      sheet.className = "stage-sheet";
      sheet.style.alignItems = "center";
      sheet.style.textAlign = "center";
      sheet.style.gap = "6px";
      env.overlay.appendChild(sheet);

      shutterHost = document.createElement("div");
      shutterHost.className = "shutter-host";
      shutterBtn = document.createElement("button");
      shutterBtn.type = "button";
      shutterBtn.className = "shutter-btn";
      shutterBtn.setAttribute("aria-label", "Auslösen");
      shutterBtn.innerHTML = icons.camera;
      shutterBtn.addEventListener("click", capture);
      shutterHost.appendChild(shutterBtn);
      env.overlay.appendChild(shutterHost);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatScore);
      highscoreBanner.update(getHighscoreBoard(GAME_ID));

      resetRound();

      closeIntro = showGameIntro({
        title: "Zugfoto",
        description: [
          "Ein Zug fährt schnell vorbei",
          "Tippe im richtigen Moment auf den Auslöser",
          "Je mittiger der Zug im Foto, desto mehr Punkte",
        ],
        onStart: () => {
          closeIntro = null;
          started = true;
          updateShutterVisibility();
        },
      });
    },

    update(dt: number) {
      if (!started) return;
      if (phase === "countdown") {
        countdown -= dt;
        if (countdown <= 0) {
          phase = "waiting";
          waitTimer = randomWait();
        }
        updateShutterVisibility();
      } else if (phase === "waiting") {
        waitTimer -= dt;
        if (waitTimer <= 0) phase = "running";
        updateShutterVisibility();
      } else if (phase === "running") {
        trainOffsetX += SPEED_PX_S * dt;
        if (trainOffsetX > currentSize.width + TRAIN_WIDTH) {
          missed = true;
          score = 0;
          capturedOffsetX = currentSize.width; // ausserhalb des Bilds, siehe render()
          finishRound();
        }
      } else if (phase === "result") {
        if (flashTimer < 1) flashTimer += dt * 4;
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      currentSize = size;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      const y = trackY(size);
      ctx.strokeStyle = theme.panelBorderLight;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();

      if (!started) return;

      if (phase === "countdown") {
        ctx.fillStyle = theme.text;
        ctx.textAlign = "center";
        ctx.font = `700 18px ${theme.fontDisplay}`;
        ctx.fillText("Halte die Kamera bereit!", size.width / 2, y - 170);
        ctx.font = `600 15px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText("Der Zug kommt gleich...", size.width / 2, y - 135);
        ctx.font = `800 86px ${theme.fontDisplay}`;
        ctx.fillStyle = theme.accent;
        ctx.fillText(`${Math.max(1, Math.ceil(countdown))}`, size.width / 2, y - 40);
      } else if (phase === "waiting") {
        // Bewusst OHNE Zahl/Timer -- man soll nicht genau wissen, wann der
        // Zug tatsaechlich kommt.
        ctx.fillStyle = theme.text;
        ctx.textAlign = "center";
        ctx.font = `700 18px ${theme.fontDisplay}`;
        ctx.fillText("Gleich ist es so weit...", size.width / 2, y - 150);
        ctx.font = `600 15px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText("Bereithalten!", size.width / 2, y - 120);
      } else if (phase === "running") {
        drawTrain(ctx, trainOffsetX, y);
      }

      if (phase !== "countdown" && phase !== "result") {
        drawCameraLens(ctx, size, y - TRAIN_HEIGHT / 2);
      }

      if (phase === "result") {
        // Dunkler "Tisch"-Hintergrund statt der Kamerasucher-Optik -- das
        // frisch "entwickelte" Foto soll im Fokus stehen.
        ctx.fillStyle = "#20211f";
        ctx.fillRect(0, 0, size.width, size.height);
        drawPolaroid(ctx, size);
        if (flashTimer < 1) {
          ctx.fillStyle = `rgba(255,255,255,${(1 - flashTimer) * 0.7})`;
          ctx.fillRect(0, 0, size.width, size.height);
        }
      }
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeIntro?.();
      closeIntro = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      sheet?.remove();
      shutterHost?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Zugfoto",
  subtitle: "Erwische den Zug in der Mitte",
  icon: "camera",
  badge: "ZF",
  accent: "#c62828",
  create: createTrainPhotoGame,
  highscoreCategories: [{ board: "default", label: "Bestwert", direction: "higher-better", formatValue: formatScore }],
});
