import type { TransitLine } from "../../data/berlinNetwork";
import { transitLines } from "../../data/berlinNetwork";
import type { LineRoute } from "./graph";

const MODE_LABEL: Record<TransitLine["mode"], string> = {
  "u-bahn": "U-Bahn",
  "s-bahn": "S-Bahn",
  tram: "Tram",
};

function lineById(id: string): TransitLine {
  return transitLines.find((l) => l.id === id)!;
}

export type Phase = "building" | "feedback" | "summary";

export interface ScreenState {
  phase: Phase;
  start: string;
  target: string;
  round: number;
  totalRounds: number;
  attempt: number;
  totalAttempts: number;
  selectedLines: string[];
  error?: string | null;
  hint?: string;
  feedback?: {
    success: boolean;
    message: string;
    scoreGained: number;
    revealed?: LineRoute;
    roundOver: boolean;
  };
  summary?: {
    totalScore: number;
    isNewHighscore: boolean;
  };
}

export interface ScreenActions {
  onSelectLine: (lineId: string) => void;
  onRemoveLast: () => void;
  onReset: () => void;
  onSubmit: () => void;
  onContinue: () => void;
  onPlayAgain: () => void;
}

function renderStartTarget(container: HTMLElement, state: ScreenState): void {
  const card = document.createElement("div");
  card.className = "ticket-card";
  card.style.textAlign = "center";
  card.style.width = "100%";

  const roundInfo = document.createElement("div");
  roundInfo.style.fontSize = "0.7rem";
  roundInfo.style.color = "var(--paper-muted)";
  roundInfo.style.letterSpacing = "0.08em";
  roundInfo.style.textTransform = "uppercase";
  roundInfo.textContent = `Runde ${state.round}/${state.totalRounds} · Versuch ${state.attempt}/${state.totalAttempts}`;
  card.appendChild(roundInfo);

  const startLabel = document.createElement("div");
  startLabel.style.fontSize = "0.68rem";
  startLabel.style.color = "var(--paper-muted)";
  startLabel.style.letterSpacing = "0.1em";
  startLabel.style.textTransform = "uppercase";
  startLabel.style.marginTop = "8px";
  startLabel.textContent = "Start";
  card.appendChild(startLabel);

  const startValue = document.createElement("div");
  startValue.style.fontFamily = "var(--font-display)";
  startValue.style.fontWeight = "800";
  startValue.style.fontSize = "1.25rem";
  startValue.textContent = state.start;
  card.appendChild(startValue);

  const arrow = document.createElement("div");
  arrow.style.color = "var(--accent-dark)";
  arrow.style.fontSize = "1.1rem";
  arrow.style.margin = "2px 0";
  arrow.textContent = "▼";
  card.appendChild(arrow);

  const targetLabel = document.createElement("div");
  targetLabel.style.fontSize = "0.68rem";
  targetLabel.style.color = "var(--paper-muted)";
  targetLabel.style.letterSpacing = "0.1em";
  targetLabel.style.textTransform = "uppercase";
  targetLabel.textContent = "Ziel";
  card.appendChild(targetLabel);

  const targetValue = document.createElement("div");
  targetValue.style.fontFamily = "var(--font-display)";
  targetValue.style.fontWeight = "800";
  targetValue.style.fontSize = "1.25rem";
  targetValue.textContent = state.target;
  card.appendChild(targetValue);

  container.appendChild(card);
}

function renderBreadcrumb(container: HTMLElement, state: ScreenState, actions: ScreenActions): void {
  const wrap = document.createElement("div");
  wrap.className = "breadcrumb";
  wrap.style.justifyContent = "center";
  wrap.style.minHeight = "28px";

  if (state.selectedLines.length === 0) {
    const hint = document.createElement("span");
    hint.textContent = "Noch keine Linie gewählt.";
    wrap.appendChild(hint);
  } else {
    state.selectedLines.forEach((id, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.setProperty("--chip-color", lineById(id).color);
      chip.style.fontSize = "0.78rem";
      chip.textContent = id;
      wrap.appendChild(chip);
      if (i < state.selectedLines.length - 1) {
        const sep = document.createElement("span");
        sep.className = "breadcrumb__sep";
        sep.textContent = "→";
        wrap.appendChild(sep);
      }
    });
  }
  container.appendChild(wrap);

  if (state.error) {
    const err = document.createElement("div");
    err.className = "field-error";
    err.style.textAlign = "center";
    err.textContent = state.error;
    container.appendChild(err);
  }

  if (state.hint) {
    const hint = document.createElement("div");
    hint.style.textAlign = "center";
    hint.style.fontSize = "0.8rem";
    hint.style.fontWeight = "700";
    hint.style.color = "var(--accent-dark)";
    hint.style.margin = "4px 0";
    hint.textContent = `💡 Tipp: Eine der Linien ist ${state.hint}.`;
    container.appendChild(hint);
  }

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.justifyContent = "center";
  btnRow.style.margin = "6px 0 4px";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn btn--ghost";
  resetBtn.style.fontSize = "0.82rem";
  resetBtn.textContent = "Auswahl leeren";
  resetBtn.disabled = state.selectedLines.length === 0;
  resetBtn.addEventListener("click", actions.onReset);
  btnRow.appendChild(resetBtn);

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "btn btn--accent";
  submitBtn.style.fontSize = "0.82rem";
  submitBtn.textContent = "Fertig, prüfen";
  submitBtn.disabled = state.selectedLines.length === 0;
  submitBtn.addEventListener("click", actions.onSubmit);
  btnRow.appendChild(submitBtn);

  container.appendChild(btnRow);
}

