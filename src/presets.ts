// Zensur-Presets (ZENSUR-PRESETS-BAUPLAN): vorgefertigte Kombinationen statt einer einzelnen Stil-Wahl. Reine Logik und Tabelle, ohne
// Laufzeit-Importe (Einheitstests mit `node --experimental-strip-types`). Die Wirkung je Zone steht in der Tabelle; der Erkenner
// (src/erkenner/zonen.ts) bildet daraus die Flaechen, der Zeichner (src/erkenner/stile.ts) malt je Behandlung.

// Behandlung je Flaeche.
//   mosaik        Pixel-Mosaik mit pinkem Rahmen          mosaik-wort   Mosaik, dazu ein Wort auf dunkler Unterlage
//   blur          Weichzeichner                           schwarz       deckendes Schwarz, ohne Rahmen
//   schwarz-wort  Schwarz mit einem pinken Wort           balken        schwarzer Augenbalken (wie `schwarz`, nur der Name sagt die Rolle)
//   mia-gesicht   Mias Gesicht (Ausschnitt aus einem Patch-Bild des Packs) mit pinkem Rahmen
//   sticker       deckende Pastell-Flaeche mit pinkem Rahmen, darauf mittig ein Sticker aus dem Pack (STICKER-BAUPLAN, src/sticker.ts)
export const BEHANDLUNGEN = ['mosaik', 'mosaik-wort', 'blur', 'schwarz', 'schwarz-wort', 'balken', 'mia-gesicht', 'sticker'] as const;
export type Behandlung = (typeof BEHANDLUNGEN)[number];

export const PRESET_IDS = [
  'mia-wort',
  'mia-mosaik',
  'mia-mosaik-wort',
  'mia-blur',
  'mia-sticker',
  'sticker',
  'mosaik',
  'mosaik-wort',
  'blur',
  'zensurbalken',
  'augenbalken',
  'person-mosaik',
  'person-blur',
] as const;
export type Preset = (typeof PRESET_IDS)[number];

export type PresetGruppe = 'mia' | 'sticker' | 'klassisch' | 'person';

// Wie die Augen behandelt werden:
//   'wie-koerper'    wie jede andere Zone (laut Schalter), in den Mia-Presets liegen sie im getauschten Gesicht (dann nichts zusaetzlich)
//   'balken-immer'   Augenbalken ueber jedem erkannten Gesicht, unabhaengig vom Schalter (Zensurbalken)
//   'nur-balken'     nur der Augenbalken, alle anderen Zonen ruhen (Augenbalken)
export type AugenArt = 'wie-koerper' | 'balken-immer' | 'nur-balken';

export interface PresetDef {
  id: Preset;
  gruppe: PresetGruppe;
  // Behandlung der Zone Face (nur wenn der Schalter an ist); null: Gesichter bleiben (nur bei `nur-balken`).
  gesicht: Behandlung | null;
  // Behandlung aller anderen Zonen (laut Schaltern); null: keine (nur bei `nur-balken`).
  koerper: Behandlung | null;
  augen: AugenArt;
  // Ganze Person: aus den Treffern eines Bildes werden Personen-Gruppen gebildet, jede Gruppe wird als Ganzes behandelt.
  person: boolean;
  // 'pack': Pack mit Patch-Bildern (`stil:mia-patch`); 'sticker': Pack mit Stickern (`zensur:sticker`); null: laeuft immer.
  braucht: 'pack' | 'sticker' | null;
  // Nutzt das Preset Woerter (Chips der Wort-Themen unter der Wahl)?
  woerter: boolean;
  // Anzeige (Englisch, Mias Stimme; der Texter schaerft nach).
  name: string;
  satz: string;
}

