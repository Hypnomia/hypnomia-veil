// Bilder in Inline-SVG (<svg><image href="..."> oder xlink:href) der Seite, Nacht 18 Paket N1. Die Versteck-Regel (style.css, wurzel-haken)
// haelt sie ohne Urteil unsichtbar; der Schleier prueft sie als Art `svgbild` wie einen Inline-Hintergrund mit einer Ebene (Url-Weg oder
// Canvas-Weg) und setzt die zensierte Fassung als href ein (anwenden.ts).

export const XLINK = 'http://www.w3.org/1999/xlink';
const SVG = 'http://www.w3.org/2000/svg';

// Ein SVG-image (localName image im SVG-Namensraum). Ein HTML-Element namens image (createElement) ist keins.
// Dazu zaehlt das Bild eines Filters (feImage, Nacht 18 N4): gleiche Quelle (href, xlink:href), gleicher Weg durch den Schleier. Es hat keine
// Flaeche und laesst sich nicht auf ein Canvas zeichnen; darum entfallen unten Bereitschaft, Pixelbestaetigung und Pixel lesen (siehe istFeImage).
export function istSvgBild(el: Element): el is SVGImageElement | SVGFEImageElement {
  return (el.localName === 'image' || el.localName === 'feImage') && el.namespaceURI === SVG;
}

export function istFeImage(el: Element): boolean {
  return el.localName === 'feImage' && el.namespaceURI === SVG;
}

// SMIL kann die Quelle wechseln, ohne ein Attribut zu aendern (nur animVal, kein MutationRecord): ein harmloses Bild wuerde frei und zeigte
// spaeter etwas anderes. Ein Bild, auf dessen href oder xlink:href eine Animation (set, animate) zielt, wird deshalb nie frei, sondern verdeckt
// (wie ein bewegtes SVG beim Erkenner). Ziel einer Animation: ihr Elternelement oder das Element hinter href="#id" bzw. xlink:href="#id".
const ANIMATION = 'set, animate';
// Eine Animation auf href eines feImage wird entschaerft: SMIL aendert nur animVal, und gezeichnet wird animVal; der Platzhalter im href (baseVal)
// haelt sie nicht auf (gemessen Nacht 18, N4: das Testbild erschien per set trotz Platzhalter). Der Schleier setzt attributeName auf einen
// Blindnamen (die Animation trifft dann nichts) und merkt sich den echten; die Pause stellt ihn zurueck.
export const ANIMATION_BLIND = 'data-veil-blind';
export const animationsName = new WeakMap<Element, string>();
export function animationsZiel(a: Element): Element | null {
  if ((a.localName !== 'set' && a.localName !== 'animate') || a.namespaceURI !== SVG) return null;
  const roh = a.getAttribute('attributeName') ?? '';
  // Eine entschaerfte Animation (anwenden.ts) traegt den Blindnamen; ihr eigentliches Ziel bleibt erkennbar.
  const name = (roh === ANIMATION_BLIND ? (animationsName.get(a) ?? '') : roh).trim();
  if (name !== 'href' && name !== 'xlink:href') return null;
  const verweis = a.getAttribute('href') ?? a.getAttributeNS(XLINK, 'href');
  if (verweis === null) return a.parentElement;
  if (!verweis.startsWith('#')) return null;
  const wurzel = a.getRootNode() as Document | ShadowRoot;
  return typeof wurzel.getElementById === 'function' ? wurzel.getElementById(verweis.slice(1)) : null;
}

// Animationen (set, animate) in einem eingefuegten Knoten samt Unterbaum.
export function animationenIn(knoten: Element): Element[] {
  const aus = knoten.matches(ANIMATION) ? [knoten] : [];
  for (const a of knoten.querySelectorAll(ANIMATION)) aus.push(a);
  return aus;
}

// Alle Animationen (set, animate), die href oder xlink:href dieses Elements treffen (Kind oder Verweis per #id), auch entschaerfte.
export function animationenZu(el: Element): Element[] {
  const aus: Element[] = [];
  for (const k of el.children) if (animationsZiel(k) === el) aus.push(k);
  if (el.id) {
    const wurzel = el.getRootNode() as Document | ShadowRoot;
    if (typeof wurzel.querySelectorAll === 'function') for (const a of wurzel.querySelectorAll(ANIMATION)) if (!aus.includes(a) && animationsZiel(a) === el) aus.push(a);
  }
  return aus;
}

