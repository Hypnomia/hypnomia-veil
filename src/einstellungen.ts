// Einstellungen der Erweiterung (PHASE-2-BAUPLAN Abschnitt 3). Ablage: storage.local, Schluessel `einstellungen`.
// Fehlende Felder werden beim Laden mit Standardwerten aufgefuellt, damit aeltere Staende weiterlaufen.

export const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'] as const;
export type Zone = (typeof ZONEN)[number];

// Zonen, bei denen "auch bedeckt" Sinn ergibt (das Modell kennt dort bedeckte Varianten).
export const BEDECKBARE_ZONEN: ReadonlySet<Zone> = new Set<Zone>(['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits']);

// Zensur-Preset (ZENSUR-PRESETS-BAUPLAN, ersetzt die frueheree Stil-Wahl): Tabelle und Logik in src/presets.ts. Mia-Presets gelten nur mit
// Pack (presetFuerPack), sonst zeichnet der Erkenner Mosaik. Alte gespeicherte `stil`-Werte werden beim Laden zu Presets (presetAusStil).
import { nutztMiasGesicht, STANDARD_PRESET, THEMA_ID_MUSTER, MAX_THEMEN, istPreset, presetAusStil, zonenFuerPreset as zonenFuerPresetAllgemein, type Preset } from './presets.ts';
export { PRESET_IDS, type Preset } from './presets.ts';

// Videos (Bauplan Video-Zonen): 'zonen' = laufende Videos werden nur an den erkannten Stellen verdeckt (Leinwand-Wiedergabe, Stil wie bei Bildern),
// 'ganz' = das ganze Video unscharf wie bisher. Standard 'zonen'; ist ein Video nicht dafuer geeignet, gilt fuer dieses Video 'ganz'.
export type VideoModus = 'zonen' | 'ganz';
export const VIDEO_MODI: readonly VideoModus[] = ['zonen', 'ganz'];

export interface ZonenEinstellung {
  an: boolean;
  bedeckt?: boolean;
}

export interface Einstellungen {
  version: 1;
  pause: boolean;
  strict: boolean;
  schwelle: number;
  preset: Preset;
  // Wort-Themen der Presets mit Woertern (Kennungen aus dem Pack). null: alle Themen des Packs (Standard), []: keins, dann steht "MIA" da.
  woerterThemen: string[] | null;
  video: VideoModus;
  rand: number;
  zonen: Record<Zone, ZonenEinstellung>;
  ausnahmen: string[];
  // Ruhig-Modus (Blitz-Grenzen, CLAUDE.md Regel 9): keine laufenden Woerter, langsamere Spirale. `prefers-reduced-motion` wirkt zusaetzlich.
  ruhig: boolean;
  // Phase 4 (PHASE-4-BAUPLAN Abschnitt 2): wirkt nur mit Pack und der passenden Freischaltung.
  erwachsen: ErwachsenEinstellung;
  quiz: QuizEinstellung;
  // Phase 5 (PHASE-5-AUFTRAEGE-SESSION-9.md): Kontrolle, wirkt nur mit Pack und der passenden Freischaltung `kontrolle:*`.
  kontrolle: KontrolleEinstellung;
  // Phase 6 (PHASE-6-AUFTRAEGE-SESSION-11.md, Auftrag T): Ton nur fuer Quiz und Blitzwoerter, wirkt nur mit Pack und Freischaltung `ton`.
  ton: TonEinstellung;
}

// Ton (Entscheidung 19): Standard AUS, Lautstaerke 0 bis 1 (Regler 0 bis 100 in der Oberflaeche).
export interface TonEinstellung {
  an: boolean;
  lautstaerke: number;
}
export const TON_LAUTSTAERKE_STANDARD = 0.6;

// Haeufigkeit der Blitzwoerter (Entscheidung 116): aus, selten (etwa alle 10 Minuten), oft (etwa alle 3 Minuten).
export const BLITZ_HAEUFIGKEITEN = ['aus', 'selten', 'oft'] as const;
export type BlitzHaeufigkeit = (typeof BLITZ_HAEUFIGKEITEN)[number];

