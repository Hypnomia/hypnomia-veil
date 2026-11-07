// Gestaltungs-System fuer Shadow Roots in fremden Seiten (Phase 8b): dieselben Werte wie tokens.css, als Zeichenkette.
// Einsatz: an den Anfang des Stils einer geschlossenen Shadow Root setzen, nach `:host { all: initial; }`.
// `all` setzt eigene Variablen nicht zurueck; die Werte stehen trotzdem ausdruecklich am :host, damit die Seite sie nicht ueberschreibt.
import { GEMEINSAM, deklarationen } from './werte';
import { SEITEN_ROUNDED, SEITEN_TEXT } from './familie';

// Lesung S2/R Nr. 1: in fremden Seiten tragen die Schriften zufaellige Familiennamen je Content-Script (familie.ts), damit eine Seite sie nicht
// mit eigenen @font-face-Regeln gleichen Namens ueberschreiben kann (etwa den Text des Pause-Knopfs).
export const SEITEN_TOKENS = `:host { ${deklarationen().replaceAll("'VEIL Rounded'", `'${SEITEN_ROUNDED}'`).replaceAll("'VEIL Text'", `'${SEITEN_TEXT}'`)} }
@keyframes v-funkeln { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.05); } }
@keyframes v-dreh { to { transform: rotate(360deg); } }
${GEMEINSAM}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`;
