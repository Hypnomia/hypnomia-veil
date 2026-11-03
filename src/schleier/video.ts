// Laufende Nachpruefung von Videos (PHASE-2-BAUPLAN 10.1): gedrosselter Einzelbild-Takt, Hysterese, Wechsel-Grenzen.
// Dieses Modul kennt weder den Erkenner noch die Attribute des Schleiers: Pruefung, Sichtbarkeit und Urteil setzen kommen ueber `VideoHaken`
// herein, die Grenzwerte ueber `VideoGrenzen` (Konstanten in konstanten.ts). Es importiert nur Typen, damit die reine Logik
// (Hysterese, Budget, Wechsel-Zeitpunkt) in den Einheitstests ohne Browser laeuft.

import type { Zustand } from './zustand';

export type VideoUrteil = 'frei' | 'verdeckt';
export type VideoErgebnis = 'treffer' | 'sauber' | 'fehler';

export interface VideoGrenzen {
  taktMs: number;
  budgetJeS: number;
  freiNach: number;
  wechselMinMs: number;
  blitzSperreMs: number;
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
  readonly hoerer: Array<[string, () => void]>;
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
  private fuehreAus<T>(s: ElementStand, art: 'erst' | 'takt', fn: () => Promise<T>): Promise<T> {
    const jetzt = performance.now();
    const nr = ++s.nr;
    s.unterwegs = true;
    s.letzterStart = jetzt;
    this.budget.nimm(jetzt);
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
    };
    z.video = lauf;
    this.laeufe.add(lauf);
    const auf = (name: string, fn: () => void): void => {
      el.addEventListener(name, fn);
      lauf.hoerer.push([name, fn]);
    };
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
      this.sofort(lauf);
    });
    if (!lauf.rvfc) auf('timeupdate', () => this.beiZeit(lauf));
    if (!this.dokumentHoerer) {
      this.dokumentHoerer = true;
      document.addEventListener('visibilitychange', this.beiDokumentSicht);
    }
    this.gleicheAn(lauf);
    this.plane(lauf);
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
  }

  private beiZeit(lauf: VideoLauf): void {
    if (lauf.tot || !lauf.armiert) return;
    if (performance.now() - lauf.stand.letzterStart < this.g.taktMs) return;
    this.alsFaellig(lauf, false);
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
      const fruehestens = lauf.stand.letzterStart + this.g.taktMs;
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
      const w = this.budget.wartezeit(jetzt);
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
    const sprung = lauf.z.sprung;
    const generation = lauf.z.generation;
    // Frist: bleibt die Antwort ueber 2 Taktzeiten aus (haengender Erkenner), gilt das wie ein Fehler: sofort verdecken. Eine zweite
    // Anfrage startet erst, wenn diese beendet ist (laeuft bleibt gesetzt); ihre spaete Antwort wird nicht mehr gewertet.
    lauf.fristTimer = setTimeout(() => {
      lauf.fristTimer = null;
      if (lauf.tot || !lauf.laeuft || lauf.verfallen) return;
      lauf.verfallen = true;
      this.haken.beiFrist();
      const neu = entscheideHysterese(lauf, 'fehler', this.g.freiNach);
      lauf.soll = neu.soll;
      lauf.sauber = neu.sauber;
      this.gleicheAn(lauf);
    }, this.g.taktMs * 2);
    this.fuehreAus(lauf.stand, 'takt', () => this.haken.pruefe(lauf.el)).then(
      (ergebnis) => this.fertig(lauf, ergebnis, sprung, generation),
      () => this.fertig(lauf, 'fehler', sprung, generation),
    );
  }

  private fertig(lauf: VideoLauf, ergebnis: VideoErgebnis | 'unlesbar', sprung: number, generation: number): void {
    lauf.laeuft = false;
    if (lauf.fristTimer) clearTimeout(lauf.fristTimer);
    lauf.fristTimer = null;
    if (lauf.tot || lauf.z.generation !== generation || !this.haken.aktiv()) return;
    this.beiErgebnis?.(lauf.el, lauf.z);
    const e: VideoErgebnis = ergebnis === 'unlesbar' ? 'fehler' : ergebnis;
    if (lauf.verfallen) {
      // Die Antwort kam nach der Frist: das Video ist schon verdeckt, die Antwort zeigt ein altes Bild und zaehlt nicht.
      lauf.verfallen = false;
    } else if (lauf.z.sprung !== sprung) {
      // Das Bild stammt von vor dem Sprung: ein Treffer (oder Fehler) gilt trotzdem, ein "sauber" wird verworfen. Danach neu pruefen.
      if (e !== 'sauber') {
        const neu = entscheideHysterese(lauf, e, this.g.freiNach);
        lauf.soll = neu.soll;
        lauf.sauber = neu.sauber;
        this.gleicheAn(lauf);
      }
      lauf.nochmal = true;
    } else {
      const neu = entscheideHysterese(lauf, e, this.g.freiNach);
      lauf.soll = neu.soll;
      lauf.sauber = neu.sauber;
      this.gleicheAn(lauf);
    }
    if (lauf.nochmal) {
      lauf.nochmal = false;
      this.alsFaellig(lauf, true);
    } else {
      this.plane(lauf);
    }
  }

  // ---------- Urteilswechsel unter den Wechsel-Grenzen ----------

  // Sprung oder emptied: eine entschiedene, aber noch wartende Freigabe gilt nicht mehr (das Bild hat sich geaendert). Ein schon verdecktes Video
  // bleibt verdeckt, seine Hysterese beginnt neu. Ein Video, dessen Erst-Urteil noch nicht gezeigt wurde, wird neu beurteilt.
  private verwirfWartendeFreigabe(lauf: VideoLauf): void {
    if (lauf.tot || lauf.soll !== 'frei') return;
    const zeigt = this.haken.angezeigt(lauf.el, lauf.z);
    if (zeigt === 'frei') return;
    if (zeigt === null || lauf.z.urteil === null) {
      this.haken.verwirf(lauf.el, lauf.z);
      return;
    }
    lauf.soll = 'verdeckt';
    lauf.sauber = 0;
    this.gleicheAn(lauf);
  }

  // Bringt das angezeigte Urteil auf den Stand der Hysterese: Verdecken sofort, Freigeben sobald die Bremse es erlaubt (sonst per Timer).
  // Massgeblich ist, was das Element wirklich zeigt (ein vorlaeufig verdecktes Video zeigt schon "verdeckt": dann ist es kein Wechsel).
  private gleicheAn(lauf: VideoLauf): void {
    if (lauf.tot) return;
    if (lauf.wechselTimer) clearTimeout(lauf.wechselTimer);
    lauf.wechselTimer = null;
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
      return;
    }
    lauf.wechselTimer = setTimeout(() => {
      lauf.wechselTimer = null;
      this.gleicheAn(lauf);
    }, ab - jetzt + 1);
  }

  // ---------- Abbau ----------

  private beendeLauf(lauf: VideoLauf): void {
    lauf.tot = true;
    lauf.sofortOffen = false;
    this.entwaffne(lauf);
    if (lauf.fristTimer) clearTimeout(lauf.fristTimer);
    lauf.fristTimer = null;
    if (lauf.z.urteil === null) this.haken.beendet(lauf.el, lauf.z);
    if (lauf.wechselTimer) clearTimeout(lauf.wechselTimer);
    lauf.wechselTimer = null;
    this.faellig.delete(lauf);
    this.laeufe.delete(lauf);
    for (const [name, fn] of lauf.hoerer) lauf.el.removeEventListener(name, fn);
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
