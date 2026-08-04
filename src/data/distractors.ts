import car from "../assets/images/distractors/car.jpg";
import bus from "../assets/images/distractors/bus.jpg";
import airplane from "../assets/images/distractors/airplane.jpg";
import ship from "../assets/images/distractors/ship.jpg";
import truck from "../assets/images/distractors/truck.jpg";
import bicycle from "../assets/images/distractors/bicycle.jpg";
import tractor from "../assets/images/distractors/tractor.jpg";
import horseCarriage from "../assets/images/distractors/horse-carriage.jpg";
import motorcycle from "../assets/images/distractors/motorcycle.jpg";
import hotAirBalloon from "../assets/images/distractors/hot-air-balloon.jpg";
import helicopter from "../assets/images/distractors/helicopter.jpg";
import sailboat from "../assets/images/distractors/sailboat.jpg";

/**
 * "Ablenker"-Fotos (keine Zuege/Bahnen) fuer die Minigames Zug-Spotter und
 * Memory. Fotos von Wikimedia Commons, freie Lizenz -- siehe
 * src/assets/images/distractors/CREDITS.md.
 *
 * Strassenbahn war frueher hier drin (faelschlich als "kein Zug"
 * einsortiert) -- zaehlt aber genau wie die S-Bahn als Bahn/Zug und ist
 * jetzt stattdessen Teil des Zielbild-Pools in train-spotter/index.ts
 * (siehe RAIL_EXTRA_TARGETS dort), Bilddatei entsprechend nach
 * assets/images/trains/ verschoben.
 */
export const distractorImages: string[] = [
  car, bus, airplane, ship, truck, bicycle, tractor, horseCarriage, motorcycle,
  hotAirBalloon, helicopter, sailboat,
];
