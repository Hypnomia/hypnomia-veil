// Rendern der Zensur auf einem Canvas: je Flaeche eine Behandlung (src/presets.ts): Pixel-Mosaik (mit pinkem Rahmen), Blur, Schwarz,
// Wort (auf Schwarz oder auf Mosaik), schwarzer Augenbalken, Mias Gesicht (Ausschnitt aus einem Patch-Bild des Mia Packs, nur wo
// er zur Flaeche passt, mit pinkem Rahmen) oder Sticker (deckende Pastell-Flaeche mit Rahmen, darauf mittig ein Sticker des Packs). Ausgabe als JPEG-Data-URL (PNG, wenn die Quelle Durchsichtiges hat und nur Balken oder Schwarz kommen).

import { FARBEN, WERTE } from '../oberflaeche/design/werte.ts';
import { ganzesBildBehandlung, hatWort, ohneWort, wortPasst, type Behandlung, type Preset } from '../presets.ts';
import { stickerFarbe, stickerPasst, stickerRechteck } from '../sticker.ts';
import type { Box, Flaeche } from '../nachrichten';

const JPEG_QUALITAET = 0.85;
// Schwarz-Behandlung und Augenbalken: reines, deckendes Schwarz (kein Rahmen, keine Schrift), Farbe aus werte.ts.
export const BALKEN_FARBE = FARBEN.schwarz;
// PNG-Ausgabe (Quelle mit Durchsichtigem): groesser als das, wird es JPEG (die Antwort an das Content-Script soll klein bleiben).
export const PNG_MAX_BYTES = 3_000_000;
const MOSAIK_ANTEIL = 0.1;
const MOSAIK_MINDEST = 4;
const BLUR_ANTEIL = 0.35;
// Pinker Rahmen (Entscheidung 73, PHASE-2-BAUPLAN 9.4): Breite max(2, round(0,03 * kleinere Seite)), hoechstens 10 px, innerhalb der Flaeche.
export const RAHMEN_FARBE = '#ff4fa3';
const RAHMEN_ANTEIL = 0.03;
const RAHMEN_MINDEST = 2;
const RAHMEN_HOECHSTENS = 10;

export function rahmenBreite(w: number, h: number): number {
  const b = Math.min(RAHMEN_HOECHSTENS, Math.max(RAHMEN_MINDEST, Math.round(RAHMEN_ANTEIL * Math.min(w, h))));
  // Bei winzigen Flaechen nie mehr als die halbe Seite, damit der Rahmen die Flaeche nicht ganz fuellt.
  return Math.min(b, Math.max(1, Math.floor(Math.min(w, h) / 2)));
}

function zeichneRahmen(ctx: Kontext, box: Box): void {
  const [x, y, w, h] = box;
  const b = rahmenBreite(w, h);
  ctx.save();
  ctx.fillStyle = RAHMEN_FARBE;
  ctx.fillRect(x, y, w, b); // oben
  ctx.fillRect(x, y + h - b, w, b); // unten
  ctx.fillRect(x, y + b, b, h - 2 * b); // links
  ctx.fillRect(x + w - b, y + b, b, h - 2 * b); // rechts
  ctx.restore();
}

