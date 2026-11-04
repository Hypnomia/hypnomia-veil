// Platz `chibi` fuer Erweiterungsseiten (Popup, Einstellungsseite; Entscheidung 102). Pack-Chibi nur mit Freischaltung `chibi:pack`,
// sonst das Demo-Chibi der Erweiterung, sonst nichts: dann bleibt das Bild verborgen und der Text daneben traegt allein.
import { demoChibiAdresse, passtZurPose, type ChibiPose } from '../chibi';
import { leseDatei, leseNamenMitRolle } from '../pack/db';
import { istFreigeschaltet, type PackKurz } from '../pack/vertrag';

// Zaehler je Bild: ein spaeter fertig werdender, veralteter Aufruf darf das Bild nicht mehr ueberschreiben.
const zaehler = new WeakMap<HTMLImageElement, number>();
const blobAdresse = new WeakMap<HTMLImageElement, string>();

function loeseBlob(bild: HTMLImageElement): void {
  const alt = blobAdresse.get(bild);
  if (alt) URL.revokeObjectURL(alt);
  blobAdresse.delete(bild);
}

function verberge(bild: HTMLImageElement): void {
  loeseBlob(bild);
  bild.onerror = null;
  bild.removeAttribute('src');
  bild.hidden = true;
}

async function demo(pose: ChibiPose): Promise<string | null> {
  try {
    return await demoChibiAdresse(pose);
  } catch {
    return null;
  }
}

// Setzt das Bild und gibt zurueck, ob eins da ist. Fehler (Datenbank, kaputte Datei) fuehren zum Rueckfall auf Text, nie zu einer Ausnahme.
// Ein kaputtes Pack-Bild widerruft seine Blob-Adresse und faellt einmal auf das Demo-Chibi zurueck.
export async function zeigeChibi(bild: HTMLImageElement, pose: ChibiPose, pack: PackKurz | null): Promise<boolean> {
  const nr = (zaehler.get(bild) ?? 0) + 1;
  zaehler.set(bild, nr);
  const gilt = () => zaehler.get(bild) === nr;
  let blob: string | null = null;
  try {
    if (istFreigeschaltet(pack, 'chibi:pack')) {
      const name = (await leseNamenMitRolle('chibi')).find((n) => passtZurPose(n, pose));
      const datei = name ? await leseDatei(name) : null;
      if (datei?.blob) blob = URL.createObjectURL(datei.blob);
    }
  } catch {
    blob = null;
  }
  const adresse = blob ?? (await demo(pose));
  if (!gilt()) {
    if (blob) URL.revokeObjectURL(blob);
    return false;
  }
  loeseBlob(bild);
  if (!adresse) {
    verberge(bild);
    return false;
  }
  if (blob) blobAdresse.set(bild, blob);
  bild.onerror = () => {
    if (!gilt()) return;
    const warBlob = blobAdresse.has(bild);
    loeseBlob(bild);
    if (!warBlob) return verberge(bild);
    // Pack-Bild kaputt: einmal das Demo-Chibi versuchen, bei erneutem Fehler Text.
    void demo(pose).then((d) => {
      if (!gilt()) return;
      if (!d) return verberge(bild);
      bild.onerror = () => gilt() && verberge(bild);
      bild.src = d;
    });
  };
  bild.src = adresse;
  bild.hidden = false;
  return true;
}
