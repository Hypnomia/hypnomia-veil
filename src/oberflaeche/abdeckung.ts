// Kurzzeile des Popups "I cover: ..." (Phase 11 E4t, W6 und W13): reine Rechnung mit denselben Funktionen wie der Schleier (`presetDef`, `hebeStufe(wirksameStufe(...),
// istStrengeZeit(...))`, `wirksameZonen`). "nothing right now" steht nur, wenn wirklich nichts verdeckt wird: keine Zone an, kein Balken und die Steigerung legt nichts dazu.
// Kann der Stand der Steigerung nicht gelesen werden, ist der Griff `unbekannt` und die Zeile sagt nie "nothing". Keine Laufzeit-Importe ausser reinen Modulen.
import { ZONEN, type Einstellungen, type Zone } from '../einstellungen.ts';
import { hebeStufe, istStrengeZeit } from '../kontrolle/streng.ts';
import { istFreigeschaltet, presetDef } from '../preset-def.ts';
import type { PackKurz } from '../pack/vertrag.ts';
import { wirksameStufe, wirksameZonen, type SteigerungStand, type SteigerungStufe } from '../steigerung.ts';

type Quelle = Pick<Einstellungen, 'zonen' | 'augenbalken' | 'preset' | 'pause' | 'kontrolle'>;

// Stufe, wie der Schleier sie nimmt: Stand der Steigerung (nur mit `zensur:steigerung`), in einer strengen Zeit (nur mit `kontrolle:zeitplan`, nicht in der Pause) eine Stufe hoeher.
export function popupStufe(e: Pick<Einstellungen, 'pause' | 'kontrolle'>, pack: PackKurz | null | undefined, stand: SteigerungStand, jetzt: Date): { basis: SteigerungStufe; stufe: SteigerungStufe; streng: boolean; hat: boolean } {
  const hat = istFreigeschaltet(pack, 'zensur:steigerung');
  const streng = !e.pause && istFreigeschaltet(pack, 'kontrolle:zeitplan') && istStrengeZeit(e.kontrolle.zeiten, jetzt);
  const basis = wirksameStufe(stand, jetzt.getTime());
  return { basis, stufe: hebeStufe(basis, streng && hat) as SteigerungStufe, streng, hat };
}

export interface AbdeckungStand {
  zonen: Zone[]; // eingeschaltet laut Schaltern
  balken: boolean; // ein schwarzer Balken ueber den Augen (Schalter Eye bar oder Stil Censor bars), ausser Mias Gesicht liegt darueber (Face an)
  griff: 'ja' | 'nein' | 'unbekannt'; // legt die Steigerung (My grip, auch durch eine strenge Zeit) Zonen dazu?
}

// `standBekannt`: der Stand der Steigerung ist gelesen; `packBekannt`: das Pack ist gelesen (X3). Ist eines nicht gelesen, ist der Griff `unbekannt`.
// X4: in einer strengen Zeit ohne Freischaltung `zensur:steigerung` gibt es keinen Griff, aber ein Quiz-Deckel liegt ueber dem Hauptvideo: auch dann `unbekannt` (nie "nothing").
export function abdeckungStand(e: Quelle, pack: PackKurz | null | undefined, stand: SteigerungStand, standBekannt: boolean, jetzt: Date, packBekannt = true): AbdeckungStand {
  const zonen = ZONEN.filter((z) => e.zonen[z].an);
  const def = presetDef(e, pack).gilt;
  const balken = def.augen === 'balken-immer' && !(def.gesicht === 'mia-gesicht' && e.zonen.face.an);
  const p = popupStufe(e, pack, stand, jetzt);
  let griff: AbdeckungStand['griff'] = 'nein';
  if (!packBekannt || (p.hat && !standBekannt) || (p.streng && !p.hat)) griff = 'unbekannt';
  else if (p.hat && p.stufe > 0) {
    const mit = wirksameZonen(e, p.stufe);
    const ohne = wirksameZonen(e, 0);
    if (mit.ganzVerdecken || ZONEN.some((z) => mit.zonen[z].an && !ohne.zonen[z].an)) griff = 'ja';
  }
  return { zonen, balken, griff };
}
