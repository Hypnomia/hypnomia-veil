// Pause nach Regel S2 (Phase 11, E3c, Regel K): die reine Entscheidung, ohne Browser und ohne Erkenner. Ein pausiertes Video ohne Leinwand, das im Urteil
// `verdeckt` steht und ein sauberes Standbild zeigt, bekommt nach drei sauberen Pruefungen desselben Standbilds eine KOPIE dieses Bilds (video-kopie.ts): das Video
// selbst wird in der Pause nie frei (das Urteil bleibt `verdeckt`). Jedes Zeichen einer Aenderung nimmt die Kopie sofort weg. Im Zweifel bleibt das Video
// verdeckt: jede Funktion hier faellt auf die strenge Seite. `video.ts` fuehrt die Entscheidungen aus (Zaehler, Timer, Kopie), dieses Modul kennt weder Element noch Urteil.

export type StandErgebnis = 'treffer' | 'sauber' | 'fehler' | 'unlesbar';

// Abstand der Nachschau, solange ein Video "frei fuer das Standbild" gilt (ms). Sie faengt, was die Ereignisse und der Bildwaechter nicht melden.
export const STAND_NACHSCHAU_MS = 250;
// So viele Abweichungen des Daumens bei gleicher Zeit duldet ein Standbild, danach ist seine Pruefung beendet (es bleibt verdeckt).
export const STAND_ABWEICHUNG_MAX = 2;
// Hoechstens so viele Kopien je Dokument zugleich (K7).
export const KOPIEN_MAX = 4;

// ---------- Wer ueberhaupt gepruft werden darf (Punkt 1 und 2) ----------

export interface StandFakten {
  // paused oder ended
  steht: boolean;
  seeking: boolean;
  readyState: number;
  videoWidth: number;
  // played.length > 0: das Video hat seit dem Laden der Quelle gespielt (ein Sprung ohne Abspielen zaehlt nicht)
  gespielt: boolean;
  hatPoster: boolean;
  hatLeinwand: boolean;
  // MediaStream: kein Standbild im Sinn der Regel
  istStrom: boolean;
  // Das Urteil ist `verdeckt` (angezeigt und entschieden), kein vorlaeufiges Urteil, kein `zensiert`, kein `frei`.
  verdeckt: boolean;
  // Die Pruefung der Zonen-Leinwand haelt den Takt (schnell): das ist ein Video mit Leinwand.
  schnell: boolean;
}

// Zeigt das Video sein Poster? (E3d, Regel P2) Das Element traegt ein `poster`-Attribut (auch ein leeres) und hat seit dem letzten Laden der Quelle nie gespielt. Ein Sprung ohne
// Abspielen beendet das Poster nicht (strengere Lesart). Es gibt genau diese eine Rechnung: sie gilt fuer das Urteil (nie `frei` solange das Poster zeigt, `video.ts`, `schleier.ts`)
// und fuer die Kopie des Standbilds (keine Kopie, Nachschau).
// P8: ein Video ohne Bildmasse (nur Ton, `videoWidth === 0`) zeigt sein Poster auch beim Abspielen: es bleibt `verdeckt`, solange das Attribut da ist.
export function zeigtPoster(f: Pick<StandFakten, 'gespielt' | 'hatPoster' | 'videoWidth'>): boolean {
  return f.hatPoster && (!f.gespielt || !(f.videoWidth > 0));
}

export function zeigtPosterAm(el: { hasAttribute(name: string): boolean; played: { length: number }; videoWidth: number }): boolean {
  let gespielt = false;
  try {
    gespielt = el.played.length > 0;
  } catch {
    gespielt = false; // nicht lesbar: im Zweifel zeigt das Video sein Poster (strengere Seite)
  }
  return zeigtPoster({ hatPoster: el.hasAttribute('poster'), gespielt, videoWidth: el.videoWidth });
}

export function standbildBerechtigt(f: StandFakten): boolean {
  if (f.hatLeinwand || f.schnell || f.istStrom) return false;
  if (!f.verdeckt) return false;
  if (!f.steht || f.seeking) return false;
  if (f.readyState < 2 || !(f.videoWidth > 0)) return false;
  if (zeigtPoster(f)) return false;
  return true;
}

// ---------- Stand der Pruefung eines Standbilds ----------

export interface StandbildStand {
  // Medienzeit, Quellen-Epoche und Quelle des Standbilds (so wurde es angelegt).
  ct: number;
  epoche: number;
  quelle: string;
  // Saubere Pruefungen in Folge desselben Standbilds (eigener Zaehler, nicht der des laufenden Videos).
  sauber: number;
  // Daumen der ersten sauberen Pruefung dieses Standbilds (null = noch keine).
  daumen: Float32Array | null;
  abweichungen: number;
  // Treffer, Fehler oder zu viele Abweichungen: die Pruefung dieses Standbilds ist zu Ende, es bleibt verdeckt, bis sich etwas aendert.
  beendet: boolean;
}

