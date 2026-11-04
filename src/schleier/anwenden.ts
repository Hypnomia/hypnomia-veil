// Urteile auf Elemente anwenden: freigeben, verdecken, Quelle gegen das zensierte Bild tauschen, Originale wiederherstellen.

import { ATTR_MS, ATTR_NUR_HG, ATTR_URTEIL, TESTHAKEN, type Urteil } from './konstanten';
import { freigabeGesperrt, testhakenAktiv } from './status';
import type { BildOriginal, Zustand } from './zustand';

// Kennzeichen eines eingesetzten Vorschau-Bildes (Pack-Bild statt Seitenbild), neben data-veil="zensiert".
export const ATTR_ERSETZT = 'data-veil-ersetzt';

// ---------- Signaturen (erkennen, ob die Seite die Quelle geaendert hat) ----------

// Quelle eines img samt source-Geschwistern im picture.
export function bildSignatur(el: HTMLImageElement): string {
  const teile = [el.getAttribute('src') ?? '', el.getAttribute('srcset') ?? ''];
  const eltern = el.parentElement;
  if (eltern?.tagName === 'PICTURE') {
    for (const q of eltern.querySelectorAll(':scope > source')) teile.push(q.getAttribute('srcset') ?? '', q.getAttribute('src') ?? '');
  }
  return teile.join('|');
}

// Inline-Wert der Langform background-image des Style-Objekts: der Browser loest die Kurzform `background: url(...)` dort auf.
// Bei `var(...)` liest die Langform leer (oder gibt den var-Text zurueck): dann gilt ohne Aufloesung nichts.
export function hintergrundInline(el: Element): string {
  return (el as HTMLElement).style?.getPropertyValue('background-image') ?? '';
}

