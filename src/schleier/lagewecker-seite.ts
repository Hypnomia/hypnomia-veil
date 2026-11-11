// Browser-Umgebung und gemeinsame Instanz des Lageweckers (Logik in lagewecker.ts). Standbild (src/player/standbild.ts) und Zonen-Leinwand
// (video-leinwand.ts) melden sich hier an.
import { TESTHAKEN } from './konstanten';
import { Lagewecker, WECK_EREIGNISSE, WECK_EREIGNISSE_FENSTER, type MutationSatz, type WeckerUmgebung } from './lagewecker';
import { testhakenAktiv } from './status';

export { merkeEigenenHost, type Abonnent } from './lagewecker';

// Testhaken nur im Testbau: Zustand des Weckers am Wurzelelement ({ wach, anlaesse, bilder }), geschrieben nur bei Wechsel. Der Wecker zaehlt
// Markierungen `data-veil...` nicht als Anlass, das Schreiben weckt ihn also nicht.
const ATTR_WECKER = TESTHAKEN ? 'data-veil-lagewecker' : '';

const HORCH = { capture: true, passive: true } as const;

function browserUmgebung(): WeckerUmgebung {
  let w: Lagewecker | null = null;
  const u: WeckerUmgebung = {
    jetzt: () => performance.now(),
    bild: (fn) => requestAnimationFrame(() => fn()),
    bildAb: (h) => cancelAnimationFrame(h),
    verborgen: () => document.hidden,
    animationLaeuft: () => {
      const g = (document as Document & { getAnimations?: () => Animation[] }).getAnimations;
      if (typeof g !== 'function') return false;
      return g.call(document).some((a) => a.playState === 'running');
    },
    beobachte: (wurzel, fn) => {
      const ziel = (wurzel as Node | null) ?? document;
      let m: MutationObserver | null = null;
      try {
        m = new MutationObserver((saetze) => fn(saetze as unknown as readonly MutationSatz[]));
        m.observe(ziel, { subtree: true, childList: true, attributes: true });
      } catch {
        m = null;
      }
      return () => m?.disconnect();
    },
    horche: (wurzel, fn) => {
      const ziel: EventTarget = (wurzel as EventTarget | null) ?? document;
      const h = (): void => fn();
      for (const n of WECK_EREIGNISSE) ziel.addEventListener(n, h, HORCH);
      if (!wurzel) for (const n of WECK_EREIGNISSE_FENSTER) addEventListener(n, h, HORCH);
      return () => {
        for (const n of WECK_EREIGNISSE) ziel.removeEventListener(n, h, HORCH);
        if (!wurzel) for (const n of WECK_EREIGNISSE_FENSTER) removeEventListener(n, h, HORCH);
      };
    },
  };
  if (ATTR_WECKER && testhakenAktiv()) {
    u.zustand = (wach) => {
      try {
        document.documentElement?.setAttribute(ATTR_WECKER, JSON.stringify({ wach, anlaesse: w?.anlaesse ?? 0, bilder: w?.bilder ?? 0 }));
      } catch {
        // egal
      }
    };
  }
  const umg = u;
  return Object.assign(umg, { setze: (x: Lagewecker) => (w = x) });
}

let instanz: Lagewecker | null = null;
export function lagewecker(): Lagewecker {
  if (!instanz) {
    const u = browserUmgebung() as WeckerUmgebung & { setze(x: Lagewecker): void };
    instanz = new Lagewecker(u);
    u.setze(instanz);
  }
  return instanz;
}

// Alle Schattenwurzeln, in denen das Element liegt (von innen nach aussen; auch geschlossene, getRootNode sieht sie).
export function schattenWurzelnVon(el: Node): ShadowRoot[] {
  const liste: ShadowRoot[] = [];
  let r = el.getRootNode();
  for (let i = 0; i < 32 && r instanceof ShadowRoot; i++) {
    liste.push(r);
    r = r.host.getRootNode();
  }
  return liste;
}
