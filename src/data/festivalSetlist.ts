/**
 * Festival-Zeitplan (Neiphos Festival) als Datengrundlage fuer das
 * Setlist-Puzzle (siehe games/setlist). Abgetippt von der offiziellen
 * Timetable-Vorlage (PDF, von der Orga bereitgestellt) -- bei einigen
 * Uhrzeiten (v. a. genaue Start-/Endminuten innerhalb einer Stunde) wurde
 * die Stundenraster-Einteilung der Vorlage uebernommen, ohne jede einzelne
 * Boxbreite nachzumessen; fuer das Puzzle reicht diese Genauigkeit voellig.
 *
 * "special" markiert Programmpunkte, die KEIN Act/Artist sind (Sektempfang,
 * Museumsfuehrung, Karaoke) -- die bleiben im Puzzle immer sichtbar und
 * werden nie als Luecke ausgewaehlt (siehe games/setlist/index.ts).
 */

export type FestivalDay = "Donnerstag" | "Freitag" | "Samstag" | "Sonntag";

export interface SetlistAct {
  id: string;
  /** Anzeige-Uhrzeit, z. B. "20:00" oder "16:00–18:00". */
  time: string;
  name: string;
  special?: boolean;
}

export interface SetlistDayColumn {
  day: FestivalDay;
  acts: SetlistAct[];
}

export interface SetlistStage {
  id: string;
  name: string;
  days: SetlistDayColumn[];
}

function range(start: string, end?: string): string {
  return end ? `${start}–${end}` : start;
}

