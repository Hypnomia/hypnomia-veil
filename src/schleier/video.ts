// Laufende Nachpruefung von Videos (PHASE-2-BAUPLAN 10.1): gedrosselter Einzelbild-Takt, Hysterese, Wechsel-Grenzen.
// Dieses Modul kennt weder den Erkenner noch die Attribute des Schleiers: Pruefung, Sichtbarkeit und Urteil setzen kommen ueber `VideoHaken`
// herein, die Grenzwerte ueber `VideoGrenzen` (Konstanten in konstanten.ts). Es importiert nur Typen, damit die reine Logik
// (Hysterese, Budget, Wechsel-Zeitpunkt) in den Einheitstests ohne Browser laeuft.

import type { Zustand } from './zustand';
import {
  bewerteStandbildPruefung,
  deckeZuBeiEreignis,
  deckeZuBeiNachschau,
  neuesStandbild,
  standbildBerechtigt,
  STAND_ABWEICHUNG_MAX,
  zeigtPoster,
  zeigtPosterAm,
  KOPIEN_MAX,
  STAND_EREIGNISSE,
  STAND_NACHSCHAU_MS,
  zaehlerBeiSeekingImStand,
  zaehlerNachZudecken,
  zaehltSauberImLaufenden,
  type StandAufnahme,
  type StandErgebnis,
  type StandFakten,
  type StandbildStand,
  type ZuGrund,
} from './video-standbild.ts';

export type VideoUrteil = 'frei' | 'verdeckt';
export type VideoErgebnis = 'treffer' | 'sauber' | 'fehler';

export interface VideoGrenzen {
  taktMs: number;
  budgetJeS: number;
  freiNach: number;
  wechselMinMs: number;
  blitzSperreMs: number;
  // Zonen-Video ("schnell"): kleinste Zeit zwischen zwei Pruefungen (die naechste startet sofort nach der Antwort, nur diese Untergrenze gegen
  // Leerlauf-Schleifen). Optional, Standard 15 ms.
  schnellMs?: number;
  // Freie Videos: nach einem erkannten Schnitt fruehestens so lange nach der letzten Pruefung die Sofortpruefung (V2). Optional, Standard 300 ms.
  schnittMinMs?: number;
}

// Eine gemalte Kopie des Standbilds (video-kopie.ts).
export interface KopieHandle {
  daumen(): Float32Array | null;
  intakt(): boolean;
  pflege(): boolean;
  zeige(): void;
  entferne(): void;
}

export interface VideoHaken {
  // Der Schleier ist an (weder Pause noch Ausnahme, nicht abgebaut).
  aktiv(): boolean;
  sichtbar(el: HTMLVideoElement, z: Zustand): boolean;
  // Liest das aktuelle Einzelbild und fragt den Erkenner. 'unlesbar' (kein Pixelzugriff) zaehlt wie ein Fehler.
  pruefe(el: HTMLVideoElement): Promise<VideoErgebnis | 'unlesbar'>;
  // Eine Video-Pruefung beginnt (im selben Augenblick, in dem das Budget sie zaehlt): Zaehler und Zeitstempel des Testhakens.
  beiStart(art: 'erst' | 'takt', zeit: number): void;
  // Die Frist einer Nachpruefung ist abgelaufen (Zaehler des Testhakens).
  beiFrist(): void;
  // Was das Element gerade wirklich zeigt (Attribut data-veil), unabhaengig vom Urteil im Zustand: ein vorlaeufig verdecktes Video zeigt
  // "verdeckt", obwohl sein Urteil noch leer ist. null = verborgen.
  angezeigt(el: HTMLVideoElement, z: Zustand): VideoUrteil | null;
  // Das Lauf-Ende traf ein noch nicht gezeigtes Urteil (Element entfernt, Lauf abgebrochen): das Video muss spaeter neu bewertet werden koennen.
  beendet(el: HTMLVideoElement, z: Zustand): void;
  // Das Erst-Urteil war noch nicht gezeigt, als das Bild sich aenderte (Sprung, emptied): verwerfen und das Video neu beurteilen.
  verwirf(el: HTMLVideoElement, z: Zustand): void;
  // Setzt das Urteil am Element (Attribut, Status) und zaehlt den Wechsel. Ist z.urteil noch leer, ist es das Erst-Urteil des Videos
  // (ein Wechsel nur, wenn das Attribut nicht schon so steht).
  wende(el: HTMLVideoElement, z: Zustand, urteil: VideoUrteil): void;
  // Optional (V2): jedes gezeigte Bild eines laufenden freien Videos. true = Schnitt erkannt (Szenenwechsel), dann kommt die Sofortpruefung.
  beiBild?(el: HTMLVideoElement, z: Zustand): boolean;
  // Optional (Zonen-Leinwand): darf ein verdecktes Video jetzt frei werden? false haelt es verdeckt (Zonen-Video: erst nach 3 s Medienzeit ohne Treffer).
  haelt?(el: HTMLVideoElement, z: Zustand): boolean;
  // Optional (Testhaken): der Zaehler sauberer Pruefungen des Videos hat sich geaendert (null = der Lauf ist zu Ende).
  beiSauber?(el: HTMLVideoElement, sauber: number | null): void;
  // Optional (Pause nach Regel S2, E3c): hat das Video eine Zonen-Leinwand? Fehlt der Haken, gilt "ja" (keine Pause-Pruefung).
  hatLeinwand?(el: HTMLVideoElement): boolean;
  // Optional (E3c): Daumen des gerade gezeigten Bilds (im selben Augenblick wie das Lesen der Pixel). null = nicht lesbar.
  daumen?(el: HTMLVideoElement): Float32Array | null;
  // Optional (E3c): sind zwei Daumen dasselbe Bild?
  daumenGleich?(a: Float32Array, b: Float32Array): boolean;
  // Optional (E3c Runde 1, Regel K5): gilt die technische Eignung der Zonen-Leinwand (lesbar, kein DRM, keine controls, keine Untertitel, kein Spiegel, nicht gedreht,
  // nicht im Vollbild, gross genug, keine Vorschau), unabhaengig von der Einstellung `video` und vom Platz? Fehlt der Haken, gilt "nein" (keine Kopie).
  kopieEignung?(el: HTMLVideoElement): boolean;
  // Optional (E3c Runde 1, K2): malt die Kopie des gezeigten Bilds (Host unsichtbar). null = nicht moeglich. `beiAenderung`: Groesse oder Lage haben sich geaendert.
  kopieMale?(el: HTMLVideoElement, beiAenderung: () => void): KopieHandle | null;
  // Optional: die Kopie wurde gezeigt oder weggenommen (das Etikett richtet sich danach).
  beiKopie?(el: HTMLVideoElement, z: Zustand): void;
}

// ---------- reine Logik ----------

export interface HystereseStand {
  soll: VideoUrteil;
  // Saubere Pruefungen in Folge, solange das Video verdeckt ist.
  sauber: number;
}

// Treffer bei frei: sofort verdeckt. Bei verdeckt erst nach `freiNach` sauberen Pruefungen in Folge wieder frei, ein Treffer setzt den
// Zaehler zurueck. Fehler und "nicht lesbar": verdeckt, ohne Zaehlerfortschritt (die Folge ist unterbrochen).
export function entscheideHysterese(stand: HystereseStand, ergebnis: VideoErgebnis, freiNach: number): HystereseStand {
  if (ergebnis !== 'sauber') return { soll: 'verdeckt', sauber: 0 };
  if (stand.soll === 'frei') return { soll: 'frei', sauber: 0 };
  const sauber = stand.sauber + 1;
  return sauber >= freiNach ? { soll: 'frei', sauber: 0 } : { soll: 'verdeckt', sauber };
}

// Gleitendes Zeitfenster: hoechstens `max` Starts in `fensterMs`.
export class Budget {
  private readonly starts: number[] = [];

