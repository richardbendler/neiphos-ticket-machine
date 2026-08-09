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
 * "Hüpftier-Metro" (ursprünglich als "Mini Metro" eingefuehrt, siehe
 * Ordnername/GAME_ID -- rein interne Bezeichner bleiben unveraendert, um
 * bestehende Highscores nicht zu verwaisen) -- eigenstaendige Neuentwicklung
 * nach dem Vorbild des Handyspiels Mini Metro (Haltestellen per Linien
 * verbinden, Passagiere befoerdern, bevor eine Haltestelle ueberfuellt),
 * aber bewusst an dieses Kiosk-Spielesammlung-Format angepasst statt 1:1
 * uebernommen:
 *
 * - Session-basiert mit Highscore (wie alle anderen Spiele hier) statt
 *   eines echten, ueber Tage laufenden Spielstands -- ein "Tag" im Spiel
 *   ist deshalb ein kurzes, beschleunigtes Zeitintervall (siehe DAY_MS),
 *   keine echte Kalenderzeit.
 * - Bruecken (im Original ein spaeteres Upgrade fuer Fluss-/Wasserquerungen)
 *   sind auf ausdruecklichen Wunsch NICHT enthalten -- diese Karte hat
 *   ohnehin kein Wasserhindernis.
 * - Passagiere sind Hüpftiere (siehe data/hopperAnimals.ts, dasselbe Bildset
 *   wie bei Zug-Spotter/Zug-Memory) mit einem kleinen Formsymbol daneben,
 *   das ihr Fahrtziel zeigt -- auf ausdruecklichen Wunsch.
 * - Passagiere planen bei Bedarf eine Route MIT Umstieg (siehe findNextHop):
 *   gibt es keine direkte Linie zum Fahrtziel, aber ein Umweg ueber eine
 *   gemeinsame Haltestelle zweier Linien, wird das automatisch erkannt.
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
const PASSENGER_SPAWN_INTERVAL_S = 15;

// Ab dieser Wartenden-Zahl faengt der Ueberlastungs-Ring an, sich um die
// Haltestelle zu fuellen (statt wie zuvor ein hartes Sofort-Game-Over) --
// auf ausdruecklichen Wunsch: ca. 20 Sekunden Zeit, bevor eine dauerhaft
// ueberfuellte Haltestelle wirklich zum Spielende fuehrt. Sinkt die Anzahl
// wieder auf OVERLOAD_TRIGGER-1 oder weniger, laeuft der Ring in
// OVERLOAD_DRAIN_S wieder leer (bewusst schneller als er sich fuellt --
// fuehlt sich reaktionsfreudiger an, sobald man das Problem behoben hat).
const OVERLOAD_TRIGGER = 6;
const OVERLOAD_FILL_S = 20;
const OVERLOAD_DRAIN_S = 10;
const OVERLOAD_RING_RADIUS = STATION_RADIUS + 10;

const TRAIN_SPEED_PX_S = 130;
const TRAIN_DWELL_S = 0.55;
const BASE_CAPACITY = 6; // "Loks koennen immer genau sechs Passagiere greifen"
const WAGON_CAPACITY_BONUS = 3;
// Etwas groesser als zuvor (war 22x14) -- auf ausdruecklichen Wunsch, plus
// jetzt immer zur aktuellen Fahrtrichtung ausgerichtet (siehe drawTrains).
const TRAIN_W = 30;
const TRAIN_H = 18;

// Ein "Tag" ist ein kurzes, beschleunigtes Intervall (siehe Datei-Kommentar
// oben) -- sieben Tage pro "Woche", am Wochenwechsel gibt es automatisch
// eine neue Lok plus die Wahl zwischen einer weiteren Linie oder einem
// Waggon. Auf ausdruecklichen Wunsch schwieriger: jeden Tag (statt vorher
// eines festen, unabhaengigen Intervalls) kommt zusaetzlich eine neue
// Haltestelle dazu, siehe tick().
const DAY_MS = 18_000;
const DAYS_PER_WEEK = 7;
// Echte Wochentag-Kuerzel statt nur einer Tageszahl -- die urspruengliche
// Spezifikation wollte oben rechts "eine Zeitanzeige UND den Wochentag"
// (nicht nur eine Zaehl-Nummer), und das Vorbild-Handyspiel zeigt dort
// ebenfalls ein Wochentag-Kuerzel ("MON") statt einer Zahl.
const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// Ein Analog-Uhr-Umlauf entspricht einer Tageshaelfte (hell) bzw. der
// anderen Haelfte (dunkel) -- zwei Umlaeufe = ein Tag, siehe updateClock().
const DAY_HALF_S = DAY_MS / 1000 / 2;