// Wert, nach dem ein Inline-Hintergrund beurteilt wird. Ist die Langform leer oder enthaelt sie var(, zaehlt der berechnete Wert
// (sonst liesse sich die Verdeckung per `background: var(--b); --b: url(...)` umgehen).
export function hintergrundWert(el: Element): string {
  const inline = hintergrundInline(el);
  if (inline !== '' && !/var\(/i.test(inline)) return inline;
  try {
    const berechnet = getComputedStyle(el).backgroundImage;
    return berechnet && berechnet !== 'none' ? berechnet : inline;
  } catch {
    return inline;
  }
}

// ---------- Urteil setzen ----------

// Steigerung der Zensur (Auftrag S): wird gerufen, wenn ein Element neu das Urteil `zensiert` bekommt (nicht beim Wiederanwenden).
let beiNeuemZensiert: ((el: Element) => void) | null = null;
export function setzeZensiertMelder(fn: ((el: Element) => void) | null): void {
  beiNeuemZensiert = fn;
}

// Freilegen (Auftrag F): wird bei jedem neuen Urteil und jedem Zuruecksetzen eines Elements gerufen (Kandidaten fuer den Knopf).
let beiUrteilAenderung: ((el: Element, z: Zustand) => void) | null = null;
export function setzeUrteilMelder(fn: ((el: Element, z: Zustand) => void) | null): void {
  beiUrteilAenderung = fn;
}

export function setzeUrteil(el: Element, z: Zustand, urteil: Urteil, ms: number | null): void {
  // Eingesetzte Vorschauen sind keine Treffer: nicht fuer die Steigerung melden, aber kennzeichnen (Freilegen unterscheidet sie).
  if (urteil === 'zensiert' && z.urteil !== 'zensiert' && !z.ersetzt) beiNeuemZensiert?.(el);
  z.urteil = urteil;
  z.urteilMs = ms;
  beiUrteilAenderung?.(el, z);
  // Elemente, die per Klasse gestaltet sind, werden vorab nie versteckt: "frei" braucht kein Attribut. "zensiert" setzt einen
  // Inline-Hintergrund (den die CSS-Regel fuer Inline-Hintergruende sonst unsichtbar machte) und "verdeckt" soll unscharf zeigen,
  // beides ueber das Attribut.
  if (z.art === 'klasse' && urteil === 'frei') return;
  // Testhaken "Freigabe sperren" (nur Testbau, nur Testhost): das Urteil gilt, aber das Element wird nie sichtbar.
  if (TESTHAKEN && freigabeGesperrt()) return;
  el.setAttribute(ATTR_URTEIL, urteil);
  if (z.ersetzt && urteil === 'zensiert') el.setAttribute(ATTR_ERSETZT, '');
  // Zeitstempel nur im Testbau auf Testhosts.
  if (TESTHAKEN && ms !== null && testhakenAktiv()) el.setAttribute(ATTR_MS, String(ms));
}

function loescheAttribute(el: Element): void {
  el.removeAttribute(ATTR_URTEIL);
  el.removeAttribute(ATTR_NUR_HG);
  el.removeAttribute(ATTR_ERSETZT);
  if (TESTHAKEN) el.removeAttribute(ATTR_MS);
}

// ---------- Bild tauschen ----------

// Data-URLs, die dieses Skript selbst als src gesetzt hat (begrenzt): ein solches src ist nie ein Original der Seite.
// Nur eine Kennung je URL (Laenge und FNV-Hash), nicht die Data-URL selbst (bis 600.000 Zeichen).
const eigeneUrls = new Set<string>();
function kennung(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${url.length}:${h}`;
}
function merkeEigene(url: string): void {
  if (eigeneUrls.size >= 256) eigeneUrls.clear();
  eigeneUrls.add(kennung(url));
}

function merkeBild(el: HTMLImageElement): BildOriginal {
  const quellen: BildOriginal['quellen'] = [];
  const eltern = el.parentElement;
  if (eltern?.tagName === 'PICTURE') {
    for (const q of eltern.querySelectorAll(':scope > source')) {
      quellen.push({ el: q, srcset: q.getAttribute('srcset'), src: q.getAttribute('src'), sizes: q.getAttribute('sizes') });
    }
  }
  return {
    src: eigenesSrc(el.getAttribute('src')) ? null : el.getAttribute('src'),
    srcset: el.getAttribute('srcset'),
    sizes: el.getAttribute('sizes'),
    loading: el.getAttribute('loading'),
    quellen,
  };
}

function eigenesSrc(src: string | null): boolean {
  return src !== null && src.startsWith('data:') && eigeneUrls.has(kennung(src));
}

function setzeAttribut(el: Element, name: string, wert: string | null): void {
  if (wert === null) el.removeAttribute(name);
  else el.setAttribute(name, wert);
}

// Vorbereitung des Tauschs: Originale merken, srcset leeren, source neutralisieren, zensiertes Bild als src setzen.
// Das Element bleibt verdeckt (kein data-veil), bis das zensierte Bild geladen ist: der Browser zeigt sonst das alte Bild weiter.
export function starteBildTausch(el: HTMLImageElement, z: Zustand, bild: string): void {
  if (!z.bildOriginal) z.bildOriginal = merkeBild(el);
  el.removeAttribute('srcset');
  el.removeAttribute('sizes');
  for (const q of z.bildOriginal.quellen) {
    q.el.removeAttribute('srcset');
    q.el.removeAttribute('sizes');
  }
  // Ein zurueckgehaltenes (lazy) Bild wuerde das zensierte Bild nie laden.
  el.setAttribute('loading', 'eager');
  merkeEigene(bild);
  z.eigen = bild;
  z.tauschLaeuft = true;
  el.setAttribute('src', bild);
  z.signatur = bildSignatur(el);
}

// Auch currentSrc muss das eigene Bild sein: waehlt der Browser nach dem Tausch ein Original (neue source, sizes oder media), ist das load keins von uns.
export function istEigenesBild(el: HTMLImageElement, z: Zustand): boolean {
  return !!z.eigen && el.getAttribute('src') === z.eigen && (!el.currentSrc || el.currentSrc === z.eigen);
}

// Die Seite hat nach dem Tausch Quelle oder srcset geaendert (z. B. Vorschau-Rotation beim Darueberfahren), das Pack-Bild bleibt dasselbe:
// die neuen Werte der Seite werden als Originale gemerkt (Pause stellt den letzten Stand her) und das Pack-Bild sofort wieder eingesetzt.
export function setzeBildSofortNeu(el: HTMLImageElement, z: Zustand, bild: string): void {
  if (z.bildOriginal) {
    const src = el.getAttribute('src');
    if (!eigenesSrc(src)) z.bildOriginal.src = src;
    z.bildOriginal.srcset = el.getAttribute('srcset');
    z.bildOriginal.sizes = el.getAttribute('sizes');
  }
  el.removeAttribute('srcset');
  el.removeAttribute('sizes');
  for (const q of z.bildOriginal?.quellen ?? []) {
    q.el.removeAttribute('srcset');
    q.el.removeAttribute('sizes');
  }
  if (el.getAttribute('src') !== bild) el.setAttribute('src', bild);
  z.signatur = bildSignatur(el);
}

// ---------- Hintergrund tauschen ----------

// neuerWert: vollstaendiger background-image-Wert (Ebenen mit zensierten Bildern ersetzt; `none` entfernt den Hintergrund ganz).
export function setzeHintergrund(el: HTMLElement, z: Zustand, neuerWert: string): void {
  if (!z.hgOriginal) {
    const wert = el.style.getPropertyValue('background-image');
    const ueberVar = z.art === 'hintergrund' && (wert === '' || /var\(/i.test(wert));
    z.hgOriginal = { wert, prio: el.style.getPropertyPriority('background-image'), stil: ueberVar ? el.getAttribute('style') : null };
  }
  el.style.setProperty('background-image', neuerWert, 'important');
  z.eigen = el.style.getPropertyValue('background-image');
  z.signatur = z.eigen;
}

// Verdeckt ohne Blur: nur der Hintergrund wird entfernt, das Element bleibt sichtbar und lesbar (ein body oder grosser Container
// mit Hintergrund soll nicht samt Text unscharf werden). Das Attribut data-veil-hg nimmt der Schleier-CSS den Blur.
export function verdeckeNurHintergrund(el: HTMLElement, z: Zustand): void {
  setzeHintergrund(el, z, 'none');
  el.setAttribute(ATTR_NUR_HG, '');
}

// ---------- Wiederherstellen und Vergessen ----------

// Stellt die Inline-Stile zurueck, die der Vorschau-Tausch gesetzt hat (object-fit, aspect-ratio, Hintergrund-Groesse).
function stelleErsetztWiederHer(el: Element, z: Zustand): void {
  const info = z.ersetzt;
  z.ersetzt = null;
  if (!info || !(el instanceof HTMLElement)) return;
  for (const s of info.stile) {
    if (s.wert) el.style.setProperty(s.name, s.wert, s.prio);
    else el.style.removeProperty(s.name);
  }
}

// Stellt die Originalquelle her (Pause, Abbau). Das Urteil selbst bleibt unangetastet, siehe vergiss().
export function stelleWiederHer(el: Element, z: Zustand): void {
  if (z.bildOriginal && el instanceof HTMLImageElement) {
    const o = z.bildOriginal;
    for (const q of o.quellen) {
      setzeAttribut(q.el, 'srcset', q.srcset);
      setzeAttribut(q.el, 'src', q.src);
      setzeAttribut(q.el, 'sizes', q.sizes);
    }
    setzeAttribut(el, 'sizes', o.sizes);
    setzeAttribut(el, 'srcset', o.srcset);
    setzeAttribut(el, 'loading', o.loading);
    setzeAttribut(el, 'src', o.src);
  }
  if (z.hgOriginal && el instanceof HTMLElement) {
    if (z.hgOriginal.stil !== null) el.setAttribute('style', z.hgOriginal.stil);
    else if (z.hgOriginal.wert) el.style.setProperty('background-image', z.hgOriginal.wert, z.hgOriginal.prio);
    else el.style.removeProperty('background-image');
  }
  stelleErsetztWiederHer(el, z);
  z.bildOriginal = null;
  z.hgOriginal = null;
  z.eigen = null;
  z.tauschLaeuft = false;
}

// Freilegen: zeigt das Original, ohne die gemerkten Daten zu verwerfen (bildOriginal, hgOriginal, eigen bleiben), damit die zensierte Fassung am Ende
// direkt wieder eingesetzt werden kann.
export function zeigeOriginal(el: Element, z: Zustand): void {
  if (z.bildOriginal && el instanceof HTMLImageElement) {
    const o = z.bildOriginal;
    for (const q of o.quellen) {
      setzeAttribut(q.el, 'srcset', q.srcset);
      setzeAttribut(q.el, 'src', q.src);
      setzeAttribut(q.el, 'sizes', q.sizes);
    }
    setzeAttribut(el, 'sizes', o.sizes);
    setzeAttribut(el, 'srcset', o.srcset);
    setzeAttribut(el, 'loading', o.loading);
    setzeAttribut(el, 'src', o.src);
    z.signatur = bildSignatur(el);
  }
  if (z.hgOriginal && el instanceof HTMLElement) {
    if (z.hgOriginal.stil !== null) el.setAttribute('style', z.hgOriginal.stil);
    else if (z.hgOriginal.wert) el.style.setProperty('background-image', z.hgOriginal.wert, z.hgOriginal.prio);
    else el.style.removeProperty('background-image');
    z.signatur = hintergrundWert(el);
  }
}

// Gegenstueck: die gemerkte zensierte Fassung (z.eigen) wieder einsetzen. Ein Bild muss danach erst laden (tauschLaeuft setzt der Aufrufer).
export function setzeZensurWieder(el: Element, z: Zustand): boolean {
  if (!z.eigen) return false;
  if (el instanceof HTMLImageElement && z.bildOriginal) {
    el.removeAttribute('srcset');
    el.removeAttribute('sizes');
    for (const q of z.bildOriginal.quellen) {
      q.el.removeAttribute('srcset');
      q.el.removeAttribute('sizes');
    }
    el.setAttribute('loading', 'eager');
    el.setAttribute('src', z.eigen);
    z.signatur = bildSignatur(el);
    return true;
  }
  if (el instanceof HTMLElement && z.hgOriginal) {
    el.style.setProperty('background-image', z.eigen, 'important');
    z.eigen = el.style.getPropertyValue('background-image');
    z.signatur = z.eigen;
    return true;
  }
  return false;
}

// Setzt das Element zurueck in "noch nicht beurteilt" (Attribut weg, Zeitgeber weg, laufende Antworten verworfen).
// restore = false, wenn die Seite die Quelle selbst geaendert hat (die gemerkten Originale sind dann veraltet).
export function vergiss(el: Element, z: Zustand, restore: boolean): void {
  if (restore) stelleWiederHer(el, z);
  else {
    stelleErsetztWiederHer(el, z);
    z.bildOriginal = null;
    z.hgOriginal = null;
    z.eigen = null;
    z.tauschLaeuft = false;
  }
  loescheAttribute(el);
  if (z.timer) clearTimeout(z.timer);
  z.timer = null;
  z.generation++;
  z.urteil = null;
  z.inhalt = null;
  z.eingereiht = false;
  z.erwarteLoad = false;
  z.versuche = 0;
  z.signatur = null;
  z.adresse = null;
  z.urteilMs = null;
  z.fehlerGesehen = false;
  z.vorlaeufig = false;
  z.freigelegt = null; // ein Zuruecksetzen beendet das Freilegen (Pause, neue Einstellungen, Quellwechsel)
  beiUrteilAenderung?.(el, z);
}
