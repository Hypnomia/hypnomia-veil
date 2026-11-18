// Einstellungsseite, Reiter (Phase 11 E4d1, Entscheidungen 245 und 279): baut die Reiterleiste (tablist mit sieben tab) ueber die Panels aus index.html
// und haelt Reiter, Adresse und Sichtbarkeit zusammen. Alle Panels stehen beim Laden vollstaendig im Dokument, nicht gewaehlte sind nur mit
// `hidden` ausgeblendet. Das Oeffnen der Seite und jeder Wechsel schreiben NICHTS in den Speicher (nur der Anker der Adresse aendert sich).
// Pfeile, Pos1 und Ende bewegen nur den Fokus (wie in jeder Gruppe der Bausteine); gewaehlt wird mit Klick, Leertaste oder Eingabe.
import './reiter.css';
import { REITER, STANDARD_REITER, ankerFuerReiter, type ReiterId } from './reiter-daten';

const nav = document.getElementById('sprung');
const liste = document.createElement('div');
liste.id = 'reiter-liste';
liste.setAttribute('role', 'tablist');
liste.setAttribute('aria-label', 'Settings');
nav?.append(liste);

const tabs = new Map<ReiterId, HTMLButtonElement>();
const panels = new Map<ReiterId, HTMLElement>();
for (const r of REITER) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.id = `reiter-${r.id}`;
  tab.className = 'reiter-tab';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', `panel-${r.id}`);
  tab.textContent = r.name;
  tab.dataset.reiter = r.id;
  tabs.set(r.id, tab);
  const panel = document.getElementById(`panel-${r.id}`);
  if (panel) panels.set(r.id, panel);
  liste.append(tab);
}

let gewaehlt: ReiterId = STANDARD_REITER;

function schmal(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
}

// Schmal ist die Leiste eine waagrecht schiebbare Zeile: der gewaehlte Reiter wird hineingeholt, ohne die Seite zu bewegen.
function holeTabInsBild(tab: HTMLElement): void {
  if (liste.scrollWidth <= liste.clientWidth) return;
  const links = tab.offsetLeft - (liste.clientWidth - tab.offsetWidth) / 2;
  liste.scrollLeft = Math.max(0, links);
}

// Liegen rechts noch Reiter ausserhalb der schiebbaren Zeile, steht data-weiter (der Verlauf am Rand, reiter.css).
function pruefeRand(): void {
  liste.dataset.weiter = liste.scrollLeft + liste.clientWidth < liste.scrollWidth - 1 ? '1' : '0';
}
liste.addEventListener('scroll', pruefeRand, { passive: true });
addEventListener('resize', pruefeRand);

function zeige(id: ReiterId): void {
  gewaehlt = id;
  for (const [k, tab] of tabs) {
    const an = k === id;
    tab.setAttribute('aria-selected', String(an));
    tab.tabIndex = an ? 0 : -1;
  }
  for (const [k, panel] of panels) panel.hidden = k !== id;
  const tab = tabs.get(id);
  if (tab) holeTabInsBild(tab);
  liste.setAttribute('aria-orientation', schmal() ? 'horizontal' : 'vertical');
  pruefeRand();
}

function anker(): string {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return '';
  }
}

// Der Anker der Adresse bestimmt den Reiter: das Element mit dieser id liegt in einem Panel, dieses Panel wird geoeffnet und das Ziel in den Blick
// geholt (ein Element in einem verborgenen Panel konnte der Browser nicht anspringen). Ohne Anker (oder bei einem Anker ausserhalb der Panels)
// bleibt der Reiter, wie er ist; beim Laden ist das der Standard.
function ausAnker(): void {
  const id = anker();
  const ziel = id ? document.getElementById(id) : null;
  const panel = ziel?.closest<HTMLElement>('[data-reiter]') ?? null;
  const reiter = panel?.dataset.reiter as ReiterId | undefined;
  if (ziel && reiter && tabs.has(reiter)) {
    zeige(reiter);
    ziel.scrollIntoView({ block: 'start' });
    return;
  }
  if (!id) zeige(STANDARD_REITER);
  else zeige(gewaehlt);
}

// Klick auf einen Reiter: der Anker des Reiters kommt in die Adresse (ein Eintrag im Verlauf, Zurueck wechselt den Reiter), ohne Sprung zum Anker.
function waehle(id: ReiterId): void {
  if (id !== gewaehlt) {
    const neu = `#${ankerFuerReiter(id)}`;
    if (location.hash !== neu) history.pushState(null, '', neu);
    zeige(id);
  }
  // Steht die Seite unterhalb des Anfangs der Reiter, geht sie an den Anfang des Inhalts, damit er nicht von oben abgeschnitten steht.
  const mitte = document.querySelector<HTMLElement>('.reiter-mitte');
  if (mitte && mitte.getBoundingClientRect().top < 0) mitte.scrollIntoView({ block: 'start' });
}

for (const [id, tab] of tabs) tab.addEventListener('click', () => waehle(id));

liste.addEventListener('keydown', (e) => {
  const reihe = [...tabs.values()];
  const jetzt = reihe.indexOf(document.activeElement as HTMLButtonElement);
  if (jetzt < 0) return;
  let nach = -1;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nach = (jetzt + 1) % reihe.length;
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nach = (jetzt - 1 + reihe.length) % reihe.length;
  else if (e.key === 'Home') nach = 0;
  else if (e.key === 'End') nach = reihe.length - 1;
  if (nach < 0) return;
  e.preventDefault();
  // Der Fokus wandert; der Tab-Halt wandert mit (ein Tab-Druck verlaesst die Leiste an dieser Stelle), gewaehlt wird noch nichts.
  for (const t of reihe) t.tabIndex = t === reihe[nach] ? 0 : -1;
  reihe[nach]!.focus();
});
// Beim Verlassen der Leiste liegt der Tab-Halt wieder auf dem gewaehlten Reiter.
liste.addEventListener('focusout', (e) => {
  if (e.relatedTarget instanceof Node && liste.contains(e.relatedTarget)) return;
  for (const [k, t] of tabs) t.tabIndex = k === gewaehlt ? 0 : -1;
});

addEventListener('hashchange', ausAnker);
matchMedia?.('(max-width: 600px)').addEventListener?.('change', () => zeige(gewaehlt));

ausAnker();
