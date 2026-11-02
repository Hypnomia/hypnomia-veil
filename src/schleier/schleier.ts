// Schleier: Steuerung des Content-Scripts (PHASE-2-BAUPLAN Abschnitt 5).
// Die CSS (entrypoints/content/style.css) verdeckt schon vor dem ersten Zeichnen. Dieser Code sammelt die Elemente, laesst sie pruefen
// und setzt dann data-veil="frei" | "zensiert" | "verdeckt".

import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import {
  aendereEinstellungen,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  vervollstaendige,
  type Einstellungen,
} from '../einstellungen';
import type { AntwortPruefe, AntwortPruefeOk, AntwortTab, NachrichtHintergrundTab, Quelle } from '../nachrichten';
import {
  bildSignatur,
  hintergrundInline,
  hintergrundWert,
  istEigenesBild,
  setzeHintergrund,
  setzeUrteil,
  stelleWiederHer,
  starteBildTausch,
  verdeckeNurHintergrund,
  vergiss,
} from './anwenden';
import { Beobachter } from './beobachter';
import {
  ATTR_SEITE,
  ATTR_STRICT,
  AUFRAEUM_VERZOEGERUNG_MS,
  GROSSFLAECHE_ANTEIL,
  HG_SELEKTOR,
  MIN_KANTE,
  PARALLEL,
  STARTPHASE_MAX_MS,
  STARTPHASE_NACH_LOAD_MS,
  STRICT_MAX_MS,
  TAB_FRIST_MS,
  TAUSCH_MAX_MS,
  TESTHAKEN,
  VIDEO_NACHFRIST_MS,
  ZWEITER_VERSUCH_MS,
  type Art,
} from './konstanten';
import { KlassenSucher } from './klasse';
import {
  lesePixel,
  refererDerSeite,
  sendePruefe,
  urlAusEbene,
  wecke,
  zerlegeEbenen,
  Zwischenspeicher,
} from './pruefung';
import { entferneWurzelStile, raeumeWurzelStileAuf, schalteWurzelStile } from './shadow';
import { Status, testhakenAktiv, type Zaehlung } from './status';
import { neuerZustand, type Zustand } from './zustand';

export interface KontextLeicht {
  readonly isValid: boolean;
  onInvalidated(rueckruf: () => void): unknown;
}

type Ergebnis =
  | { art: 'frei' }
  | { art: 'verdeckt' }
  | { art: 'fehler' }
  | { art: 'zensiert'; bild: string }
  | { art: 'zensiertHg'; wert: string };

interface QuelleMitMass {
  quelle: Quelle;
  breite: number;
  hoehe: number;
}

const FALLBACK_LOAD_MS = 1500;
const CANVAS_VERZOEGERUNG_MS = 300;
const STRICT_PRUEFTAKT_MS = 40;

// Adresse fuer den Ausnahmenvergleich: in about:blank-Frames die Adresse der Basis (die des Erzeugers).
function adresseFuerAusnahmen(): { hostname: string; pathname: string } {
  if (location.hostname) return location;
  try {
    return new URL(document.baseURI);
  } catch {
    return { hostname: '', pathname: '/' };
  }
}

