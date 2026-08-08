import type { GameEnv, MinigameModule, PointerPoint } from "../../core/Game";
import { theme } from "../../core/theme";
import { icons } from "../../core/icons";
import { showGameIntro } from "../../core/gameIntro";
import { openModal } from "../../core/modal";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { buildMenuButton } from "../../core/menuButton";
import { hopperAnimalCards } from "../../data/hopperAnimals";
import { registerGame } from "../registry";

/**
 * "Mini Metro" -- eigenstaendige Neuentwicklung nach dem Vorbild des
 * gleichnamigen Handyspiels (Haltestellen per Linien verbinden, Passagiere
 * befoerdern, bevor eine Haltestelle ueberfuellt), aber bewusst an dieses
 * Kiosk-Spielesammlung-Format angepasst statt 1:1 uebernommen:
 *
 * - Session-basiert mit Highscore (wie alle anderen Spiele hier) statt
 *   eines echten, ueber Tage laufenden Spielstands -- ein "Tag" im Spiel
 *   ist deshalb ein kurzes, beschleunigtes Zeitintervall (siehe DAY_MS),
 *   keine echte Kalenderzeit.
 * - Bruecken (im Original ein spaeteres Upgrade fuer Fluss-/Wasserquerungen)
 *   sind auf ausdruecklichen Wunsch NICHT enthalten -- diese Karte hat
 *   ohnehin kein Wasserhindernis.
 * - Passagiere sind Hüpftiere (siehe data/hopperAnimals.ts, dasselbe Bildset
 *   wie bei Zug-Spotter/Zug-Memory) mit einem kleinen Formsymbol dran, das
 *   ihr Fahrtziel zeigt -- auf ausdruecklichen Wunsch.
 */

const GAME_ID = "mini-metro";

type StationShape = "circle" | "square" | "triangle";
const SHAPES: StationShape[] = ["circle", "square", "triangle"];

// Sechs klar unterscheidbare Linienfarben aus der bestehenden Palette
// (core/theme.ts) -- mehr braucht dieses kleine Kartenformat nicht, echtes
// Mini Metro haelt Linien ab einer aehnlichen Groessenordnung selbst kaum
// noch auseinander.
const LINE_COLORS = ["#d6242c", "#0059a4", "#1f8a4c", "#e0a800", "#a53a97", "#0f7a86"];
const INITIAL_LINE_SLOTS = 2;
const MAX_LINE_SLOTS = LINE_COLORS.length;

const MAX_STATIONS = 9;
const STATION_RADIUS = 15;
const STATION_SPAWN_INTERVAL_S = 42;
const PASSENGER_SPAWN_INTERVAL_S = 15;
// Ueberfuellt = Game Over, sobald eine Haltestelle MEHR als diese Anzahl
// wartender Passagiere hat (echtes Mini Metro: sechs Punkte plus Toleranz --
// hier bewusst etwas grosszuegiger, da ohne Zwischenstationen/Umsteige-KI
// Wartezeiten schneller entstehen koennen).
const OVERCROWD_LIMIT = 7;

const TRAIN_SPEED_PX_S = 130;
const TRAIN_DWELL_S = 0.55;
const BASE_CAPACITY = 6; // "Loks koennen immer genau sechs Passagiere greifen"
const WAGON_CAPACITY_BONUS = 3;

// Ein "Tag" ist ein kurzes, beschleunigtes Intervall (siehe Datei-Kommentar
// oben) -- sieben Tage pro "Woche", am Wochenwechsel gibt es automatisch
// eine neue Lok plus die Wahl zwischen einer weiteren Linie oder einem
// Waggon.
const DAY_MS = 18_000;
const DAYS_PER_WEEK = 7;

