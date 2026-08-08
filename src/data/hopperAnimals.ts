/**
 * Alternatives Bildthema zu den Zugfotos (data/trains.ts): "Rody"-artige
 * Sitz-Hüpftiere (Hartplastik-Hüpfball mit Tiergesicht, zwei Ohren UND vier
 * kurzen Beinen zum Draufsitzen/Hüpfen) statt Zügen -- fuer den optionalen
 * Hüpftier-Modus bei Zug-Spotter und Zug-Memory, sowie fuer Passagiere
 * zählen, Hüpftier Metro, Zugfoto und Hüpftier-Glücksspiel.
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
 *
 * Alle Bilder liegen als transparente PNGs vor (per Flood-Fill vom Bildrand
 * freigestellt, siehe scratch-Skript der Bearbeitungs-Session -- die
 * urspruenglichen Fotos hatten einen fast-weissen/-grauen Studio-Hintergrund
 * als JPG einfach mit eingebrannt). Wichtig, weil die Bilder in mehreren
 * Spielen klein UND mit einem eigenen Formsymbol daneben/darauf dargestellt
 * werden (z. B. Hüpftier Metro) -- ein sichtbarer heller Kasten drumherum sah
 * dort wie ein Darstellungsfehler aus.
 */
import dogTealUrl from "../assets/images/hoppers/hopper-dog-teal.png";
import caterpillarGreenUrl from "../assets/images/hoppers/hopper-caterpillar-green.png";
import caterpillarMintUrl from "../assets/images/hoppers/hopper-caterpillar-mint.png";
import horseBlueUrl from "../assets/images/hoppers/hopper-horse-blue.png";
import horseBrownUrl from "../assets/images/hoppers/hopper-horse-brown.png";
import horseChestnutUrl from "../assets/images/hoppers/hopper-horse-chestnut.png";
import horseCrimsonUrl from "../assets/images/hoppers/hopper-horse-crimson.png";
import dinoGreenUrl from "../assets/images/hoppers/hopper-dino-green.png";
import dogPurpleUrl from "../assets/images/hoppers/hopper-dog-purple.png";
import dogGrayUrl from "../assets/images/hoppers/hopper-dog-gray.png";
import dinoTealUrl from "../assets/images/hoppers/hopper-dino-teal.png";
import dogBrownUrl from "../assets/images/hoppers/hopper-dog-brown.png";
import dinoOrangeUrl from "../assets/images/hoppers/hopper-dino-orange.png";
import trexGreenUrl from "../assets/images/hoppers/hopper-trex-green.png";
import unicornPurpleUrl from "../assets/images/hoppers/hopper-unicorn-purple.png";
import unicornPinkUrl from "../assets/images/hoppers/hopper-unicorn-pink.png";
import dinoGrayUrl from "../assets/images/hoppers/hopper-dino-gray.png";
import giraffeYellowUrl from "../assets/images/hoppers/hopper-giraffe-yellow.png";
import giraffeBrownUrl from "../assets/images/hoppers/hopper-giraffe-brown.png";
import cowWhiteUrl from "../assets/images/hoppers/hopper-cow-white.png";
import cowPinkUrl from "../assets/images/hoppers/hopper-cow-pink.png";
import cowGreenUrl from "../assets/images/hoppers/hopper-cow-green.png";
import rabbitCreamUrl from "../assets/images/hoppers/hopper-rabbit-cream.png";
import elephantGrayUrl from "../assets/images/hoppers/hopper-elephant-gray.png";
import horseRedUrl from "../assets/images/hoppers/hopper-horse-red.png";
import unicornWhiteUrl from "../assets/images/hoppers/hopper-unicorn-white.png";
import foxOrangeUrl from "../assets/images/hoppers/hopper-fox-orange.png";
import llamaBrownUrl from "../assets/images/hoppers/hopper-llama-brown.png";
import beeYellowUrl from "../assets/images/hoppers/hopper-bee-yellow.png";
import reindeerGrayUrl from "../assets/images/hoppers/hopper-reindeer-gray.png";
import frogGreenUrl from "../assets/images/hoppers/hopper-frog-green.png";
import hippoPinkUrl from "../assets/images/hoppers/hopper-hippo-pink.png";

