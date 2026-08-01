import "./style.css";
import "./games/index";
import { installKioskHardening } from "./core/kiosk";
import { Router } from "./core/Router";

installKioskHardening();

const app = document.getElementById("app");
if (!app) throw new Error("#app-Root nicht gefunden");

new Router(app);