// Das Canvas fuellt (anders als man vermuten koennte) den KOMPLETTEN
// Viewport, nicht nur den Bereich zwischen Kopf-/Fusszeile -- die Zeilen
// selbst sind separate, deckende DOM-Ebenen, die einfach DARueBER liegen
// (siehe core/Router.ts). Ohne ausreichend Rand ragten Haltestellen (vor
// allem das nach oben spitz zulaufende Dreieck) sichtbar unter der
// Kopfzeile hervor bzw. wurden von ihr angeschnitten (gemeldet). --header-h
// ist 86px, --footer-h 78px (style.css) -- die Werte hier liegen bewusst
// deutlich darueber, damit zusaetzlich die eigenen Overlay-Elemente
// (Ressourcen-/Tageszaehler oben, Linienfarb-Spalte rechts, wartende
// Passagiere ueber jeder Haltestelle) sicher Platz haben.
const MARGIN_TOP = 150;
const MARGIN_RIGHT = 90;
const MARGIN_LEFT = 24;
const MARGIN_BOTTOM = 100;
const MIN_STATION_DIST = STATION_RADIUS * 4.2;

const imageCache = new Map<string, HTMLImageElement>();
function getImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}
// Nur eine kleine, bunt gemischte Auswahl als Passagier-Sprites -- mehr
// Abwechslung braucht es bei der kleinen Darstellungsgroesse nicht, welches
// Tier es ist, ist ohnehin nur Deko (das kleine Formsymbol zeigt das Ziel).
const PASSENGER_SPRITES = hopperAnimalCards.slice(0, 8).map((c) => c.image);

let idSeq = 1;
function nextId(): number {
  return idSeq++;
}

interface Passenger {
  id: number;
  destShape: StationShape;
  sprite: string;
}

interface Station {
  id: number;
  shape: StationShape;
  x: number;
  y: number;
  waiting: Passenger[];
}

interface Train {
  fromIdx: number; // Index in line.stationIds, "von" Station des aktuellen Segments
  dir: 1 | -1;
  t: number; // 0..1 Fortschritt zur naechsten Station
  dwell: number; // > 0 = steht gerade an einer Haltestelle
  carrying: Passenger[];
  capacity: number;
}

interface Line {
  color: string;
  stationIds: number[];
  trains: Train[];
  wagons: number;
}

function formatDelivered(value: number): string {
  return value === 1 ? "1 Passagier" : `${value} Passagiere`;
}

