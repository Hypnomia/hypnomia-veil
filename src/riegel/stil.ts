// Stil des Riegels (Pastell, geschlossene Shadow Root). Keine Blitze: Farbwechsel nur ueber die Wechselsperre (src/quiz/grenzen.ts).
export const RIEGEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.huelle { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 8px; overflow: auto;
  font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #3b2a4a; background: rgba(255, 240, 248, 0.88); }
.karte { width: 100%; max-width: 480px; max-height: 100%; overflow: hidden; display: flex; flex-direction: column; background: linear-gradient(160deg, #ffe3f1 0%, #efe6ff 100%);
  border: 2px solid #ffb3d6; border-radius: 18px; padding: 14px 16px 16px; box-shadow: 0 6px 24px rgba(120, 70, 140, 0.25); outline: none;
  transition: background-color 0s; }
.scroll { overflow: auto; flex: 1 1 auto; min-height: 0; }
.kopf { flex: none; }
.karte.falsch { background: linear-gradient(160deg, #ffd9e0 0%, #f3e0ff 100%); }
.karte.richtig { background: linear-gradient(160deg, #dcf7e6 0%, #efe6ff 100%); }
.kopf { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.marke { font-weight: 700; letter-spacing: 0.04em; color: #b03a86; }
button { font: inherit; color: #3b2a4a; background: #fff; border: 2px solid #d9a6ff; border-radius: 12px; padding: 8px 14px; min-height: 44px;
  cursor: pointer; }
button:hover { background: #fdf2ff; }
button:focus-visible, input:focus-visible, .fang:focus-visible, .tippbar:focus-visible { outline: 3px solid #7a4cff; outline-offset: 2px; }
button.pause { background: #fff; border-color: #ff7ab8; font-weight: 600; min-height: 40px; padding: 6px 12px; }
.mia { display: flex; align-items: center; gap: 12px; min-height: 64px; margin-bottom: 8px; }
.augen { display: flex; gap: 6px; flex: none; }
.augen svg { width: 40px; height: 40px; }
.chibi { width: 64px; height: 64px; object-fit: contain; flex: none; }
.chibi[hidden] { display: none; }
.satz { margin: 0; font-style: italic; color: #7a2f66; min-height: 1.4em; }
.frage { font-weight: 600; margin: 0 0 10px; }
.antworten { display: grid; gap: 8px; }
.antworten button { text-align: left; }
.zeile { display: flex; gap: 8px; margin-top: 8px; }
input { font: inherit; flex: 1; min-width: 0; min-height: 44px; padding: 8px 10px; border: 2px solid #d9a6ff; border-radius: 12px; background: #fff; color: #3b2a4a; }
.zitat { margin: 6px 0; padding: 8px 10px; background: rgba(255, 255, 255, 0.7); border-left: 4px solid #ff7ab8; border-radius: 8px; font-weight: 600; }
.mitte { display: flex; flex-direction: column; align-items: center; gap: 8px; margin: 8px 0; }
.spirale { display: block; }
.spirale.dreht { animation: dreh linear infinite; }
@keyframes dreh { to { transform: rotate(360deg); } }
.tippbar { cursor: pointer; border-radius: 50%; }
.wortfeld { min-height: 84px; width: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 800; color: #7a2f66; }
.wortfeld.pink { color: #ff2d95; text-decoration: underline; text-decoration-thickness: 4px; text-underline-offset: 6px; }
.kreis { width: 150px; height: 150px; border-radius: 50%; border: 4px solid #ff7ab8; background: rgba(255, 179, 214, 0.35); }
.zeit { font-weight: 700; color: #b03a86; min-height: 1.4em; }
.fang { min-height: 44px; width: 100%; display: flex; align-items: center; justify-content: center; border-radius: 12px; border: 2px dashed #d9a6ff; padding: 6px; text-align: center; }
.warnung { margin: 4px 0 10px; }
@media (max-width: 520px) { .huelle { padding: 0; } .karte { max-width: none; min-height: 100%; border-radius: 0; border-width: 0; } }
@media (prefers-reduced-motion: reduce) { .spirale.dreht { animation: none; } }
`;
