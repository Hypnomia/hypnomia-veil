// Die Hypno-Aufgaben im Riegel (QUIZ-ENTWURF Teil 3 plus Android-Fingeraufgaben). Jede Aufgabe baut ihre Oberflaeche in `szene.buehne`
// (nur `textContent`) und liefert true (geschafft) oder false (falsch, der Riegel zieht sofort eine neue Frage). Alle Werte kommen
// geklemmt aus `begrenzeAufgabe` (src/quiz/grenzen.ts); Woerter laufen nie schneller als 2 je Sekunde, nie ein vollflaechiger Wechsel.
import {
  mischeBuchstaben,
  pruefeBuchstaben,
  pruefeCountdown,
  pruefeWortTippen,
  pruefeZahl,
  waehlePinkFolge,
  waehleZaehlFolge,
} from '../quiz/logik';
import type { AufgabeSicher } from '../quiz/grenzen';
import type { AufgabenTyp, FrageAufgabe } from '../quiz/vertrag';

export interface Szene {
  readonly buehne: HTMLElement;
  readonly zufall: () => number;
  jetzt(): number;
  zeit(fn: () => void, ms: number): void;
  takt(fn: () => void, ms: number): void;
  hoere(ziel: EventTarget, typ: string, fn: (e: any) => void, opt?: AddEventListenerOptions): void;
  taste(fn: (e: KeyboardEvent) => void): void;
  fokus(el: HTMLElement): void;
  spirale(groesse: number): SVGElement;
  // Meldung fuer die Testsicht (Zustand der Aufgabe), nur im Testbau gelesen.
  zustand(text: string): void;
}

export const RUHE_NACH_KLICK_MS = 2000; // klicken-zaehlen: so lange nichts mehr, dann wird gezaehlt
export const FREIGABE_FRIST_MS = 2000; // leertaste-halten: nach "Now." so lange Zeit zum Loslassen

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  return e;
}

type Aufgabe = (s: Szene, a: AufgabeSicher, f: FrageAufgabe) => Promise<boolean>;

function anweisung(s: Szene, f: FrageAufgabe): void {
  const p = el('p', 'frage', f.frage);
  p.id = 'frage';
  s.buehne.append(p);
}

// Eingabezeile mit Knopf; Enter schickt ab (Tasten laufen ueber den Tastenschutz, nie ueber Listener am Eingabefeld).
export function eingabeZeile(s: Szene, knopf = 'Answer'): Promise<string> {
  return new Promise((fertig) => {
    const zeile = el('div', 'zeile');
    const feld = el('input');
    feld.type = 'text';
    feld.autocomplete = 'off';
    feld.spellcheck = false;
    feld.setAttribute('autocapitalize', 'off');
    feld.setAttribute('autocorrect', 'off');
    feld.setAttribute('aria-label', 'Your answer');
    const k = el('button', '', knopf);
    k.type = 'button';
    zeile.append(feld, k);
    s.buehne.append(zeile);
    let fertigGemeldet = false;
    const sende = () => {
      if (fertigGemeldet) return;
      fertigGemeldet = true;
      fertig(feld.value);
    };
    s.hoere(k, 'click', sende);
    s.taste((e) => {
      if (e.type === 'keydown' && e.key === 'Enter' && feld.matches(':focus')) {
        // Das Absenden wechselt die Frage und den Fokus: die Taste darf danach nicht noch den neuen Knopf ausloesen (keypress/click).
        e.preventDefault();
        sende();
      }
    });
    s.fokus(feld);
  });
}

// Fangfeld: fokussierbar, damit Tastenereignisse im Riegel landen.
function fang(s: Szene, text: string): HTMLElement {
  const f = el('div', 'fang', text);
  f.tabIndex = 0;
  s.buehne.append(f);
  s.fokus(f);
  return f;
}

function spiraleMitte(s: Szene, groesse: number): SVGElement {
  const mitte = el('div', 'mitte');
  const sp = s.spirale(groesse);
  mitte.append(sp);
  s.buehne.append(mitte);
  return sp;
}

