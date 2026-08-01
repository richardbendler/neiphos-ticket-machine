import type { TransitLine } from "../../data/berlinNetwork";
import type { RouteResult, RouteSegment } from "./graph";
import type { HighscoreEntry } from "../../core/storage";

const MODE_LABEL: Record<TransitLine["mode"], string> = {
  "u-bahn": "U-Bahn",
  "s-bahn": "S-Bahn",
  tram: "Tram",
};

export interface HudViewState {
  round: number;
  totalRounds: number;
  attempt: number;
  totalAttempts: number;
  start: string;
  target: string;
  highscore: HighscoreEntry | null;
}

export function renderHud(container: HTMLElement, state: HudViewState): void {
  container.innerHTML = "";

  const card = document.createElement("div");
  card.className = "ticket-card";
  card.style.flex = "1";
  card.style.padding = "10px 14px";
  card.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
      <strong style="font-family: var(--font-display); font-size: 0.95rem;">${state.start} → ${state.target}</strong>
      <span style="font-size:0.72rem; color: var(--paper-muted);">Runde ${state.round}/${state.totalRounds} · Versuch ${state.attempt}/${state.totalAttempts}</span>
    </div>
  `;
  container.appendChild(card);

  if (state.highscore) {
    const badge = document.createElement("div");
    badge.className = "chip";
    badge.style.setProperty("--chip-color", "var(--accent-dark)");
    badge.style.color = "#2b2004";
    badge.style.flexShrink = "0";
    badge.textContent = `🏆 ${state.highscore.value} · ${state.highscore.name}`;
    container.appendChild(badge);
  }
}

export interface SheetState {
  phase: "choosing-line" | "choosing-station" | "round-feedback" | "game-summary";
  segments: RouteSegment[];
  currentStation: string;
  target: string;
  availableLines?: TransitLine[];
  activeLine?: TransitLine;
  feedback?: {
    success: boolean;
    message: string;
    scoreGained: number;
    revealed?: RouteResult;
    roundOver: boolean;
  };
  summary?: {
    totalScore: number;
    isNewHighscore: boolean;
  };
}

export interface SheetActions {
  onSelectLine: (lineId: string) => void;
  onSelectStation: (station: string) => void;
  onCancelLineChoice: () => void;
  onReset: () => void;
  onContinue: () => void;
  onPlayAgain: () => void;
}

function renderBreadcrumb(segments: RouteSegment[], currentStation: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "breadcrumb";
  if (segments.length === 0) {
    wrap.innerHTML = `<span>Du stehst in <strong style="color:var(--text)">${currentStation}</strong> und wählst deine erste Linie.</span>`;
    return wrap;
  }
  for (const seg of segments) {
    const lineChip = document.createElement("span");
    lineChip.className = "chip";
    lineChip.style.setProperty("--chip-color", "var(--primary)");
    lineChip.style.fontSize = "0.72rem";
    lineChip.style.padding = "3px 9px";
    lineChip.textContent = `${seg.lineId}`;
    wrap.appendChild(lineChip);
    const arrow = document.createElement("span");
    arrow.className = "breadcrumb__sep";
    arrow.textContent = "→";
    wrap.appendChild(arrow);
    const station = document.createElement("span");
    station.textContent = seg.to;
    wrap.appendChild(station);
    wrap.appendChild(Object.assign(document.createElement("span"), { className: "breadcrumb__sep", textContent: "·" }));
  }
  return wrap;
}

export function renderSheet(container: HTMLElement, state: SheetState, actions: SheetActions): void {
  container.innerHTML = "";

  const title = document.createElement("div");
  title.className = "stage-sheet__title";
  container.appendChild(title);

  const breadcrumbHost = document.createElement("div");
  breadcrumbHost.style.marginBottom = "10px";
  breadcrumbHost.appendChild(renderBreadcrumb(state.segments, state.currentStation));
  container.appendChild(breadcrumbHost);

  const body = document.createElement("div");
  body.className = "scroll-list";
  body.style.flex = "1";
  body.style.minHeight = "0";
  container.appendChild(body);

  if (state.phase === "choosing-line") {
    title.textContent = "Welche Linie nimmst du?";
    const grouped: Record<TransitLine["mode"], TransitLine[]> = { "u-bahn": [], "s-bahn": [], tram: [] };
    for (const line of state.availableLines ?? []) grouped[line.mode].push(line);

    for (const mode of ["u-bahn", "s-bahn", "tram"] as const) {
      if (grouped[mode].length === 0) continue;
      const label = document.createElement("div");
      label.style.fontSize = "0.72rem";
      label.style.color = "var(--text-faint)";
      label.style.margin = "8px 0 4px";
      label.textContent = MODE_LABEL[mode];
      body.appendChild(label);

      const row = document.createElement("div");
      row.className = "chip-row";
      for (const line of grouped[mode]) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chip";
        btn.style.setProperty("--chip-color", line.color);
        btn.textContent = line.label.split(" ")[0];
        btn.addEventListener("click", () => actions.onSelectLine(line.id));
        row.appendChild(btn);
      }
      body.appendChild(row);
    }

    if (state.segments.length > 0) {
      const footer = document.createElement("div");
      footer.style.marginTop = "10px";
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn btn--ghost";
      resetBtn.style.fontSize = "0.8rem";
      resetBtn.textContent = "Route zurücksetzen";
      resetBtn.addEventListener("click", actions.onReset);
      footer.appendChild(resetBtn);
      body.appendChild(footer);
    }
  } else if (state.phase === "choosing-station") {
    const line = state.activeLine!;
    title.textContent = `Linie ${line.label} — wähle deine Ausstiegs-/Umstiegsstation`;
    const currentIndex = line.stations.indexOf(state.currentStation);

    for (const station of line.stations) {
      if (station === state.currentStation) continue;
      const idx = line.stations.indexOf(station);
      const stops = Math.abs(idx - currentIndex);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "list-row";
      const isTarget = station === state.target;
      row.innerHTML = `<span>${isTarget ? "🎯 " : ""}${station}</span><span class="list-row__meta">${stops} Halt${stops === 1 ? "" : "e"}</span>`;
      if (isTarget) row.style.color = "var(--accent)";
      row.addEventListener("click", () => actions.onSelectStation(station));
      body.appendChild(row);
    }

    const footer = document.createElement("div");
    footer.style.marginTop = "8px";
    footer.style.display = "flex";
    footer.style.gap = "8px";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost";
    cancelBtn.style.fontSize = "0.8rem";
    cancelBtn.textContent = "Andere Linie wählen";
    cancelBtn.addEventListener("click", actions.onCancelLineChoice);
    footer.appendChild(cancelBtn);
    container.appendChild(footer);
  } else if (state.phase === "round-feedback") {
    const fb = state.feedback!;
    title.textContent = fb.success ? "Ziel erreicht!" : "Nicht ganz optimal";

    const msg = document.createElement("p");
    msg.style.color = "var(--text)";
    msg.style.fontSize = "0.92rem";
    msg.style.margin = "0 0 8px";
    msg.textContent = fb.message;
    body.appendChild(msg);

    if (fb.scoreGained > 0) {
      const score = document.createElement("p");
      score.style.color = "var(--accent)";
      score.style.fontFamily = "var(--font-display)";
      score.style.fontWeight = "700";
      score.textContent = `+${fb.scoreGained} Punkte`;
      body.appendChild(score);
    }

    if (fb.revealed) {
      const revealTitle = document.createElement("p");
      revealTitle.style.fontSize = "0.78rem";
      revealTitle.style.color = "var(--text-muted)";
      revealTitle.style.margin = "10px 0 4px";
      revealTitle.textContent = "So wäre die schnellste Verbindung gegangen:";
      body.appendChild(revealTitle);

      if (fb.revealed.segments.length === 0) {
        const p = document.createElement("p");
        p.style.fontSize = "0.85rem";
        p.textContent = "Start und Ziel liegen direkt beieinander.";
        body.appendChild(p);
      }

      for (const seg of fb.revealed.segments) {
        const line = document.createElement("div");
        line.style.display = "flex";
        line.style.alignItems = "center";
        line.style.gap = "8px";
        line.style.padding = "4px 0";
        line.style.fontSize = "0.85rem";
        const badge = document.createElement("span");
        badge.className = "chip";
        badge.style.setProperty("--chip-color", "var(--primary)");
        badge.style.fontSize = "0.72rem";
        badge.textContent = seg.lineId;
        line.appendChild(badge);
        const text = document.createElement("span");
        text.textContent = `${seg.from} → ${seg.to} (${seg.stops} Halte)`;
        line.appendChild(text);
        body.appendChild(line);
      }
    }

    const continueBtn = document.createElement("button");
    continueBtn.type = "button";
    continueBtn.className = "btn btn--accent";
    continueBtn.style.marginTop = "12px";
    continueBtn.style.width = "100%";
    continueBtn.textContent = "Weiter";
    continueBtn.addEventListener("click", actions.onContinue);
    container.appendChild(continueBtn);
  } else if (state.phase === "game-summary") {
    const sum = state.summary!;
    title.textContent = "Spiel beendet";

    const score = document.createElement("p");
    score.style.fontFamily = "var(--font-display)";
    score.style.fontSize = "1.6rem";
    score.style.fontWeight = "800";
    score.style.color = "var(--accent)";
    score.style.margin = "0 0 4px";
    score.textContent = `${sum.totalScore} Punkte`;
    body.appendChild(score);

    if (sum.isNewHighscore) {
      const hs = document.createElement("p");
      hs.style.color = "var(--success)";
      hs.style.fontWeight = "600";
      hs.textContent = "Neuer Highscore!";
      body.appendChild(hs);
    }

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.marginTop = "10px";
    again.style.width = "100%";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", actions.onPlayAgain);
    container.appendChild(again);
  }
}
