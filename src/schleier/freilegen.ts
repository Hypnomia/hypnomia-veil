// Freilegen (Auftrag F, Entscheidung 100): eine zensierte Flaeche laesst sich mit geloestem Quiz fuer `einstellungen.quiz.freilegenMs` aufdecken,
// danach ist sie wieder zensiert. Auf allen Seiten, nur mit Pack und Freischaltung `quiz:freilegen`, nie in der Pause.
// - Alle Knoepfe stehen in EINEM Host mit geschlossener Shadow Root (fest positioniert, Container ohne Zeigerereignisse, nur die Knoepfe klickbar),
//   nur fuer Flaechen im Sichtbereich (IntersectionObserver), hoechstens 24 (die groessten zuerst). Kein Klick auf das Bild selbst.
// - Die Steuerung bleibt in schleier.ts; diese Klasse bekommt ihre Zugriffe als Rueckrufe (Vorbild vorschau.ts).

import type { Einstellungen } from '../einstellungen';
import type { NachrichtHintergrundPackDaten, AntwortPackDaten } from '../nachrichten';
import { beiLokalerPause, istLokalePause } from '../pause-lokal';
import { istFreigeschaltet, type PackKurz } from '../pack/vertrag';
import { SatzWahl } from '../quiz/saetze';
import { fuelleSatz, pruefeTexte, type SatzGruppe, type Texte } from '../quiz/vertrag';
import { zeigeRiegel } from '../riegel/riegel';
import {
  beschneide,
  istAbgelaufen,
  istFreilegbar,
  FREILEGEN_MAX_KNOEPFE,
  KNOPF_BREITE,
  KNOPF_HOEHE,
  knopfPosition,
  sekundenFuerSatz,
  waehleKnoepfe,
  type Anwaerter,
  type Rechteck,
} from './freilegen-rein';
import { TESTHAKEN } from './konstanten';
import { Meldung } from './meldung';
import { testhakenAktiv } from './status';
import type { Zustand } from './zustand';

// Entwurfstext (der Texter liest gegen).
// So lange wird nach dem letzten Ereignis in jedem Bild weiter gemessen.
const NACHLAUF_MS = 500;
const KEIN_QUIZ = 'No quiz for you right now, pet. Try again in a moment.';
const ABBILD_ATTR: string = TESTHAKEN ? 'data-veil-freilegen' : '';

// Entwurfstexte, falls das Pack keine Saetze liefert (der Texter liest gegen). Die eingebauten Rueckfaelle der Quiz-Saetze kennen diese Gruppen nicht.
const RUECKFALL_F: Partial<Record<SatzGruppe, string>> = {
  freigelegt: 'Quick look, pet. You get {{seconds}} seconds.',
  wiederZensiert: 'Time’s up. Back under my veil it goes.',
};

import { SEITEN_TEXT } from '../oberflaeche/design/familie';
import { eigeneWurzel } from './eigene';
import { standbildDecktPunkt } from '../player/standbild';
const CSS = `
:host { all: initial; }
.flaeche { position: fixed; inset: 0; pointer-events: none; }
button { all: unset; box-sizing: border-box; position: absolute; left: 0; top: 0; width: ${KNOPF_BREITE}px; height: ${KNOPF_HOEHE}px;
  display: flex; align-items: center; justify-content: center; border-radius: 999px; background: rgba(255, 255, 255, 0.9); color: #8a2759;
  border: 1px solid #9c7e91; font: 800 12px/1 '${SEITEN_TEXT}', system-ui, sans-serif; cursor: pointer; pointer-events: auto;
  box-shadow: 0 0 0 3px rgba(226, 85, 154, 0.14), 0 4px 12px -4px rgba(168, 50, 111, 0.45); }
button:hover { background: #ffffff; }
button:focus-visible { outline: 3px solid #8f6be8; outline-offset: 2px; }
button[hidden] { display: none; }
`;

