// Werberahmen auf Erwachsenenseiten ausblenden (Live-Lauf 18 C, HOCH 1; Entscheidung 193 "Anzeigen ganz verbergen"). Im fremden Rahmen eines
// Werbenetzes weiss der Schleier nicht, dass er auf einer Erwachsenenseite sitzt, und zensiert dort nur zonenweise. Die Seite selbst kennt aber
// den Rahmen und blendet ihn als Ganzes aus (visibility hidden, inline und wichtig, gegen Seitenregeln). Als Werberahmen gilt ein iframe
//  - mit Werbe-Adresse oder Werbe-Namen (data/werbung.json), in einer Werbe-Kennung oder einem Native-Ad-Kasten (ohne die Bild-Merkmale "promo"
//    und Aufschrift, damit ein Anmelde- oder Kommentar-Rahmen in einem "promo"-Bereich nie verschwindet), oder
//  - in einem Werbe-Format (300 x 250, 970 x 250 usw., src/werbung/logik.ts formatFuer), wenn er leer oder per srcdoc gefuellt ist oder von einem
//    fremden Host kommt (so lagen die Anzeigen im Live-Lauf: `about:srcdoc` mit Zufallsklassen). Captcha- und Anmelde-Hosts nie.
// Nur im Vorschau-Tausch (Liste und Pack), nicht wenn Mias eigene Werbung die Flaechen uebernimmt; gespeicherte und lokale Pause, Ausnahme und
// Abbau geben die Rahmen sofort zurueck. Der Rahmen laedt weiter (unsichtbar); seinen Ton haelt der Schleier im Rahmen nicht (bewusste Grenze).
import { istAnzeige } from '../adapter/anzeige';
import { beiLokalerPause } from '../pause-lokal';
import { formatFuer, istWerbeAdresse, passtWerbeName } from '../werbung/logik';

interface Vorher {
  wert: string;
  prio: string;
  stil: MutationObserver;
}

const NIE_AUSBLENDEN = [
  'google.com',
  'recaptcha.net',
  'gstatic.com',
  'hcaptcha.com',
  'challenges.cloudflare.com',
  'arkoselabs.com',
  'accounts.google.com',
  'appleid.apple.com',
  'facebook.com',
  // Zahlung (Pruefung Runde 11, Nr. 9: auf OnlyFans und Fansly liegen Zahlungsfelder in fremden Rahmen)
  'stripe.com',
  'stripe.network',
  'paypal.com',
  'ccbill.com',
  'segpay.com',
  'epoch.com',
  'verotel.com',
  'paysafecard.com',
  'braintreegateway.com',
  'adyen.com',
];
const LEER_MIN = { breite: 120, hoehe: 50 };
// Anzeigen-Hintergruende (Live-Lauf 18 D, HOCH 1): Elemente mit Klasse "promo..." oder "native..." in einer Anzeige verlieren ihr Hintergrundbild
// (inline und wichtig), unabhaengig davon, wie der Schleier sie bewertet hat (das xHamster-Promoband blieb live frei, obwohl die Regel im Test griff).
// Immer, nicht erst wenn ein Bild berechnet ist (Pruefung Nacharbeit, Nr. 1): das Stylesheet der Seite kommt oft erst nach dem Pruefen, dann
// bliebe das Band unmarkiert. Ohne Bild bewirkt "none" nichts. Grenze: Bilder an ::before und ::after sieht die Regel nicht.
const HG_KANDIDATEN = '[class*="promo" i], [class*="native" i]';
// Schmale Formate (Handy-Banner) nur fuer leere oder srcdoc-Rahmen, nie fuer fremde: dort passen sonst Zahlungs- und Anmeldefelder hinein.
const SCHMAL = new Set(['320x50', '320x100', '468x60']);

// Grobe registrierbare Domain (letzte zwei Teile): eigene Unterdomains der Seite gelten nicht als fremd (Runde 11, Nr. 11).
const domainVon = (h: string): string => h.split('.').slice(-2).join('.');

