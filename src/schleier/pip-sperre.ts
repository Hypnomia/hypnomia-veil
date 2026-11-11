// Bild-in-Bild-Sperre und DRM-Erkennung fuer Videos (Bauplan Video-Zonen, Auftrag V1).
// Ein Video unter einer Leinwand-Wiedergabe oder einem Standbild darf nicht in ein eigenes Fenster gehen: dort laege das echte Bild offen.
// Mehrere Halter (Player-Standbild, Zonen-Leinwand) sperren dasselbe Video unabhaengig voneinander; der alte Wert des Attributs kommt erst
// zurueck, wenn der letzte Halter loslaesst.

interface Sperre {
  vorher: boolean;
  halter: Set<string>;
}

const sperren = new WeakMap<HTMLVideoElement, Sperre>();

// Beendet ein laufendes Bild-in-Bild dieses Videos (kein Fehler, wenn keins laeuft oder der Browser es nicht kennt).
export function beendePip(v: HTMLVideoElement): void {
  try {
    if (document.pictureInPictureElement === v) void document.exitPictureInPicture().catch(() => {});
  } catch {
    // nicht steuerbar
  }
}

// `wer` benennt den Halter ("standbild", "zonen"). an = true sperrt, false nimmt die Sperre dieses Halters zurueck.
export function sperrePip(v: HTMLVideoElement, an: boolean, wer = 'standbild'): void {
  try {
    let s = sperren.get(v);
    if (an) {
      if (!s) {
        s = { vorher: v.disablePictureInPicture, halter: new Set() };
        sperren.set(v, s);
      }
      s.halter.add(wer);
      // Nur schreiben, wenn der Wert nicht schon stimmt: jedes Setzen erzeugt einen Mutationssatz am Video, und der Takt sperrt alle 400 ms erneut
      // (sonst hielte das den Lagewecker, src/schleier/lagewecker.ts, dauernd wach).
      if (v.disablePictureInPicture !== true) v.disablePictureInPicture = true;
      beendePip(v);
    } else if (s) {
      s.halter.delete(wer);
      if (s.halter.size === 0) {
        if (v.disablePictureInPicture !== s.vorher) v.disablePictureInPicture = s.vorher;
        sperren.delete(v);
      }
    }
  } catch {
    // nicht steuerbar
  }
}

// Haelt die Sperre dieses Halters noch? (Seiten setzen das Attribut gern zurueck: der Aufrufer sperrt dann erneut.)
export function pipGesperrt(v: HTMLVideoElement): boolean {
  return sperren.has(v) && v.disablePictureInPicture === true;
}

// Geschuetzte Wiedergabe (EME): drawImage liefert dort schwarze Bilder, die Pruefung sieht nichts und gaebe das Video frei. Sicher ist nur,
// so ein Video als nicht lesbar zu behandeln (ganz verdecken).
export function istDrm(v: HTMLVideoElement): boolean {
  try {
    return (v as { mediaKeys?: unknown }).mediaKeys != null;
  } catch {
    return false;
  }
}
