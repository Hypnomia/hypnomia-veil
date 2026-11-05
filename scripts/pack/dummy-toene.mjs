// Synthetische Klaenge fuer das Dummy-Pack und die Tests (Phase 6, Auftrag T): kurze Sinustoene als WAV (PCM, 16 Bit, mono), je Name eine
// andere Tonhoehe. Keine echten Klaenge, nichts davon ist Mias Stimme; die echten Klaenge kommen mit dem Pack in Phase 7 (nie ins Repo).
export const DUMMY_TON_NAMEN = ['quiz', 'richtig', 'falsch', 'verweigert', 'trigger'];
const HOEHE_HZ = { quiz: 440, richtig: 660, falsch: 220, verweigert: 330, trigger: 880 };
const RATE = 22050;

// Baut eine WAV-Datei: `dauerMs` Sinus mit weichem Ein- und Ausklang (kein Knacken), Lautstaerke 0,4 der Vollaussteuerung.
export function baueWav(hz, dauerMs = 250) {
  const n = Math.round((RATE * dauerMs) / 1000);
  const daten = n * 2;
  const aus = new Uint8Array(44 + daten);
  const v = new DataView(aus.buffer);
  const text = (ab, t) => [...t].forEach((c, i) => (aus[ab + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + daten, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, daten, true);
  const rampe = Math.round(RATE * 0.01);
  for (let i = 0; i < n; i++) {
    const huellkurve = Math.min(1, i / rampe, (n - 1 - i) / rampe);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 0.4 * 32767 * huellkurve), true);
  }
  return aus;
}

// Dauer je Klang: `quiz` ist lang (2 s), damit Tests ihn mitten im Klang durch Pause oder Schalter abbrechen koennen; die anderen sind kurz.
const DAUER_MS = { quiz: 2000, richtig: 400, falsch: 400, verweigert: 400, trigger: 400 };

// Die Klaenge des Dummy-Packs: { name, datei, daten }.
export function dummyToene() {
  return DUMMY_TON_NAMEN.map((name) => ({ name, datei: `ton/${name}.wav`, daten: baueWav(HOEHE_HZ[name], DAUER_MS[name]) }));
}