export const FESTIVAL_SETLIST: SetlistStage[] = [
  {
    id: "museumsinsel",
    name: "Museumsinsel",
    days: [
      {
        day: "Donnerstag",
        acts: [
          { id: "mi-do-1", time: range("18:00"), name: "Sektempfang", special: true },
          { id: "mi-do-2", time: range("19:00"), name: "Kikimora" },
          { id: "mi-do-3", time: range("20:00", "22:00"), name: "Peter performt" },
        ],
      },
      {
        day: "Freitag",
        acts: [
          { id: "mi-fr-1", time: range("14:00"), name: "Trash Banger" },
          { id: "mi-fr-2", time: range("15:00"), name: "DJ Hüpftier Pils" },
          { id: "mi-fr-3", time: range("16:00", "18:00"), name: "DJonny" },
          { id: "mi-fr-4", time: range("18:00", "20:00"), name: "Iamhannahmai" },
          { id: "mi-fr-5", time: range("20:00"), name: "Museumsführung", special: true },
          { id: "mi-fr-6", time: range("20:00", "22:00"), name: "Kimme" },
          { id: "mi-fr-7", time: range("22:00"), name: "Lenni Aqua b2b Pinko" },
          { id: "mi-fr-8", time: range("23:00"), name: "4nouk" },
          { id: "mi-fr-9", time: range("00:00", "02:00"), name: "Unordnungsamt" },
          { id: "mi-fr-10", time: range("02:00", "04:00"), name: "Hugobass303" },
          { id: "mi-fr-11", time: range("04:00"), name: "NeniBLN" },
          { id: "mi-fr-12", time: range("05:00", "07:00"), name: "Dirty Plates" },
        ],
      },
      {
        day: "Samstag",
        acts: [
          { id: "mi-sa-1", time: range("14:00"), name: "High on Kola" },
          { id: "mi-sa-2", time: range("15:00"), name: "DJ Labrana" },
          { id: "mi-sa-3", time: range("16:00", "18:00"), name: "Slime" },
          { id: "mi-sa-4", time: range("18:00"), name: "Karaoke (Planequarium)", special: true },
          { id: "mi-sa-5", time: range("18:00", "20:00"), name: "Claudio Chinotto" },
          { id: "mi-sa-6", time: range("20:00", "22:00"), name: "Nutenrieth" },
          { id: "mi-sa-7", time: range("22:00"), name: "Velo99" },
          { id: "mi-sa-8", time: range("23:00"), name: "Lenny Fuck" },
          { id: "mi-sa-9", time: range("00:00", "02:00"), name: "Aufmischen b2b Pinkhoney" },
          { id: "mi-sa-10", time: range("02:00"), name: "Tina von Kugler" },
          { id: "mi-sa-11", time: range("04:00"), name: "Kïya" },
          { id: "mi-sa-12", time: range("05:00", "07:00"), name: "DJ Arbor" },
        ],
      },
      {
        day: "Sonntag",
        acts: [
          { id: "mi-so-1", time: range("14:00"), name: "DJ Split on the Clit" },
          { id: "mi-so-2", time: range("15:00", "17:00"), name: "Salzig b2b Bertha" },
          { id: "mi-so-3", time: range("17:00"), name: "Botti" },
          { id: "mi-so-4", time: range("18:00"), name: "T&H UK Garage Set" },
          { id: "mi-so-5", time: range("19:00"), name: "Shumi" },
          { id: "mi-so-6", time: range("20:00", "22:00"), name: "Peter performt b2b Unordnungsamt" },
        ],
      },
    ],
  },
  {
    id: "endstation",
    name: "Endstation",
    days: [
      {
        day: "Donnerstag",
        acts: [
          { id: "es-do-1", time: range("22:00", "00:00"), name: "DJ Zornas" },
          { id: "es-do-2", time: range("00:00", "02:00"), name: "DJ_DJ_DJ_DJ" },
        ],
      },
      {
        day: "Freitag",
        acts: [
          { id: "es-fr-1", time: range("18:00", "20:00"), name: "Verreo" },
          { id: "es-fr-2", time: range("20:00", "22:00"), name: "Knast" },
          { id: "es-fr-3", time: range("22:00"), name: "Frau Ciel" },
          { id: "es-fr-4", time: range("23:00"), name: "DJ Flipper" },
          { id: "es-fr-5", time: range("00:00"), name: "Gobi Todic" },
          { id: "es-fr-6", time: range("01:00"), name: "Jenzorn" },
          { id: "es-fr-7", time: range("02:00"), name: "Kaos DJ Set" },
          { id: "es-fr-8", time: range("03:00", "05:00"), name: "Lemmy Winks" },
          { id: "es-fr-9", time: range("05:00", "07:00"), name: "Holy Sisterz" },
        ],
      },
      {
        day: "Samstag",
        acts: [
          { id: "es-sa-1", time: range("14:00", "16:00"), name: "Senior W." },
          { id: "es-sa-2", time: range("16:00", "18:00"), name: "Myrkulik" },
          { id: "es-sa-3", time: range("18:00"), name: "Karaoke (Planequarium)", special: true },
          { id: "es-sa-4", time: range("18:00", "20:00"), name: "Wooldrik" },
          { id: "es-sa-5", time: range("20:00", "22:00"), name: "Zur Brache" },
          { id: "es-sa-6", time: range("22:00", "00:00"), name: "Kirschkartell" },
          { id: "es-sa-7", time: range("00:00", "02:00"), name: "Säsh" },
          { id: "es-sa-8", time: range("02:00"), name: "SNTXXR" },
          { id: "es-sa-9", time: range("03:00", "05:00"), name: "Makinarium" },
          { id: "es-sa-10", time: range("05:00", "07:00"), name: "Lit van de Witt" },
        ],
      },
      {
        day: "Sonntag",
        acts: [{ id: "es-so-1", time: range("14:00", "23:00"), name: "Zornig Allstars" }],
      },
    ],
  },
  {
    id: "planequarium",
    name: "Planequarium",
    days: [
      {
        day: "Freitag",
        acts: [
          { id: "pl-fr-1", time: range("19:00"), name: "Musseldog" },
          { id: "pl-fr-2", time: range("21:00"), name: "Sebastian der Saubere" },
          { id: "pl-fr-3", time: range("23:00"), name: "Kaos" },
          { id: "pl-fr-4", time: range("01:00"), name: "Monokrom" },
        ],
      },
      {
        day: "Samstag",
        acts: [
          { id: "pl-sa-1", time: range("16:00"), name: "Cardboard" },
          { id: "pl-sa-2", time: range("18:00"), name: "Karaoke (Live)", special: true },
          { id: "pl-sa-3", time: range("21:00"), name: "Kunstloses Brot" },
          { id: "pl-sa-4", time: range("23:00"), name: "The Rhino" },
          { id: "pl-sa-5", time: range("01:00"), name: "Scampi" },
        ],
      },
    ],
  },
];

/** Alle Acts (ohne "special"-Programmpunkte) ueber alle Buehnen/Tage hinweg -- Basis fuer die zufaellige Luecken-Auswahl im Puzzle. */
export function getAllRealActs(): SetlistAct[] {
  return FESTIVAL_SETLIST.flatMap((stage) => stage.days.flatMap((d) => d.acts)).filter((a) => !a.special);
}