function hostVon(src: string | null): string | null {
  if (!src) return null;
  try {
    const u = new URL(src, location.href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export class AnzeigenRahmen {
  private an = false;
  private beobachter: MutationObserver | null = null;
  private groesse: ResizeObserver | null = null;
  private readonly markiert = new Map<HTMLIFrameElement, Vorher>();
  private readonly hgMarkiert = new Map<HTMLElement, Vorher>();
  // "Pause Mia" im Riegel oder in der Galerie: sofort alles zurueck, ohne auf den Speicher zu warten.
  private readonly lokalAb = beiLokalerPause(() => this.aktualisiere(false));

  aktualisiere(an: boolean): void {
    if (an === this.an) return;
    this.an = an;
    if (an) this.starte();
    else this.stoppe();
  }

  abbau(): void {
    this.aktualisiere(false);
    this.lokalAb();
  }

  private istWerberahmen(f: HTMLIFrameElement): boolean {
    try {
      const src = f.getAttribute('src');
      const host = hostVon(src);
      if (host && NIE_AUSBLENDEN.some((h) => host === h || host.endsWith(`.${h}`))) return false;
      if (istWerbeAdresse(src, location.href) || passtWerbeName(f.getAttribute('id')) || passtWerbeName(f.getAttribute('name'))) return true;
      if (istAnzeige(f, location.href, { nurKennung: true })) return true;
      const ohneSrc = !src || !src.trim();
      const leer = f.hasAttribute('srcdoc') || (!ohneSrc && /^about:/i.test(src.trim()));
      const fremd = host !== null && domainVon(host) !== domainVon(location.hostname.toLowerCase());
      if (!leer && !fremd && !ohneSrc) return false;
      const r = f.getBoundingClientRect();
      // Live-Lauf 18 D (MITTEL 2 und 3): srcdoc- und about:-Rahmen sind auf Erwachsenenseiten Anzeigen in jeder Groesse ab LEER_MIN
      // (Redtube-Kachel 232 x 231, Pornhub-Band 656 x 72 passen in kein Normformat); Seiten fuellen eigene Inhalte nicht per srcdoc.
      if (leer) return r.width >= LEER_MIN.breite && r.height >= LEER_MIN.hoehe;
      // Rahmen ganz ohne src (Editoren, Hilfe-Chats schreiben so hinein; Pruefung Nacharbeit, Nr. 2) nur im Werbe-Format, wie vor Live-Lauf D.
      const format = formatFuer(Math.round(r.width), Math.round(r.height));
      return format !== null && (ohneSrc || !SCHMAL.has(format));
    } catch {
      return false;
    }
  }

  private pruefe(f: HTMLIFrameElement): void {
    if (!this.an) return;
    if (!f.isConnected || !this.istWerberahmen(f)) {
      this.gib(f);
      return;
    }
    if (!this.markiert.has(f)) {
      const stil = new MutationObserver(() => this.verstecke(f));
      stil.observe(f, { attributes: true, attributeFilter: ['style'] });
      this.markiert.set(f, { wert: f.style.getPropertyValue('visibility'), prio: f.style.getPropertyPriority('visibility'), stil });
    }
    this.verstecke(f);
  }

  private verstecke(f: HTMLIFrameElement): void {
    if (!this.an || !this.markiert.has(f)) return;
    if (f.style.getPropertyValue('visibility') !== 'hidden' || f.style.getPropertyPriority('visibility') !== 'important') f.style.setProperty('visibility', 'hidden', 'important');
  }

  private gib(f: HTMLIFrameElement): void {
    const v = this.markiert.get(f);
    if (!v) return;
    this.markiert.delete(f);
    v.stil.disconnect();
    if (!f.isConnected) this.groesse?.unobserve(f);
    if (v.wert) f.style.setProperty('visibility', v.wert, v.prio);
    else f.style.removeProperty('visibility');
  }

  private nimmAuf(f: HTMLIFrameElement): void {
    this.groesse?.observe(f); // Groesse kommt oft erst nach dem Einfuegen: das Werbe-Format wird dann nachgeprueft
    this.pruefe(f);
  }

  // ---------- Anzeigen-Hintergruende ----------
  private pruefeHg(el: Element): void {
    if (!this.an || !(el instanceof HTMLElement)) return;
    let treffer = false;
    try {
      treffer = el.matches(HG_KANDIDATEN) && istAnzeige(el, location.href);
    } catch {
      treffer = false;
    }
    // Keine Anzeige (mehr), etwa nach Klassenwechsel: Bild zurueck (Pruefung Nacharbeit, Nr. 4).
    if (!treffer) {
      this.gibHg(el);
      return;
    }
    if (!this.hgMarkiert.has(el)) {
      const stil = new MutationObserver(() => this.versteckeHg(el));
      stil.observe(el, { attributes: true, attributeFilter: ['style'] });
      this.hgMarkiert.set(el, { wert: el.style.getPropertyValue('background-image'), prio: el.style.getPropertyPriority('background-image'), stil });
    }
    this.versteckeHg(el);
  }

  private versteckeHg(el: HTMLElement): void {
    if (!this.an || !this.hgMarkiert.has(el)) return;
    if (el.style.getPropertyValue('background-image') !== 'none' || el.style.getPropertyPriority('background-image') !== 'important') el.style.setProperty('background-image', 'none', 'important');
  }

  private gibHg(el: HTMLElement): void {
    const v = this.hgMarkiert.get(el);
    if (!v) return;
    this.hgMarkiert.delete(el);
    v.stil.disconnect();
    if (v.wert) el.style.setProperty('background-image', v.wert, v.prio);
    else el.style.removeProperty('background-image');
  }

  private sucheHg(n: Element): void {
    this.pruefeHg(n);
    for (const k of n.querySelectorAll(HG_KANDIDATEN)) this.pruefeHg(k);
  }

  private starte(): void {
    const wurzel = document.documentElement;
    if (!wurzel) return;
    this.sucheHg(wurzel);
    this.groesse = typeof ResizeObserver === 'function' ? new ResizeObserver((e) => { for (const x of e) if (x.target instanceof HTMLIFrameElement) this.pruefe(x.target); }) : null;
    for (const f of wurzel.querySelectorAll('iframe')) this.nimmAuf(f);
    this.beobachter = new MutationObserver((liste) => {
      let entfernt = false;
      for (const r of liste) {
        if (r.type === 'attributes') {
          if (r.target instanceof HTMLIFrameElement) this.pruefe(r.target);
          else if (r.attributeName === 'class' && r.target instanceof Element) this.pruefeHg(r.target);
          continue;
        }
        for (const n of r.addedNodes) {
          if (n instanceof HTMLIFrameElement) this.nimmAuf(n);
          else if (n instanceof Element) {
            for (const f of n.querySelectorAll('iframe')) this.nimmAuf(f);
            this.sucheHg(n);
          }
        }
        if (r.removedNodes.length) entfernt = true;
      }
      // Einmal je Rueckruf (nicht je Eintrag): entfernte Rahmen freigeben und nicht weiter beobachten (Runde 11, Nr. 12 und 13).
      if (entfernt) {
        for (const f of [...this.markiert.keys()]) if (!f.isConnected) this.gib(f);
        for (const el of [...this.hgMarkiert.keys()]) if (!el.isConnected) this.gibHg(el);
      }
    });
    // Nur Struktur und die Rahmen-Merkmale; den Stil beobachtet je markiertem Rahmen ein eigener Beobachter.
    // class dazu: Seiten setzen Promo-Klassen oft erst nach dem Einfuegen (der Rueckruf prueft nur Treffer auf HG_KANDIDATEN).
    this.beobachter.observe(wurzel, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcdoc', 'name', 'id', 'class'] });
  }

  private stoppe(): void {
    this.beobachter?.disconnect();
    this.beobachter = null;
    this.groesse?.disconnect();
    this.groesse = null;
    for (const f of [...this.markiert.keys()]) this.gib(f);
    for (const el of [...this.hgMarkiert.keys()]) this.gibHg(el);
  }
}