const spiraleAnsehen: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    spiraleMitte(s, 180);
    const zeit = el('div', 'zeit');
    s.buehne.append(zeit);
    fang(s, 'Eyes on the spiral.');
    let seit = s.jetzt();
    let letzte: [number, number] | null = null;
    const bewegt = (e: PointerEvent) => {
      if (!e.isTrusted) return; // Ereignisse der Seite zaehlen nicht
      if (!letzte) {
        letzte = [e.clientX, e.clientY];
        return;
      }
      if (Math.hypot(e.clientX - letzte[0], e.clientY - letzte[1]) > 3) {
        letzte = [e.clientX, e.clientY];
        seit = s.jetzt();
      }
    };
    s.hoere(window, 'pointermove', bewegt, { capture: true, passive: true });
    s.hoere(window, 'pointerdown', (e: PointerEvent) => e.isTrusted && (seit = s.jetzt()), { capture: true, passive: true });
    s.takt(() => {
      const rest = a.sekunden * 1000 - (s.jetzt() - seit);
      zeit.textContent = `${Math.max(0, Math.ceil(rest / 1000))}`;
      s.zustand(`ansehen:${Math.max(0, Math.ceil(rest / 1000))}`);
      if (rest <= 0) fertig(true);
    }, 100);
  });

const wortTippen: Aufgabe = async (s, a, f) => {
  anweisung(s, f);
  const wert = await eingabeZeile(s);
  return pruefeWortTippen(wert, a.wort, a.anzahl);
};

const zaehlen: Aufgabe = async (s, a, f) => {
  anweisung(s, f);
  const feld = el('div', 'wortfeld');
  feld.setAttribute('aria-live', 'off');
  s.buehne.append(feld);
  const { folge, richtig } = waehleZaehlFolge(a.woerter, a.wort, a.anzahlWoerter, s.zufall);
  await new Promise<void>((weiter) => {
    let i = 0;
    const zeige = () => {
      if (i >= folge.length) {
        feld.textContent = '';
        weiter();
        return;
      }
      feld.textContent = folge[i++]!;
      s.zeit(zeige, a.wortMs);
    };
    s.zeit(zeige, 400);
  });
  s.buehne.append(el('p', 'frage', 'How many?'));
  const wert = await eingabeZeile(s);
  return pruefeZahl(wert, richtig);
};

const imKreis: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const mitte = el('div', 'mitte');
    const kreis = el('div', 'kreis');
    const zeit = el('div', 'zeit');
    mitte.append(kreis, zeit);
    s.buehne.append(mitte);
    fang(s, 'Stay inside the circle.');
    let zeiger: [number, number] | null = null;
    let seit: number | null = null;
    s.hoere(window, 'pointermove', (e: PointerEvent) => e.isTrusted && (zeiger = [e.clientX, e.clientY]), { capture: true, passive: true });
    // Verlaesst der Zeiger das Fenster, gilt er nicht mehr als innen
    s.hoere(document.documentElement, 'pointerleave', (e: Event) => e.isTrusted && (zeiger = null));
    s.hoere(document.documentElement, 'mouseleave', (e: Event) => e.isTrusted && (zeiger = null));
    s.hoere(window, 'blur', (e: Event) => e.isTrusted && (zeiger = null));
    s.takt(() => {
      const r = kreis.getBoundingClientRect();
      const innen = !!zeiger && Math.hypot(zeiger[0] - (r.left + r.width / 2), zeiger[1] - (r.top + r.height / 2)) <= r.width / 2;
      if (!innen) seit = null;
      else if (seit === null) seit = s.jetzt();
      const rest = seit === null ? a.sekunden : a.sekunden - (s.jetzt() - seit) / 1000;
      zeit.textContent = `${Math.max(0, Math.ceil(rest))}`;
      s.zustand(`kreis:${innen ? 'innen' : 'aussen'}:${Math.max(0, Math.ceil(rest))}`);
      if (seit !== null && rest <= 0) fertig(true);
    }, 100);
  });

