// Hilfe-Seite (Session 17, Entscheidung 179): kleiner Markdown-Leser fuer die Anleitungen aus `docs/`. Reine Logik ohne DOM, damit sie in
// Node testbar ist; `darstellung.ts` baut daraus Elemente (nur textContent, nie innerHTML). Unterstuetzt genau das Format, das die
// Anleitungen benutzen: `#` bis `###`, Absaetze, `-` und `1.` Listen (nicht verschachtelt), **fett**, *kursiv*, `code`, Links.
// Alles andere bleibt sichtbarer Text, nichts wird als HTML gelesen.

export type Inline =
  | { art: 'text'; text: string }
  | { art: 'fett'; kinder: Inline[] }
  | { art: 'kursiv'; kinder: Inline[] }
  | { art: 'code'; text: string }
  | { art: 'link'; ziel: LinkZiel; kinder: Inline[] };

// Ein Link fuehrt nach aussen (nur https), auf eine andere Anleitung (Dateiname ohne .md, optional mit Anker) oder ist ungueltig (dann
// bleibt nur der Text stehen).
export type LinkZiel = { art: 'aussen'; adresse: string } | { art: 'anleitung'; name: string; anker: string } | { art: 'keins' };

export type Block =
  | { art: 'ueberschrift'; stufe: 1 | 2 | 3; inhalt: Inline[]; anker: string }
  | { art: 'absatz'; inhalt: Inline[] }
  | { art: 'liste'; nummeriert: boolean; start: number; punkte: Inline[][] };

