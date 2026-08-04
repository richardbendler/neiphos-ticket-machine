import { openModal } from "../core/modal";
import { OnScreenKeyboard } from "../core/OnScreenKeyboard";
import { enterFullscreen, exitFullscreen, isFullscreenActive } from "../core/kiosk";
import { summarizeSessions, filterSessionsForGame, getAllSessions, clearAllStats, type GameSummary, type PlaySession } from "../core/stats";
import { clearHighscoreBoard, isGameEnabled, setGameEnabled } from "../core/storage";
import { fetchFeedback, markFeedbackRead, countUnread, type FeedbackEntry } from "../core/feedback";
import { setAdminSession, clearAdminSession } from "../core/adminSession";
import { pullSettingsFromServer, pullStatsFromServer, resetHighscoresOnServer, resetStatsOnServer, checkServerSyncStatus } from "../core/sync";
import { gameRegistry } from "../games/registry";

// Kommt aus .env.local (nie eingecheckt, siehe .env.local.example und
// vite.config.ts) statt hier im Quellcode zu stehen -- der Build bricht
// ohne gesetztes VITE_ADMIN_PASSWORD bewusst ab (siehe vite.config.ts).
// Bewusst weiterhin einfache Client-seitige Pruefung ohne echten Server --
// ein staerkeres Schutzverfahren ist fuer eine spaetere Iteration
// vorgemerkt, siehe README-Abschnitt "Bekannte Grenzen".
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

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

function codeBlock(text: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.style.margin = "6px 0 14px";

  const pre = document.createElement("pre");
  pre.style.background = "var(--panel-alt)";
  pre.style.border = "1px solid var(--panel-border)";
  pre.style.borderRadius = "var(--radius-sm)";
  pre.style.padding = "10px 70px 10px 12px";
  pre.style.fontSize = "0.72rem";
  pre.style.lineHeight = "1.5";
  pre.style.overflowX = "auto";
  pre.style.whiteSpace = "pre";
  pre.style.margin = "0";
  pre.textContent = text;
  wrap.appendChild(pre);

  // Rein additiv (Copy-to-Clipboard) -- greift nicht in die uebrige,
  // Touch-zentrierte Bedienung ein, ist nur ein zusaetzlicher Button.
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn btn--ghost";
    copyBtn.textContent = "Kopieren";
    copyBtn.style.position = "absolute";
    copyBtn.style.top = "6px";
    copyBtn.style.right = "6px";
    copyBtn.style.padding = "4px 10px";
    copyBtn.style.fontSize = "0.68rem";
    copyBtn.addEventListener("click", () => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          const original = copyBtn.textContent;
          copyBtn.textContent = "Kopiert!";
          setTimeout(() => {
            copyBtn.textContent = original;
          }, 1500);
        })
        .catch(() => {
          // Clipboard-Zugriff evtl. blockiert (z.B. kein sicherer Kontext) -- Button bleibt dann einfach wirkungslos.
        });
    });
    wrap.appendChild(copyBtn);
  }

  return wrap;
}

/**
 * Zusaetzlicher X-Button oben rechts im Panel -- ergaenzend zum jeweiligen
 * "Schließen"/"Zurück"-Button unten im Inhalt. Muss nach jedem
 * "panel.innerHTML = ''" (Admin-Login, Admin-Home, Feedback-Ansicht,
 * Kiosk-Anleitung) neu angehaengt werden, da der jeweils vorherige dabei
 * mit geleert wird.
 */
function addCloseCorner(panel: HTMLDivElement, close: () => void): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "modal-panel__close";
  btn.setAttribute("aria-label", "Schließen");
  btn.textContent = "✕";
  btn.addEventListener("click", close);
  panel.appendChild(btn);
}

