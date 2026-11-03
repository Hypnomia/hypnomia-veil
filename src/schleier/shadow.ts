// Shadow Roots: Wurzel eines Elements finden (offen und geschlossen) und dieselbe Schleier-CSS wie im Dokument hineinlegen.

import schleierCss from '../../entrypoints/content/style.css?inline';
import { TESTHAKEN } from './konstanten';
import { testhakenAktiv } from './status';

// Schwache Verweise: abgehaengte Wurzeln sollen nicht durch diese Liste am Leben bleiben.
const stile = new Set<WeakRef<HTMLStyleElement>>();
// Der Stil je Wurzel (wird eine Wurzel geleert, legen Haken und Beobachter genau dieses Element wieder ein).
let stilVon = new WeakMap<ShadowRoot, HTMLStyleElement>();

// Offene Wurzel direkt, geschlossene ueber die Erweiterungs-API (Chrome: dom.openOrClosedShadowRoot, Firefox: Eigenschaft am Element).
export function wurzelVon(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    const dom = (browser as unknown as { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } }).dom;
    if (dom?.openOrClosedShadowRoot) return dom.openOrClosedShadowRoot(el) ?? null;
    const eigenschaft = (el as unknown as { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot;
    if (eigenschaft) return eigenschaft;
  } catch {
    // kein Zugriff (z. B. Element aus fremdem Kontext)
  }
  return null;
}

// Kennzeichen eigener Stile in Wurzeln. Der Haken in der Seitenwelt (entrypoints/wurzel-haken.content.ts) legt Stile mit HAKEN an und verwaltet nur
// solche; beim Uebernehmen tauscht der Schleier das Kennzeichen gegen EIGEN, danach laesst der Haken das Element in Ruhe. Es gibt keine Befehle
// der Seitenwelt an den Schleier und umgekehrt: der Haken liest html[data-veil-seite="aus"] und das Lebenszeichen der Manifest-CSS selbst.
const MARKE_HAKEN = 'data-veil-haken';
const MARKE_EIGEN = 'data-veil-eigen';
// Wiedereinlegen eines geleerten Stils: je Wurzel hoechstens so oft je Sekunde. Ist die Grenze erreicht, plant der Schleier genau ein Wiedereinlegen zum
// Ende des Fensters (gedrosselt statt aufgegeben): eine Seite, die fremde Kinder ihrer Wurzel sofort wieder entfernt, zieht den Tab so nicht in eine
// Endlosschleife, die Wurzel bekommt ihren Stil aber spaetestens nach einer Sekunde zurueck. Die Zahl der Wurzeln, die die Grenze je erreicht haben,
// steht im Testbau auf Testhosts als Attribut data-veil-grenze am Wurzelelement.
const MAX_WIEDER_JE_S = 20;
const FENSTER_MS = 1000;
const einlegungen = new WeakMap<ShadowRoot, { von: number; n: number; geplant: boolean }>();
const gedrosselt = new WeakSet<ShadowRoot>();
const geplante = new Set<ReturnType<typeof setTimeout>>();
let anzahlGedrosselt = 0;

function meldeGrenze(wurzel: ShadowRoot): void {
  if (gedrosselt.has(wurzel)) return;
  gedrosselt.add(wurzel);
  anzahlGedrosselt++;
  if (TESTHAKEN && testhakenAktiv()) document.documentElement?.setAttribute('data-veil-grenze', String(anzahlGedrosselt));
}

function legeWiederEin(wurzel: ShadowRoot, stil: HTMLStyleElement): void {
  let z = einlegungen.get(wurzel);
  if (!z) {
    z = { von: 0, n: 0, geplant: false };
    einlegungen.set(wurzel, z);
  }
  const jetzt = performance.now();
  if (jetzt - z.von >= FENSTER_MS) {
    z.von = jetzt;
    z.n = 0;
  }
  if (z.n < MAX_WIEDER_JE_S) {
    z.n++;
    wurzel.append(stil);
    return;
  }
  meldeGrenze(wurzel);
  if (z.geplant) return;
  z.geplant = true;
  const t = setTimeout(() => {
    geplante.delete(t);
    z.geplant = false;
    if (stilVon.get(wurzel) !== stil || stil.parentNode === wurzel) return;
    z.von = performance.now();
    z.n = 1;
    wurzel.append(stil);
  }, Math.max(0, z.von + FENSTER_MS - jetzt));
  geplante.add(t);
}

