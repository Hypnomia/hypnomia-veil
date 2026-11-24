// Gemeinsame Messung fuer die Handy-Tests (Phase 11 E4f, Regeln H-a bis H-g): `tests/chromium/handy.spec.ts` und `tests/firefox/handy.test.mjs`
// geben `MESS_SKRIPT` und `FOKUS_SKRIPT` als Text in die Seite (Playwright `evaluate`, Selenium `executeScript`) und werten das Ergebnis mit den
// Grenzen und Ausnahmen aus diesem Modul aus. Die Funktionen aendern nichts ausser der Scrollposition. `win` ist das Fenster der Seite
// (in Firefox das Fenster des Iframes, weil das Fenster nicht schmaler als 500 px wird).

// Fenstergroessen der Messung: [Breite, Hoehe].
export const BREITEN = [
  [360, 640],
  [320, 568],
  [412, 915],
];

// J4 (H-c): gewollte Text-ueber-Bild-Auflagen, [Selektor des Textkastens (closest), Selektor des Bildes]. Nur hier.
export const AUFLAGEN_H_C = [
  ['.namensschild', 'img'], // Einwilligung: Mias Namensschild liegt gewollt auf ihrem Bild (Szene der Willkommensseite)
  ['.szene-karte', '.mia-bild img'], // Einwilligung: die Karte ueberdeckt gewollt den ausgeblendeten Rand von Mias Bild (margin-bottom -40 px der Szene)
  ['header', '.spirale-gross svg'], // Popup: die grosse Spirale (Deckkraft 0,18) liegt gewollt hinter Titel und Status im Kopf
];

// H-g (G2): hoechste erlaubte Oberkante der Reiterflaeche (des gewaehlten Bereichs) der Einstellungsseite, alle sieben Reiter.
export const GRENZE_REITERFLAECHE = { 360: 330, 320: 370 };
// H-g: die erste Bedienung eines Reiters liegt nur dort im ersten Bildschirm, wo das erste Element eine Bedienung ist. Ausgenommen (eine Stelle, mit Grund):
export const AUSNAHMEN_H_G = [
  { reiter: 'Ledger', grund: 'der Reiter beginnt mit Einleitung und Zahlen; "Clear my ledger" steht bewusst unter der Liste (Reihenfolge wie am Stand 2c003a7, G2)' },
  { reiter: 'Pack and sound', grund: 'ohne Pack beginnt der Reiter mit Einleitung und Bildstreifen, der Kaufblock steht danach (Reihenfolge wie am Stand 2c003a7, G2, Frage G5)' },
];
// H-g: hoechste erlaubte Oberkante der ersten Bedienung (CSS-Pixel ab Seitenanfang).
export const GRENZE_ERSTE_BEDIENUNG = {
  optionen: { 360: 440, 320: 470 }, // Einstellungsseite, jeder Reiter (360 x 640 und 320 x 568)
  interview: { 360: 480 }, // Interview, jede Frage (360 x 640)
};
// H-d: Mindestanteil der Fensterhoehe, den klebende Elemente bei 360 x 640 freilassen.
export const GRENZE_FREI = 0.6;
// H-b Popup mit Maus: Mindesthoehe jedes Ziels; mit grobem Zeiger gilt wie ueberall 44 x 44.
export const MAUS_MIN_HOEHE = 24;
export const FINGERZIEL = 44;

// H-b: die EINE Liste der Ausnahmen. Ein Eintrag nimmt ein Ziel (Selektor, wie die Messung ihn kurz schreibt) auf einer Flaeche von der
// Mindestgroesse aus; `grund` steht im Bericht. Leer: es gibt keine Ausnahme.
export const AUSNAHMEN_H_B = [];

