import { openModal } from "../core/modal";
import { OnScreenKeyboard } from "../core/OnScreenKeyboard";
import { enterFullscreen, exitFullscreen, isFullscreenActive, exitKioskBrowser } from "../core/kiosk";
import { summarizeSessions, filterSessionsForGame, getAllSessions, clearAllStats, type GameSummary, type PlaySession } from "../core/stats";
import { clearHighscoreBoard, isGameEnabled, setGameEnabled } from "../core/storage";
import { fetchFeedback, markFeedbackRead, deleteFeedback, deleteAllFeedback, countUnread, type FeedbackEntry } from "../core/feedback";
import { setAdminSession, clearAdminSession, getAdminSession } from "../core/adminSession";
import { pullSettingsFromServer, pullStatsFromServer, resetHighscoresOnServer, resetStatsOnServer, checkServerSyncStatus } from "../core/sync";
import { gameRegistry } from "../games/registry";
import { openTouchTest } from "./TouchTest";
import { guardedClick } from "../core/guardedClick";
import {
  isScreensaverEnabled,
  setScreensaverEnabled,
  getScreensaverTimeoutMinutes,
  setScreensaverTimeoutMinutes,
  previewScreensaver,
} from "../core/screensaver";

// Kommt aus .env.local (nie eingecheckt, siehe .env.local.example und
// vite.config.ts) statt hier im Quellcode zu stehen -- der Build bricht
// ohne gesetztes VITE_ADMIN_PASSWORD bewusst ab (siehe vite.config.ts).
// Bewusst weiterhin einfache Client-seitige Pruefung ohne echten Server --
// ein staerkeres Schutzverfahren ist fuer eine spaetere Iteration
// vorgemerkt, siehe README-Abschnitt "Bekannte Grenzen".
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

/**
 * Gegen Mitlesen ueber die Schulter am Kiosk-Automaten (ausdruecklicher
 * Nutzerwunsch): gueltig ist nicht mehr nur das reine Passwort, sondern
 * IMMER das Passwort PLUS die aktuelle Minutenzahl (zweistellig, z. B. um
 * 12:17 Uhr "17") als Suffix -- wer beim Eintippen zuschaut, kennt zwar das
 * Grundpasswort, aber nicht diese sich staendig aendernde Endung, ohne
 * selbst auf die Uhr zu schauen. Bewusst KEIN Hinweis dazu in der UI (siehe
 * Nutzerwunsch: "soll niemand checken ausser mir").
 *
 * Akzeptiert zusaetzlich die VORHERIGE Minute als Kulanz-Fenster: die
 * Eingabe ueber die Bildschirmtastatur dauert ein paar Sekunden, ohne das
 * wuerde ein Minutenwechsel WAEHREND des Tippens zu einer scheinbar
 * falschen Passworteingabe fuehren, obwohl alles korrekt eingetippt wurde.
 */
function currentPasswordSuffixes(): string[] {
  const now = new Date();
  const mm = now.getMinutes();
  const prevMm = (mm + 59) % 60;
  return [String(mm).padStart(2, "0"), String(prevMm).padStart(2, "0")];
}

function isValidAdminPassword(value: string): boolean {
  return currentPasswordSuffixes().some((suffix) => value === `${ADMIN_PASSWORD}${suffix}`);
}

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
 * Zeigt kurz nach einem Element eine Warnung an, wenn eine Server-Aktion
 * (Reset/Loeschen) fehlgeschlagen ist -- vorher wurden solche Fehler still
 * verschluckt (z. B. bei einer abgelaufenen Admin-Sitzung), der Eintrag/
 * Wert stand danach kommentarlos einfach weiter da (gemeldeter Bug). Die
 * rein lokale Aenderung ist davon unabhaengig immer schon wirksam, siehe
 * jeweiligen Aufrufer.
 */
function showServerActionError(afterEl: HTMLElement, message: string): void {
  const warn = document.createElement("p");
  warn.style.fontSize = "0.78rem";
  warn.style.color = "var(--danger)";
  warn.style.fontWeight = "600";
  warn.style.margin = "4px 0 0";
  warn.textContent = message;
  afterEl.insertAdjacentElement("afterend", warn);
  setTimeout(() => warn.remove(), 8000);
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
        `chromium \\
  --kiosk \\
  --user-data-dir=/home/pi/.config/ticketmachine-chromium \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --autoplay-policy=no-user-gesture-required \\
  --password-store=basic \\
  http://localhost:8080`,
      ),
    );
    panel.appendChild(
      paragraph(
        "Beenden dann nur noch per SSH/Tastatur am Gerät selbst, z. B. mit: pkill chromium -- oder bequemer über den Button „Kiosk-Browser jetzt beenden (Notausgang)“ weiter oben in diesem Admin-Bereich, falls der Kiosk bereits läuft und diese Seite gerade selbst im Kiosk angezeigt wird (z. B. bei fehlendem WLAN, wenn SSH nicht erreichbar ist).",
      ),
    );
    panel.appendChild(
      paragraph(
        "Meldet Chromium \"MESA-LOADER: failed to open dri: ... Keine Berechtigung\", fehlt dem Benutzer die Berechtigung fuer die GPU-Geraetedateien (faellt sonst auf langsameres Software-Rendering zurueck): sudo usermod -aG render,video <benutzername>, danach neu starten.",
      ),
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
chromium \\
  --kiosk \\
  --user-data-dir=/home/pi/.config/ticketmachine-chromium \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --autoplay-policy=no-user-gesture-required \\
  --password-store=basic \\
  http://localhost:8080`,
      ),
    );
    panel.appendChild(codeBlock("chmod +x /home/pi/neiphos-ticket-machine/start-kiosk.sh"));
    panel.appendChild(
      paragraph(
        "2) Autostart-Eintrag ~/.config/autostart/ticketmachine-kiosk.desktop anlegen (der Ordner existiert auf einem frischen Pi meist noch nicht):",
      ),
    );
    panel.appendChild(codeBlock("mkdir -p ~/.config/autostart"));
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

