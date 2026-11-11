// Reine Logik der bereichsweisen Video-Zensur (Bauplan Video-Zonen, Auftraege V3 und V3b): Inhaltsrechteck nach object-fit, Umrechnung der Boxen
// auf die Videoaufloesung, Spuren mit Zuordnung per IoU und Verfolgung je Bild, Rand und Entspannen der gezeigten Box, Entscheidung zonen oder ganz,
// Bremse fuer den Wechsel, Median der Rundlaeufe, Eignung eines Videos. Ohne Browser und ohne DOM: laeuft in den Einheitstests.
// Alle Zeiten in Sekunden Medienzeit, ausser `Ms` im Namen. Boxen in Bildpunkten des Videos, ausser wo anders vermerkt.

import type { Zone } from '../einstellungen';
import { BEHANDLUNGEN, behandlungFuerZone, ganzesBildBehandlung, hatWort, ohneWort, type Behandlung, type Preset } from '../presets.ts';
import type { GrauBild } from './daumen.ts';
import { verfolgeBox, type BoxF, type VerfolgungsOptionen } from './verfolgung.ts';

export interface Rechteck {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Kanten statt Breite und Hoehe: links, oben, rechts, unten.
export interface Kanten {
  l: number;
  t: number;
  r: number;
  b: number;
}

// ---------- Inhaltsrechteck (object-fit, object-position) ----------

export type ObjektPassung = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';
export interface Position1 {
  wert: number;
  einheit: '%' | 'px';
}
export interface Position2 {
  x: Position1;
  y: Position1;
}

export function istObjektPassung(s: string): s is ObjektPassung {
  return s === 'fill' || s === 'contain' || s === 'cover' || s === 'none' || s === 'scale-down';
}

// object-position wie der Browser sie berechnet ausgibt ("50% 50%", "10px 20px"); Schluesselwoerter werden zu Prozent. Unlesbares ergibt die Mitte.
export function parsePosition(text: string | null | undefined): Position2 {
  const mitte: Position2 = { x: { wert: 50, einheit: '%' }, y: { wert: 50, einheit: '%' } };
  if (!text) return mitte;
  const teile = text.trim().split(/\s+/);
  const eins = (t: string | undefined): Position1 | null => {
    if (!t) return null;
    const k = t.toLowerCase();
    if (k === 'center') return { wert: 50, einheit: '%' };
    if (k === 'left' || k === 'top') return { wert: 0, einheit: '%' };
    if (k === 'right' || k === 'bottom') return { wert: 100, einheit: '%' };
    const m = /^(-?\d+(?:\.\d+)?)(%|px)$/.exec(k);
    if (!m) return null;
    return { wert: Number(m[1]), einheit: m[2] as '%' | 'px' };
  };
  const x = eins(teile[0]);
  const y = eins(teile[1] ?? teile[0]);
  return { x: x ?? mitte.x, y: y ?? mitte.y };
}

// Wo das Videobild innerhalb der Inhaltsbox des Elements (Breite elB, Hoehe elH in CSS-Pixeln, ohne Rand und Innenabstand) gezeigt wird.
export function inhaltsRechteck(elB: number, elH: number, vb: number, vh: number, passung: ObjektPassung, position: Position2 = parsePosition(null)): Rechteck {
  if (!(elB > 0 && elH > 0 && vb > 0 && vh > 0)) return { x: 0, y: 0, w: Math.max(0, elB), h: Math.max(0, elH) };
  let w: number;
  let h: number;
  switch (passung) {
    case 'fill':
      return { x: 0, y: 0, w: elB, h: elH };
    case 'cover': {
      const s = Math.max(elB / vb, elH / vh);
      w = vb * s;
      h = vh * s;
      break;
    }
    case 'none':
      w = vb;
      h = vh;
      break;
    case 'scale-down': {
      const s = Math.min(1, Math.min(elB / vb, elH / vh));
      w = vb * s;
      h = vh * s;
      break;
    }
    default: {
      const s = Math.min(elB / vb, elH / vh);
      w = vb * s;
      h = vh * s;
    }
  }
  const versatz = (p: Position1, frei: number): number => (p.einheit === '%' ? (frei * p.wert) / 100 : p.wert);
  return { x: versatz(position.x, elB - w), y: versatz(position.y, elH - h), w, h };
}

// ---------- Umrechnung ----------

export interface ZoneBox {
  zone: Zone;
  box: Rechteck;
  // Unsicherheit der Box in Videopixeln (nach dem Nachfuehren auf den aktuellen Bildstand), sonst 0.
  unsicher?: number;
  // Behandlung dieser Flaeche (Preset-Tabelle, vom Erkenner gesetzt) und Ersatz fuer Mias Gesicht; fehlt sie, gilt die Tabelle nach der Zone.
  behandlung?: Behandlung;
  ersatz?: Behandlung;
}

const alsBehandlung = (x: unknown): Behandlung | undefined => ((BEHANDLUNGEN as readonly unknown[]).includes(x) ? (x as Behandlung) : undefined);

// Flaechen der Antwort (Box als [x, y, w, h] im Bild der Antwort, Breite vonB mal Hoehe vonH) auf die Videoaufloesung umrechnen und begrenzen.
export function skaliereFlaechen(flaechen: ReadonlyArray<{ zone: Zone; box: readonly number[]; behandlung?: unknown; ersatz?: unknown }>, vonB: number, vonH: number, zuB: number, zuH: number): ZoneBox[] {
  if (!(vonB > 0 && vonH > 0 && zuB > 0 && zuH > 0)) return [];
  const fx = zuB / vonB;
  const fy = zuH / vonH;
  const aus: ZoneBox[] = [];
  for (const f of flaechen) {
    const [x, y, w, h] = f.box as [number, number, number, number];
    if (![x, y, w, h].every(Number.isFinite)) continue;
    const l = Math.max(0, x * fx);
    const t = Math.max(0, y * fy);
    const r = Math.min(zuB, (x + w) * fx);
    const b = Math.min(zuH, (y + h) * fy);
    if (r - l <= 0 || b - t <= 0) continue;
    const behandlung = alsBehandlung(f.behandlung);
    const ersatz = alsBehandlung(f.ersatz);
    aus.push({ zone: f.zone, box: { x: l, y: t, w: r - l, h: b - t }, ...(behandlung ? { behandlung } : {}), ...(ersatz ? { ersatz } : {}) });
  }
  return aus;
}

export function iou(a: Rechteck, b: Rechteck): number {
  const l = Math.max(a.x, b.x);
  const t = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const u = Math.min(a.y + a.h, b.y + b.h);
  const schnitt = Math.max(0, r - l) * Math.max(0, u - t);
  const vereint = a.w * a.h + b.w * b.h - schnitt;
  return vereint > 0 ? schnitt / vereint : 0;
}

// ---------- Zeichenart je Zone (Presets) ----------
// Die EINE Stelle, die ein Preset, eine Zone und den Stand der Hilfsmittel auf eine Zeichenart abbildet. Die Tabelle steht nur in src/presets.ts: der Erkenner
// setzt `behandlung` je Flaeche nach ihr (berechneFlaechen), fehlt sie, gilt behandlungFuerZone aus derselben Tabelle. Regeln wie bei Bildern
// (rendereZensur in src/erkenner/stile.ts):
// - Mias Gesicht nur, wenn ein Gesichts-Patch da ist UND passt (patchPasst), sonst die Ersatz-Behandlung der Flaeche (Koerper-Behandlung), nie leer.
// - Eine Behandlung mit Wort ohne Wort (noch nicht geladen, Schrift fehlt) oder auf zu kleiner Flaeche (wortPasst) wird ihre Variante ohne Wort.
export type Zeichenart = Behandlung;

export interface ZonenLage {
  // Behandlung der Flaeche laut Erkenner; fehlt sie, nach der Tabelle.
  behandlung?: Behandlung;
  ersatz?: Behandlung;
  // Ein Gesichts-Patch ist geladen und passt zur Flaeche (patchPasst).
  gesichtPasst: boolean;
  // Ein Wort ist da und die Schrift geladen; die Flaeche ist gross genug (wortPasst).
  wortDa: boolean;
  wortPasst: boolean;
}

export function wirksameBehandlung(preset: Preset, zone: Zone, behandlung?: Behandlung): Behandlung {
  return behandlung ?? behandlungFuerZone(preset, zone);
}

// Ersatz fuer Mias Gesicht: die Koerper-Behandlung (nie wieder Mias Gesicht).
export function ersatzFuer(preset: Preset, ersatz?: Behandlung): Behandlung {
  return ersatz && ersatz !== 'mia-gesicht' ? ersatz : ganzesBildBehandlung(preset);
}

// Braucht die Flaeche ein Wort (auch als Ersatz fuer ein fehlendes Mia-Gesicht)? Dann holt der Aufrufer es, sonst nicht.
export function brauchtWort(preset: Preset, zone: Zone, behandlung?: Behandlung, ersatz?: Behandlung): boolean {
  const b = wirksameBehandlung(preset, zone, behandlung);
  return hatWort(b) || (b === 'mia-gesicht' && hatWort(ersatzFuer(preset, ersatz)));
}

export function stilFuerZone(preset: Preset, zone: Zone, l: ZonenLage): Zeichenart {
  let b = wirksameBehandlung(preset, zone, l.behandlung);
  if (b === 'mia-gesicht') {
    if (l.gesichtPasst) return 'mia-gesicht';
    b = ersatzFuer(preset, l.ersatz);
  }
  if (hatWort(b) && !(l.wortDa && l.wortPasst)) b = ohneWort(b);
  return b;
}

// ---------- Spuren ----------

export interface Spur {
  id: number;
  // Schluessel fuer Mias Gesicht und das Wort dieser Flaeche. Ohne Erbe gleich `id`; entsteht die Spur kurz nach dem Verlust einer Spur an etwa derselben
  // Stelle (gleiche Zone, gleiche wirksame Behandlung), traegt sie deren Motiv weiter (siehe SpurListe.ordneZu): dasselbe Wort, dasselbe Gesicht.
  motiv: number;
  // Zone beim Anlegen (bleibt, damit ein gewaehltes Patch-Bild stabil bleibt).
  zone: Zone;
  // Verfolgte Zone ohne Rand, in Bildpunkten des Videos.
  box: Rechteck;
  // Gezeigte Kanten (Videopixel), null = noch keine.
  anzeige: Kanten | null;
  // Zusatzrand in Videopixeln fuer die Unsicherheit der Verfolgung.
  unsicher: number;
  // Behandlung und Ersatz der letzten Erkennung (siehe ZoneBox).
  behandlung?: Behandlung;
  ersatz?: Behandlung;
  // Medienzeit der letzten Erkennung (Aufnahmezeit des Bildes, das geprueft wurde).
  letzterTreffer: number;
}

export interface SpurParameter {
  // Wirksames Preset: fehlt `behandlung` auf einer Seite, wird vor dem Vergleich die Behandlung der Tabelle nach der Zone eingesetzt (keine Doppelspuren).
  preset?: Preset;
  zuordnungIou: number;
  halten: number;
}

// Erbe des Motivs (Wort, Mias Gesicht): eine verlorene Spur bleibt so lange Medienzeit (ab ihrem letzten Treffer, in beide Richtungen) im Gedaechtnis.
// 2 s decken den Verlust durch entferneAlte (Haltezeit 1 s) samt einer Antwort danach und eine neue Szene (Sprung, Sichtbarwerden, Groessenwechsel) samt
// der Sofortpruefung; ein weiterer Sprung oder eine lange Luecke erbt nicht.
export const SPUR_ERBE_S = 2;
// Hoechstens so viele verlorene Spuren im Gedaechtnis (die aeltesten fallen zuerst weg).
export const SPUR_ERBE_MAX = 16;

// Eine verlorene Spur im Gedaechtnis: Motiv, Zone, Behandlung (wie an der Spur; die wirksame setzt ordneZu mit dem Preset ein), letzte Box, Medienzeit des letzten Treffers.
export interface SpurErbe {
  motiv: number;
  zone: Zone;
  behandlung?: Behandlung;
  box: Rechteck;
  zeit: number;
}

const boxMitte = (r: Rechteck): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

export class SpurListe {
  spuren: Spur[] = [];
  private naechste = 1;
  private gedaechtnis: SpurErbe[] = [];