export const PRESETS: Readonly<Record<Preset, PresetDef>> = {
  'mia-wort': { id: 'mia-wort', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'schwarz-wort', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: true, name: 'My face, black, words', satz: 'With Face on, every face becomes mine. Everything else I cover turns black, with a word of mine in pink.' },
  'mia-mosaik': { id: 'mia-mosaik', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'mosaik', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: false, name: 'My face, mosaic', satz: 'With Face on, every face becomes mine. Everything else I cover gets mosaic.' },
  'mia-mosaik-wort': { id: 'mia-mosaik-wort', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'mosaik-wort', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: true, name: 'My face, mosaic, words', satz: 'With Face on, every face becomes mine. Everything else I cover gets mosaic, with a word of mine on top.' },
  'mia-blur': { id: 'mia-blur', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'blur', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: false, name: 'My face, blur', satz: 'With Face on, every face becomes mine. Everything else I cover gets blurred.' },
  'mia-sticker': { id: 'mia-sticker', gruppe: 'sticker', gesicht: 'mia-gesicht', koerper: 'sticker', augen: 'wie-koerper', person: false, braucht: 'sticker', woerter: false, name: 'My face, stickers', satz: 'With Face on, every face becomes mine. Everything else I cover gets a pastel patch with a little me on top.' },
  sticker: { id: 'sticker', gruppe: 'sticker', gesicht: 'sticker', koerper: 'sticker', augen: 'wie-koerper', person: false, braucht: 'sticker', woerter: false, name: 'Stickers', satz: 'A pastel patch over everything I cover, with a little me on top.' },
  mosaik: { id: 'mosaik', gruppe: 'klassisch', gesicht: 'mosaik', koerper: 'mosaik', augen: 'wie-koerper', person: false, braucht: null, woerter: false, name: 'Mosaic', satz: 'Pixels over everything I cover.' },
  'mosaik-wort': { id: 'mosaik-wort', gruppe: 'klassisch', gesicht: 'mosaik-wort', koerper: 'mosaik-wort', augen: 'wie-koerper', person: false, braucht: null, woerter: true, name: 'Mosaic and words', satz: 'Pixels over everything I cover, with a word of mine on top.' },
  blur: { id: 'blur', gruppe: 'klassisch', gesicht: 'blur', koerper: 'blur', augen: 'wie-koerper', person: false, braucht: null, woerter: false, name: 'Blur', satz: 'A soft blur over everything I cover.' },
  zensurbalken: { id: 'zensurbalken', gruppe: 'klassisch', gesicht: 'schwarz', koerper: 'schwarz', augen: 'balken-immer', person: false, braucht: null, woerter: false, name: 'Censor bars', satz: 'A black bar over the eyes, always. Everything else I cover turns black.' },
  augenbalken: { id: 'augenbalken', gruppe: 'klassisch', gesicht: null, koerper: null, augen: 'nur-balken', person: false, braucht: null, woerter: false, name: 'Eye bar', satz: 'Just a black bar over the eyes. Everything else stays in view.' },
  'person-mosaik': { id: 'person-mosaik', gruppe: 'person', gesicht: 'mosaik', koerper: 'mosaik', augen: 'wie-koerper', person: true, braucht: null, woerter: false, name: 'Whole person, mosaic', satz: 'When I find something you picked, the whole person goes under mosaic.' },
  'person-blur': { id: 'person-blur', gruppe: 'person', gesicht: 'blur', koerper: 'blur', augen: 'wie-koerper', person: true, braucht: null, woerter: false, name: 'Whole person, blur', satz: 'When I find something you picked, the whole person goes under blur.' },
};

export const GRUPPEN_NAMEN: Readonly<Record<PresetGruppe, string>> = { mia: 'With my face', sticker: 'With my stickers', klassisch: 'Classic', person: 'Whole person' };
export const GRUPPEN: readonly PresetGruppe[] = ['mia', 'sticker', 'klassisch', 'person'];
export const STANDARD_PRESET: Preset = 'mosaik';
// Preset, das ein frisch importiertes erstes Pack einschaltet (Plan: Standard mit Pack).
export const PACK_PRESET: Preset = 'mia-wort';
// Preset, auf das Mia-Presets ohne Pack zurueckfallen.
export const OHNE_PACK_PRESET: Preset = 'mosaik';
// Hinweis, der die Grenze der Ganze-Person-Presets ehrlich nennt (Plan, Abschnitt "Ganze Person").
export const PERSON_GRENZE = 'I work out the person from the parts I recognize, so the edges can be off. When I’m unsure, I cover more rather than less.';

export function istPreset(x: unknown): x is Preset {
  return typeof x === 'string' && (PRESET_IDS as readonly string[]).includes(x);
}

// Migration: der alte Wert `stil` wird zum Preset. Unbekannt: null.
export function presetAusStil(stil: unknown): Preset | null {
  switch (stil) {
    case 'mosaik':
      return 'mosaik';
    case 'blur':
      return 'blur';
    case 'mia-patch':
      return 'mia-wort';
    case 'augenbalken':
      return 'augenbalken';
    default:
      return null;
  }
}

