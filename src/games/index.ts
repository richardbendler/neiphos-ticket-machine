/**
 * Zentrale Registrierungsstelle: main.ts importiert nur diese Datei, dadurch
 * bleibt registry.ts frei von Abhaengigkeiten zu einzelnen Spielen (keine
 * Zirkelbezuege).
 *
 * Die meisten Spiele registrieren hier nur noch ihre LEICHTEN Metadaten
 * (Titel/Icon/Highscore-Kategorien -- fuers Hauptmenue/Highscore-Board
 * sofort noetig), die eigentliche (teils sehr umfangreiche, siehe
 * mini-metro/index.ts mit ueber 2700 Zeilen) Spiellogik wird erst per
 * dynamischem import() nachgeladen, wenn das Spiel wirklich geoeffnet wird
 * (siehe GameMeta.create in registry.ts und Router.ts#startGame). Auf
 * ausdruecklichen Wunsch ("Spiele erst geladen werden, wenn sie geoeffnet
 * werden, damit Ressourcen gespart werden") -- vorher wurde hier JEDES
 * Spiel beim App-Start eingebunden, alle ca. 15 Minigames landeten dadurch
 * in einem einzigen JS-Bundle.
 *
 * DREI Spiele (count-passengers, train-photo, memory) bleiben bewusst beim
 * alten, sich selbst registrierenden Weg (siehe deren jeweilige index.ts):
 * ihre Highscore-Kategorien sind eng mit den fuer das Spiel selbst
 * benoetigten Level-/Board-Definitionen verzahnt (z. B. SPEED_LEVELS,
 * TRAIN_BOARD_SIZES). Diese Definitionen sauber von der Spiellogik zu
 * trennen, ohne eine doppelt gepflegte (und leicht auseinanderlaufende)
 * Kopie zu riskieren, braucht mehr als die hier moegliche mechanische
 * Auslagerung -- lieber weiterhin eager laden als das falsch machen.
 *
 * Neues (einfaches) Spiel andocken: Ordner unter src/games/<name>/ anlegen,
 * die Spiellogik als "export function createXGame(): MinigameModule"
 * exportieren (NICHT mehr selbst registrieren), hier einen Eintrag mit
 * lazy create ergaenzen.
 */
import { registerGame } from "./registry";
import "./count-passengers";
import "./train-photo";
import "./memory";

registerGame({
  id: "connection-puzzle",
  // Weiches Trennzeichen (U+00AD) an der Wortfuge -- ohne das bricht der
  // Browser das lange, zusammengesetzte Wort in der schmalen Menu-Kachel an
  // einer zufaelligen Stelle statt an der Silbengrenze um.
  title: "Verbindungs­suche",
  subtitle: "Finde die schnellste Route",
  icon: "route",
  badge: "VS",
  accent: "#0f7a86",
  create: () => import("./connection-puzzle").then((m) => m.createConnectionPuzzleGame()),
  highscoreCategories: [{ board: "default", label: "Bestwert", direction: "higher-better", formatValue: (value) => `${value} Punkte` }],
});

registerGame({
  id: "dj-mixer",
  title: "DJ-Mischer",
  subtitle: "Baue einen Beat aus Zuggeräuschen",
  icon: "sliders",
  badge: "DJ",
  accent: "#f3791d",
  create: () => import("./dj-mixer").then((m) => m.createDjMixerGame()),
});

registerGame({
  id: "hopper-slots",
  title: "Hüpftier-Glück",
  subtitle: "Hüpft dir dein Glück",
  icon: "hopper",
  badge: "GS",
  accent: "#a53a97",
  create: () => import("./hopper-slots").then((m) => m.createHopperSlotsGame()),
  highscoreCategories: [{ board: "default", label: "Höchststand", direction: "higher-better", formatValue: (value) => (value === 1 ? "1 Punkt" : `${value} Punkte`) }],
});

registerGame({
  id: "mini-metro",
  title: "Hüpftier-Metro",
  subtitle: "Bringe Hüpftiere von A nach B",
  icon: "metroMap",
  badge: "MM",
  accent: "#0059a4",
  create: () => import("./mini-metro").then((m) => m.createMiniMetroGame()),
  highscoreCategories: [{ board: "default", label: "Passagiere", direction: "higher-better", formatValue: (value) => (value === 1 ? "1 Passagier" : `${value} Passagiere`) }],
});

registerGame({
  id: "setlist",
  title: "Setlist-Puzzle",
  subtitle: "Puzzle die Setlist richtig zusammen",
  icon: "musicNote",
  badge: "SL",
  accent: "#6a3fb5",
  isNew: true,
  create: () => import("./setlist").then((m) => m.createSetlistPuzzleGame()),
});

registerGame({
  id: "switch-run",
  title: "Weichenspiel",
  subtitle: "Links, Mitte oder Rechts?",
  icon: "fork",
  badge: "WS",
  accent: "#8c6dab",
  create: () => import("./switch-run").then((m) => m.createSwitchRunGame()),
  highscoreCategories: [{ board: "default", label: "Bestwert", direction: "higher-better", formatValue: (value) => `${value} Weiche${value === 1 ? "" : "n"}` }],
});

registerGame({
  id: "train-quartet",
  title: "Zug-Quartett",
  subtitle: "Vergleiche Werte mit 20 echten Zügen",
  icon: "cards",
  badge: "ZQ",
  accent: "#7e5330",
  create: () => import("./train-quartet").then((m) => m.createTrainQuartetGame()),
  highscoreCategories: [{ board: "default", label: "Meiste gesammelte Karten", direction: "higher-better", formatValue: (value) => (value === 1 ? "1 Karte" : `${value} Karten`) }],
});

registerGame({
  id: "train-sim",
  title: "Zugsimulator",
  subtitle: "Finde den Weg zum Neiphos Festival",
  icon: "locomotive",
  badge: "ZG",
  accent: "#1f6f43",
  create: () => import("./train-sim").then((m) => m.createTrainSimGame()),
  highscoreCategories: [{ board: "breddin", label: "Wenigste Züge", direction: "lower-better", formatValue: (value) => (value === 1 ? "1 Zug" : `${value} Züge`) }],
});

registerGame({
  id: "train-spotter",
  title: "Zug-Spotter",
  subtitle: "Finde alle Züge im Raster",
  note: "auch mit Hüpftieren spielbar",
  icon: "searchGrid",
  badge: "ZS",
  accent: "#0059a4",
  create: () => import("./train-spotter").then((m) => m.createTrainSpotterGame()),
  highscoreCategories: [
    { board: "default", label: "Bestzeit", direction: "lower-better", formatValue: (value) => `${value.toFixed(2)} s` },
    { board: "hopper", label: "Hüpftiere Bestzeit", direction: "lower-better", formatValue: (value) => `${value.toFixed(2)} s` },
  ],
});
