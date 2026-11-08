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
import {
  istFuer,
  type AntwortPruefe,
  type AntwortPruefeOk,
  type AntwortTab,
  type NachrichtErkennerStatus,
  type NachrichtHintergrundAdresse,
  type NachrichtHintergrundTab,
  type NachrichtInhalt,
  type Quelle,
} from '../nachrichten';
import {
  bildSignatur,
  hintergrundInline,
  hintergrundWert,
  istEigenesBild,
  setzeHintergrund,
  setzeUrteil,
  setzeZensurWieder,
  stelleWiederHer,
  starteBildTausch,
  starteSvgTausch,
  verdeckeNurHintergrund,
  vergiss as vergissElement,
  zeigeOriginal,
} from './anwenden';
import { entscheideNachladen } from '../erkenner/nachladen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, wirksamerStil, type PackKurz } from '../pack/vertrag';
import { SteigerungMelder } from './steigerung-melder';
import { setzeUrteilMelder, setzeZensiertMelder } from './anwenden';
import { setzeZonenAnpassung } from './pruefung';
import { AdressBeobachter } from './adresse';
import { Beobachter } from './beobachter';
import {
  ATTR_MS,
  ATTR_NUR_HG,
  ATTR_SEITE,
  ATTR_STRICT,
  ATTR_URTEIL,
  AUFRAEUM_VERZOEGERUNG_MS,
  BLITZ_SPERRE_MS,
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
  VIDEO_BUDGET_JE_S,
  VIDEO_FREI_NACH,
  VIDEO_LAENGSTE_SEITE,
  VIDEO_NACHFRIST_AUTOPLAY_MS,
  VIDEO_NACHFRIST_MS,
  VIDEO_TAKT_MS,
  VIDEO_WECHSEL_MIN_MS,
  VORRANG_KLEIN_PX,
  VORRANG_NAH_FAKTOR,
  VORRANG_NAH_RAND,
  ZWEITER_VERSUCH_MS,
  type Art,
} from './konstanten';
import { KlassenSucher } from './klasse';
import {
  lesePixel,
  pixelLesenErlaubt,
  refererDerSeite,
  sendePruefe,
  svgQuelle,
  urlAusEbene,
  wecke,
  zerlegeEbenen,
  Zwischenspeicher,
} from './pruefung';
import { entferneWurzelStile, raeumeWurzelStileAuf, schalteWurzelStile } from './shadow';
import { leinwandLeer, Spiegel } from './spiegel';
import { testRiegel } from '../riegel/testhaken';
import { freigabeGesperrt, Status, testhakenAktiv } from './status';
import { zaehleZustaende, type Zaehlung } from './zaehlung';
import { istSchleifenUmlauf, VideoTakt, type VideoErgebnis, type VideoUrteil } from './video';
import { inhaltAusTreffern, zaehltFuerInhalt } from '../adapter/inhalt';
import { Vorschau } from './vorschau';
import { TonDeckel } from './ton-deckel';
import { AnzeigenRahmen } from './anzeigen-rahmen';
import { istLokalePause } from '../pause-lokal';
import { adapterFuer, istHoverVideo } from '../adapter';
import { istAnzeige } from '../adapter/anzeige';
import { erwachsenStatus } from '../adapter/status';
import { Freilegen } from './freilegen';
import { neuerZustand, type Zustand } from './zustand';
import { istKleinDargestellt, liegtImBereich, SichtBeobachter, vorrangStufe, waehleNachVorrang } from './vorrang';
import { melde } from '../ereignisse';
import { istEigeneWurzel } from './eigene';
import { animationenIn, animationsZiel, hrefAnimiert, istSvgBild, svgAdresse, svgSignatur, wirdBereit, zeichnetNichts, zeigtBaldFassung } from './svg-bild';

export interface KontextLeicht {
  readonly isValid: boolean;
  onInvalidated(rueckruf: () => void): unknown;
}

type Ergebnis =
  // videoEcht: Video, das Urteil beruht auf einer echten Pruefung: es wird unter den Wechsel-Grenzen gezeigt, danach laeuft die Nachpruefung.
  | { art: 'frei'; videoEcht?: true }
  | { art: 'verdeckt'; videoEcht?: true }
  // Video ohne Bilddaten (readyState unter 2 oder videoWidth 0): zurueck auf "wartet auf loadeddata", nicht endgueltig verdecken.
  | { art: 'warte' }
  // endgueltig: eine Wiederholung bringt nichts (Netzgrenze: fehler 'privat'), das Element wird sofort verdeckt.
  | { art: 'fehler'; endgueltig?: boolean }
  | { art: 'zensiert'; bild: string }
  | { art: 'zensiertHg'; wert: string }
  // Leinwand ist Spiegel eines Videos: kein eigenes Urteil, sie folgt dem Video (spiegel.ts).
  | { art: 'spiegel' };

