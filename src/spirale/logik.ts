// Reine Logik der Leerlauf-Spirale (Auftrag L, Phase 5): Drehzahl mit den Deckeln, Einblenden, Aufloesung, Bedingungen und die
// Zustandslogik (Phasen, Sperre bis zum naechsten Wechsel active und idle). Keine Browser-Zugriffe und nur ein Import mit Endung `.ts`,
// damit der Einheitstest (`node --experimental-strip-types`) sie ohne Browser prueft.
import { deckleDrehzahl, SPERRE_MS, streifenHz } from '../kontrolle/grenzen.ts';

// Arme der Spirale und Wunsch-Drehzahl (Umdrehungen je Sekunde). Die Deckel (Streifen hoechstens 2,5 Hz, Ruhig 30 %) wirken immer ueber
// `deckleDrehzahl`: 3 Arme mal 0,4 = 1,2 Hz, im Ruhig-Modus 0,36 Hz.
export const SPIRALE_ARME = 3;
export const WUNSCH_UMDREHUNGEN = 0.4;

// Einblenden: mindestens 1200 ms (kein harter vollflaechiger Wechsel), gebaut sind 1500 ms.
export const EINBLEND_MIN_MS = 1200;
export const EINBLEND_MS = 1500;
// Nach 15 Minuten ein stehendes Bild (kein Zeichnen mehr).
export const STEHEND_NACH_MS = 15 * 60_000;
// Laengste Seite der Leinwand in Pixeln (CSS streckt sie auf den Sichtbereich).
export const LEINWAND_MAX_SEITE = 1280;
// Zeichnen hoechstens alle 33 ms (rund 30 Bilder je Sekunde, spart Strom; bei 1,2 Hz Streifenfrequenz ruhig genug).
export const BILD_ABSTAND_MS = 33;
// Mausbewegung unter dieser Strecke (Bildschirmpixel) zaehlt nicht als Bewegung, wenn das Ereignis keine eigene Bewegung meldet.
export const MAUS_SCHWELLE_PX = 1;
// Nachlauf: der Rest einer Geste, die die Spirale beendet hat (Klick, gehaltene Taste), erreicht die Seite nicht. Er endet kurz nach dem
// Loslassen (Maus 300 ms, Beruehrung 700 ms: der Klick kommt dort spaeter), aus Sicherheit nach 2 Minuten.
export const NACHLAUF_MAX_MS = 120_000;
export const NACHLAUF_NACH_LOSLASSEN_MS = 300;
export const NACHLAUF_NACH_LOSLASSEN_TOUCH_MS = 700;

export interface Drehung {
  arme: number;
  umdrehungenJeSekunde: number;
  hz: number;
  ruhig: boolean;
}

// Gedeckelte Drehung (Betrag): Streifenfrequenz = Arme mal Umdrehungen, nie ueber 2,5 Hz, im Ruhig-Modus mal 0,3.
export function drehungFuer(ruhig: boolean, arme: number = SPIRALE_ARME, wunsch: number = WUNSCH_UMDREHUNGEN): Drehung {
  const ups = deckleDrehzahl(arme, wunsch, ruhig);
  return { arme, umdrehungenJeSekunde: ups, hz: streifenHz(arme, ups), ruhig };
}

// Deckkraft beim Einblenden nach `ms` Millisekunden: linear von 0 bis 1, die Dauer ist nie unter 1200 ms.
export function deckkraftNach(ms: number, einblendMs: number = EINBLEND_MS): number {
  const dauer = Math.max(EINBLEND_MIN_MS, Number.isFinite(einblendMs) ? einblendMs : EINBLEND_MS);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(1, ms / dauer);
}

// Leinwand-Pixel fuer einen Sichtbereich: die laengste Seite hoechstens 1280, das Seitenverhaeltnis bleibt, mindestens 1 Pixel.
export function leinwandMasse(breite: number, hoehe: number): { breite: number; hoehe: number } {
  const b = Math.max(1, Number.isFinite(breite) ? breite : 1);
  const h = Math.max(1, Number.isFinite(hoehe) ? hoehe : 1);
  const faktor = Math.min(1, LEINWAND_MAX_SEITE / Math.max(b, h));
  return { breite: Math.max(1, Math.round(b * faktor)), hoehe: Math.max(1, Math.round(h * faktor)) };
}

// Einen Satz der Gruppe waehlen (`zufall` 0 bis unter 1); leer, wenn es keinen gibt.
export function waehleSatz(liste: readonly string[] | undefined, zufall: number): string {
  const l = (liste ?? []).filter((s) => typeof s === 'string' && s.trim() !== '');
  if (l.length === 0) return '';
  const z = Number.isFinite(zufall) ? Math.min(Math.max(zufall, 0), 0.999999) : 0;
  return l[Math.floor(z * l.length)]!;
}

// Hat sich die Maus wirklich bewegt? Ein Ereignis mit eigener Bewegung (movementX oder Y) zaehlt immer; sonst vergleichen wir die
// Bildschirmposition mit der des Ereignisses davor (ein vom Browser nachgeschobenes Ereignis nach dem Layout hat dieselbe Position).
export function mausBewegt(vorher: { x: number; y: number } | null, jetzt: { x: number; y: number; bewegungX?: number; bewegungY?: number }): boolean {
  if ((jetzt.bewegungX ?? 0) !== 0 || (jetzt.bewegungY ?? 0) !== 0) return true;
  if (!vorher) return false;
  return Math.max(Math.abs(jetzt.x - vorher.x), Math.abs(jetzt.y - vorher.y)) >= MAUS_SCHWELLE_PX;
}

