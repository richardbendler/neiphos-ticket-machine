/**
 * Alternatives Bildthema zu den Zugfotos (data/trains.ts): "Rody"-artige
 * Sitz-Hüpftiere (Hartplastik-Hüpfball mit Tiergesicht und zwei zum Festhalten
 * geformten Ohren/Hörnern) statt Zügen -- fuer den optionalen Hüpftier-Modus
 * bei Zug-Spotter und Zug-Memory. Fotos stammen von Flickr/Wikimedia Commons
 * (CC-lizenziert), Herkunft je Bild unten.
 *
 * Bewusst auf klare Unterscheidbarkeit geachtet (nicht nur auf Bildanzahl):
 * mehrere fast identische Ausschnitte aus DEMSELBEN Foto ("Rodys In The
 * Rafters" -- eine ganze Reihe haengender Huepftiere, alle in derselben Pose
 * aus demselben Blickwinkel fotografiert) wurden aussortiert, wenn sie sich
 * zusaetzlich auch noch farblich kaum unterschieden (z. B. zwei fast
 * gleiche Gruentoene, oder zwei fast gleiche Blautoene) -- genau das machte
 * sie im Memory-Spiel praktisch ununterscheidbar.
 */
import blueUrl from "../assets/images/hoppers/hopper-rody-blue.jpg";
import redUrl from "../assets/images/hoppers/hopper-rody-red.jpg";
import orangeUrl from "../assets/images/hoppers/hopper-rody-orange.jpg";
import navyUrl from "../assets/images/hoppers/hopper-rody-navy.jpg";
import purpleUrl from "../assets/images/hoppers/hopper-rody-purple.jpg";
import grayUrl from "../assets/images/hoppers/hopper-rody-gray.jpg";
import pinkUrl from "../assets/images/hoppers/hopper-rody-pink.jpg";
import darkgreenUrl from "../assets/images/hoppers/hopper-rody-darkgreen.jpg";
import horseUrl from "../assets/images/hoppers/hopper-horse.jpg";
import bullUrl from "../assets/images/hoppers/hopper-bull.jpg";
import goatOrangeUrl from "../assets/images/hoppers/hopper-goat-orange.jpg";
import goatRedUrl from "../assets/images/hoppers/hopper-goat-red.jpg";

export interface HopperAnimalCard {
  id: string;
  name: string;
  image: string;
}

// Quellen (alle flickr.com, ausser wo anders vermerkt):
//  - blue ("Rody pony"), red ("Rody!"), orange ("Rody the Pig Horse"): je
//    ein EIGENES Foto (nicht aus der Rafters-Reihe), CC BY/BY-NC-SA 2.0 --
//    volle Rody-Figur mit Beinen/Ohren/grossen Augen, daher trotz aehnlicher
//    Form klar an der Farbe UND am Blickwinkel unterscheidbar.
//  - navy/purple/gray/pink/darkgreen: Ausschnitte aus "Rodys In The
//    Rafters" (Reihe mehrerer haengender Huepftiere, alle im selben
//    Kugel-Stil mit aufgemaltem Gesicht statt vollem Koerper), CC BY-NC-SA
//    2.0 -- nur EIN Huepftier je Farbfamilie behalten (z. B. "royalblue"
//    entfernt, da neben "navy" ein zweites, kaum unterscheidbares Blau).
//
// Weitere Huepftier-ARTEN (nicht nur -Farben), von Wikimedia Commons/Flickr:
//  - horse ("Hoppity Horse", The Children's Museum of Indianapolis): CC BY-SA 3.0
//  - bull ("Skippybal"/PonPon-Huepftier mit Stierkopf, Hoernern und
//    Dampfwoelkchen): CC BY-SA 3.0
//  - goatOrange/goatRed: klassischer "Space Hopper" mit Widder-/
//    Ziegenhoernern und aufgemaltem Gesicht, zwei sehr sauber freigestellte
//    Studio-/Wiesenfotos in unterschiedlichen Farben (CC BY 2.0 / gemeinfrei)
export const hopperAnimalCards: HopperAnimalCard[] = [
  { id: "blue", name: "Hüpftier (blau)", image: blueUrl },
  { id: "red", name: "Hüpftier (rot)", image: redUrl },
  { id: "orange", name: "Hüpftier (orange)", image: orangeUrl },
  { id: "navy", name: "Hüpftier (dunkelblau)", image: navyUrl },
  { id: "purple", name: "Hüpftier (lila)", image: purpleUrl },
  { id: "gray", name: "Hüpftier (grau)", image: grayUrl },
  { id: "pink", name: "Hüpftier (pink)", image: pinkUrl },
  { id: "darkgreen", name: "Hüpftier (grün)", image: darkgreenUrl },
  { id: "horse", name: "Hüpftier (Pferd)", image: horseUrl },
  { id: "bull", name: "Hüpftier (Stier)", image: bullUrl },
  { id: "goatOrange", name: "Hüpftier (Ziege, orange)", image: goatOrangeUrl },
  { id: "goatRed", name: "Hüpftier (Ziege, rot)", image: goatRedUrl },
];
