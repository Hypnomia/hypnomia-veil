// Blitz-Grenzen fuer Phase 5 (SICHERHEITSGRENZEN.md, CLAUDE.md Regel 9), vom Orchestrator geschrieben (Vertrag Session 9). Bauer lesen nur.
// Keine Laufzeit-Importe: laeuft in Einheitstests mit `node --experimental-strip-types` und im Browser. Die Deckel gelten im Code
// unabhaengig von Pack-Daten und Einstellungen; Messung per Blitz-Aufnahme (Pixel) in MESSUNG-PHASE-5.md.

// Blitzwoerter: ein Wort je 185 ms hoechstens (5,4 Hz, bewusst unter 6 Hz), Schwarm hoechstens 12 Woerter und 2500 ms am Stueck.
export const BLITZ_WORT_MIN_ABSTAND_MS = 185;
export const SCHWARM_MAX_WORTE = 12;
export const SCHWARM_MAX_MS = 2500;
// Spirale: Streifenfrequenz (Arme mal Umdrehungen je Sekunde) hoechstens 2,5 Hz; Ruhig-Modus und prefers-reduced-motion: Drehzahl auf 30 %.
export const STREIFEN_MAX_HZ = 2.5;
export const RUHIG_FAKTOR = 0.3;
// Vollflaechige Wechsel (Erscheinen oder Verschwinden einer Flaeche ueber der ganzen Seite): hoechstens 3 je Sekunde, Sperre 334 ms.
export const SPERRE_MS = 334;
// Nie beim Tippen: so lange nach der letzten Taste gilt die Person noch als tippend.
export const TIPP_NACHLAUF_MS = 2000;

// Warnung vor Fotosensibilitaet (storage.local): gesehen im Quiz (Schluessel aus src/riegel/riegel.ts, hier als Kopie fuer die
// Einstellungsseite, die den Riegel nicht laden soll) oder auf der Spirale bzw. in der Einstellungsseite.
export const QUIZ_WARNUNG_SCHLUESSEL = 'quizWarnungGesehen';
export const WARNUNG_SPIRALE_SCHLUESSEL = 'spiraleWarnungGesehen';

// Abstand zwischen zwei Blitz-Ereignissen je Haeufigkeit (gleichverteilt zwischen min und max, Entscheidung 116: selten etwa alle 10 Minuten).
export const BLITZ_ABSTAND_MS: Readonly<Record<'selten' | 'oft', readonly [number, number]>> = {
  selten: [8 * 60_000, 12 * 60_000],
  oft: [2 * 60_000, 4 * 60_000],
};

// Ein Wort im Plan: Beginn ab Start des Ereignisses und Sichtdauer, beides in Millisekunden.
export interface WortPlan {
  beginnMs: number;
  dauerMs: number;
}

// Deckelt einen Plan fuer Blitzwoerter: sortiert, verschiebt Woerter auf mindestens 185 ms Abstand der Anfaenge, kuerzt jedes Wort so,
// dass es vor dem naechsten endet, wirft alles hinter dem 12. Wort und alles, was nach 2500 ms enden wuerde, weg. Ein einzelnes Wort
// ist ein Schwarm der Laenge 1 (Dauer hoechstens 2500 ms). Ungueltige Zahlen fallen weg; gerechnet wird in ganzen Millisekunden.
export function deckleWortPlan(plan: readonly WortPlan[]): WortPlan[] {
  const sauber = plan
    .filter((w) => Number.isFinite(w.beginnMs) && Number.isFinite(w.dauerMs) && w.dauerMs > 0)
    .map((w) => ({ beginnMs: Math.max(0, Math.round(w.beginnMs)), dauerMs: Math.round(w.dauerMs) }))
    .filter((w) => w.dauerMs > 0)
    .sort((a, b) => a.beginnMs - b.beginnMs);
  // Alles relativ zum ersten Wort, damit die 2500 ms ab dem ersten sichtbaren Wort gelten.
  const erster = sauber[0]?.beginnMs ?? 0;
  for (const w of sauber) w.beginnMs -= erster;
  const aus: WortPlan[] = [];
  for (const w of sauber) {
    if (aus.length >= SCHWARM_MAX_WORTE) break;
    const vorher = aus[aus.length - 1];
    const beginn = vorher ? Math.max(w.beginnMs, vorher.beginnMs + BLITZ_WORT_MIN_ABSTAND_MS) : w.beginnMs;
    if (beginn >= SCHWARM_MAX_MS) break;
    if (vorher) vorher.dauerMs = Math.min(vorher.dauerMs, beginn - vorher.beginnMs);
    aus.push({ beginnMs: beginn, dauerMs: Math.min(w.dauerMs, SCHWARM_MAX_MS - beginn) });
  }
  return aus.filter((w) => w.beginnMs + w.dauerMs <= SCHWARM_MAX_MS && w.dauerMs > 0);
}

