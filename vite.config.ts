import { defineConfig } from "vite";

export default defineConfig({
  // Relativer Base-Pfad: das gebaute dist/ laeuft dadurch sowohl von einem
  // lokalen Webserver auf dem Pi (z. B. http://localhost:PORT/) als auch von
  // einer Unterseite/Unterordner einer normalen Domain aus, ohne Anpassung.
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
});
