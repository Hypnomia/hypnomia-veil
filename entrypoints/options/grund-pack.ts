// Einstellungsseite, Einstieg und Pack (Session 11, Auftrag S, Entscheidung 133): das Mia Pack wartet auf den Einstieg. Solange
// `einstiegFertig` falsch ist, ist das Dateifeld gesperrt (Satz und Knopf "Meet Mia first"); der Knopf "Do the interview again" erscheint
// erst danach. Die Sperre folgt Aenderungen von `einstieg`. main.ts liest die Sperre aus `document.body.dataset.packGesperrt`.
import { EINSTIEG_SCHLUESSEL, WILLKOMMEN_PFAD, einstiegFertig, ladeEinstieg, vervollstaendigeEinstieg } from '../../src/einstieg/vertrag';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const sperre = el<HTMLDivElement>('pack-sperre');
const sperreKnopf = el<HTMLButtonElement>('pack-sperre-knopf');
const datei = el<HTMLInputElement>('datei');
const interviewAbschnitt = el<HTMLElement>('abschnitt-interview');
const interviewKnopf = el<HTMLButtonElement>('interview-neu');
const interviewChip = el<HTMLAnchorElement>('chip-interview');

function zeichne(fertig: boolean): void {
  document.body.dataset.packGesperrt = fertig ? '0' : '1';
  sperre.hidden = fertig;
  // Waehrend eines laufenden Imports bleibt das Feld ohnehin gesperrt (main.ts); hier nur die Sperre selbst.
  if (!fertig) datei.disabled = true;
  else if (!document.getElementById('annehmen')?.hasAttribute('disabled')) datei.disabled = false;
  // Fund 17: Abschnitt und Chip "Interview" erst nach dem Einstieg.
  interviewAbschnitt.hidden = !fertig;
  interviewChip.hidden = !fertig;
}

function oeffneWillkommen(anker: string): void {
  const url = browser.runtime.getURL(WILLKOMMEN_PFAD as never) + anker;
  void browser.tabs.create({ url });
}

sperreKnopf.addEventListener('click', () => oeffneWillkommen(''));
// Runde 3, N12: das Wiederholen laeuft im selben Tab; am Ende fuehrt "All settings" hierher zurueck (keine zweite Einstellungsseite).
interviewKnopf.addEventListener('click', () => window.location.assign(browser.runtime.getURL(WILLKOMMEN_PFAD as never) + '#interview'));

const horcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
  if (bereich === 'local' && EINSTIEG_SCHLUESSEL in aenderungen) zeichne(einstiegFertig(vervollstaendigeEinstieg(aenderungen[EINSTIEG_SCHLUESSEL]?.newValue)));
};
browser.storage.onChanged.addListener(horcher);
window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(horcher), { once: true });

// Das Dateifeld ist im HTML gesperrt und wird erst nach dem Lesen freigegeben. Die Pruefung beim Waehlen und beim Annehmen (main.ts) liest
// den Speicher selbst. Kann der Speicher nicht gelesen werden, gilt die Sperre.
void ladeEinstieg().then((s) => zeichne(einstiegFertig(s)), () => zeichne(false));
