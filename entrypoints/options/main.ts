// Einstellungsseite: Einstieg der Module und Abschnitt 'Adult sites' (eigene Seiten, Quiz, Calm mode) mit Begruessung.
// Session 12 (Vertragsschritt): der Pack-Teil liegt jetzt in pack.ts (Auftrag P).
import { FREILEGEN_MAX_MS, FREILEGEN_MIN_MS, VERWEIGERN_MAX, VERWEIGERN_MIN, aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { hostAus } from '../../src/adapter/liste';
import { hatErwachsenFunktionen, waehleSatz } from '../../src/oberflaeche/erwachsen';
import { zeigeChibi } from '../../src/oberflaeche/chibi-platz';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import type { Texte } from '../../src/quiz/vertrag';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';
import { speichere } from './grund-speichern';
// Phase 5: Abschnitt "Mia’s control" (eigenes Modul).
import './kontrolle';
// Session 11 (Auftrag S): Grundeinstellungen, Ausnahmen, Einstieg und Pack-Sperre als eigene Module.
import './grund';
import './grund-ausnahmen';
import './grund-pack';
import './grund-erwachsen';
import './kern-streifen';
// Session 11: eigene Module je Auftrag (Ton T, Ledger L, Ueber/Version V), jedes fuellt nur seinen Abschnitt.
import './ton';
import './ledger';
import './ueber';
// Session 12: Mia Pack (Auftrag P).
import './pack';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

// ---------- Adult sites ----------

const seiteForm = el<HTMLFormElement>('seite-form');
const seiteFeld = el<HTMLInputElement>('seite-feld');
const seiteMeldung = el<HTMLParagraphElement>('seite-meldung');
const seitenListe = el<HTMLUListElement>('seiten-liste');
const verweigern = el<HTMLInputElement>('verweigern');
const verweigernWert = el<HTMLOutputElement>('verweigern-wert');
const freilegen = el<HTMLInputElement>('freilegen');
const freilegenWert = el<HTMLOutputElement>('freilegen-wert');
const ruhig = el<HTMLInputElement>('ruhig');
const erwPackHinweis = el<HTMLParagraphElement>('erw-pack-hinweis');
const begruessung = el<HTMLDivElement>('begruessung');
const begruessungText = el<HTMLParagraphElement>('begruessung-text');
const begruessungChibi = el<HTMLImageElement>('begruessung-chibi');

verweigern.min = String(Math.round(VERWEIGERN_MIN * 100));
verweigern.max = String(Math.round(VERWEIGERN_MAX * 100));
freilegen.min = String(FREILEGEN_MIN_MS / 1000);
freilegen.max = String(FREILEGEN_MAX_MS / 1000);

let gezeichneteListe = '';
// `erzwingen`: auch Regler mit Fokus auf den gespeicherten Stand setzen (nach einem gescheiterten Speichern, Fund 26).
function zeichneErwachsen(e: Einstellungen, erzwingen = false): void {
  const schluessel = JSON.stringify(e.erwachsen.eigeneSeiten);
  // Nur neu bauen, wenn sich die Liste aendert (fremde Aenderungen wie Pause aus dem Popup lassen den Fokus in Ruhe).
  if (schluessel !== gezeichneteListe) {
    gezeichneteListe = schluessel;
    const fokusHost = (document.activeElement as HTMLElement | null)?.dataset?.host ?? null;
    seitenListe.replaceChildren();
    for (const host of e.erwachsen.eigeneSeiten) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = host;
      const weg = document.createElement('button');
      weg.type = 'button';
      weg.className = 'klein ruhig';
      weg.dataset.host = host;
      weg.textContent = 'Remove';
      weg.setAttribute('aria-label', `Remove ${host}`);
      weg.addEventListener('click', () => {
        const stelle = (JSON.parse(gezeichneteListe) as string[]).indexOf(host);
        void aendereEinstellungen((alt) => ({ erwachsen: { ...alt.erwachsen, eigeneSeiten: alt.erwachsen.eigeneSeiten.filter((h) => h !== host) } })).then(
          (neu) => {
            // Fokus nicht verlieren: naechster Remove-Knopf, sonst der vorherige, sonst das Eingabefeld.
            zeichneErwachsen(neu);
            const knoepfe = seitenListe.querySelectorAll<HTMLButtonElement>('button');
            (knoepfe[Math.min(stelle, knoepfe.length - 1)] ?? seiteFeld).focus();
          },
          () => {
            seiteMeldung.classList.add('fehler');
            seiteMeldung.textContent = FEHLER_SPEICHERN;
          },
        );
      });
      li.append(name, weg);
      seitenListe.append(li);
      if (host === fokusHost) weg.focus();
    }
  }
  if (erzwingen || document.activeElement !== verweigern) verweigern.value = String(Math.round(e.quiz.verweigern * 100));
  verweigernWert.textContent = `${Math.round(e.quiz.verweigern * 100)}%`;
  verweigern.setAttribute('aria-valuetext', verweigernWert.textContent);
  if (erzwingen || document.activeElement !== freilegen) freilegen.value = String(Math.round(e.quiz.freilegenMs / 1000));
  freilegenWert.textContent = `${Math.round(e.quiz.freilegenMs / 1000)} s`;
  freilegen.setAttribute('aria-valuetext', freilegenWert.textContent);
  ruhig.checked = e.ruhig;
}

