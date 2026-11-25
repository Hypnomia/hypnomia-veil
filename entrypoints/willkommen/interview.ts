// Interview der Willkommensseite (Phase 11 E4e, Regeln I1 bis I11, I5a, I5b, I8a): die sechs Seiten (Zones, Clothes, Style, Mood, Adult sites, Extras; ohne Pack
// die ersten vier) aus den gemeinsamen Bausteinen von `src/oberflaeche/bausteine/` und derselben reinen Logik wie die Einstellungsseite (`gleicheDeckung`,
// `zonenUnterKleidung`, `erwachsen-wahl.ts`). Keine zweite Fassung der Logik: diese Datei ist nur der Anschluss an den Speicher.
// Sicherheit: Anzeigen und `setze()` schreiben nie; geschrieben wird allein nach einer Handlung des Nutzers (Klick, Leertaste, Eingabe, Regler losgelassen).
// Eine verworfene Handlung schreibt nichts (`null`, I8a). Nicht gefragt und nie angefasst: komplettErsatz, quiz.verweigern, kontrolle.leerlauf, kontrolle.cursor,
// ton.an und jeder andere Wert ausser denen, die eine Seite ausdruecklich setzt (I7).
import {
  waehlePreset,
  type BlitzHaeufigkeit,
  type Einstellungen,
} from '../../src/einstellungen';
import { istFreigeschaltet, type PackKurz } from '../../src/pack/vertrag';
import { baueKarten } from '../../src/oberflaeche/presets-ansicht';
import { EYE_BAR_TEXT, EYE_BAR_TITEL } from '../../src/oberflaeche/gemeinsam';
import { ersatzWarnungGilt, gesperrtText, waehleErwachsenHinweis, waehleKleidungHinweis, waehleStilHinweise, waehleZonenHinweis } from '../../src/oberflaeche/hinweise';
import { beobachteGesichter, type GesichterStand } from '../../src/oberflaeche/gesichter-status';
import { presetDef } from '../../src/preset-def';
import { baueLiveVorschau, type LiveVorschau } from '../../src/oberflaeche/vorschau/ansicht';
import { INTERVIEW_CUSTOM_ZEILE } from '../../src/oberflaeche/bedienung-texte';
import { presetSatz, zonenHinweisTeile } from '../../src/oberflaeche/preset-texte';
import {
  baueAuswahl,
  baueHinweis,
  baueKleidungsfrage,
  baueSchalter,
  baueStufenwahl,
  baueWahlkarten,
  baueZonenwahl,
  zonenSchreibteil,
  zonenUnterKleidung,
  type WahlkartenHandle,
} from '../../src/oberflaeche/bausteine/bausteine';
import { erwachsenGesperrt, erwachsenKarte, erwachsenKarten, erwachsenNachWahl } from '../../src/oberflaeche/bausteine/erwachsen-wahl';
import { INTERVIEW_SEITEN } from '../../src/einstieg/vertrag';
import { zonenWahl, type ZonenStand } from '../../src/einstieg/zonen';
import { STIMMUNG_STUFEN_INTERVIEW, TEXT, zahlGenau } from '../../src/einstieg/texte';

export interface Seite {
  knoten: HTMLElement;
  // `erzwingen`: auch ein Regler mit Fokus wird auf den gespeicherten Stand gestellt (nach einem Speicherfehler, nach einer verworfenen Handlung).
  aktualisiere: (e: Einstellungen, p: PackKurz | null, erzwingen?: boolean) => void;
  // Aufraeumen, wenn die Seite verlassen wird (laufende Beobachtungen beenden)
  abbau?: () => void;
}

export type Speicherergebnis = 'gespeichert' | 'verworfen' | 'fehler';

// Was die Seite von der Willkommensseite braucht (main.ts besitzt den Fehlersatz und den zuletzt gesehenen Stand).
export interface Kontext {
  einst(): Einstellungen; // der zuletzt gesehene gespeicherte Stand
  // Schreibt auf den frisch gelesenen Stand; liefert `teil` null, wird NICHT geschrieben (auch nicht der unveraenderte Stand) und ein stehender Fehlersatz bleibt.
  // Bei 'fehler' steht der Fehlersatz da und alle Elemente zeigen den gespeicherten Stand; bei 'verworfen' zeigen sie ihn ebenfalls.
  speichere(teil: (alt: Einstellungen) => Partial<Einstellungen> | null): Promise<Speicherergebnis>;
  pfadOptionen(anker?: string): string;
}

