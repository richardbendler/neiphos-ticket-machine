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
 * - Waggons haengen an EINZELNEN Zuegen (nicht an der Linie als Ganzes) und
 *   werden wie Loks aus einem Vorrat links per Antippen-dann-Ziel-antippen
 *   zugewiesen -- Ziel ist hier aber ein tatsaechlicher Zug auf der Strecke,
 *   nicht eine Linie (siehe trainAt/handleDown).
 * - Ringlinien sind erlaubt, aber jede Haltestelle darf pro Linie maximal
 *   ZWEIMAL vorkommen -- und zwar ausschliesslich als Schluss des Rings
 *   zurueck zur allerersten Haltestelle dieser Linie ("einmal rein, einmal
 *   raus"), siehe tryExtendActiveLine.
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
// Auf ausdruecklichen Wunsch 30% dicker (war 5).
const LINE_WIDTH = 6.5;

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

// "Station aus Linie nehmen"-UI: nach einem Tipp (ohne Ziehen) auf eine
// bereits verbundene Haltestelle erscheint JE LINIE, die diese Haltestelle
// beruehrt, EIN Symbol in diesem Abstand vom Haltestellen-Mittelpunkt --
// deutlich ausserhalb des eigentlichen Antipp-Bereichs (siehe stationAt).
// Bewusst pro LINIE statt pro Verbindungsrichtung (frueherer Ansatz): das
// Symbol nimmt die komplette Haltestelle aus dieser einen Linie heraus,
// der Rest der Linie bleibt dabei als EINE zusammenhaengende Strecke
// bestehen (removeStationFromLine) -- unabhaengig davon, an welchem Ende
// die Linie urspruenglich gezogen wurde.
const DELETE_BADGE_OFFSET = STATION_RADIUS + 24;
const DELETE_BADGE_RADIUS = 13;
const ARMED_STATION_TIMEOUT_MS = 4000;

// Linien-Stummel: eine bestehende Linie laesst sich NUR noch verlaengern,
// indem man sie an diesem kurzen, ueber die Endstation hinausragenden
// Streckenstueck greift (nicht mehr an der Haltestelle selbst) -- ein Tipp
// direkt auf die Haltestelle startet stattdessen immer eine NEUE Linie.
// Das macht beide Gesten nebeneinander bedienbar, siehe Datei-Kommentar
// bei handleDown.
const LINE_STUB_LENGTH = 22;
const LINE_STUB_HIT_RADIUS = 18;

// Kamera-Zoom auf die ueberlastete Haltestelle, BEVOR das (unveraenderte)
// Game-Over-Panel erscheint -- auf ausdruecklichen Wunsch. Erst nach Ablauf
// dieser Zeitspanne wird triggerGameOver() aufgerufen, das seinerseits wie
// gehabt den Highscore-Dialog um weitere 900ms verzoegert.
const GAMEOVER_ZOOM_MS = 900;
const GAMEOVER_ZOOM_S = GAMEOVER_ZOOM_MS / 1000;
const GAMEOVER_ZOOM_SCALE = 2.4;

const TRAIN_SPEED_PX_S = 130;
const TRAIN_DWELL_S = 0.55;
const BASE_CAPACITY = 6; // "Loks koennen immer genau sechs Passagiere greifen"
const WAGON_CAPACITY = 6; // Ein Waggon traegt genau so viel wie die Lok selbst, auf ausdruecklichen Wunsch.
// Passagiere steigen nicht mehr alle gleichzeitig ein, sondern nacheinander
// mit dieser Verzoegerung -- der Zug wartet dafuer notfalls laenger als
// TRAIN_DWELL_S an der Haltestelle (siehe stepTrain).
const BOARD_STAGGER_S = 0.3;
// Etwas groesser als zuvor (war 22x14) -- auf ausdruecklichen Wunsch, plus
// jetzt immer zur aktuellen Fahrtrichtung ausgerichtet (siehe drawTrains).
const TRAIN_W = 30;
const TRAIN_H = 18;
const WAGON_GAP = 4;

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

// Persistenter, extrem langsamer Rauszoom-Effekt: je mehr Haltestellen es
// gibt, desto weiter zoomt die Kamera (kaum wahrnehmbar) heraus -- auf
// ausdruecklichen Wunsch, damit neue Haltestellen NICHT zwischen die
// bestehenden gequetscht werden muessen, sondern das Streckennetz insgesamt
// einfach groesser wird (neue Haltestellen entstehen im dadurch neu
// verfuegbaren Weltbereich, siehe randomStationPosition/getCameraPivot).
// worldZoom naehert sich seinem Ziel (worldZoomTarget, siehe tick()) nur
// sehr langsam an (WORLD_ZOOM_LERP_RATE) statt bei jeder neuen Haltestelle
// zu springen -- das macht die Bewegung ueber die gesamte Rundendauer
// verteilt praktisch unsichtbar.
const WORLD_ZOOM_MIN = 0.62;
const WORLD_ZOOM_LERP_RATE = 0.12;

// Sicherheitsabstand des Tutorial-Pfeils zur Kopfzeile (86px hoch, siehe
// --header-h in style.css): der oberste gezeichnete Text lag beim frueheren
// festen Versatz (MARGIN_TOP - 22) teils nur ~3px unterhalb der Kopfzeile
// -- je nach Bildschirmhoehe/Schriftrendering reichte das nicht, der Text
// wurde vom Header angeschnitten (gemeldet). tipY wird jetzt zusaetzlich
// gegen diesen Mindestwert geclampt, unabhaengig von der Bildschirmhoehe.
const TUTORIAL_HEADER_CLEARANCE = 110;

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
  wagons: number; // Haengt am ZUG (nicht mehr an der Linie), siehe Datei-Kommentar oben.
  // Passagiere, die GERADE einsteigen (nacheinander, siehe BOARD_STAGGER_S)
  // -- bleiben bis zum tatsaechlichen Einsteigen noch in station.waiting.
  boardQueue: Passenger[];
  boardTimer: number;
}