  private readonly max: number;
  private readonly fensterMs: number;

  constructor(max: number, fensterMs = 1000) {
    this.max = max;
    this.fensterMs = fensterMs;
  }

  private bereinige(jetzt: number): void {
    while (this.starts.length && jetzt - this.starts[0]! >= this.fensterMs) this.starts.shift();
  }

  nimm(jetzt: number): void {
    this.bereinige(jetzt);
    this.starts.push(jetzt);
  }

  // Millisekunden, bis ein Start erlaubt ist (0 = jetzt).
  wartezeit(jetzt: number): number {
    this.bereinige(jetzt);
    if (this.starts.length < this.max) return 0;
    return Math.max(0, this.starts[this.starts.length - this.max]! + this.fensterMs - jetzt);
  }
}

// Frueheste Zeit, zu der ein Urteil gezeigt werden darf (PHASE-2-BAUPLAN 10.5): Verdecken immer sofort. Freigeben fruehestens `wechselMinMs`
// nach dem letzten Wechsel dieses Videos und `blitzSperreMs` nach der letzten Freigabe im Dokument.
export function fruehestensWechsel(ziel: VideoUrteil, letzterWechsel: number, letzteFreigabe: number, g: Pick<VideoGrenzen, 'wechselMinMs' | 'blitzSperreMs'>): number {
  if (ziel === 'verdeckt') return Number.NEGATIVE_INFINITY;
  return Math.max(letzterWechsel + g.wechselMinMs, letzteFreigabe + g.blitzSperreMs);
}

// Der Umlauf eines Videos mit loop (vom Ende an den Anfang) loest seeking und seeked aus, ist aber kein Sprung des Nutzers.
export function istSchleifenUmlauf(el: HTMLVideoElement): boolean {
  return el.loop && !el.paused && el.currentTime < 0.1;
}

// ---------- Takt je Video ----------

type Frist = ReturnType<typeof setTimeout>;

// Was je Video-Element ueber Quellenwechsel und Lauf-Ende hinaus bekannt bleibt (WeakMap): der letzte Wechsel des Urteils, der Beginn der
// letzten Pruefung und eine noch laufende Pruefung. So gibt es auch nach einem Quellenwechsel oder einer Wiederaufnahme nie zwei
// Pruefungen desselben Videos zugleich, nie mehr als eine je Taktzeit und nie zwei Freigaben unter `wechselMinMs`.
interface ElementStand {
  letzterWechsel: number;
  letzterStart: number;
  unterwegs: boolean;
  // Erledigt sich, wenn die laufende Pruefung endet.
  ende: Promise<void> | null;
  // Ein Lauf wartet auf das Ende der laufenden Pruefung eines frueheren Laufs.
  nach: (() => void) | null;
  // Nummer der laufenden Pruefung: das Ende einer abgeloesten (haengenden) Pruefung darf die neuere nicht als beendet melden.
  nr: number;
}

export interface VideoLauf {
  readonly el: HTMLVideoElement;
  readonly z: Zustand;
  // Stand der Hysterese: das, was entschieden ist. Das angezeigte Urteil (z.urteil) zieht nach, sobald die Wechsel-Grenzen es erlauben.
  soll: VideoUrteil;
  sauber: number;
  readonly stand: ElementStand;
  // Eine Pruefung dieses Laufs ist unterwegs.
  laeuft: boolean;
  // Waehrend einer Pruefung kam ein Anlass (seeked, play): danach noch einmal pruefen.
  nochmal: boolean;
  // Eine Sofortpruefung ist geschuldet (seeked, play, Sichtbarwerden).
  sofortOffen: boolean;
  // Ein Anlass kam, als das Video nicht pruefbar war (unsichtbar, Tab verdeckt): beim Sichtbarwerden nachholen.
  verpasst: boolean;
  // Die Frist der laufenden Pruefung ist abgelaufen (haengender Erkenner): das Video wurde verdeckt, die Antwort wird nicht mehr gewertet.
  verfallen: boolean;
  fristTimer: Frist | null;
  armiert: boolean;
  timer: Frist | null;
  handle: number | null;
  fruehTimer: Frist | null;
  wechselTimer: Frist | null;
  tot: boolean;
  readonly rvfc: boolean;
  readonly hoerer: Array<[string, (e: Event) => void, boolean]>;
  // Zonen-Video: die naechste Pruefung startet mit dem naechsten Bild nach der Antwort (kein fester Takt, nicht im Budget). Der Bildtakt
  // kommt dann von der Leinwand (`bildBereit`), nicht von diesem Modul.
  schnell: boolean;
  // Ein Schnitt wurde erkannt: die Sofortpruefung darf schon nach `schnittMinMs` statt nach `taktMs` folgen.
  schnitt: boolean;
  // Rueckrufschleife der Schnitterkennung (nur freie, laufende Videos mit rVFC).
  waechterHandle: number | null;
  // ---- Pause nach Regel S2 (E3c, video-standbild.ts) ----
  // Das Standbild, das gerade geprueft wird (eigener Zaehler, nicht `sauber`), oder null.
  standbild: StandbildStand | null;
  // Die Kopie des Standbilds (K1): nach der dritten sauberen Pruefung gemalt, gezeigt unter den Bremsen jeder Freigabe. Das Urteil des Videos bleibt `verdeckt`.
  kopie: KopieStand | null;
  // Aufnahme der laufenden Standbild-Pruefung (null = die laufende Pruefung ist eine gewoehnliche).
  standAufnahme: StandAufnahme | null;
  // Stand des Videos beim Start der laufenden Pruefung: stand es schon, galt die Pruefung (auch eine gewoehnliche, etwa nach einem Sprung) genau diesem Bild.
  startStand: { steht: boolean; lief: boolean; ct: number } | null;
  // Nachschau im Takt und Bildwaechter, solange `kopie` besteht.
  standNachschau: ReturnType<typeof setInterval> | null;
  standWaechter: number | null;
  // Zaehlt loadstart und emptied (Quellenwechsel).
  epoche: number;
}

interface KopieStand {
  h: KopieHandle;
  ct: number;
  epoche: number;
  quelle: string;
  gezeigt: boolean;
  // Wartet auf die Bremse der Freigabe (Mindestabstand, Blitz-Sperre).
  timer: Frist | null;
}

export class VideoTakt {
  private readonly laeufe = new Set<VideoLauf>();
  private readonly faellig = new Set<VideoLauf>();
  private readonly staende = new WeakMap<HTMLVideoElement, ElementStand>();
  private readonly budget: Budget;
  private letzteFreigabe = Number.NEGATIVE_INFINITY;
  private budgetTimer: Frist | null = null;
  private dokumentHoerer = false;
  private readonly beiDokumentSicht = (): void => {
    for (const lauf of [...this.laeufe]) {
      if (document.visibilityState === 'visible') this.sichtGeaendert(lauf);
      else this.entwaffne(lauf);
    }
  };

  private readonly haken: VideoHaken;
  // Testhaken (nur ueber den Testbau gesetzt): kein Bildwaechter fuer die Kopie, sie geht dann nur ueber Ereignisse und Nachschau.
  private ohneBildwaechter = false;
  private readonly fensterHoerer: Array<[string, (ev: Event) => void]> = [];
  private readonly g: VideoGrenzen;

  // Rueckrufe fuer Spiegel-Leinwaende (spiegel.ts, gesetzt vom Schleier): `beiWechsel` unmittelbar nach jedem Urteilswechsel im Takt (im selben
  // Augenblick, also ohne eigene Bremse), `beiErgebnis` bei jedem Ergebnis einer Takt-Pruefung (auch ohne Wechsel, vor der Entscheidung), damit
  // die Zuordnung der Leinwaende neu vermessen wird.
  beiWechsel: ((el: HTMLVideoElement, z: Zustand) => void) | null = null;
  beiErgebnis: ((el: HTMLVideoElement, z: Zustand) => void) | null = null;

