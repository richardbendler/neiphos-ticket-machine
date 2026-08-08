import type { GameEnv, MinigameModule } from "../../core/Game";
import { openModal } from "../../core/modal";
import { registerGame } from "../registry";

const GAME_ID = "setlist";

/**
 * Noch kein eigenes Spiel/Feature -- nur die Menue-Kachel samt Hinweis, dass
 * die Setlist-Funktion noch in Arbeit ist. Oeffnet direkt beim Start einen
 * Hinweis-Dialog statt eines Canvas-Spiels; "Zurueck zum Menue" verlaesst
 * ueber env.exit() sofort wieder.
 */
function createSetlistPlaceholder(): MinigameModule {
  let closeDialog: (() => void) | null = null;

  return {
    id: GAME_ID,

    init(env: GameEnv) {
      closeDialog = openModal((panel, close) => {
        const h2 = document.createElement("h2");
        h2.textContent = "Setlist";
        panel.appendChild(h2);

        const text = document.createElement("p");
        text.textContent = "Wir arbeiten noch an dieser Funktion -- schau bald wieder vorbei!";
        panel.appendChild(text);

        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "btn btn--accent";
        okBtn.style.width = "100%";
        okBtn.style.marginTop = "12px";
        okBtn.textContent = "Zurück zum Menü";
        okBtn.addEventListener("click", () => {
          close();
          env.exit();
        });
        panel.appendChild(okBtn);
      });
    },

    update() {},
    render() {},

    cleanup() {
      closeDialog?.();
      closeDialog = null;
    },
  };
}

registerGame({
  id: GAME_ID,
  title: "Setlist",
  subtitle: "Welche Artists heute noch performen",
  icon: "musicNote",
  badge: "SL",
  accent: "#6a3fb5",
  create: createSetlistPlaceholder,
});