// Das Canvas fuellt (anders als man vermuten koennte) den KOMPLETTEN
// Viewport, nicht nur den Bereich zwischen Kopf-/Fusszeile -- die Zeilen
// selbst sind separate, deckende DOM-Ebenen, die einfach DARueBER liegen
// (siehe core/Router.ts). Ohne ausreichend Rand ragten Haltestellen (vor
// allem das nach oben spitz zulaufende Dreieck) sichtbar unter der
// Kopfzeile hervor bzw. wurden von ihr angeschnitten (gemeldet). --header-h
// ist 86px, --footer-h 78px (style.css) -- die Werte hier liegen bewusst
// deutlich darueber, damit zusaetzlich die eigenen Overlay-Elemente
// (Ressourcen-/Tageszaehler oben, Linienfarb-Spalte rechts, wartende
// Passagiere ueber jeder Haltestelle) sicher Platz haben. MARGIN_TOP wurde
// nochmal angehoben (war 150), weil die wartenden Huepftiere jetzt groesser
// sind und dadurch mehr Platz ueber der Haltestelle brauchen.
const MARGIN_TOP = 175;
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
// Auf ausdruecklichen Wunsch groesser (war 13px) und mit dem Formsymbol
// DANEBEN statt DARueBERLIEGEND -- vorher verdeckte der Kreis-Chip einen
// Teil des Huepftier-Sprites.
const PASSENGER_SPRITE_SIZE = 20;
const PASSENGER_BADGE_GAP = 3;
const PASSENGER_ITEM_GAP = 5;
const SHAPE_BADGE_RADIUS = 6;

let idSeq = 1;
function nextId(): number {
  return idSeq++;
}

interface Passenger {
  id: number;
  destShape: StationShape;
  sprite: string;
  // Ziel-Haltestelle des AKTUELLEN Fahrtabschnitts -- entweder schon das
  // Endziel (destShape erreicht) oder eine Umstiege-Haltestelle, an der der
  // Passagier wieder aussteigt und auf eine andere Linie wartet (siehe
  // findNextHop/arriveAtStation). null, solange der Passagier noch wartet.
  nextStop: number | null;
}