// Das Preset, das wirklich gilt: Mia-Presets nur mit Pack (Freischaltung `stil:mia-patch`), Sticker-Presets nur mit Stickern im Pack
// (`zensur:sticker`), sonst Mosaik. `mitSticker` fehlt = keine Sticker (sicherer Standard).
export function presetFuerPack(preset: Preset, mitMiaPack: boolean, mitSticker = false): Preset {
  return !packGenuegt(PRESETS[preset].braucht, mitMiaPack, mitSticker) ? OHNE_PACK_PRESET : preset;
}

// Reicht das Pack fuer die Anforderung eines Presets (`braucht`)?
export function packGenuegt(braucht: PresetDef['braucht'], mitMiaPack: boolean, mitSticker: boolean): boolean {
  return braucht === null || (braucht === 'pack' ? mitMiaPack : mitSticker);
}

// Nutzt dieses Preset Sticker (Flaechen mit der Behandlung `sticker`, auch als Ersatz fuer Mias Gesicht)?
export const nutztSticker = (preset: Preset): boolean => PRESETS[preset].gesicht === 'sticker' || PRESETS[preset].koerper === 'sticker';

// Zeichnet dieses Preset Mias Gesicht?
export const nutztMiasGesicht = (preset: Preset): boolean => PRESETS[preset].gesicht === 'mia-gesicht';

// Behandlung fuer ein ganz verdecktes Bild (Steigerung Stufe 4, bewegtes SVG): die Behandlung der Koerper-Zonen, ersatzweise Mosaik.
// Mias Gesicht, der Augenbalken und der Sticker passen nicht auf ein ganzes Bild (STICKER-BAUPLAN Entscheidung 6: dort bleibt es Mosaik).
export function ganzesBildBehandlung(preset: Preset): Behandlung {
  const k = PRESETS[preset].koerper;
  return k === null || k === 'mia-gesicht' || k === 'balken' || k === 'sticker' ? 'mosaik' : k;
}

// Behandlung einer Flaeche der Zone `zone` im Preset, aus der Tabelle (die Videozensur nimmt sie, wenn eine Flaeche keine eigene Behandlung traegt;
// der Erkenner setzt `behandlung` nach derselben Regel, siehe berechneFlaechen in src/erkenner/zonen.ts): Augenbalken immer Balken, Zensurbalken
// auf den Augen Balken, Gesicht nach `gesicht`, alles andere nach `koerper`. Ohne Eintrag (Gesicht oder Koerper null) Mosaik, nie "nichts".
export function behandlungFuerZone(preset: Preset, zone: string): Behandlung {
  const d = PRESETS[preset];
  if (d.augen === 'nur-balken') return 'balken';
  if (zone === 'eyes' && d.augen === 'balken-immer') return 'balken';
  return (zone === 'face' ? d.gesicht : d.koerper) ?? 'mosaik';
}

// Zonen, die ein Preset wirklich auswertet (statt der Schalter): Augenbalken nur Augen; Zensurbalken die Schalter plus Augen.
// Andere Presets: die Schalter unveraendert (dasselbe Objekt).
export function zonenFuerPreset<T extends { an: boolean; bedeckt?: boolean }>(preset: Preset | undefined, zonen: Record<string, T>): Record<string, T> {
  if (!preset) return zonen;
  const d = PRESETS[preset];
  if (d.augen === 'nur-balken') {
    const nur: Record<string, T> = {};
    for (const [z, e] of Object.entries(zonen)) nur[z] = z === 'eyes' ? ({ ...e, an: true } as T) : ({ ...e, an: false, ...('bedeckt' in e ? { bedeckt: false } : {}) } as T);
    return nur;
  }
  if (d.augen === 'balken-immer') return { ...zonen, eyes: { ...zonen.eyes!, an: true } };
  return zonen;
}

