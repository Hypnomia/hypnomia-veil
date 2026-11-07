// Gemeinsamer Regler der Erweiterungsseiten (Phase 8b, Lesung W/U/O Nr. 3): Chromium kann die Spur nicht selbst bis zum Wert fuellen;
// diese Datei setzt `--wert` (Prozent) an jedem input[type=range]. Werte, die der Code setzt (aus dem Speicher), loesen kein input-Ereignis
// aus: darum zusaetzlich nach dem Laden, bei Speicher-Aenderungen und fuer neu eingefuegte Regler. Nur Aussehen, kein Wert wird geaendert.

function setze(r: HTMLInputElement): void {
  const min = Number(r.min || 0);
  const max = Number(r.max || 100);
  const w = Number(r.value);
  const p = max > min && Number.isFinite(w) ? Math.min(100, Math.max(0, ((w - min) / (max - min)) * 100)) : 0;
  r.style.setProperty('--wert', `${p.toFixed(1)}%`);
}

function alle(): void {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[type="range"]')) setze(r);
}

export function belebeRegler(): void {
  const aufEreignis = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'range') setze(t);
  };
  document.addEventListener('input', aufEreignis, true);
  document.addEventListener('change', aufEreignis, true);
  for (const ms of [0, 150, 600, 1500]) setTimeout(alle, ms);
  try {
    browser.storage.onChanged.addListener(() => setTimeout(alle, 0));
  } catch {
    // ohne storage (Vorschau): nur Ereignisse
  }
  new MutationObserver(() => alle()).observe(document.body ?? document.documentElement, { childList: true, subtree: true });
}