export interface FreilegenRueckrufe {
  lebt(): boolean;
  // Verarbeitung laeuft (nicht Pause, nicht Ausnahme).
  aktiv(): boolean;
  zustand(el: Element): Zustand | undefined;
  // Alle verfolgten Elemente (beim Einschalten werden vorhandene zensierte Flaechen aufgenommen).
  elemente(): Iterable<Element>;
  // Original sofort zeigen und z.freigelegt setzen.
  legeFrei(el: Element, z: Zustand, bisMs: number): void;
  // Original sofort wegnehmen (Hide-first) und neu pruefen.
  zensiereWieder(el: Element, z: Zustand): void;
  // Liefert die Abbruchfunktion des Zeitgebers.
  zeitgeber(fn: () => void, ms: number): () => void;
  // Lokale Pause: das Freilegen endet, das Original bleibt (die Pause gibt ohnehin alles frei), danach wird wieder normal geprueft.
  beendeOhneZensur(el: Element, z: Zustand): void;
}

export class Freilegen {
  private an = false;
  private dauerMs = 10000;
  private packStand = -1;
  private readonly meldung = new Meldung();
  private kandidaten = new Set<Element>();
  private sichtbar = new Set<Element>();
  private knoepfe = new Map<Element, HTMLButtonElement>();
  private offen = new Map<Element, () => void>();
  private abbruch: AbortController | null = null;
  private mo: MutationObserver | null = null;
  private letzteAufraeumung = 0;
  private nachlaufBis = 0;
  private host: HTMLElement | null = null;
  private flaeche: HTMLElement | null = null;
  private io: IntersectionObserver | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private riegelOffen = false;
  private texte: Promise<Texte | null> | null = null;
  private wahl: SatzWahl | null = null;
  private letzterAbbild = '';
  private lokalAb: (() => void) | null = null;

  constructor(private readonly r: FreilegenRueckrufe) {}

  // ---------- Schalter ----------

  // Bei jeder Aenderung von Einstellungen oder Pack. `aus`: Pause oder Ausnahme (dann raeumt der Schleier alles selbst zurueck).
  aktualisiere(e: Einstellungen, pack: PackKurz | null, aus: boolean): void {
    this.dauerMs = e.quiz.freilegenMs;
    const stand = pack?.importiert ?? 0;
    if (stand !== this.packStand) {
      this.packStand = stand;
      this.texte = null;
      this.wahl = null;
    }
    const neuAn = !aus && !istLokalePause(e) && istFreigeschaltet(pack, 'quiz:freilegen');
    if (neuAn === this.an) {
      if (this.an) this.plane();
      return;
    }
    this.an = neuAn;
    if (neuAn) this.starte();
    else this.stoppe(!aus);
  }

  private starte(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.io = new IntersectionObserver((eintraege) => {
      for (const ei of eintraege) {
        if (ei.isIntersecting) {
          this.sichtbar.add(ei.target);
          this.ro?.observe(ei.target);
        } else {
          this.sichtbar.delete(ei.target);
          this.ro?.unobserve(ei.target);
          if (!ei.target.isConnected) this.kandidaten.delete(ei.target);
        }
      }
      this.anstoss();
    });
    this.ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.anstoss());
    window.addEventListener('scroll', this.beiBewegung, { capture: true, passive: true });
    window.addEventListener('resize', this.beiBewegung, { passive: true });
    document.addEventListener('visibilitychange', this.beiSicht);
    document.addEventListener('fullscreenchange', this.beiBewegung);
    document.addEventListener('transitionend', this.beiBewegung, { capture: true, passive: true });
    document.addEventListener('animationend', this.beiBewegung, { capture: true, passive: true });
    // Verschiebungen ohne Scrollen (nachgeladener Inhalt, einklappender Kopf): Aenderungen im Dokument planen eine neue Messung.
    if (typeof MutationObserver !== 'undefined') {
      this.mo = new MutationObserver(this.beiBewegung);
      this.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    // Knopf "Pause Mia" im Riegel: sofort alles weg (Zeitgeber, Knoepfe, Meldung), auch wenn die gespeicherte Pause nie ankommt.
    this.lokalAb = beiLokalerPause(() => {
      for (const el of this.offen.keys()) {
        const z = this.r.zustand(el);
        if (z) this.r.beendeOhneZensur(el, z);
      }
      this.an = false;
      this.stoppe(false);
    });
    for (const el of this.r.elemente()) {
      const z = this.r.zustand(el);
      if (z) this.beiUrteil(el, z);
    }
    this.plane();
  }

