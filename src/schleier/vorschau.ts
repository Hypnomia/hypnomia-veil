// Vorschau-Tausch und Erkennen am Inhalt im Content-Script (Auftrag E, PHASE-4-BAUPLAN Abschnitt 8 Punkte 1 bis 3).
// - Auf Erwachsenenseiten (Liste und eigene Seiten, Einstellung erwachsen.an, Freischaltung erwachsen:vorschau) wird jedes Vorschaubild
//   (img und Inline-Hintergrund in einem Link zu einer Videoseite, ab 80 px Kante) OHNE Pruefung gegen ein Pack-Bild getauscht. Das Element
//   bleibt bis zum Tausch verdeckt (Hide-first), das Pack-Bild kommt als Data-URL ueber den Erkenner (rolle `vorschau`).
// - Hover-Vorschauvideos in solchen Links werden nie gezeigt (sie bekommen kein Urteil und bleiben unsichtbar).
// - Kommt kein Bild (Fehler, Pack kaputt, Tausch scheitert, z. B. wegen einer strengen Seiten-CSP): normaler Schleier fuer dieses Element.
// - Zaehlt die echten Pruefungen von Bildern auf Seiten, die nicht auf der Liste stehen (Erkennen am Inhalt, src/adapter/inhalt.ts).
// Die Steuerung bleibt in schleier.ts; diese Klasse bekommt ihre Zugriffe als Rueckrufe.

import { adapterFuer, istHoverVideo, istVorschau, VORSCHAU_MIN_KANTE } from '../adapter';
import { InhaltsZaehler, type InhaltsUrteil } from '../adapter/inhalt';
import { istListenPfad } from '../player/logik';
import { istAnzeige } from '../adapter/anzeige';
import { seiteFuer, TEST_DOMAIN, type SeitenName } from '../adapter/liste';
import { erwachsenStatus, setzeErwachsenStatus } from '../adapter/status';
import { STUFEN_WAHL, type Einstellungen, type StufeWahl } from '../einstellungen';
import type { AntwortFehler, AntwortPackBild, NachrichtErkennerPackBild } from '../nachrichten';
import { istFreigeschaltet, type PackKurz } from '../pack/vertrag';
import { schluesselMitKlasse, trenneKlasse } from '../pack/wahl';
import { bildSignatur, hintergrundWert, setzeBildSofortNeu, setzeHintergrund, stelleWiederHer, starteBildTausch } from './anwenden';
import { ANTWORT_MAX_MS, TAUSCH_MAX_MS } from './konstanten';
import { urlAusEbene, vergissWecken, wecke, zerlegeEbenen } from './pruefung';
import { testhakenAktiv } from './status';
import { NachtauschMerker, VorschauSpeicher } from './vorschau-speicher';
import type { ErsetztInfo, Zustand } from './zustand';

// Quellen, die eine Seite fuer verzoegertes Laden in Attribute legt (die echte Adresse steht dort, nicht in src).
const LAZY_ATTRIBUTE = ['data-src', 'data-original', 'data-lazy-src', 'data-thumb_url', 'data-mediumthumb', 'data-image', 'data-poster'];
const SCHLUESSEL_MAX = 512;
const TRANSPORT_SPERRE_MS = 5000;
// Testhaken nur im Testbau (WXT_TESTHAKEN=1): ohne Schalter faellt der Name des Attributs samt Code beim Bauen weg (Release-Pruefung).
const TESTHAKEN_E: boolean = import.meta.env.WXT_TESTHAKEN === '1';

// Stumm ist auch ein Video mit Lautstaerke 0 (Pruefung Runde 7, Nr. 2: sonst entging eine Anzeige der Regel mit muted=false, volume=0).
const stumm = (v: HTMLVideoElement): boolean => v.muted || v.volume === 0;
const NACHHALTEN_MAX = 20; // so oft haelt der Schleier ein verstecktes Video wieder an, wenn die Seite es neu startet

