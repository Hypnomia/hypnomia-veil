// Steigerung der Zensur im Content-Script (Auftrag S, PHASE-4-BAUPLAN Abschnitt 9). Zwei Aufgaben:
// 1. Wirksame Stufe kennen (Stand aus storage.local `steigerung`, nur mit Freischaltung `zensur:steigerung`, sonst 0) und dem Erkenner
//    die angehobenen Zonen geben (`wirksameZonen`, ueber den Haken in pruefung.ts). Aendert sich die Stufe, prueft der Schleier neu.
// 2. Nur die oberste Seite eines sichtbaren Tabs meldet einmal je Minute dem Hintergrund, ob sie eine Erwachsenenseite ist und wie viele
//    neue Urteile `zensiert` es seit der letzten Meldung gab. Der Hintergrund entscheidet, ob die Minute zaehlt (src/hintergrund/steigerung.ts).
// Pause: keine Meldung, Stufe gilt nicht (der Schleier prueft in der Pause ohnehin nicht).

import { istErwachsenenseite } from '../adapter/liste';
import type { Einstellungen } from '../einstellungen';
import type { NachrichtHintergrundSteigerungMinute } from '../nachrichten';
import { hebeStufe, istStrengeZeit } from '../kontrolle/streng';
import { istFreigeschaltet, type PackKurz } from '../pack/vertrag';
import { STEIGERUNG_SCHLUESSEL, vervollstaendigeStand, wirksameStufe, wirksameZonen, type SteigerungStand, type SteigerungStufe, type WirksameZonen } from '../steigerung';
import { TESTHAKEN } from './konstanten';
import { baueMinute, NeueUrteileZaehler } from './steigerung-zaehler';
import { testhakenAktiv } from './status';

const TAKT_MS = 60_000;

// Testhaken: Seitenparameter `veil-steigerung-takt=<ms>` verkuerzt den Takt (nur Testbau, nur Testhost, mindestens 200 ms).
function takt(): number {
  if (!TESTHAKEN || !testhakenAktiv()) return TAKT_MS;
  try {
    const wert = Number(new URL(location.href).searchParams.get('veil-steigerung-takt'));
    return Number.isFinite(wert) && wert >= 200 ? wert : TAKT_MS;
  } catch {
    return TAKT_MS;
  }
}

