import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { getHighscore, isNewHighscore, setHighscore, type HighscoreEntry } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { registerGame } from "../registry";

const GAME_ID = "switch-run";
const INTRO_DURATION = 2.5;
const COMMIT_DURATION = 0.6;
const OUTCOME_DURATION = 1.3;
const BASE_COUNTDOWN = 10;
const MIN_COUNTDOWN = 4;

type Lane = "left" | "center" | "right";
type Phase = "intro" | "approaching" | "committing" | "outcome" | "game-over";

const LANE_TARGET: Record<Lane, number> = { left: -1, center: 0, right: 1 };
const LANE_LABEL: Record<Lane, string> = { left: "Links", center: "Mitte", right: "Rechts" };

function pickDeadEnd(): Lane {
  const lanes: Lane[] = ["left", "center", "right"];
  return lanes[Math.floor(Math.random() * lanes.length)];
}

function createSwitchRunGame(): MinigameModule {
  let phase: Phase = "intro";
  let introTimer = 0;
  let countdown = BASE_COUNTDOWN;
  let roundDuration = BASE_COUNTDOWN;
  let score = 0;
  let deadEndLane: Lane = pickDeadEnd();
  let chosenLane: Lane | null = null;
  let laneOffset = 0;
  let commitTimer = 0;
  let outcomeTimer = 0;
  let crashed = false;
  let tieOffset = 0;
  let highscore: HighscoreEntry | null = null;
  let closeHighscoreModal: (() => void) | null = null;

  let buttonBar: HTMLDivElement;
  let banner: HTMLDivElement;
  let gameOverPanel: HTMLDivElement;

  function updateHud(): void {
    banner.style.display = phase === "intro" || phase === "game-over" ? "block" : "none";
    buttonBar.style.display = phase === "approaching" ? "flex" : "none";
    gameOverPanel.style.display = phase === "game-over" ? "flex" : "none";

    if (phase === "intro") {
      banner.textContent = highscore
        ? `Highscore: ${highscore.name} — ${highscore.value} Weichen`
        : "Noch kein Highscore aufgestellt — sei die/der Erste!";
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
    phase = "intro";
    introTimer = 0;
    score = 0;
    roundDuration = BASE_COUNTDOWN;
    countdown = roundDuration;
    deadEndLane = pickDeadEnd();
    chosenLane = null;
    laneOffset = 0;
    crashed = false;
    highscore = getHighscore(GAME_ID);
    updateHud();
  }

  function chooseLane(lane: Lane): void {
    if (phase !== "approaching") return;
    chosenLane = lane;
    phase = "committing";
    commitTimer = 0;
    updateHud();
  }

  function finishOutcome(): void {
    if (crashed) {
      phase = "game-over";
      const newRecord = isNewHighscore(GAME_ID, score, "higher-better");
      updateHud();
      if (newRecord) {
        closeHighscoreModal = promptHighscoreName({
          message: `Du hast ${score} Weiche${score === 1 ? "" : "n"} geschafft — neuer Bestwert!`,
          onDone: (name) => {
            closeHighscoreModal = null;
            highscore = setHighscore(GAME_ID, name, score);
          },
        });
      }
    } else {
      score += 1;
      roundDuration = Math.max(MIN_COUNTDOWN, BASE_COUNTDOWN - score * 0.4);
      countdown = roundDuration;
      deadEndLane = pickDeadEnd();
      chosenLane = null;
      laneOffset = 0;
      phase = "approaching";
      updateHud();
    }
  }

  function drawCorridor(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const horizonY = size.height * 0.3;
    const baseY = size.height * 0.88;
    const cx = size.width / 2 + laneOffset * size.width * 0.32;

    const grad = ctx.createLinearGradient(0, horizonY, 0, baseY);
    grad.addColorStop(0, "#173b40");
    grad.addColorStop(1, theme.bg);
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizonY, size.width, baseY - horizonY);

    const topHalfWidth = 10;
    const baseHalfWidth = size.width * 0.42;

    ctx.fillStyle = "#0f2b2f";
    ctx.beginPath();
    ctx.moveTo(cx - topHalfWidth, horizonY);
    ctx.lineTo(cx + topHalfWidth, horizonY);
    ctx.lineTo(size.width / 2 + baseHalfWidth, baseY);
    ctx.lineTo(size.width / 2 - baseHalfWidth, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - topHalfWidth, horizonY);
    ctx.lineTo(size.width / 2 - baseHalfWidth, baseY);
    ctx.moveTo(cx + topHalfWidth, horizonY);
    ctx.lineTo(size.width / 2 + baseHalfWidth, baseY);
    ctx.stroke();

    const tieCount = 9;
    for (let i = 0; i < tieCount; i++) {
      const d = ((i / tieCount + tieOffset) % 1 + 1) % 1;
      const eased = d * d;
      const y = horizonY + eased * (baseY - horizonY);
      const halfW = topHalfWidth + eased * (baseHalfWidth - topHalfWidth);
      const tieCx = cx + (size.width / 2 - cx) * eased;
      ctx.strokeStyle = `rgba(255,204,51,${0.15 + eased * 0.35})`;
      ctx.lineWidth = 2 + eased * 3;
      ctx.beginPath();
      ctx.moveTo(tieCx - halfW * 0.9, y);
      ctx.lineTo(tieCx + halfW * 0.9, y);
      ctx.stroke();
    }
  }

  function drawForkPreview(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const horizonY = size.height * 0.3;
    const lanes: Lane[] = ["left", "center", "right"];
    const spacing = size.width * 0.22;
    lanes.forEach((lane, i) => {
      const x = size.width / 2 + (i - 1) * spacing;
      ctx.fillStyle = "rgba(244,247,246,0.6)";
      ctx.font = `600 11px ${theme.font}`;
      ctx.textAlign = "center";
      ctx.fillText(LANE_LABEL[lane], x, horizonY - 14);
    });
  }

  function drawOutcomeOverlay(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    const alpha = Math.min(1, outcomeTimer / 0.25) * (crashed ? 0.35 : 0.22);
    ctx.fillStyle = crashed ? `rgba(239,86,87,${alpha})` : `rgba(53,196,123,${alpha})`;
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.textAlign = "center";
    ctx.font = `800 26px ${theme.fontDisplay}`;
    ctx.fillStyle = crashed ? theme.danger : theme.success;
    ctx.fillText(crashed ? "Sackgasse!" : "Weiche geschafft!", size.width / 2, size.height * 0.45);
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      highscore = getHighscore(GAME_ID);

      banner = document.createElement("div");
      banner.className = "ticket-card";
      banner.style.textAlign = "center";
      banner.style.fontFamily = "var(--font-display)";
      banner.style.fontWeight = "700";

      buttonBar = document.createElement("div");
      buttonBar.style.display = "none";
      buttonBar.style.gap = "10px";
      buttonBar.style.width = "100%";

      (["left", "center", "right"] as Lane[]).forEach((lane) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.style.flex = "1";
        btn.style.fontSize = "1.4rem";
        btn.textContent = lane === "left" ? "⭠" : lane === "center" ? "⭡" : "⭢";
        btn.addEventListener("click", () => chooseLane(lane));
        buttonBar.appendChild(btn);
      });

      gameOverPanel = document.createElement("div");
      gameOverPanel.style.display = "none";
      gameOverPanel.style.flexDirection = "column";
      gameOverPanel.style.alignItems = "center";
      gameOverPanel.style.textAlign = "center";

      const wrap = document.createElement("div");
      wrap.className = "stage-sheet";
      wrap.style.alignItems = "center";
      wrap.style.gap = "12px";
      wrap.appendChild(banner);
      wrap.appendChild(buttonBar);
      wrap.appendChild(gameOverPanel);
      env.overlay.appendChild(wrap);

      restart();
    },

    update(dt: number) {
      tieOffset += dt * (phase === "committing" ? 1.4 : 0.55);

      if (phase === "intro") {
        introTimer += dt;
        if (introTimer >= INTRO_DURATION) {
          phase = "approaching";
          updateHud();
        }
      } else if (phase === "approaching") {
        countdown -= dt;
        if (countdown <= 0) {
          chooseLane("center");
        }
      } else if (phase === "committing") {
        commitTimer += dt;
        const target = LANE_TARGET[chosenLane ?? "center"];
        laneOffset += (target - laneOffset) * Math.min(1, dt * 6);
        if (commitTimer >= COMMIT_DURATION) {
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

      drawCorridor(ctx, size);

      if (phase === "approaching") {
        drawForkPreview(ctx, size);
        ctx.textAlign = "center";
        ctx.fillStyle = theme.text;
        ctx.font = `800 40px ${theme.fontDisplay}`;
        ctx.fillText(`${Math.max(0, Math.ceil(countdown))}`, size.width / 2, size.height * 0.2);

        ctx.font = `600 12px ${theme.font}`;
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(`${score} Weichen geschafft`, size.width / 2, size.height * 0.26);
      } else if (phase === "outcome") {
        drawOutcomeOverlay(ctx, size);
      }
    },

    cleanup() {
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      buttonBar?.parentElement?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Weichenspiel",
  subtitle: "Links, Mitte oder Rechts?",
  icon: "fork",
  accent: "#8c6dab",
  create: createSwitchRunGame,
});
