// Content-Script: Ton zu Quiz und Blitzwoertern (Auftrag T, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 7, Entscheidungen 19 und 133).
// Hoert auf den Ereignis-Kanal (src/ereignisse.ts) und spielt einen kurzen Klang aus dem Pack: Quiz beginnt (quiz), richtig (richtig),
// falsch (falsch), verweigert (verweigert), Blitzwort-Folge (trigger). Spielt nur mit Pack und Freischaltung `ton`, eingeschaltetem Ton,
// Lautstaerke ueber 0, ohne Pause (gespeichert oder lokal) und nie auf einer eigenen Ausnahme-Seite (`kontrolleErlaubt`). Das Audio-Objekt
// wird nie ins DOM gehaengt. Hoechstens ein Klang zugleich (ein neuer ersetzt den laufenden), Abstand mindestens 300 ms zwischen zwei Starts.
// Lehnt der Browser das Abspielen ab (keine Interaktion mit der Seite), bleibt es still. Pause oder Schalter aus beendet den Klang sofort.
// Bewusst je Rahmen: ein Quiz in einem Rahmen und ein Blitzwort oben koennen gleichzeitig klingen, und die lokale Pause eines Rahmens stoppt
// nur dessen eigenen Klang (der Riegel kann im Rahmen stehen). Die gespeicherte Pause und der Schalter wirken in allen Rahmen.
// Kein Netz; die Klang-Daten holt der Hintergrund aus dem Pack (src/hintergrund/ton.ts), je Frame einmal und zwischengespeichert.
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import { beiEreignis, type EreignisArt } from '../ereignisse';
import { istOberstesFenster, kontrolleErlaubt } from '../kontrolle/gemeinsam';
import type { AntwortPackTon, AntwortTab, NachrichtHintergrundPackTon, NachrichtHintergrundTab } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, kurzAusRoh, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause } from '../pause-lokal';
import { TESTHAKEN } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { testhakenAktiv } from '../schleier/status';
import { TON_NAMEN, type TonName } from './vertrag';

// Welcher Anlass welchen Klang spielt.
const ANLASS: Partial<Record<EreignisArt, TonName>> = {
  'quiz-start': 'quiz',
  'quiz-richtig': 'richtig',
  'quiz-falsch': 'falsch',
  'quiz-verweigert': 'verweigert',
  blitz: 'trigger',
};
// Zwischen zwei Starts mindestens so lange (Sicherung gegen Knattern, etwa bei schnellen Falsch-Antworten).
export const TON_MIN_ABSTAND_MS = 300;

// Testabbild (nur Testbau): JSON am html-Element mit den letzten Abspielversuchen (Name, Lautstaerke, Ergebnis).
const ATTR_ABBILD: string = TESTHAKEN ? 'data-veil-ton' : '';
const MAX_VERSUCHE = 30;

