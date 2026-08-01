/**
 * Kuratiertes Modell des Berliner Nahverkehrsnetzes fuer das Minigame
 * "Verbindungssuche" (src/games/connection-puzzle).
 *
 * Alle U-Bahn- (U1-U9, U12) und die wichtigsten S-Bahn-Linien sind mit ihrer
 * echten, stationsgenauen Reihenfolge hinterlegt (recherchiert ueber die
 * deutsch-/englischsprachige Wikipedia, Stand der Recherche: 2026). Ein paar
 * sehr kleine Aussenaeste mit unklarer/wechselnder aktueller Streckenfuehrung
 * (z. B. S45/S46/S47 im BER-Umfeld, S85) wurden bewusst weggelassen, um keine
 * unsicheren Daten auszuliefern.
 *
 * Die Straba-/Tram-Linien (M1, M2, M4, M5, M6, M8, M10) sind auf ihre
 * wichtigsten/bekanntesten Haltestellen reduziert (nicht jede einzelne
 * Haltestelle) -- das reicht fuer ein Verbindungs-Puzzle voellig aus und
 * vermeidet fehleranfaellige Kleinst-Haltestellen-Listen. Das komplette
 * Berliner Tramnetz hat >20 Linien; hier ist eine reprsentative Auswahl der
 * zentralen Metro-Tram-Linien abgebildet.
 */

export type TransitMode = "u-bahn" | "s-bahn" | "tram";

export interface TransitLine {
  id: string;
  mode: TransitMode;
  label: string;
  color: string;
  /** Stationen in echter Reihenfolge von einem Ende zum anderen (bei Ringbahn: einmal rundherum). */
  stations: string[];
  /** Ringbahn faehrt im Kreis -- letzte und erste Station sind ebenfalls verbunden. */
  isLoop?: boolean;
}

