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
const SVG_PRUEF_MAX = 4 * 1024 * 1024;
const SVG_BEWEGUNG =
  /<\s*(?:[\w.-]+:)?(?:animate|set|animateTransform|animateMotion|script|foreignObject)[\s/>]|@(?:-\w+-)?keyframes|\banimation(?:-name)?\s*:/i;
export async function svgMitBewegung(blob: Blob): Promise<boolean> {
  if (!(await istSvg(blob))) return false;
  if (blob.size > SVG_PRUEF_MAX) return true;
  try {
    return SVG_BEWEGUNG.test(await blob.text());
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