export function starteTon(ctx: KontextLeicht): void {
  let abgebaut = false;
  const lebt = (): boolean => !abgebaut && ctx.isValid;
  let einst: Einstellungen | null = null;
  let pack: PackKurz | null = null;
  // Audio-Objekte je Name (Versprechen, damit zwei schnelle Ereignisse nicht zweimal laden); null = dieser Anlass ist still.
  const klaenge = new Map<TonName, Promise<HTMLAudioElement | null>>();
  let klangSchluessel = '';
  let laufend: HTMLAudioElement | null = null;
  let laufendName: TonName | null = null;
  let letzterStart = -Infinity;
  let nr = 0;
  let startNr = 0;
  const versuche: Array<{ nr: number; name: TonName; lautstaerke: number; ergebnis: string; quelle: string }> = [];

  const bereit = Promise.all([ladeEinstellungen(), ladePackKurz()]).then(
    ([e, p]) => {
      einst = e;
      pack = p;
    },
    () => undefined,
  );

  function erlaubt(): boolean {
    if (!lebt() || !einst || !pack) return false;
    if (!einst.ton.an || !(einst.ton.lautstaerke > 0)) return false;
    return kontrolleErlaubt(einst, pack, 'ton');
  }

  function stoppe(): void {
    const a = laufend;
    laufend = null;
    laufendName = null;
    schreibeAbbild();
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
    } catch {
      // ein Klang, der schon weg ist, braucht nichts mehr
    }
  }

  function vergissKlaenge(): void {
    stoppe();
    klaenge.clear();
    klangSchluessel = '';
  }

  async function lade(name: TonName): Promise<HTMLAudioElement | null> {
    try {
      const n: NachrichtHintergrundPackTon = { ziel: 'hintergrund', typ: 'packton', name };
      const a = (await browser.runtime.sendMessage(n)) as AntwortPackTon | undefined;
      if (!a || a.ok !== true) throw new Error('keine Antwort');
      if (!a.dataUrl) return null;
      const audio = new Audio(); // nie ins DOM gehaengt
      audio.preload = 'auto';
      audio.addEventListener('ended', () => {
        if (laufend === audio) {
          laufend = null;
          laufendName = null;
          schreibeAbbild();
        }
      });
      audio.src = a.dataUrl;
      return audio;
    } catch {
      klaenge.delete(name); // beim naechsten Mal noch einmal versuchen
      return null;
    }
  }

  function holeKlang(name: TonName): Promise<HTMLAudioElement | null> {
    const schluessel = pack ? `${pack.id}|${pack.version}|${pack.importiert}` : '';
    if (schluessel !== klangSchluessel) {
      vergissKlaenge();
      klangSchluessel = schluessel;
    }
    let p = klaenge.get(name);
    if (!p) {
      p = lade(name);
      klaenge.set(name, p);
    }
    return p;
  }

  // Testabbild: letzte Versuche plus der Klang, der gerade laeuft (mit seiner Lautstaerke), damit Tests "sofort still" messen koennen.
  function schreibeAbbild(): void {
    if (!TESTHAKEN || !testhakenAktiv()) return;
    try {
      document.documentElement.setAttribute(ATTR_ABBILD, JSON.stringify({ nr, versuche, laufend: laufendName, volume: laufend ? laufend.volume : null }));
    } catch {
      // ohne Dokument kein Abbild
    }
  }

  function notiere(name: TonName, lautstaerke: number, ergebnis: string, quelle: string): void {
    if (!TESTHAKEN) return;
    versuche.push({ nr: ++nr, name, lautstaerke, ergebnis, quelle });
    if (versuche.length > MAX_VERSUCHE) versuche.shift();
    schreibeAbbild();
  }

  // Eigene Ausnahmen gelten je Tab: in eingebetteten Rahmen zaehlt auch die Adresse des Tabs (Hintergrund fragen), wie im Schleier.
  async function tabAusgenommen(e: Einstellungen): Promise<boolean> {
    if (istOberstesFenster()) return false;
    try {
      const n: NachrichtHintergrundTab = { ziel: 'hintergrund', typ: 'tab' };
      const a = (await browser.runtime.sendMessage(n)) as Partial<AntwortTab> | undefined;
      if (a && a.ok === true && typeof a.url === 'string') return passtAusnahme(new URL(a.url), e.ausnahmen);
    } catch {
      // keine Antwort: es zaehlt nur die Adresse des Rahmens
    }
    return false;
  }

  async function spiele(name: TonName, quelle: string): Promise<void> {
    await bereit;
    if (!erlaubt()) return;
    const jetzt = performance.now();
    if (jetzt - letzterStart < TON_MIN_ABSTAND_MS) return;
    letzterStart = jetzt;
    const meine = ++startNr;
    if (einst && (await tabAusgenommen(einst))) return;
    const audio = await holeKlang(name);
    // Waehrend des Ladens kann Pause, Schalter oder ein anderes Pack dazwischengekommen sein, oder ein neuerer Klang wurde schon gestartet.
    if (!audio || meine !== startNr || !erlaubt() || !einst) return;

    stoppe();
    const lautstaerke = einst.ton.lautstaerke;
    let ergebnis = 'gespielt';
    try {
      audio.volume = lautstaerke;
      audio.currentTime = 0;
      laufend = audio;
      laufendName = name;
      await audio.play();
    } catch {
      // Der Browser erlaubt das Abspielen erst nach einer Interaktion mit der Seite: dann bleibt es still.
      ergebnis = 'abgelehnt';
      if (laufend === audio) {
        laufend = null;
        laufendName = null;
      }
    }
    notiere(name, lautstaerke, ergebnis, quelle);
  }

  const abmeldenEreignis = beiEreignis((e) => {
    const name = ANLASS[e.art];
    if (name) void spiele(name, e.art);
  });
  const abmeldenPause = beiLokalerPause(stoppe);
  const abmeldenEinst = beiEinstellungsAenderung((neu) => {
    einst = neu;
    if (!erlaubt()) stoppe();
    else if (laufend) {
      laufend.volume = neu.ton.lautstaerke;
      schreibeAbbild();
    }
  });
  const packHoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
    pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]!.newValue);
    if (!erlaubt()) stoppe();
  };
  browser.storage.onChanged.addListener(packHoerer);
  const beiAbgang = (): void => stoppe();
  window.addEventListener('pagehide', beiAbgang);

  // ---------- Testhaken ----------
  // Ereignis `veil-test` mit { ton: { ereignis: <Ereignis-Art> } } (JSON-Text oder Objekt) spielt den Klang des Anlasses, als haette das
  // Modul das Ereignis gemeldet (alle Bedingungen gelten). { ton: { abbruch: true } } beendet einen laufenden Klang.
  const beiTestEreignis = (ev: Event): void => {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const t = (detail as { ton?: { ereignis?: string; abbruch?: boolean } } | null)?.ton;
      if (!t) return;
      if (t.abbruch) return stoppe();
      const name = t.ereignis ? ANLASS[t.ereignis as EreignisArt] : undefined;
      if (name && (TON_NAMEN as readonly string[]).includes(name)) void spiele(name, `test:${t.ereignis}`);
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  };
  if (TESTHAKEN && testhakenAktiv()) document.addEventListener('veil-test', beiTestEreignis);

  ctx.onInvalidated(() => {
    abgebaut = true;
    stoppe();
    klaenge.clear();
    abmeldenEreignis();
    abmeldenPause();
    window.removeEventListener('pagehide', beiAbgang);
    if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    try {
      abmeldenEinst();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg
    }
  });
}
