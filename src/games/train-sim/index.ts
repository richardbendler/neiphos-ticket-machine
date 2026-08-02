import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { cityName, neighborsOf, randomStartCity, FESTIVAL_CITY_ID, type RailEdge } from "../../data/germanRailNetwork";
import { showGameIntro } from "../../core/gameIntro";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { registerGame } from "../registry";

const GAME_ID = "train-sim";
// Eigenes Board (statt "default"), da das alte Spielprinzip (meiste besuchte
// Staedte, hoeher-ist-besser) unter demselben Key voellig andere Werte
// gespeichert hat -- die waeren sonst als (falsch interpretierte) Zugzahlen
// wieder aufgetaucht.
const BOARD = "kyritz";
const HIGHSCORE_POPUP_DELAY_MS = 2000;
const MIN_SPEED = 20;
const MAX_SPEED = 100;
const SPEED_STEP = 10;
const DEFAULT_SPEED = 45;

type Phase = "choosing" | "traveling" | "finished";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function formatLegCount(value: number): string {
  return value === 1 ? "1 Zug" : `${value} Züge`;
}

function createTrainSimGame(): MinigameModule {
  let started = false;
  let phase: Phase = "choosing";
  let currentCityId = randomStartCity(FESTIVAL_CITY_ID);
  let previousCityId: string | null = null;
  let targetCityId: string | null = null;
  let currentEdgeKm = 0;
  let progressKm = 0;
  let legsCompleted = 0;
  let speedKmS = DEFAULT_SPEED;
  let tieOffset = 0;
  let reachedFestival = false;

  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let topBar: HTMLDivElement;
  let speedLabel: HTMLSpanElement;
  let goalLine: HTMLDivElement;
  let cityLine: HTMLDivElement;
  let sheet: HTMLDivElement;
  let choiceHost: HTMLDivElement;
  let finishHost: HTMLDivElement;

  function updateSpeedLabel(): void {
    speedLabel.textContent = `${speedKmS} km/s`;
  }

  function setSpeed(next: number): void {
    speedKmS = Math.min(MAX_SPEED, Math.max(MIN_SPEED, next));
    updateSpeedLabel();
  }

  /**
   * Aktuelle Station als DOM-Text statt auf dem Canvas -- so bleibt sie auf
   * jeder Bildschirmhoehe lesbar. Eine Canvas-Position mit festem Pixel-
   * Versatz geriet auf kuerzeren Viewports in den dunklen Gleisbereich und
   * war dort praktisch unsichtbar (dunkler Text auf dunklem Grund).
   */
  function updateCityInfo(): void {
    goalLine.textContent = `Ziel: Kyritz · ${formatLegCount(legsCompleted)} bisher`;
    if (phase === "traveling" && targetCityId) {
      const pct = Math.min(100, Math.round((progressKm / currentEdgeKm) * 100));
      cityLine.textContent = `${cityName(currentCityId)} → ${cityName(targetCityId)} (${pct}%)`;
    } else {
      cityLine.textContent = cityName(currentCityId);
    }
  }

  function renderChoiceButtons(options: RailEdge[]): void {
    choiceHost.innerHTML = "";
    for (const edge of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.style.width = "100%";
      const isFestivalStop = edge.to === FESTIVAL_CITY_ID;
      btn.textContent = `→ ${cityName(edge.to)} (${edge.km} km)${isFestivalStop ? " 🎪" : ""}`;
      if (isFestivalStop) btn.classList.add("btn--accent");
      btn.addEventListener("click", () => startLeg(edge));
      choiceHost.appendChild(btn);
    }
    updateSheetVisibility();
  }

  function updateSheetVisibility(): void {
    sheet.style.display = phase === "choosing" || phase === "finished" ? "flex" : "none";
    choiceHost.style.display = phase === "choosing" ? "flex" : "none";
    finishHost.style.display = phase === "finished" ? "flex" : "none";
    topBar.style.display = phase === "finished" ? "none" : "flex";
  }

  function beginChoice(): void {
    phase = "choosing";
    updateCityInfo();
    const options = neighborsOf(currentCityId, previousCityId);
    if (options.length === 0) {
      finish(false);
      return;
    }
    if (options.length === 1) {
      startLeg(options[0]);
      return;
    }
    renderChoiceButtons(options);
  }

  function startLeg(edge: RailEdge): void {
    targetCityId = edge.to;
    currentEdgeKm = edge.km;
    progressKm = 0;
    phase = "traveling";
    updateSheetVisibility();
    updateCityInfo();
  }

  function arriveAtTarget(): void {
    previousCityId = currentCityId;
    currentCityId = targetCityId!;
    targetCityId = null;
    legsCompleted += 1;
    if (currentCityId === FESTIVAL_CITY_ID) {
      finish(true);
    } else {
      beginChoice();
    }
  }

  function finish(reached: boolean): void {
    phase = "finished";
    reachedFestival = reached;
    updateSheetVisibility();
    renderFinishPanel();

    if (!reached) return;
    const outcome = getHighscoreOutcome(GAME_ID, legsCompleted, "lower-better", BOARD);
    if (outcome !== "none") {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatLegCount(legsCompleted)} bis nach Kyritz — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            highscoreBanner.update(recordHighscore(GAME_ID, name, legsCompleted, "lower-better", BOARD));
          },
        });
      }, HIGHSCORE_POPUP_DELAY_MS);
    }
  }

  function renderFinishPanel(): void {
    finishHost.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.2rem";
    title.style.color = theme.accent;
    title.textContent = reachedFestival ? "Willkommen in Kyritz! 🎪" : "Sackgasse!";
    finishHost.appendChild(title);

    const detail = document.createElement("div");
    detail.style.color = "var(--text-muted)";
    detail.style.fontSize = "0.88rem";
    detail.style.margin = "6px 0 12px";
    detail.textContent = reachedFestival
      ? `Das Auto-Shuttle zum Neiphos Festival wartet — in ${formatLegCount(legsCompleted)} geschafft.`
      : "Von hier führt keine Strecke weiter. Versuch eine andere Route.";
    finishHost.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.textContent = "Nochmal";
    again.addEventListener("click", resetRun);
    finishHost.appendChild(again);
  }

  function resetRun(): void {
    currentCityId = randomStartCity(FESTIVAL_CITY_ID);
    previousCityId = null;
    targetCityId = null;
    currentEdgeKm = 0;
    progressKm = 0;
    legsCompleted = 0;
    reachedFestival = false;
    highscoreBanner.update(getHighscoreBoard(GAME_ID, BOARD));
    beginChoice();
  }

  // ---------------------------------------------------------------- Zeichnen

  function geometry(size: { width: number; height: number }) {
    const horizonY = size.height * 0.36;
    const baseY = size.height * 0.86;
    const cx = size.width / 2;
    return { horizonY, baseY, cx };
  }

  function drawTrack(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const { horizonY, baseY, cx } = geometry(size);

    const grad = ctx.createLinearGradient(0, horizonY, 0, baseY);
    grad.addColorStop(0, "#173b40");
    grad.addColorStop(1, theme.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizonY, size.width, baseY - horizonY);

    const topHalfWidth = 8;
    const baseHalfWidth = size.width * 0.42;

    ctx.fillStyle = "#0f2b2f";
    ctx.beginPath();
    ctx.moveTo(cx - topHalfWidth, horizonY);
    ctx.lineTo(cx + topHalfWidth, horizonY);
    ctx.lineTo(cx + baseHalfWidth, baseY);
    ctx.lineTo(cx - baseHalfWidth, baseY);
    ctx.closePath();
    ctx.fill();

    // Schwellen, die im Fahrttempo auf den Betrachter zulaufen.
    const tieCount = 10;
    for (let i = 0; i < tieCount; i++) {
      const d = (((i / tieCount + tieOffset) % 1) + 1) % 1;
      const eased = d * d;
      const y = lerp(horizonY, baseY, eased);
      const halfW = lerp(topHalfWidth, baseHalfWidth, eased);
      ctx.strokeStyle = `rgba(255,204,51,${0.15 + eased * 0.35})`;
      ctx.lineWidth = 2 + eased * 3;
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 0.9, y);
      ctx.lineTo(cx + halfW * 0.9, y);
      ctx.stroke();
    }

    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - topHalfWidth, horizonY);
    ctx.lineTo(cx - baseHalfWidth, baseY);
    ctx.moveTo(cx + topHalfWidth, horizonY);
    ctx.lineTo(cx + baseHalfWidth, baseY);
    ctx.stroke();
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      topBar = document.createElement("div");
      topBar.className = "stage-top-bar";
      topBar.style.flexDirection = "column";
      topBar.style.gap = "6px";

      const speedRow = document.createElement("div");
      speedRow.style.display = "flex";
      speedRow.style.alignItems = "center";
      speedRow.style.justifyContent = "center";
      speedRow.style.gap = "10px";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.className = "btn btn--ghost";
      minusBtn.textContent = "−";
      minusBtn.addEventListener("click", () => setSpeed(speedKmS - SPEED_STEP));

      speedLabel = document.createElement("span");
      speedLabel.style.fontFamily = "var(--font-display)";
      speedLabel.style.fontWeight = "700";
      speedLabel.style.minWidth = "76px";
      speedLabel.style.textAlign = "center";
      speedLabel.textContent = `${speedKmS} km/s`;

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.className = "btn btn--ghost";
      plusBtn.textContent = "+";
      plusBtn.addEventListener("click", () => setSpeed(speedKmS + SPEED_STEP));

      speedRow.append(minusBtn, speedLabel, plusBtn);

      goalLine = document.createElement("div");
      goalLine.style.fontFamily = "var(--font-display)";
      goalLine.style.fontWeight = "600";
      goalLine.style.fontSize = "0.8rem";
      goalLine.style.color = theme.accent;
      goalLine.style.textAlign = "center";

      cityLine = document.createElement("div");
      cityLine.style.fontFamily = "var(--font-display)";
      cityLine.style.fontWeight = "700";
      cityLine.style.fontSize = "1rem";
      cityLine.style.color = "var(--text)";
      cityLine.style.textAlign = "center";

      topBar.append(speedRow, goalLine, cityLine);
      env.overlay.appendChild(topBar);

      sheet = document.createElement("div");
      sheet.className = "stage-sheet";
      sheet.style.alignItems = "center";
      sheet.style.textAlign = "center";
      sheet.style.gap = "8px";

      choiceHost = document.createElement("div");
      choiceHost.style.display = "none";
      choiceHost.style.flexDirection = "column";
      choiceHost.style.gap = "8px";
      choiceHost.style.width = "100%";

      const choiceTitle = document.createElement("div");
      choiceTitle.className = "stage-sheet__title";
      choiceTitle.textContent = "Wohin geht die Fahrt?";
      sheet.appendChild(choiceTitle);
      sheet.appendChild(choiceHost);

      finishHost = document.createElement("div");
      finishHost.style.display = "none";
      finishHost.style.flexDirection = "column";
      finishHost.style.alignItems = "center";
      finishHost.style.textAlign = "center";
      sheet.appendChild(finishHost);

      env.overlay.appendChild(sheet);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatLegCount);
      highscoreBanner.update(getHighscoreBoard(GAME_ID, BOARD));

      beginChoice();
      updateSheetVisibility();

      closeIntro = showGameIntro({
        title: "Zugsimulator",
        description:
          "Du startest an einem zufälligen deutschen Bahnhof und musst nach Kyritz — dort wartet das Auto-Shuttle zum Neiphos Festival. An jeder Station entscheidest du, wohin die Fahrt weitergeht, die Geschwindigkeit kannst du oben jederzeit anpassen. Highscore: möglichst wenige Züge bis Kyritz.",
        onStart: () => {
          closeIntro = null;
          started = true;
        },
      });
    },

    update(dt: number) {
      if (!started || phase !== "traveling") return;
      const deltaKm = speedKmS * dt;
      progressKm += deltaKm;
      tieOffset += dt * (speedKmS / 25);
      if (progressKm >= currentEdgeKm) {
        arriveAtTarget();
      } else {
        updateCityInfo();
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      if (!started) return;

      drawTrack(ctx, size);
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeIntro?.();
      closeIntro = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      highscoreBanner?.destroy();
      topBar?.remove();
      sheet?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Zugsimulator",
  subtitle: "Finde den Weg nach Kyritz",
  icon: "locomotive",
  badge: "ZG",
  accent: "#1f6f43",
  create: createTrainSimGame,
  highscoreCategories: [{ board: BOARD, label: "Wenigste Züge", direction: "lower-better", formatValue: formatLegCount }],
});
