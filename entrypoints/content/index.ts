// Schleier (Content-Script): verdeckt Bilder, Videos und Canvas vor dem ersten Zeichnen und laesst sie vom Erkenner pruefen.
// Die Logik liegt in src/schleier/. Die Standard-Ausnahmeliste kommt ueber einen Hook in wxt.config.ts als exclude_matches ins
// Manifest (nicht aus diesem Skript, sonst landete die Liste im Bundle jeder Seite): auf diesen Seiten laeuft das Content-Script
// gar nicht. Eigene Ausnahmen und Pause prueft der Schleier zur Laufzeit.
import './style.css';
import { starteSchleier } from '../../src/schleier/schleier';
import { bindeKontext } from '../../src/riegel/riegel';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  cssInjectionMode: 'manifest',
  main(ctx) {
    // Phase 4: Tastenschutz fuer den Riegel sofort (vor allen Seitenskripten), dann der Schleier.
    bindeKontext(ctx);
    starteSchleier(ctx);
  },
});