// Wann passt ein Patch-Bild in eine Flaeche? Das Bild wird formatfuellend und mittig beschnitten (zeichnePatch). Der sichtbare Anteil des
// Bildes nach dem Beschneiden ist min(r, 1/r) mit r = Seitenverhaeltnis der Flaeche durch Seitenverhaeltnis des Bildes. Zwei Regeln:
// - Anteil mindestens PATCH_MIN_ANTEIL (0,5): mindestens die Haelfte des Bildes bleibt zu sehen, also Flaeche und Bild im Format hoechstens
//   Faktor 2 auseinander. Ein schmaler Augen- oder Mundstreifen (etwa 4 zu 1) zeigte sonst nur einen Streifen aus der Mitte des Bildes,
//   der nicht mehr als Mia zu erkennen ist.
// - Kleinere Seite der Flaeche mindestens PATCH_MIN_SEITE (24 px): darunter ist von einem Bild nichts mehr zu erkennen, nur noch der
//   pinke Rahmen (Breite 2 px bei kleinen Flaechen) und ein Farbfleck; Mosaik mit Rahmen sagt dort ehrlicher "hier ist zensiert".
// Passt die Flaeche nicht, wird sie Mosaik mit pinkem Rahmen (wie ohne Patch). Gemessen wird am tatsaechlich gewaehlten Patch-Bild
// (die Wahl in src/pack/patches.ts laeuft stabil per Hash und kennt kein Format).
// Die Box liegt in Pixeln des Arbeitsbildes (bis 1600 px lang, oft groesser als die Darstellung). Die kleinste Seite zaehlt aber, wie sie
// auf dem Bildschirm aussieht: `anzeigeSkala` (Darstellungsgroesse durch Arbeitsbild, 1 wenn unbekannt) rechnet sie um. Das Seitenverhaeltnis
// ist davon unberuehrt.
export const PATCH_MIN_ANTEIL = 0.5;
export const PATCH_MIN_SEITE = 24;

export function sichtbarerAnteil(flaecheB: number, flaecheH: number, bildB: number, bildH: number): number {
  if (flaecheB <= 0 || flaecheH <= 0 || bildB <= 0 || bildH <= 0) return 0;
  const r = flaecheB / flaecheH / (bildB / bildH);
  return Math.min(r, 1 / r);
}

export function patchPasst(box: Box, bildB: number, bildH: number, anzeigeSkala = 1): boolean {
  const skala = Number.isFinite(anzeigeSkala) && anzeigeSkala > 0 ? anzeigeSkala : 1;
  return Math.min(box[2], box[3]) * skala >= PATCH_MIN_SEITE && sichtbarerAnteil(box[2], box[3], bildB, bildH) >= PATCH_MIN_ANTEIL;
}

// Breite und Hoehe eines Patch-Bildes (ImageBitmap, OffscreenCanvas, HTML-Leinwand).
function bildMass(q: CanvasImageSource): { b: number; h: number } {
  const o = q as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  return { b: o.naturalWidth ?? o.width ?? 0, h: o.naturalHeight ?? o.height ?? 0 };
}

// Mias Gesicht: der Ausschnitt `a` (x, y, w, h im Patch-Bild) wird formatfuellend auf die Gesichtsflaeche gesetzt (bei `balken` gedreht
// um die Mitte, sonst achsenparallel), mit abgerundeten Ecken und pinkem Rahmen. false, wenn nicht zu zeichnen (leer oder geschlossen).
export function zeichneGesicht(ctx: Kontext, f: Pick<Flaeche, 'box' | 'balken'>, patch: CanvasImageSource, a: Box): boolean {
  const mitte = f.balken ? f.balken.mitte : ([f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] / 2] as [number, number]);
  const w = f.balken ? f.balken.breite : f.box[2];
  const h = f.balken ? f.balken.hoehe : f.box[3];
  const winkel = f.balken ? f.balken.winkel : 0;
  const [ax, ay, aw, ah] = a;
  if (aw <= 0 || ah <= 0 || w <= 0 || h <= 0) return false;
  const skala = Math.max(w / aw, h / ah);
  const sw = w / skala;
  const sh = h / skala;
  const r = Math.min(w, h) * 0.14;
  const pfad = (): void => {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + r, -h / 2);
    ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
    ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
    ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
    ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
    ctx.closePath();
  };
  ctx.save();
  try {
    ctx.translate(mitte[0], mitte[1]);
    ctx.rotate(winkel);
    pfad();
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(patch, ax + (aw - sw) / 2, ay + (ah - sh) / 2, sw, sh, -w / 2, -h / 2, w, h);
    // Rahmen: doppelt so breit gezogen wie gewollt, die Aussenhaelfte liegt ausserhalb des Beschnitts
    pfad();
    ctx.strokeStyle = RAHMEN_FARBE;
    ctx.lineWidth = 2 * rahmenBreite(w, h);
    ctx.stroke();
    return true;
  } catch {
    // Geschlossenes oder sonst unzeichenbares Bitmap (InvalidStateError): nichts Ganzes wurde gezeichnet.
    return false;
  } finally {
    ctx.restore();
  }
}

