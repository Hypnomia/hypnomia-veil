// Einheitstests Paket N3 (Sicherheitspruefung Phase 9 Fund A4): Referer-Regeln nur fuer den genauen Host, nie fuer die Hosts des
// Versions-Checks, mit Haltezeit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ABLAUF_SCHLUESSEL,
  MAX_REFERER_REGELN,
  REGEL_ID_START,
  abgelaufeneIds,
  erzeugeRefererChrome,
  erzeugeRefererFirefox,
  hostRegex,
  istEigenerHost,
  naechsterAblauf,
  saubereReferer,
} from '../../src/hintergrund/referer.ts';

test('eigene Hosts: Versions-Check und Release-Seite samt Ober- und Unterdomains', () => {
  for (const h of ['raw.githubusercontent.com', 'RAW.GitHubUserContent.com', 'raw.githubusercontent.com.', 'githubusercontent.com', 'github.com', 'api.github.com', 'x.raw.githubusercontent.com', 'com']) {
    assert.equal(istEigenerHost(h), true, h);
  }
  for (const h of ['cdn.example.com', 'githubusercontent.com.example', 'notgithub.com', 'avatars.example.org', '']) {
    assert.equal(istEigenerHost(h), false, h);
  }
});

test('saubereReferer: eigene Hosts abgelehnt, sonst nur Hostname und http(s)-Referer', () => {
  assert.equal(saubereReferer('raw.githubusercontent.com', 'https://seite.example/'), null);
  assert.equal(saubereReferer('raw.githubusercontent.com:443', 'https://seite.example/'), null);
  assert.equal(saubereReferer('githubusercontent.com', 'https://seite.example/'), null);
  assert.equal(saubereReferer('github.com', 'https://seite.example/'), null);
  assert.deepEqual(saubereReferer('CDN.Example.com:8080', 'https://seite.example/'), { hostname: 'cdn.example.com', referer: 'https://seite.example/' });
  assert.equal(saubereReferer('cdn.example.com', 'moz-extension://abc/'), null);
  assert.equal(saubereReferer('cdn.example.com', 'null'), null);
});

test('hostRegex trifft genau den Host mit beliebigem Port, keine Unterdomain, keinen Host im Pfad', () => {
  const r = new RegExp(hostRegex('cdn.example.com'), 'i');
  assert.ok(r.test('https://cdn.example.com/a.png'));
  assert.ok(r.test('http://cdn.example.com:8080/a.png'));
  assert.ok(!r.test('https://x.cdn.example.com/a.png'));
  assert.ok(!r.test('https://cdnxexample.com/a.png'), 'der Punkt ist maskiert');
  assert.ok(!r.test('https://cdn.example.com.evil.test/a.png'));
  assert.ok(!r.test('https://evil.test/?u=https://cdn.example.com/'));
  const v6 = new RegExp(hostRegex('[::1]'));
  assert.ok(v6.test('http://[::1]:8080/x'));
});

test('Ablauf: fehlende, ungueltige und vergangene Zeiten gelten als abgelaufen', () => {
  assert.deepEqual(abgelaufeneIds([1, 2, 3, 4], { 1: 100, 2: 300, 3: 'x' }, 200), [1, 3, 4]);
  assert.equal(naechsterAblauf({}), null);
  assert.equal(naechsterAblauf({ 5: 30, 6: 10 }), 10);
});

// Kleiner Nachbau von declarativeNetRequest und storage.session.
function nachbau() {
  let regeln = [];
  let sitzung = {};
  let zeit = 1_000_000;
  const dnr = {
    async getSessionRules() {
      return regeln.map((r) => structuredClone(r));
    },
    async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
      regeln = regeln.filter((r) => !removeRuleIds.includes(r.id));
      for (const r of addRules) {
        if (regeln.some((x) => x.id === r.id)) throw new Error('doppelte ID');
        regeln.push(structuredClone(r));
      }
    },
  };
  const speicher = {
    async get(k) {
      return k in sitzung ? { [k]: structuredClone(sitzung[k]) } : {};
    },
    async set(o) {
      sitzung = { ...sitzung, ...structuredClone(o) };
    },
  };
  return {
    dnr,
    speicher,
    regeln: () => regeln,
    sitzung: () => sitzung,
    jetzt: () => zeit,
    vor: (ms) => {
      zeit += ms;
    },
  };
}

