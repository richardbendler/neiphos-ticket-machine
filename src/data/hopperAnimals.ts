/**
 * Alternatives Bildthema zu den Zugfotos (data/trains.ts): "Rody"-artige
 * Sitz-Hüpftiere (Hartplastik-Hüpfball mit Tiergesicht, zwei Ohren UND vier
 * kurzen Beinen zum Draufsitzen/Hüpfen) statt Zügen -- fuer den optionalen
 * Hüpftier-Modus bei Zug-Spotter und Zug-Memory.
 *
 * Bewusst nur EIN Spielzeug-Typ (der "Rody"-Bauart mit Beinen): eine erste
 * Version enthielt zusaetzlich den klassischen "Space Hopper" (Kugel mit
 * Widder-/Ziegenhoernern statt Beinen, nur ein Griff/Riemen oben) -- der
 * wurde auf Nutzerhinweis wieder entfernt, weil er auf den ersten Blick
 * nicht als Hüpftier erkennbar war (eher wie ein kleines Fabelwesen mit
 * Fühlern). Nur Motive mit klar sichtbaren Beinen/Fuessen zaehlen hier.
 *
 * Diese Bilder wurden vom Projekt-Betreiber selbst per Screenshot
 * zusammengestellt (Produktfotos verschiedener Online-Shops, keine
 * durchgaengige CC-Lizenzangabe wie bei den urspruenglichen 8 Flickr-Fotos)
 * -- bewusste Entscheidung fuer dieses private, nicht-kommerzielle
 * Festival-Kiosk-Projekt. Absichtlich viele verschiedene Tierarten (nicht
 * nur Farbvarianten eines einzigen Tiers) fuer bessere Unterscheidbarkeit
 * im Memory-/Spotter-Spiel.
 *
 * "elephant-blue" und "elephant-red" wurden wieder entfernt: beide stammten
 * aus EINEM Quellfoto mit einem blauen UND einem roten Elefanten
 * nebeneinander, das nachtraeglich in zwei Einzelbilder aufgetrennt wurde --
 * an den Raendern blieb dadurch jeweils ein sichtbarer Rest des jeweils
 * anderen Elefanten stehen (gemeldet, sah dadurch schlecht/unfertig aus).
 * "elephant-gray" ist ein eigenstaendiges, sauberes Foto und bleibt erhalten.
 */
import dogTealUrl from "../assets/images/hoppers/hopper-dog-teal.jpg";
import caterpillarGreenUrl from "../assets/images/hoppers/hopper-caterpillar-green.jpg";
import horseBlueUrl from "../assets/images/hoppers/hopper-horse-blue.jpg";
import horseBrownUrl from "../assets/images/hoppers/hopper-horse-brown.jpg";
import dinoGreenUrl from "../assets/images/hoppers/hopper-dino-green.jpg";
import dogPurpleUrl from "../assets/images/hoppers/hopper-dog-purple.jpg";
import dinoTealUrl from "../assets/images/hoppers/hopper-dino-teal.jpg";
import dogBrownUrl from "../assets/images/hoppers/hopper-dog-brown.jpg";
import dinoOrangeUrl from "../assets/images/hoppers/hopper-dino-orange.jpg";
import trexGreenUrl from "../assets/images/hoppers/hopper-trex-green.jpg";
import unicornPurpleUrl from "../assets/images/hoppers/hopper-unicorn-purple.jpg";
import dinoGrayUrl from "../assets/images/hoppers/hopper-dino-gray.jpg";
import giraffeYellowUrl from "../assets/images/hoppers/hopper-giraffe-yellow.jpg";
import cowWhiteUrl from "../assets/images/hoppers/hopper-cow-white.jpg";
import cowPinkUrl from "../assets/images/hoppers/hopper-cow-pink.jpg";
import cowGreenUrl from "../assets/images/hoppers/hopper-cow-green.jpg";
import rabbitCreamUrl from "../assets/images/hoppers/hopper-rabbit-cream.jpg";
import elephantGrayUrl from "../assets/images/hoppers/hopper-elephant-gray.jpg";
import horseRedUrl from "../assets/images/hoppers/hopper-horse-red.jpg";
import unicornWhiteUrl from "../assets/images/hoppers/hopper-unicorn-white.jpg";
import foxOrangeUrl from "../assets/images/hoppers/hopper-fox-orange.jpg";
import llamaBrownUrl from "../assets/images/hoppers/hopper-llama-brown.jpg";

export interface HopperAnimalCard {
  id: string;
  name: string;
  image: string;
}

export const hopperAnimalCards: HopperAnimalCard[] = [
  { id: "dog-teal", name: "Hüpftier-Hund (türkis)", image: dogTealUrl },
  { id: "caterpillar-green", name: "Hüpftier-Raupe (grün)", image: caterpillarGreenUrl },
  { id: "horse-blue", name: "Hüpftier-Pferd (blau)", image: horseBlueUrl },
  { id: "horse-brown", name: "Hüpftier-Pferd (braun)", image: horseBrownUrl },
  { id: "dino-green", name: "Hüpftier-Dino (grün)", image: dinoGreenUrl },
  { id: "dog-purple", name: "Hüpftier-Hund (lila)", image: dogPurpleUrl },
  { id: "dino-teal", name: "Hüpftier-Dino (türkis)", image: dinoTealUrl },
  { id: "dog-brown", name: "Hüpftier-Hund (braun)", image: dogBrownUrl },
  { id: "dino-orange", name: "Hüpftier-Dino (orange)", image: dinoOrangeUrl },
  { id: "trex-green", name: "Hüpftier-T-Rex (grün)", image: trexGreenUrl },
  { id: "unicorn-purple", name: "Hüpftier-Einhorn (lila)", image: unicornPurpleUrl },
  { id: "dino-gray", name: "Hüpftier-Dino (grau)", image: dinoGrayUrl },
  { id: "giraffe-yellow", name: "Hüpftier-Giraffe (gelb)", image: giraffeYellowUrl },
  { id: "cow-white", name: "Hüpftier-Kuh (weiß)", image: cowWhiteUrl },
  { id: "cow-pink", name: "Hüpftier-Kuh (pink)", image: cowPinkUrl },
  { id: "cow-green", name: "Hüpftier-Kuh (grün)", image: cowGreenUrl },
  { id: "rabbit-cream", name: "Hüpftier-Hase (creme)", image: rabbitCreamUrl },
  { id: "elephant-gray", name: "Hüpftier-Elefant (grau)", image: elephantGrayUrl },
  { id: "horse-red", name: "Hüpftier-Pferd (rot)", image: horseRedUrl },
  { id: "unicorn-white", name: "Hüpftier-Einhorn (weiß)", image: unicornWhiteUrl },
  { id: "fox-orange", name: "Hüpftier-Fuchs (orange)", image: foxOrangeUrl },
  { id: "llama-brown", name: "Hüpftier-Lama (braun)", image: llamaBrownUrl },
];
