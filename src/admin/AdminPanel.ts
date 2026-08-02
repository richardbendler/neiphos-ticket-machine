import { openModal } from "../core/modal";
import { OnScreenKeyboard } from "../core/OnScreenKeyboard";
import { enterFullscreen, exitFullscreen, isFullscreenActive } from "../core/kiosk";
import { getSummaryByGame, getSessionsForGame, clearAllStats, type GameSummary } from "../core/stats";
import { clearHighscoreBoard } from "../core/storage";
import { fetchFeedback, markFeedbackRead, countUnread, type FeedbackEntry } from "../core/feedback";
import { gameRegistry } from "../games/registry";

// Bewusst simpel gehalten fuer den Start -- ein staerkeres Schutzverfahren
// (z. B. Aenderbarkeit ueber die UI selbst) ist fuer eine spaetere Iteration
// vorgemerkt, siehe README-Abschnitt "Bekannte Grenzen".
const ADMIN_PASSWORD = "Neiphos";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function gameTitle(gameId: string): string {
  return gameRegistry.find((g) => g.id === gameId)?.title ?? gameId;
}

export function openAdminPanel(): void {
  openModal((panel, close) => {
    panel.innerHTML = "";
    const h2 = document.createElement("h2");
    h2.textContent = "Admin-Bereich";
    const p = document.createElement("p");
    p.textContent = "Passwort eingeben, um fortzufahren.";
    const error = document.createElement("div");
    error.className = "field-error";
    panel.append(h2, p, error);

    const kb = new OnScreenKeyboard({
      layout: "alphanumeric",
      maxLength: 32,
      placeholder: "Passwort",
      submitLabel: "Anmelden",
      mask: true,
      onSubmit: (value) => {
        // Die Bildschirmtastatur kann nur Grossbuchstaben eingeben (kein
        // Shift/Caps-Umschalter auf einem Touch-Kiosk noetig) -- Vergleich
        // daher bewusst case-insensitive.
        if (value.toLowerCase() === ADMIN_PASSWORD.toLowerCase()) {
          renderAdminHome(panel, close);
        } else {
          error.textContent = "Falsches Passwort.";
          kb.setValue("");
        }
      },
    });
    kb.mount(panel);

    const cancel = document.createElement("div");
    cancel.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.addEventListener("click", close);
    cancel.appendChild(cancelBtn);
    panel.appendChild(cancel);
  });
}

