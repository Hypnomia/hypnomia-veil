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
  'person-mosaik',
  'person-blur',
] as const;
export type Preset = (typeof PRESET_IDS)[number];

// Custom-Baukasten (Phase 11 E6a): ein dreizehnter Stil daneben, den der Nutzer aus Bausteinen mischt. Er steht NICHT im Katalog der zwoelf Karten
// (`PRESET_IDS`, `presetKatalog`), sondern ist eine eigene Kennung. Im Speicher steht `preset: 'custom'` plus `custom: { gesicht, flaeche, woerter }`.
//   PresetKennung  was im Speicher stehen darf (`Einstellungen.preset`)
//   CustomKennung  die abgeleitete Kennung EINER Mischung, `custom:<gesicht>:<flaeche>:<w|->`: jede der 40 Mischungen hat genau eine, so teilen zwei
//                  Mischungen nie ein gemerktes Objekt (E6a C8). Sie lebt nur im Programm (Definition, Videospur, Schluessel), nie im Speicher.
//   WirkKennung    die Kennung einer aufgeloesten Definition (`PresetDef.id`): ein Preset der Tabelle oder die Kennung einer Mischung
export const CUSTOM_ID = 'custom' as const;
export type PresetKennung = Preset | typeof CUSTOM_ID;
export type CustomKennung = `custom:${string}`;
export type WirkKennung = Preset | CustomKennung;
export type AnyKennung = PresetKennung | CustomKennung;

export const CUSTOM_GESICHT = ['mia', 'sticker', 'mosaik', 'blur', 'schwarz'] as const;
export const CUSTOM_FLAECHE = ['schwarz', 'mosaik', 'blur', 'sticker'] as const;
export type CustomGesicht = (typeof CUSTOM_GESICHT)[number];
export type CustomFlaeche = (typeof CUSTOM_FLAECHE)[number];
export interface CustomMischung {
  gesicht: CustomGesicht;
  flaeche: CustomFlaeche;
  woerter: boolean;
}
// Standard und Rueckfall jeder ungueltigen Mischung: alles Mosaik, ohne Woerter.
// Name und Satz des Stils Custom (E6b B10, B11): ueberall, wo der Name des Stils steht, stehen diese beiden.
export const CUSTOM_NAME = 'Custom';
export const CUSTOM_SATZ = 'You pick the face, the rest and the words. I do it your way.';
export const CUSTOM_STANDARD: Readonly<CustomMischung> = Object.freeze({ gesicht: 'mosaik', flaeche: 'mosaik', woerter: false });

export type PresetGruppe = 'mia' | 'sticker' | 'klassisch' | 'person';

// Wie die Augen behandelt werden:
//   'wie-koerper'    wie jede andere Zone (laut Schalter), in den Mia-Presets liegen sie im getauschten Gesicht (dann nichts zusaetzlich)
//   'balken-immer'   Augenbalken ueber jedem erkannten Gesicht, unabhaengig vom Zonen-Schalter `eyes` (Zensurbalken, und jeder Stil mit dem Schalter
//                    "Eye bar": den Schalter verrechnet `presetDef` in src/preset-def.ts, kein Aufrufer rechnet ihn selbst)
export type AugenArt = 'wie-koerper' | 'balken-immer';

export interface PresetDef {
  id: WirkKennung;
  gruppe: PresetGruppe | 'custom';
  // Behandlung der Zone Face (nur wenn der Schalter an ist).
  gesicht: Behandlung | null;
  // Behandlung aller anderen Zonen (laut Schaltern).
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
  // Nur bei Custom: die Mischung, aus der diese Definition entstand (eingefroren). Bei den zwoelf Presets fehlt sie.
  mischung?: Readonly<CustomMischung>;
}

