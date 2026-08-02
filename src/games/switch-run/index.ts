import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { showGameIntro } from "../../core/gameIntro";
import { registerGame } from "../registry";

const GAME_ID = "switch-run";
const FORK_DURATION = 1.1;
const OUTCOME_DURATION = 1.3;
const BASE_COUNTDOWN = 10;
const MIN_COUNTDOWN = 4;

function formatSwitches(value: number): string {
  return `${value} Weiche${value === 1 ? "" : "n"}`;
}

type Lane = "left" | "center" | "right";
type Phase = "approaching" | "forking" | "outcome" | "game-over";

const LANE_ORDER: Lane[] = ["left", "center", "right"];
const LANE_LABEL: Record<Lane, string> = { left: "Links", center: "Mitte", right: "Rechts" };
const LANE_ARROW: Record<Lane, string> = { left: "⭠", center: "⭡", right: "⭢" };

function pickDeadEnd(): Lane {
  return LANE_ORDER[Math.floor(Math.random() * LANE_ORDER.length)];
}

interface Point {
  x: number;
  y: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function createSwitchRunGame(): MinigameModule {
  let phase: Phase = "approaching";
  let started = false;
  let countdown = BASE_COUNTDOWN;
  let roundDuration = BASE_COUNTDOWN;
  let score = 0;
  let deadEndLane: Lane = pickDeadEnd();
  let chosenLane: Lane = "center";
  let forkTimer = 0;
  let outcomeTimer = 0;
  let crashed = false;
  let tieOffset = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let closeIntro: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let buttonBar: HTMLDivElement;
  let choiceIndicator: HTMLDivElement;
  let gameOverPanel: HTMLDivElement;

  function updateHud(): void {
    buttonBar.style.display = phase === "approaching" ? "flex" : "none";
    choiceIndicator.style.display = phase === "approaching" ? "flex" : "none";
    gameOverPanel.style.display = phase === "game-over" ? "flex" : "none";

    if (phase === "approaching") {
      choiceIndicator.innerHTML = `
        <span class="switch-choice-banner__arrow">${LANE_ARROW[chosenLane]}</span>
        <span class="switch-choice-banner__text">Gewählt: ${LANE_LABEL[chosenLane]}</span>
      `;
    }

    if (phase === "game-over") {
      gameOverPanel.innerHTML = "";
      const title = document.createElement("div");
      title.style.fontFamily = "var(--font-display)";
      title.style.fontWeight = "800";
      title.style.fontSize = "1.3rem";
      title.style.color = theme.danger;
      title.textContent = "Sackgasse!";
      const scoreLine = document.createElement("div");
      scoreLine.style.margin = "6px 0 14px";
      scoreLine.style.color = "var(--text-muted)";
      scoreLine.textContent = `Du hast ${score} Weiche${score === 1 ? "" : "n"} geschafft.`;
      const again = document.createElement("button");
      again.type = "button";
      again.className = "btn btn--accent";
      again.textContent = "Nochmal spielen";
      again.addEventListener("click", () => restart());
      gameOverPanel.append(title, scoreLine, again);
    }
  }

  function restart(): void {
    phase = "approaching";
    started = false;
    score = 0;
    roundDuration = BASE_COUNTDOWN;
    countdown = roundDuration;
    deadEndLane = pickDeadEnd();
    chosenLane = "center";
    crashed = false;
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    updateHud();

    closeIntro = showGameIntro({
      title: "Weichenspiel",
      description:
        "Vor jeder Weiche läuft ein Countdown. Wähle Links, Mitte oder Rechts — eine Richtung ist immer eine Sackgasse. Ohne Wahl fährst du automatisch Mitte.",
      onStart: () => {
        closeIntro = null;
        started = true;
      },
    });
  }

  function chooseLane(lane: Lane): void {
    if (phase !== "approaching") return;
    // Tippen speichert nur die Entscheidung (Anzeige aktualisiert sich) --
    // der Countdown laeuft unbeeinflusst weiter, die Strecke selbst aendert
    // sich hier noch nicht.
    chosenLane = lane;
    updateHud();
  }

  function beginFork(): void {
    phase = "forking";
    forkTimer = 0;
    updateHud();
  }

  function finishOutcome(): void {
    if (crashed) {
      phase = "game-over";
      const outcome = getHighscoreOutcome(GAME_ID, score, "higher-better");
      updateHud();
      if (outcome !== "none") {
        closeHighscoreModal = promptHighscoreName({
          message: `Du hast ${score} Weiche${score === 1 ? "" : "n"} geschafft — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            highscoreBanner.update(recordHighscore(GAME_ID, name, score, "higher-better"));
          },
        });
      }
    } else {
      score += 1;
      roundDuration = Math.max(MIN_COUNTDOWN, BASE_COUNTDOWN - score * 0.4);
      countdown = roundDuration;
      deadEndLane = pickDeadEnd();
      chosenLane = "center";
      phase = "approaching";
      updateHud();
    }
  }

  // ---------------------------------------------------------------- Geometrie

  function geometry(size: { width: number; height: number }) {
    const horizonY = size.height * 0.3;
    const baseY = size.height * 0.86;
    const junctionY = size.height * 0.58;
    const cx = size.width / 2;
    const spread = size.width * 0.3;
    const endpoints: Record<Lane, Point> = {
      left: { x: cx - spread, y: horizonY },
      center: { x: cx, y: horizonY },
      right: { x: cx + spread, y: horizonY },
    };
    return { horizonY, baseY, junctionY, cx, endpoints };
  }

  // ---------------------------------------------------------------- Zeichnen

  function drawBackground(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, horizonY: number, baseY: number): void {
    const grad = ctx.createLinearGradient(0, horizonY, 0, baseY);
    grad.addColorStop(0, "#173b40");
    grad.addColorStop(1, theme.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizonY, size.width, baseY - horizonY);
  }

  function drawRailPair(ctx: CanvasRenderingContext2D, from: Point, to: Point, topHalfWidth: number, baseHalfWidth: number, color: string, lineWidth: number): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(from.x - topHalfWidth, from.y);
    ctx.lineTo(to.x - baseHalfWidth, to.y);
    ctx.moveTo(from.x + topHalfWidth, from.y);
    ctx.lineTo(to.x + baseHalfWidth, to.y);
    ctx.stroke();
  }

  function drawApproachingTrack(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const { horizonY, baseY, cx } = geometry(size);
    drawBackground(ctx, size, horizonY, baseY);

    const topHalfWidth = 10;
    const baseHalfWidth = size.width * 0.42;

    ctx.fillStyle = "#0f2b2f";
    ctx.beginPath();
    ctx.moveTo(cx - topHalfWidth, horizonY);
    ctx.lineTo(cx + topHalfWidth, horizonY);
    ctx.lineTo(cx + baseHalfWidth, baseY);
    ctx.lineTo(cx - baseHalfWidth, baseY);
    ctx.closePath();
    ctx.fill();

    drawRailPair(ctx, { x: cx, y: horizonY }, { x: cx, y: baseY }, topHalfWidth, baseHalfWidth, theme.accent, 3);
    drawTies(ctx, { x: cx, y: horizonY }, { x: cx, y: baseY }, topHalfWidth, baseHalfWidth);
  }

  function drawTies(ctx: CanvasRenderingContext2D, from: Point, to: Point, topHalfWidth: number, baseHalfWidth: number): void {
    const tieCount = 8;
    for (let i = 0; i < tieCount; i++) {
      const d = ((i / tieCount + tieOffset) % 1 + 1) % 1;
      const eased = d * d;
      const y = lerp(from.y, to.y, eased);
      const halfW = lerp(topHalfWidth, baseHalfWidth, eased);
      const tieCx = lerp(from.x, to.x, eased);
      ctx.strokeStyle = `rgba(255,204,51,${0.15 + eased * 0.35})`;
      ctx.lineWidth = 2 + eased * 3;
      ctx.beginPath();
      ctx.moveTo(tieCx - halfW * 0.9, y);
      ctx.lineTo(tieCx + halfW * 0.9, y);
      ctx.stroke();
    }
  }

  function drawForkTrack(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const { horizonY, baseY, junctionY, cx, endpoints } = geometry(size);
    drawBackground(ctx, size, horizonY, baseY);

    const topHalfWidth = 10;
    const junctionHalfWidth = 22;
    const baseHalfWidth = size.width * 0.42;

    // Unterer Abschnitt: vom Betrachter bis zur Weiche, immer mittig.
    ctx.fillStyle = "#0f2b2f";
    ctx.beginPath();
    ctx.moveTo(cx - junctionHalfWidth, junctionY);
    ctx.lineTo(cx + junctionHalfWidth, junctionY);
    ctx.lineTo(cx + baseHalfWidth, baseY);
    ctx.lineTo(cx - baseHalfWidth, baseY);
    ctx.closePath();
    ctx.fill();
    drawRailPair(ctx, { x: cx, y: junctionY }, { x: cx, y: baseY }, junctionHalfWidth, baseHalfWidth, theme.accent, 3);

    // Drei Aeste ab der Weiche: gewaehlter Ast hell/dick, die anderen beiden
    // dezent, damit klar sichtbar ist, welchen der Zug tatsaechlich nimmt.
    for (const lane of LANE_ORDER) {
      const isChosen = lane === chosenLane;
      drawRailPair(
        ctx,
        { x: cx, y: junctionY },
        endpoints[lane],
        junctionHalfWidth,
        topHalfWidth,
        isChosen ? theme.accent : "rgba(169,192,192,0.35)",
        isChosen ? 3 : 1.5,
      );
    }

    drawTies(ctx, { x: cx, y: junctionY }, { x: cx, y: baseY }, junctionHalfWidth, baseHalfWidth);
  }

  function trainMarkerPosition(size: { width: number; height: number }, t: number): Point {
    const { baseY, junctionY, cx, endpoints } = geometry(size);
    const start: Point = { x: cx, y: baseY - 36 };
    const junction: Point = { x: cx, y: junctionY };
    const end = endpoints[chosenLane];
    if (t < 0.4) return { x: lerp(start.x, junction.x, t / 0.4), y: lerp(start.y, junction.y, t / 0.4) };
    const t2 = Math.min(1, (t - 0.4) / 0.6);
    return { x: lerp(junction.x, end.x, t2), y: lerp(junction.y, end.y, t2) };
  }

  function drawTrainMarker(ctx: CanvasRenderingContext2D, p: Point): void {
    ctx.beginPath();
    ctx.fillStyle = theme.text;
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = theme.accent;
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.accentDark;
    ctx.stroke();
  }

  function drawWall(ctx: CanvasRenderingContext2D, p: Point): void {
    const w = 46;
    const h = 14;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "#7a1f1f";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      buttonBar = document.createElement("div");
      buttonBar.style.display = "none";
      buttonBar.style.gap = "10px";
      buttonBar.style.width = "100%";

      LANE_ORDER.forEach((lane) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.style.flex = "1";
        btn.style.fontSize = "1.4rem";
        btn.textContent = LANE_ARROW[lane];
        btn.addEventListener("click", () => chooseLane(lane));
        buttonBar.appendChild(btn);
      });

      choiceIndicator = document.createElement("div");
      choiceIndicator.className = "switch-choice-banner";
      choiceIndicator.style.display = "none";
      env.overlay.appendChild(choiceIndicator);

      gameOverPanel = document.createElement("div");
      gameOverPanel.style.display = "none";
      gameOverPanel.style.flexDirection = "column";
      gameOverPanel.style.alignItems = "center";
      gameOverPanel.style.textAlign = "center";

      const wrap = document.createElement("div");
      wrap.className = "stage-sheet";
      wrap.style.alignItems = "center";
      wrap.style.gap = "12px";
      wrap.appendChild(buttonBar);
      wrap.appendChild(gameOverPanel);
      env.overlay.appendChild(wrap);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatSwitches);

      restart();
    },

    update(dt: number) {
      if (!started) return;
      tieOffset += dt * (phase === "forking" ? 1.4 : 0.55);

      if (phase === "approaching") {
        countdown -= dt;
        if (countdown <= 0) beginFork();
      } else if (phase === "forking") {
        forkTimer += dt;
        if (forkTimer >= FORK_DURATION) {
          crashed = chosenLane === deadEndLane;
          phase = "outcome";
          outcomeTimer = 0;
        }
      } else if (phase === "outcome") {
        outcomeTimer += dt;
        if (outcomeTimer >= OUTCOME_DURATION) {
          finishOutcome();
        }
      }
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);

      if (!started) return;

      if (phase === "approaching") {
        drawApproachingTrack(ctx, size);
        ctx.textAlign = "center";
        ctx.font = `800 40px ${theme.fontDisplay}`;
        const countdownText = `${Math.max(0, Math.ceil(countdown))}`;
        const countdownY = size.height * 0.27;
        // Weisser Umriss + dunkle Fuellung: bleibt so sowohl vor dem hellen
        // Hintergrund oben als auch vor der dunklen Gleis-Grafik lesbar,
        // statt vor dem dunklen Bereich foermlich zu verschwinden.
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#ffffff";
        ctx.strokeText(countdownText, size.width / 2, countdownY);
        ctx.fillStyle = theme.text;
        ctx.fillText(countdownText, size.width / 2, countdownY);
      } else {
        // Bei einem Crash wackelt das Bild waehrend der Outcome-Phase kurz --
        // simuliert eine Vollbremsung.
        let shakeX = 0;
        let shakeY = 0;
        if (phase === "outcome" && crashed) {
          const decay = Math.max(0, 1 - outcomeTimer / 0.5);
          shakeX = (Math.random() - 0.5) * 6 * decay;
          shakeY = (Math.random() - 0.5) * 6 * decay;
        }
        ctx.save();
        ctx.translate(shakeX, shakeY);
        drawForkTrack(ctx, size);

        const t = phase === "forking" ? Math.min(1, forkTimer / FORK_DURATION) : 1;
        const markerPos = trainMarkerPosition(size, t);
        if (phase === "outcome" && crashed) drawWall(ctx, markerPos);
        drawTrainMarker(ctx, markerPos);
        ctx.restore();

        if (phase === "outcome") {
          const alpha = Math.min(1, outcomeTimer / 0.25) * (crashed ? 0.35 : 0.22);
          ctx.fillStyle = crashed ? `rgba(239,86,87,${alpha})` : `rgba(53,196,123,${alpha})`;
          ctx.fillRect(0, 0, size.width, size.height);

          ctx.textAlign = "center";
          ctx.font = `800 26px ${theme.fontDisplay}`;
          ctx.fillStyle = crashed ? theme.danger : theme.success;
          ctx.fillText(crashed ? "Sackgasse!" : "Weiche geschafft!", size.width / 2, size.height * 0.2);
        }
      }
    },

    cleanup() {
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      closeIntro?.();
      closeIntro = null;
      highscoreBanner?.destroy();
      buttonBar?.parentElement?.remove();
      choiceIndicator?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Weichenspiel",
  subtitle: "Links, Mitte oder Rechts?",
  icon: "fork",
  badge: "WS",
  accent: "#8c6dab",
  create: createSwitchRunGame,
  highscoreCategories: [{ board: "default", label: "Bestwert", direction: "higher-better", formatValue: formatSwitches }],
});