// Gedeckelte Drehzahl der Spirale in Umdrehungen je Sekunde (Betrag, Richtung waehlt der Aufrufer): Arme mal Drehzahl hoechstens 2,5 Hz,
// danach im Ruhig-Modus mal 0,3. Arme unter 1 gelten als 1, gebrochene werden aufgerundet; nicht endliche Werte ergeben Stillstand.
export function deckleDrehzahl(arme: number, umdrehungenJeSekunde: number, ruhig: boolean): number {
  if (!Number.isFinite(arme) || !Number.isFinite(umdrehungenJeSekunde)) return 0;
  const a = Math.max(1, Math.ceil(arme));
  const u = Math.abs(umdrehungenJeSekunde);
  const gedeckelt = Math.min(u, STREIFEN_MAX_HZ / a);
  return ruhig ? gedeckelt * RUHIG_FAKTOR : gedeckelt;
}

// Streifenfrequenz in Hz fuer Messung und Tests.
export function streifenHz(arme: number, umdrehungenJeSekunde: number): number {
  return Math.max(1, Math.ceil(arme)) * Math.abs(umdrehungenJeSekunde);
}

// Naechster Abstand bis zum Blitz-Ereignis (`zufall` 0 bis unter 1, injizierbar).
export function naechsterBlitzAbstand(haeufigkeit: 'selten' | 'oft', zufall: number): number {
  const [min, max] = BLITZ_ABSTAND_MS[haeufigkeit];
  const z = Number.isFinite(zufall) ? Math.min(Math.max(zufall, 0), 0.999999) : 0.5;
  return Math.round(min + (max - min) * z);
}

// ---------- Session 10 (PHASE-5-AUFTRAEGE-SESSION-10.md) ----------
// Meldungen (Auftrag M): hoechstens eine je 10 Minuten ueber alle Tabs (Entscheidung 116), sichtbar 8 s. Anlaesse: 50 zensierte Bilder am
// Tag (dann je weitere 50), Stufe der Steigerung gestiegen, 20 Minuten sichtbar auf einer Erwachsenenseite, Beginn einer strengen Zeit.
export const MELDUNG_MIN_ABSTAND_MS = 10 * 60_000;
export const MELDUNG_SICHT_MS = 8000;
export const MELDUNG_ZENSIERT_SCHRITT = 50;
export const MELDUNG_ERWACHSEN_MS = 20 * 60_000;

// Pflicht-Besuche (Auftrag Z2, Entscheidungen 116 und 125): nie oefter als alle 2 Stunden, geplant zufaellig 2 bis 4 Stunden nach dem letzten
// Besuch bzw. nach dem Einschalten; vor dem Oeffnen 5 s ein Hinweis mit "Not now".
export const BESUCH_MIN_ABSTAND_MS = 2 * 60 * 60_000;
export const BESUCH_ABSTAND_MS: readonly [number, number] = [2 * 60 * 60_000, 4 * 60 * 60_000];
export const BESUCH_HINWEIS_MS = 5000;

export function naechsterBesuchAbstand(zufall: number): number {
  const [min, max] = BESUCH_ABSTAND_MS;
  const z = Number.isFinite(zufall) ? Math.min(Math.max(zufall, 0), 0.999999) : 0.5;
  return Math.max(BESUCH_MIN_ABSTAND_MS, Math.round(min + (max - min) * z));
}