export const MESS_SKRIPT = String.raw`
function messeHandy(win, opt) {
  opt = opt || {};
  const document = win.document;
  const iw = win.innerWidth;
  const ih = win.innerHeight;
  const root = document.documentElement;
  const kurz = (el) => {
    if (!el || !el.tagName) return String(el);
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    const teile = [];
    let e = el;
    for (let i = 0; e && e.tagName && i < 3; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { teile.unshift(s + '#' + e.id); break; }
      const k = [...(e.classList || [])].slice(0, 2).join('.');
      if (k) s += '.' + k;
      teile.unshift(s);
    }
    return teile.join(' > ');
  };
  const rund = (n) => Math.round(n * 10) / 10;
  const inGeschlossenem = (el) => {
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (d.open) continue;
      const sm = d.querySelector(':scope > summary');
      if (!(sm && (sm === el || sm.contains(el)))) return true;
    }
    return false;
  };
  const sichtbar = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (inGeschlossenem(el)) return false;
    const cs = win.getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none');
  };
  const lesbar = (el) => {
    if (!sichtbar(el)) return false;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = win.getComputedStyle(e);
      if (c.visibility === 'hidden' || c.display === 'none') return false;
      if (parseFloat(c.opacity) === 0) return false;
    }
    return true;
  };
  const verwandt = (a, b) => a === b || a.contains(b) || b.contains(a);
  // Ein Element in einem klebenden oder festen Vorfahren liegt je nach Scrollstand ueber anderem Inhalt: das ist Absicht (die Leiste, die Zeile am unteren
  // Rand), kein Verstoss gegen "zwei Ziele ueberlappen sich nicht" und "kein Text ueber Text"; ob es etwas verdeckt, prueft H-f (Fokus) und H-d.
  // J3: ausgenommen ist nur die Ueberlappung zwischen einem klebenden oder festen Behaelter und dem Inhalt im Fluss (oder einem anderen Behaelter). Innerhalb
  // EINES klebenden Behaelters (Reiterzeile, Zeile Back, Skip, Next) gelten Ueberlappung, Text ueber Text und Reihenfolge wie ueberall.
  const klebAhn = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = win.getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') return e; } return null; };
  const andererBehaelter = (a, b) => klebAhn(a) !== klebAhn(b);
  win.scrollTo(0, 0);
  const aus = { breite: iw, hoehe: ih };

  // ---------- H-a ----------
  {
    const ueber = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.right <= iw + 0.5 && r.left >= -0.5) continue;
      if (inGeschlossenem(el)) continue;
      const cs = win.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let beschnitten = false;
      for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
        const c = win.getComputedStyle(e);
        if (c.overflowX !== 'visible') {
          const er = e.getBoundingClientRect();
          if (er.right <= iw + 0.5 && er.left >= -0.5) { beschnitten = true; break; }
        }
      }
      if (!beschnitten) ueber.push({ el: kurz(el), mehr: rund(Math.max(r.right - iw, -r.left)) });
    }
    aus.ra = { waagrecht: root.scrollWidth > root.clientWidth || document.body.scrollWidth > document.body.clientWidth, scrollW: root.scrollWidth, clientW: root.clientWidth, ueberstehend: ueber.slice(0, 6) };
  }

  // ---------- Ziele (H-b, H-g) ----------
  const KAND = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button], [role=switch], [role=checkbox], [role=radio], [role=link], [role=slider], [role=option], [tabindex]:not([tabindex="-1"]), label';
  const ziele = [];
  const gesehen = new Set();
  const typVon = (el) => {
    const tag = el.tagName.toLowerCase();
    const k = el.className && typeof el.className === 'string' ? el.className : '';
    if (tag === 'select') return 'Auswahlfeld';
    if (tag === 'input' && el.type === 'range') return 'Regler';
    if (/schalter/.test(k) || el.getAttribute('role') === 'switch' || (tag === 'input' && el.type === 'checkbox')) return 'Schalter';
    if (/hilfe|help|frage/.test(k) || (el.textContent || '').trim() === '?') return 'Hilfe';
    if (tag === 'a') return 'Link';
    if (tag === 'button') return 'Knopf';
    return tag;
  };
  for (const c of document.querySelectorAll(KAND)) {
    if (c.disabled) continue;
    let ziel = c;
    const tag = c.tagName.toLowerCase();
    if (tag === 'input' && c.labels && c.labels.length) {
      let bestes = null;
      for (const l of c.labels) if (lesbar(l)) {
        const r = l.getBoundingClientRect();
        if (!bestes || r.width * r.height > bestes.getBoundingClientRect().width * bestes.getBoundingClientRect().height) bestes = l;
      }
      const r0 = c.getBoundingClientRect();
      if (bestes && (!lesbar(c) || r0.width <= 2 || r0.height <= 2 || bestes.getBoundingClientRect().width * bestes.getBoundingClientRect().height >= r0.width * r0.height)) ziel = bestes;
    }
    if (tag === 'label') {
      const ein = c.control;
      if (ein && ein.disabled) continue;
      if (!ein && !c.querySelector('input,select,textarea,button')) continue;
      if (ein && !(ein.getBoundingClientRect().width <= 2) && c.contains(ein) === false && lesbar(ein) && ein.type !== 'checkbox' && ein.type !== 'radio') continue;
    }
    if (gesehen.has(ziel)) continue;
    if (!lesbar(ziel)) continue;
    const r = ziel.getBoundingClientRect();
    if (r.width <= 2 && r.height <= 2) continue;
    gesehen.add(ziel);
    ziele.push({ el: ziel, typ: typVon(ziel) });
  }
  const docRects = ziele.map((z) => { const r = z.el.getBoundingClientRect(); return { l: r.left + win.scrollX, t: r.top + win.scrollY, r: r.right + win.scrollX, b: r.bottom + win.scrollY }; });
  const trifft = (t, e) => {
    if (!e) return false;
    if (e === t || t.contains(e)) return true;
    const lab = e.closest && e.closest('label');
    if (lab && lab === t) return true;
    if (t.tagName === 'INPUT' && t.labels && lab && [...t.labels].includes(lab)) return true;
    if (e.tagName === 'LABEL' && e.control === t) return true;
    return false;
  };
  const daten = [];
  for (let i = 0; i < ziele.length; i++) {
    const el = ziele[i].el;
    let r = el.getBoundingClientRect();
    const d = { typ: ziele[i].typ, sel: kurz(el), w: rund(r.width), h: rund(r.height), text: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 30), docTop: rund(docRects[i].t) };
    d.eff = { w: d.w, h: d.h };
    if (r.width < 44 || r.height < 44) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { /* weiter */ }
      r = el.getBoundingClientRect();
      const x0 = Math.max(0, Math.floor(r.left - 24)), x1 = Math.min(iw - 1, Math.ceil(r.right + 24));
      const y0 = Math.max(0, Math.floor(r.top - 24)), y1 = Math.min(ih - 1, Math.ceil(r.bottom + 24));
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, treffer = 0;
      for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
        if (!trifft(el, document.elementFromPoint(x, y))) continue;
        treffer++;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
      }
      d.eff = treffer ? { w: rund(mxx - mnx + 2), h: rund(mxy - mny + 2) } : { w: 0, h: 0 };
    }
    daten.push(d);
  }
  win.scrollTo(0, 0);
  const ueberlappung = [];
  for (let i = 0; i < ziele.length; i++) for (let j = i + 1; j < ziele.length; j++) {
    if (verwandt(ziele[i].el, ziele[j].el) || andererBehaelter(ziele[i].el, ziele[j].el)) continue;
    const a = docRects[i], b = docRects[j];
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
    const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (w >= 2 && h >= 2) ueberlappung.push({ a: daten[i].sel + ' "' + daten[i].text + '"', b: daten[j].sel + ' "' + daten[j].text + '"', w: rund(w), h: rund(h) });
  }
  aus.ziele = daten;
  aus.ueberlappung = ueberlappung;

  // ---------- H-g: Oberkante der ersten Bedienung im Behaelter opt.erste (ohne opt.ausser) ----------
  if (opt.panel) {
    const p = document.querySelector(opt.panel);
    if (p) aus.panelTop = rund(p.getBoundingClientRect().top + win.scrollY);
  }
  if (opt.erste) {
    const behaelter = [...document.querySelectorAll(opt.erste)].filter((b) => lesbar(b));
    let erste = null;
    for (let i = 0; i < ziele.length; i++) {
      const el = ziele[i].el;
      if (!behaelter.some((b) => b.contains(el))) continue;
      if (opt.ausser && el.closest(opt.ausser)) continue;
      if (!erste || docRects[i].t < erste.top) erste = { top: rund(docRects[i].t), sel: daten[i].sel, text: daten[i].text };
    }
    // Gesperrte Antworten (Karten ohne Freischaltung) sind sichtbare Antworten und zaehlen mit; sie sind nur nicht bedienbar.
    for (const b of behaelter) for (const c of b.querySelectorAll('input:disabled, button:disabled, select:disabled, [aria-disabled="true"]')) {
      let z = c;
      const r0 = c.getBoundingClientRect();
      if ((r0.width <= 2 || r0.height <= 2 || !lesbar(c)) && c.labels && c.labels.length) z = c.labels[0];
      if (!lesbar(z) || (opt.ausser && z.closest(opt.ausser))) continue;
      const t = z.getBoundingClientRect().top + win.scrollY;
      if (!erste || t < erste.top) erste = { top: rund(t), sel: kurz(z) + ' (gesperrt)', text: (z.textContent || '').trim().slice(0, 30) };
    }
    aus.erste = erste;
  }

  // ---------- H-c ----------
  {
    const befunde = [];
    const durchsichtig = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    const hatKasten = (cs) => !durchsichtig(cs.backgroundColor) || cs.backgroundImage !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
    const zeilen = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const p = n.parentElement;
      if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION'].includes(p.tagName) || !lesbar(p)) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const rects = [...rg.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (!rects.length) continue;
      const cs = win.getComputedStyle(p);
      let klipper = null;
      for (let e = p; e && e !== document.documentElement; e = e.parentElement) {
        const c = win.getComputedStyle(e);
        if (c.overflowX === 'hidden' || c.overflowX === 'clip' || c.overflowY === 'hidden' || c.overflowY === 'clip') { klipper = e; break; }
      }
      let box = null;
      for (let e = p; e && e !== document.documentElement; e = e.parentElement) if (hatKasten(win.getComputedStyle(e))) { box = e; break; }
      const kr = klipper && klipper.getBoundingClientRect();
      const br = box && box.getBoundingClientRect();
      let beschn = 0, aussen = 0, kastenRaus = 0;
      for (const r of rects) {
        if (kr && (r.right > kr.right + 1 || r.left < kr.left - 1 || r.bottom > kr.bottom + 1 || r.top < kr.top - 1)) beschn = Math.max(beschn, rund(Math.max(r.right - kr.right, kr.left - r.left, r.bottom - kr.bottom, kr.top - r.top)));
        if (br && (r.right > br.right + 1 || r.left < br.left - 1)) kastenRaus = Math.max(kastenRaus, rund(Math.max(r.right - br.right, br.left - r.left)));
        if (r.right > iw + 1 || r.left < -1) {
          let inScroll = false;
          for (let e = p; e && e !== document.documentElement; e = e.parentElement) { const c = win.getComputedStyle(e); if (c.overflowX === 'auto' || c.overflowX === 'scroll') { inScroll = true; break; } }
          if (!inScroll) aussen = Math.max(aussen, rund(Math.max(r.right - iw, -r.left)));
        }
      }
      const txt = n.nodeValue.trim().slice(0, 40);
      if (beschn > 0) befunde.push({ art: 'abgeschnitten', el: kurz(p), mehr: beschn, text: txt });
      if (kastenRaus > 0 && !(beschn > 0)) befunde.push({ art: 'laeuft aus dem Kasten', el: kurz(p), mehr: kastenRaus, text: txt });
      if (aussen > 0) befunde.push({ art: 'ausserhalb des Fensters', el: kurz(p), mehr: aussen, text: txt });
      if ((cs.textOverflow === 'ellipsis' && p.scrollWidth > p.clientWidth + 1) || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && p.scrollHeight > p.clientHeight + 1)) befunde.push({ art: 'gekuerzt', el: kurz(p), text: txt });
      const re = /\S+/g;
      let m, gemeldet = 0;
      while ((m = re.exec(n.nodeValue)) && gemeldet < 3) {
        if (m[0].length < 4 || /[-‐‑–—\/­]/.test(m[0])) continue;
        const rr = document.createRange();
        rr.setStart(n, m.index);
        rr.setEnd(n, m.index + m[0].length);
        const tops = new Set([...rr.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).map((r) => Math.round(r.top / 3)));
        if (tops.size > 1) { befunde.push({ art: 'Wort mitten im Wort umbrochen', el: kurz(p), text: m[0].slice(0, 40) }); gemeldet++; }
      }
      for (const r of rects) zeilen.push({ n, el: p, r });
    }
    // J4: kein Textkasten schneidet ein Bild, eine Leinwand, ein Video, ein SVG oder die Flaeche der Vorschau; gewollte Auflagen stehen in AUFLAGEN_H_C (handy-mess.mjs).
    const bilder = [...document.querySelectorAll('img, svg, canvas, video, .v-vorschau-flaeche')].filter((e) => !(e.parentElement && e.parentElement.closest('svg')) && lesbar(e));
    const auflagen = opt.auflagen || [];
    const ueberBild = new Set();
    for (const z of zeilen) {
      if (z.el.closest('svg')) continue;
      for (const bild of bilder) {
        if (bild.contains(z.el) || andererBehaelter(z.el, bild)) continue;
        const q = bild.getBoundingClientRect();
        const w = Math.min(z.r.right, q.right) - Math.max(z.r.left, q.left);
        const h = Math.min(z.r.bottom, q.bottom) - Math.max(z.r.top, q.top);
        if (w <= 3 || h <= Math.max(3, z.r.height * 0.3)) continue;
        if (auflagen.some((a) => z.el.closest(a[0]) && bild.matches(a[1]))) continue;
        const key = kurz(z.el) + '|' + kurz(bild);
        if (ueberBild.has(key)) continue;
        ueberBild.add(key);
        befunde.push({ art: 'Text ueber Bild', el: kurz(z.el), text: kurz(bild) });
      }
    }
    const ueberText = [];
    const dopp = new Set();
    for (let i = 0; i < zeilen.length; i++) for (let j = i + 1; j < zeilen.length; j++) {
      const a = zeilen[i], b = zeilen[j];
      if (a.n === b.n || a.el === b.el || andererBehaelter(a.el, b.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 3 && h > Math.max(3, Math.min(a.r.height, b.r.height) * 0.3)) {
        const key = kurz(a.el) + '|' + kurz(b.el);
        if (dopp.has(key)) continue;
        dopp.add(key);
        ueberText.push({ a: kurz(a.el) + ' "' + a.n.nodeValue.trim().slice(0, 24) + '"', b: kurz(b.el) + ' "' + b.n.nodeValue.trim().slice(0, 24) + '"' });
      }
    }
    const kasten = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!lesbar(el)) continue;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'inline' || ['SELECT', 'INPUT', 'TEXTAREA', 'SVG', 'svg', 'IMG', 'CANVAS', 'VIDEO'].includes(el.tagName)) continue;
      if (![...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim())) continue;
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') kasten.push({ el: kurz(el), scrollW: el.scrollWidth, clientW: el.clientWidth, text: (el.textContent || '').trim().slice(0, 30) });
    }
    aus.rc = { befunde, ueberText, kasten };
  }

  // ---------- H-d: Anteil der Hoehe, den klebende oder feste Elemente (mindestens halbe Fensterbreite, samt allem darin) freilassen ----------
  {
    const feste = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = win.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      feste.push(el);
    }
    const maxS = Math.max(0, root.scrollHeight - ih);
    const je = [];
    for (const s of [0, Math.round(maxS / 2), maxS]) {
      win.scrollTo(0, s);
      const baender = [];
      for (const el of feste) {
        // Rechteck des Elements und aller sichtbaren Nachkommen (ein klebender Behaelter ohne eigene Hoehe traegt oft eine absolut gesetzte Karte)
        let t = 1e9, b = -1e9, l = 1e9, rr = -1e9;
        for (const e of [el, ...el.querySelectorAll('*')]) {
          const q = e.getBoundingClientRect();
          if (q.width <= 0 || q.height <= 0) continue;
          const c = win.getComputedStyle(e);
          if (c.visibility === 'hidden' || c.display === 'none') continue;
          t = Math.min(t, q.top); b = Math.max(b, q.bottom); l = Math.min(l, q.left); rr = Math.max(rr, q.right);
        }
        if (b <= t) continue;
        const tt = Math.max(0, t), bb = Math.min(ih, b);
        if (bb <= tt) continue;
        if (rr - l >= iw * 0.5) baender.push([tt, bb, kurz(el)]);
      }
      baender.sort((p, q) => p[0] - q[0]);
      let union = 0, cur = null;
      for (const [t, b] of baender) { if (!cur) cur = [t, b]; else if (t <= cur[1]) cur[1] = Math.max(cur[1], b); else { union += cur[1] - cur[0]; cur = [t, b]; } }
      if (cur) union += cur[1] - cur[0];
      je.push({ scrollY: s, bedeckt: rund(union), frei: rund((ih - union) / ih), liste: baender.map((x) => x[2]) });
    }
    win.scrollTo(0, 0);
    aus.rd = { schlechtester: Math.min(...je.map((x) => x.frei)), stellen: je };
  }

  // ---------- H-e: Masse gleicher Elementarten ----------
  {
    const rechteck = (el) => { const r = el.getBoundingClientRect(); return { w: rund(r.width), h: rund(r.height), sel: kurz(el) }; };
    const alle = (css) => [...document.querySelectorAll(css)].filter(lesbar).map(rechteck);
    aus.mass = {
      spur: [...alle('.regler'), ...alle('.v-bahn')],
      hilfe: [...alle('a.hilfe-rund'), ...alle('.v-frage'), ...alle('#hilfe'), ...alle('#grip-hilfe')],
      auswahl: alle('select'),
      kachel: alle('.v-wahl-karte'),
    };
  }
  return aus;
}
`;