function knoten<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string, id?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  if (id) e.id = id;
  return e;
}

// Fund 4: ohne Pack ein Satz, was das Pack auf dieser Seite zeigt, und der Link zum Pack-Abschnitt (die Seite merkt sich den Schritt).
function packHinweis(k: Kontext, text: string): HTMLParagraphElement {
  const p = knoten('p', 'hinweis', `${text} `, 'iv-ohne-pack');
  const link = knoten('a', undefined, TEXT.packLink, 'iv-pack-link');
  link.href = k.pfadOptionen('#neu');
  // Fund N11: neuer Tab, das Interview bleibt auf seiner Seite (Zurueck-Taste und gemerkter Schritt bleiben unberuehrt).
  link.target = '_blank';
  link.rel = 'noopener';
  p.append(link);
  p.hidden = true;
  return p;
}

// ---------- 1 Zones und 2 Clothes: beide lesen ueber dieselbe Funktion den Stand, `setze()` an beiden nach jedem Speichern, Speicherfehler und jeder Aenderung von aussen ----------

// Der eine Hinweis der Kleidungsfrage bei einem gemischten Stand (keine Antwort markiert): nennt genau, was heute eingeschaltet UND unter Kleidung gedeckt ist
// (reine Funktion waehleKleidungHinweis; der Satz zu einer verworfenen Handlung verdraengt den gewoehnlichen Teil).
function kleidungHinweisText(zonen: ZonenStand, gemischt: boolean, verworfen: boolean): string | null {
  return waehleKleidungHinweis({ gemischt, namen: zonenUnterKleidung(zonen).map((z) => TEXT.zonenNamen[z]), verworfen });
}

// Zonen und Kleidung teilen sich die Schreibregel: eine Handlung gilt nur fuer den Stand, den der Nutzer gesehen hat (G3). Hat er sich geaendert, wird nichts
// geschrieben, es gibt KEINEN zweiten Versuch, die Seite zeigt den gespeicherten Stand und einen kurzen Hinweis, der bei der naechsten Handlung verschwindet.
function zonenSchreiber(k: Kontext, nachWechsel: () => void = () => undefined): { hinweis: HTMLElement; lies: () => ZonenStand; setzeStand: (z: ZonenStand) => void; schreibe: (neu: ZonenStand) => void } {
  let stand: ZonenStand = k.einst().zonen;
  const hinweis = baueHinweis(TEXT.zonenVerworfen);
  hinweis.id = 'iv-zonen-verworfen';
  hinweis.setAttribute('role', 'status');
  hinweis.hidden = true;
  return {
    hinweis,
    lies: () => stand,
    setzeStand: (z) => (stand = z),
    schreibe: (neu) => {
      hinweis.hidden = true;
      nachWechsel();
      const vorher = stand; // der Stand, auf dem der Baustein gerade gerechnet hat
      stand = neu; // folgt eine zweite Handlung vor dem Speichern, rechnet sie auf diesem Stand
      void k.speichere((alt) => zonenSchreibteil(alt.zonen, vorher, neu)).then((erg) => {
        if (erg === 'verworfen') {
          hinweis.hidden = false;
          nachWechsel();
        }
      });
    },
  };
}

export function seiteZonen(k: Kontext): Seite {
  const wurzel = knoten('div');
  wurzel.append(knoten('p', undefined, TEXT.i1Text));
  const zeichneHinweis = (): void => {
    const art = waehleZonenHinweis({ verworfen: !z.hinweis.hidden, wahlKeine: zonenWahl(z.lies()) === null, zensurbalken: false });
    wahl.setzeHinweis(art === 'wahl-keine' ? TEXT.wahlKeine : null);
  };
  const z = zonenSchreiber(k, () => zeichneHinweis());
  const wahl = baueZonenwahl({
    titel: TEXT.zonenTitel,
    karten: TEXT.zonenKarten,
    einzeln: { titel: TEXT.zonenEinzeln.titel, stand: TEXT.zonenEinzeln.stand, gruppenLabel: TEXT.zonenEinzeln.gruppenLabel, namen: TEXT.zonenNamen },
    zonen: z.lies,
    beiAenderung: z.schreibe,
  });
  wahl.element.id = 'iv-zonen-wahl';
  wurzel.append(wahl.element, z.hinweis);
  return {
    knoten: wurzel,
    aktualisiere: (e) => {
      z.setzeStand(e.zonen);
      wahl.setze();
      zeichneHinweis();
    },
  };
}