// Das groesste Video des Dokuments nach dargestellter Flaeche (Hauptvideo einer Videoseite). Gleich gross: das Video selbst gilt als groesstes.
export function istGroesstesVideo(v: HTMLVideoElement): boolean {
  const flaeche = (x: Element): number => {
    const r = x.getBoundingClientRect();
    return r.width * r.height;
  };
  const eigene = flaeche(v);
  for (const x of document.querySelectorAll('video')) if (x !== v && flaeche(x) > eigene) return false;
  return true;
}
const ATTR_ERWACHSEN = TESTHAKEN_E ? 'data-veil-erwachsen' : '';

export interface VorschauRueckrufe {
  lebt(): boolean;
  aktiv(): boolean;
  // Normaler Schleier fuer das Element (Pruefung), wenn der Tausch nicht klappt.
  bewerte(el: Element, z: Zustand): void;
  // Zeitgeber, den Pause und Abbau aufraeumen.
  zeitgeber(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  // Hintergrund ist getauscht: Urteil `zensiert` setzen und weiterplanen (Bilder schliessen ueber das load-Ereignis).
  hintergrundFertig(el: Element, z: Zustand): void;
  // Urteil verwerfen (Original zurueck, sofort wieder verdeckt) und das Element neu bewerten: der Tausch darf es nach der Transport-Sperre noch einmal versuchen.
  neuBewerten(el: Element, z: Zustand): void;
}

// Eine Anfrage an den Erkenner. 'transport': keine verwertbare Antwort (nicht geweckt, Zeitgrenze, Empfaenger weg).
// `zusammen`: Schluessel der Quelle samt Klasse der Flaeche (src/pack/wahl.ts), `stufe`: aktuelle Intensitaet (wird bei jeder Anfrage gelesen).
function frageErkenner(lebt: () => boolean, stufe: () => StufeWahl): (zusammen: string) => Promise<AntwortPackBild | AntwortFehler | 'transport'> {
  return async (zusammen) => {
    if (!(await wecke(lebt))) return 'transport';
    const { schluessel, breite, hoehe } = trenneKlasse(zusammen);
    const nachricht: NachrichtErkennerPackBild = { ziel: 'erkenner', typ: 'packbild', rolle: 'vorschau', schluessel, breite, hoehe, stufe: stufe() };
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const zeit = new Promise<null>((fertig) => {
      uhr = setTimeout(() => fertig(null), ANTWORT_MAX_MS);
    });
    try {
      const a = (await Promise.race([browser.runtime.sendMessage(nachricht) as Promise<AntwortPackBild | AntwortFehler | undefined>, zeit])) as
        | AntwortPackBild
        | AntwortFehler
        | undefined
        | null;
      if (a && a.ok === false) return a;
      return a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a : 'transport';
    } catch {
      return 'transport';
    } finally {
      clearTimeout(uhr);
    }
  };
}

// Mit einem zweiten Versuch nach einem Transportfehler (frisch wecken). null = endgueltig kein Bild; wirft bei bleibendem Transportfehler.
function holeVomErkenner(lebt: () => boolean, stufe: () => StufeWahl): (schluessel: string) => Promise<AntwortPackBild | null> {
  const einmal = frageErkenner(lebt, stufe);
  return async (schluessel) => {
    let a = await einmal(schluessel);
    if (a === 'transport') {
      vergissWecken();
      a = await einmal(schluessel);
    }
    if (a === 'transport') throw new Error('Erkenner nicht erreichbar');
    return a.ok === true ? a : null;
  };
}

export class Vorschau {
  private liste: SeitenName | null = null;
  private tausch = false;
  // Vor der ersten Einstellung und bei jedem Zweifel die mildeste Stufe (Rueckfall nie schaerfer); aktualisiere() setzt die gespeicherte.
  private stufe: StufeWahl = 'tease';
  private erkennen = false;
  private importiert = 0;
  private readonly zaehler = new InhaltsZaehler();
  private readonly speicher: VorschauSpeicher;
  private fehlgeschlagen = 0;
  private sperreBis = 0;
  // Elemente, die in der Transport-Sperre den normalen Schleier bekamen: nach der Sperre werden sie erneut getauscht.
  private readonly nachtausch = new NachtauschMerker<Element, Zustand>();
  private nachtauschPlan: ReturnType<typeof setTimeout> | null = null;
  private gruende: string[] = [];
  private testTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly r: VorschauRueckrufe, speicher?: VorschauSpeicher) {
    this.speicher = speicher ?? new VorschauSpeicher(holeVomErkenner(() => r.lebt(), () => this.stufe));
  }

