// Kleidungsfrage, reine Logik (Phase 11 E4c0, Regel B6). Rein, ohne DOM.
// `kleidungsStand` liest nur. `setzeKleidung` schreibt nur nach einer Handlung des Nutzers und aendert nie einen Zonen-Schalter (`an`).
import { BEDECKBARE_ZONEN, ZONEN, type Zone, type ZonenEinstellung } from '../../einstellungen.ts';
import { setzeBedeckt, type ZonenStand } from '../../einstieg/zonen.ts';

export type KleidungsStand = 'haut' | 'auch-bedeckt' | 'gemischt';
export type KleidungsAntwort = Exclude<KleidungsStand, 'gemischt'>;

// haut: keine eingeschaltete bedeckbare Zone ist bedeckt. auch-bedeckt: jede eingeschaltete bedeckbare Zone ist bedeckt. Sonst gemischt.
// Ist keine bedeckbare Zone eingeschaltet, zaehlen die gespeicherten Kaestchen aller bedeckbaren Zonen (alle an: auch-bedeckt, keins: haut, sonst gemischt),
// damit die Frage nichts markiert, was nicht gespeichert ist (Nacharbeit R7).
export function kleidungsStand(zonen: ZonenStand): KleidungsStand {
  const bedeckbar = ZONEN.filter((z) => BEDECKBARE_ZONEN.has(z));
  const an = bedeckbar.filter((z) => zonen[z].an);
  const rechne = an.length > 0 ? an : bedeckbar;
  const bedeckt = rechne.filter((z) => zonen[z].bedeckt === true).length;
  if (bedeckt === 0) return 'haut';
  if (bedeckt === rechne.length) return 'auch-bedeckt';
  return 'gemischt';
}

// "Under clothes too" setzt `bedeckt` fuer alle bedeckbaren Zonen, "Bare skin only" nimmt es fuer alle weg: genau `setzeBedeckt` aus src/einstieg/zonen.ts
// (Nacharbeit R15, eine Rechnung statt zwei). `an` bleibt unberuehrt, Zonen ohne `bedeckt` (Eyes, Mouth, Face, Head) bleiben gleich, der Eingang wird nie veraendert.
export function setzeKleidung(zonen: ZonenStand, antwort: KleidungsAntwort): ZonenStand {
  return setzeBedeckt(zonen, antwort === 'auch-bedeckt');
}

// Eine einzelne Zone ein- oder ausschalten (Aufklapper "Pick zones one by one"). Eine neu eingeschaltete bedeckbare Zone verliert nie ein gespeichertes
// `bedeckt` (Nacharbeit R1): sie behaelt es ODER bekommt es, wenn die Kleidungsfrage auf auch-bedeckt steht. Ausgeschaltete behalten ihr `bedeckt`.
export function setzeEineZone(zonen: ZonenStand, zone: Zone, an: boolean): ZonenStand {
  const neu = {} as ZonenStand;
  const bedecktVorher = kleidungsStand(zonen) === 'auch-bedeckt';
  for (const z of ZONEN) neu[z] = { ...zonen[z] };
  const alt = zonen[zone];
  const e: ZonenEinstellung = { an };
  if (BEDECKBARE_ZONEN.has(zone)) e.bedeckt = !alt.an && an ? bedecktVorher || alt.bedeckt === true : alt.bedeckt === true;
  neu[zone] = e;
  return neu;
}

// Gleich im Sinn der Deckung: `an` jeder Zone und `bedeckt` der bedeckbaren Zonen (fehlt es, gilt es als falsch). Die Einstellungsseite schreibt eine Handlung
// nur, wenn der gespeicherte Stand noch der ist, auf dem sie gerechnet wurde (sonst wuerde ein alter Stand neuere Deckung ueberschreiben).
export function gleicheDeckung(a: ZonenStand, b: ZonenStand): boolean {
  return ZONEN.every((z) => a[z].an === b[z].an && (!BEDECKBARE_ZONEN.has(z) || (a[z].bedeckt === true) === (b[z].bedeckt === true)));
}

// Die Zonen, die heute eingeschaltet UND unter Kleidung gedeckt sind: das, was die Kleidungsfrage bei einem gemischten Stand nennt (nie mehr als gespeichert ist).
export function zonenUnterKleidung(zonen: ZonenStand): Zone[] {
  return ZONEN.filter((z) => BEDECKBARE_ZONEN.has(z) && zonen[z].an && zonen[z].bedeckt === true);
}

// Der Teil der Einstellungen, den Zonenwahl und Kleidungsfrage nach einer Handlung schreiben (Einstellungsseite und Interview, eine Rechnung): nur `zonen`, und nur, wenn
// der gespeicherte Stand `alt` noch der ist, auf dem die Handlung gerechnet wurde (`vorher`); sonst null (nichts schreiben, K2/G3).
export function zonenSchreibteil(alt: ZonenStand, vorher: ZonenStand, neu: ZonenStand): { zonen: ZonenStand } | null {
  return gleicheDeckung(alt, vorher) ? { zonen: neu } : null;
}