export function neuesStandbild(ct: number, epoche: number, quelle: string): StandbildStand {
  return { ct, epoche, quelle, sauber: 0, daumen: null, abweichungen: 0, beendet: false };
}

// Was im Augenblick der Aufnahme (Pixel lesen) und was bei der Antwort galt.
export interface StandAufnahme {
  ct: number;
  epoche: number;
  quelle: string;
  daumen: Float32Array | null;
}
export interface StandJetzt {
  steht: boolean;
  seeking: boolean;
  ct: number;
  epoche: number;
  quelle: string;
  hatLeinwand: boolean;
}

export type StandAktion =
  // Die Antwort zaehlt als saubere Pruefung, es fehlen noch welche.
  | 'zaehlt'
  // Die dritte saubere Pruefung in Folge: das Standbild bekommt seine Kopie (das Video selbst wird nie frei).
  | 'drei'
  // Treffer, Fehler oder zu viele Abweichungen: die Pruefung dieses Standbilds ist beendet.
  | 'beendet'
  // Die Antwort zaehlt nicht (etwas hat sich geaendert), der Zaehler steht auf null.
  | 'verworfen';

export interface StandBefund {
  stand: StandbildStand;
  aktion: StandAktion;
}

// Eine Pruefung zaehlt als sauber fuer das Standbild nur, wenn von der Aufnahme bis zur Antwort alles gleich blieb: das Video steht, die Zeit ist unveraendert,
// kein Sprung laeuft, dieselbe Quelle, keine Leinwand, und der Daumen der Aufnahme gleicht dem Daumen der ersten sauberen Pruefung. Jede Abweichung setzt den
// Zaehler auf null. Ein Treffer, ein Fehler oder "nicht lesbar" beendet die Pruefung dieses Standbilds (nie ein Dauerpruefen eines unveraenderten Bilds).
export function bewerteStandbildPruefung(
  stand: StandbildStand,
  aufnahme: StandAufnahme,
  jetzt: StandJetzt,
  ergebnis: StandErgebnis,
  gleich: (a: Float32Array, b: Float32Array) => boolean,
  freiNach: number,
): StandBefund {
  const nullen: StandbildStand = { ...stand, sauber: 0, daumen: null };
  if (stand.beendet) return { stand, aktion: 'beendet' };
  // Etwas hat sich zwischen Aufnahme und Antwort (oder gegenueber dem Standbild) geaendert: die Antwort gilt dem Bild von damals.
  if (
    !jetzt.steht ||
    jetzt.seeking ||
    jetzt.hatLeinwand ||
    jetzt.ct !== aufnahme.ct ||
    jetzt.epoche !== aufnahme.epoche ||
    jetzt.quelle !== aufnahme.quelle ||
    aufnahme.ct !== stand.ct ||
    aufnahme.epoche !== stand.epoche ||
    aufnahme.quelle !== stand.quelle
  ) {
    return { stand: nullen, aktion: 'verworfen' };
  }
  if (ergebnis !== 'sauber') return { stand: { ...nullen, beendet: true }, aktion: 'beendet' };
  // Ohne lesbaren Daumen laesst sich nicht belegen, dass es dasselbe Bild war: wie ein Fehler.
  if (!aufnahme.daumen) return { stand: { ...nullen, beendet: true }, aktion: 'beendet' };
  if (stand.daumen && !gleich(stand.daumen, aufnahme.daumen)) {
    const abweichungen = stand.abweichungen + 1;
    if (abweichungen >= STAND_ABWEICHUNG_MAX) return { stand: { ...nullen, abweichungen, beendet: true }, aktion: 'beendet' };
    return { stand: { ...nullen, abweichungen }, aktion: 'verworfen' };
  }
  const sauber = stand.sauber + 1;
  const neu: StandbildStand = { ...stand, sauber, daumen: stand.daumen ?? aufnahme.daumen };
  return { stand: neu, aktion: sauber >= freiNach ? 'drei' : 'zaehlt' };
}

// ---------- Wann "frei fuer das Standbild" wieder zugedeckt wird (Punkt 5) ----------

// Ereignisse, die immer zudecken (Zudecken geht vor), und `timeupdate`, das nur bei anderer Zeit zudeckt.
const ZU_IMMER = ['play', 'playing', 'seeking', 'seeked', 'ratechange', 'loadstart', 'emptied', 'enterpictureinpicture'] as const;
export const STAND_EREIGNISSE: readonly string[] = [...ZU_IMMER, 'timeupdate'];

