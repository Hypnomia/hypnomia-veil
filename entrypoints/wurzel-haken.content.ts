// Haken fuer Shadow Roots (PHASE-3-BAUPLAN Auftrag R): laeuft in der Seitenwelt (world MAIN) vor allen Seitenskripten und umhaengt
// Element.prototype.attachShadow. Jede neue Wurzel (offen und geschlossen) bekommt im ersten Mikrotask nach attachShadow ein style-Element
// (Kennzeichen data-veil-haken) am ENDE der Wurzel: die Kinder der Wurzel bleiben waehrend der synchronen Kette (Konstruktor, connectedCallback)
// unberuehrt, und gezeichnet wird zwischen attachShadow und Mikrotask nie. Leert die Seite die Wurzel (innerHTML), legt ein MutationObserver
// dasselbe Element im Rueckruf wieder ein.
// Dem Schleier (Content-Script in der isolierten Welt) wird die Wurzel per Ereignis am Host gemeldet; der Schleier uebernimmt den Stil
// (src/schleier/shadow.ts: versorgeWurzel tauscht das Kennzeichen gegen data-veil-eigen) und sichert ihn dann selbst. Der Haken fasst nur
// Stile an, die er selbst angelegt hat; uebernommene Stile (data-veil-eigen) schaltet er nur ab, wenn die Erweiterung verschwunden ist.
// Keine Befehle aus der Seite: es gibt kein Ereignis, das den Haken schaltet. Er liest selbst
//   - html[data-veil-seite="aus"] (Pause, Ausnahme, Abbau): dann sind seine Stile per media abgeschaltet, neue Wurzeln starten abgeschaltet;
//   - das Lebenszeichen `--veil-lebt` der Manifest-CSS (entrypoints/content/style.css), nie im heissen Pfad, sondern in einem Takt von 1 s
//     (zuletzt bekannter Wert, Verzug bis etwa 1 s ist gewollt). Verschwindet es (Erweiterung entfernt oder abgeschaltet, die Seite bleibt offen),
//     schlaeft der Haken: er legt nichts mehr an, entfernt seine nicht uebernommenen Stile und schaltet uebernommene per media ab. Kehrt das
//     Zeichen zurueck (Neu-Einspritzen nach einem Update), laeuft er wieder an.
// Robustheit ehrlich: der Haken sitzt vor allen Seitenskripten und ruft das Original immer auf. Wer spaeter attachShadow umhaengt, ruft unseren
// Haken mit auf. Umgehen koennen ihn Wurzeln, die deklarativ im HTML entstehen (template shadowrootmode), und Skripte, die ein unberuehrtes
// attachShadow besitzen, etwa aus einem frisch erzeugten about:blank-Frame, bevor dort unser Skript lief. Solche Wurzeln fasst nur die Suche des
// Schleiers (src/schleier/beobachter.ts) im Rueckruf des MutationObserver des Dokuments, noch vor dem naechsten Zeichnen. Ein Fehler im Haken
// bricht attachShadow nie: das Ergebnis des Originals kommt immer zurueck. Je Wurzel hoechstens 20 Wiedereinlegungen je Sekunde, ein weiteres
// am Ende des Fensters (Drosselung statt Aufgeben).
export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  main() {
    const proto = Element.prototype;
    const original = proto.attachShadow;
    if (typeof original !== 'function') return;
    // Schutz gegen doppeltes Einrichten (Skript zweimal eingespritzt, etwa nach einem Update in Firefox): das Kennzeichen steht am Prototyp,
    // unsichtbar fuer Aufzaehlungen. Sicherheitspruefung Phase 9 Fund A3: kein Symbol.for mit Namen (jede Seite konnte es ueber das globale
    // Register abfragen), sondern ein Symbol ohne Beschreibung und ohne Register. Ein zweites Einspritzen erkennt es an der Form des
    // Eintrags (eigenes Symbol ohne Beschreibung, Wert true, weder schreib- noch aenderbar). Ganz unerkennbar ist der Haken damit nicht
    // (umgehaengtes attachShadow, Lebenszeichen, Attribute gehoeren zur Funktion), nur nicht mehr per Name.
    const istKennzeichen = (s: symbol): boolean => {
      if (s.description !== undefined) return false;
      const d = Object.getOwnPropertyDescriptor(proto, s);
      return !!d && d.value === true && d.writable === false && d.enumerable === false && d.configurable === false;
    };
    // Ein Haken aus Version 0.9.0 und frueher (offene Tabs ueber ein Update hinweg) trug das alte Kennzeichen; das Nachsehen legt nichts an
    // und kein Eintrag entsteht am Prototyp. Entfernbar, sobald keine Installation mehr von 0.9.0 aus aktualisiert (ab Version 1.0).
    const ALT = Symbol.for('hypnomia-veil.wurzel-haken');
    if (Object.prototype.hasOwnProperty.call(proto, ALT) || Object.getOwnPropertySymbols(proto).some(istKennzeichen)) return;
    Object.defineProperty(proto, Symbol(), { value: true });

    // Eigene Verweise auf die Browserfunktionen, damit spaetere Aenderungen durch die Seite den Haken nicht stoeren.
    const erzeuge = Document.prototype.createElement;
    const anhaengen = DocumentFragment.prototype.append;
    const setzeAttribut = Element.prototype.setAttribute;
    const leseAttribut = Element.prototype.getAttribute;
    const hatAttribut = Element.prototype.hasAttribute;
    const entferne = Element.prototype.remove;
    const sende = EventTarget.prototype.dispatchEvent;
    const hoere = EventTarget.prototype.addEventListener;
    const mikrotask = window.queueMicrotask.bind(window);
    const stilVonFenster = window.getComputedStyle.bind(window);
    const setzeZeit = window.setTimeout.bind(window);
    const NeuesEreignis = Event;
    const Beobachter = MutationObserver;
    const Schwach = WeakRef;
    const doc = document;

    // Dieselbe Regel wie in entrypoints/content/style.css (Versteck-Regel, nur ohne Urteil und ohne die Ausnahme fuer html[data-veil-seite], die es in
    // Wurzeln nicht gibt); ein Einheitstest vergleicht beide. Der Schleier ersetzt den Text beim Uebernehmen durch die ganze Datei.
    const REGEL =
      ':is(img, video, canvas, svg image, [style*="background" i][style*="url(" i]):not([data-veil="frei"], [data-veil="zensiert"], [data-veil="verdeckt"]) { opacity: 0 !important; }';
    const MARKE_HAKEN = 'data-veil-haken';
    const MARKE_EIGEN = 'data-veil-eigen';
    const MAX_WIEDER_JE_S = 20;
    const FENSTER_MS = 1000;
    // Testbau auf Testhosts: Zaehler der gedrosselten Wurzeln als Attribut am Wurzelelement (im Release-Bau faellt der Block weg).
    const TESTBAU = import.meta.env.WXT_TESTHAKEN === '1' && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);

    // Alle Stile, die der Haken angelegt hat (schwach), und je Wurzel der eigene Stil.
    const stile = new Set<WeakRef<HTMLStyleElement>>();
    const stilVon = new WeakMap<Node, HTMLStyleElement>();
    const einlegungen = new WeakMap<Node, { von: number; n: number; geplant: boolean }>();
    const gedrosselt = new WeakSet<Node>();
    let anzahlGedrosselt = 0;
    // aus: nur die Attribut-Wache schreibt es. schlaeft: ohne Lebenszeichen. gesehen: das Zeichen wurde je gelesen.
    let aus = false;
    let schlaeft = false;
    let gesehen = false;
    let takt = false;

    const leseAus = (): boolean => {
      const html = doc.documentElement;
      return !!html && leseAttribut.call(html, 'data-veil-seite') === 'aus';
    };

    const markiert = (el: Element, marke: string): boolean => hatAttribut.call(el, marke);

    // Ist in der Wurzel schon ein eigener Stil (des Hakens oder des Schleiers)?
    const hatEigenenStil = (wurzel: ShadowRoot): boolean => {
      for (const kind of wurzel.children) {
        if (kind.localName === 'style' && (markiert(kind, MARKE_HAKEN) || markiert(kind, MARKE_EIGEN))) return true;
      }
      return false;
    };

    // Stellt media der Stile nach Pause, Ausnahme und Schlaf ein. Fuer uebernommene Stile (data-veil-eigen) gilt dieselbe Regel, die der Schleier
    // selbst anwendet (Pause und Ausnahme zeigt er am Attribut); der Haken ist dort nur noch zusaetzlich zustaendig, wenn die Erweiterung weg ist.
    const gleicheAn = (): void => {
      for (const ref of stile) {
        const stil = ref.deref();
        if (!stil || !(markiert(stil, MARKE_HAKEN) || markiert(stil, MARKE_EIGEN))) {
          stile.delete(ref);
          continue;
        }
        stil.media = aus || schlaeft ? 'not all' : '';
      }
    };

    // Lebenszeichen der Manifest-CSS lesen. Bevor das Zeichen je gesehen wurde, gilt die Erweiterung als lebendig (die CSS koennte noch nicht
    // angewendet sein).
    const leseLebt = (): boolean => {
      try {
        const html = doc.documentElement;
        if (!html) return true;
        if (stilVonFenster(html).getPropertyValue('--veil-lebt').trim() !== '') {
          gesehen = true;
          return true;
        }
        return !gesehen;
      } catch {
        return true;
      }
    };

    // Ohne Lebenszeichen: schlafen. Eigene nicht uebernommene Stile weg, uebernommene abgeschaltet (Firefox entfernt die Erweiterung, ohne dass der
    // Schleier noch etwas aufraeumt), nichts mehr anlegen.
    const schlafe = (): void => {
      schlaeft = true;
      for (const ref of stile) {
        const stil = ref.deref();
        if (stil && markiert(stil, MARKE_HAKEN)) {
          entferne.call(stil);
          stile.delete(ref);
        }
      }
      gleicheAn();
    };

    const wecke = (): void => {
      schlaeft = false;
      gleicheAn();
    };

    // Takt von 1 s, solange es Stile gibt oder der Haken schlaeft (dann wartet er auf das Zeichen). Kein Lesen im heissen Pfad.
    const planeTakt = (): void => {
      if (takt) return;
      takt = true;
      setzeZeit(() => {
        takt = false;
        const ok = leseLebt();
        if (!ok && !schlaeft) schlafe();
        else if (ok && schlaeft) wecke();
        else gleicheAn();
        if (stile.size || schlaeft) planeTakt();
      }, FENSTER_MS);
    };

    const zaehlerVon = (wurzel: Node) => {
      let z = einlegungen.get(wurzel);
      if (!z) {
        z = { von: 0, n: 0, geplant: false };
        einlegungen.set(wurzel, z);
      }
      return z;
    };

    // Testbau: Zahl der Wurzeln, die die Grenze je erreicht haben.
    const meldeGrenze = (wurzel: Node): void => {
      if (!TESTBAU || gedrosselt.has(wurzel)) return;
      gedrosselt.add(wurzel);
      anzahlGedrosselt++;
      const html = doc.documentElement;
      if (html) setzeAttribut.call(html, 'data-veil-grenze-haken', String(anzahlGedrosselt));
    };

    // Legt den Stil einer geleerten Wurzel wieder ein. Hoechstens MAX_WIEDER_JE_S je Fenster von einer Sekunde; ist die Grenze erreicht, wird genau
    // ein Wiedereinlegen zum Ende des Fensters geplant (gedrosselt, nicht aufgegeben): der Tab bleibt bedienbar, die Wurzel spaeter geschuetzt.
    const legeWiederEin = (wurzel: ShadowRoot, stil: HTMLStyleElement): void => {
      const z = zaehlerVon(wurzel);
      const jetzt = performance.now();
      if (jetzt - z.von >= FENSTER_MS) {
        z.von = jetzt;
        z.n = 0;
      }
      if (z.n < MAX_WIEDER_JE_S) {
        z.n++;
        anhaengen.call(wurzel, stil);
        return;
      }
      meldeGrenze(wurzel);
      if (z.geplant) return;
      z.geplant = true;
      setzeZeit(() => {
        z.geplant = false;
        try {
          if (schlaeft || stilVon.get(wurzel) !== stil || !markiert(stil, MARKE_HAKEN)) return;
          if (stil.parentNode === wurzel || hatEigenenStil(wurzel)) return;
          z.von = performance.now();
          z.n = 1;
          anhaengen.call(wurzel, stil);
        } catch {
          // wie unten
        }
      }, Math.max(0, z.von + FENSTER_MS - jetzt));
    };

    // Leert die Seite eine Wurzel, legt der Haken im Rueckruf (Mikrotask, vor dem Zeichnen) dasselbe Element wieder ein, solange er es verwaltet.
    const wache = new Beobachter((liste) => {
      try {
        if (schlaeft) return;
        for (const m of liste) {
          const wurzel = m.target as ShadowRoot;
          const stil = stilVon.get(wurzel);
          if (!stil) continue;
          if (!markiert(stil, MARKE_HAKEN)) {
            stilVon.delete(wurzel); // vom Schleier uebernommen: ab jetzt sichert er ihn
            continue;
          }
          if (stil.parentNode === wurzel || hatEigenenStil(wurzel)) continue;
          legeWiederEin(wurzel, stil);
        }
      } catch {
        // Der Haken ist nur Vorsorge: ein Fehler hier darf die Seite nicht stoeren.
      }
    });

    // Pause, Ausnahme und Abbau zeigt der Schleier am Wurzelelement (html[data-veil-seite="aus"]); das kann die Seite auch selbst setzen.
    const attributWache = new Beobachter(() => {
      try {
        const neu = leseAus();
        if (neu === aus) return;
        aus = neu;
        gleicheAn();
      } catch {
        // wie oben
      }
    });
    attributWache.observe(doc, { attributes: true, attributeFilter: ['data-veil-seite'], subtree: true });
    hoere.call(doc, 'DOMContentLoaded', () => void leseLebt(), { once: true });

    // Im ersten Mikrotask nach attachShadow: den Stil ans Ende der Wurzel legen und dem Schleier die Wurzel melden.
    const legeStilAn = (host: Element, wurzel: ShadowRoot): void => {
      try {
        if (schlaeft) return;
        if (!hatEigenenStil(wurzel)) {
          const stil = erzeuge.call(host.ownerDocument ?? doc, 'style') as HTMLStyleElement;
          setzeAttribut.call(stil, MARKE_HAKEN, '');
          stil.textContent = REGEL;
          if (leseAus()) stil.media = 'not all';
          anhaengen.call(wurzel, stil);
          stile.add(new Schwach(stil));
          stilVon.set(wurzel, stil);
          wache.observe(wurzel, { childList: true });
          planeTakt();
        }
        // Nur ein Hinweis: der Schleier sucht die Wurzel selbst (wurzelVon) und vertraut dem Ereignis nicht.
        sende.call(host, new NeuesEreignis('veil-wurzel', { bubbles: true, composed: true }));
      } catch {
        // Die Wurzel selbst ist angelegt und unberuehrt: nichts weiter zu tun.
      }
    };

    const haken = {
      attachShadow(this: Element, init: ShadowRootInit): ShadowRoot {
        const wurzel = original.call(this, init);
        try {
          if (!schlaeft) {
            const host = this;
            mikrotask(() => legeStilAn(host, wurzel));
          }
        } catch {
          // Der Haken ist nur Vorsorge: die Wurzel selbst ist angelegt und geht unveraendert zurueck.
        }
        return wurzel;
      },
    }.attachShadow;
    proto.attachShadow = haken;
  },
});
