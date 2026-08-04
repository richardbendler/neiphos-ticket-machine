import { defineConfig, loadEnv } from "vite";

// Admin-Passwort bewusst NICHT im Quellcode/Repo, sondern per .env.local
// (siehe .env.local.example + README-Abschnitt "Admin-Passwort einrichten")
// -- ".local"-Dateien sind per .gitignore ausgeschlossen, landen also nie im
// (oeffentlichen) Repo. Ohne diese Datei bricht der Build/Dev-Server hier
// bewusst laut ab, statt z.B. mit einem unsicheren Default-Passwort
// weiterzumachen.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (!env.VITE_ADMIN_PASSWORD || !env.VITE_ADMIN_PASSWORD.trim()) {
    throw new Error(
      "\n\n" +
        "FEHLT: VITE_ADMIN_PASSWORD ist nicht gesetzt.\n" +
        "Bitte im Projekt-Wurzelverzeichnis eine Datei '.env.local' anlegen\n" +
        "(wird per .gitignore nie eingecheckt) mit der Zeile:\n\n" +
        "  VITE_ADMIN_PASSWORD=DeinPasswortHier\n\n" +
        "Vorlage: .env.local.example kopieren und anpassen.\n" +
        "Details siehe README, Abschnitt 'Admin-Passwort einrichten'.\n",
    );
  }

  return {
    // Relativer Base-Pfad: das gebaute dist/ laeuft dadurch sowohl von einem
    // lokalen Webserver auf dem Pi (z. B. http://localhost:PORT/) als auch
    // von einer Unterseite/Unterordner einer normalen Domain aus, ohne
    // Anpassung.
    base: "./",
    build: {
      target: "es2020",
      outDir: "dist",
      assetsInlineLimit: 8192,
      sourcemap: false,
    },
    server: {
      host: true,
    },
  };
});