export interface KontrolleEinstellung {
  werbung: boolean; // Werbe-Tausch (Auftrag W); seit 0.9.0 Standard AUS (Entscheidung 179, Mozillas Opt-in-Regel)
  // Mia hat einmal "Show my ads?" gefragt und die Person hat geantwortet (oder den Schalter selbst bedient). Bis dahin zeigt die
  // Einstellungsseite die Frage, sobald das Pack den Werbe-Tausch freischaltet.
  werbungGefragt: boolean;
  // Hosts, auf denen Mias Werbung ausbleibt ("Hide my ads on this site", Session 17 Fund 13); gleiche Schreibweise wie `ausnahmen`.
  werbungAus: string[];
  blitz: BlitzHaeufigkeit; // Blitzwoerter (Auftrag B), Standard selten
  leerlauf: boolean; // Leerlauf-Spirale (Auftrag L), Standard an
  leerlaufMinuten: number; // Minuten ohne Eingabe bis zur Spirale (Inhaberin 04.11.2026: 2), ganzzahlig
  // Session 10 (PHASE-5-AUFTRAEGE-SESSION-10.md):
  tabtitel: boolean; // Tab-Titel im Hintergrund wird Mias Satz (Auftrag K1), Standard an
  cursor: CursorArt; // Mauszeiger (Auftrag K2), Standard kleine pinke Spirale
  meldungen: boolean; // kleine Meldungen mit Mini-Chibi (Auftrag M), Standard an
  besuche: boolean; // Pflicht-Besuche: Mia oeffnet selbst einen Tab (Auftrag Z2), Standard AUS (Entscheidung 125)
  zeiten: StrengeZeit[]; // strenge Zeiten (Auftrag Z1), ab Werk keine (Entscheidung 118)
}

// Mauszeiger mit Pack (Entscheidung 116): kleine pinke Spirale (Standard), pinkes Herz, aus.
export const CURSOR_ARTEN = ['spirale', 'herz', 'aus'] as const;
export type CursorArt = (typeof CURSOR_ARTEN)[number];

// Ein Zeitfenster, in dem Mia strenger ist. `tage`: Wochentage wie Date.getDay() (0 Sonntag bis 6 Samstag), mindestens einer. `von`, `bis`:
// Minuten seit Mitternacht (0 bis 1439), Ortszeit. `bis` kleiner als `von` heisst ueber Mitternacht (der Tag zaehlt fuer den Beginn).
// `von` gleich `bis` gilt als ganzer Tag. Logik in src/kontrolle/streng.ts.
export interface StrengeZeit {
  tage: number[];
  von: number;
  bis: number;
}
export const MAX_STRENGE_ZEITEN = 3;

// Bereinigt rohe Zeitfenster: ganzzahlige Minuten 0 bis 1439, Tage 0 bis 6 ohne Doppelte (sortiert), Fenster ohne Tage fallen weg, hoechstens 3.
export function bereinigeZeiten(roh: unknown): StrengeZeit[] {
  if (!Array.isArray(roh)) return [];
  const aus: StrengeZeit[] = [];
  for (const z of roh) {
    if (aus.length >= MAX_STRENGE_ZEITEN) break;
    if (!z || typeof z !== 'object') continue;
    const r = z as Record<string, unknown>;
    const minute = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1439 ? x : null);
    const von = minute(r.von);
    const bis = minute(r.bis);
    if (von === null || bis === null || !Array.isArray(r.tage)) continue;
    const tage = [...new Set(r.tage.filter((t): t is number => typeof t === 'number' && Number.isInteger(t) && t >= 0 && t <= 6))].sort((a, b) => a - b);
    if (tage.length === 0) continue;
    aus.push({ tage, von, bis });
  }
  return aus;
}

// Intensitaet der Pack-Bilder auf Erwachsenenseiten (Phase 7, Entscheidung 148), kumulativ: tease = nur tease, hot = tease und hot,
// explicit = alle drei. Standard hot. Die Wahl der Bilder liegt in src/pack/wahl.ts.
export const STUFEN_WAHL = ['tease', 'hot', 'explicit'] as const;
export type StufeWahl = (typeof STUFEN_WAHL)[number];