// J1: Zustand der festen Karte der Einstellungsseite bei stehendem Fehlersatz (Aufruf: probeFehler(window)).
export const FEHLER_SKRIPT = String.raw`
function probeFehler(win) {
  const d = win.document;
  const rect = (el) => el.getBoundingClientRect();
  const innen = (el) => { const r = rect(el); return r.width > 0 && r.height > 0 && r.top >= -0.5 && r.bottom <= win.innerHeight + 0.5; };
  // J12: Mitte und vier Ecken (je 2 px nach innen): die Mitte trifft das Element selbst oder etwas darin, jede Ecke dazu auch einen Vorfahren (runde Ecken zeigen den Grund);
  // alles andere liegt darueber.
  const frei = (el) => {
    const r = rect(el);
    if (r.width <= 0 || r.height <= 0) return null;
    win.__deckt = '';
    const mitte = d.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const wer = (e) => (e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '') + ' [' + (() => { const q = e.getBoundingClientRect(); return Math.round(q.left) + ',' + Math.round(q.top) + ',' + Math.round(q.right) + ',' + Math.round(q.bottom); })() + ']' : 'nichts');
    if (!mitte || !(mitte === el || el.contains(mitte))) { win.__deckt = 'Mitte: ' + wer(mitte); return false; }
    // 2 px innerhalb der sichtbaren Form: bei runden Ecken liegt der Punkt 2 px innerhalb der Rundung (Radius mal 0,29 weiter innen), nicht im leeren Eck des Rechtecks.
    const rad = Math.min(parseFloat(win.getComputedStyle(el).borderTopLeftRadius) || 0, r.width / 2, r.height / 2);
    const k = 2 + rad * 0.2929;
    for (const [x, y] of [[r.left + k, r.top + k], [r.right - k, r.top + k], [r.left + k, r.bottom - k], [r.right - k, r.bottom - k]]) {
      const e = d.elementFromPoint(x, y);
      if (!e || !(e === el || el.contains(e) || e.contains(el))) { win.__deckt = 'Knopf [' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom) + '] Ecke ' + Math.round(x - r.left) + '/' + Math.round(y - r.top) + ': ' + wer(e); return false; }
    }
    return true;
  };
  const meldung = d.getElementById('speicher-meldung');
  const klein = d.getElementById('pause-leiste');
  const gross = d.getElementById('pause');
  const karte = d.querySelector('.leiste-karte');
  const zeile = d.querySelector('.leiste-zeile');
  const kleinSichtbar = rect(klein).width > 0;
  return {
    meldungSichtbar: !meldung.hidden && innen(meldung),
    meldungOben: Math.round(rect(meldung).top),
    hilfeFrei: frei(d.getElementById('hilfe-link')),
    hilfeImBild: innen(d.getElementById('hilfe-link')),
    grossFrei: frei(gross),
    grossDeckt: win.__deckt || '',
    grossImBild: innen(gross),
    kleinSichtbar,
    kleinFrei: kleinSichtbar ? frei(klein) : null,
    kartenHoehe: Math.round(rect(karte).height),
    meldungHoehe: Math.round(rect(meldung).height),
    zeileAnzeige: win.getComputedStyle(zeile).display,
    scrollY: Math.round(win.scrollY),
    hoch: d.documentElement.scrollHeight,
    grossDoc: Math.round(rect(gross).top + win.scrollY),
    platz: Math.round(parseFloat(win.getComputedStyle(d.documentElement).paddingTop) || 0),
    panelTop: (() => { const p = d.querySelector('[role=tabpanel]:not([hidden])'); return p ? Math.round(rect(p).top + win.scrollY) : null; })(),
  };
}
`;

