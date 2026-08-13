/**
 * Wiederverwendbare Bildschirmtastatur (kein Hardware-Keyboard auf dem Pi).
 * Zwei Layouts: "numeric" (Ziffernblock, z. B. Passagiere-schaetzen) und
 * "alphanumeric" (Namenseingabe bei einem neuen Highscore).
 */

export type KeyboardLayout = "numeric" | "alphanumeric";

export interface OnScreenKeyboardOptions {
  layout: KeyboardLayout;
  maxLength?: number;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  mask?: boolean;
  /** Nur bei layout "alphanumeric": haengt rechts zusaetzlich ein Zahlenfeld an (aktuell nur beim Admin-Login genutzt, die Highscore-Namenseingabe bleibt ohne). */
  extraKeys?: boolean;
  /** Nur bei layout "alphanumeric": fuegt eine Umschalttaste fuer Gross-/Kleinschreibung hinzu (aktuell nur beim Admin-Login genutzt). */
  caseToggle?: boolean;
  /** Nur bei layout "alphanumeric": zeigt eine Umschalttaste zu einer Sonderzeichen-Ansicht (wie "?123"/"ABC" bei mobilen Tastaturen) -- fuer WLAN-Passwort und Admin-Login/-Bestaetigung, da Passwoerter Sonderzeichen enthalten koennen, die die normale Buchstaben-Tastatur bisher nicht eingeben konnte (gemeldeter Bug: WLAN-Verbindung mit Sonderzeichen-Passwort nicht moeglich). */
  symbolsToggle?: boolean;
  /** Nur bei layout "alphanumeric": Anzeige wird ein mehrzeiliges, umbrechendes und ab "rows" Zeilen scrollbares Feld statt der sonst einzeiligen, zentrierten Anzeige (fuer laengere Freitexte, z. B. Feedback). */
  multiline?: boolean;
  /** Nur zusammen mit multiline: sichtbare Zeilenzahl, bevor das Feld scrollt (Default 5). */
  rows?: number;
  /** Optionale CSS-Schriftgroesse fuer die Anzeige (z. B. "2.2rem") -- Default kommt aus .field-input. */
  displayFontSize?: string;
  /** Optionale CSS-Textfarbe fuer die Anzeige (z. B. var(--accent)) -- Default kommt aus .field-input. */
  displayColor?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

const ALPHA_ROWS = ["QWERTZUIOP", "ASDFGHJKL", "YXCVBNM"];
// Drei Reihen mit je 10 Zeichen (dieselbe Zeichenzahl wie ALPHA_ROWS[0]) --
// deckt die gaengigsten in Passwoertern verwendeten Sonderzeichen ab. Ziffern
// muessen hier nicht zusaetzlich rein, die gibt's bei symbolsToggle-Tastaturen
// ohnehin immer schon ueber das Zahlenfeld (extraKeys).
const SYMBOL_ROWS = ["!\"§$%&/()=", "?ß´`+*~#'@", "-_.:,;<>|\\"];

export class OnScreenKeyboard {
  readonly el: HTMLDivElement;
  private display: HTMLDivElement;
  private value: string;
  /** Nur relevant OHNE caseToggle (z.B. Highscore-Namenseingabe): dort gibt es keine Umschalttaste, Buchstaben bleiben wie bisher immer gross. */
  private uppercase = true;
  /** Nur bei caseToggle: Feststelltaste ("⇪ Umschalt") -- bleibt an, bis sie erneut gedrueckt wird. Start = kleingeschrieben. */
  private capsLock = false;
  /** Nur bei caseToggle: klassisches Shift ("⇧") -- macht nur den naechsten Buchstaben einmalig gross, dann automatisch wieder aus. */
  private shiftOnce = false;
  /** Nur bei symbolsToggle: ob gerade die Sonderzeichen-Ansicht (statt Buchstaben) gezeigt wird. */
  private symbolsMode = false;
  /** Nur bei layout "alphanumeric": Container fuer die Buchstaben-/Sonderzeichen-Reihen, wird bei symbolsToggle komplett neu aufgebaut (siehe renderLetterRows). */
  private lettersArea: HTMLDivElement | null = null;
  private readonly opts: Required<Omit<OnScreenKeyboardOptions, "onChange" | "onSubmit" | "displayFontSize" | "displayColor">> & {
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
    displayFontSize?: string;
    displayColor?: string;
  };
  private readonly clickHandler: (e: Event) => void;
  private readonly keydownHandler: (e: KeyboardEvent) => void;
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: OnScreenKeyboardOptions) {
    this.opts = {
      layout: options.layout,
      maxLength: options.maxLength ?? (options.layout === "numeric" ? 4 : 16),
      initialValue: options.initialValue ?? "",
      placeholder: options.placeholder ?? "",
      submitLabel: options.submitLabel ?? "Bestätigen",
      mask: options.mask ?? false,
      extraKeys: options.extraKeys ?? false,
      caseToggle: options.caseToggle ?? false,
      symbolsToggle: options.symbolsToggle ?? false,
      multiline: options.multiline ?? false,
      rows: options.rows ?? 5,
      onChange: options.onChange,
      onSubmit: options.onSubmit,
      displayFontSize: options.displayFontSize,
      displayColor: options.displayColor,
    };
    this.value = this.opts.initialValue;

    this.el = document.createElement("div");
    this.el.className = `osk osk--${this.opts.layout}${this.opts.extraKeys ? " osk--with-extra" : ""}`;

    this.display = document.createElement("div");
    this.display.className = "field-input";
    this.display.style.marginBottom = "10px";
    if (this.opts.displayFontSize) this.display.style.fontSize = this.opts.displayFontSize;
    if (this.opts.displayColor) this.display.style.color = this.opts.displayColor;
    if (this.opts.multiline) {
      // Mehrzeiliges, umbrechendes Feld statt der sonst einzeiligen,
      // zentrierten Anzeige -- fuer laengere Freitexte (z. B. Feedback),
      // bei denen eine einzelne Zeile ohne Umbruch schlicht ueber den
      // Rand hinauslief. Feste Hoehe (line-height * rows) statt reinem
      // "waechst mit dem Text" -- ab "rows" Zeilen wird stattdessen
      // gescrollt, damit die Tastatur darunter nicht verdraengt wird.
      this.display.style.textAlign = "left";
      this.display.style.whiteSpace = "pre-wrap";
      this.display.style.wordBreak = "break-word";
      this.display.style.overflowY = "auto";
      this.display.style.lineHeight = "1.4";
      this.display.style.height = `calc(1.4em * ${this.opts.rows})`;
    } else {
      this.display.style.textAlign = "center";
      this.display.style.minHeight = "1.4em";
    }

    this.el.appendChild(this.display);
    this.el.appendChild(this.buildKeys());
    this.clickHandler = (e) => this.handleClick(e);
    this.el.addEventListener("click", this.clickHandler);
    // Zusaetzlich zur Bildschirmtastatur (die bleibt der fuer den Kiosk-
    // Betrieb vorgesehene primaere Eingabeweg) nimmt eine angeschlossene
    // USB-Tastatur direkt Text entgegen -- rein zum bequemen Testen, siehe
    // handleKeydown().
    this.keydownHandler = (e) => this.handleKeydown(e);
    document.addEventListener("keydown", this.keydownHandler);
    this.updateDisplay();
  }

