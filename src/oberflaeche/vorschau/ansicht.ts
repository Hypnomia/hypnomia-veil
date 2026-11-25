// Ansicht der Live-Vorschau (Phase 11 E5, V4, V7, V8, V10 bis V13): Kachel (ein Knopf), vier Punkte zum Blaettern, ein <dialog> mit dem grossen Bild. Sie liest nur,
// sie schreibt nie in den Speicher. Das gewaehlte Bild lebt nur, solange die Seite offen ist. Jede Aenderung der Eingaben zeichnet neu (entprellt rund 100 ms);
// das zuletzt angeforderte Bild gewinnt, ein aelteres Ergebnis wird nie mehr gezeigt, und bis das neue fertig ist bleibt das alte stehen (kein Zwischenbild, kein
// Blinken, keine Bewegung). Fehlen die Beispielbilder im Bau, zeigt sie wie vor Etappe 5 die Strichzeichnung.
import { BEISPIELE, beispielAdresse, type BeispielKennung } from '../../beispiel';
import type { Einstellungen } from '../../einstellungen';
import { presetDef } from '../../preset-def';
import { nutztMiasGesicht } from '../../presets';
import type { PackKurz } from '../../pack/vertrag';
import { baueVorschauPlatz } from '../bausteine/bausteine';
import { el, knopf, neueKennung } from '../bausteine/dom';
import { beobachteGesichter, type GesichterStand } from '../gesichter-status';
import { SCHAU_TEXTE } from '../bedienung-texte';
import { VORSCHAU_ALT_OFFEN, VORSCHAU_HINWEIS, VORSCHAU_KACHEL, VORSCHAU_NICHTS, VORSCHAU_PUNKTE_LABEL, VORSCHAU_PUNKT_NAMEN, VORSCHAU_SCHLIESSEN, vorschauAlt } from '../gemeinsam';
import { presetVorschau } from '../presets-ansicht';
import { ATTR_VORSCHAU, ATTR_VORSCHAU_BREMSE, ATTR_VORSCHAU_KENNUNG, TESTHAKEN } from './haken';
import { SCHAU_PACK, schauEinstellungen, zeichenSchluessel, type VorschauEingabe } from './rechnung';
import { zeichneBeispiel } from './zeichner';

const ENTPRELL_MS = 100;
const GESICHT_NOCH_MAL_MS = 700;
const GESICHT_VERSUCHE = 6;

export interface VorschauStand {
  einstellungen: Einstellungen;
  pack: PackKurz | null;
  // Stand der Gesichtssuche; fehlt der Wert (Interview), beobachtet die Ansicht ihn selbst.
  gesichter?: GesichterStand | null;
}

// Die Schau eines gesperrten Stils ohne Pack (E6b B8): der gedachte Teil der Einstellungen (so, wie die Wahl mit Pack gespeichert wuerde) und die Art, die den Satz bestimmt.
export interface SchauWahl {
  teil: Partial<Einstellungen>;
  art: 'karte' | 'baustein';
}

export interface LiveVorschau {
  element: HTMLElement;
  aktualisiere(stand: VorschauStand): void;
  // Schau: nur ein Zustand dieser Ansicht, sie schreibt nichts in den Speicher und schickt keine Nachricht. `ausloeser`: das Bedienelement, das sie gestartet hat (dorthin
  // kehrt der Fokus nach "Back to yours" zurueck).
  zeigeSchau(wahl: SchauWahl, ausloeser?: HTMLElement | null): void;
  beendeSchau(): void;
  laeuftSchau(): boolean;
}

export interface LiveVorschauOptionen {
  label: string; // Name des Bereichs fuer Screenreader
  praefix?: string; // haelt die Filter-Kennungen der Strichzeichnung eindeutig (Standard `vorschau`)
}

interface Punkte {
  gruppe: HTMLElement;
  knoepfe: HTMLButtonElement[];
}