export const FOKUS_SKRIPT = String.raw`
// Beginnt eine Tab-Folge: Startpunkt der Tastatur an den Seitenanfang, ein Horcher misst jeden Halt kurz nach dem Fokus (nach dem Scrollen der Seite),
// Rueckgabe: Zahl der zu druckenden Tasten.
function fokusStart(win) {
  const document = win.document;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.body.tabIndex = -1;
  document.body.focus();
  document.body.removeAttribute('tabindex');
  win.__veilKleb = null;
  win.__veilFolge = [];
  if (!win.__veilHorcher) {
    win.__veilHorcher = true;
    document.addEventListener('focusin', (e) => {
      const ziel = e.target;
      win.setTimeout(() => { if (win.__veilFolge && ziel === document.activeElement) win.__veilFolge.push(fokusSchritt(win)); }, 0);
    }, true);
  }
  win.scrollTo(0, 0);
  return document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]').length + 4;
}
// Wartet ms Millisekunden, misst den Halt noch einmal (Beobachter der Seite haben ihre Abstaende dann gesetzt) und ersetzt damit die fruehe Messung des letzten Halts.
// Rueckgabe: true, sobald ein Halt wiederkehrt (die Folge ist einmal rund).
async function fokusNach(win, ms) {
  await new Promise((fertig) => win.setTimeout(fertig, ms));
  const liste = win.__veilFolge || [];
  let f = fokusSchritt(win);
  // Zeigt die Messung einen verdeckten Fokus, bekommt die Seite noch einmal Zeit (Firefox scrollt asynchron, Beobachter setzen ihre Abstaende); gezaehlt wird der ruhige Stand.
  if (!f.leer && f.leisten && f.leisten.length) {
    await new Promise((fertig) => win.setTimeout(fertig, 350));
    const g = fokusSchritt(win);
    if (!g.leer && g.sel === f.sel && g.text === f.text) f = g;
  }
  if (!f.leer && liste.length) liste[liste.length - 1] = f;
  const schluessel = liste.filter((x) => !x.leer).map((x) => x.sel + '@' + x.text + '@' + x.docLeft);
  return new Set(schluessel).size < schluessel.length;
}
// Beendet die Folge: gibt die gemessenen Halte zurueck, bis ein Halt wiederkehrt.
function fokusFolge(win) {
  const liste = win.__veilFolge || [];
  win.__veilFolge = null;
  const aus = [];
  const gesehen = new Set();
  for (const f of liste) {
    if (f.leer) continue;
    const k = f.sel + '@' + f.text + '@' + f.docLeft;
    if (gesehen.has(k)) break;
    gesehen.add(k);
    aus.push(f);
  }
  if (win.document.activeElement && win.document.activeElement.blur) win.document.activeElement.blur();
  win.scrollTo(0, 0);
  return aus;
}
function fokusSchritt(win) {
  const document = win.document;
  const iw = win.innerWidth, ih = win.innerHeight;
  const rund = (n) => Math.round(n * 10) / 10;
  const kurz = (el) => {
    if (!el || !el.tagName) return String(el);
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    const teile = [];
    let e = el;
    for (let i = 0; e && e.tagName && i < 3; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { teile.unshift(s + '#' + e.id); break; }
      const k = [...(e.classList || [])].slice(0, 2).join('.');
      if (k) s += '.' + k;
      teile.unshift(s);
    }
    return teile.join(' > ');
  };
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { leer: true };
  let ra = a;
  { const r0 = a.getBoundingClientRect(); if ((r0.width <= 2 || r0.height <= 2) && a.labels && a.labels.length) ra = a.labels[0]; }
  const r = ra.getBoundingClientRect();
  const cs = win.getComputedStyle(ra);
  const aus = {
    sel: kurz(a),
    text: (a.getAttribute('aria-label') || a.textContent || a.value || '').trim().slice(0, 30),
    docTop: rund(r.top + win.scrollY), docLeft: rund(r.left + win.scrollX), hoehe: rund(r.height),
    unsichtbar: r.width <= 0 || r.height <= 0 || cs.visibility === 'hidden',
    ausserhalb: r.bottom <= 0 || r.top >= ih || r.right <= 0 || r.left >= iw,
  };
  let kleb = false;
  for (let e = a; e && e !== document.documentElement; e = e.parentElement) { const c = win.getComputedStyle(e); if (c.position === 'fixed' || c.position === 'sticky') { kleb = true; break; } }
  aus.inKlebend = kleb;
  { let k = null; for (let e = a; e && e !== document.documentElement; e = e.parentElement) { const c = win.getComputedStyle(e); if (c.position === 'fixed' || c.position === 'sticky') { k = kurz(e); break; } } aus.klebKey = k; }
  aus.vl = rund(r.left); aus.vt = rund(r.top);
  // Verdeckung durch klebende Elemente (samt dem, was darin steht): Flaeche des Schnitts mit dem Fokus
  const leisten = [];
  // Die Liste der klebenden Elemente gilt fuer die ganze Tab-Folge (der Aufrufer loescht win.__veilKleb am Anfang der Folge).
  if (!win.__veilKleb) win.__veilKleb = [...document.body.querySelectorAll('*')].filter((e) => { const p = win.getComputedStyle(e).position; return p === 'fixed' || p === 'sticky'; });
  for (const el of win.__veilKleb) {
    const c = win.getComputedStyle(el);
    if (el === a || el.contains(a) || a.contains(el) || el === ra || el.contains(ra)) continue;
    if (c.visibility === 'hidden' || c.display === 'none') continue;
    for (const e of [el, ...el.querySelectorAll('*')]) {
      const q = e.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      const ce = win.getComputedStyle(e);
      if (ce.visibility === 'hidden' || ce.display === 'none') continue;
      const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
      const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
      if (w > 1 && h > 1) { leisten.push({ leiste: kurz(el), ueberdeckt: rund(h), vonHoehe: rund(r.height), fokusOben: rund(r.top), leisteUnten: rund(q.bottom), scrollY: rund(win.scrollY) }); break; }
    }
  }
  aus.leisten = leisten;
  return aus;
}
`;

