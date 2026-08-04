/**
 * Haelt das Admin-Passwort NUR im Arbeitsspeicher, waehrend der Admin-Bereich
 * offen ist -- nie in localStorage/sessionStorage, damit es nicht laenger als
 * noetig irgendwo greifbar liegt. Wird gebraucht, um admin-geschuetzte
 * Sync-Endpunkte (siehe core/sync.ts, server/serve.js) mit demselben
 * Passwort zu authentifizieren, das admin/AdminPanel.ts beim Login schon
 * client-seitig gegen VITE_ADMIN_PASSWORD prueft.
 */

let currentPassword: string | null = null;

export function setAdminSession(password: string): void {
  currentPassword = password;
}

export function clearAdminSession(): void {
  currentPassword = null;
}

export function getAdminSession(): string | null {
  return currentPassword;
}