export interface ErwachsenEinstellung {
  stufe: StufeWahl; // wirkt nur mit Pack und Freischaltung `erwachsen:vorschau`
  an: boolean; // Pornoseiten-Modus (Standard an, wirkt nur mit Pack)
  komplettErsatz: boolean; // Komplett-Ersatz: Mia-Galerie in der Seite statt der Seite (Standard aus, Entscheidung 100)
  erkennenAmInhalt: boolean; // Zusatz zur Liste: Seite am Inhalt erkennen (nur Quiz und Freilegen, nie Vorschau oder Ersatz)
  eigeneSeiten: string[]; // vom Nutzer ergaenzte Hosts (gleiche Schreibweise wie `ausnahmen`, nur Hosts)
}

export interface QuizEinstellung {
  verweigern: number; // Anteil richtiger Antworten, die Mia trotzdem verweigert (nie zweimal hintereinander)
  freilegenMs: number; // wie lange eine zensierte Flaeche nach geloestem Quiz frei bleibt
}

export const VERWEIGERN_MIN = 0;
export const VERWEIGERN_MAX = 0.3;
export const FREILEGEN_MIN_MS = 3000;
export const FREILEGEN_MAX_MS = 30000;

export const LEERLAUF_MIN_MINUTEN = 1;
export const LEERLAUF_MAX_MINUTEN = 60;
// Obergrenze der Liste "Sites without my ads" (Session 17 Fund 3); bei mehr bleiben die neuesten.
export const WERBUNG_AUS_MAX = 200;

export const SCHWELLE_MIN = 0.1;
export const SCHWELLE_MAX = 0.25;
export const SPEICHER_SCHLUESSEL = 'einstellungen';

export const STANDARD: Einstellungen = {
  version: 1,
  pause: false,
  strict: false,
  schwelle: 0.1,
  preset: STANDARD_PRESET,
  woerterThemen: null,
  video: 'zonen',
  rand: 0.15,
  zonen: {
    eyes: { an: false },
    mouth: { an: false },
    face: { an: false },
    head: { an: false },
    breast: { an: true, bedeckt: false },
    genitals: { an: true, bedeckt: true },
    buttocks: { an: true, bedeckt: false },
    belly: { an: false, bedeckt: false },
    feet: { an: false, bedeckt: false },
    armpits: { an: false, bedeckt: false },
  },
  ausnahmen: [],
  ruhig: false,
  erwachsen: { stufe: 'hot', an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: [] },
  quiz: { verweigern: 0.1, freilegenMs: 10000 },
  kontrolle: { werbung: false, werbungGefragt: false, werbungAus: [], blitz: 'selten', leerlauf: true, leerlaufMinuten: 2, tabtitel: true, cursor: 'spirale', meldungen: true, besuche: false, zeiten: [] },
  ton: { an: false, lautstaerke: TON_LAUTSTAERKE_STANDARD },
};

// Preset waehlen (Einstellungsseite, Einstieg, erstes Pack): beim Wechsel auf ein Preset mit Mias Gesicht schaltet sich die Zone Face ein
// (Entscheidung der Inhaberin), sonst saehe man kein einziges Gesicht von Mia. Gilt nur beim Wechsel (vorher kein Mia-Preset) und nur, wenn
// Face aus war; spaeter abgeschaltet bleibt es aus, es wird nie bei jedem Laden neu eingeschaltet. `faceEingeschaltet` sagt der Oberflaeche,
// ob sie den kurzen Hinweis zeigen soll.
export function waehlePreset(alt: Pick<Einstellungen, 'preset' | 'zonen'>, neu: Preset): { teil: Partial<Einstellungen>; faceEingeschaltet: boolean } {
  if (nutztMiasGesicht(neu) && !nutztMiasGesicht(alt.preset) && !alt.zonen.face.an) {
    return { teil: { preset: neu, zonen: { ...alt.zonen, face: { ...alt.zonen.face, an: true } } }, faceEingeschaltet: true };
  }
  return { teil: { preset: neu }, faceEingeschaltet: false };
}