// Wertet die Folge der Tab-Halte (Reihenfolge der Tastatur) aus: gibt Befunde als Texte zurueck. `vorwaerts` false: Umschalt+Tab ab Seitenanfang.
// Reihenfolge: der naechste Halt endet ueber der Oberkante des vorigen (Sprung nach oben) oder steht in derselben Zeile weiter links.
export function wertungFokus(schritte, vorwaerts) {
  const befunde = [];
  for (const s of schritte) {
    if (s.unsichtbar) befunde.push(`Fokus unsichtbar: ${s.sel} "${s.text}"`);
    if (s.ausserhalb) befunde.push(`Fokus ausserhalb des Bildes: ${s.sel} "${s.text}"`);
    for (const l of s.leisten ?? []) befunde.push(`Fokus unter ${l.leiste}: ${s.sel} "${s.text}" ${l.ueberdeckt} von ${l.vonHoehe} px (Fokus oben ${l.fokusOben}, Leiste unten ${l.leisteUnten}, scrollY ${l.scrollY})`);
  }
  if (vorwaerts) {
    // J3: Halte innerhalb EINES klebenden Behaelters folgen derselben Regel (Lage im Fenster, nach oben und nach links), getrennt vom Fluss.
    const vorKleb = {};
    for (const s of schritte) {
      if (!s.klebKey) continue;
      const v = vorKleb[s.klebKey];
      if (v) {
        const gleicheZeile = Math.min(v.vt + v.hoehe, s.vt + s.hoehe) - Math.max(v.vt, s.vt) > Math.min(v.hoehe, s.hoehe) * 0.5;
        if (s.vt + s.hoehe < v.vt + 1) befunde.push(`Reihenfolge springt nach oben in ${s.klebKey}: ${v.sel} "${v.text}" -> ${s.sel} "${s.text}"`);
        else if (gleicheZeile && s.vl < v.vl - 1) befunde.push(`Reihenfolge springt nach links in ${s.klebKey}: ${v.sel} "${v.text}" -> ${s.sel} "${s.text}"`);
      }
      vorKleb[s.klebKey] = s;
    }
    let vor = null;
    for (const s of schritte) {
      if (s.inKlebend) continue;
      if (vor) {
        const gleicheZeile = Math.min(vor.docTop + vor.hoehe, s.docTop + s.hoehe) - Math.max(vor.docTop, s.docTop) > Math.min(vor.hoehe, s.hoehe) * 0.5;
        if (s.docTop + s.hoehe < vor.docTop + 1) befunde.push(`Reihenfolge springt nach oben: ${vor.sel} "${vor.text}" (${vor.docTop}) -> ${s.sel} "${s.text}" (${s.docTop})`);
        else if (gleicheZeile && s.docLeft < vor.docLeft - 1) befunde.push(`Reihenfolge springt nach links: ${vor.sel} "${vor.text}" -> ${s.sel} "${s.text}"`);
      }
      vor = s;
    }
  }
  return befunde;
}