  // zensiereOffene: Pack oder Freischaltung weg, aber kein Pause: freigelegte Flaechen sofort wieder zensieren.
  private stoppe(zensiereOffene: boolean): void {
    const offene = [...this.offen.keys()];
    for (const abbrechen of this.offen.values()) abbrechen();
    this.offen.clear();
    this.abbruch?.abort();
    this.abbruch = null;
    this.riegelOffen = false;
    this.mo?.disconnect();
    this.mo = null;
    document.removeEventListener('fullscreenchange', this.beiBewegung);
    document.removeEventListener('transitionend', this.beiBewegung, true);
    document.removeEventListener('animationend', this.beiBewegung, true);
    window.removeEventListener('scroll', this.beiBewegung, true);
    window.removeEventListener('resize', this.beiBewegung);
    document.removeEventListener('visibilitychange', this.beiSicht);
    this.lokalAb?.();
    this.lokalAb = null;
    this.io?.disconnect();
    this.ro?.disconnect();
    this.io = this.ro = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.kandidaten.clear();
    this.sichtbar.clear();
    this.knoepfe.clear();
    this.host?.remove();
    this.host = this.flaeche = null;
    this.schreibeAbbild('');
    this.meldung.raeumeAuf();
    if (zensiereOffene && this.r.aktiv()) {
      for (const el of offene) {
        const z = this.r.zustand(el);
        if (z?.freigelegt) this.r.zensiereWieder(el, z);
      }
    }
  }

  // Abbau (ctx.onInvalidated): Host, Zeitgeber, Beobachter weg. Die Originale stellt der Schleier selbst zurueck.
  raeumeAuf(): void {
    this.an = false;
    this.stoppe(false);
  }

  // ---------- Kandidaten ----------

  // Wird bei jedem neuen Urteil und jedem Zuruecksetzen eines Elements gerufen (anwenden.ts).
  beiUrteil(el: Element, z: Zustand): void {
    if (!z.freigelegt && this.offen.has(el)) {
      this.offen.get(el)?.();
      this.offen.delete(el);
    }
    if (!this.an) return;
    if (this.freilegbar(el, z)) {
      if (!this.kandidaten.has(el)) {
        this.kandidaten.add(el);
        this.io?.observe(el);
      }
    } else if (this.kandidaten.delete(el)) {
      this.io?.unobserve(el);
      this.ro?.unobserve(el);
      this.sichtbar.delete(el);
      this.plane();
    }
  }

  // Urteil und Art; die Groesse wird beim Positionieren gemessen.
  private freilegbar(el: Element, z: Zustand, breite = 1e6, hoehe = 1e6): boolean {
    return istFreilegbar({ art: z.art, urteil: z.urteil, ersetzt: !!z.ersetzt, freigelegt: !!z.freigelegt, breite, hoehe }) && !z.tauschLaeuft && el.isConnected;
  }

  // ---------- Knoepfe ----------

  // Ereignis, nach dem sich Lagen aendern koennten: danach hoechstens NACHLAUF_MS lang in jedem Bild messen (Animationen laufen aus), dann ruhen.
  private readonly beiBewegung = (): void => this.anstoss();
  private anstoss(): void {
    this.nachlaufBis = performance.now() + NACHLAUF_MS;
    this.plane();
  }
  private readonly beiSicht = (): void => {
    if (document.hidden) return;
    // Zeitgeber ruhender Tabs kommen verspaetet: Abgelaufenes sofort wieder zensieren.
    for (const el of [...this.offen.keys()]) {
      const z = this.r.zustand(el);
      if (z?.freigelegt && istAbgelaufen(z.freigelegt.bisMs, performance.now())) this.ende(el);
    }
  };

