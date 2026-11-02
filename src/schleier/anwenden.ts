// Urteile auf Elemente anwenden: freigeben, verdecken, Quelle gegen das zensierte Bild tauschen, Originale wiederherstellen.

import { ATTR_MS, ATTR_NUR_HG, ATTR_URTEIL, TESTHAKEN, type Urteil } from './konstanten';
import { freigabeGesperrt, testhakenAktiv } from './status';
import type { BildOriginal, Zustand } from './zustand';

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

export function setzeUrteil(el: Element, z: Zustand, urteil: Urteil, ms: number | null): void {
  z.urteil = urteil;
  z.urteilMs = ms;
  // Elemente, die per Klasse gestaltet sind, werden vorab nie versteckt: "frei" braucht kein Attribut. "zensiert" setzt einen
  // Inline-Hintergrund (den die CSS-Regel fuer Inline-Hintergruende sonst unsichtbar machte) und "verdeckt" soll unscharf zeigen,
  // beides ueber das Attribut.
  if (z.art === 'klasse' && urteil === 'frei') return;
  // Testhaken "Freigabe sperren" (nur Testbau, nur Testhost): das Urteil gilt, aber das Element wird nie sichtbar.
  if (TESTHAKEN && freigabeGesperrt()) return;
  el.setAttribute(ATTR_URTEIL, urteil);
  // Zeitstempel nur im Testbau auf Testhosts.
  if (TESTHAKEN && ms !== null && testhakenAktiv()) el.setAttribute(ATTR_MS, String(ms));
}

function loescheAttribute(el: Element): void {
  el.removeAttribute(ATTR_URTEIL);
  el.removeAttribute(ATTR_NUR_HG);
  if (TESTHAKEN) el.removeAttribute(ATTR_MS);
}

// ---------- Bild tauschen ----------

function merkeBild(el: HTMLImageElement): BildOriginal {
  const quellen: BildOriginal['quellen'] = [];
  const eltern = el.parentElement;
  if (eltern?.tagName === 'PICTURE') {
    for (const q of eltern.querySelectorAll(':scope > source')) {
      quellen.push({ el: q, srcset: q.getAttribute('srcset'), src: q.getAttribute('src'), sizes: q.getAttribute('sizes') });
    }
  }
  return {
    src: el.getAttribute('src'),
    srcset: el.getAttribute('srcset'),
    sizes: el.getAttribute('sizes'),
    loading: el.getAttribute('loading'),
    quellen,
  };
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
  z.eigen = bild;
  z.tauschLaeuft = true;
  el.setAttribute('src', bild);
  z.signatur = bildSignatur(el);
}

export function istEigenesBild(el: HTMLImageElement, z: Zustand): boolean {
  return !!z.eigen && el.getAttribute('src') === z.eigen;
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
  z.bildOriginal = null;
  z.hgOriginal = null;
  z.eigen = null;
  z.tauschLaeuft = false;
}

// Setzt das Element zurueck in "noch nicht beurteilt" (Attribut weg, Zeitgeber weg, laufende Antworten verworfen).
// restore = false, wenn die Seite die Quelle selbst geaendert hat (die gemerkten Originale sind dann veraltet).
export function vergiss(el: Element, z: Zustand, restore: boolean): void {
  if (restore) stelleWiederHer(el, z);
  else {
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
  z.eingereiht = false;
  z.erwarteLoad = false;
  z.versuche = 0;
  z.signatur = null;
  z.adresse = null;
  z.urteilMs = null;
  z.fehlerGesehen = false;
  z.vorlaeufig = false;
}
