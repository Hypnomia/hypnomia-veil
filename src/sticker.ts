// Sticker-Zensur (STICKER-BAUPLAN): reine Geometrie und Farbwahl, ohne Browser (Einheitstests mit `node --experimental-strip-types`).
// Die Behandlung `sticker` deckt eine Zone mit einer deckenden Pastell-Flaeche (Sakura Glas), darauf sitzt mittig ein Sticker aus dem
// Mia Pack. Die Flaeche ist immer das Rechteck, das `schwarz` fuer dieselbe Zone decken wuerde; der Sticker ist nur Zugabe (Hide-first).

import { FARBEN } from './oberflaeche/design/werte.ts';
import { hashe } from './pack/hash.ts';

// Die drei Pastelltoene der Flaeche (Schluessel aus werte.ts). Mehr nicht: die Farbe ist je Schluessel stabil, nie zufaellig je Bild.
export const STICKER_FARBEN = ['rosa-200', 'lav-200', 'pfirsich-200'] as const;
export type StickerFarbName = (typeof STICKER_FARBEN)[number];

// Der Farbschluessel einer Flaeche (Bild: `kennung|zone|box`, Video: `hash(currentSrc)|motiv`) bestimmt Ton und Sticker stabil.
export function stickerFarbName(schluessel: string): StickerFarbName {
  return STICKER_FARBEN[hashe(`farbe|${schluessel}`) % STICKER_FARBEN.length]!;
}
export function stickerFarbe(schluessel: string): string {
  return FARBEN[stickerFarbName(schluessel)];
}

// Anteil der kuerzeren Flaechenseite (innerhalb des Rahmens), den die laengste Seite des Stickers einnimmt.
export const STICKER_ANTEIL = 0.86;
// Kuerzere Seite der Flaeche (Anzeigegroesse, wie `patchPasst`) unter diesem Wert: nur die Flaeche, kein Sticker.
export const STICKER_MIN_SEITE = 24;

export type StickerBox = readonly [number, number, number, number];

// Sticker mittig in der Flaeche (x, y, w, h), Seitenverhaeltnis bleibt (einpassen). `rahmen`: Breite des pinken Rahmens innen (der Sticker
// liegt innerhalb davon). Die laengste Seite ist STICKER_ANTEIL der kuerzeren Seite der Innenflaeche; so liegt er in beiden Richtungen drin.
// null, wenn nichts zu zeichnen ist (leere Flaeche oder leeres Bild).
export function stickerRechteck(flaeche: StickerBox, bildBreite: number, bildHoehe: number, rahmen: number): [number, number, number, number] | null {
  const [x, y, w, h] = flaeche;
  if (!(w > 0 && h > 0 && bildBreite > 0 && bildHoehe > 0)) return null;
  const r = Number.isFinite(rahmen) && rahmen > 0 ? rahmen : 0;
  const innenB = w - 2 * r;
  const innenH = h - 2 * r;
  if (innenB <= 0 || innenH <= 0) return null;
  const lang = STICKER_ANTEIL * Math.min(innenB, innenH);
  const skala = lang / Math.max(bildBreite, bildHoehe);
  const sw = bildBreite * skala;
  const sh = bildHoehe * skala;
  return [x + (w - sw) / 2, y + (h - sh) / 2, sw, sh];
}

// Passt ein Sticker in die Flaeche? Die kuerzere Seite zaehlt, wie sie auf dem Bildschirm aussieht (`anzeigeSkala`: Darstellung durch Arbeitsbild).
export function stickerPasst(flaeche: StickerBox, anzeigeSkala = 1): boolean {
  const s = Number.isFinite(anzeigeSkala) && anzeigeSkala > 0 ? anzeigeSkala : 1;
  return Math.min(flaeche[2], flaeche[3]) * s >= STICKER_MIN_SEITE;
}

// Wahl unter n Stickern: Startplatz stabil je Schluessel. Das naechste Bild nach einem Fehler ist (start + i) % n.
export function stickerStart(schluessel: string, n: number): number {
  return n > 0 ? hashe(schluessel) % n : 0;
}

// Hoechstens so viele Sticker werden je Wahl nacheinander versucht (nach einem Dekodierfehler der naechste).
export const STICKER_MAX_VERSUCHE = 4;

// Wahl unter `namen` (Reihenfolge fest): Start bei stickerStart, nicht dekodierbare Namen (`kaputt`) werden uebersprungen und zaehlen nicht als Versuch,
// bei einem Dekodierfehler (`versuch` liefert null) wird der Name vergessen und der naechste versucht, hoechstens STICKER_MAX_VERSUCHE. Wirft `versuch` (Lesefehler,
// Zeitgrenze), endet die Wahl sofort mit `fehler: true`: es wird nichts weiter gelesen. Rein, ohne Browser (Einheitstests).
export async function waehleNaechsten<T>(
  schluessel: string,
  namen: readonly string[],
  kaputt: Set<string>,
  versuch: (name: string) => Promise<T | null>,
  max = STICKER_MAX_VERSUCHE,
): Promise<{ wert: { name: string; wert: T } | null; fehler: boolean; versuche: number }> {
  const start = stickerStart(schluessel, namen.length);
  let versuche = 0;
  for (let i = 0; i < namen.length && versuche < max; i++) {
    const name = namen[(start + i) % namen.length]!;
    if (kaputt.has(name)) continue;
    versuche++;
    let w: T | null;
    try {
      w = await versuch(name);
    } catch {
      return { wert: null, fehler: true, versuche };
    }
    if (w !== null) return { wert: { name, wert: w }, fehler: false, versuche };
    kaputt.add(name);
  }
  return { wert: null, fehler: false, versuche };
}

// Je Flaeche einen Wert holen (`hole` liefert null: keiner zu haben); nach dem ersten Lesefehler (`fehler: true`) wird fuer die restlichen Flaechen nichts mehr
// angefordert (sie bleiben ohne Sticker, die Flaeche deckt trotzdem). `braucht(i)` false: diese Flaeche braucht keinen.
export async function holeJeFlaeche<T>(
  n: number,
  braucht: (i: number) => boolean,
  hole: (i: number) => Promise<{ wert: T | null; fehler: boolean }>,
): Promise<(T | null)[]> {
  const aus: (T | null)[] = [];
  let aufgegeben = false;
  for (let i = 0; i < n; i++) {
    if (aufgegeben || !braucht(i)) {
      aus.push(null);
      continue;
    }
    const r = await hole(i);
    if (r.fehler) aufgegeben = true;
    aus.push(r.wert);
  }
  return aus;
}

// Ablage mit Verdraengung nach letzter Nutzung (Map haelt die Einfuegereihenfolge): bei einem Treffer neu einordnen (delete und set), damit ein noch
// sichtbares Motiv bei vielen Motiven nicht als aeltestes verdraengt wird und seinen Sticker neu laden muss. Rein, ohne Browser.
export function ordneNeu<K, V>(m: Map<K, V>, schluessel: K): void {
  if (!m.has(schluessel)) return;
  const wert = m.get(schluessel) as V;
  m.delete(schluessel);
  m.set(schluessel, wert);
}
