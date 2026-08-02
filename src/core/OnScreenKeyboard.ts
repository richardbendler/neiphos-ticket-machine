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
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

const ALPHA_ROWS = ["QWERTZUIOP", "ASDFGHJKL", "YXCVBNM"];

export class OnScreenKeyboard {
  readonly el: HTMLDivElement;
  private display: HTMLDivElement;
  private value: string;
  private readonly opts: Required<Omit<OnScreenKeyboardOptions, "onChange" | "onSubmit">> & {
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
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
      onChange: options.onChange,
      onSubmit: options.onSubmit,
    };
    this.value = this.opts.initialValue;

    this.el = document.createElement("div");
    this.el.className = `osk osk--${this.opts.layout}`;

    this.display = document.createElement("div");
    this.display.className = "field-input";
    this.display.style.textAlign = "center";
    this.display.style.marginBottom = "10px";
    this.display.style.minHeight = "1.4em";

    this.el.appendChild(this.display);
    this.el.appendChild(this.buildKeys());
    this.clickHandler = (e) => this.handleClick(e);
    this.el.addEventListener("click", this.clickHandler);

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
      for (const row of ALPHA_ROWS) {
        wrap.appendChild(this.buildRow(row.split("")));
      }
      const lastRow = document.createElement("div");
      lastRow.className = "osk__row";
      lastRow.appendChild(this.buildKey("␣ Leerzeichen", " ", "osk__key--wide"));
      lastRow.appendChild(this.buildKey("←", "←"));
      lastRow.appendChild(this.buildKey(this.opts.submitLabel, "OK", "osk__key--accent osk__key--wide"));
      wrap.appendChild(lastRow);
    }

    return wrap;
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
    if (key === "←") {
      this.value = this.value.slice(0, -1);
    } else if (key === "OK") {
      this.opts.onSubmit?.(this.value);
      return;
    } else if (this.value.length < this.opts.maxLength) {
      this.value += key;
    }
    this.updateDisplay();
    this.opts.onChange?.(this.value);
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
    // Der Elternknoten ist meist ein schmuckloser Wrapper-Div in einem Flex-
    // Container mit align-items:center (z.B. .stage-sheet) -- ohne stretch
    // schrumpft dieser Wrapper auf seinen eigenen Inhalt zusammen, ein
    // zirkulaerer Bezug (da .osk selbst width:100% seines Elternknotens
    // ist), der fitNumericKeys() unten eine falsche, viel zu kleine Breite
    // messen liesse.
    parent.style.alignSelf = "stretch";
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
    const rowGap = 6;
    const colGap = 6;
    const width = this.el.clientWidth;
    if (width <= 0) return;
    const size = Math.floor((width - colGap * (cols - 1)) / cols);
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
