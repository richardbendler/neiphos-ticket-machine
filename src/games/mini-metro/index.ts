import type { GameEnv, MinigameModule, PointerPoint } from "../../core/Game";
import { theme } from "../../core/theme";
import { icons } from "../../core/icons";
import { showGameIntro } from "../../core/gameIntro";
import { openModal } from "../../core/modal";
import { getHighscoreBoard, getHighscoreOutcome, recordHighscore } from "../../core/storage";
import { promptHighscoreName } from "../../core/highscorePrompt";
import { mountHighscoreBanner, type HighscoreBannerHandle } from "../../core/highscoreBanner";
import { buildMenuButton } from "../../core/menuButton";
import { startTrainChug, stopTrainChug, playHighscoreOpenSound, playStationPopSound, playRandomStationAnnouncement } from "../../core/sound";
import { checkTicketEligibility, isTicketEligible, describeTicketReason, primaryTicketReason, recordDailyBestIfApplicable } from "../../core/ticketMethods";
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

// String statt strikter 3er-Union, damit die generierten Sondersymbole
// (siehe SPECIAL_SHAPE_DEFS/SPECIAL_SHAPES) sich einfach dazugesellen
// koennen -- ueberall im Code wird die Form ohnehin nur per Gleichheit
// verglichen (Ziel-Formsymbol == Haltestellen-Form), nie exhaustiv
// gematcht, ein reiner String-Typ ist hier also unproblematisch.
type StationShape = string;
const SHAPES: StationShape[] = ["circle", "square", "triangle"];

// Sondersymbol-Haltestellen (auf ausdruecklichen Wunsch: ein Pool von rund
// 20 verschiedenen geometrischen Formen, jedes zehnte Symbol, das spawnt,
// ist eins davon, siehe SPECIAL_STATION_INTERVAL/spawnStation) -- generisch
// aus regelmaessigen Vielecken/Sternen erzeugt statt 20 einzeln von Hand
// gezeichneter Icons: bleibt dadurch beliebig erweiterbar und jede Form ist
// allein durch ihre Ecken-/Zackenzahl klar von allen anderen (auch den drei
// normalen Formen) unterscheidbar.
type SpecialShapeDef = { kind: "polygon"; n: number } | { kind: "star"; n: number };
const SPECIAL_SHAPE_DEFS: Record<string, SpecialShapeDef> = {};
for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) SPECIAL_SHAPE_DEFS[`poly${n}`] = { kind: "polygon", n };
for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) SPECIAL_SHAPE_DEFS[`star${n}`] = { kind: "star", n };
const SPECIAL_SHAPES: StationShape[] = Object.keys(SPECIAL_SHAPE_DEFS);

function isSpecialShape(shape: StationShape): boolean {
  return !SHAPES.includes(shape);
}

// Jede zehnte gespawnte Haltestelle ist eine Sondersymbol-Haltestelle, siehe
// spawnStation (Spawn-Abstand siehe STATION_SPAWN_INTERVAL_S).
const SPECIAL_STATION_INTERVAL = 10;

// Sechs klar unterscheidbare Linienfarben aus der bestehenden Palette
// (core/theme.ts) -- mehr braucht dieses kleine Kartenformat nicht, echtes
// Mini Metro haelt Linien ab einer aehnlichen Groessenordnung selbst kaum
// noch auseinander.
const LINE_COLORS = ["#d6242c", "#0059a4", "#1f8a4c", "#e0a800", "#a53a97", "#0f7a86"];
const INITIAL_LINE_SLOTS = 2;
const MAX_LINE_SLOTS = LINE_COLORS.length;
// Auf ausdruecklichen Wunsch 30% dicker (war 5).
const LINE_WIDTH = 6.5;

// War lange Zeit zugleich eine harte Spawn-Obergrenze in spawnStation() --
// dadurch blieben Runden, die laenger als ca. eine Minute liefen, auf ewig
// bei genau 12 Haltestellen stehen (mehrfach gemeldeter Bug: "es kommen
// keine neuen mehr"). Auf ausdruecklichen Wunsch spawnen Haltestellen jetzt
// unbegrenzt weiter, solange die Runde laeuft -- MAX_STATIONS bleibt nur
// noch als Bezugsgroesse fuer den Kamera-Auszoom-Fortschritt (tick(),
// zoomProgress) bestehen: ab dieser Haltestellenzahl ist der Auszoom
// vollstaendig, mehr Haltestellen zoomen nicht noch weiter raus.
const MAX_STATIONS = 12;
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

// Eine Linie MITTEN zwischen zwei Haltestellen greifen, um dort eine neue
// Haltestelle einzufuegen (siehe midDrag/findLineSegmentAt) -- auf
// ausdruecklichen Wunsch: "irgendwo in der Mitte der Linie anfassen, dann
// einen Knick ziehen und an eine neue Station ranziehen".
const LINE_SEGMENT_HIT_RADIUS = 16;

// Kamera-Zoom auf die ueberlastete Haltestelle, BEVOR das (unveraenderte)
// Game-Over-Panel erscheint -- auf ausdruecklichen Wunsch. Nach Erreichen
// des vollen Zooms bleibt die Ansicht noch GAMEOVER_ZOOM_HOLD_MS lang genau
// dort stehen (nicht sofort das Ergebnis zeigen), ERST danach wird
// triggerGameOver() aufgerufen, das seinerseits wie gehabt den
// Highscore-Dialog um weitere 900ms verzoegert -- der Timer fuer den
// Highscore-Dialog startet also automatisch erst, wenn wirklich fertig
// rangezoomt UND kurz gehalten wurde.
const GAMEOVER_ZOOM_MS = 900;
const GAMEOVER_ZOOM_S = GAMEOVER_ZOOM_MS / 1000;
const GAMEOVER_ZOOM_HOLD_MS = 600;
const GAMEOVER_ZOOM_HOLD_S = GAMEOVER_ZOOM_HOLD_MS / 1000;
const GAMEOVER_ZOOM_SCALE = 3.4;

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
// Spawn-Abstand fuer neue Haltestellen -- war testweise alle 12 Spielstunden
// (DAY_HALF_S), seit Haltestellen aber nicht mehr bei 12 Stueck aufhoeren
// zu spawnen (siehe MAX_STATIONS-Kommentar), wurde die Runde dadurch zu
// schnell zu schwer (gemeldet). Jetzt wieder alle 24 Spielstunden (ein
// ganzer Tag), siehe tick().
const STATION_SPAWN_INTERVAL_S = DAY_MS / 1000;

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
// Die drei Start-Haltestellen sollen sichtbar in der Bildschirmmitte
// beginnen (auf ausdruecklichen Wunsch), statt gleich zu Rundenbeginn ueber
// die ganze Flaeche verstreut zu sein -- siehe resetGame/randomStationPosition.
const INITIAL_CLUSTER_RADIUS = 150;

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
// Auf ausdruecklichen Wunsch groesser (war 13px, dann 20px, dann 26px) --
// das Formsymbol sitzt jetzt MITTIG AUF dem Sprite statt daneben, das Tier
// ist gross genug, dass das Symbol nicht mehr zu viel davon verdeckt.
const PASSENGER_SPRITE_SIZE = 26;
const PASSENGER_ITEM_GAP = 12;
// Auf ausdruecklichen Wunsch 20% kleiner (war 6px), passend zum jetzt
// mittig auf dem Huepftier-Sprite sitzenden Formsymbol.
const SHAPE_BADGE_RADIUS = 4.8;

let idSeq = 1;
function nextId(): number {
  return idSeq++;
}

