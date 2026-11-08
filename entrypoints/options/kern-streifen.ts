// Einstellungsseite, Abschnitt "Add the Mia Pack" (Phase 7, Auftrag I3): ohne Pack ein kleiner Streifen mit 3 Kern-Bildern und darunter als echter Text,
// was das Pack dazu bringt. Mit Pack kein Streifen. Ohne Kern-Bilder im Bau bleibt alles weg (kein leerer Rahmen, kein Text ohne Bild).
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { zeigeKernBilder } from '../../src/oberflaeche/kern-platz';
import { neuesBlobRegister } from '../../src/oberflaeche/blob-register';
import { leseDatei, leseMeta } from '../../src/pack/db';
import { waehleVorschauNamen } from '../../src/pack/wahl';
import { TESTHAKEN } from '../../src/schleier/konstanten';
import './kern-streifen.css';

const streifen = document.getElementById('kern-streifen') as HTMLDivElement;
const bilder = document.getElementById('kern-bilder') as HTMLDivElement;
let gezeigt = false;
let lauf = 0;

// Mit Pack (Session 17, Wunsch der Inhaberin, UX-Rest 18 aus Phase 8b): eine Reihe Bilder der Stufe Tease aus dem Pack. Nie eine schaerfere
// Stufe (wahl.ts waehlt nur Tease). Die Blob-Adressen werden beim Neuzeichnen und beim Verlassen der Seite freigegeben.
const reiheZeile = document.getElementById('pack-bildreihe-zeile') as HTMLDivElement | null;
const reihe = document.getElementById('pack-bildreihe') as HTMLDivElement | null;
const blobs = neuesBlobRegister((a) => URL.revokeObjectURL(a));
let reiheLauf = 0;
let reiheSchluessel = '';
window.addEventListener('pagehide', () => blobs.gibAlleFrei());

async function zeichneReihe(pack: PackKurz | null): Promise<void> {
  if (!reiheZeile || !reihe) return;
  const meiner = ++reiheLauf;
  if (!pack || !istFreigeschaltet(pack, 'erwachsen:vorschau')) {
    reiheSchluessel = '';
    blobs.gibAlleFrei();
    reihe.replaceChildren();
    reiheZeile.hidden = true;
    return;
  }
  const schluessel = `${pack.id}|${pack.version}|${pack.importiert}`;
  if (schluessel === reiheSchluessel && !reiheZeile.hidden) return;
  const adressen: string[] = [];
  const namen: string[] = [];
  try {
    const meta = await leseMeta();
    if (meiner !== reiheLauf || !meta) return;
    const dateien = meta.dateien.filter((d) => d.rolle === 'vorschau');
    const wahl = waehleVorschauNamen(dateien, 'tease', schluessel);
    for (const name of wahl) {
      if (adressen.length >= 3) break;
      const datei = await leseDatei(name).catch(() => null);
      if (meiner !== reiheLauf) {
        for (const a of adressen) blobs.gibFrei(a);
        return;
      }
      if (!datei?.blob) continue;
      const adresse = URL.createObjectURL(datei.blob);
      blobs.merke(adresse);
      const ok = await new Promise<boolean>((fertig) => {
        const probe = new Image();
        probe.addEventListener('load', () => fertig(true), { once: true });
        probe.addEventListener('error', () => fertig(false), { once: true });
        probe.src = adresse;
      });
      if (meiner !== reiheLauf) {
        blobs.gibFrei(adresse);
        for (const a of adressen) blobs.gibFrei(a);
        return;
      }
      if (!ok) {
        blobs.gibFrei(adresse);
        continue;
      }
      adressen.push(adresse);
      namen.push(name);
    }
  } catch {
    // ohne lesbare Bilder bleibt die Reihe weg
  }
  if (meiner !== reiheLauf) return;
  const bilder = adressen.map((a) => {
    const b = new Image();
    b.alt = '';
    b.decoding = 'async';
    b.src = a;
    return b;
  });
  const alte = [...reihe.querySelectorAll('img')].map((i) => i.src);
  reihe.replaceChildren(...bilder);
  for (const a of alte) blobs.gibFrei(a);
  if (TESTHAKEN) reihe.setAttribute('data-veil-bildreihe', namen.join(','));
  reiheSchluessel = bilder.length ? schluessel : '';
  reiheZeile.hidden = bilder.length === 0;
}

async function zeichne(pack: PackKurz | null): Promise<void> {
  void zeichneReihe(pack);
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
