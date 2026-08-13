/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Admin-Passwort, aus .env.local (siehe .env.local.example + vite.config.ts). */
  readonly VITE_ADMIN_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Fortlaufende Build-Nummer, per vite.config.ts#define zur Kompilierzeit eingesetzt (siehe dortiger Kommentar). */
declare const __APP_BUILD__: number;
/** Zeitpunkt (Datum + Uhrzeit) dieses Builds, ebenfalls per vite.config.ts#define eingesetzt. */
declare const __APP_BUILD_TIME__: string;
