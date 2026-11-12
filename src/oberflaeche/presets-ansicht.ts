// Ansicht der Zensur-Presets (ZENSUR-PRESETS-BAUPLAN, Abschnitt Oberflaeche): Karten in vier Gruppen mit kleiner schematischer Vorschau,
// gemeinsam fuer Einstellungsseite und Einstieg (kompakt), dazu die Vorschau-Figur fuer die Zeile im Popup. Farben nur aus werte.ts.
// Die Vorschau ist eine stilisierte Figur (nichts Explizites): Kopf, Augenlinie, Oberkoerper, Unterkoerper mit der Behandlung des Presets.
import { FARBEN } from './design/werte';
import { GRUPPEN, GRUPPEN_NAMEN, PRESETS, PRESET_IDS, packGenuegt, presetFuerPack, type Behandlung, type Preset } from '../presets.ts';

const F = FARBEN;

// Bereiche der Figur (viewBox 0 0 60 72)
const KOPF = [20, 5, 20, 20] as const;
const AUGEN = [21, 12, 18, 5] as const;
const BRUST = [17, 33, 26, 13] as const;
const UNTEN = [17, 49, 26, 14] as const;
const PERSON = [12, 3, 36, 64] as const;

type Rechteck = readonly [number, number, number, number];

function wortBalken(r: Rechteck): string {
  const [x, y, w, h] = r;
  const bh = Math.max(2, Math.round(h * 0.28));
  return `<rect x="${x + w * 0.2}" y="${y + (h - bh) / 2}" width="${w * 0.6}" height="${bh}" rx="${bh / 2}" fill="${F['rosa-300']}"/>`;
}

function mosaik(r: Rechteck, unterlage = false): string {
  const [x, y, w, h] = r;
  const z = 4;
  const farben = [F['rosa-300'], F['lav-200'], F['rosa-200'], F['pfirsich-200']];
  let s = '';
  for (let j = 0; j * z < h; j++) {
    for (let i = 0; i * z < w; i++) {
      s += `<rect x="${x + i * z}" y="${y + j * z}" width="${Math.min(z, w - i * z)}" height="${Math.min(z, h - j * z)}" fill="${farben[(i * 3 + j * 5) % farben.length]}"/>`;
    }
  }
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${F['rosa-500']}" stroke-width="1.2"/>`;
  if (unterlage) s += `<rect x="${x + w * 0.12}" y="${y + h * 0.3}" width="${w * 0.76}" height="${h * 0.4}" rx="2" fill="${F.etikett}" opacity="0.75"/>`;
  return s;
}

function weichzeichner(r: Rechteck, id: string): string {
  const [x, y, w, h] = r;
  return `<defs><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4"/></filter></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${F['rosa-300']}" filter="url(#${id})"/>`;
}

function schwarz(r: Rechteck): string {
  const [x, y, w, h] = r;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${F.etikett}"/>`;
}

function miasGesicht(): string {
  const [x, y, w, h] = KOPF;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${F['rosa-500']}" stroke="${F['rosa-700']}" stroke-width="1.4"/>` +
    `<circle cx="${x + w * 0.32}" cy="${y + h * 0.42}" r="2.1" fill="${F.weiss}"/><circle cx="${x + w * 0.68}" cy="${y + h * 0.42}" r="2.1" fill="${F.weiss}"/>` +
    `<path d="M${x + w * 0.32} ${y + h * 0.7} Q${x + w * 0.5} ${y + h * 0.86} ${x + w * 0.68} ${y + h * 0.7}" fill="none" stroke="${F.weiss}" stroke-width="1.4" stroke-linecap="round"/>`
  );
}

