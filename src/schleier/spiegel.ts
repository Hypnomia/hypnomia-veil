// Spiegel-Leinwaende (PHASE-3-BAUPLAN Auftrag S, S1 bis S7): Manche Seiten (TikTok) halten das Video unsichtbar und malen es Bild fuer Bild
// auf eine Leinwand daneben. Eine solche Leinwand wird nie selbst geprueft (WebGL liest leer, das wuerde jedes spaetere Bild freigeben), sondern
// folgt laufend dem Urteil ihres Videos. Dieses Modul kennt weder den Erkenner noch die Attribute des Schleiers: Urteil setzen, Zustand, Uhr und
// Zeitgeber kommen ueber `SpiegelHaken` herein, damit die Zuordnung in den Einheitstests ohne Browser laeuft. Es importiert nur Typen.

import type { Zustand } from './zustand';

export type SpiegelUrteil = 'frei' | 'verdeckt';

// Mindestanteil der Leinwandflaeche, den das Video ueberdecken muss, damit die Leinwand sein Spiegel ist (S1).
export const SPIEGEL_MIN_UEBERDECKUNG = 0.5;
// So viele Ebenen ueber dem Video werden nach Leinwaenden abgesucht (die Zuordnung selbst prueft von der Leinwand aus Eltern und Grosseltern).
const SUCH_EBENEN = 3;
// Standard fuer die Eigengroesse eines Kandidaten (gleich MIN_KANTE in konstanten.ts; der Schleier uebergibt den echten Wert in den Grenzen).
export const SPIEGEL_MIN_KANTE = 32;

const KNOTEN_ELEMENT = 1;
const KNOTEN_DOKUMENT = 9;

export interface RechteckLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Grenzwerte aus konstanten.ts, vom Schleier uebergeben (spiegel.ts importiert keine Konstanten, damit die Einheitstests ohne Bauumgebung laufen).
export interface SpiegelGrenzen {
  // Eigengroesse (videoWidth, videoHeight) ab der ein Video Kandidat ist: mindestens eine Seite so lang.
  minKante: number;
  // Freigaben ausserhalb eines Video-Wechsels: je Leinwand so lange nach ihrem letzten Wechsel (Blitz-Grenze, Entscheidung 86).
  wechselMinMs: number;
  // Freigaben im Dokument mindestens so weit auseinander.
  blitzSperreMs: number;
  // So lange muss ein Video aus dem Dokument sein, bevor die Bindung seiner Leinwand geloest wird.
  aufraeumMs: number;
}

export const STANDARD_GRENZEN: SpiegelGrenzen = { minKante: SPIEGEL_MIN_KANTE, wechselMinMs: 1000, blitzSperreMs: 334, aufraeumMs: 3000 };

// ---------- reine Geometrie ----------

export function flaeche(r: RechteckLike): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
}

// Anteil der Flaeche von `leinwand`, den `video` ueberdeckt (0 bis 1). Eine Leinwand ohne Flaeche hat keinen Anteil: 0.
export function ueberdeckung(leinwand: RechteckLike, video: RechteckLike): number {
  const a = flaeche(leinwand);
  if (a <= 0) return 0;
  const breite = Math.min(leinwand.right, video.right) - Math.max(leinwand.left, video.left);
  const hoehe = Math.min(leinwand.bottom, video.bottom) - Math.max(leinwand.top, video.top);
  if (breite <= 0 || hoehe <= 0) return 0;
  return (breite * hoehe) / a;
}

export interface VideoKandidat<V> {
  video: V;
  rechteck: RechteckLike;
}