export function hrefAnimiert(el: SVGImageElement): boolean {
  if (el.href && el.href.animVal !== el.href.baseVal) return true;
  for (const k of el.children) if (animationsZiel(k) === el) return true;
  if (!el.id) return false;
  const wurzel = el.getRootNode() as Document | ShadowRoot;
  for (const a of wurzel.querySelectorAll(ANIMATION)) if (animationsZiel(a) === el) return true;
  return false;
}

// decode() des Elements (SVGImageElement.decode, in Chromium und Firefox 159 vorhanden, in den TypeScript-Typen nicht). Fehlt es (aeltere
// Browser), gilt das Element als fertig: die Fassung ist vorab dekodiert und wird dann sofort gezeigt (gemessen per drawImage), und
// svgElementLesen prueft zusaetzlich, ob das Element ueberhaupt etwas zeichnet.
function dekodiere(el: SVGImageElement): Promise<unknown> {
  const d = (el as SVGImageElement & { decode?: () => Promise<void> }).decode;
  return typeof d === 'function' ? d.call(el) : Promise.resolve();
}

// true, sobald das Element seine aktuelle Quelle zeigen kann; false nach `ms`. Gemessen (Nacht 18, N1): Chromium feuert fuer SVG-Bilder kein
// load, solange das Dokument laedt, decode() geht dort. Firefox lehnt decode() direkt nach dem Setzen von href aus dem Content-Script teils ab
// ("EncodingError: Invalid image request", die neue Anfrage steht noch nicht), feuert aber load. Deshalb gilt das Erste von beidem; ein
// abgelehntes decode() wird bis zur Frist im Abstand von 50 ms wiederholt.
export function wirdBereit(el: SVGImageElement, ms: number): Promise<boolean> {
  if (istFeImage(el)) return Promise.resolve(true);
  return new Promise((fertig) => {
    let erledigt = false;
    const ende = (ok: boolean) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(frist);
      el.removeEventListener('load', beiLoad);
      fertig(ok);
    };
    const beiLoad = () => ende(true);
    el.addEventListener('load', beiLoad);
    const frist = setTimeout(() => ende(false), ms);
    const versuche = (): void => {
      if (erledigt) return;
      dekodiere(el).then(
        () => ende(true),
        () => {
          if (!erledigt) setTimeout(versuche, 50);
        },
      );
    };
    versuche();
  });
}

// true = das Element zeichnet genau die Fassung (gleiche Pixel in 128 x 128, Abweichung je Kanal hoechstens 8). Nach dem Setzen von href kann
// ein Browser noch eine Weile das alte Bild zeigen, und weder load noch decode() bezeugen browseruebergreifend, dass die neue Quelle gilt
// (gemessen Nacht 18, N1: Firefox meldete fuer eine blob:-Quelle "fertig", zeigte aber noch das Original). Die Pixel bezeugen es: zeigt das
// Element ein fremdes Original, ist die Leinwand verschmutzt (false); ein gleich-ursprungs-Original weicht in den zensierten Flaechen ab.
const PROBE = 128;

// Leinwand im HTML-Namensraum: in einem eigenstaendigen SVG-Dokument (XML) erzeugt createElement('canvas') kein HTML-Canvas.
function leinwand(): HTMLCanvasElement {
  return document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
}
export function zeigtFassung(el: SVGImageElement, fassung: HTMLImageElement): boolean {
  try {
    const lies = (quelle: CanvasImageSource): Uint8ClampedArray | null => {
      const k = leinwand();
      k.width = PROBE;
      k.height = PROBE;
      const x = k.getContext('2d');
      if (!x) return null;
      x.drawImage(quelle, 0, 0, PROBE, PROBE);
      return x.getImageData(0, 0, PROBE, PROBE).data;
    };
    const a = lies(el);
    const b = lies(fassung);
    if (!a || !b) return false;
    let gezeichnet = false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i]! - b[i]!) > 8) return false;
      if (i % 4 === 3 && a[i] !== 0) gezeichnet = true;
    }
    return gezeichnet;
  } catch {
    return false;
  }
}