// Gemeinsam fuer klicken-zaehlen (Maus oder Fingertipp) und finger-tippen: genau n Klicks mit Mindestabstand, danach Ruhe.
const klickenZaehlen: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const sp = spiraleMitte(s, 200);
    sp.classList.add('tippbar');
    sp.removeAttribute('aria-hidden'); // tippbar: fuer Hilfstechnik sichtbar
    sp.setAttribute('role', 'button');
    sp.setAttribute('aria-label', 'Spiral');
    sp.setAttribute('tabindex', '0');
    sp.setAttribute('data-ziel', '');
    let n = 0;
    let letzte = Number.NEGATIVE_INFINITY;
    let fertigGemeldet = false;
    const ende = (ok: boolean) => {
      if (fertigGemeldet) return;
      fertigGemeldet = true;
      fertig(ok);
    };
    const klick = () => {
      const t = s.jetzt();
      if (t - letzte < a.abstandMs) return ende(false);
      letzte = t;
      n++;
      s.zustand(`klicks:${n}`);
      if (n > a.anzahl) return ende(false);
      s.zeit(() => {
        if (s.jetzt() - letzte >= RUHE_NACH_KLICK_MS - 5) ende(n === a.anzahl);
      }, RUHE_NACH_KLICK_MS);
    };
    s.hoere(sp, 'click', klick);
    s.taste((e) => {
      if (e.type === 'keydown' && !e.repeat && (e.key === 'Enter' || e.key === ' ') && sp.matches(':focus')) {
        e.preventDefault();
        klick();
      }
    });
  });

const buchstabenTakt: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const zeit = el('div', 'zeit');
    s.buehne.append(zeit);
    fang(s, 'Type with the keyboard.');
    const soll = [...a.wort.replace(/\s+/g, '').toLowerCase()];
    let i = 0;
    let letzte: number | null = null;
    s.taste((e) => {
      if (e.type !== 'keydown' || e.repeat || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = s.jetzt();
      if (letzte !== null && (t - letzte < a.taktMinMs || t - letzte > a.taktMaxMs)) return fertig(false);
      if (e.key.toLowerCase() !== soll[i]) return fertig(false);
      letzte = t;
      i++;
      zeit.textContent = soll.slice(0, i).join('').toUpperCase();
      s.zustand(`takt:${i}`);
      if (i === soll.length) fertig(true);
    });
  });

const pinkKlicken: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const feld = el('div', 'wortfeld tippbar');
    feld.tabIndex = 0;
    feld.setAttribute('role', 'button');
    feld.setAttribute('aria-label', 'Click here');
    s.buehne.append(feld);
    s.fokus(feld);
    const { folge, pink } = waehlePinkFolge(a.woerter, a.anzahlWoerter, s.zufall);
    let i = -1;
    let aktivPink = false;
    let fertigGemeldet = false;
    const ende = (ok: boolean) => {
      if (fertigGemeldet) return;
      fertigGemeldet = true;
      fertig(ok);
    };
    const schritt = () => {
      i++;
      if (i >= folge.length) return ende(false);
      feld.textContent = folge[i]!;
      aktivPink = i === pink;
      feld.classList.toggle('pink', aktivPink);
      s.zustand(`pink:${aktivPink ? 'ja' : 'nein'}`);
      s.zeit(schritt, a.wortMs);
    };
    const klick = () => ende(aktivPink);
    s.hoere(feld, 'click', klick);
    s.taste((e) => {
      if (e.type === 'keydown' && !e.repeat && (e.key === 'Enter' || e.key === ' ') && feld.matches(':focus')) {
        e.preventDefault();
        klick();
      }
    });
    s.zeit(schritt, 500);
  });

const countdown: Aufgabe = async (s, a, f) => {
  anweisung(s, f);
  const wert = await eingabeZeile(s);
  return pruefeCountdown(wert, a.von, a.wort);
};

const leertasteHalten: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const zeit = el('div', 'zeit');
    s.buehne.append(zeit);
    const fangFeld = fang(s, 'Hold the space bar.');
    let seit: number | null = null;
    let jetztAb: number | null = null;
    let fertigGemeldet = false;
    const ende = (ok: boolean) => {
      if (fertigGemeldet) return;
      fertigGemeldet = true;
      fertig(ok);
    };
    s.taste((e) => {
      if (e.code !== 'Space' || !fangFeld.matches(':focus')) return;
      e.preventDefault();
      if (e.type === 'keydown' && !e.repeat && seit === null) {
        seit = s.jetzt();
        s.zustand('halten');
      } else if (e.type === 'keyup') {
        if (jetztAb !== null && s.jetzt() - jetztAb <= FREIGABE_FRIST_MS) ende(true);
        else ende(false);
      }
    });
    s.takt(() => {
      if (seit === null) return;
      const t = s.jetzt();
      if (jetztAb === null) {
        const rest = a.sekunden * 1000 - (t - seit);
        zeit.textContent = `${Math.max(0, Math.ceil(rest / 1000))}`;
        if (rest <= 0) {
          jetztAb = t;
          zeit.textContent = 'Now.';
          s.zustand('jetzt');
        }
      } else if (t - jetztAb > FREIGABE_FRIST_MS) ende(false);
    }, 100);
  });

