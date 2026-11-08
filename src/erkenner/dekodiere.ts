// Bild aus Bytes dekodieren. createImageBitmap(Blob) kann kein SVG (Chromium lehnt es ab): ein SVG-Logo blieb deshalb ohne Urteil und der Schleier
// versuchte es erst nach 10 s erneut (Live-Lauf 17, MITTEL 1). SVG wird darum ueber ein img-Element gerastert (im Bildmodus laedt ein SVG keine
// Skripte und keine Nachbarn; eingebettete Rasterbilder werden mitgezeichnet und gehen so durch die normale Pruefung, nie blind frei).

export const SVG_LAENGSTE_SEITE = 1280;
const SVG_STANDARD = { breite: 300, hoehe: 150 }; // Browser-Vorgabe fuer ein SVG ganz ohne Mass
const SVG_FRIST_MS = 5000;

// SVG am Typ oder, wenn der Server keinen verwertbaren Typ nennt, am Anfang der Bytes erkennen.
export async function istSvg(blob: Blob): Promise<boolean> {
  if (/^image\/svg\+xml/i.test(blob.type)) return true;
  if (blob.type && !/^(text\/(plain|xml)|application\/(octet-stream|xml))/i.test(blob.type)) return false;
  const kopf = await blob.slice(0, 1024).text();
  return /<svg[\s>]/i.test(kopf);
}

// SVG mit Bewegung oder Skript (SMIL, CSS-Animation, script, foreignObject): zum Ladezeitpunkt zeigt es einen harmlosen ersten Zustand, spaeter
// etwas anderes. Es wird nie freigegeben (Session 17 Fund 9): der Erkenner meldet eine Flaeche ueber das ganze Bild, das Urteil lautet wie bei
// einem unklaren Bild "zensiert". Gelesen werden hoechstens SVG_PRUEF_MAX Zeichen; ein groesseres SVG gilt als bewegt (nicht pruefbar).
// Lesung 17 R2-2: auch alles, was zeitversetzt (discard, transition, @starting-style) oder je nach Groesse und Umgebung (@media, @container)
// anderes zeigt, gilt als bewegt; der Erkenner rastert in Eigengroesse, die Seite zeigt in ihrer.
const SVG_PRUEF_MAX = 4 * 1024 * 1024;
const SVG_BEWEGUNG =
  /<\s*(?:[\w.-]+:)?(?:animate|animateColor|set|animateTransform|animateMotion|discard|script|foreignObject)[\s/>]|@(?:-\w+-)?keyframes|@(?:media|container|import|starting-style)\b|\b(?:animation|transition)(?:-[\w-]+)?\s*:/i;