  // ---------- Zustand der Seite ----------

  // Neu berechnen, wenn sich Einstellungen oder Pack aendern. Erster Bestandteil des Pruefstands (siehe stand()).
  aktualisiere(e: Einstellungen, pack: PackKurz | null): void {
    const liste = e.erwachsen.an ? seiteFuer(location.href, e.erwachsen.eigeneSeiten) : null;
    const neuTausch = liste !== null && istFreigeschaltet(pack, 'erwachsen:vorschau');
    const neuImportiert = pack?.importiert ?? 0;
    // Anderes Pack oder anderer Schalter: gehaltene Bilder gehoeren zum alten Stand.
    // Auch bei einem Stufenwechsel: gehaltene Bilder gehoeren zur alten Stufe, das naechste Bild fragt neu (bereits getauschte bleiben stehen).
    if (neuTausch !== this.tausch || (neuTausch && neuImportiert !== this.importiert) || (neuTausch && e.erwachsen.stufe !== this.stufe)) this.speicher.leere();
    this.stufe = e.erwachsen.stufe;
    this.liste = liste;
    this.tausch = neuTausch;
    this.importiert = neuImportiert;
    // Erkennen am Inhalt: nur fuer Quiz und Freilegen, darum nur mit einer dieser Freischaltungen und nur ausserhalb der Liste.
    this.erkennen =
      e.erwachsen.an &&
      e.erwachsen.erkennenAmInhalt &&
      liste === null &&
      (istFreigeschaltet(pack, 'erwachsen:quiz') || istFreigeschaltet(pack, 'quiz:freilegen'));
    if (!this.erkennen) this.zaehler.neuStart();
    this.melde();
  }

  // Beitrag zum Pruefstand: ein anderer Wert beginnt eine neue Epoche und beurteilt alles neu (Schalter, Liste, Pack).
  stand(): string {
    // Die Stufe gehoert dazu: ein Wechsel beurteilt alles neu, bereits getauschte Kacheln bekommen ein Bild der neuen Stufe (auch bei einer milderen).
    return `${this.tausch ? 1 : 0}|${this.liste ?? ''}|${this.tausch ? this.importiert : 0}|${this.tausch ? this.stufe : ''}`;
  }

  // Tauscht diese Seite Vorschaubilder?
  get tauscht(): boolean {
    return this.tausch;
  }

  private melde(): void {
    setzeErwachsenStatus({ liste: this.liste, amInhalt: this.erkennen && this.zaehler.amInhalt });
    this.planeTestStatus();
  }

  // ---------- Tausch ----------

  // Qualifiziert das Element als Vorschaubild? Groesse (dargestellt, sonst natuerlich) und Aufbau (Adapter).
  private qualifiziert(el: Element): DOMRect | null {
    const r = el.getBoundingClientRect();
    let b = r.width;
    let h = r.height;
    if ((b <= 0 || h <= 0) && el instanceof HTMLImageElement && el.naturalWidth > 0) {
      b = el.naturalWidth;
      h = el.naturalHeight;
    }
    if (b < VORSCHAU_MIN_KANTE || h < VORSCHAU_MIN_KANTE) return null;
    // Entscheidung 193: Anzeigen werden wie Vorschaubilder ganz getauscht (nicht nur zonenweise zensiert).
    return istVorschau(Vorschau.ueberSchatten(el), adapterFuer(this.liste), location.href) || istAnzeige(el, location.href) ? r : null;
  }

  // closest geht nicht ueber Shadow-Grenzen: ohne Treffer wird am Host der Shadow Root weitergesucht.
  private static naechster(el: Element, selektor: string): Element | null {
    let n: Element | null = el;
    while (n) {
      const t = n.closest(selektor);
      if (t) return t;
      const wurzel = n.getRootNode();
      n = wurzel instanceof ShadowRoot ? wurzel.host : null;
    }
    return null;
  }