// Wartet, bis zeigtFassung gilt: sofort, bei jedem load des Elements und alle 50 ms, hoechstens `ms`.
export function zeigtBaldFassung(el: SVGImageElement, fassung: HTMLImageElement, ms: number): Promise<boolean> {
  // Ein feImage laesst sich nicht auf ein Canvas zeichnen, die Pixelprobe geht nicht. Sicher ist es trotzdem: bis das Urteil faellt, steht der
  // neutrale Platzhalter im href (filterVorab unten), und die Fassung ist vorab geladen und dekodiert; das Original zeigt sich nie.
  if (istFeImage(el)) return Promise.resolve(true);
  return new Promise((fertig) => {
    let erledigt = false;
    const ende = (ok: boolean) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(frist);
      clearInterval(takt);
      el.removeEventListener('load', probe);
      fertig(ok);
    };
    const probe = () => {
      if (zeigtFassung(el, fassung)) ende(true);
    };
    el.addEventListener('load', probe);
    const frist = setTimeout(() => ende(false), ms);
    const takt = setInterval(probe, 50);
    probe();
  });
}

// true = das Element zeichnet (noch) nichts: ganz durchsichtig auf einer leeren Leinwand (nicht geladen, nicht dekodiert, widerrufene Quelle).
// Dann darf aus seinen Pixeln kein Urteil werden. Ein wirklich ganz durchsichtiges Bild faellt mit darunter (zeigt ohnehin nichts).
export function zeichnetNichts(el: SVGImageElement): boolean {
  if (istFeImage(el)) return true; // nicht lesbar: dann nie frei aus den Pixeln, sondern verdeckt
  try {
    const k = leinwand();
    k.width = 16;
    k.height = 16;
    const x = k.getContext('2d');
    if (!x) return true;
    x.drawImage(el, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  } catch {
    return true;
  }
}

// ---------- Filter-Bilder (feImage) vorab verbergen ----------

// Hide-first fuer ein feImage ohne CSS: display none haelt das Filterbild in Chromium nicht zuverlaessig weg (gemessen Nacht 18, N4: ein per
// Skript eingefuegtes feImage laedt und zeichnet trotz berechnetem display none, und mit der Erweiterungs-CSS galt das auch fuer
// Markup-Elemente), opacity und visibility greifen am Filterprimitiv nicht. Darum ersetzt der Schleier den href eines gefundenen feImage sofort
// (im Mikrotask der Beobachter, vor dem naechsten Zeichnen) durch einen neutralen grauen Platzhalter und merkt sich die Quelle der Seite hier.
// Das gefilterte Element bleibt dabei sichtbar (der Filter laeuft mit dem Platzhalter weiter), ein Original zeigt sich nie vor dem Urteil.
// Das Urteil setzt den href dann: frei = Original zurueck, zensiert = Fassung, verdeckt = Platzhalter bleibt (anwenden.ts).
export const FILTER_PLATZHALTER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQI12NoAAMGCAUAKg4GAaW135oAAAAASUVORK5CYII=';
export interface FilterQuelle {
  href: string | null;
  xlink: string | null;
}
// Merkt sich je neutralisiertem feImage die Quelle der Seite. Eintrag da = das Element zeigt (noch) den Platzhalter statt der Seitenquelle.
export const filterVorab = new WeakMap<Element, FilterQuelle>();

// Die Quelle der Seite: bei einem neutralisierten feImage der gemerkte Stand, sonst die Attribute.
function quelleVon(el: Element): FilterQuelle {
  return filterVorab.get(el) ?? { href: el.getAttribute('href'), xlink: el.getAttributeNS(XLINK, 'href') };
}

// Beide Quellen-Attribute: href (SVG 2, hat Vorrang) und xlink:href. Erkennt jede Aenderung der Seite, auch an der jeweils unwirksamen.
export function svgSignatur(el: Element): string {
  const q = quelleVon(el);
  return `${q.href ?? ''}|${q.xlink ?? ''}`;
}

// Die Quelle, die der Browser laedt (href.baseVal waehlt href vor xlink:href), aufgeloest gegen die Basis des Elements. '' = keine Quelle.
export function svgAdresse(el: Element): string {
  const q = filterVorab.has(el) ? quelleVon(el) : null;
  const roh = q ? (q.href ?? q.xlink ?? '') : ((el as SVGImageElement).href?.baseVal ?? el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href') ?? '');
  // Leer oder nur ein Verweis in dasselbe Dokument (#...): ein image zeigt dann nichts.
  if (!roh.trim() || roh.trim().startsWith('#')) return '';
  try {
    return new URL(roh, el.baseURI).href;
  } catch {
    return '';
  }
}