export interface HopperAnimalCard {
  id: string;
  name: string;
  image: string;
}

export const hopperAnimalCards: HopperAnimalCard[] = [
  { id: "dog-teal", name: "Hüpftier-Hund (türkis)", image: dogTealUrl },
  { id: "caterpillar-green", name: "Hüpftier-Raupe (grün)", image: caterpillarGreenUrl },
  { id: "caterpillar-mint", name: "Hüpftier-Raupe (mint)", image: caterpillarMintUrl },
  { id: "horse-blue", name: "Hüpftier-Pferd (blau)", image: horseBlueUrl },
  { id: "horse-brown", name: "Hüpftier-Pferd (braun)", image: horseBrownUrl },
  { id: "horse-chestnut", name: "Hüpftier-Pferd (kastanienbraun)", image: horseChestnutUrl },
  { id: "horse-crimson", name: "Hüpftier-Pferd (karmesinrot)", image: horseCrimsonUrl },
  { id: "dino-green", name: "Hüpftier-Dino (grün)", image: dinoGreenUrl },
  { id: "dog-purple", name: "Hüpftier-Hund (lila)", image: dogPurpleUrl },
  { id: "dog-gray", name: "Hüpftier-Hund (grau)", image: dogGrayUrl },
  { id: "dino-teal", name: "Hüpftier-Dino (türkis)", image: dinoTealUrl },
  { id: "dog-brown", name: "Hüpftier-Hund (braun)", image: dogBrownUrl },
  { id: "dino-orange", name: "Hüpftier-Dino (orange)", image: dinoOrangeUrl },
  { id: "trex-green", name: "Hüpftier-T-Rex (grün)", image: trexGreenUrl },
  { id: "unicorn-purple", name: "Hüpftier-Einhorn (lila)", image: unicornPurpleUrl },
  { id: "unicorn-pink", name: "Hüpftier-Einhorn (rosa)", image: unicornPinkUrl },
  { id: "dino-gray", name: "Hüpftier-Dino (grau)", image: dinoGrayUrl },
  { id: "giraffe-yellow", name: "Hüpftier-Giraffe (gelb)", image: giraffeYellowUrl },
  { id: "giraffe-brown", name: "Hüpftier-Giraffe (braun)", image: giraffeBrownUrl },
  { id: "cow-white", name: "Hüpftier-Kuh (weiß)", image: cowWhiteUrl },
  { id: "cow-pink", name: "Hüpftier-Kuh (pink)", image: cowPinkUrl },
  { id: "cow-green", name: "Hüpftier-Kuh (grün)", image: cowGreenUrl },
  { id: "rabbit-cream", name: "Hüpftier-Hase (creme)", image: rabbitCreamUrl },
  { id: "elephant-gray", name: "Hüpftier-Elefant (grau)", image: elephantGrayUrl },
  { id: "horse-red", name: "Hüpftier-Pferd (rot)", image: horseRedUrl },
  { id: "unicorn-white", name: "Hüpftier-Einhorn (weiß)", image: unicornWhiteUrl },
  { id: "fox-orange", name: "Hüpftier-Fuchs (orange)", image: foxOrangeUrl },
  { id: "llama-brown", name: "Hüpftier-Lama (braun)", image: llamaBrownUrl },
  { id: "bee-yellow", name: "Hüpftier-Biene (gelb)", image: beeYellowUrl },
  { id: "reindeer-gray", name: "Hüpftier-Rentier (grau)", image: reindeerGrayUrl },
  { id: "frog-green", name: "Hüpftier-Frosch (grün)", image: frogGreenUrl },
  { id: "hippo-pink", name: "Hüpftier-Nilpferd (pink)", image: hippoPinkUrl },
];