export function seiteKleidung(k: Kontext): Seite {
  const wurzel = knoten('div');
  wurzel.append(knoten('p', undefined, TEXT.i2Text));
  const zeichneHinweis = (): void => frage.setzeHinweis(kleidungHinweisText(z.lies(), frage.stand() === 'gemischt', !z.hinweis.hidden));
  const z = zonenSchreiber(k, () => zeichneHinweis());
  const frage = baueKleidungsfrage({
    titel: TEXT.kleidungTitel,
    erklaerung: TEXT.kleidungErklaerung,
    antworten: TEXT.kleidungAntworten,
    zonen: z.lies,
    beiAenderung: z.schreibe,
  });
  frage.element.id = 'iv-kleidung-frage';
  wurzel.append(frage.element, z.hinweis);
  return {
    knoten: wurzel,
    aktualisiere: (e) => {
      z.setzeStand(e.zonen);
      frage.setze();
      // Bei einem gemischten Stand (keine Antwort markiert) sagt der eine Hinweis, was heute unter Kleidung gedeckt wird.
      zeichneHinweis();
    },
  };
}

// ---------- 3 Style ----------

// Die Vorschau des Interviews (E6b B8): die Schau gesperrter Karten laeuft auch hier. Gesetzt von `baueVorschau`.
let vorschauLive: LiveVorschau | null = null;

