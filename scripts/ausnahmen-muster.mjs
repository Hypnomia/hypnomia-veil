// Ausnahmeliste: Muster aus data/ausnahmen-standard.json (und eigene Muster des Nutzers) in zwei Formen.
// 1. Bauzeit: `exclude_matches` fuer das Manifest (wxt.config.ts), damit das Content-Script auf Ausnahmeseiten gar nicht laeuft.
// 2. Laufzeit: `passtAusnahme(location, muster)` fuer die eigenen Ausnahmen des Nutzers im Content-Script.
// Schreibweise der Muster (siehe data/AUSNAHMEN-LIES-MICH.md): Host-Suffix (`paypal.com` deckt Host und Subdomains)
// oder Host plus Pfad-Praefix (`amazon.de/gp/buy`). Klein geschrieben, ohne Protokoll, ohne Sternchen.
// Reines JavaScript ohne Abhaengigkeiten, damit wxt.config.ts, Tests und der Erweiterungscode dieselbe Datei nutzen.

// Zerlegt ein Muster in Host und Pfad. Ungueltige Muster ergeben null.
export function zerlegeMuster(muster) {
  if (typeof muster !== 'string') return null;
  const m = muster.trim().toLowerCase();
  const treffer = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(\/[a-z0-9._~%\/-]*)?$/.exec(m);
  if (!treffer) return null;
  const host = treffer[1];
  let pfad = treffer[2] ?? '';
  if (pfad === '/') pfad = '';
  return { host, pfad };
}

// Liest die Muster aus der Standardliste (Objekt aus ausnahmen-standard.json). Unsichere Eintraege zaehlen mit.
export function musterAusListe(liste) {
  const aus = [];
  for (const gruppe of liste?.gruppen ?? []) {
    for (const eintrag of gruppe.muster ?? []) {
      const m = typeof eintrag === 'string' ? eintrag : eintrag?.muster;
      if (zerlegeMuster(m)) aus.push(m.trim().toLowerCase());
    }
  }
  return aus;
}

// Manifest-Muster (match patterns) fuer exclude_matches: je Muster der Host selbst und alle Subdomains.
export function manifestMuster(muster) {
  const aus = new Set();
  for (const m of muster) {
    const z = zerlegeMuster(m);
    if (!z) continue;
    const pfad = z.pfad ? `${z.pfad}*` : '/*';
    aus.add(`*://${z.host}${pfad}`);
    aus.add(`*://*.${z.host}${pfad}`);
  }
  return [...aus];
}

// Passt eine Adresse (Objekt mit hostname und pathname, z. B. window.location) zu einem der Muster?
export function passtAusnahme(adresse, muster) {
  const host = String(adresse?.hostname ?? '').toLowerCase();
  const pfad = String(adresse?.pathname ?? '/').toLowerCase();
  if (!host) return false;
  for (const m of muster ?? []) {
    const z = zerlegeMuster(m);
    if (!z) continue;
    const hostPasst = host === z.host || host.endsWith(`.${z.host}`);
    if (!hostPasst) continue;
    if (!z.pfad || pfad.startsWith(z.pfad)) return true;
  }
  return false;
}