export type Kontext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function neueLeinwand(b: number, h: number): { leinwand: OffscreenCanvas; ctx: Kontext } {
  const leinwand = new OffscreenCanvas(Math.max(1, Math.round(b)), Math.max(1, Math.round(h)));
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error('kein 2D-Kontext');
  return { leinwand, ctx };
}

// Zielleinwand fuer das fertige Bild: wo es ein Dokument gibt (Offscreen-Dokument, Firefox-Hintergrundseite), eine HTML-Leinwand.
function neueZielLeinwand(b: number, h: number): { leinwand: OffscreenCanvas | HTMLCanvasElement; ctx: Kontext } {
  if (typeof document === 'undefined') return neueLeinwand(b, h);
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.max(1, Math.round(b));
  leinwand.height = Math.max(1, Math.round(h));
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error('kein 2D-Kontext');
  return { leinwand, ctx };
}

// Beschneidet `quelle` auf (x, y, w, h) und verkleinert in Halbierungsschritten auf zb x zh (mittelt sauber, auch bei grossem Faktor).
function verkleinere(quelle: CanvasImageSource, x: number, y: number, w: number, h: number, zb: number, zh: number): OffscreenCanvas {
  let { leinwand: aktuell, ctx } = neueLeinwand(w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(quelle, x, y, w, h, 0, 0, aktuell.width, aktuell.height);
  while (aktuell.width / 2 >= zb && aktuell.height / 2 >= zh) {
    const naechste = neueLeinwand(Math.ceil(aktuell.width / 2), Math.ceil(aktuell.height / 2));
    naechste.ctx.imageSmoothingQuality = 'high';
    naechste.ctx.drawImage(aktuell, 0, 0, aktuell.width, aktuell.height, 0, 0, naechste.leinwand.width, naechste.leinwand.height);
    aktuell = naechste.leinwand;
  }
  const ziel = neueLeinwand(zb, zh);
  ziel.ctx.imageSmoothingQuality = 'high';
  ziel.ctx.drawImage(aktuell, 0, 0, aktuell.width, aktuell.height, 0, 0, zb, zh);
  return ziel.leinwand;
}

function zeichneMosaik(ctx: Kontext, quelle: CanvasImageSource, box: Box): void {
  const [x, y, w, h] = box;
  const block = Math.max(MOSAIK_MINDEST, Math.round(h * MOSAIK_ANTEIL));
  const kb = Math.max(1, Math.ceil(w / block));
  const kh = Math.max(1, Math.ceil(h / block));
  const klein = verkleinere(quelle, x, y, w, h, kb, kh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(klein, 0, 0, kb, kh, x, y, kb * block, kh * block);
  ctx.restore();
  zeichneRahmen(ctx, box);
}

// Kann der 2D-Kontext `filter`? (Rueckfall auf Mosaik, wenn nicht.)
function kannFilter(ctx: Kontext): boolean {
  if (!('filter' in ctx)) return false;
  ctx.filter = 'blur(1px)';
  const ok = ctx.filter === 'blur(1px)';
  ctx.filter = 'none';
  return ok;
}

function zeichneBlur(ctx: Kontext, quelle: CanvasImageSource, box: Box, bildB: number, bildH: number): void {
  const [x, y, w, h] = box;
  const r = Math.max(2, Math.round(BLUR_ANTEIL * Math.min(w, h)));
  // Mittelfarbe als Untergrund: an den Raendern der Flaeche und des Bildes darf der Blur nie das Original durchscheinen lassen.
  const mittel = verkleinere(quelle, x, y, w, h, 1, 1).getContext('2d')?.getImageData(0, 0, 1, 1).data;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = mittel ? `rgb(${mittel[0]},${mittel[1]},${mittel[2]})` : 'rgb(128,128,128)';
  ctx.fillRect(x, y, w, h);
  ctx.filter = `blur(${r}px)`;
  // Quellbereich um die Flaeche erweitern, damit der Blur Nachbarpixel mittelt.
  const pad = r * 2;
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sb = Math.min(bildB, x + w + pad) - sx;
  const sh = Math.min(bildH, y + h + pad) - sy;
  ctx.drawImage(quelle, sx, sy, sb, sh, sx, sy, sb, sh);
  ctx.restore();
}

// Schwarz und Augenbalken: deckender Balken in reinem Schwarz, ohne Rahmen und ohne Schrift. Mit `balken` (geneigte Augenlinie) gedreht um seine Mitte,
// sonst die Box. Die Leinwand beschneidet am Bildrand selbst. Kantenglaettung bei der Drehung ist gewollt (der Balken ist deckend, auch
// die Randpixel sind nur Mischung aus Schwarz und Original).
function zeichneSchwarz(ctx: Kontext, f: Flaeche): void {
  ctx.save();
  ctx.fillStyle = BALKEN_FARBE;
  if (f.balken) {
    const b = f.balken;
    ctx.translate(b.mitte[0], b.mitte[1]);
    ctx.rotate(b.winkel);
    ctx.fillRect(-b.breite / 2, -b.hoehe / 2, b.breite, b.hoehe);
  } else {
    ctx.fillRect(f.box[0], f.box[1], f.box[2], f.box[3]);
  }
  ctx.restore();
}

// Traegt das Bild durchsichtige Pixel? Gefragt fuer Balken-Presets (siehe rendereZensur): dort soll ausser den Balken nichts anders aussehen, und
// JPEG machte Durchsichtiges schwarz. Geprueft wird ein auf hoechstens ALPHA_PROBE_SEITE verkleinertes Abbild (billig, auch fuer grosse Bilder):
// durchsichtige Flaechen erscheinen dort als Pixel mit Alpha unter 255; nur ein einzelnes durchsichtiges Pixel in einem grossen Bild kann
// durchrutschen (es wird dann wie bisher schwarz).
export const ALPHA_PROBE_SEITE = 64;
export function hatTransparenz(quelle: CanvasImageSource, breite: number, hoehe: number): boolean {
  const f = Math.min(1, ALPHA_PROBE_SEITE / Math.max(1, breite, hoehe));
  const b = Math.max(1, Math.round(breite * f));
  const h = Math.max(1, Math.round(hoehe * f));
  const { ctx } = neueLeinwand(b, h);
  ctx.drawImage(quelle, 0, 0, b, h);
  const d = ctx.getImageData(0, 0, b, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]! < 255) return true;
  return false;
}

// Formate, die Durchsichtigkeit kennen koennen (nur dann lohnt das Pruefen auf Alpha).
export function kannAlpha(typ: string): boolean {
  return /^image\/(png|apng|webp|gif|avif|svg\+xml)/i.test(typ);
}

// Sticker (STICKER-BAUPLAN): erst die deckende Pastell-Flaeche ueber genau die Box, die `schwarz` decken wuerde, dann der pinke Rahmen, dann (nur wenn
// ein Sticker da ist und die Flaeche gross genug) der Sticker mittig, Seitenverhaeltnis bleibt. Sicherheit (Regeln S1 und S2): die Flaeche hat Alpha 1,
// `source-over`, keinen Clip und haengt an nichts vom Sticker; das Zeichnen des Stickers kann sie nie loeschen oder durchsichtig machen (nur `drawImage`
// mit `source-over`, kein `clearRect`, kein `destination-out`). Scheitert der Sticker (geschlossenes Bitmap), bleibt die Flaeche stehen.
// `farbe`: Hex-Farbe der Flaeche (src/sticker.ts stickerFarbe). `anzeigeSkala`: Darstellungsgroesse durch Arbeitsbild, wie bei `patchPasst`.
export function zeichneSticker(ctx: Kontext, box: Box, farbe: string, sticker: CanvasImageSource | null | undefined, anzeigeSkala = 1): void {
  const [x, y, w, h] = box;
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = farbe;
    ctx.fillRect(x, y, w, h);
  } finally {
    ctx.restore();
  }
  zeichneRahmen(ctx, box);
  if (!sticker || !stickerPasst(box, anzeigeSkala)) return;
  const m = bildMass(sticker);
  const r = stickerRechteck(box, m.b, m.h, rahmenBreite(w, h));
  if (!r) return;
  ctx.save();
  try {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(sticker, r[0], r[1], r[2], r[3]);
  } catch {
    // Geschlossenes oder sonst unzeichenbares Bitmap: die Flaeche steht schon, ohne Sticker.
  } finally {
    ctx.restore();
  }
}