const widerstehen: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const mitte = el('div', 'mitte');
    const knopf = el('button', '', 'Click me');
    knopf.type = 'button';
    const zeit = el('div', 'zeit');
    mitte.append(knopf, zeit);
    s.buehne.append(mitte);
    fang(s, 'Resist.');
    const t0 = s.jetzt();
    s.hoere(knopf, 'click', () => fertig(false));
    s.takt(() => {
      const rest = a.sekunden * 1000 - (s.jetzt() - t0);
      zeit.textContent = `${Math.max(0, Math.ceil(rest / 1000))}`;
      s.zustand(`widerstehen:${Math.max(0, Math.ceil(rest / 1000))}`);
      if (rest <= 0) fertig(true);
    }, 100);
  });

const wortBlitz: Aufgabe = async (s, a, f) => {
  anweisung(s, f);
  const feld = el('div', 'wortfeld');
  s.buehne.append(feld);
  await new Promise<void>((weiter) => {
    s.zeit(() => {
      feld.textContent = a.wort;
      s.zeit(() => {
        feld.textContent = '';
        weiter();
      }, a.zeigeMs);
    }, 700);
  });
  const wert = await eingabeZeile(s);
  return pruefeBuchstaben(wert, a.wort);
};

const buchstabenRaetsel: Aufgabe = async (s, a, f) => {
  anweisung(s, f);
  const gemischt = a.gemischt || mischeBuchstaben(a.wort, s.zufall);
  s.buehne.append(el('div', 'zitat', gemischt));
  const wert = await eingabeZeile(s);
  return pruefeBuchstaben(wert, a.wort);
};

const fingerHalten: Aufgabe = (s, a, f) =>
  new Promise((fertig) => {
    anweisung(s, f);
    const sp = spiraleMitte(s, 200);
    sp.classList.add('tippbar');
    sp.removeAttribute('aria-hidden');
    sp.setAttribute('role', 'button');
    sp.setAttribute('aria-label', 'Hold your finger here');
    sp.style.touchAction = 'none';
    const zeit = el('div', 'zeit');
    s.buehne.append(zeit);
    let seit: number | null = null;
    s.hoere(sp, 'pointerdown', (e: PointerEvent) => {
      try {
        sp.setPointerCapture(e.pointerId);
      } catch {
        // ohne Capture reicht der Abbruch ueber pointerup
      }
      seit = s.jetzt();
      s.zustand('finger:unten');
    });
    const los = () => {
      seit = null;
      zeit.textContent = '';
      s.zustand('finger:oben');
    };
    s.hoere(sp, 'pointerup', los);
    s.hoere(sp, 'pointercancel', los);
    s.takt(() => {
      if (seit === null) return;
      const rest = a.sekunden * 1000 - (s.jetzt() - seit);
      zeit.textContent = `${Math.max(0, Math.ceil(rest / 1000))}`;
      if (rest <= 0) fertig(true);
    }, 100);
  });

export const AUFGABEN: Record<AufgabenTyp, Aufgabe> = {
  'spirale-ansehen': spiraleAnsehen,
  'wort-tippen': wortTippen,
  zaehlen,
  'im-kreis': imKreis,
  'klicken-zaehlen': klickenZaehlen,
  'buchstaben-takt': buchstabenTakt,
  'pink-klicken': pinkKlicken,
  countdown,
  'leertaste-halten': leertasteHalten,
  widerstehen,
  'wort-blitz': wortBlitz,
  'buchstaben-raetsel': buchstabenRaetsel,
  'finger-halten': fingerHalten,
  'finger-tippen': klickenZaehlen,
};
