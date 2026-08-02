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
} as const;

export type IconName = keyof typeof icons;