// Zonen, die ein Preset wirklich auswertet (src/presets.ts, zonenFuerPreset): Augenbalken nur die Augen, Zensurbalken die Schalter plus
// Augen, alle anderen die Schalter unveraendert (dasselbe Objekt). Unabhaengig von der Steigerung.
export function zonenFuerPreset(preset: Preset | undefined, zonen: Record<Zone, ZonenEinstellung>): Record<Zone, ZonenEinstellung> {
  return zonenFuerPresetAllgemein(preset, zonen) as Record<Zone, ZonenEinstellung>;
}

// Liste von Hosts oder Mustern: nur Texte, getrimmt, klein, ohne Leere und Doppelte.
function textListe(roh: unknown): string[] {
  if (!Array.isArray(roh)) return [];
  return [...new Set(roh.filter((m): m is string => typeof m === 'string').map((m) => m.trim().toLowerCase()).filter(Boolean))];
}

const objekt = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const wahr = (x: unknown, standard: boolean): boolean => (typeof x === 'boolean' ? x : standard);

function begrenze(wert: unknown, min: number, max: number, standard: number): number {
  const z = typeof wert === 'number' && Number.isFinite(wert) ? wert : standard;
  return Math.min(max, Math.max(min, z));
}

// Fuellt ein beliebiges Objekt zu vollstaendigen Einstellungen auf (ungueltige Werte -> Standard).
export function vervollstaendige(roh: unknown): Einstellungen {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Partial<Record<keyof Einstellungen, unknown>>;
  const zonen = {} as Record<Zone, ZonenEinstellung>;
  const rohZonen = (r.zonen && typeof r.zonen === 'object' ? r.zonen : {}) as Partial<Record<Zone, Partial<ZonenEinstellung>>>;
  for (const z of ZONEN) {
    const s = STANDARD.zonen[z];
    const v = rohZonen[z] ?? {};
    zonen[z] = { an: typeof v.an === 'boolean' ? v.an : s.an };
    if (BEDECKBARE_ZONEN.has(z)) zonen[z].bedeckt = typeof v.bedeckt === 'boolean' ? v.bedeckt : !!s.bedeckt;
  }
  return {
    version: 1,
    pause: typeof r.pause === 'boolean' ? r.pause : STANDARD.pause,
    strict: typeof r.strict === 'boolean' ? r.strict : STANDARD.strict,
    schwelle: begrenze(r.schwelle, SCHWELLE_MIN, SCHWELLE_MAX, STANDARD.schwelle),
    // Altbestand: `stil` wird zum Preset (mia-patch zu mia-wort), `preset` gewinnt, wo beides steht.
    preset: istPreset(r.preset) ? r.preset : presetAusStil((r as { stil?: unknown }).stil) ?? STANDARD_PRESET,
    woerterThemen: Array.isArray(r.woerterThemen)
      ? [...new Set(r.woerterThemen.filter((t): t is string => typeof t === 'string' && THEMA_ID_MUSTER.test(t)))].slice(0, MAX_THEMEN)
      : null,
    video: VIDEO_MODI.includes(r.video as VideoModus) ? (r.video as VideoModus) : STANDARD.video,
    rand: begrenze(r.rand, 0, 0.5, STANDARD.rand),
    zonen,
    ausnahmen: Array.isArray(r.ausnahmen)
      ? r.ausnahmen.filter((m): m is string => typeof m === 'string').map((m) => m.trim().toLowerCase()).filter(Boolean)
      : [],
    ruhig: wahr(r.ruhig, STANDARD.ruhig),
    erwachsen: (() => {
      const e = objekt(r.erwachsen);
      const s = STANDARD.erwachsen;
      return {
        stufe: (STUFEN_WAHL as readonly unknown[]).includes(e.stufe) ? (e.stufe as StufeWahl) : s.stufe,
        an: wahr(e.an, s.an),
        komplettErsatz: wahr(e.komplettErsatz, s.komplettErsatz),
        erkennenAmInhalt: wahr(e.erkennenAmInhalt, s.erkennenAmInhalt),
        eigeneSeiten: textListe(e.eigeneSeiten),
      };
    })(),
    quiz: (() => {
      const q = objekt(r.quiz);
      return {
        verweigern: begrenze(q.verweigern, VERWEIGERN_MIN, VERWEIGERN_MAX, STANDARD.quiz.verweigern),
        freilegenMs: Math.round(begrenze(q.freilegenMs, FREILEGEN_MIN_MS, FREILEGEN_MAX_MS, STANDARD.quiz.freilegenMs)),
      };
    })(),
    kontrolle: (() => {
      const k = objekt(r.kontrolle);
      const s = STANDARD.kontrolle;
      return {
        werbung: wahr(k.werbung, s.werbung),
        werbungGefragt: wahr(k.werbungGefragt, s.werbungGefragt),
        werbungAus: [...new Set(textListe(k.werbungAus).map((m) => m.trim().toLowerCase()).filter(Boolean))].slice(-WERBUNG_AUS_MAX),
        blitz: (BLITZ_HAEUFIGKEITEN as readonly unknown[]).includes(k.blitz) ? (k.blitz as BlitzHaeufigkeit) : s.blitz,
        leerlauf: wahr(k.leerlauf, s.leerlauf),
        leerlaufMinuten: Math.round(begrenze(k.leerlaufMinuten, LEERLAUF_MIN_MINUTEN, LEERLAUF_MAX_MINUTEN, s.leerlaufMinuten)),
        tabtitel: wahr(k.tabtitel, s.tabtitel),
        cursor: (CURSOR_ARTEN as readonly unknown[]).includes(k.cursor) ? (k.cursor as CursorArt) : s.cursor,
        meldungen: wahr(k.meldungen, s.meldungen),
        besuche: wahr(k.besuche, s.besuche),
        zeiten: bereinigeZeiten(k.zeiten),
      };
    })(),
    ton: (() => {
      const t = objekt(r.ton);
      return { an: wahr(t.an, STANDARD.ton.an), lautstaerke: begrenze(t.lautstaerke, 0, 1, STANDARD.ton.lautstaerke) };
    })(),
  };
}

