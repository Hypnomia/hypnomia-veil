// Ansicht des Custom-Baukastens (Phase 11 E6b, B2 bis B6): die drei Zeilen "Face", "Everything else" und "Words" unter der Karte Custom (nur Einstellungsseite). Die Ansicht
// rechnet nichts: Anzeige und Wahl kommen aus den reinen Funktionen in baukasten.ts, geschrieben wird ueber die Rueckrufe der Seite (je Tipp ein Schreibvorgang).
// Jede Zeile ist eine Radiogruppe mit Namen (Pfeiltasten bewegen den Fokus, gewaehlt wird mit Leertaste, Eingabe oder Klick). Ein gesperrter Baustein ist nicht waehlbar
// (`disabled`), hat aber daneben ein eigenes Bedienelement, das die Schau startet (E6b B8 e). Texte nur ueber das Woerterbuch (bedienung-texte.ts), nur textContent.
import { baueSchalter, type SchalterHandle } from './bausteine/bausteine';
import { HinweisFach, baueTitel, el, knopf, markiereRadios, radioTastatur } from './bausteine/dom';
import { FACE_WAHLEN, FLAECHE_WAHLEN, faceAnzeige, faceGesperrt, flaecheGesperrt, gespeichertGesperrt, wortMoeglich, type BaukastenFrei, type BaukastenStand, type FaceWahl } from './baukasten';
import { BAUKASTEN_TEXTE } from './bedienung-texte';
import { CUSTOM_STANDARD, pruefeCustom, type CustomFlaeche, type CustomMischung } from '../presets';

export type BaukastenZeile = 'face' | 'flaeche';

export interface BaukastenEingabe {
  beiFace(wahl: FaceWahl): void;
  beiFlaeche(wahl: CustomFlaeche): void;
  beiWoerter(an: boolean): void;
  // Antippen eines gesperrten Bausteins: startet die Schau. `ausloeser` ist das Bedienelement (dorthin kehrt der Fokus zurueck).
  beiSchau(zeile: BaukastenZeile, wert: string, ausloeser: HTMLElement): void;
}

export interface BaukastenZeichnung {
  stand: BaukastenStand; // Zonen, Eye bar und die gespeicherte Mischung
  frei: BaukastenFrei; // was das Pack freischaltet
  gilt: Pick<CustomMischung, 'gesicht' | 'flaeche'>; // die geltende Mischung (nach dem Pack ersetzt), fuer "Wort moeglich"
}

export interface BaukastenAnsicht {
  element: HTMLElement;
  zeichne(z: BaukastenZeichnung): void;
}

interface RadioZeile {
  element: HTMLElement;
  setze(wert: string | null, gesperrt: ReadonlySet<string>, hinweis: string | null): void;
}

function baueRadioZeile(titelText: string, optionen: readonly { wert: string; name: string }[], wahl: (wert: string) => void, schau: (wert: string, ausloeser: HTMLElement) => void): RadioZeile {
  // Kein `v-baustein`: die Zeilen sind nur sichtbar, solange Custom gewaehlt ist, und gehoeren nicht zu den Radiogruppen der Bausteine, die andere Tests durchlaufen.
  const w = el('div', 'v-baukasten-zeile');
  w.dataset.vBaukasten = 'zeile';
  const titel = baueTitel({ titel: titelText });
  const gruppe = el('div', 'v-bk-gruppe');
  gruppe.setAttribute('role', 'radiogroup');
  gruppe.setAttribute('aria-labelledby', titel.titel.id);
  const eintraege = optionen.map((o) => {
    const huelle = el('span', 'v-bk-huelle');
    const k = knopf('v-bk-knopf', o.name);
    k.setAttribute('role', 'radio');
    k.dataset.id = o.wert;
    k.addEventListener('click', () => {
      if (!k.disabled) wahl(o.wert);
    });
    // Das Bedienelement der Schau: nur sichtbar, solange der Baustein gesperrt ist; nie im Radio, mit klarem Namen.
    const s = knopf('v-bk-schau');
    s.hidden = true;
    s.dataset.schau = o.wert;
    s.setAttribute('aria-label', BAUKASTEN_TEXTE.gesperrtName(o.name));
    s.addEventListener('click', () => schau(o.wert, s));
    huelle.append(k, s);
    return { o, k, s, huelle };
  });
  gruppe.append(...eintraege.map((e) => e.huelle));
  radioTastatur(gruppe);
  w.append(titel.element, gruppe);
  const fach = new HinweisFach(gruppe, gruppe, null);
  return {
    element: w,
    setze(wert, gesperrt, hinweis) {
      for (const e of eintraege) {
        const g = gesperrt.has(e.o.wert);
        e.k.disabled = g;
        e.s.hidden = !g;
      }
      markiereRadios(
        eintraege.map((e) => e.k),
        wert === null ? null : eintraege.findIndex((e) => e.o.wert === wert),
      );
      fach.setze(hinweis);
    },
  };
}

