// Einstellungsseite, Abschnitt "Sound" (Auftrag T, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 7, Entscheidungen 19 und 133): Schalter (aus),
// Regler 0 bis 100, "Play a sample" (spielt hier auf der Einstellungsseite) und ein Satz zu Quiz, Trigger-Woertern und Ausnahmen. Ohne Pack
// (oder mit einem Pack ohne Klaenge) steht ein Hinweis da; Schalter und Regler lassen sich trotzdem stellen, nur die Probe ruht. Alle Texte
// per textContent. Die Klaenge holt der Hintergrund aus dem Pack (`packton`).
import './ton.css';
import { speichere } from './grund-speichern';
import { TON_LAUTSTAERKE_STANDARD, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import type { AntwortPackTon, NachrichtHintergrundPackTon } from '../../src/nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { TESTHAKEN } from '../../src/schleier/konstanten';
import { TON_TEXTE } from '../../src/ton/texte';
import { TON_NAMEN, type TonName } from '../../src/ton/vertrag';

// Testabbild (nur Testbau): JSON am Probe-Knopf mit Name, Lautstaerke und Ergebnis des letzten Abspielversuchs.
const ATTR_ABBILD: string = TESTHAKEN ? 'data-veil-ton' : '';
// Welcher Klang als Probe dient: der erste, den das Pack mitbringt.
const PROBE_REIHE: readonly TonName[] = ['richtig', 'quiz', 'trigger', 'falsch', 'verweigert'];

const abschnitt = document.getElementById('ton');
if (abschnitt) {
  const neu = <K extends keyof HTMLElementTagNameMap>(tag: K, eigenschaften: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    const { class: klasse, ...rest } = eigenschaften as Record<string, unknown>;
    Object.assign(e, rest);
    if (typeof klasse === 'string') e.className = klasse;
    return e;
  };

  const titel = neu('h2', { id: 'ton-titel', textContent: TON_TEXTE.titel });
  const hinweis = neu('p', { id: 'ton-pack-hinweis', class: 'hinweis' });

  const schalterZeile = neu('label', { class: 'schalter', id: 'ton-an-zeile' });
  const an = neu('input', { id: 'ton-an', type: 'checkbox' });
  an.setAttribute('role', 'switch');
  const regler = neu('span', { class: 'regler' });
  regler.setAttribute('aria-hidden', 'true');
  const schalterText = neu('span', { class: 'text' });
  schalterText.append(
    neu('strong', { textContent: TON_TEXTE.schalterTitel }),
    neu('small', { textContent: TON_TEXTE.schalterHinweis }),
  );
  schalterZeile.append(an, regler, schalterText);

  const lautZeile = neu('div', { class: 'regel', id: 'ton-lautstaerke-zeile' });
  const lautLabel = neu('label', { textContent: TON_TEXTE.lautstaerke, htmlFor: 'ton-lautstaerke' });
  const lautWert = neu('output', { id: 'ton-lautstaerke-wert' });
  lautWert.htmlFor.add('ton-lautstaerke');
  lautZeile.append(lautLabel, lautWert);
  const laut = neu('input', { id: 'ton-lautstaerke', type: 'range', min: '0', max: '100', step: '1' });

  const probeZeile = neu('div', { class: 'ton-probe' });
  const probe = neu('button', { id: 'ton-probe', class: 'klein', type: 'button', textContent: TON_TEXTE.probe });
  const probeMeldung = neu('p', { id: 'ton-probe-meldung' });
  probeMeldung.setAttribute('role', 'status');
  probeMeldung.setAttribute('aria-live', 'polite');
  probeZeile.append(probe, probeMeldung);

  const regel = neu('p', {
    class: 'hinweis',
    id: 'ton-regel',
    textContent: TON_TEXTE.regel,
  });

  abschnitt.append(titel, hinweis, schalterZeile, lautZeile, laut, probeZeile, regel);

  let pack: PackKurz | null = null;
  let zuletzt: Einstellungen | null = null;
  let probeAudio: HTMLAudioElement | null = null;

  const prozent = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 100);
  function zeigeLautstaerke(p: number): void {
    lautWert.textContent = `${p}%`;
    laut.setAttribute('aria-valuetext', `${p} percent`);
  }

  function zeichnePack(): void {
    const mit = istFreigeschaltet(pack, 'ton');
    // Fund 24: in der Pause bleibt die Probe frei, ihr Klick sagt, warum es still bleibt (TON_TEXTE.probePause).
    probe.disabled = !mit;
    hinweis.textContent = mit ? TON_TEXTE.hinweisMitTon : pack ? TON_TEXTE.hinweisAltesPack : TON_TEXTE.hinweisOhnePack;
    if (!mit) probeMeldung.textContent = '';
  }

  // `erzwingen`: auch den Regler mit Fokus neu zeichnen (nach dem eigenen Speichern).
  function zeichne(e: Einstellungen, erzwingen = false): void {
    zuletzt = e;
    probe.disabled = !istFreigeschaltet(pack, 'ton');
    // Fund 24: der Satz aus der Pause verschwindet, sobald Mia wieder da ist.
    if (!e.pause && probeMeldung.textContent === TON_TEXTE.probePause) probeMeldung.textContent = '';
    an.checked = e.ton.an;
    if (erzwingen || document.activeElement !== laut) laut.value = String(prozent(e.ton.lautstaerke));
    zeigeLautstaerke(Number(laut.value));
  }

  // Fund 26: Speichern ueber die gemeinsame Stelle (Fehlersatz in der Leiste, Schalter und Regler springen auf den gespeicherten Stand).
  an.addEventListener('change', () => {
    const wert = an.checked;
    void speichere((alt) => ({ ton: { ...alt.ton, an: wert } }), (e) => zeichne(e, true));
  });
  laut.addEventListener('input', () => zeigeLautstaerke(Number(laut.value)));
  laut.addEventListener('change', () => {
    const v = Number(laut.value);
    if (!Number.isFinite(v)) return;
    // Nach dem Speichern den gespeicherten Stand zeigen, aber nur, wenn der Regler seither nicht weitergeschoben wurde (schnelle Tastenfolge).
    void speichere(
      (alt) => ({ ton: { ...alt.ton, lautstaerke: Math.min(Math.max(v, 0), 100) / 100 } }),
      (e) => {
        if (Number(laut.value) === v) zeichne(e, true);
      },
    );
  });
  laut.addEventListener('blur', () => zuletzt && zeichne(zuletzt, true));

  async function holeProbe(): Promise<{ name: TonName; dataUrl: string } | null> {
    for (const name of PROBE_REIHE) {
      if (!(TON_NAMEN as readonly string[]).includes(name)) continue;
      try {
        const n: NachrichtHintergrundPackTon = { ziel: 'hintergrund', typ: 'packton', name };
        const a = (await browser.runtime.sendMessage(n)) as AntwortPackTon | undefined;
        if (a?.ok === true && a.dataUrl) return { name, dataUrl: a.dataUrl };
      } catch {
        // dieser Klang ist nicht zu haben, der naechste vielleicht
      }
    }
    return null;
  }

  function notiere(name: TonName | null, lautstaerke: number, ergebnis: string): void {
    if (!TESTHAKEN) return;
    probe.setAttribute(ATTR_ABBILD, JSON.stringify({ name, lautstaerke, ergebnis }));
  }

  probe.addEventListener('click', async () => {
    if (probe.disabled) return;
    if (zuletzt?.pause) {
      probeMeldung.textContent = TON_TEXTE.probePause;
      return;
    }
    probe.disabled = true;
    try {
      const klang = await holeProbe();
      const lautstaerke = Number(laut.value) / 100;
      if (!klang) {
        probeMeldung.textContent = TON_TEXTE.probeKeinKlang;
        notiere(null, lautstaerke, 'ohne-klang');
        return;
      }
      probeAudio?.pause();
      const audio = new Audio(); // nie ins DOM gehaengt
      audio.src = klang.dataUrl;
      audio.volume = lautstaerke;
      probeAudio = audio;
      try {
        await audio.play();
        probeMeldung.textContent = lautstaerke > 0 ? TON_TEXTE.probeGespielt : TON_TEXTE.probeStumm;
        notiere(klang.name, lautstaerke, 'gespielt');
      } catch {
        probeMeldung.textContent = TON_TEXTE.probeAbgelehnt;
        notiere(klang.name, lautstaerke, 'abgelehnt');
      }
    } finally {
      probe.disabled = !istFreigeschaltet(pack, 'ton');
    }
  });

  beiEinstellungsAenderung((e) => {
    // Pause oder Schalter aus beendet auch einen laufenden Probeklang (Regel 8).
    if ((e.pause && !zuletzt?.pause) || (zuletzt?.ton.an && !e.ton.an)) probeAudio?.pause();
    zeichne(e);
  });
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
    pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
    zeichnePack();
  });

  zeigeLautstaerke(prozent(TON_LAUTSTAERKE_STANDARD));
  laut.value = String(prozent(TON_LAUTSTAERKE_STANDARD));
  zeichnePack();
  void Promise.all([ladeEinstellungen(), ladePackKurz()]).then(([e, p]) => {
    pack = p;
    zeichnePack();
    zeichne(e, true);
  });
}