// Waehlt unter den Videos aus Eltern- und Grosselternelement der Leinwand ihr Spiegelvideo (S1). `kandidaten` stehen in der Reihenfolge
// "naechster Behaelter zuerst, dann Dokumentreihenfolge". Mit Flaeche: das Video mit der groessten Ueberdeckung, mindestens 50 %; bei Gleichstand
// das erste. Ohne Flaeche (0 x 0, TikTok hat eine zweite, leere Leinwand): das erste Video im selben Behaelter. Die Regel gilt nur, solange die
// Leinwand keine Flaeche hat (S7): wer sie misst, misst bei jedem Abgleich neu.
export function waehleSpiegelVideo<V>(leinwand: RechteckLike, kandidaten: ReadonlyArray<VideoKandidat<V>>): V | null {
  if (!kandidaten.length) return null;
  if (flaeche(leinwand) <= 0) return kandidaten[0]!.video;
  let bestes: V | null = null;
  let bester = 0;
  for (const k of kandidaten) {
    const u = ueberdeckung(leinwand, k.rechteck);
    if (u >= SPIEGEL_MIN_UEBERDECKUNG && u > bester) {
      bester = u;
      bestes = k.video;
    }
  }
  return bestes;
}

// ---------- Suche im Dokument ----------

// Seitenwurzel (S7): body, html und das Dokument sind nie Behaelter. Sonst gehoerte jedem Video der Seite jede Leinwand daneben.
function istSeitenwurzel(n: Node): boolean {
  if (n.nodeType === KNOTEN_DOKUMENT) return true;
  if (n.nodeType !== KNOTEN_ELEMENT) return false;
  const name = String((n as Element).localName ?? '').toLowerCase();
  return name === 'body' || name === 'html';
}

// Behaelter, in dem das Video stecken muss: das Grosselternelement (es enthaelt auch das Elternelement), bei einer Leinwand direkt in einer Shadow
// Root die Wurzel selbst. Die Seitenwurzel (body, html, Dokument) gilt nie als Behaelter: dann zaehlt nur das Elternelement; ist auch das die
// Seitenwurzel, gibt es keinen Behaelter. Ueber eine Shadow-Grenze wird nicht hinausgesucht.
function behaelterVon(el: Node): ParentNode | null {
  const eltern = el.parentNode;
  if (!eltern || istSeitenwurzel(eltern)) return null;
  const gross = eltern.nodeType === KNOTEN_ELEMENT ? eltern.parentNode : null;
  return (gross && !istSeitenwurzel(gross) ? gross : eltern) as ParentNode;
}

// Videos im Behaelter der Leinwand: zuerst die im Elternelement, dann die uebrigen aus dem Grosselternelement.
function sammleVideos(leinwand: HTMLCanvasElement): HTMLVideoElement[] {
  const eltern = leinwand.parentNode as ParentNode | null;
  const behaelter = behaelterVon(leinwand);
  if (!eltern || !behaelter) return [];
  const naechste = Array.from(eltern.querySelectorAll('video'));
  if (behaelter === eltern) return naechste;
  const rest = Array.from(behaelter.querySelectorAll('video')).filter((v) => !naechste.includes(v));
  return [...naechste, ...rest];
}

// Kandidat fuer ein Spiegelvideo (S7): Eigengroesse mindestens `minKante` an einer Seite. Videos nur mit Ton und Videos unter der Mindestgroesse
// uebergibt der Schleier ohne echte Pruefung als frei; ihre Leinwand wuerde sonst ungeprueft frei. Solange die Masse noch unbekannt sind
// (readyState unter 1, TikTok legt Video und Leinwand vor den Daten an), gilt das Video als Kandidat.
export function istVideoKandidat(video: HTMLVideoElement, minKante: number = SPIEGEL_MIN_KANTE): boolean {
  if ((video.readyState ?? 0) < 1) return true;
  const b = video.videoWidth ?? 0;
  const h = video.videoHeight ?? 0;
  if (!(b > 0 && h > 0)) return false;
  return b >= minKante || h >= minKante;
}