// Wertet das Ergebnis von `messeHandy` fuer eine Ansicht aus: Texte der Verstoesse je Regel. `zeiger` 'grob' oder 'fein'; `flaeche` 'popup' | 'optionen' | 'interview' | 'willkommen'.
export function wertungMessung(m, { flaeche, zeiger, breite, hoehe, erste = false, reiter = null }) {
  const aus = { 'H-a': [], 'H-b': [], 'H-c': [], 'H-d': [], 'H-g': [] };
  if (m.ra.waagrecht) aus['H-a'].push(`waagrecht gescrollt: ${m.ra.scrollW} von ${m.ra.clientW}`, ...m.ra.ueberstehend.map((u) => `${u.el} ragt ${u.mehr} px hinaus`));
  const popupMaus = flaeche === 'popup' && zeiger !== 'grob';
  for (const z of m.ziele) {
    if (AUSNAHMEN_H_B.some((a) => a.sel === z.sel && a.flaeche === flaeche)) continue;
    if (popupMaus) {
      if (z.eff.h < MAUS_MIN_HOEHE - 0.5) aus['H-b'].push(`${z.sel} "${z.text}": Hoehe ${z.eff.h} < ${MAUS_MIN_HOEHE}`);
    } else if (z.eff.w < FINGERZIEL - 0.5 || z.eff.h < FINGERZIEL - 0.5) aus['H-b'].push(`${z.sel} "${z.text}": ${z.eff.w} x ${z.eff.h} < ${FINGERZIEL}`);
  }
  for (const u of m.ueberlappung) aus['H-b'].push(`Ueberlappung ${u.a} / ${u.b} (${u.w} x ${u.h})`);
  for (const b of m.rc.befunde) aus['H-c'].push(`${b.art}: ${b.el} "${b.text}"`);
  for (const b of m.rc.ueberText) aus['H-c'].push(`Text ueber Text: ${b.a} / ${b.b}`);
  for (const b of m.rc.kasten) aus['H-c'].push(`Kasten laeuft ueber: ${b.el} ${b.scrollW} > ${b.clientW}`);
  if (breite === 360 && hoehe === 640 && m.rd.schlechtester < GRENZE_FREI) aus['H-d'].push(`nur ${Math.round(m.rd.schlechtester * 100)} Prozent der Hoehe frei (${m.rd.stellen.map((s) => s.liste.join('+')).join(' | ')})`);
  if (reiter !== null && GRENZE_REITERFLAECHE[breite] !== undefined) {
    if (m.panelTop === undefined) aus['H-g'].push('Reiterflaeche nicht gefunden');
    else if (m.panelTop > GRENZE_REITERFLAECHE[breite]) aus['H-g'].push(`Reiterflaeche oben bei ${m.panelTop} px, Grenze ${GRENZE_REITERFLAECHE[breite]}`);
  }
  if (erste && !(reiter !== null && AUSNAHMEN_H_G.some((a) => a.reiter === reiter))) {
    const grenze = GRENZE_ERSTE_BEDIENUNG[flaeche]?.[breite];
    if (grenze !== undefined) {
      if (!m.erste) aus['H-g'].push('keine Bedienung gefunden');
      else if (m.erste.top > grenze) aus['H-g'].push(`erste Bedienung ${m.erste.sel} "${m.erste.text}" bei ${m.erste.top} px, Grenze ${grenze}`);
    }
  }
  return aus;
}