  // Verlorene Spuren, deren Motiv eine neue Spur an derselben Stelle erben kann (nur lesen, fuer die Einheitstests).
  get erbe(): readonly SpurErbe[] {
    return this.gedaechtnis;
  }

  // Neue Szene (Schnitt, Sprung, Sichtbarwerden, Groessenwechsel): alle Spuren fallen weg, ihre Motive bleiben kurz im Gedaechtnis.
  leere(): void {
    for (const s of this.spuren) this.merke(s);
    this.spuren = [];
  }

  // Wirklich etwas anderes beginnt (andere Quelle): Spuren UND Gedaechtnis weg, kein Motiv wird mehr geerbt.
  vergiss(): void {
    this.spuren = [];
    this.gedaechtnis = [];
  }

  private merke(s: Spur): void {
    this.gedaechtnis.push({ motiv: s.motiv, zone: s.zone, ...(s.behandlung ? { behandlung: s.behandlung } : {}), box: { ...s.box }, zeit: s.letzterTreffer });
    if (this.gedaechtnis.length > SPUR_ERBE_MAX) this.gedaechtnis.splice(0, this.gedaechtnis.length - SPUR_ERBE_MAX);
  }

  // Eintraege, die (Medienzeit, beide Richtungen) zu weit von `jetzt` liegen, kann niemand mehr erben.
  private altern(jetzt: number): void {
    this.gedaechtnis = this.gedaechtnis.filter((g) => Math.abs(jetzt - g.zeit) <= SPUR_ERBE_S);
  }