// Sticker: deckende Pastell-Flaeche mit pinkem Rahmen und einem kleinen Herz-Sticker mittig (nur Farben aus werte.ts). `ton` waehlt den Pastellton.
const STICKER_TOENE = ['rosa-200', 'lav-200', 'pfirsich-200'] as const;
function stickerFlaeche(r: Rechteck, ton: number): string {
  const [x, y, w, h] = r;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const k = Math.min(w, h) * 0.5; // Groesse des Herzens
  const herz = `M${cx} ${cy + k * 0.42} C${cx - k * 0.75} ${cy - k * 0.1} ${cx - k * 0.45} ${cy - k * 0.55} ${cx} ${cy - k * 0.2} C${cx + k * 0.45} ${cy - k * 0.55} ${cx + k * 0.75} ${cy - k * 0.1} ${cx} ${cy + k * 0.42}Z`;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${F[STICKER_TOENE[ton % STICKER_TOENE.length]!]}"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${F['rosa-500']}" stroke-width="1.2"/>` +
    `<path d="${herz}" fill="${F['rosa-500']}" stroke="${F.weiss}" stroke-width="1"/>`
  );
}

function flaeche(b: Behandlung, r: Rechteck, id: string, ton = 0): string {
  switch (b) {
    case 'mosaik':
      return mosaik(r);
    case 'mosaik-wort':
      return mosaik(r, true) + wortBalken(r);
    case 'blur':
      return weichzeichner(r, id);
    case 'schwarz':
    case 'balken':
      return schwarz(r);
    case 'schwarz-wort':
      return schwarz(r) + wortBalken(r);
    case 'mia-gesicht':
      return miasGesicht();
    case 'sticker':
      return stickerFlaeche(r, ton);
  }
}

// SVG-Vorschau eines Presets. `id` macht die Filter-Kennung eindeutig (mehrere Vorschauen in einer Seite).
export function presetVorschau(preset: Preset, id = 'p'): string {
  const d = PRESETS[preset];
  const fig =
    `<rect x="14" y="30" width="32" height="38" rx="12" fill="${F['rosa-100']}" stroke="${F['rosa-300']}" stroke-width="1.2"/>` +
    `<circle cx="30" cy="15" r="11" fill="${F['rosa-200']}" stroke="${F['rosa-300']}" stroke-width="1.2"/>`;
  let ueber = '';
  if (d.person) {
    ueber = flaeche(d.koerper!, PERSON, `${id}-f-${preset}`);
  } else if (d.augen === 'nur-balken') {
    ueber = schwarz(AUGEN);
  } else {
    // Zensurbalken: der Kopf bleibt (Gesicht nur mit Face an), nur die Augen bekommen den Balken.
    if (d.gesicht && d.augen !== 'balken-immer') ueber += flaeche(d.gesicht, KOPF, `${id}-f-${preset}-k`, 1);
    if (d.augen === 'balken-immer') ueber += schwarz(AUGEN);
    if (d.koerper) ueber += flaeche(d.koerper, BRUST, `${id}-f-${preset}-b`, 0) + flaeche(d.koerper, UNTEN, `${id}-f-${preset}-u`, 2);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 72" width="60" height="72" aria-hidden="true" focusable="false">${fig}${ueber}</svg>`;
}

export interface KartenOptionen {
  // Name der Radiogruppe und Praefix der Feld-Kennungen (`<praefix>-<preset>`).
  name: string;
  praefix: string;
  kompakt?: boolean;
  // Kennung der Ueberschrift der ganzen Wahl (Radiogruppe), z. B. `stil-titel`: die vier Gruppen darin sind nur Gruppen mit eigener Ueberschrift.
  labelId: string;
  beiWahl: (p: Preset) => void;
}

export interface Karten {
  // Zeichnet die Auswahl: `aktuell` ist das gespeicherte Preset, `miaPack` ob die Mia-Presets frei sind, `mitSticker` ob das Pack Sticker mitbringt.
  aktualisiere(aktuell: Preset, miaPack: boolean, mitSticker: boolean): void;
  felder: ReadonlyMap<Preset, HTMLInputElement>;
}

function neu<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Baut die Karten in vier Gruppen in `host`. Die Karten sind Radios (Tastatur, Screenreader); Mia-Presets sind ohne Pack gesperrt, Sticker-Presets ohne Sticker im Pack.
export function baueKarten(host: HTMLElement, o: KartenOptionen): Karten {
  const felder = new Map<Preset, HTMLInputElement>();
  const karten = new Map<Preset, HTMLLabelElement>();
  host.classList.add('preset-wahl');
  // Eine einzige Radiogruppe (name gilt fuer alle dreizehn Karten), darin vier benannte Gruppen: so sagt der Screenreader "Auswahl 3 von 13".
  host.setAttribute('role', 'radiogroup');
  host.setAttribute('aria-labelledby', o.labelId);
  if (o.kompakt) host.classList.add('kompakt');
  for (const g of GRUPPEN) {
    const gruppe = neu('div', 'preset-gruppe');
    gruppe.setAttribute('role', 'group');
    const titelId = `${o.praefix}-gruppe-${g}`;
    const titel = neu('h3', 'preset-gruppe-titel', GRUPPEN_NAMEN[g]);
    titel.id = titelId;
    gruppe.setAttribute('aria-labelledby', titelId);
    const liste = neu('div', 'preset-liste');
    for (const id of PRESET_IDS.filter((p) => PRESETS[p].gruppe === g)) {
      const d = PRESETS[id];
      const label = neu('label', 'preset-karte');
      const feld = neu('input');
      feld.type = 'radio';
      feld.name = o.name;
      feld.value = id;
      feld.id = `${o.praefix}-${id}`;
      const bild = neu('span', 'preset-bild');
      bild.innerHTML = presetVorschau(id, o.praefix);
      const text = neu('span', 'preset-text');
      text.append(neu('strong', undefined, d.name));
      // (kein Satz auf der Karte: er steht unter der Wahl)
      const box = neu('span', 'preset-box');
      box.append(bild, text);
      label.append(feld, box);
      feld.addEventListener('change', () => {
        if (feld.checked) o.beiWahl(id);
      });
      felder.set(id, feld);
      karten.set(id, label);
      liste.append(label);
    }
    gruppe.append(titel, liste);
    host.append(gruppe);
  }
  return {
    felder,
    aktualisiere(aktuell, miaPack, mitSticker) {
      const gilt = presetFuerPack(aktuell, miaPack, mitSticker);
      for (const [id, feld] of felder) {
        feld.checked = id === gilt;
        const gesperrt = !packGenuegt(PRESETS[id].braucht, miaPack, mitSticker);
        feld.disabled = gesperrt;
        karten.get(id)!.classList.toggle('gesperrt', gesperrt);
      }
    },
  };
}