export function seiteStil(k: Kontext, seiten: number): Seite {
  const wurzel = knoten('div');
  wurzel.append(knoten('p', undefined, TEXT.i3Text));
  // Dieselben Preset-Karten wie auf der Einstellungsseite, kompakt (nur Vorschau und Name).
  let faceHinweisAn = false;
  const kartenHost = knoten('div', undefined, undefined, 'iv-preset-karten');
  const karten = baueKarten(kartenHost, {
    name: 'iv-preset',
    praefix: 'iv-preset',
    kompakt: true,
    labelId: 'schritt-titel',
    beiTipp: () => vorschauLive?.beendeSchau(),
    // Gesperrte Karten haben ein eigenes Bedienelement fuer die Schau (nichts wird gespeichert); die Wahl einer freien Karte beendet sie (B8 d).
    beiSchau: (preset, ausloeser) => vorschauLive?.zeigeSchau({ teil: waehlePreset(k.einst(), preset).teil, art: 'karte' }, ausloeser),
    // Wechsel auf ein Preset mit Mias Gesicht schaltet Face ein (waehlePreset); der Hinweis steht darunter, erst nach erfolgreichem Speichern.
    beiWahl: (preset) => {
      vorschauLive?.beendeSchau();
      let faceEin = false;
      void k
        .speichere((alt) => {
          const r = waehlePreset(alt, preset);
          faceEin = r.faceEingeschaltet;
          return r.teil;
        })
        .then((erg) => {
          if (erg !== 'gespeichert') return;
          faceHinweisAn = faceEin;
          zeichneSatz();
        });
    },
  });
  // B9: Custom hat im Interview keine Karte; steht es im Speicher, ist keine Karte gewaehlt und diese Zeile sagt es.
  const customZeile = knoten('p', 'hinweis', INTERVIEW_CUSTOM_ZEILE, 'iv-stil-custom');
  customZeile.hidden = true;
  const satz = knoten('p', 'hinweis', '', 'iv-stil-satz');
  const sperre = knoten('p', 'hinweis', '', 'iv-stil-sperre');
  sperre.hidden = true;
  const zonenText = knoten('p', 'hinweis', '', 'iv-stil-zonen');
  zonenText.hidden = true;
  const faceText = knoten('p', 'hinweis', '', 'iv-stil-face');
  faceText.hidden = true;
  faceText.setAttribute('role', 'status');
  // Stand der Gesichtssuche (Zahl der Bilder mit Gesicht im Satz), einmal angestossen
  let gesichter: GesichterStand | null = null;
  let beobachtet: (() => void) | null = null;
  // zuletzt gesehener Stand: die Beobachtung der Gesichtssuche und der Hinweis zeichnen mit den aktuellen Werten, nicht mit denen von damals
  let letzt: { e: Einstellungen; p: PackKurz | null } | null = null;
  const zeichneSatz = (): void => {
    if (letzt) zeichne(letzt.e, letzt.p);
  };
  // Eye bar (E4c): derselbe Schalter wie auf der Einstellungsseite, direkt unter dem Raster.
  const augenbalken = baueSchalter({
    titel: EYE_BAR_TITEL,
    hinweis: EYE_BAR_TEXT,
    an: k.einst().augenbalken,
    beiAenderung: (an) => void k.speichere(() => ({ augenbalken: an })),
  });
  augenbalken.knopf.id = 'iv-augenbalken';
  wurzel.append(kartenHost, customZeile, augenbalken.element, satz, sperre, zonenText, faceText);
  // Fund 7 und 8: ohne Pack (vier Seiten) steht Calm mode auf der Stil-Seite, er wirkt dort auf bewegte Stile; mit Pack steht er auf der letzten Seite (Extras).
  const ruhig = seiten < INTERVIEW_SEITEN ? baueSchalter({ titel: TEXT.ruhigTitel, hinweis: TEXT.ruhigText, an: k.einst().ruhig, beiAenderung: (an) => void k.speichere(() => ({ ruhig: an })) }) : null;
  if (ruhig) {
    ruhig.knopf.id = 'iv-ruhig';
    wurzel.append(ruhig.element);
  }
  const zeichne = (e: Einstellungen, p: PackKurz | null): void => {
    ruhig?.setze(e.ruhig);
    augenbalken.setze(e.augenbalken);
    const patchFrei = istFreigeschaltet(p, 'stil:mia-patch');
    const stickerFrei = istFreigeschaltet(p, 'zensur:sticker');
    karten.aktualisiere(e.preset, patchFrei, stickerFrei);
    customZeile.hidden = e.preset !== 'custom';
    const def = presetDef(e, p).gilt;
    const wirksam = def.id;
    if (patchFrei && !beobachtet) {
      beobachtet = beobachteGesichter((st) => {
        gesichter = st;
        zeichneSatz(); // mit dem aktuellen Stand, nicht mit dem von damals
      });
    }
    satz.textContent = presetSatz(wirksam, patchFrei, patchFrei && gesichter?.fertig ? gesichter.mit : null);
    // E4t W5: ein gewoehnlicher Hinweis (Sperre des Packs, Gesicht nicht klar genug, Face gerade eingeschaltet, Censor bars), dazu nie verdraengt der Satz zu Mias Gesicht
    // und der Satz "Face aus". "Wort ohne Pack" gilt hier nur ohne Pack (dann gibt es keine Themen, W21); mit Pack kennt die Seite die Themen nicht.
    const sh = waehleStilHinweise({ gilt: def, frei: patchFrei, mitSticker: stickerFrei, pack: p, faceAn: e.zonen.face.an, faceGeradeEingeschaltet: faceHinweisAn, gesichter, woerterOhneThemen: !p });
    const art = sh.gewoehnlich?.art ?? null;
    const zt = zonenHinweisTeile(wirksam);
    const sperreText = art === 'pack' || art === 'kein-gesicht' || art === 'wort-ohne-pack' ? sh.gewoehnlich!.text : '';
    sperre.textContent = sperreText;
    sperre.hidden = sperreText === '';
    const zh = zt.nie || (art === null ? zt.gewoehnlich : '');
    zonenText.textContent = zh;
    zonenText.hidden = zh === '';
    const ft = sh.nie || (art === 'face-ein' ? sh.gewoehnlich!.text : '');
    faceText.textContent = ft;
    faceText.hidden = ft === '';
  };
  return {
    knoten: wurzel,
    abbau: () => beobachtet?.(),
    aktualisiere: (e, p) => {
      letzt = { e, p };
      zeichne(e, p);
    },
  };
}

