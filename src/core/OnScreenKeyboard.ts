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
  private readonly opts: Required<Omit<OnScreenKeyboardOptions, "onChange" | "onSubmit" | "displayFontSize" | "displayColor">> & {
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
    displayFontSize?: string;
    displayColor?: string;
  };
  private readonly clickHandler: (e: Event) => void;
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

    // Buchstabentasten wurden oben immer mit ihrem Grossbuchstaben-Label
    // gebaut -- bei caseToggle (Start = kleingeschrieben) muessen die
    // Beschriftungen daher einmalig auf klein umgestellt werden.
    if (this.opts.caseToggle) this.applyCaseToLetterKeys();

    this.updateDisplay();
  }

  private buildKeys(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "osk";

    if (this.opts.layout === "numeric") {
      const rows = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["←", "0", "OK"],
      ];
      for (const row of rows) {
        wrap.appendChild(this.buildRow(row));
      }
    } else {
      ALPHA_ROWS.forEach((row, i) => {
        const rowEl = this.buildRow(row.split(""));
        // Zwei getrennte Umschalttasten (wie bei einer echten Tastatur, auf
        // die mittlere und untere Buchstabenreihe verteilt) -- nur wenn
        // caseToggle aktiv ist (aktuell nur Admin-Login, siehe Options-
        // Kommentar): "⇧" macht einmalig nur den naechsten Buchstaben gross,
        // "⇪" ist eine Feststelltaste, die an bleibt, bis sie erneut
        // gedrueckt wird.
        if (this.opts.caseToggle && i === 1) {
          rowEl.appendChild(this.buildKey("⇧", "⇧"));
        }
        if (this.opts.caseToggle && i === ALPHA_ROWS.length - 1) {
          rowEl.appendChild(this.buildKey("⇪", "⇪"));
        }
        wrap.appendChild(rowEl);
      });
      const lastRow = document.createElement("div");
      lastRow.className = "osk__row";
      lastRow.appendChild(this.buildKey("␣ Leerzeichen", " ", "osk__key--wide"));
      lastRow.appendChild(this.buildKey("←", "←"));
      lastRow.appendChild(this.buildKey(this.opts.submitLabel, "OK", "osk__key--accent osk__key--wide"));
      wrap.appendChild(lastRow);
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

  private handleClick(e: Event): void {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-key]");
    if (!target) return;
    const key = target.dataset.key!;
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
    const keys = this.el.querySelectorAll<HTMLButtonElement>("[data-key]");
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
    }
  }

  private fitNumericKeys(): void {
    const cols = 3;
    const rows = 4;
    const rowGap = 6;
    const colGap = 6;
    const width = this.el.clientWidth;
    if (width <= 0) return;
    const widthBasedSize = (width - colGap * (cols - 1)) / cols;
    // Zusaetzlich an der Fensterhoehe orientieren, sonst kann die (nur
    // breitenbasiert berechnete) Tastatur auf kurzen/breiten Bildschirmen
    // zusammen hoeher werden als der Bildschirm selbst und unten
    // rausragen, statt zu schrumpfen.
    const heightBasedSize = (window.innerHeight * 0.4 - rowGap * (rows - 1)) / rows;
    const size = Math.floor(Math.min(widthBasedSize, heightBasedSize));
    const clamped = Math.max(50, Math.min(110, size));
    this.el.style.setProperty("--osk-key-size", `${clamped}px`);
    this.el.style.setProperty("--osk-row-gap", `${rowGap}px`);
  }

  destroy(): void {
    this.el.removeEventListener("click", this.clickHandler);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.el.remove();
  }
}
