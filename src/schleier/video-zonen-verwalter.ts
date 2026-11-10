// Verwaltung der Zonen-Leinwaende eines Dokuments (Bauplan Video-Zonen, Auftrag V5): welches Video eine Leinwand bekommt (hoechstens eines je Dokument,
// geeignet nach pruefeEignung), Aufnahme und Antwort der Pruefungen, Rueckfall auf Ganz-Verdecken und Wiederaufnahme, Mias Gesicht und Woerter der Presets je Motiv
// (Spur.motiv: gleich der Spur-Kennung oder geerbt von einer eben verlorenen Spur an derselben Stelle).
// Die Steuerung des Urteils (data-veil, Zaehlung, Bremse) bleibt im Schleier (schleier.ts): hierher kommen nur Rueckrufe.

import type { Einstellungen } from '../einstellungen';
import type { AntwortFehler, AntwortPackBild, AntwortPackWort, NachrichtErkennerPackBild } from '../nachrichten';
import { ladeSeitenSchriften, schriftVersuchMoeglich } from '../oberflaeche/design/schrift';
import { waehleWort, type Preset } from '../presets';
import { PACKBILD_MAX_SEITE_PATCH } from '../nachrichten';
import { ANTWORT_MAX_MS, VIDEO_WECHSEL_MIN_MS, VIDEO_ZONEN_GRAU_B, VIDEO_ZONEN_MAX_JE_DOKUMENT, VIDEO_ZONEN_MIN_B, VIDEO_ZONEN_MIN_H } from './konstanten';
import { GrauLeser } from './daumen';
import { istDrm } from './pip-sperre';
import { vergissWecken, wecke } from './pruefung';
import type { VideoZonenZaehler } from './status';
import type { Zustand } from './zustand';
import { ZonenVideo, type Aufnahme, type AntwortDaten, type AnfangsAntwort, type LeinwandHaken } from './video-leinwand';
import { matrixDreht, pruefeEignung, type Eignung, type EignungsGrund } from './video-zonen';
import { ETIKETT_LANGSAM, etikettTextFuer, VideoEtikett } from './video-etikett';

export interface VerwalterHaken {
  lebt(): boolean;
  aktiv(): boolean;
  einstellungen(): Einstellungen | null;
  // Wirksames Preset (Mia-Presets nur mit Pack, sonst Mosaik).
  preset(): Preset;
  // Gewaehlte Wort-Themen (null = alle, [] = keins).
  woerterThemen(): string[] | null;
  packStand(): number;
  zustand(el: HTMLVideoElement): Zustand | undefined;
  sichtbar(el: HTMLVideoElement, z: Zustand): boolean;
  // Pixel des Videos lesbar (kein srcObject, Firefox nur data: und blob:).
  lesbar(el: HTMLVideoElement): boolean;
  hatSpiegel(el: HTMLVideoElement): boolean;
  // Hover-Vorschau oder Anzeigen-Video auf einer Erwachsenenseite der Liste (nie Zonen, immer ganz verdeckt).
  vorschau(el: HTMLVideoElement): boolean;
  // Anzeigen-Video (Werbeflaeche): bekommt kein Etikett, das Dokument bleibt unberuehrt (Mias Werbung tauscht die Flaeche).
  anzeige(el: HTMLVideoElement): boolean;
  // Takt (video.ts)
  setzeSchnell(el: HTMLVideoElement, an: boolean): void;
  bildBereit(el: HTMLVideoElement): void;
  freigabeReif(el: HTMLVideoElement): boolean;
  sofort(el: HTMLVideoElement): void;
  // Urteil am Element: "zensiert" (Leinwand) und "verdeckt" (ganz, Blur). Zaehlen den Wechsel und merken ihn fuer die Bremse.
  zeigeZonen(el: HTMLVideoElement, z: Zustand): void;
  zeigeGanz(el: HTMLVideoElement, z: Zustand): void;
  // Die Dokument-Bremse (BLITZ_SPERRE_MS nach dem letzten grossen Wechsel eines Videos im Dokument) erlaubt einen Wechsel zur Leinwand?
  dokumentBremseOk(): boolean;
  // Ein Rueckfall wegen Langsamkeit (Popup-Hinweis, Status).
  meldeLangsam(): void;
  zaehler: VideoZonenZaehler;
}