export function deckeZuBeiEreignis(name: string, ctJetzt: number, ctStand: number): boolean {
  if (name === 'timeupdate') return ctJetzt !== ctStand;
  return (ZU_IMMER as readonly string[]).includes(name);
}

export interface NachschauFakten {
  // Der Schleier ist an und die technische Eignung (wie die Zonen-Leinwand) gilt noch (kein Vollbild, keine controls, gross genug ...).
  aktiv: boolean;
  eignungOk: boolean;
  // Die Seite hat ein poster-Attribut gesetzt, und das Video hat nie gespielt: gezeigt wird das Poster, nicht das gepruefte Bild.
  poster: boolean;
  verbunden: boolean;
  steht: boolean;
  seeking: boolean;
  ct: number;
  ctStand: number;
  epoche: number;
  epocheStand: number;
  quelle: string;
  quelleStand: string;
  hatLeinwand: boolean;
  readyState: number;
}

// Die Nachschau im Takt: deckt zu, sobald das Video nicht mehr genau so dasteht, wie es freigegeben wurde.
export function deckeZuBeiNachschau(f: NachschauFakten): boolean {
  return !f.aktiv || !f.eignungOk || f.poster || !f.verbunden || !f.steht || f.seeking || f.ct !== f.ctStand || f.epoche !== f.epocheStand || f.quelle !== f.quelleStand || f.hatLeinwand || f.readyState < 2;
}

// ---------- Zaehler des laufenden Videos nach dem Zudecken (Punkt 6) ----------

export type ZuGrund = 'enterpictureinpicture' | 'play' | 'playing' | 'ratechange' | 'seeking' | 'seeked' | 'loadstart' | 'emptied' | 'timeupdate' | 'bildwaechter' | 'nachschau';

// Der Zaehler sauberer Pruefungen des laufenden Videos nach dem Zudecken. Nach Play (ohne Sprung) steht er wie vor der Pause. Nach einem Sprung, einem
// Quellenwechsel und bei jeder Aenderung im Stand ohne Play steht er auf null: das Video braucht dann wieder drei saubere Pruefungen in Folge.
export function zaehlerNachZudecken(grund: ZuGrund, steht: boolean, zaehlerVorPause: number): number {
  switch (grund) {
    case 'enterpictureinpicture':
    case 'play':
    case 'playing':
    case 'ratechange':
      return Math.max(0, zaehlerVorPause);
    case 'seeking':
    case 'seeked':
    case 'loadstart':
    case 'emptied':
      return 0;
    default:
      // timeupdate, Bildwaechter, Nachschau: laeuft das Video, ist es Play (Stand vor der Pause), im Stand ist es eine Aenderung des Bilds (null).
      return steht ? 0 : Math.max(0, zaehlerVorPause);
  }
}

// ---------- Verschaerfung im Bestand (V1, V2) ----------

// V1: eine gewoehnliche Pruefung zaehlt im laufenden Zaehler `sauber` nur, wenn das Video bei ihrem Start UND bei ihrer Antwort lief (nicht paused, nicht ended, nicht
// seeking). Sonst wird sie fuer den Zaehler verworfen; ein Treffer oder Fehler wirkt weiter sofort (nur ein "sauber" ist betroffen).
export function zaehltSauberImLaufenden(startLief: boolean, jetztLief: boolean): boolean {
  return startLief && jetztLief;
}

// V2: `seeking` im Stand (das Video steht beim Beginn des Sprungs) setzt den Zaehler des laufenden Videos immer auf null, auch ohne angelegtes Standbild.
export function zaehlerBeiSeekingImStand(steht: boolean, aktuell: number): number {
  return steht ? 0 : aktuell;
}

// ---------- Poster-Aenderung und Bildmasse (E3d, Nachtrag 2) ----------

// P9: eine Aenderung des `poster`-Attributs wirkt nur, wenn das Video sein Poster zeigte oder zeigen koennte (nie gespielt oder ohne Bildmasse). Hat es schon gespielt und Bildmasse,
// aendert ein neues oder entferntes `poster` nichts: kein neues Erst-Urteil, Lauf und Zaehler bleiben, die Hysterese nach einem Treffer wird nicht umgangen.
export function posterAenderungWirkt(gespielt: boolean, videoWidth: number): boolean {
  return !(gespielt && videoWidth > 0);
}

// P11: ein Video ohne Lauf, das ohne Bildmasse beurteilt wurde (nur Ton, zum Beispiel frei) und jetzt Bildmasse hat, wird neu beurteilt (sofort verdeckt, dann Erst-Urteil).
export function neuBeurteilenBeiBildmasse(warOhneBildmasse: boolean, videoWidth: number, hatLauf: boolean): boolean {
  return warOhneBildmasse && videoWidth > 0 && !hatLauf;
}
