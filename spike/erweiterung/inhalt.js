// Wegwerf-Spike: Content-Script bei document_start, in allen Frames.
// Aufgaben: (S4) Shadow Roots nachverdecken, (Feed) sichtbare Bilder pruefen lassen und freigeben,
// (S2/S3) auf Anfrage Bildadressen und Videoquellen einsammeln, Canvas-Lesbarkeit testen.
// Die Konfiguration kommt aus inhalt-konfig.js (vom Bau erzeugt), damit bei document_start nichts asynchron ist.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const K = (typeof S_KONFIG !== 'undefined' && S_KONFIG) || {};
  const strategie = K.strategie ?? 'a';
  const freigabe = K.freigabe ?? 'pruefung';
  const start = performance.now();
  const istHaupt = window === window.top;
  const SCHLEIER_CSS = 'img, picture, video, canvas, [style*="background-image"] { opacity: 0 !important; } [data-veil="frei"] { opacity: 1 !important; }';

  // ---------- Shadow Roots ----------
  const hosts = new Map(); // Element -> Frames gewartet
  const verdeckteWurzeln = new WeakSet();
  let shadowGefunden = 0;
  function wurzelVon(el) {
    if (el.shadowRoot) return el.shadowRoot;
    try {
      if (api.dom && api.dom.openOrClosedShadowRoot) return api.dom.openOrClosedShadowRoot(el);
      if (el.openOrClosedShadowRoot) return el.openOrClosedShadowRoot;
    } catch { /* kein Zugriff */ }
    return null;
  }
  function verdeckeWurzel(sr) {
    if (verdeckteWurzeln.has(sr)) return;
    verdeckteWurzeln.add(sr);
    shadowGefunden++;
    const style = document.createElement('style');
    style.textContent = SCHLEIER_CSS;
    sr.prepend(style);
    // Innerhalb der Wurzel weiter beobachten (verschachtelte Shadow Roots, nachgeladene Bilder).
    beobachte(sr);
    for (const el of sr.querySelectorAll('*')) merke(el);
    if (freigabe === 'pruefung') for (const img of sr.querySelectorAll('img')) planeBild(img);
  }
  function merke(el) {
    const sr = wurzelVon(el);
    if (sr) { verdeckeWurzel(sr); return; }
    if (el.tagName && el.tagName !== 'IMG' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' && el.tagName !== 'LINK') hosts.set(el, 0);
  }
  function pruefeHosts() {
    for (const [el, n] of hosts) {
      const sr = wurzelVon(el);
      if (sr) { verdeckeWurzel(sr); hosts.delete(el); continue; }
      if (n > 180 || !el.isConnected) hosts.delete(el); else hosts.set(el, n + 1);
    }
  }
  function beobachte(wurzel) {
    const mo = new MutationObserver((liste) => {
      for (const m of liste) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          merke(n);
          if (n.tagName === 'IMG' && freigabe === 'pruefung') planeBild(n);
          if (n.querySelectorAll) {
            for (const el of n.querySelectorAll('*')) merke(el);
            if (freigabe === 'pruefung') for (const img of n.querySelectorAll('img')) planeBild(img);
          }
        }
      }
      pruefeHosts();
    });
    mo.observe(wurzel, { childList: true, subtree: true });
  }
  beobachte(document);
  // Vor jedem Zeichnen nachsehen (Parser haengt deklarative Shadow Roots ohne Ereignis an).
  (function schleife() { pruefeHosts(); requestAnimationFrame(schleife); })();

  // ---------- Freigabe nach Pruefung (Feed-Kennzahl) ----------
  const freigaben = [];
  const geplant = new WeakSet();
  let laufend = 0;
  const warteschlange = [];
  const PARALLEL = K.parallel ?? 3;
  function sichtbar(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }
  function planeBild(img) {
    if (geplant.has(img)) return;
    geplant.add(img);
    warteschlange.push(img);
    starteNaechste();
  }
  function starteNaechste() {
    while (laufend < PARALLEL && warteschlange.length) {
      // Sichtbare zuerst.
      let idx = warteschlange.findIndex(sichtbar);
      if (idx < 0) idx = 0;
      const img = warteschlange.splice(idx, 1)[0];
      laufend++;
      pruefeBild(img).finally(() => { laufend--; starteNaechste(); });
    }
  }
  // Wecken mit Wiederholung: ein frisch erzeugtes Offscreen-Dokument hoert erst nach dem Laden von ORT zu.
  async function wecke() {
    const t0 = performance.now();
    let erk = null;
    while (performance.now() - t0 < 20000) {
      try {
        await api.runtime.sendMessage({ typ: 'wecke', ziel: 'sw' });
        erk = await api.runtime.sendMessage({ typ: 'wecke' });
      } catch { erk = null; }
      if (erk && erk.ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return Math.round(performance.now() - t0);
  }
  async function pruefeBild(img) {
    const tPlan = performance.now();
    let url = img.currentSrc || img.src;
    if (!url) {
      await new Promise((ok) => { const f = () => ok(); img.addEventListener('load', f, { once: true }); img.addEventListener('error', f, { once: true }); setTimeout(ok, 3000); });
      url = img.currentSrc || img.src;
    }
    const warSichtbar = sichtbar(img);
    let antwort = null;
    let weckMs = null;
    let t0 = performance.now();
    if (url && /^https?:/.test(url)) {
      try {
        weckMs = await wecke();
        t0 = performance.now();
        antwort = await api.runtime.sendMessage({ typ: 'pruefeUrl', url });
        if (K.debug) console.log('veil: antwort', JSON.stringify(antwort).slice(0, 200));
      } catch (e) { antwort = { ok: false, fehler: String(e && e.message ? e.message : e) }; }
    } else antwort = { ok: false, fehler: 'keine http-Adresse' };
    // Freigabe: im Spike auch bei Treffern (es zaehlt die Zeit bis zum Urteil), Treffer werden mitgeschrieben.
    img.dataset.veil = 'frei';
    const t1 = performance.now();
    // dauer = reiner Rundlauf Content-Script bis Antwort; nachricht = Rundlauf minus Arbeit im Erkenner.
    freigaben.push({ i: freigaben.length, sichtbar: warSichtbar, feed: img.dataset.feedIndex ?? null, t: Math.round(t1), geplant: Math.round(tPlan), adresseWartenMs: Math.round(t0 - tPlan - (weckMs ?? 0)), weckMs, dauer: Math.round(t1 - t0), nachricht: antwort?.ms ? Math.round(t1 - t0 - antwort.ms.gesamt) : null, ok: !!antwort?.ok, kalt: antwort?.kalt ?? null, instanz: antwort?.instanz ?? null, ms: antwort?.ms ?? null, zonen: antwort?.zonen?.sichtbar ?? null, status: antwort?.status ?? null, fehler: antwort?.fehler ?? null });
    if (!K.ohneDom) { try { document.documentElement.dataset.veilFreigaben = JSON.stringify(freigaben); } catch { /* egal */ } }
  }
  function erstenDurchlauf() {
    for (const el of document.querySelectorAll('*')) merke(el);
    if (freigabe === 'pruefung') for (const img of document.querySelectorAll('img')) planeBild(img);
    if (strategie === 'c' && freigabe === 'nie') {
      // Aufnahme-Modus: Vollschleier nach fester Zeit heben, die Bilder bleiben verdeckt (Positivkontrolle sichtbar).
      setTimeout(() => { document.documentElement.dataset.veilSeite = 'frei'; document.documentElement.dataset.veilSeiteFreiMs = String(Math.round(performance.now())); }, 2500);
    }
    if (strategie === 'c' && freigabe === 'pruefung') {
      // Vollschleier: Seite erst freigeben, wenn alle gerade sichtbaren Bilder beurteilt sind (oder nach 4 s).
      // Die Sichtbarkeit wird bei jeder Pruefung neu berechnet: bei DOMContentLoaded haben Bilder noch keine Hoehe.
      let freigegeben = false;
      const frei = () => { if (freigegeben) return; freigegeben = true; document.documentElement.dataset.veilSeite = 'frei'; document.documentElement.dataset.veilSeiteFreiMs = String(Math.round(performance.now())); };
      const t = setInterval(() => {
        const sichtbare = [...document.querySelectorAll('img')].filter(sichtbar);
        const freie = sichtbare.filter((i) => i.dataset.veil === 'frei').length;
        document.documentElement.dataset.veilSeiteDebug = `${Math.round(performance.now())}: sichtbar ${sichtbare.length}, frei ${freie}, gesamt ${document.images.length}`;
        if (sichtbare.length > 0 && freie === sichtbare.length) { clearInterval(t); frei(); }
      }, 20);
      setTimeout(() => { clearInterval(t); frei(); }, 4000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', erstenDurchlauf, { once: true });
  else erstenDurchlauf();
  if (istHaupt && !K.ohneDom) {
    document.documentElement.dataset.veilStart = String(Math.round(start));
    document.documentElement.dataset.veilStrategie = strategie;
  }
  // Fuer die Auswertung: sichtbare Bilder, die noch kein Urteil haben.
  function offeneSichtbare() { return [...document.querySelectorAll('img')].filter((i) => sichtbar(i) && i.dataset.veil !== 'frei').length; }

  // ---------- Einsammeln fuer S2/S3 (auf Anfrage) ----------
  function canvasLesbar(el, b, h) {
    try {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.min(b, 64));
      c.height = Math.max(1, Math.min(h, 64));
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      c.getContext('2d').getImageData(0, 0, 1, 1);
      return { lesbar: true };
    } catch (e) { return { lesbar: false, fehler: e.name }; }
  }
  function alleElemente(wurzel, aus) {
    for (const e of wurzel.querySelectorAll('*')) { aus.push(e); const sr = wurzelVon(e); if (sr) alleElemente(sr, aus); }
    return aus;
  }
  function sammle(max) {
    const bilder = [];
    const elemente = alleElemente(document, []);
    for (const img of elemente.filter((e) => e.tagName === 'IMG')) {
      const url = img.currentSrc || img.src;
      if (!url || !/^https?:/.test(url)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      const geladen = img.complete && img.naturalWidth > 0;
      bilder.push({ url, breite: img.naturalWidth, hoehe: img.naturalHeight, geladen, sichtbar: sichtbar(img), imShadow: img.getRootNode() !== document, crossorigin: img.crossOrigin ?? null, canvas: geladen ? canvasLesbar(img, img.naturalWidth, img.naturalHeight) : null });
      if (bilder.length >= max) break;
    }
    const videos = [];
    for (const v of elemente.filter((e) => e.tagName === 'VIDEO')) {
      const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
      const r = v.getBoundingClientRect();
      videos.push({ art: src.startsWith('blob:') ? 'blob' : (src ? 'direkt' : 'leer'), host: (() => { try { return src.startsWith('blob:') ? 'blob' : new URL(src).host; } catch { return '?'; } })(), url: src.startsWith('blob:') ? null : src, breite: v.videoWidth, hoehe: v.videoHeight, readyState: v.readyState, crossorigin: v.crossOrigin ?? null, sichtbar: r.width > 0 && r.height > 0, canvas: v.readyState >= 2 ? canvasLesbar(v, v.videoWidth, v.videoHeight) : null });
    }
    return { url: location.origin, bilder, videos, bilderImShadow: bilder.filter((b) => b.imShadow).length, shadowGefunden, frames: istHaupt ? window.frames.length : null };
  }
  // Videobild als Pixelliste in Modellgroesse an den Erkenner schicken (Transportzeit messen).
  async function videoPixel(index, S) {
    const v = document.querySelectorAll('video')[index];
    if (!v) return { ok: false, fehler: 'kein Video' };
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    const skala = S / Math.max(v.videoWidth || 1, v.videoHeight || 1);
    g.fillStyle = 'rgb(0,0,0)';
    g.fillRect(0, 0, S, S);
    g.drawImage(v, 0, 0, Math.max(1, Math.round(v.videoWidth * skala)), Math.max(1, Math.round(v.videoHeight * skala)));
    let daten;
    try { daten = Array.from(g.getImageData(0, 0, S, S).data); } catch (e) { return { ok: false, fehler: e.name }; }
    await wecke();
    const t0 = performance.now();
    const antwort = await api.runtime.sendMessage({ typ: 'pruefePixel', daten, breite: v.videoWidth, hoehe: v.videoHeight });
    const rundlauf = Math.round(performance.now() - t0);
    return { ok: true, rundlaufMs: rundlauf, transportMs: antwort?.ms ? Math.round(rundlauf - antwort.ms.gesamt) : null, antwort };
  }
  api.runtime.onMessage.addListener((n, absender, antworte) => {
    if (!n || n.ziel !== 'inhalt') return undefined;
    if (n.typ === 'sammle') { antworte(sammle(n.max ?? 50)); return false; }
    if (n.typ === 'videoPixel') { videoPixel(n.index ?? 0, n.S ?? 320).then(antworte, (e) => antworte({ ok: false, fehler: String(e) })); return true; }
    if (n.typ === 'freigaben') { antworte({ start: Math.round(start), freigaben, shadowGefunden, offeneSichtbare: offeneSichtbare(), bilderGesamt: document.images.length }); return false; }
    return undefined;
  });
})();
