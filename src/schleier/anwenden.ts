// Urteile auf Elemente anwenden: freigeben, verdecken, Quelle gegen das zensierte Bild tauschen, Originale wiederherstellen.

import { ATTR_MS, ATTR_NUR_HG, ATTR_URTEIL, TESTHAKEN, type Urteil } from './konstanten';
import { freigabeGesperrt, testhakenAktiv } from './status';
import type { BildOriginal, Zustand } from './zustand';
import { ANIMATION_BLIND, FILTER_PLATZHALTER, XLINK, animationenZu, animationsName, filterVorab, istFeImage, svgSignatur, type FilterQuelle } from './svg-bild';

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
  if (istFeImage(el)) wendeFilterUrteilAn(el, z, urteil);
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

// ---------- Bild in Inline-SVG tauschen (svg-bild.ts) ----------

// Setzt die zensierte Fassung als href (hat Vorrang vor xlink:href, das unberuehrt bleibt). Der Aufrufer hat die Fassung vorab geladen und
// dekodiert (schleier.ts, urteilZensiertSvg) und setzt das Urteil gleich danach.
export function starteSvgTausch(el: Element, z: Zustand, bild: string): void {
  if (!z.svgOriginal) {
    // Ein neutralisiertes feImage (svg-bild.ts, filterVorab) zeigt den Platzhalter: die Quelle der Seite ist der gemerkte Stand.
    const href = filterVorab.has(el) ? filterVorab.get(el)!.href : el.getAttribute('href');
    z.svgOriginal = { href: eigenerHref(el, href) ? null : href };
  }
  merkeEigene(bild);
  z.eigen = bild;
  // Ein neutralisiertes feImage bekommt die Fassung erst mit dem Urteil (wendeFilterUrteilAn): bei gesperrter Freigabe (Testhaken) bleibt es neutral.
  if (istFeImage(el) && filterVorab.has(el)) {
    z.signatur = svgSignatur(el);
    return;
  }
  el.setAttribute('href', bild);
  if (istFeImage(el)) filterEigen.set(el, bild);
  z.signatur = svgSignatur(el);
}

// ---------- Filter-Bilder (feImage) neutralisieren und freigeben (svg-bild.ts) ----------

// Der Wert, den die Erweiterung zuletzt selbst als href in ein feImage geschrieben hat (Fassung oder Platzhalter). Je Element statt ueber die
// gemeinsame, bei 256 Eintraegen geleerte Menge eigeneUrls: sonst gaelte eine aeltere Fassung danach als Quelle der Seite.
const filterEigen = new WeakMap<Element, string>();
// Ist dieser href-Wert eigene Schreibung? Bei einem feImage je Element, sonst ueber eigeneUrls.
function eigenerHref(el: Element, href: string | null): boolean {
  if (!istFeImage(el)) return eigenesSrc(href);
  return href !== null && (href === FILTER_PLATZHALTER || filterEigen.get(el) === href);
}

// Stand, den die Erweiterung selbst als Quelle zurueckgeschrieben hat (Freigabe, Pause): die Beobachter melden diese Schreibung, sie ist keine
// Aenderung der Seite und darf nicht erneut verbergen.
const filterZurueck = new WeakMap<Element, FilterQuelle>();

// Ersetzt die Quelle eines feImage sofort durch den grauen Platzhalter und merkt sich die der Seite. Aufruf beim Finden (entdeckt = true, immer
// neu verbergen) und bei jeder Attributaenderung (entdeckt = false: die eigene Rueckschreibung gilt nicht als Aenderung der Seite).
export function neutralisiereFilterBild(el: Element, entdeckt: boolean): void {
  if (!istFeImage(el)) return;
  const href = el.getAttribute('href');
  const xlink = el.getAttributeNS(XLINK, 'href');
  const zurueck = filterZurueck.get(el);
  if (zurueck && zurueck.href === href && zurueck.xlink === xlink) {
    // Eigene Rueckschreibung. Beim Wiederfinden ohne Urteil (nach der Pause, das Urteil wurde dort geloescht) gilt die Quelle wieder als ungeprueft.
    if (!entdeckt || el.hasAttribute(ATTR_URTEIL)) return;
  }
  filterZurueck.delete(el);
  const vorab = filterVorab.get(el);
  if (vorab && href === FILTER_PLATZHALTER) {
    vorab.xlink = xlink; // xlink:href hat unter dem Platzhalter keine Wirkung, aber die Seite meint es als Quelle
    return;
  }
  // Der eigene Tausch (zensiert, verdeckt) ist der Stand der Erweiterung, keine Quelle der Seite.
  if (!vorab && eigenerHref(el, href)) return;
  const roh = (href ?? xlink ?? '').trim();
  if (!roh || roh.startsWith('#')) {
    filterVorab.delete(el); // nichts zu verbergen (leer oder Verweis auf ein Element, das seine eigene Regel hat)
    return;
  }
  filterVorab.set(el, { href, xlink });
  filterZurueck.delete(el);
  el.setAttribute('href', FILTER_PLATZHALTER);
  entschaerfeAnimationen(el);
}

