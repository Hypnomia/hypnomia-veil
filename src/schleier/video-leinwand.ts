// Leinwand-Wiedergabe eines Videos mit Zonen-Zensur (Bauplan Video-Zonen, Auftrag V4).
// Das Video bleibt unsichtbar (data-veil-leinwand, CSS opacity 0). Direkt dahinter liegt ein Host mit geschlossener Shadow Root und einer Leinwand,
// die jedes gezeigte Einzelbild selbst malt und die Zensur darauflegt (Vorbild src/player/standbild.ts). Dieselbe Rueckrufschleife pro Bild
//   1. zieht ein Graustufenbild (160 px breit) und den Daumen 32 x 18,
//   2. prueft die Szene (Schnitt oder Sprung: dieses Bild ganz Mosaik, Spuren weg, Sofortpruefung),
//   3. fuehrt jede Spur mit Blockvergleich auf dem neuen Bild nach (V3b),
//   4. fragt beim Takt, ob die naechste Erkennung starten soll (sofort nach der letzten Antwort, kleine Untergrenze),
//   5. malt Bild und Zensur.
// Kommt eine Antwort, werden ihre Boxen ueber die inzwischen gezeigten Bilder auf den heutigen Stand nachgefuehrt und den Spuren zugeordnet.
// Dieses Modul kennt weder den Erkenner noch den Takt (video.ts): beides kommt ueber `LeinwandHaken`.

import type { Zone } from '../einstellungen';
import { patchPasst } from '../erkenner/stile';
import { PRESETS, ganzesBildBehandlung, personenGruppen, wortPasst, type Preset } from '../presets';
import {
  ATTR_LEINWAND,
  ATTR_VIDEO_BOXEN,
  ATTR_VIDEO_MODUS,
  TESTHAKEN,
  VIDEO_ZONEN_ALTER_MAX_S,
  VIDEO_ZONEN_BILD_S,
  VIDEO_ZONEN_DAUMEN_B,
  VIDEO_ZONEN_DAUMEN_H,
  VIDEO_ZONEN_ENTSPANNEN_S,
  VIDEO_ZONEN_FREI_NACH_S,
  VIDEO_ZONEN_GANZ_ANTEIL,
  VIDEO_ZONEN_GRAU_B,
  VIDEO_ZONEN_KONTRAST_MIN,
  VIDEO_ZONEN_LEINWAND_MAX_SEITE,
  VIDEO_ZONEN_RAND_BASIS,
  VIDEO_ZONEN_RTT_FENSTER,
  VIDEO_ZONEN_RTT_GRENZE_MS,
  VIDEO_ZONEN_SAD_UNSICHER,
  VIDEO_ZONEN_SPUR_HALTEN_S,
  VIDEO_ZONEN_SUCH_BASIS,
  VIDEO_ZONEN_SUCH_MAX,
  VIDEO_ZONEN_SZENE_SCHWELLE,
  VIDEO_ZONEN_WACHSTUM_JE_S,
  VIDEO_ZONEN_ZELLE_SCHWELLE,
  VIDEO_ZONEN_ZELLEN_ANTEIL,
  VIDEO_ZONEN_ZUORDNUNG_IOU,
  VIDEO_SPRUNG_MEDIA_S,
  VIDEO_UHR_RUECK_S,
  VIDEO_WECHSEL_MIN_MS,
} from './konstanten';
import { daumenAusGrau, GrauLeser, vergleicheDaumen, type GrauBild } from './daumen';
import { eigeneWurzel } from './eigene';
import { istFestPositioniert, legeAufRechteck, zIndexFuerLeinwand } from './lage';
import { lagewecker, merkeEigenenHost, schattenWurzelnVon } from './lagewecker-seite';
import { sperrePip } from './pip-sperre';
import { testhakenAktiv, type VideoZonenZaehler } from './status';
import {
  Rundlauf,
  SpurListe,
  boxenAnteil,
  entscheideAnsicht,
  entspanne,
  fruehestensAnsicht,
  fuehreDurch,
  inhaltsRechteck,
  istObjektPassung,
  istSprung,
  zeitOhneRueckfall,
  kantenZuRechteck,
  parsePosition,
  rueckkehrOk,
  saubereZeitNach,
  skaliereFlaechen,
  spurHalten,
  stilFuerZone,
  brauchtWort,
  wirksameBehandlung,
  zielKanten,
  FEHLER_SICHER_GRAUPIXEL,
  type Ansicht,
  type EignungsGrund,
  type GanzGrund,
  type Kanten,
  type Spur,
  type VerfolgungsParameter,
  type ZoneBox,
} from './video-zonen';
import { Zeichner, type FlaechenMittel, type ZeichenRechteck } from './video-zeichner';

const PARAM: VerfolgungsParameter = {
  suchBasis: VIDEO_ZONEN_SUCH_BASIS,
  suchMax: VIDEO_ZONEN_SUCH_MAX,
  sadUnsicher: VIDEO_ZONEN_SAD_UNSICHER,
  kontrastMin: VIDEO_ZONEN_KONTRAST_MIN,
  wachstumJeS: VIDEO_ZONEN_WACHSTUM_JE_S,
  fehlerSicher: FEHLER_SICHER_GRAUPIXEL,
};
const SPUR_P = { zuordnungIou: VIDEO_ZONEN_ZUORDNUNG_IOU, halten: VIDEO_ZONEN_SPUR_HALTEN_S };
const SZENE_S = { szene: VIDEO_ZONEN_SZENE_SCHWELLE, zelle: VIDEO_ZONEN_ZELLE_SCHWELLE, anteil: VIDEO_ZONEN_ZELLEN_ANTEIL };
const RING = 24; // so viele Graustufenbilder bleiben fuer das Nachfuehren einer Antwort (bei 30 Bildern je s knapp 0,8 s)
const EIGNUNG_TAKT_MS = 250;
const SAUBER_SCHRITT_S = 0.25; // hoechstens so viel Medienzeit zaehlt eine einzelne saubere Antwort
const ERSTES_BILD_FRIST_MS = 700; // ohne gemaltes Bild nach so langer Zeit gilt die Leinwand als gestoert
const LAGE_TAKT_MS = 400;
const ZAEHLER_LISTE = 64;
// Testhaken nur im Testbau: Zahl der Bilder, die mit geleerter Leinwand gemalt wurden (Leinwandgroesse neu gesetzt, danach bis zum Ende unseres
// letzten Rueckrufs vor dem Malen, der ResizeObserver-Phase, kein Videobild gezeichnet). Am Video, geschrieben nur bei Aenderung.
const ATTR_VIDEO_LEER = TESTHAKEN ? 'data-veil-video-leer' : '';

