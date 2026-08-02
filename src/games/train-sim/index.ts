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
const SPEED_KM_S = 45;

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
  let reachedFestival = false;

  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let topBar: HTMLDivElement;
  let goalLine: HTMLDivElement;
  let sheet: HTMLDivElement;
  let currentCityLabel: HTMLDivElement;
  let choiceHost: HTMLDivElement;
  let finishHost: HTMLDivElement;

  /**
   * "Du bist in ..." steht bewusst direkt ueber der Liste der Anschluss-
   * stationen (statt separat oben im HUD) -- so ist auf einen Blick klar,
   * dass das die aktuelle Station ist, von der aus die Wahl unten gilt.
   */
  function updateLabels(): void {
    goalLine.textContent = `Ziel: Kyritz · ${formatLegCount(legsCompleted)} bisher`;
    currentCityLabel.textContent = `Du bist in: ${cityName(currentCityId)}`;
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
    currentCityLabel.style.display = phase === "choosing" ? "block" : "none";
    choiceHost.style.display = phase === "choosing" ? "flex" : "none";
    finishHost.style.display = phase === "finished" ? "flex" : "none";
  }

  function beginChoice(): void {
    phase = "choosing";
    updateLabels();
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

  /** Kleine Zugsilhouette in Draufsicht, zeigt in Fahrtrichtung (nach rechts). */
  function drawTrainTop(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    ctx.roundRect(-15, -7, 30, 14, 4);
    ctx.fill();
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(15, -7);
    ctx.lineTo(22, 0);
    ctx.lineTo(15, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawStationDot(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, color: string): void {
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.font = `700 13px ${theme.fontDisplay}`;
    ctx.fillStyle = theme.text;
    ctx.fillText(label, x, y - 18);
  }

  /**
   * Draufsicht-Karte statt der 3D-Perspektivstrecke aus dem Weichenspiel --
   * bewusst eine andere Optik, damit sich die beiden Spiele nicht gleich
   * anfuehlen. Ausserhalb der Fahrt (waehrend der Stationswahl) steht nur
   * ein einzelner Punkt fuer die aktuelle Station.
   */
  function drawMap(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const midY = size.height * 0.4;

    if (phase === "traveling" && targetCityId) {
      const fromX = size.width * 0.16;
      const toX = size.width * 0.84;
      const pct = currentEdgeKm > 0 ? Math.min(1, progressKm / currentEdgeKm) : 0;

      ctx.strokeStyle = theme.panelBorderLight;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(fromX, midY);
      ctx.lineTo(toX, midY);
      ctx.stroke();

      const tieCount = 18;
      ctx.strokeStyle = "rgba(180,150,40,0.35)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= tieCount; i++) {
        const x = lerp(fromX, toX, i / tieCount);
        ctx.beginPath();
        ctx.moveTo(x, midY - 6);
        ctx.lineTo(x, midY + 6);
        ctx.stroke();
      }

      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(fromX, midY);
      ctx.lineTo(lerp(fromX, toX, pct), midY);
      ctx.stroke();

      drawStationDot(ctx, fromX, midY, cityName(currentCityId), theme.textMuted);
      const targetColor = targetCityId === FESTIVAL_CITY_ID ? theme.accent : theme.primary;
      drawStationDot(ctx, toX, midY, cityName(targetCityId), targetColor);
      drawTrainTop(ctx, lerp(fromX, toX, pct), midY);

      ctx.textAlign = "center";
      ctx.font = `600 12px ${theme.font}`;
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(`${Math.round(progressKm)} / ${Math.round(currentEdgeKm)} km`, size.width / 2, midY + 38);
    } else {
      drawStationDot(ctx, size.width / 2, midY, cityName(currentCityId), theme.accent);
      ctx.textAlign = "center";
      ctx.font = `600 12px ${theme.font}`;
      ctx.fillStyle = theme.textMuted;
      ctx.fillText("Du bist hier", size.width / 2, midY + 26);
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      topBar = document.createElement("div");
      topBar.className = "stage-top-bar";

      goalLine = document.createElement("div");
      goalLine.style.fontFamily = "var(--font-display)";
      goalLine.style.fontWeight = "600";
      goalLine.style.fontSize = "0.85rem";
      goalLine.style.color = theme.accent;
      goalLine.style.textAlign = "center";
      goalLine.style.width = "100%";

      topBar.appendChild(goalLine);
      env.overlay.appendChild(topBar);

      sheet = document.createElement("div");
      sheet.className = "stage-sheet";
      sheet.style.alignItems = "center";
      sheet.style.textAlign = "center";
      sheet.style.gap = "8px";

      currentCityLabel = document.createElement("div");
      currentCityLabel.style.fontFamily = "var(--font-display)";
      currentCityLabel.style.fontWeight = "800";
      currentCityLabel.style.fontSize = "1.05rem";
      currentCityLabel.style.color = "var(--text)";
      sheet.appendChild(currentCityLabel);

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
          "Du startest an einem zufälligen deutschen Bahnhof und musst nach Kyritz — dort wartet das Auto-Shuttle zum Neiphos Festival. An jeder Station entscheidest du, wohin die Fahrt weitergeht. Highscore: möglichst wenige Züge bis Kyritz.",
        onStart: () => {
          closeIntro = null;
          started = true;
        },
      });
    },

    update(dt: number) {
      if (!started || phase !== "traveling") return;
      progressKm += SPEED_KM_S * dt;
      if (progressKm >= currentEdgeKm) {
        arriveAtTarget();
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      if (!started) return;

      drawMap(ctx, size);
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