  private plane(): void {
    if (this.raf || !this.an) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.ordne();
    });
  }

  private baueHost(): void {
    if (this.host?.isConnected) return;
    const host = document.createElement('div');
    const wurzel = eigeneWurzel(host);
    const stil = document.createElement('style');
    stil.textContent = CSS;
    const flaeche = document.createElement('div');
    flaeche.className = 'flaeche';
    wurzel.append(stil, flaeche);
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    host.style.setProperty('z-index', '2147483646', 'important');
    document.documentElement.append(host); // nicht an body: ein transform dort verschobe die festen Knoepfe
    this.host = host;
    this.flaeche = flaeche;
    // Der Host war weg (Seite hat ihn entfernt): alte Knoepfe haengen an der alten Flaeche.
    this.knoepfe.clear();
  }

  // Eine Ebene, die das Bild ganz deckt, selbst aber nichts zeigt (durchsichtiger Link oder Klickfang, Instagram-Muster): sie verdeckt nichts.
  private durchsichtig(t: Element, voll: Rechteck): boolean {
    try {
      if (t.matches('img, video, canvas, svg, iframe, picture, object, embed')) return false;
      const b = t.getBoundingClientRect();
      if (b.left > voll.links || b.top > voll.oben || b.right < voll.rechts || b.bottom < voll.unten) return false; // deckt nicht das ganze Bild
      const cs = getComputedStyle(t);
      if (cs.backgroundImage !== 'none' || cs.visibility === 'hidden') return cs.visibility === 'hidden';
      const farbe = cs.backgroundColor;
      if (farbe !== 'transparent' && !/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(farbe)) return false;
      return (t.textContent ?? '').trim() === '';
    } catch {
      return false;
    }
  }

  // Der Knopfpunkt muss zur Flaeche gehoeren: liegt dort etwas anderes obenauf (klebender Kopf, Karussell, deckende Ebene), kommt kein Knopf.
  // Ein Vorfahre als Treffer gilt (Bild mit pointer-events: none), denn der Punkt liegt schon innerhalb aller Beschneidungen der Vorfahren.
  private oben(el: Element, x: number, y: number, voll: Rechteck): boolean {
    // Session 16 (Live-Lauf): Mias Standbild deckt das Bild (Poster unter dem Player): kein Knopf, Freilegen zeigte darunter nur ihren Deckel.
    if (standbildDecktPunkt(x, y)) return false;
    try {
      const wurzel = el.getRootNode() as Document | ShadowRoot;
      const liste = (typeof wurzel.elementsFromPoint === 'function' ? wurzel : document).elementsFromPoint(x, y);
      for (const t of liste) {
        if (t === this.host) continue;
        if (t === el || el.contains(t) || t.contains(el)) return true;
        if (this.durchsichtig(t, voll)) continue;
        return false;
      }
    } catch {
      return true;
    }
    return false; // leere Liste (Punkt ausserhalb): kein Beweis, kein Knopf
  }

  // Sichtbarer Teil des Rechtecks nach den Beschneidungen aller Vorfahren mit overflow ungleich visible (Karussell, Scroll-Behaelter).
  private beschneideVorfahren(el: Element, r: Rechteck): Rechteck | null {
    let aktuell: Rechteck | null = r;
    try {
      if (getComputedStyle(el).position === 'fixed') return r;
      let p: Element | null = el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null);
      while (p && aktuell && p !== document.documentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const b = p.getBoundingClientRect();
          aktuell = {
            links: cs.overflowX !== 'visible' ? Math.max(aktuell.links, b.left) : aktuell.links,
            rechts: cs.overflowX !== 'visible' ? Math.min(aktuell.rechts, b.right) : aktuell.rechts,
            oben: cs.overflowY !== 'visible' ? Math.max(aktuell.oben, b.top) : aktuell.oben,
            unten: cs.overflowY !== 'visible' ? Math.min(aktuell.unten, b.bottom) : aktuell.unten,
          };
          if (aktuell.rechts <= aktuell.links || aktuell.unten <= aktuell.oben) return null;
        }
        p = p.parentElement ?? ((p.getRootNode() as ShadowRoot).host ?? null);
      }
    } catch {
      return aktuell;
    }
    return aktuell;
  }

  // Elemente, die nie sichtbar waren und aus dem Dokument fielen, bleiben sonst in `kandidaten` haengen.
  private fegeKandidaten(): void {
    const jetzt = performance.now();
    if (jetzt - this.letzteAufraeumung < 2000) return;
    this.letzteAufraeumung = jetzt;
    for (const el of [...this.kandidaten]) {
      if (el.isConnected) continue;
      this.kandidaten.delete(el);
      this.sichtbar.delete(el);
      this.io?.unobserve(el);
      this.ro?.unobserve(el);
    }
  }

  // Misst zuerst alles, schreibt danach (kein Layout-Thrashing). Der teure Treffertest laeuft erst nach der Auswahl und nur fuer die Gewaehlten.
  private ordne(): void {
    if (!this.an || !this.r.lebt()) return;
    this.fegeKandidaten();
    // Fenstermass ohne Bildlaufleiste, wie im Riegel (im Quirks-Modus gilt body).
    const wurzelMass = document.compatMode === 'BackCompat' ? document.body : document.documentElement;
    const bw = wurzelMass?.clientWidth || innerWidth;
    const bh = wurzelMass?.clientHeight || innerHeight;
    const gemessen: Array<Anwaerter<{ el: Element; sicht: Rechteck }>> = [];
    if (!this.riegelOffen && this.r.aktiv() && !document.fullscreenElement) {
      for (const el of [...this.sichtbar]) {
        const z = this.r.zustand(el);
        if (!z || !el.isConnected) {
          if (!el.isConnected) this.sichtbar.delete(el);
          continue;
        }
        const b = el.getBoundingClientRect();
        if (!this.freilegbar(el, z, b.width, b.height)) continue;
        const voll: Rechteck = { links: b.left, oben: b.top, rechts: b.right, unten: b.bottom };
        const fenster = beschneide(voll, bw, bh);
        const sicht = fenster ? this.beschneideVorfahren(el, fenster) : null;
        if (sicht && knopfPosition(sicht)) gemessen.push({ ziel: { el, sicht }, rechteck: voll });
      }
    }
    // Die Groessten zuerst; wer den Treffertest nicht besteht, macht Platz fuer den Naechsten.
    const gewaehlt: typeof gemessen = [];
    for (const g of waehleKnoepfe(gemessen, gemessen.length)) {
      if (gewaehlt.length >= FREILEGEN_MAX_KNOEPFE) break;
      const pos = knopfPosition(g.ziel.sicht)!;
      if (this.oben(g.ziel.el, pos.x + KNOPF_BREITE / 2, pos.y + KNOPF_HOEHE / 2, g.rechteck)) gewaehlt.push(g);
    }
    if (gewaehlt.length > 0) this.baueHost();
    const behalten = new Set(gewaehlt.map((g) => g.ziel.el));
    for (const [el, knopf] of this.knoepfe) {
      if (!behalten.has(el)) {
        knopf.remove();
        this.knoepfe.delete(el);
      }
    }
    const abbild: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    for (const g of gewaehlt) {
      const pos = knopfPosition(g.ziel.sicht)!;
      let knopf = this.knoepfe.get(g.ziel.el);
      if (!knopf && this.flaeche) {
        knopf = this.baueKnopf(g.ziel.el);
        this.flaeche.append(knopf);
        this.knoepfe.set(g.ziel.el, knopf);
      }
      if (knopf) knopf.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
      abbild.push({ id: g.ziel.el.id, x: Math.round(pos.x), y: Math.round(pos.y), w: KNOPF_BREITE, h: KNOPF_HOEHE });
    }
    this.schreibeAbbild(JSON.stringify({ knoepfe: abbild, offen: this.offen.size }));
    if (gewaehlt.length > 0 && performance.now() < this.nachlaufBis) this.plane(); // kurz nach einem Ereignis jedes Bild messen, danach ruhen
  }

  private baueKnopf(el: Element): HTMLButtonElement {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.textContent = 'Reveal';
    knopf.setAttribute('aria-label', 'Reveal this picture. Answer Mia’s quiz first.');
    knopf.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      void this.klick(el);
    });
    return knopf;
  }

  private async klick(el: Element): Promise<void> {
    if (this.riegelOffen || !this.an) return;
    this.riegelOffen = true;
    this.plane();
    let erg: 'geloest' | 'pause' | 'abgebrochen' = 'abgebrochen';
    const abbruch = new AbortController();
    this.abbruch = abbruch;
    try {
      erg = await zeigeRiegel({ grund: 'freilegen', anker: el, signal: abbruch.signal });
    } catch {
      erg = 'abgebrochen';
    }
    if (this.abbruch === abbruch) this.abbruch = null;
    this.riegelOffen = false;
    if (abbruch.signal.aborted || !this.an || !this.r.lebt()) return;
    // Kein Quiz moeglich (Bank fehlt, zu wenige Fragen, anderer Riegel offen): kurze Meldung statt eines Knopfs, der nichts tut.
    if (erg === 'abgebrochen') this.meldung.zeige(KEIN_QUIZ, 'nein');
    if (erg === 'geloest') {
      const z = this.r.zustand(el);
      if (z && this.r.aktiv() && this.freilegbar(el, z)) this.beginne(el, z);
    }
    this.plane();
  }

  // ---------- Freilegen und Ende ----------

  private beginne(el: Element, z: Zustand): void {
    const ms = this.dauerMs;
    const bis = performance.now() + ms;
    this.kandidaten.delete(el);
    this.sichtbar.delete(el);
    this.io?.unobserve(el);
    this.ro?.unobserve(el);
    this.r.legeFrei(el, z, bis);
    this.offen.set(el, this.r.zeitgeber(() => this.ende(el), ms));
    void this.sage('freigelegt', 'zwinkern', sekundenFuerSatz(ms));
    this.plane();
  }

  private ende(el: Element): void {
    this.offen.get(el)?.();
    this.offen.delete(el);
    const z = this.r.zustand(el);
    if (!z?.freigelegt) return; // Pause, neue Einstellungen oder Quellwechsel haben es schon zurueckgesetzt
    this.r.zensiereWieder(el, z);
    if (el.isConnected) void this.sage('wiederZensiert', 'schmollen');
    this.plane();
  }

  // ---------- Mias Saetze ----------

  private holeTexte(): Promise<Texte | null> {
    if (!this.texte) {
      this.texte = (async () => {
        try {
          const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
          const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
          return a && a.ok === true && a.daten ? pruefeTexte(a.daten) : null;
        } catch {
          return null;
        }
      })();
    }
    return this.texte;
  }

  private async sage(gruppe: 'freigelegt' | 'wiederZensiert', pose: 'zwinkern' | 'schmollen', sekunden?: number): Promise<void> {
    const texte = await this.holeTexte();
    if (!this.an || !this.r.lebt()) return;
    this.wahl ??= new SatzWahl(texte, Math.random);
    const werte = { seconds: sekunden };
    const satz = this.wahl.hole(gruppe, werte) || fuelleSatz(RUECKFALL_F[gruppe] ?? '', werte);
    this.meldung.zeige(satz, pose);
  }

  // ---------- Testhaken ----------

  private schreibeAbbild(text: string): void {
    if (!TESTHAKEN || !testhakenAktiv() || text === this.letzterAbbild) return;
    this.letzterAbbild = text;
    try {
      if (text) document.documentElement.setAttribute(ABBILD_ATTR, text);
      else document.documentElement.removeAttribute(ABBILD_ATTR);
    } catch {
      // Dokument weg
    }
  }
}