  private buildKeys(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "osk";

    if (this.opts.layout === "numeric") {
      // Schmale Extra-Reihe nur fuer Backspace, rechtsbuendig -- auf
      // ausdruecklichen Wunsch soll Backspace bei JEDER Tastatur oben
      // rechts sitzen, wie bei den meisten echten Tastaturen (vorher unten
      // links neben der 0).
      const topRow = document.createElement("div");
      topRow.className = "osk__row osk__row--end";
      topRow.appendChild(this.buildKey("←", "←"));
      wrap.appendChild(topRow);

      const rows = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
      ];
      for (const row of rows) {
        wrap.appendChild(this.buildRow(row));
      }
      const lastRow = document.createElement("div");
      lastRow.className = "osk__row";
      lastRow.appendChild(this.buildKey("0", "0"));
      lastRow.appendChild(this.buildKey("OK", "OK", "osk__key--accent osk__key--wide"));
      wrap.appendChild(lastRow);
    } else {
      this.lettersArea = document.createElement("div");
      this.lettersArea.className = "osk__letters";
      this.renderLetterRows();
      wrap.appendChild(this.lettersArea);
    }

    if (!this.opts.extraKeys) return wrap;

    // Nur fuer den Admin-Login (siehe extraKeys-Option): Buchstaben-Tastatur
    // links, zusaetzliches Zahlenfeld (3er-Reihen wie ein Ziffernblock)
    // rechts daneben -- alles eine einzige Tastatur.
    wrap.classList.add("osk__main");
    const outer = document.createElement("div");
    outer.className = "osk__with-extra";
    outer.append(wrap, this.buildNumpad());
    return outer;
  }

  /**
   * Baut die Buchstaben- ODER Sonderzeichen-Reihen (je nach symbolsMode)
   * inklusive Backspace (oben rechts, siehe buildKeys) und der untersten
   * Reihe (Leerzeichen/OK, plus Umschalttaste zu Sonderzeichen falls
   * symbolsToggle aktiv ist) komplett neu -- wird nicht nur einmalig beim
   * Aufbau aufgerufen, sondern jedes Mal, wenn die "?123"/"ABC"-Taste
   * gedrueckt wird (siehe handleClick), da sich dabei der komplette
   * Zeichensatz aendert, nicht nur eine Beschriftung wie bei Gross-/
   * Kleinschreibung (applyCaseToLetterKeys).
   */
  private renderLetterRows(): void {
    const container = this.lettersArea!;
    container.innerHTML = "";
    const rowsSource = this.symbolsMode ? SYMBOL_ROWS : ALPHA_ROWS;
    rowsSource.forEach((row, i) => {
      const rowEl = this.buildRow(row.split(""));
      if (i === 0) {
        rowEl.appendChild(this.buildKey("←", "←"));
      }
      // Zwei getrennte Umschalttasten (wie bei einer echten Tastatur, auf
      // die mittlere und untere Buchstabenreihe verteilt) -- nur wenn
      // caseToggle aktiv ist UND gerade Buchstaben (nicht Sonderzeichen)
      // gezeigt werden, Gross-/Kleinschreibung ergibt bei Sonderzeichen
      // keinen Sinn. "⇪" ist die Feststelltaste (bleibt an, bis sie erneut
      // gedrueckt wird) und sitzt wie auf einer echten Tastatur in der
      // mittleren Reihe; "⇧" (einmaliges Shift) sitzt darunter in der
      // untersten Buchstabenreihe.
      if (!this.symbolsMode && this.opts.caseToggle && i === 1) {
        rowEl.appendChild(this.buildKey("⇪", "⇪"));
      }
      if (!this.symbolsMode && this.opts.caseToggle && i === rowsSource.length - 1) {
        rowEl.appendChild(this.buildKey("⇧", "⇧"));
      }
      container.appendChild(rowEl);
    });

    const lastRow = document.createElement("div");
    lastRow.className = "osk__row";
    if (this.opts.symbolsToggle) {
      // Wie bei mobilen Tastaturen: kleine Umschalttaste links neben dem
      // Leerzeichen, Beschriftung zeigt jeweils das ZIEL des naechsten
      // Tastendrucks (nicht den aktuellen Zustand).
      lastRow.appendChild(this.buildKey(this.symbolsMode ? "ABC" : "#!?", "TOGGLE_SYMBOLS"));
    }
    lastRow.appendChild(this.buildKey("␣ Leerzeichen", " ", "osk__key--wide"));
    lastRow.appendChild(this.buildKey(this.opts.submitLabel, "OK", "osk__key--accent osk__key--wide"));
    container.appendChild(lastRow);

    // Buchstabentasten werden oben immer mit ihrem Grossbuchstaben-Label
    // gebaut -- bei caseToggle (Start = kleingeschrieben) muss die
    // Beschriftung daher einmalig auf klein umgestellt werden.
    if (this.opts.caseToggle) this.applyCaseToLetterKeys();

    // Beim allerersten Aufbau (aus dem Konstruktor heraus) haengt this.el
    // noch nicht im DOM -- getBoundingClientRect() liefert dann ueberall
    // nur Nullen, eine Neuberechnung waere sinnlos. Nach mount() (siehe
    // dort) UND bei jedem spaeteren Neuaufbau (z.B. "?123"/"ABC"-Umschalten,
    // siehe handleClick) dagegen schon.
    if (this.el.isConnected) this.fitLetterKeys();
  }

  private buildNumpad(): HTMLDivElement {
    const numpad = document.createElement("div");
    numpad.className = "osk__numpad";
    const rows = [
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
    ];
    for (const row of rows) numpad.appendChild(this.buildRow(row));
    const zeroRow = document.createElement("div");
    zeroRow.className = "osk__row osk__row--center";
    zeroRow.appendChild(this.buildKey("0", "0"));
    numpad.appendChild(zeroRow);
    return numpad;
  }

  private buildRow(keys: string[]): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "osk__row";
    for (const k of keys) {
      const extra = k === "OK" ? "osk__key--accent" : "";
      row.appendChild(this.buildKey(k, k, extra));
    }
    return row;
  }

  private buildKey(label: string, value: string, extraClass = ""): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `osk__key ${extraClass}`.trim();
    btn.textContent = label;
    btn.dataset.key = value;
    return btn;
  }

  /**
   * Erlaubt zusaetzlich zur Bildschirmtastatur auch Eingaben ueber eine
   * angeschlossene physische USB-Tastatur -- rein zum bequemen Testen
   * gedacht, die Bildschirmtastatur bleibt der fuer den eigentlichen Kiosk-
   * Betrieb vorgesehene Weg. Physische Eingaben werden 1:1 uebernommen
   * (auch Gross-/Kleinschreibung so, wie tatsaechlich getippt) OHNE durch
   * die eigene Umschalt-Logik (capsLock/shiftOnce) zu laufen -- eine echte
   * Tastatur bringt ihre Gross-/Kleinschreibung schon selbst mit.
   */
  private handleKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      this.value = this.value.slice(0, -1);
      this.updateDisplay();
      this.opts.onChange?.(this.value);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.opts.onSubmit?.(this.value);
      return;
    }
    if (e.key.length !== 1) return; // Modifier-/Funktionstasten (Tab, Shift, Pfeile, ...) ignorieren
    if (this.opts.layout === "numeric" && !/^[0-9]$/.test(e.key)) return;
    if (this.value.length >= this.opts.maxLength) return;
    e.preventDefault();
    this.value += e.key;
    this.updateDisplay();
    this.opts.onChange?.(this.value);
  }

  private handleClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-key]");
    if (!target) return;
    const key = target.dataset.key!;
    if (key === "TOGGLE_SYMBOLS") {
      this.symbolsMode = !this.symbolsMode;
      // Anders als beim Gross-/Klein-Umschalten (applyCaseToLetterKeys)
      // aendert sich hier der komplette Zeichensatz -- die Reihen muessen
      // deshalb neu aufgebaut werden, ein reines Umlabeln reicht nicht.
      this.renderLetterRows();
      return;
    }
    if (key === "⇧") {
      // Klassisches Shift: macht nur den naechsten Buchstaben einmalig
      // gross (wird beim naechsten Buchstaben-Tastendruck unten wieder
      // automatisch deaktiviert).
      this.shiftOnce = !this.shiftOnce;
      this.applyCaseToLetterKeys();
      return;
    }
    if (key === "⇪") {
      // Feststelltaste ("Umschalt"): bleibt an, bis sie erneut gedrueckt wird.
      this.capsLock = !this.capsLock;
      this.applyCaseToLetterKeys();
      return;
    }
    if (key === "←") {
      this.value = this.value.slice(0, -1);
    } else if (key === "OK") {
      this.opts.onSubmit?.(this.value);
      return;
    } else if (this.value.length < this.opts.maxLength) {
      // dataset.key bleibt bei Buchstaben immer der kanonische Grossbuchstabe
      // (siehe applyCaseToLetterKeys) -- die tatsaechlich eingefuegte
      // Gross-/Kleinschreibung haengt vom aktuellen Umschaltzustand ab. Ohne
      // caseToggle (z.B. Highscore-Namenseingabe) gibt es keine Umschalt-
      // taste, dort bleibt es wie bisher immer bei Grossbuchstaben.
      const isLetter = /^[A-ZÄÖÜ]$/.test(key);
      const effectiveUpper = this.opts.caseToggle ? this.capsLock || this.shiftOnce : this.uppercase;
      this.value += isLetter && !effectiveUpper ? key.toLowerCase() : key;
      if (isLetter && this.shiftOnce) {
        this.shiftOnce = false;
        this.applyCaseToLetterKeys();
      }
    }
    this.updateDisplay();
    this.opts.onChange?.(this.value);
  }

  /** Aktualisiert nur die ANZEIGE der Buchstabentasten (Gross/Klein) -- dataset.key bleibt unveraendert kanonisch, siehe handleClick. */
  private applyCaseToLetterKeys(): void {
    const effectiveUpper = this.opts.caseToggle ? this.capsLock || this.shiftOnce : this.uppercase;
    // this.lettersArea statt this.el abfragen: beim allerersten Aufruf (aus
    // renderLetterRows() heraus, waehrend buildKeys() noch laeuft) haengt
    // das gebaute Tasten-Markup zwar schon in lettersArea, aber lettersArea
    // selbst noch NICHT in this.el (der Konstruktor haengt buildKeys() erst
    // NACH dessen Rueckgabe an) -- eine Abfrage auf this.el fand dann exakt
    // 0 Tasten und liess die caseToggle-Tastatur (WLAN-/Admin-Login) beim
    // Oeffnen faelschlich gross starten, statt wie vorgesehen klein (siehe
    // capsLock/shiftOnce Start = false) und erst durch Umschalt/Shift gross
    // umschaltbar (gemeldeter Bug).
    const keys = (this.lettersArea ?? this.el).querySelectorAll<HTMLButtonElement>("[data-key]");
    keys.forEach((btn) => {
      const k = btn.dataset.key!;
      if (/^[A-ZÄÖÜ]$/.test(k)) {
        btn.textContent = effectiveUpper ? k : k.toLowerCase();
      }
      if (k === "⇧") {
        btn.classList.toggle("osk__key--accent", this.shiftOnce);
      }
      if (k === "⇪") {
        btn.classList.toggle("osk__key--accent", this.capsLock);
      }
    });
  }

  private updateDisplay(): void {
    const shown = this.opts.mask ? "•".repeat(this.value.length) : this.value;
    this.display.textContent = this.value.length > 0 ? shown : this.opts.placeholder;
    this.display.style.opacity = this.value.length > 0 ? "1" : "0.45";
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value.slice(0, this.opts.maxLength);
    this.updateDisplay();
  }

  mount(parent: HTMLElement): void {
    // Nur beim Ziffernblock noetig: der Elternknoten ist dort meist ein
    // schmuckloser Wrapper-Div in einem Flex-Container mit
    // align-items:center (z.B. .stage-sheet) -- ohne stretch schrumpft
    // dieser Wrapper auf seinen eigenen Inhalt zusammen, ein zirkulaerer
    // Bezug (da .osk selbst width:100% seines Elternknotens ist), der
    // fitNumericKeys() unten eine falsche, viel zu kleine Breite messen
    // liesse. Fuer die alphanumerische Tastatur (Highscore-Name, Admin-
    // Login) wird dagegen immer in ein Modal-Panel gemountet -- dort liess
    // "stretch" das Panel auf die volle Scrim-Hoehe aufziehen und brachte
    // in diesem Headless-Chromium den Titel (h2) zum Verschwinden (Layout-
    // und Paint-Position liefen auseinander), obwohl das Panel dafuer gar
    // keinen Grund hatte -- Modal-Panels sollen ohnehin nur so hoch wie ihr
    // Inhalt sein (siehe .modal-scrim/.modal-panel in style.css).
    if (this.opts.layout === "numeric") {
      parent.style.alignSelf = "stretch";
    }
    parent.appendChild(this.el);
    if (this.opts.layout === "numeric") {
      // Feste Pixelgroessen (statt reinem CSS flex/aspect-ratio) garantieren
      // hier zuverlaessig quadratische Tasten, die trotzdem nie breiter
      // werden als der tatsaechlich verfuegbare Platz -- dieser Bereich
      // steckt in einem "stage-sheet", dessen Breite je nach Geraet/
      // Bildschirmausschnitt stark variiert.
      this.fitNumericKeys();
      this.resizeObserver = new ResizeObserver(() => this.fitNumericKeys());
      this.resizeObserver.observe(this.el);
    } else {
      // Buchstaben-/Sonderzeichentastatur (Highscore-Name, Admin-Login, ...):
      // war bisher rein vh/vw-basiert mit einem festen 44px-Sockel -- auf
      // einem sehr kurzen Bildschirm (z.B. Testgeraet 528x300) sprengten
      // 4 Reihen a 44px plus Anzeigefeld/Modal-Polsterung zusammen locker
      // die verfuegbare Hoehe, das Modal musste dann gescrollt werden
      // (gemeldeter Bug, "will auf gar keinen Fall bei 'ner Tastatur
      // scrollen muessen"). Gleiches Prinzip wie fitNumericKeys(): echte
      // Messung statt geschaetzter vh-Werte, siehe fitLetterKeys().
      this.fitLetterKeys();
      this.resizeObserver = new ResizeObserver(() => this.fitLetterKeys());
      this.resizeObserver.observe(this.el);
      // KEIN eigener MutationObserver hier (fuer z. B. einen erst nach
      // mount() angehaengten "Abbrechen"-Button oder eine spaeter per JS
      // gesetzte Fehlermeldung, siehe admin/AdminPanel.ts/core/
      // highscorePrompt.ts): core/modal.ts#openModal beobachtet fuer
      // Tastatur-Modals bereits das gesamte Panel und skaliert es bei
      // Bedarf ALS GANZES per transform:scale() (fasst dabei automatisch
      // auch die Tastatur mit). Ein zusaetzlicher Observer HIER wuerde bei
      // genau diesen Aenderungen erneut fitLetterKeys() ausloesen, WAEHREND
      // das Panel unter Umstaenden bereits transformiert ist -- alle
      // getBoundingClientRect()-Messungen unten liefern dann bereits
      // VERZERRTE (durch die Panel-Skalierung gestauchte) Werte, was zu
      // einer falsch berechneten (doppelt verkleinerten) Tastengroesse
      // fuehrte (beobachtet/per Messung belegt).
    }
  }

  private fitNumericKeys(): void {
    const cols = 3;
    // 5 statt 4: die zusaetzliche schmale Backspace-Reihe oben (siehe
    // buildKeys) zaehlt fuer die Hoehenberechnung mit, sonst koennten die
    // Tasten auf kurzen Bildschirmen zusammen wieder ueber den unteren
    // Bildschirmrand hinausragen.
    const rows = 5;
    const rowGap = 6;
    const colGap = 6;
    // Vertikaler Abstand ZWISCHEN den Reihen kommt aus dem "gap" der
    // ".osk"-Flex-Spalte selbst (siehe style.css) -- ein eigener, fixer
    // Wert, unabhaengig von --osk-row-gap (das steuert nur den
    // HORIZONTALEN Abstand zwischen Tasten INNERHALB einer Reihe).
    const rowGapVertical = 8;
    const width = this.el.clientWidth;
    if (width <= 0) return;
    const widthBasedSize = (width - colGap * (cols - 1)) / cols;
    // Zusaetzlich an der tatsaechlich verfuegbaren Hoehe orientieren, sonst
    // kann die (nur breitenbasiert berechnete) Tastatur auf kurzen/breiten
    // Bildschirmen zusammen hoeher werden als der Bildschirm selbst und
    // unten rausragen, statt zu schrumpfen. War lange nur "40% der
    // Fensterhoehe" geschaetzt -- passte nicht, sobald ueber der Tastatur
    // (z.B. Frage + "Anzahl"-Anzeigefeld, siehe games/count-passengers)
    // schon selbst nennenswert Platz verbraucht war, die Tasten ragten dann
    // trotzdem unten heraus (gemeldeter/per Screenshot belegter Bug). Jetzt
    // ECHT gemessen: von der Unterkante des Anzeigefelds (this.display, auch
    // ein Kind von this.el -- NICHT this.el selbst, das war der eigentliche
    // Fehler in einer ersten Fassung: this.el.top liegt VOR dem Anzeigefeld,
    // dessen Hoehe fehlte dadurch komplett im Budget) bis zum unteren Rand
    // des naechsten scrollbaren Vorfahren (z.B. .stage-center-panel/
    // .stage-sheet) -- NICHT bis zur Fussleiste, deren eigener CSS-
    // "bottom"-Versatz nicht zwangslaeufig mit dem des tatsaechlichen
    // Panel-Containers uebereinstimmt.
    const contentTop = this.display.getBoundingClientRect().bottom;
    let scrollAncestor: HTMLElement | null = this.el.parentElement;
    while (scrollAncestor && scrollAncestor !== document.body) {
      const overflowY = getComputedStyle(scrollAncestor).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollAncestor = scrollAncestor.parentElement;
    }
    const limitBottom =
      scrollAncestor && scrollAncestor !== document.body
        ? scrollAncestor.getBoundingClientRect().bottom
        : (document.querySelector(".chrome-footer-bar")?.getBoundingClientRect().top ?? window.innerHeight);
    // Eigenes unteres Padding des Scroll-Vorfahren (z.B. .stage-sheet)
    // gehoert zu dessen Box (getBoundingClientRect().bottom schliesst es
    // ein), ist aber KEIN fuer die Tastatur nutzbarer Platz -- ohne Abzug
    // ragten die Tasten entsprechend weit in dieses Padding hinein (gleicher
    // Fehler wie urspruenglich bei fitLetterKeys(), siehe dort).
    const scrollAncestorPaddingBottom =
      scrollAncestor && scrollAncestor !== document.body ? parseFloat(getComputedStyle(scrollAncestor).paddingBottom) || 0 : 0;
    // "- 18" statt "- 8": zusaetzlich zum Sicherheitsabstand faellt zwischen
    // Anzeigefeld und Tastenblock noch dessen eigener marginBottom (10px)
    // UND der Flex-"gap" von ".osk" (8px) an -- beides zusammen 18px, die
    // sonst im Budget fehlten und die Tastatur trotz "echter" Messung noch
    // ein Stueck zu gross werden liessen.
    const availableHeight = Math.max(0, limitBottom - contentTop - 18 - scrollAncestorPaddingBottom);
    const heightBasedSize = (availableHeight - rowGapVertical * (rows - 1)) / rows;
    const size = Math.floor(Math.min(widthBasedSize, heightBasedSize));
    // War Math.max(50, ...) -- auf einem sehr kurzen Bildschirm liess dieser
    // Komfort-Sockel die Tastatur trotz obiger Messung nicht mehr genug
    // schrumpfen und ragte weiterhin ueber den Bildschirmrand (gleiches
    // Bug-Muster wie an anderer Stelle in der App, siehe style.css-
    // Kommentar am Dateianfang) -- jetzt nur noch eine kleine technische
    // Notbremse.
    const clamped = Math.max(14, Math.min(110, size));
    this.el.style.setProperty("--osk-key-size", `${clamped}px`);
    this.el.style.setProperty("--osk-row-gap", `${rowGap}px`);
  }

  /**
   * Analog zu fitNumericKeys(), aber fuer die Buchstaben-/Sonderzeichen-
   * tastatur (und das optionale Zahlenfeld daneben bei extraKeys): die
   * Tastenhoehe kam vorher rein aus CSS (vh/vw-Clamp mit 44px-Sockel), der
   * auf kurzen Bildschirmen zusammen mit Anzeigefeld + Modal-Titel/-Text +
   * Polsterung ueber die verfuegbare Hoehe hinausragte -- das Modal musste
   * dann gescrollt werden, was bei einer Tastatur nie passieren soll. Misst
   * jetzt genau wie beim Ziffernblock von der Unterkante des Anzeigefelds
   * bis zum unteren Rand des naechsten scrollbaren Vorfahren (i.d.R.
   * .modal-panel) und teilt den so ermittelten Platz durch die tatsaechliche
   * Zeilenzahl (3 Buchstaben-/Sonderzeichenreihen + 1 Leerzeichen/OK-Reihe).
   * Die Breite regelt weiterhin reines Flexbox (jede Taste flex:1), das
   * bleibt unveraendert -- nur die Hoehe (und mit ihr die Schriftgroesse)
   * wird hier bewusst begrenzt.
   */
  private fitLetterKeys(): void {
    if (!this.lettersArea) return;
    const rows = (this.symbolsMode ? SYMBOL_ROWS : ALPHA_ROWS).length + 1;
    const contentTop = this.display.getBoundingClientRect().bottom;
    let scrollAncestor: HTMLElement | null = this.el.parentElement;
    while (scrollAncestor && scrollAncestor !== document.body) {
      const overflowY = getComputedStyle(scrollAncestor).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scrollAncestor = scrollAncestor.parentElement;
    }
    // War hier (anders als bei limitBottom selbst) bisher NICHT beruecksichtigt:
    // der Scroll-Vorfahre (i.d.R. .modal-panel) hat selbst ein eigenes
    // unteres Padding (siehe .modal-panel), das Teil seiner
    // getBoundingClientRect()-Box ist, aber KEIN fuer Inhalt nutzbarer
    // Platz -- ohne Abzug ragte die Tastatur trotz "echter" Messung
    // weiterhin ein Stueck in dieses Padding hinein und das Panel musste
    // (minimal) gescrollt werden (per Playwright-Messung belegt).
    const scrollAncestorPaddingBottom =
      scrollAncestor && scrollAncestor !== document.body ? parseFloat(getComputedStyle(scrollAncestor).paddingBottom) || 0 : 0;
    let limitBottom =
      scrollAncestor && scrollAncestor !== document.body ? scrollAncestor.getBoundingClientRect().bottom : window.innerHeight;
    // Geschwister-Elemente, die ERST NACH mount() (und damit nach DIESER
    // Messung) im selben Eltern-Container angehaengt werden -- z. B. ein
    // "Abbrechen"-Button, siehe admin/AdminPanel.ts/core/highscorePrompt.ts
    // -- kennt diese Funktion bewusst nicht: core/modal.ts#openModal
    // beobachtet fuer Tastatur-Modals das GESAMTE Panel per ResizeObserver/
    // MutationObserver und skaliert es bei Bedarf als Ganzes, das faengt
    // auch nachtraeglich angehaengte Geschwister zuverlaessig ab (siehe
    // Kommentar bei mount() oben, warum das NICHT hier zusaetzlich versucht
    // wird). AUSNAHME: Auf Handybildschirmgroesse (siehe .modal-panel--
    // keyboard .modal-fit-wrap > .osk in style.css) ist this.el SELBST ein
    // flex:1-Element -- der Browser weist ihm dabei bereits korrekt nur so
    // viel Hoehe zu, wie NACH Abzug aller Geschwister (inkl. eines erst
    // spaeter angehaengten "Abbrechen"-Buttons) uebrig bleibt. In diesem
    // Fall ist this.el's eigene (durch Flex bereits geschwister-bewusste)
    // Unterkante die praezisere Grenze als die des Scroll-Vorfahren (der ja
    // nichts von den Geschwistern weiss) -- ohne diese Ausnahme wuchsen die
    // Tasten hier ueber die eigene Flex-Box hinaus und ueberlappten sichtbar
    // einen nachtraeglich angehaengten Button (per Screenshot belegter Bug).
    // Der ResizeObserver auf this.el (siehe mount()) bemerkt zuverlaessig,
    // wenn sich diese Flex-zugewiesene Groesse durch ein neues Geschwister
    // aendert -- KEIN zusaetzlicher MutationObserver noetig.
    const ownFlexGrow = parseFloat(getComputedStyle(this.el).flexGrow || "0");
    if (ownFlexGrow > 0) limitBottom = Math.min(limitBottom, this.el.getBoundingClientRect().bottom);
    const availableHeight = Math.max(0, limitBottom - contentTop - 18 - scrollAncestorPaddingBottom);
    // Der Zeilenabstand skaliert bewusst PROPORTIONAL mit der Tastenhoehe
    // (statt eines fixen 8px-Werts) -- auf einem sehr kurzen Bildschirm
    // (z.B. Testgeraet 528x300 mit ohnehin knappem Modal-Platz oberhalb der
    // Tastatur, siehe .modal-panel-Padding/-Titel/-Beschreibung) sprengte
    // allein ein fixer Zeilenabstand von 3 x 8px = 24px bereits einen
    // Grossteil des verfuegbaren Budgets, WEIT bevor die Tasten selbst auf
    // eine sinnvolle Groesse schrumpfen konnten -- die Tastatur ragte trotz
    // Sockel-Groesse weiterhin unten heraus. Aufloesung von
    // "verfuegbar = rows*key + (rows-1)*gapFactor*key" nach key.
    const gapFactor = 0.18;
    const rawKeySize = availableHeight / (rows + (rows - 1) * gapFactor);
    // Kein hoher Komfort-Sockel (war 14, siehe style.css-Kommentar zu
    // frueheren, aehnlichen Faellen) -- auf ausdruecklichen Wunsch soll eine
    // Tastatur NIE gescrollt werden muessen, auch nicht auf einem extrem
    // kurzen Testbildschirm mit vollem Anzeigefeld/Modal-Titel darueber.
    // 6px ist nur eine technische Notbremse gegen eine Groesse von 0.
    const clamped = Math.max(6, Math.min(92, Math.floor(rawKeySize)));
    const rowGap = Math.max(2, Math.round(clamped * gapFactor));
    const fontSize = Math.max(7, Math.min(42, Math.floor(clamped * 0.34)));
    this.el.style.setProperty("--osk-letter-key-size", `${clamped}px`);
    this.el.style.setProperty("--osk-letter-font-size", `${fontSize}px`);
    this.el.style.setProperty("--osk-letter-row-gap", `${rowGap}px`);
  }

  destroy(): void {
    this.el.removeEventListener("click", this.clickHandler);
    document.removeEventListener("keydown", this.keydownHandler);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.el.remove();
  }
}