export const PRESETS: Readonly<Record<Preset, PresetDef>> = {
  'mia-wort': { id: 'mia-wort', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'schwarz-wort', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: true, name: 'My face, black, words', satz: 'With Face on, every face becomes mine. The rest turns black, with a pink word of mine.' },
  'mia-mosaik': { id: 'mia-mosaik', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'mosaik', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: false, name: 'My face, mosaic', satz: 'With Face on, every face becomes mine. The rest gets mosaic.' },
  'mia-mosaik-wort': { id: 'mia-mosaik-wort', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'mosaik-wort', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: true, name: 'My face, mosaic, words', satz: 'With Face on, every face becomes mine. The rest gets mosaic, with a word of mine on top.' },
  'mia-blur': { id: 'mia-blur', gruppe: 'mia', gesicht: 'mia-gesicht', koerper: 'blur', augen: 'wie-koerper', person: false, braucht: 'pack', woerter: false, name: 'My face, blur', satz: 'With Face on, every face becomes mine. The rest gets blurred.' },
  'mia-sticker': { id: 'mia-sticker', gruppe: 'sticker', gesicht: 'mia-gesicht', koerper: 'sticker', augen: 'wie-koerper', person: false, braucht: 'sticker', woerter: false, name: 'My face, stickers', satz: 'With Face on, every face becomes mine. The rest gets a pastel patch and a little me.' },
  sticker: { id: 'sticker', gruppe: 'sticker', gesicht: 'sticker', koerper: 'sticker', augen: 'wie-koerper', person: false, braucht: 'sticker', woerter: false, name: 'Stickers', satz: 'A pastel patch over everything I cover, with a little me on top.' },
  mosaik: { id: 'mosaik', gruppe: 'klassisch', gesicht: 'mosaik', koerper: 'mosaik', augen: 'wie-koerper', person: false, braucht: null, woerter: false, name: 'Mosaic', satz: 'Pixels over everything I cover.' },
  'mosaik-wort': { id: 'mosaik-wort', gruppe: 'klassisch', gesicht: 'mosaik-wort', koerper: 'mosaik-wort', augen: 'wie-koerper', person: false, braucht: null, woerter: true, name: 'Mosaic and words', satz: 'Pixels over everything I cover, with a word of mine on top.' },
  blur: { id: 'blur', gruppe: 'klassisch', gesicht: 'blur', koerper: 'blur', augen: 'wie-koerper', person: false, braucht: null, woerter: false, name: 'Blur', satz: 'A soft blur over everything I cover.' },
  zensurbalken: { id: 'zensurbalken', gruppe: 'klassisch', gesicht: 'schwarz', koerper: 'schwarz', augen: 'balken-immer', person: false, braucht: null, woerter: false, name: 'Censor bars', satz: 'A black bar over the eyes, always. Everything else I cover turns black.' },
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
export const PERSON_GRENZE = 'I build the person from parts I spot, so edges can be off. I add a margin around them.';

export function istPreset(x: unknown): x is Preset {
  return typeof x === 'string' && (PRESET_IDS as readonly string[]).includes(x);
}

// DIE Nachschlage-Funktion der Tabelle (Phase 11 E4b, Sicherheitsregel S3: im Zweifel Mosaik): eine fehlende oder unbekannte Kennung (auch
// Prototyp-Namen wie `constructor`, `__proto__`, `toString`) liefert die Definition von Mosaik. Jede Stelle, die die Tabelle liest, geht hierueber.
// Custom (E6a): die Kennung einer Mischung (`custom:...`, streng geprueft) liefert die Definition dieser Mischung; die blosse Kennung `custom` kennt keine
// Mischung und gilt wie jede unbekannte als Mosaik (E6a C4, C7). Aus den Einstellungen macht `wirkKennungVon` die Kennung.
export function presetOderMosaik(kennung: unknown): PresetDef {
  if (typeof kennung !== 'string') return PRESETS[STANDARD_PRESET];
  if (Object.hasOwn(PRESETS, kennung)) return PRESETS[kennung as Preset];
  const m = mischungAusKennung(kennung);
  return m ? customDef(m) : PRESETS[STANDARD_PRESET];
}

// ---------- Custom-Baukasten (E6a) ----------
// Die Behandlung eines Bausteins; `woerter` macht aus Mosaik und Schwarz die Variante mit Wort (alle anderen koennen kein Wort tragen).
function behandlungFuerBaustein(b: CustomGesicht | CustomFlaeche, woerter: boolean): Behandlung {
  switch (b) {
    case 'mia':
      return 'mia-gesicht';
    case 'sticker':
      return 'sticker';
    case 'blur':
      return 'blur';
    case 'mosaik':
      return woerter ? 'mosaik-wort' : 'mosaik';
    case 'schwarz':
      return woerter ? 'schwarz-wort' : 'schwarz';
  }
}

const istObjektArt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x) && Object.prototype.toString.call(x) === '[object Object]';

