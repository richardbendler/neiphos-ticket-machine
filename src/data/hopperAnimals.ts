/**
 * Alternatives Bildthema zu den Zugfotos (data/trains.ts): "Rody"-artige
 * Sitz-Hüpftiere (Hartplastik-Hüpfball mit Tiergesicht, zwei Ohren UND vier
 * kurzen Beinen zum Draufsitzen/Hüpfen) statt Zügen -- fuer den optionalen
 * Hüpftier-Modus bei Zug-Spotter und Zug-Memory. Fotos stammen von Flickr
 * (CC-lizenziert), Herkunft je Bild unten.
 *
 * Bewusst nur EIN Spielzeug-Typ (der "Rody"-Bauart mit Beinen): eine erste
 * Version enthielt zusaetzlich den klassischen "Space Hopper" (Kugel mit
 * Widder-/Ziegenhoernern statt Beinen, nur ein Griff/Riemen oben) -- der
 * wurde auf Nutzerhinweis wieder entfernt, weil er auf den ersten Blick
 * nicht als Hüpftier erkennbar war (eher wie ein kleines Fabelwesen mit
 * Fühlern). Nur Motive mit klar sichtbaren Beinen/Fuessen zaehlen hier.
 *
 * Bewusst auf klare Unterscheidbarkeit geachtet (nicht nur auf Bildanzahl):
 * mehrere fast identische Ausschnitte aus DEMSELBEN Foto ("Rodys In The
 * Rafters" -- eine ganze Reihe haengender Huepftiere, alle in derselben Pose
 * aus demselben Blickwinkel fotografiert) wurden aussortiert, wenn sie sich
 * zusaetzlich auch noch farblich kaum unterschieden (z. B. zwei fast
 * gleiche Gruen- oder Blautoene) -- genau das machte sie im Memory-Spiel
 * praktisch ununterscheidbar.
 */
import blueUrl from "../assets/images/hoppers/hopper-rody-blue.jpg";
import redUrl from "../assets/images/hoppers/hopper-rody-red.jpg";
import orangeUrl from "../assets/images/hoppers/hopper-rody-orange.jpg";
import navyUrl from "../assets/images/hoppers/hopper-rody-navy.jpg";
import purpleUrl from "../assets/images/hoppers/hopper-rody-purple.jpg";
import grayUrl from "../assets/images/hoppers/hopper-rody-gray.jpg";
import pinkUrl from "../assets/images/hoppers/hopper-rody-pink.jpg";
import darkgreenUrl from "../assets/images/hoppers/hopper-rody-darkgreen.jpg";

export interface HopperAnimalCard {
  id: string;
  name: string;
  image: string;
}

// Quellen (alle flickr.com):
//  - blue ("Rody pony"): CC BY 2.0
//  - red: Ganzkoerper-Aufnahme auf einer Wiese, mit deutlich sichtbaren
//    Beinen/Schwanz/Punkte-Musterung -- CC-lizenziert
//  - orange ("Rody the Pig Horse"): CC BY-NC-SA 2.0
//  - navy/purple/gray/pink/darkgreen: Ausschnitte aus "Rodys In The
//    Rafters" (Reihe mehrerer haengender Huepftiere, alle im selben
//    Rody-Kugel-Stil mit Ohren und aufgemaltem Gesicht), CC BY-NC-SA 2.0 --
//    nur EIN Huepftier je Farbfamilie behalten (z. B. "royalblue" entfernt,
//    da neben "navy" ein zweites, kaum unterscheidbares Blau).
export const hopperAnimalCards: HopperAnimalCard[] = [
  { id: "blue", name: "Hüpftier (blau)", image: blueUrl },
  { id: "red", name: "Hüpftier (rot)", image: redUrl },
  { id: "orange", name: "Hüpftier (orange)", image: orangeUrl },
  { id: "navy", name: "Hüpftier (dunkelblau)", image: navyUrl },
  { id: "purple", name: "Hüpftier (lila)", image: purpleUrl },
  { id: "gray", name: "Hüpftier (grau)", image: grayUrl },
  { id: "pink", name: "Hüpftier (pink)", image: pinkUrl },
  { id: "darkgreen", name: "Hüpftier (grün)", image: darkgreenUrl },
];
