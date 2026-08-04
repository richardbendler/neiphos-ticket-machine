/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Admin-Passwort, aus .env.local (siehe .env.local.example + vite.config.ts). */
  readonly VITE_ADMIN_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
