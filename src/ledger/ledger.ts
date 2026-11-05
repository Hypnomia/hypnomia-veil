// Content-Script: Mia’s Ledger zaehlt die Ereignisse dieses Frames (src/ereignisse.ts) und schickt gebuendelt Summen an den Hintergrund
// (Auftrag L, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 5). Nur Zahlen, nie Adressen oder Titel. Gesendet wird hoechstens einmal je 60 s
// (Zeitgeber ab dem ersten Ereignis), beim Verbergen des Tabs und beim Verlassen der Seite. Nach ungueltigem Kontext passiert nichts mehr.
// Gemeldet wird nur, was der Kanal liefert: `zensiert` nur bei neuem Inhalt, `werbung` je Seitenelement einmal, `blitz` mit den geplanten Woertern
// (hoechstens 12). Im Testbau laeuft kein Zeitgeber von selbst: nur der Testhaken sendet (und schaltet auf Wunsch einen kurzen Zeitgeber ein).
import { beiEreignis, type VeilEreignis } from '../ereignisse';
import type { NachrichtHintergrundLedger } from '../nachrichten';
import { TESTHAKEN } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { testhakenAktiv } from '../schleier/status';
import type { LedgerPlus } from './vertrag';
import { ENDGUELTIG_ABGELEHNT, Puffer, SENDE_ABSTAND_MS } from './logik';

// Testabbild (nur Testbau): JSON am html-Element.
const ATTR_ABBILD: string = TESTHAKEN ? 'data-veil-ledger' : '';

export function starteLedger(ctx: KontextLeicht): void {
  const puffer = new Puffer();
  let abgebaut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Zeitgeber: im Betrieb an (60 s); im Testbau aus, bis der Testhaken einen kurzen Abstand einstellt.
  let abstandMs = SENDE_ABSTAND_MS;
  let zeitgeberAn = !TESTHAKEN;
  let nachrichten = 0;
  let fehlgeschlagen = 0;
  let letzte: LedgerPlus | null = null;
  let letzteAntwort: unknown = null;
  let rohAntwort: unknown = null;
  // Testabbild: Zeitpunkte (performance.now) des ersten gepufferten Ereignisses und der letzten Sendung.
  let ersteMs: number | null = null;
  let gesendetMs: number | null = null;
  const lebt = (): boolean => !abgebaut && ctx.isValid;
  const zaehle = (e: VeilEreignis): boolean => {
    const war = puffer.leer;
    const ja = puffer.zaehle(e);
    if (ja && war) ersteMs = performance.now();
    return ja;
  };

  function abbild(): void {
    if (!TESTHAKEN || !testhakenAktiv()) return;
    try {
      document.documentElement.setAttribute(ATTR_ABBILD, JSON.stringify({ nachrichten, fehlgeschlagen, letzte, antwort: letzteAntwort, rohAntwort, ersteMs, gesendetMs, gepuffert: !puffer.leer, jetzt: performance.now() }));
    } catch {
      // Dokument weg
    }
  }

  function planeSendung(): void {
    if (!zeitgeberAn || timer !== null || !lebt()) return;
    timer = setTimeout(() => {
      timer = null;
      sende();
    }, abstandMs);
  }

  function sende(): Promise<void> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!lebt() || puffer.leer) return Promise.resolve();
    const plus = puffer.nimm();
    const n: NachrichtHintergrundLedger = { ziel: 'hintergrund', typ: 'ledger', plus };
    nachrichten++;
    letzte = plus;
    gesendetMs = performance.now();
    let versprechen: Promise<unknown>;
    try {
      versprechen = Promise.resolve(browser.runtime.sendMessage(n));
    } catch {
      return Promise.resolve();
    }
    return versprechen.then(
      (antwort) => {
        letzteAntwort = antwort ?? null;
        // Nicht angenommen: war es die Pruefung (Summe oder Absender), ist die Summe verworfen; jeder andere Fehler (z. B. Speicher) laesst
        // sie im Puffer, bis sie ankommt.
        const a = antwort as { ok?: boolean; fehler?: string } | null | undefined;
        if (a?.ok !== true && !(typeof a?.fehler === 'string' && ENDGUELTIG_ABGELEHNT.includes(a.fehler)) && lebt()) {
          fehlgeschlagen++;
          puffer.zurueck(plus);
          planeSendung();
        }
        abbild();
      },
      () => {
        // Hintergrund nicht erreichbar: die Summe wartet im Puffer auf die naechste Sendung (nur solange der Kontext lebt)
        fehlgeschlagen++;
        if (lebt()) {
          puffer.zurueck(plus);
          planeSendung();
        }
        abbild();
      },
    );
  }

  const abmelden = beiEreignis((e: VeilEreignis) => {
    if (!lebt()) return;
    if (zaehle(e)) {
      planeSendung();
      abbild();
    }
  });

  const beiSichtbarkeit = (): void => {
    if (document.visibilityState === 'hidden') void sende();
  };
  const beiPagehide = (): void => {
    void sende();
  };
  document.addEventListener('visibilitychange', beiSichtbarkeit);
  window.addEventListener('pagehide', beiPagehide);

  // ---------- Testhaken ----------
  // Ereignis `veil-test` mit { ledger: { ereignis?: { art, woerter? }, senden?: boolean, takt?: number, roh?: object } } (JSON-Text oder Objekt):
  // `ereignis` zaehlt wie ein echtes Ereignis und sendet sofort (bei `takt` erst nach dem Zeitgeber); `senden` leert den Puffer sofort; `takt`
  // (ms, mindestens 50) schaltet den Zeitgeber mit diesem Abstand ein; `roh` schickt eine beliebige Nachricht aus dem Content-Script an den
  // Hintergrund (Pruefung der Absender und Werte) und legt die Antwort ins Abbild (`rohAntwort`).
  const beiTestEreignis = (ev: Event): void => {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const t = (detail as { ledger?: { ereignis?: VeilEreignis; senden?: boolean; takt?: number; roh?: object } } | null)?.ledger;
      if (!t) return;
      if (typeof t.takt === 'number' && t.takt >= 50) {
        zeitgeberAn = true;
        abstandMs = t.takt;
      }
      if (t.ereignis && typeof t.ereignis === 'object' && zaehle(t.ereignis)) {
        if (typeof t.takt === 'number') planeSendung();
        else void sende();
      }
      if (t.senden) void sende();
      if (t.roh && typeof t.roh === 'object') {
        rohAntwort = 'wartet';
        Promise.resolve(browser.runtime.sendMessage(t.roh)).then(
          (a) => {
            rohAntwort = a ?? null;
            abbild();
          },
          (e) => {
            rohAntwort = { fehlerText: String(e) };
            abbild();
          },
        );
      }
      abbild();
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  };
  if (TESTHAKEN && testhakenAktiv()) {
    document.addEventListener('veil-test', beiTestEreignis);
    abbild();
  }

  ctx.onInvalidated(() => {
    abgebaut = true;
    abmelden();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    window.removeEventListener('pagehide', beiPagehide);
    if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
  });
}
