// Einstellungen der Erweiterung (PHASE-2-BAUPLAN Abschnitt 3). Ablage: storage.local, Schluessel `einstellungen`.
// Fehlende Felder werden beim Laden mit Standardwerten aufgefuellt, damit aeltere Staende weiterlaufen.

export const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'] as const;
export type Zone = (typeof ZONEN)[number];

// Zonen, bei denen "auch bedeckt" Sinn ergibt (das Modell kennt dort bedeckte Varianten).
export const BEDECKBARE_ZONEN: ReadonlySet<Zone> = new Set<Zone>(['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits']);

// 'mia-patch' gilt nur mit Pack (src/pack/vertrag.ts, wirksamerStil); ohne Pack zeichnet der Erkenner Mosaik.
export type Stil = 'mosaik' | 'blur' | 'mia-patch';
export const STILE: readonly Stil[] = ['mosaik', 'blur', 'mia-patch'];

export interface ZonenEinstellung {
  an: boolean;
  bedeckt?: boolean;
}

export interface Einstellungen {
  version: 1;
  pause: boolean;
  strict: boolean;
  schwelle: number;
  stil: Stil;
  rand: number;
  zonen: Record<Zone, ZonenEinstellung>;
  ausnahmen: string[];
}

export const SCHWELLE_MIN = 0.1;
export const SCHWELLE_MAX = 0.25;
export const SPEICHER_SCHLUESSEL = 'einstellungen';

export const STANDARD: Einstellungen = {
  version: 1,
  pause: false,
  strict: false,
  schwelle: 0.1,
  stil: 'mosaik',
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
};

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
    stil: STILE.includes(r.stil as Stil) ? (r.stil as Stil) : 'mosaik',
    rand: begrenze(r.rand, 0, 0.5, STANDARD.rand),
    zonen,
    ausnahmen: Array.isArray(r.ausnahmen)
      ? r.ausnahmen.filter((m): m is string => typeof m === 'string').map((m) => m.trim().toLowerCase()).filter(Boolean)
      : [],
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