// Prueft eine rohe Mischung streng (E6a C4): ein einfaches Objekt mit den drei EIGENEN Feldern, `gesicht` und `flaeche` aus ihren Listen, `woerter` ein Boolean.
// Ein einziges ungueltiges Feld macht die ganze Mischung ungueltig (null), es wird nie teilweise repariert. Fremde Zusatzfelder zaehlen nicht und werden nicht uebernommen.
// Liefert eine neue, eingefrorene Kopie mit genau den drei Feldern.
export function pruefeCustom(roh: unknown): Readonly<CustomMischung> | null {
  if (!istObjektArt(roh)) return null;
  if (!Object.hasOwn(roh, 'gesicht') || !Object.hasOwn(roh, 'flaeche') || !Object.hasOwn(roh, 'woerter')) return null;
  const { gesicht, flaeche, woerter } = roh as { gesicht: unknown; flaeche: unknown; woerter: unknown };
  if (typeof gesicht !== 'string' || !(CUSTOM_GESICHT as readonly string[]).includes(gesicht)) return null;
  if (typeof flaeche !== 'string' || !(CUSTOM_FLAECHE as readonly string[]).includes(flaeche)) return null;
  if (typeof woerter !== 'boolean') return null;
  return Object.freeze({ gesicht: gesicht as CustomGesicht, flaeche: flaeche as CustomFlaeche, woerter });
}

// Die Kennung einer (gueltigen) Mischung.
export const customKennung = (m: Readonly<CustomMischung>): CustomKennung => `custom:${m.gesicht}:${m.flaeche}:${m.woerter ? 'w' : '-'}`;

// Die Mischung zu einer Kennung `custom:...`; alles andere (auch die blosse `custom`) null.
export function mischungAusKennung(kennung: unknown): Readonly<CustomMischung> | null {
  if (typeof kennung !== 'string') return null;
  const t = /^custom:([a-z]+):([a-z]+):(w|-)$/.exec(kennung);
  return t ? pruefeCustom({ gesicht: t[1], flaeche: t[2], woerter: t[3] === 'w' }) : null;
}

const CUSTOM_DEFS = new Map<string, PresetDef>();

// Die Definition einer Mischung (E6a C2, C3): dasselbe eingefrorene Objekt bei jedem Aufruf, je Mischung genau eines. `gesicht` und `koerper` sind nie null (Regel S3):
// jeder Baustein ist eine deckende Behandlung. `augen: 'wie-koerper'`, `person: false`. `braucht`: 'sticker', wenn ein Baustein Sticker nutzt, sonst 'pack', wenn Mias
// Gesicht dabei ist, sonst null. Woerter wirken auf Gesicht und Flaeche gleich, wo die Behandlung ein Wort tragen kann.
export function customDef(mischung: Readonly<CustomMischung>): PresetDef {
  const m = pruefeCustom(mischung) ?? CUSTOM_STANDARD;
  const id = customKennung(m);
  let d = CUSTOM_DEFS.get(id);
  if (!d) {
    const gesicht = behandlungFuerBaustein(m.gesicht, m.woerter);
    const koerper = behandlungFuerBaustein(m.flaeche, m.woerter);
    d = Object.freeze({
      id,
      gruppe: 'custom' as const,
      gesicht,
      koerper,
      augen: 'wie-koerper' as const,
      person: false,
      braucht: gesicht === 'sticker' || koerper === 'sticker' ? ('sticker' as const) : gesicht === 'mia-gesicht' ? ('pack' as const) : null,
      woerter: hatWort(gesicht) || hatWort(koerper),
      name: CUSTOM_NAME,
      satz: CUSTOM_SATZ,
      mischung: Object.freeze({ ...m }),
    });
    CUSTOM_DEFS.set(id, d);
  }
  return d;
}