// Das Video, dessen Spiegel die Leinwand ist, sonst null. Die Leinwand wird bei jedem Aufruf neu vermessen.
export function sucheVideo(leinwand: HTMLCanvasElement, minKante: number = SPIEGEL_MIN_KANTE): HTMLVideoElement | null {
  const videos = sammleVideos(leinwand).filter((v) => istVideoKandidat(v, minKante));
  if (!videos.length) return null;
  const rechteck = leinwand.getBoundingClientRect();
  const mitFlaeche = flaeche(rechteck) > 0;
  return waehleSpiegelVideo(
    rechteck,
    videos.map((video) => ({ video, rechteck: mitFlaeche ? video.getBoundingClientRect() : rechteck })),
  );
}

// Zaehlt eine gebundene Leinwand fuer die Eignung der Zonen-Leinwand als Spiegel? Nur wenn sie im Augenblick der Pruefung im Dokument steht und
// Flaeche hat (Breite und Hoehe groesser 0): eine Leinwand ohne Flaeche (Hilfsleinwand fuer Bildschirmfotos im Player) zeigt nichts. Die Bindung
// (S7) bleibt davon unberuehrt. Keine Mindestgroesse: jede Flaeche groesser 0 zaehlt. Ein Messfehler zaehlt als Spiegel (hide-first).
export function leinwandZaehltAlsSpiegel(leinwand: Pick<HTMLCanvasElement, 'isConnected' | 'getBoundingClientRect'>): boolean {
  try {
    if (!leinwand.isConnected) return false;
    const r = leinwand.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  } catch {
    return true;
  }
}

// Leinwaende, die zum Video passen koennten: alle Leinwaende unter dem Vorfahren einige Ebenen ueber dem Video (nie body oder html), in deren
// Behaelter das Video steckt.
export function sammleLeinwaende(video: HTMLVideoElement): HTMLCanvasElement[] {
  const start = video.parentNode as ParentNode | null;
  if (!start || istSeitenwurzel(start)) return [];
  let wurzel: ParentNode = start;
  for (let i = 1; i < SUCH_EBENEN; i++) {
    const hoeher: ParentNode | null = wurzel.nodeType === KNOTEN_ELEMENT ? (wurzel.parentNode as ParentNode | null) : null;
    if (!hoeher || istSeitenwurzel(hoeher)) break;
    wurzel = hoeher;
  }
  return Array.from(wurzel.querySelectorAll('canvas')).filter((c) => behaelterVon(c)?.contains(video));
}

// Liest die Leinwand nichts Brauchbares (WebGL ohne preserveDrawingBuffer liest nach dem Zeigen leer, fremde Pixel werfen)? Leer heisst: voellig
// durchsichtig oder einfarbig auf einem kleinen Probebild. Nur fuer ehemalige Spiegel (S7): ihr Lesezugriff darf sie nie freigeben.
export function leinwandLeer(leinwand: HTMLCanvasElement): boolean {
  try {
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 16;
    const g = probe.getContext('2d', { willReadFrequently: true });
    if (!g) return true;
    g.drawImage(leinwand, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let gleich = true;
    let sichtbar = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! !== 0) sichtbar = true;
      if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) gleich = false;
    }
    return !sichtbar || gleich;
  } catch {
    return true;
  }
}

// ---------- Zustand und Abgleich ----------

