// Wort-Schrift `VEIL Wort` (public/schrift/rounded-800.woff2): einmal je Dokument registrieren, ohne onnxruntime. Der Erkenner (Hintergrund,
// Offscreen-Dokument) und die Vorschau der Erweiterungsseiten benutzen dieses Modul gemeinsam, damit Woerter erst gezeichnet werden, wenn die Schrift
// wirklich geladen ist (`fonts.check` beweist das nicht). `wortSchriftFertig` wird erst nach dem Laden gesetzt. Scheitert das Laden (auch synchron),
// gilt die Systemschrift und es wird fruehestens nach WORT_SCHRIFT_PAUSE_MS wieder versucht (nie bei jedem Wort neu).
import { WORT_FAMILIE } from './stile';

const WORT_SCHRIFT_PAUSE_MS = 30_000;
let wortSchriftFertig = false;
let wortSchriftLaeuft: Promise<void> | null = null;
let wortSchriftFehlerBis = 0;
const jetzt = (): number => performance.now();

export function ladeWortSchrift(): Promise<void> {
  if (wortSchriftFertig) return Promise.resolve();
  if (wortSchriftLaeuft) return wortSchriftLaeuft;
  if (jetzt() < wortSchriftFehlerBis) return Promise.resolve();
  const lauf = (async () => {
    try {
      if (typeof FontFace !== 'function' || typeof document === 'undefined') return; // kein Dokument: Systemschrift, nichts zu versuchen
      const ff = new FontFace(WORT_FAMILIE, `url(${(browser.runtime.getURL as (p: string) => string)('/schrift/rounded-800.woff2')})`, { weight: '800' });
      await ff.load();
      document.fonts.add(ff);
      wortSchriftFertig = true;
    } catch {
      wortSchriftFehlerBis = jetzt() + WORT_SCHRIFT_PAUSE_MS;
    } finally {
      wortSchriftLaeuft = null;
    }
  })();
  wortSchriftLaeuft = lauf;
  return lauf;
}