/**
 * Zweite Bestaetigung fuer unwiderrufliche Aktionen (Statistik/Highscores
 * zuruecksetzen) -- eigenes Modal MIT erneuter Passworteingabe (nicht nur
 * ein simples "Wirklich?"-Popup), damit ein versehentlicher Doppel-Klick auf
 * den eigentlichen Button allein nichts loeschen kann. Oeffnet ueber dem
 * bestehenden Admin-Home-Modal ein weiteres, schliesst sich danach wieder
 * dorthin zurueck (kein Verlassen des Admin-Bereichs noetig).
 */
function confirmWithPassword(warningText: string, onConfirmed: () => void): void {
  openModal((panel, close) => {
    // Ohne diese Klasse blieb das Panel (und damit die Bildschirmtastatur
    // darin) beim schmaleren Standard-Modal-Panel -- wirkte im Vergleich
    // zur (bewusst breiteren) Login-Tastatur gedraengt (gemeldeter Bug).
    // War modal-panel--wide (720px), jetzt dieselbe responsive Breite wie
    // Admin-Login (siehe dort), damit beide weiterhin exakt gleich aussehen.
    panel.classList.add("modal-panel--keyboard");
    addCloseCorner(panel, close);
    const h2 = document.createElement("h2");
    h2.textContent = "Sicher?";
    const warning = paragraph(warningText);
    warning.style.color = "var(--danger)";
    warning.style.fontWeight = "600";
    const p = document.createElement("p");
    p.textContent = "Zur Bestätigung Admin-Passwort erneut eingeben:";
    const error = document.createElement("div");
    error.className = "field-error";
    panel.append(h2, warning, p, error);

    const kb = new OnScreenKeyboard({
      layout: "alphanumeric",
      maxLength: 32,
      placeholder: "Passwort",
      submitLabel: "Endgültig löschen",
      mask: true,
      extraKeys: true,
      caseToggle: true,
      symbolsToggle: true,
      onSubmit: (value) => {
        if (isValidAdminPassword(value)) {
          close();
          onConfirmed();
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

/**
 * Leichtgewichtige Bestaetigung OHNE erneute Passworteingabe -- fuer
 * Aktionen, die zwar nicht versehentlich ausgeloest werden sollen, aber
 * weder besonders folgenschwer noch schwer rueckgaengig zu machen sind (z. B.
 * einzelnes Feedback loeschen). Fuer wirklich unwiderrufliche Aktionen
 * (Statistik/Highscores komplett zuruecksetzen) siehe stattdessen
 * confirmWithPassword oben.
 */
function confirmSimple(message: string, confirmLabel: string, onConfirmed: () => void): void {
  openModal((panel, close) => {
    addCloseCorner(panel, close);
    const h2 = document.createElement("h2");
    h2.textContent = "Sicher?";
    const p = paragraph(message);
    panel.append(h2, p);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.addEventListener("click", close);
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn--accent";
    confirmBtn.textContent = confirmLabel;
    confirmBtn.addEventListener("click", () => {
      close();
      onConfirmed();
    });
    actions.append(cancelBtn, confirmBtn);
    panel.appendChild(actions);
  });
}

export function openAdminPanel(onClose?: () => void): void {
  openModal((panel, close) => {
    panel.innerHTML = "";
    // War modal-panel--wide (fester 720px-Deckel) -- auf ausdruecklichen
    // Wunsch jetzt dieselbe responsive Breite wie Highscore-/Feedback-
    // Tastatur, siehe .modal-panel--keyboard.
    panel.classList.add("modal-panel--keyboard");
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
      symbolsToggle: true,
      onSubmit: (value) => {
        if (isValidAdminPassword(value)) {
          // Muss VOR renderAdminHome gesetzt werden -- die dortigen
          // Server-Abgleiche (Statistik/Highscore-Reset) haengen fuer die
          // admin-geschuetzten Endpunkte davon ab, siehe core/adminSession.ts.
          // WICHTIG: hier bewusst das REINE ADMIN_PASSWORD speichern, nicht
          // den eingetippten Wert (value) -- der enthaelt noch das
          // Minuten-Suffix (siehe isValidAdminPassword), das der Server bei
          // X-Admin-Password nicht kennt und zurueckweisen wuerde.
          setAdminSession(ADMIN_PASSWORD);
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

function systemAdminHeaders(): HeadersInit {
  const password = getAdminSession();
  return password ? { "X-Admin-Password": password } : {};
}

/**
 * Buendelt Lautstaerke- und WLAN-Steuerung (server/serve.js, wpctl/nmcli)
 * -- beide sind reine Pi-Funktionen, die auf einem normalen Entwicklungs-
 * rechner (npm run dev, kein wpctl/nmcli installiert) ins Leere laufen;
 * beide Unterabschnitte behandeln einen fehlgeschlagenen ersten Ladeversuch
 * deshalb bewusst als "hier nicht verfuegbar" statt als Fehler.
 */
function renderSystemSection(): HTMLDivElement {
  const section = document.createElement("div");
  section.style.margin = "16px 0";
  section.append(renderScreensaverControl(), renderVolumeControl(), renderAudioOutputControl(), renderWifiControl());
  return section;
}

/**
 * Ein einfacher, gemuetlich durchfahrender Zug mit Aufschrift, der nach X
 * Minuten ganz ohne Eingabe erscheint -- reine Geraete-Einstellung
 * (localStorage), kein Server-Sync noetig (siehe core/screensaver.ts).
 */
function renderScreensaverControl(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.marginBottom = "18px";

  const title = document.createElement("p");
  title.style.color = "var(--text-muted)";
  title.style.marginBottom = "8px";
  title.textContent = "Bildschirmschoner:";
  wrap.appendChild(title);

  const enabledRow = document.createElement("label");
  enabledRow.style.display = "flex";
  enabledRow.style.alignItems = "center";
  enabledRow.style.gap = "8px";
  enabledRow.style.marginBottom = "8px";
  enabledRow.style.cursor = "pointer";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isScreensaverEnabled();
  checkbox.style.width = "20px";
  checkbox.style.height = "20px";

  const enabledLabel = document.createElement("span");
  enabledLabel.textContent = "Aktiviert";

  enabledRow.append(checkbox, enabledLabel);
  wrap.appendChild(enabledRow);

  const timeoutRow = document.createElement("div");
  timeoutRow.style.display = "flex";
  timeoutRow.style.alignItems = "center";
  timeoutRow.style.gap = "8px";

  const timeoutLabel = document.createElement("span");
  timeoutLabel.textContent = "Erscheint nach";
  timeoutLabel.style.fontSize = "0.85rem";

  const timeoutInput = document.createElement("input");
  timeoutInput.type = "number";
  timeoutInput.min = "1";
  timeoutInput.max = "120";
  timeoutInput.step = "1";
  timeoutInput.value = String(getScreensaverTimeoutMinutes());
  timeoutInput.style.width = "4.5em";
  timeoutInput.disabled = !checkbox.checked;

  const timeoutUnit = document.createElement("span");
  timeoutUnit.textContent = "Min. Inaktivität";
  timeoutUnit.style.fontSize = "0.85rem";

  timeoutRow.append(timeoutLabel, timeoutInput, timeoutUnit);
  wrap.appendChild(timeoutRow);

  // Zum bequemen Testen/Design-Abnehmen, ohne die Inaktivitaetszeit
  // abwarten zu muessen -- zeigt ihn sofort, unabhaengig von der
  // An/Aus-Einstellung oben (siehe core/screensaver.ts#previewScreensaver).
  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "btn btn--ghost";
  previewBtn.style.marginTop = "8px";
  previewBtn.style.fontSize = "0.8rem";
  previewBtn.textContent = "Bildschirmschoner jetzt aktivieren";
  guardedClick(previewBtn, () => previewScreensaver());
  wrap.appendChild(previewBtn);

  checkbox.addEventListener("change", () => {
    setScreensaverEnabled(checkbox.checked);
    timeoutInput.disabled = !checkbox.checked;
  });

  timeoutInput.addEventListener("change", () => {
    const minutes = Number(timeoutInput.value);
    if (!Number.isFinite(minutes) || minutes < 1) {
      timeoutInput.value = String(getScreensaverTimeoutMinutes());
      return;
    }
    setScreensaverTimeoutMinutes(minutes);
    timeoutInput.value = String(getScreensaverTimeoutMinutes());
  });

  return wrap;
}

function renderVolumeControl(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.marginBottom = "18px";

  const title = document.createElement("p");
  title.style.color = "var(--text-muted)";
  title.style.marginBottom = "8px";
  title.textContent = "Betriebssystem-Lautstärke:";
  wrap.appendChild(title);

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "12px";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.style.flex = "1";
  slider.disabled = true;

  const valueLabel = document.createElement("span");
  valueLabel.style.fontFamily = "var(--font-display)";
  valueLabel.style.fontWeight = "700";
  valueLabel.style.minWidth = "3.2em";
  valueLabel.style.textAlign = "right";
  valueLabel.textContent = "…";

  row.append(slider, valueLabel);
  wrap.appendChild(row);

  const status = document.createElement("p");
  status.style.fontSize = "0.76rem";
  status.style.color = "var(--text-faint)";
  status.style.margin = "4px 0 0";
  wrap.appendChild(status);

  fetch("./api/system/volume", { headers: systemAdminHeaders() })
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((data: { volume: number; muted: boolean }) => {
      slider.disabled = false;
      slider.value = String(Math.round(data.volume * 100));
      valueLabel.textContent = `${Math.round(data.volume * 100)}%${data.muted ? " 🔇" : ""}`;
    })
    .catch(() => {
      status.textContent = "Nicht verfügbar (läuft das gerade auf einem echten Pi mit server/serve.js?).";
      valueLabel.textContent = "–";
    });

  // Debounce: waehrend des Ziehens am Regler nicht bei JEDEM Pixel einen
  // eigenen wpctl-Aufruf ausloesen, sondern erst kurz nach der letzten
  // Bewegung.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  slider.addEventListener("input", () => {
    const pct = Number(slider.value);
    valueLabel.textContent = `${pct}%`;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void fetch("./api/system/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...systemAdminHeaders() },
        body: JSON.stringify({ volume: pct / 100 }),
      }).then((res) => {
        if (!res.ok) status.textContent = "Konnte Lautstärke nicht ändern.";
      });
    }, 200);
  });

  return wrap;
}

/**
 * Umschalten zwischen den auf diesem Geraet vorhandenen PipeWire-Audio-
 * Ausgaengen (z. B. Klinke vs. HDMI) -- gemeldeter Fall: Ton lief bisher nur
 * ueber die Klinke, HDMI-Ton war ueber das Betriebssystem zwar moeglich,
 * aber ohne diesen Schalter nur per Konsole erreichbar.
 */
function renderAudioOutputControl(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.marginBottom = "18px";

  const titleRow = document.createElement("div");
  titleRow.style.display = "flex";
  titleRow.style.alignItems = "center";
  titleRow.style.justifyContent = "space-between";
  titleRow.style.gap = "8px";
  titleRow.style.marginBottom = "8px";

  const title = document.createElement("p");
  title.style.color = "var(--text-muted)";
  title.style.margin = "0";
  title.textContent = "Audioausgabe:";
  titleRow.appendChild(title);

  // Gemeldeter Fall: ein HDMI-Bildschirm (mit eigenem Audioausgang) wurde
  // erst NACH dem Hochfahren des Pi angeschlossen -- PipeWire/WirePlumber
  // erkennt neue Sinks meist automatisch, ohne Neustart aber nicht
  // zuverlaessig in jedem Fall. Deshalb explizit manuell neu abrufbar,
  // statt nur beim (Wieder-)Oeffnen des Admin-Bereichs.
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "btn btn--ghost";
  refreshBtn.style.fontSize = "0.76rem";
  refreshBtn.style.padding = "4px 10px";
  refreshBtn.textContent = "Aktualisieren";
  titleRow.appendChild(refreshBtn);

  wrap.appendChild(titleRow);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "6px";
  wrap.appendChild(list);

  const status = document.createElement("p");
  status.style.fontSize = "0.76rem";
  status.style.color = "var(--text-faint)";
  status.style.margin = "4px 0 0";
  wrap.appendChild(status);

  function renderOutputs(outputs: Array<{ id: number; name: string; active: boolean }>): void {
    list.innerHTML = "";
    status.textContent = "";
    if (outputs.length === 0) {
      status.textContent = "Keine Audiogeräte gefunden.";
      return;
    }
    for (const output of outputs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--ghost";
      btn.style.width = "100%";
      btn.style.justifyContent = "flex-start";
      btn.style.fontSize = "0.82rem";
      btn.textContent = `${output.active ? "✅ " : ""}${output.name}`;
      guardedClick(btn, () => {
        if (output.active) return;
        btn.disabled = true;
        fetch("./api/system/audio/output", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...systemAdminHeaders() },
          body: JSON.stringify({ id: output.id }),
        })
          .then((res) => {
            if (!res.ok) status.textContent = "Konnte Audioausgabe nicht ändern.";
            refresh();
          })
          .finally(() => {
            btn.disabled = false;
          });
      });
      list.appendChild(btn);
    }
  }

  function refresh(): Promise<void> {
    list.innerHTML = "";
    return fetch("./api/system/audio/outputs", { headers: systemAdminHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { outputs: Array<{ id: number; name: string; active: boolean }> }) => renderOutputs(data.outputs))
      .catch(() => {
        status.textContent = "Nicht verfügbar (läuft das gerade auf einem echten Pi mit server/serve.js?).";
      });
  }
  refresh();

  // Gemeldeter Fall: ein HDMI-Bildschirm (mit eigenem Audioausgang) wurde
  // erst NACH dem Hochfahren angeschlossen und blieb dauerhaft unsichtbar,
  // auch nach mehrfachem Klick auf "Aktualisieren" (das vorher nur erneut
  // "wpctl status" abfragte). Ursache: WirePlumber scannt die ALSA-Karten
  // nur einmalig beim eigenen Start -- der Button loest deshalb jetzt einen
  // WirePlumber-Neustart aus (POST /api/system/audio/rescan, server/
  // serve.js), erst DANACH liefert "wpctl status" auch die HDMI-Ausgabe.
  guardedClick(refreshBtn, () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Suche läuft …";
    list.innerHTML = "";
    status.textContent = "";
    fetch("./api/system/audio/rescan", { method: "POST", headers: systemAdminHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { outputs: Array<{ id: number; name: string; active: boolean }> }) => renderOutputs(data.outputs))
      .catch(() => {
        status.textContent = "Nicht verfügbar (läuft das gerade auf einem echten Pi mit server/serve.js?).";
      })
      .finally(() => {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Aktualisieren";
      });
  });

  return wrap;
}

function renderWifiControl(): HTMLDivElement {
  const wrap = document.createElement("div");

  const title = document.createElement("p");
  title.style.color = "var(--text-muted)";
  title.style.marginBottom = "8px";
  title.textContent = "WLAN:";
  wrap.appendChild(title);

  const status = document.createElement("p");
  status.style.fontWeight = "600";
  status.style.margin = "0 0 8px";
  status.textContent = "Status wird geprüft …";
  wrap.appendChild(status);

  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";
  btnRow.style.flexWrap = "wrap";

  const scanBtn = document.createElement("button");
  scanBtn.type = "button";
  scanBtn.className = "btn btn--ghost";
  scanBtn.style.fontSize = "0.8rem";
  scanBtn.textContent = "Netzwerke suchen";
  btnRow.appendChild(scanBtn);

  const disconnectBtn = document.createElement("button");
  disconnectBtn.type = "button";
  disconnectBtn.className = "btn btn--ghost";
  disconnectBtn.style.fontSize = "0.8rem";
  disconnectBtn.style.display = "none";
  disconnectBtn.textContent = "Trennen";
  btnRow.appendChild(disconnectBtn);

  wrap.appendChild(btnRow);

  function refreshStatus(): void {
    fetch("./api/system/wifi/status", { headers: systemAdminHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { available: boolean; connected: boolean; ssid: string | null }) => {
        if (!data.available) {
          status.textContent = "Kein WLAN-Gerät gefunden.";
          status.style.color = "var(--text-muted)";
          scanBtn.style.display = "none";
          return;
        }
        if (data.connected) {
          status.textContent = `✅ Verbunden mit „${data.ssid}“`;
          status.style.color = "var(--success)";
          disconnectBtn.style.display = "inline-flex";
        } else {
          status.textContent = "Nicht verbunden.";
          status.style.color = "var(--text-muted)";
          disconnectBtn.style.display = "none";
        }
      })
      .catch(() => {
        status.textContent = "Nicht verfügbar (läuft das gerade auf einem echten Pi mit server/serve.js?).";
        status.style.color = "var(--text-muted)";
        scanBtn.style.display = "none";
      });
  }
  refreshStatus();

  // guardedClick statt addEventListener("click", ...): ein WLAN-Scan stoesst
  // serverseitig einen "nmcli ... --rescan yes"-Aufruf an (bis zu 15s
  // Timeout) -- mehrere gleichzeitig laufende Scans durch Spam auf diesen
  // Button ueberlasteten die schwache Pi-Hardware spuerbar (gemeldeter Bug,
  // siehe core/guardedClick.ts).
  guardedClick(scanBtn, () => {
    scanBtn.disabled = true;
    scanBtn.textContent = "Suche läuft …";
    fetch("./api/system/wifi/scan", { headers: systemAdminHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { networks: Array<{ ssid: string; signal: number; secured: boolean; inUse: boolean; known: boolean }> }) => {
        openWifiNetworksModal(data.networks, refreshStatus);
      })
      .catch(() => {
        showServerActionError(btnRow, "Suche fehlgeschlagen.");
      })
      .finally(() => {
        scanBtn.disabled = false;
        scanBtn.textContent = "Netzwerke suchen";
      });
  });

  guardedClick(disconnectBtn, () => {
    disconnectBtn.disabled = true;
    fetch("./api/system/wifi/disconnect", { method: "POST", headers: systemAdminHeaders() })
      .then((res) => {
        if (!res.ok) showServerActionError(btnRow, "Trennen fehlgeschlagen.");
        refreshStatus();
      })
      .finally(() => {
        disconnectBtn.disabled = false;
      });
  });

  return wrap;
}

function connectWifi(ssid: string, password: string, status: HTMLElement, onDone: () => void, onFailed?: () => void): void {
  status.textContent = `Verbinde mit „${ssid}“ …`;
  status.style.color = "var(--text-muted)";
  fetch("./api/system/wifi/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...systemAdminHeaders() },
    body: JSON.stringify({ ssid, password }),
  })
    .then((res) => res.json().catch(() => ({})))
    .then((data: { ok?: boolean; error?: string }) => {
      if (!data.ok) {
        if (onFailed) {
          onFailed();
          return;
        }
        status.textContent = `❌ Verbindung zu „${ssid}“ fehlgeschlagen${data.error ? ` (${data.error})` : ""}.`;
        status.style.color = "var(--danger)";
        return;
      }
      onDone();
    })
    .catch(() => {
      if (onFailed) {
        onFailed();
        return;
      }
      status.textContent = "Verbindung fehlgeschlagen.";
      status.style.color = "var(--danger)";
    });
}

/**
 * Eigenes Unterfenster fuer die Scan-Ergebnisse -- vorher wuchs die Liste
 * direkt im Admin-Bereich nach unten mit, was den ohnehin schon vollen
 * Bildschirm bei vielen gefundenen Netzwerken regelrecht sprengte
 * (gemeldet). Mit explizitem Zurueck-Button (zusaetzlich zum X oben rechts,
 * wie bei den anderen Admin-Unterfenstern auch, siehe addCloseCorner).
 */
function openWifiNetworksModal(
  networks: Array<{ ssid: string; signal: number; secured: boolean; inUse: boolean; known: boolean }>,
  onConnected: () => void,
): void {
  openModal((panel, close) => {
    addCloseCorner(panel, close);
    const h2 = document.createElement("h2");
    h2.textContent = "WLAN-Netzwerke";
    panel.appendChild(h2);

    const modalStatus = document.createElement("p");
    modalStatus.style.fontSize = "0.82rem";
    modalStatus.style.minHeight = "1.2em";
    panel.appendChild(modalStatus);

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    list.style.maxHeight = "50vh";
    list.style.overflowY = "auto";
    panel.appendChild(list);

    if (networks.length === 0) {
      const empty = document.createElement("p");
      empty.style.fontSize = "0.78rem";
      empty.style.color = "var(--text-faint)";
      empty.textContent = "Keine Netzwerke gefunden.";
      list.appendChild(empty);
    }
    for (const net of networks) {
      const netBtn = document.createElement("button");
      netBtn.type = "button";
      netBtn.className = "btn btn--ghost";
      netBtn.style.width = "100%";
      netBtn.style.justifyContent = "space-between";
      netBtn.style.fontSize = "0.82rem";
      const lock = net.secured ? "🔒 " : "";
      const marker = net.inUse ? " (aktuell)" : net.known ? " (bekannt)" : "";
      netBtn.textContent = `${lock}${net.ssid}${marker} — ${net.signal}%`;
      guardedClick(netBtn, () => {
        if (net.inUse) return;
        if (net.secured && !net.known) {
          promptWifiPassword(net.ssid, (password) => connectWifi(net.ssid, password, modalStatus, onConnected));
          return;
        }
        // Bekanntes Netzwerk: nmcli hat bereits ein gespeichertes Profil
        // mit Zugangsdaten -- ohne Passwort verbinden aktiviert dieses
        // automatisch (siehe server/serve.js#getKnownWifiSsids). Klappt
        // das bei einem gesicherten Netzwerk ausnahmsweise nicht (z. B.
        // Passwort beim Access Point zwischenzeitlich geaendert), als
        // Fallback ganz normal danach fragen statt nur eine
        // Fehlermeldung anzuzeigen. Bei offenen Netzwerken gibt es kein
        // sinnvolles Fallback -- dort wie gehabt die Fehlermeldung zeigen.
        connectWifi(
          net.ssid,
          "",
          modalStatus,
          onConnected,
          net.secured ? () => promptWifiPassword(net.ssid, (password) => connectWifi(net.ssid, password, modalStatus, onConnected)) : undefined,
        );
      });
      list.appendChild(netBtn);
    }

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn btn--accent";
    backBtn.style.width = "100%";
    backBtn.style.marginTop = "14px";
    backBtn.textContent = "Zurück";
    backBtn.addEventListener("click", close);
    panel.appendChild(backBtn);
  });
}

/** Kleiner eigener Passwort-Dialog fuer eine gesicherte WLAN-Verbindung -- dieselbe Bildschirmtastatur wie ueberall sonst, aber ohne Admin-Bezug (das ist ja bereits das WLAN-Passwort, nicht das App-Admin-Passwort). */
function promptWifiPassword(ssid: string, onSubmit: (password: string) => void): void {
  openModal(
    (panel, close) => {
      const h2 = document.createElement("h2");
      h2.textContent = `WLAN-Passwort für „${ssid}“`;
      panel.appendChild(h2);

      const kb = new OnScreenKeyboard({
        layout: "alphanumeric",
        maxLength: 63,
        placeholder: "WLAN-Passwort",
        submitLabel: "Verbinden",
        mask: true,
        extraKeys: true,
        caseToggle: true,
        symbolsToggle: true,
        onSubmit: (value) => {
          close();
          onSubmit(value);
        },
      });
      kb.mount(panel);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn--ghost";
      cancelBtn.style.width = "100%";
      cancelBtn.style.marginTop = "8px";
      cancelBtn.textContent = "Abbrechen";
      cancelBtn.addEventListener("click", close);
      panel.appendChild(cancelBtn);
    },
    { keyboard: true },
  );
}

function renderAdminHome(panel: HTMLDivElement, close: () => void): void {
  panel.innerHTML = "";
  panel.classList.add("modal-panel--wide");
  addCloseCorner(panel, close);

  const h2 = document.createElement("h2");
  h2.textContent = "Admin-Bereich";
  panel.appendChild(h2);

  // --- Sync-Status ---------------------------------------------------
  // Direkt unter der Ueberschrift (war frueher ganz unten, auf
  // ausdruecklichen Wunsch nach oben geholt -- man will als erstes sehen,
  // ob der Server gerade ueberhaupt erreichbar ist, bevor man sich durch
  // die einzelnen Abschnitte scrollt, die alle davon abhaengen). Nur eine
  // Anzeige, kein Ablauf haengt hiervon ab -- die einzelnen Abschnitte
  // unten pruefen/pushen unabhaengig davon selbst (siehe core/sync.ts).
  // Unterscheidet bewusst DREI Faelle (nicht nur an/aus), damit auf einen
  // Blick klar ist, WARUM die Sync ggf. nicht laeuft -- "laeuft gerade nur
  // lokal" (kein server/serve.js erreichbar, z. B. beim Entwickeln mit npm
  // run dev) sieht ganz anders aus als "server/serve.js laeuft zwar, aber
  // NTM_SYNC ist dort nicht gesetzt" (siehe
  // core/sync.ts#checkServerSyncStatus).
  const syncStatus = paragraph("Sync-Status: wird geprüft …");
  syncStatus.style.fontSize = "0.78rem";
  syncStatus.style.fontWeight = "600";
  syncStatus.style.padding = "6px 10px";
  syncStatus.style.margin = "10px 0 0";
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
      syncStatus.textContent =
        "✅ Server erreichbar, geräteübergreifende Synchronisation aktiv — Highscores/Statistik/Einstellungen/Feedback werden geteilt. Löschen/Zurücksetzen wirkt zentral, auch auf anderen Geräten (spätestens bei deren nächstem Menübesuch).";
      syncStatus.style.color = "var(--success)";
    }
  });

  // Reihenfolge der folgenden Abschnitte auf ausdruecklichen Wunsch so
  // festgelegt (haeufigste/wichtigste Admin-Aufgaben zuerst): Feedback,
  // Statistik, Highscores, Spiele-Sichtbarkeit, System (Bildschirmschoner/
  // Lautstaerke/Audioausgabe/WLAN), Kiosk-Modus, Rest (Touchscreen-Test).

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
    confirmWithPassword(
      "Löscht unwiderruflich die gesamte Spielstatistik (alle Sitzungen, aller Spiele) -- lokal und, falls Synchronisation aktiv ist, auch auf dem Server.",
      () => {
        clearAllStats();
        currentSessions = [];
        renderStatsList(statsList, currentSessions);
        void resetStatsOnServer().then((ok) => {
          if (!ok) showServerActionError(statsList, "Auf dem Server konnte die Statistik nicht zurückgesetzt werden (z. B. abgelaufene Admin-Sitzung) -- lokal ist sie trotzdem geleert. Bitte Admin-Bereich neu öffnen und erneut versuchen.");
        });
      },
    );
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
    confirmWithPassword(
      "Löscht unwiderruflich ALLE Highscores (aller Spiele, aller Spielfeldgrößen) -- lokal und, falls Synchronisation aktiv ist, auch auf dem Server.",
      () => {
        for (const game of gameRegistry) {
          for (const category of game.highscoreCategories ?? []) {
            clearHighscoreBoard(game.id, category.board);
          }
        }
        highscoreResetBtn.textContent = "Highscores zurückgesetzt.";
        highscoreResetBtn.disabled = true;
        void resetHighscoresOnServer().then((ok) => {
          if (!ok) showServerActionError(highscoreResetBtn, "Auf dem Server konnten die Highscores nicht zurückgesetzt werden (z. B. abgelaufene Admin-Sitzung) -- lokal sind sie trotzdem geleert. Bitte Admin-Bereich neu öffnen und erneut versuchen.");
        });
      },
    );
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

  // --- System: Bildschirmschoner + Lautstaerke + Audioausgabe + WLAN ---
  // Steuert die ECHTE Betriebssystem-Lautstaerke/WLAN-Verbindung/Audio-
  // ausgabe des Pi (server/serve.js, wpctl/nmcli) -- auf ausdruecklichen
  // Wunsch, damit man dafuer nicht extra den Kiosk-Modus verlassen muss.
  // Ausserhalb des Pi (z. B. npm run dev auf einem normalen
  // Entwicklungsrechner ohne wpctl/nmcli) blenden sich die betroffenen
  // Abschnitte automatisch als "nicht verfuegbar" aus, statt kaputt
  // auszusehen.
  panel.appendChild(renderSystemSection());

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
    "Hinweis: Das steuert nur den Vollbildmodus dieser Webseite (Fullscreen API), nicht den echten Betriebssystem-Kiosk-Modus des Browsers (--kiosk) -- eine Webseite kann grundsätzlich nicht zuverlässig erkennen, ob der Browser darin gerade läuft.";
  kioskSection.appendChild(kioskHint);

  // --- Kiosk-Notausgang ------------------------------------------------
  // Getrennt vom obigen Umschalter (siehe Hinweistext dort): beendet den
  // echten --kiosk-Chromium-Prozess auf DIESEM Geraet ueber den lokalen
  // Server (server/serve.js, core/kiosk.ts#exitKioskBrowser) -- z. B. fuer
  // den Notfall, dass ohne funktionierendes WLAN weder SSH noch ein anderer
  // Fernzugriff moeglich ist, der darunterliegende Desktop (fuer WLAN-
  // Neueinrichtung etc.) aber erreichbar sein muss.
  const exitBtn = document.createElement("button");
  exitBtn.type = "button";
  exitBtn.className = "btn btn--ghost";
  exitBtn.style.marginTop = "8px";
  exitBtn.textContent = "Kiosk-Browser jetzt beenden (Notausgang)";
  exitBtn.addEventListener("click", () => {
    confirmSimple(
      "Beendet den Kiosk-Browser auf diesem Gerät sofort und startet den echten Raspberry-Pi-Desktop (Taskleiste mit Startmenü/Netzwerk-Applet, Dateimanager mit Desktop-Icons) -- plus ein kleines Fenster mit Countdown (verlängerbar, oder sofort zurück in den Kiosk) und Schnellzugriff-Buttons für Terminal/Dateimanager. Funktioniert nur, wenn der lokale Server (server/serve.js) läuft.",
      "Ja, Kiosk beenden",
      () => {
        exitBtn.disabled = true;
        exitBtn.textContent = "Wird beendet …";
        void exitKioskBrowser().then(({ ok, killed }) => {
          // Hat killed wirklich geklappt, beendet sich diese Seite gleich
          // von selbst mit -- der Code hier laeuft dann meist gar nicht
          // mehr zu Ende. Kommt trotzdem eine Antwort an (kein Server, kein
          // passender Prozess gefunden), bekommt die Admin-Person jetzt
          // eine erklaerende Meldung STATT dass der Button (wie zuvor)
          // unbegrenzt bei "Wird beendet..." haengen bleibt, ohne dass
          // jemals etwas passiert (gemeldeter Bug -- die Antwort wurde
          // vorher client-seitig ueberhaupt nicht ausgewertet).
          exitBtn.disabled = false;
          exitBtn.textContent = "Kiosk-Browser jetzt beenden (Notausgang)";
          if (!ok) {
            showServerActionError(exitBtn, "Kein Server erreichbar oder Admin-Sitzung ungültig -- läuft server/serve.js? Bitte Admin-Bereich neu öffnen und erneut versuchen.");
          } else if (!killed) {
            showServerActionError(exitBtn, "Es wurde kein laufender Kiosk-Chromium-Prozess gefunden -- läuft der Kiosk gerade wirklich über --user-data-dir=.../ticketmachine-chromium (siehe Kiosk-Modus-Anleitung)?");
          }
        });
      },
    );
  });
  kioskSection.appendChild(exitBtn);

  panel.appendChild(kioskSection);

  // --- Touchscreen-Test ------------------------------------------------
  // Gedacht fuer den allerersten Anschluss eines neuen Touch-Displays
  // (Anlass: Verdacht auf eine tote Zone) -- kein alltaeglicher Admin-
  // Vorgang, daher auf ausdruecklichen Wunsch weiter unten (siehe
  // Reihenfolge-Kommentar oben).
  const touchTestBtn = document.createElement("button");
  touchTestBtn.type = "button";
  touchTestBtn.className = "btn btn--ghost";
  touchTestBtn.style.margin = "18px 0 0";
  touchTestBtn.textContent = "Touchscreen-Test";
  guardedClick(touchTestBtn, () => openTouchTest());
  panel.appendChild(touchTestBtn);

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

  const clearAllBtn = document.createElement("button");
  clearAllBtn.type = "button";
  clearAllBtn.className = "btn btn--ghost";
  clearAllBtn.style.fontSize = "0.8rem";
  clearAllBtn.style.marginBottom = "10px";
  clearAllBtn.textContent = "Alles Feedback löschen";
  clearAllBtn.addEventListener("click", () => {
    confirmWithPassword(
      "Löscht unwiderruflich ALLE Feedback-Einträge -- lokal und, falls erreichbar, auch auf dem Server.",
      () => {
        void deleteAllFeedback().then((ok) => {
          load();
          if (!ok) showServerActionError(clearAllBtn, "Auf dem Server konnte das Feedback nicht vollständig gelöscht werden (z. B. abgelaufene Admin-Sitzung) -- lokal ist es trotzdem geleert. Bitte Admin-Bereich neu öffnen und erneut versuchen.");
        });
      },
    );
  });
  panel.appendChild(clearAllBtn);

  const backActions = document.createElement("div");
  backActions.className = "modal-actions";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "btn";
  backBtn.textContent = "Zurück";
  backBtn.addEventListener("click", () => renderAdminHome(panel, close));
  backActions.appendChild(backBtn);
  panel.appendChild(backActions);

  function load(): void {
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
        list.appendChild(
          buildFeedbackRow(entry, unreadIds.has(entry.id), () => {
            confirmSimple("Diesen Feedback-Eintrag löschen?", "Ja, löschen", () => {
              void deleteFeedback(entry).then((ok) => {
                load();
                if (!ok) showServerActionError(list, "Auf dem Server konnte dieser Eintrag nicht gelöscht werden (z. B. abgelaufene Admin-Sitzung) -- er taucht deshalb weiterhin auf. Bitte Admin-Bereich neu öffnen und erneut versuchen.");
              });
            });
          }),
        );
      }

      // Sobald das Feedback angeschaut wurde, gilt es als gelesen.
      for (const entry of entries) {
        if (!entry.read) void markFeedbackRead(entry);
      }
    });
  }
  load();
}

function buildFeedbackRow(entry: FeedbackEntry, wasUnread: boolean, onDelete: () => void): HTMLElement {
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
  head.style.gap = "8px";

  const dateGroup = document.createElement("span");
  dateGroup.style.display = "inline-flex";
  dateGroup.style.alignItems = "center";
  dateGroup.style.gap = "6px";

  const date = document.createElement("span");
  date.style.fontSize = "0.75rem";
  date.style.color = "var(--text-faint)";
  date.textContent = formatDateTime(entry.createdAt) + (entry.id.startsWith("local-") ? " · nur lokal" : "");
  dateGroup.appendChild(date);

  if (wasUnread) {
    const badge = document.createElement("span");
    badge.style.fontSize = "0.68rem";
    badge.style.fontWeight = "700";
    badge.style.color = "var(--accent)";
    badge.textContent = "NEU";
    dateGroup.appendChild(badge);
  }
  head.appendChild(dateGroup);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--ghost";
  deleteBtn.style.fontSize = "0.72rem";
  deleteBtn.style.padding = "3px 9px";
  deleteBtn.textContent = "Löschen";
  deleteBtn.addEventListener("click", onDelete);
  head.appendChild(deleteBtn);

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
