// Galerie des Komplett-Ersatzes (Auftrag U, PHASE-4-BAUPLAN Abschnitt 8 Punkt 4 und 7). Die Umleitung (src/hintergrund/umleitung.ts)
// schickt Listen-Domains hierher und haengt die Originaladresse roh hinter `?ziel=`. Bilder kommen direkt aus IndexedDB (Erweiterungsseite),
// alles Pack-Material nur ueber Bildelemente und textContent, nie innerHTML. Pause: Regel weg, Pause lokal, dann sofort zurueck.
//
// Zustand: "aktiv" nur, wenn der Ersatz gilt UND `ziel` eine http(s)-Adresse auf einer Erwachsenenseite ist (Liste, eigene Seiten). Sonst
// "inaktiv": keine Pack-Bilder (bereits gezeigte werden sofort geleert). Zurueck springt die Seite nur, wenn `ziel` auf einer Erwachsenenseite
// liegt (keine offene Weiterleitung auf fremde Hosts); sonst zeigt sie nur den Hostnamen als Text. Im Rahmen (iframe) tut sie nichts.
import links from '../../data/links.json' with { type: 'json' };
import { alleDomains } from '../../src/adapter/liste';
import { demoChibiAdresse, passtZurPose } from '../../src/chibi';
import { SPEICHER_SCHLUESSEL, aendereEinstellungen, ladeEinstellungen } from '../../src/einstellungen';
import { GALERIE_ZIEL_PARAMETER, UMLEITUNG_REGEL_ID, ersatzAktiv } from '../../src/hintergrund/umleitung';
import { leseDatei, leseNamenMitRolle } from '../../src/pack/db';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz } from '../../src/pack/vertrag';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

const MAX_BILDER = 24;

// Gerahmt (iframe): nichts zeigen, nichts tun. Die Regel greift nur fuer oberste Seiten, ein Rahmen darf hier nichts ausloesen.
if (window.top !== window) {
  document.body.replaceChildren();
} else {
  void haupt();
}