// Ein aufgenommenes Bild, auf das sich eine Antwort des Erkenners bezieht.
export interface Aufnahme {
  nr: number; // Bildnummer in der Schleife, -1 = vor der Leinwand aufgenommen
  szene: number;
  mediaTime: number;
  zeit: number; // performance.now() bei der Aufnahme
  vb: number;
  vh: number;
  grau: GrauBild | null;
}

export interface AntwortDaten {
  flaechen: ReadonlyArray<{ zone: Zone; box: readonly number[]; behandlung?: unknown; ersatz?: unknown }>;
  breite: number;
  hoehe: number;
}

export interface LeinwandHaken {
  lebt(): boolean;
  sichtbar(): boolean;
  // Wirksames Preset (Mia-Presets nur mit Pack, sonst schon Mosaik; src/pack/vertrag.ts presetFuerPackKurz).
  preset(): Preset;
  // Zaehler der Spruenge des Schleiers (seeking, seeked ohne Schleifenumlauf).
  sprungZaehler(): number;
  // null = das Video ist (weiter) fuer die Leinwand geeignet.
  eignung(): EignungsGrund | null;
  // Das naechste Bild ist da und analysiert: der Takt darf die naechste Erkennung starten (sie nimmt dabei `aufnahme()`).
  bildBereit(): void;
  // Eine Sofortpruefung ist geschuldet (Schnitt, Sprung, Pause).
  sofort(): void;
  // Die Hysterese des Taktes (video.ts) steht kurz vor der Freigabe (genug saubere Pruefungen in Folge)? Erst dann darf ein Bild ohne Spur klar bleiben.
  freigabeReif(): boolean;
  // Mias Gesicht fuer dieses Motiv (Spur.motiv): Bild des Packs und Gesichtsausschnitt darin (null = noch nicht geladen oder keins zu haben, das Laden ist
  // angestossen; dann gilt die Koerper-Behandlung). Stabil je Motiv, also auch ueber eine neu angelegte Spur an derselben Stelle hinweg.
  gesicht(motiv: number): { bild: CanvasImageSource; ausschnitt: [number, number, number, number] } | null;
  // Das Wort dieses Motivs fuer Behandlungen mit Wort (null = noch nicht geladen oder die Schrift fehlt: dann steht kein Wort da). Stabil je Motiv.
  wort(motiv: number): string | null;
  // Die Leinwand kann nicht weiter malen: der Verwalter faellt auf Ganz-Verdecken zurueck.
  beiStoerung(grund: string): void;
  // Der Median der Rundlaeufe liegt ueber der Grenze: ganz verdecken.
  beiLangsam(): void;
  zaehler: VideoZonenZaehler;
}

interface RingEintrag {
  nr: number;
  szene: number;
  mt: number;
  grau: GrauBild;
}

export interface AnfangsAntwort {
  aufnahme: Aufnahme;
  antwort: AntwortDaten | null;
}

interface Masse {
  rect: DOMRect;
  // Inhalt (Videobild) in Bildpunkten der Leinwand.
  inhalt: ZeichenRechteck;
  flipX: boolean;
  flipY: boolean;
  untergrund: string | null;
  // Leinwandpunkte je CSS-Pixel (fuer Mindestgroessen von Wort und Mias Gesicht in Anzeigepixeln).
  skala: number;
}

// Testhaken (nur Testbau): die Rueckrufschleife nimmt requestAnimationFrame statt requestVideoFrameCallback (Pfad von Firefox 128).
let rvfcAus = false;
export function setzeRvfcAus(aus: boolean): void {
  if (TESTHAKEN) rvfcAus = aus;
}

// Testhaken (nur Testbau): die Leinwand malt nichts (Pruefung der Frist fuer das erste Bild).
let malenAus = false;
export function setzeMalenAus(aus: boolean): void {
  if (TESTHAKEN) malenAus = aus;
}

const rundeMs = (x: number): number => Math.round(x * 100) / 100;

export class ZonenVideo {
  readonly el: HTMLVideoElement;
  private readonly h: LeinwandHaken;
  private readonly host: HTMLElement;
  private readonly leinwand: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly zeichner = new Zeichner();
  private readonly leser = new GrauLeser(VIDEO_ZONEN_GRAU_B);
  private readonly spuren = new SpurListe();
  private readonly rundlauf = new Rundlauf(VIDEO_ZONEN_RTT_FENSTER);
  private readonly ring: RingEintrag[] = [];
  private readonly hoerer: Array<[EventTarget, string, EventListener]> = [];
  private tot = false;
  private bildNr = 0;
  private szene = 0;
  private wartetAufSzene = false;
  private letzterDaumen: Float32Array | null = null;
  private letzteMt = Number.NaN;
  private letzteSprungZahl: number;
  private letzteZeitMs = 0;
  // Ergebnis der letzten Antwort fuer die Entscheidung.
  private letzteAntwortMt = Number.NEGATIVE_INFINITY;
  private fehler = false;
  // Anfangs ganz gedeckt: das erste Bild entscheidet, ob Zonen reichen (der erste Wechsel ist nicht gebremst).
  private ansicht: Ansicht = 'ganz';
  private grund: GanzGrund | null = 'wartet';
  private letzterWechsel = Number.NEGATIVE_INFINITY;
  private schmutzig = true;
  private sofortOffen = false;
  private ersteBildZeit: number | null = null;
  private gemalt = 0;
  private handle: number | null = null;
  private handleArt: 'rvfc' | 'raf' | null = null;
  private letzteEignung = 0;
  private lageTimer: ReturnType<typeof setInterval> | null = null;
  // Lagewecker (lagewecker.ts): ResizeObserver auf dem Video fuer einen Rueckruf nach dem Layout desselben Bildes, Abmeldung.
  private beob: ResizeObserver | null = null;
  private weckerAb: (() => void) | null = null;
  // Leinwand geleert (Groesse neu gesetzt) und seither kein Videobild gezeichnet; Zahl der so gemalten Bilder (Testhaken).
  private leinwandLeer = false;
  private leereBilder = 0;
  private masse: Masse | null = null;
  private frist: ReturnType<typeof setTimeout> | null = null;
  private zuletztZ = '';
  private anfang: AnfangsAntwort | null;
  private modusText = '';
  private boxenText = '';
  private boxenZeit = 0;
  private sichtbarWar = true;
  // Das Videobild dieses Durchgangs liegt schon auf der Leinwand (verarbeite hat es vor der Analyse gemalt).
  private videoGezeichnet = false;
  // Beobachtete saubere Medienzeit seit dem letzten Treffer: waechst nur durch Antworten (je Antwort um den Abstand zur vorigen Antwort derselben Szene,
  // hoechstens SAUBER_SCHRITT_S), geht bei einem Treffer und bei jeder neuen Szene (Sprung, Hintergrund, Wegscrollen) auf 0. Eine Luecke der Medienzeit
  // zaehlt nie als sauber.
  private saubereZeit = 0;
  private fristAbgelaufen = false;
  private readonly testAn = TESTHAKEN && testhakenAktiv();