export function baueBaukasten(e: BaukastenEingabe): BaukastenAnsicht {
  const w = el('div', 'v-baukasten');
  w.dataset.vBaukasten = 'baukasten';
  const face = baueRadioZeile(
    BAUKASTEN_TEXTE.zeilen.face,
    FACE_WAHLEN.map((wert) => ({ wert, name: BAUKASTEN_TEXTE.face[wert] })),
    (wert) => e.beiFace(wert as FaceWahl),
    (wert, a) => e.beiSchau('face', wert, a),
  );
  const flaeche = baueRadioZeile(
    BAUKASTEN_TEXTE.zeilen.flaeche,
    FLAECHE_WAHLEN.map((wert) => ({ wert, name: BAUKASTEN_TEXTE.flaeche[wert] })),
    (wert) => e.beiFlaeche(wert as CustomFlaeche),
    (wert, a) => e.beiSchau('flaeche', wert, a),
  );
  face.element.id = 'baukasten-face';
  flaeche.element.id = 'baukasten-flaeche';
  const woerter: SchalterHandle = baueSchalter({ titel: BAUKASTEN_TEXTE.zeilen.woerter, an: false, beiAenderung: (an) => e.beiWoerter(an) });
  woerter.element.id = 'baukasten-woerter';
  w.append(face.element, flaeche.element, woerter.element);
  return {
    element: w,
    zeichne({ stand, frei, gilt }) {
      const m = pruefeCustom(stand.custom) ?? CUSTOM_STANDARD;
      const anzeige = faceAnzeige(stand);
      // Gesperrt sind die Bausteine, die ohne Freischaltung nicht waehlbar sind (B6); ein gespeicherter, gesperrter Baustein steht gewaehlt da, mit dem einen Satz.
      const faceGesperrtSet = new Set<string>(FACE_WAHLEN.filter((x) => faceGesperrt(x, frei)));
      const flaecheGesperrtSet = new Set<string>(FLAECHE_WAHLEN.filter((x) => flaecheGesperrt(x, frei)));
      const gesp = gespeichertGesperrt(stand, frei);
      face.setze(anzeige, faceGesperrtSet, gesp.face ? BAUKASTEN_TEXTE.gespeichertGesperrt : anzeige === 'nothing' ? BAUKASTEN_TEXTE.hinweisNothing : anzeige === 'bar' ? BAUKASTEN_TEXTE.hinweisBar : null);
      flaeche.setze(m.flaeche, flaecheGesperrtSet, gesp.flaeche ? BAUKASTEN_TEXTE.gespeichertGesperrt : null);
      // Words: der Schalter zeigt den gespeicherten Wert; kann nirgends ein Wort stehen, ist er nicht bedienbar und traegt den Hinweis (der Wert bleibt).
      const moeglich = wortMoeglich(gilt, stand.zonen.face.an);
      woerter.setze(m.woerter);
      woerter.setzeGesperrt(!moeglich);
      woerter.setzeHinweis(moeglich ? null : BAUKASTEN_TEXTE.hinweisWortNein);
    },
  };
}