  constructor(haken: VideoHaken, g: VideoGrenzen) {
    this.haken = haken;
    this.g = g;
    this.budget = new Budget(g.budgetJeS);
    // Fruehe Horcher am Fenster (Capture, ab Start des Content-Scripts, vor jedem Skript der Seite): die Seite kann diese Ereignisse dort nicht mehr vor uns stoppen (M2).
    // Dazu je Video ein Horcher am Element (Shadow Roots: dorthin reicht das Fenster nicht).
    for (const name of STAND_EREIGNISSE) {
      const fn = (ev: Event): void => this.beiFensterEreignis(ev);
      window.addEventListener(name, fn, true);
      this.fensterHoerer.push([name, fn]);
    }
  }

  setzeOhneBildwaechter(aus: boolean): void {
    this.ohneBildwaechter = aus;
  }

  // Endgueltiger Abbau des Schleiers (R3): alle Laeufe enden und die Horcher am Fenster gehen.
  abbauen(): void {
    this.stoppAlle();
    for (const [name, fn] of this.fensterHoerer) window.removeEventListener(name, fn, true);
    this.fensterHoerer.length = 0;
  }

  private beiFensterEreignis(ev: Event): void {
    const el = ev.target;
    if (!(el instanceof HTMLVideoElement)) return;
    for (const lauf of this.laeufe) if (lauf.el === el) return this.beiStandEreignis(lauf, ev.type);
  }

  private standVon(el: HTMLVideoElement): ElementStand {
    let s = this.staende.get(el);
    if (!s) {
      s = { letzterWechsel: Number.NEGATIVE_INFINITY, letzterStart: Number.NEGATIVE_INFINITY, unterwegs: false, ende: null, nach: null, nr: 0 };
      this.staende.set(el, s);
    }
    return s;
  }

  // Der Schleier hat das Urteil des Videos gesetzt oder verworfen (Erst-Urteil, Verbergen beim Quellenwechsel): zaehlt als Wechsel.
  merkeWechsel(el: HTMLVideoElement): void {
    this.standVon(el).letzterWechsel = performance.now();
  }

  // Erste Pruefung eines Videos (ausserhalb des Takts): sie zaehlt im Budget mit, wartet aber nicht darauf (einmalige Kosten wie bei Bildern,
  // begrenzt durch die parallelen Anfragen des Schleiers); die Nachpruefung laufender Videos weicht ihr. Der Taktabstand VIDEO_TAKT_MS gilt
  // fuer sie nicht. Laeuft fuer dasselbe Video noch eine Pruefung (auch eines frueheren Laufs), wartet sie deren Ende ab, hoechstens
  // `fristMs` (haengender Erkenner). Danach muss `pruefbar` noch gelten (Schleier an, Lauf nicht abgebaut, Generation gleich, Bilddaten
  // da), sonst gibt es 'kein': keine Anfrage und kein Budget.
  async pruefung<T>(el: HTMLVideoElement, pruefbar: () => boolean, fn: () => Promise<T>): Promise<T | 'kein'> {
    const s = this.standVon(el);
    const grenze = performance.now() + this.g.taktMs * 2;
    while (s.ende && performance.now() < grenze) {
      let uhr: Frist | undefined;
      const frist = new Promise<void>((fertig) => {
        uhr = setTimeout(fertig, Math.max(0, grenze - performance.now()));
      });
      await Promise.race([s.ende, frist]);
      clearTimeout(uhr);
    }
    if (!pruefbar()) return 'kein';
    return this.fuehreAus(s, 'erst', fn);
  }

  // Startet eine Pruefung: Budget, Beginn und "unterwegs" gelten je Element. fn laeuft sofort (der Pixelzugriff geschieht im selben Takt).
  private fuehreAus<T>(s: ElementStand, art: 'erst' | 'takt', fn: () => Promise<T>, imBudget = true): Promise<T> {
    const jetzt = performance.now();
    const nr = ++s.nr;
    s.unterwegs = true;
    s.letzterStart = jetzt;
    if (imBudget) this.budget.nimm(jetzt);
    this.haken.beiStart(art, jetzt);
    let p: Promise<T>;
    try {
      p = fn();
    } catch (fehler) {
      p = Promise.reject(fehler);
    }
    const fertig = (): void => {
      if (s.nr !== nr) return; // eine neuere Pruefung hat diese abgeloest
      s.unterwegs = false;
      s.ende = null;
      const nach = s.nach;
      s.nach = null;
      nach?.();
    };
    const q = p.then(
      (wert) => {
        fertig();
        return wert;
      },
      (fehler) => {
        fertig();
        throw fehler;
      },
    );
    s.ende = q.then(
      () => undefined,
      () => undefined,
    );
    return q;
  }