// Nach einem Rueckfall wartet das Video so lange, bevor es die Leinwand wieder versuchen darf (Millisekunden).
const SPERRE_MS: Record<string, number> = { langsam: 10_000, lesen: 5000, vollbild: 0 };
const SPERRE_STANDARD_MS = 3000;
const BILDER_MAX = 48;
// Eine fehlgeschlagene Lieferung (zum Beispiel die Gesichtssuche ist noch nicht fertig) wird so bald nicht neu erfragt.
const FEHLER_PAUSE_MS = 4000;

function kennungVon(adresse: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < adresse.length; i++) {
    h ^= adresse.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

type GesichtsStand = 'laedt' | { fehlerBis: number } | { bild: ImageBitmap; ausschnitt: [number, number, number, number] };
type WortStand = 'laedt' | { fehlerBis: number } | { wort: string };

export class VideoZonen {
  private readonly lauf = new Map<HTMLVideoElement, ZonenVideo>();
  // Letzte Antwort eines Videos ohne Leinwand (die erste Erkennung eines Treffers): Grundlage fuer den Start der Leinwand.
  private readonly anfaenge = new WeakMap<HTMLVideoElement, AnfangsAntwort>();
  private readonly sperreBis = new WeakMap<HTMLVideoElement, number>();
  // Rueckfall wegen Langsamkeit: so lange zeigt das Etikett den Grund (bis zum Ende der Sperre).
  private readonly langsamBis = new WeakMap<HTMLVideoElement, number>();
  private readonly letzterWechsel = new WeakMap<HTMLVideoElement, number>();
  // Mias Gesicht und Wort je Motiv (Schluessel: Video und Motiv). Verworfen bei jeder Aenderung von Preset, Themen, Gesichtsstand und Pack (vergissBilder).
  private readonly gesichter = new Map<string, GesichtsStand>();
  private readonly woerter = new Map<string, WortStand>();
  // Zaehlt jedes Verwerfen (vergissBilder): eine Lieferung aus einer alten Runde legt nichts mehr ab.
  private runde = 0;
  private schriftStand: 'neu' | 'laedt' | 'da' | 'fehlt' = 'neu';
  private readonly leser = new GrauLeser(VIDEO_ZONEN_GRAU_B);
  private readonly etiketten = new VideoEtikett();
  private readonly haken: VerwalterHaken;

  constructor(haken: VerwalterHaken) {
    this.haken = haken;
  }

  get anzahl(): number {
    return this.lauf.size;
  }

  hat(el: HTMLVideoElement): boolean {
    return this.lauf.has(el);
  }

  // Das Video bleibt verdeckt, bis `darfFrei` stimmt (Bremse der Freigabe im Takt, video.ts `haelt`).
  haelt(el: HTMLVideoElement): boolean {
    const l = this.lauf.get(el);
    return !!l && !l.darfFrei();
  }

  // ---------- Eignung ----------

  private drehtInKette(el: HTMLElement): boolean {
    let k: Element | null = el;
    for (let i = 0; k && i < 8; i++, k = k.parentElement) {
      try {
        if (matrixDreht(getComputedStyle(k).transform)) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  private fakten(el: HTMLVideoElement): Eignung {
    const e = this.haken.einstellungen();
    let rect: DOMRect | null = null;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      rect = null;
    }
    let untertitel = false;
    try {
      for (const t of Array.from(el.textTracks)) if (t.mode === 'showing') untertitel = true;
    } catch {
      untertitel = false;
    }
    return {
      einstellung: e?.video ?? 'ganz',
      lesbar: this.haken.lesbar(el),
      drm: istDrm(el),
      controls: el.controls,
      untertitel,
      spiegel: this.haken.hatSpiegel(el),
      dreht: this.drehtInKette(el),
      cssB: rect?.width ?? 0,
      cssH: rect?.height ?? 0,
      minB: VIDEO_ZONEN_MIN_B,
      minH: VIDEO_ZONEN_MIN_H,
      vollbildVideo: document.fullscreenElement === el,
      vorschau: this.haken.vorschau(el),
      andereAktiv: [...this.lauf.keys()].some((v) => v !== el) && this.lauf.size >= VIDEO_ZONEN_MAX_JE_DOKUMENT,
    };
  }

  // null = geeignet. `ohneAndere`: das Limit "ein Zonen-Video je Dokument" nicht pruefen (laufende Leinwand prueft sich selbst).
  grundFuer(el: HTMLVideoElement): EignungsGrund | null {
    const r = pruefeEignung(this.fakten(el));
    return r.ok ? null : r.grund;
  }

  // ---------- Aufnahme und Antwort ----------

  // Ein Bild fuer die naechste Pruefung aufnehmen (im selben Augenblick wie das Lesen der Pixel). Mit Leinwand: das gerade analysierte Bild
  // der Schleife. Ohne: ein Graustufenbild fuer den Start der Leinwand, nur wenn die Einstellung Zonen verlangt.
  aufnahme(el: HTMLVideoElement): Aufnahme | null {
    const l = this.lauf.get(el);
    if (l) return l.aufnahme();
    if (this.haken.einstellungen()?.video !== 'zonen') return null;
    const grau = this.leser.lies(el);
    return { nr: -1, szene: 0, mediaTime: el.currentTime, zeit: performance.now(), vb: el.videoWidth, vh: el.videoHeight, grau };
  }

  beiAntwort(el: HTMLVideoElement, aufn: Aufnahme | null, antwort: AntwortDaten | null): void {
    if (!aufn) return;
    const l = this.lauf.get(el);
    if (l) return l.beiAntwort(aufn, antwort);
    this.anfaenge.set(el, { aufnahme: aufn, antwort });
  }

  // ---------- Start und Ende ----------

  // Das Video soll verdeckt gezeigt werden: Zonen (true) oder ganz (false). Bei true steht die Leinwand und der Schleier zeigt "zensiert".
  versuche(el: HTMLVideoElement, z: Zustand): boolean {
    if (this.lauf.has(el)) return true;
    if (!this.haken.aktiv() || !el.isConnected) return false;
    if (this.haken.einstellungen()?.video !== 'zonen') return false;
    const sperre = this.sperreBis.get(el);
    if (sperre !== undefined && performance.now() < sperre) return false;
    const letzter = this.letzterWechsel.get(el);
    if (letzter !== undefined && performance.now() - letzter < VIDEO_WECHSEL_MIN_MS) return false;
    const anfang = this.anfaenge.get(el);
    // Ohne frische Antwort (erste Pruefung mit Bild) gibt es keine Boxen: ganz verdecken, bis die naechste Antwort da ist.
    // Nur mit einer Antwort, die Flaechen hat: eine saubere Antwort (bei noch geltendem Urteil "verdeckt") liesse ein klares Bild stehen und umginge die
    // Hysterese der saubere Pruefungen.
    if (!anfang || !anfang.antwort || anfang.antwort.flaechen.length === 0) return false;
    if (!this.haken.dokumentBremseOk()) return false;
    if (this.grundFuer(el)) return false;
    this.anfaenge.delete(el);
    this.etiketten.entferne(el);
    let l: ZonenVideo;
    try {
      l = new ZonenVideo(el, this.leinwandHaken(el), anfang);
    } catch {
      return false;
    }
    this.lauf.set(el, l);
    this.haken.setzeSchnell(el, true);
    this.letzterWechsel.set(el, performance.now());
    this.haken.zeigeZonen(el, z);
    l.starte();
    return true;
  }

  // Etikett fuer ein ganz verdecktes Video, das trotz "Only the naughty bits" ganz bleibt (nicht lesbar, zu knifflig): nur nach dem Urteil.
  // Ein Video, das nur auf seine Leinwand wartet (geeignet), bekommt keins.
  etikett(el: HTMLVideoElement, z: Zustand): void {
    if (z.urteil !== 'verdeckt' || this.lauf.has(el) || this.haken.einstellungen()?.video !== 'zonen' || !this.haken.aktiv()) return this.etiketten.entferne(el);
    // Ohne Bilddaten gibt es nichts zu erklaeren (vorlaeufig verdeckt, Werbeflaeche ohne Quelle): kein Etikett, das Dokument bleibt unberuehrt.
    if (el.readyState < 2 || !(el.videoWidth > 0) || this.haken.anzeige(el)) return this.etiketten.entferne(el);
    if ((this.langsamBis.get(el) ?? 0) > performance.now()) return this.etiketten.setze(el, ETIKETT_LANGSAM);
    const grund = this.grundFuer(el);
    this.etiketten.setze(el, grund ? etikettTextFuer(grund) : null);
  }

  // Leinwand weg (Freigabe, Quellenwechsel, Pause, Rueckfall). Das Urteil setzt der Aufrufer.
  beende(el: HTMLVideoElement): void {
    const l = this.lauf.get(el);
    this.anfaenge.delete(el);
    this.etiketten.entferne(el);
    if (!l) return;
    this.lauf.delete(el);
    try {
      l.beende();
    } catch {
      // Element weg
    }
    this.haken.setzeSchnell(el, false);
    this.letzterWechsel.set(el, performance.now());
  }

  // Ein Wechsel des Videos ausserhalb der Leinwand (frei zu ganz verdeckt): fuer die Bremse der Rueckkehr zur Leinwand merken.
  merkeWechsel(el: HTMLVideoElement): void {
    this.letzterWechsel.set(el, performance.now());
  }

  alleBeenden(): void {
    for (const el of [...this.lauf.keys()]) this.beende(el);
    this.etiketten.alleWeg();
  }

  // Die Leinwand kann nicht weiter: ganz verdecken (Blur), nach einer Sperrzeit darf es erneut versucht werden.
  private faelleZurueck(el: HTMLVideoElement, grund: string): void {
    const z = this.haken.zustand(el);
    this.beende(el);
    const sperre = SPERRE_MS[grund] ?? SPERRE_STANDARD_MS;
    if (sperre > 0) this.sperreBis.set(el, performance.now() + sperre);
    if (grund === 'langsam') {
      this.langsamBis.set(el, performance.now() + sperre);
      this.haken.meldeLangsam();
    }
    if (z && this.haken.aktiv()) this.haken.zeigeGanz(el, z);
  }

  // Nach einem Ergebnis der Takt-Pruefung: ein ganz verdecktes Video kehrt zu den Zonen zurueck, sobald es geeignet ist und die Bremse es erlaubt.
  abgleichen(el: HTMLVideoElement, z: Zustand): void {
    if (this.lauf.has(el) || z.urteil !== 'verdeckt' || !z.videoEcht) return;
    if (!this.versuche(el, z)) this.etikett(el, z);
  }

  // ---------- Haken der Leinwand ----------

  private leinwandHaken(el: HTMLVideoElement): LeinwandHaken {
    const h = this.haken;
    return {
      lebt: () => h.lebt() && h.aktiv(),
      sichtbar: () => {
        const z = h.zustand(el);
        return !!z && h.sichtbar(el, z);
      },
      preset: () => h.preset(),
      sprungZaehler: () => h.zustand(el)?.sprung ?? 0,
      eignung: () => {
        const f = this.fakten(el);
        // Die eigene Leinwand zaehlt nicht als "andere".
        f.andereAktiv = false;
        const r = pruefeEignung(f);
        return r.ok ? null : r.grund;
      },
      bildBereit: () => h.bildBereit(el),
      freigabeReif: () => h.freigabeReif(el),
      sofort: () => h.sofort(el),
      gesicht: (motiv) => this.gesicht(el, motiv),
      wort: (motiv) => this.wort(el, motiv),
      beiStoerung: (grund) => this.faelleZurueck(el, grund),
      beiLangsam: () => this.faelleZurueck(el, 'langsam'),
      zaehler: h.zaehler,
    };
  }

  // ---------- Mias Gesicht und Woerter (Presets) ----------

  private schluessel(el: HTMLVideoElement, motiv: number): string {
    return `${kennungVon(el.currentSrc || el.src || 'video')}|${motiv}`;
  }

  private begrenze<T>(m: Map<string, T>): void {
    if (m.size > BILDER_MAX) {
      const aeltester = m.keys().next().value;
      if (aeltester !== undefined) {
        const alt = m.get(aeltester);
        if (alt && typeof alt === 'object' && 'bild' in alt) (alt as { bild: ImageBitmap }).bild.close();
        m.delete(aeltester);
      }
    }
  }

  // Mias Gesicht fuer (Video, Motiv): stabil gewaehlt vom Erkenner (Schluessel). null, bis es geladen ist oder wenn keins zu haben ist (dann gilt die
  // Koerper-Behandlung, nie eine offene Flaeche). Nach einem Fehler wird erst nach FEHLER_PAUSE_MS wieder gefragt.
  private gesicht(el: HTMLVideoElement, motiv: number): { bild: ImageBitmap; ausschnitt: [number, number, number, number] } | null {
    if (this.haken.packStand() <= 0) return null;
    const schluessel = this.schluessel(el, motiv);
    const stand = this.gesichter.get(schluessel);
    if (stand && typeof stand === 'object' && 'bild' in stand) return stand;
    if (stand === 'laedt') return null;
    if (stand && performance.now() < stand.fehlerBis) return null;
    this.gesichter.set(schluessel, 'laedt');
    this.begrenze(this.gesichter);
    void this.ladeGesicht(schluessel);
    return null;
  }

  private async ladeGesicht(schluessel: string): Promise<void> {
    const meine = this.gesichter;
    const runde = this.runde;
    const gilt = (): boolean => runde === this.runde && meine.get(schluessel) === 'laedt';
    const fehler = (): void => {
      if (gilt()) meine.set(schluessel, { fehlerBis: performance.now() + FEHLER_PAUSE_MS });
    };
    const a = await this.frage({ ziel: 'erkenner', typ: 'packbild', rolle: 'gesicht', schluessel, maxSeite: PACKBILD_MAX_SEITE_PATCH, packStand: this.haken.packStand() });
    const ausschnitt = a && a.ok === true && 'dataUrl' in a ? a.ausschnitt : undefined;
    if (!a || a.ok !== true || !('dataUrl' in a) || !a.dataUrl.startsWith('data:image/') || !ausschnitt || ausschnitt.length !== 4 || !ausschnitt.every(Number.isFinite)) return fehler();
    // Als ImageBitmap aus den Bytes, nicht als Image mit data:-Adresse: ein Bild, das das Content-Script selbst laedt, macht in Firefox die Leinwand fuer das Lesen
    // der Pixel unbrauchbar (getImageData wirft), und die Seite darf (CSP) data:-Adressen sperren. Ein ImageBitmap aus einem Blob ist herkunftsrein.
    let bild: ImageBitmap;
    try {
      const komma = a.dataUrl.indexOf(',');
      const typ = /^data:([^;,]+)/.exec(a.dataUrl)?.[1] ?? 'image/jpeg';
      const roh = atob(a.dataUrl.slice(komma + 1));
      const bytes = new Uint8Array(roh.length);
      for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
      bild = await createImageBitmap(new Blob([bytes], { type: typ }));
    } catch {
      return fehler();
    }
    // Nur ablegen, wenn der Eintrag noch der laufende ist (vergissBilder leert die Ablage, dann gilt diese Lieferung nicht mehr).
    if (gilt()) meine.set(schluessel, { bild, ausschnitt: [ausschnitt[0]!, ausschnitt[1]!, ausschnitt[2]!, ausschnitt[3]!] });
    else bild.close();
  }

  // Das Wort fuer (Video, Motiv): gleiche Wahl wie bei Bildern (Hash des Motivs, Themen aus den Einstellungen, ohne Pack "MIA"). null, bis die Schrift
  // geladen ist (Schrift im Content-Script wie die anderen Seitenteile, src/oberflaeche/design/schrift.ts) und das Wort da ist: dann steht kein Wort da.
  private wort(el: HTMLVideoElement, motiv: number): string | null {
    // Ein Fehlschlag beim Laden der Schrift gilt nicht fuer immer: nach den Pausen von schrift-versuche.ts (2 s, 8 s, 30 s) kommt ein neuer Versuch, danach ist Schluss.
    // Bis dahin steht kein Wort da. Zwischen den Versuchen kostet das nur den Blick auf eine Zeit.
    if (this.schriftStand === 'neu' || (this.schriftStand === 'fehlt' && schriftVersuchMoeglich())) {
      this.schriftStand = 'laedt';
      void ladeSeitenSchriften().then((ok) => {
        this.schriftStand = ok ? 'da' : 'fehlt';
      });
    }
    if (this.schriftStand !== 'da') return null;
    const schluessel = this.schluessel(el, motiv);
    const stand = this.woerter.get(schluessel);
    if (stand && typeof stand === 'object' && 'wort' in stand) return stand.wort;
    if (stand === 'laedt') return null;
    if (stand && performance.now() < stand.fehlerBis) return null;
    // Ohne Pack gibt es keine Wort-Datei: das Wort steht fest ("MIA"), ohne Weg ueber den Erkenner.
    if (this.haken.packStand() <= 0) {
      const wort = waehleWort(schluessel, null, this.haken.woerterThemen());
      this.woerter.set(schluessel, { wort });
      this.begrenze(this.woerter);
      return wort;
    }
    this.woerter.set(schluessel, 'laedt');
    this.begrenze(this.woerter);
    void this.ladeWort(schluessel);
    return null;
  }

  private async ladeWort(schluessel: string): Promise<void> {
    const meine = this.woerter;
    const runde = this.runde;
    const a = await this.frage({ ziel: 'erkenner', typ: 'packbild', rolle: 'wort', schluessel, packStand: this.haken.packStand(), themen: this.haken.woerterThemen() });
    if (runde !== this.runde || meine.get(schluessel) !== 'laedt') return;
    meine.set(schluessel, a && a.ok === true && 'wort' in a && typeof a.wort === 'string' && a.wort.length > 0 ? { wort: a.wort } : { fehlerBis: performance.now() + FEHLER_PAUSE_MS });
  }

  // Eine Frage an den Erkenner (mit Frist, bei ausbleibender Antwort nach dem Wecken noch einmal). null: keine Antwort.
  private async frage(n: NachrichtErkennerPackBild): Promise<AntwortPackBild | AntwortPackWort | AntwortFehler | null> {
    const einmal = async (): Promise<AntwortPackBild | AntwortPackWort | AntwortFehler | null> => {
      if (!(await wecke(() => this.haken.lebt()))) return null;
      let uhr: ReturnType<typeof setTimeout> | undefined;
      const zeit = new Promise<null>((fertig) => {
        uhr = setTimeout(() => fertig(null), ANTWORT_MAX_MS);
      });
      try {
        return (await Promise.race([browser.runtime.sendMessage(n) as Promise<AntwortPackBild | AntwortPackWort | AntwortFehler | undefined>, zeit])) ?? null;
      } catch {
        return null;
      } finally {
        clearTimeout(uhr);
      }
    };
    let a = await einmal();
    if (a === null) {
      vergissWecken();
      a = await einmal();
    }
    return a;
  }

  // Preset, Wort-Themen, Gesichtsstand oder Pack haben sich geaendert: gemerkte Gesichter und Woerter verwerfen (laufende Lieferungen gelten nicht mehr).
  // Die Leinwaende zeichnen danach neu: der Schleier beendet sie mit dem neuen Pruefstand und nimmt sie nach der naechsten Pruefung wieder auf.
  vergissBilder(): void {
    this.runde++;
    for (const g of this.gesichter.values()) if (typeof g === 'object' && 'bild' in g) g.bild.close();
    this.gesichter.clear();
    this.woerter.clear();
  }
}