interface Station {
  id: number;
  shape: StationShape;
  x: number;
  y: number;
  waiting: Passenger[];
  // 0..1 Fuellstand des Ueberlastungs-Rings, siehe OVERLOAD_TRIGGER.
  overloadT: number;
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
  let passengerTimers = new Map<number, number>();
  let gameOver = false;
  let started = false;
  let tutorialDismissed = false;
  let tutorialPulseTimer = 0;
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
  // Letzte Zeigerposition waehrend eines aktiven Drags -- ermoeglicht das
  // "Aufsammeln" mehrerer Haltestellen in einer einzigen, zuegigen
  // Zieh-Geste (siehe stationsAlongSegment), statt nur die Haltestelle
  // direkt unter dem Zeiger je Bewegungs-Event zu erfassen. Bei schnellen
  // Bewegungen (wenige Move-Events, grosse Distanz pro Event) wirkte das
  // vorher "schwerfaellig" (gemeldet) -- man musste langsam ueber jede
  // Haltestelle einzeln fahren.
  let lastPointer: { x: number; y: number } | null = null;
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
  let clockWrapEl: HTMLDivElement;
  let clockHandEl: HTMLDivElement;
  let clockFaceEl: HTMLDivElement;
  let clockBadgeEl: HTMLSpanElement;

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
      overloadT: 0,
    };
    stations.push(s);
    passengerTimers.set(s.id, PASSENGER_SPAWN_INTERVAL_S * (0.5 + Math.random()));
  }

  function spawnPassenger(station: Station): void {
    const options = SHAPES.filter((s) => s !== station.shape);
    const destShape = options[Math.floor(Math.random() * options.length)];
    const sprite = PASSENGER_SPRITES[Math.floor(Math.random() * PASSENGER_SPRITES.length)];
    station.waiting.push({ id: nextId(), destShape, sprite, nextStop: null });
  }

  // ------------------------------------------------------------------ Linien

  /**
   * Nachbarschafts-Graph aus allen aktuell verlegten Linien (Kante = zwei
   * auf einer Linie direkt aufeinanderfolgende Haltestellen, unabhaengig
   * davon welche Linie das ist) -- Grundlage fuer die Umstiege-Suche
   * (findNextHop). Wird bewusst bei jeder Ankunft frisch gebaut statt
   * dauerhaft gepflegt: bei maximal neun Haltestellen/sechs Linien voellig
   * vernachlaessigbarer Aufwand, dafuer immer garantiert konsistent mit dem
   * gerade aktuellen Streckennetz (der Spieler kann es jederzeit umbauen).
   */
  function buildAdjacency(): Map<number, Set<number>> {
    const adj = new Map<number, Set<number>>();
    for (const s of stations) adj.set(s.id, new Set());
    for (const line of lines) {
      if (!line) continue;
      for (let i = 0; i < line.stationIds.length - 1; i++) {
        const a = line.stationIds[i];
        const b = line.stationIds[i + 1];
        adj.get(a)?.add(b);
        adj.get(b)?.add(a);
      }
    }
    return adj;
  }

  /**
   * Naechster Halt auf dem kuerzesten Weg (in Haltestellen-Schritten, nicht
   * Distanz) von fromId zu einer BELIEBIGEN Haltestelle mit passender Form
   * -- per Breitensuche ueber den Streckennetz-Graphen. Liefert null, wenn
   * (noch) keine Verbindung existiert. Der Passagier muss den Rest der
   * Route nicht kennen: er faehrt bis zu diesem naechsten Halt (das kann
   * auch schon das Endziel sein), steigt dort ggf. um und die Suche laeuft
   * bei der naechsten Ankunft dort erneut -- so bleibt die Logik robust
   * gegenueber einem sich waehrend der Fahrt aendernden Streckennetz.
   */
  function findNextHop(adj: Map<number, Set<number>>, fromId: number, destShape: StationShape): number | null {
    const visited = new Set<number>([fromId]);
    const queue: number[] = [fromId];
    const prev = new Map<number, number>();
    let goal: number | null = null;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur !== fromId && stationById(cur).shape === destShape) {
        goal = cur;
        break;
      }
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          prev.set(nb, cur);
          queue.push(nb);
        }
      }
    }
    if (goal === null) return null;
    let n = goal;
    while (prev.get(n) !== fromId) n = prev.get(n)!;
    return n;
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

  // -------------------------------------------------------------- Zug-Indizes

  // train.fromIdx ist ein Index INS stationIds-Array -- fuegt man am Anfang
  // (unshift) eine Haltestelle ein, verschieben sich alle folgenden Indizes
  // um eins nach hinten, ohne Anpassung zeigte fromIdx danach auf die FALSCHE
  // Haltestelle. Wurde das Array stattdessen am Anfang verkuerzt (shift,
  // "Undo per Zurueckziehen"), musste fromIdx entsprechend mitschrumpfen.
  // Ohne diese Anpassung konnte fromIdx nach mehreren Umbauten sogar
  // AUSSERHALB des Arrays landen (Index >= Laenge) -- stationById() bekommt
  // dann `undefined` zurueck (die Typ-Zusicherung "!" prueft zur Laufzeit
  // NICHTS), der naechste Feldzugriff (".x") wirft eine echte Exception.
  // Passierte das in render() (drawLines/drawTrains laufen VOR drawStations),
  // brach das Zeichnen mittendrin ab -- drawStations() kam nie mehr zum
  // Zug, alle Haltestellen wirkten wie "verschwunden" (gemeldeter Bug).
  // clampTrainIndex() unten ist zusaetzlich eine Absicherung an den drei
  // Lesestellen (stepTrain/drawTrains) -- falls doch mal ein Fall auftaucht,
  // der hier nicht bedacht wurde, kann daraus nie mehr eine Exception werden.
  function reindexTrainsForUnshift(line: Line): void {
    for (const t of line.trains) t.fromIdx += 1;
  }

  function reindexTrainsForShift(line: Line): void {
    for (const t of line.trains) t.fromIdx = Math.max(0, t.fromIdx - 1);
  }

  function clampTrainIndex(line: Line, train: Train): void {
    const maxIdx = line.stationIds.length - 1;
    if (maxIdx < 0) return;
    train.fromIdx = Math.min(Math.max(train.fromIdx, 0), maxIdx);
  }

  // ------------------------------------------------------------------- Zuege

  function stepTrain(line: Line, train: Train, dt: number): void {
    clampTrainIndex(line, train);
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
    // Erst abladen (Ziel des aktuellen Fahrtabschnitts erreicht), dann erst
    // einladen -- macht sofort wieder Platz frei fuer neue Fahrgaeste an
    // derselben Haltestelle.
    const staying: Passenger[] = [];
    for (const p of train.carrying) {
      if (p.nextStop !== station.id) {
        staying.push(p);
        continue;
      }
      if (station.shape === p.destShape) {
        delivered += 1;
      } else {
        // Umstiege-Haltestelle erreicht: zurueck in die Warteschlange, die
        // naechste Ankunft (egal welche Linie) sucht von hier aus weiter.
        p.nextStop = null;
        station.waiting.push(p);
      }
    }
    train.carrying = staying;

    const adj = buildAdjacency();
    const stillWaiting: Passenger[] = [];
    for (const p of station.waiting) {
      if (train.carrying.length >= train.capacity) {
        stillWaiting.push(p);
        continue;
      }
      const nextHop = findNextHop(adj, station.id, p.destShape);
      if (nextHop !== null && line.stationIds.includes(nextHop)) {
        p.nextStop = nextHop;
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
    dayLabelEl.textContent = `${WEEKDAY_LABELS[(gameDay - 1) % DAYS_PER_WEEK]} · Woche ${Math.ceil(gameDay / DAYS_PER_WEEK)}`;
    deliveredLabelEl.textContent = formatDelivered(delivered);
    sparelokBtn.querySelector(".mm-resource__count")!.textContent = String(spareLoks);
    sparelokBtn.disabled = spareLoks <= 0;
  }

  /**
   * Kleine Analog-Uhr oben rechts: ein Zeiger, der einmal im Kreis laeuft
   * pro Tageshaelfte (DAY_HALF_S) -- zwei Umlaeufe ergeben also einen
   * ganzen Spieltag, wie gewuenscht. Erste Haelfte = "hell" (Sonne,
   * helles Ziffernblatt), zweite Haelfte = "dunkel" (Mond, dunkles
   * Ziffernblatt).
   */
  function updateClock(): void {
    const isNight = dayTimerS >= DAY_HALF_S;
    const progress = (dayTimerS % DAY_HALF_S) / DAY_HALF_S;
    clockHandEl.style.transform = `rotate(${progress * 360}deg)`;
    clockFaceEl.classList.toggle("mm-clock__face--night", isNight);
    clockBadgeEl.innerHTML = isNight ? icons.moon : icons.sun;
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

    // Eigene, bewusst schmal begrenzte Karte statt der Inhalte direkt im
    // (vollbreiten, nur zentrierenden) .stage-center-panel -- ohne das
    // wurden "Nochmal spielen"/"Menü" via width:100% bildschirmbreit.
    const card = document.createElement("div");
    card.className = "ticket-card";
    card.style.textAlign = "center";
    card.style.width = "100%";
    card.style.maxWidth = "340px";
    gameOverPanel.appendChild(card);

    const title = document.createElement("div");
    title.style.fontFamily = "var(--font-display)";
    title.style.fontWeight = "800";
    title.style.fontSize = "1.3rem";
    title.style.color = theme.danger;
    title.textContent = "Haltestelle dauerhaft überlastet!";
    card.appendChild(title);

    const detail = document.createElement("div");
    detail.style.color = "var(--paper-muted)";
    detail.style.margin = "6px 0 14px";
    detail.textContent = `${formatDelivered(delivered)} befördert, bevor eine Haltestelle zu lange überfüllt war.`;
    card.appendChild(detail);

    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn--accent";
    again.style.width = "100%";
    again.textContent = "Nochmal spielen";
    again.addEventListener("click", () => resetGame());
    card.appendChild(again);

    const menuBtn = buildMenuButton(exitGame);
    menuBtn.style.width = "100%";
    menuBtn.style.marginTop = "8px";
    menuBtn.style.justifyContent = "center";
    card.appendChild(menuBtn);

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
    passengerTimers = new Map();
    gameOver = false;
    weeklyModalOpen = false;
    awaitingWagonPick = false;
    sparelokArmed = false;
    armedDeleteIndex = null;
    tutorialDismissed = false;
    tutorialPulseTimer = 0;
    gameOverPanel.style.display = "none";
    // Start = genau eine Haltestelle je Form (Nutzerwunsch) -- lastSize wird
    // in tick() laufend aktualisiert, siehe dort.
    for (const shape of SHAPES) spawnStation(lastSize, shape);
    highscoreBanner.update(getHighscoreBoard(GAME_ID));
    renderLineColumn();
    updateHint();
    updateCounters();
    updateClock();
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

  function drawOverloadRing(ctx: CanvasRenderingContext2D, s: Station): void {
    if (s.overloadT <= 0 && s.waiting.length < OVERLOAD_TRIGGER) return;
    ctx.beginPath();
    ctx.arc(s.x, s.y, OVERLOAD_RING_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(198, 40, 40, 0.18)";
    ctx.lineWidth = 5;
    ctx.stroke();
    if (s.overloadT > 0) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, OVERLOAD_RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * s.overloadT);
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  function drawStations(ctx: CanvasRenderingContext2D): void {
    for (const s of stations) {
      drawOverloadRing(ctx, s);

      ctx.fillStyle = theme.panel;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 2.5;
      drawShapeOutline(ctx, s.shape, s.x, s.y, STATION_RADIUS);
      ctx.fill();
      ctx.stroke();

      if (s.waiting.length > 0) {
        const size = PASSENGER_SPRITE_SIZE;
        const badgeSpace = SHAPE_BADGE_RADIUS * 2 + PASSENGER_BADGE_GAP;
        const itemW = size + badgeSpace + PASSENGER_ITEM_GAP;
        const totalW = s.waiting.length * itemW - PASSENGER_ITEM_GAP;
        let px = s.x - totalW / 2;
        const py = s.y - STATION_RADIUS - size - 8;
        for (const p of s.waiting) {
          const img = getImage(p.sprite);
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, px, py, size, size);
          } else {
            ctx.fillStyle = theme.panelAlt;
            ctx.fillRect(px, py, size, size);
          }
          // Formsymbol DANEBEN statt ueberlappend auf dem Sprite -- zeigt
          // weiterhin das Fahrtziel, verdeckt aber nicht mehr das Tier.
          drawMiniShapeBadge(ctx, p.destShape, px + size + PASSENGER_BADGE_GAP + SHAPE_BADGE_RADIUS, py + size / 2, SHAPE_BADGE_RADIUS);
          px += itemW;
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
        clampTrainIndex(line, train);
        const from = stationById(line.stationIds[train.fromIdx]);
        const toIdx = Math.min(Math.max(train.fromIdx + train.dir, 0), line.stationIds.length - 1);
        const to = stationById(line.stationIds[toIdx]);
        const x = from.x + (to.x - from.x) * train.t;
        const y = from.y + (to.y - from.y) * train.t;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = line.color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-TRAIN_W / 2, -TRAIN_H / 2, TRAIN_W, TRAIN_H, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Formsymbole der Fahrgaeste ueber dem Zug -- bewusst NICHT
        // mitgedreht (sonst stehen sie bei senkrechter Fahrt auf dem Kopf)
        // und als Symbol statt Zahl, auf ausdruecklichen Wunsch: reicht,
        // um auf einen Blick zu sehen, wohin die Fahrgaeste wollen.
        if (train.carrying.length > 0) {
          const r = 4.5;
          const gap = 2;
          const totalW = train.carrying.length * (r * 2 + gap) - gap;
          let ix = x - totalW / 2 + r;
          const iy = y - TRAIN_H / 2 - r - 5;
          for (const p of train.carrying) {
            drawMiniShapeBadge(ctx, p.destShape, ix, iy, r);
            ix += r * 2 + gap;
          }
        }
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

  function drawTutorialArrow(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    if (tutorialDismissed || stations.length === 0) return;
    const bounce = Math.sin(tutorialPulseTimer * 3.4) * 6;
    const cx = size.width / 2;
    // Fest knapp unter dem oberen Rand des Spielfelds positioniert (nicht
    // von den tatsaechlichen, zufaellig platzierten Start-Haltestellen
    // abgeleitet) -- die drei Start-Haltestellen koennen ueberall im
    // Spielfeld liegen, ein Pfeil, der nach unten in Richtung Spielfeld
    // zeigt, bleibt so in jedem Fall sinnvoll UND kollidiert nie mit dem
    // Ressourcen-/Tages-Panel oben.
    const tipY = MARGIN_TOP - 22 + bounce;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - 18, tipY - 20);
    ctx.lineTo(cx - 8, tipY - 20);
    ctx.lineTo(cx - 8, tipY - 36);
    ctx.lineTo(cx + 8, tipY - 36);
    ctx.lineTo(cx + 8, tipY - 20);
    ctx.lineTo(cx + 18, tipY - 20);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.font = `800 22px ${theme.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.fillText("Ziehe deine erste Linie!", cx, tipY - 46);
    ctx.font = `700 13px ${theme.fontDisplay}`;
    ctx.fillStyle = theme.textMuted;
    ctx.fillText("Verbinde zwei Haltestellen mit dem Finger", cx, tipY - 64);
  }

  // ---------------------------------------------------------------- Eingabe

  function stationAt(x: number, y: number): Station | null {
    let best: Station | null = null;
    let bestDist = STATION_RADIUS + 16;
    for (const s of stations) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Alle Haltestellen, deren Umkreis von der Strecke zwischen p0 und p1
   * geschnitten wird -- sortiert in der Reihenfolge, in der sie auf dieser
   * Strecke liegen (Projektion auf die Strecke, 0 = bei p0). Ermoeglicht
   * es, mehrere Haltestellen in einer einzigen zuegigen Zieh-Geste zu
   * erfassen (siehe handleMove), auch wenn dazwischen nur wenige/grobe
   * Pointer-Move-Events ankommen.
   */
  function stationsAlongSegment(p0: { x: number; y: number }, p1: { x: number; y: number }): Station[] {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len2 = dx * dx + dy * dy;
    const captureR = STATION_RADIUS + 16;
    const hits: Array<{ s: Station; t: number }> = [];
    for (const s of stations) {
      let t = len2 > 0 ? ((s.x - p0.x) * dx + (s.y - p0.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = p0.x + dx * t;
      const py = p0.y + dy * t;
      if (Math.hypot(s.x - px, s.y - py) <= captureR) hits.push({ s, t });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits.map((h) => h.s);
  }

  function handleDown(x: number, y: number): void {
    lastPointer = { x, y };
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

  /** Versucht, eine einzelne Haltestelle an die aktive Linie anzuhaengen/zu entfernen -- Kernlogik von handleMove, je Treffer aus stationsAlongSegment aufgerufen. */
  function tryExtendActiveLine(station: Station): void {
    if (!activeDrag) return;
    const line = lines[activeDrag.lineIndex];
    if (!line) return;

    const ids = line.stationIds;
    const atStart = activeDrag.fromEnd === "start";
    const edgeId = atStart ? ids[0] : ids[ids.length - 1];
    const secondId = ids.length >= 2 ? (atStart ? ids[1] : ids[ids.length - 2]) : null;

    if (station.id === edgeId) return;
    if (secondId !== null && station.id === secondId) {
      // Rueckwaerts ueber die vorletzte Station gezogen -- letzte Station
      // wieder entfernen (einfache "Undo per Zurueckziehen"-Geste).
      if (atStart) {
        ids.shift();
        reindexTrainsForShift(line);
      } else {
        ids.pop();
        for (const t of line.trains) clampTrainIndex(line, t);
      }
      if (ids.length < 2 && line.trains.length > 0) {
        line.trains = [];
      }
      renderLineColumn();
      return;
    }
    if (ids.includes(station.id)) return;
    if (atStart) {
      ids.unshift(station.id);
      reindexTrainsForUnshift(line);
    } else {
      ids.push(station.id);
    }
    ensureTrainOnNewLine(line);
    if (ids.length >= 2) tutorialDismissed = true;
    renderLineColumn();
  }

  function handleMove(x: number, y: number): void {
    if (!activeDrag) {
      lastPointer = { x, y };
      return;
    }
    const prev = lastPointer ?? { x, y };
    for (const station of stationsAlongSegment(prev, { x, y })) {
      tryExtendActiveLine(station);
    }
    lastPointer = { x, y };
  }

  function handleUp(): void {
    activeDrag = null;
    lastPointer = null;
  }

  // ------------------------------------------------------------------- Loop

  function tick(dt: number, size: { width: number; height: number }): void {
    lastSize = size;
    if (!started || gameOver || weeklyModalOpen) return;

    tutorialPulseTimer += dt;

    dayTimerS += dt;
    updateClock();
    if (dayTimerS >= DAY_MS / 1000) {
      dayTimerS = 0;
      gameDay += 1;
      // Auf ausdruecklichen Wunsch schwieriger: jeden Tag kommt automatisch
      // eine neue Haltestelle dazu (vorher ein davon unabhaengiges, festes
      // Intervall).
      spawnStation(size);
      if ((gameDay - 1) % DAYS_PER_WEEK === 0) {
        triggerWeekChange();
      }
      updateCounters();
    }

    for (const s of stations) {
      const remaining = (passengerTimers.get(s.id) ?? PASSENGER_SPAWN_INTERVAL_S) - dt;
      if (remaining <= 0) {
        spawnPassenger(s);
        passengerTimers.set(s.id, PASSENGER_SPAWN_INTERVAL_S * (0.7 + Math.random() * 0.6));
      } else {
        passengerTimers.set(s.id, remaining);
      }
    }

    for (const s of stations) {
      if (s.waiting.length >= OVERLOAD_TRIGGER) {
        s.overloadT = Math.min(1, s.overloadT + dt / OVERLOAD_FILL_S);
        if (s.overloadT >= 1) {
          triggerGameOver();
          return;
        }
      } else if (s.waiting.length <= OVERLOAD_TRIGGER - 1) {
        s.overloadT = Math.max(0, s.overloadT - dt / OVERLOAD_DRAIN_S);
      }
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

      clockWrapEl = document.createElement("div");
      clockWrapEl.className = "mm-clock";
      clockFaceEl = document.createElement("div");
      clockFaceEl.className = "mm-clock__face";
      clockHandEl = document.createElement("div");
      clockHandEl.className = "mm-clock__hand";
      clockFaceEl.appendChild(clockHandEl);
      clockBadgeEl = document.createElement("span");
      clockBadgeEl.className = "mm-clock__badge";
      clockBadgeEl.innerHTML = icons.sun;
      clockWrapEl.append(clockFaceEl, clockBadgeEl);
      topRight.appendChild(clockWrapEl);

      const textCol = document.createElement("div");
      textCol.className = "mm-panel__text-col";
      dayLabelEl = document.createElement("div");
      dayLabelEl.className = "mm-panel__day";
      deliveredLabelEl = document.createElement("div");
      deliveredLabelEl.className = "mm-panel__delivered";
      textCol.append(dayLabelEl, deliveredLabelEl);
      topRight.appendChild(textCol);

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
        title: "Hüpftier-Metro",
        description: [
          "Verbinde Haltestellen (Kreis/Quadrat/Dreieck) per Ziehen zu Linien",
          "Auch mehrere Haltestellen in einem Zug -- oder eine Linie an ihrem Ende greifen und weiterziehen",
          "Hüpftiere sind die Passagiere -- das kleine Symbol zeigt ihr Fahrtziel, notfalls steigen sie unterwegs um",
          "Ist eine Haltestelle zu lange überfüllt (Ring läuft voll), ist die Runde vorbei",
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
      drawTutorialArrow(ctx, size);
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
  title: "Hüpftier-Metro",
  subtitle: "Bringe Hüpftiere von A nach B",
  icon: "metroMap",
  badge: "MM",
  accent: "#0059a4",
  create: createMiniMetroGame,
  highscoreCategories: [{ board: "default", label: "Passagiere", direction: "higher-better", formatValue: formatDelivered }],
});
