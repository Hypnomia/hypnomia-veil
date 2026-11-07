// Ansicht der Galerie des Komplett-Ersatzes (Auftrag G, Entscheidung 107): ein Host mit geschlossener Shadow Root ueber der ganzen Seite,
// in der obersten Ebene per Popover (die Seite kann ihn nicht ueberdecken). Texte nur ueber textContent. Bilder kommen als Data-URL vom
// Erkenner (`erkenner/packbild`, Rollen `vorschau` und `chibi`), nie als Rohbytes aus dem Pack.
import links from '../../data/links.json' with { type: 'json' };
import type { AntwortPackBild, AntwortPackDaten, NachrichtErkennerPackBild, NachrichtHintergrundPackDaten } from '../nachrichten';
import { SatzWahl } from '../quiz/saetze';
import { pruefeTexte } from '../quiz/vertrag';
import { ANTWORT_MAX_MS, TESTHAKEN } from '../schleier/konstanten';
import { vergissWecken, wecke } from '../schleier/pruefung';
import { ladeEinstellungen, type StufeWahl } from '../einstellungen';
import { SEITEN_TOKENS } from '../oberflaeche/design/tokens';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';
import { augenpaar } from '../oberflaeche/design/motive';
import { logoSvg, type LogoName } from '../oberflaeche/design/logos';
import { eigeneWurzel } from '../schleier/eigene';

// Marke am Host nur im Testbau (im Release-Bau faellt der Name weg); die Regel in style.css braucht sie nicht.
export const HOST_MARKE: string = TESTHAKEN ? 'data-veil-ersatz-host' : '';
export const GALERIE_BILDER = 12;
// Testhaken (nur Testbau, im Release-Bau faellt der Name weg): JSON-Abbild der Galerie am html-Element. Die Shadow Root bleibt geschlossen.
export const ABBILD_ATTR: string = TESTHAKEN ? 'data-veil-ersatz-abbild' : '';
const CHIBI_FRIST_MS = 8000;

