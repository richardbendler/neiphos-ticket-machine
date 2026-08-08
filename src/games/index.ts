/**
 * Zentrale Registrierungsstelle: jedes Minigame-Modul registriert sich beim
 * Import selbst (registerGame(...) am Dateiende). main.ts importiert nur
 * diese Datei, dadurch bleibt registry.ts frei von Abhaengigkeiten zu
 * einzelnen Spielen (keine Zirkelbezuege).
 *
 * Neues Spiel andocken: Ordner unter src/games/<name>/ anlegen und hier
 * einmal importieren.
 */
import "./connection-puzzle";
import "./train-quartet";
import "./count-passengers";
import "./switch-run";
import "./train-spotter";
import "./memory";
import "./dj-mixer";
import "./train-photo";
import "./train-sim";
import "./mini-metro";
import "./hopper-slots";