// Die Mischung, die mit diesem Pack wirklich gilt (E6a C5), bausteinweise: Mias Gesicht ohne Freischaltung `stil:mia-patch` wird Mosaik, Sticker (am Gesicht oder an
// der Flaeche) ohne `zensur:sticker` wird Mosaik; `woerter` bleibt, der ersetzte Baustein traegt dann das Wort wie jedes Mosaik.
export function mischungFuerPack(m: Readonly<CustomMischung>, mitMiaPack: boolean, mitSticker: boolean): Readonly<CustomMischung> {
  const gesicht: CustomGesicht = (m.gesicht === 'mia' && !mitMiaPack) || (m.gesicht === 'sticker' && !mitSticker) ? 'mosaik' : m.gesicht;
  const flaeche: CustomFlaeche = m.flaeche === 'sticker' && !mitSticker ? 'mosaik' : m.flaeche;
  return gesicht === m.gesicht && flaeche === m.flaeche ? m : Object.freeze({ gesicht, flaeche, woerter: m.woerter });
}

// Die Kennung der Definition, die zu gespeicherten Einstellungen gehoert (`gewaehlt`, ohne Pack): `preset: 'custom'` mit gueltiger Mischung ist die Kennung dieser
// Mischung, ohne gueltige Mischung Mosaik (E6a C4); jede andere Kennung die der Tabelle, unbekannt Mosaik. Nimmt auch die Kennung einer Mischung.
export function wirkKennungVon(e: { preset?: unknown; custom?: unknown }): WirkKennung {
  if (e.preset === CUSTOM_ID) {
    const m = pruefeCustom(e.custom);
    return m ? customKennung(m) : STANDARD_PRESET;
  }
  return presetOderMosaik(e.preset).id;
}

// Das, was bei Einstellungen und Nachrichten fuer eine aufgeloeste Definition steht: bei einer Mischung `preset: 'custom'` mit der Mischung, sonst die Kennung.
// So reist die aufgeloeste (nach dem Pack ersetzte) Mischung mit (E6a C7), und der Empfaenger prueft sie nach C4.
export function wahlAusDef(d: PresetDef): { preset: PresetKennung; custom?: CustomMischung } {
  return d.mischung ? { preset: CUSTOM_ID, custom: { ...d.mischung } } : { preset: d.id as Preset };
}

export function istPresetKennung(x: unknown): x is PresetKennung {
  return x === CUSTOM_ID || istPreset(x);
}

// Migration: der alte Wert `stil` wird zum Preset. Unbekannt: null. (`augenbalken` ist seit Phase 11 E4c kein Stil mehr, sondern der Schalter
// `Einstellungen.augenbalken`; die Wanderung steht in `vervollstaendige`, src/einstellungen.ts, und greift vor dieser Funktion.)
export function presetAusStil(stil: unknown): Preset | null {
  switch (stil) {
    case 'mosaik':
      return 'mosaik';
    case 'blur':
      return 'blur';
    case 'mia-patch':
      return 'mia-wort';
    default:
      return null;
  }
}

// Das Preset, das wirklich gilt: Mia-Presets nur mit Pack (Freischaltung `stil:mia-patch`), Sticker-Presets nur mit Stickern im Pack
// (`zensur:sticker`), sonst Mosaik. `mitSticker` fehlt = keine Sticker (sicherer Standard). Eine Mischung (Custom) wird bausteinweise ersetzt
// (`mischungFuerPack`) und liefert die Kennung der ersetzten Mischung.
export function presetFuerPack(preset: AnyKennung, mitMiaPack: boolean, mitSticker = false): WirkKennung {
  const d = presetOderMosaik(preset);
  if (d.mischung) return customKennung(mischungFuerPack(d.mischung, mitMiaPack, mitSticker));
  return !packGenuegt(d.braucht, mitMiaPack, mitSticker) ? OHNE_PACK_PRESET : (d.id as Preset);
}

// Reicht das Pack fuer die Anforderung eines Presets (`braucht`)?
export function packGenuegt(braucht: PresetDef['braucht'], mitMiaPack: boolean, mitSticker: boolean): boolean {
  return braucht === null || (braucht === 'pack' ? mitMiaPack : mitSticker);
}

// Nutzt dieses Preset Sticker (Flaechen mit der Behandlung `sticker`, auch als Ersatz fuer Mias Gesicht)?
export const nutztSticker = (preset: AnyKennung): boolean => presetOderMosaik(preset).gesicht === 'sticker' || presetOderMosaik(preset).koerper === 'sticker';

