import type { GameEnv, MinigameModule, PointerPoint } from "../../core/Game";
import { theme } from "../../core/theme";
import {
  cityName,
  neighborsOf,
  randomStartCity,
  bearingBetween,
  FESTIVAL_CITY_ID,
  RAIL_CITIES,
  RAIL_EDGES,
  type RailEdge,
} from "../../data/germanRailNetwork";
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
const BOARD = "breddin";
const HIGHSCORE_POPUP_DELAY_MS = 1000; // vorher 2000 -- auf ausdruecklichen Wunsch kuerzer
const SPEED_KM_S = 45;

type Phase = "choosing" | "traveling" | "finished";

function formatLegCount(value: number): string {
  return value === 1 ? "1 Zug" : `${value} Züge`;
}

// ---------------------------------------------------------------- Netzkarte
// Einfache aequirechteckige Projektion (Laengengrad-Stauchung anhand der
// mittleren Breite Deutschlands) -- fuer eine grobe Uebersichtskarte reicht
// das, exakte Kartografie ist hier nicht das Ziel (siehe auch bearingBetween
// oben, die fuer die Fahrt-Animation die echte Peilung berechnet).
const LAT_REF = 51;
const LON_SCALE = Math.cos((LAT_REF * Math.PI) / 180);

interface WorldPos {
  x: number;
  y: number;
}

const cityWorldPos = new Map<string, WorldPos>();
for (const city of RAIL_CITIES) {
  // Norden = oben im Bild, daher -lat (Canvas-Y waechst nach unten).
  cityWorldPos.set(city.id, { x: city.lon * LON_SCALE, y: -city.lat });
}

const NETWORK_BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pos of cityWorldPos.values()) {
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
  }
  return { width: maxX - minX, height: maxY - minY };
})();

interface Camera {
  cx: number;
  cy: number;
  zoom: number;
}

interface MapRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const MAP_INNER_PAD = 44;
const MAX_ZOOM = 260;
const TAP_MOVE_TOLERANCE = 12;
const TAP_HIT_RADIUS = 28;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Zoomstufe, bei der das GESAMTE Netz gerade so in rect passt -- weiter kann man nicht rauszoomen. */
function minZoomFor(rect: MapRect): number {
  const availW = Math.max(40, rect.width - MAP_INNER_PAD * 2);
  const availH = Math.max(40, rect.height - MAP_INNER_PAD * 2);
  return Math.min(availW / NETWORK_BOUNDS.width, availH / NETWORK_BOUNDS.height);
}