const CSS = `
:host { all: initial; }
${SEITEN_TOKENS}
/* Phase 8b ("Sakura Glas"): Grund im Verlauf, Kopf und Bereiche als Glas, Kacheln mit grossem Radius, Pause-Knopf wie ueberall. */
.wurzel { position: fixed; inset: 0; overflow-y: auto; overflow-x: hidden; background: var(--v-verlauf-grund); color: var(--v-text);
  font: 400 15px/1.5 var(--v-schrift-text); }
* { box-sizing: border-box; }
main { display: flex; flex-direction: column; gap: 18px; max-width: 980px; margin: 0 auto; padding: 24px 16px 32px; }
header { display: flex; align-items: center; gap: 10px; }
h1 { margin: 0; font: 800 15px/1.2 var(--v-schrift-display); letter-spacing: 0.14em; color: var(--v-rosa-800); }
h2 { margin: 0 0 6px; font: 800 26px/1.2 var(--v-schrift-display); color: var(--v-text); letter-spacing: -0.01em; }
h2.klein { font: 800 12px/1.2 var(--v-schrift-text); letter-spacing: 0.1em; text-transform: uppercase; color: var(--v-rosa-700); margin-bottom: 10px; }
p { margin: 0 0 8px; }
.leise { color: var(--v-leise); }
section { padding: 18px; background: rgba(255, 255, 255, 0.7); border: 1px solid var(--v-glas-kante); border-radius: var(--v-r-l); box-shadow: var(--v-schatten); }
.kopf { position: relative; overflow: hidden; display: flex; align-items: center; gap: 18px; background: var(--v-verlauf-kopf); }
.kopf::after { content: ''; position: absolute; right: -50px; top: -60px; width: 200px; height: 200px; border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%); pointer-events: none; }
.chibi img { display: block; max-width: 150px; max-height: 150px; width: auto; height: auto; filter: drop-shadow(0 10px 16px rgba(168, 50, 111, 0.3)); }
.bilder { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
.bilder img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--v-r-m); background: var(--v-lav-100);
  border: 2px solid var(--v-weiss); box-shadow: 0 10px 22px -10px rgba(168, 50, 111, 0.5); }
.knopf, .pause { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 18px 0 8px; margin: 0 8px 8px 0; border: 1px solid var(--v-rosa-200);
  border-radius: var(--v-r-voll); background: var(--v-weiss); color: var(--v-rosa-800); font: 800 14px/1 var(--v-schrift-text); text-decoration: none; cursor: pointer;
  box-shadow: var(--v-schatten-klein); }
.knopf:hover, .pause:hover { background: var(--v-rosa-50); }
header .pause { margin: 0 0 0 auto; white-space: nowrap; flex: none; }
@media (max-width: 400px) { header .v-augenpaar svg + svg { display: none; } h1 { font-size: 13px; letter-spacing: 0.1em; } }
.pause { padding: 0 18px 0 10px; font-family: var(--v-schrift-display); background: linear-gradient(180deg, #ffffff 0%, var(--v-rosa-50) 100%); box-shadow: var(--v-schatten-pause); }
.pause::before { content: ''; flex: none; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(#fff, #fff) 9px 7px / 2.5px 10px no-repeat,
  linear-gradient(#fff, #fff) 13px 7px / 2.5px 10px no-repeat, var(--v-verlauf-akzent); }
.knopf:focus-visible, .pause:focus-visible { outline: 3px solid var(--v-lav-500); outline-offset: 2px; }
footer { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; color: var(--v-leise); font-size: 13px; }
@media (max-width: 480px) { .kopf { flex-direction: column; align-items: flex-start; } h2 { font-size: 22px; } }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Eine Anfrage an den Erkenner mit Frist; null = kein Bild.
async function frageBild(n: NachrichtErkennerPackBild, lebt: () => boolean, frist: number): Promise<AntwortPackBild | null> {
  for (let versuch = 0; versuch < 2; versuch++) {
    if (!(await wecke(lebt))) return null;
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const zeit = new Promise<null>((ok) => {
      uhr = setTimeout(() => ok(null), frist);
    });
    try {
      const a = (await Promise.race([browser.runtime.sendMessage(n) as Promise<AntwortPackBild | { ok: false } | undefined>, zeit])) as
        | AntwortPackBild
        | { ok: false }
        | undefined
        | null;
      if (a && a.ok === false) return null;
      if (a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/')) return a;
    } catch {
      // Empfaenger weg: neu wecken und noch einmal
    } finally {
      clearTimeout(uhr);
    }
    vergissWecken();
  }
  return null;
}

export interface GalerieOptionen {
  hostname: string;
  lebt(): boolean;
}

export class Galerie {
  readonly host: HTMLDivElement;
  private readonly main: HTMLElement;
  private readonly wurzel: ShadowRoot;
  // Sollwert der Inline-Lage; weicht der Host davon ab, stellt ihn die Wache wieder her.
  private soll = '';
  private readonly bilder: HTMLDivElement;
  private readonly leer: HTMLParagraphElement;
  private readonly chibiBox: HTMLDivElement;
  private readonly chibiBild: HTMLImageElement;
  private readonly titel: HTMLHeadingElement;
  readonly pauseKnopf: HTMLButtonElement;
  private readonly linkListe: HTMLAnchorElement[] = [];
  private lauf = 0;
  // Dateinamen der gezeigten Pack-Bilder (nur fuer das Abbild des Testhakens).
  private readonly namen: string[] = [];

  constructor(private readonly opt: GalerieOptionen) {
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    if (TESTHAKEN) host.setAttribute(HOST_MARKE, '');
    const wurzel = eigeneWurzel(host);
    this.wurzel = wurzel;
    const stil = el('style');
    stil.textContent = CSS;
    const huelle = el('div', 'wurzel');
    const main = el('main');
    main.setAttribute('role', 'dialog');
    main.tabIndex = -1;
    this.main = main;
    main.setAttribute('aria-label', 'Mia');

    const kopfzeile = el('header');
    kopfzeile.append(augenpaar(26), el('h1', undefined, 'HYPNOMIA VEIL'));
    void ladeSeitenSchriften();

    const kopf = el('section', 'kopf');
    this.chibiBox = el('div', 'chibi');
    this.chibiBox.hidden = true;
    this.chibiBild = el('img');
    this.chibiBild.alt = '';
    this.chibiBild.setAttribute('data-veil', 'frei');
    this.chibiBox.append(this.chibiBild);
    const kopfText = el('div');
    this.titel = el('h2', undefined, 'I’ll take it from here, pet.');
    kopfText.append(this.titel, el('p', 'leise', `${opt.hostname} is right behind me.`));
    kopf.append(this.chibiBox, kopfText);

    const bilderBereich = el('section');
    this.bilder = el('div', 'bilder');
    this.leer = el('p', 'leise', 'No pictures to show right now.');
    this.leer.hidden = true;
    bilderBereich.append(el('h2', 'klein', 'Look at me instead'), this.bilder, this.leer);

    const linkBereich = el('section');
    const absatz = el('p');
    this.linkListe.push(this.baueLink('Patreon', links.patreon, 'patreon'), this.baueLink('SubscribeStar', links.subscribestar, 'subscribestar'));
    absatz.append(...this.linkListe);
    linkBereich.append(el('h2', 'klein', 'Find me properly'), absatz);

    const fuss = el('footer');
    const pause = el('button', 'pause', 'Pause Mia');
    pause.type = 'button';
    this.pauseKnopf = pause;
    // Phase 8b (Lesung S2/R Nr. 15): Pause steht oben im Kopf neben der Marke, auch bei 360 px ohne Scrollen erreichbar.
    kopfzeile.append(pause);
    fuss.append(el('span', undefined, 'Pausing is always allowed. The site shows up right away.'));

    main.append(kopfzeile, kopf, bilderBereich, linkBereich, fuss);
    huelle.append(main);
    wurzel.append(stil, huelle);
    this.host = host;
    this.legeLage();
  }

  private baueLink(text: string, adresse: unknown, logo: LogoName): HTMLAnchorElement {
    const a = el('a', 'knopf', text);
    a.prepend(logoSvg(logo, 28)); // Phase 8b: Logo der Plattform vor dem Namen (aria-hidden, der Linktext bleibt)
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (typeof adresse === 'string' && /^https:\/\//.test(adresse)) a.href = adresse;
    else a.hidden = true;
    return a;
  }

  // Gilt ein echter Klick dem Pause-Knopf? Mit Maus oder Finger nach Lage, per Tastatur (Enter, Leertaste) nach Fokus.
  istPauseKlick(e: MouseEvent): boolean {
    if (e.detail === 0 && e.clientX === 0 && e.clientY === 0) return this.wurzel.activeElement === this.pauseKnopf;
    const r = this.pauseKnopf.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  // Inline und wichtig: schlaegt Seitenregeln auf Popover, div und *. Zuerst `all: initial` (nimmt allgemeine Regeln der Seite wie clip-path,
  // mask, translate, pointer-events, content-visibility), danach die Lage.
  legeLage(): void {
    const s = this.host.style;
    const setze = (k: string, v: string) => s.setProperty(k, v, 'important');
    setze('all', 'initial');
    setze('position', 'fixed');
    setze('inset', '0');
    setze('width', '100vw');
    setze('height', '100vh');
    setze('max-width', 'none');
    setze('max-height', 'none');
    setze('margin', '0');
    setze('padding', '0');
    setze('border', '0');
    setze('overflow', 'hidden');
    setze('display', 'block');
    setze('visibility', 'visible');
    setze('opacity', '1');
    setze('pointer-events', 'auto');
    setze('zoom', '1');
    setze('background', '#fff5fa');
    setze('z-index', '2147483647');
    this.soll = s.cssText;
    if (this.host.getAttribute('popover') !== 'manual') this.host.setAttribute('popover', 'manual');
  }

  // Stimmt die Lage noch (Inline-Werte und Popover-Attribut)? Sonst stellt die Wache sie her.
  lageOk(): boolean {
    return this.host.style.cssText === this.soll && this.host.getAttribute('popover') === 'manual';
  }

  // Wieder in die oberste Ebene holen (nach einem fremden Popover): schliessen und neu oeffnen.
  holeNachOben(): void {
    try {
      if (this.host.matches(':popover-open')) this.host.hidePopover();
    } catch {
      // egal
    }
    this.zeige();
  }

  // In den Baum haengen und in die oberste Ebene holen. Gibt zurueck, ob der Host danach steht.
  zeige(): boolean {
    const wurzel = document.documentElement;
    if (!wurzel) return false;
    if (!this.host.isConnected) wurzel.append(this.host);
    try {
      if (typeof this.host.showPopover === 'function' && !this.host.matches(':popover-open')) this.host.showPopover();
    } catch {
      // ohne Popover bleibt die feste Lage mit hohem z-index
    }
    this.fokus();
    this.meldeAbbild();
    return this.host.isConnected;
  }

  // Fokus in die Galerie: Tasten treffen dann den Host und nicht den body der Seite.
  fokus(): void {
    try {
      this.main.focus({ preventScroll: true });
    } catch {
      // egal
    }
  }

  steht(): boolean {
    if (!this.host.isConnected) return false;
    try {
      return typeof this.host.matches !== 'function' || this.host.matches(':popover-open');
    } catch {
      return true;
    }
  }

  // Bilder laden (nur einmal je Anzeige); bricht ab, wenn die Galerie inzwischen weg ist.
  async ladeBilder(): Promise<void> {
    const meiner = ++this.lauf;
    const noch = () => meiner === this.lauf && this.opt.lebt();
    const gesehen = new Set<string>();
    let gezeigt = 0;
    // Begruessung aus den Pack-Texten (Gruppe begruessung, zufaellig); ohne sie bleibt der eingebaute Titel.
    const gruss = (async () => {
      try {
        const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
        const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
        const texte = a && a.ok === true && a.daten ? pruefeTexte(a.daten) : null;
        if (!texte || !texte.gruppen.begruessung?.length || !noch()) return;
        const satz = new SatzWahl(texte, Math.random).hole('begruessung');
        if (satz) this.titel.textContent = satz;
      } catch {
        // eingebauter Titel bleibt
      }
    })();
    const chibi = frageBild({ ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: 'thron' }, noch, CHIBI_FRIST_MS).then((a) => {
      if (!a || !noch()) return;
      this.chibiBild.src = a.dataUrl;
      this.chibiBild.addEventListener('load', () => this.meldeAbbild(), { once: true });
      this.chibiBox.hidden = false;
    });
    // Intensitaet der Bilder aus den Einstellungen (Auftrag I2); die Galerie fragt mit 16:9 (Kacheln sind quer).
    // Die Stufe wird einmal je Anzeige gelesen; eine offene Galerie folgt einem Stufenwechsel nicht (sie wird beim naechsten Oeffnen neu geladen).
    // Bei einem Lesefehler gilt die mildeste Stufe, nie die Standardstufe.
    let stufe: StufeWahl = 'tease';
    try {
      stufe = (await ladeEinstellungen()).erwachsen.stufe;
    } catch {
      // mildeste Stufe
    }
    // Nacheinander: der Erkenner waehlt je Schluessel stabil ein Bild, doppelte (gleicher Name) werden weggelassen.
    for (let i = 1; i <= GALERIE_BILDER && noch(); i++) {
      const a = await frageBild({ ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel: `galerie-${i}`, breite: 16, hoehe: 9, stufe }, noch, ANTWORT_MAX_MS);
      if (!noch()) return;
      if (!a || gesehen.has(a.name)) continue;
      gesehen.add(a.name);
      this.namen.push(a.name);
      const bild = el('img');
      bild.alt = 'Mia';
      bild.decoding = 'async';
      // Eigene Bilder: der Schleier der Erweiterung soll sie nicht verdecken.
      bild.setAttribute('data-veil', 'frei');
      bild.addEventListener('load', () => this.meldeAbbild(), { once: true });
      bild.src = a.dataUrl;
      this.bilder.append(bild);
      gezeigt++;
    }
    await Promise.all([chibi, gruss]).catch(() => undefined);
    if (noch()) this.leer.hidden = gezeigt > 0;
    this.meldeAbbild();
  }

  // Testhaken: Abbild schreiben (nur Testbau).
  meldeAbbild(): void {
    if (!TESTHAKEN) return;
    const r = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const bilder = [...this.bilder.querySelectorAll('img')];
    let offen = false;
    try {
      offen = this.host.matches(':popover-open');
    } catch {
      // egal
    }
    const abbild = {
      popoverOffen: offen,
      titel: this.titel.textContent,
      bilder: bilder.length,
      namen: [...this.namen],
      breiten: bilder.map((b) => b.naturalWidth),
      chibi: !this.chibiBox.hidden && this.chibiBild.naturalWidth > 0,
      links: this.linkListe.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel })),
      zeile: this.host.isConnected ? this.titel.parentElement?.querySelector('p')?.textContent : null,
      leerSichtbar: !this.leer.hidden,
      pause: r(this.pauseKnopf),
      host: r(this.host),
    };
    document.documentElement?.setAttribute(ABBILD_ATTR, JSON.stringify(abbild));
  }

  // Aus dem Baum nehmen; laufende Ladevorgaenge brechen ab.
  entferne(): void {
    this.lauf++;
    try {
      if (this.host.matches(':popover-open')) this.host.hidePopover();
    } catch {
      // egal
    }
    this.host.remove();
    if (TESTHAKEN) document.documentElement?.removeAttribute(ABBILD_ATTR);
  }
}