export function starteSchleier(ctx: KontextLeicht): void {
  const lebt = () => !abgebaut && ctx.isValid;
  let abgebaut = false;
  let einstellungen: Einstellungen | null = null;
  let aktiv = false; // Verarbeitung laeuft (Einstellungen geladen, weder Pause noch Ausnahme)
  let aus = false;
  let geladen = false; // load-Ereignis des Fensters
  let startphaseVorbei = false;
  let seiteFrei = false; // Strict: Seite freigegeben
  let startElemente: Element[] = [];

  const zustaende = new WeakMap<Element, Zustand>();
  const verfolgt = new Set<Element>();
  const wartend = new Set<Element>();
  const speicher = new Zwischenspeicher();
  const timer = new Set<ReturnType<typeof setTimeout>>();
  // Wurzeln, auf denen Medienereignisse abgehoert werden: das WeakSet verhindert Doppelte, die schwachen Verweise erlauben den Abbau.
  const wurzelnMitHoerer = new Set<WeakRef<ShadowRoot>>();
  const wurzelnGemerkt = new WeakSet<ShadowRoot>();
  let laufend = 0;
  // Stand der pruefrelevanten Einstellungen (Schwelle, Zonen, Rand, Stil). Jede Aenderung beginnt eine neue Epoche: der Schluessel im
  // Zwischenspeicher und bei laufenden Anfragen enthaelt sie, so landet keine Antwort zu alten Einstellungen bei neuen Urteilen.
  let pruefStand = '';
  let epoche = 0;
  // Wartezeit des zweiten Versuchs nach einem Fehler (Standard 10 s; nur der Testbau stellt sie per veil-test kuerzer).
  let zweiterVersuchMs = ZWEITER_VERSUCH_MS;
  // Eingebettete Frames: Adresse des Tabs (eigene Ausnahmen gelten je Tab). null = unbekannt, dann zaehlt nur die eigene Adresse.
  const istRahmen = (() => {
    try {
      return window !== window.top;
    } catch {
      return true;
    }
  })();
  let tabAdresse: URL | null = null;
  let aufraeumPlan: ReturnType<typeof setTimeout> | null = null;
  let strictTimer: ReturnType<typeof setTimeout> | null = null;
  let strictPlan: ReturnType<typeof setTimeout> | null = null;

  // ---------- Status ----------

  const zaehle = (): Zaehlung => {
    const z: Zaehlung = { gesamt: 0, offen: 0, frei: 0, zensiert: 0, verdeckt: 0 };
    for (const el of verfolgt) {
      if (!el.isConnected) continue;
      const s = zustaende.get(el);
      if (!s) continue;
      z.gesamt++;
      if (s.urteil) z[s.urteil]++;
      else z.offen++;
    }
    return z;
  };
  const status = new Status(zaehle);

  // ---------- Attribute am Wurzelelement ----------

  function wendeWurzelAttributeAn(): void {
    const wurzel = document.documentElement;
    if (!wurzel) return; // kommt, sobald das html-Element im Dokument steht (Beobachter meldet es)
    // Lebenszeichen fuer die Phase-0-Tests (hello.spec.ts, hello.test.mjs), nur auf 127.0.0.1 und localhost.
    if (TESTHAKEN && testhakenAktiv()) wurzel.dataset.hypnomiaVeil = 'hello';
    const seite = aus ? 'aus' : seiteFrei && einstellungen?.strict ? 'frei' : null;
    if (seite) wurzel.setAttribute(ATTR_SEITE, seite);
    else wurzel.removeAttribute(ATTR_SEITE);
    if (einstellungen?.strict && !aus) wurzel.setAttribute(ATTR_STRICT, '');
    else wurzel.removeAttribute(ATTR_STRICT);
    status.plane();
  }

  function setzeTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const t = setTimeout(() => {
      timer.delete(t);
      fn();
    }, ms);
    timer.add(t);
    return t;
  }

  // ---------- Hilfen ----------

  function istSichtbar(el: Element): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  // Sichtbarkeit aus dem IntersectionObserver, solange er noch nichts gemeldet hat aus einer Messung.
  function sichtbarJetzt(el: Element, z: Zustand): boolean {
    return z.sichtMeldung ? z.sichtbar : istSichtbar(el);
  }

  function istKlein(el: Element): boolean {
    let nb = 0;
    let nh = 0;
    if (el instanceof HTMLImageElement) {
      nb = el.naturalWidth;
      nh = el.naturalHeight;
    } else if (el instanceof HTMLVideoElement) {
      nb = el.videoWidth;
      nh = el.videoHeight;
    } else if (el instanceof HTMLCanvasElement) {
      nb = el.width;
      nh = el.height;
    }
    if (nb > 0 && nh > 0 && nb < MIN_KANTE && nh < MIN_KANTE) return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.width < MIN_KANTE && r.height < MIN_KANTE;
  }

  function bildGeladen(el: HTMLImageElement): boolean {
    return el.complete && el.naturalWidth > 0;
  }

  function bildAdresse(el: HTMLImageElement): string {
    return el.currentSrc || el.src;
  }

  // Mass fuer Pixelweg und Anfrage: die natuerliche Groesse, bei Bildern ohne Eigengroesse (SVG ohne width/height) die Darstellungsgroesse.
  function bildMass(el: HTMLImageElement): { breite: number; hoehe: number } {
    if (el.naturalWidth > 0 && el.naturalHeight > 0) return { breite: el.naturalWidth, hoehe: el.naturalHeight };
    const r = el.getBoundingClientRect();
    return { breite: Math.round(r.width), hoehe: Math.round(r.height) };
  }

  // ---------- Urteile setzen ----------

  function nachUrteil(): void {
    status.plane();
    planeStartphasePruefung();
    planeStrictPruefung();
  }

  function urteilFrei(el: Element, z: Zustand): void {
    z.eingereiht = false;
    if (z.art === 'bild') z.adresse = bildAdresse(el as HTMLImageElement);
    setzeUrteil(el, z, 'frei', status.seitStart());
    nachUrteil();
  }

  // Klassen-Hintergrund und grosse Inline-Hintergrund-Container (body, Seitenrahmen) wuerden mit Blur samt Text unlesbar:
  // dort verschwindet nur der Hintergrund.
  function nurHintergrundVerdecken(el: Element, z: Zustand): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (z.art === 'klasse') return true;
    if (z.art !== 'hintergrund') return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height > GROSSFLAECHE_ANTEIL * innerWidth * innerHeight;
  }

  function urteilVerdeckt(el: Element, z: Zustand): void {
    z.eingereiht = false;
    if (nurHintergrundVerdecken(el, z)) verdeckeNurHintergrund(el as HTMLElement, z);
    setzeUrteil(el, z, 'verdeckt', status.seitStart());
    nachUrteil();
  }

  function urteilFehler(el: Element, z: Zustand): void {
    z.eingereiht = false;
    status.fehler++;
    z.versuche++;
    if (z.versuche < 2) {
      // Bleibt verdeckt (kein data-veil), nach 10 s ein zweiter Versuch.
      z.timer = planeNeuenVersuch(el, z, zweiterVersuchMs);
    } else {
      // Zweiter Versuch gescheitert: endgueltig verdeckt (blur).
      if (z.tauschLaeuft || z.bildOriginal || z.hgOriginal) stelleWiederHer(el, z);
      urteilVerdeckt(el, z);
    }
    status.plane();
    planeStrictPruefung();
  }

  function planeNeuenVersuch(el: Element, z: Zustand, ms: number): ReturnType<typeof setTimeout> {
    return setzeTimer(() => {
      z.timer = null;
      if (aktiv && !z.urteil && !z.eingereiht) reihe(el, z);
    }, ms);
  }

  function urteilZensiertBild(el: HTMLImageElement, z: Zustand, bild: string): void {
    z.eingereiht = false;
    starteBildTausch(el, z, bild);
    // Das Element bleibt verdeckt, bis das zensierte Bild geladen ist (load-Ereignis, siehe beiMedienEreignis).
    if (z.timer) clearTimeout(z.timer);
    z.timer = setzeTimer(() => {
      z.timer = null;
      if (!z.tauschLaeuft) return;
      stelleWiederHer(el, z);
      urteilVerdeckt(el, z);
    }, TAUSCH_MAX_MS);
  }

  function schliesseTausch(el: HTMLImageElement, z: Zustand): void {
    if (z.timer) clearTimeout(z.timer);
    z.timer = null;
    z.tauschLaeuft = false;
    z.adresse = bildAdresse(el);
    setzeUrteil(el, z, 'zensiert', status.seitStart());
    nachUrteil();
  }

  function scheitereTausch(el: HTMLImageElement, z: Zustand): void {
    if (z.timer) clearTimeout(z.timer);
    z.timer = null;
    stelleWiederHer(el, z);
    urteilVerdeckt(el, z);
  }

  function urteilZensiertHg(el: HTMLElement, z: Zustand, wert: string): void {
    z.eingereiht = false;
    setzeHintergrund(el, z, wert);
    setzeUrteil(el, z, 'zensiert', status.seitStart());
    nachUrteil();
  }

  // ---------- Entdecken und Bewerten ----------

  function entdecke(el: Element, art: Art): void {
    if (abgebaut) return;
    let z = zustaende.get(el);
    if (!z) {
      z = neuerZustand(art);
      zustaende.set(el, z);
    }
    sichtBeobachter?.observe(el); // mehrfaches observe desselben Elements ist unschaedlich
    verfolgt.add(el);
    if (aktiv) bewerte(el, z);
  }

  function bewerte(el: Element, z: Zustand): void {
    if (!aktiv || z.urteil || z.eingereiht || z.erwarteLoad || z.tauschLaeuft) return;
    if (z.timer && z.versuche > 0) return; // zweiter Versuch ist geplant
    if (!startphaseVorbei && istSichtbar(el)) z.sichtbarBeiStart = true;
    switch (z.art) {
      case 'bild':
        return bewerteBild(el as HTMLImageElement, z);
      case 'video':
        return bewerteVideo(el as HTMLVideoElement, z);
      case 'canvas':
        return bewerteCanvas(el as HTMLCanvasElement, z);
      default:
        return bewerteHintergrund(el, z);
    }
  }

  function bewerteBild(el: HTMLImageElement, z: Zustand): void {
    z.signatur = bildSignatur(el);
    // Ohne Quelle gibt es nichts zu zeigen. Setzt die Seite spaeter eine src, meldet das der Beobachter.
    if (el.complete && !el.currentSrc && !el.getAttribute('src')) return urteilFrei(el, z);
    if (!bildGeladen(el)) {
      // Noch unterwegs: auf load oder error warten.
      if (!(el.complete && el.currentSrc)) return;
      // Fertig, aber ohne natuerliche Groesse: ein kaputtes Bild (error-Ereignis) wird freigegeben, ein Bild ohne Eigengroesse
      // (SVG ohne width und height) wird mit seiner Darstellungsgroesse geprueft. Ist nichts dargestellt, gibt es nichts zu zeigen.
      if (z.fehlerGesehen) return urteilFrei(el, z);
      const m = bildMass(el);
      if (m.breite < 1 || m.hoehe < 1) return urteilFrei(el, z);
    }
    if (istKlein(el)) return urteilFrei(el, z);
    const adresse = bildAdresse(el);
    const treffer = speicher.hole(schluesselFuer(adresse));
    if (treffer) return wendeAntwortAn(el, z, treffer);
    reihe(el, z);
  }

  function bewerteVideo(el: HTMLVideoElement, z: Zustand): void {
    if (el.readyState < 2) {
      // Noch keine Bilddaten (preload none oder metadata: erst nach dem Abspielen). Nach load und kurzer Frist unscharf zeigen,
      // sonst bliebe das Video samt Poster und Bedienelementen unsichtbar. loadeddata prueft es dann richtig (siehe beiMedienEreignis).
      if (geladen) planeVideoNachfrist(el, z);
      return;
    }
    if (el.videoWidth === 0) return urteilFrei(el, z); // nur Ton
    if (istKlein(el)) return urteilFrei(el, z);
    reihe(el, z);
  }

  function planeVideoNachfrist(el: HTMLVideoElement, z: Zustand): void {
    if (z.timer) return;
    z.timer = setzeTimer(() => {
      z.timer = null;
      if (!aktiv || z.urteil || z.eingereiht || el.readyState >= 2) return;
      z.vorlaeufig = true;
      urteilVerdeckt(el, z);
    }, VIDEO_NACHFRIST_MS);
  }

  function bewerteCanvas(el: HTMLCanvasElement, z: Zustand): void {
    if (istKlein(el)) return urteilFrei(el, z);
    if (!geladen || z.timer) return; // nach load, mit kleiner Verzoegerung
    z.timer = setzeTimer(() => {
      z.timer = null;
      if (aktiv && !z.urteil && !z.eingereiht) reihe(el, z);
    }, CANVAS_VERZOEGERUNG_MS);
  }

  // Wert des Hintergrunds: Inline-Wert (hintergrund) oder berechneter Wert (klasse).
  function hintergrundQuelle(el: Element, z: Zustand): string {
    if (z.art === 'klasse') {
      try {
        return getComputedStyle(el).backgroundImage;
      } catch {
        return '';
      }
    }
    return hintergrundWert(el);
  }

  function pruefbareAdresse(ebene: string): string | null {
    const url = urlAusEbene(ebene);
    return url && /^(https?|data|blob):/i.test(url) ? url : null;
  }

  function bewerteHintergrund(el: Element, z: Zustand): void {
    const wert = hintergrundQuelle(el, z);
    z.signatur = z.art === 'klasse' ? null : wert;
    if (z.eigen && wert === z.eigen) return urteilFrei(el, z);
    const ebenen = zerlegeEbenen(wert).filter((e) => pruefbareAdresse(e));
    if (!ebenen.length) return urteilFrei(el, z);
    if (istKlein(el)) return urteilFrei(el, z);
    reihe(el, z);
  }

  // ---------- Warteschlange ----------

  function reihe(el: Element, z: Zustand): void {
    if (!aktiv || z.eingereiht || z.urteil) return;
    z.eingereiht = true;
    // Sichtbarkeit nur beim Einreihen messen; danach fuehrt der IntersectionObserver sie nach (kein Layout je Auswahl).
    if (!z.sichtMeldung) z.sichtbar = istSichtbar(el);
    wartend.add(el);
    starteNaechste();
  }

  function waehleNaechstes(): Element | null {
    let erstes: Element | null = null;
    for (const el of wartend) {
      const z = zustaende.get(el);
      if (!z) {
        wartend.delete(el);
        continue;
      }
      if (!el.isConnected) {
        // Aus dem Dokument gefallen: nicht mehr pruefen. Kommt es zurueck, meldet der Beobachter es erneut.
        wartend.delete(el);
        z.eingereiht = false;
        continue;
      }
      if (z.sichtbar) return el; // Sichtbares zuerst
      erstes ??= el;
    }
    return erstes;
  }

  function starteNaechste(): void {
    while (aktiv && lebt() && laufend < PARALLEL && wartend.size) {
      const el = waehleNaechstes();
      if (!el) break;
      wartend.delete(el);
      laufend++;
      void verarbeite(el).finally(() => {
        laufend--;
        starteNaechste();
      });
    }
  }

  async function verarbeite(el: Element): Promise<void> {
    const z = zustaende.get(el);
    if (!z || z.urteil || !z.eingereiht) return;
    const generation = z.generation;
    let ergebnis: Ergebnis;
    try {
      switch (z.art) {
        case 'bild':
          ergebnis = await pruefeBild(el as HTMLImageElement, z);
          break;
        case 'video':
          ergebnis = await pruefeVideo(el as HTMLVideoElement);
          break;
        case 'canvas':
          ergebnis = await pruefeCanvas(el as HTMLCanvasElement);
          break;
        default:
          ergebnis = await pruefeHintergrund(el, z);
      }
    } catch {
      ergebnis = { art: 'fehler' };
    }
    // Verworfen, wenn sich das Element inzwischen geaendert hat (neue src, Pause, neue Einstellungen).
    if (!lebt() || !aktiv || z.generation !== generation) return;
    wendeErgebnisAn(el, z, ergebnis);
  }

  function wendeErgebnisAn(el: Element, z: Zustand, e: Ergebnis): void {
    switch (e.art) {
      case 'frei':
        return urteilFrei(el, z);
      case 'verdeckt':
        return urteilVerdeckt(el, z);
      case 'fehler':
        return urteilFehler(el, z);
      case 'zensiert':
        return urteilZensiertBild(el as HTMLImageElement, z, e.bild);
      case 'zensiertHg':
        return urteilZensiertHg(el as HTMLElement, z, e.wert);
    }
  }

  // Antwort aus dem Zwischenspeicher oder frisch: entscheidet ueber das Urteil eines img.
  function wendeAntwortAn(el: HTMLImageElement, z: Zustand, a: AntwortPruefeOk): void {
    if (!a.flaechen.length) return urteilFrei(el, z);
    if (a.bild) return urteilZensiertBild(el, z, a.bild);
    urteilVerdeckt(el, z);
  }

  // ---------- Pruefen ----------

  // Fragt den Erkenner (mit Zwischenspeicher, gleiche Adresse nur einmal gleichzeitig). null = nicht lesbar, freigeben.
  // Schluessel fuer Zwischenspeicher und laufende Anfragen: Epoche der pruefrelevanten Einstellungen plus Adresse.
  function schluesselFuer(adresse: string): string {
    return `${epoche}|${adresse}`;
  }

  async function frageNach(adresse: string, bau: () => Promise<QuelleMitMass | null> | QuelleMitMass | null): Promise<AntwortPruefe | null> {
    // Die Einstellungen werden einmal festgehalten: Anfrage, Schluessel und Ablage gehoeren zum selben Stand.
    const e = einstellungen;
    if (!e) return null;
    const dieseEpoche = epoche;
    const schluessel = schluesselFuer(adresse);
    const treffer = speicher.hole(schluessel);
    if (treffer) return treffer;
    const antwort = await speicher.einmal(schluessel, async () => {
      const q = await bau();
      if (!q) return null;
      if (!(await wecke(lebt))) return { ok: false, id: '', fehler: 'Erkenner nicht erreichbar' } as AntwortPruefe;
      return sendePruefe(q.quelle, q.breite, q.hoehe, e, true);
    });
    // Nur ablegen, wenn sich die pruefrelevanten Einstellungen inzwischen nicht geaendert haben.
    if (antwort?.ok && dieseEpoche === epoche) speicher.lege(schluessel, antwort);
    return antwort;
  }

  async function pruefeBild(el: HTMLImageElement, z: Zustand): Promise<Ergebnis> {
    const adresse = bildAdresse(el);
    z.adresse = adresse;
    const antwort = await frageNach(adresse, () => {
      const m = bildMass(el);
      const px = lesePixel(el, m.breite, m.hoehe);
      if (px) return { quelle: { art: 'daten', dataUrl: px.dataUrl }, breite: m.breite, hoehe: m.hoehe };
      // Ohne Eigengroesse und nicht lesbar: kaputtes Bild oder fremdes SVG, es gibt nichts zu pruefen.
      if (!(el.naturalWidth > 0)) return null;
      // Nicht lesbar (Chrome ohne CORS): der Erkenner laedt selbst. data: und blob: gibt es nur ueber den Canvas-Weg.
      if (/^https?:/i.test(adresse)) return { quelle: { art: 'url', url: adresse, referer: refererDerSeite() }, breite: m.breite, hoehe: m.hoehe };
      return null;
    });
    if (!antwort) return { art: 'frei' };
    if (!antwort.ok) return { art: 'fehler' };
    if (!antwort.flaechen.length) return { art: 'frei' };
    return antwort.bild ? { art: 'zensiert', bild: antwort.bild } : { art: 'verdeckt' };
  }

  async function pruefeVideo(el: HTMLVideoElement): Promise<Ergebnis> {
    // Einzelbild per Canvas. Nicht lesbar: verdeckt (Entscheidung 21). Keine laufende Nachpruefung in dieser Session.
    const px = lesePixel(el, el.videoWidth, el.videoHeight);
    if (!px || !einstellungen) return { art: 'verdeckt' };
    if (!(await wecke(lebt))) return { art: 'fehler' };
    const a = await sendePruefe({ art: 'daten', dataUrl: px.dataUrl }, el.videoWidth, el.videoHeight, einstellungen, false);
    if (!a.ok) return { art: 'fehler' };
    return a.flaechen.length ? { art: 'verdeckt' } : { art: 'frei' };
  }

  async function pruefeCanvas(el: HTMLCanvasElement): Promise<Ergebnis> {
    // Canvas ohne Lesezugriff sind meist Spiele und Diagramme: freigeben [Likely].
    const px = lesePixel(el, el.width, el.height);
    if (!px || !einstellungen) return { art: 'frei' };
    if (!(await wecke(lebt))) return { art: 'fehler' };
    const a = await sendePruefe({ art: 'daten', dataUrl: px.dataUrl }, el.width, el.height, einstellungen, false);
    if (!a.ok) return { art: 'fehler' };
    return a.flaechen.length ? { art: 'verdeckt' } : { art: 'frei' };
  }

  // Bild fuer den Canvas-Weg laden, wenn es vom selben Ursprung stammt (sonst ist das Canvas ohnehin verschmutzt).
  async function ladeBild(url: string): Promise<HTMLImageElement | null> {
    const bild = new Image();
    bild.decoding = 'async';
    const fertig = new Promise<boolean>((auf) => {
      bild.addEventListener('load', () => auf(true), { once: true });
      bild.addEventListener('error', () => auf(false), { once: true });
      setTimeout(() => auf(false), 8000);
    });
    bild.src = url;
    return (await fertig) && bild.naturalWidth > 0 ? bild : null;
  }

  function gleicherUrsprung(url: string): boolean {
    if (/^(data|blob):/i.test(url)) return true;
    try {
      return new URL(url).origin === location.origin;
    } catch {
      return false;
    }
  }

  async function hintergrundQuelleBauen(url: string): Promise<QuelleMitMass | null> {
    if (gleicherUrsprung(url)) {
      const bild = await ladeBild(url);
      if (bild) {
        const px = lesePixel(bild, bild.naturalWidth, bild.naturalHeight);
        if (px) return { quelle: { art: 'daten', dataUrl: px.dataUrl }, breite: bild.naturalWidth, hoehe: bild.naturalHeight };
      }
    }
    if (/^https?:/i.test(url)) return { quelle: { art: 'url', url, referer: refererDerSeite() }, breite: 0, hoehe: 0 };
    return null;
  }

  async function pruefeHintergrund(el: Element, z: Zustand): Promise<Ergebnis> {
    const wert = hintergrundQuelle(el, z);
    const neu: string[] = [];
    let geaendert = false;
    let verdeckt = false;
    let fehler = false;
    for (const ebene of zerlegeEbenen(wert)) {
      const url = pruefbareAdresse(ebene);
      if (!url) {
        neu.push(ebene);
        continue;
      }
      const a = await frageNach(url, () => hintergrundQuelleBauen(url));
      if (!a) neu.push(ebene);
      else if (!a.ok) fehler = true;
      else if (!a.flaechen.length) neu.push(ebene);
      else if (a.bild) {
        // Zensiertes Bild vorladen, damit beim Setzen kein leerer Hintergrund aufblitzt.
        await ladeBild(a.bild);
        neu.push(`url("${a.bild}")`);
        geaendert = true;
      } else verdeckt = true;
    }
    if (fehler) return { art: 'fehler' };
    if (verdeckt) return { art: 'verdeckt' };
    return geaendert ? { art: 'zensiertHg', wert: neu.join(', ') } : { art: 'frei' };
  }

  // ---------- Startphase und Strict ----------

  let sichtBeobachter: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    sichtBeobachter = new IntersectionObserver((eintraege) => {
      for (const e of eintraege) {
        const z = zustaende.get(e.target);
        if (!z) continue;
        z.sichtMeldung = true;
        z.sichtbar = e.isIntersecting;
        if (e.isIntersecting && !startphaseVorbei) z.sichtbarBeiStart = true;
      }
    });
  }

  let startPlan: ReturnType<typeof setTimeout> | null = null;
  function planeStartphasenEnde(ms: number): void {
    if (startphaseVorbei) return;
    if (startPlan) clearTimeout(startPlan); // ein spaeterer Plan ersetzt den frueheren (load verkuerzt die Frist)
    startPlan = setzeTimer(() => {
      startPlan = null;
      beendeStartphase();
    }, ms);
  }

  function beendeStartphase(): void {
    if (startphaseVorbei) return;
    startphaseVorbei = true;
    startElemente = [];
    // Die Liste dient nur der Messung sichtbarFreiMs (Testbau): sonst keine Verweise festhalten.
    if (status.aktiv) {
      for (const el of verfolgt) {
        const z = zustaende.get(el);
        if (z?.sichtbarBeiStart && z.art !== 'klasse') startElemente.push(el);
      }
    }
    planeStartphasePruefung();
  }

  // sichtbarFreiMs: Zeit ab Start des Content-Scripts, bis das letzte beim Start sichtbare Element beurteilt ist.
  function planeStartphasePruefung(): void {
    if (!startphaseVorbei || status.sichtbarFreiMs !== null || !status.aktiv) return;
    let spaetestens = 0;
    for (const el of startElemente) {
      const z = zustaende.get(el);
      if (!z || !el.isConnected) continue; // entfernte Elemente zaehlen nicht mehr
      if (!z.urteil || z.urteilMs === null) return; // noch offen
      spaetestens = Math.max(spaetestens, z.urteilMs);
    }
    status.sichtbarFreiMs = spaetestens;
    startElemente = [];
    status.plane();
  }

  // Strict wartet nur auf Elemente, die beim Start sichtbar sind oder deren Groesse noch unbekannt ist. Ein nicht-lazy Bild weit
  // unter dem Sichtbereich, dessen Platz schon feststeht, haelt die Seite nicht auf (es bleibt einzeln verdeckt, bis es beurteilt ist).
  function offenFuerStrict(): boolean {
    for (const el of verfolgt) {
      const z = zustaende.get(el);
      if (!z || z.urteil || z.art === 'klasse' || !el.isConnected) continue;
      if (z.versuche > 0 && !z.eingereiht) continue; // gescheitert, wartet auf zweiten Versuch
      if (z.eingereiht) {
        if (sichtbarJetzt(el, z)) return true;
        continue;
      }
      // Noch nicht eingereiht: nur ein nicht-lazy Bild, das noch laedt, kann die Seite aufhalten.
      if (z.art !== 'bild' || (el as HTMLImageElement).loading === 'lazy') continue;
      if (z.sichtbarBeiStart || sichtbarJetzt(el, z)) return true;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return true; // Groesse noch unbekannt
    }
    return false;
  }

  function planeStrictPruefung(): void {
    if (!aktiv || !einstellungen?.strict || seiteFrei || strictPlan) return;
    strictPlan = setzeTimer(() => {
      strictPlan = null;
      if (document.readyState !== 'loading' && !offenFuerStrict()) gibSeiteFrei();
    }, STRICT_PRUEFTAKT_MS);
  }

  function gibSeiteFrei(): void {
    if (seiteFrei) return;
    seiteFrei = true;
    if (strictTimer) clearTimeout(strictTimer);
    strictTimer = null;
    status.seiteFreiMs = status.seitStart();
    wendeWurzelAttributeAn();
    status.schreibe(); // Attribut und Status gleichzeitig sichtbar
  }

  // Strict beginnt: Seite bleibt unsichtbar, hoechstens 4 s ab Start des Content-Scripts. Spaeter (Umschalten im Popup, Ende der Pause)
  // wird die Seite nicht erneut versteckt.
  function beginneStrict(): void {
    if (seiteFrei || strictTimer) return;
    const rest = STRICT_MAX_MS - status.seitStart();
    if (rest <= 0) {
      gibSeiteFrei();
      return;
    }
    strictTimer = setzeTimer(gibSeiteFrei, rest);
    planeStrictPruefung();
  }

  // ---------- Ereignisse ----------

  function beiMedienEreignis(e: Event): void {
    if (abgebaut) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    const z = zustaende.get(el);
    if (!z) return;
    if (el instanceof HTMLImageElement && z.tauschLaeuft && istEigenesBild(el, z)) {
      if (e.type === 'load') schliesseTausch(el, z);
      else if (e.type === 'error') scheitereTausch(el, z);
      return;
    }
    if (!aktiv) return;
    if (z.art === 'bild' && el instanceof HTMLImageElement) {
      if (e.type === 'error') z.fehlerGesehen = true;
      if (z.erwarteLoad) {
        z.erwarteLoad = false;
        if (z.timer) clearTimeout(z.timer);
        z.timer = null;
      }
      if (z.urteil) {
        // Quelle gewechselt ohne Attributaenderung (Medienabfrage in picture, sizes)?
        if (e.type === 'load' && !istEigenesBild(el, z) && z.adresse !== bildAdresse(el)) {
          vergiss(el, z, false);
          bewerte(el, z);
        }
        return;
      }
      bewerte(el, z);
    } else if (z.art === 'video' && e.type === 'loadeddata') {
      if (z.vorlaeufig) {
        // Vorlaeufig unscharf gezeigt (keine Daten bis jetzt): richtig pruefen. Das Attribut bleibt bis zum neuen Urteil stehen.
        z.vorlaeufig = false;
        z.urteil = null;
      }
      bewerte(el, z);
    }
  }

  const MEDIEN_EREIGNISSE = ['load', 'error', 'loadeddata'] as const;
  function hoereAb(ziel: Document | ShadowRoot): void {
    for (const name of MEDIEN_EREIGNISSE) ziel.addEventListener(name, beiMedienEreignis, true);
  }
  function hoereAuf(ziel: Document | ShadowRoot): void {
    for (const name of MEDIEN_EREIGNISSE) ziel.removeEventListener(name, beiMedienEreignis, true);
  }

  // Die Seite hat die Quelle geaendert: neu beurteilen. Das Element wird sofort wieder verdeckt (data-veil weg).
  function neuePruefung(el: Element, z: Zustand, wartetAufLoad: boolean): void {
    wartend.delete(el);
    vergiss(el, z, false);
    if (!aktiv) return;
    if (wartetAufLoad && el instanceof HTMLImageElement && (el.getAttribute('src') || el.getAttribute('srcset') || el.parentElement?.tagName === 'PICTURE')) {
      // currentSrc und complete hinken hinter dem Attribut her: erst das naechste load oder error abwarten.
      z.erwarteLoad = true;
      z.timer = setzeTimer(() => {
        z.timer = null;
        z.erwarteLoad = false;
        bewerte(el, z);
      }, FALLBACK_LOAD_MS);
      return;
    }
    bewerte(el, z);
  }

  const beobachter: Beobachter = new Beobachter({
    gefunden: (el, art) => entdecke(el, art),
    neueWurzel: (w) => {
      hoereAb(w);
      if (!wurzelnGemerkt.has(w)) {
        wurzelnGemerkt.add(w);
        wurzelnMitHoerer.add(new WeakRef(w));
      }
    },
    entfernt: () => planeAufraeumen(),
    istAus: () => aus,
    hinzugefuegt: (knoten) => {
      if (knoten === document.documentElement) wendeWurzelAttributeAn();
      if (aktiv && geladen) klassen.planeKnoten(knoten);
    },
    geaendert: (el, attribut) => {
      if (!aktiv) return;
      if (attribut === 'class') {
        if (geladen) klassen.planeElement(el);
        return;
      }
      if (attribut === 'style') {
        const z = zustaende.get(el);
        if (!z) {
          if (el.matches(HG_SELEKTOR)) entdecke(el, 'hintergrund');
          return;
        }
        if (z.art !== 'hintergrund' && z.art !== 'klasse') return;
        // Inline-Hintergrund: derselbe Wert wie bei der Beurteilung (bei var() der berechnete). Klassen-Hintergrund: nur der eigene Inline-Wert.
        const aktuell = z.art === 'hintergrund' ? hintergrundWert(el) : hintergrundInline(el);
        if (z.art === 'hintergrund' ? aktuell === z.signatur : aktuell === (z.eigen ?? '')) return; // eigene oder unwichtige Aenderung
        neuePruefung(el, z, false);
        return;
      }
      // src, srcset: bei einem source gilt die Aenderung dem img im selben picture.
      let ziel: Element = el;
      if (el.localName === 'source' && el.parentElement?.tagName === 'PICTURE') {
        const img = el.parentElement.querySelector(':scope > img');
        if (!img) return;
        ziel = img;
      }
      if (!(ziel instanceof HTMLImageElement)) return;
      const z = zustaende.get(ziel);
      if (!z) {
        entdecke(ziel, 'bild');
        return;
      }
      if (bildSignatur(ziel) === z.signatur) return; // eigene Aenderung (Tausch) oder gleicher Wert
      neuePruefung(ziel, z, true);
    },
  });

  const klassen = new KlassenSucher(
    (el) => entdecke(el, 'klasse'),
    (el) => verfolgt.has(el),
  );

  function planeKlassenUndCanvas(): void {
    if (!aktiv) return;
    for (const w of beobachter.wurzeln()) klassen.planeWurzel(w);
    for (const el of verfolgt) {
      const z = zustaende.get(el);
      if (z?.art === 'canvas' || z?.art === 'video') bewerte(el, z); // Video ohne Daten: jetzt beginnt die Nachfrist
    }
  }

  // Aufraeumen: aus dem Dokument gefallene Elemente nicht laenger festhalten (Seiten mit endlosem Nachladen, Einzelseiten-Apps).
  // Die Zustaende liegen in einer WeakMap und gehen mit dem Element. Kommt ein Element zurueck, meldet es der Beobachter neu.
  function planeAufraeumen(): void {
    if (aufraeumPlan || !aktiv) return;
    aufraeumPlan = setzeTimer(() => {
      aufraeumPlan = null;
      raeumeGetrennteAuf();
    }, AUFRAEUM_VERZOEGERUNG_MS);
  }

  function raeumeGetrennteAuf(): void {
    for (const el of verfolgt) {
      if (el.isConnected) continue;
      verfolgt.delete(el);
      if (wartend.delete(el)) {
        const z = zustaende.get(el);
        if (z) z.eingereiht = false;
      }
      sichtBeobachter?.unobserve(el);
    }
    for (const ref of wurzelnMitHoerer) if (!ref.deref()) wurzelnMitHoerer.delete(ref);
    raeumeWurzelStileAuf();
  }

  function beiLoad(): void {
    if (geladen) return;
    geladen = true;
    beobachter.markiereGeladen();
    planeStartphasenEnde(STARTPHASE_NACH_LOAD_MS);
    planeKlassenUndCanvas();
    planeStrictPruefung();
  }

  // ---------- Einstellungen, Pause, Ausnahmen ----------

  // Eigene Ausnahmen gelten je Tab: in eingebetteten Frames zaehlt auch die Adresse des Tabs (falls bekannt).
  function istAusFuer(e: Einstellungen): boolean {
    if (e.pause || passtAusnahme(adresseFuerAusnahmen(), e.ausnahmen)) return true;
    return tabAdresse !== null && passtAusnahme(tabAdresse, e.ausnahmen);
  }

  async function frageTabAdresse(): Promise<void> {
    if (!istRahmen) return;
    try {
      const nachricht: NachrichtHintergrundTab = { ziel: 'hintergrund', typ: 'tab' };
      const antwort = (await browser.runtime.sendMessage(nachricht)) as Partial<AntwortTab> | undefined;
      if (antwort && antwort.ok === true && typeof antwort.url === 'string') tabAdresse = new URL(antwort.url);
    } catch {
      // keine oder fehlerhafte Antwort: es zaehlt nur die eigene Adresse
    }
  }

  function pruefRelevant(e: Einstellungen): string {
    return JSON.stringify([e.schwelle, e.zonen, e.rand, e.stil]);
  }

  // Beginnt eine neue Epoche, wenn sich die pruefrelevanten Einstellungen geaendert haben (auch waehrend einer Pause).
  // Gibt true zurueck, wenn schon Urteile nach einem alten Stand existieren koennten.
  function aktualisierePruefstand(neu: Einstellungen): boolean {
    const stand = pruefRelevant(neu);
    if (stand === pruefStand) return false;
    const warSchonDa = pruefStand !== '';
    pruefStand = stand;
    epoche++;
    speicher.leere();
    return warSchonDa;
  }

  // Alles zuruecksetzen und neu beurteilen (neue Schwelle, Zonen, Rand oder Stil). Der Zwischenspeicher ist mit der neuen Epoche
  // schon leer; Antworten laufender Anfragen tragen die alte Epoche und werden nie wieder gefunden.
  function beurteileNeu(): void {
    wartend.clear();
    for (const el of verfolgt) {
      const z = zustaende.get(el);
      if (!z) continue;
      if (z.urteil || z.eingereiht || z.tauschLaeuft) vergiss(el, z, true);
    }
    for (const el of verfolgt) {
      const z = zustaende.get(el);
      if (z) bewerte(el, z);
    }
    status.plane();
  }

  // Pause oder Ausnahme: Seite zeigen, Originale zurueck, nichts mehr tun.
  function schalteAus(): void {
    aus = true;
    const warAktiv = aktiv;
    aktiv = false;
    beobachter.stopp();
    klassen.stopp();
    wartend.clear();
    for (const t of timer) clearTimeout(t);
    timer.clear();
    strictTimer = null;
    strictPlan = null;
    startPlan = null;
    aufraeumPlan = null;
    for (const el of verfolgt) {
      const z = zustaende.get(el);
      if (z && (warAktiv || z.urteil)) {
        vergiss(el, z, true);
      }
    }
    verfolgt.clear();
    sichtBeobachter?.disconnect();
    schalteWurzelStile(true);
    wendeWurzelAttributeAn();
  }

  function schalteAn(): void {
    const warAus = aus;
    aus = false;
    aktiv = true;
    klassen.erlaube();
    schalteWurzelStile(false);
    beobachter.start(); // sammelt neu, auch nach einer Pause (bewertet Zwischengespeichertes sofort)
    for (const el of verfolgt) {
      const z = zustaende.get(el);
      if (z) bewerte(el, z);
    }
    // Attribut erst nach dem Wiederanwenden entfernen: Zwischengespeichertes ist dann schon beurteilt.
    wendeWurzelAttributeAn();
    if (geladen) planeKlassenUndCanvas();
    if (warAus && startphaseVorbei === false) planeStartphasenEnde(STARTPHASE_MAX_MS);
  }

  function wendeEinstellungenAn(neu: Einstellungen): void {
    if (abgebaut) return;
    einstellungen = neu;
    const stand = aktualisierePruefstand(neu);
    const sollAus = istAusFuer(neu);
    if (sollAus) {
      if (!aus || aktiv) schalteAus();
      else wendeWurzelAttributeAn();
      return;
    }
    if (!aktiv) {
      schalteAn();
    } else if (stand) {
      beurteileNeu();
    }
    if (!neu.strict) {
      seiteFrei = false;
      if (strictTimer) clearTimeout(strictTimer);
      strictTimer = null;
    }
    wendeWurzelAttributeAn();
    if (neu.strict) beginneStrict();
    status.plane();
  }

  // ---------- Testhaken: CustomEvent veil-test (nur im Testbau, nur auf 127.0.0.1 und localhost) ----------

  // detail ist ein JSON-Text oder ein Objekt mit { einstellungen, zweiterVersuchMs }. Ein Text ist der sichere Weg ueber die Grenze
  // zwischen Seite und Content-Script (Firefox reicht Objekte der Seite nicht durch). zweiterVersuchMs verkuerzt die Wartezeit des
  // zweiten Versuchs nach einem Fehler, damit der Fehlerpfad im Test nicht 10 s dauert; das Produktverhalten bleibt unveraendert.
  function beiTestEreignis(e: Event): void {
    try {
      let detail = (e as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const d = detail as { einstellungen?: unknown; zweiterVersuchMs?: unknown } | null;
      if (typeof d?.zweiterVersuchMs === 'number' && d.zweiterVersuchMs >= 0) zweiterVersuchMs = d.zweiterVersuchMs;
      const roh = d?.einstellungen;
      if (!roh || typeof roh !== 'object') return;
      aendereEinstellungen(roh as Partial<Einstellungen>).catch(() => {});
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  }

  // ---------- Start ----------

  // Ein fremdes Attribut "aus" (oder Strict) am html stammt von einem frueheren Content-Script dieser Erweiterung (Update, Neu-Einspritzen
  // in einen offenen Tab): sofort und synchron entfernen, sonst bliebe die Seite bis zum Laden der Einstellungen ungeschuetzt.
  try {
    const altWurzel = document.documentElement;
    if (altWurzel) {
      if (altWurzel.getAttribute(ATTR_SEITE) === 'aus') altWurzel.removeAttribute(ATTR_SEITE);
      altWurzel.removeAttribute(ATTR_STRICT);
    }
  } catch {
    // Dokument nicht lesbar: nichts zu tun
  }

  hoereAb(document);
  if (TESTHAKEN && testhakenAktiv()) document.addEventListener('veil-test', beiTestEreignis);
  window.addEventListener('load', beiLoad, { once: true });
  planeStartphasenEnde(STARTPHASE_MAX_MS);
  beobachter.start(); // sofort sammeln, auswerten erst nach dem Laden der Einstellungen
  if (document.readyState === 'complete') beiLoad();
  status.plane();

  let ausEinstellungGehoert = false;
  const abmelden = beiEinstellungsAenderung((neu) => {
    ausEinstellungGehoert = true;
    wendeEinstellungenAn(neu);
  });
  // Eingebettete Frames fragen den Hintergrund nach der Adresse des Tabs. Kommt die Antwort spaeter als die Einstellungen,
  // gilt sie ab dann (die Einstellungen werden erneut angewendet); der Start wartet hoechstens TAB_FRIST_MS darauf.
  const tabAntwort = frageTabAdresse().then(() => {
    if (einstellungen && lebt()) wendeEinstellungenAn(einstellungen);
  });
  const tabFrist = new Promise<void>((fertig) => setTimeout(fertig, TAB_FRIST_MS));
  Promise.all([ladeEinstellungen().catch(() => vervollstaendige(undefined)), Promise.race([tabAntwort, tabFrist])]).then(([e]) => {
    if (!ausEinstellungGehoert) wendeEinstellungenAn(e);
  });

  ctx.onInvalidated(() => {
    abgebaut = true;
    aktiv = false;
    abmelden();
    beobachter.stopp();
    klassen.stopp();
    sichtBeobachter?.disconnect();
    for (const t of timer) clearTimeout(t);
    timer.clear();
    // Kein Lock: die Seite zeigt sich ohne Schleier. Originale zurueck, Urteils-Attribute weg, Strict-Verhuellung weg. Eine uebrig
    // gebliebene Schleier-CSS (Chrome entfernt sie beim Abbau nicht immer sofort) neutralisiert data-veil-seite="aus".
    try {
      for (const el of verfolgt) {
        const z = zustaende.get(el);
        if (z) vergiss(el, z, true);
      }
      verfolgt.clear();
      wartend.clear();
      const wurzel = document.documentElement;
      if (wurzel) {
        wurzel.setAttribute(ATTR_SEITE, 'aus');
        wurzel.removeAttribute(ATTR_STRICT);
      }
    } catch {
      // Dokument schon weg: nichts mehr zu tun
    }
    hoereAuf(document);
    for (const ref of wurzelnMitHoerer) {
      const w = ref.deref();
      if (w) hoereAuf(w);
    }
    if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    window.removeEventListener('load', beiLoad);
    entferneWurzelStile();
    status.raeumeAuf();
  });
}
