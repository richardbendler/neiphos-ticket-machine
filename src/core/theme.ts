/**
 * Zentrale Farb-/Design-Tokens. Werden sowohl von CSS (src/style.css, als
 * gleichlautende --Custom-Properties) als auch direkt von Canvas-Zeichencode
 * in den Minigames genutzt, damit beide Welten optisch zusammenpassen.
 * Bei Aenderung hier immer auch style.css nachziehen.
 *
 * Bewusst helles Schema (statt eines "App-Dark-Mode"): angelehnt an echte
 * Fahrkartenautomaten-Bildschirme (VBB/BVG-Style) -- weisse "Karten"-Flaechen
 * in einem grauen Geraete-Gehaeuse, silberne 3D-Tasten, dunkler Text. Keys
 * (bg/panel/text/...) sind bewusst identisch zum vorherigen dunklen Schema
 * geblieben, nur die Werte sind "umgepolt" -- so mussten die Minigames selbst
 * nicht angefasst werden, nur diese eine Datei plus style.css.
 */
export const theme = {
  bg: "#eef0f1",
  bgGradientTop: "#f7f8f9",
  panel: "#ffffff",
  panelAlt: "#f2f3f4",
  panelBorder: "#d5d8da",
  panelBorderLight: "#9aa0a6",

  primary: "#0f7a86",
  primaryLight: "#1fb3c4",
  primaryDark: "#0a545c",

  accent: "#ffcc33",
  accentDark: "#e0a800",

  magenta: "#e2007a",

  text: "#181b1d",
  textMuted: "#54595d",
  textFaint: "#82888d",

  success: "#1f8a4c",
  danger: "#c62828",

  paper: "#f5efe0",
  paperText: "#241f14",
  paperMuted: "#6b6248",

  // Aeusseres "Geraetegehaeuse" ausserhalb der weissen Karten-Flaeche.
  bezel: "#b7bbbf",
  bezelDark: "#7d8288",

  // Silberne 3D-Taste, wie am echten Fahrkartenautomaten.
  buttonFaceTop: "#f7f8f9",
  buttonFaceBottom: "#d8dbdd",
  buttonBorder: "#9aa0a6",

  font: "'Barlow', sans-serif",
  fontDisplay: "'Barlow Semi Condensed', sans-serif",
} as const;

export const lineColors = {
  sBahn: "#008d4f",
  uBahn: "#0059a4",
  tram: "#d6242c",
  bus: "#a53a97",
} as const;