  // Erkennungen (schon auf den aktuellen Bildstand nachgefuehrt) den Spuren zuordnen: groesster IoU zuerst, mindestens `zuordnungIou`.
  // Zugeordnete Spuren nehmen die Erkennung als Box (die Spur wird nie kleiner als die Erkennung, geglaettet wird nur beim Zeigen), die Unsicherheit
  // beginnt neu. Nicht zugeordnete Erkennungen werden neue Spuren. `zeit` ist die Aufnahmezeit des geprueften Bildes.
  // Eine neue Spur erbt das Motiv einer verlorenen Spur aus dem Gedaechtnis, wenn Zone und wirksame Behandlung gleich sind, die Medienzeit hoechstens
  // SPUR_ERBE_S auseinander liegt und die Boxen nah sind (Ueberlappung oder Abstand der Mitten hoechstens die laengere Seite der alten Box). Die naechste
  // Mitte gewinnt, jeder Eintrag wird nur einmal geerbt, ein Motiv einer lebenden Spur nie. Das Erbe aendert nur Wort und Gesicht, nie Box, Rand oder Ansicht.
  ordneZu(erkennungen: readonly ZoneBox[], zeit: number, p: SpurParameter, unsicherNeu = 0): Spur[] {
    // Nur Flaechen gleicher Behandlung gehoeren zusammen (sonst nimmt ein Gesicht die Spur des Kopfes darum, bei niedriger Schwelle).
    const wirksam = (zone: Zone, b?: Behandlung): Behandlung | undefined => b ?? (p.preset ? behandlungFuerZone(p.preset, zone) : undefined);
    const paare: Array<{ s: number; e: number; wert: number }> = [];
    this.spuren.forEach((s, si) => {
      erkennungen.forEach((e, ei) => {
        const bs = wirksam(s.zone, s.behandlung);
        const be = wirksam(e.zone, e.behandlung);
        if (bs !== be) return;
        const w = iou(s.box, e.box);
        if (w >= p.zuordnungIou) paare.push({ s: si, e: ei, wert: w });
      });
    });
    paare.sort((a, b) => b.wert - a.wert);
    const spurBelegt = new Set<number>();
    const erkennungBelegt = new Set<number>();
    for (const paar of paare) {
      if (spurBelegt.has(paar.s) || erkennungBelegt.has(paar.e)) continue;
      spurBelegt.add(paar.s);
      erkennungBelegt.add(paar.e);
      const s = this.spuren[paar.s]!;
      s.box = { ...erkennungen[paar.e]!.box };
      s.unsicher = erkennungen[paar.e]!.unsicher ?? unsicherNeu;
      if (erkennungen[paar.e]!.ersatz !== undefined) s.ersatz = erkennungen[paar.e]!.ersatz;
      s.letzterTreffer = zeit;
    }
    const neue = erkennungen.map((_, ei) => ei).filter((ei) => !erkennungBelegt.has(ei));
    // Erbe: alle passenden Paare (neue Erkennung, Eintrag), naechste Mitte zuerst; jede Erkennung und jeder Eintrag hoechstens einmal.
    const erbe = new Map<number, number>();
    if (neue.length && this.gedaechtnis.length) {
      const lebend = new Set(this.spuren.map((s) => s.motiv));
      const kandidaten: Array<{ e: number; g: number; abstand: number }> = [];
      for (const ei of neue) {
        const e = erkennungen[ei]!;
        const be = wirksam(e.zone, e.behandlung);
        const [ex, ey] = boxMitte(e.box);
        this.gedaechtnis.forEach((g, gi) => {
          if (g.zone !== e.zone || wirksam(g.zone, g.behandlung) !== be || lebend.has(g.motiv)) return;
          if (!(Math.abs(zeit - g.zeit) <= SPUR_ERBE_S)) return;
          const [gx, gy] = boxMitte(g.box);
          const abstand = Math.hypot(ex - gx, ey - gy);
          if (!(iou(g.box, e.box) > 0 || abstand <= Math.max(g.box.w, g.box.h))) return;
          kandidaten.push({ e: ei, g: gi, abstand });
        });
      }
      kandidaten.sort((a, b) => a.abstand - b.abstand);
      const genommen = new Set<number>();
      const motive = new Set<number>();
      for (const k of kandidaten) {
        const m = this.gedaechtnis[k.g]!.motiv;
        if (erbe.has(k.e) || genommen.has(k.g) || motive.has(m)) continue;
        erbe.set(k.e, m);
        genommen.add(k.g);
        motive.add(m);
      }
      if (genommen.size) this.gedaechtnis = this.gedaechtnis.filter((_, gi) => !genommen.has(gi));
    }
    for (const ei of neue) {
      const e = erkennungen[ei]!;
      const id = this.naechste++;
      this.spuren.push({ id, motiv: erbe.get(ei) ?? id, zone: e.zone, box: { ...e.box }, anzeige: null, unsicher: e.unsicher ?? unsicherNeu, letzterTreffer: zeit, ...(e.behandlung ? { behandlung: e.behandlung } : {}), ...(e.ersatz ? { ersatz: e.ersatz } : {}) });
    }
    return this.spuren;
  }