function sectionHeading(text: string): HTMLHeadingElement {
  const h = document.createElement("h3");
  h.style.fontSize = "1rem";
  h.style.margin = "18px 0 4px";
  h.style.color = "var(--text)";
  h.textContent = text;
  return h;
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.style.fontSize = "0.85rem";
  p.style.color = "var(--text-muted)";
  p.style.margin = "4px 0";
  p.textContent = text;
  return p;
}

/**
 * Ausfuehrliche Anleitung, wie der Kiosk-Modus WIRKLICH (auf Betriebssystem-
 * statt nur Browser-Vollbild-Ebene) gestartet und fuer den Autostart
 * eingerichtet wird -- inhaltlich identisch zu den entsprechenden
 * README-Abschnitten, nur direkt im Admin-Bereich nutzbar, ohne dafuer an
 * den Quellcode/die README auf dem Geraet selbst zu muessen.
 */
function openKioskGuideModal(): void {
  openModal((panel, close) => {
    panel.classList.add("modal-panel--wide");
    addCloseCorner(panel, close);
    const h2 = document.createElement("h2");
    h2.textContent = "Kiosk-Modus-Anleitung";
    panel.appendChild(h2);

    panel.appendChild(
      paragraph(
        'Der Button "Kiosk-Modus starten" oben schaltet nur den Vollbildmodus dieser Webseite um (Fullscreen API). Damit der Kiosk wirklich nicht aus Versehen (oder von Besuchern) verlassen werden kann, muss der Browser selbst im Betriebssystem-Kiosk-Modus gestartet werden -- das geht nur per Befehl, nicht per Knopf in der App.',
      ),
    );

    panel.appendChild(sectionHeading("Raspberry Pi / Linux: Browser im Kiosk-Modus starten"));
    panel.appendChild(paragraph("Im Terminal auf dem Pi ausführen (Server muss bereits laufen, siehe unten):"));
    panel.appendChild(
      codeBlock(
        `chromium-browser \\
  --kiosk \\
  --user-data-dir=/home/pi/.config/ticketmachine-chromium \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --autoplay-policy=no-user-gesture-required \\
  http://localhost:8080`,
      ),
    );
    panel.appendChild(
      paragraph("Beenden dann nur noch per SSH/Tastatur am Gerät selbst, z. B. mit: pkill chromium-browser"),
    );

    panel.appendChild(sectionHeading("Raspberry Pi / Linux: Autostart einrichten"));
    panel.appendChild(
      paragraph(
        "Ziel: Pi einschalten → ohne jeden manuellen Klick landet man im laufenden Kiosk. Dafür starten zwei Dinge automatisch: der lokale Server und Chromium im Kiosk-Modus.",
      ),
    );
    panel.appendChild(paragraph("1) Startskript /home/pi/neiphos-ticket-machine/start-kiosk.sh anlegen:"));
    panel.appendChild(
      codeBlock(
        `#!/bin/bash
# Kurz warten, bis der Server-Service sicher steht (nach einem Reboot).
sleep 3
chromium-browser \\
  --kiosk \\
  --user-data-dir=/home/pi/.config/ticketmachine-chromium \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --autoplay-policy=no-user-gesture-required \\
  http://localhost:8080`,
      ),
    );
    panel.appendChild(codeBlock("chmod +x /home/pi/neiphos-ticket-machine/start-kiosk.sh"));
    panel.appendChild(paragraph("2) Autostart-Eintrag ~/.config/autostart/ticketmachine-kiosk.desktop anlegen:"));
    panel.appendChild(
      codeBlock(
        `[Desktop Entry]
Type=Application
Name=Neiphos Ticket Machine Kiosk
Exec=/home/pi/neiphos-ticket-machine/start-kiosk.sh
X-GNOME-Autostart-enabled=true`,
      ),
    );
    panel.appendChild(
      paragraph(
        "Für den Server-Autostart (damit http://localhost:8080 schon beim Booten bereitsteht, noch vor dem Desktop-Login) einen systemd-Service einrichten -- Details dazu stehen in der README im Abschnitt „Autostart einrichten (Linux/Raspberry Pi OS)“.",
      ),
    );
    panel.appendChild(
      paragraph("Nach einem Neustart (sudo reboot) sollte der Pi jetzt direkt im laufenden Kiosk starten."),
    );

    panel.appendChild(sectionHeading("Windows (zum Testen oder als Alternativ-Gerät)"));
    panel.appendChild(paragraph("Browser im Kiosk-Modus starten (PowerShell):"));
    panel.appendChild(
      codeBlock(
        `& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" \`
  --kiosk \`
  --user-data-dir="$env:LOCALAPPDATA\\TicketMachineChromium" \`
  --noerrdialogs \`
  --disable-pinch \`
  --overscroll-history-navigation=0 \`
  --autoplay-policy=no-user-gesture-required \`
  http://localhost:8080`,
      ),
    );
    panel.appendChild(
      paragraph(
        "Beenden: Alt+F4 funktioniert im --kiosk-Modus bewusst nicht ohne Weiteres -- entweder über den Task-Manager (Strg+Umschalt+Esc) den Chrome/Edge-Prozess beenden, oder vorher hier im Admin-Bereich den Vollbildmodus verlassen.",
      ),
    );
    const warning = paragraph(
      "⚠️ Wichtig auf einem Touchscreen: --kiosk sperrt nur den Browser, nicht die Windows-Shell. Vom Bildschirmrand hineinwischen kann trotzdem das Info-/Action-Center, die Taskleiste oder das Startmenü einblenden. Für echte Absicherung auf einem Touchscreen: Windows-eigenen Kiosk-Modus einrichten -- Einstellungen → Konten → Weitere Benutzer → „Kiosk einrichten“ → Microsoft Edge als Kiosk-App (Windows Pro/Enterprise/Education nötig, in Windows Home nicht verfügbar). Details siehe README, Abschnitt „Kiosk-Modus unter Windows“.",
    );
    warning.style.color = "var(--danger)";
    warning.style.fontWeight = "600";
    panel.appendChild(warning);
    panel.appendChild(paragraph("Autostart-Ordner (Win+R → shell:startup) → Datei start-kiosk.bat ablegen (nur fuer die einfache --kiosk-Methode oben):"));
    panel.appendChild(
      codeBlock(
        `@echo off
cd /d "C:\\Pfad\\zur\\Neiphos Ticket Machine"
start "" node server\\serve.js dist 8080
timeout /t 3 /nobreak >nul
start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk --user-data-dir="%LOCALAPPDATA%\\TicketMachineChromium" --noerrdialogs --disable-pinch --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required http://localhost:8080`,
      ),
    );
    panel.appendChild(
      paragraph(
        "Dazu am besten einen Windows-Benutzer einrichten, der sich automatisch anmeldet (netplwiz → Häkchen bei „Benutzer muss Kennwort eingeben“ entfernen), damit der Rechner nach dem Einschalten direkt bis zum Kiosk durchstartet. Alternativ die Aufgabenplanung (taskschd.msc) mit Trigger „Bei Anmeldung“.",
      ),
    );

    panel.appendChild(sectionHeading("Echte Kiosk-Absicherung unter Windows (empfohlen für Touchscreens)"));
    panel.appendChild(
      paragraph(
        "Für einen von fremden Personen bedienten Touchscreen reicht die einfache --kiosk-Methode oben nicht (siehe Warnung). Richtiger Windows-Kiosk-Modus (sperrt Taskleiste, Action Center, Wisch-Gesten UND meldet sich automatisch an): Einstellungen → Konten → Weitere Benutzer → „Kiosk einrichten“ → Microsoft Edge als App, Modus „Digitale Beschilderung“, URL http://localhost:8080. Braucht Windows Pro/Enterprise/Education (nicht Home). Verlassen nur per Strg+Alt+Entf -- setzt eine physische Tastatur voraus.",
      ),
    );

    panel.appendChild(
      paragraph(
        "Physische Tasten am Monitor-/Display-Gehäuse selbst (Helligkeit, Eingangsquelle, Power) hängen vollständig vom verwendeten Bildschirm ab, nicht von dieser App -- in der Bedienungsanleitung des Geräts nachsehen, ob es eine „Tastensperre“/„Key Lock“-Funktion im Bildschirmmenü (OSD) gibt.",
      ),
    );

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn btn--accent";
    closeBtn.textContent = "Schließen";
    closeBtn.addEventListener("click", close);
    actions.appendChild(closeBtn);
    panel.appendChild(actions);
  });
}