// SMIL auf href eines feImage entschaerfen (svg-bild.ts, ANIMATION_BLIND) und in der Pause wieder scharf stellen.
function entschaerfeAnimationen(el: Element): void {
  for (const a of animationenZu(el)) {
    const name = a.getAttribute('attributeName');
    if (name === null || name === ANIMATION_BLIND) continue;
    animationsName.set(a, name);
    a.setAttribute('attributeName', ANIMATION_BLIND);
  }
}
function stelleAnimationenHer(el: Element): void {
  let zurueck = false;
  for (const a of animationenZu(el)) {
    if (a.getAttribute('attributeName') !== ANIMATION_BLIND) continue;
    const name = animationsName.get(a);
    if (name !== undefined) a.setAttribute('attributeName', name);
    animationsName.delete(a);
    zurueck = true;
  }
  if (!zurueck) return;
  // Eine schon gelaufene Animation (set mit fill freeze) wirkt nach dem Zurueckstellen des Namens nicht von selbst wieder (gemessen Chromium): die
  // Zeitleiste auf die jetzige Zeit setzen wertet alle Animationen neu aus.
  try {
    const svg = (el as SVGElement).ownerSVGElement;
    svg?.setCurrentTime(svg.getCurrentTime());
  } catch {
    // ohne SMIL-Zeitleiste nichts zu tun
  }
}

// Quelle der Seite zurueckschreiben (frei, Pause) und den Eintrag loeschen.
function stelleFilterBildHer(el: Element): void {
  const vorab = filterVorab.get(el);
  if (!vorab) return;
  filterVorab.delete(el);
  setzeAttribut(el, 'href', vorab.href);
  filterZurueck.set(el, { href: vorab.href, xlink: vorab.xlink });
  weckeXlink(el);
}

// Firefox 128 greift nach dem Entfernen von href nicht auf xlink:href zurueck (das Filterbild bleibt leer, gemessen Nacht 18, N4; Firefox 159 und
// Chromium tun es). Gemessen in Firefox 128: xlink:href mit gleichem Wert noch einmal setzen genuegt nicht, es hilft, xlink:href zu entfernen und
// neu zu setzen. Der Wert aendert sich am Ende nicht, die Markierung der Rueckschreibung gilt weiter.
function weckeXlink(el: Element): void {
  if (!istFeImage(el) || el.getAttribute('href') !== null) return;
  const xlink = el.getAttributeNS(XLINK, 'href');
  if (xlink === null) return;
  el.removeAttributeNS(XLINK, 'href');
  el.setAttributeNS(XLINK, 'xlink:href', xlink);
}

// Urteil an einem feImage: frei = Quelle der Seite zurueck, zensiert = die Fassung, verdeckt = der neutrale Platzhalter bleibt (das gefilterte
// Element bleibt sichtbar, ein Originalbild nie).
function wendeFilterUrteilAn(el: Element, z: Zustand, urteil: Urteil): void {
  if (urteil === 'frei') {
    stelleFilterBildHer(el);
    z.signatur = svgSignatur(el);
    return;
  }
  if (urteil === 'verdeckt') starteSvgTausch(el, z, FILTER_PLATZHALTER);
  entschaerfeAnimationen(el); // eine spaeter eingefuegte oder umgelenkte Animation trifft das feImage erst jetzt
  if (z.eigen && filterVorab.has(el)) {
    filterVorab.delete(el);
    el.setAttribute('href', z.eigen);
    filterEigen.set(el, z.eigen);
    z.signatur = svgSignatur(el);
  }
}

// Original-href zurueck (null: Attribut weg, dann gilt wieder xlink:href der Seite).
function setzeSvgOriginal(el: Element, z: Zustand): void {
  if (!z.svgOriginal) return;
  setzeAttribut(el, 'href', z.svgOriginal.href);
  if (istFeImage(el)) {
    filterZurueck.set(el, { href: el.getAttribute('href'), xlink: el.getAttributeNS(XLINK, 'href') });
    weckeXlink(el);
  }
  z.signatur = svgSignatur(el);
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
  stelleFilterBildHer(el);
  if (istFeImage(el)) stelleAnimationenHer(el);
  setzeSvgOriginal(el, z);
  stelleErsetztWiederHer(el, z);
  z.bildOriginal = null;
  z.hgOriginal = null;
  z.svgOriginal = null;
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
  setzeSvgOriginal(el, z);
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
  if (z.svgOriginal) {
    el.setAttribute('href', z.eigen);
    z.signatur = svgSignatur(el);
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
    // Bild in Inline-SVG: hat die Seite nur xlink:href geaendert, stuende die eigene Fassung als href noch da und verdeckte die neue Quelle
    // (href hat Vorrang). Eine noch eigene href geht deshalb auf das Original zurueck; eine von der Seite neu gesetzte bleibt.
    // Ein neutralisiertes feImage (filterVorab) haelt die neue Quelle der Seite selbst: der alte href darf nicht zurueckgeschrieben werden, sonst
    // ueberschriebe der naechste Beobachtertakt die neue Quelle mit der alten.
    if (z.svgOriginal && !(istFeImage(el) && filterVorab.has(el)) && eigenerHref(el, el.getAttribute('href'))) setzeAttribut(el, 'href', z.svgOriginal.href);
    stelleErsetztWiederHer(el, z);
    z.bildOriginal = null;
    z.hgOriginal = null;
    z.svgOriginal = null;
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