interface Passenger {
  id: number;
  destShape: StationShape;
  sprite: string;
  // Naechste physische Haltestelle DIESES Zuges (siehe arriveAtStation) --
  // entweder schon das Endziel (destShape erreicht) oder eine
  // Umstiege-Haltestelle, an der der Passagier wieder aussteigt und auf eine
  // andere Linie wartet. null, solange der Passagier noch wartet.
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

// Bahnansagen-Geraeuschkulisse (siehe core/sound.ts#playRandomStationAnnouncement)
// -- per Button an-/ausschaltbar, auf ausdruecklichen Wunsch geraetweit
// gemerkt (nicht nur fuer die laufende Runde), damit man es nicht bei jeder
// neuen Runde erneut anschalten muss.
const ANNOUNCEMENTS_STORAGE_KEY = "ntm:mini-metro:announcementsEnabled";
// Kein fester 10s-Takt, sondern ein zufaelliger Bereich UM 10 Sekunden herum
// -- wirkt dadurch weniger wie ein maschineller Timer, mehr wie echte,
// unregelmaessige Ansagen.
const ANNOUNCEMENT_INTERVAL_MIN_S = 7;
const ANNOUNCEMENT_INTERVAL_MAX_S = 13;

function loadAnnouncementsEnabled(): boolean {
  try {
    return localStorage.getItem(ANNOUNCEMENTS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveAnnouncementsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ANNOUNCEMENTS_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage evtl. nicht verfuegbar (z. B. privater Modus) -- dann
    // bleibt die Einstellung eben nur fuer die laufende Runde erhalten.
  }
}

function randomAnnouncementInterval(): number {
  return ANNOUNCEMENT_INTERVAL_MIN_S + Math.random() * (ANNOUNCEMENT_INTERVAL_MAX_S - ANNOUNCEMENT_INTERVAL_MIN_S);
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
  // Eigener, von dayTimerS UNABHAENGIGER Timer fuer neue Haltestellen (siehe
  // STATION_SPAWN_INTERVAL_S/tick()).
  let stationSpawnTimerS = 0;
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

  // Nur waehrend WIRKLICH mindestens ein Zug auf einer Linie faehrt (siehe
  // tick()/updateTrainChug) laeuft das Zug-Grundrauschen -- verhindert, dass
  // es schon vor der ersten gezogenen Linie zu hoeren ist (gemeldeter Bug).
  let trainChugPlaying = false;

  // Bahnansagen-Geraeuschkulisse (siehe ANNOUNCEMENTS_STORAGE_KEY oben) --
  // announcementTimerS zaehlt in tick() hoch, bei Erreichen von
  // announcementNextS spielt eine zufaellige Ansage und der naechste
  // (wieder zufaellige) Abstand wird gewuerfelt.
  let announcementsEnabled = loadAnnouncementsEnabled();
  let announcementTimerS = 0;
  let announcementNextS = randomAnnouncementInterval();
  let announcementBtn: HTMLButtonElement;
  let announcementPanelEl: HTMLDivElement;

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

  // Eine Linie MITTEN zwischen zwei Haltestellen greifen, um dort per Zug
  // eine neue Haltestelle einzufuegen (siehe findLineSegmentAt/handleUp) --
  // afterIdx = Index der Haltestelle VOR der Einfuegestelle in
  // line.stationIds, d. h. das betroffene Segment liegt zwischen afterIdx
  // und afterIdx+1.
  let midDrag: { lineIndex: number; afterIdx: number } | null = null;

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

  // Ein bereits fahrender Zug wird direkt gegriffen (siehe trainAt/handleDown,
  // nur ausserhalb einer Haltestelle -- dwell > 0 zaehlt nicht) und beim
  // Loslassen auf DERSELBEN Linie an der naechstgelegenen Stelle wieder
  // abgesetzt (siehe placeTrainAtSegment/handleUp). Waehrend des Ziehens
  // folgt die Lok direkt dem Zeiger (siehe drawTrains), auf ausdruecklichen
  // Wunsch statt des bisherigen "erst rechts die Linie antippen"-Umwegs.
  let trainDrag: { line: Line; train: Train } | null = null;

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
  // Fuers Umrechnen von Client- in Canvas-/Weltkoordinaten beim Ziehen eines
  // Vorrats-Icons (siehe wireResourceDrag) -- die Icons selbst sind normale
  // DOM-Buttons ausserhalb des Canvas, das Ziel (Linien-Kreis rechts bzw.
  // fahrender Zug auf der Strecke) muss aber ueber echte Pointer-Events
  // (nicht die Spiel-eigene onPointerDown/Move/Up-Pipeline) verfolgt werden,
  // damit der Ziehvorgang unabhaengig vom Canvas ueber den ganzen Bildschirm
  // hinweg funktioniert.
  let canvasEl: HTMLCanvasElement | null = null;
  // Bricht einen evtl. noch aktiven Vorrats-Ziehvorgang (siehe
  // wireResourceDrag) beim Verlassen des Spiels sauber ab, damit dessen
  // window-Pointer-Listener nicht ueber das Spielende hinaus haengen bleiben.
  let cancelActiveResourceDrag: (() => void) | null = null;
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

  /**
   * clusterRadius (optional): statt im GESAMTEN (durch worldZoom evtl.
   * bereits vergroesserten) Weltbereich zu wuerfeln, wird der Kandidat auf
   * einen Kreis mit diesem Radius um den Kamera-Drehpunkt beschraenkt -- auf
   * ausdruecklichen Wunsch fuer die drei Start-Haltestellen (siehe
   * INITIAL_CLUSTER_RADIUS/resetGame), damit die Runde sichtbar in der
   * Bildschirmmitte beginnt und das Netz von dort aus nach aussen waechst,
   * statt von Anfang an ueber die ganze Flaeche verstreut zu sein.
   */
  function randomStationPosition(size: { width: number; height: number }, clusterRadius?: number): { x: number; y: number } | null {
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
      let x: number;
      let y: number;
      if (clusterRadius !== undefined) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * clusterRadius;
        x = pivot.x + Math.cos(angle) * r;
        y = pivot.y + Math.sin(angle) * r;
      } else {
        x = left + Math.random() * w;
        y = top + Math.random() * h;
      }
      if (stations.every((s) => Math.hypot(s.x - x, s.y - y) >= MIN_STATION_DIST)) {
        return { x, y };
      }
    }
    return null;
  }

  /** Noch nicht in dieser Runde vergebene Sondersymbol-Form auswuerfeln -- null, falls (theoretisch) schon alle 20 vergeben sind. */
  function pickUnusedSpecialShape(): StationShape | null {
    const used = new Set(stations.map((s) => s.shape));
    const options = SPECIAL_SHAPES.filter((s) => !used.has(s));
    if (options.length === 0) return null;
    return options[Math.floor(Math.random() * options.length)];
  }

  function spawnStation(size: { width: number; height: number }, shape?: StationShape, clusterRadius?: number): void {
    const pos = randomStationPosition(size, clusterRadius);
    if (!pos) return;
    // Jede zehnte gespawnte Haltestelle (ueber alle Haltestellen dieser
    // Runde gezaehlt, auch die drei Start-Haltestellen) ist eine
    // Sondersymbol-Haltestelle -- nur, wenn die Form nicht explizit
    // vorgegeben wurde (siehe resetGame, das gibt fuer die drei
    // Start-Haltestellen bewusst je eine der drei Grundformen vor).
    const ordinal = stations.length + 1;
    let resolvedShape = shape;
    if (!resolvedShape && ordinal % SPECIAL_STATION_INTERVAL === 0) {
      resolvedShape = pickUnusedSpecialShape() ?? undefined;
    }
    if (!resolvedShape) {
      resolvedShape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    }
    const s: Station = {
      id: nextId(),
      shape: resolvedShape,
      x: pos.x,
      y: pos.y,
      waiting: [],
      overloadT: 0,
    };
    stations.push(s);
    passengerTimers.set(s.id, PASSENGER_SPAWN_INTERVAL_S * (0.5 + Math.random()));
    playStationPopSound();
  }