// J1: wertet probeFehler aus. `oben`: Seite ganz oben. Gibt Texte der Verstoesse zurueck.
export function wertungFehler(p, oben) {
  const b = [];
  if (!p.meldungSichtbar) b.push(`Fehlersatz nicht sichtbar (oben ${p.meldungOben})`);
  if (p.grossImBild === p.kleinSichtbar) b.push(`kleine Pause ${p.kleinSichtbar ? 'sichtbar' : 'verborgen'}, grosser Knopf ${p.grossImBild ? 'im Bild' : 'nicht im Bild'}`);
  if (p.hilfeImBild && p.hilfeFrei === false) b.push('#hilfe-link verdeckt');
  if (p.grossImBild && p.grossFrei === false) b.push('#pause verdeckt (' + p.grossDeckt + ')');
  if (p.kleinSichtbar && p.kleinFrei === false) b.push('#pause-leiste verdeckt');
  if (!p.kleinSichtbar && p.zeileAnzeige !== 'none') b.push('leere Zeile in der Karte');
  if (!p.kleinSichtbar && p.kartenHoehe > p.meldungHoehe + 24) b.push(`Karte ${p.kartenHoehe} px hoch fuer einen Satz von ${p.meldungHoehe} px`);
  if (oben && !p.grossImBild) b.push('Seite nicht ganz oben');
  return b;
}