function renderAdminHome(panel: HTMLDivElement, close: () => void): void {
  panel.innerHTML = "";
  panel.classList.add("modal-panel--wide");

  const h2 = document.createElement("h2");
  h2.textContent = "Admin-Bereich";
  panel.appendChild(h2);

  // --- Kiosk-Steuerung -----------------------------------------------
  const kioskSection = document.createElement("div");
  kioskSection.style.margin = "16px 0";
  const kioskTitle = document.createElement("p");
  kioskTitle.style.color = "var(--text-muted)";
  kioskTitle.style.marginBottom = "8px";
  kioskTitle.textContent = "Kiosk-Modus (Vollbild) dieses Browserfensters:";
  kioskSection.appendChild(kioskTitle);

  const kioskBtn = document.createElement("button");
  kioskBtn.type = "button";
  kioskBtn.className = "btn btn--accent";
  const syncKioskLabel = () => {
    kioskBtn.textContent = isFullscreenActive() ? "Kiosk-Modus beenden" : "Kiosk-Modus starten";
  };
  syncKioskLabel();
  kioskBtn.addEventListener("click", async () => {
    if (isFullscreenActive()) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
    syncKioskLabel();
  });
  kioskSection.appendChild(kioskBtn);

  const kioskHint = document.createElement("p");
  kioskHint.style.fontSize = "0.78rem";
  kioskHint.style.marginTop = "8px";
  kioskHint.textContent =
    "Hinweis: Das steuert nur den Vollbildmodus dieser Webseite (Fullscreen API). Wurde Chromium mit --kiosk gestartet, hilft zum vollständigen Beenden nur ein Neustart des Browsers auf dem Gerät (siehe README).";
  kioskSection.appendChild(kioskHint);
  panel.appendChild(kioskSection);

  // --- Statistik -------------------------------------------------------
  const statsTitle = document.createElement("p");
  statsTitle.style.color = "var(--text-muted)";
  statsTitle.style.margin = "18px 0 8px";
  statsTitle.textContent = "Spielstatistik:";
  panel.appendChild(statsTitle);

  const statsList = document.createElement("div");
  statsList.style.display = "flex";
  statsList.style.flexDirection = "column";
  statsList.style.gap = "8px";
  panel.appendChild(statsList);

  renderStatsList(statsList);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn--ghost";
  clearBtn.style.marginTop = "10px";
  clearBtn.style.fontSize = "0.8rem";
  clearBtn.textContent = "Statistik zurücksetzen";
  clearBtn.addEventListener("click", () => {
    clearAllStats();
    renderStatsList(statsList);
  });
  panel.appendChild(clearBtn);

  // --- Feedback ----------------------------------------------------------
  const feedbackTitle = document.createElement("p");
  feedbackTitle.style.color = "var(--text-muted)";
  feedbackTitle.style.margin = "18px 0 8px";
  feedbackTitle.textContent = "Feedback von Besucher:innen:";
  panel.appendChild(feedbackTitle);

  const feedbackBtn = document.createElement("button");
  feedbackBtn.type = "button";
  feedbackBtn.className = "btn";
  feedbackBtn.style.display = "inline-flex";
  feedbackBtn.style.alignItems = "center";
  feedbackBtn.style.gap = "8px";
  feedbackBtn.textContent = "Feedback anschauen";
  panel.appendChild(feedbackBtn);

  const unreadBadge = document.createElement("span");
  unreadBadge.style.display = "none";
  unreadBadge.style.background = "var(--accent)";
  unreadBadge.style.color = "#2b2004";
  unreadBadge.style.borderRadius = "999px";
  unreadBadge.style.padding = "1px 8px";
  unreadBadge.style.fontSize = "0.8rem";
  unreadBadge.style.fontWeight = "700";
  feedbackBtn.appendChild(unreadBadge);

  const refreshUnreadBadge = () => {
    fetchFeedback().then(({ entries }) => {
      const unread = countUnread(entries);
      unreadBadge.style.display = unread > 0 ? "inline-block" : "none";
      unreadBadge.textContent = String(unread);
    });
  };
  refreshUnreadBadge();

  feedbackBtn.addEventListener("click", () => {
    renderFeedbackView(panel, close);
  });

  // --- Highscores ----------------------------------------------------------
  const highscoreTitle = document.createElement("p");
  highscoreTitle.style.color = "var(--text-muted)";
  highscoreTitle.style.margin = "18px 0 8px";
  highscoreTitle.textContent = "Highscores:";
  panel.appendChild(highscoreTitle);

  const highscoreResetBtn = document.createElement("button");
  highscoreResetBtn.type = "button";
  highscoreResetBtn.className = "btn btn--ghost";
  highscoreResetBtn.style.fontSize = "0.8rem";
  highscoreResetBtn.textContent = "Alle Highscores zurücksetzen";
  highscoreResetBtn.addEventListener("click", () => {
    for (const game of gameRegistry) {
      for (const category of game.highscoreCategories ?? []) {
        clearHighscoreBoard(game.id, category.board);
      }
    }
    highscoreResetBtn.textContent = "Highscores zurückgesetzt.";
    highscoreResetBtn.disabled = true;
  });
  panel.appendChild(highscoreResetBtn);

  // --- Schliessen --------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn";
  closeBtn.textContent = "Schließen";
  closeBtn.addEventListener("click", close);
  actions.appendChild(closeBtn);
  panel.appendChild(actions);
}

function renderFeedbackView(panel: HTMLDivElement, close: () => void): void {
  panel.innerHTML = "";
  const h2 = document.createElement("h2");
  h2.textContent = "Feedback";
  panel.appendChild(h2);

  const status = document.createElement("p");
  status.style.color = "var(--text-muted)";
  status.style.fontSize = "0.85rem";
  status.textContent = "Lädt …";
  panel.appendChild(status);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "8px";
  list.style.margin = "10px 0";
  panel.appendChild(list);

  const backActions = document.createElement("div");
  backActions.className = "modal-actions";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn";
  backBtn.textContent = "Zurück";
  backBtn.addEventListener("click", () => renderAdminHome(panel, close));
  backActions.appendChild(backBtn);
  panel.appendChild(backActions);

  fetchFeedback().then(({ entries, serverReachable }) => {
    const unreadIds = new Set(entries.filter((e) => !e.read).map((e) => e.id));

    if (!serverReachable) {
      status.textContent = "Kein Server erreichbar — es werden nur lokal auf diesem Gerät gespeicherte Rückmeldungen angezeigt.";
    } else if (entries.length === 0) {
      status.textContent = "Noch kein Feedback vorhanden.";
    } else {
      status.textContent = "";
    }

    list.innerHTML = "";
    for (const entry of entries) {
      list.appendChild(buildFeedbackRow(entry, unreadIds.has(entry.id)));
    }

    // Sobald das Feedback angeschaut wurde, gilt es als gelesen.
    for (const entry of entries) {
      if (!entry.read) void markFeedbackRead(entry);
    }
  });
}

