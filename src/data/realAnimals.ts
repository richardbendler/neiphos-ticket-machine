/**
 * Echte Tierfotos, passend zu den Huepftier-Motiven in data/hopperAnimals.ts
 * -- Distraktoren fuer den Huepftier-Modus von Zug-Spotter (Pendant zu
 * data/distractors.ts im Zug-Modus). Bewusst dieselben Tierarten wie die
 * Huepftiere: genau das Verwechseln/Unterscheiden ist die Aufgabe im Spiel.
 * Alle Fotos von Wikimedia Commons bzw. Flickr, Quellen unten.
 */
import catUrl from "../assets/images/realanimals/real-cat.jpg";
import buffaloUrl from "../assets/images/realanimals/real-buffalo.jpg";
import dogUrl from "../assets/images/realanimals/real-dog.jpg";
import donkeyUrl from "../assets/images/realanimals/real-donkey.jpg";
import elephantUrl from "../assets/images/realanimals/real-elephant.jpg";
import giraffeUrl from "../assets/images/realanimals/real-giraffe.jpg";
import turtleUrl from "../assets/images/realanimals/real-turtle.jpg";
import horseUrl from "../assets/images/realanimals/real-horse.jpg";

// Quellen (flickr.com, jeweils CC-lizenziert, ausser cat = Wikimedia Commons):
//  - cat: commons.wikimedia.org "Domestic cat portrait.jpg" (CC BY-SA 4.0)
//  - dog: "Dog portrait" (CC BY-NC-SA 2.0)
//  - donkey: "Donkey portrait" (CC BY-NC-SA 2.0)
//  - elephant: "African Elephant Portrait" (CC BY-NC-ND 2.0)
//  - giraffe: "Cute giraffe portrait" (CC BY-ND 2.0)
//  - buffalo: "American Bison Portrait - Wyoming" (CC BY-NC 2.0)
//  - turtle: "Turtle portrait" (CC BY 2.0)
//  - horse: "Horse Portrait" (CC BY 2.0)
export const realAnimalImages: string[] = [catUrl, buffaloUrl, dogUrl, donkeyUrl, elephantUrl, giraffeUrl, turtleUrl, horseUrl];