// Zeichnet dieses Preset Mias Gesicht?
export const nutztMiasGesicht = (preset: AnyKennung): boolean => presetOderMosaik(preset).gesicht === 'mia-gesicht';

// Behandlung fuer ein ganz verdecktes Bild (Steigerung Stufe 4, bewegtes SVG): die Behandlung der Koerper-Zonen, ersatzweise Mosaik.
// Mias Gesicht, der Augenbalken und der Sticker passen nicht auf ein ganzes Bild (STICKER-BAUPLAN Entscheidung 6: dort bleibt es Mosaik).
export function ganzesBildBehandlung(preset: AnyKennung): Behandlung {
  const k = presetOderMosaik(preset).koerper;
  return k === null || k === 'mia-gesicht' || k === 'balken' || k === 'sticker' ? 'mosaik' : k;
}

// Behandlung einer Flaeche der Zone `zone` im Preset, aus der Tabelle (die Videozensur nimmt sie, wenn eine Flaeche keine eigene Behandlung traegt;
// der Erkenner setzt `behandlung` nach derselben Regel, siehe berechneFlaechen in src/erkenner/zonen.ts): Zensurbalken auf den Augen Balken, Gesicht
// nach `gesicht`, alles andere nach `koerper`. Ohne Eintrag (Gesicht oder Koerper null) Mosaik, nie "nichts".
export function behandlungFuerZone(preset: AnyKennung, zone: string): Behandlung {
  const d = presetOderMosaik(preset);
  if (zone === 'eyes' && d.augen === 'balken-immer') return 'balken';
  return (zone === 'face' ? d.gesicht : d.koerper) ?? 'mosaik';
}

// Hat der STIL selbst den Augenbalken (Zensurbalken, Tabelle von Anfang an)? Dann ersetzt der Balken die Augenflaeche dieses Stils (Phase 11 E1, unveraendert).
// Der Schalter Eye bar (E4c) taucht hier nicht auf: er kommt nur dazu (R11), die Augenflaeche des Stils bleibt, der Balken liegt darueber.
export const stilHatBalken = (d: PresetDef): boolean => d.augen === 'balken-immer' && presetOderMosaik(d.id).augen === 'balken-immer';

// Zonen, die eine Definition wirklich auswertet (statt der Schalter): hat der Stil den Balken (Zensurbalken), kommen die Augen zu den Schaltern dazu. Mit dem Schalter
// Eye bar bleiben die Schalter, wie der Nutzer sie hat (R11: der Schalter nimmt nie etwas weg und fuegt keine Augenflaeche hinzu). Sonst dasselbe Objekt.
// Gegeben wird die aufgeloeste Definition (`presetDef(e).gewaehlt`) oder eine Kennung (dann ohne Schalter).
export function zonenFuerPreset<T extends { an: boolean; bedeckt?: boolean }>(preset: AnyKennung | PresetDef | undefined, zonen: Record<string, T>): Record<string, T> {
  if (!preset) return zonen;
  const d = typeof preset === 'string' ? presetOderMosaik(preset) : preset;
  if (stilHatBalken(d)) return { ...zonen, eyes: { ...zonen.eyes!, an: true } };
  return zonen;
}

// Zonen fuer die GESICHTSSUCHE: bei jedem Stil mit Balken, auch mit dem Schalter, laufen die Augen mit (YuNet muss laufen, damit der Balken entsteht),
// ohne dass daraus eine Augenflaeche wird. Nur der Erkenner ruft sie, fuer die Suche und sonst nirgends.
export function zonenFuerSuche<T extends { an: boolean; bedeckt?: boolean }>(d: PresetDef, zonen: Record<string, T>): Record<string, T> {
  return d.augen === 'balken-immer' ? { ...zonen, eyes: { ...zonen.eyes!, an: true } } : zonen;
}