  // Spuren ohne Treffer seit mehr als `halten` Sekunden Medienzeit fallen weg (ins Gedaechtnis). Springt die Zeit zurueck (Sprung), fallen alle weg.
  entferneAlte(jetzt: number, halten: number): void {
    const bleiben: Spur[] = [];
    for (const s of this.spuren) {
      if (jetzt >= s.letzterTreffer && jetzt - s.letzterTreffer <= halten) bleiben.push(s);
      else this.merke(s);
    }
    this.spuren = bleiben;
    this.altern(jetzt);
  }
}

// ---------- Verfolgung je Bild ----------

export interface VerfolgungsParameter {
  suchBasis: number;
  suchMax: number;
  sadUnsicher: number;
  kontrastMin: number;
  // Wachstum der Unsicherheit je Sekunde Medienzeit (Anteil der laengeren Bildseite), wenn die Verfolgung unsicher ist.
  wachstumJeS: number;
  // Fehler einer sicheren Verfolgung je Schritt in Bildpunkten des Graustufenbildes.
  fehlerSicher: number;
}

export const FEHLER_SICHER_GRAUPIXEL = 0.6;

export function suchRadius(dt: number, p: Pick<VerfolgungsParameter, 'suchBasis' | 'suchMax'>): number {
  const wunsch = p.suchBasis + Math.max(0, dt) * 60;
  return Math.max(1, Math.min(p.suchMax, Math.round(wunsch)));
}

export interface SchrittErgebnis {
  box: Rechteck;
  unsicher: number;
  sicher: boolean;
}

// Fuehrt eine Box (Videopixel) durch eine Folge von Graustufenbildern (alle gleicher Groesse, `zeiten` je Bild in Sekunden Medienzeit).
// `skala` rechnet Videopixel in Graustufenpixel um. Die Unsicherheit (in Videopixeln) waechst je Schritt: klein bei sicherer Verfolgung, sonst wie
// ohne Verfolgung mit der Zeit und der laengeren Bildseite `laenge`.
export function fuehreDurch(box: Rechteck, unsicher: number, bilder: readonly GrauBild[], zeiten: readonly number[], skala: number, laenge: number, p: VerfolgungsParameter): SchrittErgebnis {
  let aktuell = { ...box };
  let u = unsicher;
  let alleSicher = true;
  for (let i = 1; i < bilder.length; i++) {
    const dt = Math.max(0, (zeiten[i] ?? 0) - (zeiten[i - 1] ?? 0));
    const o: VerfolgungsOptionen = { radius: suchRadius(dt, p), sadUnsicher: p.sadUnsicher, kontrastMin: p.kontrastMin };
    const f: BoxF = { x: aktuell.x * skala, y: aktuell.y * skala, w: aktuell.w * skala, h: aktuell.h * skala };
    const v = verfolgeBox(bilder[i - 1]!, bilder[i]!, f, o);
    if (v.sicher) {
      aktuell = { x: aktuell.x + v.dx / skala, y: aktuell.y + v.dy / skala, w: aktuell.w, h: aktuell.h };
      u += p.fehlerSicher / skala;
    } else {
      // Unsicher: die Verschiebung wird nicht uebernommen (sie waere Raten), die Box waechst mit der Zeit.
      alleSicher = false;
      u += p.wachstumJeS * dt * laenge;
    }
  }
  return { box: aktuell, unsicher: u, sicher: alleSicher };
}

// ---------- Zeigen: Rand, Entspannen, Anteil ----------

export function begrenzeKanten(k: Kanten, bildB: number, bildH: number): Kanten {
  return { l: Math.max(0, k.l), t: Math.max(0, k.t), r: Math.min(bildB, k.r), b: Math.min(bildH, k.b) };
}

// Ziel der gezeigten Box: Spurbox mit Randbasis (Anteil der laengeren Bildseite) plus Unsicherheit, auf das Bild begrenzt.
export function zielKanten(s: Pick<Spur, 'box' | 'unsicher'>, bildB: number, bildH: number, randBasis: number): Kanten {
  const m = randBasis * Math.max(bildB, bildH) + s.unsicher;
  return begrenzeKanten({ l: s.box.x - m, t: s.box.y - m, r: s.box.x + s.box.w + m, b: s.box.y + s.box.h + m }, bildB, bildH);
}

// Gezeigte Kanten auf das Ziel zubewegen: nach aussen sofort (nie ein Bildpunkt weniger gedeckt als das Ziel verlangt), nach innen mit der
// Zeitkonstante `tau` (gleitender Mittelwert gegen Zittern). Ohne bisherige Kanten gilt das Ziel.
export function entspanne(alt: Kanten | null, ziel: Kanten, dt: number, tau: number): Kanten {
  if (!alt) return { ...ziel };
  const k = tau > 0 ? 1 - Math.exp(-Math.max(0, dt) / tau) : 1;
  const schritt = (a: number, z: number, nachAussenKleiner: boolean): number => {
    // nachAussenKleiner: links und oben wachsen nach aussen mit kleinerem Wert
    const aussen = nachAussenKleiner ? z < a : z > a;
    return aussen ? z : a + (z - a) * k;
  };
  return { l: schritt(alt.l, ziel.l, true), t: schritt(alt.t, ziel.t, true), r: schritt(alt.r, ziel.r, false), b: schritt(alt.b, ziel.b, false) };
}

export function kantenZuRechteck(k: Kanten): Rechteck {
  return { x: k.l, y: k.t, w: Math.max(0, k.r - k.l), h: Math.max(0, k.b - k.t) };
}

// Anteil der Bildflaeche, den die Kanten decken (Summe der Einzelflaechen, ueberlappende zaehlen doppelt: lieber zu viel, Sicherheit zuerst).
export function boxenAnteil(liste: readonly Kanten[], bildB: number, bildH: number): number {
  if (!(bildB > 0 && bildH > 0)) return 1;
  let summe = 0;
  for (const k of liste) summe += Math.max(0, k.r - k.l) * Math.max(0, k.b - k.t);
  return summe / (bildB * bildH);
}

// ---------- Entscheidung zonen oder ganz (im Bild) ----------

export type Ansicht = 'zonen' | 'ganz';
export type GanzGrund = 'alt' | 'schnitt' | 'sprung' | 'anteil' | 'fehler' | 'wartet' | 'zeit' | 'leer';

export interface AnsichtFakten {
  // Sekunden Medienzeit seit der Aufnahme des Bildes der letzten ausgewerteten Antwort. Infinity = noch keine oder Sprung nach hinten.
  alter: number;
  alterMax: number;
  // Dieses Bild gehoert zu einer neuen Szene (Schnitt erkannt).
  schnitt: boolean;
  // Dieses Bild kam nach einem Sprung der Abspielposition.
  sprung: boolean;
  // Die neue Szene ist noch nicht (mit einer Antwort zu einem Bild dieser Szene) geprueft.
  wartetAufSzene: boolean;
  anteil: number;
  ganzAnteil: number;
  // Die letzte Antwort war ein Fehler oder blieb aus.
  fehler: boolean;
  // Keine Spur (keine Antwort mit Boxen zur aktuellen Szene), das Urteil "verdeckt" gilt aber noch (die Hysterese haelt das Video): ein klares Bild
  // waere dann offen. Optional, Standard false.
  leerGehalten?: boolean;
}

export function entscheideAnsicht(f: AnsichtFakten): { ansicht: Ansicht; grund: GanzGrund | null } {
  if (f.schnitt) return { ansicht: 'ganz', grund: 'schnitt' };
  if (f.sprung) return { ansicht: 'ganz', grund: 'sprung' };
  if (f.fehler) return { ansicht: 'ganz', grund: 'fehler' };
  if (f.wartetAufSzene) return { ansicht: 'ganz', grund: 'wartet' };
  if (f.leerGehalten) return { ansicht: 'ganz', grund: 'leer' };
  if (!(f.alter <= f.alterMax)) return { ansicht: 'ganz', grund: 'alt' };
  if (f.anteil > f.ganzAnteil) return { ansicht: 'ganz', grund: 'anteil' };
  return { ansicht: 'zonen', grund: null };
}

// Bremse fuer den Wechsel der Ansicht (Blitz-Grenze, hoechstens 2 Wechsel je Sekunde und Video): Decken ("ganz") sofort, zurueck zu den Zonen
// fruehestens `minMs` nach dem letzten Wechsel. Gibt die Zeit (performance.now) zurueck, ab der der Wechsel erlaubt ist.
export function fruehestensAnsicht(ziel: Ansicht, letzterWechsel: number, minMs: number): number {
  return ziel === 'ganz' ? Number.NEGATIVE_INFINITY : letzterWechsel + minMs;
}

// Medienzeit eines Durchgangs ohne Bildzeit (Pause, Takt): die Uhr. Liegt sie hoechstens `toleranz` hinter der Bildzeit des letzten Bildes (`letzteMt`),
// gilt die Bildzeit, sonst fiele die Zeit zurueck und entferneAlte verwuerfe alle Spuren. Ist ein Sprung gemeldet (`sprungOffen`: seeking oder seeked noch nicht
// verarbeitet), kommt immer die Uhr zurueck: ein gemeldeter Sprung ist nie ein Rueckfall der Uhr, der Durchgang muss ihn als neue Szene sehen. Weiter zurueck bleibt die Uhr: das ist ein echter Rueckwaertssprung.
export function zeitOhneRueckfall(uhr: number, letzteMt: number, toleranz: number, sprungOffen: boolean): number {
  if (sprungOffen || !Number.isFinite(uhr) || !Number.isFinite(letzteMt)) return uhr;
  const d = letzteMt - uhr;
  return d > 0 && d <= toleranz ? letzteMt : uhr;
}

// Beobachtete saubere Medienzeit nach einer Antwort: ein Treffer setzt sie auf 0; sonst waechst sie um den Abstand zur vorigen Antwort derselben Szene
// (`letzteMt` unendlich negativ = erste Antwort der Szene: 0), hoechstens um `maxSchritt`. Eine Luecke der Medienzeit (Sprung, Hintergrund-Tab,
// weggescrollt) zaehlt damit nie als sauber.
export function saubereZeitNach(alt: number, letzteMt: number, mt: number, hatBoxen: boolean, maxSchritt: number): number {
  if (hatBoxen) return 0;
  const schritt = Number.isFinite(letzteMt) && mt > letzteMt ? Math.min(maxSchritt, mt - letzteMt) : 0;
  return alt + schritt;
}

// Darf ein Zonen-Video wieder frei werden? Nur nach `freiNachS` Sekunden Medienzeit ohne Treffer (Sprung zurueck: nie).
export function darfFrei(jetzt: number, letzterTreffer: number, freiNachS: number): boolean {
  return jetzt >= letzterTreffer && jetzt - letzterTreffer >= freiNachS;
}

// Rueckkehr von "ganz" zu den Zonen (Hysterese gegen Flackern): nur, wenn zwei Rundlaeufe samt einem Bild kuerzer ist als das erlaubte Alter der Boxen.
// Ohne Messwert (noch keine Antwort gemessen) gilt sie als erfuellt.
// Vor einer Antwort sind die Boxen bis zu zwei Rundlaeufe plus ein Bild alt (die naechste Pruefung startet erst mit dem Bild nach der Antwort).
export function rueckkehrOk(medianMs: number | null, bildS: number, alterMaxS: number): boolean {
  return medianMs === null || (2 * medianMs) / 1000 + bildS < alterMaxS;
}

// Wie lange eine Spur ohne Treffer haelt: mindestens `basisS`, bei langsamem Erkenner das Dreifache des Rundlaufs (sonst verfielen Spuren zwischen zwei Antworten).
export function spurHalten(medianMs: number | null, basisS: number): number {
  return medianMs === null ? basisS : Math.max(basisS, (3 * medianMs) / 1000);
}

// ---------- Rundlauf ----------

// Median der letzten `fenster` Rundlaeufe in Millisekunden (Zeit von der Aufnahme des Bildes bis zur Antwort).
export class Rundlauf {
  private liste: number[] = [];
  private readonly fenster: number;
  private readonly mindestens: number;