seiteForm.addEventListener('submit', (ereignis) => {
  ereignis.preventDefault();
  const host = hostAus(seiteFeld.value);
  seiteMeldung.classList.toggle('fehler', !host);
  if (!host) {
    seiteMeldung.textContent = 'That doesn’t look like a site address. Try something like example.com.';
    return;
  }
  let schonDa = false;
  aendereEinstellungen((alt) => {
    schonDa = alt.erwachsen.eigeneSeiten.includes(host);
    return schonDa ? {} : { erwachsen: { ...alt.erwachsen, eigeneSeiten: [...alt.erwachsen.eigeneSeiten, host] } };
  }).then(
    () => {
      seiteMeldung.classList.remove('fehler');
      seiteMeldung.textContent = schonDa ? `${host} is on the list already.` : `Added ${host}. I’ll treat it like the rest.`;
      seiteFeld.value = '';
    },
    () => {
      seiteMeldung.classList.add('fehler');
      seiteMeldung.textContent = FEHLER_SPEICHERN;
    },
  );
});

verweigern.addEventListener('input', () => {
  verweigernWert.textContent = `${verweigern.value}%`;
  verweigern.setAttribute('aria-valuetext', verweigernWert.textContent);
});
verweigern.addEventListener('change', () => {
  const wert = Number(verweigern.value) / 100;
  void speichere((alt) => ({ quiz: { ...alt.quiz, verweigern: wert } }), (e) => zeichneErwachsen(e, true), false);
});
freilegen.addEventListener('input', () => {
  freilegenWert.textContent = `${freilegen.value} s`;
  freilegen.setAttribute('aria-valuetext', freilegenWert.textContent);
});
freilegen.addEventListener('change', () => {
  const wert = Number(freilegen.value) * 1000;
  void speichere((alt) => ({ quiz: { ...alt.quiz, freilegenMs: wert } }), (e) => zeichneErwachsen(e, true), false);
});
ruhig.addEventListener('change', () => {
  const wert = ruhig.checked;
  void speichere(() => ({ ruhig: wert }), (e) => zeichneErwachsen(e, true), false);
});

// Begruessung mit Chibi, solange ein Pack drin ist (Platz `chibi`, ohne Bild nur Text). Satz aus der Pack-Gruppe `begruessung`, sonst eingebaut.
let begruessungFuer = '';
// Begruessung: nur kurz nach einem Import (unter einer Minute) und nur einmal je Import (storage.local `begruesstFuer`).
const BEGRUESST_SCHLUESSEL = 'begruesstFuer';
async function zeichneBegruessung(pack: PackKurz | null): Promise<void> {
  const kennung = pack ? `${pack.id}|${pack.importiert}` : '';
  let mitPack = !!pack && begruessungFuer === kennung;
  if (pack && !mitPack && Date.now() - pack.importiert < 60_000) {
    try {
      mitPack = (await browser.storage.local.get(BEGRUESST_SCHLUESSEL))[BEGRUESST_SCHLUESSEL] !== kennung;
      if (mitPack) await browser.storage.local.set({ [BEGRUESST_SCHLUESSEL]: kennung });
    } catch {
      mitPack = false;
    }
  }
  erwPackHinweis.textContent = hatErwachsenFunktionen(pack)
    ? 'Everything here is yours to set.'
    : pack
      ? 'These settings need a newer Mia Pack than yours. Set them now and they’ll be ready.'
      : 'These settings only work with the Mia Pack. Set them now and they’ll be ready.';
  begruessung.hidden = !mitPack;
  if (!pack || !mitPack) {
    begruessungFuer = '';
    return;
  }
  if (begruessungFuer === kennung) return;
  begruessungFuer = kennung;
  let texte: Texte | null = null;
  try {
    const a = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' })) as { daten?: unknown } | undefined;
    const d = a?.daten as Texte | null | undefined;
    texte = d && typeof d === 'object' && 'gruppen' in d ? d : null;
  } catch {
    texte = null;
  }
  begruessungText.textContent = waehleSatz(texte?.gruppen.begruessung, "Welcome in. Make yourself comfortable.", Math.random());
  void zeigeChibi(begruessungChibi, 'jubeln', pack);
}

beiEinstellungsAenderung(zeichneErwachsen);
void ladeEinstellungen().then(zeichneErwachsen);
void ladePackKurz().then((p) => zeichneBegruessung(p));
browser.storage.onChanged.addListener((aenderungen: Record<string, unknown>, bereich: string) => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) void ladePackKurz().then((p) => zeichneBegruessung(p));
});