export class SteigerungMelder {
  private stand: SteigerungStand | null = null;
  private frei = false;
  private pause = false;
  // Strenge Zeiten (Auftrag Z1): nur mit Freischaltung `kontrolle:zeitplan`; null, solange keine Fenster gelten koennen.
  private zeiten: Einstellungen['kontrolle']['zeiten'] | null = null;
  private eigeneSeiten: readonly string[] = [];
  // Schleier fuer diese Seite aus (Pause, eigene Ausnahme): keine Meldung, keine Stufe.
  private aus = false;
  // Zaehlung neuer Urteile (steigerung-zaehler.ts): eine Neubewertung (Stufe, Pack, Schwelle, Ende der Pause) zaehlt nicht als neues Urteil.
  private readonly zaehler = new NeueUrteileZaehler();
  private uhr: ReturnType<typeof setInterval> | null = null;
  private letzteStufe: SteigerungStufe = 0;
  private gestoppt = false;
  private readonly hoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich !== 'local' || !(STEIGERUNG_SCHLUESSEL in aenderungen)) return;
    this.stand = vervollstaendigeStand(aenderungen[STEIGERUNG_SCHLUESSEL]?.newValue);
    this.pruefeWechsel();
  };

  // `oberste`: oberste Seite des Tabs (nur sie meldet). `beiWechsel`: die wirksame Stufe hat sich geaendert (neu pruefen).
  constructor(
    private readonly oberste: boolean,
    private readonly beiWechsel: () => void,
  ) {}

  // Liefert ein Promise, das den ersten Stand geladen hat (oder gescheitert ist): der Schleier wartet darauf vor dem ersten Pruefen,
  // damit fruehe Bilder nicht mit der Grundstufe entschieden werden.
  start(): Promise<void> {
    browser.storage.onChanged.addListener(this.hoerer);
    // Auch Frames rechnen jede Minute die Stufe nach (Abbau ueber die Zeit), nur die oberste Seite meldet.
    this.uhr = setInterval(() => this.tick(), takt());
    return browser.storage.local
      .get(STEIGERUNG_SCHLUESSEL)
      .then((ablage) => {
        if (this.gestoppt || this.stand) return;
        this.stand = vervollstaendigeStand(ablage[STEIGERUNG_SCHLUESSEL]);
        this.pruefeWechsel();
      })
      .catch(() => {});
  }

  stopp(): void {
    this.gestoppt = true;
    // Zuerst den Zeitgeber: removeListener kann bei ungueltigem Erweiterungskontext werfen.
    if (this.uhr) clearInterval(this.uhr);
    this.uhr = null;
    try {
      browser.storage.onChanged.removeListener(this.hoerer);
    } catch {
      // Kontext schon ungueltig: der Listener ist mit ihm weg.
    }
  }

  // Nach jeder Aenderung von Einstellungen oder Pack (wendeEinstellungenAn).
  aktualisiere(e: Einstellungen, pack: PackKurz | null, aus: boolean): void {
    this.frei = istFreigeschaltet(pack, 'zensur:steigerung');
    this.pause = e.pause;
    this.zeiten = istFreigeschaltet(pack, 'kontrolle:zeitplan') && e.kontrolle.zeiten.length > 0 ? e.kontrolle.zeiten : null;
    this.aus = aus;
    this.eigeneSeiten = e.erwachsen.eigeneSeiten;
    this.letzteStufe = this.stufe();
  }

  // Wirksame Stufe jetzt (0 ohne Freischaltung, in der Pause oder ohne Stand). In einer strengen Zeit eine Stufe hoeher (hoechstens 4); der
  // gespeicherte Stand aendert sich dadurch nie. Den Wechsel am Rand eines Fensters erkennt der Minuten-Takt (`tick` ruft `pruefeWechsel`).
  stufe(): SteigerungStufe {
    if (!this.frei || this.pause || !this.stand) return 0;
    const jetzt = Date.now();
    const basis = wirksameStufe(this.stand, jetzt);
    const streng = this.zeiten !== null && istStrengeZeit(this.zeiten, new Date(jetzt));
    return hebeStufe(basis, streng) as SteigerungStufe;
  }

  // Zonen fuer den Erkenner bei der aktuellen Stufe; null bei Stufe 0 (dann gelten die Einstellungen unveraendert).
  zonenFuer(e: Einstellungen): WirksameZonen | null {
    const s = this.stufe();
    return s === 0 ? null : wirksameZonen(e, s);
  }

  // Ein Element hat gerade das Urteil `zensiert` bekommen (vorher ein anderes). Zaehlt nur neue Inhalte (Quelle oder Stil anders als bei der
  // letzten Meldung dieses Elements).
  zensiert(el: Element): boolean {
    return this.zaehler.zensiert(el as HTMLImageElement);
  }

  private pruefeWechsel(): void {
    const s = this.stufe();
    if (s === this.letzteStufe) return;
    this.letzteStufe = s;
    this.beiWechsel();
  }

  private tick(): void {
    if (this.gestoppt) return;
    this.pruefeWechsel();
    const minute = baueMinute(
      { oberste: this.oberste, frei: this.frei, pause: this.pause, aus: this.aus, sichtbar: document.visibilityState === 'visible' },
      this.zaehler,
      () => istErwachsenenseite(location.href, this.eigeneSeiten),
    );
    if (!minute) return;
    const nachricht: NachrichtHintergrundSteigerungMinute = { ziel: 'hintergrund', typ: 'steigerung-minute', ...minute };
    browser.runtime.sendMessage(nachricht).catch(() => {});
  }
}