export interface SpiegelHaken {
  // Zustand des Elements im Schleier (undefined = nicht verfolgt).
  zustand(el: Element): Zustand | undefined;
  // Was das Video gerade zeigt (frei, verdeckt), null = verborgen (noch kein Urteil).
  angezeigt(video: HTMLVideoElement, z: Zustand): SpiegelUrteil | null;
  // Setzt das Urteil der Leinwand am Element (Attribut, Zustand, Status) und verwirft Antworten aelterer Pruefungen.
  setze(leinwand: HTMLCanvasElement, z: Zustand, urteil: SpiegelUrteil): void;
  // Leinwand zurueck in "ohne Urteil" (verborgen); die Zuordnung zum Video bleibt.
  vergiss(leinwand: HTMLCanvasElement, z: Zustand): void;
  // Die Beziehung ist weggefallen: die Leinwand wird wie jede Leinwand bewertet.
  bewerte(leinwand: HTMLCanvasElement, z: Zustand): void;
  // Der Schleier ist an (weder Pause noch Ausnahme, nicht abgebaut).
  aktiv(): boolean;
  // Uhr in Millisekunden und Zeitgeber (liefert die Abbruchfunktion); die Einheitstests setzen eine Scheinuhr.
  jetzt(): number;
  timer(fn: () => void, ms: number): () => void;
  // Zeit der letzten Freigabe eines Videos im Dokument; eine Freigabe des Spiegels ausserhalb eines Video-Wechsels zaehlt mit.
  letzteFreigabe(): number;
  merkeFreigabe(zeit: number): void;
  // Die Leinwand wurde (neu) einem Video zugeordnet: Zeitgeber der eigenen Pruefung und Platz in der Schlange entfallen.
  gebunden?(leinwand: HTMLCanvasElement, z: Zustand): void;
  // Zuordnung im Dokument (Standard: sucheVideo, sammleLeinwaende); die Einheitstests setzen eigene.
  suche?(leinwand: HTMLCanvasElement): HTMLVideoElement | null;
  leinwaendeBei?(video: HTMLVideoElement): HTMLCanvasElement[];
}

export class Spiegel {
  // Eigener Zustand der Spiegel (nicht in zustand.ts): Leinwand -> Video, Video -> seine Spiegel (schwach, damit nichts festgehalten wird).
  private readonly zuVideo = new WeakMap<HTMLCanvasElement, HTMLVideoElement>();
  private readonly spiegelVon = new WeakMap<HTMLVideoElement, Set<WeakRef<HTMLCanvasElement>>>();
  private readonly verweise = new WeakMap<HTMLCanvasElement, WeakRef<HTMLCanvasElement>>();
  private readonly alle = new Set<WeakRef<HTMLCanvasElement>>();
  // Leinwaende, die einmal Spiegel waren (S7): ihr eigener Lesezugriff darf sie nie freigeben.
  private readonly waren = new WeakSet<HTMLCanvasElement>();
  // Zeit des letzten Wechsels der Anzeige je Leinwand (fuer die Bremse ausserhalb von Video-Wechseln).
  private readonly letzterWechsel = new WeakMap<HTMLCanvasElement, number>();
  // Eine wartende Freigabe (Bremse) je Leinwand: Abbruchfunktion des Zeitgebers.
  private readonly wartendeFreigabe = new WeakMap<HTMLCanvasElement, () => void>();
  // Seit wann das Video der Bindung aus dem Dokument ist (erste Beobachtung beim Aufraeumen).
  private readonly getrenntSeit = new WeakMap<HTMLCanvasElement, number>();

  private readonly haken: SpiegelHaken;
  private readonly g: SpiegelGrenzen;

  constructor(haken: SpiegelHaken, grenzen: Partial<SpiegelGrenzen> = {}) {
    this.haken = haken;
    this.g = { ...STANDARD_GRENZEN, ...grenzen };
  }

  // ---------- Abfragen ----------

  videoVon(leinwand: HTMLCanvasElement): HTMLVideoElement | null {
    return this.zuVideo.get(leinwand) ?? null;
  }

  istSpiegel(leinwand: HTMLCanvasElement): boolean {
    return this.zuVideo.has(leinwand);
  }

  // Die Leinwand war einmal Spiegel (auch nach dem Loesen der Bindung).
  warSpiegel(leinwand: HTMLCanvasElement): boolean {
    return this.waren.has(leinwand);
  }

  spiegelDes(video: HTMLVideoElement): HTMLCanvasElement[] {
    const menge = this.spiegelVon.get(video);
    const liste: HTMLCanvasElement[] = [];
    if (!menge) return liste;
    for (const ref of [...menge]) {
      const c = ref.deref();
      if (c) liste.push(c);
      else menge.delete(ref);
    }
    return liste;
  }

