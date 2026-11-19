// Gemeinsame Hilfen der Bausteine (Phase 11 E4c0): Elemente bauen, Kennungen, Erklaerung per "?", ein Hinweis je Baustein, Tastatur der Auswahlgruppen.
// Kein Satz der Oberflaeche steht hier: jeder Text kommt als Eingabe. Es wird nie innerHTML benutzt, Texte gehen ueber textContent.

let zaehler = 0;
export function neueKennung(vorsatz: string): string {
  zaehler += 1;
  return `v-${vorsatz}-${zaehler}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, klasse = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function knopf(klasse: string, text?: string): HTMLButtonElement {
  const k = el('button', klasse, text);
  k.type = 'button';
  return k;
}

// Jeder Baustein traegt `data-v-baustein` mit seiner Art (Tests und Seiten finden ihn so).
export function wurzel(art: string, klasse = ''): HTMLDivElement {
  const w = el('div', `v-baustein v-${art}${klasse ? ` ${klasse}` : ''}`);
  w.dataset.vBaustein = art;
  return w;
}

export interface ErklaerungEingabe {
  knopfLabel: string; // Name des "?"-Knopfs fuer Screenreader, zum Beispiel "What does this do?"
  text: string; // die Erklaerung, sichtbar nur nach dem Druck auf "?"
}

// "?" am Titel: ein Knopf mit aria-expanded und aria-controls, der ein Feld mit der Erklaerung zeigt. Der Knopf selbst ist 44 mal 44 Pixel gross
// (`--v-fingerziel`), nur der Kreis darin ist klein. Escape schliesst.
export function baueErklaerungTeile(eingabe: ErklaerungEingabe): { knopf: HTMLButtonElement; feld: HTMLElement } {
  const feld = el('p', 'v-erklaerung', eingabe.text);
  feld.id = neueKennung('erklaerung');
  feld.hidden = true;
  const k = knopf('v-frage');
  const kreis = el('span', 'v-frage-kreis', '?');
  kreis.setAttribute('aria-hidden', 'true');
  k.append(kreis);
  k.setAttribute('aria-label', eingabe.knopfLabel);
  k.setAttribute('aria-expanded', 'false');
  k.setAttribute('aria-controls', feld.id);
  const setze = (offen: boolean) => {
    feld.hidden = !offen;
    k.setAttribute('aria-expanded', String(offen));
  };
  k.addEventListener('click', () => setze(!!feld.hidden));
  k.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !feld.hidden) {
      e.preventDefault();
      setze(false);
    }
  });
  return { knopf: k, feld };
}

export interface TitelHandle {
  element: HTMLElement; // Zeile mit Titel und "?" plus (zugeklappt) das Feld der Erklaerung
  titel: HTMLElement; // der Titeltext, Ziel fuer aria-labelledby
  knopf: HTMLButtonElement | null;
  feld: HTMLElement | null;
  setzeTitel(text: string): void;
}

export interface TitelEingabe {
  titel: string;
  erklaerung?: ErklaerungEingabe;
}

// Titelzeile mit optionaler Erklaerung per "?". Auch einzeln als Baustein benutzbar.
export function baueTitel(eingabe: TitelEingabe): TitelHandle {
  const huelle = el('div', 'v-titel');
  const zeile = el('div', 'v-titelzeile');
  const text = el('span', 'v-titeltext', eingabe.titel);
  text.id = neueKennung('titel');
  zeile.append(text);
  let k: HTMLButtonElement | null = null;
  let f: HTMLElement | null = null;
  if (eingabe.erklaerung) {
    const t = baueErklaerungTeile(eingabe.erklaerung);
    k = t.knopf;
    f = t.feld;
    zeile.append(k);
  }
  huelle.append(zeile);
  if (f) huelle.append(f);
  return { element: huelle, titel: text, knopf: k, feld: f, setzeTitel: (t) => (text.textContent = t) };
}

// Hoechstens ein Hinweis je Baustein: das Fach besitzt genau ein `p.v-hinweis`, setzt man erneut einen Text, wird derselbe Absatz ueberschrieben.
// null oder leer nimmt ihn weg. Solange er da ist, verweist `aria-describedby` des Ziels auf ihn.
export class HinweisFach {
  private absatz: HTMLElement | null = null;
  private readonly kennung = neueKennung('hinweis');
  constructor(
    private readonly anker: Element,
    private readonly ziel: Element | null,
    text?: string | null,
  ) {
    this.setze(text ?? null);
  }
  setze(text: string | null): void {
    if (!text) {
      this.absatz?.remove();
      this.absatz = null;
      this.ziel?.removeAttribute('aria-describedby');
      return;
    }
    if (!this.absatz) {
      this.absatz = el('p', 'v-hinweis');
      this.absatz.id = this.kennung;
      this.anker.after(this.absatz);
    }
    this.absatz.textContent = text;
    this.ziel?.setAttribute('aria-describedby', this.kennung);
  }
  get text(): string | null {
    return this.absatz?.textContent ?? null;
  }
}

// Der Hinweis als eigener Baustein (ein Absatz). Wer einen Hinweis zu einem anderen Baustein will, gibt ihn dort als `hinweis` mit.
export function baueHinweis(text: string): HTMLElement {
  const w = el('p', 'v-hinweis', text);
  w.dataset.vBaustein = 'hinweis';
  return w;
}

// Gruppe von Knoepfen mit role="radio": nur der markierte (sonst der erste) ist per Tab erreichbar. Pfeiltasten, Pos1 und Ende bewegen NUR den
// Fokus (Nacharbeit R6): gewaehlt wird mit Leertaste, Eingabe oder Klick, damit ein Pfeil nie etwas speichert. Der Knopf mit dem Fokus ist
// der eine Tab-Halt, bis die Markierung neu gesetzt wird.
export function radioTastatur(gruppe: HTMLElement): void {
  gruppe.addEventListener('keydown', (e) => {
    const knoepfe = [...gruppe.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
    const aktuell = knoepfe.findIndex((k) => k === e.target || k.contains(e.target as Node));
    if (aktuell < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    let ziel = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ziel = (aktuell + 1) % knoepfe.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ziel = (aktuell - 1 + knoepfe.length) % knoepfe.length;
    else if (e.key === 'Home') ziel = 0;
    else if (e.key === 'End') ziel = knoepfe.length - 1;
    if (ziel < 0) return;
    e.preventDefault();
    knoepfe.forEach((k, i) => (k.tabIndex = i === ziel ? 0 : -1));
    knoepfe[ziel]?.focus();
  });
  // Beim Verlassen der Gruppe (Fokus geht ausserhalb) liegt der Tab-Halt wieder auf der gewaehlten, sonst auf der ersten Stufe.
  gruppe.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && gruppe.contains(e.relatedTarget)) return;
    setzeTabHalt([...gruppe.querySelectorAll<HTMLButtonElement>('[role="radio"]')]);
  });
}

// Markierung und Tab-Reihenfolge: genau ein Knopf mit tabindex 0 (der markierte, sonst der erste), siehe `setzeTabHalt`.
export function markiereRadios(knoepfe: readonly HTMLButtonElement[], markiert: number | null): void {
  knoepfe.forEach((k, i) => k.setAttribute('aria-checked', String(i === markiert)));
  setzeTabHalt(knoepfe);
}

// Der eine Tab-Halt einer Gruppe liegt auf dem markierten Knopf, ist keiner markiert (oder der markierte gesperrt) auf dem ersten nicht gesperrten
// (Nacharbeit NN1: nach dem Verlassen der Gruppe liegt er wieder dort, nicht auf dem Knopf, der zuletzt den Fokus hatte).
export function setzeTabHalt(knoepfe: readonly HTMLButtonElement[]): void {
  const markiert = knoepfe.findIndex((k) => k.getAttribute('aria-checked') === 'true' && !k.disabled);
  const halt = markiert >= 0 ? markiert : knoepfe.findIndex((k) => !k.disabled);
  knoepfe.forEach((k, i) => (k.tabIndex = i === halt ? 0 : -1));
}