  // Nach der ersten echten Pruefung: das Video laeuft ab jetzt im Takt. `ziel` ist das Erst-Urteil (oder das schon gezeigte Urteil bei
  // Wiederaufnahme); es wird unter den Wechsel-Grenzen gezeigt: Verdecken sofort, Freigeben gebremst.
  registriere(el: HTMLVideoElement, z: Zustand, ziel: VideoUrteil): void {
    if (z.video) this.beendeLauf(z.video);
    // E3d (P1): ein Video, das sein Poster zeigt (poster-Attribut, nie gespielt), wird nie frei: das Erst-Urteil ist `verdeckt`.
    if (ziel === 'frei' && zeigtPosterAm(el)) ziel = 'verdeckt';
    const lauf: VideoLauf = {
      el,
      z,
      soll: ziel,
      sauber: 0,
      stand: this.standVon(el),
      laeuft: false,
      nochmal: false,
      sofortOffen: false,
      verpasst: false,
      verfallen: false,
      fristTimer: null,
      armiert: false,
      timer: null,
      handle: null,
      fruehTimer: null,
      wechselTimer: null,
      tot: false,
      rvfc: typeof (el as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function',
      hoerer: [],
      schnell: false,
      schnitt: false,
      waechterHandle: null,
      standbild: null,
      kopie: null,
      standAufnahme: null,
      startStand: null,
      standNachschau: null,
      standWaechter: null,
      epoche: 0,
    };
    z.video = lauf;
    this.laeufe.add(lauf);
    const auf = (name: string, fn: () => void): void => {
      el.addEventListener(name, fn);
      lauf.hoerer.push([name, fn, false]);
    };
    // Fruehe Horcher (Capture, vor allen anderen am Video) fuer die Pause-Pruefung: sie decken im selben Schritt wieder zu (Punkt 5 der Regel).
    for (const name of STAND_EREIGNISSE) {
      const fn = (ev: Event): void => this.beiStandEreignis(lauf, ev.type);
      el.addEventListener(name, fn, true);
      lauf.hoerer.push([name, fn, true]);
    }
    auf('play', () => this.sofort(lauf));
    auf('playing', () => this.plane(lauf));
    auf('pause', () => this.beiStopp(lauf));
    auf('ended', () => this.beiStopp(lauf));
    auf('emptied', () => {
      this.verwirfWartendeFreigabe(lauf);
      this.entwaffne(lauf);
    });
    // Schon beim Beginn eines Sprungs eine wartende Freigabe verwerfen: feuerte ihr Timer zwischen seeking und seeked, zeigte sie das neue,
    // ungepruefte Bild mit dem Urteil zum alten frei (Gegencheck Session 5).
    auf('seeking', () => {
      if (z.schleife) return;
      this.verwirfWartendeFreigabe(lauf);
    });
    auf('seeked', () => {
      // Der Zaehler z.sprung steht im Zustand (der Schleier zaehlt seeking und seeked schon vor dem ersten Urteil); der Umlauf bei loop ist kein Sprung.
      if (z.schleife) return;
      this.verwirfWartendeFreigabe(lauf);
      this.standbildPlane(lauf); // im Stand: das neue Standbild wird neu geprueft (E3c)
      this.sofort(lauf);
    });
    if (!lauf.rvfc) auf('timeupdate', () => this.beiZeit(lauf));
    if (!this.dokumentHoerer) {
      this.dokumentHoerer = true;
      document.addEventListener('visibilitychange', this.beiDokumentSicht);
    }
    this.meldeSauber(lauf);
    this.gleicheAn(lauf);
    this.plane(lauf);
    this.standbildPlane(lauf); // schon pausiert (zum Beispiel nie gespielt, ohne Poster): das Standbild wird geprueft
  }

  // Der Schleier hat das Urteil verworfen oder das Element geht weg: Takt, Timer und Hoerer enden.
  beende(z: Zustand): void {
    if (z.video) this.beendeLauf(z.video);
  }

  stoppAlle(): void {
    for (const lauf of [...this.laeufe]) this.beendeLauf(lauf);
  }

  // Aus dem Dokument entfernte Videos nicht festhalten.
  raeumeEntfernteAuf(): void {
    for (const lauf of [...this.laeufe]) if (!lauf.el.isConnected) this.beendeLauf(lauf);
  }

  // Die Sichtbarkeit des Videos hat sich geaendert (IntersectionObserver des Schleiers).
  sichtGeaendert(lauf: VideoLauf): void {
    if (lauf.tot) return;
    if (!this.haken.sichtbar(lauf.el, lauf.z) || document.visibilityState !== 'visible') {
      this.entwaffne(lauf);
      return;
    }
    // Sichtbar geworden: ein laufendes Video (oder ein verpasster Sprung) wird sofort neu geprueft.
    if (lauf.verpasst || (!lauf.el.paused && !lauf.el.ended)) {
      lauf.verpasst = false;
      this.alsFaellig(lauf, true);
    } else {
      this.plane(lauf);
      this.standbildPlane(lauf);
    }
  }

  // ---------- Ausloeser ----------

  private sofort(lauf: VideoLauf): void {
    if (lauf.tot) return;
    this.alsFaellig(lauf, true);
  }

  // pause und ended: der Takt endet; eine geschuldete Sofortpruefung (zum Beispiel nach einem Sprung kurz vor dem Anhalten) bleibt geschuldet.
  private beiStopp(lauf: VideoLauf): void {
    const offen = lauf.sofortOffen;
    this.entwaffne(lauf);
    if (offen && !lauf.tot) {
      lauf.verpasst = false;
      this.alsFaellig(lauf, true);
    }
    this.standbildPlane(lauf); // E3c: im Stand wird das Standbild geprueft (nur unter den Bedingungen der Regel)
  }

  private beiZeit(lauf: VideoLauf): void {
    if (lauf.tot || !lauf.armiert || lauf.schnell) return;
    // V2 ohne requestVideoFrameCallback (Firefox 128): die Schnitterkennung laeuft mit jedem timeupdate.
    if (lauf.soll === 'frei' && this.haken.beiBild?.(lauf.el, lauf.z)) this.schnittMelden(lauf);
    if (performance.now() - lauf.stand.letzterStart < this.g.taktMs) return;
    this.alsFaellig(lauf, false);
  }

  // ---------- Zonen-Video und Schnitt ----------

  // Das Video bekommt die Zonen-Leinwand (oder verliert sie): ab jetzt bestimmt der Bildtakt der Leinwand die Pruefungen (`bildBereit`).
  setzeSchnell(el: HTMLVideoElement, an: boolean): void {
    const lauf = [...this.laeufe].find((l) => l.el === el);
    if (!lauf || lauf.schnell === an) return;
    lauf.schnell = an;
    if (an) this.kopieWeg(lauf, 'play'); // K7/K4: ein Video, das die Leinwand bekommt, verliert zuerst seine Kopie
    this.entwaffne(lauf);
    if (!an) this.plane(lauf);
    else if (!lauf.laeuft) this.armiere(lauf);
  }

  // Die Leinwand hat das naechste Bild analysiert: eine Pruefung darf starten, wenn keine laeuft und die Untergrenze verstrichen ist.
  bildBereit(el: HTMLVideoElement): void {
    const lauf = [...this.laeufe].find((l) => l.el === el);
    if (!lauf || lauf.tot || !lauf.schnell || !lauf.armiert || lauf.laeuft) return;
    if (performance.now() - lauf.stand.letzterStart < (this.g.schnellMs ?? 15)) return;
    this.alsFaellig(lauf, false);
  }

  // Steht die Hysterese kurz vor der Freigabe (frei, oder nur noch eine saubere Pruefung fehlt)? Fuer die Leinwand: ein Bild ohne Spur darf erst dann klar bleiben.
  freigabeReif(el: HTMLVideoElement): boolean {
    const lauf = [...this.laeufe].find((l) => l.el === el);
    return !lauf || lauf.soll === 'frei' || lauf.sauber >= this.g.freiNach - 1;
  }

  // Die Leinwand endet ohne Freigabe (Rueckfall, Platzverlust, P7): der Zaehler sauberer Pruefungen steht danach auf 0, eine geplante Freigabe
  // (soll frei, wartet auf die Bremse) entfaellt. Das Video braucht danach wieder drei saubere Pruefungen in Folge. Nie fuer die Freigabe selbst.
  verwirfFreigabe(el: HTMLVideoElement): void {
    const lauf = [...this.laeufe].find((l) => l.el === el);
    if (!lauf || lauf.tot) return;
    lauf.soll = 'verdeckt';
    lauf.sauber = 0;
    if (lauf.wechselTimer) clearTimeout(lauf.wechselTimer);
    lauf.wechselTimer = null;
    this.meldeSauber(lauf);
  }

  private meldeSauber(lauf: VideoLauf): void {
    this.haken.beiSauber?.(lauf.el, lauf.sauber);
  }

  // Sofortpruefung auf Wunsch der Leinwand (Schnitt, Sprung, Pause).
  sofortFuer(el: HTMLVideoElement): void {
    const lauf = [...this.laeufe].find((l) => l.el === el);
    if (!lauf || lauf.tot) return;
    this.alsFaellig(lauf, true);
  }

  // Schnitt in einem freien Video erkannt (V2): Sofortpruefung, fruehestens `schnittMinMs` nach der letzten Pruefung.
  private schnittMelden(lauf: VideoLauf): void {
    if (lauf.tot || lauf.schnell) return;
    lauf.schnitt = true;
    this.alsFaellig(lauf, true);
  }

  // Rueckrufschleife der Schnitterkennung: jedes gezeigte Bild eines laufenden, freien Videos (nur mit Rueckruf des Schleiers).
  private starteWaechter(lauf: VideoLauf): void {
    // Nur fuer freie Videos: ein verdecktes Video wird ohnehin laufend geprueft (und hat sein Urteil), die Daumen kosten sonst nur.
    if (!this.haken.beiBild || !lauf.rvfc || lauf.waechterHandle !== null || lauf.schnell || lauf.soll !== 'frei') return;
    const schritt = (): void => {
      lauf.waechterHandle = null;
      if (lauf.tot || !lauf.armiert || lauf.schnell || lauf.soll !== 'frei') return;
      try {
        if (this.haken.beiBild?.(lauf.el, lauf.z)) this.schnittMelden(lauf);
        if (!lauf.tot && lauf.armiert && !lauf.schnell && lauf.soll === 'frei') lauf.waechterHandle = lauf.el.requestVideoFrameCallback(schritt);
      } catch {
        // Element weg oder Bild nicht lesbar: keine Schnitterkennung mehr, der Takt prueft weiter
      }
    };
    try {
      lauf.waechterHandle = lauf.el.requestVideoFrameCallback(schritt);
    } catch {
      lauf.waechterHandle = null;
    }
  }

  // Ist das Video jetzt pruefbar? Im Takt nur, solange es laeuft; Sofortpruefungen gelten auch im Stand (seeked).
  private berechtigt(lauf: VideoLauf, sofort: boolean): boolean {
    const el = lauf.el;
    if (!this.haken.aktiv() || !el.isConnected) return false;
    if (document.visibilityState !== 'visible') return false;
    if (!this.haken.sichtbar(el, lauf.z)) return false;
    if (el.readyState < 2 || !(el.videoWidth > 0)) return false;
    if (!sofort && (el.paused || el.ended)) return false;
    return true;
  }

  // Stellt den Takt passend zum Zustand des Videos ein: pruefbar und laufend = scharf, sonst aus.
  private plane(lauf: VideoLauf): void {
    if (lauf.tot) return;
    if (!lauf.el.isConnected) return this.beendeLauf(lauf);
    if (lauf.laeuft || lauf.armiert || this.faellig.has(lauf)) return;
    if (!this.berechtigt(lauf, false)) return;
    this.armiere(lauf);
  }

  // Scharf stellen: nach Ablauf der Taktzeit auf das naechste gezeigte Einzelbild warten (requestVideoFrameCallback) oder, ohne die
  // Schnittstelle (Firefox 128), auf das naechste timeupdate (beiZeit).
  private armiere(lauf: VideoLauf): void {
    lauf.armiert = true;
    if (lauf.schnell) return; // Zonen-Video: der Bildtakt der Leinwand startet die Pruefungen (bildBereit)
    this.starteWaechter(lauf);
    if (!lauf.rvfc) return;
    const warte = Math.max(0, lauf.stand.letzterStart + this.g.taktMs - performance.now());
    lauf.timer = setTimeout(() => {
      lauf.timer = null;
      if (lauf.tot || !lauf.armiert) return;
      lauf.handle = lauf.el.requestVideoFrameCallback(() => {
        lauf.handle = null;
        if (lauf.tot || !lauf.armiert) return;
        this.alsFaellig(lauf, false);
      });
    }, warte);
  }

  // Der Takt (Timer, Bildrueckruf) und eine aufgeschobene Sofortpruefung enden. Eine geschuldete Sofortpruefung gilt dann als verpasst.
  private entwaffne(lauf: VideoLauf): void {
    lauf.armiert = false;
    if (lauf.timer) clearTimeout(lauf.timer);
    lauf.timer = null;
    if (lauf.fruehTimer) {
      clearTimeout(lauf.fruehTimer);
      lauf.fruehTimer = null;
      if (lauf.sofortOffen) {
        lauf.sofortOffen = false;
        lauf.verpasst = true;
      }
    }
    if (lauf.handle !== null) {
      try {
        lauf.el.cancelVideoFrameCallback(lauf.handle);
      } catch {
        // Element schon weg: nichts abzubrechen
      }
    }
    lauf.handle = null;
    if (lauf.waechterHandle !== null) {
      try {
        lauf.el.cancelVideoFrameCallback(lauf.waechterHandle);
      } catch {
        // Element schon weg
      }
    }
    lauf.waechterHandle = null;
  }

  private alsFaellig(lauf: VideoLauf, sofort: boolean): void {
    if (lauf.tot) return;
    const offen = lauf.sofortOffen;
    this.entwaffne(lauf);
    if (offen) lauf.sofortOffen = true; // entwaffne hat den aufgeschobenen Anlass als verpasst gebucht: er wird hier ja gleich neu eingereiht
    if (lauf.laeuft) {
      if (sofort) lauf.nochmal = true;
      return;
    }
    if (sofort) lauf.sofortOffen = true;
    lauf.verpasst = false;
    this.faellig.add(lauf);
    this.verteile();
  }

  // ---------- Verteilen: aelteste letzte Pruefung zuerst, Budget je Dokument ----------

  private verteile(): void {
    let wartezeit = 0;
    const liste = [...this.faellig].sort((a, b) => a.stand.letzterStart - b.stand.letzterStart);
    for (const lauf of liste) {
      const jetzt = performance.now(); // jede Pruefung kostet Zeit (Pixel lesen): die Uhr je Video neu lesen
      if (lauf.tot) {
        this.faellig.delete(lauf);
        continue;
      }
      if (!this.berechtigt(lauf, lauf.sofortOffen)) {
        this.faellig.delete(lauf);
        if (lauf.sofortOffen) lauf.verpasst = true;
        lauf.sofortOffen = false;
        continue;
      }
      if (lauf.stand.unterwegs) {
        // Eine Pruefung dieses Videos aus einem frueheren Lauf ist noch offen: danach erst weiter.
        this.faellig.delete(lauf);
        lauf.stand.nach = () => this.alsFaellig(lauf, false);
        continue;
      }
      const abstand = lauf.schnell ? (this.g.schnellMs ?? 15) : lauf.schnitt ? (this.g.schnittMinMs ?? 300) : this.g.taktMs;
      const fruehestens = lauf.stand.letzterStart + abstand;
      if (jetzt < fruehestens) {
        // Zu bald nach der letzten Pruefung dieses Videos: nie oefter als einmal je Taktzeit.
        this.faellig.delete(lauf);
        if (!lauf.fruehTimer) {
          lauf.fruehTimer = setTimeout(() => {
            lauf.fruehTimer = null;
            this.alsFaellig(lauf, false);
          }, fruehestens - jetzt + 1);
        }
        continue;
      }
      // Das Zonen-Video steht ausserhalb des Budgets (hoechstens eines je Dokument, es soll so oft pruefen, wie der Erkenner schafft).
      const w = lauf.schnell ? 0 : this.budget.wartezeit(jetzt);
      if (w > 0) {
        wartezeit = wartezeit === 0 ? w : Math.min(wartezeit, w);
        continue; // bleibt faellig; dank der Sortierung kommt beim naechsten Platz das aelteste zuerst
      }
      this.faellig.delete(lauf);
      this.starte(lauf);
    }
    if (this.budgetTimer) {
      clearTimeout(this.budgetTimer);
      this.budgetTimer = null;
    }
    if (this.faellig.size && wartezeit > 0) {
      this.budgetTimer = setTimeout(() => {
        this.budgetTimer = null;
        this.verteile();
      }, wartezeit + 1);
    }
  }

  private starte(lauf: VideoLauf): void {
    lauf.laeuft = true;
    lauf.verfallen = false;
    lauf.sofortOffen = false;
    lauf.nochmal = false;
    lauf.schnitt = false;
    const sprung = lauf.z.sprung;
    const generation = lauf.z.generation;
    // E3c: gilt diese Pruefung dem Standbild? Dann wird im selben Augenblick, in dem die Pixel gelesen werden (fuehreAus ruft die Pruefung sofort), der Daumen
    // des gezeigten Bilds aufgenommen. Ob die Pruefung zaehlt, entscheidet erst die Antwort (bewerteStandbildPruefung).
    lauf.standAufnahme = this.standAufnahmeJetzt(lauf);
    lauf.startStand = { steht: lauf.el.paused || lauf.el.ended, lief: !lauf.el.paused && !lauf.el.ended && !lauf.el.seeking, ct: lauf.el.currentTime };
    // Frist: bleibt die Antwort ueber 2 Taktzeiten aus (haengender Erkenner), gilt das wie ein Fehler: sofort verdecken. Eine zweite
    // Anfrage startet erst, wenn diese beendet ist (laeuft bleibt gesetzt); ihre spaete Antwort wird nicht mehr gewertet.
    lauf.fristTimer = setTimeout(() => {
      lauf.fristTimer = null;
      if (lauf.tot || !lauf.laeuft || lauf.verfallen) return;
      lauf.verfallen = true;
      this.haken.beiFrist();
      if (lauf.standAufnahme) {
        // Haengende Pruefung eines Standbilds: das Standbild bleibt verdeckt (seine Pruefung ist beendet), der Zaehler des laufenden Videos bleibt unberuehrt.
        lauf.standAufnahme = null;
        if (lauf.standbild) lauf.standbild = { ...lauf.standbild, sauber: 0, daumen: null, beendet: true };
        return;
      }
      const neu = entscheideHysterese(lauf, 'fehler', this.g.freiNach);
      lauf.soll = neu.soll;
      lauf.sauber = neu.sauber;
      this.meldeSauber(lauf);
      this.gleicheAn(lauf);
    }, this.g.taktMs * 2);
    const aufn = lauf.standAufnahme;
    this.fuehreAus(lauf.stand, 'takt', () => this.haken.pruefe(lauf.el), !lauf.schnell).then(
      (ergebnis) => this.fertig(lauf, ergebnis, sprung, generation, aufn),
      () => this.fertig(lauf, 'fehler', sprung, generation, aufn),
    );
  }

  private fertig(lauf: VideoLauf, ergebnis: VideoErgebnis | 'unlesbar', sprung: number, generation: number, aufn: StandAufnahme | null = null): void {
    lauf.laeuft = false;
    lauf.standAufnahme = null;
    const startStand = lauf.startStand;
    lauf.startStand = null;
    if (lauf.fristTimer) clearTimeout(lauf.fristTimer);
    lauf.fristTimer = null;
    if (lauf.tot || lauf.z.generation !== generation || !this.haken.aktiv()) return;
    this.beiErgebnis?.(lauf.el, lauf.z);
    const e: VideoErgebnis = ergebnis === 'unlesbar' ? 'fehler' : ergebnis;
    if (lauf.verfallen) {
      // Die Antwort kam nach der Frist: das Video ist schon verdeckt, die Antwort zeigt ein altes Bild und zaehlt nicht.
      lauf.verfallen = false;
    } else if (aufn) {
      // Pruefung des Standbilds (E3c): eigener Zaehler, der Zaehler des laufenden Videos bleibt unberuehrt.
      this.standbildErgebnis(lauf, aufn, ergebnis, sprung);
    } else if (lauf.z.sprung !== sprung) {
      // Das Bild stammt von vor dem Sprung: ein Treffer (oder Fehler) gilt trotzdem, ein "sauber" wird verworfen. Danach neu pruefen.
      if (e !== 'sauber') {
        this.uebernimm(lauf, e);
      }
      lauf.nochmal = true;
    } else if (e === 'sauber' && !zaehltSauberImLaufenden(startStand?.lief ?? false, !lauf.el.paused && !lauf.el.ended && !lauf.el.seeking)) {
      // V1: ein "sauber" zaehlt im laufenden Zaehler nur, wenn das Video bei Start und Antwort lief; sonst wird es fuer den Zaehler verworfen (ein Treffer wirkt weiter).
    } else {
      this.uebernimm(lauf, e);
      // E3c: eine gewoehnliche Pruefung, die einem stehenden Bild galt (zum Beispiel nach einem Sprung im Stand) und es nicht sauber fand, beendet die Pruefung dieses
      // Standbilds schon: eine zweite Pruefung desselben Bilds brauchte niemand.
      if (e !== 'sauber' && startStand?.steht && this.steht(lauf) && lauf.el.currentTime === startStand.ct && !lauf.el.seeking) this.standbildBeenden(lauf);
    }
    if (lauf.nochmal) {
      lauf.nochmal = false;
      this.alsFaellig(lauf, true);
    } else {
      this.plane(lauf);
      this.standbildPlane(lauf); // E3c: die naechste Pruefung desselben Standbilds, falls noch eine fehlt
    }
  }

  // Hysterese anwenden und das Ergebnis zeigen. Haelt der Schleier das Video (Zonen-Leinwand: noch keine 3 s Medienzeit ohne Treffer), wird es
  // nicht frei, auch wenn die saubere Folge schon reicht (der Zaehler bleibt eine Pruefung vor der Freigabe).
  private uebernimm(lauf: VideoLauf, e: VideoErgebnis): void {
    const neu = entscheideHysterese(lauf, e, this.g.freiNach);
    if (neu.soll === 'frei' && lauf.soll === 'verdeckt' && this.haken.haelt?.(lauf.el, lauf.z)) {
      lauf.soll = 'verdeckt';
      lauf.sauber = Math.max(0, this.g.freiNach - 1);
    } else {
      lauf.soll = neu.soll;
      lauf.sauber = neu.sauber;
    }
    this.meldeSauber(lauf);
    this.gleicheAn(lauf);
  }

  // ---------- Urteilswechsel unter den Wechsel-Grenzen ----------

  // Sprung oder emptied: eine entschiedene, aber noch wartende Freigabe gilt nicht mehr (das Bild hat sich geaendert). Ein schon verdecktes Video
  // bleibt verdeckt, seine Hysterese beginnt neu. Ein Video, dessen Erst-Urteil noch nicht gezeigt wurde, wird neu beurteilt.
  private verwirfWartendeFreigabe(lauf: VideoLauf): void {
    if (lauf.tot) return;
    if (lauf.kopie) this.kopieWeg(lauf, 'seeked'); // die Kopie gilt nach einem Sprung oder Quellenwechsel nie weiter
    if (lauf.soll !== 'frei') return;
    const zeigt = this.haken.angezeigt(lauf.el, lauf.z);
    if (zeigt === 'frei') return;
    if (zeigt === null || lauf.z.urteil === null) {
      this.haken.verwirf(lauf.el, lauf.z);
      return;
    }
    lauf.soll = 'verdeckt';
    lauf.sauber = 0;
    this.meldeSauber(lauf);
    this.gleicheAn(lauf);
  }

  // Bringt das angezeigte Urteil auf den Stand der Hysterese: Verdecken sofort, Freigeben sobald die Bremse es erlaubt (sonst per Timer).
  // Massgeblich ist, was das Element wirklich zeigt (ein vorlaeufig verdecktes Video zeigt schon "verdeckt": dann ist es kein Wechsel).
  private gleicheAn(lauf: VideoLauf): void {
    if (lauf.tot) return;
    if (lauf.wechselTimer) clearTimeout(lauf.wechselTimer);
    lauf.wechselTimer = null;
    // E3d (P1, P4): solange das Video sein Poster zeigt, haelt jede Freigabe zurueck; der Zaehler steht dann auf null (er zaehlt erst ab dem Abspielen).
    if (lauf.soll === 'frei' && zeigtPosterAm(lauf.el)) {
      lauf.soll = 'verdeckt';
      lauf.sauber = 0;
      this.meldeSauber(lauf);
    }
    if (this.haken.angezeigt(lauf.el, lauf.z) === lauf.soll) {
      // Zeigt schon das Richtige; fehlt nur das Urteil im Zustand (vorlaeufig verdeckt), wird es ohne Wechsel nachgetragen.
      if (lauf.z.urteil === null) this.haken.wende(lauf.el, lauf.z, lauf.soll);
      return;
    }
    const jetzt = performance.now();
    const ab = fruehestensWechsel(lauf.soll, lauf.stand.letzterWechsel, this.letzteFreigabe, this.g);
    if (jetzt >= ab) {
      lauf.stand.letzterWechsel = jetzt;
      if (lauf.soll === 'frei') this.letzteFreigabe = jetzt;
      this.haken.wende(lauf.el, lauf.z, lauf.soll);
      this.beiWechsel?.(lauf.el, lauf.z);
      if (lauf.soll === 'frei' && lauf.armiert) this.starteWaechter(lauf); // frei geworden: ab jetzt Schnitterkennung (V2)
      return;
    }
    lauf.wechselTimer = setTimeout(() => {
      lauf.wechselTimer = null;
      this.gleicheAn(lauf);
    }, ab - jetzt + 1);
  }

  // ---------- Pause nach Regel S2 (E3c, Regel K) ----------
  // Ein pausiertes Video ohne Leinwand im Urteil `verdeckt`, das ein sauberes Standbild zeigt, bekommt nach drei sauberen Pruefungen desselben Standbilds (eigener Zaehler) eine
  // KOPIE dieses Bilds (video-kopie.ts). Das Video selbst wird auf diesem Weg NIE frei: `soll` und `data-veil` bleiben `verdeckt`, `wende('frei')` wird nicht gerufen. Alles Weitere
  // entscheidet video-standbild.ts; hier laufen Zaehler, Timer und Kopie. Jedes Zeichen einer Aenderung nimmt die Kopie sofort und ohne Bremse weg (kopieWeg).

  private standFakten(lauf: VideoLauf): StandFakten {
    const el = lauf.el;
    return {
      steht: el.paused || el.ended,
      seeking: el.seeking,
      readyState: el.readyState,
      videoWidth: el.videoWidth,
      gespielt: el.played.length > 0,
      hatPoster: el.hasAttribute('poster'),
      hatLeinwand: this.haken.hatLeinwand?.(el) ?? true,
      istStrom: !!el.srcObject,
      verdeckt: lauf.soll === 'verdeckt' && lauf.z.urteil === 'verdeckt' && this.haken.angezeigt(el, lauf.z) === 'verdeckt',
      schnell: lauf.schnell,
    };
  }

  private steht(lauf: VideoLauf): boolean {
    return lauf.el.paused || lauf.el.ended;
  }

  // Die Pruefung des gerade stehenden Bilds ist zu Ende (es bleibt verdeckt, bis sich etwas aendert).
  private standbildBeenden(lauf: VideoLauf): void {
    if (lauf.kopie) return;
    const el = lauf.el;
    lauf.standbild = { ...neuesStandbild(el.currentTime, lauf.epoche, el.currentSrc), beendet: true };
  }

  private standGleich(lauf: VideoLauf, st: { ct: number; epoche: number; quelle: string }): boolean {
    return st.ct === lauf.el.currentTime && st.epoche === lauf.epoche && st.quelle === lauf.el.currentSrc;
  }

  // Wie viele Kopien gibt es in diesem Dokument gerade (K7)?
  private kopienZahl(): number {
    let n = 0;
    for (const l of this.laeufe) if (l.kopie) n++;
    return n;
  }

  // Zeigt dieses Video gerade seine Kopie? (Das Etikett fragt danach, K8.)
  kopieZeigt(el: HTMLVideoElement): boolean {
    for (const l of this.laeufe) if (l.el === el) return !!l.kopie?.gezeigt;
    return false;
  }

  // Eine Pruefung des Standbilds soll laufen (oder weiterlaufen): legt das Standbild an, wenn es keines gibt, und reiht die naechste Pruefung ein
  // (im bestehenden Takt und Budget: je Video hoechstens eine je Taktzeit). Gilt die Regel fuer das Video nicht, endet ein angelegtes Standbild.
  private standbildPlane(lauf: VideoLauf): void {
    if (lauf.tot || lauf.kopie) return;
    if (!standbildBerechtigt(this.standFakten(lauf))) {
      lauf.standbild = null;
      return;
    }
    const st = lauf.standbild;
    if (st && this.standGleich(lauf, st)) {
      if (st.beendet) return; // Treffer, Fehler oder zu viele Abweichungen: verdeckt, bis sich etwas aendert
      if (!lauf.laeuft) this.alsFaellig(lauf, true);
      return;
    }
    lauf.standbild = neuesStandbild(lauf.el.currentTime, lauf.epoche, lauf.el.currentSrc);
    this.alsFaellig(lauf, true);
  }

  // Aufnahme fuer die Pruefung, die jetzt startet, oder null (gewoehnliche Pruefung).
  private standAufnahmeJetzt(lauf: VideoLauf): StandAufnahme | null {
    const st = lauf.standbild;
    if (!st || st.beendet || lauf.kopie) return null;
    if (!this.standGleich(lauf, st) || !standbildBerechtigt(this.standFakten(lauf))) return null;
    let daumen: Float32Array | null = null;
    try {
      daumen = this.haken.daumen?.(lauf.el) ?? null;
    } catch {
      daumen = null;
    }
    return { ct: lauf.el.currentTime, epoche: lauf.epoche, quelle: lauf.el.currentSrc, daumen };
  }

  private standbildErgebnis(lauf: VideoLauf, aufn: StandAufnahme, ergebnis: StandErgebnis, sprung: number): void {
    const st = lauf.standbild;
    const gleich = this.haken.daumenGleich;
    if (!st || !gleich) return;
    const el = lauf.el;
    const b = bewerteStandbildPruefung(
      st,
      aufn,
      {
        steht: el.paused || el.ended,
        seeking: el.seeking || lauf.z.sprung !== sprung,
        ct: el.currentTime,
        epoche: lauf.epoche,
        quelle: el.currentSrc,
        hatLeinwand: this.haken.hatLeinwand?.(el) ?? true,
      },
      ergebnis,
      gleich,
      this.g.freiNach,
    );
    lauf.standbild = b.stand;
    if (b.aktion === 'drei') this.kopieAnlegen(lauf);
  }

  // Drei saubere Pruefungen desselben Standbilds: erst malen (K3 Schritt 1, der Host ist unsichtbar), dann pruefen (Schritt 2: alles gilt noch, der Daumen der gemalten Kopie
  // gleicht dem der ersten sauberen Pruefung), dann zeigen (Schritt 3, unter den Bremsen jeder Freigabe). Schlaegt etwas fehl: keine Kopie, Zaehler des Standbilds auf null.
  private kopieAnlegen(lauf: VideoLauf): void {
    const st = lauf.standbild;
    if (!st || lauf.kopie) return;
    const el = lauf.el;
    const beende = (): void => {
      lauf.standbild = { ...st, sauber: 0, daumen: null, beendet: true };
    };
    // K5: technische Eignung (wie die Zonen-Leinwand, ohne Einstellung und Platz), hoechstens vier Kopien je Dokument (K7). Sonst bleibt das Video verdeckt.
    if (!this.haken.kopieMale || !this.haken.kopieEignung?.(el) || this.kopienZahl() >= KOPIEN_MAX) return beende();
    let h: KopieHandle | null = null;
    try {
      h = this.haken.kopieMale(el, () => this.kopieWeg(lauf, 'nachschau'));
    } catch {
      h = null;
    }
    if (!h) return beende();
    const dk = h.daumen();
    const gleich = this.haken.daumenGleich;
    const gilt = this.steht(lauf) && !el.seeking && this.standGleich(lauf, st) && !(this.haken.hatLeinwand?.(el) ?? true) && !!st.daumen && !!dk && !!gleich && gleich(st.daumen, dk);
    if (!gilt) {
      h.entferne();
      const abweichungen = st.abweichungen + 1;
      lauf.standbild = { ...st, sauber: 0, daumen: null, abweichungen, beendet: abweichungen >= STAND_ABWEICHUNG_MAX || !dk };
      return;
    }
    lauf.kopie = { h, ct: st.ct, epoche: st.epoche, quelle: st.quelle, gezeigt: false, timer: null };
    lauf.standbild = { ...st, beendet: true }; // keine weitere Pruefung dieses Standbilds
    this.starteStandWache(lauf);
    this.kopieZeigeVersuch(lauf);
  }

  // Das Zeigen der Kopie ist ein Wechsel von verdeckt zu scharf: gleiche Bremsen wie jede Freigabe (Mindestabstand je Video, Blitz-Sperre im Dokument).
  private kopieZeigeVersuch(lauf: VideoLauf): void {
    const k = lauf.kopie;
    if (!k || k.gezeigt || lauf.tot) return;
    if (k.timer) clearTimeout(k.timer);
    k.timer = null;
    if (this.kopieUngueltig(lauf)) return this.kopieWeg(lauf, 'nachschau');
    const jetzt = performance.now();
    const ab = fruehestensWechsel('frei', lauf.stand.letzterWechsel, this.letzteFreigabe, this.g);
    if (jetzt < ab) {
      k.timer = setTimeout(() => {
        k.timer = null;
        this.kopieZeigeVersuch(lauf);
      }, ab - jetzt + 1);
      return;
    }
    lauf.stand.letzterWechsel = jetzt;
    this.letzteFreigabe = jetzt;
    k.gezeigt = true;
    k.h.zeige();
    this.haken.beiKopie?.(lauf.el, lauf.z);
  }

  // Gilt die Kopie noch? Das Video steht, Zeit, Quelle, Eignung, Poster, Lage; Host und Attribut an ihrem Platz.
  private kopieUngueltig(lauf: VideoLauf): boolean {
    const k = lauf.kopie;
    if (!k) return false;
    const el = lauf.el;
    const f = this.standFakten(lauf);
    if (
      deckeZuBeiNachschau({
        aktiv: this.haken.aktiv(),
        eignungOk: this.haken.kopieEignung?.(el) ?? false,
        poster: zeigtPoster(f),
        verbunden: el.isConnected,
        steht: f.steht,
        seeking: f.seeking,
        ct: el.currentTime,
        ctStand: k.ct,
        epoche: lauf.epoche,
        epocheStand: k.epoche,
        quelle: el.currentSrc,
        quelleStand: k.quelle,
        hatLeinwand: f.hatLeinwand,
        readyState: el.readyState,
      })
    )
      return true;
    return !k.h.intakt() || !k.h.pflege();
  }

  // Fruehe Horcher (Capture) fuer play, playing, seeking, seeked, timeupdate, ratechange, loadstart, emptied: am Fenster und am Element.
  private beiStandEreignis(lauf: VideoLauf, name: string): void {
    if (lauf.tot) return;
    const el = lauf.el;
    // V2: ein Sprung im Stand setzt den Zaehler des laufenden Videos immer auf null, auch ohne angelegtes Standbild.
    if (name === 'seeking' && !lauf.z.schleife) {
      const neu = zaehlerBeiSeekingImStand(el.paused || el.ended, lauf.sauber);
      if (neu !== lauf.sauber) {
        lauf.sauber = neu;
        this.meldeSauber(lauf);
      }
    }
    // Quellenwechsel (Fenster und Element melden dasselbe Ereignis, die Epoche zaehlt dann zweimal: sie wird nur auf Ungleichheit verglichen).
    if (name === 'loadstart' || name === 'emptied') lauf.epoche++;
    if (lauf.kopie) {
      if (deckeZuBeiEreignis(name, el.currentTime, lauf.kopie.ct)) this.kopieWeg(lauf, name as ZuGrund);
      return;
    }
    const st = lauf.standbild;
    if (!st) return;
    // Standbild in Pruefung: jede Aenderung (ausser timeupdate bei gleicher Zeit) verwirft es.
    if (deckeZuBeiEreignis(name, el.currentTime, st.ct)) {
      lauf.standbild = null;
      lauf.standAufnahme = null;
    }
  }

  // Die Kopie sofort und ohne Bremse wegnehmen: das Video steht dann weichgezeichnet da (sein Urteil blieb `verdeckt`). Der Zaehler des laufenden Videos (`sauber`) wurde von der
  // Pause-Pruefung nie angefasst: nach Play steht er, wie er vor der Pause war, nach einem Sprung oder einer Aenderung im Stand steht er auf null.
  private kopieWeg(lauf: VideoLauf, grund: ZuGrund): void {
    const k = lauf.kopie;
    this.stoppeStandWache(lauf);
    lauf.kopie = null;
    lauf.standbild = null;
    if (!k) return;
    if (k.timer) clearTimeout(k.timer);
    k.timer = null;
    try {
      k.h.entferne();
    } catch {
      // Element schon weg
    }
    if (lauf.tot) return;
    lauf.sauber = zaehlerNachZudecken(grund, lauf.el.paused || lauf.el.ended, lauf.sauber);
    this.meldeSauber(lauf);
    if (k.gezeigt) this.haken.beiKopie?.(lauf.el, lauf.z);
  }

  // Nachschau im Takt (fuer alles, was kein Ereignis meldet) und Bildwaechter (wo vorhanden: jedes neue gezeigte Bild nimmt die Kopie weg).
  private starteStandWache(lauf: VideoLauf): void {
    this.stoppeStandWache(lauf);
    lauf.standNachschau = setInterval(() => {
      if (lauf.tot || !lauf.kopie) return this.stoppeStandWache(lauf);
      if (this.kopieUngueltig(lauf)) this.kopieWeg(lauf, 'nachschau');
    }, STAND_NACHSCHAU_MS);
    if (!lauf.rvfc || this.ohneBildwaechter) return;
    try {
      lauf.standWaechter = lauf.el.requestVideoFrameCallback(() => {
        lauf.standWaechter = null;
        if (!lauf.tot && lauf.kopie) this.kopieWeg(lauf, 'bildwaechter');
      });
    } catch {
      lauf.standWaechter = null;
    }
  }

  private stoppeStandWache(lauf: VideoLauf): void {
    if (lauf.standNachschau) clearInterval(lauf.standNachschau);
    lauf.standNachschau = null;
    if (lauf.standWaechter !== null) {
      try {
        lauf.el.cancelVideoFrameCallback(lauf.standWaechter);
      } catch {
        // Element schon weg
      }
    }
    lauf.standWaechter = null;
  }

  // E3d (P3): das Attribut `poster` hat sich geaendert (Attribut-Beobachtung des Schleiers). Zeigt das Video jetzt sein Poster, ist es sofort und ohne Bremse `verdeckt`
  // (auch ein freies, nie gespieltes Video), der Zaehler steht auf null, eine Kopie faellt weg. Gibt es keinen Lauf, tut der Schleier das Noetige selbst.
  posterGeaendert(el: HTMLVideoElement): boolean {
    const lauf = [...this.laeufe].find((l) => l.el === el);
    if (!lauf || lauf.tot) return false;
    if (!zeigtPosterAm(el)) return true;
    this.kopieWeg(lauf, 'seeked');
    lauf.soll = 'verdeckt';
    lauf.sauber = 0;
    if (lauf.wechselTimer) clearTimeout(lauf.wechselTimer);
    lauf.wechselTimer = null;
    this.meldeSauber(lauf);
    this.gleicheAn(lauf);
    return true;
  }

  // ---------- Abbau ----------

  private beendeLauf(lauf: VideoLauf): void {
    lauf.tot = true;
    lauf.sofortOffen = false;
    this.haken.beiSauber?.(lauf.el, null);
    this.entwaffne(lauf);
    this.kopieWeg(lauf, 'emptied'); // M3: eine Kopie geht mit dem Lauf (Aushaengen, Vergessen, Abbau), nie verwaist
    this.stoppeStandWache(lauf);
    lauf.standbild = null;
    lauf.standAufnahme = null;
    if (lauf.fristTimer) clearTimeout(lauf.fristTimer);
    lauf.fristTimer = null;
    if (lauf.z.urteil === null) this.haken.beendet(lauf.el, lauf.z);
    if (lauf.wechselTimer) clearTimeout(lauf.wechselTimer);
    lauf.wechselTimer = null;
    this.faellig.delete(lauf);
    this.laeufe.delete(lauf);
    for (const [name, fn, frueh] of lauf.hoerer) lauf.el.removeEventListener(name, fn, frueh);
    lauf.hoerer.length = 0;
    if (lauf.z.video === lauf) lauf.z.video = null;
    if (!this.laeufe.size) {
      if (this.dokumentHoerer) document.removeEventListener('visibilitychange', this.beiDokumentSicht);
      this.dokumentHoerer = false;
      if (this.budgetTimer) clearTimeout(this.budgetTimer);
      this.budgetTimer = null;
    }
  }
}