  // Urteil, dem ein Spiegel des Videos gerade folgt (S2, S7): null = das Video hat keins. "frei" gilt nur, wenn das Urteil des Videos auf einer
  // echten Pruefung beruht (videoEcht); ein Video, das ohne Pruefung frei ging (nur Ton, klein, Fehlerfall), laesst den Spiegel verdeckt.
  ziel(video: HTMLVideoElement): SpiegelUrteil | null {
    const z = this.haken.zustand(video);
    if (!z) return null;
    const a = this.haken.angezeigt(video, z);
    if (a === 'frei') return z.videoEcht ? 'frei' : 'verdeckt';
    return a;
  }

  suche(leinwand: HTMLCanvasElement): HTMLVideoElement | null {
    return this.haken.suche ? this.haken.suche(leinwand) : sucheVideo(leinwand, this.g.minKante);
  }

  // ---------- Zuordnung ----------

  binde(leinwand: HTMLCanvasElement, video: HTMLVideoElement): void {
    const bisher = this.zuVideo.get(leinwand);
    if (bisher === video) return;
    if (bisher) this.loese(leinwand);
    let verweis = this.verweise.get(leinwand);
    if (!verweis) {
      verweis = new WeakRef(leinwand);
      this.verweise.set(leinwand, verweis);
    }
    this.zuVideo.set(leinwand, video);
    this.waren.add(leinwand);
    this.getrenntSeit.delete(leinwand);
    let menge = this.spiegelVon.get(video);
    if (!menge) {
      menge = new Set();
      this.spiegelVon.set(video, menge);
    }
    menge.add(verweis);
    this.alle.add(verweis);
    const z = this.haken.zustand(leinwand);
    if (z) this.haken.gebunden?.(leinwand, z);
  }

  // Hebt die Zuordnung auf (das Urteil der Leinwand bleibt unberuehrt).
  loese(leinwand: HTMLCanvasElement): void {
    const video = this.zuVideo.get(leinwand);
    const verweis = this.verweise.get(leinwand);
    this.zuVideo.delete(leinwand);
    this.getrenntSeit.delete(leinwand);
    this.abbrechen(leinwand);
    if (!verweis) return;
    if (video) this.spiegelVon.get(video)?.delete(verweis);
    this.alle.delete(verweis);
  }

  // ---------- Anzeige der Leinwand ----------

  private abbrechen(leinwand: HTMLCanvasElement): void {
    const f = this.wartendeFreigabe.get(leinwand);
    if (!f) return;
    this.wartendeFreigabe.delete(leinwand);
    f();
  }

  private zeige(leinwand: HTMLCanvasElement, z: Zustand, urteil: SpiegelUrteil): void {
    this.letzterWechsel.set(leinwand, this.haken.jetzt());
    this.haken.setze(leinwand, z, urteil);
  }

  // Zurueck in "ohne Urteil" (verborgen). Ein Platz in der Schlange oder ein frueheres eigenes Urteil gilt nicht mehr.
  private verberge(leinwand: HTMLCanvasElement, z: Zustand): void {
    if (z.urteil === null && !z.eingereiht) return;
    if (z.urteil !== null) this.letzterWechsel.set(leinwand, this.haken.jetzt());
    this.haken.vergiss(leinwand, z);
  }

