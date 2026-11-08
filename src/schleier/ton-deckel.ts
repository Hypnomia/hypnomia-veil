// Ton verdeckter Vorschauvideos auf Erwachsenenseiten (Entscheidung 193, Live-Lauf 18 B): eine Vorschau (Hover-Video des Seiten-Adapters) oder
// ein Anzeigen-Video, das der Schleier verdeckt haelt, gibt keinen Ton, solange es verdeckt ist. Nur solche Videos: der Player oeffnet sie nie per
// Quiz, das Hauptvideo ist also nie betroffen (Pruefung Runde 8, Nr. 1: eine Erkennung "groesstes Video" konnte danebenliegen).
// Wird das Video frei, zurueckgesetzt (Pause, neue Einstellungen, Quellwechsel) oder baut sich der Schleier ab, kommt der alte Ton-Zustand
// zurueck. Schaltet die Seite den Ton eines verdeckten Videos wieder an, wird er erneut stumm (hoechstens TON_NACHHALTEN Mal je Video).
import type { Zustand } from './zustand';

const TON_NACHHALTEN = 20;

interface Merker {
  warStumm: boolean;
  nachgehalten: number;
  horcher: () => void;
}

export class TonDeckel {
  private readonly merker = new Map<HTMLVideoElement, Merker>();

  constructor(
    private readonly gilt: () => boolean, // Erwachsenenseite der Liste, Schleier aktiv
    private readonly istVorschau: (v: HTMLVideoElement) => boolean, // Hover-Vorschau oder Anzeige, nicht im Player
  ) {}

  beiUrteil(el: Element, z: Zustand): void {
    if (z.art !== 'video' || !(el instanceof HTMLVideoElement)) return;
    if (z.urteil === 'verdeckt' && this.gilt() && this.istVorschau(el)) this.stumm(el);
    else this.gibFrei(el);
  }

  private stumm(v: HTMLVideoElement): void {
    if (this.merker.has(v)) return;
    const m: Merker = {
      warStumm: v.muted,
      nachgehalten: 0,
      horcher: () => {
        if (v.muted || m.nachgehalten >= TON_NACHHALTEN) return;
        m.nachgehalten++;
        v.muted = true;
      },
    };
    this.merker.set(v, m);
    v.addEventListener('volumechange', m.horcher);
    v.muted = true;
  }

  gibFrei(v: HTMLVideoElement): void {
    const m = this.merker.get(v);
    if (!m) return;
    this.merker.delete(v);
    v.removeEventListener('volumechange', m.horcher);
    v.muted = m.warStumm;
  }

  alleFrei(): void {
    for (const v of [...this.merker.keys()]) this.gibFrei(v);
  }
}
