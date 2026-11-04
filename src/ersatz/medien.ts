// Medien der Seite waehrend die Galerie steht (Auftrag G): jedes video und audio wird angehalten und stumm gehalten. Ein Capture-Listener
// faengt jedes spaetere `play` ab. Danach kommt der Ton-Zustand zurueck (nicht die Wiedergabe: die Seite spielt selbst weiter, wenn sie will).
// Grenze: Audio ohne Element im Dokument (new Audio(), WebAudio) sehen wir nicht.
const SWEEP_MS = 1000;

export class MedienStopp {
  private an = false;
  private readonly alt = new Map<HTMLMediaElement, boolean>(); // vorheriger muted-Wert
  private takt: ReturnType<typeof setInterval> | undefined;

  private readonly beiPlay = (e: Event): void => {
    if (e.target instanceof HTMLMediaElement) this.halte(e.target);
  };

  private halte(m: HTMLMediaElement): void {
    if (!this.alt.has(m)) this.alt.set(m, m.muted);
    try {
      if (!m.muted) m.muted = true;
      if (!m.paused) m.pause();
    } catch {
      // Element im Umbau
    }
  }

  private fege(): void {
    for (const m of document.querySelectorAll<HTMLMediaElement>('video, audio')) this.halte(m);
  }

  starte(): void {
    if (this.an) return;
    this.an = true;
    for (const art of ['play', 'playing', 'volumechange']) document.addEventListener(art, this.beiPlay, true);
    this.fege();
    this.takt = setInterval(() => this.fege(), SWEEP_MS);
  }

  stoppe(): void {
    if (!this.an) return;
    this.an = false;
    for (const art of ['play', 'playing', 'volumechange']) document.removeEventListener(art, this.beiPlay, true);
    clearInterval(this.takt);
    for (const [m, war] of this.alt) {
      try {
        m.muted = war;
      } catch {
        // egal
      }
    }
    this.alt.clear();
  }
}