// Familie der Wort-Schrift (der Erkenner registriert sie per FontFace aus public/schrift/rounded-800.woff2, siehe erkenner.ts) und Farbe.
export const WORT_FAMILIE = 'VEIL Wort';
const WORT_FARBE = FARBEN['rosa-300'];
const WORT_UNTERLAGE = WERTE['wort-unterlage']!;
const WORT_BREITE = 0.8; // hoechstens 80 % der Breite der Flaeche
const WORT_HOEHE = 0.5; // und hoechstens die Haelfte der Hoehe

// Ein Wort waagerecht in die Mitte der Flaeche (Box). Auf Mosaik liegt eine dunkle Unterlage hinter dem Wort, damit es lesbar bleibt.
// `familie`: die Schrift (der Erkenner nennt `VEIL Wort`, die Videozensur im Content-Script die Seitenfamilie `VEIL Rounded <zufall>`, gleiche Datei).
export function zeichneWort(ctx: Kontext, text: string, box: Box, aufMosaik: boolean, familie = WORT_FAMILIE): void {
  const [x, y, w, h] = box;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 100px "${familie}", "Arial Rounded MT Bold", system-ui, sans-serif`;
  const m = Math.max(1, ctx.measureText(text).width);
  const groesse = Math.max(6, Math.min((100 * w * WORT_BREITE) / m, h * WORT_HOEHE));
  ctx.font = `800 ${groesse}px "${familie}", "Arial Rounded MT Bold", system-ui, sans-serif`;
  const tb = ctx.measureText(text).width;
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (aufMosaik) {
    const pad = groesse * 0.3;
    ctx.fillStyle = WORT_UNTERLAGE;
    ctx.fillRect(cx - tb / 2 - pad, cy - groesse * 0.65, tb + 2 * pad, groesse * 1.3);
  }
  ctx.fillStyle = WORT_FARBE;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function alsDataUrl(blob: Blob): Promise<string> {
  return new Promise((ok, fehl) => {
    const leser = new FileReader();
    leser.onload = () => ok(String(leser.result));
    leser.onerror = () => fehl(leser.error ?? new Error('Lesefehler'));
    leser.readAsDataURL(blob);
  });
}

export interface GesichtsBild {
  bild: CanvasImageSource;
  // Ausschnitt in den Pixeln des Bildes: [x, y, w, h]
  ausschnitt: Box;
}

export interface RenderOptionen {
  // Darstellungsgroesse durch Arbeitsbild (1 wenn unbekannt): rechnet Mindestgroessen in Anzeigepixel um.
  anzeigeSkala?: number;
  // PNG statt JPEG (Quelle mit Durchsichtigem, nur Balken oder Schwarz).
  png?: boolean;
  // Je Flaeche (gleiche Reihenfolge wie `flaechen`): Gesichts-Patch fuer `mia-gesicht`, null wenn keiner zu haben ist.
  gesichter?: readonly (GesichtsBild | null)[];
  // Je Flaeche: das Wort fuer Behandlungen mit Wort ('' oder fehlend: kein Wort).
  woerter?: readonly string[];
  // Je Flaeche: der Sticker fuer `sticker` (auch als Ersatz fuer Mias Gesicht), null wenn keiner zu haben ist (dann steht die Flaeche ohne Sticker).
  sticker?: readonly (CanvasImageSource | null)[];
  // Je Flaeche: der Schluessel, der die Pastellfarbe bestimmt (`kennung|zone|box`, wie bei Gesicht und Wort); fehlt er, gilt `zone|box`.
  stickerSchluessel?: readonly string[];
}

// Zeichnet das Bild in Zielgroesse, legt die Zensur auf alle Flaechen und liefert ein JPEG als Data-URL.
// Behandlung je Flaeche: `f.behandlung`, fehlt sie die des Presets fuer ein ganzes Bild. `mia-gesicht` ohne passenden Patch (keiner da,
// Patch-Passt-Regel nicht erfuellt) wird `f.ersatz` (sonst Mosaik, bei Mia und Sticker der Sticker mit Pastell-Flaeche); Behandlungen mit Wort ohne Wort oder auf zu kleiner Flaeche
// (src/presets.ts wortPasst) werden ihre Variante ohne Wort.
export async function rendereZensur(
  quelle: CanvasImageSource,
  breite: number,
  hoehe: number,
  flaechen: readonly Flaeche[],
  preset: Preset,
  optionen: RenderOptionen = {},
): Promise<string> {
  const { leinwand, ctx } = neueZielLeinwand(breite, hoehe);
  ctx.drawImage(quelle, 0, 0, leinwand.width, leinwand.height);
  const blurOk = kannFilter(ctx);
  const standard = ganzesBildBehandlung(preset);
  flaechen.forEach((f, i) => {
    let b: Behandlung = f.behandlung ?? standard;
    if (b === 'mia-gesicht') {
      const g = optionen.gesichter?.[i];
      const w = f.balken ? f.balken.breite : f.box[2];
      const h = f.balken ? f.balken.hoehe : f.box[3];
      if (g && patchPasst([0, 0, w, h], g.ausschnitt[2], g.ausschnitt[3], optionen.anzeigeSkala) && zeichneGesicht(ctx, f, g.bild, g.ausschnitt)) return;
      b = f.ersatz && f.ersatz !== 'mia-gesicht' ? f.ersatz : 'mosaik';
    }
    const wort = hatWort(b) ? (optionen.woerter?.[i] ?? '') : '';
    if (hatWort(b) && (wort === '' || !wortPasst(f.box[2], f.box[3], optionen.anzeigeSkala))) b = ohneWort(b);
    switch (b) {
      case 'schwarz':
      case 'balken':
        zeichneSchwarz(ctx, f);
        return;
      case 'schwarz-wort':
        zeichneSchwarz(ctx, f);
        zeichneWort(ctx, wort, f.box, false);
        return;
      case 'blur':
        if (blurOk) zeichneBlur(ctx, quelle, f.box, leinwand.width, leinwand.height);
        else zeichneMosaik(ctx, quelle, f.box);
        return;
      case 'mosaik-wort':
        zeichneMosaik(ctx, quelle, f.box);
        zeichneWort(ctx, wort, f.box, true);
        return;
      case 'sticker':
        zeichneSticker(ctx, f.box, stickerFarbe(optionen.stickerSchluessel?.[i] ?? `${f.zone}|${f.box.join(',')}`), optionen.sticker?.[i] ?? null, optionen.anzeigeSkala);
        return;
      default:
        zeichneMosaik(ctx, quelle, f.box);
    }
  });
  // Auf einer HTML-Leinwand kodiert toDataURL sofort. OffscreenCanvas.convertToBlob wartet in versteckten Dokumenten
  // (Offscreen-Dokument) auf gedrosselte Aufgaben und brauchte dort rund eine Sekunde.
  // `png`: bei einer Quelle mit durchsichtigen Pixeln verlustfrei und mit Alpha, damit ausser den Balken nichts anders aussieht.
  if (leinwand instanceof OffscreenCanvas) {
    if (optionen.png) {
      const png = await leinwand.convertToBlob({ type: 'image/png' });
      if (png.size <= PNG_MAX_BYTES) return alsDataUrl(png);
    }
    return alsDataUrl(await leinwand.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITAET }));
  }
  if (optionen.png) {
    const png = leinwand.toDataURL('image/png');
    if (png.length <= PNG_MAX_BYTES * 1.4) return png; // Base64: etwa ein Drittel groesser als die Bytes
  }
  return leinwand.toDataURL('image/jpeg', JPEG_QUALITAET);
}
