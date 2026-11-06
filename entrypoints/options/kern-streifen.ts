// Einstellungsseite, Abschnitt "Add the Mia Pack" (Phase 7, Auftrag I3): ohne Pack ein kleiner Streifen mit 3 Kern-Bildern und darunter als echter Text,
// was das Pack dazu bringt. Mit Pack kein Streifen. Ohne Kern-Bilder im Bau bleibt alles weg (kein leerer Rahmen, kein Text ohne Bild).
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { zeigeKernBilder } from '../../src/oberflaeche/kern-platz';
import './kern-streifen.css';

const streifen = document.getElementById('kern-streifen') as HTMLDivElement;
const bilder = document.getElementById('kern-bilder') as HTMLDivElement;
let gezeigt = false;
let lauf = 0;

async function zeichne(pack: PackKurz | null): Promise<void> {
  const meiner = ++lauf;
  if (pack) {
    streifen.hidden = true;
    return;
  }
  if (gezeigt) {
    streifen.hidden = false;
    return;
  }
  const n = await zeigeKernBilder(bilder, 3, () => meiner === lauf);
  if (meiner !== lauf) return;
  gezeigt = n > 0;
  streifen.hidden = n === 0;
}

void ladePackKurz().then(zeichne, () => zeichne(null));
const horcher = (aenderungen: Record<string, unknown>, bereich: string): void => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) void ladePackKurz().then(zeichne, () => zeichne(null));
};
browser.storage.onChanged.addListener(horcher);
window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(horcher), { once: true });