export async function ladeEinstellungen(): Promise<Einstellungen> {
  const ablage = await browser.storage.local.get(SPEICHER_SCHLUESSEL);
  return vervollstaendige(ablage[SPEICHER_SCHLUESSEL]);
}

// Speichert vollstaendige Einstellungen (Teilaenderungen vorher mit ladeEinstellungen zusammenfuehren).
export async function speichereEinstellungen(e: Einstellungen): Promise<void> {
  await browser.storage.local.set({ [SPEICHER_SCHLUESSEL]: vervollstaendige(e) });
}

// Aenderungen laufen nacheinander (Laden, Zusammenfuehren, Speichern), damit zwei schnelle Aenderungen sich nicht ueberschreiben.
// Eine Funktion als Aenderung bekommt den frisch gelesenen Stand und liefert den Teil, der sich aendert (fuer Zonen, Ausnahmen, Umschalten).
let aenderungsKette: Promise<unknown> = Promise.resolve();
export function aendereEinstellungen(
  aenderung: Partial<Einstellungen> | ((alt: Einstellungen) => Partial<Einstellungen>),
): Promise<Einstellungen> {
  const schritt = aenderungsKette.then(async () => {
    const alt = await ladeEinstellungen();
    const teil = typeof aenderung === 'function' ? aenderung(alt) : aenderung;
    const neu = vervollstaendige({ ...alt, ...teil });
    await browser.storage.local.set({ [SPEICHER_SCHLUESSEL]: neu });
    return neu;
  });
  aenderungsKette = schritt.catch(() => undefined);
  return schritt;
}

// Ruft `rueckruf` bei jeder Aenderung der Einstellungen (storage.onChanged). Gibt eine Funktion zum Abmelden zurueck.
export function beiEinstellungsAenderung(rueckruf: (neu: Einstellungen) => void): () => void {
  const horcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string) => {
    if (bereich !== 'local' || !(SPEICHER_SCHLUESSEL in aenderungen)) return;
    rueckruf(vervollstaendige(aenderungen[SPEICHER_SCHLUESSEL].newValue));
  };
  browser.storage.onChanged.addListener(horcher);
  return () => browser.storage.onChanged.removeListener(horcher);
}