// ---------- 4 Mood ----------

export function seiteStimmung(k: Kontext): Seite {
  let laeuft = 0; // K3i: Zahl der Speichervorgaenge dieses Elements, die noch nicht beendet sind
  const wurzel = knoten('div');
  wurzel.append(knoten('p', undefined, TEXT.i4Text));
  const stufen = baueStufenwahl({
    titel: TEXT.stimmungTitel,
    liste: STIMMUNG_STUFEN_INTERVIEW,
    wert: k.einst().schwelle,
    exakt: { titel: TEXT.stimmungExakt.titel, formatiere: zahlGenau, reglerLabel: TEXT.stimmungExakt.reglerLabel },
    beiAenderung: (wert) => {
      laeuft += 1;
      void k.speichere(() => ({ schwelle: wert })).then((erg) => {
        laeuft -= 1;
        // K3i: nach dem Ende des Speicherns (Erfolg): hat der Regler den Fokus nicht mehr, steht der gespeicherte Stand da (bei einem Fehler zeichnet `nachFehler` erzwungen)
        if (erg === 'gespeichert' && laeuft === 0 && document.activeElement !== stufen.regler) stufen.setze(gespeichert);
      });
    },
  });
  stufen.element.id = 'iv-stimmung-wahl';
  let gespeichert = k.einst().schwelle;
  // Verliert der Regler "Exact value" den Fokus, zeigt das Element wieder den gespeicherten Stand (ein Zug ohne Loslassen hat nichts geschrieben).
  // K3i: laeuft ein Speichern dieses Elements (Loslassen, sofort Tab), zeichnet der Fokusverlust nicht den alten Stand.
  stufen.regler.addEventListener('blur', () => {
    if (laeuft === 0) stufen.setze(gespeichert);
  });
  // Strict bleibt als Schalter auf dieser Seite (Regel I4: ob Strict aus dem Interview faellt, ist eine offene Frage; bis zur Antwort gilt der strengere Weg).
  const strict = baueSchalter({
    titel: TEXT.strictTitel,
    hinweis: TEXT.strictText,
    an: k.einst().strict,
    beiAenderung: (an) => void k.speichere(() => ({ strict: an })),
  });
  strict.knopf.id = 'iv-strict';
  wurzel.append(stufen.element, strict.element);
  return {
    knoten: wurzel,
    aktualisiere: (e, _p, erzwingen = false) => {
      gespeichert = e.schwelle;
      // Ein Regler, an dem der Nutzer gerade zieht, wird nicht unter der Hand zurueckgestellt, ausser nach einem Speicherfehler.
      // L2: solange ein Speichern dieses Elements laeuft, kein ueberholter Zwischenstand; nach einem Fehler erzwungen (H1)
      if (erzwingen || (document.activeElement !== stufen.regler && laeuft === 0)) stufen.setze(e.schwelle);
      strict.setze(e.strict);
    },
  };
}

// ---------- 5 Adult sites (nur mit Pack beim Einstieg) ----------