  constructor(fenster: number, mindestens = 3) {
    this.fenster = fenster;
    this.mindestens = mindestens;
  }

  push(ms: number): void {
    this.liste.push(ms);
    if (this.liste.length > this.fenster) this.liste.shift();
  }

  median(): number | null {
    if (!this.liste.length) return null;
    const s = [...this.liste].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  }

  // Zu langsam: genug Messwerte und der Median liegt ueber der Grenze.
  zuLangsam(grenzeMs: number): boolean {
    if (this.liste.length < this.mindestens) return false;
    const m = this.median();
    return m !== null && m > grenzeMs;
  }

  leere(): void {
    this.liste = [];
  }

  get anzahl(): number {
    return this.liste.length;
  }
}

// ---------- Eignung ----------

export interface Eignung {
  // Einstellung `video` ('zonen' oder 'ganz').
  einstellung: 'zonen' | 'ganz';
  // Pixel lesbar (kein fremdes Video ohne CORS in Chrome, kein http(s) in Firefox, kein srcObject).
  lesbar: boolean;
  drm: boolean;
  controls: boolean;
  untertitel: boolean;
  spiegel: boolean;
  dreht: boolean;
  cssB: number;
  cssH: number;
  minB: number;
  minH: number;
  // Das Video selbst ist im Vollbild.
  vollbildVideo: boolean;
  // Ein anderes Video dieses Dokuments hat schon die Zonen-Leinwand.
  andereAktiv: boolean;
  // Hover-Vorschau oder Anzeigen-Video auf einer Erwachsenenseite: bleibt ganz verdeckt (Vorschauen werden nie gezeigt).
  vorschau: boolean;
}

export type EignungsGrund = 'einstellung' | 'unlesbar' | 'drm' | 'controls' | 'untertitel' | 'spiegel' | 'dreht' | 'klein' | 'vollbild' | 'andere' | 'vorschau';

export function pruefeEignung(f: Eignung): { ok: true } | { ok: false; grund: EignungsGrund } {
  if (f.einstellung !== 'zonen') return { ok: false, grund: 'einstellung' };
  if (f.vorschau) return { ok: false, grund: 'vorschau' };
  if (f.drm) return { ok: false, grund: 'drm' };
  if (!f.lesbar) return { ok: false, grund: 'unlesbar' };
  if (f.vollbildVideo) return { ok: false, grund: 'vollbild' };
  if (f.controls) return { ok: false, grund: 'controls' };
  if (f.untertitel) return { ok: false, grund: 'untertitel' };
  if (f.spiegel) return { ok: false, grund: 'spiegel' };
  if (f.dreht) return { ok: false, grund: 'dreht' };
  if (f.cssB < f.minB || f.cssH < f.minH) return { ok: false, grund: 'klein' };
  if (f.andereAktiv) return { ok: false, grund: 'andere' };
  return { ok: true };
}

// Dreht oder schert die CSS-Matrix? (`matrix(a, b, c, d, tx, ty)` oder `matrix3d(...)`; "none" und Unlesbares: nein.) Skalieren und Spiegeln sind
// erlaubt, Drehung und Scherung nicht (die Leinwand liegt achsenparallel auf dem Begrenzungsrechteck).
export function matrixDreht(transform: string | null | undefined): boolean {
  if (!transform || transform === 'none') return false;
  const m3 = /^matrix3d\(([^)]*)\)$/.exec(transform.trim());
  if (m3) {
    const w = m3[1]!.split(',').map((x) => Number(x));
    if (w.length !== 16 || w.some((x) => !Number.isFinite(x))) return true;
    // Drehung um die z-Achse steckt in m12 und m21 (Index 1 und 4); jede Drehung um x oder y verschiebt m13, m23, m31, m32 (Index 2, 6, 8, 9).
    return [1, 4, 2, 6, 8, 9].some((i) => Math.abs(w[i]!) > 1e-3);
  }
  const m = /^matrix\(([^)]*)\)$/.exec(transform.trim());
  if (!m) return true; // unbekannte Form (rotate(), skew() im berechneten Wert gibt es nicht): sicherheitshalber ganz
  const w = m[1]!.split(',').map((x) => Number(x));
  if (w.length !== 6 || w.some((x) => !Number.isFinite(x))) return true;
  return Math.abs(w[1]!) > 1e-3 || Math.abs(w[2]!) > 1e-3;
}

// ---------- Sprung ----------

// Hat sich die Abspielposition zwischen zwei gezeigten Bildern sprunghaft geaendert (ohne dass ein Ereignis es gemeldet haette)? Normal ist ein
// kleiner Schritt nach vorn (auch ein paar Bilder uebersprungen); ein Schritt ueber `grenze` Sekunden oder nach hinten ist ein Sprung.
export function istSprung(vorher: number, jetzt: number, grenze: number, rueck = 0.1): boolean {
  if (!Number.isFinite(vorher) || !Number.isFinite(jetzt)) return true;
  const d = jetzt - vorher;
  // Rueckwaerts bis `rueck` (Standard 0,1 s, der Aufrufer reicht VIDEO_UHR_RUECK_S) ist kein Sprung: die Zeit stammt mal aus requestVideoFrameCallback (Bild), mal aus currentTime (Uhr), sie weichen um ein bis zwei Bilder ab.
  // Echte Spruenge meldet ausserdem der Zaehler der seeking- und seeked-Ereignisse.
  return d > grenze || d < -rueck;
}
