// Testwaechter (nur fuer die Testseiten): beobachtet nach dem Zeichnen jedes Frames (rAF, dann setTimeout, damit die Probe hinter den
// rAF-Rueckrufen des Schleiers laeuft) alle Kandidaten des Schleiers: img, video, canvas und Elemente mit Inline-Hintergrundbild
// (auch Kurzform `background: url(...)`), im Dokument, in offenen Shadow Roots und in geschlossenen (deren Wurzeln fangen wir ab,
// weil dieses Skript vor allen anderen laeuft und attachShadow umhaengt).
// Ergebnis:
//   window.__aufblitzen   Kandidaten, die sichtbar waren, obwohl sie noch kein Urteil (data-veil) hatten
//   window.__unsichtbar   Kandidaten mit Urteil (frei, zensiert, verdeckt), die trotzdem nicht opacity 1 hatten
//   window.__proben       Anzahl der Pruefungen, window.__wer: Beschreibung der Funde
//   window.__strictGesehen / __strictOffen   Proben bei Strict (data-veil-strict ohne data-veil-seite): Seite unsichtbar bzw. faelschlich sichtbar
// Waehrend die Seite aus ist (data-veil-seite="aus": Pause, Ausnahme) wird nicht gepruefte: dort soll alles sichtbar sein.
(function () {
  window.__aufblitzen = 0;
  window.__unsichtbar = 0;
  window.__proben = 0;
  window.__wer = [];
  window.__strictGesehen = 0;
  window.__strictOffen = 0;
  var KANDIDAT = 'img, video, canvas, [style*="background" i][style*="url(" i]';

  // Geschlossene Wurzeln sind von der Seite aus sonst nicht erreichbar.
  var geschlossen = [];
  var original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    var wurzel = original.call(this, init);
    if (init && init.mode === 'closed') geschlossen.push(wurzel);
    return wurzel;
  };

  function sammle(wurzel, aus) {
    var liste = wurzel.querySelectorAll('*');
    for (var i = 0; i < liste.length; i++) {
      if (liste[i].shadowRoot) sammle(liste[i].shadowRoot, aus);
    }
    var treffer = wurzel.querySelectorAll(KANDIDAT);
    for (var j = 0; j < treffer.length; j++) aus.push(treffer[j]);
  }

  function alle() {
    var aus = [];
    sammle(document, aus);
    for (var i = 0; i < geschlossen.length; i++) {
      if (geschlossen[i].host && geschlossen[i].host.isConnected) sammle(geschlossen[i], aus);
    }
    return aus;
  }

  function melde(art, el) {
    window.__wer.push(art + ' ' + (el.id || el.localName + ':' + (el.currentSrc || el.src || el.getAttribute('style') || '')) + ' @' + Math.round(performance.now()));
  }

  function probe() {
    var wurzel = document.documentElement;
    if (!wurzel) return;
    var seite = wurzel.getAttribute('data-veil-seite');
    if (wurzel.hasAttribute('data-veil-strict') && seite === null) {
      if (getComputedStyle(wurzel).opacity === '0') window.__strictGesehen++;
      else window.__strictOffen++;
    }
    if (seite === 'aus') return;
    var elemente = alle();
    for (var i = 0; i < elemente.length; i++) {
      var el = elemente[i];
      window.__proben++;
      var urteil = el.getAttribute('data-veil');
      var opacity = getComputedStyle(el).opacity;
      if (urteil === null && opacity !== '0') {
        window.__aufblitzen++;
        melde('aufgeblitzt', el);
      } else if (urteil !== null && opacity !== '1') {
        window.__unsichtbar++;
        melde('unsichtbar(' + urteil + ')', el);
      }
    }
  }

  function schritt() {
    setTimeout(probe, 0);
    requestAnimationFrame(schritt);
  }
  requestAnimationFrame(schritt);
})();
