// Mauszeiger (Auftrag K2, Phase 5 Session 10, Entscheidung 116): reine Logik ohne Laufzeit-Importe. Die Zeiger werden als SVG gezeichnet und als
// Data-URL in `cursor: url(...)` gesetzt (keine Datei, kein web_accessible_resources). Mias Pink mit dunkler Kontur, damit der Zeiger auf hellen
// und dunklen Seiten sichtbar ist. Hoechstens 32 x 32 px (Browsergrenze fuer volle Wirkung; groessere Zeiger blendet Chromium am Rand des
// Fensters aus). Klickpunkt bei beiden Zeigern in der Mitte (16, 16): beim Herz die Mitte des Koerpers, bei der Spirale ihr Zentrum.
import type { CursorArt } from '../einstellungen';

export const ZEIGER_GROESSE = 32;
export const KLICKPUNKT = 16;
export const MIAS_PINK = '#ff4fa3';
export const KONTUR = '#4a0d33';

export type ZeigerArt = Exclude<CursorArt, 'aus'>;

// Spirale: Archimedische Spirale um die Mitte, 2,25 Umdrehungen, Radius 1,5 bis 14,2 px.
function spiralenPfad(): string {
  const umdrehungen = 2.25;
  const schritte = 72;
  const r0 = 1.5;
  const r1 = 14.2;
  const punkte: string[] = [];
  for (let i = 0; i <= schritte; i++) {
    const t = i / schritte;
    const winkel = t * umdrehungen * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    const x = KLICKPUNKT + r * Math.cos(winkel);
    const y = KLICKPUNKT + r * Math.sin(winkel);
    punkte.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return punkte.join('');
}

const HERZ_PFAD = 'M16 28.2C16 28.2 3.2 20 3.2 11.6C3.2 7.2 6.6 4.2 10.6 4.2C13.1 4.2 15 5.5 16 7.4C17 5.5 18.9 4.2 21.4 4.2C25.4 4.2 28.8 7.2 28.8 11.6C28.8 20 16 28.2 16 28.2Z';

// Das SVG eines Zeigers. Einfache Anfuehrungszeichen in den Attributen, damit die Data-URL in `url("...")` ohne Maskierung steht. Die Kennung
// `id` an der Wurzel sagt den Tests, welche Art gerade wirkt.
export function zeigerSvg(art: ZeigerArt): string {
  const kopf = `<svg xmlns='http://www.w3.org/2000/svg' id='veil-${art}' width='${ZEIGER_GROESSE}' height='${ZEIGER_GROESSE}' viewBox='0 0 ${ZEIGER_GROESSE} ${ZEIGER_GROESSE}'>`;
  if (art === 'herz') {
    return `${kopf}<path d='${HERZ_PFAD}' fill='${MIAS_PINK}' stroke='${KONTUR}' stroke-width='2' stroke-linejoin='round'/></svg>`;
  }
  const d = spiralenPfad();
  return (
    `${kopf}<path d='${d}' fill='none' stroke='${KONTUR}' stroke-width='4.6' stroke-linecap='round' stroke-linejoin='round'/>` +
    `<path d='${d}' fill='none' stroke='${MIAS_PINK}' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/></svg>`
  );
}

export function zeigerUrl(art: ZeigerArt): string {
  return `data:image/svg+xml,${encodeURIComponent(zeigerSvg(art))}`;
}

// Der Wert fuer `cursor`: Zeiger mit Klickpunkt, Rueckfall `auto`.
export function zeigerWert(art: ZeigerArt): string {
  return `url("${zeigerUrl(art)}") ${KLICKPUNKT} ${KLICKPUNKT}, auto`;
}

// Eingabefelder mit Texteingabe, editierbare Bereiche und ihr Inhalt behalten den Textcursor.
const TEXT_FELDER =
  'textarea, input:is(:not([type]), [type="text" i], [type="search" i], [type="email" i], [type="url" i], [type="tel" i], [type="password" i], [type="number" i]), [contenteditable]:not([contenteditable="false" i])';

// Das Blatt. `wurzel`: false fuer das Dokument (`:root:root` hebt die Spezifitaet, damit Seitenregeln mit !important und mittlerer Spezifitaet
// den Zeiger nicht kippen und die Text-Regeln darueber liegen), true fuer eine Shadow Root (dort gibt es kein `:root`).
export function zeigerCss(art: ZeigerArt, wurzel = false): string {
  const w = zeigerWert(art);
  if (wurzel) {
    return `* { cursor: ${w} !important; }\n:is(${TEXT_FELDER}), :is(${TEXT_FELDER}) * { cursor: text !important; }\n`;
  }
  return (
    `:root:root, :root:root * { cursor: ${w} !important; }\n` +
    `:root:root :is(${TEXT_FELDER}), :root:root :is(${TEXT_FELDER}) *, :root:root[contenteditable]:not([contenteditable="false" i]) { cursor: text !important; }\n`
  );
}
