// Testhaken des Riegels (nur Testbau, nur auf 127.0.0.1 und localhost; im Release-Bau faellt alles weg).
// Die Shadow Root bleibt auch im Testbau geschlossen. Tests sehen den Riegel ueber ein Abbild in `data-veil-riegel` (JSON am html-Element:
// Zustand, Frage, Antworten, Rechtecke der Bedienelemente) und das Ergebnis in `data-veil-riegel-ergebnis`; sie oeffnen ihn ueber das
// Ereignis `veil-test` mit `{ riegel: { oeffne: {...} } }` (siehe `testRiegel`).
import { gebundenerKontext, zeigeRiegel } from './riegel';
import { loescheErgebnis, schreibeErgebnis, testRiegelAktiv } from './testspur';

interface OeffneBefehl {
  grund?: 'video' | 'freilegen';
  frage?: string;
  verweigern?: number;
  geraet?: 'desktop' | 'touch';
  zufall?: number[];
  richtigMs?: number;
  verweigertMs?: number;
  pauseHaengt?: boolean;
  ladeVerzoegerungMs?: number;
  maxRettungen?: number;
  anker?: string;
}

// Stellt das Ende des Erweiterungskontexts nach (WXT: notifyInvalidated ruft alle onInvalidated-Rueckrufe, auch den des Riegels).
interface MitInvalidierung {
  notifyInvalidated?: () => void;
}

// Wird vom Handler des Ereignisses `veil-test` aufgerufen (Edit in src/schleier/schleier.ts).
export function testRiegel(roh: unknown): void {
  if (!testRiegelAktiv() || !roh || typeof roh !== 'object') return;
  const befehl = roh as { oeffne?: OeffneBefehl; invalidiere?: boolean };
  if (befehl.invalidiere) {
    (gebundenerKontext() as MitInvalidierung | null)?.notifyInvalidated?.();
    return;
  }
  const o = befehl.oeffne;
  if (!o) return;
  loescheErgebnis();
  let i = 0;
  const reihe = Array.isArray(o.zufall) && o.zufall.length > 0 ? o.zufall : null;
  const anker = typeof o.anker === 'string' ? document.querySelector(o.anker) : null;
  zeigeRiegel({
    grund: o.grund === 'freilegen' ? 'freilegen' : 'video',
    anker,
    ersteFrage: o.frage,
    verweigern: o.verweigern,
    geraet: o.geraet,
    zufall: reihe ? () => reihe[i++ % reihe.length]! : undefined,
    richtigMs: o.richtigMs,
    verweigertMs: o.verweigertMs,
    sendePause: o.pauseHaengt ? () => new Promise(() => {}) : undefined,
    ladeVerzoegerungMs: o.ladeVerzoegerungMs,
    maxRettungen: o.maxRettungen,
  }).then(schreibeErgebnis, () => schreibeErgebnis('fehler'));
}