function createMiniMetroGame(): MinigameModule {
  let stations: Station[] = [];
  let lines: (Line | null)[] = [];
  let maxLines = INITIAL_LINE_SLOTS;
  let spareLoks = 0;
  let delivered = 0;
  let gameDay = 1;
  let dayTimerS = 0;
  let stationSpawnTimerS = 0;
  let passengerTimers = new Map<number, number>();
  let gameOver = false;
  let started = false;
  let closeIntro: (() => void) | null = null;
  let closeHighscoreModal: (() => void) | null = null;
  let highscoreTimer: ReturnType<typeof setTimeout> | null = null;
  let highscoreBanner: HighscoreBannerHandle;
  let exitGame: () => void = () => {};

  let weeklyModalOpen = false;
  let awaitingWagonPick = false;
  let armedDeleteIndex: number | null = null;
  let armedDeleteTimer: ReturnType<typeof setTimeout> | null = null;

  let activeDrag: { lineIndex: number; fromEnd: "start" | "end" } | null = null;
  // Wird in tick() laufend aktualisiert -- resetGame() (auch vom "Nochmal
  // spielen"-Button aus, ausserhalb von update()) braucht die aktuelle
  // Canvas-Groesse, um die Start-Haltestellen zu platzieren, hat aber
  // selbst kein GameEnv zur Hand.
  let lastSize: { width: number; height: number } = { width: 960, height: 600 };

  let dayLabelEl: HTMLDivElement;
  let deliveredLabelEl: HTMLDivElement;
  let resourceRowEl: HTMLDivElement;
  let sparelokBtn: HTMLButtonElement;
  let lineColumnEl: HTMLDivElement;
  let lineCircles: HTMLButtonElement[] = [];
  let hintEl: HTMLDivElement;
  let gameOverPanel: HTMLDivElement;

  function stationById(id: number): Station {
    return stations.find((s) => s.id === id)!;
  }

  function lineCapacity(line: Line): number {
    return BASE_CAPACITY + line.wagons * WAGON_CAPACITY_BONUS;
  }

  function activeLineCount(): number {
    return lines.filter((l) => l && l.stationIds.length >= 2).length;
  }

  // ------------------------------------------------------------- Haltestellen

  function randomStationPosition(size: { width: number; height: number }): { x: number; y: number } | null {
    const w = size.width - MARGIN_LEFT - MARGIN_RIGHT;
    const h = size.height - MARGIN_TOP - MARGIN_BOTTOM;
    if (w < 40 || h < 40) return null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = MARGIN_LEFT + Math.random() * w;
      const y = MARGIN_TOP + Math.random() * h;
      if (stations.every((s) => Math.hypot(s.x - x, s.y - y) >= MIN_STATION_DIST)) {
        return { x, y };
      }
    }
    return null;
  }

  function spawnStation(size: { width: number; height: number }, shape?: StationShape): void {
    if (stations.length >= MAX_STATIONS) return;
    const pos = randomStationPosition(size);
    if (!pos) return;
    const s: Station = {
      id: nextId(),
      shape: shape ?? SHAPES[Math.floor(Math.random() * SHAPES.length)],
      x: pos.x,
      y: pos.y,
      waiting: [],
    };
    stations.push(s);
    passengerTimers.set(s.id, PASSENGER_SPAWN_INTERVAL_S * (0.5 + Math.random()));
  }

  function spawnPassenger(station: Station): void {
    const options = SHAPES.filter((s) => s !== station.shape);
    const destShape = options[Math.floor(Math.random() * options.length)];
    const sprite = PASSENGER_SPRITES[Math.floor(Math.random() * PASSENGER_SPRITES.length)];
    station.waiting.push({ id: nextId(), destShape, sprite });
    if (station.waiting.length > OVERCROWD_LIMIT) {
      triggerGameOver();
    }
  }

  // ------------------------------------------------------------------ Linien

  function lineReachesShape(line: Line, shape: StationShape): boolean {
    return line.stationIds.some((id) => stationById(id).shape === shape);
  }

  function ensureTrainOnNewLine(line: Line): void {
    if (line.trains.length === 0 && line.stationIds.length >= 2) {
      line.trains.push({ fromIdx: 0, dir: 1, t: 0, dwell: 0, carrying: [], capacity: lineCapacity(line) });
    }
  }

  function findLineIndexAtStation(stationId: number): { lineIndex: number; end: "start" | "end" } | null {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.stationIds.length === 0) continue;
      if (line.stationIds[0] === stationId) return { lineIndex: i, end: "start" };
      if (line.stationIds[line.stationIds.length - 1] === stationId) return { lineIndex: i, end: "end" };
    }
    return null;
  }

  function stationOnAnyLine(stationId: number): boolean {
    return lines.some((l) => l && l.stationIds.includes(stationId));
  }

  function firstFreeLineSlot(): number | null {
    for (let i = 0; i < maxLines; i++) {
      if (!lines[i] || lines[i]!.stationIds.length === 0) return i;
    }
    return null;
  }

  function deleteLine(index: number): void {
    lines[index] = null;
    renderLineColumn();
  }

  // ------------------------------------------------------------------- Zuege

  function stepTrain(line: Line, train: Train, dt: number): void {
    if (train.dwell > 0) {
      train.dwell -= dt;
      return;
    }
    const from = stationById(line.stationIds[train.fromIdx]);
    const toIdx = train.fromIdx + train.dir;
    if (toIdx < 0 || toIdx >= line.stationIds.length) {
      // Endstation erreicht -- umdrehen.
      train.dir = (train.dir * -1) as 1 | -1;
      return;
    }
    const to = stationById(line.stationIds[toIdx]);
    const dist = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    train.t += (TRAIN_SPEED_PX_S * dt) / dist;
    if (train.t >= 1) {
      train.t = 0;
      train.fromIdx = toIdx;
      arriveAtStation(line, train, to);
    }
  }

  function arriveAtStation(line: Line, train: Train, station: Station): void {
    train.dwell = TRAIN_DWELL_S;
    // Erst abladen (Ziel erreicht), dann erst einladen -- macht sofort
    // wieder Platz frei fuer neue Fahrgaeste an derselben Haltestelle.
    const staying: Passenger[] = [];
    for (const p of train.carrying) {
      if (p.destShape === station.shape) {
        delivered += 1;
      } else {
        staying.push(p);
      }
    }
    train.carrying = staying;

    const stillWaiting: Passenger[] = [];
    for (const p of station.waiting) {
      if (train.carrying.length < train.capacity && lineReachesShape(line, p.destShape)) {
        train.carrying.push(p);
      } else {
        stillWaiting.push(p);
      }
    }
    station.waiting = stillWaiting;
    updateCounters();
  }

  // -------------------------------------------------------------- Wochenwahl

  function triggerWeekChange(): void {
    spareLoks += 1;
    weeklyModalOpen = true;
    openModal(
      (panel, close) => {
        const h2 = document.createElement("h2");
        h2.textContent = `Woche geschafft! (Tag ${gameDay})`;
        panel.appendChild(h2);
        const p = document.createElement("p");
        p.textContent = "Es gibt eine neue Lok gratis dazu -- und du darfst zusätzlich wählen:";
        panel.appendChild(p);

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "10px";
        row.style.marginTop = "10px";

        const lineBtn = document.createElement("button");
        lineBtn.type = "button";
        lineBtn.className = "btn btn--accent";
        lineBtn.style.flex = "1";
        lineBtn.textContent = "Neue Linie";
        lineBtn.disabled = maxLines >= MAX_LINE_SLOTS;
        lineBtn.addEventListener("click", () => {
          maxLines = Math.min(MAX_LINE_SLOTS, maxLines + 1);
          renderLineColumn();
          weeklyModalOpen = false;
          close();
        });
        row.appendChild(lineBtn);

        const wagonBtn = document.createElement("button");
        wagonBtn.type = "button";
        wagonBtn.className = "btn";
        wagonBtn.style.flex = "1";
        wagonBtn.textContent = "Waggon";
        wagonBtn.disabled = activeLineCount() === 0;
        wagonBtn.addEventListener("click", () => {
          weeklyModalOpen = false;
          awaitingWagonPick = true;
          updateHint();
          close();
        });
        row.appendChild(wagonBtn);

        panel.appendChild(row);
      },
      { onClose: () => (weeklyModalOpen = false) },
    );
    updateCounters();
  }

  // --------------------------------------------------------------- Overlay UI

  function updateHint(): void {
    if (sparelokArmed) {
      hintEl.textContent = "Tippe eine Linie rechts an, um ihr eine zusätzliche Lok zu geben.";
      hintEl.style.display = "block";
    } else if (awaitingWagonPick) {
      hintEl.textContent = "Tippe eine Linie rechts an, um ihr den Waggon zu geben.";
      hintEl.style.display = "block";
    } else {
      hintEl.style.display = "none";
    }
  }

  function updateCounters(): void {
    dayLabelEl.textContent = `Tag ${((gameDay - 1) % DAYS_PER_WEEK) + 1}/${DAYS_PER_WEEK} · Woche ${Math.ceil(gameDay / DAYS_PER_WEEK)}`;
    deliveredLabelEl.textContent = formatDelivered(delivered);
    sparelokBtn.querySelector(".mm-resource__count")!.textContent = String(spareLoks);
    sparelokBtn.disabled = spareLoks <= 0;
  }

  function renderLineColumn(): void {
    lineColumnEl.innerHTML = "";
    lineCircles = [];
    for (let i = 0; i < maxLines; i++) {
      const line = lines[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mm-line-circle";
      btn.style.setProperty("--mm-line-color", LINE_COLORS[i]);
      const hasStations = !!line && line.stationIds.length > 0;
      btn.classList.toggle("mm-line-circle--empty", !hasStations);
      btn.classList.toggle("mm-line-circle--armed", armedDeleteIndex === i);
      btn.innerHTML = armedDeleteIndex === i ? "✕" : hasStations ? String(line!.wagons > 0 ? `+${line!.wagons}` : "") : "";
      btn.addEventListener("click", () => onLineCircleTap(i));
      lineColumnEl.appendChild(btn);
      lineCircles.push(btn);
    }
  }

  // Zwei Modi warten auf den naechsten Tipp auf eine Linien-Farbkugel:
  // "eine Lok aus dem Vorrat zuweisen" (sparelokArmed) und "Waggon
  // zuweisen" (awaitingWagonPick, siehe Wochenwahl). Beide schliessen sich
  // gegenseitig aus -- das Starten des einen bricht den anderen ab.
  let sparelokArmed = false;

  function onLineCircleTap(index: number): void {
    const line = lines[index];
    if (sparelokArmed) {
      if (line && line.stationIds.length >= 2) {
        spareLoks -= 1;
        line.trains.push({ fromIdx: 0, dir: 1, t: 0, dwell: 0, carrying: [], capacity: lineCapacity(line) });
        sparelokArmed = false;
        updateHint();
        updateCounters();
        renderLineColumn();
      }
      return;
    }
    if (awaitingWagonPick) {
      if (line && line.stationIds.length >= 2) {
        line.wagons += 1;
        for (const t of line.trains) t.capacity = lineCapacity(line);
        awaitingWagonPick = false;
        updateHint();
        renderLineColumn();
      }
      return;
    }
    if (!line || line.stationIds.length === 0) return; // nichts zu loeschen
    if (armedDeleteIndex === index) {
      if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
      armedDeleteIndex = null;
      deleteLine(index);
      return;
    }
    if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
    armedDeleteIndex = index;
    renderLineColumn();
    armedDeleteTimer = setTimeout(() => {
      armedDeleteIndex = null;
      renderLineColumn();
    }, 3000);
  }

  function onSparelokTap(): void {
    if (spareLoks <= 0) return;
    awaitingWagonPick = false;
    sparelokArmed = true;
    updateHint();
  }

  function triggerGameOver(): void {
    if (gameOver) return;
    gameOver = true;
    gameOverPanel.style.display = "flex";
    gameOverPanel.innerHTML = "";

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.3rem";
    title.style.color = theme.danger;
    title.textContent = "Überfüllte Haltestelle!";
    gameOverPanel.appendChild(title);

    const detail = document.createElement("div");
    detail.style.color = "var(--text-muted)";
    detail.style.margin = "6px 0 14px";
    detail.textContent = `${formatDelivered(delivered)} befördert, bevor es zu voll wurde.`;
    gameOverPanel.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", () => resetGame());
    gameOverPanel.appendChild(again);

    const menuBtn = buildMenuButton(exitGame);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";
    gameOverPanel.appendChild(menuBtn);

    const outcome = getHighscoreOutcome(GAME_ID, delivered, "higher-better");
    if (outcome !== "none" && delivered > 0) {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        closeHighscoreModal = promptHighscoreName({
          message: `${formatDelivered(delivered)} befördert — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, delivered, "higher-better"));
          },
        });
      }, 900);
    }
  }

  function resetGame(): void {
    stations = [];
    lines = new Array(MAX_LINE_SLOTS).fill(null);
    maxLines = INITIAL_LINE_SLOTS;
    spareLoks = 0;
    delivered = 0;
    gameDay = 1;
    dayTimerS = 0;
    stationSpawnTimerS = 0;
    passengerTimers = new Map();
    gameOver = false;
    weeklyModalOpen = false;
    awaitingWagonPick = false;
    sparelokArmed = false;
    armedDeleteIndex = null;
    gameOverPanel.style.display = "none";
    // Start = genau eine Haltestelle je Form (Nutzerwunsch) -- lastSize wird
    // in tick() laufend aktualisiert, siehe dort.
    for (const shape of SHAPES) spawnStation(lastSize, shape);
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    renderLineColumn();
    updateHint();
    updateCounters();
  }

  // -------------------------------------------------------------- Zeichnen

  function drawShapeOutline(ctx: CanvasRenderingContext2D, shape: StationShape, x: number, y: number, r: number): void {
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else if (shape === "square") {
      const s = r * 1.6;
      ctx.rect(x - s / 2, y - s / 2, s, s);
    } else {
      const s = r * 1.9;
      ctx.moveTo(x, y - s * 0.62);
      ctx.lineTo(x + s * 0.55, y + s * 0.42);
      ctx.lineTo(x - s * 0.55, y + s * 0.42);
      ctx.closePath();
    }
  }

  function drawStations(ctx: CanvasRenderingContext2D): void {
    for (const s of stations) {
      ctx.fillStyle = theme.panel;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 2.5;
      drawShapeOutline(ctx, s.shape, s.x, s.y, STATION_RADIUS);
      ctx.fill();
      ctx.stroke();

      if (s.waiting.length > 0) {
        const size = 13;
        const totalW = s.waiting.length * (size + 3);
        let px = s.x - totalW / 2;
        const py = s.y - STATION_RADIUS - size - 6;
        for (const p of s.waiting) {
          const img = getImage(p.sprite);
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, px, py, size, size);
          } else {
            ctx.fillStyle = theme.panelAlt;
            ctx.fillRect(px, py, size, size);
          }
          // Kleines weisses Formsymbol unten rechts am Huepftier-Sprite --
          // zeigt das Fahrtziel (siehe drawMiniShapeBadge).
          drawMiniShapeBadge(ctx, p.destShape, px + size - 4, py + size - 4, 5);
          px += size + 3;
        }
      }
    }
  }

  function drawMiniShapeBadge(ctx: CanvasRenderingContext2D, shape: StationShape, x: number, y: number, r: number): void {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.text;
    drawShapeOutline(ctx, shape, x, y, r);
    ctx.fill();
  }

  function drawLines(ctx: CanvasRenderingContext2D): void {
    lines.forEach((line, idx) => {
      if (!line || line.stationIds.length < 2) return;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const offset = (idx - (maxLines - 1) / 2) * 4.5;
      ctx.beginPath();
      for (let i = 0; i < line.stationIds.length; i++) {
        const st = stationById(line.stationIds[i]);
        const prev = i > 0 ? stationById(line.stationIds[i - 1]) : null;
        const next = i < line.stationIds.length - 1 ? stationById(line.stationIds[i + 1]) : null;
        const ref = prev ?? next!;
        const dx = st.x - ref.x;
        const dy = st.y - ref.y;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * offset;
        const oy = (dx / len) * offset;
        if (i === 0) ctx.moveTo(st.x + ox, st.y + oy);
        else ctx.lineTo(st.x + ox, st.y + oy);
      }
      ctx.stroke();
    });
  }

  function drawTrains(ctx: CanvasRenderingContext2D): void {
    for (const line of lines) {
      if (!line || line.stationIds.length < 2) continue;
      for (const train of line.trains) {
        const from = stationById(line.stationIds[train.fromIdx]);
        const toIdx = Math.min(Math.max(train.fromIdx + train.dir, 0), line.stationIds.length - 1);
        const to = stationById(line.stationIds[toIdx]);
        const x = from.x + (to.x - from.x) * train.t;
        const y = from.y + (to.y - from.y) * train.t;

        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = line.color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        const w = 22,
          h = 14;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 4);
        ctx.fill();
        ctx.stroke();
        if (train.carrying.length > 0) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "700 10px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(train.carrying.length), 0, 0);
        }
        ctx.restore();
      }
    }
  }

  function drawDraftLine(ctx: CanvasRenderingContext2D): void {
    if (!activeDrag) return;
    const line = lines[activeDrag.lineIndex];
    if (!line || line.stationIds.length === 0) return;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < line.stationIds.length; i++) {
      const st = stationById(line.stationIds[i]);
      if (i === 0) ctx.moveTo(st.x, st.y);
      else ctx.lineTo(st.x, st.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------------------------------------------------------------- Eingabe

  function stationAt(x: number, y: number): Station | null {
    let best: Station | null = null;
    let bestDist = STATION_RADIUS + 14;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  function handleDown(x: number, y: number): void {
    if (gameOver || weeklyModalOpen) return;
    const station = stationAt(x, y);
    if (!station) return;

    const existing = findLineIndexAtStation(station.id);
    if (existing) {
      activeDrag = { lineIndex: existing.lineIndex, fromEnd: existing.end };
      return;
    }
    if (stationOnAnyLine(station.id)) return; // mittendrin, kein Branching in dieser Version
    const freeSlot = firstFreeLineSlot();
    if (freeSlot === null) return;
    lines[freeSlot] = { color: LINE_COLORS[freeSlot], stationIds: [station.id], trains: [], wagons: 0 };
    activeDrag = { lineIndex: freeSlot, fromEnd: "end" };
    renderLineColumn();
  }

  function handleMove(x: number, y: number): void {
    if (!activeDrag) return;
    const line = lines[activeDrag.lineIndex];
    if (!line) return;
    const station = stationAt(x, y);
    if (!station) return;

    const ids = line.stationIds;
    const atStart = activeDrag.fromEnd === "start";
    const edgeId = atStart ? ids[0] : ids[ids.length - 1];
    const secondId = ids.length >= 2 ? (atStart ? ids[1] : ids[ids.length - 2]) : null;

    if (station.id === edgeId) return;
    if (secondId !== null && station.id === secondId) {
      // Rueckwaerts ueber die vorletzte Station gezogen -- letzte Station
      // wieder entfernen (einfache "Undo per Zurueckziehen"-Geste).
      if (atStart) ids.shift();
      else ids.pop();
      if (ids.length < 2 && lines[activeDrag.lineIndex]!.trains.length > 0) {
        lines[activeDrag.lineIndex]!.trains = [];
      }
      return;
    }
    if (ids.includes(station.id)) return;
    if (atStart) ids.unshift(station.id);
    else ids.push(station.id);
    ensureTrainOnNewLine(line);
    renderLineColumn();
  }

  function handleUp(): void {
    activeDrag = null;
  }

  // ------------------------------------------------------------------- Loop

  function tick(dt: number, size: { width: number; height: number }): void {
    lastSize = size;
    if (!started || gameOver || weeklyModalOpen) return;

    dayTimerS += dt;
    if (dayTimerS >= DAY_MS / 1000) {
      dayTimerS = 0;
      gameDay += 1;
      if ((gameDay - 1) % DAYS_PER_WEEK === 0) {
        triggerWeekChange();
      }
      updateCounters();
    }

    stationSpawnTimerS += dt;
    if (stationSpawnTimerS >= STATION_SPAWN_INTERVAL_S) {
      stationSpawnTimerS = 0;
      spawnStation(size);
    }

    for (const s of stations) {
      const remaining = (passengerTimers.get(s.id) ?? PASSENGER_SPAWN_INTERVAL_S) - dt;
      if (remaining <= 0) {
        spawnPassenger(s);
        passengerTimers.set(s.id, PASSENGER_SPAWN_INTERVAL_S * (0.7 + Math.random() * 0.6));
      } else {
        passengerTimers.set(s.id, remaining);
      }
      if (gameOver) return;
    }

    for (const line of lines) {
      if (!line || line.stationIds.length < 2) continue;
      for (const train of line.trains) stepTrain(line, train, dt);
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      exitGame = env.exit;
      lastSize = env.size;
      for (const src of PASSENGER_SPRITES) getImage(src);
      lines = new Array(MAX_LINE_SLOTS).fill(null);

      const topLeft = document.createElement("div");
      topLeft.className = "mm-panel mm-panel--top-left";
      sparelokBtn = document.createElement("button");
      sparelokBtn.type = "button";
      sparelokBtn.className = "mm-resource";
      sparelokBtn.innerHTML = `<span class="mm-resource__icon">${icons.locomotive}</span><span class="mm-resource__count">0</span>`;
      sparelokBtn.addEventListener("click", () => onSparelokTap());
      topLeft.appendChild(sparelokBtn);
      resourceRowEl = topLeft;
      env.overlay.appendChild(topLeft);

      const topRight = document.createElement("div");
      topRight.className = "mm-panel mm-panel--top-right";
      dayLabelEl = document.createElement("div");
      dayLabelEl.className = "mm-panel__day";
      deliveredLabelEl = document.createElement("div");
      deliveredLabelEl.className = "mm-panel__delivered";
      topRight.append(dayLabelEl, deliveredLabelEl);
      env.overlay.appendChild(topRight);

      lineColumnEl = document.createElement("div");
      lineColumnEl.className = "mm-line-column";
      env.overlay.appendChild(lineColumnEl);

      hintEl = document.createElement("div");
      hintEl.className = "mm-hint";
      hintEl.style.display = "none";
      env.overlay.appendChild(hintEl);

      gameOverPanel = document.createElement("div");
      gameOverPanel.className = "stage-center-panel";
      gameOverPanel.style.display = "none";
      env.overlay.appendChild(gameOverPanel);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatDelivered);
      highscoreBanner.update(getHighscoreBoard(GAME_ID));

      resetGame();

      closeIntro = showGameIntro({
        title: "Mini Metro",
        description: [
          "Verbinde Haltestellen (Kreis/Quadrat/Dreieck) per Ziehen zu Linien",
          "Hüpftiere sind die Passagiere -- das kleine Symbol zeigt ihr Fahrtziel",
          "Läuft eine Haltestelle über, ist die Runde vorbei",
          "Jede Woche gibt's eine neue Lok gratis, plus die Wahl: neue Linie oder Waggon",
        ],
        onStart: () => {
          closeIntro = null;
          started = true;
        },
      });
    },

    update(dt: number, env: GameEnv) {
      tick(dt, env.size);
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);
      if (!started) return;
      drawLines(ctx);
      drawDraftLine(ctx);
      drawTrains(ctx);
      drawStations(ctx);
    },

    onPointerDown(p: PointerPoint) {
      handleDown(p.x, p.y);
    },
    onPointerMove(p: PointerPoint) {
      handleMove(p.x, p.y);
    },
    onPointerUp() {
      handleUp();
    },

    cleanup() {
      if (highscoreTimer) clearTimeout(highscoreTimer);
      highscoreTimer = null;
      closeHighscoreModal?.();
      closeHighscoreModal = null;
      closeIntro?.();
      closeIntro = null;
      if (armedDeleteTimer) clearTimeout(armedDeleteTimer);
      armedDeleteTimer = null;
      highscoreBanner?.destroy();
      resourceRowEl?.remove();
      lineColumnEl?.remove();
      hintEl?.remove();
      gameOverPanel?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Mini Metro",
  subtitle: "Baue ein Streckennetz, bevor es überläuft",
  icon: "metroMap",
  badge: "MM",
  accent: "#0059a4",
  create: createMiniMetroGame,
  highscoreCategories: [{ board: "default", label: "Passagiere", direction: "higher-better", formatValue: formatDelivered }],
});