// Nicht pruefbar, weil der Text Inhalt verbergen kann, den das Muster nicht sieht: Stilblaetter per xml-stylesheet und jede eingebettete
// data:-Adresse in href oder url() ausser Rasterbildern (ein SVG im SVG, CSS, Schriften; Base64 oder Prozent-Kodierung verdecken die Bewegung).
// Eingebettete Rasterbilder werden mitgezeichnet und gehen durch die normale Pruefung.
// Entitaeten im DOCTYPE (Illustrator-Exporte tragen sie fast immer) sperren nicht pauschal (Pruefung Runde 3, N3): interne Entitaeten werden
// aufgeloest wie im XML-Leser, danach wird geprueft (Pruefung Runde 4, M1: sonst zerlegen sie Schluesselwoerter in Stil und Attributen).
// Parameter-Entitaeten, externe Entitaeten, Bezuege ohne Definition und zu tiefe oder zu grosse Aufloesungen gelten als nicht pruefbar;
// Rueckstriche im DOCTYPE gelten wie im Stil als nicht pruefbar.
const SVG_NICHT_PRUEFBAR =
  /<\?xml-stylesheet|(?:\bhref\s*=\s*["']?|\burl\(\s*["']?)\s*data:(?!\s*image\/(?:png|jpe?g|gif|webp|avif|bmp)\s*[;,])/i;
// @media nur mit Vorlieben der Person, die eine Seite nicht steuern kann (prefers-reduced-motion, -contrast, -reduced-transparency,
// -reduced-data), haengt nicht an der Groesse und gilt nicht als bewegt (N3). prefers-color-scheme bleibt "bewegt": die Seite kann
// `color-scheme` am Bild setzen, der Erkenner rastert hell (Pruefung Runde 4, M2). Jede andere Abfrage (Breite, Hoehe, Seitenverhaeltnis,
// Aufloesung) bleibt ebenso "bewegt".
const MEDIA_NUR_VORLIEBE =
  /^\s*(?:(?:not|only|screen|all|and|,)\s*|\(\s*prefers-(?:reduced-motion|contrast|reduced-transparency|reduced-data)\s*:\s*[a-z-]+\s*\)\s*)+$/i;
const XML_VORGEGEBEN = new Set(['lt', 'gt', 'amp', 'quot', 'apos']);
const ENTITAET_TIEFE = 8;

// Interne Entitaeten aufloesen. null = nicht pruefbar.
function loeseEntitaeten(roh: string): string | null {
  if (/<!ENTITY\s+%/i.test(roh)) return null;
  // Nur echte Deklarationen: im internen Teil des DOCTYPE, ohne Kommentare und Verarbeitungsanweisungen (Pruefung Runde 5, P1). Ein doppelter
  // Name gilt als nicht pruefbar (XML nimmt den ersten Wert, eine falsche Wahl haette eine andere Lesart als der Browser).
  const teil = roh.match(/<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/i)?.[1] ?? '';
  const deklarationen = teil.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const werte = new Map<string, string>();
  for (const m of deklarationen.matchAll(/<!ENTITY\s+([^\s%"'>]+)\s+(?:(SYSTEM|PUBLIC)\b|"([^"]*)"|'([^']*)')/gi)) {
    if (m[2] || werte.has(m[1]!)) return null;
    werte.set(m[1]!, entschluesselt(m[3] ?? m[4] ?? ''));
  }
  // Deklarationen ausserhalb des DOCTYPE-Teils (in Kommentaren, Texten) sind keine: wer sich darauf verlaesst, bekommt sie nicht aufgeloest
  // und landet bei "Bezug ohne Definition" (nicht pruefbar).
  const grenze = Math.max(roh.length * 4, 64 * 1024);
  let text = roh;
  for (let tiefe = 0; tiefe <= ENTITAET_TIEFE; tiefe++) {
    let offen = false;
    let fremd = false;
    text = text.replace(/&([A-Za-z_:][\w.:-]*);/g, (ganz, name: string) => {
      if (XML_VORGEGEBEN.has(name)) return ganz;
      const w = werte.get(name);
      if (w === undefined) {
        fremd = true;
        return ganz;
      }
      offen = true;
      return w;
    });
    if (fremd || text.length > grenze) return null;
    if (!offen) return text;
  }
  return null;
}

// Zeichenbezuege (&#107; &#x61;) und die fuenf XML-Entitaeten aufloesen: der XML-Leser tut es vor dem CSS-Leser.
function entschluesselt(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|amp|quot|apos));/gi, (ganz, dez?: string, hex?: string, name?: string) => {
    if (dez || hex) {
      const code = dez ? Number(dez) : parseInt(hex as string, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ganz;
    }
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[(name as string).toLowerCase()] ?? ganz;
  });
}

// Inhalt der style-Elemente und style-Attribute.
function stilTeile(text: string): string[] {
  const teile: string[] = [];
  for (const m of text.matchAll(/<\s*(?:[\w.-]+:)?style\b[^>]*>([\s\S]*?)<\s*\/\s*(?:[\w.-]+:)?style\s*>/gi)) teile.push(m[1] ?? '');
  for (const m of text.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) teile.push(m[1] ?? m[2] ?? '');
  // Interner Teil des DOCTYPE: Entitaeten koennen Stil-Text in ein style-Element tragen.
  for (const m of text.matchAll(/<!DOCTYPE[^[>]*\[([\s\S]*?)\]\s*>/gi)) teile.push(m[1] ?? '');
  return teile;
}

export function svgTextMitBewegung(roh: string): boolean {
  const aufgeloest = loeseEntitaeten(roh);
  if (aufgeloest === null) return true;
  const text = entschluesselt(aufgeloest);
  if (SVG_NICHT_PRUEFBAR.test(text)) return true;
  // CSS-Escapes (anim\61tion, @\6b eyframes) sieht das Muster nicht: jeder Rueckstrich im Stil gilt als nicht pruefbar.
  if (stilTeile(text).some((s) => s.includes('\\'))) return true;
  // CSS-Kommentare duerfen zwischen Namen und Doppelpunkt stehen (animation/**/:).
  const ohneKommentare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return SVG_BEWEGUNG.test(ohneKommentare.replace(/@media\b([^{]*)\{/gi, (ganz, vor: string) => (MEDIA_NUR_VORLIEBE.test(vor) ? '{' : ganz)));
}

export async function svgMitBewegung(blob: Blob): Promise<boolean> {
  if (!(await istSvg(blob))) return false;
  if (blob.size > SVG_PRUEF_MAX) return true;
  try {
    return svgTextMitBewegung(await blob.text());
  } catch {
    return true;
  }
}

// Grauer Ersatz fuer ein bewegtes SVG: es wird gar nicht erst gezeichnet (ein foreignObject beschmutzt die Leinwand, ein schwerer Filter bremst),
// die Mosaik-Flaeche ueber dem ganzen Bild geht auf das Mass der Anfrage.
export function ersatzBildFuerBewegtesSvg(wunsch?: { breite?: number; hoehe?: number }): ImageBitmap {
  let b = wunsch?.breite && wunsch.breite > 0 ? wunsch.breite : SVG_STANDARD.breite;
  let h = wunsch?.hoehe && wunsch.hoehe > 0 ? wunsch.hoehe : SVG_STANDARD.hoehe;
  const skala = Math.min(1, SVG_LAENGSTE_SEITE / Math.max(b, h));
  b = Math.max(1, Math.round(b * skala));
  h = Math.max(1, Math.round(h * skala));
  const flaeche = new OffscreenCanvas(b, h);
  const ctx = flaeche.getContext('2d');
  if (!ctx) throw new Error('SVG: keine Leinwand');
  ctx.fillStyle = '#888';
  ctx.fillRect(0, 0, b, h);
  return flaeche.transferToImageBitmap();
}

function ladeImg(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, nein) => {
    const img = new Image();
    const uhr = setTimeout(() => nein(new Error('SVG: Zeitgrenze')), SVG_FRIST_MS);
    img.onload = () => {
      clearTimeout(uhr);
      ok(img);
    };
    img.onerror = () => {
      clearTimeout(uhr);
      nein(new Error('SVG nicht dekodierbar'));
    };
    img.src = url;
  });
}

// wunsch: Mass aus der Anfrage (Darstellungsgroesse), nur fuer SVG ohne eigenes Mass.
export async function dekodiereBild(blob: Blob, wunsch?: { breite?: number; hoehe?: number }): Promise<ImageBitmap> {
  if (!(await istSvg(blob))) return createImageBitmap(blob, { imageOrientation: 'from-image' });
  // Typ erzwingen: ohne image/svg+xml zeigt ein img den Blob nicht als SVG.
  const svg = blob.type.toLowerCase().startsWith('image/svg+xml') ? blob : new Blob([blob], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svg);
  try {
    const img = await ladeImg(url);
    let b = img.naturalWidth;
    let h = img.naturalHeight;
    if (!(b > 0) || !(h > 0)) {
      b = wunsch?.breite && wunsch.breite > 0 ? wunsch.breite : SVG_STANDARD.breite;
      h = wunsch?.hoehe && wunsch.hoehe > 0 ? wunsch.hoehe : SVG_STANDARD.hoehe;
    }
    const skala = Math.min(1, SVG_LAENGSTE_SEITE / Math.max(b, h));
    const bb = Math.max(1, Math.round(b * skala));
    const hh = Math.max(1, Math.round(h * skala));
    const flaeche = new OffscreenCanvas(bb, hh);
    const ctx = flaeche.getContext('2d');
    if (!ctx) throw new Error('SVG: keine Leinwand');
    ctx.fillStyle = '#fff'; // Transparenz auf Weiss, wie beim Canvas-Weg des Schleiers
    ctx.fillRect(0, 0, bb, hh);
    ctx.drawImage(img, 0, 0, bb, hh);
    return flaeche.transferToImageBitmap();
  } finally {
    URL.revokeObjectURL(url);
  }
}