  function spawnPassenger(station: Station): void {
    // Sondersymbol-Ziele nur fuer Haltestellen, die JETZT SCHON existieren
    // (auf ausdruecklichen Wunsch) -- da hier direkt ueber die aktuell
    // existierenden `stations` iteriert wird, kommen spaeter gespawnte
    // Sondersymbol-Haltestellen automatisch erst ab ihrem eigenen
    // Spawn-Zeitpunkt als Fahrtziel infrage, nie rueckwirkend.
    const specialDestShapes = stations.filter((s) => s.shape !== station.shape && isSpecialShape(s.shape)).map((s) => s.shape);
    const options = [...SHAPES.filter((s) => s !== station.shape), ...specialDestShapes];
    const destShape = options[Math.floor(Math.random() * options.length)];
    const sprite = PASSENGER_SPRITES[Math.floor(Math.random() * PASSENGER_SPRITES.length)];
    station.waiting.push({ id: nextId(), destShape, sprite, nextStop: null });
  }

  // ------------------------------------------------------------------ Linien

  /** Wie buildAdjacency, aber ohne die Kanten EINER bestimmten Linie -- siehe stationsReachableAhead. */
  function buildAdjacencyExcluding(excludeLine: Line): Map<number, Set<number>> {
    const adj = new Map<number, Set<number>>();
    for (const s of stations) adj.set(s.id, new Set());
    for (const line of lines) {
      if (!line || line === excludeLine) continue;
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
   * Alle Haltestellen, die ein Zug ab jetzt OHNE Umkehren noch erreichen
   * wird: erst die verbleibenden Haltestellen dieser Linie in der
   * aktuellen Fahrtrichtung (bei einer Ringlinie faehrt er ohnehin
   * frueher oder spaeter an jeder davon vorbei), dann -- ab JEDER davon --
   * rekursiv/transitiv alles, was ueber andere Linien erreichbar ist
   * (Umstieg zaehlt unabhaengig von deren Richtung, siehe Datei-Kommentar
   * bei buildAdjacencyExcluding: die TRANSITIVE Ausweitung nutzt bewusst
   * NICHT nochmal die Kanten dieser Linie selbst, sonst wuerde ueber die
   * direkte Nachbarschaft zur Ausgangs-Haltestelle faelschlich auch die
   * Gegenrichtung als "erreichbar" durchsickern).
   *
   * Grundlage fuer die Einstiegs-Entscheidung in arriveAtStation: ein
   * Fahrgast steigt nur ein, wenn seine Zielform auf diesem Weg ueberhaupt
   * noch vorkommt -- sonst lieber auf die Rueckfahrt/einen anderen Zug
   * warten, statt unnoetig Kapazitaet zu blockieren (gemeldeter Wunsch).
   */
  function stationsReachableAhead(line: Line, fromIdx: number, dir: 1 | -1): Set<number> {
    const ahead = new Set<number>();
    if (isRingLine(line)) {
      for (const id of line.stationIds) ahead.add(id);
    } else {
      let idx = fromIdx;
      while (idx >= 0 && idx < line.stationIds.length) {
        ahead.add(line.stationIds[idx]);
        idx += dir;
      }
    }
    const adjOther = buildAdjacencyExcluding(line);
    const visited = new Set(ahead);
    const queue = [...ahead];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of adjOther.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    return visited;
  }

  function ensureTrainOnNewLine(line: Line): void {
    if (line.trains.length === 0 && line.stationIds.length >= 2) {
      line.trains.push(createTrain());
    }
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

  /**
   * Je betroffener Linie normalerweise EIN Symbol, positioniert "weg von der
   * Linie" (Gegenrichtung der Summe aller Nachbarrichtungen an dieser
   * Haltestelle auf dieser Linie).
   *
   * Ausnahme (auf ausdruecklichen Wunsch): beruehrt eine Linie diese
   * Haltestelle ZWEIMAL (z. B. eine Ringlinie, die hier raus- und wieder
   * reinfaehrt) UND mindestens eines der beiden Vorkommen ist ein echtes
   * Linienende, ist "nimm diese Haltestelle aus der Linie" mehrdeutig --
   * es gibt zwei unterschiedliche Ergebnisse je nachdem, welche der beiden
   * Seiten gekappt wird. In diesem Fall gibt es je Vorkommen ein eigenes,
   * einzeln antippbares Symbol (occurrenceIdx gesetzt) statt nur eines, das
   * automatisch beide Vorkommen entfernt (siehe removeStationOccurrenceFromLine
   * vs. removeStationFromLine). Liegen dagegen BEIDE Vorkommen mitten in der
   * Linie (reines Durchfahren, kein Linienende betroffen), bleibt es beim
   * bisherigen einzelnen Symbol -- da ist das Ergebnis eindeutig.
   */
  function getRemoveBadgePositions(
    stationId: number,
  ): Array<{ lineIndex: number; x: number; y: number; color: string; occurrenceIdx?: number }> {
    const station = stationById(stationId);

    function awayDirection(line: Line, idx: number): { x: number; y: number } {
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
      const awayLen = Math.hypot(awayX, awayY);
      if (awayLen < 0.001) {
        awayX = 0;
        awayY = -1;
      } else {
        awayX /= awayLen;
        awayY /= awayLen;
      }
      return { x: awayX, y: awayY };
    }

    const raw: Array<{ lineIndex: number; color: string; occurrenceIdx?: number; away: { x: number; y: number } }> = [];
    for (const lineIndex of getLinesAtStation(stationId)) {
      const line = lines[lineIndex]!;
      const occurrences: number[] = [];
      line.stationIds.forEach((id, idx) => {
        if (id === stationId) occurrences.push(idx);
      });
      const touchesEnd = occurrences.some((idx) => idx === 0 || idx === line.stationIds.length - 1);
      if (occurrences.length >= 2 && touchesEnd) {
        for (const idx of occurrences) {
          raw.push({ lineIndex, color: line.color, occurrenceIdx: idx, away: awayDirection(line, idx) });
        }
      } else {
        const idx = occurrences[0];
        raw.push({ lineIndex, color: line.color, away: awayDirection(line, idx) });
      }
    }

    // Bei mehreren betroffenen Symbolen (egal ob mehrere Linien oder mehrere
    // Vorkommen derselben Linie) leicht faechern, damit sie sich nicht
    // gegenseitig ueberlappen.
    return raw.map((b, i, arr) => {
      const baseAngle = Math.atan2(b.away.y, b.away.x);
      const spread = (i - (arr.length - 1) / 2) * 0.5;
      const angle = baseAngle + spread;
      return {
        lineIndex: b.lineIndex,
        occurrenceIdx: b.occurrenceIdx,
        x: station.x + Math.cos(angle) * DELETE_BADGE_OFFSET,
        y: station.y + Math.sin(angle) * DELETE_BADGE_OFFSET,
        color: b.color,
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

  /** Gegenstueck zu reindexTrainsForSplice -- eine neue Haltestelle wird direkt NACH afterIdx eingefuegt, alles danach rueckt um eins nach hinten. */
  function reindexTrainsForInsert(line: Line, afterIdx: number): void {
    for (const t of line.trains) {
      if (t.fromIdx > afterIdx) t.fromIdx += 1;
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
  /** Eine einzelne Position im stationIds-Array entfernen, mit passender Index-Nachfuehrung der Zuege -- gemeinsam genutzt von removeStationFromLine (alle Vorkommen) und removeStationOccurrenceFromLine (nur ein Vorkommen). */
  function removeStationIndexFromLine(line: Line, idx: number): void {
    if (idx === 0) {
      line.stationIds.shift();
      for (const t of line.trains) t.fromIdx = Math.max(0, t.fromIdx - 1);
    } else if (idx === line.stationIds.length - 1) {
      line.stationIds.pop();
    } else {
      reindexTrainsForSplice(line, idx);
      line.stationIds.splice(idx, 1);
    }
  }

  function removeStationFromLine(lineIndex: number, stationId: number): void {
    const line = lines[lineIndex];
    if (!line) return;
    let idx = line.stationIds.indexOf(stationId);
    while (idx !== -1) {
      removeStationIndexFromLine(line, idx);
      idx = line.stationIds.indexOf(stationId);
    }
    for (const t of line.trains) clampTrainIndex(line, t);
    if (line.stationIds.length < 2) line.trains = [];
    renderLineColumn();
  }

  /**
   * Entfernt NUR EIN bestimmtes Vorkommen einer Haltestelle aus der Linie
   * (per Array-Index, nicht per stationId) -- fuer den Sonderfall, dass
   * dieselbe Haltestelle zweimal auf derselben Linie liegt und mindestens
   * eines der beiden Vorkommen ein echtes Linienende ist (siehe
   * getRemoveBadgePositions). Anders als removeStationFromLine bleibt das
   * JEWEILS ANDERE Vorkommen unangetastet stehen.
   */
  function removeStationOccurrenceFromLine(lineIndex: number, occurrenceIdx: number): void {
    const line = lines[lineIndex];
    if (!line) return;
    if (occurrenceIdx < 0 || occurrenceIdx >= line.stationIds.length) return;
    removeStationIndexFromLine(line, occurrenceIdx);
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

  /**
   * Welche Richtung der Zug ab JETZT tatsaechlich weiterfaehrt -- bei einer
   * (nicht geschlossenen) Linie faehrt ein an der Endstation ankommender
   * Zug in der GEGENRICHTUNG weiter, aber train.dir selbst wird dafuer erst
   * einen Tick SPAETER umgedreht (siehe stepTrain, das passiert erst NACH
   * dem Dwell, nicht schon beim Ankommen). Direkt bei der Ankunft
   * (arriveAtStation) zeigt train.dir deshalb noch in die ALTE Richtung --
   * fuer die Einstiegs-Entscheidung dort (welche Ziele liegen "voraus")
   * braucht es aber die tatsaechliche NAECHSTE Richtung, sonst haelt man an
   * der Endstation faelschlich fuer eine Sackgasse (gemeldeter Bug: "an der
   * Endstation wird gar nichts mehr eingesammelt, obwohl da Passagiere fuer
   * die Rueckfahrt warten"). Bei einer Ringlinie gibt es keine Umkehr, dort
   * bleibt dir unveraendert.
   */
  function effectiveDepartureDir(line: Line, fromIdx: number, dir: 1 | -1): 1 | -1 {
    if (isRingLine(line)) return dir;
    const rawToIdx = fromIdx + dir;
    if (rawToIdx < 0 || rawToIdx >= line.stationIds.length) return (dir * -1) as 1 | -1;
    return dir;
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

  /**
   * Naechster Punkt auf dem tatsaechlichen Streckenverlauf einer Linie zu
   * einer gegebenen Weltposition -- fuer das Wiederabsetzen eines gegriffenen
   * Zuges (siehe trainDrag/handleUp). segIdx bezeichnet das Segment
   * stationIds[segIdx] -> stationIds[segIdx+1], ratio (0..1) die Position
   * darauf. Funktioniert unveraendert auch fuer Ringlinien: deren
   * geschlossenes Segment (letzter -> erster Eintrag) ist bereits regulaerer
   * Teil von stationIds (siehe isRingLine-Kommentar), keine Sonderbehandlung
   * noetig.
   */
  function nearestPointOnLinePath(line: Line, x: number, y: number): { segIdx: number; ratio: number } | null {
    let best: { segIdx: number; ratio: number; dist: number } | null = null;
    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const a = stationById(line.stationIds[i]);
      const b = stationById(line.stationIds[i + 1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const ratio = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / lenSq));
      const px = a.x + dx * ratio;
      const py = a.y + dy * ratio;
      const dist = Math.hypot(px - x, py - y);
      if (!best || dist < best.dist) best = { segIdx: i, ratio, dist };
    }
    return best;
  }

  /**
   * Setzt einen gegriffenen Zug an einer Stelle seiner eigenen Linie ab --
   * schaut dabei auf ausdruecklichen Wunsch immer zu der der Ablegeposition
   * NAEHEREN der beiden Nachbar-Haltestellen (nicht in "normaler"
   * Fahrtrichtung weiter): bei ratio < 0.5 (naeher an der Startseite des
   * Segments) zeigt die Lok zurueck zu dieser Station (dir=-1), sonst zur
   * Zielseite (dir=1). Die normale Fahrsimulation (stepTrain) laeuft ab da
   * unveraendert weiter, der Zug faehrt also ganz regulaer erst zur nun
   * naeheren Station und von dort aus normal weiter.
   */
  function placeTrainAtSegment(train: Train, segIdx: number, ratio: number): void {
    if (ratio < 0.5) {
      train.fromIdx = segIdx + 1;
      train.dir = -1;
      train.t = 1 - ratio;
    } else {
      train.fromIdx = segIdx;
      train.dir = 1;
      train.t = ratio;
    }
    train.dwell = 0;
    train.boardQueue = [];
    train.boardTimer = 0;
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

    // Fuer BEIDES (Aussteigen-Sonderfall unten UND Einsteigen) vorab
    // berechnet: was liegt ab hier in der tatsaechlichen naechsten
    // Fahrtrichtung dieses Zuges ueberhaupt noch (direkt oder ueber
    // Anschlusslinien) erreichbar? effectiveDepartureDir statt train.dir
    // direkt -- an der Endstation ist train.dir bei der Ankunft noch NICHT
    // umgedreht, das passiert erst einen Tick spaeter (siehe dortigen
    // Kommentar).
    const departDir = effectiveDepartureDir(line, train.fromIdx, train.dir);
    const nextIdx = nextTrainIdx(line, train.fromIdx, departDir);
    const nextStopId = line.stationIds[nextIdx];
    const aheadIds = stationsReachableAhead(line, train.fromIdx, departDir);
    const aheadShapes = new Set(stations.filter((s) => aheadIds.has(s.id)).map((s) => s.shape));

    // Erst abladen, dann erst einladen -- macht sofort wieder Platz frei
    // fuer neue Fahrgaeste an derselben Haltestelle.
    //
    // WICHTIG (gemeldeter Bug: "nicht alle passenden Passagiere werden
    // abgelegt"): die Endziel-Pruefung (station.shape === p.destShape) laeuft
    // IMMER zuerst, unabhaengig vom gespeicherten nextStop -- ein Fahrgast,
    // dessen Zielform genau hier erreicht ist, steigt IMMER aus, auch wenn
    // sein zuletzt gesetztes nextStop (naechster Umstiegs-Halt) zufaellig
    // noch auf eine ANDERE Haltestelle zeigte.
    //
    // NEU (gemeldeter Bug: "eine Linie nimmt Passagiere mit, die ihr Ziel
    // damit gar nicht erreichen koennen"): ein noch mitfahrender Fahrgast,
    // dessen Ziel ab hier in der (evtl. inzwischen umgebauten) Streckenfuehrung
    // gar nicht mehr erreichbar ist, steigt hier ebenfalls aus (statt
    // sinnlos weiterzufahren) -- kann sonst passieren, wenn waehrend der
    // Fahrt eine Haltestelle aus der Linie entfernt wurde, die fuer die
    // Weiterfahrt noetig gewesen waere.
    const staying: Passenger[] = [];
    for (const p of train.carrying) {
      if (station.shape === p.destShape) {
        delivered += 1;
      } else if (p.nextStop === station.id || !aheadShapes.has(p.destShape)) {
        // Umstiege-Haltestelle erreicht ODER Ziel ab hier nicht mehr
        // erreichbar: zurueck in die Warteschlange, die naechste Ankunft
        // (egal welche Linie) sucht von hier aus neu.
        p.nextStop = null;
        station.waiting.push(p);
      } else {
        staying.push(p);
      }
    }
    train.carrying = staying;

    // Einsteigende werden nur AUSGEWAEHLT, aber (anders als frueher) noch
    // NICHT sofort aus station.waiting entfernt/in train.carrying verschoben
    // -- das passiert gestaffelt in stepTrain (siehe BOARD_STAGGER_S), damit
    // sie sichtbar nacheinander einsteigen statt alle im selben Frame.
    //
    // Auf ausdruecklichen Wunsch "smart" einsteigen: nur, wenn die Zielform
    // des Fahrgasts ueberhaupt noch in der AKTUELLEN Fahrtrichtung dieses
    // Zuges vorkommt (direkt auf dieser Linie oder -- rekursiv/transitiv --
    // ueber eine von dort erreichbare Anschlusslinie), siehe
    // stationsReachableAhead. Kommt die Zielform nur noch in der
    // Gegenrichtung vor, bleibt der Fahrgast lieber stehen (wartet auf die
    // Rueckfahrt bzw. einen anderen Zug), statt unnoetig Kapazitaet zu
    // blockieren.
    const boarding: Passenger[] = [];
    for (const p of station.waiting) {
      if (train.carrying.length + boarding.length >= train.capacity) continue;
      if (!aheadShapes.has(p.destShape)) continue;
      p.nextStop = nextStopId;
      boarding.push(p);
    }
    train.boardQueue = boarding;
    updateCounters();
  }

  // -------------------------------------------------------------- Wochenwahl

  function triggerWeekChange(): void {
    spareLoks += 1;
    weeklyModalOpen = true;
    playHighscoreOpenSound(); // dieselbe DB-Ansage wie beim Highscore-Board/-Erfolg, siehe core/sound.ts
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
        p.innerHTML = `Tag ${gameDay} erreicht!`;
        panel.appendChild(p);

        // Eigenes, kleineres Element in Gruen -- auf ausdruecklichen Wunsch
        // klar erkennbar ANDERS als die beiden Wahl-Buttons unten: die Lok
        // ist bereits sicher, dafuer muss nichts angeklickt werden.
        const grant = document.createElement("div");
        grant.className = "mm-week-modal__grant";
        grant.innerHTML = `${icons.locomotive}<span>+1 Lok -- bekommst du automatisch</span>`;
        panel.appendChild(grant);

        const chooseText = document.createElement("p");
        chooseText.className = "mm-week-modal__text";
        chooseText.textContent = "Wähle zusätzlich:";
        panel.appendChild(chooseText);

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

  /** Direktes Ziehziel fuer eine Lok aus dem Vorrat (siehe wireResourceDrag): ein Linien-Kreis rechts unter dem Zeiger, dieselbe Wirkung wie der bisherige sparelokArmed-Weg ueber onLineCircleTap. */
  function tryAttachLocoAt(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(clientX, clientY);
    const circleBtn = el?.closest(".mm-line-circle") as HTMLElement | null;
    if (!circleBtn) return false;
    const index = lineCircles.indexOf(circleBtn as HTMLButtonElement);
    if (index < 0) return false;
    const line = lines[index];
    if (!line || line.stationIds.length < 2) return false;
    spareLoks -= 1;
    line.trains.push(createTrain());
    updateCounters();
    renderLineColumn();
    return true;
  }

  /** Direktes Ziehziel fuer einen Waggon aus dem Vorrat (siehe wireResourceDrag): ein fahrender Zug auf dem Canvas unter dem Zeiger, dieselbe Wirkung wie der bisherige wagonArmed-Weg ueber handleDown/trainAt. */
  function tryAttachWagonAt(clientX: number, clientY: number): boolean {
    if (!canvasEl) return false;
    const rect = canvasEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const world = screenToWorld(clientX - rect.left, clientY - rect.top);
    const hit = trainAt(world.x, world.y);
    if (!hit) return false;
    hit.train.wagons += 1;
    hit.train.capacity = BASE_CAPACITY + hit.train.wagons * WAGON_CAPACITY;
    spareWagons -= 1;
    updateCounters();
    return true;
  }

  /**
   * Verkabelt ein Vorrats-Icon (Lok/Waggon links) mit einer echten
   * Ziehen-und-Ablegen-Geste ZUSAETZLICH zum bisherigen "antippen zum
   * Scharfstellen, dann Ziel separat antippen"-Weg (onSparelokTap/
   * onWagonTap bleiben unveraendert als Ein-Finger-Fallback bei einem
   * reinen Tipp ohne Bewegung). Auf ausdruecklichen Nutzerwunsch: das Icon
   * soll sich direkt auf sein Ziel ziehen lassen. Nutzt echte Pointer-Events
   * auf window (statt der Canvas-eigenen onPointerDown/Move/Up-Pipeline),
   * weil der Ziehweg ueber DOM-Elemente ausserhalb des Canvas (Linien-Kreise)
   * fuehren kann.
   */
  function wireResourceDrag(btn: HTMLButtonElement, kind: "loco" | "wagon"): void {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let ghost: HTMLDivElement | null = null;

    function cleanup(): void {
      dragging = false;
      moved = false;
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (cancelActiveResourceDrag === onCancel) cancelActiveResourceDrag = null;
    }

    function onMove(e: PointerEvent): void {
      if (!dragging) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
        moved = true;
        ghost = document.createElement("div");
        ghost.className = "mm-resource-drag-ghost";
        ghost.innerHTML = kind === "loco" ? icons.locomotive : icons.wagon;
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      }
    }

    function onUp(e: PointerEvent): void {
      const wasMoved = moved;
      cleanup();
      if (!wasMoved) {
        if (kind === "loco") onSparelokTap();
        else onWagonTap();
        return;
      }
      // Ausserhalb eines gueltigen Ziels losgelassen: einfach abbrechen,
      // der Vorrat bleibt unangetastet -- kein Fehlerhinweis noetig, das
      // Icon ist ja sichtbar zur Ausgangsposition zurueckgesprungen.
      if (kind === "loco") tryAttachLocoAt(e.clientX, e.clientY);
      else tryAttachWagonAt(e.clientX, e.clientY);
    }

    function onCancel(): void {
      cleanup();
    }

    btn.addEventListener("pointerdown", (e) => {
      if (btn.disabled) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      cancelActiveResourceDrag = onCancel;
    });
  }

  /** Startet/stoppt das Zug-Grundrauschen je nachdem, ob gerade wirklich ein Zug auf einer Linie faehrt (siehe tick()) -- vermeidet unnoetige startTrainChug()/stopTrainChug()-Aufrufe bei unveraendertem Zustand. */
  function updateTrainChug(anyTrainRunning: boolean): void {
    if (anyTrainRunning && !trainChugPlaying) {
      trainChugPlaying = true;
      // Durchgehendes, leises Zug-Grundrauschen -- deutlich leiser als bei
      // den Spielen mit einer einzelnen animierten Fahrt (dort 0.35), da es
      // hier ggf. die ganze Runde ueber im Hintergrund laeuft und nicht der
      // eigentliche Fokusmoment ist.
      startTrainChug(0.1);
    } else if (!anyTrainRunning && trainChugPlaying) {
      trainChugPlaying = false;
      stopTrainChug();
    }
  }

  /** Startet den Kamera-Zoom auf die ueberlastete Haltestelle -- triggerGameOver() (unveraendert, inkl. Text und Highscore-Delay) folgt erst nach GAMEOVER_ZOOM_S, siehe tick(). */
  function beginGameOverZoom(station: Station): void {
    if (gameOver || zooming) return;
    zooming = true;
    zoomStation = station;
    zoomElapsedS = 0;
    trainChugPlaying = false;
    stopTrainChug();
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
    const ticketResult = checkTicketEligibility({ gameId: GAME_ID, value: delivered, direction: "higher-better", highscoreOutcome: outcome });
    if ((outcome !== "none" || isTicketEligible(ticketResult)) && delivered > 0) {
      highscoreTimer = setTimeout(() => {
        highscoreTimer = null;
        const gameTitle = "Hüpftier-Metro";
        const scoreText = formatDelivered(delivered);
        const { title, message } = describeTicketReason(
          ticketResult,
          `${scoreText} befördert — ${outcome === "tied-best" ? "eingestellter Bestwert!" : "neuer Bestwert!"}`,
          gameTitle,
          scoreText,
        );
        closeHighscoreModal = promptHighscoreName({
          title,
          message,
          gameTitle,
          scoreText,
          ticketReason: primaryTicketReason(ticketResult),
          onDone: (name) => {
            closeHighscoreModal = null;
            if (name === null) return;
            highscoreBanner.update(recordHighscore(GAME_ID, name, delivered, "higher-better"));
            recordDailyBestIfApplicable(GAME_ID, undefined, name, delivered, "higher-better");
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
    stationSpawnTimerS = 0;
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
    midDrag = null;
    setGameSpeed(1);
    disarmStationDelete();
    gameOverPanel.style.display = "none";
    // Das leise Zug-Grundrauschen startet NICHT hier automatisch mit der
    // Runde, sondern erst in tick(), sobald wirklich ein Zug faehrt (siehe
    // updateTrainChug) -- auf ausdruecklichen Wunsch: vorher lief der Sound
    // schon los, bevor ueberhaupt eine Linie gezogen war (gemeldeter Bug).
    // trainChugPlaying muss trotzdem bei jeder neuen Runde zurueckgesetzt
    // werden, falls die vorherige Runde mit laufendem Sound endete.
    trainChugPlaying = false;
    announcementTimerS = 0;
    announcementNextS = randomAnnouncementInterval();
    // Start = genau eine Haltestelle je Form (Nutzerwunsch) -- lastSize wird
    // in tick() laufend aktualisiert, siehe dort.
    for (const shape of SHAPES) spawnStation(lastSize, shape, INITIAL_CLUSTER_RADIUS);
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
    } else if (shape === "triangle") {
      const s = r * 1.9;
      ctx.moveTo(x, y - s * 0.62);
      ctx.lineTo(x + s * 0.55, y + s * 0.42);
      ctx.lineTo(x - s * 0.55, y + s * 0.42);
      ctx.closePath();
    } else {
      drawSpecialShapePath(ctx, shape, x, y, r);
    }
  }

  /**
   * Sondersymbole (siehe SPECIAL_SHAPE_DEFS): regelmaessiges Vieleck oder
   * Stern, generisch aus Eckenzahl/Zackenzahl erzeugt statt 20 einzeln von
   * Hand gezeichneter Pfade -- ctx.beginPath() ist bereits von
   * drawShapeOutline aufgerufen, hier wird nur der Pfad selbst gefuellt.
   */
  function drawSpecialShapePath(ctx: CanvasRenderingContext2D, shape: StationShape, x: number, y: number, r: number): void {
    const def = SPECIAL_SHAPE_DEFS[shape];
    if (!def) {
      ctx.arc(x, y, r, 0, Math.PI * 2); // sollte nie eintreten, sicherer Fallback
      return;
    }
    const outerR = r * 1.15;
    if (def.kind === "polygon") {
      for (let i = 0; i < def.n; i++) {
        const a = -Math.PI / 2 + (i / def.n) * Math.PI * 2;
        const px = x + Math.cos(a) * outerR;
        const py = y + Math.sin(a) * outerR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    } else {
      const innerR = outerR * 0.45;
      const points = def.n * 2;
      for (let i = 0; i < points; i++) {
        const a = -Math.PI / 2 + (i / points) * Math.PI * 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        const px = x + Math.cos(a) * rad;
        const py = y + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
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
        const itemW = size + PASSENGER_ITEM_GAP;
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
          // Formsymbol MITTIG auf dem Huepftier-Sprite (auf ausdruecklichen
          // Wunsch) -- das Sprite ist inzwischen gross genug dafuer (siehe
          // PASSENGER_SPRITE_SIZE), drawMiniShapeBadge zeichnet selbst schon
          // einen weissen Kreis dahinter, das Symbol bleibt also unabhaengig
          // von der Tierfarbe gut lesbar.
          drawMiniShapeBadge(ctx, p.destShape, px + size / 2, py + size / 2, SHAPE_BADGE_RADIUS);
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
        // Gerade gegriffener Zug (siehe trainDrag): folgt bis zum Loslassen
        // direkt dem Zeiger statt der normalen Streckenposition, halbtrans-
        // parent als Griff-Feedback, ohne Waggons/Fahrgast-Symbole (die
        // haengen erst wieder dran, sobald der Zug abgesetzt ist).
        if (trainDrag && trainDrag.train === train) {
          if (lastPointer) {
            ctx.save();
            ctx.globalAlpha = 0.55;
            drawLoco(ctx, lastPointer.x, lastPointer.y, 0, line.color);
            ctx.restore();
          }
          continue;
        }
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

  /** Waehrend eine Linie mitten zwischen zwei Haltestellen gegriffen wird (siehe midDrag/findLineSegmentAt): gestrichelter Knick von der Haltestelle davor ueber den Zeiger zur Haltestelle danach. */
  function drawMidDragKink(ctx: CanvasRenderingContext2D): void {
    if (!midDrag || !lastPointer) return;
    const line = lines[midDrag.lineIndex];
    if (!line) return;
    const a = stationById(line.stationIds[midDrag.afterIdx]);
    const b = stationById(line.stationIds[midDrag.afterIdx + 1]);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(lastPointer.x, lastPointer.y);
    ctx.lineTo(b.x, b.y);
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
    // War frueher oben unter der Kopfzeile (Pfeil zeigte nach unten zu den
    // Haltestellen) -- dort konnte der Text vom Highscore-Banner ueberdeckt
    // werden (gemeldeter Bug). Jetzt stattdessen unten im Spielfeld, Pfeil
    // zeigt nach OBEN zu den Haltestellen -- dort ist garantiert Platz
    // (siehe MARGIN_BOTTOM), unabhaengig davon, ob/wo gerade ein
    // Highscore-Banner eingeblendet ist.
    // Zusaetzlicher Abstand (war -85), seit es unten links auch den
    // Bahnansagen-Umschalter gibt (siehe .mm-panel--left-bottom) -- der
    // zentrierte, auf schmalen Bildschirmen recht breite Hinweistext reichte
    // sonst bis in dessen Bereich hinein (gemeldete Ueberdeckung).
    const tipY = size.height - MARGIN_BOTTOM - 150 + bounce;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - 18, tipY + 20);
    ctx.lineTo(cx - 8, tipY + 20);
    ctx.lineTo(cx - 8, tipY + 36);
    ctx.lineTo(cx + 8, tipY + 36);
    ctx.lineTo(cx + 8, tipY + 20);
    ctx.lineTo(cx + 18, tipY + 20);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = theme.accent;
    ctx.font = `800 22px ${theme.fontDisplay}`;
    ctx.textAlign = "center";
    ctx.fillText("Ziehe deine erste Linie!", cx, tipY + 58);
    ctx.font = `700 13px ${theme.fontDisplay}`;
    ctx.fillStyle = theme.textMuted;
    ctx.fillText("Verbinde zwei Haltestellen mit dem Finger", cx, tipY + 76);
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

  function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  /** Trifft ein Tipp die Strecke MITTEN zwischen zwei aufeinanderfolgenden Haltestellen einer Linie (nicht in Stationsnaehe, dafuer ist stationAt zustaendig) -- siehe Datei-Kommentar bei midDrag. */
  function findLineSegmentAt(x: number, y: number): { lineIndex: number; afterIdx: number } | null {
    let best: { lineIndex: number; afterIdx: number } | null = null;
    let bestDist = LINE_SEGMENT_HIT_RADIUS;
    lines.forEach((line, lineIndex) => {
      if (!line || line.stationIds.length < 2) return;
      for (let i = 0; i < line.stationIds.length - 1; i++) {
        const a = stationById(line.stationIds[i]);
        const b = stationById(line.stationIds[i + 1]);
        const d = distToSegment(x, y, a.x, a.y, b.x, b.y);
        if (d < bestDist) {
          best = { lineIndex, afterIdx: i };
          bestDist = d;
        }
      }
    });
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

    // Einen bereits fahrenden Zug (nicht gerade an einer Haltestelle
    // stehend, siehe Datei-Kommentar bei trainDrag) direkt greifen -- geht
    // dem Linien-Stummel-Griff/Stations-Tipp vor, damit sich ein Zug ZWISCHEN
    // zwei Haltestellen ueberhaupt fassen laesst, ohne stattdessen eine neue
    // Linie zu starten. Bewusst NICHT waehrend sparelokArmed/wagonArmed
    // (dort hat die Vorrats-Zuweisung Vorrang, siehe oben).
    if (!sparelokArmed && !wagonArmed) {
      const hit = trainAt(x, y);
      if (hit && hit.train.dwell <= 0 && hit.train.boardQueue.length === 0) {
        trainDrag = hit;
        return;
      }
    }

    // Danach pruefen, ob gerade eine Haltestelle "scharf" fuer Loeschen ist
    // und dieser Tipp eines ihrer Symbole trifft -- das geht der normalen
    // Stations-/Zieh-Logik unten vor.
    if (armedDeleteStationId !== null) {
      const badges = getRemoveBadgePositions(armedDeleteStationId);
      const hit = badges.find((b) => Math.hypot(b.x - x, b.y - y) <= DELETE_BADGE_RADIUS + 8);
      if (hit) {
        if (hit.occurrenceIdx !== undefined) {
          removeStationOccurrenceFromLine(hit.lineIndex, hit.occurrenceIdx);
        } else {
          removeStationFromLine(hit.lineIndex, armedDeleteStationId);
        }
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
      // Keine Haltestelle getroffen -- pruefen, ob mitten auf einer Linie
      // (zwischen zwei Haltestellen) gegriffen wurde. Damit laesst sich ein
      // "Knick" herausziehen und an einer neuen Haltestelle ablegen, um
      // diese in die Linie einzufuegen (siehe handleUp/drawMidDragKink).
      const seg = findLineSegmentAt(x, y);
      if (seg) {
        midDrag = seg;
        return;
      }
      disarmStationDelete();
      return;
    }
    downStationId = station.id;

    // Eine Haltestelle DIREKT (nicht ueber ihren Linien-Stummel) angetippt:
    // startet IMMER eine neue Linie -- auch wenn sie schon Endstation ODER
    // mittendrin auf einer ANDEREN Linie liegt (Umsteige-Haltestellen mit
    // beliebig vielen kreuzenden Linien sind ausdruecklich erwuenscht). Die
    // bestehende(n) Linie(n) lassen sich stattdessen ueber ihren jeweiligen
    // Stummel weiterziehen (siehe oben). Die einzige Grenze gilt PRO LINIE
    // (max. zweimal, nur als Ringschluss), nicht global -- siehe
    // tryExtendActiveLine.
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
      // Rings zurueck zum jeweils ANDEREN Ende dieser Linie -- "einmal rein,
      // einmal raus" gilt fuer jede andere Haltestelle (auf ausdruecklichen
      // Nutzerwunsch, max. zweimal pro Haltestelle und nur als Ringschluss).
      // Bewusst SYMMETRISCH fuer beide Enden: zieht man von "end", schliesst
      // man zurueck zur ersten Haltestelle (ids[0]); zieht man von "start",
      // spiegelbildlich zurueck zur letzten (ids[length-1]). Nur EINE Seite
      // zu erlauben (frueherer Stand) fuehrte dazu, dass sich z. B. eine
      // ZWEITE Ringlinie ueber dieselben Haltestellen scheinbar "nicht
      // schliessen liess", wenn man zufaellig vom anderen Ende aus zog
      // (gemeldeter Bug).
      const closeTargetId = atStart ? ids[ids.length - 1] : ids[0];
      const canClose = station.id === closeTargetId && ids.length >= 3;
      if (!canClose) return;
      if (atStart) {
        ids.unshift(station.id);
        reindexTrainsForUnshift(line);
      } else {
        ids.push(station.id);
      }
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
    if (trainDrag) {
      // Die Lok folgt beim Zeichnen direkt lastPointer (siehe drawTrains) --
      // hier ist bis zum Loslassen sonst nichts zu tun.
      lastPointer = { x, y };
      return;
    }
    if (midDrag) {
      // Die eigentliche Visualisierung des Knicks liest lastPointer direkt
      // (siehe drawMidDragKink) -- hier ist sonst nichts zu tun, bis
      // losgelassen wird (siehe handleUp).
      lastPointer = { x, y };
      return;
    }
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

  function handleUp(x: number, y: number): void {
    if (trainDrag) {
      const { line, train } = trainDrag;
      const nearest = nearestPointOnLinePath(line, x, y);
      if (nearest) placeTrainAtSegment(train, nearest.segIdx, nearest.ratio);
      trainDrag = null;
      lastPointer = null;
      return;
    }
    if (midDrag) {
      // Losgelassen ueber einer Haltestelle, die noch nicht auf dieser
      // Linie vorkommt (und nicht einer der beiden direkten Nachbarn
      // selbst ist) -- fuegt sie genau an der gegriffenen Stelle ein, der
      // Rest der Linie bleibt unveraendert bestehen. Ueber leerem Bereich
      // oder einer ungueltigen Haltestelle losgelassen: nichts passiert,
      // die Linie bleibt wie sie war.
      const { lineIndex, afterIdx } = midDrag;
      const line = lines[lineIndex];
      const target = stationAt(x, y);
      if (line && target) {
        const beforeId = line.stationIds[afterIdx];
        const afterId = line.stationIds[afterIdx + 1];
        if (target.id !== beforeId && target.id !== afterId && !line.stationIds.includes(target.id)) {
          reindexTrainsForInsert(line, afterIdx);
          line.stationIds.splice(afterIdx + 1, 0, target.id);
          for (const t of line.trains) clampTrainIndex(line, t);
          tutorialDismissed = true;
          renderLineColumn();
        }
      }
      midDrag = null;
      lastPointer = null;
      return;
    }

    // Eine dabei spekulativ angelegte NEUE Linie, die es nie auf zwei
    // Haltestellen gebracht hat, wieder verwerfen -- sie soll nie dauerhaft
    // einen Linien-Slot belegen. Bewusst UNABHAENGIG von dragMoved: auch ein
    // Ziehen, das nie eine zweite (andere) Haltestelle erreicht hat (z. B.
    // nur ein kurzes Zittern auf der Stelle, oder zurueck zur Ausgangsstation
    // gezogen), darf keine "unsichtbare", nicht mehr nutzbare Linie
    // hinterlassen (gemeldeter Bug: eine Linie liess sich nicht mehr
    // verwenden, obwohl auf der Karte nichts von ihr zu sehen war).
    if (freshLineIndex !== null) {
      const l = lines[freshLineIndex];
      if (l && l.stationIds.length < 2) {
        lines[freshLineIndex] = null;
        renderLineColumn();
      }
    }
    if (!dragMoved) {
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
      if (zoomElapsedS >= GAMEOVER_ZOOM_S + GAMEOVER_ZOOM_HOLD_S) {
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

    // Neue Haltestelle alle 24 Spielstunden (STATION_SPAWN_INTERVAL_S) --
    // bewusst UNABHAENGIG vom Tag-/Wochen-Timer unten, damit es sich
    // konstant und vorhersehbar anfuehlt. "-= STATION_SPAWN_INTERVAL_S"
    // statt "= 0", damit bei grossen dt-Werten (z. B. 2x Geschwindigkeit)
    // kein Rest verloren geht.
    stationSpawnTimerS += dt;
    if (stationSpawnTimerS >= STATION_SPAWN_INTERVAL_S) {
      stationSpawnTimerS -= STATION_SPAWN_INTERVAL_S;
      spawnStation(size);
    }

    dayTimerS += dt;
    updateClock();
    if (dayTimerS >= DAY_MS / 1000) {
      dayTimerS = 0;
      gameDay += 1;
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

    // "laeuft" heisst NICHT nur "es existiert ein Zug auf einer Linie",
    // sondern auch: das Spiel ist gerade nicht pausiert (gameSpeed > 0).
    // Ohne diese Bedingung liefen Zug-Grundrauschen UND Bahnansagen auch bei
    // gedrueckter Pause einfach weiter (gemeldeter Bug) -- tick() wird auch
    // im pausierten Zustand jeden Frame aufgerufen (nur mit dt=0, siehe
    // update()), stehende Zuege "existieren" also weiterhin auf ihrer Linie.
    let anyTrainRunning = false;
    for (const line of lines) {
      if (!line || line.stationIds.length < 2) continue;
      if (line.trains.length > 0) anyTrainRunning = true;
      for (const train of line.trains) stepTrain(line, train, dt);
    }
    updateTrainChug(anyTrainRunning && gameSpeed > 0);

    if (announcementsEnabled && gameSpeed > 0) {
      announcementTimerS += dt;
      if (announcementTimerS >= announcementNextS) {
        announcementTimerS = 0;
        announcementNextS = randomAnnouncementInterval();
        playRandomStationAnnouncement();
      }
    }
  }

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      exitGame = env.exit;
      lastSize = env.size;
      canvasEl = env.canvas;
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
      wireResourceDrag(sparelokBtn, "loco");
      wagonBtn = document.createElement("button");
      wagonBtn.type = "button";
      wagonBtn.className = "mm-resource";
      wagonBtn.innerHTML = `<span class="mm-resource__icon">${icons.wagon}</span><span class="mm-resource__count">0</span>`;
      wireResourceDrag(wagonBtn, "wagon");
      resourceCol.append(sparelokBtn, wagonBtn);
      resourceColEl = resourceCol;
      env.overlay.appendChild(resourceCol);

      // Bahnansagen-Geraeuschkulisse an-/ausschalten -- auf ausdruecklichen
      // Wunsch unten links, eigenes Panel (siehe .mm-panel--left-bottom),
      // damit es nicht mit dem Loks/Waggons-Vorrat (links MITTIG) kollidiert.
      const announcementPanel = document.createElement("div");
      announcementPanel.className = "mm-panel mm-panel--left-bottom";
      announcementBtn = document.createElement("button");
      announcementBtn.type = "button";
      announcementBtn.className = "mm-sound-toggle";
      announcementBtn.setAttribute("aria-pressed", "false");
      function renderAnnouncementBtn(): void {
        announcementBtn.classList.toggle("mm-sound-toggle--active", announcementsEnabled);
        announcementBtn.setAttribute("aria-pressed", announcementsEnabled ? "true" : "false");
        announcementBtn.innerHTML = `<span class="mm-sound-toggle__icon">${icons.speaker}</span><span>Bahngeräuschkulisse ${announcementsEnabled ? "an" : "aus"}</span>`;
      }
      renderAnnouncementBtn();
      announcementBtn.addEventListener("click", () => {
        announcementsEnabled = !announcementsEnabled;
        saveAnnouncementsEnabled(announcementsEnabled);
        renderAnnouncementBtn();
        // Beim Anschalten gleich mal eine Ansage als direktes Feedback,
        // statt bis zu 13s auf die erste zu warten.
        if (announcementsEnabled) {
          playRandomStationAnnouncement();
          announcementTimerS = 0;
          announcementNextS = randomAnnouncementInterval();
        }
      });
      announcementPanel.appendChild(announcementBtn);
      announcementPanelEl = announcementPanel;
      env.overlay.appendChild(announcementPanel);

      // Uhr/Tage-Zeile UND Geschwindigkeitsregler sitzen bewusst als ZWEI
      // ZEILEN IM SELBEN Panel (nicht als zwei unabhaengig positionierte
      // Elemente) -- nur so bleibt die zweite Zeile garantiert unterhalb der
      // ersten, egal wie hoch deren Inhalt (Uhr + Text) tatsaechlich wird
      // (gemeldeter Bug: bei umbrechendem Text ueberlappten sich beide
      // Zeilen, weil die Geschwindigkeitszeile einen fest geratenen
      // Pixel-Versatz von oben hatte statt sich am tatsaechlichen
      // Panel-Inhalt zu orientieren).
      const topRight = document.createElement("div");
      topRight.className = "mm-panel mm-panel--top-right";

      const headerRow = document.createElement("div");
      headerRow.className = "mm-panel__header-row";

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
      headerRow.appendChild(clockWrapEl);

      const textCol = document.createElement("div");
      textCol.className = "mm-panel__text-col";
      dayLabelEl = document.createElement("div");
      dayLabelEl.className = "mm-panel__day";
      deliveredLabelEl = document.createElement("div");
      deliveredLabelEl.className = "mm-panel__delivered";
      textCol.append(dayLabelEl, deliveredLabelEl);
      headerRow.appendChild(textCol);

      topRight.appendChild(headerRow);

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
      topRight.appendChild(speedRowEl);

      env.overlay.appendChild(topRight);
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
      drawMidDragKink(ctx);
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
    onPointerUp(p: PointerPoint) {
      const w = screenToWorld(p.x, p.y);
      handleUp(w.x, w.y);
    },

    cleanup() {
      stopTrainChug();
      cancelActiveResourceDrag?.();
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
      announcementPanelEl?.remove();
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
