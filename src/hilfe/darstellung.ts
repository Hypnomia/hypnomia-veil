// Hilfe-Seite (Session 17): baut aus dem Baum von markdown.ts DOM-Elemente, nur mit textContent. Aeussere Links oeffnen in einem neuen Tab
// (rel="noopener noreferrer"), Links auf andere Anleitungen werden zu Adressen `#<name>` bzw. `#<name>/<anker>` der Hilfe-Seite.
import type { Block, Inline } from './markdown.ts';

function inlineElemente(teile: readonly Inline[], aktuell: string): Node[] {
  return teile.map((t): Node => {
    switch (t.art) {
      case 'text':
        return document.createTextNode(t.text);
      case 'code': {
        const c = document.createElement('code');
        c.textContent = t.text;
        return c;
      }
      case 'fett': {
        const s = document.createElement('strong');
        s.append(...inlineElemente(t.kinder, aktuell));
        return s;
      }
      case 'kursiv': {
        const e = document.createElement('em');
        e.append(...inlineElemente(t.kinder, aktuell));
        return e;
      }
      case 'link': {
        if (t.ziel.art === 'keins') {
          const s = document.createElement('span');
          s.append(...inlineElemente(t.kinder, aktuell));
          return s;
        }
        const a = document.createElement('a');
        if (t.ziel.art === 'aussen') {
          a.href = t.ziel.adresse;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.className = 'aussen';
        } else {
          const name = t.ziel.name || aktuell;
          a.href = `#${name}${t.ziel.anker ? `/${t.ziel.anker}` : ''}`;
        }
        a.append(...inlineElemente(t.kinder, aktuell));
        return a;
      }
    }
  });
}

// `aktuell`: Name der angezeigten Anleitung (fuer Anker-Links ohne Datei).
export function zeichneDokument(bloecke: readonly Block[], aktuell: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const b of bloecke) {
    if (b.art === 'ueberschrift') {
      // Die Seite hat schon ein h1 (Marke): die Dokument-Ueberschriften ruecken eine Stufe nach unten.
      const h = document.createElement(`h${b.stufe + 1}` as 'h2' | 'h3' | 'h4');
      h.id = `a-${b.anker}`;
      h.append(...inlineElemente(b.inhalt, aktuell));
      f.append(h);
    } else if (b.art === 'absatz') {
      const p = document.createElement('p');
      p.append(...inlineElemente(b.inhalt, aktuell));
      f.append(p);
    } else {
      const l = document.createElement(b.nummeriert ? 'ol' : 'ul');
      if (b.nummeriert && b.start !== 1) (l as HTMLOListElement).start = b.start;
      for (const punkt of b.punkte) {
        const li = document.createElement('li');
        li.append(...inlineElemente(punkt, aktuell));
        l.append(li);
      }
      f.append(l);
    }
  }
  return f;
}