export function baueLiveVorschau(o: LiveVorschauOptionen): LiveVorschau {
  const praefix = o.praefix ?? 'vorschau';
  const platz = baueVorschauPlatz({ label: o.label });
  const hinweis = el('p', 'v-vorschau-hinweis', VORSCHAU_HINWEIS);
  const offenHinweis = el('p', 'v-vorschau-hinweis v-vorschau-offen', VORSCHAU_NICHTS);
  offenHinweis.id = neueKennung('vorschau-offen');
  offenHinweis.hidden = true;

  // Zustand: die Wahl des Nutzers (null: noch nicht geblaettert, dann gilt V10), die letzten Eingaben, Zaehler der Anforderungen.
  let gewaehlt: BeispielKennung | null = null;
  let stand: VorschauStand | null = null;
  let eigeneGesichter: GesichterStand | null = null;
  let eigenerBeobachter: { packId: string; ab: () => void } | null = null;
  let bilderDa: boolean | null = null; // null: noch nicht gefragt
  let seq = 0; // jede neue Anforderung zaehlt hoch; nur das Ergebnis der letzten wird gezeigt
  let angeforderterSchluessel = '';
  let gezeigterSchluessel = '';
  let zeitgeber: ReturnType<typeof setTimeout> | null = null;
  let nochMal: ReturnType<typeof setTimeout> | null = null;
  let gezeigteBilder = 0;
  let aktuellesBild: BeispielKennung = 'vorn';
  // Schau (E6b B8): `basis` ist die Unterschrift der Einstellungen und des Packs beim Start; jede Aenderung davon beendet sie.
  let schau: { wahl: SchauWahl; basis: string; ausloeser: HTMLElement | null } | null = null;
  let schauAngezeigt = false; // das gezeigte Bild ist ein Schau-Bild (Marke, Satz und Knopf folgen dem Bild, nicht der Anforderung)
  const unterschrift = (v: VorschauStand): string => JSON.stringify([v.einstellungen, v.pack?.id ?? null, v.pack?.importiert ?? 0, v.pack?.freischaltungen ?? null, v.pack?.sticker ?? 0]);

  // ---------- Bausteine der Ansicht ----------
  const kachel = knopf('v-vorschau-kachel');
  kachel.setAttribute('aria-label', VORSCHAU_KACHEL);
  const kachelBild = el('img');
  kachelBild.decoding = 'async';
  kachelBild.alt = '';
  kachel.append(kachelBild);

  const baueDot = (klasse: string): Punkte => {
    const gruppe = el('div', klasse);
    gruppe.setAttribute('role', 'group');
    gruppe.setAttribute('aria-label', VORSCHAU_PUNKTE_LABEL);
    const knoepfe = BEISPIELE.map((b, i) => {
      const k = knopf('v-vorschau-punkt');
      k.dataset.bild = b.kennung;
      k.setAttribute('aria-label', VORSCHAU_PUNKT_NAMEN[i] ?? b.kennung);
      k.append(el('span', 'v-vorschau-punkt-marke'));
      k.addEventListener('click', () => waehle(b.kennung));
      k.addEventListener('keydown', (ev) => {
        const schritt = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
        if (!schritt) return;
        ev.preventDefault();
        const ziel = BEISPIELE[(i + schritt + BEISPIELE.length) % BEISPIELE.length]!.kennung;
        waehle(ziel);
        knoepfe[BEISPIELE.findIndex((x) => x.kennung === ziel)]?.focus();
      });
      return k;
    });
    gruppe.append(...knoepfe);
    return { gruppe, knoepfe };
  };
  const punkte = baueDot('v-vorschau-punkte');
  const dialogPunkte = baueDot('v-vorschau-dialog-punkte');
  const zeigePunkte = (bild: BeispielKennung): void => {
    for (const p of [punkte, dialogPunkte]) {
      for (const k of p.knoepfe) {
        const an = k.dataset.bild === bild;
        if (an) k.setAttribute('aria-current', 'true');
        else k.removeAttribute('aria-current');
        k.tabIndex = an ? 0 : -1;
      }
    }
  };

  const dialog = el('dialog', 'v-vorschau-dialog');
  dialog.setAttribute('aria-label', VORSCHAU_PUNKTE_LABEL);
  const grossBild = el('img', 'v-vorschau-gross');
  grossBild.alt = '';
  const zu = knopf('v-vorschau-zu', VORSCHAU_SCHLIESSEN);
  // Im Dialog gelten die Hinweise immer (der Streifen blendet die der Spalte aus), darum eigene Klasse.
  const dialogHinweis = el('p', 'v-vorschau-dialog-hinweis', VORSCHAU_HINWEIS);
  const dialogOffen = el('p', 'v-vorschau-dialog-hinweis', VORSCHAU_NICHTS);
  dialogOffen.id = neueKennung('vorschau-dialog-offen');
  dialogOffen.hidden = true;
  dialog.append(grossBild, dialogPunkte.gruppe, dialogHinweis, dialogOffen, zu);
  zu.addEventListener('click', () => dialog.close());
  // Klick auf den Hintergrund schliesst; der Fokus kehrt zur Kachel zurueck.
  dialog.addEventListener('click', (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => kachel.focus());
  kachel.addEventListener('click', () => {
    if (!dialog.open && kachelBild.src) dialog.showModal();
  });

  const skizze = el('div', 'v-vorschau-skizze');
  // Schau: die Marke steht als Text im DOM an der Kachel (in jeder Groesse), der Satz im breiten Raster und im Fenster (ein Vorleser hoert ihn einmal: der Satz im Fenster
  // ist nur bei geoeffnetem Fenster da), der Knopf beendet sie.
  const marke = el('span', 'v-vorschau-marke', SCHAU_TEXTE.marke);
  marke.hidden = true;
  platz.flaeche.parentElement?.append(marke);
  const schauSatz = el('p', 'v-vorschau-schau', '');
  schauSatz.hidden = true;
  schauSatz.setAttribute('role', 'status');
  const dialogSchauSatz = el('p', 'v-vorschau-dialog-hinweis', '');
  dialogSchauSatz.hidden = true;
  const zurueck = knopf('v-vorschau-zurueck', SCHAU_TEXTE.zurueck);
  zurueck.hidden = true;
  zurueck.addEventListener('click', () => {
    const ziel = schau?.ausloeser;
    beende();
    // Der Fokus bleibt auf einem sinnvollen Element: dem Bedienelement, das die Schau gestartet hat, sonst der Kachel.
    if (ziel && ziel.isConnected && !ziel.hidden) ziel.focus();
    else kachel.focus();
  });
  dialog.insertBefore(dialogSchauSatz, zu);
  platz.element.append(punkte.gruppe, hinweis, offenHinweis, schauSatz, zurueck, dialog);
  const zeigeSchauUi = (an: boolean): void => {
    schauAngezeigt = an;
    marke.hidden = !an;
    schauSatz.hidden = !an;
    dialogSchauSatz.hidden = !an;
    zurueck.hidden = !an;
    const satz = schau ? (schau.wahl.art === 'karte' ? SCHAU_TEXTE.satzKarte : SCHAU_TEXTE.satzBaustein) : schauSatz.textContent;
    if (an && schauSatz.textContent !== satz) {
      schauSatz.textContent = satz;
      dialogSchauSatz.textContent = satz;
    }
    // die gezeigte Kachel traegt die Marke auch fuer Vorleser (der Name der Kachel sagt es)
    if (an) kachel.setAttribute('data-veil-schau', '1');
    else kachel.removeAttribute('data-veil-schau');
  };

  // ---------- Anzeige ----------
  let zeigtBild = false;
  const zeigeSkizze = (stilId: string, name: string, welches?: BeispielKennung): void => {
    if (welches) {
      aktuellesBild = welches;
      zeigePunkte(welches);
    }
    skizze.innerHTML = presetVorschau(stilId as never, praefix);
    if (zeigtBild || platz.flaeche.firstChild !== skizze) platz.flaeche.replaceChildren(skizze);
    zeigtBild = false;
    platz.setzeEtikett(name);
    // Die Punkte bleiben, sobald die Bilder da sind: ein anderes Bild hat vielleicht etwas zu verdecken.
    punkte.gruppe.hidden = bilderDa !== true;
    hinweis.hidden = bilderDa !== true;
    offenHinweis.hidden = true;
    dialogOffen.hidden = true;
    kachel.removeAttribute('aria-describedby');
    if (dialog.open) dialog.close();
  };
  const zeigeBild = (bild: string, name: string, welches: BeispielKennung, offen: boolean): void => {
    // Bild, Alt-Text und Hinweise wechseln in einem Zug (nie Hinweis und verdecktes Bild zugleich, nie ein offenes Bild ohne Hinweis).
    const alt = offen ? VORSCHAU_ALT_OFFEN : vorschauAlt(name);
    kachelBild.src = bild;
    kachelBild.alt = alt;
    grossBild.src = bild;
    grossBild.alt = alt;
    offenHinweis.hidden = !offen;
    dialogOffen.hidden = !offen;
    if (offen) {
      kachel.setAttribute('aria-describedby', offenHinweis.id);
      grossBild.setAttribute('aria-describedby', dialogOffen.id);
    } else {
      kachel.removeAttribute('aria-describedby');
      grossBild.removeAttribute('aria-describedby');
    }
    if (!zeigtBild) platz.flaeche.replaceChildren(kachel);
    zeigtBild = true;
    platz.setzeEtikett(name);
    punkte.gruppe.hidden = false;
    hinweis.hidden = false;
    aktuellesBild = welches;
    zeigePunkte(welches);
    gezeigteBilder += 1;
  };

  const schreibeHaken = (): void => {
    if (!TESTHAKEN || !stand) return;
    platz.element.setAttribute(
      ATTR_VORSCHAU,
      JSON.stringify({ angefordert: angeforderterSchluessel, gezeigt: gezeigterSchluessel, anzahl: gezeigteBilder, bild: aktuellesBild, offen: !offenHinweis.hidden, stil: wirkDef(stand).gilt.id, schau: schauAngezeigt, schauAngefordert: schau !== null }),
    );
  };

  // ---------- Eingaben ----------
  // Was die Vorschau zeigt: die Einstellungen des Nutzers, in der Schau die gedachten (der angetippte Stil mit dem gedachten Pack, in dem alles frei ist).
  const wirkEinst = (v: VorschauStand): Einstellungen => (schau ? schauEinstellungen(v.einstellungen, schau.wahl.teil) : v.einstellungen);
  const wirkDef = (v: VorschauStand): { gewaehlt: ReturnType<typeof presetDef>['gewaehlt']; gilt: ReturnType<typeof presetDef>['gilt'] } => presetDef(wirkEinst(v), schau ? SCHAU_PACK : v.pack);
  const gesichterJetzt = (): GesichterStand | null => (stand && stand.gesichter !== undefined ? stand.gesichter : eigeneGesichter);
  const bildJetzt = (): BeispielKennung => {
    if (gewaehlt) return gewaehlt;
    const gilt = stand ? wirkDef(stand).gilt : null;
    return gilt && nutztMiasGesicht(gilt.id) ? 'portraet' : 'vorn';
  };
  const eingabeJetzt = (): VorschauEingabe | null => {
    if (!stand) return null;
    const bild = bildJetzt();
    const b = BEISPIELE.find((x) => x.kennung === bild)!;
    const g = gesichterJetzt();
    const test = TESTHAKEN ? document.documentElement.getAttribute(ATTR_VORSCHAU_KENNUNG) : null;
    return {
      einstellungen: wirkEinst(stand),
      pack: stand.pack,
      ...(schau ? { schau: true } : {}),
      gesichter: g ? { fertig: g.fertig, mit: g.mit } : null,
      bild,
      breite: b.breite,
      hoehe: b.hoehe,
      ...(test ? { kennungTest: test } : {}),
    };
  };

  async function zeichne(mein: number, a: VorschauEingabe, schluessel: string, versuch: number): Promise<void> {
    const gilt = presetDef(a.einstellungen, a.schau ? SCHAU_PACK : a.pack).gilt;
    try {
      if (TESTHAKEN) {
        const bremse = document.documentElement.getAttribute(ATTR_VORSCHAU_BREMSE);
        const [stil, ms] = (bremse ?? '').split(':');
        if (stil === gilt.id && Number(ms) > 0) await new Promise((fertig) => setTimeout(fertig, Number(ms)));
      }
      const adresse = await beispielAdresse(a.bild);
      if (mein !== seq) return;
      if (!adresse) {
        bilderDa = false;
        gezeigterSchluessel = schluessel;
        zeigeSkizze(gilt.id, gilt.name, a.bild);
        zeigeSchauUi(!!a.schau);
        schreibeHaken();
        return;
      }
      bilderDa = true;
      const r = await zeichneBeispiel(a, adresse);
      if (mein !== seq) return; // ein neueres Bild wurde angefordert: dieses wird nie mehr gezeigt
      gezeigterSchluessel = schluessel;
      zeigeBild(r.bild, gilt.name, a.bild, r.offen); // bei null Flaechen das offene Bild mit Hinweis, sonst nie das unverdeckte Bild
      zeigeSchauUi(!!a.schau);
      schreibeHaken();
      // Mias Gesicht noch nicht lesbar, obwohl die Suche fertig meldet (die Ablage wird kurz nach der Meldung geschrieben): ein paar Mal nachlesen.
      if (r.gesichtOffen && versuch < GESICHT_VERSUCHE && a.gesichter?.fertig && a.gesichter.mit > 0) {
        if (nochMal) clearTimeout(nochMal);
        nochMal = setTimeout(() => {
          nochMal = null;
          if (mein !== seq) return;
          const neu = ++seq;
          void zeichne(neu, a, schluessel, versuch + 1);
        }, GESICHT_NOCH_MAL_MS);
      }
    } catch {
      if (mein !== seq) return;
      // Bild nicht ladbar oder Fehler beim Malen: ehrlich zurueck auf die Strichzeichnung (nie das Rohbild).
      gezeigterSchluessel = schluessel;
      zeigeSkizze(gilt.id, gilt.name, a.bild);
      zeigeSchauUi(!!a.schau);
      schreibeHaken();
    }
  }

  function anfordern(sofort: boolean): void {
    const a = eingabeJetzt();
    if (!a) return;
    const schluessel = zeichenSchluessel(a);
    if (schluessel === angeforderterSchluessel) return;
    angeforderterSchluessel = schluessel;
    const mein = ++seq;
    if (nochMal) clearTimeout(nochMal);
    if (zeitgeber) clearTimeout(zeitgeber);
    schreibeHaken();
    const los = (): void => {
      zeitgeber = null;
      void zeichne(mein, a, schluessel, 0);
    };
    if (sofort) los();
    else zeitgeber = setTimeout(los, ENTPRELL_MS);
  }

  // Schau beenden: danach zeigt die Vorschau wieder, was gilt (V8: neu angefordert, das alte Bild bleibt bis das neue da ist).
  function beende(): void {
    if (!schau) return;
    schau = null;
    anfordern(true);
  }

  function waehle(bild: BeispielKennung): void {
    gewaehlt = bild;
    zeigePunkte(bild);
    anfordern(true);
  }

  // Gesichtsstand selbst beobachten, wenn der Besitzer ihn nicht liefert (Interview).
  function pflegeBeobachter(): void {
    if (!stand || stand.gesichter !== undefined) return;
    const braucht = !!stand.pack && nutztMiasGesicht(presetDef(stand.einstellungen, stand.pack).gilt.id);
    const id = stand.pack ? `${stand.pack.id}:${stand.pack.importiert}` : '';
    if (eigenerBeobachter && (!braucht || eigenerBeobachter.packId !== id)) {
      eigenerBeobachter.ab();
      eigenerBeobachter = null;
      eigeneGesichter = null;
    }
    if (braucht && !eigenerBeobachter) {
      eigenerBeobachter = {
        packId: id,
        ab: beobachteGesichter((s) => {
          eigeneGesichter = s;
          anfordern(false);
        }),
      };
    }
  }

  if (TESTHAKEN) {
    // Der Test setzt die Kennung oder die Bremse am Wurzelelement; die Vorschau zeichnet dann neu.
    new MutationObserver(() => anfordern(false)).observe(document.documentElement, { attributes: true, attributeFilter: [ATTR_VORSCHAU_KENNUNG] });
  }
  window.addEventListener('pagehide', () => {
    eigenerBeobachter?.ab();
    if (zeitgeber) clearTimeout(zeitgeber);
    if (nochMal) clearTimeout(nochMal);
  });

  // Vor dem ersten Ergebnis steht die Strichzeichnung; sie weicht dem Bild, sobald es fertig ist.
  return {
    element: platz.element,
    zeigeSchau: (wahl, ausloeser = null) => {
      if (!stand) return;
      // Nur eine Schau auf einmal: eine neue ersetzt die alte. Nichts wird gespeichert oder gesendet, die Ansicht rechnet nur anders.
      schau = { wahl, basis: unterschrift(stand), ausloeser };
      anfordern(true);
    },
    beendeSchau: beende,
    laeuftSchau: () => schau !== null,
    aktualisiere: (neu) => {
      const erstes = stand === null;
      // Jede Aenderung einer Einstellung oder des Packs beendet die Schau (B8 d).
      if (schau && unterschrift(neu) !== schau.basis) schau = null;
      stand = neu;
      pflegeBeobachter();
      const gilt = wirkDef(neu).gilt;
      // Bis das erste Bild da ist (oder ohne Beispielbilder) zeigt der Platz den Stil als Strichzeichnung, sofort.
      if (!zeigtBild && (erstes || bilderDa === false)) zeigeSkizze(gilt.id, gilt.name);
      anfordern(erstes);
    },
  };
}
