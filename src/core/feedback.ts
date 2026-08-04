import { loadJSON, saveJSON } from "./storage";
import { getAdminSession } from "./adminSession";

/**
 * Feedback wird primaer server-seitig als Datei abgelegt (siehe
 * server/serve.js, Endpunkt /api/feedback) -- so landet es unabhaengig davon,
 * ob die App gerade vom Pi lokal oder von einem normalen Webserver
 * ausgeliefert wird, direkt im Dateisystem. Ist kein Server erreichbar (z. B.
 * rein statisches Hosting ohne server/serve.js, oder beim Testen mit
 * `npm run dev`), faellt die App automatisch auf eine lokale Ablage in
 * localStorage zurueck, damit nichts verloren geht.
 *
 * Lesen (fetchFeedback) und Als-gelesen-Markieren sind server-seitig
 * admin-geschuetzt (siehe server/serve.js) -- die einzigen Aufrufer sind
 * ohnehin admin/AdminPanel.ts, wo zu diesem Zeitpunkt immer schon eine
 * gueltige Admin-Session (core/adminSession.ts) vorliegt. Absenden selbst
 * (submitFeedback) bleibt bewusst oeffentlich/ohne Login, das soll jede:r
 * Besucher:in tun koennen.
 */

function adminHeaders(): HeadersInit {
  const password = getAdminSession();
  return password ? { "X-Admin-Password": password } : {};
}

export interface FeedbackEntry {
  id: string;
  message: string;
  createdAt: string;
  read: boolean;
}

const LOCAL_FALLBACK_PATH = ["feedback", "local"];

function loadLocalFallback(): FeedbackEntry[] {
  return loadJSON<FeedbackEntry[]>(LOCAL_FALLBACK_PATH, []);
}

function saveLocalFallback(entries: FeedbackEntry[]): void {
  saveJSON(LOCAL_FALLBACK_PATH, entries);
}

function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

export async function submitFeedback(message: string): Promise<{ ok: boolean; storedLocally: boolean }> {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, storedLocally: false };

  try {
    const res = await fetch("./api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, storedLocally: false };
  } catch {
    const entries = loadLocalFallback();
    entries.push({
      id: `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      message: trimmed,
      createdAt: new Date().toISOString(),
      read: false,
    });
    saveLocalFallback(entries);
    return { ok: true, storedLocally: true };
  }
}

export async function fetchFeedback(): Promise<{ entries: FeedbackEntry[]; serverReachable: boolean }> {
  const localEntries = loadLocalFallback();

  try {
    const res = await fetch("./api/feedback", { headers: adminHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const serverEntries = (await res.json()) as FeedbackEntry[];
    const merged = [...serverEntries, ...localEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { entries: merged, serverReachable: true };
  } catch {
    return { entries: [...localEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), serverReachable: false };
  }
}

export async function markFeedbackRead(entry: FeedbackEntry): Promise<void> {
  if (isLocalId(entry.id)) {
    const entries = loadLocalFallback().map((e) => (e.id === entry.id ? { ...e, read: true } : e));
    saveLocalFallback(entries);
    return;
  }
  try {
    await fetch(`./api/feedback/${encodeURIComponent(entry.id)}/read`, { method: "POST", headers: adminHeaders() });
  } catch {
    // Server gerade nicht erreichbar -- bleibt serverseitig ungelesen, kein Absturz.
  }
}

export function countUnread(entries: FeedbackEntry[]): number {
  return entries.filter((e) => !e.read).length;
}