export function openAdminPanel(onClose?: () => void): void {
  openModal((panel, close) => {
    panel.innerHTML = "";
    panel.classList.add("modal-panel--wide");
    addCloseCorner(panel, close);
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
      extraKeys: true,
      caseToggle: true,
      onSubmit: (value) => {
        if (value === ADMIN_PASSWORD) {
          // Muss VOR renderAdminHome gesetzt werden -- die dortigen
          // Server-Abgleiche (Statistik/Highscore-Reset) haengen fuer die
          // admin-geschuetzten Endpunkte davon ab, siehe core/adminSession.ts.
          setAdminSession(value);
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
  }, {
    onClose: () => {
      // Passwort soll nicht ueber das Ende der Admin-Sitzung hinaus im
      // Speicher bleiben (siehe core/adminSession.ts).
      clearAdminSession();
      onClose?.();
    },
  });
}

function renderAdminHome(panel: HTMLDivElement, close: () => void): void {
  panel.innerHTML = "";
  panel.classList.add("modal-panel--wide");
  addCloseCorner(panel, close);

  const h2 = document.createElement("h2");
  h2.textContent = "Admin-Bereich";
  panel.appendChild(h2);

  // --- Sync-Status ---------------------------------------------------
  // Nur eine Anzeige, kein Ablauf haengt hiervon ab -- die einzelnen
  // Abschnitte unten pruefen/pushen unabhaengig davon selbst (siehe
  // core/sync.ts). Unterscheidet bewusst DREI Faelle (nicht nur an/aus),
  // damit auf einen Blick klar ist, WARUM die Sync ggf. nicht laeuft --
  // "laeuft gerade nur lokal" (kein server/serve.js erreichbar, z. B. beim
  // Entwickeln mit npm run dev) sieht ganz anders aus als "server/serve.js
  // laeuft zwar, aber NTM_SYNC ist dort nicht gesetzt" (siehe
  // core/sync.ts#checkServerSyncStatus).
  const syncStatus = paragraph("Sync-Status: wird geprüft …");
  syncStatus.style.fontSize = "0.78rem";
  syncStatus.style.fontWeight = "600";
  syncStatus.style.padding = "6px 10px";
  syncStatus.style.borderRadius = "var(--radius-sm)";
  syncStatus.style.border = "1px solid var(--panel-border)";
  panel.appendChild(syncStatus);
  void checkServerSyncStatus().then((status) => {
    if (status === "no-server") {
      syncStatus.textContent = "🖥️ Läuft gerade rein lokal (kein Server erreichbar) — alles bleibt nur auf diesem Gerät.";
      syncStatus.style.color = "var(--text-muted)";
    } else if (status === "server-sync-off") {
      syncStatus.textContent = "🌐 Server erreichbar, geräteübergreifende Synchronisation aber nicht aktiviert (NTM_SYNC fehlt) — Highscores/Statistik/Einstellungen bleiben lokal.";
      syncStatus.style.color = "var(--text)";
    } else {
      syncStatus.textContent = "✅ Server erreichbar, geräteübergreifende Synchronisation aktiv — Highscores/Statistik/Einstellungen werden geteilt.";
      syncStatus.style.color = "var(--success)";
    }
  });

  // --- Kiosk-Steuerung -----------------------------------------------
  const kioskSection = document.createElement("div");
  kioskSection.style.margin = "16px 0";
  const kioskTitle = document.createElement("p");
  kioskTitle.style.color = "var(--text-muted)";
  kioskTitle.style.marginBottom = "8px";
  kioskTitle.textContent = "Kiosk-Modus (Vollbild) dieses Browserfensters:";
  kioskSection.appendChild(kioskTitle);

  const kioskBtnRow = document.createElement("div");
  kioskBtnRow.style.display = "flex";
  kioskBtnRow.style.gap = "8px";
  kioskBtnRow.style.flexWrap = "wrap";

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
  kioskBtnRow.appendChild(kioskBtn);

  const kioskGuideBtn = document.createElement("button");
  kioskGuideBtn.type = "button";
  kioskGuideBtn.className = "btn btn--ghost";
  kioskGuideBtn.textContent = "Kiosk-Modus-Anleitung";
  kioskGuideBtn.addEventListener("click", () => openKioskGuideModal());
  kioskBtnRow.appendChild(kioskGuideBtn);

  kioskSection.appendChild(kioskBtnRow);

  const kioskHint = document.createElement("p");
  kioskHint.style.fontSize = "0.78rem";
  kioskHint.style.marginTop = "8px";
  kioskHint.textContent =
    "Hinweis: Das steuert nur den Vollbildmodus dieser Webseite (Fullscreen API). Wurde der Browser richtig im Betriebssystem-Kiosk-Modus gestartet, hilft zum vollständigen Beenden nur ein Neustart des Browsers auf dem Gerät -- siehe „Kiosk-Modus-Anleitung“ oben.";
  kioskSection.appendChild(kioskHint);
  panel.appendChild(kioskSection);

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

  // Erst sofort mit dem lokalen Stand rendern (kein Warten auf den Server,
  // siehe Datei-Kommentar in core/sync.ts), dann im Hintergrund die
  // Server-Sessions ALLER Geraete dazuholen und (nur fuer diese Ansicht,
  // ohne localStorage zu veraendern) zusammenfuehren.
  let currentSessions = getAllSessions();
  renderStatsList(statsList, currentSessions);
  void pullStatsFromServer().then((serverSessions) => {
    if (!serverSessions || serverSessions.length === 0) return;
    currentSessions = mergeSessions(getAllSessions(), serverSessions);
    renderStatsList(statsList, currentSessions);
  });

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn--ghost";
  clearBtn.style.marginTop = "10px";
  clearBtn.style.fontSize = "0.8rem";
  clearBtn.textContent = "Statistik zurücksetzen";
  clearBtn.addEventListener("click", () => {
    clearAllStats();
    void resetStatsOnServer();
    currentSessions = [];
    renderStatsList(statsList, currentSessions);
  });
  panel.appendChild(clearBtn);

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
    void resetHighscoresOnServer();
    highscoreResetBtn.textContent = "Highscores zurückgesetzt.";
    highscoreResetBtn.disabled = true;
  });
  panel.appendChild(highscoreResetBtn);

  // --- Spiele ein-/ausblenden ------------------------------------------
  const gamesTitle = document.createElement("p");
  gamesTitle.style.color = "var(--text-muted)";
  gamesTitle.style.margin = "18px 0 8px";
  gamesTitle.textContent = "Spiele im Hauptmenü:";
  panel.appendChild(gamesTitle);

  const gamesList = document.createElement("div");
  gamesList.style.display = "flex";
  gamesList.style.flexDirection = "column";
  gamesList.style.gap = "6px";
  panel.appendChild(gamesList);

  const checkboxByGameId = new Map<string, HTMLInputElement>();

  for (const game of gameRegistry) {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "10px";
    row.style.padding = "8px 10px";
    row.style.border = "1px solid var(--panel-border)";
    row.style.borderRadius = "var(--radius-sm)";
    row.style.cursor = "pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    // Groesser als der winzige Browser-Standard -- auf einem Touchscreen
    // sonst kaum treffsicher antippbar.
    checkbox.style.width = "20px";
    checkbox.style.height = "20px";
    checkbox.style.flexShrink = "0";
    checkbox.checked = isGameEnabled(game.id);
    checkbox.addEventListener("change", () => {
      setGameEnabled(game.id, checkbox.checked);
    });
    row.appendChild(checkbox);
    checkboxByGameId.set(game.id, checkbox);

    const label = document.createElement("span");
    label.textContent = game.title;
    row.appendChild(label);

    gamesList.appendChild(row);
  }

  // Falls ein anderes Geraet die Sichtbarkeit inzwischen (server-seitig)
  // geaendert hat, hier beim Oeffnen des Admin-Bereichs einmal nachziehen --
  // ohne das wuerde ein versehentliches erneutes Anklicken einer Checkbox
  // den fremden Stand sonst wieder ueberschreiben.
  void pullSettingsFromServer().then((changed) => {
    if (!changed) return;
    for (const [gameId, checkbox] of checkboxByGameId) checkbox.checked = isGameEnabled(gameId);
  });

  const gamesHint = document.createElement("p");
  gamesHint.style.fontSize = "0.78rem";
  gamesHint.style.color = "var(--text-faint)";
  gamesHint.style.marginTop = "6px";
  gamesHint.textContent = "Abgehakte Spiele erscheinen im Hauptmenü. Ausgehakte bleiben erhalten (inkl. Highscores), sind nur ausgeblendet.";
  panel.appendChild(gamesHint);

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
  addCloseCorner(panel, close);
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
  // pre-wrap allein bricht nur an Leerzeichen/Zeilenumbruechen um -- ein
  // einzelnes langes "Wort" ohne Leerzeichen (z. B. eine URL oder wildes
  // Getippe) ragte dadurch weiterhin ueber den Rand hinaus. overflowWrap
  // erzwingt bei Bedarf zusaetzlich einen Umbruch mitten im Wort.
  message.style.overflowWrap = "break-word";
  message.textContent = entry.message;
  row.appendChild(message);

  return row;
}