// Anker aus einer Ueberschrift: klein, nur a bis z, 0 bis 9 und Bindestrich (wie GitHub, ohne Sonderfaelle).
export function anker(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Linkziel pruefen. Aussen nur https (kein http, kein javascript:, kein data:). Innen nur Dateinamen aus a bis z, 0 bis 9 und Bindestrich.
export function linkZiel(roh: string): LinkZiel {
  const r = roh.trim();
  if (/^https:\/\//i.test(r)) {
    try {
      const u = new URL(r);
      if (u.protocol === 'https:' && !u.username && !u.password) return { art: 'aussen', adresse: u.href };
    } catch {
      // ungueltig
    }
    return { art: 'keins' };
  }
  const innen = /^(?:\.\/)?([A-Za-z0-9-]+)\.md(?:#([a-z0-9-]*))?$/.exec(r);
  // Gross geschriebene Dateinamen (README.md wie auf GitHub) gelten klein, wie in anleitungen.ts.
  if (innen) return { art: 'anleitung', name: (innen[1] ?? '').toLowerCase(), anker: innen[2] ?? '' };
  const nurAnker = /^#([a-z0-9-]+)$/.exec(r);
  if (nurAnker) return { art: 'anleitung', name: '', anker: nurAnker[1] ?? '' };
  return { art: 'keins' };
}

// Inline-Teile lesen. Reihenfolge: Code (darin nichts weiter), Link, fett, kursiv. Unpaarige Zeichen bleiben Text.
export function inline(text: string): Inline[] {
  const aus: Inline[] = [];
  let puffer = '';
  const flush = (): void => {
    if (puffer) aus.push({ art: 'text', text: puffer });
    puffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const z = text[i];
    if (z === '`') {
      const ende = text.indexOf('`', i + 1);
      if (ende > i + 1) {
        flush();
        aus.push({ art: 'code', text: text.slice(i + 1, ende) });
        i = ende + 1;
        continue;
      }
    }
    if (z === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (m) {
        flush();
        aus.push({ art: 'link', ziel: linkZiel(m[2] ?? ''), kinder: inline(m[1] ?? '') });
        i += m[0].length;
        continue;
      }
    }
    if (z === '*' && text[i + 1] === '*') {
      const ende = text.indexOf('**', i + 2);
      if (ende > i + 2) {
        flush();
        aus.push({ art: 'fett', kinder: inline(text.slice(i + 2, ende)) });
        i = ende + 2;
        continue;
      }
    }
    if (z === '*' && text[i + 1] !== ' ' && text[i + 1] !== '*') {
      const ende = text.indexOf('*', i + 1);
      if (ende > i + 1 && text[ende - 1] !== ' ') {
        flush();
        aus.push({ art: 'kursiv', kinder: inline(text.slice(i + 1, ende)) });
        i = ende + 1;
        continue;
      }
    }
    puffer += z;
    i += 1;
  }
  flush();
  return aus;
}

// Reiner Text eines Inline-Baums (fuer Titel, Anker und Suche).
export function reinerText(teile: readonly Inline[]): string {
  return teile.map((t) => (t.art === 'text' || t.art === 'code' ? t.text : reinerText(t.kinder))).join('');
}

// Ein ganzes Dokument lesen. Leerzeilen trennen Bloecke; Zeilen eines Absatzes werden mit Leerzeichen verbunden.
export function lies(quelle: string): Block[] {
  const zeilen = quelle.replace(/\r\n?/g, '\n').split('\n');
  const bloecke: Block[] = [];
  let absatz: string[] = [];
  let liste: { nummeriert: boolean; start: number; punkte: string[] } | null = null;
  const schliesseAbsatz = (): void => {
    if (absatz.length) bloecke.push({ art: 'absatz', inhalt: inline(absatz.join(' ')) });
    absatz = [];
  };
  const schliesseListe = (): void => {
    if (liste) bloecke.push({ art: 'liste', nummeriert: liste.nummeriert, start: liste.start, punkte: liste.punkte.map(inline) });
    liste = null;
  };
  for (const roh of zeilen) {
    const zeile = roh.trimEnd();
    if (!zeile.trim()) {
      schliesseAbsatz();
      schliesseListe();
      continue;
    }
    // HTML-Kommentar auf einer Zeile (z. B. der Vermerk, welches lokale Bild zur Seite gehoert): nie anzeigen, nie in die Suche.
    if (/^<!--.*-->$/.test(zeile.trim())) continue;
    const kopf = /^(#{1,3})\s+(.+)$/.exec(zeile);
    if (kopf) {
      schliesseAbsatz();
      schliesseListe();
      const inhalt = inline((kopf[2] ?? '').trim());
      bloecke.push({ art: 'ueberschrift', stufe: (kopf[1] ?? '#').length as 1 | 2 | 3, inhalt, anker: anker(reinerText(inhalt)) });
      continue;
    }
    const punkt = /^\s*-\s+(.+)$/.exec(zeile);
    const nummer = /^\s*(\d{1,3})[.)]\s+(.+)$/.exec(zeile);
    if (punkt || nummer) {
      schliesseAbsatz();
      const nummeriert = !!nummer;
      if (liste && liste.nummeriert !== nummeriert) schliesseListe();
      if (!liste) liste = { nummeriert, start: nummer ? Number(nummer[1]) : 1, punkte: [] };
      liste.punkte.push(((punkt ? punkt[1] : nummer![2]) ?? '').trim());
      continue;
    }
    // Fortsetzungszeile eines Listenpunkts (eingerueckt) gehoert zum letzten Punkt.
    if (liste && /^\s{2,}\S/.test(roh) && liste.punkte.length) {
      liste.punkte[liste.punkte.length - 1] += ` ${zeile.trim()}`;
      continue;
    }
    schliesseListe();
    absatz.push(zeile.trim());
  }
  schliesseAbsatz();
  schliesseListe();
  return bloecke;
}

// Titel eines Dokuments: die erste Ueberschrift der Stufe 1, sonst der Dateiname.
export function titel(bloecke: readonly Block[], ersatz: string): string {
  const h = bloecke.find((b) => b.art === 'ueberschrift' && b.stufe === 1);
  return h && h.art === 'ueberschrift' ? reinerText(h.inhalt) : ersatz;
}

// Suchtext eines Dokuments (klein, ohne Zeichen), fuer die Filterung der Themenliste.
export function suchText(bloecke: readonly Block[]): string {
  return bloecke
    .map((b) => (b.art === 'liste' ? b.punkte.map(reinerText).join(' ') : reinerText(b.inhalt)))
    .join(' ')
    .toLowerCase();
}