export const transitLines: TransitLine[] = [
  // ---------------------------------------------------------------- U-Bahn
  {
    id: "U1",
    mode: "u-bahn",
    label: "U1",
    color: "#7dad4c",
    stations: [
      "Uhlandstraße", "Kurfürstendamm", "Wittenbergplatz", "Nollendorfplatz",
      "Kurfürstenstraße", "Gleisdreieck", "Möckernbrücke", "Hallesches Tor",
      "Prinzenstraße", "Kottbusser Tor", "Görlitzer Bahnhof", "Schlesisches Tor",
      "Warschauer Straße",
    ],
  },
  {
    id: "U2",
    mode: "u-bahn",
    label: "U2",
    color: "#da421e",
    stations: [
      "Pankow", "Vinetastraße", "Schönhauser Allee", "Eberswalder Straße",
      "Senefelderplatz", "Rosa-Luxemburg-Platz", "Alexanderplatz", "Klosterstraße",
      "Märkisches Museum", "Spittelmarkt", "Hausvogteiplatz", "Stadtmitte",
      "Anton-Wilhelm-Amo-Straße", "Potsdamer Platz", "Mendelssohn-Bartholdy-Park",
      "Gleisdreieck", "Bülowstraße", "Nollendorfplatz", "Wittenbergplatz",
      "Zoologischer Garten", "Ernst-Reuter-Platz", "Deutsche Oper", "Bismarckstraße",
      "Sophie-Charlotte-Platz", "Kaiserdamm", "Theodor-Heuss-Platz", "Neu-Westend",
      "Olympia-Stadion", "Ruhleben",
    ],
  },
  {
    id: "U3",
    mode: "u-bahn",
    label: "U3",
    color: "#16a563",
    stations: [
      "Krumme Lanke", "Onkel Toms Hütte", "Oskar-Helene-Heim", "Freie Universität (Thielplatz)",
      "Dahlem-Dorf", "Podbielskiallee", "Breitenbachplatz", "Rüdesheimer Platz",
      "Heidelberger Platz", "Fehrbelliner Platz", "Hohenzollernplatz", "Spichernstraße",
      "Augsburger Straße", "Wittenbergplatz", "Nollendorfplatz", "Kurfürstenstraße",
      "Gleisdreieck", "Möckernbrücke", "Hallesches Tor", "Prinzenstraße",
      "Kottbusser Tor", "Görlitzer Bahnhof", "Schlesisches Tor", "Warschauer Straße",
    ],
  },
  {
    id: "U4",
    mode: "u-bahn",
    label: "U4",
    color: "#f0d722",
    stations: ["Nollendorfplatz", "Viktoria-Luise-Platz", "Bayerischer Platz", "Rathaus Schöneberg", "Innsbrucker Platz"],
  },
  {
    id: "U5",
    mode: "u-bahn",
    label: "U5",
    color: "#7e5330",
    stations: [
      "Hönow", "Louis-Lewin-Straße", "Hellersdorf", "Cottbusser Platz",
      "Kienberg (Gärten der Welt)", "Kaulsdorf-Nord", "Wuhletal", "Elsterwerdaer Platz",
      "Biesdorf-Süd", "Tierpark", "Friedrichsfelde", "Lichtenberg", "Magdalenenstraße",
      "Frankfurter Allee", "Samariterstraße", "Frankfurter Tor", "Weberwiese",
      "Strausberger Platz", "Schillingstraße", "Alexanderplatz", "Rotes Rathaus",
      "Museumsinsel", "Unter den Linden", "Brandenburger Tor", "Bundestag", "Hauptbahnhof",
    ],
  },
  {
    id: "U6",
    mode: "u-bahn",
    label: "U6",
    color: "#8c6dab",
    stations: [
      "Alt-Tegel", "Borsigwerke", "Holzhauser Straße", "Otisstraße", "Scharnweberstraße",
      "Kurt-Schumacher-Platz", "Afrikanische Straße", "Rehberge", "Seestraße",
      "Leopoldplatz", "Wedding", "Reinickendorfer Straße", "Schwartzkopffstraße",
      "Naturkundemuseum", "Oranienburger Tor", "Friedrichstraße", "Unter den Linden",
      "Stadtmitte", "Kochstraße", "Hallesches Tor", "Mehringdamm", "Platz der Luftbrücke",
      "Paradestraße", "Tempelhof", "Alt-Tempelhof", "Kaiserin-Augusta-Straße",
      "Ullsteinstraße", "Westphalweg", "Alt-Mariendorf",
    ],
  },
  {
    id: "U7",
    mode: "u-bahn",
    label: "U7",
    color: "#528dba",
    stations: [
      "Rathaus Spandau", "Altstadt Spandau", "Zitadelle", "Haselhorst", "Paulsternstraße",
      "Rohrdamm", "Siemensdamm", "Halemweg", "Jakob-Kaiser-Platz", "Jungfernheide",
      "Mierendorffplatz", "Richard-Wagner-Platz", "Bismarckstraße", "Wilmersdorfer Straße",
      "Adenauerplatz", "Konstanzer Straße", "Fehrbelliner Platz", "Blissestraße",
      "Berliner Straße", "Bayerischer Platz", "Eisenacher Straße", "Kleistpark",
      "Yorckstraße", "Möckernbrücke", "Mehringdamm", "Gneisenaustraße", "Südstern",
      "Hermannplatz", "Rathaus Neukölln", "Karl-Marx-Straße", "Neukölln", "Grenzallee",
      "Blaschkoallee", "Parchimer Allee", "Britz-Süd", "Johannisthaler Chaussee",
      "Lipschitzallee", "Wutzkyallee", "Zwickauer Damm", "Rudow",
    ],
  },
  {
    id: "U8",
    mode: "u-bahn",
    label: "U8",
    color: "#224f86",
    stations: [
      "Wittenau", "Rathaus Reinickendorf", "Karl-Bonhoeffer-Nervenklinik", "Lindauer Allee",
      "Paracelsus-Bad", "Residenzstraße", "Franz-Neumann-Platz", "Osloer Straße",
      "Pankstraße", "Gesundbrunnen", "Voltastraße", "Bernauer Straße", "Rosenthaler Platz",
      "Weinmeisterstraße", "Alexanderplatz", "Jannowitzbrücke", "Heinrich-Heine-Straße",
      "Moritzplatz", "Kottbusser Tor", "Schönleinstraße", "Hermannplatz", "Boddinstraße",
      "Leinestraße", "Hermannstraße",
    ],
  },
  {
    id: "U9",
    mode: "u-bahn",
    label: "U9",
    color: "#f3791d",
    stations: [
      "Osloer Straße", "Nauener Platz", "Leopoldplatz", "Amrumer Straße", "Westhafen",
      "Birkenstraße", "Turmstraße", "Hansaplatz", "Zoologischer Garten", "Kurfürstendamm",
      "Spichernstraße", "Güntzelstraße", "Berliner Straße", "Bundesplatz",
      "Friedrich-Wilhelm-Platz", "Walther-Schreiber-Platz", "Schloßstraße", "Rathaus Steglitz",
    ],
  },
  {
    id: "U12",
    mode: "u-bahn",
    label: "U12",
    color: "#9aa66b",
    stations: [
      "Warschauer Straße", "Schlesisches Tor", "Görlitzer Bahnhof", "Kottbusser Tor",
      "Prinzenstraße", "Hallesches Tor", "Möckernbrücke", "Gleisdreieck", "Kurfürstenstraße",
      "Nollendorfplatz", "Wittenbergplatz", "Zoologischer Garten", "Ernst-Reuter-Platz",
      "Deutsche Oper", "Bismarckstraße", "Sophie-Charlotte-Platz", "Kaiserdamm",
      "Theodor-Heuss-Platz", "Neu-Westend", "Olympia-Stadion", "Ruhleben",
    ],
  },

  // ---------------------------------------------------------------- S-Bahn
  {
    id: "S1",
    mode: "s-bahn",
    label: "S1",
    color: "#da6ba2",
    stations: [
      "Oranienburg", "Lehnitz", "Borgsdorf", "Birkenwerder", "Hohen Neuendorf", "Frohnau",
      "Hermsdorf", "Waidmannslust", "Wittenau", "Wilhelmsruh", "Schönholz", "Wollankstraße",
      "Bornholmer Straße", "Gesundbrunnen", "Humboldthain", "Nordbahnhof", "Oranienburger Straße",
      "Friedrichstraße", "Brandenburger Tor", "Potsdamer Platz", "Anhalter Bahnhof",
      "Yorckstraße", "Julius-Leber-Brücke", "Schöneberg", "Friedenau", "Feuerbachstraße",
      "Rathaus Steglitz", "Botanischer Garten", "Lichterfelde West", "Sundgauer Straße",
      "Zehlendorf", "Mexikoplatz", "Schlachtensee", "Nikolassee", "Wannsee",
    ],
  },
  {
    id: "S2",
    mode: "s-bahn",
    label: "S2",
    color: "#00854a",
    stations: [
      "Bernau", "Bernau-Friedenstal", "Zepernick", "Röntgental", "Buch", "Karow", "Blankenburg",
      "Pankow-Heinersdorf", "Pankow", "Bornholmer Straße", "Gesundbrunnen", "Nordbahnhof",
      "Oranienburger Straße", "Friedrichstraße", "Brandenburger Tor", "Potsdamer Platz",
      "Anhalter Bahnhof", "Yorckstraße", "Priesterweg", "Attilastraße", "Marienfelde",
      "Buckower Chaussee", "Schichauweg", "Lichtenrade", "Mahlow", "Blankenfelde",
    ],
  },
  {
    id: "S25",
    mode: "s-bahn",
    label: "S25",
    color: "#00854a",
    stations: [
      "Teltow Stadt", "Lichterfelde Süd", "Osdorfer Straße", "Lichterfelde Ost", "Lankwitz",
      "Südende", "Priesterweg", "Südkreuz", "Yorckstraße", "Anhalter Bahnhof", "Potsdamer Platz",
      "Brandenburger Tor", "Friedrichstraße", "Oranienburger Straße", "Nordbahnhof",
      "Humboldthain", "Gesundbrunnen", "Bornholmer Straße", "Wollankstraße", "Schönholz",
      "Alt-Reinickendorf", "Karl-Bonhoeffer-Nervenklinik", "Eichborndamm", "Tegel",
      "Schulzendorf", "Heiligensee", "Hennigsdorf",
    ],
  },
  {
    id: "S26",
    mode: "s-bahn",
    label: "S26",
    color: "#4fae6b",
    stations: [
      "Teltow Stadt", "Lichterfelde Süd", "Osdorfer Straße", "Lichterfelde Ost", "Lankwitz",
      "Südende", "Priesterweg", "Südkreuz", "Yorckstraße", "Anhalter Bahnhof", "Potsdamer Platz",
      "Brandenburger Tor", "Friedrichstraße", "Oranienburger Straße", "Nordbahnhof",
      "Humboldthain", "Gesundbrunnen", "Bornholmer Straße", "Pankow", "Pankow-Heinersdorf",
      "Blankenburg",
    ],
  },
  {
    id: "S3",
    mode: "s-bahn",
    label: "S3",
    color: "#0066ad",
    stations: [
      "Erkner", "Wilhelmshagen", "Rahnsdorf", "Friedrichshagen", "Hirschgarten", "Köpenick",
      "Wuhlheide", "Karlshorst", "Rummelsburg", "Ostkreuz", "Warschauer Straße", "Ostbahnhof",
      "Jannowitzbrücke", "Alexanderplatz", "Hackescher Markt", "Friedrichstraße", "Hauptbahnhof",
      "Bellevue", "Tiergarten", "Zoologischer Garten", "Savignyplatz", "Charlottenburg",
      "Westkreuz", "Messe Süd", "Heerstraße", "Olympiastadion", "Pichelsberg", "Stresow", "Spandau",
    ],
  },
  {
    id: "S41",
    mode: "s-bahn",
    label: "S41 (Ring, im Uhrzeigersinn)",
    color: "#a5673f",
    isLoop: true,
    stations: [
      "Südkreuz", "Schöneberg", "Tempelhof", "Hermannstraße", "Neukölln", "Sonnenallee",
      "Treptower Park", "Ostkreuz", "Frankfurter Allee", "Storkower Straße", "Landsberger Allee",
      "Greifswalder Straße", "Prenzlauer Allee", "Schönhauser Allee", "Gesundbrunnen", "Wedding",
      "Westhafen", "Beusselstraße", "Jungfernheide", "Westend", "Messe Nord/ZOB", "Westkreuz",
      "Halensee", "Hohenzollerndamm", "Heidelberger Platz", "Bundesplatz", "Innsbrucker Platz",
    ],
  },
  {
    id: "S42",
    mode: "s-bahn",
    label: "S42 (Ring, gegen Uhrzeigersinn)",
    color: "#c17d3e",
    isLoop: true,
    stations: [
      "Südkreuz", "Innsbrucker Platz", "Bundesplatz", "Heidelberger Platz", "Hohenzollerndamm",
      "Halensee", "Westkreuz", "Messe Nord/ZOB", "Westend", "Jungfernheide", "Beusselstraße",
      "Westhafen", "Wedding", "Gesundbrunnen", "Schönhauser Allee", "Prenzlauer Allee",
      "Greifswalder Straße", "Landsberger Allee", "Storkower Straße", "Frankfurter Allee",
      "Ostkreuz", "Treptower Park", "Sonnenallee", "Neukölln", "Hermannstraße", "Tempelhof",
      "Schöneberg",
    ],
  },
  {
    id: "S5",
    mode: "s-bahn",
    label: "S5",
    color: "#de6e0f",
    stations: [
      "Strausberg Nord", "Strausberg", "Petershagen Nord", "Fredersdorf", "Neuenhagen",
      "Hoppegarten", "Mahlsdorf", "Kaulsdorf", "Wuhletal", "Biesdorf", "Friedrichsfelde Ost",
      "Lichtenberg", "Nöldnerplatz", "Ostkreuz", "Warschauer Straße", "Ostbahnhof",
      "Jannowitzbrücke", "Alexanderplatz", "Hackescher Markt", "Friedrichstraße", "Hauptbahnhof",
      "Bellevue", "Tiergarten", "Zoologischer Garten", "Savignyplatz", "Charlottenburg", "Westkreuz",
    ],
  },
  {
    id: "S7",
    mode: "s-bahn",
    label: "S7",
    color: "#816ba5",
    stations: [
      "Ahrensfelde", "Mehrower Allee", "Raoul-Wallenberg-Straße", "Marzahn", "Poelchaustraße",
      "Springpfuhl", "Friedrichsfelde Ost", "Lichtenberg", "Nöldnerplatz", "Ostkreuz",
      "Warschauer Straße", "Ostbahnhof", "Jannowitzbrücke", "Alexanderplatz", "Hackescher Markt",
      "Friedrichstraße", "Hauptbahnhof", "Bellevue", "Tiergarten", "Zoologischer Garten",
      "Savignyplatz", "Charlottenburg", "Westkreuz", "Grunewald", "Nikolassee", "Wannsee",
      "Griebnitzsee", "Babelsberg", "Potsdam Hauptbahnhof",
    ],
  },
  {
    id: "S75",
    mode: "s-bahn",
    label: "S75",
    color: "#9b7fc4",
    stations: [
      "Wartenberg", "Hohenschönhausen", "Gehrenseestraße", "Springpfuhl", "Friedrichsfelde Ost",
      "Lichtenberg", "Nöldnerplatz", "Ostkreuz", "Warschauer Straße",
    ],
  },
  {
    id: "S8",
    mode: "s-bahn",
    label: "S8",
    color: "#4f9f3b",
    stations: [
      "Wildau", "Zeuthen", "Eichwalde", "Grünau", "Adlershof", "Johannisthal", "Schöneweide",
      "Baumschulenweg", "Plänterwald", "Treptower Park", "Ostkreuz", "Frankfurter Allee",
      "Storkower Straße", "Landsberger Allee", "Greifswalder Straße", "Prenzlauer Allee",
      "Schönhauser Allee", "Bornholmer Straße", "Pankow", "Pankow-Heinersdorf", "Blankenburg",
      "Mühlenbeck-Mönchmühle", "Schönfließ", "Bergfelde", "Hohen Neuendorf", "Birkenwerder",
    ],
  },
  {
    id: "S9",
    mode: "s-bahn",
    label: "S9",
    color: "#9e1b32",
    stations: [
      "Flughafen BER", "Waßmannsdorf", "Schönefeld", "Grünbergallee", "Altglienicke", "Adlershof",
      "Johannisthal", "Schöneweide", "Baumschulenweg", "Plänterwald", "Treptower Park", "Ostkreuz",
      "Warschauer Straße", "Ostbahnhof", "Jannowitzbrücke", "Alexanderplatz", "Hackescher Markt",
      "Friedrichstraße", "Hauptbahnhof", "Bellevue", "Tiergarten", "Zoologischer Garten",
      "Savignyplatz", "Charlottenburg", "Westkreuz", "Messe Süd", "Heerstraße", "Olympiastadion",
      "Pichelsberg", "Stresow", "Spandau",
    ],
  },

  // ------------------------------------------------------------------ Tram
  // Bewusst auf die wichtigsten Haltestellen reduziert (siehe Kommentar oben).
  {
    id: "M1",
    mode: "tram",
    label: "M1",
    color: "#d6242c",
    stations: ["Rosenthal Nord", "Wilhelmsruh", "Pankow Kirche", "Pankow", "Schönhauser Allee", "Eberswalder Straße", "Rosenthaler Platz", "Am Kupfergraben"],
  },
  {
    id: "M2",
    mode: "tram",
    label: "M2",
    color: "#d6242c",
    stations: ["Heinersdorf", "Pankow", "Vinetastraße", "Schönhauser Allee", "Eberswalder Straße", "Senefelderplatz", "Rosa-Luxemburg-Platz", "Alexanderplatz"],
  },
  {
    id: "M4",
    mode: "tram",
    label: "M4",
    color: "#d6242c",
    stations: ["Falkenberg", "Hohenschönhausen", "Landsberger Allee", "Greifswalder Straße", "Alexanderplatz", "Hackescher Markt"],
  },
  {
    id: "M5",
    mode: "tram",
    label: "M5",
    color: "#d6242c",
    stations: ["Hohenschönhausen", "Landsberger Allee", "Alexanderplatz", "Hackescher Markt"],
  },
  {
    id: "M6",
    mode: "tram",
    label: "M6",
    color: "#d6242c",
    stations: ["Hellersdorf", "Lichtenberg", "Landsberger Allee", "Alexanderplatz", "Hackescher Markt"],
  },
  {
    id: "M8",
    mode: "tram",
    label: "M8",
    color: "#d6242c",
    stations: ["Ahrensfelde", "Hohenschönhausen", "Prenzlauer Allee", "Rosa-Luxemburg-Platz", "Hackescher Markt"],
  },
  {
    id: "M10",
    mode: "tram",
    label: "M10",
    color: "#d6242c",
    stations: ["Warschauer Straße", "Frankfurter Tor", "Prenzlauer Allee", "Eberswalder Straße", "Nordbahnhof"],
  },
];

/** Alle eindeutigen Stationsnamen ueber alle Linien hinweg. */
export function getAllStations(): string[] {
  const set = new Set<string>();
  for (const line of transitLines) {
    for (const s of line.stations) set.add(s);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

/** Alle Linien, die eine bestimmte Station bedienen. */
export function getLinesForStation(station: string): TransitLine[] {
  return transitLines.filter((l) => l.stations.includes(station));
}
