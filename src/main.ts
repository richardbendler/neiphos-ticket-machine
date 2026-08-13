import "./style.css";
import "./games/index";
import { installKioskHardening } from "./core/kiosk";
import { Router } from "./core/Router";
import { pullHighscoresFromServer } from "./core/sync";
import { initScreensaver } from "./core/screensaver";
import { installDragScroll } from "./core/dragScroll";
import { initHopperEasterEgg } from "./core/hopperEasterEgg";

installKioskHardening();
initScreensaver();
installDragScroll();
initHopperEasterEgg();

const app = document.getElementById("app");
if (!app) throw new Error("#app-Root nicht gefunden");

// Bewusst NICHT abgewartet: der Kiosk soll sofort starten, auch wenn das
// Netzwerk/der Server gerade langsam oder gar nicht erreichbar ist (siehe
// core/sync.ts) -- Highscore-Anzeigen ziehen den frischen Serverstand einfach
// nach, sobald er da ist (localStorage wurde bis dahin bereits normal
// gelesen). Die (fuer jede:n Besucher:in sichtbaren) Menue-Einstellungen
// werden zusaetzlich bei jedem Menuebesuch erneut abgeglichen, siehe
// core/Router.ts.
void pullHighscoresFromServer();

new Router(app);
