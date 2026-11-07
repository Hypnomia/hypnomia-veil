// Stil des Riegels (Sakura Glas, Phase 8b; geschlossene Shadow Root). Keine Blitze: Farbwechsel nur ueber die Wechselsperre (src/quiz/grenzen.ts).
import { SEITEN_TOKENS } from '../oberflaeche/design/tokens';

export const RIEGEL_CSS = `
:host { all: initial; }
${SEITEN_TOKENS}
* { box-sizing: border-box; }
.huelle { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 8px; overflow: auto;
  font: 16px/1.4 var(--v-schrift-text); color: var(--v-text); background: rgba(255, 240, 248, 0.88); }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .huelle { -webkit-backdrop-filter: blur(10px) saturate(1.2); backdrop-filter: blur(10px) saturate(1.2); }
}
.karte { width: 100%; max-width: 480px; max-height: 100%; overflow: hidden; display: flex; flex-direction: column;
  background-color: var(--v-glas-stark); background-image: linear-gradient(160deg, rgba(255, 233, 243, 0.55) 0%, rgba(241, 235, 255, 0.55) 100%);
  border: 1px solid var(--v-glas-kante); border-radius: var(--v-r-l); padding: 16px 18px 16px; box-shadow: var(--v-schatten); outline: none;
  transition: background-color 0s; }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .karte { background-color: var(--v-glas); -webkit-backdrop-filter: var(--v-glas-unschaerfe); backdrop-filter: var(--v-glas-unschaerfe); }
}
.scroll { overflow: auto; flex: 1 1 auto; min-height: 0; padding: 6px; margin: -6px; }
.kopf { flex: none; }
.karte.falsch { background-image: linear-gradient(160deg, rgba(255, 211, 224, 0.7) 0%, rgba(243, 224, 255, 0.6) 100%); }
.karte.richtig { background-image: linear-gradient(160deg, rgba(220, 247, 230, 0.75) 0%, rgba(239, 230, 255, 0.6) 100%); }
.kopf { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.marke { display: inline-flex; align-items: center; gap: 8px; font: 800 14px/1.2 var(--v-schrift-display); letter-spacing: 0.02em; color: var(--v-rosa-700); }
.marke .v-augenpaar svg { width: 26px; height: 26px; }
button { font: 700 15px/1.3 var(--v-schrift-text); color: var(--v-text); background: var(--v-glas-stark); border: 1px solid var(--v-rosa-200); border-radius: var(--v-r-m);
  padding: 8px 14px; min-height: 44px; cursor: pointer; transition: box-shadow var(--v-dauer-kurz), border-color var(--v-dauer-kurz); }
button:hover { border-color: var(--v-rosa-300); box-shadow: var(--v-schatten-klein); }
button:focus-visible, input:focus-visible, .fang:focus-visible, .tippbar:focus-visible { outline: 3px solid var(--v-lav-500); outline-offset: 2px; }
button.pause { display: inline-flex; align-items: center; gap: 8px; flex: none; min-height: 40px; padding: 0 14px 0 8px; border-radius: var(--v-r-voll);
  border: 1px solid var(--v-glas-kante); background: linear-gradient(180deg, #fff 0%, var(--v-rosa-50) 100%); box-shadow: var(--v-schatten-pause);
  font: 800 14px/1 var(--v-schrift-display); color: var(--v-rosa-800); }
button.pause::before { content: ''; flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--v-verlauf-akzent);
  background-image: linear-gradient(#fff, #fff), linear-gradient(#fff, #fff), var(--v-verlauf-akzent); background-repeat: no-repeat;
  background-size: 3px 10px, 3px 10px, 100% 100%; background-position: 8px 7px, 13px 7px, 0 0; }
button.pause:hover { box-shadow: var(--v-schatten-pause); border-color: var(--v-rosa-300); }
.mia { display: flex; align-items: flex-end; gap: 12px; min-height: 64px; margin-bottom: 10px; }
.chibi { width: 72px; height: auto; max-height: 96px; object-fit: contain; flex: none; filter: drop-shadow(0 6px 10px rgba(168, 50, 111, 0.25)); }
.chibi[hidden] { display: none; }
/* UX-Pruefung 8b Nr. 3: die Pose sprechblase hat oben rechts eine gemalte leere Blase; neben der echten Sprechblase nur die Figur zeigen. */
.chibi[data-pose='sprechblase'] { aspect-ratio: 0.7; height: 96px; width: auto; object-fit: cover; object-position: 0% 100%; }
.chibi[hidden] + .satz::before { display: none; }
.satz { position: relative; flex: 1 1 auto; min-width: 0; margin: 0 0 4px 8px; min-height: 2.6em; padding: 10px 14px; background: #fff; color: var(--v-rosa-800);
  border: 1px solid var(--v-rosa-100); border-radius: 18px 18px 18px 6px; box-shadow: var(--v-schatten-klein); font: 700 14px/1.45 var(--v-schrift-text); }
.satz::before { content: ''; position: absolute; left: -7px; bottom: 8px; width: 14px; height: 14px; background: #fff; border-left: 1px solid var(--v-rosa-100);
  border-bottom: 1px solid var(--v-rosa-100); transform: rotate(45deg); border-radius: 0 0 0 4px; }
.frage { font: 800 18px/1.35 var(--v-schrift-display); color: var(--v-text); margin: 6px 0 12px; }
.antworten { display: grid; gap: 8px; counter-reset: antwort; }
.antworten button { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 10px 14px 10px 12px; text-align: left; background: var(--v-glas-stark);
  border: 1px solid var(--v-rosa-200); border-radius: 14px; }
.antworten button::before { counter-increment: antwort; content: counter(antwort); flex: none; width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center;
  font: 800 13px/1 var(--v-schrift-text); color: var(--v-rosa-800); background: linear-gradient(135deg, var(--v-rosa-100), var(--v-lav-100)); border: 1px solid #fff; }
.zeile { display: flex; gap: 8px; margin-top: 8px; }
.zeile button, .buehne > button { min-height: 48px; background: var(--v-verlauf-akzent); color: #fff; border: 0; border-radius: var(--v-r-voll); padding: 8px 20px; box-shadow: var(--v-schatten-knopf); font-weight: 800; }
input { font: inherit; flex: 1; min-width: 0; min-height: 44px; padding: 8px 12px; border: 1px solid var(--v-rand); border-radius: 14px; background: #fff; color: var(--v-text); }
.zitat { margin: 6px 0; padding: 8px 12px; background: rgba(255, 255, 255, 0.75); border-left: 4px solid var(--v-rosa-300); border-radius: 10px; font-weight: 700; }
.mitte { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 8px 0; }
.spirale { display: block; }
.spirale.dreht { animation: dreh linear infinite; }
@keyframes dreh { to { transform: rotate(360deg); } }
.tippbar { cursor: pointer; border-radius: 50%; }
.wortfeld { min-height: 84px; width: 100%; display: flex; align-items: center; justify-content: center; font: 800 2rem/1.2 var(--v-schrift-display); color: var(--v-rosa-800); }
.wortfeld.pink { color: #ff2d95; text-decoration: underline; text-decoration-thickness: 4px; text-underline-offset: 6px; }
.kreis { width: 150px; height: 150px; border-radius: 50%; border: 4px solid var(--v-rosa-300); background: rgba(255, 179, 211, 0.35); }
.zeit { font-weight: 800; color: var(--v-rosa-700); min-height: 1.4em; }
.fang { min-height: 44px; width: 100%; display: flex; align-items: center; justify-content: center; border-radius: 14px; border: 2px dashed var(--v-lav-300); padding: 6px; text-align: center; }
.warnung { margin: 4px 0 10px; }
.fuss { flex: none; display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 12px; font-size: 12.5px; font-weight: 700; color: var(--v-leise); }
.ansage { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 520px) { .huelle { padding: 0; } .karte { max-width: none; min-height: 100%; border-radius: 0; border-width: 0; } button.pause { min-height: 44px; } }
@media (pointer: coarse) { button.pause { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .spirale.dreht { animation: none; } }
`;