  constructor(el: HTMLVideoElement, haken: LeinwandHaken, anfang: AnfangsAntwort | null) {
    this.el = el;
    this.h = haken;
    this.anfang = anfang;
    this.letzteSprungZahl = haken.sprungZaehler();
    // Host als Geschwister direkt hinter dem Video: Inline-Stile mit !important (CSSOM), Klicks gehen ans Video.
    const host = document.createElement('div');
    this.host = host;
    merkeEigenenHost(host);
    const s = host.style;
    for (const [n, w] of [
      ['all', 'initial'],
      ['position', 'absolute'],
      ['display', 'block'],
      ['margin', '0'],
      ['padding', '0'],
      ['border', '0'],
      ['overflow', 'hidden'],
      ['background', 'transparent'],
      ['pointer-events', 'none'],
      ['visibility', 'visible'],
      ['opacity', '1'],
      ['box-sizing', 'border-box'],
      ['left', '0'],
      ['top', '0'],
    ] as const) s.setProperty(n, w, 'important');
    const wurzel = eigeneWurzel(host);
    const c = document.createElement('canvas');
    c.style.setProperty('display', 'block', 'important');
    c.style.setProperty('width', '100%', 'important');
    c.style.setProperty('height', '100%', 'important');
    wurzel.append(c);
    this.leinwand = c;
    const ctx = c.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('kein 2D-Kontext');
    this.ctx = ctx;
    // Erst das Attribut (Video unsichtbar), dann der Host: nie ein Augenblick mit sichtbarem Video.
    el.setAttribute(ATTR_LEINWAND, '');
    const eltern = el.parentNode;
    if (!eltern) throw new Error('kein Elternknoten');
    eltern.insertBefore(host, el.nextSibling);
    this.setzeZ();
    sperrePip(el, true, 'zonen');
    this.hoere(el, 'seeked', () => this.planeMalen());
    this.hoere(el, 'pause', () => {
      this.schmutzig = true;
      this.h.sofort();
      this.planeMalen();
    });
    this.hoere(el, 'play', () => (this.schmutzig = true));
    this.hoere(el, 'resize', () => {
      this.neueSzene();
      this.masse = null;
    });
    this.hoere(el, 'enterpictureinpicture', () => sperrePip(el, true, 'zonen'));
    this.hoere(document, 'fullscreenchange', () => {
      if (document.fullscreenElement === el) this.stoerung('vollbild');
      else this.schmutzig = true;
    });
    this.hoere(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') this.neueSzene();
    });
    this.lageTimer = setInterval(() => this.pflege(), LAGE_TAKT_MS);
    // Lagewecker: verschiebt sich das Video ohne Groessenwechsel und ohne neues Bild (Pause), liegt der Host im selben Bild wieder richtig.
    // Je Bild, solange wach: das Video frisch beobachten, der Rueckruf kommt nach dem Layout desselben Bildes und legt dort (nie den Host beobachten).
    try {
      this.beob = new ResizeObserver(() => this.lageNachLayout());
      this.beob.observe(el);
    } catch {
      this.beob = null;
    }
    this.weckerAb = lagewecker().melde(
      {
        lebt: () => !this.tot && this.h.lebt(),
        jeBild: () => {
          if (this.beob) {
            this.beob.unobserve(el);
            this.beob.observe(el);
          } else this.lageNachLayout();
        },
      },
      schattenWurzelnVon(el),
    );
    this.setzeModus();
  }

  // Lage nach dem Layout (ResizeObserver, danach malt der Browser) oder im rAF. Nur die Lage geaendert: Host legen, nicht malen. Groesse geaendert
  // und das Video laeuft: nur den Host legen (die Leinwand waechst per CSS mit), Masse und Leinwandgroesse bleiben; das naechste verarbeite rechnet
  // neu und malt im selben Aufruf. Sonst wuerde hier die Leinwand geleert und erst ein Bild spaeter gemalt. Groesse geaendert und das Video steht:
  // Masse neu und im selben Rueckruf malen (kein planeMalen, das malte erst im naechsten Bild). Nichts hier aendert eine beobachtete Groesse.
  private lageNachLayout(): void {
    if (this.tot || document.hidden) return;
    const el = this.el;
    if (!el.isConnected) return;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    const alt = this.masse?.rect;
    const groesseGleich = !!alt && Math.abs(alt.width - rect.width) < 0.5 && Math.abs(alt.height - rect.height) < 0.5;
    if (groesseGleich) {
      this.pruefeLage();
    } else if (!el.paused && !el.ended) {
      legeAufRechteck(this.host, rect, istFestPositioniert(el));
    } else {
      this.pruefeLage();
      this.schmutzig = true;
      try {
        this.verarbeite(undefined);
      } catch (e) {
        this.stoerung(`Fehler ${(e as Error)?.message ?? e}`);
      }
    }
    this.zaehleLeer();
  }

  // Nach dem Eintragen beim Verwalter: das erste Bild sofort (das Video steht oft schon), dann laeuft die Rueckrufschleife. Eine Stoerung dabei
  // meldet sich beim Verwalter, der die Leinwand dann kennen muss.
  starte(): void {
    if (this.tot) return;
    try {
      this.verarbeite(undefined);
    } catch (e) {
      this.stoerung(`Fehler ${(e as Error)?.message ?? e}`);
      return;
    }
    this.plane();
  }

  // ---------- Abfragen ----------

  get anzahlSpuren(): number {
    return this.spuren.spuren.length;
  }

  get zeigtGanz(): boolean {
    return this.ansicht === 'ganz';
  }

  // Darf das Video wieder frei werden? Nur nach 3 s Medienzeit ohne Treffer, ohne offene Szenenpruefung und ohne Fehler.
  darfFrei(): boolean {
    if (this.wartetAufSzene || this.fehler) return false;
    return this.saubereZeit >= VIDEO_ZONEN_FREI_NACH_S;
  }

  // Ein Bild, auf das sich die naechste Antwort bezieht: das zuletzt analysierte (die Aufnahme geschieht im selben Rueckruf, in dem es gemalt wird).
  aufnahme(): Aufnahme {
    const e = this.ring[this.ring.length - 1];
    return {
      nr: e?.nr ?? -1,
      szene: this.szene,
      mediaTime: e?.mt ?? this.mediaZeit(),
      zeit: performance.now(),
      vb: this.el.videoWidth,
      vh: this.el.videoHeight,
      grau: e?.grau ?? null,
    };
  }

  // ---------- Antwort ----------

  beiAntwort(aufn: Aufnahme, antwort: AntwortDaten | null): void {
    if (this.tot) return;
    const z = this.h.zaehler;
    z.pruefungen++;
    const rtt = performance.now() - aufn.zeit;
    z.rtt.push(rundeMs(rtt));
    if (z.rtt.length > ZAEHLER_LISTE) z.rtt.shift();
    this.rundlauf.push(rtt);
    if (this.rundlauf.zuLangsam(VIDEO_ZONEN_RTT_GRENZE_MS)) {
      this.h.beiLangsam();
      return;
    }
    if (!antwort) {
      // Fehler oder keine Antwort: bis zu einer guten Antwort ganz decken.
      this.fehler = true;
      this.schmutzig = true;
      return;
    }
    if (aufn.szene !== this.szene) return; // gehoert zu einer fruehren Szene: die Boxen passen nicht mehr
    this.fehler = false;
    this.wendeAn(aufn, antwort);
  }

  private wendeAn(aufn: Aufnahme, antwort: AntwortDaten): void {
    const boxen = skaliereFlaechen(antwort.flaechen, antwort.breite, antwort.hoehe, aufn.vb, aufn.vh);
    const nachgefuehrt = this.fuehreNach(boxen, aufn);
    this.spuren.ordneZu(nachgefuehrt, aufn.mediaTime, { ...SPUR_P, preset: this.h.preset() });
    this.saubereZeit = saubereZeitNach(this.saubereZeit, this.letzteAntwortMt, aufn.mediaTime, boxen.length > 0, SAUBER_SCHRITT_S);
    this.letzteAntwortMt = aufn.mediaTime;
    this.wartetAufSzene = false;
    this.schmutzig = true;
  }

  // Boxen vom Bild der Aufnahme bis zum zuletzt gezeigten Bild nachfuehren (Blockvergleich ueber die Bilder dazwischen).
  private fuehreNach(boxen: ZoneBox[], aufn: Aufnahme): ZoneBox[] {
    const jetzt = this.ring[this.ring.length - 1];
    if (!jetzt || !aufn.grau) return boxen.map((b) => ({ ...b, unsicher: this.unsicherOhne(aufn) }));
    // Bilder nach der Aufnahme in derselben Szene; fehlt die Aufnahme im Ring (zu alt), geht es nicht schrittweise.
    let folge: RingEintrag[];
    if (aufn.nr >= 0) {
      const erstes = this.ring[0]!;
      if (aufn.nr < erstes.nr) return boxen.map((b) => ({ ...b, unsicher: this.unsicherOhne(aufn) }));
      folge = this.ring.filter((e) => e.nr > aufn.nr && e.szene === aufn.szene);
    } else {
      // Aufnahme vor der Leinwand (erste Antwort): ein grosser Schritt auf das erste gezeigte Bild.
      folge = this.ring.filter((e) => e.szene === aufn.szene);
    }
    const bilder: GrauBild[] = [aufn.grau, ...folge.map((e) => e.grau)];
    const zeiten: number[] = [aufn.mediaTime, ...folge.map((e) => e.mt)];
    if (bilder.length < 2) return boxen;
    const skala = aufn.grau.b / Math.max(1, aufn.vb);
    const laenge = Math.max(aufn.vb, aufn.vh);
    return boxen.map((b) => {
      const r = fuehreDurch(b.box, b.unsicher ?? 0, bilder, zeiten, skala, laenge, PARAM);
      return { zone: b.zone, box: r.box, unsicher: r.unsicher, ...(b.behandlung ? { behandlung: b.behandlung } : {}), ...(b.ersatz ? { ersatz: b.ersatz } : {}) };
    });
  }

  // Unsicherheit einer Box, die nicht nachgefuehrt werden konnte: wie ohne Verfolgung mit der Zeit seit der Aufnahme.
  private unsicherOhne(aufn: Aufnahme): number {
    const dt = Math.max(0, this.mediaZeit() - aufn.mediaTime);
    return VIDEO_ZONEN_WACHSTUM_JE_S * dt * Math.max(aufn.vb, aufn.vh);
  }

  private mediaZeit(): number {
    const e = this.ring[this.ring.length - 1];
    return e ? e.mt : this.el.currentTime;
  }

  // ---------- Rueckrufschleife ----------

  private plane(): void {
    if (this.tot || this.handle !== null) return;
    const el = this.el;
    const rvfc = (el as { requestVideoFrameCallback?: (f: (t: number, m: VideoFrameCallbackMetadata) => void) => number }).requestVideoFrameCallback;
    try {
      if (typeof rvfc === 'function' && !rvfcAus) {
        this.handleArt = 'rvfc';
        this.handle = rvfc.call(el, (_t, meta) => {
          this.handle = null;
          this.rueckruf(meta);
        });
      } else {
        this.handleArt = 'raf';
        this.handle = requestAnimationFrame(() => {
          this.handle = null;
          this.rueckruf(undefined);
        });
      }
    } catch {
      this.handle = null;
    }
  }

  private rueckruf(meta: VideoFrameCallbackMetadata | undefined): void {
    if (this.tot) return;
    try {
      this.verarbeite(meta);
    } catch (e) {
      this.stoerung(`Fehler ${(e as Error)?.message ?? e}`);
      return;
    }
    this.plane();
  }

  // Wartet auf das naechste Mal mit einem Bild (nach seeked, pause: kein neues Bild vom Browser gemeldet).
  private planeMalen(): void {
    if (this.tot) return;
    requestAnimationFrame(() => {
      if (this.tot) return;
      try {
        this.verarbeite(undefined);
      } catch (e) {
        this.stoerung(`Fehler ${(e as Error)?.message ?? e}`);
      }
    });
  }

  // ---------- Ein Bild ----------

  private verarbeite(meta: VideoFrameCallbackMetadata | undefined): void {
    const el = this.el;
    if (!this.h.lebt()) return;
    if (el.readyState < 2 || !(el.videoWidth > 0)) return;
    const t0 = performance.now();
    const sichtbar = this.h.sichtbar() && document.visibilityState === 'visible';
    if (!sichtbar) {
      this.sichtbarWar = false;
      // Unsichtbar kann nichts gemalt werden: die Frist fuer das erste Bild laeuft nicht weiter, sie beginnt beim Sichtbarwerden neu.
      if (this.frist) clearTimeout(this.frist);
      this.frist = null;
      return;
    }
    if (!this.sichtbarWar) {
      // Unsichtbar gewesen: dazwischen kamen keine Bilder durch diese Schleife, die Spuren passen nicht mehr.
      this.sichtbarWar = true;
      this.neueSzene();
    }
    // Die Frist fuer das erste gemalte Bild beginnt erst jetzt: sichtbar, sichtbarer Tab und Bilddaten da (vorher kann nichts gemalt werden).
    if (this.frist === null && this.gemalt === 0 && !this.fristAbgelaufen) {
      this.frist = setTimeout(() => {
        this.frist = null;
        this.fristAbgelaufen = true;
        if (!this.tot && this.gemalt === 0) this.stoerung('keine Bilder');
      }, ERSTES_BILD_FRIST_MS);
    }
    if (t0 - this.letzteEignung > EIGNUNG_TAKT_MS) {
      this.letzteEignung = t0;
      const g = this.h.eignung();
      if (g) return this.stoerung(g);
    }
    const sprungZahl = this.h.sprungZaehler();
    const mt = typeof meta?.mediaTime === 'number' ? meta.mediaTime : zeitOhneRueckfall(el.currentTime, this.letzteMt, VIDEO_UHR_RUECK_S, sprungZahl !== this.letzteSprungZahl);
    const anders = !(mt === this.letzteMt) || this.ring.length === 0;
    if (!anders && !this.schmutzig) return;
    // Jeder Durchgang, der malt, wird auch analysiert: die Medienzeit allein erkennt ein neues Bild nicht verlaesslich (Firefox 128 meldet in requestAnimationFrame
    // dieselbe Zeit, waehrend das Videobild schon wechselte). Ein Bild ohne Analyse zu malen, liesse einen Schnitt unerkannt offen.
    const neuesBild = true;
    // Spruenge (Ereignis oder Sprung der Medienzeit) und Schnitte.
    let szeneNeu = false;
    let grund: 'sprung' | 'schnitt' = 'sprung';
    let sofort = false;
    if (neuesBild) {
      if (sprungZahl !== this.letzteSprungZahl) {
        this.letzteSprungZahl = sprungZahl;
        szeneNeu = true;
      } else if (Number.isFinite(this.letzteMt) && istSprung(this.letzteMt, mt, VIDEO_SPRUNG_MEDIA_S, VIDEO_UHR_RUECK_S)) szeneNeu = true;
    }
    let grau: GrauBild | null = null;
    let daumen: Float32Array | null = null;
    if (neuesBild) {
      // Das Video wird je Bild nur einmal gelesen: erst auf die Leinwand gemalt, das Graustufenbild kommt aus der Leinwand (siehe GrauLeser.liesLeinwand).
      this.pruefeLage();
      const m0 = this.masse;
      if (!m0) return;
      try {
        this.zeichneVideo(m0);
      } catch (e) {
        return this.stoerung(`Fehler ${(e as Error)?.message ?? e}`);
      }
      this.videoGezeichnet = true;
      grau = this.leser.liesLeinwand(this.leinwand, m0.inhalt, m0.flipX, m0.flipY, el.videoWidth, el.videoHeight);
      if (!grau) return this.stoerung('lesen');
      daumen = daumenAusGrau(grau, VIDEO_ZONEN_DAUMEN_B, VIDEO_ZONEN_DAUMEN_H);
      this.h.zaehler.msGrau += performance.now() - t0;
      if (this.letzterDaumen && !szeneNeu) {
        const b = vergleicheDaumen(this.letzterDaumen, daumen, SZENE_S);
        if (b.art === 'schnitt') {
          szeneNeu = true;
          grund = 'schnitt';
        } else if (b.art === 'sofort') sofort = true;
      }
      if (szeneNeu) this.neueSzene();
      const dt = Number.isFinite(this.letzteMt) ? mt - this.letzteMt : 0;
      const vorher = this.ring[this.ring.length - 1];
      this.ring.push({ nr: ++this.bildNr, szene: this.szene, mt, grau });
      if (this.ring.length > RING) this.ring.shift();
      // Spuren nachfuehren: nur innerhalb derselben Szene und bei gleich gebliebener Bildgroesse.
      if (vorher && !szeneNeu && vorher.szene === this.szene && vorher.grau.b === grau.b && vorher.grau.h === grau.h && dt >= 0) {
        const tv = performance.now();
        this.fuehreSpuren(vorher, grau, mt, dt);
        this.h.zaehler.msVerfolgung += performance.now() - tv;
      }
      this.letzterDaumen = daumen;
      this.letzteMt = mt;
    }
    // Erste Antwort (vor der Leinwand aufgenommen) einspielen.
    if (this.anfang) this.spieleAnfangEin(this.anfang);
    this.spuren.entferneAlte(mt, spurHalten(this.rundlauf.median(), VIDEO_ZONEN_SPUR_HALTEN_S));
    if (sofort || szeneNeu || this.sofortOffen) {
      this.sofortOffen = false;
      this.h.sofort();
    }
    // Die naechste Erkennung darf starten (sie nimmt das eben analysierte Bild auf). Ihr Lesen der Pixel (JPEG) zaehlt nicht zur Zeit je Bild:
    // gemessen wird Analyse, Verfolgung und Malen (M2).
    const vorBereit = performance.now();
    if (neuesBild) this.h.bildBereit();
    const nachBereit = performance.now();
    const tm = performance.now();
    this.male(mt, szeneNeu ? grund : null);
    this.h.zaehler.msMalen += performance.now() - tm;
    const ms = vorBereit - t0 + (performance.now() - nachBereit);
    this.h.zaehler.ms += ms;
    this.h.zaehler.msBilder++;
  }

  private spieleAnfangEin(a: AnfangsAntwort): void {
    this.anfang = null;
    const e = this.ring[this.ring.length - 1];
    if (!e) return;
    // Die Aufnahme gehoert zur Szene dieser Leinwand, ausser zwischen Aufnahme und erstem Bild kam ein Schnitt.
    let gleicheSzene = true;
    if (a.aufnahme.grau && e.grau.b === a.aufnahme.grau.b && e.grau.h === a.aufnahme.grau.h) {
      const alt = daumenAusGrau(a.aufnahme.grau, VIDEO_ZONEN_DAUMEN_B, VIDEO_ZONEN_DAUMEN_H);
      const neu = this.letzterDaumen ?? daumenAusGrau(e.grau, VIDEO_ZONEN_DAUMEN_B, VIDEO_ZONEN_DAUMEN_H);
      if (vergleicheDaumen(alt, neu, SZENE_S).art === 'schnitt') gleicheSzene = false;
    } else gleicheSzene = false; // ohne vergleichbares Graustufenbild laesst sich weder die Szene noch die Bewegung pruefen: neue Szene, ganz decken, sofort neu pruefen
    if (!gleicheSzene) {
      this.neueSzene();
      this.h.sofort();
      return;
    }
    const aufn: Aufnahme = { ...a.aufnahme, nr: -1, szene: this.szene };
    if (!a.antwort) {
      this.fehler = true;
      return;
    }
    // Die Bilder bis jetzt: eine Aufnahme ohne Ring-Nummer wird ueber alle Ring-Bilder der Szene nachgefuehrt.
    this.wendeAn(aufn, a.antwort);
  }

  private fuehreSpuren(vorher: RingEintrag, grau: GrauBild, mt: number, dt: number): void {
    const skala = grau.b / Math.max(1, this.el.videoWidth);
    const laenge = Math.max(this.el.videoWidth, this.el.videoHeight);
    for (const s of this.spuren.spuren) {
      const r = fuehreDurch(s.box, s.unsicher, [vorher.grau, grau], [mt - dt, mt], skala, laenge, PARAM);
      s.box = r.box;
      s.unsicher = r.unsicher;
    }
  }

  // `mt`: Medienzeit des ersten Bildes der neuen Szene. Die Hysterese (3 s ohne Treffer) beginnt dort neu: nur beobachtete saubere Zeit zaehlt, nie eine
  // Luecke durch Sprung, Hintergrund-Tab oder Wegscrollen.
  // Eine neue Szene (Schnitt, Sprung, Sichtbarwerden, Groessenwechsel) beginnt die saubere Zeit neu: nur beobachtete saubere Zeit zaehlt.
  private neueSzene(): void {
    this.szene++;
    this.saubereZeit = 0;
    this.sofortOffen = true;
    this.spuren.leere();
    this.wartetAufSzene = true;
    this.letzterDaumen = null;
    this.letzteAntwortMt = Number.NEGATIVE_INFINITY;
    this.schmutzig = true;
  }

  // ---------- Malen ----------

  private male(mt: number, szeneGrund: 'sprung' | 'schnitt' | null): void {
    if (TESTHAKEN && malenAus) return;
    const el = this.el;
    if (!this.videoGezeichnet) this.pruefeLage();
    const m = this.masse;
    if (!m) return;
    const dt = Math.min(0.2, Math.max(0, mt - (this.letzteMalZeit ?? mt)));
    this.letzteMalZeit = mt;
    const vb = el.videoWidth;
    const vh = el.videoHeight;
    // Anzeige der Spuren: Ziel mit Rand und Unsicherheit, nach aussen sofort, nach innen gleitend.
    const kanten: Kanten[] = [];
    for (const s of this.spuren.spuren) {
      s.anzeige = entspanne(s.anzeige, zielKanten(s, vb, vh, VIDEO_ZONEN_RAND_BASIS), dt, VIDEO_ZONEN_ENTSPANNEN_S);
      kanten.push(s.anzeige);
    }
    const alter = Number.isFinite(this.letzteAntwortMt) ? (mt >= this.letzteAntwortMt ? mt - this.letzteAntwortMt : Infinity) : Infinity;
    const e = entscheideAnsicht({
      alter,
      alterMax: VIDEO_ZONEN_ALTER_MAX_S,
      schnitt: szeneGrund === 'schnitt',
      sprung: szeneGrund === 'sprung',
      wartetAufSzene: this.wartetAufSzene,
      anteil: boxenAnteil(kanten, vb, vh),
      ganzAnteil: VIDEO_ZONEN_GANZ_ANTEIL,
      fehler: this.fehler,
      // Keine Spur, aber das Video gilt noch als verdeckt (Hysterese, 3 s Medienzeit ohne Treffer): das Bild bleibt ganz gedeckt, nie klar.
      leerGehalten: this.spuren.spuren.length === 0 && (!this.darfFrei() || !this.h.freigabeReif()),
    });
    // Wechsel unter der Bremse: Decken sofort, zurueck zu den Zonen erst nach der Mindestzeit (Blitz-Grenze, hoechstens 2 Wechsel je s).
    const jetzt = performance.now();
    // Zurueck zu den Zonen zusaetzlich nur, wenn ein Rundlauf samt Bild unter dem erlaubten Alter der Boxen liegt (sonst flackerte es zwischen ganz und Zonen).
    const rueckOk = e.ansicht !== 'zonen' || rueckkehrOk(this.rundlauf.median(), VIDEO_ZONEN_BILD_S, VIDEO_ZONEN_ALTER_MAX_S);
    if (e.ansicht !== this.ansicht && rueckOk && jetzt >= fruehestensAnsicht(e.ansicht, this.letzterWechsel, VIDEO_WECHSEL_MIN_MS)) {
      this.ansicht = e.ansicht;
      this.letzterWechsel = jetzt;
      this.grund = e.grund;
    }
    if (this.ansicht === 'ganz' && e.ansicht === 'ganz') this.grund = e.grund; // der heutige Grund (Testhaken)
    this.malen(m, vb, vh);
    this.gemalt++;
    this.h.zaehler.bilder++;
    if (this.ansicht === 'ganz') this.h.zaehler.ganz++;
    if (this.ersteBildZeit === null) this.ersteBildZeit = jetzt;
    this.schmutzig = false;
    this.setzeModus();
    this.schreibeBoxen(jetzt, kanten, m);
  }

  private letzteMalZeit: number | null = null;
  // Testhaken: Zeichenart je Flaeche im letzten Bild und die wirklich gemalten Rechtecke (Leinwandpunkte).
  private arten: string[] = [];
  private malRechtecke: Array<[number, number, number, number]> = [];
  private malIds: number[] = [];
  // Motiv je gemalter Flaeche (Wort und Mias Gesicht), gleiche Reihenfolge wie `malIds`; -1 bei Personen-Huellen.
  private malMotive: number[] = [];

  // Das Videobild (mit Untergrund und Spiegelung) auf die leere Leinwand malen.
  private zeichneVideo(m: Masse): void {
    const ctx = this.ctx;
    const c = this.leinwand;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (m.untergrund) {
      ctx.fillStyle = m.untergrund;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    const r = m.inhalt;
    ctx.save();
    if (m.flipX || m.flipY) {
      ctx.translate(m.flipX ? r.x * 2 + r.w : 0, m.flipY ? r.y * 2 + r.h : 0);
      ctx.scale(m.flipX ? -1 : 1, m.flipY ? -1 : 1);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.el, r.x, r.y, r.w, r.h);
    ctx.restore();
    this.leinwandLeer = false;
  }

  // Testhaken: endet ein Rueckruf der ResizeObserver-Phase (danach malt der Browser) mit geleerter Leinwand, zeigt dieses Bild sie leer.
  private zaehleLeer(): void {
    if (!this.testAn || !ATTR_VIDEO_LEER || !this.leinwandLeer || this.tot) return;
    this.leereBilder++;
    this.el.setAttribute(ATTR_VIDEO_LEER, String(this.leereBilder));
  }

  private malen(m: Masse, vb: number, vh: number): void {
    const ctx = this.ctx;
    const c = this.leinwand;
    this.arten = [];
    this.malRechtecke = [];
    this.malIds = [];
    this.malMotive = [];
    if (!this.videoGezeichnet) this.zeichneVideo(m);
    this.videoGezeichnet = false;
    const r = m.inhalt;
    const flaeche = Zeichner.begrenze(r, c.width, c.height);
    if (!flaeche) return;
    if (this.ansicht === 'ganz') {
      this.zeichner.ganz(ctx, flaeche);
      return;
    }
    const fx = r.w / vb;
    const fy = r.h / vh;
    const preset = this.h.preset();
    const anzeige = 1 / Math.max(0.05, m.skala); // CSS-Pixel je Leinwandpunkt
    // Gezeigte Flaechen in Leinwandpunkten.
    const liste: Array<{ spur: Spur; rr: ZeichenRechteck }> = [];
    for (const s of this.spuren.spuren) {
      const k = s.anzeige;
      if (!k) continue;
      const l = m.flipX ? vb - k.r : k.l;
      const o = m.flipY ? vh - k.b : k.t;
      const rr = Zeichner.begrenze({ x: r.x + l * fx, y: r.y + o * fy, w: (k.r - k.l) * fx, h: (k.b - k.t) * fy }, c.width, c.height);
      if (rr) liste.push({ spur: s, rr });
    }
    // Ganze Person: je Bild werden die Huellen der Spuren neu zusammengefasst (Spuren, die einander nahe kamen, werden eine Huelle), wie bei Bildern
    // (personenGruppen); die Huellen tragen schon ihren Rand, darum hier ohne zweiten. Behandlung: die der Koerper-Zonen des Presets.
    if (PRESETS[preset].person) {
      const art = ganzesBildBehandlung(preset);
      const huellen = personenGruppen(liste.map((e) => [e.rr.x, e.rr.y, e.rr.w, e.rr.h] as const), liste.map(() => true), c.width, c.height, 0);
      for (const [x, y, w, h] of huellen) {
        const rr = Zeichner.begrenze({ x, y, w, h }, c.width, c.height);
        if (!rr) continue;
        this.zeichner.flaeche(ctx, rr, art, { gesicht: null, wort: '' });
        if (this.testAn) this.merkeGemalt(art, rr, -1, -1);
      }
      return;
    }
    for (const { spur: s, rr } of liste) {
      const beh = wirksameBehandlung(preset, s.zone, s.behandlung);
      const g = beh === 'mia-gesicht' ? this.h.gesicht(s.motiv) : null;
      const gesichtPasst = !!g && patchPasst([0, 0, rr.w, rr.h], g.ausschnitt[2], g.ausschnitt[3], anzeige);
      const wort = brauchtWort(preset, s.zone, s.behandlung, s.ersatz) ? this.h.wort(s.motiv) : null;
      const art = stilFuerZone(preset, s.zone, {
        behandlung: s.behandlung,
        ersatz: s.ersatz,
        gesichtPasst,
        wortDa: !!wort,
        wortPasst: wortPasst(rr.w, rr.h, anzeige),
      });
      const ersatz = stilFuerZone(preset, s.zone, { behandlung: s.behandlung, ersatz: s.ersatz, gesichtPasst: false, wortDa: !!wort, wortPasst: wortPasst(rr.w, rr.h, anzeige) });
      const mittel: FlaechenMittel = { gesicht: art === 'mia-gesicht' ? g : null, wort: wort ?? '', ersatz };
      this.zeichner.flaeche(ctx, rr, art, mittel);
      if (this.testAn) this.merkeGemalt(art, rr, s.id, s.motiv);
    }
  }

  private merkeGemalt(art: string, rr: ZeichenRechteck, id: number, motiv: number): void {
    this.arten.push(art);
    this.malIds.push(id);
    this.malMotive.push(motiv);
    this.malRechtecke.push([rr.x, rr.y, rr.w, rr.h]);
  }

  // ---------- Lage und Groesse ----------

  // Lage des Hosts und Masse der Leinwand. Je Bild nur zwei Messungen: das Rechteck des Videos und (in legeAufRechteck) das des Hosts; verglichen wird
  // der Versatz Video minus Host und die Groesse, ein Scrollen (beide bewegen sich gleich) legt also nichts neu. Die Masse (getComputedStyle) wird
  // nur bei geaenderter Groesse und im Lage-Takt neu gerechnet.
  private pruefeLage(erzwingen = false): void {
    const el = this.el;
    if (!el.isConnected) return;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) {
      this.masse = null;
      return;
    }
    const alt = this.masse?.rect;
    const groesseGleich = !!alt && Math.abs(alt.width - rect.width) < 0.5 && Math.abs(alt.height - rect.height) < 0.5;
    const neuGelegt = legeAufRechteck(this.host, rect, istFestPositioniert(el), erzwingen);
    if (!this.masse || !groesseGleich || erzwingen) this.masse = this.berechneMasse(rect);
    else if (neuGelegt) this.masse = { ...this.masse, rect };
  }

  private berechneMasse(rect: DOMRect): Masse | null {
    const el = this.el;
    let cs: CSSStyleDeclaration;
    try {
      cs = getComputedStyle(el);
    } catch {
      return null;
    }
    const num = (s: string): number => Number.parseFloat(s) || 0;
    const offB = el.offsetWidth > 0 ? el.offsetWidth : rect.width;
    const offH = el.offsetHeight > 0 ? el.offsetHeight : rect.height;
    const sx = rect.width / offB;
    const sy = rect.height / offH;
    const padL = num(cs.paddingLeft);
    const padR = num(cs.paddingRight);
    const padT = num(cs.paddingTop);
    const padB = num(cs.paddingBottom);
    const innenB = Math.max(1, el.clientWidth - padL - padR);
    const innenH = Math.max(1, el.clientHeight - padT - padB);
    const passung = istObjektPassung(cs.objectFit) ? cs.objectFit : 'contain';
    const ir = inhaltsRechteck(innenB, innenH, el.videoWidth, el.videoHeight, passung, parsePosition(cs.objectPosition));
    // Leinwandgroesse: CSS-Groesse mal dpr, hoechstens Videoaufloesung im Inhaltsbereich und 1920.
    const cssB = rect.width;
    const cssH = rect.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const grenzeSeite = VIDEO_ZONEN_LEINWAND_MAX_SEITE / Math.max(cssB, cssH);
    const grenzeVideo = el.videoWidth / Math.max(1, ir.w * sx);
    const q = Math.max(0.05, Math.min(dpr, grenzeSeite, grenzeVideo));
    const cb = Math.max(1, Math.round(cssB * q));
    const ch = Math.max(1, Math.round(cssH * q));
    if (this.leinwand.width !== cb || this.leinwand.height !== ch) {
      this.leinwandLeer = true;
      this.leinwand.width = cb;
      this.leinwand.height = ch;
      this.schmutzig = true;
    }
    const ox = (el.clientLeft + padL + ir.x) * sx * q;
    const oy = (el.clientTop + padT + ir.y) * sy * q;
    // Spiegelung (scaleX(-1)): die Leinwand muss das Bild so zeigen wie das Video es zeigte. Drehung schliesst die Eignung aus.
    let flipX = false;
    let flipY = false;
    const tm = /^matrix\(([^)]*)\)$/.exec(cs.transform.trim());
    if (tm) {
      const w = tm[1]!.split(',').map((x) => Number(x));
      flipX = (w[0] ?? 1) < 0;
      flipY = (w[3] ?? 1) < 0;
    }
    // Hintergrund des Elements (z. B. schwarze Balken um ein contain-Video): das Video ist unsichtbar, sein Hintergrund mit ihm.
    const bg = cs.backgroundColor;
    const untergrund = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : null;
    return { rect, inhalt: { x: ox, y: oy, w: ir.w * sx * q, h: ir.h * sy * q }, flipX, flipY, untergrund, skala: q };
  }

  private setzeZ(): void {
    const z = zIndexFuerLeinwand(this.el);
    if (z === this.zuletztZ) return;
    this.zuletztZ = z;
    if (z === 'auto') this.host.style.removeProperty('z-index');
    else this.host.style.setProperty('z-index', z, 'important');
  }

  // Lagepflege im Takt: z-index des Videos, Lage (auch wenn kein neues Bild kommt, z. B. in der Pause), Bild-in-Bild-Sperre.
  private pflege(): void {
    if (this.tot) return;
    if (!this.h.lebt()) return;
    this.setzeZ();
    // Hat die Seite das Video umgehaengt (anderer Elternknoten, anderer Vorgaenger), zieht der Host mit: er steht immer direkt hinter dem Video.
    const eltern = this.el.parentNode;
    if (eltern && (this.host.parentNode !== eltern || this.host.previousSibling !== this.el)) {
      try {
        eltern.insertBefore(this.host, this.el.nextSibling);
        this.schmutzig = true;
      } catch {
        this.stoerung('umgehaengt');
        return;
      }
    }
    sperrePip(this.el, true, 'zonen');
    if (document.hidden) return;
    const vorher = this.masse;
    this.pruefeLage(true);
    if (this.masse && vorher !== this.masse) {
      this.schmutzig = true;
      this.planeMalen();
    }
  }

  // ---------- Testhaken ----------

  private setzeModus(): void {
    if (!this.testAn || !ATTR_VIDEO_MODUS) return;
    const text = this.ansicht === 'ganz' ? 'mosaik' : 'zonen';
    if (text === this.modusText) return;
    this.modusText = text;
    this.el.setAttribute(ATTR_VIDEO_MODUS, text);
  }

  private schreibeBoxen(jetzt: number, kanten: readonly Kanten[], m: Masse): void {
    if (!this.testAn || !ATTR_VIDEO_BOXEN || jetzt - this.boxenZeit < 60) return;
    this.boxenZeit = jetzt;
    const el = this.el;
    // Boxen in CSS-Pixeln des Fensters (zum Vergleichen mit Aufnahmen der Seite).
    const r = m.rect;
    const ir = m.inhalt;
    const q = this.leinwand.width / Math.max(1, r.width);
    const fx = ir.w / Math.max(1, el.videoWidth) / q;
    const fy = ir.h / Math.max(1, el.videoHeight) / q;
    const liste = kanten.map((k) => {
      const rr = kantenZuRechteck(k);
      return [Math.round(r.left + ir.x / q + rr.x * fx), Math.round(r.top + ir.y / q + rr.y * fy), Math.round(rr.w * fx), Math.round(rr.h * fy)];
    });
    // `flaechen`: die wirklich gemalten Rechtecke in CSS-Pixeln des Fensters (die Leinwand liegt auf dem Rechteck des Videos).
    const flaechen = this.malRechtecke.map((g) => [Math.round(r.left + g[0] / q), Math.round(r.top + g[1] / q), Math.round(g[2] / q), Math.round(g[3] / q)]);
    const text = JSON.stringify({ ansicht: this.ansicht, grund: this.grund, szene: this.szene, arten: this.arten, ids: this.malIds, motive: this.malMotive, flaechen, boxen: liste, mt: Math.round(this.letzteMt * 1000) / 1000 });
    if (text === this.boxenText) return;
    this.boxenText = text;
    el.setAttribute(ATTR_VIDEO_BOXEN, text);
  }

  // ---------- Ende ----------

  private stoerung(grund: string): void {
    if (this.tot) return;
    const z = this.h.zaehler;
    z.rueckfall.push(grund);
    if (z.rueckfall.length > 16) z.rueckfall.shift();
    this.h.beiStoerung(grund);
  }

  private hoere(ziel: EventTarget, name: string, fn: EventListener): void {
    ziel.addEventListener(name, fn);
    this.hoerer.push([ziel, name, fn]);
  }

  // Leinwand weg, Video wieder in der Hand der Seite (das Urteil des Schleiers setzt der Aufrufer).
  beende(): void {
    if (this.tot) return;
    this.tot = true;
    if (this.handle !== null) {
      try {
        if (this.handleArt === 'rvfc') this.el.cancelVideoFrameCallback(this.handle);
        else cancelAnimationFrame(this.handle);
      } catch {
        // Element schon weg
      }
    }
    this.handle = null;
    this.weckerAb?.();
    this.weckerAb = null;
    try {
      this.beob?.disconnect();
    } catch {
      // egal
    }
    this.beob = null;
    if (this.lageTimer) clearInterval(this.lageTimer);
    this.lageTimer = null;
    if (this.frist) clearTimeout(this.frist);
    this.frist = null;
    for (const [ziel, name, fn] of this.hoerer) ziel.removeEventListener(name, fn);
    this.hoerer.length = 0;
    // Reine Vorsorge: Der Verwalter legt nach dem Beenden ohnehin eine neue Leinwand mit neuer Spurliste an, kein Motiv geht an eine spaetere Leinwand weiter.
    this.spuren.vergiss();
    sperrePip(this.el, false, 'zonen');
    this.host.remove();
    this.el.removeAttribute(ATTR_LEINWAND);
    if (ATTR_VIDEO_MODUS) this.el.removeAttribute(ATTR_VIDEO_MODUS);
    if (ATTR_VIDEO_BOXEN) this.el.removeAttribute(ATTR_VIDEO_BOXEN);
    if (ATTR_VIDEO_LEER) this.el.removeAttribute(ATTR_VIDEO_LEER);
  }
}