function buildFeedbackRow(entry: FeedbackEntry, wasUnread: boolean): HTMLElement {
  const row = document.createElement("div");
  row.style.border = "1px solid var(--panel-border)";
  row.style.borderRadius = "var(--radius-sm)";
  row.style.padding = "10px 12px";
  row.style.background = wasUnread ? "var(--panel-alt)" : "transparent";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.justifyContent = "space-between";
  head.style.alignItems = "center";
  head.style.marginBottom = "4px";

  const date = document.createElement("span");
  date.style.fontSize = "0.75rem";
  date.style.color = "var(--text-faint)";
  date.textContent = formatDateTime(entry.createdAt) + (entry.id.startsWith("local-") ? " · nur lokal" : "");
  head.appendChild(date);

  if (wasUnread) {
    const badge = document.createElement("span");
    badge.style.fontSize = "0.68rem";
    badge.style.fontWeight = "700";
    badge.style.color = "var(--accent)";
    badge.textContent = "NEU";
    head.appendChild(badge);
  }

  row.appendChild(head);

  const message = document.createElement("div");
  message.style.color = "var(--text)";
  message.style.fontSize = "0.92rem";
  message.style.whiteSpace = "pre-wrap";
  message.textContent = entry.message;
  row.appendChild(message);

  return row;
}

function renderStatsList(container: HTMLElement): void {
  container.innerHTML = "";
  const summaries = getSummaryByGame();

  if (summaries.length === 0) {
    const empty = document.createElement("p");
    empty.style.color = "var(--text-faint)";
    empty.style.fontSize = "0.85rem";
    empty.textContent = "Noch keine Spiele gestartet.";
    container.appendChild(empty);
    return;
  }

  for (const summary of summaries) {
    container.appendChild(buildStatsRow(summary));
  }
}

function buildStatsRow(summary: GameSummary): HTMLElement {
  const row = document.createElement("div");
  row.style.border = "1px solid var(--panel-border)";
  row.style.borderRadius = "var(--radius-sm)";
  row.style.overflow = "hidden";

  const head = document.createElement("button");
  head.type = "button";
  head.style.width = "100%";
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.padding = "10px 12px";
  head.style.background = "var(--panel-alt)";
  head.style.border = "none";
  head.style.color = "var(--text)";
  head.style.cursor = "pointer";

  const left = document.createElement("span");
  left.style.fontFamily = "var(--font-display)";
  left.style.fontWeight = "600";
  left.textContent = gameTitle(summary.gameId);

  const right = document.createElement("span");
  right.style.fontSize = "0.82rem";
  right.style.color = "var(--text-muted)";
  right.textContent = `${summary.count}× · ${formatDuration(summary.totalMs)}`;

  head.append(left, right);
  row.appendChild(head);

  const detail = document.createElement("div");
  detail.style.display = "none";
  detail.style.maxHeight = "220px";
  detail.style.overflowY = "auto";
  detail.style.padding = "6px 12px 10px";
  detail.style.fontSize = "0.82rem";
  detail.style.color = "var(--text-muted)";
  row.appendChild(detail);

  let loaded = false;
  head.addEventListener("click", () => {
    const isOpen = detail.style.display !== "none";
    detail.style.display = isOpen ? "none" : "block";
    if (!isOpen && !loaded) {
      loaded = true;
      const sessions = getSessionsForGame(summary.gameId);
      for (const session of sessions) {
        const line = document.createElement("div");
        line.style.display = "flex";
        line.style.justifyContent = "space-between";
        line.style.padding = "4px 0";
        line.style.borderBottom = "1px solid var(--panel-border)";
        line.innerHTML = `<span>${formatDateTime(session.startedAt)}</span><span>${formatDuration(session.durationMs)}</span>`;
        detail.appendChild(line);
      }
    }
  });

  return row;
}
