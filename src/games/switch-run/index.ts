import type { GameEnv, MinigameModule } from "../../core/Game";
import { theme } from "../../core/theme";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { showGameIntro } from "../../core/gameIntro";
import { startTrainChug, stopTrainChug, preloadTrainChug, playSwitchSuccessSound, playSwitchCrashSound } from "../../core/sound";
import { registerGame } from "../registry";

const GAME_ID = "switch-run";
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer
const FORK_DURATION = 1.1;
const OUTCOME_DURATION = 1.3;
const BASE_COUNTDOWN = 10;
const MIN_COUNTDOWN = 3;
// Der Zug faehrt waehrend der "forking"-Phase nur bis knapp vor die Weichen-
// Aeste (nicht bis zum rechnerischen Fluchtpunkt) -- dort ist er noch gross
// genug, dass Zug UND (im Sackgassen-Fall) die Barriere davor gut sichtbar
// sind. Erst in der Outcome-Phase entscheidet sich, ob er dort haengen
// bleibt (Absperrung) oder weiter Richtung Horizont davonfaehrt.
const FORK_MAX_T = 0.85;

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
  // null = noch keine aktive Wahl in dieser Runde getroffen. Faellt der
  // Countdown auf 0, ohne dass getippt wurde, ist das jetzt IMMER ein
  // Rausflug (kein automatisches "Mitte" mehr) -- man muss sich wirklich
  // entscheiden.
  let chosenLane: Lane | null = null;
  let forkTimer = 0;
  let outcomeTimer = 0;
  let crashed = false;
  let tieOffset = 0;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let closeIntro: (() => void) | null = null;
  let highscoreBanner: HighscoreBannerHandle;

  let buttonBar: HTMLDivElement;
  const laneButtons: Partial<Record<Lane, HTMLButtonElement>> = {};
  let choiceIndicator: HTMLDivElement;
  let gameOverPanel: HTMLDivElement;

  function updateHud(): void {
    buttonBar.style.display = phase === "approaching" ? "flex" : "none";
    choiceIndicator.style.display = phase === "approaching" ? "flex" : "none";
    gameOverPanel.style.display = phase === "game-over" ? "flex" : "none";

    if (phase === "approaching") {
      for (const lane of LANE_ORDER) {
        laneButtons[lane]?.classList.toggle("btn--accent", lane === chosenLane);
      }
      choiceIndicator.innerHTML =
        chosenLane === null
          ? `<span class="switch-choice-banner__text">Bitte Richtung wählen!</span>`
          : `
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
      title.textContent = chosenLane === null ? "Keine Wahl getroffen!" : "Sackgasse!";
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
    chosenLane = null;
    crashed = false;
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    updateHud();

    closeIntro = showGameIntro({
      title: "Weichenspiel",
      description: [
        "Vor jeder Weiche läuft ein Countdown",
        "Wähle Links, Mitte oder Rechts",
        "Eine Richtung ist immer eine Sackgasse",
        "Ohne Wahl hältst du am Ende einfach an",
      ],
      onStart: () => {
        closeIntro = null;
        started = true;
        startTrainChug();
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
      stopTrainChug();
      phase = "game-over";
      const outcome = getHighscoreOutcome(GAME_ID, score, "higher-better");
      updateHud();
      if (outcome !== "none") {
        highscoreTimer = setTimeout(() => {
          highscoreTimer = null;
          closeHighscoreModal = promptHighscoreName({
            message: `Du hast ${score} Weiche${score === 1 ? "" : "n"} geschafft — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
            onDone: (name) => {
              closeHighscoreModal = null;
              if (name === null) return;
              highscoreBanner.update(recordHighscore(GAME_ID, name, score, "higher-better"));
            },
          });
        }, HIGHSCORE_POPUP_DELAY_MS);
      }
    } else {
      score += 1;
      roundDuration = Math.max(MIN_COUNTDOWN, BASE_COUNTDOWN - score * 1);
      countdown = roundDuration;
      deadEndLane = pickDeadEnd();
      chosenLane = null;
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

  // horizonY/baseY haengen nur von der (praktisch nie wechselnden) Canvas-
  // Groesse ab -- ohne Cache legt render() diesen Gradienten trotzdem jeden
  // einzelnen Frame neu an, auf schwacher Hardware (Pi 3) messbar teuer.
  let backgroundGradientCache: { key: string; gradient: CanvasGradient } | null = null;

  function drawBackground(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, horizonY: number, baseY: number): void {
    const key = `${horizonY}:${baseY}`;
    if (backgroundGradientCache?.key !== key) {
      const grad = ctx.createLinearGradient(0, horizonY, 0, baseY);
      grad.addColorStop(0, "#173b40");
      grad.addColorStop(1, theme.bg);
      backgroundGradientCache = { key, gradient: grad };
    }
    ctx.fillStyle = backgroundGradientCache.gradient;
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
    // Ohne Wahl (chosenLane === null) rein visuell "Mitte" fuer die
    // Fahranimation -- der Rausflug wird trotzdem korrekt ausgeloest (siehe
    // crashed-Berechnung), das hier bestimmt nur, wohin der Zug gezeichnet wird.
    const end = endpoints[chosenLane ?? "center"];
    if (t < 0.4) return { x: lerp(start.x, junction.x, t / 0.4), y: lerp(start.y, junction.y, t / 0.4) };
    const t2 = (t - 0.4) / 0.6;
    return { x: lerp(junction.x, end.x, t2), y: lerp(junction.y, end.y, t2) };
  }

  /** Halbe Gleisbreite an der Stelle t entlang derselben Strecke wie trainMarkerPosition -- bestimmt, wie gross Zug/Barriere dort gezeichnet werden. */
  function trainHalfWidthAt(size: { width: number; height: number }, t: number): number {
    const junctionHalfWidth = 22;
    const topHalfWidth = 10;
    const baseHalfWidth = size.width * 0.42;
    if (t < 0.4) return lerp(baseHalfWidth, junctionHalfWidth, t / 0.4);
    const t2 = Math.min(1, (t - 0.4) / 0.6);
    return lerp(junctionHalfWidth, topHalfWidth, t2);
  }

  /** Stilisierte Rueckansicht eines Zugs -- Groesse folgt der lokalen Gleisbreite, damit er perspektivisch passt. */
  function drawTrainBody(ctx: CanvasRenderingContext2D, p: Point, halfWidth: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const w = Math.max(5, halfWidth * 1.7);
    const h = w * 0.68;
    const bodyTop = p.y - h;
    const r = Math.min(6, w * 0.18);

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 1, w * 0.55, Math.max(1, w * 0.14), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = theme.primary;
    ctx.beginPath();
    ctx.moveTo(p.x - w / 2 + r, bodyTop);
    ctx.arcTo(p.x + w / 2, bodyTop, p.x + w / 2, p.y, r);
    ctx.arcTo(p.x + w / 2, p.y, p.x - w / 2, p.y, r);
    ctx.arcTo(p.x - w / 2, p.y, p.x - w / 2, bodyTop, r);
    ctx.arcTo(p.x - w / 2, bodyTop, p.x + w / 2, bodyTop, r);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.fillRect(p.x - w / 2, bodyTop, w, Math.max(1, h * 0.12));

    ctx.fillStyle = "#0d2b30";
    const winW = w * 0.3;
    const winH = h * 0.34;
    ctx.beginPath();
    ctx.roundRect(p.x - winW / 2, bodyTop + h * 0.22, winW, winH, Math.min(3, winW * 0.2));
    ctx.fill();

    ctx.fillStyle = "#ff4d4d";
    const lightR = Math.max(1.4, w * 0.06);
    ctx.beginPath();
    ctx.arc(p.x - w * 0.36, p.y - h * 0.16, lightR, 0, Math.PI * 2);
    ctx.arc(p.x + w * 0.36, p.y - h * 0.16, lightR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Rot-weiss gestreifte Absperrung quer zur Sackgasse -- der sichtbare Grund fuer den Crash. */
  function drawBarrier(ctx: CanvasRenderingContext2D, p: Point, halfWidth: number): void {
    const w = halfWidth * 3;
    const h = Math.max(11, w * 0.2);
    const topY = p.y - h - halfWidth * 1.35;
    const left = p.x - w / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, topY, w, h);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(left, topY, w, h);
    ctx.fillStyle = "#c62828";
    const stripe = h * 0.9;
    for (let sx = left - h; sx < left + w + h; sx += stripe * 2) {
      ctx.beginPath();
      ctx.moveTo(sx, topY + h);
      ctx.lineTo(sx + stripe, topY + h);
      ctx.lineTo(sx + stripe + h, topY);
      ctx.lineTo(sx + h, topY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = "#2b2004";
    ctx.lineWidth = Math.max(1, h * 0.12);
    ctx.strokeRect(left, topY, w, h);

    // Zwei Pfosten, die die Absperrung sichtbar auf den Gleisen "verankern".
    ctx.fillStyle = "#4a4640";
    const postW = Math.max(2, h * 0.18);
    ctx.fillRect(left + h * 0.6, topY + h * 0.6, postW, p.y - (topY + h * 0.6));
    ctx.fillRect(left + w - h * 0.6 - postW, topY + h * 0.6, postW, p.y - (topY + h * 0.6));
  }

  /** Kurzer Funkenstoss im Aufprallmoment -- progress laeuft 0 (Einschlag) bis 1 (verklungen). */
  function drawImpactSparks(ctx: CanvasRenderingContext2D, p: Point, halfWidth: number, progress: number): void {
    if (progress >= 1) return;
    const alpha = 1 - progress;
    const count = 9;
    ctx.save();
    ctx.strokeStyle = `rgba(255,214,79,${alpha})`;
    ctx.lineWidth = 2;
    const originY = p.y - halfWidth * 0.5;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + progress * 3;
      const len = (8 + 20 * progress) * (0.7 + 0.3 * Math.sin(i * 2.1));
      ctx.beginPath();
      ctx.moveTo(p.x, originY);
      ctx.lineTo(p.x + Math.cos(angle) * len, originY + Math.sin(angle) * len * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      preloadTrainChug();
      buttonBar = document.createElement("div");
      buttonBar.style.display = "none";
      buttonBar.style.gap = "12px";
      buttonBar.style.width = "100%";

      LANE_ORDER.forEach((lane) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.style.flex = "1";
        btn.style.fontSize = "2rem";
        btn.style.padding = "18px 0";
        btn.textContent = LANE_ARROW[lane];
        btn.addEventListener("click", () => chooseLane(lane));
        buttonBar.appendChild(btn);
        laneButtons[lane] = btn;
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
          // Keine Wahl getroffen zaehlt jetzt immer als Rausflug -- kein
          // automatisches "Mitte" mehr, siehe chosenLane-Deklaration oben.
          crashed = chosenLane === null || chosenLane === deadEndLane;
          phase = "outcome";
          outcomeTimer = 0;
          if (crashed) playSwitchCrashSound();
          else playSwitchSuccessSound();
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
        // Zeigt die Weichen-Verzweigung bereits waehrend der Entscheidung
        // (nicht erst danach, wie vorher) -- sonst haben die drei Knoepfe
        // (Links/Mitte/Rechts) keinerlei sichtbare Entsprechung auf der
        // Strecke, waehrend man sich entscheiden soll (Tester-Feedback: "hab
        // ich nicht ganz verstanden"). Welcher Ast die Sackgasse ist, bleibt
        // bewusst weiterhin unsichtbar -- nur DASS es drei echte, waehlbare
        // Gleise gibt, wird jetzt sofort klar. drawForkTrack hebt den gerade
        // gewaehlten Ast automatisch hervor (chosenLane), reagiert also live
        // auf Antippen, auch vor Ablauf des Countdowns.
        drawForkTrack(ctx, size);
        ctx.textAlign = "center";
        ctx.font = `800 40px ${theme.fontDisplay}`;
        const countdownText = `${Math.max(0, Math.ceil(countdown))}`;
        // Mindestabstand von oben, damit die Zahl auf niedrigen Canvas-Hoehen
        // (kleine/breite Bildschirme) nicht unter die absolut positionierte
        // ".switch-choice-banner" ("Gewählt: ...") rutscht -- die sitzt in
        // Fensterkoordinaten fest oberhalb des Canvas und wandert bei einer
        // reinen Prozent-Y-Position nicht mit.
        // Mindestabstand von 210px (statt vorher 120px): bei der Berechnung
        // ueber die Fenstergroesse wurde nicht beruecksichtigt, dass die
        // ".switch-choice-banner" ("Gewählt: ...") bis zu ca. y=186
        // reicht -- 120 lag also noch mitten in der Banner-Pille.
        const countdownY = Math.max(size.height * 0.27, 210);
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
          shakeX = (Math.random() - 0.5) * 8 * decay;
          shakeY = (Math.random() - 0.5) * 8 * decay;
        }
        ctx.save();
        ctx.translate(shakeX, shakeY);
        drawForkTrack(ctx, size);

        // Waehrend "forking" faehrt der Zug bis knapp vor die Weiche (siehe
        // FORK_MAX_T). Erst in "outcome" entscheidet sich, ob er dort an
        // einer Absperrung haengen bleibt oder weiter Richtung Horizont
        // davonfaehrt (und dabei sichtbar kleiner wird und ausblendet).
        // Ohne getroffene Wahl faehrt der Zug NICHT mehr sichtbar in einen
        // der drei Aeste hinein (vorher liess FORK_MAX_T=0.85 ihn optisch
        // schon 75% des Wegs Richtung "Mitte" zuruecklegen, bevor die
        // Absperrung kam) -- er bleibt stattdessen genau am Abzweigungspunkt
        // (t=0.4, siehe trainMarkerPosition) stehen, dort passiert dann auch
        // der Crash. Bei einer getroffenen (falschen) Wahl bleibt es beim
        // bisherigen Verhalten (bis kurz vor den gewaehlten Ast).
        const crashMaxT = chosenLane === null ? 0.4 : FORK_MAX_T;
        let t: number;
        let alpha = 1;
        if (phase === "forking") {
          const forkCapT = chosenLane === null ? crashMaxT : FORK_MAX_T;
          t = Math.min(forkCapT, (forkTimer / FORK_DURATION) * forkCapT);
        } else if (crashed) {
          t = crashMaxT;
        } else {
          const p = Math.min(1, outcomeTimer / OUTCOME_DURATION);
          t = lerp(FORK_MAX_T, 1, p);
          alpha = 1 - p;
        }
        const markerPos = trainMarkerPosition(size, t);
        const markerHalfWidth = trainHalfWidthAt(size, t);
        if (phase === "outcome" && crashed) {
          drawBarrier(ctx, markerPos, markerHalfWidth);
          drawImpactSparks(ctx, markerPos, markerHalfWidth, outcomeTimer / 0.4);
        }
        drawTrainBody(ctx, markerPos, markerHalfWidth, alpha);
        ctx.restore();

        if (phase === "outcome") {
          const alpha = Math.min(1, outcomeTimer / 0.25) * (crashed ? 0.35 : 0.22);
          ctx.fillStyle = crashed ? `rgba(239,86,87,${alpha})` : `rgba(53,196,123,${alpha})`;
          ctx.fillRect(0, 0, size.width, size.height);

          ctx.textAlign = "center";
          ctx.font = `800 26px ${theme.fontDisplay}`;
          ctx.fillStyle = crashed ? theme.danger : theme.success;
          // "Keine Wahl getroffen" statt "Sackgasse!", wenn schlicht nicht
          // rechtzeitig gewaehlt wurde (Zug haelt einfach an, siehe Intro-Text
          // "Ohne Wahl haeltst du am Ende einfach an") -- vorher stand hier
          // (anders als im spaeteren Game-Over-Panel, siehe renderGameOver
          // oben) IMMER "Sackgasse!", auch wenn man gar keine falsche Richtung
          // gewaehlt, sondern nur gar nicht reagiert hat (gemeldet).
          const crashText = chosenLane === null ? "Keine Wahl getroffen!" : "Sackgasse!";
          ctx.fillText(crashed ? crashText : "Weiche geschafft!", size.width / 2, size.height * 0.2);
        }
      }
    },

    cleanup() {
      stopTrainChug();
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
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