function renderLinePicker(container: HTMLElement, actions: ScreenActions): void {
  const grouped: Record<TransitLine["mode"], TransitLine[]> = { "u-bahn": [], "s-bahn": [], tram: [] };
  for (const line of transitLines) grouped[line.mode].push(line);

  for (const mode of ["u-bahn", "s-bahn", "tram"] as const) {
    const label = document.createElement("div");
    label.style.fontSize = "0.72rem";
    label.style.color = "var(--text-faint)";
    label.style.margin = "8px 0 4px";
    label.textContent = MODE_LABEL[mode];
    container.appendChild(label);

    const row = document.createElement("div");
    row.className = "chip-row chip-row--picker";
    for (const line of grouped[mode]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip chip--picker";
      btn.style.setProperty("--chip-color", line.color);
      btn.textContent = line.label.split(" ")[0];
      btn.addEventListener("click", () => actions.onSelectLine(line.id));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }
}

export function renderScreen(container: HTMLElement, state: ScreenState, actions: ScreenActions): void {
  container.innerHTML = "";
  renderStartTarget(container, state);

  if (state.phase === "building") {
    renderBreadcrumb(container, state, actions);
    renderLinePicker(container, actions);
  } else if (state.phase === "feedback" && state.feedback) {
    const fb = state.feedback;
    const msg = document.createElement("p");
    msg.style.textAlign = "center";
    msg.style.color = fb.success ? "var(--success)" : "var(--text)";
    msg.style.fontWeight = "700";
    msg.style.margin = "10px 0 4px";
    msg.textContent = fb.message;
    container.appendChild(msg);

    if (fb.scoreGained > 0) {
      const score = document.createElement("p");
      score.style.textAlign = "center";
      score.style.color = "var(--accent)";
      score.style.fontFamily = "var(--font-display)";
      score.style.fontWeight = "700";
      score.textContent = `+${fb.scoreGained} Punkte`;
      container.appendChild(score);
    }

    if (fb.revealed) {
      const revealTitle = document.createElement("p");
      revealTitle.style.textAlign = "center";
      revealTitle.style.fontSize = "0.78rem";
      revealTitle.style.color = "var(--text-muted)";
      revealTitle.style.margin = "10px 0 6px";
      revealTitle.textContent = "So wäre eine direkte Verbindung gegangen:";
      container.appendChild(revealTitle);

      const row = document.createElement("div");
      row.className = "breadcrumb";
      row.style.justifyContent = "center";
      fb.revealed.lineIds.forEach((id, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.style.setProperty("--chip-color", lineById(id).color);
        chip.textContent = id;
        row.appendChild(chip);
        if (i < fb.revealed!.lineIds.length - 1) {
          const sep = document.createElement("span");
          sep.className = "breadcrumb__sep";
          sep.textContent = "→";
          row.appendChild(sep);
        }
      });
      container.appendChild(row);
    }

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "btn btn--accent";
    continueBtn.style.width = "100%";
    continueBtn.style.marginTop = "14px";
    continueBtn.textContent = "Weiter";
    continueBtn.addEventListener("click", actions.onContinue);
    container.appendChild(continueBtn);
  } else if (state.phase === "summary" && state.summary) {
    const score = document.createElement("p");
    score.style.textAlign = "center";
    score.style.fontFamily = "var(--font-display)";
    score.style.fontSize = "1.6rem";
    score.style.fontWeight = "800";
    score.style.color = "var(--accent)";
    score.style.margin = "10px 0 4px";
    score.textContent = `${state.summary.totalScore} Punkte`;
    container.appendChild(score);

    if (state.summary.isNewHighscore) {
      const hs = document.createElement("p");
      hs.style.textAlign = "center";
      hs.style.color = "var(--success)";
      hs.style.fontWeight = "600";
      hs.textContent = "Neuer Highscore!";
      container.appendChild(hs);
    }

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.style.marginTop = "10px";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", actions.onPlayAgain);
    container.appendChild(again);
  }
}
