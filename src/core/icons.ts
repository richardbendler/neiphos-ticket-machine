/**
 * Handgezeichnete, sehr einfache Linien-Icons als Inline-SVG-Strings.
 * Bewusst minimalistisch (kein Icon-Font, keine externe Bibliothek noetig,
 * skaliert verlustfrei fuer die Menu-Kacheln).
 */
const svg = (inner: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

export const icons = {
  route: svg(
    `<circle cx="5" cy="6" r="2.4" fill="currentColor" stroke="none"/>
     <circle cx="19" cy="18" r="2.4" fill="currentColor" stroke="none"/>
     <path d="M6.8 7.8 L17.2 16.2" stroke-dasharray="2.6 2.6"/>`,
  ),
  cards: svg(
    `<rect x="2" y="5" width="13" height="17" rx="2"/>
     <rect x="9" y="2" width="13" height="17" rx="2" fill="var(--tile-accent, transparent)" fill-opacity="0.15"/>`,
  ),
  trainWindow: svg(
    `<rect x="2" y="7" width="20" height="12" rx="3"/>
     <line x1="8" y1="7" x2="8" y2="19"/>
     <line x1="16" y1="7" x2="16" y2="19"/>
     <circle cx="5" cy="13" r="1.1" fill="currentColor" stroke="none"/>
     <circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none"/>
     <circle cx="19" cy="13" r="1.1" fill="currentColor" stroke="none"/>`,
  ),
  fork: svg(
    `<path d="M12 22 V13"/>
     <path d="M12 13 L5 4"/>
     <path d="M12 13 L19 4"/>
     <path d="M12 13 L12 4"/>`,
  ),
  searchGrid: svg(
    `<rect x="2" y="2" width="8" height="8" rx="1.5"/>
     <rect x="14" y="2" width="8" height="8" rx="1.5"/>
     <rect x="2" y="14" width="8" height="8" rx="1.5"/>
     <circle cx="17.5" cy="17.5" r="3.1"/>
     <line x1="19.8" y1="19.8" x2="22.2" y2="22.2"/>`,
  ),
  memory: svg(
    `<rect x="2" y="2" width="9" height="9" rx="1.5"/>
     <rect x="13" y="2" width="9" height="9" rx="1.5"/>
     <rect x="2" y="13" width="9" height="9" rx="1.5"/>
     <rect x="13" y="13" width="9" height="9" rx="1.5"/>
     <path d="M15.5 17.5 L17 19 L20.5 15"/>`,
  ),
  sliders: svg(
    `<line x1="5" y1="4" x2="5" y2="20"/>
     <line x1="12" y1="4" x2="12" y2="20"/>
     <line x1="19" y1="4" x2="19" y2="20"/>
     <circle cx="5" cy="9" r="2.1" fill="currentColor" stroke="none"/>
     <circle cx="12" cy="15" r="2.1" fill="currentColor" stroke="none"/>
     <circle cx="19" cy="7" r="2.1" fill="currentColor" stroke="none"/>`,
  ),
  gear: svg(
    `<circle cx="12" cy="12" r="3.2"/>
     <path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3 5.6 5.6"/>`,
  ),
  exit: svg(`<path d="M11 5 L4 12 L11 19"/><path d="M4 12 H20"/>`),
  close: svg(`<path d="M5 5 L19 19"/><path d="M19 5 L5 19"/>`),
  trophy: svg(
    `<path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/>
     <path d="M7 5H4a3 3 0 0 0 3 5"/>
     <path d="M17 5h3a3 3 0 0 1-3 5"/>
     <path d="M12 13v3"/>
     <path d="M8 20h8"/>
     <path d="M9.5 16.5h5l1 3.5h-7l1-3.5Z"/>`,
  ),
  feedback: svg(
    `<path d="M4 5h16v11H9l-5 4V5Z"/>
     <line x1="8" y1="9" x2="16" y2="9"/>
     <line x1="8" y1="12.5" x2="13" y2="12.5"/>`,
  ),
  camera: svg(
    `<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/>
     <circle cx="12" cy="13.2" r="3.4"/>`,
  ),
  locomotive: svg(
    `<path d="M4 10a4 4 0 0 1 4-4h5a8 8 0 0 1 8 8v2H4v-6Z"/>
     <line x1="4" y1="13" x2="21" y2="13"/>
     <circle cx="8" cy="19" r="2"/>
     <circle cx="17" cy="19" r="2"/>`,
  ),
  // Fahrkarte mit angedeuteter Lochung (Kreis-Ausschnitt links) und
  // gestrichelter Abriss-Linie -- fuer den Ticket-Druck-Button
  // (core/highscorePrompt.ts) und die Erfolgsmeldung danach.
  ticket: svg(
    `<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/>
     <line x1="14" y1="6" x2="14" y2="18" stroke-dasharray="2.4 2.4"/>`,
  ),
  // Warndreieck mit Ausrufezeichen -- fuer die Papierstand-Anzeige im
  // Header (core/Router.ts), erscheint nur, wenn der Bondrucker wenig/kein
  // Papier mehr meldet.
  warningTriangle: svg(
    `<path d="M12 3.5 21.5 20h-19L12 3.5Z"/>
     <line x1="12" y1="10" x2="12" y2="14.5"/>
     <circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/>`,
  ),
  // Vereinfachtes Huepftier (Rody-Stil: Ball-Koerper, zwei Ohren, vier
  // Beine) -- als eigenstaendiges Icon statt eines Emojis (siehe
  // games/memory/index.ts, games/train-spotter/index.ts), das auf Systemen
  // ohne installierte Emoji-Schriftart (z. B. ein frisches Raspberry Pi OS)
  // sonst als leere Flaeche/Tofu-Box angezeigt wird.
  hopper: svg(
    `<circle cx="12" cy="11" r="7"/>
     <path d="M8.5 5.5 7 2.5M15.5 5.5 17 2.5"/>
     <path d="M7 17 L5.5 21M10 18 L9 21.5M14 18 L15 21.5M17 17 L18.5 21"/>`,
  ),
  // Drei Haltestellen-Grundformen (Kreis/Quadrat/Dreieck, wie im Spiel
  // selbst) durch eine Linie verbunden -- fuer games/mini-metro.
  metroMap: svg(
    `<circle cx="4.5" cy="19.5" r="2.3" fill="currentColor" stroke="none"/>
     <rect x="9.7" y="2" width="4.6" height="4.6" rx="0.6" fill="currentColor" stroke="none"/>
     <path d="M19 15.5 L22 20.5 L16 20.5 Z" fill="currentColor" stroke="none"/>
     <path d="M5.5 17.8 L11.2 7.3 M13 6.5 L18.3 15" stroke-dasharray="2.4 2.4"/>`,
  ),
  // Zwei verbundene Achtelnoten -- fuer den Setlist-Menuepunkt.
  musicNote: svg(
    `<circle cx="6.5" cy="18" r="2.7" fill="currentColor" stroke="none"/>
     <circle cx="16.5" cy="16" r="2.7" fill="currentColor" stroke="none"/>
     <path d="M9.2 18V5.5L19.2 3.5V16"/>
     <path d="M9.2 8 L19.2 6"/>`,
  ),
  // Sonne/Mond fuer die Tag/Nacht-Uhr in games/mini-metro.
  sun: svg(
    `<circle cx="12" cy="12" r="4.2"/>
     <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6"/>`,
  ),
  moon: svg(`<path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 16 6.8 6.8 0 0 1 15.5 3.5Z" fill="currentColor" stroke="none"/>`),
  // Geschwindigkeitsregler (games/mini-metro): Pause/Play/Vorspulen.
  pause: svg(
    `<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>
     <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>`,
  ),
  play: svg(`<path d="M7 4 L20 12 L7 20 Z" fill="currentColor" stroke="none"/>`),
  fastForward: svg(
    `<path d="M2 5 L11 12 L2 19 Z" fill="currentColor" stroke="none"/>
     <path d="M12 5 L21 12 L12 19 Z" fill="currentColor" stroke="none"/>`,
  ),
  // Waggon-Vorrat (games/mini-metro) -- eigenes Icon statt einer Wiederverwendung
  // von "locomotive", damit Lok- und Waggon-Vorratsanzeige auf einen Blick
  // unterscheidbar sind.
  wagon: svg(
    `<rect x="4" y="7" width="16" height="10" rx="1.5"/>
     <line x1="4" y1="12" x2="20" y2="12"/>
     <circle cx="8" cy="19" r="2"/>
     <circle cx="16" cy="19" r="2"/>`,
  ),
} as const;

export type IconName = keyof typeof icons;
