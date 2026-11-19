// Einstellungsseite: Einstieg der Module und Abschnitt 'Adult sites' (eigene Seiten, Quiz, Calm mode) mit Begruessung.
// Session 12 (Vertragsschritt): der Pack-Teil liegt jetzt in pack.ts (Auftrag P).
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
// Phase 9 (Vertrag mit Paket C): die Pack-Karte baut pack-karte.ts beim Import synchron in #stand, darum steht der Import ganz oben.
import './pack-karte';
import { hostAus } from '../../src/adapter/liste';
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { hatErwachsenFunktionen, waehleSatz } from '../../src/oberflaeche/erwachsen';
import { zeigeChibi } from '../../src/oberflaeche/chibi-platz';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import type { Texte } from '../../src/quiz/vertrag';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';
import { speichere } from './grund-speichern';
import { haengeStufenwahl } from './bedienung-stufen';
import { STUFENLISTEN } from '../../src/oberflaeche/bausteine/bausteine';
import { FREILEGEN_TEXTE, VERWEIGERN_TEXTE } from './bedienung-texte';
import { augenpaar } from '../../src/oberflaeche/design/motive';
// Phase 5: Abschnitt "Mia’s control" (eigenes Modul).
import './kontrolle';
import './werbung-aus';
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
// Phase 11 E4d1: Reiter (alle Abschnitte stehen vorher im Dokument, ein Anker der Adresse oeffnet den Reiter, bevor ordnung.ts den Sprung haelt).
import './reiter';
// Phase 9: Gruppen, Hilfe-Knoepfe und Reihenfolge (muss nach den Modulen laufen, die ihre Abschnitte fuellen).
import './ordnung';
import { belebeRegler } from '../../src/oberflaeche/design/regler';

belebeRegler(); // Phase 8b: gemeinsamer Regler, Fuellung bis zum Wert auch in Chromium

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

// ---------- Adult sites ----------

// Phase 8b: Mias Spiral-Augen vor dem Titel (nur Zierde, aria-hidden, der Titeltext bleibt unveraendert).
document.querySelector('header h1')?.prepend(augenpaar(30));

const seiteForm = el<HTMLFormElement>('seite-form');
const seiteFeld = el<HTMLInputElement>('seite-feld');
const seiteMeldung = el<HTMLParagraphElement>('seite-meldung');
const seitenListe = el<HTMLUListElement>('seiten-liste');
const ruhig = el<HTMLInputElement>('ruhig');
const erwPackHinweis = el<HTMLParagraphElement>('erw-pack-hinweis');
const begruessung = el<HTMLDivElement>('begruessung');
const begruessungText = el<HTMLParagraphElement>('begruessung-text');
const begruessungChibi = el<HTMLImageElement>('begruessung-chibi');

// F3 (E4d2): Verweigern und Freilegen als Stufen mit Namen, der Regler steht im Aufklapper "Exact value".
const verweigernWahl = haengeStufenwahl(el('verweigern-ort'), 'verweigern-wahl', {
  titel: VERWEIGERN_TEXTE.titel,
  liste: STUFENLISTEN.verweigern,
  exakt: VERWEIGERN_TEXTE.exakt,
  hinweisFuer: () => VERWEIGERN_TEXTE.hinweis,
  lies: (e) => e.quiz.verweigern,
  schreibe: (alt, wert) => ({ quiz: { ...alt.quiz, verweigern: wert } }),
});
const freilegenWahl = haengeStufenwahl(el('freilegen-ort'), 'freilegen-wahl', {
  titel: FREILEGEN_TEXTE.titel,
  liste: STUFENLISTEN.freilegen,
  exakt: FREILEGEN_TEXTE.exakt,
  lies: (e) => e.quiz.freilegenMs,
  schreibe: (alt, wert) => ({ quiz: { ...alt.quiz, freilegenMs: wert } }),
});

let gezeichneteListe = '';
let ausnahmenListe: string[] = [];
// `erzwingen`: auch Regler mit Fokus auf den gespeicherten Stand setzen (nach einem gescheiterten Speichern, Fund 26).
function zeichneErwachsen(e: Einstellungen, erzwingen = false): void {
  ausnahmenListe = e.ausnahmen;
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
  verweigernWahl.zeichne(e, erzwingen);
  freilegenWahl.zeichne(e, erzwingen);
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
  // Phase 9, Fund 11: steht der Host schon bei den Seiten, die ich in Ruhe lasse, wirkte die Zeile gegenteilig: Satz statt stillem Doppel.
  if (ausnahmenListe.some((m) => passtAusnahme(new URL(`https://${host}/`), [m]))) {
    seiteMeldung.classList.add('fehler');
    seiteMeldung.textContent = `${host} is on my list of sites I leave alone. Remove it there first, then I can treat it as an adult site.`;
    return;
  }
  let schonDa = false;
  aendereEinstellungen((alt) => {
    schonDa = alt.erwachsen.eigeneSeiten.includes(host);
    return schonDa ? {} : { erwachsen: { ...alt.erwachsen, eigeneSeiten: [...alt.erwachsen.eigeneSeiten, host] } };
  }).then(
    () => {
      seiteMeldung.classList.remove('fehler');
      seiteMeldung.textContent = schonDa ? `${host} is on the list already.` : `${host}: I treat it like the big adult sites.`;
      seiteFeld.value = '';
    },
    () => {
      seiteMeldung.classList.add('fehler');
      seiteMeldung.textContent = FEHLER_SPEICHERN;
    },
  );
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