// J10: an jeder Scrollstelle ist die Mitte des grossen Knopfs treffbar oder die kleine Pause sichtbar und treffbar, nie keines von beiden.
export function wertungStelle(p) {
  const gross = p.grossFrei === true && p.grossImBild;
  const klein = p.kleinSichtbar && p.kleinFrei === true;
  return gross || klein ? null : `weder der grosse Knopf (frei ${p.grossFrei} ${p.grossDeckt}, im Bild ${p.grossImBild}) noch die kleine Pause (sichtbar ${p.kleinSichtbar}, frei ${p.kleinFrei}) bedienbar bei scrollY ${p.scrollY}`;
}

// J11: Reiterflaeche im Fehlerzustand: die Grenze von H-g plus die Hoehe der Karte oben (benannte Regel, ohne Fehlersatz gilt GRENZE_REITERFLAECHE unveraendert).
export function wertungFehlerHG(p, breite) {
  const g = GRENZE_REITERFLAECHE[breite];
  if (g === undefined) return [];
  if (p.panelTop === null) return ['Reiterflaeche nicht gefunden'];
  return p.panelTop > g + p.kartenHoehe ? [`Reiterflaeche oben bei ${p.panelTop} px, Grenze ${g} plus Karte ${p.kartenHoehe}`] : [];
}

// J11: beim Scrollen springt nichts: Seitenhoehe und Lage des grossen Knopfs im Dokument sind an jeder Stelle gleich (`ref` ist die erste Probe).
export function wertungSprung(p, ref) {
  const b = [];
  if (Math.abs(p.hoch - ref.hoch) > 1) b.push(`Seitenhoehe ${p.hoch} statt ${ref.hoch} bei scrollY ${p.scrollY}`);
  if (Math.abs(p.grossDoc - ref.grossDoc) > 1) b.push(`grosser Knopf im Dokument bei ${p.grossDoc} statt ${ref.grossDoc} (scrollY ${p.scrollY})`);
  return b;
}