// Wort-Vertrag (Pack, Rolle `woerter`): Grenzen und Pruefung. Themen und Woerter kommen nur aus dem Pack, nie aus dem Repo (Entscheidung 100).
export const WORT_MAX_LAENGE = 14;
export const WORT_MUSTER = /^[A-Z0-9 '’!]{1,14}$/; // Apostroph gerade oder typografisch (’), wie in Mias Saetzen
export const THEMA_MIN_WOERTER = 5;
export const THEMA_MAX_WOERTER = 60;
export const MAX_THEMEN = 12;
export const THEMA_ID_MUSTER = /^[a-z0-9-]{1,24}$/;
export const THEMA_TITEL_MAX = 30;
// Fest eingebautes Wort ohne Pack (und bei leerer Themenwahl).
export const STANDARD_WORT = 'MIA';

export interface WortThema {
  id: string;
  titel: string;
  woerter: string[];
}
export interface WoerterDatei {
  themen: WortThema[];
}

// Prueft eine rohe Woerter-Datei. Ungueltige Woerter und Themen fallen weg (nie die ganze Datei, ausser nichts bleibt uebrig):
// Wort gueltig nach WORT_MUSTER, Thema mit 5 bis 60 Woertern (Doppelte zaehlen einmal, mehr als 60 werden abgeschnitten), hoechstens 12 Themen,
// Themen-Kennungen eindeutig. null, wenn kein gueltiges Thema bleibt.
export function pruefeWoerter(roh: unknown): WoerterDatei | null {
  if (!roh || typeof roh !== 'object') return null;
  const themenRoh = (roh as { themen?: unknown }).themen;
  if (!Array.isArray(themenRoh)) return null;
  const themen: WortThema[] = [];
  const gesehen = new Set<string>();
  for (const t of themenRoh) {
    if (themen.length >= MAX_THEMEN) break;
    if (!t || typeof t !== 'object') continue;
    const { id, titel, woerter } = t as { id?: unknown; titel?: unknown; woerter?: unknown };
    if (typeof id !== 'string' || !THEMA_ID_MUSTER.test(id) || gesehen.has(id)) continue;
    if (typeof titel !== 'string' || titel.trim().length === 0 || [...titel].length > THEMA_TITEL_MAX) continue;
    if (!Array.isArray(woerter)) continue;
    // Erst trimmen, dann pruefen, dann Doppelte entfernen ("MIA" und " MIA " sind dasselbe Wort).
    const gut = [...new Set(woerter.filter((w): w is string => typeof w === 'string').map((w) => w.trim()).filter((w) => w.length > 0 && WORT_MUSTER.test(w)))].slice(0, THEMA_MAX_WOERTER);
    if (gut.length < THEMA_MIN_WOERTER) continue;
    gesehen.add(id);
    themen.push({ id, titel: titel.trim(), woerter: gut });
  }
  return themen.length > 0 ? { themen } : null;
}

// FNV-1a, wie src/pack/hash.ts (hier noch einmal, damit diese Datei ohne Laufzeit-Importe bleibt).
export function hashe(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Wort fuer eine Flaeche: stabil je Schluessel (Bild plus Flaeche), wechselnd ueber Bilder. `themenWahl`: null = alle Themen der Datei,
// Liste = nur diese (unbekannte Kennungen zaehlen nicht), leer oder nichts Passendes = STANDARD_WORT. Ohne Datei ebenfalls STANDARD_WORT.
export function waehleWort(schluessel: string, datei: WoerterDatei | null, themenWahl: readonly string[] | null): string {
  if (!datei) return STANDARD_WORT;
  if (themenWahl !== null && themenWahl.length === 0) return STANDARD_WORT;
  const themen = themenWahl === null ? datei.themen : datei.themen.filter((t) => themenWahl.includes(t.id));
  const alle = themen.flatMap((t) => t.woerter);
  if (alle.length === 0) return STANDARD_WORT;
  return alle[hashe(schluessel) % alle.length]!;
}

// Wort-Flaechen: unter dieser Groesse in Anzeigepixeln (kleinere Seite zaehlt je Richtung) bekommt eine Flaeche kein Wort, sondern die
// Behandlung ohne Wort (Plan: unter etwa 48 px Hoehe oder 64 px Breite).
export const WORT_MIN_HOEHE = 48;
export const WORT_MIN_BREITE = 64;
export function wortPasst(breite: number, hoehe: number, anzeigeSkala = 1): boolean {
  const s = Number.isFinite(anzeigeSkala) && anzeigeSkala > 0 ? anzeigeSkala : 1;
  return hoehe * s >= WORT_MIN_HOEHE && breite * s >= WORT_MIN_BREITE;
}
// Ohne Wort: Mosaik-Wort wird Mosaik, Schwarz-Wort wird Schwarz.
export function ohneWort(b: Behandlung): Behandlung {
  return b === 'mosaik-wort' ? 'mosaik' : b === 'schwarz-wort' ? 'schwarz' : b;
}
export const hatWort = (b: Behandlung): boolean => b === 'mosaik-wort' || b === 'schwarz-wort';

// Mias Gesicht: Ausschnitt um das gefundene Gesicht eines Patch-Bildes. Rand 25 % der Gesichtsbox je Seite, danach auf das Seitenverhaeltnis
// 3:4 (Breite zu Hoehe) gebracht (zuerst die Breite erweitern, sonst die Hoehe), auf das Bild begrenzt (dabei kann das Verhaeltnis kleiner
// werden, dann bleibt es, wie es ist). Kommazahlen; [x, y, w, h].
export const GESICHT_RAND = 0.25;
export const GESICHT_VERHAELTNIS = 3 / 4;
export function gesichtsAusschnitt(gesicht: readonly [number, number, number, number], bildB: number, bildH: number): [number, number, number, number] {
  const [gx, gy, gw, gh] = gesicht;
  const cx = gx + gw / 2;
  const cy = gy + gh / 2;
  let w = gw * (1 + 2 * GESICHT_RAND);
  let h = gh * (1 + 2 * GESICHT_RAND);
  if (w / h < GESICHT_VERHAELTNIS) w = h * GESICHT_VERHAELTNIS;
  else h = w / GESICHT_VERHAELTNIS;
  // auf das Bild begrenzen: erst die Groesse (Verhaeltnis halten), dann die Lage
  const f = Math.min(1, bildB / w, bildH / h);
  w *= f;
  h *= f;
  const x = Math.min(Math.max(0, cx - w / 2), bildB - w);
  const y = Math.min(Math.max(0, cy - h / 2), bildH - h);
  return [x, y, w, h];
}

// Personen-Gruppen (Presets "Ganze Person"): Boxen [x, y, w, h] werden um NACHBAR_ANTEIL ihrer laengeren Seite erweitert; ueberlappen
// erweiterte Boxen, gehoeren sie zu einer Gruppe (Union-Find, transitiv). Je Gruppe: Huelle der urspruenglichen Boxen plus PERSON_RAND
// der laengeren Huellenseite, auf das Bild begrenzt. `zaehlt[i]`: die Box i gehoert zu einer eingeschalteten Zone; nur Gruppen mit
// mindestens einer solchen Box kommen heraus. Bei Unsicherheit eher groesser (die Zahlen sind grosszuegig).
export const NACHBAR_ANTEIL = 0.15;
export const PERSON_RAND = 0.08;
export function personenGruppen(
  boxen: readonly (readonly [number, number, number, number])[],
  zaehlt: readonly boolean[],
  breite: number,
  hoehe: number,
  // Rand um die Huelle als Anteil der laengeren Huellenseite. Die Videozensur fasst schon fertige Huellen (mit Rand) je Bild neu zusammen und nimmt 0.
  personRand = PERSON_RAND,
): [number, number, number, number][] {
  const n = boxen.length;
  const eltern = boxen.map((_, i) => i);
  const wurzel = (i: number): number => {
    while (eltern[i] !== i) {
      eltern[i] = eltern[eltern[i]!]!;
      i = eltern[i]!;
    }
    return i;
  };
  const gross = boxen.map(([x, y, w, h]) => {
    const d = NACHBAR_ANTEIL * Math.max(w, h);
    return [x - d, y - d, x + w + d, y + h + d] as const;
  });
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = gross[i]!;
      const b = gross[j]!;
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) eltern[wurzel(i)] = wurzel(j);
    }
  }
  const gruppen = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const w = wurzel(i);
    gruppen.set(w, [...(gruppen.get(w) ?? []), i]);
  }
  const aus: [number, number, number, number][] = [];
  for (const mitglieder of gruppen.values()) {
    if (!mitglieder.some((i) => zaehlt[i])) continue;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const i of mitglieder) {
      const [x, y, w, h] = boxen[i]!;
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x + w);
      y2 = Math.max(y2, y + h);
    }
    const d = personRand * Math.max(x2 - x1, y2 - y1);
    const bx1 = Math.max(0, Math.floor(x1 - d));
    const by1 = Math.max(0, Math.floor(y1 - d));
    const bx2 = Math.min(breite, Math.ceil(x2 + d));
    const by2 = Math.min(hoehe, Math.ceil(y2 + d));
    aus.push([bx1, by1, Math.max(1, bx2 - bx1), Math.max(1, by2 - by1)]);
  }
  return aus;
}
