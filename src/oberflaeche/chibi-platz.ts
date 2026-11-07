// Platz `chibi` fuer Erweiterungsseiten (Popup, Einstellungsseite; Entscheidung 102). Pack-Chibi nur mit Freischaltung `chibi:pack`,
// sonst das Demo-Chibi der Erweiterung, sonst nichts: dann bleibt das Bild verborgen und der Text daneben traegt allein.
import { demoChibiAdresse, passtZurPose, type ChibiPose } from '../chibi';
import { leseDatei, leseNamenMitRolle } from '../pack/db';
import { neuesBlobRegister } from './blob-register';
import { istFreigeschaltet, type PackKurz } from '../pack/vertrag';

// Zaehler je Bild: ein spaeter fertig werdender, veralteter Aufruf darf das Bild nicht mehr ueberschreiben.
const zaehler = new WeakMap<HTMLImageElement, number>();
const blobAdresse = new WeakMap<HTMLImageElement, string>();

// Alle noch offenen Blob-Adressen dieser Seite: beim Verlassen der Seite (pagehide) werden sie freigegeben.
const register = neuesBlobRegister((a) => URL.revokeObjectURL(a));
const gibFrei = (a: string): void => void register.gibFrei(a);

function loeseBlob(bild: HTMLImageElement): void {
  const alt = blobAdresse.get(bild);
  if (alt) gibFrei(alt);
  blobAdresse.delete(bild);
}

/** Gibt die Blob-Adresse eines Bildes frei, das aus der Seite genommen wird (z. B. beim Wechsel eines Schritts). */
export function gibChibiFrei(bild: HTMLImageElement): void {
  zaehler.set(bild, (zaehler.get(bild) ?? 0) + 1); // ein spaet fertig werdender Aufruf setzt nichts mehr
  loeseBlob(bild);
}

/** Gibt alle offenen Blob-Adressen frei (Seite geht). */
export function gibAlleChibisFrei(): void {
  register.gibAlleFrei();
}

if (typeof addEventListener === 'function') addEventListener('pagehide', gibAlleChibisFrei);

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
  bild.dataset.pose = pose; // Phase 8b: das CSS kann die gemalte leere Blase der Pose sprechblase abschneiden
  const gilt = () => zaehler.get(bild) === nr;
  let blob: string | null = null;
  try {
    if (istFreigeschaltet(pack, 'chibi:pack')) {
      const name = (await leseNamenMitRolle('chibi')).find((n) => passtZurPose(n, pose));
      const datei = name ? await leseDatei(name) : null;
      if (datei?.blob) {
        blob = URL.createObjectURL(datei.blob);
        register.merke(blob);
      }
    }
  } catch {
    blob = null;
  }
  const adresse = blob ?? (await demo(pose));
  if (!gilt()) {
    if (blob) gibFrei(blob);
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