  static ueberSchatten(el: Element): { matches(s: string): boolean; closest(s: string): Element | null } {
    return { matches: (s) => el.matches(s), closest: (s) => Vorschau.naechster(el, s) };
  }

  // Schluessel der Wahl: wenn moeglich die Video-Kennung aus dem Link (alle Bilder eines Videos gleich), sonst die echte Quelle
  // (Lazy-Attribute vor src), absolut und ohne Query und Fragment.
  private schluesselBild(el: HTMLImageElement): string {
    let quelle = '';
    for (const a of LAZY_ATTRIBUTE) {
      const w = el.getAttribute(a);
      if (w && !w.startsWith('data:')) {
        quelle = w;
        break;
      }
    }
    if (!quelle) quelle = el.currentSrc || el.getAttribute('src') || '';
    return this.kuerze(quelle, el);
  }

  private static ohneAbfrage(adresse: string): string {
    if (!adresse || adresse.startsWith('data:') || adresse.startsWith('blob:')) return '';
    try {
      const u = new URL(adresse, document.baseURI);
      return `${u.origin}${u.pathname}`;
    } catch {
      return '';
    }
  }

  private static videoKennung(href: string): string | null {
    for (const muster of [/[?&]viewkey=([\w-]+)/i, /\/videos\/([^/?#]+)/i, /\/video[-.]?([\w]+)\//i, /\/video\/([\w-]+)/i, /\/post\/([\w-]+)/i]) {
      const t = muster.exec(href);
      if (t?.[1]) return t[1];
    }
    return null;
  }

  private kuerze(quelle: string, el: Element): string {
    const href = Vorschau.naechster(el, 'a[href]')?.getAttribute('href') ?? '';
    const kennung = Vorschau.videoKennung(href);
    if (kennung) return `video:${kennung}`.slice(0, SCHLUESSEL_MAX);
    return (Vorschau.ohneAbfrage(quelle) || Vorschau.ohneAbfrage(href) || 'leer').slice(0, SCHLUESSEL_MAX);
  }

  // Schluessel fuer einen Hintergrund: erste url-Ebene, sonst der Link.
  private schluesselHg(el: Element, wert: string): string {
    for (const e of zerlegeEbenen(wert)) {
      const u = urlAusEbene(e);
      if (u && !u.startsWith('data:')) return this.kuerze(u, el);
    }
    return this.kuerze('', el);
  }

  // Versucht den Tausch fuer ein img oder einen Inline-Hintergrund. true = der Tausch uebernimmt das Element (laeuft oder ist fertig),
  // false = der normale Schleier ist dran.
  versuche(el: Element, z: Zustand): boolean {
    if (!this.tausch || z.ohneVorschau || !this.r.aktiv() || !this.r.lebt()) return false;
    const gesperrt = performance.now() < this.sperreBis;
    let schluessel: string;
    let mass: DOMRect | null;
    if (z.art === 'bild' && el instanceof HTMLImageElement) {
      mass = this.qualifiziert(el); // die einzige Messung je Element
      if (!mass) return false;
      if (gesperrt) return this.merkeFuerNachtausch(el, z);
      schluessel = this.schluesselBild(el);
    } else if (z.art === 'hintergrund' && el instanceof HTMLElement) {
      const wert = hintergrundWert(el);
      if (!zerlegeEbenen(wert).some((e) => urlAusEbene(e))) return false;
      mass = this.qualifiziert(el);
      if (!mass) return false;
      if (gesperrt) return this.merkeFuerNachtausch(el, z);
      schluessel = this.schluesselHg(el, wert);
    } else return false;

    z.eingereiht = true; // belegt das Element, bis die Antwort da ist (bewerte laeuft nicht doppelt)
    const generation = z.generation;
    schluessel = schluesselMitKlasse(schluessel, mass.width, mass.height); // Klasse der Flaeche (quer, hoch, quadratisch) gehoert zum Zwischenspeicher
    const jetzt = this.speicher.sofort(schluessel);
    if (jetzt) {
      this.stapele(el, z, jetzt, mass, schluessel, generation);
      return true;
    }
    const stufeBeiAnfrage = this.stufe;
    void this.speicher.hole(schluessel).then(
      (a) => {
        if (!this.r.lebt() || !this.r.aktiv() || z.generation !== generation) return;
        // Antwort auf eine Anfrage vor einem Wechsel zu einer milderen Stufe: nicht einsetzen, das Element neu bewerten (zweiter Gurt, der erste
        // ist die neue Epoche durch stand()).
        if (STUFEN_WAHL.indexOf(stufeBeiAnfrage) > STUFEN_WAHL.indexOf(this.stufe)) {
          z.eingereiht = false;
          return this.r.neuBewerten(el, z);
        }
        if (!a) return this.scheitert(el, z, 'kein Bild');
        this.stapele(el, z, a, mass!, schluessel, generation);
      },
      () => {
        // Transportfehler (auch nach dem zweiten Versuch): dieses Element geht den normalen Weg, der Tausch pausiert kurz. Kein dauerhaftes ohneVorschau.
        if (!this.r.lebt() || !this.r.aktiv() || z.generation !== generation) return;
        this.sperreBis = performance.now() + TRANSPORT_SPERRE_MS;
        this.fehlgeschlagen++;
        if (this.gruende.length < 8) this.gruende.push('Transport');
        z.eingereiht = false;
        this.planeTestStatus();
        this.merkeFuerNachtausch(el, z);
        this.r.bewerte(el, z);
      },
    );
    return true;
  }

  // Ein Vorschaubild geht waehrend der Sperre den normalen Weg (false), wird aber fuer den Nachtausch gemerkt und nach Ende der Sperre erneut versucht.
  private merkeFuerNachtausch(el: Element, z: Zustand): false {
    this.nachtausch.merke(el, z);
    if (!this.nachtauschPlan) {
      const warte = Math.max(0, this.sperreBis - performance.now()) + 50;
      this.nachtauschPlan = this.r.zeitgeber(() => {
        this.nachtauschPlan = null;
        this.tauscheNach();
      }, warte);
    }
    return false;
  }

  private tauscheNach(): void {
    const liste = this.nachtausch.nimm();
    if (!this.tausch || !this.r.lebt() || !this.r.aktiv()) return;
    // Weiter gesperrt (ein neuer Transportfehler kam dazu): alles wieder vormerken, der neue Plan wartet auf das neue Ende.
    if (performance.now() < this.sperreBis) {
      for (const [el, z] of liste) this.merkeFuerNachtausch(el, z);
      return;
    }
    for (const [el, z] of liste) {
      if (!el.isConnected || z.ersetzt || z.ohneVorschau) continue;
      this.r.neuBewerten(el, z);
    }
  }

  private merkeStile(el: HTMLElement, z: Zustand, setze: Array<[string, string]>): ErsetztInfo {
    const info: ErsetztInfo = z.ersetzt ?? { stile: [] };
    for (const [name, wert] of setze) {
      if (!info.stile.some((s) => s.name === name)) {
        info.stile.push({ name, wert: el.style.getPropertyValue(name), prio: el.style.getPropertyPriority(name) });
      }
      el.style.setProperty(name, wert, 'important');
    }
    return info;
  }

  // Schreibzugriffe gebuendelt: Messungen (qualifiziert) und Stil-Schreibvorgaenge des Tauschs wechseln sich sonst je Karte ab und erzwingen
  // bei Feeds mit hunderten Karten jedes Mal ein neues Layout. Das Element bleibt bis dahin verdeckt (Hide-first).
  private stapel: Array<{ el: Element; z: Zustand; a: AntwortPackBild; mass: DOMRect; schluessel: string; generation: number }> = [];
  private stapelPlan: ReturnType<typeof setTimeout> | null = null;

  private stapele(el: Element, z: Zustand, a: AntwortPackBild, mass: DOMRect, schluessel: string, generation: number): void {
    this.stapel.push({ el, z, a, mass, schluessel, generation });
    if (this.stapelPlan) return;
    this.stapelPlan = setTimeout(() => {
      this.stapelPlan = null;
      const liste = this.stapel;
      this.stapel = [];
      for (const t of liste) {
        if (!this.r.lebt() || !this.r.aktiv() || t.z.generation !== t.generation) continue;
        this.tausche(t.el, t.z, t.a, t.mass, t.schluessel);
      }
    }, 0);
  }

  // Die Seite hat Quelle oder srcset eines getauschten Bildes geaendert und der Schluessel bleibt gleich: sofort aus dem Zwischenspeicher
  // neu einsetzen, ohne auf das Laden des Originals zu warten (Vorschau-Rotation beim Darueberfahren).
  ersetzeSofort(el: HTMLImageElement, z: Zustand): boolean {
    if (!this.tausch || !z.ersetzt?.schluessel || !this.r.aktiv() || z.tauschLaeuft) return false;
    // Der gemerkte Schluessel traegt die Klasse von damals (aus derselben Messung wie der Tausch): nur die Quelle davor wird verglichen.
    if (trenneKlasse(z.ersetzt.schluessel).schluessel !== this.schluesselBild(el)) return false;
    const a = this.speicher.sofort(z.ersetzt.schluessel);
    if (!a) return false;
    z.eigen = a.dataUrl;
    setzeBildSofortNeu(el, z, a.dataUrl);
    return true;
  }

  private tausche(el: Element, z: Zustand, a: AntwortPackBild, mass: DOMRect, schluessel: string): void {
    z.eingereiht = false;
    if (z.art === 'bild' && el instanceof HTMLImageElement) {
      // Formatfuellend, Seitenverhaeltnis der Flaeche bleibt: object-fit und festes Verhaeltnis der bisherigen Darstellung.
      const stile: Array<[string, string]> = [['object-fit', 'cover']];
      if (mass.width > 0 && mass.height > 0) stile.push(['aspect-ratio', `${mass.width} / ${mass.height}`]);
      z.ersetzt = this.merkeStile(el, z, stile);
      z.ersetzt.schluessel = schluessel;
      starteBildTausch(el, z, a.dataUrl);
      // Das load-Ereignis (schleier.ts) schliesst den Tausch; kommt es nicht, greift nach TAUSCH_MAX_MS der normale Schleier.
      if (z.timer) clearTimeout(z.timer);
      z.timer = this.r.zeitgeber(() => {
        z.timer = null;
        if (z.tauschLaeuft) this.scheitert(el, z, 'Zeit');
      }, TAUSCH_MAX_MS);
    } else if (el instanceof HTMLElement) {
      // Hintergrund: Pack-Bild vorladen, damit beim Setzen nichts Leeres aufblitzt; das Element ist bis dahin verdeckt.
      const generation = z.generation;
      const probe = new Image();
      probe.decoding = 'async';
      let erledigt = false;
      const weiter = (ok: boolean) => {
        if (erledigt) return;
        erledigt = true;
        if (!this.r.lebt() || !this.r.aktiv() || z.generation !== generation) return;
        if (!ok) return this.scheitert(el, z, 'Hintergrund nicht ladbar');
        setzeHintergrund(el, z, `url("${a.dataUrl}")`);
        z.ersetzt = this.merkeStile(el, z, [
          ['background-size', 'cover'],
          ['background-position', 'center'],
          ['background-repeat', 'no-repeat'],
        ]);
        z.ersetzt.schluessel = schluessel;
        this.r.hintergrundFertig(el, z);
      };
      probe.addEventListener('load', () => weiter(true), { once: true });
      probe.addEventListener('error', () => weiter(false), { once: true });
      this.r.zeitgeber(() => weiter(false), TAUSCH_MAX_MS);
      probe.src = a.dataUrl;
    }
    this.planeTestStatus();
  }

  // Kein Bild oder Tausch gescheitert: Original zurueck, dieses Element faellt auf den normalen Schleier.
  scheitert(el: Element, z: Zustand, grund = 'Ladefehler'): void {
    this.fehlgeschlagen++;
    if (this.gruende.length < 8) this.gruende.push(grund);
    if (z.timer) clearTimeout(z.timer);
    z.timer = null;
    stelleWiederHer(el, z);
    z.ohneVorschau = true;
    z.eingereiht = false;
    // Die Rueckkehr der Originale ist keine Aenderung der Seite: Signatur nachfuehren, sonst startete der Beobachter eine neue Pruefung.
    if (el instanceof HTMLImageElement) z.signatur = bildSignatur(el);
    this.planeTestStatus();
    this.r.bewerte(el, z);
  }

  // Hover-Vorschauvideo in einer Vorschau-Karte: im Tausch-Modus nie zeigen (kein Urteil, bleibt durch Hide-first unsichtbar).
  versteckeVideo(el: Element, z: Zustand): boolean {
    if (!this.tausch || !this.r.aktiv()) return false;
    const adapter = adapterFuer(this.liste);
    // Nur stumme Vorschau-Schleifen: Beitragsvideos und Player (Bedienelemente, Ton, Player-Selektor) bleiben beim normalen Schleier.
    const v = el as HTMLVideoElement;
    const imPlayer = !!adapter.player?.length && adapter.player.some((s) => { try { return !!Vorschau.naechster(el, s); } catch { return false; } });
    // Entscheidung 193: ein Video in einer Anzeige wird nie gezeigt, auch mit Ton (angehalten, also still), ausser im Player der Seite. Der
    // Ton-Zustand bleibt unberuehrt (nichts zurueckzustellen bei Pause, Pruefung Runde 8, Nr. 3).
    if (!imPlayer && istAnzeige(el, location.href)) {
      this.beobachteVideo(v, z);
      try {
        v.pause();
      } catch {
        // nicht steuerbar
      }
      return true;
    }
    if (v.controls || !stumm(v)) return false;
    if (imPlayer) return false;
    // Live-Lauf 18, Fund 1: auf Seiten mit eigenem Adapter (Player bekannt) gilt jede stumme Schleife ohne Bedienelemente ausserhalb des
    // Players als Vorschau oder Anzeige, nicht nur, was auf einen Hover-Selektor passt. Eine Anzeige ausserhalb der Karten lief sonst durch die
    // Pruefung, die ein explizites Bild verfehlte (Firefox, Pornhub). Ausgenommen OnlyFans und Fansly: dort sind Beitragsvideos Inhalt.
    // Pruefung Runde 7, Nr. 1: auf einer Videoseite ist das groesste Video ausgenommen (Hauptvideo, auch wenn der Player-Selektor der Seite
    // veraltet ist; der Riegel waehlt es als Rueckfall). Auf Listenseiten gibt es kein Hauptvideo.
    const sonstigeSchleife =
      !!adapter.player?.length && adapter.name !== 'onlyfans' && adapter.name !== 'fansly' && (istListenPfad(location.pathname) || !istGroesstesVideo(v));
    if (!sonstigeSchleife && !istHoverVideo(Vorschau.ueberSchatten(el), adapter)) return false;
    this.beobachteVideo(v, z);
    try {
      (el as HTMLVideoElement).pause();
    } catch {
      // nicht abspielbar: nichts zu tun
    }
    return true;
  }

  // Ein beim Einfuegen stummes Video kann spaeter Ton und Bedienelemente bekommen (Beitragsvideo, Player): dann normal pruefen statt dauerhaft
  // verstecken. Ein Hoerer je Video auf volumechange, play und loadedmetadata.
  private readonly beobachtet = new WeakSet<Element>();
  private beobachteVideo(v: HTMLVideoElement, z: Zustand): void {
    if (this.beobachtet.has(v)) return;
    this.beobachtet.add(v);
    const anzeige = istAnzeige(v, location.href);
    let nachgehalten = 0;
    const pruefe = (ev?: Event) => {
      if (!this.r.lebt() || !this.r.aktiv()) return;
      if (anzeige) {
        // Anzeige (Entscheidung 193): bleibt verborgen und angehalten, auch wenn die Seite Ton oder Bedienelemente einschaltet. Hoechstens
        // NACHHALTEN_MAX Mal (gegen ein Hin und Her mit der Seite).
        try {
          if (ev?.type === 'play' && nachgehalten < NACHHALTEN_MAX) {
            nachgehalten++;
            v.pause();
          } else if (nachgehalten >= NACHHALTEN_MAX && !v.muted) {
            // Pruefung Runde 9, A: startet die Seite die Anzeige immer wieder, laeuft sie nach der Grenze unsichtbar weiter, aber nie mit Ton.
            v.muted = true;
          }
        } catch {
          // nicht steuerbar
        }
        return;
      }
      if (v.controls || !stumm(v)) {
        for (const e of ['volumechange', 'play', 'loadedmetadata']) v.removeEventListener(e, pruefe);
        this.beobachtet.delete(v);
        if (!z.urteil && !z.eingereiht) this.r.bewerte(v, z);
      } else if (ev?.type === 'play' && !z.urteil && nachgehalten < NACHHALTEN_MAX) {
        nachgehalten++;
        // Live-Lauf 18, Fund 2: startet die Seite eine versteckte Vorschau neu, laeuft sie nicht unsichtbar weiter.
        try {
          v.pause();
        } catch {
          // nicht steuerbar
        }
      }
    };
    for (const e of ['volumechange', 'play', 'loadedmetadata']) v.addEventListener(e, pruefe);
  }

  // ---------- Erkennen am Inhalt ----------

  // Eine echte Pruefung eines Bildes ist ausgegangen (frei oder Treffer). Eingesetzte Vorschau-Bilder und Videos kommen hier nie an.
  zaehle(z: Zustand, urteil: InhaltsUrteil): void {
    if (!this.erkennen || (z.art !== 'bild' && z.art !== 'hintergrund')) return;
    const schluessel = z.adresse && !z.adresse.startsWith('data:') ? z.adresse : z.signatur && !z.signatur.startsWith('data:') ? z.signatur : '';
    if (!schluessel) return;
    if (this.zaehler.zaehle(schluessel.slice(0, SCHLUESSEL_MAX), urteil)) this.melde();
    else this.planeTestStatus();
  }

  // Braucht der Schleier den Adressbeobachter fuer die Zaehlung (Seitenwechsel ohne Neuladen)?
  brauchtAdresse(): boolean {
    return this.erkennen && (this.zaehler.stand.gesamt > 0 || this.zaehler.amInhalt);
  }

  // Seitenwechsel ohne Neuladen: die Erkennung beginnt neu.
  beiAdresswechsel(): void {
    this.zaehler.neuStart();
    this.melde();
  }

  // ---------- Testhaken ----------

  // Nur im Testbau, auf Testhosts und auf der Testdomain: Stand als Attribut am Wurzelelement (data-veil-erwachsen).
  private planeTestStatus(): void {
    if (!TESTHAKEN_E || this.testTimer) return;
    if (!testhakenAktiv() && !location.hostname.endsWith(TEST_DOMAIN)) return;
    this.testTimer = setTimeout(() => {
      this.testTimer = null;
      const wurzel = document.documentElement;
      if (!wurzel) return;
      const s = erwachsenStatus();
      wurzel.setAttribute(
        ATTR_ERWACHSEN,
        JSON.stringify({
          liste: s.liste,
          amInhalt: s.amInhalt,
          tausch: this.tausch,
          erkennen: this.erkennen,
          abrufe: this.speicher.abrufe,
          bilder: this.speicher.anzahlBilder,
          bytes: this.speicher.anzahlBytes,
          fehlgeschlagen: this.fehlgeschlagen,
          gruende: this.gruende,
          zaehlung: this.zaehler.stand,
        }),
      );
    }, 30);
  }

  // Abbau (Erweiterung wird entfernt oder neu geladen).
  raeumeAuf(): void {
    if (this.testTimer) clearTimeout(this.testTimer);
    this.testTimer = null;
    if (this.stapelPlan) clearTimeout(this.stapelPlan);
    this.stapelPlan = null;
    this.stapel = [];
    if (this.nachtauschPlan) clearTimeout(this.nachtauschPlan);
    this.nachtauschPlan = null;
    this.nachtausch.leere();
    this.speicher.leere();
    if (TESTHAKEN_E) document.documentElement?.removeAttribute(ATTR_ERWACHSEN);
    setzeErwachsenStatus({ liste: null, amInhalt: false });
  }
}