async function haupt(): Promise<void> {
  const status = el<HTMLParagraphElement>('status');
  const zielZeile = el<HTMLParagraphElement>('ziel-zeile');
  const bilderBox = el<HTMLDivElement>('bilder');
  const bilderLeer = el<HTMLParagraphElement>('bilder-leer');
  const pauseKnopf = el<HTMLButtonElement>('pause');
  const chibiBox = el<HTMLDivElement>('chibi');
  const chibiBild = el<HTMLImageElement>('chibi-bild');

  // Originaladresse: alles hinter `?ziel=`, roh (die Adresse hat selbst `?` und `&`). Nur http und https, sonst null.
  function leseZiel(): URL | null {
    const marke = `?${GALERIE_ZIEL_PARAMETER}=`;
    const i = location.href.indexOf(marke);
    if (i < 0) return null;
    try {
      const url = new URL(location.href.slice(i + marke.length));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  const ziel = leseZiel();
  const passt = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
  // Liegt der Host von `ziel` auf einer Erwachsenenseite (Liste, eigene Seiten)? Nur dann darf die Seite dorthin zurueck.
  const zielErlaubt = (eigene: string[]): boolean => !!ziel && alleDomains(eigene).some((d) => passt(ziel.hostname.toLowerCase(), d));

  let geht = false;
  let lauf = 0; // erhoeht bei jeder Zustandsaenderung; laufende Ladevorgaenge brechen ab, wenn er sich geaendert hat
  let bilderDa = false;
  let chibiDa = false;

  function leereAnzeige(): void {
    lauf++;
    bilderDa = false;
    chibiDa = false;
    bilderBox.replaceChildren();
    bilderLeer.hidden = true;
    chibiBox.hidden = true;
    chibiBild.removeAttribute('src');
  }

  // Blob-Adresse nach dem Laden freigeben (das Bild bleibt im Element).
  function mitBlob(bild: HTMLImageElement, blob: Blob): void {
    const adresse = URL.createObjectURL(blob);
    const frei = () => URL.revokeObjectURL(adresse);
    bild.addEventListener('load', frei, { once: true });
    bild.addEventListener('error', frei, { once: true });
    bild.src = adresse;
  }

  async function entferneRegel(): Promise<void> {
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [UMLEITUNG_REGEL_ID] }).catch(() => undefined);
  }

  // Regel weg, dann zurueck zur Originaladresse. Der Hintergrund bekommt die Abgleich-Nachricht ohne Warten hinterher.
  async function kehreZurueck(): Promise<void> {
    if (geht || !ziel) return;
    geht = true;
    pauseKnopf.disabled = true;
    leereAnzeige();
    await entferneRegel();
    void browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'umleitung-abgleich' }).catch(() => undefined);
    location.replace(ziel.href);
  }

  async function pausiere(): Promise<void> {
    pauseKnopf.disabled = true;
    status.textContent = 'Paused. Taking you back.';
    leereAnzeige();
    // Zuerst die Regel selbst entfernen, dann Pause lokal festhalten (gilt auch, wenn der Hintergrund schlaeft), dann sofort zurueck.
    await entferneRegel();
    await aendereEinstellungen({ pause: true }).catch(() => undefined);
    if (zielErlaubt((await ladeEinstellungen().catch(() => null))?.erwachsen.eigeneSeiten ?? [])) await kehreZurueck();
    else status.textContent = 'I’m out of your way now. Close this tab whenever you like.';
  }

  function setzeLink(id: string, adresse: unknown): void {
    const a = el<HTMLAnchorElement>(id);
    if (typeof adresse === 'string' && /^https:\/\//.test(adresse)) a.href = adresse;
    else a.hidden = true;
  }

  function mische<T>(liste: T[]): T[] {
    const kopie = [...liste];
    for (let i = kopie.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [kopie[i], kopie[j]] = [kopie[j]!, kopie[i]!];
    }
    return kopie;
  }

  async function zeigeBilder(meiner: number): Promise<void> {
    const namen = mische(await leseNamenMitRolle('vorschau')).slice(0, MAX_BILDER);
    let gezeigt = 0;
    for (const name of namen) {
      const datei = await leseDatei(name).catch(() => null);
      if (meiner !== lauf) return; // inzwischen inaktiv oder neu gestartet
      if (!datei || !datei.typ.startsWith('image/')) continue;
      const bild = document.createElement('img');
      bild.alt = 'Mia';
      bild.decoding = 'async';
      mitBlob(bild, datei.blob);
      bilderBox.append(bild);
      gezeigt++;
    }
    bilderLeer.hidden = gezeigt > 0;
  }

  // Chibi "thron": Pack-Chibi mit `chibi:pack` (nur echte Bilder), sonst das Demo-Chibi, sonst bleibt der Platz zu.
  async function zeigeChibi(meiner: number): Promise<void> {
    const pack = await ladePackKurz();
    let blob: Blob | null = null;
    let adresse: string | null = null;
    if (istFreigeschaltet(pack, 'chibi:pack')) {
      const name = (await leseNamenMitRolle('chibi')).find((n) => passtZurPose(n, 'thron'));
      const datei = name ? await leseDatei(name).catch(() => null) : null;
      if (datei && datei.typ.startsWith('image/')) blob = datei.blob;
    }
    if (!blob) adresse = await demoChibiAdresse('thron');
    if (meiner !== lauf || (!blob && !adresse)) return;
    if (blob) mitBlob(chibiBild, blob);
    else if (adresse) chibiBild.src = adresse;
    chibiBox.hidden = false;
  }

  // Einziger Ort, der den Zustand bewertet: beim Laden und bei jeder Aenderung von Einstellungen oder Pack.
  async function bewerte(): Promise<void> {
    if (geht) return;
    const [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    if (geht) return;
    const gilt = ersatzAktiv(e, pack);
    const aufListe = zielErlaubt(e.erwachsen.eigeneSeiten);
    if (!gilt || !aufListe) {
      leereAnzeige();
      // Nur zurueck, wenn der Host des Ziels eine Erwachsenenseite ist; ein fremder Host bleibt nur ein Text.
      if (ziel && aufListe) await kehreZurueck();
      return;
    }
    if (!bilderDa) {
      bilderDa = true;
      const meiner = lauf;
      await Promise.all([zeigeBilder(meiner), zeigeChibi(meiner)]).catch(() => undefined);
    }
  }

  setzeLink('link-patreon', links.patreon);
  setzeLink('link-subscribestar', links.subscribestar);
  if (ziel) {
    zielZeile.textContent = `You were heading to ${ziel.hostname}.`;
    zielZeile.hidden = false;
  }
  pauseKnopf.addEventListener('click', () => void pausiere());
  // Zuerst anmelden, dann pruefen: eine Aenderung zwischen beiden Schritten geht sonst verloren.
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich === 'local' && (SPEICHER_SCHLUESSEL in aenderungen || PACK_SPEICHER_SCHLUESSEL in aenderungen)) void bewerte().catch(() => undefined);
  });
  await bewerte().catch(() => {
    status.textContent = 'Something went wrong. Press Pause Mia and I’ll step aside.';
  });
}