  // Die Leinwand zeigt, was ihr Video zeigt: ohne Urteil verborgen, sonst dasselbe Urteil (S2). `sofort`: der Abgleich geschieht im Augenblick
  // eines Wechsels des Videos (Video und Spiegel zaehlen als ein Wechsel, die Bremse des Videos gilt einmal). Sonst (Neubindung, Wiederfinden,
  // Abgleich ohne Wechsel) laufen Freigaben ueber dieselbe Bremse wie bei Videos: je Leinwand `wechselMinMs` nach ihrem letzten Wechsel, im
  // Dokument `blitzSperreMs` nach der letzten Freigabe (S7). Verdecken wartet nie.
  private gleiche(leinwand: HTMLCanvasElement, z: Zustand, video: HTMLVideoElement, sofort: boolean): void {
    this.abbrechen(leinwand);
    const soll = this.ziel(video);
    if (soll === null) {
      this.verberge(leinwand, z);
      return;
    }
    if (z.urteil === soll) return;
    if (soll === 'verdeckt' || sofort) {
      this.zeige(leinwand, z, soll);
      return;
    }
    const jetzt = this.haken.jetzt();
    const ab = Math.max((this.letzterWechsel.get(leinwand) ?? Number.NEGATIVE_INFINITY) + this.g.wechselMinMs, this.haken.letzteFreigabe() + this.g.blitzSperreMs);
    if (jetzt >= ab) {
      this.zeige(leinwand, z, 'frei');
      this.haken.merkeFreigabe(jetzt);
      return;
    }
    this.wartendeFreigabe.set(
      leinwand,
      this.haken.timer(() => {
        this.wartendeFreigabe.delete(leinwand);
        this.spaeter(leinwand);
      }, ab - jetzt + 1),
    );
  }

  // Eine wartende Freigabe ist faellig: noch einmal gegen den aktuellen Stand abgleichen (das Video kann inzwischen verdeckt haben).
  private spaeter(leinwand: HTMLCanvasElement): void {
    if (!this.haken.aktiv()) return;
    const video = this.zuVideo.get(leinwand);
    const z = this.haken.zustand(leinwand);
    if (!video || !z || !leinwand.isConnected) return;
    this.gleiche(leinwand, z, video, false);
  }

  // ---------- Folgen ----------

  // Gleicht Zuordnung und Anzeige der Leinwand mit dem Dokument ab (beim Bewerten, Entdecken, nach Takt-Ergebnissen und vor dem Anwenden eines
  // Ergebnisses aus der Warteschlange): hat sie ein Spiegelvideo, wird sie ihm zugeordnet und uebernimmt dessen Urteil; true = ist Spiegel, wird nie
  // selbst geprueft. Weicht die Zuordnung von der bisherigen ab, beginnt die Leinwand neu ohne Urteil (ein eigenes Urteil oder ein Platz in der
  // Schlange gilt dann nicht mehr). Faellt die Beziehung weg (Video verschoben, Leinwand zu klein ueberdeckt), wird die Leinwand wieder
  // wie jede Leinwand bewertet; der Aufrufer bewertet. Ein aus dem Dokument entferntes Video loest die Bindung nicht sofort (erst `raeumeAuf`),
  // ebenso bleibt die Bindung, solange die Leinwand selbst getrennt ist.
  ordne(leinwand: HTMLCanvasElement, z: Zustand, sofort = false): boolean {
    const bisher = this.zuVideo.get(leinwand) ?? null;
    if (!leinwand.isConnected) return bisher !== null;
    const jetzt = this.suche(leinwand);
    if (jetzt === bisher) {
      if (jetzt) this.gleiche(leinwand, z, jetzt, sofort);
      return jetzt !== null;
    }
    if (jetzt) {
      this.binde(leinwand, jetzt);
      this.verberge(leinwand, z);
      this.gleiche(leinwand, z, jetzt, sofort);
      return true;
    }
    // Kein Spiegelvideo mehr gefunden. Ein aus dem Dokument entferntes Video kommt vielleicht zurueck (Seiten haengen Videos aus und ein):
    // die Bindung bleibt bis zum verzoegerten Aufraeumen.
    if (bisher && !bisher.isConnected) return true;
    if (bisher) {
      this.loese(leinwand);
      this.verberge(leinwand, z);
    }
    return false;
  }