interface QuelleMitMass {
  quelle: Quelle;
  breite: number;
  hoehe: number;
}
// Keine Anfrage, sondern gleich ein Fehler (SVG nicht lesbar oder zu gross, R2-1). endgueltig wie bei der Netzgrenze: nie wiederholen.
interface BauFehler {
  fehler: string;
  endgueltig?: boolean;
}
const FEHLER_NICHT_PRUEFBAR = 'nicht pruefbar';

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
  // Testhaken: kuenstliche Verzoegerung der Video-Antwort in ms (0 = keine), gesetzt ueber das Ereignis veil-test.
  let videoVerzoegerungMs = 0;
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
    const aktuell: Zustand[] = [];
    for (const el of verfolgt) {
      if (!el.isConnected) continue;
      const s = zustaende.get(el);
      if (s) aktuell.push(s);
    }
    return zaehleZustaende(aktuell);
  };
  const status = new Status(zaehle);

  // ---------- Laufende Nachpruefung von Videos ----------

  // Zeit der letzten Freigabe eines Videos (oder eines Spiegels ausserhalb eines Video-Wechsels) im Dokument, fuer die Bremse der Spiegel.
  let letzteVideoFreigabe = Number.NEGATIVE_INFINITY;

  const video = new VideoTakt(
    {
      aktiv: () => aktiv && lebt(),
      sichtbar: (el, z) => sichtbarJetzt(el, z),
      pruefe: (el) => pruefeVideoBild(el),
      beiStart: (art, zeit) => status.zaehleVideoStart(art, zeit),
      beiFrist: () => {
        status.videoFristen++;
        status.plane();
      },
      angezeigt: (el, z) => videoAngezeigt(el, z),
      beendet: (_el, z) => {
        // Der Lauf endete, bevor sein Erst-Urteil gezeigt wurde (Element entfernt): das Video muss beim Wiedereinhaengen neu bewertet werden.
        z.eingereiht = false;
        z.videoEcht = false;
      },
      verwirf: (el, z) => {
        vergiss(el, z, false);
        if (aktiv) bewerte(el, z);
      },
      wende: (el, z, urteil: VideoUrteil) => {
        if (z.urteil === null) {
          // Erst-Urteil: wie jedes Urteil (Zeit fuer sichtbarFreiMs, Zaehlung).
          if (urteil === 'frei') {
            letzteVideoFreigabe = performance.now();
            urteilFrei(el, z);
          } else urteilVerdeckt(el, z);
          return;
        }
        // Wechsel im Takt: urteilMs und data-veil-ms bleiben, wie sie waren.
        if (urteil === 'frei') letzteVideoFreigabe = performance.now();
        setzeUrteil(el, z, urteil, z.urteilMs);
        status.videoWechsel++;
        status.plane();
      },
    },
    {
      taktMs: VIDEO_TAKT_MS,
      budgetJeS: VIDEO_BUDGET_JE_S,
      freiNach: VIDEO_FREI_NACH,
      wechselMinMs: VIDEO_WECHSEL_MIN_MS,
      blitzSperreMs: BLITZ_SPERRE_MS,
    },
  );

  // Spiegel-Leinwaende (PHASE-3-BAUPLAN S1 bis S7): eine Leinwand direkt neben einem Video, die es ueberdeckt, wird nie selbst geprueft und
  // folgt dem Urteil ihres Videos (spiegel.ts). Die Wechsel im Takt gehen im selben Augenblick mit; Freigaben ausserhalb eines Video-Wechsels
  // (Neubindung, Wiederfinden) laufen ueber dieselbe Bremse wie Videos.
  const spiegel = new Spiegel(
    {
      zustand: (el) => zustaende.get(el),
      angezeigt: (el, z) => videoAngezeigt(el, z),
      setze: (c, z, urteil) => {
        // Antworten aelterer Pruefungen dieser Leinwand (Warteschlange) gelten nicht mehr.
        z.generation++;
        z.eingereiht = false;
        if (z.timer) clearTimeout(z.timer);
        z.timer = null;
        setzeUrteil(c, z, urteil, z.urteilMs ?? status.seitStart());
        nachUrteil();
      },
      vergiss: (c, z) => {
        vergissElement(c, z, false);
        nachUrteil();
      },
      bewerte: (c, z) => {
        if (aktiv) bewerte(c, z);
      },
      aktiv: () => aktiv && lebt(),
      jetzt: () => performance.now(),
      timer: (fn, ms) => {
        const t = setzeTimer(fn, ms);
        return () => {
          clearTimeout(t);
          timer.delete(t);
        };
      },
      letzteFreigabe: () => letzteVideoFreigabe,
      merkeFreigabe: (zeit) => {
        letzteVideoFreigabe = Math.max(letzteVideoFreigabe, zeit);
      },
      gebunden: (c, z) => {
        // Ein Spiegel wird nie selbst geprueft: Zeitgeber der eigenen Pruefung und Platz in der Warteschlange entfallen.
        if (z.timer) clearTimeout(z.timer);
        z.timer = null;
        wartend.delete(c);
      },
    },
    { minKante: MIN_KANTE, wechselMinMs: VIDEO_WECHSEL_MIN_MS, blitzSperreMs: BLITZ_SPERRE_MS, aufraeumMs: AUFRAEUM_VERZOEGERUNG_MS },
  );
  video.beiWechsel = (el) => spiegel.angleichen(el);
  video.beiErgebnis = (el) => spiegel.pruefeNachbarn(el);

  // Vorschau-Tausch und Erkennen am Inhalt (Auftrag E, vorschau.ts): die Steuerung bleibt hier, die Klasse bekommt ihre Zugriffe als Rueckrufe.
  // Live-Lauf 18 C: Werberahmen auf Erwachsenenseiten als Ganzes ausblenden (nur im Vorschau-Tausch, nie in der Pause).
  const anzeigenRahmen = new AnzeigenRahmen();
  const vorschau = new Vorschau({
    lebt,
    aktiv: () => aktiv && lebt(),
    bewerte: (el, z) => bewerte(el, z),
    zeitgeber: (fn, ms) => setzeTimer(fn, ms),
    hintergrundFertig: (el, z) => {
      z.eingereiht = false;
      setzeUrteil(el, z, 'zensiert', status.seitStart());
      nachUrteil();
    },
    neuBewerten: (el, z) => {
      if (!aktiv) return;
      wartend.delete(el);
      vergiss(el, z, true); // Original zurueck und data-veil weg: Hide-first verdeckt das Element im selben Zug
      bewerte(el, z);
      nachUrteil();
    },
  });

  // Bilder, bei denen nach dem Freilegen das erste load des Originals noch aussteht.
  const ersteLoadAus = new WeakSet<Element>();
  // Freilegen (Auftrag F, freilegen.ts): zensierte Flaechen mit Knopf und Quiz kurz aufdecken. Die Steuerung bleibt hier.
  const freilegen = new Freilegen({
    lebt,
    aktiv: () => aktiv && lebt(),
    zustand: (el) => zustaende.get(el),
    elemente: () => verfolgt,
    legeFrei: (el, z, bisMs) => {
      // Original zurueck und als frei zeigen; das Urteil `zensiert` bleibt im Zustand, Beobachter und Pruefung lassen das Element in Ruhe.
      if (el instanceof HTMLImageElement && z.pruefAdresse) ersteLoadAus.add(el);
      zeigeOriginal(el, z); // gemerkte Daten bleiben: das Ende setzt die zensierte Fassung direkt wieder ein
      z.freigelegt = { bisMs };
      el.setAttribute(ATTR_URTEIL, 'frei');
    },
    beendeOhneZensur: (_el, z) => {
      z.freigelegt = null; // lokale Pause: das Original bleibt, ab jetzt gilt wieder die normale Beobachtung
    },
    zensiereWieder: (el, z) => {
      // Hide-first: data-veil geht sofort weg (Element unsichtbar), dann kommt die gemerkte zensierte Fassung direkt wieder. Nur ohne gemerkte Fassung
      // wird neu geprueft.
      wartend.delete(el);
      z.freigelegt = null;
      el.removeAttribute(ATTR_URTEIL);
      if (!setzeZensurWieder(el, z)) {
        vergiss(el, z, false);
        if (aktiv) bewerte(el, z);
        return;
      }
      if (el instanceof HTMLImageElement) {
        z.tauschLaeuft = true; // das load-Ereignis des eigenen Bildes schliesst den Tausch (schliesseTausch)
        if (z.timer) clearTimeout(z.timer);
        z.timer = setzeTimer(() => {
          z.timer = null;
          if (!z.tauschLaeuft) return;
          stelleWiederHer(el, z);
          urteilVerdeckt(el, z);
        }, TAUSCH_MAX_MS);
      } else {
        setzeUrteil(el, z, 'zensiert', z.urteilMs);
        nachUrteil();
      }
    },
    zeitgeber: (fn, ms) => {
      const t = setzeTimer(fn, ms);
      return () => {
        clearTimeout(t);
        timer.delete(t);
      };
    },
  });

  // Eine echte Pruefung eines Bildes ist ausgegangen: fuer das Erkennen am Inhalt zaehlen. Die Zaehlung braucht den Adressbeobachter (Seitenwechsel).
  // Treffer fuers Erkennen am Inhalt: unbedeckte Brust, Genitalien oder Po in der Antwort, unabhaengig von Zonen, Stufe und Stil.
  function inhaltAusAntwort(a: AntwortPruefeOk): 'frei' | 'treffer' {
    return inhaltAusTreffern(a.treffer);
  }

  function zaehleInhalt(z: Zustand, urteil: 'frei' | 'treffer'): void {
    vorschau.zaehle(z, urteil);
    if (!istRahmen && vorschau.brauchtAdresse()) adressen.start();
  }

  // Wie anwenden.vergiss, beendet aber zuerst die Nachpruefung des Videos. Das Verbergen eines Videos mit Urteil zaehlt als Wechsel.
  function vergiss(el: Element, z: Zustand, restore: boolean): void {
    if (z.art === 'video' && el.getAttribute(ATTR_URTEIL) !== null) {
      // Massgeblich ist, was das Element zeigt: auch ein vorlaeufig verdecktes Video (Urteil im Zustand leer) wird hier verborgen.
      video.merkeWechsel(el as HTMLVideoElement);
      status.videoWechsel++;
    }
    video.beende(z);
    z.videoEcht = false;
    vergissElement(el, z, restore);
    // Spiegel (S3): wird das Video zurueckgesetzt, gehen seine Leinwaende mit zurueck; eine zurueckgesetzte Leinwand wird neu zugeordnet.
    if (z.art === 'video') spiegel.angleichen(el as HTMLVideoElement);
    else if (z.art === 'canvas') spiegel.loese(el as HTMLCanvasElement);
  }

  function videoAdresse(el: HTMLVideoElement): string {
    return el.currentSrc || el.src;
  }

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

  // Was ein Video gerade zeigt: das Attribut data-veil (frei, verdeckt), sonst verborgen. Mit gesperrter Freigabe (Testhaken) setzt der Schleier
  // nie ein Attribut, dann gilt das Urteil im Zustand.
  function videoAngezeigt(el: HTMLVideoElement, z: Zustand): VideoUrteil | null {
    if (TESTHAKEN && freigabeGesperrt()) return z.urteil === 'frei' || z.urteil === 'verdeckt' ? z.urteil : null;
    const a = el.getAttribute(ATTR_URTEIL);
    return a === 'frei' || a === 'verdeckt' ? a : null;
  }

  // Jedes Urteil eines Videos, das die Anzeige aendert, ist ein Wechsel: fuer die Bremse merken, fuer den Testhaken zaehlen. Steht das Attribut
  // schon so da (vorlaeufig verdeckt, dann echtes Urteil "verdeckt"), ist es kein Wechsel. Die Adresse des Urteils wird festgehalten.
  function zaehleVideoWechsel(el: HTMLVideoElement, z: Zustand, neu: VideoUrteil): void {
    z.adresse = videoAdresse(el) || z.adresse;
    if (videoAngezeigt(el, z) === neu) return;
    video.merkeWechsel(el);
    status.videoWechsel++;
  }

  function urteilFrei(el: Element, z: Zustand): void {
    z.eingereiht = false;
    if (z.art === 'bild') z.adresse = bildAdresse(el as HTMLImageElement);
    else if (z.art === 'video') zaehleVideoWechsel(el as HTMLVideoElement, z, 'frei');
    setzeUrteil(el, z, 'frei', status.seitStart());
    if (z.art === 'video') spiegel.beiVideoUrteil(el as HTMLVideoElement);
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
    if (z.art === 'video') zaehleVideoWechsel(el as HTMLVideoElement, z, 'verdeckt');
    setzeUrteil(el, z, 'verdeckt', status.seitStart());
    if (z.art === 'video') spiegel.beiVideoUrteil(el as HTMLVideoElement);
    nachUrteil();
  }

  function urteilFehler(el: Element, z: Zustand, endgueltig = false): void {
    z.eingereiht = false;
    status.fehler++;
    z.versuche++;
    if (endgueltig) z.versuche = 2;
    if (z.versuche < 2) {
      // Bleibt verdeckt (kein data-veil), nach 10 s ein zweiter Versuch.
      z.timer = planeNeuenVersuch(el, z, zweiterVersuchMs);
    } else {
      // Zweiter Versuch gescheitert: endgueltig verdeckt (blur).
      if (z.tauschLaeuft || z.bildOriginal || z.hgOriginal || z.svgOriginal) stelleWiederHer(el, z);
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
    if (z.ersetzt) return vorschau.scheitert(el, z); // eingesetzte Vorschau nicht ladbar: normaler Schleier statt Blur
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

  // Bild in Inline-SVG: die zensierte Fassung als href. Anders als beim img wird nicht auf das load des Elements gewartet: Chromium feuert es fuer
  // SVG-Bilder nicht, solange das Dokument noch laedt, und danach auch nicht nachtraeglich; Firefox meldete load bzw. decode() teils fuer die alte
  // Anfrage (gemessen Nacht 18, N1). Stattdessen: Fassung vorab laden und dekodieren, href setzen, dann an den Pixeln bestaetigen, dass das Element
  // die Fassung zeichnet (zeigtBaldFassung, svg-bild.ts). Erst dann faellt das Urteil; bis dahin bleibt es verborgen (tauschLaeuft haelt bewerte
  // fern). Laedt die Fassung nicht oder bestaetigt sie sich nicht binnen TAUSCH_MAX_MS: Original zurueck und verdeckt.
  function urteilZensiertSvg(el: Element, z: Zustand, bild: string): void {
    z.eingereiht = false;
    z.tauschLaeuft = true;
    const generation = z.generation;
    const gilt = () => lebt() && aktiv && z.generation === generation && z.tauschLaeuft;
    void (async () => {
      const fassung = await ladeFassung(bild);
      if (!gilt()) return;
      if (!fassung) {
        z.tauschLaeuft = false;
        return urteilVerdeckt(el, z);
      }
      starteSvgTausch(el, z, bild);
      const gezeigt = await zeigtBaldFassung(el as SVGImageElement, fassung, TAUSCH_MAX_MS);
      if (!gilt()) return;
      if (!gezeigt) {
        stelleWiederHer(el, z);
        return urteilVerdeckt(el, z);
      }
      z.tauschLaeuft = false;
      setzeUrteil(el, z, 'zensiert', status.seitStart());
      nachUrteil();
    })();
  }

  async function ladeFassung(url: string): Promise<HTMLImageElement | null> {
    const bild = await ladeBild(url);
    if (!bild) return null;
    try {
      await bild.decode();
    } catch {
      // geladen reicht
    }
    return bild;
  }

  // ---------- Entdecken und Bewerten ----------

  let eigeneEntdeckt = 0;
  function entdecke(el: Element, art: Art): void {
    if (abgebaut) return;
    // Session 16: Bilder in eigenen Wurzeln der Erweiterung (Galerie, Werbung, Riegel ...) nie pruefen; der Beobachter betritt sie schon nicht,
    // dies ist die zweite Sperre. Im Testbau zaehlt ein Attribut jeden Versuch (der Regressionstest erwartet 0 Versuche ab dem Beobachter).
    const wurzel = el.getRootNode();
    if (wurzel instanceof ShadowRoot && istEigeneWurzel(wurzel)) {
      if (TESTHAKEN) document.documentElement?.setAttribute('data-veil-eigene-entdeckt', String(++eigeneEntdeckt));
      return;
    }
    let z = zustaende.get(el);
    if (!z) {
      z = neuerZustand(art);
      zustaende.set(el, z);
      // Neues Element: Urteil-Attribute, die nicht von diesem Script stammen (Seite oder frueheres Script), gelten nicht. Sonst hielte ein
      // von der Seite gesetztes data-veil="frei" das Element ohne Pruefung sichtbar.
      el.removeAttribute(ATTR_URTEIL);
      el.removeAttribute(ATTR_NUR_HG);
      if (ATTR_MS) el.removeAttribute(ATTR_MS);
    }
    sichtBeobachter?.observe(el); // mehrfaches observe desselben Elements ist unschaedlich
    verfolgt.add(el);
    // Ein Video, das aus dem Dokument fiel und mit anderer Quelle zurueckkam (die Ereignisse kamen ausserhalb des Dokuments): neu bewerten.
    if (aktiv && z.art === 'video' && z.urteil !== null && z.adresse !== null) {
      const jetzt = videoAdresse(el as HTMLVideoElement);
      if (jetzt && jetzt !== z.adresse) vergiss(el, z, false);
    }
    // Ein Video mit echtem Urteil, das aus dem Dokument fiel und zurueckkam, laeuft wieder im Takt.
    if (aktiv && z.art === 'video' && z.videoEcht && !z.video && (z.urteil === 'frei' || z.urteil === 'verdeckt')) {
      video.registriere(el as HTMLVideoElement, z, z.urteil);
    }
    // Spiegel (S7): die Zuordnung wird auch beim Entdecken geprueft. Ein Video (auch ohne Urteil) ordnet die Leinwaende in seiner Naehe neu ein;
    // eine Leinwand mit Urteil oder Platz in der Schlange wird gegen ihr Video abgeglichen (weicht es ab: vergessen und neu bewertet). Ohne
    // Urteil und ohne Platz in der Schlange ordnet bewerteCanvas zu.
    if (aktiv && z.art === 'video') spiegel.beiVideoEntdeckt(el as HTMLVideoElement);
    else if (aktiv && z.art === 'canvas' && (z.urteil !== null || z.eingereiht)) spiegel.ordne(el as HTMLCanvasElement, z);
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
        if (vorschau.versteckeVideo(el, z)) return; // Hover-Vorschauvideo auf Erwachsenenseiten: nie zeigen
        return bewerteVideo(el as HTMLVideoElement, z);
      case 'canvas':
        return bewerteCanvas(el as HTMLCanvasElement, z);
      case 'svgbild':
        return bewerteSvgBild(el as SVGImageElement, z);
      default:
        return bewerteHintergrund(el, z);
    }
  }

  // Bild in Inline-SVG (svg-bild.ts): die Quelle steht im Attribut, geprueft wird sofort (Url-Weg oder Canvas-Weg wie beim Inline-Hintergrund),
  // ohne auf das load des Elements zu warten. Ohne Quelle zeigt es nichts.
  function bewerteSvgBild(el: SVGImageElement, z: Zustand): void {
    z.signatur = svgSignatur(el);
    // Quelle per SMIL animiert (svg-bild.ts): nie frei, sofort verdeckt.
    if (hrefAnimiert(el)) return urteilVerdeckt(el, z);
    const adresse = svgAdresse(el);
    if (!adresse) return urteilFrei(el, z);
    if (istKlein(el)) return urteilFrei(el, z);
    z.adresse = adresse;
    z.pruefAdresse = adresse;
    const treffer = speicher.hole(schluesselFuer(adresse));
    if (treffer) {
      if (!treffer.flaechen.length) return urteilFrei(el, z);
      if (treffer.bild) return urteilZensiertSvg(el, z, treffer.bild);
      return urteilVerdeckt(el, z);
    }
    reihe(el, z);
  }

  function bewerteBild(el: HTMLImageElement, z: Zustand): void {
    z.signatur = bildSignatur(el);
    if (vorschau.versuche(el, z)) return; // Erwachsenenseite: Vorschaubild gegen ein Pack-Bild tauschen, ohne Pruefung
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
    z.adresse = adresse; // auch im Cache-Pfad: die Zaehlung am Inhalt nutzt sie als Schluessel
    z.pruefAdresse = adresse;
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
    // Nur Ton und kleine Videos (unter 32 x 32) werden ohne Pruefung und ohne Bremse freigegeben: dort gibt es keinen vollflaechigen Wechsel.
    if (el.videoWidth === 0) return urteilFrei(el, z); // nur Ton
    if (istKlein(el)) return urteilFrei(el, z);
    reihe(el, z);
  }

  function planeVideoNachfrist(el: HTMLVideoElement, z: Zustand): void {
    if (z.timer) return;
    // Autoplay (oder schon laufendes Abspielen): die Daten kommen gleich, bis zu 5 s unsichtbar statt vorlaeufig unscharf (kein Flackern).
    const frist = el.autoplay || !el.paused ? VIDEO_NACHFRIST_AUTOPLAY_MS : VIDEO_NACHFRIST_MS;
    z.timer = setzeTimer(() => {
      z.timer = null;
      if (!aktiv || z.urteil || z.eingereiht || el.readyState >= 2) return;
      z.vorlaeufig = true;
      urteilVerdeckt(el, z);
    }, frist);
  }

  function bewerteCanvas(el: HTMLCanvasElement, z: Zustand): void {
    // Spiegel eines Videos: nie selbst pruefen, das Urteil folgt dem Video (auch eine Leinwand ohne Flaeche, auch vor dem load-Ereignis).
    if (spiegel.ordne(el, z)) {
      if (z.timer) clearTimeout(z.timer);
      z.timer = null;
      return;
    }
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
    if (vorschau.versuche(el, z)) return; // Erwachsenenseite: Vorschaubild gegen ein Pack-Bild tauschen, ohne Pruefung
    // Live-Lauf 18 C (MITTEL 3 und 4): Stylesheet-Hintergrund in einer Anzeige auf einer Erwachsenenseite (xHamster-Promoband, Cam-Kachel) wird
    // ohne Pruefung ganz ausgeblendet (nur der Hintergrund, der Text bleibt), Entscheidung 193.
    if (z.art === 'klasse' && vorschau.tauscht && istAnzeige(el, location.href)) return urteilVerdeckt(el, z);
    const ebenen = zerlegeEbenen(wert).filter((e) => pruefbareAdresse(e));
    if (!ebenen.length) return urteilFrei(el, z);
    if (istKlein(el)) return urteilFrei(el, z);
    reihe(el, z);
  }

  // ---------- Warteschlange ----------

  function reihe(el: Element, z: Zustand): void {
    if (!aktiv || z.eingereiht || z.urteil) return;
    z.eingereiht = true;
    // Video: die Adresse schon jetzt festhalten, damit ein Quellenwechsel (loadstart) in der Warteschlange erkannt wird.
    if (z.art === 'video') z.adresse = videoAdresse(el as HTMLVideoElement) || z.adresse;
    // Groesse, Sichtbarkeit und Naehe nur beim Einreihen messen (ein Layout-Zugriff); danach fuehren die IntersectionObserver sie nach
    // (kein Layout je Auswahl). Vor der ersten Meldung eines Beobachters gilt die Messung.
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) z.klein = istKleinDargestellt(r, VORRANG_KLEIN_PX);
    if (!z.sichtMeldung) z.sichtbar = liegtImBereich(r, innerHeight, innerWidth, 0);
    if (!z.nahMeldung) z.nah = liegtImBereich(r, innerHeight, innerWidth, nahFaktor);
    wartend.add(el);
    starteNaechste();
  }

  // Vorrang in der Warteschlange (vorrang.ts): ein Durchlauf, keine Sortierung. Stufen: sichtbar gross, sichtbar klein, nah gross,
  // nah klein, Rest; innerhalb der Stufe in Einreihungsfolge. Nichts wird ausgelassen: Stufe 5 kommt dran, sobald die vorderen leer sind.
  function waehleNaechstes(): Element | null {
    return waehleNachVorrang(wartend, (el) => {
      const z = zustaende.get(el);
      if (!z) {
        wartend.delete(el);
        return 0;
      }
      if (!el.isConnected) {
        // Aus dem Dokument gefallen: nicht mehr pruefen. Kommt es zurueck, meldet der Beobachter es erneut.
        wartend.delete(el);
        z.eingereiht = false;
        return 0;
      }
      return vorrangStufe(z.sichtbar, z.nah, z.klein);
    });
  }

  // Zwei Bildschirmhoehen ueber und unter dem Sichtbereich (derselbe Wert bildet VORRANG_NAH_RAND).
  const nahFaktor = VORRANG_NAH_FAKTOR;
  // Testhaken (nur Testbau, per veil-test): Halt sperrt den Start jeder Pruefung (die Warteschlange fuellt sich), die Verzoegerung haelt
  // einen Platz der Parallelitaet vor jeder Pruefung fest (kuenstlich langsamer Erkenner).
  let warteschlangeHalt = false;
  let pruefVerzoegerungMs = 0;

  function starteNaechste(): void {
    if (TESTHAKEN && warteschlangeHalt) return;
    while (aktiv && lebt() && laufend < PARALLEL && wartend.size) {
      const el = waehleNaechstes();
      if (!el) break;
      wartend.delete(el);
      laufend++;
      const lauf =
        TESTHAKEN && pruefVerzoegerungMs > 0
          ? new Promise<void>((fertig) => setTimeout(fertig, pruefVerzoegerungMs)).then(() => verarbeite(el))
          : verarbeite(el);
      void lauf.finally(() => {
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
          ergebnis = await pruefeVideo(el as HTMLVideoElement, z);
          break;
        case 'canvas':
          ergebnis = await pruefeCanvas(el as HTMLCanvasElement, z);
          break;
        case 'svgbild':
          ergebnis = await pruefeSvgBild(el as SVGImageElement, z);
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
    // Spiegel (S7): ein Ergebnis aus der Warteschlange wird vor dem Anwenden gegen den aktuellen Stand abgeglichen. Ist die Leinwand inzwischen
    // Spiegel eines Videos, gilt nur dessen Urteil (kein veraltetes "frei" aus der Zeit vor der Zuordnung); ohne Urteil des Videos bleibt sie verborgen.
    if (z.art === 'canvas' && (e.art === 'spiegel' || spiegel.ordne(el as HTMLCanvasElement, z))) {
      z.eingereiht = false;
      return;
    }
    // Erkennen am Inhalt: nur echte Pruefungen mit Antwort des Erkenners (z.inhalt), nie Ausfaelle, Videos oder verdeckte Bilder ohne Treffer.
    if (z.inhalt && zaehltFuerInhalt(z.art, e.art)) zaehleInhalt(z, z.inhalt);
    z.inhalt = null;
    switch (e.art) {
      case 'spiegel':
        return;
      case 'frei':
        if (e.videoEcht) return starteVideoTakt(el, z, 'frei');
        return urteilFrei(el, z);
      case 'verdeckt':
        if (e.videoEcht) return starteVideoTakt(el, z, 'verdeckt');
        return urteilVerdeckt(el, z);
      case 'warte':
        // Keine Bilddaten (mehr): das Video wartet auf loadeddata (oder die Nachfrist), siehe bewerteVideo.
        z.eingereiht = false;
        return bewerteVideo(el as HTMLVideoElement, z);
      case 'fehler':
        return urteilFehler(el, z, e.endgueltig === true);
      case 'zensiert':
        if (z.art === 'svgbild') return urteilZensiertSvg(el, z, e.bild);
        return urteilZensiertBild(el as HTMLImageElement, z, e.bild);
      case 'zensiertHg':
        return urteilZensiertHg(el as HTMLElement, z, e.wert);
    }
  }

  // Erst-Urteil eines Videos aus einer echten Pruefung: der Takt zeigt es (Verdecken sofort, Freigeben gebremst) und prueft danach laufend.
  function starteVideoTakt(el: Element, z: Zustand, urteil: VideoUrteil): void {
    z.videoEcht = true;
    video.registriere(el as HTMLVideoElement, z, urteil);
  }

  // Antwort aus dem Zwischenspeicher oder frisch: entscheidet ueber das Urteil eines img.
  function wendeAntwortAn(el: HTMLImageElement, z: Zustand, a: AntwortPruefeOk): void {
    zaehleInhalt(z, inhaltAusAntwort(a));
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

  async function frageNach(
    adresse: string,
    bau: () => Promise<QuelleMitMass | BauFehler | null> | QuelleMitMass | BauFehler | null,
  ): Promise<AntwortPruefe | null> {
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
      if ('fehler' in q) return { ok: false, id: '', fehler: q.endgueltig ? FEHLER_NICHT_PRUEFBAR : q.fehler } as AntwortPruefe;
      if (!(await wecke(lebt))) return { ok: false, id: '', fehler: 'Erkenner nicht erreichbar' } as AntwortPruefe;
      return sendePruefe(q.quelle, q.breite, q.hoehe, e, true, packStandFuer(e));
    });
    // Nur ablegen, wenn sich die pruefrelevanten Einstellungen inzwischen nicht geaendert haben.
    if (antwort?.ok && dieseEpoche === epoche) speicher.lege(schluessel, antwort);
    return antwort;
  }

  // Netzgrenze: 'privat' ist endgueltig (die Seite darf das Ziel nie bekommen), jede Wiederholung wuerde dasselbe antworten.
  function fehlerErgebnis(a: AntwortPruefe): Ergebnis {
    return !a.ok && (a.fehler === 'privat' || a.fehler === FEHLER_NICHT_PRUEFBAR) ? { art: 'fehler', endgueltig: true } : { art: 'fehler' };
  }

  // Vorpruefung der Ausgangsadresse (Netzgrenze im Content-Script, spart den Weg zum Erkenner). Die Endadresse nach Weiterleitungen
  // prueft allein der Erkenner (ladeNach).
  // Hintergrund: Firefox laesst Content-Scripts mit Host-Rechten die Pixel fremder Bilder lesen (kein verschmutztes
  // Canvas), der Erkenner liefe dann gar nicht ins Nachladen. Ein fremdes Bild in einem privaten Bereich darf eine oeffentliche oder
  // undurchsichtige Seite (Herkunft "null") nicht ueber die Erweiterung lesbar machen: endgueltig verdeckt, ohne Pixel zu lesen.
  function netzgrenzeSperrt(url: string): boolean {
    if (!/^https?:/i.test(url)) return false;
    try {
      if (new URL(url).origin === window.origin) return false; // eigener Ursprung: die Seite kann es ohnehin lesen
    } catch {
      return false;
    }
    return entscheideNachladen(url, refererDerSeite()) === 'privat';
  }

  // SVG auf dem Canvas-Weg (Lesung 17 R2-1): Bytes statt Pixel, damit der Erkenner die Bewegungspruefung macht. 'kein' = kein SVG.
  // Nicht lesbare Bytes: http(s) geht den Url-Weg (der Erkenner laedt und prueft selbst). Eine blob:-Adresse, die die Seite nach dem Laden
  // widerrufen hat (verbreitetes Muster: revokeObjectURL im onload), ist nicht mehr abrufbar: dann wie bisher die Pixel (Pruefung Runde 3, N1).
  // Restrisiko: ein bewegtes SVG hinter einer widerrufenen blob:-Adresse wird als Momentaufnahme geprueft (Stand vor 0.9.0).
  async function svgWeg(adresse: string, breite: number, hoehe: number): Promise<QuelleMitMass | BauFehler | 'kein'> {
    const svg = await svgQuelle(adresse);
    if (svg === 'kein') return 'kein';
    if (svg === 'zuGross') return { fehler: 'SVG zu gross', endgueltig: true };
    if (svg === 'unklar') {
      if (/^https?:/i.test(adresse)) return { quelle: { art: 'url', url: adresse, referer: refererDerSeite() }, breite, hoehe };
      return 'kein';
    }
    return { quelle: { art: 'daten', dataUrl: svg.dataUrl }, breite, hoehe };
  }

  async function pruefeBild(el: HTMLImageElement, z: Zustand): Promise<Ergebnis> {
    const adresse = bildAdresse(el);
    z.adresse = adresse;
    z.pruefAdresse = adresse;
    z.inhalt = null;
    if (netzgrenzeSperrt(adresse)) return { art: 'fehler', endgueltig: true };
    const antwort = await frageNach(adresse, async () => {
      const m = bildMass(el);
      const lesbar = pixelLesenErlaubt(adresse);
      // data: und blob: vor dem Canvas: ein SVG, das das Canvas verschmutzt (foreignObject), gaebe sonst gar kein Urteil.
      if (lesbar && /^(data|blob):/i.test(adresse)) {
        const svg = await svgWeg(adresse, m.breite, m.hoehe);
        if (svg !== 'kein') return svg;
      }
      const px = lesbar ? lesePixel(el, m.breite, m.hoehe) : null;
      if (px) {
        // http(s) lesbar (gleicher Ursprung, CORS; nur Chrome): erst nachsehen, ob es ein SVG ist.
        if (/^https?:/i.test(adresse)) {
          const svg = await svgWeg(adresse, m.breite, m.hoehe);
          if (svg !== 'kein') return svg;
        }
        return { quelle: { art: 'daten', dataUrl: px.dataUrl }, breite: m.breite, hoehe: m.hoehe };
      }
      // Ohne Eigengroesse und nicht lesbar: kaputtes Bild oder fremdes SVG, es gibt nichts zu pruefen.
      if (!(el.naturalWidth > 0)) return null;
      // Nicht lesbar (Chrome ohne CORS) oder in Firefox nicht erlaubt: der Erkenner laedt selbst. data: und blob: gibt es nur ueber den Canvas-Weg.
      if (/^https?:/i.test(adresse)) return { quelle: { art: 'url', url: adresse, referer: refererDerSeite() }, breite: m.breite, hoehe: m.hoehe };
      return null;
    });
    if (!antwort) return { art: 'frei' };
    if (!antwort.ok) return fehlerErgebnis(antwort);
    z.inhalt = inhaltAusAntwort(antwort);
    if (!antwort.flaechen.length) return { art: 'frei' };
    return antwort.bild ? { art: 'zensiert', bild: antwort.bild } : { art: 'verdeckt' };
  }

  // Ein Einzelbild des Videos lesen und vom Erkenner pruefen lassen (erste und laufende Pruefung, Bild hoechstens 640 px).
  // Firefox: nur data:- und blob:-Videos werden gelesen; http(s)-Quellen, srcObject (MediaStream) und leere Adresse sind 'unlesbar'.
  async function pruefeVideoBild(el: HTMLVideoElement): Promise<VideoErgebnis | 'unlesbar'> {
    const e = einstellungen;
    const px = !el.srcObject && pixelLesenErlaubt(videoAdresse(el)) ? lesePixel(el, el.videoWidth, el.videoHeight, VIDEO_LAENGSTE_SEITE) : null;
    if (!px || !e) return 'unlesbar';
    // Testhaken: kuenstlich verzoegerte Antwort (haengender Erkenner), nur im Testbau, per veil-test gesetzt.
    if (TESTHAKEN && videoVerzoegerungMs > 0) await new Promise<void>((fertig) => setTimeout(fertig, videoVerzoegerungMs));
    if (!(await wecke(lebt))) return 'fehler';
    const a = await sendePruefe({ art: 'daten', dataUrl: px.dataUrl }, px.breite, px.hoehe, e, false, packStandFuer(e));
    if (!a.ok) return 'fehler';
    return a.flaechen.length ? 'treffer' : 'sauber';
  }

  async function pruefeVideo(el: HTMLVideoElement, z: Zustand): Promise<Ergebnis> {
    // Nicht lesbar: verdeckt ohne Takt (Entscheidung 21, 80). Echte Pruefung: das Urteil startet die laufende Nachpruefung.
    z.adresse = videoAdresse(el) || z.adresse;
    const generation = z.generation;
    const sprungVorher = z.sprung;
    // Die erste Pruefung zaehlt im Budget mit, wartet aber nicht darauf; laeuft noch eine Pruefung desselben Videos, wartet sie deren Ende ab
    // (hoechstens 2 Taktzeiten). Danach muss sie noch gelten (Schleier an, Generation gleich) und das Video Bilddaten haben, sonst gibt es keine
    // Anfrage und kein Budget und das Video wartet auf loadeddata (nicht endgueltig verdeckt).
    const r = await video.pruefung(
      el,
      () => lebt() && aktiv && z.generation === generation && el.readyState >= 2 && el.videoWidth > 0,
      () => pruefeVideoBild(el),
    );
    if (r === 'kein') return { art: 'warte' };
    if (r === 'unlesbar') return { art: 'verdeckt' };
    if (r === 'fehler') return { art: 'fehler' };
    // Ein Sprung waehrend der Pruefung: das geprueft Bild kann veraltet sein. Ein Treffer gilt, ein "sauber" wird verworfen und das Video
    // (es bleibt verborgen) neu geprueft.
    if (r === 'sauber' && z.sprung !== sprungVorher) return { art: 'warte' };
    return r === 'treffer' ? { art: 'verdeckt', videoEcht: true } : { art: 'frei', videoEcht: true };
  }

  async function pruefeCanvas(el: HTMLCanvasElement, z: Zustand): Promise<Ergebnis> {
    // Ein Spiegel wird nie gelesen (S4). Erst nach dem Einreihen als Spiegel erkannt: er nimmt das Urteil des Videos, ohne Urteil bleibt er
    // verborgen (der naechste Urteilswechsel des Videos gleicht ihn an).
    if (spiegel.ordne(el, z)) return { art: 'spiegel' };
    // Canvas ohne Lesezugriff sind meist Spiele und Diagramme: freigeben [Likely]. Nicht so eine Leinwand, die einmal Spiegel war (S7): ein
    // unlesbarer oder leerer Zugriff (WebGL) gibt sie nie frei, sie bleibt verdeckt, bis sie neu gebunden ist.
    const px = lesePixel(el, el.width, el.height);
    if (spiegel.warSpiegel(el) && (!px || leinwandLeer(el))) return { art: 'verdeckt' };
    if (!px || !einstellungen) return { art: 'frei' };
    if (!(await wecke(lebt))) return { art: 'fehler' };
    const a = await sendePruefe({ art: 'daten', dataUrl: px.dataUrl }, el.width, el.height, einstellungen, false, packStandFuer(einstellungen));
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
      return new URL(url).origin === window.origin;
    } catch {
      return false;
    }
  }

  async function hintergrundQuelleBauen(url: string): Promise<QuelleMitMass | BauFehler | null> {
    // Firefox liest nur data: und blob: selbst (hier gibt es kein crossOrigin); sonst geht es den Url-Weg.
    if (gleicherUrsprung(url) && pixelLesenErlaubt(url)) {
      // SVG: Bytes statt Pixel (R2-1), wie bei pruefeBild.
      const svg = await svgWeg(url, 0, 0);
      if (svg !== 'kein') return svg;
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
    z.inhalt = null;
    const wert = hintergrundQuelle(el, z);
    const neu: string[] = [];
    let geaendert = false;
    let verdeckt = false;
    let fehler = false;
    let endgueltig = false;
    let inhalt: 'frei' | 'treffer' | null = null;
    for (const ebene of zerlegeEbenen(wert)) {
      const url = pruefbareAdresse(ebene);
      if (!url) {
        neu.push(ebene);
        continue;
      }
      if (netzgrenzeSperrt(url)) {
        fehler = true;
        endgueltig = true;
        continue;
      }
      const a = await frageNach(url, () => hintergrundQuelleBauen(url));
      if (a?.ok) inhalt = inhalt === 'treffer' ? 'treffer' : inhaltAusAntwort(a);
      if (!a) neu.push(ebene);
      else if (!a.ok) {
        fehler = true;
        if (a.fehler === 'privat' || a.fehler === FEHLER_NICHT_PRUEFBAR) endgueltig = true;
      }
      else if (!a.flaechen.length) neu.push(ebene);
      else if (a.bild) {
        // Zensiertes Bild vorladen, damit beim Setzen kein leerer Hintergrund aufblitzt.
        await ladeBild(a.bild);
        neu.push(`url("${a.bild}")`);
        geaendert = true;
      } else verdeckt = true;
    }
    if (fehler) return endgueltig ? { art: 'fehler', endgueltig: true } : { art: 'fehler' };
    z.inhalt = inhalt;
    if (verdeckt) return { art: 'verdeckt' };
    return geaendert ? { art: 'zensiertHg', wert: neu.join(', ') } : { art: 'frei' };
  }

  // Bild in Inline-SVG: wie eine Hintergrund-Ebene (gleicher Ursprung, data: und blob: ueber das Canvas, sonst der Url-Weg). Eine blob:-Adresse,
  // die die Seite widerrufen hat, ist nicht mehr abrufbar: dann die Pixel des Elements selbst. Ist gar nichts lesbar, wird es nie blind frei
  // (verdeckt). Andere Schemata (file:, about: ...) prueft der Erkenner nicht: verdeckt.
  async function pruefeSvgBild(el: SVGImageElement, z: Zustand): Promise<Ergebnis> {
    const adresse = svgAdresse(el);
    z.adresse = adresse;
    z.pruefAdresse = adresse;
    z.inhalt = null;
    if (!adresse) return { art: 'frei' };
    // Inzwischen animiert (zum Beispiel vor einem zweiten Versuch eingefuegt): nie frei.
    if (hrefAnimiert(el)) return { art: 'verdeckt' };
    if (!/^(https?|data|blob):/i.test(adresse)) return { art: 'fehler', endgueltig: true };
    if (netzgrenzeSperrt(adresse)) return { art: 'fehler', endgueltig: true };
    const antwort = await frageNach(adresse, async () => (await hintergrundQuelleBauen(adresse)) ?? (await svgElementLesen(el, adresse)));
    if (!antwort) return { art: 'fehler' };
    if (!antwort.ok) return fehlerErgebnis(antwort);
    if (!antwort.flaechen.length) return { art: 'frei' };
    return antwort.bild ? { art: 'zensiert', bild: antwort.bild } : { art: 'verdeckt' };
  }

  // Pixel des Elements selbst (data:, blob: nicht mehr abrufbar, etwa sofort widerrufen): erst wenn das Element bereit ist, und nie aus einem
  // Element, das nichts zeichnet (sonst wuerde eine leere Leinwand als harmlos frei). Nicht lesbar ist hier endgueltig (eine widerrufene Adresse
  // wird nie wieder abrufbar): sofort verdeckt, ohne zweiten Versuch.
  async function svgElementLesen(el: SVGImageElement, adresse: string): Promise<QuelleMitMass | BauFehler> {
    const nichtLesbar: BauFehler = { fehler: 'SVG-Bild nicht lesbar', endgueltig: true };
    if (!pixelLesenErlaubt(adresse)) return nichtLesbar;
    if (!(await wirdBereit(el, TAUSCH_MAX_MS))) return nichtLesbar;
    if (zeichnetNichts(el)) return nichtLesbar;
    const r = el.getBoundingClientRect();
    const px = lesePixel(el, Math.round(r.width), Math.round(r.height));
    return px ? { quelle: { art: 'daten', dataUrl: px.dataUrl }, breite: px.breite, hoehe: px.hoehe } : nichtLesbar;
  }

  // ---------- Startphase und Strict ----------

  // Zwei Beobachter (vorrang.ts): der erste meldet den Sichtbereich, der zweite den Bereich zwei Bildschirmhoehen darum (Vorrang "nah").
  // Die Eintraege bringen das Rechteck mit: die dargestellte Groesse (klein) wird ohne Layout-Zugriff nachgefuehrt.
  let sichtBeobachter: SichtBeobachter | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    const merkeGroesse = (z: Zustand, e: IntersectionObserverEntry) => {
      const r = e.boundingClientRect;
      if (r.width > 0 && r.height > 0) z.klein = istKleinDargestellt(r, VORRANG_KLEIN_PX);
    };
    sichtBeobachter = new SichtBeobachter(
      (eintraege) => {
        for (const e of eintraege) {
          const z = zustaende.get(e.target);
          if (!z) continue;
          z.sichtMeldung = true;
          z.sichtbar = e.isIntersecting;
          merkeGroesse(z, e);
          if (e.isIntersecting && !startphaseVorbei) z.sichtbarBeiStart = true;
          if (z.video) video.sichtGeaendert(z.video);
        }
      },
      (eintraege) => {
        for (const e of eintraege) {
          const z = zustaende.get(e.target);
          if (!z) continue;
          z.nahMeldung = true;
          z.nah = e.isIntersecting;
          merkeGroesse(z, e);
        }
      },
      VORRANG_NAH_RAND,
    );
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
    // Bild in Inline-SVG: die Quelle steht im Attribut, geprueft und getauscht wird ohne load (urteilZensiertSvg).
    if (z.art === 'svgbild') return;
    if (!aktiv) return;
    // Freigelegt: das erste load nach dem Zurueckstellen des Originals gehoert zum geprueften Original, wenn die Adresse dieselbe ist.
    // Eine andere Adresse (entfernte source, media oder sizes gewechselt) ist ein anderes Bild: neu pruefen.
    if (z.freigelegt && e.type === 'load' && ersteLoadAus.has(el)) {
      ersteLoadAus.delete(el);
      if (el instanceof HTMLImageElement && bildAdresse(el) === z.pruefAdresse) {
        z.adresse = z.pruefAdresse;
        return;
      }
      neuePruefung(el, z, false);
      return;
    }
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
    } else if (z.art === 'video' && (e.type === 'seeking' || e.type === 'seeked')) {
      // Spruenge zaehlen schon vor dem ersten Urteil: eine Pruefung, die ueber einen Sprung hinweg lief, zeigt ein altes Bild (pruefeVideo).
      // Der Umlauf bei loop ist kein Sprung (die Nachpruefung laeuft ohnehin im Takt weiter).
      if (e.type === 'seeking') z.schleife = istSchleifenUmlauf(el as HTMLVideoElement);
      if (!z.schleife) z.sprung++;
      // Ein Video, das wegen eines Sprungs ohne Bilddaten wartete (kein neues loadeddata), wird nach dem Sprung neu bewertet.
      if (e.type === 'seeked' && (el as HTMLVideoElement).readyState >= 2 && (z.vorlaeufig || (!z.urteil && !z.eingereiht))) bilddatenDa(el, z);
    } else if (z.art === 'video' && (e.type === 'loadstart' || e.type === 'emptied')) {
      // Quellenwechsel (Playlist, Feed mit wiederverwendetem Element): Urteil verwerfen, wieder verdecken, wie ein neues Video pruefen.
      const adresse = videoAdresse(el as HTMLVideoElement);
      if (z.adresse !== null && adresse !== z.adresse && e.type === 'loadstart') {
        vergiss(el, z, false);
        bewerte(el, z);
      }
    } else if (z.art === 'video' && e.type === 'loadeddata') {
      bilddatenDa(el, z);
    }
  }

  function bilddatenDa(el: Element, z: Zustand): void {
    if (z.vorlaeufig) {
      // Vorlaeufig unscharf gezeigt (keine Daten bis jetzt): richtig pruefen. Das Attribut bleibt bis zum neuen Urteil stehen.
      z.vorlaeufig = false;
      z.urteil = null;
    }
    bewerte(el, z);
  }

  // SMIL-Animation auf href eines bekannten SVG-Bildes (svg-bild.ts): das Bild neu bewerten, dann wird es verdeckt.
  function pruefeAnimationsZiel(a: Element): void {
    if (!aktiv) return;
    const ziel = animationsZiel(a);
    const z = ziel && istSvgBild(ziel) ? zustaende.get(ziel) : undefined;
    if (ziel && z && z.urteil !== 'verdeckt') neuePruefung(ziel, z, false);
  }

  // Beginn oder Wiederholung einer Animation: faengt auch, was kein beobachtetes Attribut verraet (xlink:href an der Animation, beginElement()).
  function beiAnimation(e: Event): void {
    if (abgebaut || !aktiv) return;
    if (e.target instanceof Element) pruefeAnimationsZiel(e.target);
  }

  const MEDIEN_EREIGNISSE = ['load', 'error', 'loadeddata', 'loadstart', 'emptied', 'seeking', 'seeked'] as const;
  const ANIMATIONS_EREIGNISSE = ['beginEvent', 'repeatEvent'] as const;
  function hoereAb(ziel: Document | ShadowRoot): void {
    for (const name of MEDIEN_EREIGNISSE) ziel.addEventListener(name, beiMedienEreignis, true);
    for (const name of ANIMATIONS_EREIGNISSE) ziel.addEventListener(name, beiAnimation, true);
  }
  function hoereAuf(ziel: Document | ShadowRoot): void {
    for (const name of MEDIEN_EREIGNISSE) ziel.removeEventListener(name, beiMedienEreignis, true);
    for (const name of ANIMATIONS_EREIGNISSE) ziel.removeEventListener(name, beiAnimation, true);
  }

  // Die Seite hat die Quelle geaendert: neu beurteilen. Das Element wird sofort wieder verdeckt (data-veil weg).
  function neuePruefung(el: Element, z: Zustand, wartetAufLoad: boolean): void {
    wartend.delete(el);
    z.ohneVorschau = false; // neue Quelle: der Tausch darf es wieder versuchen
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
    entfernt: () => {
      video.raeumeEntfernteAuf();
      planeAufraeumen();
    },
    istAus: () => aus,
    hinzugefuegt: (knoten) => {
      if (knoten === document.documentElement) wendeWurzelAttributeAn();
      // Eine nachtraeglich eingefuegte source im picture wuerde das getauschte Bild uebersteuern: wie eine Aenderung der Quelle behandeln.
      if (aktiv && knoten.localName === 'source' && knoten.parentElement?.tagName === 'PICTURE') {
        const img = knoten.parentElement.querySelector(':scope > img');
        const zi = img ? zustaende.get(img) : undefined;
        if (img instanceof HTMLImageElement && zi && bildSignatur(img) !== zi.signatur) neuePruefung(img, zi, true);
      }
      if (aktiv && geladen) klassen.planeKnoten(knoten);
      // Eine spaeter eingefuegte SMIL-Animation auf href eines schon bekannten SVG-Bildes (beurteilt, wartend oder vor dem zweiten Versuch): neu
      // bewerten (dann verdeckt).
      if (aktiv) for (const a of animationenIn(knoten)) pruefeAnimationsZiel(a);
    },
    geaendert: (el, attribut) => {
      if (!aktiv) return;
      if (attribut === 'class') {
        if (geladen) klassen.planeElement(el);
        return;
      }
      // SMIL: eine Animation wird umgelenkt (href) oder bekommt einen anderen Attributnamen; ein SVG-Bild bekommt die id, auf die eine Animation zielt.
      if (attribut === 'attributeName' || (attribut === 'href' && !istSvgBild(el))) return pruefeAnimationsZiel(el);
      if (attribut === 'id') {
        const z = istSvgBild(el) ? zustaende.get(el) : undefined;
        if (z && z.urteil !== 'verdeckt' && hrefAnimiert(el as SVGImageElement)) neuePruefung(el, z, false);
        return;
      }
      // Bild in Inline-SVG: href oder xlink:href (eigener Beobachter je Element, beobachter.ts). Eigene Aenderungen (Tausch) haben dieselbe Signatur.
      if (attribut === 'href') {
        if (!istSvgBild(el)) return;
        const z = zustaende.get(el);
        if (!z) {
          entdecke(el, 'svgbild');
          return;
        }
        if (svgSignatur(el) === z.signatur) return;
        neuePruefung(el, z, false);
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
      if (z.ersetzt && vorschau.ersetzeSofort(ziel, z)) return; // Vorschau-Rotation: gleiches Pack-Bild sofort wieder einsetzen
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
      // Kommt das Element zurueck, meldet der Beobachter neu: bis dahin gilt wieder die Messung beim Einreihen.
      const zg = zustaende.get(el);
      if (zg) zg.sichtMeldung = zg.nahMeldung = false;
    }
    for (const ref of wurzelnMitHoerer) if (!ref.deref()) wurzelnMitHoerer.delete(ref);
    raeumeWurzelStileAuf();
    // Spiegel (S7): erst jetzt, nach der Verzoegerung, loest sich die Bindung einer Leinwand an ein entferntes Video. Ist ein Video noch zu jung
    // getrennt, folgt ein weiterer Durchlauf.
    if (spiegel.raeumeAuf() > 0) planeAufraeumen();
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

  // Fragt den Hintergrund nach der Adresse des Tabs (nur eingebettete Frames). undefined = keine verwertbare Antwort (alter Stand bleibt).
  async function frageTabAdresse(): Promise<URL | null | undefined> {
    if (!istRahmen) return undefined;
    try {
      const nachricht: NachrichtHintergrundTab = { ziel: 'hintergrund', typ: 'tab' };
      const antwort = (await browser.runtime.sendMessage(nachricht)) as Partial<AntwortTab> | undefined;
      if (antwort && antwort.ok === true) return typeof antwort.url === 'string' ? new URL(antwort.url) : null;
    } catch {
      // keine oder fehlerhafte Antwort: es zaehlt nur die eigene Adresse
    }
    return undefined;
  }

  // Liest die Tab-Adresse neu; hat sie sich geaendert, gelten die Ausnahmen neu (sie greifen oder enden).
  async function aktualisiereTabAdresse(): Promise<void> {
    const neu = await frageTabAdresse();
    if (neu === undefined || abgebaut) return;
    uebernimmTabAdresse(neu);
  }

  // ---------- Adresswechsel (Einzelseiten-Apps): nur bei vorhandenen eigenen Ausnahmen ----------

  // Nur die oberste Seite beobachtet ihre Adresse. Wechselt sie (pushState, popstate, hashchange), gelten die Ausnahmen neu (ein
  // Pfadmuster kann jetzt passen oder nicht mehr) und der Hintergrund bekommt die neue Adresse; er reicht sie an die Frames des Tabs weiter.
  const adressen = new AdressBeobachter(
    () => location.href,
    () => {
      if (!lebt()) return;
      vorschau.beiAdresswechsel(); // Erkennen am Inhalt beginnt auf der neuen Seite neu
      if (einstellungen) wendeEinstellungenAn(einstellungen);
      // Nur melden, wenn es Rahmen gibt, die es betrifft (kein Rahmen: nichts weiterzureichen).
      if (window.frames.length === 0) return;
      const nachricht: NachrichtHintergrundAdresse = { ziel: 'hintergrund', typ: 'adresse', url: location.href };
      browser.runtime.sendMessage(nachricht).catch(() => {});
    },
  );

  // Eingebettete Frames hoeren auf inhalt/tab des Hintergrunds. Sie fragen hintergrund/tab nur beim Start (wenn es Ausnahmen gibt),
  // beim Entstehen der ersten Ausnahme und beim Sichtbarwerden des Tabs, nie im Takt.
  function beiInhaltNachricht(nachricht: unknown): undefined {
    if (!istRahmen || !lebt() || !istFuer(nachricht, 'inhalt')) return undefined;
    const n = nachricht as NachrichtInhalt;
    if (n.typ !== 'tab' || typeof n.url !== 'string') return undefined;
    try {
      uebernimmTabAdresse(new URL(n.url));
    } catch {
      // ungueltige Adresse: ignorieren
    }
    return undefined;
  }

  function uebernimmTabAdresse(neu: URL | null): void {
    if ((neu?.href ?? null) === (tabAdresse?.href ?? null)) return;
    tabAdresse = neu;
    if (einstellungen) wendeEinstellungenAn(einstellungen);
  }

  function beiSichtbarkeit(): void {
    if (!document.hidden && istRahmen && lebt() && einstellungen?.ausnahmen.length) void aktualisiereTabAdresse();
  }

  let inhaltHoererAn = false;
  // Hat dieser Frame die Tab-Adresse in der laufenden Ausnahmen-Phase schon beim Hintergrund erfragt? Dann fragt er nur noch beim Sichtbarwerden.
  let tabGefragt = false;
  // Beobachtung an, wenn es eigene Ausnahmen gibt, sonst aus (dann gibt es nichts zu entscheiden und nichts zu fragen).
  function beobachteAdressen(e: Einstellungen): void {
    if (e.ausnahmen.length > 0) {
      if (!istRahmen) {
        adressen.start();
      } else if (!inhaltHoererAn) {
        inhaltHoererAn = true;
        browser.runtime.onMessage.addListener(beiInhaltNachricht);
        document.addEventListener('visibilitychange', beiSichtbarkeit);
        if (!tabGefragt) {
          tabGefragt = true;
          void aktualisiereTabAdresse();
        }
      }
    } else {
      if (!vorschau.brauchtAdresse()) adressen.stopp(); // die Zaehlung am Inhalt braucht ihn weiter
      if (inhaltHoererAn) {
        inhaltHoererAn = false;
        browser.runtime.onMessage.removeListener(beiInhaltNachricht);
        document.removeEventListener('visibilitychange', beiSichtbarkeit);
      }
      tabAdresse = null;
      tabGefragt = false;
    }
  }

  // Das Mia Pack gehoert zum Pruefstand, solange der Stil Mia-Patch ist: wird das Pack ersetzt (neues `importiert`) oder erst jetzt
  // freigeschaltet, rechnen offene Tabs neu, auch wenn die Einstellungen selbst gleich bleiben. Gelesen wird nur storage.local.pack.
  let packKurz: PackKurz | null = null;
  // Steigerung der Zensur (Auftrag S): wirksame Stufe gehoert zum Pruefstand; aendert sie sich, wird neu geprueft.
  const steigerung = new SteigerungMelder(!istRahmen, () => {
    if (einstellungen) wendeEinstellungenAn(einstellungen);
  });
  // packStand fuer die Anfrage an den Erkenner: nur bei Stil mia-patch (importiert des Packs, sonst 0), sonst weggelassen.
  function packStandFuer(e: Einstellungen): number | undefined {
    return e.stil === 'mia-patch' ? (packKurz?.importiert ?? 0) : undefined;
  }
  function pruefRelevant(e: Einstellungen): string {
    const stil = wirksamerStil(e.stil, packKurz);
    return JSON.stringify([e.schwelle, e.zonen, e.rand, e.stil, stil, e.stil === 'mia-patch' ? (packKurz?.importiert ?? 0) : 0, vorschau.stand(), steigerung.stufe()]);
  }

  function beiPackAenderung(aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen) || abgebaut) return;
    const p = aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue as PackKurz | undefined;
    packKurz = p && typeof p === 'object' && typeof p.id === 'string' ? p : null;
    if (einstellungen) wendeEinstellungenAn(einstellungen);
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
      z.ohneVorschau = false; // neuer Stand (Pack, Schalter): der Tausch darf es wieder versuchen
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
      // Die Beobachter werden getrennt: nach der Pause wird Sicht und Naehe beim Einreihen neu gemessen.
      if (z) z.sichtMeldung = z.nahMeldung = false;
    }
    verfolgt.clear();
    video.stoppAlle();
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
    vorschau.aktualisiere(neu, packKurz); // vor dem Pruefstand: Liste, Schalter und Pack gehoeren dazu
    // Mias eigene Werbung (eingeschaltet, mit Freischaltung) uebernimmt die Werbeflaechen selbst: dann blendet der Schleier keine Rahmen aus.
    // Wie in werbung.ts: Schalter an, Freischaltung da und diese Seite nicht in "Sites without my ads" (Runde 11, Nr. 10).
    const miasWerbung = neu.kontrolle.werbung && istFreigeschaltet(packKurz, 'kontrolle:werbung') && !passtAusnahme(adresseFuerAusnahmen(), neu.kontrolle.werbungAus);
    anzeigenRahmen.aktualisiere(vorschau.tauscht && !miasWerbung && !istAusFuer(neu) && !istLokalePause(neu));
    steigerung.aktualisiere(neu, packKurz, istAusFuer(neu)); // ebenso: die wirksame Stufe haengt an Pack und Pause; auf Ausnahmen keine Meldung
    freilegen.aktualisiere(neu, packKurz, istAusFuer(neu)); // Pack und Pause wirken sofort
    beobachteAdressen(neu);
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

  // detail ist ein JSON-Text oder ein Objekt mit { einstellungen, zweiterVersuchMs, erkennerStatus }. Ein Text ist der sichere Weg ueber die Grenze
  // zwischen Seite und Content-Script (Firefox reicht Objekte der Seite nicht durch). zweiterVersuchMs verkuerzt die Wartezeit des
  // zweiten Versuchs nach einem Fehler, damit der Fehlerpfad im Test nicht 10 s dauert; das Produktverhalten bleibt unveraendert.
  function beiTestEreignis(e: Event): void {
    try {
      let detail = (e as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const d = detail as {
        einstellungen?: unknown;
        zweiterVersuchMs?: unknown;
        videoVerzoegerungMs?: unknown;
        pruefVerzoegerungMs?: unknown;
        warteschlangeHalt?: unknown;
        erkennerStatus?: unknown;
        riegel?: unknown;
      } | null;
      if (typeof d?.zweiterVersuchMs === 'number' && d.zweiterVersuchMs >= 0) zweiterVersuchMs = d.zweiterVersuchMs;
      if (typeof d?.videoVerzoegerungMs === 'number' && d.videoVerzoegerungMs >= 0) videoVerzoegerungMs = d.videoVerzoegerungMs;
      // Vorrang-Tests: kuenstlich langsamer Erkenner (Bilder, Hintergruende) und angehaltene Warteschlange (Ende des Halts startet die Auswahl).
      if (typeof d?.pruefVerzoegerungMs === 'number' && d.pruefVerzoegerungMs >= 0) pruefVerzoegerungMs = d.pruefVerzoegerungMs;
      if (typeof d?.warteschlangeHalt === 'boolean') {
        warteschlangeHalt = d.warteschlangeHalt;
        if (!warteschlangeHalt) starteNaechste();
      }
      // Phase 4 (Auftrag Q): Riegel oeffnen, Abbild in data-veil-riegel (src/riegel/testhaken.ts).
      if (d?.riegel) testRiegel(d.riegel);
      // Status des Erkenners abfragen (weckt eine beendete Ereignisseite): die Antwort steht samt der Nummer der Anfrage in data-veil-erkenner.
      if (typeof d?.erkennerStatus === 'number') {
        const nr = d.erkennerStatus;
        const schreibe = (inhalt: Record<string, unknown>) => document.documentElement?.setAttribute('data-veil-erkenner', JSON.stringify({ nr, ...inhalt }));
        const frage: NachrichtErkennerStatus = { ziel: 'erkenner', typ: 'status' };
        browser.runtime.sendMessage(frage).then(
          (antwort) => schreibe({ antwort }),
          (fehler) => schreibe({ fehler: String(fehler) }),
        );
      }
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
  setzeZonenAnpassung((e) => steigerung.zonenFuer(e));
  setzeZensiertMelder((el) => {
    // Session 11: Ledger zaehlt nur neue Inhalte (Neubewertung desselben Inhalts zaehlt nicht, wie bei der Steigerung).
    if (steigerung.zensiert(el)) melde({ art: 'zensiert' });
  });
  // Entscheidung 193: verdeckte Vorschau- und Anzeigen-Videos auf Erwachsenenseiten der Liste geben keinen Ton. Nie ein Video im Player.
  const tonDeckel = new TonDeckel(
    () => aktiv && erwachsenStatus().liste !== null,
    (v) => {
      const adapter = adapterFuer(erwachsenStatus().liste);
      const imPlayer = (adapter.player ?? []).some((sel) => {
        try {
          return !!v.closest(sel);
        } catch {
          return false;
        }
      });
      // ueber Shadow-Grenzen wie versteckeVideo (Pruefung Runde 9, B: Hover-Video in einer Shadow Root mit dem Link am Host)
      return !imPlayer && (istHoverVideo(Vorschau.ueberSchatten(v), adapter) || istAnzeige(v, location.href));
    },
  );
  setzeUrteilMelder((el, z) => {
    freilegen.beiUrteil(el, z);
    tonDeckel.beiUrteil(el, z);
  });
  const steigerungGeladen = steigerung.start();
  if (document.readyState === 'complete') beiLoad();
  status.plane();

  let ausEinstellungGehoert = false;
  const abmelden = beiEinstellungsAenderung((neu) => {
    ausEinstellungGehoert = true;
    wendeEinstellungenAn(neu);
  });
  // Eingebettete Frames fragen den Hintergrund nach der Adresse des Tabs, aber nur, wenn es eigene Ausnahmen gibt (sonst ist die Antwort
  // ohne Folgen). Der Start wartet hoechstens TAB_FRIST_MS darauf; spaetere Wechsel melden die Frames ueber inhalt/tab.
  let packGehoert = false;
  const packLaden = ladePackKurz().catch(() => null);
  const packHoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) packGehoert = true;
    beiPackAenderung(aenderungen, bereich);
  };
  browser.storage.onChanged.addListener(packHoerer);
  Promise.all([ladeEinstellungen().catch(() => vervollstaendige(undefined)), packLaden, steigerungGeladen]).then(async ([e, pack]) => {
    if (!packGehoert) packKurz = pack;
    if (!ausEinstellungGehoert && istRahmen && e.ausnahmen.length > 0) {
      tabGefragt = true;
      const frist = new Promise<undefined>((fertig) => setTimeout(() => fertig(undefined), TAB_FRIST_MS));
      const t = await Promise.race([frageTabAdresse(), frist]);
      if (t) tabAdresse = t;
    }
    if (!ausEinstellungGehoert) wendeEinstellungenAn(e);
    else if (einstellungen) wendeEinstellungenAn(einstellungen); // das Pack ist inzwischen da
  });

  ctx.onInvalidated(() => {
    abgebaut = true;
    aktiv = false;
    abmelden();
    browser.storage.onChanged.removeListener(packHoerer);
    setzeZonenAnpassung(null);
    setzeZensiertMelder(null);
    setzeUrteilMelder(null);
    tonDeckel.alleFrei();
    freilegen.raeumeAuf();
    try {
      steigerung.stopp();
    } catch {
      // Abbau geht weiter, auch wenn der Melder nicht sauber stoppt.
    }
    adressen.stopp();
    if (inhaltHoererAn) browser.runtime.onMessage.removeListener(beiInhaltNachricht);
    inhaltHoererAn = false;
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    beobachter.stopp();
    klassen.stopp();
    video.stoppAlle();
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
    vorschau.raeumeAuf();
    anzeigenRahmen.abbau();
    window.removeEventListener('load', beiLoad);
    entferneWurzelStile();
    status.raeumeAuf();
  });
}