test('Chrome: Regel je genauem Host mit regexFilter, Ablaufzeit in storage.session, eigene Hosts nie', async () => {
  const n = nachbau();
  const r = erzeugeRefererChrome({ dnr: n.dnr, sitzung: n.speicher, tabIdNone: -1, dauer: async () => 60_000, jetzt: n.jetzt });
  assert.equal(await r.setze('raw.githubusercontent.com', 'https://seite.example/'), false);
  assert.equal(n.regeln().length, 0);
  assert.equal(await r.setze('cdn.example.com', 'https://seite.example/a?b'), true);
  const [regel] = n.regeln();
  assert.equal(regel.id, REGEL_ID_START);
  assert.deepEqual(regel.condition.requestDomains, ['cdn.example.com']);
  assert.equal(regel.condition.regexFilter, hostRegex('cdn.example.com'));
  assert.deepEqual(regel.condition.tabIds, [-1]);
  assert.equal(n.sitzung()[ABLAUF_SCHLUESSEL][String(regel.id)], n.jetzt() + 60_000);
  // Neu setzen ersetzt die Regel des Hosts und verlaengert die Haltezeit.
  n.vor(30_000);
  await r.setze('cdn.example.com', 'https://andere.example/');
  assert.equal(n.regeln().length, 1);
  assert.equal(n.regeln()[0].action.requestHeaders[0].value, 'https://andere.example/');
  assert.deepEqual(Object.values(n.sitzung()[ABLAUF_SCHLUESSEL]), [n.jetzt() + 60_000]);
});

test('Chrome: abgelaufene Regeln und Regeln ohne Ablaufzeit fallen beim Raeumen und beim naechsten Setzen weg', async () => {
  const n = nachbau();
  const r = erzeugeRefererChrome({ dnr: n.dnr, sitzung: n.speicher, tabIdNone: -1, dauer: async () => 60_000, jetzt: n.jetzt });
  await r.setze('a.example', 'https://seite.example/');
  n.vor(30_000);
  await r.setze('b.example', 'https://seite.example/');
  // Fremde Regel ausserhalb des Bereichs bleibt immer.
  await n.dnr.updateSessionRules({ addRules: [{ id: 5, condition: {} }] });
  n.vor(31_000);
  await r.raeume();
  const namen = () => n.regeln().map((x) => String(x.condition.requestDomains?.[0] ?? x.id)).sort();
  assert.deepEqual(namen(), ['5', 'b.example']);
  // Service Worker neu gestartet, Ablaufzeiten verloren: Regel ohne Zeit gilt als abgelaufen.
  await n.speicher.set({ [ABLAUF_SCHLUESSEL]: {} });
  const r2 = erzeugeRefererChrome({ dnr: n.dnr, sitzung: n.speicher, tabIdNone: -1, dauer: async () => 60_000, jetzt: n.jetzt });
  await r2.raeume();
  assert.deepEqual(n.regeln().map((x) => x.id), [5]);
  // Beim Setzen wird ebenfalls geraeumt.
  await r2.setze('c.example', 'https://seite.example/');
  n.vor(60_000);
  await r2.setze('d.example', 'https://seite.example/');
  assert.deepEqual(namen(), ['5', 'd.example']);
});

test('Chrome: hoechstens MAX_REFERER_REGELN, die aelteste fliegt raus', async () => {
  const n = nachbau();
  const r = erzeugeRefererChrome({ dnr: n.dnr, sitzung: n.speicher, tabIdNone: -1, dauer: async () => 60_000, jetzt: n.jetzt });
  for (let i = 0; i <= MAX_REFERER_REGELN; i++) await r.setze(`h${i}.example`, 'https://seite.example/');
  assert.equal(n.regeln().length, MAX_REFERER_REGELN);
  assert.ok(!n.regeln().some((x) => x.condition.requestDomains[0] === 'h0.example'));
  assert.equal(Object.keys(n.sitzung()[ABLAUF_SCHLUESSEL]).length, MAX_REFERER_REGELN);
});

test('Firefox: genauer Host, Haltezeit, eigene Hosts nie', async () => {
  let zeit = 0;
  const r = erzeugeRefererFirefox({ dauer: async () => 1000, jetzt: () => zeit });
  assert.equal(await r.setze('github.com', 'https://seite.example/'), false);
  assert.equal(await r.setze('cdn.example.com:443', 'https://seite.example/'), true);
  assert.equal(r.fuer('cdn.example.com'), 'https://seite.example/');
  assert.equal(r.fuer('CDN.example.com.'), 'https://seite.example/');
  assert.equal(r.fuer('x.cdn.example.com'), null);
  assert.equal(r.fuer('example.com'), null);
  zeit = 999;
  assert.equal(r.fuer('cdn.example.com'), 'https://seite.example/');
  zeit = 1000;
  assert.equal(r.fuer('cdn.example.com'), null);
});