// Eigene Stile in der Wurzel (Kinder mit einem der beiden Kennzeichen), der des Hakens zuerst.
function markierteStile(wurzel: ShadowRoot): HTMLStyleElement[] {
  const liste: HTMLStyleElement[] = [];
  for (const kind of wurzel.children) {
    if (kind.localName === 'style' && (kind.hasAttribute(MARKE_HAKEN) || kind.hasAttribute(MARKE_EIGEN))) liste.push(kind as HTMLStyleElement);
  }
  return liste.sort((a, b) => Number(b.hasAttribute(MARKE_HAKEN)) - Number(a.hasAttribute(MARKE_HAKEN)));
}

// Weitere gekennzeichnete Stile neben dem behaltenen fliegen raus (auch bei schon bekannten Wurzeln: ein zweiter Haken oder die Seite kann Kopien
// hinterlassen).
function bereinige(wurzel: ShadowRoot, behalte: HTMLStyleElement): void {
  for (const k of markierteStile(wurzel)) if (k !== behalte) k.remove();
}

// Legt die CSS einmal je Wurzel an. Gibt true zurueck, wenn die Wurzel neu war. Hat der Haken schon einen Stil eingelegt, wird er uebernommen (Text durch
// die ganze Schleier-CSS ersetzt, damit auch Blur und Ausnahmen gelten, Kennzeichen getauscht), weitere eigene Stile fliegen raus: eine Wurzel
// bekommt nie zwei Kopien. Ein neuer Stil kommt ans Ende der Wurzel, damit er das erste Kind der Seite nicht verdraengt.
export function versorgeWurzel(wurzel: ShadowRoot, aus: boolean): boolean {
  if (stilVon.has(wurzel)) {
    sichereStil(wurzel);
    return false;
  }
  const vorhanden = markierteStile(wurzel);
  let stil = vorhanden[0] ?? null;
  for (const weiterer of vorhanden.slice(1)) weiterer.remove();
  if (!stil) {
    stil = document.createElement('style');
    wurzel.append(stil);
  }
  stil.textContent = schleierCss;
  stil.removeAttribute(MARKE_HAKEN);
  stil.setAttribute(MARKE_EIGEN, '');
  stil.media = aus ? 'not all' : '';
  stilVon.set(wurzel, stil);
  stile.add(new WeakRef(stil));
  return true;
}

// Hat die Seite die Wurzel geleert (innerHTML, replaceChildren, Kinder entfernt), ist der Stil weg und die Bilder darin waeren ungeschuetzt:
// dasselbe Element kommt sofort wieder ans Ende. Der Aufruf geschieht im Rueckruf des MutationObserver der Wurzel (Mikrotask, vor dem naechsten
// Zeichnen). Uebernommene Stile sichert nur der Schleier (der Haken laesst sie in Ruhe), nicht uebernommene nur der Haken.
export function sichereStil(wurzel: ShadowRoot): void {
  const stil = stilVon.get(wurzel);
  if (!stil) return;
  if (stil.parentNode !== wurzel) legeWiederEin(wurzel, stil);
  if (stil.parentNode === wurzel) bereinige(wurzel, stil);
}

// Pause und Ausnahmen: die CSS in den Wurzeln abschalten bzw. wieder einschalten (html[data-veil-seite] reicht nicht in Wurzeln).
export function schalteWurzelStile(aus: boolean): void {
  for (const ref of stile) {
    const stil = ref.deref();
    if (!stil) {
      stile.delete(ref);
      continue;
    }
    stil.media = aus ? 'not all' : '';
  }
}

// Verweise auf Stile geloeschter Wurzeln loswerden (die Wurzel ist weg, der Stil auch).
export function raeumeWurzelStileAuf(): void {
  for (const ref of stile) if (!ref.deref()) stile.delete(ref);
}

// Aufraeumen beim Abbau: eingelegte Stile entfernen.
export function entferneWurzelStile(): void {
  for (const ref of stile) ref.deref()?.remove();
  stile.clear();
  stilVon = new WeakMap();
  for (const t of geplante) clearTimeout(t);
  geplante.clear();
}