/**
 * Fuehrt lokale und vom Server geholte Sessions zusammen, OHNE Duplikate
 * doppelt zu zaehlen -- auf genau dem Geraet, das eine Session selbst
 * erzeugt hat, kommt sie sonst zweimal vor (einmal aus localStorage, einmal
 * aus der eigenen, bereits an den Server gepushten Kopie). Sessions haben
 * keine eigene ID (siehe core/stats.ts), daher Duplikat-Erkennung ueber die
 * Kombination aus Inhaltsfeldern, die pro Session eindeutig ist.
 */
function mergeSessions(local: PlaySession[], server: PlaySession[]): PlaySession[] {
  const seen = new Set(local.map((s) => `${s.gameId}|${s.startedAt}|${s.endedAt}|${s.durationMs}`));
  const merged = [...local];
  for (const s of server) {
    const key = `${s.gameId}|${s.startedAt}|${s.endedAt}|${s.durationMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
  }
  return merged;
}

function renderStatsList(container: HTMLElement, sessions: PlaySession[]): void {
  container.innerHTML = "";
  const summaries = summarizeSessions(sessions);

  if (summaries.length === 0) {
    const empty = document.createElement("p");
    empty.style.color = "var(--text-faint)";
    empty.style.fontSize = "0.85rem";
    empty.textContent = "Noch keine Spiele gestartet.";
    container.appendChild(empty);
    return;
  }

  for (const summary of summaries) {
    container.appendChild(buildStatsRow(summary, sessions));
  }
}

function buildStatsRow(summary: GameSummary, sessions: PlaySession[]): HTMLElement {
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
      const gameSessions = filterSessionsForGame(sessions, summary.gameId);
      for (const session of gameSessions) {
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