interface Line {
  color: string;
  stationIds: number[];
  trains: Train[];
}

function formatDelivered(value: number): string {
  return value === 1 ? "1 Passagier" : `${value} Passagiere`;
}

function createTrain(): Train {
  return { fromIdx: 0, dir: 1, t: 0, dwell: 0, carrying: [], capacity: BASE_CAPACITY, wagons: 0, boardQueue: [], boardTimer: 0 };
}

function createMiniMetroGame(): MinigameModule {
  let stations: Station[] = [];
  let lines: (Line | null)[] = [];
  let maxLines = INITIAL_LINE_SLOTS;
  let spareLoks = 0;
  let spareWagons = 0;
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

  // 0 = pausiert, 1 = normal, 2 = doppelte Geschwindigkeit -- skaliert
  // einfach das an tick() uebergebene dt, siehe update(). Wirkt dadurch
  // gleichmaessig auf Zeit/Zuege/Passagier-Nachschub/Ueberlastung, ohne
  // dass jede einzelne Konstante angefasst werden muss.
  let gameSpeed: 0 | 1 | 2 = 1;

  let weeklyModalOpen = false;
  let armedDeleteIndex: number | null = null;
  let armedDeleteTimer: ReturnType<typeof setTimeout> | null = null;

  // "Station aus Linie nehmen" -- siehe Datei-Kommentar bei DELETE_BADGE_OFFSET.
  let armedDeleteStationId: number | null = null;
  let armedStationDeleteTimer: ReturnType<typeof setTimeout> | null = null;
  // Tap- vs. Zieh-Erkennung: handleDown merkt sich die angetippte Haltestelle,
  // handleMove setzt dragMoved sobald sich der Zeiger tatsaechlich bewegt --
  // erst wenn handleUp OHNE Bewegung auf derselben (verbundenen) Haltestelle
  // landet, gilt das als "Haltestelle fuer Loeschen antippen" statt als (im
  // Ergebnis wirkungsloser) Linien-Zieh-Versuch.
  let downStationId: number | null = null;
  let dragMoved = false;
  // Wird in handleDown gesetzt, wenn dabei SPEKULATIV eine neue (noch leere,
  // nur aus einer Haltestelle bestehende) Linie angelegt wurde -- bleibt es
  // bei einem reinen Tipp (kein Ziehen), wird dieser Slot in handleUp wieder
  // freigegeben, statt dauerhaft einen Linien-Slot zu belegen.
  let freshLineIndex: number | null = null;

  // Game-Over-Zoom (siehe GAMEOVER_ZOOM_S): waehrend "zooming" true ist, laeuft
  // keine normale Spiellogik mehr (siehe tick()), nur die Zoom-Animation.
  let zooming = false;
  let zoomStation: Station | null = null;
  let zoomElapsedS = 0;

  // Persistenter Rauszoom-Effekt (siehe WORLD_ZOOM_MIN) -- worldZoom ist der
  // tatsaechlich gezeichnete/fuer Eingaben verwendete Wert, worldZoomTarget
  // das aktuelle Ziel je nach Haltestellenzahl (siehe tick()).
  let worldZoom = 1;
  let worldZoomTarget = 1;

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
  let resourceColEl: HTMLDivElement;
  let sparelokBtn: HTMLButtonElement;
  let wagonBtn: HTMLButtonElement;
  let lineColumnEl: HTMLDivElement;
  let lineCircles: HTMLButtonElement[] = [];
  let hintEl: HTMLDivElement;
  let gameOverPanel: HTMLDivElement;
  let clockWrapEl: HTMLDivElement;
  let clockHandEl: HTMLDivElement;
  let clockFaceEl: HTMLDivElement;
  let clockBadgeEl: HTMLSpanElement;
  let speedRowEl: HTMLDivElement;
  let pauseBtn: HTMLButtonElement;
  let playBtn: HTMLButtonElement;
  let ffBtn: HTMLButtonElement;

  function stationById(id: number): Station {
    return stations.find((s) => s.id === id)!;
  }

  /**
   * Fester Drehpunkt fuer den Welt-Zoom -- die Mitte des urspruenglichen
   * (margin-begrenzten) Spielfelds bei worldZoom=1. Wird sowohl beim
   * Platzieren neuer Haltestellen (randomStationPosition) als auch beim
   * Zeichnen (render) und beim Umrechnen von Bildschirm- in Welt-Koordinaten
   * (screenToWorld) verwendet -- nur wenn ueberall derselbe Drehpunkt gilt,
   * bildet ein vergroesserter Weltbereich bei jedem Zoom-Stand wieder exakt
   * auf denselben Bildschirmbereich ab (bei worldZoom=1 identisch zum
   * bisherigen Verhalten).
   */
  function getCameraPivot(size: { width: number; height: number }): { x: number; y: number } {
    return {
      x: MARGIN_LEFT + (size.width - MARGIN_LEFT - MARGIN_RIGHT) / 2,
      y: MARGIN_TOP + (size.height - MARGIN_TOP - MARGIN_BOTTOM) / 2,
    };
  }

  function screenToWorld(x: number, y: number): { x: number; y: number } {
    const pivot = getCameraPivot(lastSize);
    return { x: pivot.x + (x - pivot.x) / worldZoom, y: pivot.y + (y - pivot.y) / worldZoom };
  }

  // ------------------------------------------------------------- Haltestellen

  function randomStationPosition(size: { width: number; height: number }): { x: number; y: number } | null {
    // Durch worldZoom geteilt -- je weiter herausgezoomt (kleinerer Wert),
    // desto groesser der Weltbereich, in dem neue Haltestellen entstehen
    // koennen (siehe Datei-Kommentar bei WORLD_ZOOM_MIN).
    const w = (size.width - MARGIN_LEFT - MARGIN_RIGHT) / worldZoom;
    const h = (size.height - MARGIN_TOP - MARGIN_BOTTOM) / worldZoom;
    if (w < 40 || h < 40) return null;
    const pivot = getCameraPivot(size);
    const left = pivot.x - w / 2;
    const top = pivot.y - h / 2;
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = left + Math.random() * w;
      const y = top + Math.random() * h;
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
      line.trains.push(createTrain());
    }
  }

  function isMiddleOfAnyLine(stationId: number): boolean {
    return lines.some((line) => {
      if (!line) return false;
      const idx = line.stationIds.indexOf(stationId);
      return idx > 0 && idx < line.stationIds.length - 1;
    });
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

  // ---------------------------------------- Einzelne Haltestelle aus Linie nehmen (Tap)

  /** Alle Linien, die diese Haltestelle beruehren (mit mindestens zwei Haltestellen, also wirklich befahren). */
  function getLinesAtStation(stationId: number): number[] {
    const result: number[] = [];
    lines.forEach((line, i) => {
      if (line && line.stationIds.length >= 2 && line.stationIds.includes(stationId)) result.push(i);
    });
    return result;
  }

  /** Je betroffener Linie EIN Symbol, positioniert "weg von der Linie" (Gegenrichtung der Summe aller Nachbarrichtungen an dieser Haltestelle auf dieser Linie). */
  function getRemoveBadgePositions(stationId: number): Array<{ lineIndex: number; x: number; y: number; color: string }> {
    const station = stationById(stationId);
    return getLinesAtStation(stationId).map((lineIndex, i, arr) => {
      const line = lines[lineIndex]!;
      const idx = line.stationIds.indexOf(stationId);
      const neighborIds: number[] = [];
      if (idx > 0) neighborIds.push(line.stationIds[idx - 1]);
      if (idx < line.stationIds.length - 1) neighborIds.push(line.stationIds[idx + 1]);
      let sumX = 0;
      let sumY = 0;
      for (const nid of neighborIds) {
        const n = stationById(nid);
        const dx = n.x - station.x;
        const dy = n.y - station.y;
        const len = Math.hypot(dx, dy) || 1;
        sumX += dx / len;
        sumY += dy / len;
      }
      let awayX = -sumX;
      let awayY = -sumY;
      let awayLen = Math.hypot(awayX, awayY);
      if (awayLen < 0.001) {
        awayX = 0;
        awayY = -1;
        awayLen = 1;
      }
      const baseAngle = Math.atan2(awayY / awayLen, awayX / awayLen);
      // Bei mehreren betroffenen Linien die Symbole leicht faechern, damit
      // sie sich nicht gegenseitig ueberlappen.
      const spread = (i - (arr.length - 1) / 2) * 0.5;
      const angle = baseAngle + spread;
      return {
        lineIndex,
        x: station.x + Math.cos(angle) * DELETE_BADGE_OFFSET,
        y: station.y + Math.sin(angle) * DELETE_BADGE_OFFSET,
        color: line.color,
      };
    });
  }

  function disarmStationDelete(): void {
    armedDeleteStationId = null;
    if (armedStationDeleteTimer) clearTimeout(armedStationDeleteTimer);
    armedStationDeleteTimer = null;
  }

  function armStationDelete(stationId: number): void {
    armedDeleteStationId = stationId;
    if (armedStationDeleteTimer) clearTimeout(armedStationDeleteTimer);
    armedStationDeleteTimer = setTimeout(() => {
      armedDeleteStationId = null;
      armedStationDeleteTimer = null;
    }, ARMED_STATION_TIMEOUT_MS);
  }

  function toggleStationDeleteArm(stationId: number): void {
    if (armedDeleteStationId === stationId) disarmStationDelete();
    else armStationDelete(stationId);
  }

  function reindexTrainsForSplice(line: Line, removedIdx: number): void {
    for (const t of line.trains) {
      if (t.fromIdx > removedIdx) t.fromIdx -= 1;
      else if (t.fromIdx === removedIdx) t.fromIdx = Math.max(0, removedIdx - 1);
    }
  }

  /**
   * Entfernt eine Haltestelle KOMPLETT aus einer Linie -- der Rest bleibt
   * eine einzige, zusammenhaengende Strecke (die bisherigen Nachbarn ruecken
   * direkt zusammen), unabhaengig davon, ob die Haltestelle am Rand oder
   * mitten in der Linie liegt bzw. an welchem Ende die Linie urspruenglich
   * gezogen wurde. Bewusst KEIN Trennen/Verwerfen eines Teilstuecks -- auf
   * ausdruecklichen Nutzerwunsch: "der Rest der Verbindung bleibt bestehen".
   * Entfernt bei einer Ringlinie (siehe tryExtendActiveLine) vorsichtshalber
   * ALLE Vorkommen dieser Haltestelle auf der Linie, nicht nur das erste --
   * visuell gibt es ja nur einen Haltestellen-Punkt zum Antippen.
   */
  function removeStationFromLine(lineIndex: number, stationId: number): void {
    const line = lines[lineIndex];
    if (!line) return;
    let idx = line.stationIds.indexOf(stationId);
    while (idx !== -1) {
      if (idx === 0) {
        line.stationIds.shift();
        for (const t of line.trains) t.fromIdx = Math.max(0, t.fromIdx - 1);
      } else if (idx === line.stationIds.length - 1) {
        line.stationIds.pop();
      } else {
        reindexTrainsForSplice(line, idx);
        line.stationIds.splice(idx, 1);
      }
      idx = line.stationIds.indexOf(stationId);
    }
    for (const t of line.trains) clampTrainIndex(line, t);
    if (line.stationIds.length < 2) line.trains = [];
    renderLineColumn();
  }

  // ------------------------------------------------------- Linien-Stummel (verlaengern)

  /** Punkt etwas HINTER der Endstation (Richtung von deren Nachbar weg weiterverlaengert) -- siehe Datei-Kommentar bei LINE_STUB_LENGTH. */
  function lineStubTip(line: Line, end: "start" | "end"): { x: number; y: number } | null {
    if (line.stationIds.length < 2) return null;
    const idx = end === "start" ? 0 : line.stationIds.length - 1;
    const neighborIdx = end === "start" ? 1 : line.stationIds.length - 2;
    const station = stationById(line.stationIds[idx]);
    const neighbor = stationById(line.stationIds[neighborIdx]);
    const dx = station.x - neighbor.x;
    const dy = station.y - neighbor.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: station.x + (dx / len) * LINE_STUB_LENGTH, y: station.y + (dy / len) * LINE_STUB_LENGTH };
  }

  function findLineStubAt(x: number, y: number): { lineIndex: number; end: "start" | "end" } | null {
    let best: { lineIndex: number; end: "start" | "end" } | null = null;
    let bestDist = LINE_STUB_HIT_RADIUS;
    lines.forEach((line, lineIndex) => {
      if (!line || line.stationIds.length < 2) return;
      (["start", "end"] as const).forEach((end) => {
        const tip = lineStubTip(line, end);
        if (!tip) return;
        const d = Math.hypot(tip.x - x, tip.y - y);
        if (d < bestDist) {
          best = { lineIndex, end };
          bestDist = d;
        }
      });
    });
    return best;
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

  /** Ringlinie = erste und letzte Haltestelle sind identisch (siehe tryExtendActiveLine) -- mindestens drei Eintraege, sonst waeren "erste" und "letzte" dieselbe einzelne Haltestelle. */
  function isRingLine(line: Line): boolean {
    const lastIdx = line.stationIds.length - 1;
    return lastIdx >= 2 && line.stationIds[0] === line.stationIds[lastIdx];
  }

  /**
   * Naechster Index in Fahrtrichtung -- bei einer Ringlinie faehrt der Zug
   * tatsaechlich RUNDHERUM statt an den Array-Enden umzudrehen (auf
   * ausdruecklichen Wunsch): ueber die doppelt gezaehlte Schluss-Haltestelle
   * hinaus geht's direkt beim naechsten "echten" Nachbarn weiter (Index 1
   * bzw. laenge-2). Bei einer normalen (nicht geschlossenen) Linie bleibt
   * es beim bisherigen Clamping (die Umkehr-Entscheidung selbst trifft
   * weiterhin stepTrain). Wird sowohl von stepTrain als auch von den rein
   * visuellen Stellen (drawTrains/currentTrainPos) verwendet, damit der Zug
   * am Ringschluss nicht sichtbar "haengenbleibt".
   */
  function nextTrainIdx(line: Line, fromIdx: number, dir: 1 | -1): number {
    const lastIdx = line.stationIds.length - 1;
    const toIdx = fromIdx + dir;
    if (isRingLine(line)) {
      if (toIdx > lastIdx) return 1;
      if (toIdx < 0) return lastIdx - 1;
    }
    return Math.min(Math.max(toIdx, 0), lastIdx);
  }

  function currentTrainPos(line: Line, train: Train): { x: number; y: number } {
    const from = stationById(line.stationIds[train.fromIdx]);
    const toIdx = nextTrainIdx(line, train.fromIdx, train.dir);
    const to = stationById(line.stationIds[toIdx]);
    return { x: from.x + (to.x - from.x) * train.t, y: from.y + (to.y - from.y) * train.t };
  }

  /** Fuer das Anhaengen eines Waggons (siehe wagonArmed/handleDown) -- sucht den Zug, dessen AKTUELLE gezeichnete Position dem Tipp am naechsten ist. */
  function trainAt(x: number, y: number): { line: Line; train: Train } | null {
    let best: { line: Line; train: Train } | null = null;
    let bestDist = 26;
    for (const line of lines) {
      if (!line || line.stationIds.length < 2) continue;
      for (const train of line.trains) {
        const pos = currentTrainPos(line, train);
        const d = Math.hypot(pos.x - x, pos.y - y);
        if (d < bestDist) {
          best = { line, train };
          bestDist = d;
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------- Zuege

  function stepTrain(line: Line, train: Train, dt: number): void {
    clampTrainIndex(line, train);
    if (train.boardQueue.length > 0) {
      train.boardTimer -= dt;
      if (train.boardTimer <= 0) {
        const p = train.boardQueue.shift()!;
        const station = stationById(line.stationIds[train.fromIdx]);
        const idx = station.waiting.findIndex((w) => w.id === p.id);
        if (idx >= 0) station.waiting.splice(idx, 1);
        train.carrying.push(p);
        train.boardTimer = BOARD_STAGGER_S;
      }
    }
    if (train.dwell > 0 || train.boardQueue.length > 0) {
      if (train.dwell > 0) train.dwell -= dt;
      return;
    }
    const from = stationById(line.stationIds[train.fromIdx]);
    const rawToIdx = train.fromIdx + train.dir;
    if (!isRingLine(line) && (rawToIdx < 0 || rawToIdx >= line.stationIds.length)) {
      // Endstation einer normalen (nicht geschlossenen) Linie erreicht --
      // umdrehen. Bei einer Ringlinie faehrt der Zug stattdessen einfach
      // weiter rundherum, siehe nextTrainIdx.
      train.dir = (train.dir * -1) as 1 | -1;
      return;
    }
    const toIdx = nextTrainIdx(line, train.fromIdx, train.dir);
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
    train.boardTimer = 0; // erster wartender Fahrgast darf sofort einsteigen
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

    // Einsteigende werden nur AUSGEWAEHLT, aber (anders als frueher) noch
    // NICHT sofort aus station.waiting entfernt/in train.carrying verschoben
    // -- das passiert gestaffelt in stepTrain (siehe BOARD_STAGGER_S), damit
    // sie sichtbar nacheinander einsteigen statt alle im selben Frame.
    const adj = buildAdjacency();
    const boarding: Passenger[] = [];
    for (const p of station.waiting) {
      if (train.carrying.length + boarding.length >= train.capacity) continue;
      const nextHop = findNextHop(adj, station.id, p.destShape);
      if (nextHop !== null && line.stationIds.includes(nextHop)) {
        p.nextStop = nextHop;
        boarding.push(p);
      }
    }
    train.boardQueue = boarding;
    updateCounters();
  }

  // -------------------------------------------------------------- Wochenwahl

  function triggerWeekChange(): void {
    spareLoks += 1;
    weeklyModalOpen = true;
    openModal(
      (panel, close) => {
        panel.classList.add("mm-week-modal");

        const badge = document.createElement("div");
        badge.className = "mm-week-modal__badge";
        badge.innerHTML = icons.locomotive;
        panel.appendChild(badge);

        const h2 = document.createElement("h2");
        h2.className = "mm-week-modal__title";
        h2.textContent = `Woche geschafft!`;
        panel.appendChild(h2);

        const p = document.createElement("p");
        p.className = "mm-week-modal__text";
        p.innerHTML = `Tag ${gameDay} erreicht — eine neue Lok gibt's gratis dazu. Wähle zusätzlich:`;
        panel.appendChild(p);

        const row = document.createElement("div");
        row.className = "mm-week-modal__row";

        const lineBtn = document.createElement("button");
        lineBtn.type = "button";
        lineBtn.className = "mm-week-modal__btn";
        lineBtn.innerHTML = `${icons.route}<span>Neue Linie</span>`;
        lineBtn.disabled = maxLines >= MAX_LINE_SLOTS;
        lineBtn.addEventListener("click", () => {
          maxLines = Math.min(MAX_LINE_SLOTS, maxLines + 1);
          renderLineColumn();
          weeklyModalOpen = false;
          close();
        });
        row.appendChild(lineBtn);

        const wagonChoiceBtn = document.createElement("button");
        wagonChoiceBtn.type = "button";
        wagonChoiceBtn.className = "mm-week-modal__btn";
        wagonChoiceBtn.innerHTML = `${icons.wagon}<span>Waggon</span>`;
        wagonChoiceBtn.addEventListener("click", () => {
          spareWagons += 1;
          updateCounters();
          weeklyModalOpen = false;
          close();
        });
        row.appendChild(wagonChoiceBtn);

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
    } else if (wagonArmed) {
      hintEl.textContent = "Tippe einen fahrenden Zug an, um ihm einen Waggon anzuhängen.";
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
    wagonBtn.querySelector(".mm-resource__count")!.textContent = String(spareWagons);
    wagonBtn.disabled = spareWagons <= 0;
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

  function updateSpeedButtons(): void {
    pauseBtn.classList.toggle("mm-speed-btn--active", gameSpeed === 0);
    playBtn.classList.toggle("mm-speed-btn--active", gameSpeed === 1);
    ffBtn.classList.toggle("mm-speed-btn--active", gameSpeed === 2);
  }

  function setGameSpeed(v: 0 | 1 | 2): void {
    gameSpeed = v;
    updateSpeedButtons();
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
      btn.innerHTML = armedDeleteIndex === i ? "✕" : "";
      btn.addEventListener("click", () => onLineCircleTap(i));
      lineColumnEl.appendChild(btn);
      lineCircles.push(btn);
    }
  }

  // "Eine Lok aus dem Vorrat zuweisen" (sparelokArmed, Ziel: Linie rechts)
  // und "Waggon aus dem Vorrat zuweisen" (wagonArmed, Ziel: ein tatsaechlich
  // fahrender Zug auf der Strecke, siehe trainAt/handleDown) schliessen sich
  // gegenseitig aus -- das Starten des einen bricht den anderen ab.
  let sparelokArmed = false;
  let wagonArmed = false;

  function onLineCircleTap(index: number): void {
    const line = lines[index];
    if (sparelokArmed) {
      if (line && line.stationIds.length >= 2) {
        spareLoks -= 1;
        line.trains.push(createTrain());
        sparelokArmed = false;
        updateHint();
        updateCounters();
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
    wagonArmed = false;
    sparelokArmed = true;
    updateHint();
  }

  function onWagonTap(): void {
    if (spareWagons <= 0) return;
    sparelokArmed = false;
    wagonArmed = true;
    updateHint();
  }

  /** Startet den Kamera-Zoom auf die ueberlastete Haltestelle -- triggerGameOver() (unveraendert, inkl. Text und Highscore-Delay) folgt erst nach GAMEOVER_ZOOM_S, siehe tick(). */
  function beginGameOverZoom(station: Station): void {
    if (gameOver || zooming) return;
    zooming = true;
    zoomStation = station;
    zoomElapsedS = 0;
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
    spareWagons = 0;
    delivered = 0;
    gameDay = 1;
    dayTimerS = 0;
    passengerTimers = new Map();
    gameOver = false;
    weeklyModalOpen = false;
    sparelokArmed = false;
    wagonArmed = false;
    armedDeleteIndex = null;
    tutorialDismissed = false;
    tutorialPulseTimer = 0;
    zooming = false;
    zoomStation = null;
    zoomElapsedS = 0;
    worldZoom = 1;
    worldZoomTarget = 1;
    setGameSpeed(1);
    disarmStationDelete();
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
      ctx.lineWidth = LINE_WIDTH;
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

  /** Kurzes Streckenstueck, das ueber jede Endstation hinausragt -- Greifpunkt zum Verlaengern der BESTEHENDEN Linie, siehe findLineStubAt/handleDown. */
  function drawLineStubs(ctx: CanvasRenderingContext2D): void {
    lines.forEach((line) => {
      if (!line || line.stationIds.length < 2) return;
      (["start", "end"] as const).forEach((end) => {
        const tip = lineStubTip(line, end);
        if (!tip) return;
        const stationIdx = end === "start" ? 0 : line.stationIds.length - 1;
        const station = stationById(line.stationIds[stationIdx]);
        ctx.strokeStyle = line.color;
        ctx.lineWidth = LINE_WIDTH;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(station.x, station.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = line.color;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    });
  }

  /** Lok: Rechteck mit angespitzter Front (Fahrtrichtung +x nach der Rotation) -- optisch klar von den (rechteckigen) Waggons unterscheidbar. */
  function drawLoco(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, color: string): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    const w = TRAIN_W;
    const h = TRAIN_H;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2 - 6, -h / 2);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w / 2 - 6, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawWagon(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, color: string): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-TRAIN_W / 2, -TRAIN_H / 2, TRAIN_W, TRAIN_H, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawTrains(ctx: CanvasRenderingContext2D): void {
    for (const line of lines) {
      if (!line || line.stationIds.length < 2) continue;
      for (const train of line.trains) {
        clampTrainIndex(line, train);
        const from = stationById(line.stationIds[train.fromIdx]);
        const toIdx = nextTrainIdx(line, train.fromIdx, train.dir);
        const to = stationById(line.stationIds[toIdx]);
        const x = from.x + (to.x - from.x) * train.t;
        const y = from.y + (to.y - from.y) * train.t;
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);

        drawLoco(ctx, x, y, angle, line.color);
        for (let i = 1; i <= train.wagons; i++) {
          const offset = TRAIN_W / 2 + WAGON_GAP + TRAIN_W / 2 + (i - 1) * (TRAIN_W + WAGON_GAP);
          drawWagon(ctx, x - dirX * offset, y - dirY * offset, angle, line.color);
        }

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
    // Zusaetzliches Stueck bis zum aktuellen Zeiger -- auf ausdruecklichen
    // Wunsch soll die Linie schon WAEHREND des Ziehens sichtbar zwischen der
    // Start-Haltestelle und dem Finger gespannt sein, nicht erst wenn eine
    // weitere Haltestelle erreicht ist. Bei fromEnd "start" haengt die
    // gezogene Seite am ERSTEN Eintrag des Arrays (siehe tryExtendActiveLine,
    // dort wird bei "start" per unshift vorne eingefuegt), deshalb dort ein
    // eigenes Teilstueck ab Station 0 statt einfach ans Ende des bisherigen
    // Pfads anzuhaengen.
    if (lastPointer) {
      if (activeDrag.fromEnd === "end") {
        ctx.lineTo(lastPointer.x, lastPointer.y);
      } else {
        const first = stationById(line.stationIds[0]);
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(lastPointer.x, lastPointer.y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Je betroffener Linie ein Symbol an einer angetippten Haltestelle, mit dem sich GENAU DIESE Haltestelle aus GENAU DIESER Linie nehmen laesst -- siehe removeStationFromLine. */
  function drawStationRemoveUI(ctx: CanvasRenderingContext2D): void {
    if (armedDeleteStationId === null) return;
    const station = stations.find((s) => s.id === armedDeleteStationId);
    if (!station) {
      disarmStationDelete();
      return;
    }
    const badges = getRemoveBadgePositions(armedDeleteStationId);
    if (badges.length === 0) {
      disarmStationDelete();
      return;
    }

    ctx.beginPath();
    ctx.arc(station.x, station.y, STATION_RADIUS + 6, 0, Math.PI * 2);
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const b of badges) {
      ctx.beginPath();
      ctx.moveTo(station.x, station.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(b.x, b.y, DELETE_BADGE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Kleines weisses Formsymbol der Haltestelle MIT Ausschluss-Strich --
      // zeigt "genau DIESE Haltestelle (Form) wird aus dieser Linie
      // (Badge-Farbe) entfernt", statt (wie zuvor, missverstaendlich) eine
      // einzelne Verbindung zwischen zwei Stationen zu kappen.
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      drawShapeOutline(ctx, station.shape, b.x, b.y, DELETE_BADGE_RADIUS * 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x - DELETE_BADGE_RADIUS * 0.65, b.y - DELETE_BADGE_RADIUS * 0.65);
      ctx.lineTo(b.x + DELETE_BADGE_RADIUS * 0.65, b.y + DELETE_BADGE_RADIUS * 0.65);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawTutorialArrow(ctx: CanvasRenderingContext2D, size: { width: number; height: number }): void {
    if (tutorialDismissed || stations.length === 0) return;
    const bounce = Math.sin(tutorialPulseTimer * 3.4) * 6;
    const cx = size.width / 2;
    // tipY nach unten gegen TUTORIAL_HEADER_CLEARANCE geclampt (siehe dort)
    // -- bleibt dadurch auf JEDER Bildschirmhoehe unterhalb der Kopfzeile,
    // statt (wie zuvor bei kurzen Bildschirmen) teilweise darunter zu
    // verschwinden.
    const tipY = Math.max(MARGIN_TOP - 22, TUTORIAL_HEADER_CLEARANCE + 64) + bounce;
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
    downStationId = null;
    dragMoved = false;
    freshLineIndex = null;
    if (gameOver || weeklyModalOpen) return;

    // Waggon-Zuweisung hat Vorrang und "verbraucht" den Tipp komplett --
    // Ziel ist ein tatsaechlich fahrender Zug, keine Haltestelle/Linie.
    if (wagonArmed) {
      const hit = trainAt(x, y);
      if (hit) {
        hit.train.wagons += 1;
        hit.train.capacity = BASE_CAPACITY + hit.train.wagons * WAGON_CAPACITY;
        spareWagons -= 1;
        wagonArmed = false;
        updateHint();
        updateCounters();
      }
      return;
    }

    // Danach pruefen, ob gerade eine Haltestelle "scharf" fuer Loeschen ist
    // und dieser Tipp eines ihrer Symbole trifft -- das geht der normalen
    // Stations-/Zieh-Logik unten vor.
    if (armedDeleteStationId !== null) {
      const badges = getRemoveBadgePositions(armedDeleteStationId);
      const hit = badges.find((b) => Math.hypot(b.x - x, b.y - y) <= DELETE_BADGE_RADIUS + 8);
      if (hit) {
        removeStationFromLine(hit.lineIndex, armedDeleteStationId);
        disarmStationDelete();
        return;
      }
    }

    // Linien-Stummel hinter einer Endstation greifen -- verlaengert die
    // BESTEHENDE Linie (siehe drawLineStubs). Hat Vorrang vor einem
    // normalen Stations-Tipp, damit beide Gesten (Linie weiterziehen / neue
    // Linie starten) nebeneinander moeglich sind, siehe Datei-Kommentar.
    const stub = findLineStubAt(x, y);
    if (stub) {
      activeDrag = { lineIndex: stub.lineIndex, fromEnd: stub.end };
      return;
    }

    const station = stationAt(x, y);
    if (!station) {
      disarmStationDelete();
      return;
    }
    downStationId = station.id;

    // Eine Haltestelle DIREKT (nicht ueber ihren Linien-Stummel) angetippt:
    // startet IMMER eine neue Linie, auch wenn die Haltestelle schon
    // Endstation einer anderen Linie ist -- die bestehende Linie laesst
    // sich stattdessen ueber ihren Stummel weiterziehen (siehe oben).
    if (isMiddleOfAnyLine(station.id)) return; // mittendrin, kein Branching in dieser Version
    const freeSlot = firstFreeLineSlot();
    if (freeSlot === null) return;
    lines[freeSlot] = { color: LINE_COLORS[freeSlot], stationIds: [station.id], trains: [] };
    activeDrag = { lineIndex: freeSlot, fromEnd: "end" };
    freshLineIndex = freeSlot;
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
      // wieder entfernen (einfache "Undo per Zurueckziehen"-Geste). Das
      // funktioniert unveraendert auch, um einen frisch geschlossenen Ring
      // (siehe unten) wieder zu oeffnen.
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

    // Ist die Linie bereits ein geschlossener Ring (erste == letzte
    // Haltestelle), ist sie fertig -- keine weitere Verlaengerung moeglich.
    if (ids.length >= 2 && ids[0] === ids[ids.length - 1]) return;

    if (ids.includes(station.id)) {
      // Ringlinie: die EINZIGE erlaubte Wiederholung ist das Schliessen des
      // Rings zurueck zur ALLERERSTEN Haltestelle dieser Linie -- "einmal
      // rein, einmal raus" gilt fuer jede andere Haltestelle (auf
      // ausdruecklichen Nutzerwunsch, max. zweimal pro Haltestelle und nur
      // als Ringschluss).
      const canClose = !atStart && station.id === ids[0] && ids.length >= 3;
      if (!canClose) return;
      ids.push(station.id);
      tutorialDismissed = true;
      renderLineColumn();
      return;
    }

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
    if (!dragMoved && Math.hypot(x - prev.x, y - prev.y) > 3) {
      // Sobald wirklich gezogen wird, hat eine evtl. noch offene
      // Loeschen-Ansicht einer anderen Haltestelle keine Bedeutung mehr.
      dragMoved = true;
      disarmStationDelete();
    }
    for (const station of stationsAlongSegment(prev, { x, y })) {
      tryExtendActiveLine(station);
    }
    lastPointer = { x, y };
  }

  function handleUp(): void {
    if (!dragMoved) {
      // Ein reiner Tipp (kein Ziehen): eine dabei spekulativ angelegte NEUE
      // (noch leere) Linie wieder verwerfen -- sie soll nie dauerhaft einen
      // Linien-Slot belegen, wenn gar nicht wirklich gezogen wurde.
      if (freshLineIndex !== null) {
        const l = lines[freshLineIndex];
        if (l && l.stationIds.length < 2) {
          lines[freshLineIndex] = null;
          renderLineColumn();
        }
      }
      // Gilt sowohl fuer Endstationen (dort setzt handleDown activeDrag,
      // das ohne Bewegung aber folgenlos bleibt) als auch fuer Haltestellen
      // MITTEN auf einer Linie (dort setzt handleDown gar kein activeDrag)
      // -- deshalb hier bewusst nicht von activeDrag abhaengig.
      if (downStationId !== null && getLinesAtStation(downStationId).length > 0) {
        toggleStationDeleteArm(downStationId);
      }
    }
    activeDrag = null;
    lastPointer = null;
    downStationId = null;
    dragMoved = false;
    freshLineIndex = null;
  }

  // ------------------------------------------------------------------- Loop

  function tick(dt: number, size: { width: number; height: number }): void {
    lastSize = size;
    if (zooming) {
      zoomElapsedS += dt;
      if (zoomElapsedS >= GAMEOVER_ZOOM_S) {
        zooming = false;
        triggerGameOver();
      }
      return; // waehrend des Zooms laeuft keine normale Spiellogik mehr
    }
    if (!started || gameOver || weeklyModalOpen) return;

    tutorialPulseTimer += dt;

    // Zielwert haengt nur von der aktuellen Haltestellenzahl ab, die
    // tatsaechliche Annaeherung ist bewusst sehr traege (siehe
    // WORLD_ZOOM_LERP_RATE) -- dadurch verschwimmt jeder einzelne Schritt zu
    // einer ueber die ganze Runde verteilten, kaum wahrnehmbaren Bewegung.
    const zoomStartCount = SHAPES.length;
    const zoomSpan = Math.max(1, MAX_STATIONS - zoomStartCount);
    const zoomProgress = Math.max(0, Math.min(1, (stations.length - zoomStartCount) / zoomSpan));
    worldZoomTarget = 1 - zoomProgress * (1 - WORLD_ZOOM_MIN);
    worldZoom += (worldZoomTarget - worldZoom) * dt * WORLD_ZOOM_LERP_RATE;

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
          beginGameOverZoom(s);
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

      // Ressourcen-Vorrat (Loks/Waggons) -- auf ausdruecklichen Wunsch links
      // VERTIKAL MITTIG statt oben links.
      const resourceCol = document.createElement("div");
      resourceCol.className = "mm-panel mm-panel--left-mid";
      sparelokBtn = document.createElement("button");
      sparelokBtn.type = "button";
      sparelokBtn.className = "mm-resource";
      sparelokBtn.innerHTML = `<span class="mm-resource__icon">${icons.locomotive}</span><span class="mm-resource__count">0</span>`;
      sparelokBtn.addEventListener("click", () => onSparelokTap());
      wagonBtn = document.createElement("button");
      wagonBtn.type = "button";
      wagonBtn.className = "mm-resource";
      wagonBtn.innerHTML = `<span class="mm-resource__icon">${icons.wagon}</span><span class="mm-resource__count">0</span>`;
      wagonBtn.addEventListener("click", () => onWagonTap());
      resourceCol.append(sparelokBtn, wagonBtn);
      resourceColEl = resourceCol;
      env.overlay.appendChild(resourceCol);

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

      // Geschwindigkeitsregler -- eigene Zeile UNTER dem Uhr-/Tage-Panel,
      // rechts ausgerichtet wie die Vorlage.
      speedRowEl = document.createElement("div");
      speedRowEl.className = "mm-speed-row";
      pauseBtn = document.createElement("button");
      pauseBtn.type = "button";
      pauseBtn.className = "mm-speed-btn";
      pauseBtn.innerHTML = icons.pause;
      pauseBtn.addEventListener("click", () => setGameSpeed(0));
      playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "mm-speed-btn";
      playBtn.innerHTML = icons.play;
      playBtn.addEventListener("click", () => setGameSpeed(1));
      ffBtn = document.createElement("button");
      ffBtn.type = "button";
      ffBtn.className = "mm-speed-btn";
      ffBtn.innerHTML = icons.fastForward;
      ffBtn.addEventListener("click", () => setGameSpeed(2));
      speedRowEl.append(pauseBtn, playBtn, ffBtn);
      env.overlay.appendChild(speedRowEl);
      updateSpeedButtons();

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
          "Auch mehrere Haltestellen in einem Zug -- oder eine Linie an ihrem Stummel hinter der Endstation greifen und weiterziehen",
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
      tick(dt * gameSpeed, env.size);
    },

    render(env: GameEnv) {
      const { ctx, size } = env;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, size.width, size.height);
      if (!started) return;

      const pivot = getCameraPivot(size);
      ctx.save();
      // Persistenter Rauszoom (siehe WORLD_ZOOM_MIN) -- IMMER aktiv, auch
      // ganz am Rundenanfang (dort aber worldZoom praktisch 1, siehe
      // resetGame/tick, also visuell unveraendert).
      ctx.translate(pivot.x, pivot.y);
      ctx.scale(worldZoom, worldZoom);
      ctx.translate(-pivot.x, -pivot.y);

      if (zooming && zoomStation) {
        // Ease-out: schnell reinzoomen, gegen Ende sanft abbremsen -- wirkt
        // dynamischer als ein linearer Zoom. Setzt auf dem bereits aktiven
        // Welt-Zoom oben ON TOP auf (beide Transformationen verwenden
        // Weltkoordinaten, lassen sich also einfach verschachteln).
        const progress = Math.min(1, zoomElapsedS / GAMEOVER_ZOOM_S);
        const eased = 1 - Math.pow(1 - progress, 3);
        const zoom = 1 + (GAMEOVER_ZOOM_SCALE - 1) * eased;
        ctx.translate(zoomStation.x, zoomStation.y);
        ctx.scale(zoom, zoom);
        ctx.translate(-zoomStation.x, -zoomStation.y);
      }
      drawLines(ctx);
      drawLineStubs(ctx);
      drawDraftLine(ctx);
      drawTrains(ctx);
      drawStations(ctx);
      drawStationRemoveUI(ctx);
      ctx.restore();
      // Bewusst AUSSERHALB des Welt-Zooms -- der Tutorial-Pfeil ist ein
      // fester Bildschirm-Hinweis, kein Weltobjekt, und soll unabhaengig
      // vom aktuellen Zoom-Stand immer gleich gross/gleich positioniert sein.
      drawTutorialArrow(ctx, size);
    },

    onPointerDown(p: PointerPoint) {
      const w = screenToWorld(p.x, p.y);
      handleDown(w.x, w.y);
    },
    onPointerMove(p: PointerPoint) {
      const w = screenToWorld(p.x, p.y);
      handleMove(w.x, w.y);
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
      if (armedStationDeleteTimer) clearTimeout(armedStationDeleteTimer);
      armedStationDeleteTimer = null;
      highscoreBanner?.destroy();
      resourceColEl?.remove();
      speedRowEl?.remove();
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