  // Das Urteil des Videos hat sich im Takt geaendert oder fiel weg (Wechsel im Takt, Quellenwechsel, Zuruecksetzen): die Spiegel gehen im selben
  // Augenblick mit, ohne eigene Pruefung und ohne eigene Bremse (S2, S3). Getrennte Leinwaende bleiben unberuehrt; sie gleichen sich beim
  // Wiederfinden ab.
  angleichen(video: HTMLVideoElement): void {
    for (const c of this.spiegelDes(video)) {
      if (!c.isConnected) continue;
      const z = this.haken.zustand(c);
      if (z) this.gleiche(c, z, video, true);
    }
  }

  // Leinwaende in der Naehe des Videos neu abgleichen: die bisherigen Spiegel (Rechteck neu vermessen) und alle, die erst jetzt als Spiegel
  // erkennbar sind (das Layout stand beim Bewerten noch nicht). Aufgerufen beim Entdecken des Videos (auch ohne Urteil), nach jedem Takt-Ergebnis
  // und bei jedem Urteil des Videos (`sofort`).
  pruefeNachbarn(video: HTMLVideoElement, sofort = false): void {
    const liste = new Set<HTMLCanvasElement>(this.spiegelDes(video));
    for (const c of (this.haken.leinwaendeBei ?? sammleLeinwaende)(video)) liste.add(c);
    for (const c of liste) {
      const z = this.haken.zustand(c);
      if (!z || z.art !== 'canvas') continue;
      const warGebunden = this.zuVideo.has(c);
      // Fiel die Beziehung weg (zum Beispiel ein Video nur mit Ton), geht die Leinwand zurueck in die gewoehnliche Bewertung.
      if (!this.ordne(c, z, sofort) && warGebunden) this.haken.bewerte(c, z);
    }
  }

  // Urteil des Videos gesetzt oder verworfen (Erst-Urteil, Verbergen, nicht aus dem Takt): einmal abgleichen und die Spiegel gehen sofort mit.
  beiVideoUrteil(video: HTMLVideoElement): void {
    this.pruefeNachbarn(video, true);
  }

  // Das Video wurde entdeckt (neu oder wieder eingehaengt), auch ohne Urteil.
  beiVideoEntdeckt(video: HTMLVideoElement): void {
    this.pruefeNachbarn(video);
  }

  // Verzoegertes Aufraeumen (der Schleier ruft es nach entfernten Knoten, 3 s Verzoegerung): ist das Video einer Bindung seit mindestens
  // `aufraeumMs` aus dem Dokument, ist die Leinwand kein Spiegel mehr und wird wie jede Leinwand bewertet (S3, S7). Eine getrennte Leinwand
  // behaelt ihre Bindung. Liefert die Zahl der Bindungen, deren Video getrennt, aber noch nicht lange genug getrennt ist (der Schleier plant
  // dann einen weiteren Durchlauf).
  raeumeAuf(): number {
    let offen = 0;
    const jetzt = this.haken.jetzt();
    for (const verweis of [...this.alle]) {
      const c = verweis.deref();
      if (!c) {
        this.alle.delete(verweis);
        continue;
      }
      const video = this.zuVideo.get(c);
      if (!video) {
        this.alle.delete(verweis);
        continue;
      }
      if (!c.isConnected || video.isConnected) {
        this.getrenntSeit.delete(c);
        continue;
      }
      const seit = this.getrenntSeit.get(c);
      if (seit === undefined) {
        this.getrenntSeit.set(c, jetzt);
        offen++;
        continue;
      }
      // Kleine Toleranz: ein Zeitgeber kann einige Millisekunden vor der Frist feuern.
      if (jetzt - seit + 100 < this.g.aufraeumMs) {
        offen++;
        continue;
      }
      this.loese(c);
      const z = this.haken.zustand(c);
      if (!z) continue;
      this.verberge(c, z);
      this.haken.bewerte(c, z);
    }
    return offen;
  }
}
