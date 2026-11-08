// Einheitstests Bewegungspruefung fuer SVG (Fund 9, Lesung 17 R2-2): reine Logik, ohne Browser.
// Ein SVG, das spaeter oder in anderer Groesse etwas anderes zeigen kann, gilt als bewegt (nie freigegeben).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { svgMitBewegung } from '../../src/erkenner/dekodiere.ts';

const svg = (innen, kopf = '') => new Blob([`${kopf}<svg xmlns="http://www.w3.org/2000/svg" width="150" height="40">${innen}</svg>`], { type: 'image/svg+xml' });
const RECHT = '<rect width="150" height="40" fill="#e91e63"/>';

test('ruhige SVG gelten nicht als bewegt', async () => {
  for (const innen of [
    RECHT,
    `<style>rect{fill:#e91e63}</style>${RECHT}`,
    `<rect width="150" height="40" style="fill:#e91e63;opacity:.9"/>`,
    `<image width="10" height="10" href="data:image/png;base64,iVBORw0KGgo="/>${RECHT}`,
    `<text x="2" y="20">Mia &amp; friends</text>`,
    `<path d="M0 0L10 10"/><g transform="translate(2 2)">${RECHT}</g>`,
    // Pruefung Runde 3, N3: haeufige ruhige Logos
    `<text x="2" y="20">Data: 2023</text>${RECHT}`,
    `<style>@media screen and (prefers-reduced-motion: reduce){rect{fill:#fff}}</style>${RECHT}`,
  ]) {
    assert.equal(await svgMitBewegung(svg(innen)), false, innen);
  }
  // Illustrator-Export mit Entitaeten im DOCTYPE
  const illustrator = '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/"><!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">]>';
  assert.equal(await svgMitBewegung(svg(RECHT, illustrator)), false, 'Illustrator-DOCTYPE');
});

test('bekannte Bewegung bleibt erkannt', async () => {
  for (const innen of [
    `<rect width="150" height="40"><set attributeName="fill" to="#000" begin="1s"/></rect>`,
    `<style>@keyframes a{from{opacity:0}}rect{animation:a 2s}</style>${RECHT}`,
    `<script>1</script>`,
  ]) {
    assert.equal(await svgMitBewegung(svg(innen)), true, innen);
  }
});

test('Luecken aus Lesung 17 R2-2 gelten als bewegt', async () => {
  const faelle = {
    discard: `${RECHT}<rect width="150" height="40" fill="#fff"><discard begin="2s"/></rect>`,
    'CSS-Escape keyframes': `<style>@\\6b eyframes a{to{opacity:0}}rect{anim\\61tion:a 2s}</style>${RECHT}`,
    'CSS-Escape im style-Attribut': `<rect width="150" height="40" style="anim\\61tion: a 2s"/>`,
    'starting-style': `<style>@starting-style{rect{opacity:0}}rect{transition:opacity 1s 3s}</style>${RECHT}`,
    transition: `<style>rect{transition-delay:3s}</style>${RECHT}`,
    media: `<style>@media (min-width: 400px){rect{fill:#000}}</style>${RECHT}`,
    'media gross geschrieben': `<style>@MEDIA (min-width: 400px){rect{fill:#000}}</style>${RECHT}`,
    container: `<style>@container (min-width: 400px){rect{fill:#000}}</style>${RECHT}`,
    import: `<style>@import url("mia.css");</style>${RECHT}`,
    'Kommentar vor dem Doppelpunkt': `<style>rect{animation/**/:a 2s}</style>${RECHT}`,
    'Zeichenbezug in style': `<style>@&#107;eyframes a{to{opacity:0}}rect{anim&#x61;tion:a 2s}</style>${RECHT}`,
    'Zeichenbezug im style-Attribut': `<rect width="150" height="40" style="anim&#97;tion: a 2s"/>`,
    'Entitaet baut set': `${RECHT}&x;`,
    'eingebettetes SVG als data:': `<image width="150" height="40" href="data:image/svg+xml;base64,PHN2Zz48c2V0Lz48L3N2Zz4="/>`,
    'xml-stylesheet': `${RECHT}`,
    'media mit Breite neben Vorliebe': `<style>@media (prefers-color-scheme: dark) and (min-width: 400px){rect{fill:#000}}</style>${RECHT}`,
    'eingebettete CSS-Adresse in url()': `<style>rect{fill:url("data:text/css,x")}</style>${RECHT}`,
    'Entitaet mit Rueckstrich in style': `<style>&s;</style>${RECHT}`,
    // Pruefung Runde 4, M1: Entitaeten zerlegen Schluesselwoerter in Stil und Attributen
    'Entitaeten zerlegen keyframes und animation': `<style>&a;&b;&c;</style>${RECHT}`,
    'Entitaet im style-Attribut': `<rect width="150" height="40" style="anim&x;tion: a 2s"/>`,
    'Entitaet baut data:-Adresse': `<image width="150" height="40" href="&d;ata:image/svg+xml,x"/>`,
    'Parameter-Entitaet': RECHT,
    'externe Entitaet': `${RECHT}&e;`,
    'Entitaet ohne Definition': `<text>&z;</text>${RECHT}`,
    // M2: die Seite kann color-scheme am Bild setzen, der Erkenner rastert hell
    'media prefers-color-scheme': `<style>@media (prefers-color-scheme: dark){rect{fill:#000}}</style>${RECHT}`,
    // Pruefung Runde 5, P1: doppelte Namen (XML nimmt den ersten Wert) und Deklarationen in Kommentaren
    'doppelte Entitaet': `<style>&a;&b;</style>${RECHT}`,
    'Entitaet nur im Kommentar': `<style>&a;&b;</style>${RECHT}`,
  };
  const koepfe = {
    'Entitaet baut set': '<!DOCTYPE svg [<!ENTITY x "&#60;set attributeName=\'fill\' to=\'#000\' begin=\'1s\'/>">]>',
    'Entitaeten zerlegen keyframes und animation': '<!DOCTYPE svg [<!ENTITY a "@key"><!ENTITY b "frames x{to{opacity:0}} rect{anim"><!ENTITY c "ation:x 2s}">]>',
    'Entitaet im style-Attribut': '<!DOCTYPE svg [<!ENTITY x "a">]>',
    'Entitaet baut data:-Adresse': '<!DOCTYPE svg [<!ENTITY d "d">]>',
    'Parameter-Entitaet': '<!DOCTYPE svg [<!ENTITY % p "x">]>',
    'doppelte Entitaet': '<!DOCTYPE svg [<!ENTITY a "@key"><!ENTITY a "x"><!ENTITY b "frames q{to{opacity:0}}">]>',
    'Entitaet nur im Kommentar': '<!DOCTYPE svg [<!ENTITY a "@key"><!-- <!ENTITY a "x"> --><!ENTITY b "frames q{to{opacity:0}}">]>',
    'externe Entitaet': '<!DOCTYPE svg [<!ENTITY e SYSTEM "x.txt">]>',
    'Entitaet ohne Definition': '',
    'Entitaet mit Rueckstrich in style': '<!DOCTYPE svg [<!ENTITY s "rect{anim\\61tion:a 2s}">]>',
    'xml-stylesheet': '<?xml-stylesheet type="text/css" href="data:text/css,%40keyframes%20a%7B%7D"?>',
  };
  for (const [name, innen] of Object.entries(faelle)) {
    assert.equal(await svgMitBewegung(svg(innen, koepfe[name] ?? '')), true, name);
  }
});