// Malreihenfolge (E4c R12, Bild und Video gleich): erst die Behandlung der Zonen (auch der Ersatz fuer ein Mia-Gesicht, das nicht gemalt werden kann), dann die Augenbalken,
// zuletzt Mias Gesicht. Ein deckendes Mia-Gesicht liegt so ueber dem Balken (kein Balken ueber Mias Gesicht, R5); ein nicht gemaltes, gescheitertes oder durchscheinendes
// laesst den Balken sehen, nie die Augen. `gesichtMoeglich`: Mias Gesicht kann gemalt werden (Patch da und passt). Scheitert das Malen doch noch (`male(i, 'gesicht')` gibt
// false), wird der Ersatz gemalt und danach alle Balken noch einmal (Schicht `balken`, `wiederholung` true), damit der Balken oben liegt.
export type Schicht = 'zone' | 'balken' | 'gesicht';
export interface MalEintrag {
  behandlung: Behandlung;
  gesichtMoeglich: boolean;
}
export function malLauf(eintraege: readonly MalEintrag[], male: (index: number, schicht: Schicht, wiederholung: boolean) => boolean): void {
  const gesichter: number[] = [];
  const balken: number[] = [];
  eintraege.forEach((e, i) => {
    if (e.behandlung === 'balken') balken.push(i);
    else if (e.behandlung === 'mia-gesicht' && e.gesichtMoeglich) gesichter.push(i);
    else male(i, 'zone', false);
  });
  for (const i of balken) male(i, 'balken', false);
  let gescheitert = false;
  for (const i of gesichter) if (!male(i, 'gesicht', false)) gescheitert = true;
  if (gescheitert) for (const i of balken) male(i, 'balken', true);
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

// Regel O2 (Phase 11): je sichtbar zusammenhaengender Flaeche hoechstens ein Wort oder Sticker. Faellt eine aufgelegte Gesichtsflaeche auf ihre Ersatz-
// behandlung zurueck (kein passender Patch) und die Ersatzbehandlung traegt ein Wort oder einen Sticker, schneidet sie aber eine Flaeche, die schon
// eine Marke (Wort oder Sticker) traegt, dann entfaellt ihre Marke: Variante ohne Wort bzw. Sticker-Flaeche ohne Sticker. Die Deckung bleibt voll,
// nur die Marke entfaellt. Steht sie allein, behaelt sie ihre Marke. `markierte`: die Boxen der Flaechen, die in diesem Bild schon eine Marke tragen.
export type BoxLike = readonly [number, number, number, number];
const schneidetBox = (a: BoxLike, b: BoxLike): boolean => Math.min(a[0] + a[2], b[0] + b[2]) > Math.max(a[0], b[0]) && Math.min(a[1] + a[3], b[1] + b[3]) > Math.max(a[1], b[1]);
export const traegtMarkeArt = (b: Behandlung): boolean => hatWort(b) || b === 'sticker';
export function ersatzMitMarke(b: Behandlung, box: BoxLike, markierte: readonly BoxLike[]): { behandlung: Behandlung; ohneSticker: boolean } {
  if (!traegtMarkeArt(b) || !markierte.some((m) => schneidetBox(m, box))) return { behandlung: b, ohneSticker: false };
  return { behandlung: ohneWort(b), ohneSticker: b === 'sticker' };
}

// Staerke einer Behandlung beim Verschmelzen von Flaechen (Phase 11, S1): Schwarz (mit oder ohne Wort, auch der Augenbalken) vor Sticker vor
// Mosaik (mit oder ohne Wort) vor Weichzeichner. Mias Gesicht wird nie verschmolzen; sicherheitshalber zaehlt es wie Mosaik.
const RANG: Readonly<Record<Behandlung, number>> = { blur: 0, mosaik: 1, 'mosaik-wort': 1, 'mia-gesicht': 1, sticker: 2, schwarz: 3, 'schwarz-wort': 3, balken: 3 };
export const behandlungsRang = (b: Behandlung): number => RANG[b];
// Die staerkste Behandlung einer Liste; das Wort bleibt, wenn eine der staerksten Flaechen eines traegt. Eine Flaeche ohne Behandlung gilt als
// `standard` (im Zeichner ist das die Behandlung des Presets fuer ein ganzes Bild); sie wird nie uebergangen.
export function staerksteBehandlung(liste: readonly (Behandlung | undefined)[], standard: Behandlung): Behandlung {
  const da = liste.map((b) => b ?? standard);
  const top = Math.max(...da.map(behandlungsRang));
  const gleich = da.filter((b) => behandlungsRang(b) === top);
  return gleich.find(hatWort) ?? gleich[0] ?? standard;
}

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