export function seiteErwachsen(k: Kontext): Seite {
  const wurzel = knoten('div');
  wurzel.append(knoten('p', undefined, TEXT.i5Text));
  const hinweis = packHinweis(k, TEXT.ohnePack5);
  const ersatz = baueHinweis(TEXT.ersatzAn); // Warnsatz (W4): steht nur, wenn der Ersatz auf Erwachsenenseiten wirken wuerde; weicht keinem anderen Hinweis
  ersatz.id = 'iv-ersatz-an';
  ersatz.hidden = true;
  // K2: Hinweis zu einer verworfenen Wahl (die Form der Gruppe hat sich zwischen Klick und Speichern geaendert), bis zur naechsten Handlung
  const verworfen = baueHinweis(TEXT.erwachsenVerworfen);
  verworfen.id = 'iv-erw-verworfen';
  verworfen.setAttribute('role', 'status');
  verworfen.hidden = true;
  const ort = knoten('div', undefined, undefined, 'iv-erw-ort');
  wurzel.append(hinweis, ort, verworfen, ersatz);
  let wahl: WahlkartenHandle | null = null;
  let form: boolean | null = null;
  let stufeFrei = false;
  let fokusNachWechsel = false;
  // Eine Wahl rechnet auf dem frisch gelesenen Stand (erwachsen-wahl.ts); eine unzulaessige Wahl (gesperrte Stufe) schreibt nichts (null, I8a).
  const waehle = (id: string): void => {
    verworfen.hidden = true;
    zeichneHinweis();
    void k
      .speichere((alt) => {
        const neu = erwachsenNachWahl(alt.erwachsen, id, stufeFrei);
        return neu ? { erwachsen: neu } : null;
      })
      .then((erg) => {
        if (erg === 'verworfen') verworfen.hidden = false;
        zeichneHinweis();
      });
  };
  // E4t W5: ein gewoehnlicher Hinweis, Vorrang: verworfene Wahl, "Set these now" mit Link (ohne Pack), gesperrte Stufen.
  let packJetzt: PackKurz | null = null;
  const zeichneHinweis = (): void => {
    const art = waehleErwachsenHinweis({ verworfen: !verworfen.hidden, pack: packJetzt, mitPackHinweis: true });
    hinweis.hidden = art !== 'ohne-pack';
    wahl?.setzeHinweis(art === 'gesperrt' ? gesperrtText(packJetzt) : null);
  };
  const zeichne = (e: Einstellungen, p: PackKurz | null): void => {
    packJetzt = p;
    stufeFrei = istFreigeschaltet(p, 'erwachsen:vorschau');
    // Die Gruppe hat zwei Formen (G1): mit Freischaltung Off, Tease, Hot, Explicit; ohne sie Off und On (waehlbar) und die drei Stufen gesperrt und nie markiert.
    // Wechselt die Form (Pack kommt oder geht bei offener Seite), wird der Baustein neu gebaut und gezeichnet, nie geschrieben.
    if (!wahl || form !== stufeFrei) {
      const alt = wahl;
      const hatteFokus = !!alt && alt.element.contains(document.activeElement); // K4i
      wahl = baueWahlkarten({
        titel: TEXT.erwachsenTitel,
        karten: erwachsenKarten(stufeFrei).map((id) => ({ id, ...TEXT.erwachsenKarten[id] })),
        wert: null,
        spalten: 2,
        beiAenderung: waehle,
      });
      wahl.element.id = 'iv-erw-wahl';
      if (alt) alt.element.replaceWith(wahl.element);
      else ort.append(wahl.element);
      form = stufeFrei;
      fokusNachWechsel = hatteFokus;
    }
    // Erst sperren (I5b: nur ueber setzeGesperrt, nie `disabled` von aussen), dann markieren: die Markierung legt den Tab-Halt auf die gewaehlte, sonst auf die erste waehlbare Karte.
    wahl.setzeGesperrt(erwachsenGesperrt(stufeFrei));
    wahl.setze(erwachsenKarte(e.erwachsen, stufeFrei));
    // K4i: stand der Fokus in der alten Gruppe, liegt er auf der markierten Karte der neuen Form (sonst der ersten waehlbaren), nie auf body
    if (fokusNachWechsel) {
      fokusNachWechsel = false;
      wahl.setzeFokus();
    }
    zeichneHinweis();
    ersatz.hidden = !ersatzWarnungGilt(e.erwachsen, p);
  };
  return { knoten: wurzel, aktualisiere: (e, p) => zeichne(e, p) };
}

// ---------- 6 Extras (nur mit Pack beim Einstieg) ----------