// ---------- Bedingungen ----------
export interface LageEingabe {
  oberste: boolean; // oberste Seite des Tabs
  schalterAn: boolean; // einstellungen.kontrolle.leerlauf
  erlaubt: boolean; // kontrolleErlaubt(...): Pack mit Freischaltung, keine Pause, keine eigene Ausnahme
  sichtbar: boolean; // Dokument sichtbar
  tippt: boolean; // eingabeAktiv()
  belegt: boolean; // andereVorDerSeite('spirale')
  vollbild: boolean; // document.fullscreenElement
  satz: string; // Satz aus der Pack-Gruppe `leerlauf`
}

export type Absage = 'nicht-oberste' | 'schalter-aus' | 'nicht-erlaubt' | 'unsichtbar' | 'eingabe' | 'belegt' | 'vollbild' | 'kein-satz';

// Warum es keine Spirale gibt (null: alles in Ordnung). Die Reihenfolge ist fest und wird im Test geprueft.
export function absageGrund(l: LageEingabe): Absage | null {
  if (!l.oberste) return 'nicht-oberste';
  if (!l.schalterAn) return 'schalter-aus';
  if (!l.erlaubt) return 'nicht-erlaubt';
  if (!l.sichtbar) return 'unsichtbar';
  if (l.tippt) return 'eingabe';
  if (l.belegt) return 'belegt';
  if (l.vollbild) return 'vollbild';
  if (l.satz === '') return 'kein-satz';
  return null;
}

// ---------- Zustand ----------
// ruhend: nichts zu sehen. laedt: Leerlauf gemeldet, Lage wird geprueft (Pack, Saetze). warnung: die Warnkarte steht. spirale: die Spirale steht.
export type Phase = 'ruhend' | 'laedt' | 'warnung' | 'spirale';

// Eine neue Spirale gibt es erst nach dem naechsten Wechsel active und idle (`gesperrt`, bis `aktiv()` kommt) und frueher als 334 ms nach
// dem letzten Ende nicht (Blitz-Grenze: hoechstens 3 vollflaechige Wechsel je Sekunde).
export class LeerlaufZustand {
  phase: Phase = 'ruhend';
  gesperrt = false;
  private ende = -Infinity;

  // Leerlauf gemeldet: darf eine Pruefung beginnen? (Dann ist die Phase `laedt`.)
  versucheStart(jetzt: number): boolean {
    if (this.phase !== 'ruhend' || this.gesperrt) return false;
    if (jetzt - this.ende < SPERRE_MS) return false;
    this.phase = 'laedt';
    return true;
  }

  // Warum `versucheStart` nein sagt (fuer die Testspur): Sperre bis active, weniger als 334 ms nach dem Ende, oder es laeuft schon etwas.
  warumNicht(jetzt: number): 'gesperrt' | 'abstand' | 'laeuft-schon' {
    if (this.phase !== 'ruhend') return 'laeuft-schon';
    if (this.gesperrt) return 'gesperrt';
    return jetzt - this.ende < SPERRE_MS ? 'abstand' : 'laeuft-schon';
  }

  // Die Pruefung hat nichts zu zeigen ergeben (oder wurde abgebrochen).
  verwirf(): void {
    if (this.phase === 'laedt') this.phase = 'ruhend';
  }

  zeigeWarnung(): boolean {
    if (this.phase !== 'laedt') return false;
    this.phase = 'warnung';
    return true;
  }

  zeigeSpirale(): boolean {
    if (this.phase !== 'laedt') return false;
    this.phase = 'spirale';
    return true;
  }

  // Die Warnkarte ist zu (Knopf, Escape, Klick daneben, Pause ...). Die Sperre aendert sich nicht.
  schliesseWarnung(jetzt: number): void {
    if (this.phase !== 'warnung') return;
    this.phase = 'ruhend';
    this.ende = jetzt;
  }

  // Die Spirale ist weg (Eingabe, Pause, Tab verborgen, Schalter aus ...): neue Spirale erst nach active und idle.
  endeSpirale(jetzt: number): boolean {
    if (this.phase !== 'spirale') return false;
    this.phase = 'ruhend';
    this.gesperrt = true;
    this.ende = jetzt;
    return true;
  }

  // Der Hintergrund meldet active oder locked: die Sperre faellt. Liefert, ob gerade die Spirale steht (dann muss sie enden) oder eine
  // Pruefung laeuft (dann wird sie abgebrochen). Die Warnkarte bleibt: wer zurueckkommt, soll sie lesen.
  aktiv(): 'spirale-beenden' | 'abgebrochen' | 'nichts' {
    this.gesperrt = false;
    if (this.phase === 'spirale') return 'spirale-beenden';
    if (this.phase === 'laedt') {
      this.phase = 'ruhend';
      return 'abgebrochen';
    }
    return 'nichts';
  }
}
