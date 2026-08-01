/**
 * Zentrale Farb-/Design-Tokens. Werden sowohl von CSS (src/style.css, als
 * gleichlautende --Custom-Properties) als auch direkt von Canvas-Zeichencode
 * in den Minigames genutzt, damit beide Welten optisch zusammenpassen.
 * Bei Aenderung hier immer auch style.css nachziehen.
 */
export const theme = {
  bg: "#0a1d20",
  bgGradientTop: "#0d272b",
  panel: "#123338",
  panelAlt: "#163e44",
  panelBorder: "#2a4d52",
  panelBorderLight: "#3a6067",

  primary: "#0f7a86",
  primaryLight: "#1fb3c4",
  primaryDark: "#0a545c",

  accent: "#ffcc33",
  accentDark: "#e0a800",

  magenta: "#e2007a",

  text: "#f4f7f6",
  textMuted: "#a9c0c0",
  textFaint: "#6f8a8a",

  success: "#35c47b",
  danger: "#ef5657",

  paper: "#f5efe0",
  paperText: "#241f14",
  paperMuted: "#6b6248",

  font: "'Barlow', sans-serif",
  fontDisplay: "'Barlow Semi Condensed', sans-serif",
} as const;

export const lineColors = {
  sBahn: "#008d4f",
  uBahn: "#0059a4",
  tram: "#d6242c",
  bus: "#a53a97",
} as const;