export function seiteExtras(k: Kontext): Seite {
  const wurzel = knoten('div');
  wurzel.append(knoten('p', undefined, TEXT.i6Text));
  const hinweis = packHinweis(k, TEXT.ohnePack6);
  const ruhig = baueSchalter({ titel: TEXT.ruhigTitel, hinweis: TEXT.ruhigText, an: k.einst().ruhig, beiAenderung: (an) => void k.speichere(() => ({ ruhig: an })) });
  ruhig.knopf.id = 'iv-ruhig';
  const blitz = baueAuswahl({
    titel: TEXT.blitzTitel,
    optionen: [
      { wert: 'aus', text: TEXT.blitzAus },
      { wert: 'selten', text: TEXT.blitzSelten },
      { wert: 'oft', text: TEXT.blitzOft },
    ],
    wert: k.einst().kontrolle.blitz,
    beiAenderung: (w) => void k.speichere((alt) => ({ kontrolle: { ...alt.kontrolle, blitz: w as BlitzHaeufigkeit } })),
  });
  blitz.auswahl.id = 'iv-blitz';
  const auchAn = knoten('p', 'hinweis auch-an', undefined, 'iv-auch-an');
  wurzel.append(hinweis, ruhig.element, blitz.element, auchAn);
  return {
    knoten: wurzel,
    aktualisiere: (e, p) => {
      hinweis.hidden = p !== null;
      ruhig.setze(e.ruhig);
      blitz.setze(e.kontrolle.blitz);
      // Fund 3: nennt nur, was ab Werk an ist und hier nicht gefragt wird (und gerade wirklich an ist).
      const an = (['werbung', 'tabtitel', 'meldungen'] as const).filter((n) => e.kontrolle[n]).map((n) => TEXT.auchAnNamen[n]);
      // Fund 21: eigener Absatz mit Link zu den Einstellungen (neuer Tab, das Interview bleibt).
      const link = knoten('a', undefined, TEXT.auchAnLink, 'iv-auch-an-link');
      link.href = k.pfadOptionen('#kontrolle');
      link.target = '_blank';
      link.rel = 'noopener';
      if (an.length) auchAn.replaceChildren(`${TEXT.auchAn(an)} `, link);
      else auchAn.replaceChildren();
      auchAn.hidden = an.length === 0;
    },
  };
}

// ---------- Schritte links und Platz der festen Vorschau (I9) ----------

// Liste der Fragen mit der aktuellen, nicht bedienbar (Fortschritt und "Back" bleiben die Wege). Sechs Namen mit Pack, vier ohne.
export function baueSchritteListe(nr: number, seiten: number): HTMLElement {
  const nav = knoten('nav', 'iv-schritte');
  nav.setAttribute('aria-label', TEXT.schritteAria);
  const ol = knoten('ol');
  TEXT.schritteNamen.slice(0, seiten).forEach((name, i) => {
    const li = knoten('li', undefined, name);
    li.dataset.zustand = i + 1 < nr ? 'fertig' : i + 1 === nr ? 'jetzt' : 'danach';
    if (i + 1 === nr) li.setAttribute('aria-current', 'step');
    ol.append(li);
  });
  nav.append(ol);
  return nav;
}

// Der Platz zeigt ein Beispielbild, verdeckt wie die Erweiterung es verdecken wuerde (E5, src/oberflaeche/vorschau/), oder ohne Beispielbilder im Bau die Stilvorschau, nur
// gelesen. Keine eigene Kopie der Einstellungen: jede Seite ruft `zeichne` mit dem Stand, der gilt.
export function baueVorschau(): { element: HTMLElement; zeichne: (e: Einstellungen, p: PackKurz | null) => void } {
  const aside = knoten('aside', 'iv-vorschau');
  const kopf = knoten('p', 'iv-vorschau-kopf', TEXT.vorschauKopf);
  // Der Praefix `vorschau` haelt die Filter-Kennungen der Strichzeichnung getrennt von denen der Stilkarten (keine doppelte id im Dokument).
  const live = baueLiveVorschau({ label: TEXT.vorschauLabel, praefix: 'vorschau' });
  aside.append(kopf, live.element);
  vorschauLive = live;
  return {
    element: aside,
    zeichne: (e, p) => live.aktualisiere({ einstellungen: e, pack: p }),
  };
}

// Die Seite zu einer Nummer (1 bis 6).
export function baueSeite(nr: number, k: Kontext, seiten: number): Seite {
  switch (nr) {
    case 1:
      return seiteZonen(k);
    case 2:
      return seiteKleidung(k);
    case 3:
      return seiteStil(k, seiten);
    case 4:
      return seiteStimmung(k);
    case 5:
      return seiteErwachsen(k);
    default:
      return seiteExtras(k);
  }
}