/** Kamera, die die uebergebenen Staedte (z.B. aktuelle Station + erreichbare Nachbarn) mittig einrahmt. */
function fitCamera(ids: string[], rect: MapRect): Camera {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = cityWorldPos.get(id);
    if (!p) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const boxW = Math.max(0.1, maxX - minX);
  const boxH = Math.max(0.1, maxY - minY);
  const availW = Math.max(40, rect.width - MAP_INNER_PAD * 2);
  const availH = Math.max(40, rect.height - MAP_INNER_PAD * 2);
  const fitZoom = Math.min(availW / boxW, availH / boxH);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    zoom: clamp(fitZoom, minZoomFor(rect), MAX_ZOOM),
  };
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
  let centerBtn: HTMLButtonElement;

  // -------------------------------------------------- Netzkarte: Kamera & Touch
  let currentOptions: RailEdge[] = [];
  let camera: Camera = { cx: 0, cy: 0, zoom: 60 };
  let cameraFrom: Camera = { ...camera };
  let cameraTarget: Camera | null = null;
  let cameraAnimT = 1;
  let pendingCameraFit: string[] | null = null;
  let hasCameraInitialized = false;
  let mapPulseTimer = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; camCx: number; camCy: number } | null = null;
  let pinchStart: { dist: number; zoom: number; cx: number; cy: number } | null = null;
  let tapCandidate: { id: number; startX: number; startY: number } | null = null;

  /**
   * Sichtbarer Kartenbereich in Canvas-Koordinaten: zwischen der oberen
   * HUD-Leiste und dem unteren Sheet, ermittelt ueber die tatsaechlichen
   * DOM-Rechtecke statt geschaetzter Prozentwerte -- bleibt so auch korrekt,
   * wenn das Sheet je nach Anzahl der Anschlussstationen unterschiedlich
   * hoch ist.
   */
  function getMapRect(env: GameEnv): MapRect {
    const canvasBox = env.canvas.getBoundingClientRect();
    const topBarBox = topBar.getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    const top = clamp(topBarBox.bottom - canvasBox.top + 12, 20, env.size.height - 140);
    const sheetTop = sheetBox.height > 0 ? sheetBox.top - canvasBox.top : env.size.height - 40;
    const bottom = clamp(sheetTop - 12, top + 100, env.size.height - 10);
    const left = MAP_INNER_PAD * 0.5;
    const right = env.size.width - MAP_INNER_PAD * 0.5;
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    };
  }

  /**
   * "Du bist in ..." steht bewusst direkt ueber der Liste der Anschluss-
   * stationen (statt separat oben im HUD) -- so ist auf einen Blick klar,
   * dass das die aktuelle Station ist, von der aus die Wahl unten gilt.
   */
  function updateLabels(): void {
    goalLine.textContent = `Ziel: Breddin · ${formatLegCount(legsCompleted)} bisher`;
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
    centerBtn.style.display = phase === "choosing" ? "block" : "none";
  }

  function beginChoice(): void {
    phase = "choosing";
    updateLabels();
    const options = neighborsOf(currentCityId, previousCityId);
    currentOptions = options;
    if (options.length === 0) {
      finish(false);
      return;
    }
    // Bewusst IMMER die Wahl zeigen, auch bei nur einer Option -- ein
    // fruehere automatisches Weiterfahren bei Stationen mit nur einer
    // Anschlussstrecke kettete sich an mehreren solcher Stationen hinter-
    // einander zu mehreren Strecken "auf einen Tap" zusammen, ohne dass man
    // dazwischen "Du bist in: <Stadt>" ueberhaupt sehen konnte. Ein Tap soll
    // immer genau eine Direktverbindung (= ein Zug) ausloesen.
    renderChoiceButtons(options);
    // Kamera neu auf aktuelle Station + erreichbare Nachbarn ausrichten --
    // die eigentliche Berechnung passiert in update(), sobald die aktuelle
    // Groesse von topBar/sheet feststeht (siehe getMapRect).
    pendingCameraFit = [currentCityId, ...options.map((o) => o.to)];
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
          message: `${formatLegCount(legsCompleted)} bis nach Breddin — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
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
    title.textContent = reachedFestival ? "Willkommen in Breddin! 🎪" : "Sackgasse!";
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

  /**
   * Kleine Zugsilhouette in Draufsicht. "angle" ist der Blickwinkel in
   * Bildschirm-Koordinaten (0 = zeigt nach rechts, wie ctx.rotate) -- damit
   * zeigt der Zug immer in die tatsaechliche Fahrtrichtung, nicht mehr fix
   * nach rechts.
   */
  function drawTrainTop(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
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
   *
   * Waehrend der Fahrt bleibt der Zug fest in der Bildmitte -- stattdessen
   * "wandert" die Welt (Start-/Zielpunkt, Gleis, Schwellen) daran vorbei,
   * und zwar in der tatsaechlichen Kompass-Himmelsrichtung der echten
   * Strecke (Norden ist immer oben im Bild, siehe Kompass-Hinweis unten
   * rechts). So fuehlt es sich an, als bewege man sich wirklich in die
   * richtige Richtung, statt immer nur stur von links nach rechts.
   */
  /**
   * Uebersichtskarte des GESAMTEN Streckennetzes waehrend der Stationswahl
   * (statt frueher nur ein einzelner Punkt) -- Kamera ist per fitCamera() auf
   * die aktuelle Station + ihre direkt erreichbaren Nachbarn ausgerichtet,
   * per Ziehen/Pinch aber frei verschieb-/zoombar (siehe onPointerMove).
   * Bewusst wird NUR die aktuelle Station namentlich beschriftet -- alle
   * anderen Staedte (auch das eigentliche Ziel Breddin, sobald es nicht
   * gerade selbst eine Option ist) bleiben stumme Punkte, damit man sich
   * nicht die ganze Route im Voraus von der Karte ablesen kann.
   */
  function drawNetworkMap(ctx: CanvasRenderingContext2D, env: GameEnv): void {
    const rect = getMapRect(env);
    const optionIds = new Set(currentOptions.map((o) => o.to));

    const toScreen = (id: string): { x: number; y: number } | null => {
      const w = cityWorldPos.get(id);
      if (!w) return null;
      return {
        x: rect.centerX + (w.x - camera.cx) * camera.zoom,
        y: rect.centerY + (w.y - camera.cy) * camera.zoom,
      };
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();

    // Alle Strecken im Hintergrund, blass -- vermittelt "das ist nur ein
    // Ausschnitt aus einem groesseren Netz", ohne vom Wesentlichen abzulenken.
    ctx.strokeStyle = theme.panelBorderLight;
    ctx.lineWidth = 2;
    for (const edge of RAIL_EDGES) {
      const a = toScreen(edge.from);
      const b = toScreen(edge.to);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    const cur = toScreen(currentCityId);

    // Erreichbare Strecken ab der aktuellen Station farbig hervorgehoben --
    // der eigentliche "Eyecatcher": sofort klar, wohin man von hier aus
    // fahren kann.
    if (cur) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = theme.accent;
      for (const opt of currentOptions) {
        const to = toScreen(opt.to);
        if (!to) continue;
        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }

    // Alle uebrigen Staedte nur als kleine, blasse, UNBESCHRIFTETE Punkte.
    for (const city of RAIL_CITIES) {
      if (city.id === currentCityId || optionIds.has(city.id)) continue;
      const p = toScreen(city.id);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = theme.panelBorderLight;
      ctx.fill();
    }

    const pulse = 1 + Math.sin(mapPulseTimer * 3.2) * 0.18;

    // Erreichbare Nachbarstationen: gross, farbig, sanft pulsierend -- auch
    // per Antippen direkt auswaehlbar (siehe onPointerUp), als schnellere
    // Alternative zu den Buttons in der Leiste unten. Bewusst ebenfalls ohne
    // Namensbeschriftung.
    for (const opt of currentOptions) {
      const p = toScreen(opt.to);
      if (!p) continue;
      const isFestivalStop = opt.to === FESTIVAL_CITY_ID;
      const dotColor = isFestivalStop ? theme.accent : theme.primary;
      const r = (isFestivalStop ? 13 : 11) * pulse;

      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 9, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }

    // Aktuelle Station: Glow + Punkt + einzige beschriftete Stelle der Karte.
    if (cur) {
      const glowR = 26 * pulse;
      const grad = ctx.createRadialGradient(cur.x, cur.y, 0, cur.x, cur.y, glowR);
      grad.addColorStop(0, hexToRgba(theme.accentDark, 0.35));
      grad.addColorStop(1, hexToRgba(theme.accentDark, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      drawStationDot(ctx, cur.x, cur.y, cityName(currentCityId), theme.accent);
      ctx.textAlign = "center";
      ctx.font = `600 12px ${theme.font}`;
      ctx.fillStyle = theme.textMuted;
      ctx.fillText("Du bist hier", cur.x, cur.y + 24);
    }

    ctx.restore();
  }

  function drawMap(ctx: CanvasRenderingContext2D, env: GameEnv): void {
    const { size } = env;
    const midY = size.height * 0.4;

    if (phase === "traveling" && targetCityId) {
      const centerX = size.width / 2;
      const centerY = midY;
      const pct = currentEdgeKm > 0 ? Math.min(1, progressKm / currentEdgeKm) : 0;

      const bearingDeg = bearingBetween(currentCityId, targetCityId);
      const rad = (bearingDeg * Math.PI) / 180;
      // Bildschirm-Richtungsvektor der Fahrt: Norden (0 Grad) = nach oben
      // (negatives Y), Osten (90 Grad) = nach rechts (positives X).
      const dirX = Math.sin(rad);
      const dirY = -Math.cos(rad);
      const perpX = -dirY;
      const perpY = dirX;

      // "D" ist eine rein visuelle Streckenlaenge in Pixeln (unabhaengig
      // von den echten km) -- legt fest, wie weit Start-/Zielpunkt bei
      // Fahrtbeginn/-ende von der Bildmitte entfernt erscheinen.
      const routeHalf = Math.min(size.width, size.height) * 0.42;
      const D = routeHalf * 2;

      // Weltposition s=0 ist der Startbahnhof, s=D der Zielbahnhof; bei
      // Fortschritt "pct" steht der (fest zentrierte) Zug bei s=pct*D. Ein
      // Punkt bei Weltposition s liegt also auf dem Bildschirm bei
      // center + dir*(s - pct*D).
      const worldToScreen = (s: number): { x: number; y: number } => ({
        x: centerX + dirX * (s - pct * D),
        y: centerY + dirY * (s - pct * D),
      });

      const from = worldToScreen(0);
      const to = worldToScreen(D);
      const railFar1 = worldToScreen(-0.3 * D);
      const railFar2 = worldToScreen(1.3 * D);

      ctx.strokeStyle = theme.panelBorderLight;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(railFar1.x, railFar1.y);
      ctx.lineTo(railFar2.x, railFar2.y);
      ctx.stroke();

      // Schwellen in festen Weltabstaenden -- da ihre Bildschirmposition
      // (wie alles hier) von "pct" abhaengt, scheinen sie am Zug vorbei zu
      // ziehen, was den Bewegungseindruck deutlich verstaerkt.
      const tieSpacing = 26;
      ctx.strokeStyle = "rgba(180,150,40,0.35)";
      ctx.lineWidth = 2;
      for (let s = -0.3 * D; s <= 1.3 * D; s += tieSpacing) {
        const p = worldToScreen(s);
        ctx.beginPath();
        ctx.moveTo(p.x - perpX * 6, p.y - perpY * 6);
        ctx.lineTo(p.x + perpX * 6, p.y + perpY * 6);
        ctx.stroke();
      }

      // Bereits zurueckgelegte Strecke (Start bis Zugmitte) farbig hervorgehoben.
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(centerX, centerY);
      ctx.stroke();

      drawStationDot(ctx, from.x, from.y, cityName(currentCityId), theme.textMuted);
      const targetColor = targetCityId === FESTIVAL_CITY_ID ? theme.accent : theme.primary;
      drawStationDot(ctx, to.x, to.y, cityName(targetCityId), targetColor);
      drawTrainTop(ctx, centerX, centerY, Math.atan2(dirY, dirX));

      // Kompass-Hinweis: Norden ist immer "oben" im Bild, damit die
      // Himmelsrichtung der Fahrt ueberhaupt einzuordnen ist.
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = `700 11px ${theme.font}`;
      ctx.fillStyle = theme.textFaint;
      const compassX = size.width - 24;
      const compassY = 26;
      ctx.fillText("N", compassX, compassY - 8);
      ctx.strokeStyle = theme.textFaint;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(compassX, compassY + 8);
      ctx.lineTo(compassX, compassY - 4);
      ctx.moveTo(compassX - 4, compassY);
      ctx.lineTo(compassX, compassY - 4);
      ctx.lineTo(compassX + 4, compassY);
      ctx.stroke();
      ctx.restore();

      ctx.textAlign = "center";
      ctx.font = `600 12px ${theme.font}`;
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(`${Math.round(progressKm)} / ${Math.round(currentEdgeKm)} km`, size.width / 2, size.height - 22);
    } else {
      drawNetworkMap(ctx, env);
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
      // Deutlich kraeftiger als die urspruengliche kleine Titelzeile -- das
      // ist die eigentliche Handlungsaufforderung ("was soll ich tun?"),
      // direkt unter der auf die Nachbarstationen hervorgehobenen Karte.
      choiceTitle.style.fontSize = "1.05rem";
      choiceTitle.style.fontWeight = "800";
      choiceTitle.style.color = "var(--accent-dark)";
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

      centerBtn = document.createElement("button");
      centerBtn.type = "button";
      centerBtn.className = "btn";
      centerBtn.textContent = "⌖ Zentrieren";
      centerBtn.style.position = "absolute";
      centerBtn.style.top = "calc(var(--header-h) + 96px + var(--safe-top))";
      centerBtn.style.right = "calc(10px + var(--safe-right))";
      centerBtn.style.zIndex = "16";
      centerBtn.style.padding = "6px 12px";
      centerBtn.style.fontSize = "0.78rem";
      centerBtn.style.display = "none";
      centerBtn.addEventListener("click", () => {
        pendingCameraFit = [currentCityId, ...currentOptions.map((o) => o.to)];
      });
      env.overlay.appendChild(centerBtn);

      highscoreBanner = mountHighscoreBanner(env.overlay, formatLegCount);
      highscoreBanner.update(getHighscoreBoard(GAME_ID, BOARD));

      beginChoice();
      updateSheetVisibility();

      closeIntro = showGameIntro({
        title: "Zugsimulator",
        description: [
          "Start an einem zufälligen deutschen Bahnhof",
          "Ziel: Breddin — dort wartet das Shuttle zum Neiphos Festival",
          "An jeder Station wählst du die nächste Strecke",
          "Highscore: möglichst wenige Züge bis Breddin",
        ],
        onStart: () => {
          closeIntro = null;
          started = true;
        },
      });
    },

    update(dt: number, env: GameEnv) {
      if (!started) return;

      if (pendingCameraFit) {
        const rect = getMapRect(env);
        const target = fitCamera(pendingCameraFit, rect);
        pendingCameraFit = null;
        if (!hasCameraInitialized) {
          // Erster Fit ueberhaupt: direkt uebernehmen statt von der
          // Default-Kamera (Null-Insel bei 0/0) heranzufliegen.
          camera = { ...target };
          cameraTarget = null;
          hasCameraInitialized = true;
        } else {
          cameraFrom = { ...camera };
          cameraTarget = target;
          cameraAnimT = 0;
        }
      }
      if (cameraTarget) {
        cameraAnimT = Math.min(1, cameraAnimT + dt * 2.2);
        const e = 1 - (1 - cameraAnimT) * (1 - cameraAnimT) * (1 - cameraAnimT);
        camera = {
          cx: lerp(cameraFrom.cx, cameraTarget.cx, e),
          cy: lerp(cameraFrom.cy, cameraTarget.cy, e),
          zoom: lerp(cameraFrom.zoom, cameraTarget.zoom, e),
        };
        if (cameraAnimT >= 1) cameraTarget = null;
      }
      mapPulseTimer += dt;

      if (phase !== "traveling") return;
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

      drawMap(ctx, env);
    },

    /**
     * Karte per Ziehen verschiebbar (ein Finger) und per Pinch zoombar (zwei
     * Finger) -- nur waehrend der Stationswahl aktiv. Ein Tap ohne
     * nennenswerte Bewegung auf einer hervorgehobenen Nachbarstation waehlt
     * diese direkt aus, als schnellere Alternative zu den Buttons unten.
     */
    onPointerDown(p: PointerPoint) {
      if (phase !== "choosing") return;
      pointers.set(p.id, { x: p.x, y: p.y });
      cameraTarget = null; // Nutzer uebernimmt die Kontrolle -- Auto-Fit-Animation abbrechen.

      if (pointers.size === 1) {
        dragStart = { x: p.x, y: p.y, camCx: camera.cx, camCy: camera.cy };
        tapCandidate = { id: p.id, startX: p.x, startY: p.y };
      } else if (pointers.size === 2) {
        dragStart = null;
        tapCandidate = null;
        const pts = [...pointers.values()];
        pinchStart = {
          dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
          zoom: camera.zoom,
          cx: camera.cx,
          cy: camera.cy,
        };
      }
    },

    onPointerMove(p: PointerPoint, env: GameEnv) {
      if (phase !== "choosing" || !pointers.has(p.id)) return;
      pointers.set(p.id, { x: p.x, y: p.y });

      if (pointers.size === 1 && dragStart) {
        const dx = p.x - dragStart.x;
        const dy = p.y - dragStart.y;
        camera = {
          cx: dragStart.camCx - dx / camera.zoom,
          cy: dragStart.camCy - dy / camera.zoom,
          zoom: camera.zoom,
        };
        if (tapCandidate && tapCandidate.id === p.id) {
          const moved = Math.hypot(p.x - tapCandidate.startX, p.y - tapCandidate.startY);
          if (moved > TAP_MOVE_TOLERANCE) tapCandidate = null;
        }
      } else if (pointers.size === 2 && pinchStart) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const rect = getMapRect(env);
        const newZoom = clamp((pinchStart.zoom * dist) / Math.max(1, pinchStart.dist), minZoomFor(rect), MAX_ZOOM);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        // Weltpunkt unter der Pinch-Mitte fixiert lassen, damit der Zoom
        // "unter den Fingern" bleibt statt wegzuspringen.
        const worldX = pinchStart.cx + (midX - rect.centerX) / pinchStart.zoom;
        const worldY = pinchStart.cy + (midY - rect.centerY) / pinchStart.zoom;
        camera = {
          zoom: newZoom,
          cx: worldX - (midX - rect.centerX) / newZoom,
          cy: worldY - (midY - rect.centerY) / newZoom,
        };
      }
    },

    onPointerUp(p: PointerPoint, env: GameEnv) {
      if (tapCandidate && tapCandidate.id === p.id && phase === "choosing") {
        const rect = getMapRect(env);
        for (const edge of currentOptions) {
          const w = cityWorldPos.get(edge.to);
          if (!w) continue;
          const sx = rect.centerX + (w.x - camera.cx) * camera.zoom;
          const sy = rect.centerY + (w.y - camera.cy) * camera.zoom;
          if (Math.hypot(p.x - sx, p.y - sy) <= TAP_HIT_RADIUS) {
            startLeg(edge);
            break;
          }
        }
      }
      pointers.delete(p.id);
      if (tapCandidate?.id === p.id) tapCandidate = null;
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 1) {
        const [[id, pt]] = pointers;
        dragStart = { x: pt.x, y: pt.y, camCx: camera.cx, camCy: camera.cy };
        tapCandidate = null;
        void id;
      } else if (pointers.size === 0) {
        dragStart = null;
      }
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
      centerBtn?.remove();
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Zugsimulator",
  subtitle: "Finde den Weg nach Breddin",
  icon: "locomotive",
  badge: "ZG",
  accent: "#1f6f43",
  create: createTrainSimGame,
  highscoreCategories: [{ board: BOARD, label: "Wenigste Züge", direction: "lower-better", formatValue: formatLegCount }],
});
