// Testwaechter des Komplett-Ersatzes (nur fuer die Testseiten ersatz*.html). Laeuft im Seitenkopf, nach dem Content-Script (document_start).
// Nach jedem Frame (rAF, dann setTimeout) wird geprueft, ob der Seiteninhalt (#inhalt) verdeckt ist, solange html[data-veil-ersatz] steht.
// Ergebnis in window.__e:
//   proben        Anzahl Proben mit Inhalt
//   sichtbarMitAttr   Proben MIT Attribut, bei denen #inhalt nicht visibility hidden war (muss 0 sein)
//   hgFalsch      Proben MIT Attribut, bei denen der Hintergrund von html nicht der Galerie-Hintergrund war (muss 0 sein)
//   ohneAttr      Proben OHNE Attribut (auf einer Listen-Seite mit Pack muss das 0 sein: die Seite war nie zu sehen)
//   wechsel       [['an'|'aus', ms seit Navigationsbeginn], ...] aus einem MutationObserver (ab diesem Skript)
//   ersteProbeMitAttr   war das Attribut schon bei der ersten Probe da?
(function () {
  var A = 'data-veil-ersatz';
  var e = (window.__e = { proben: 0, sichtbarMitAttr: 0, hgFalsch: 0, ohneAttr: 0, wechsel: [], ersteProbeMitAttr: null });
  var mit = function () {
    return !!document.documentElement && document.documentElement.hasAttribute(A);
  };
  if (window.__m) e.wechsel = window.__m; // Beobachter aus dem Inline-Skript der Seite (sieht auch Aenderungen vor dem Laden dieser Datei)
  else {
    new MutationObserver(function () {
      e.wechsel.push([mit() ? 'an' : 'aus', Math.round(performance.now() * 10) / 10]);
    }).observe(document, { attributes: true, subtree: true, attributeFilter: [A] });
  }
  function probe() {
    var h = document.getElementById('inhalt');
    if (!h) return;
    e.proben++;
    var an = mit();
    if (e.ersteProbeMitAttr === null) e.ersteProbeMitAttr = an;
    if (an) {
      if (getComputedStyle(h).visibility !== 'hidden') e.sichtbarMitAttr++;
      // Das Rosa gilt erst mit der Galerie (Wert "galerie"); in der Fruehphase hat das Attribut keine eigene Farbe.
      if (document.documentElement.getAttribute(A) === 'galerie' && getComputedStyle(document.documentElement).backgroundColor !== 'rgb(255, 245, 250)') e.hgFalsch++;
    } else {
      e.ohneAttr++;
    }
  }
  function schritt() {
    setTimeout(probe, 0);
    requestAnimationFrame(schritt);
  }
  requestAnimationFrame(schritt);
})();
