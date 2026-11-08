// "Fewer notes?" (Session 17, UX-Pruefung Phase 9 Fund 25): wer drei Meldungen hintereinander innerhalb eines Tages mit dem Kreuz wegklickt,
// will vermutlich weniger. Die naechste Meldung traegt dann einmal die Zeile "Fewer notes?" mit dem Knopf "Turn my notes off", hoechstens
// einmal pro Woche. Reine Logik ohne Browser-Aufrufe (Einheitstest); der Stand liegt in storage.local unter `WENIGER_SCHLUESSEL`.
export const WENIGER_SCHLUESSEL = 'meldungWeniger';
export const WENIGER_FOLGE = 3;
export const TAG_MS = 24 * 60 * 60_000;
export const WOCHE_MS = 7 * TAG_MS;

export interface WenigerStand {
  // Wie viele Meldungen in Folge mit dem Kreuz geschlossen wurden (eine von selbst verschwundene Meldung beendet die Folge).
  folge: number;
  // Zeitpunkt (ms) des ersten Schliessens dieser Folge.
  seit: number;
  // Die naechste Meldung stellt die Frage.
  fragt: boolean;
  // Zeitpunkt (ms) der letzten gestellten Frage (0: nie).
  gefragt: number;
}

export const LEERER_STAND: WenigerStand = { folge: 0, seit: 0, fragt: false, gefragt: 0 };

const zahl = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);

export function vervollstaendigeWeniger(roh: unknown): WenigerStand {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, unknown>;
  return { folge: Math.min(1000, Math.floor(zahl(r.folge))), seit: zahl(r.seit), fragt: r.fragt === true, gefragt: zahl(r.gefragt) };
}

// Die Person hat eine Meldung mit dem Kreuz geschlossen.
export function beiSchliessen(s: WenigerStand, jetzt: number): WenigerStand {
  const frisch = s.folge > 0 && jetzt - s.seit >= 0 && jetzt - s.seit < TAG_MS;
  const folge = frisch ? s.folge + 1 : 1;
  const seit = frisch ? s.seit : jetzt;
  const darfFragen = jetzt - s.gefragt >= WOCHE_MS || s.gefragt > jetzt;
  return { ...s, folge, seit, fragt: s.fragt || (folge >= WENIGER_FOLGE && darfFragen) };
}

// Eine Meldung ist von selbst verschwunden (oder aus anderem Grund weg): die Folge ist unterbrochen. Eine vorgemerkte Frage bleibt.
export function beiAblauf(s: WenigerStand): WenigerStand {
  return { ...s, folge: 0, seit: 0 };
}

// Soll die Meldung, die jetzt erscheint, die Frage tragen?
export function fragtJetzt(s: WenigerStand, jetzt: number): boolean {
  return s.fragt && (jetzt - s.gefragt >= WOCHE_MS || s.gefragt > jetzt);
}

// Die Frage wurde gestellt: nicht noch einmal diese Woche.
export function nachFrage(_s: WenigerStand, jetzt: number): WenigerStand {
  return { folge: 0, seit: 0, fragt: false, gefragt: jetzt };
}
