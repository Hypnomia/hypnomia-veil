// Texte des Pack-Teils der Einstellungsseite (Session 12, Auftrag P). Entwuerfe, der Texter liest gegen; Tests pruefen gegen diese
// Konstanten. Jeder Satz sagt, was passiert ist, ob etwas gespeichert wurde und was jetzt zu tun ist.
import { PackFehler, type PackFehlerCode } from '../../src/pack/format.ts';
import type { PackVergleich } from '../../src/pack/ersetzen.ts';

export const NICHTS_GESPEICHERT = ' Nothing was stored.';

export const TEXT_EINSTIEG_ZUERST = 'Meet me first, then bring the pack. Nothing was stored. Use the button above.';
export const TEXT_MEHRERE_DATEIEN = 'One file at a time. Nothing was read and nothing was stored. Drop just the one pack file.';
export const TEXT_KEINE_DATEI = 'That wasn’t a file I can read, so nothing happened. Drop a single .miapack file, or use the button.';
export const TEXT_ORDNER = 'That’s a folder, and I only take a single pack file. Nothing was read and nothing was stored. Drop the .miapack file itself.';
export const TEXT_BESCHAEFTIGT = 'Hold on, I’m still busy with the last one. Nothing was changed.';
export const TEXT_LIZENZ_NICHT_LESBAR =
  'I couldn’t read the license from the stored pack just now. The pack itself is untouched. Open this page again, or add the pack file again to see the license.';
export const TEXT_ABLAGE = 'Or drop the pack file here.';
export const TEXT_ABLAGE_UEBER = 'Let go, I’ll take a look.';
export const KNOPF_ANNEHMEN = 'Accept and add';
export const KNOPF_ANNEHMEN_AELTER = 'Replace with the older version';
export const KNOPF_LIZENZ_ZEIGEN = 'Read the license';
export const KNOPF_LIZENZ_ZU = 'Hide the license';

export const TEXT_FERTIG = 'There it is. The pack is in, and it never left your browser.';
// Der Import hat Face eingeschaltet (nur dann steht das da) bzw. Face stand schon aus (Altbestand: Mia-Preset gewaehlt, Face bewusst aus).
export const TEXT_FERTIG_STIL = 'Your cover style is now “My face, black, words”. Face is on under What I cover, so every face becomes mine. You can switch it off again.';
export const TEXT_FERTIG_STIL_FACE_AUS = 'Your cover style is now “My face, black, words”. Face is off under What I cover, so faces stay as they are. Switch it on and every face becomes mine.';
export const TEXT_FERTIG_STIL_FEHLT = 'I couldn’t switch the cover style for you, so pick a style with my face under Cover style.';
export const TEXT_FERTIG_ERSETZT = 'The old pack is gone. Your settings stayed exactly as they were.';

export function megabyte(bytes: number): string {
  // Dezimal-MB, wie die Grenze von 300 MB (300 000 000 Bytes) im Format. Unter 1 MB in KB, damit kleine Packs nicht als "0.0 MB" erscheinen.
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function fehlerText(e: unknown): string {
  if (!(e instanceof PackFehler)) return `Something went wrong while reading that file.${NICHTS_GESPEICHERT} Try downloading the pack again.`;
  const code: PackFehlerCode = e.code;
  switch (code) {
    case 'zu-klein':
    case 'kennung':
    case 'manifest-groesse':
    case 'manifest-ungueltig':
    case 'format':
      return `That doesn’t look like a Mia Pack, so I can’t read it.${NICHTS_GESPEICHERT} Check that you picked the .miapack file.`;
    case 'zu-gross':
      return `That file is bigger than a pack is allowed to be (300 MB).${NICHTS_GESPEICHERT} Check that you picked the right file, or ask for a smaller pack.`;
    case 'bildmasse':
    case 'bild-zu-gross':
      return `A picture inside is too large (over 4096 pixels on a side), or its size can’t be read.${NICHTS_GESPEICHERT} Ask for a fixed pack.`;
    case 'veil-zu-alt':
    case 'format-version':
      return `This pack needs a newer version of HYPNOMIA VEIL. Update first, then try again.${NICHTS_GESPEICHERT}`;
    case 'sha256':
    case 'signatur':
    case 'utf8':
    case 'bereich':
    case 'ueberlappung':
    case 'lesefehler':
      return `Something inside the pack doesn’t add up. The file may be damaged or cut short.${NICHTS_GESPEICHERT} Your current pack, if you have one, is untouched. Try downloading the pack again.`;
    case 'lizenz':
      return `The pack has no usable license text, and I don’t add packs without one.${NICHTS_GESPEICHERT} Ask for a fixed pack.`;
    case 'ton-zu-gross':
      return `One of the sounds in this pack is too big for me (1 MB at most), so the pack stays out.${NICHTS_GESPEICHERT} Ask for a fixed pack.`;
    default:
      return `This pack breaks one of my rules, so it stays out.${NICHTS_GESPEICHERT} Ask for a fixed pack, or try another pack file.`;
  }
}

interface KurzePackAngabe {
  titel: string;
  version: string;
}

// Hinweis nach der Pruefung, bevor die Person annimmt. `erstes`: kein Hinweis (null).
export function ersetzenHinweis(fall: PackVergleich, alt: KurzePackAngabe | null, neu: KurzePackAngabe): string | null {
  switch (fall) {
    case 'erstes':
      return null;
    case 'neuer':
      return `You have ${alt?.titel ?? 'a pack'} in version ${alt?.version ?? '?'}. This file is version ${neu.version}, so it replaces the old one. Your settings stay exactly as they are.`;
    case 'gleich':
      if (alt && alt.version !== neu.version) {
        return `Your pack is version ${alt.version}, and this file is version ${neu.version}. I count those as the same version. Adding it again swaps in a fresh copy, which repairs a damaged one. Your settings stay exactly as they are.`;
      }
      return `Version ${neu.version} is already in. Adding it again swaps in a fresh copy, which repairs a damaged one. Your settings stay exactly as they are.`;
    case 'aelter':
      return `Careful: your pack is version ${alt?.version ?? '?'}, and this file is the older version ${neu.version}. Replacing it takes you back, and anything the newer version brought goes away. Your settings stay as they are. Only go on if you mean it.`;
    case 'anderes':
      return `This is a different pack. It replaces ${alt?.titel ?? 'your current pack'} (version ${alt?.version ?? '?'}), and that one is gone unless you keep its file. Your settings stay exactly as they are.`;
  }
}

export const TEXT_ERSETZT_KURZFASSUNG_OK = 'The pictures are stored, and I’ve finished setting up the pack.';
export const TEXT_KURZFASSUNG_STIL = ' Pick a style with my face under Cover style to use it.';
export const TEXT_KURZFASSUNG_FEHLT = 'The pictures are stored, but I couldn’t finish setting up the pack. Open this page again and I’ll sort it out.';
export const TEXT_NICHT_GESPEICHERT = 'The pictures couldn’t be stored, and nothing changed. Try again in a moment.';

// ---------- Runde 2: weitere Saetze der Seite ----------
export const TEXT_PACK_GEAENDERT =
  'Your pack changed while this file was waiting (maybe in another tab). Nothing was stored. Choose the file again and I’ll check it against what’s there now.';
export const TEXT_VORHANDENES_NICHT_LESBAR =
  'I couldn’t look at your current pack just now, so I’m not touching anything. Nothing was stored. Try again in a moment.';
export const STATUS_LEER = 'No pack yet. The Classic and Whole person styles work without it.';
export const STATUS_VERWAIST = 'I found leftover pictures from an earlier pack. Remove them to start clean.';
export const STATUS_DA = 'Pack in place. Stored on this device only.';
export const TEXT_ABGEBROCHEN = 'Not yet, then. Nothing was stored.';
export const TEXT_ENTFERNT = 'Mia Pack removed. If a style with my face was your cover style, it’s Mosaic now.';
export const TEXT_ENTFERNEN_TEILWEISE = 'The pictures are gone, but I couldn’t update everything else. Open this page again and I’ll finish the cleanup.';
export const TEXT_ENTFERNEN_FEHLER = 'I couldn’t remove the Mia Pack just now, so nothing changed. Try again in a moment.';
export const TEXT_ABGLEICH_NACHGESCHRIEBEN = 'I found your pictures and set the pack up again.';
export const TEXT_ABGLEICH_ENTFERNT = 'I found a pack entry with no pictures behind it and cleaned it up.';
export const TEXT_FORTSCHRITT_LESEN = 'Reading the pack';
export const textFortschrittPruefen = (fertig: number, gesamt: number): string => `Checking file ${Math.min(fertig + 1, gesamt)} of ${gesamt} in the pack`;
// Faustwert: kurzzeitig bis etwa das Doppelte der Pack-Groesse an freiem Arbeitsspeicher (siehe src/pack/speicher.ts).
export const textFortschrittStart = (groesse: number): string => `Storing the pictures. This can briefly use up to ${megabyte(groesse * 2)} of memory.`;
export const textFortschrittSpeichern = (fertig: number, gesamt: number): string => `Storing the pictures, file ${Math.min(fertig + 1, gesamt)} of ${gesamt}`;
export const textPatchBilder = (n: number): string => `${n} patch ${n === 1 ? 'picture' : 'pictures'}`;
export const textLizenzKopf = (titel: string, version: string, bilder: number, groesse: number): string =>
  `${titel}, version ${version}, ${textPatchBilder(bilder)}, ${megabyte(groesse)}. Everything checked out.`;

// ---------- Session 17, Paket C: Karte "Mia Pack" (Entwuerfe, der Texter liest gegen) ----------
export const TEXT_KARTE_TITEL = 'Mia Pack';
export const TEXT_NEU_EINLEITUNG =
  'The Mia Pack holds my pictures, sounds and words, and it unlocks the rest of me. I check it here and keep it on this device only. It never leaves your browser.';
export const TEXT_KERN = 'This is me dressed for the office. The Mia Pack is me off duty.';
export const TEXT_KAUF_TITEL = 'Get the Mia Pack';
export const TEXT_KAUF_PREIS = '€9.99, paid once, and later versions are free for you. Or included in my Hypnotic Pet tier, €10 a month.';
export const TEXT_KAUF_PATREON = 'Get it on Patreon';
export const TEXT_KAUF_SUBSCRIBESTAR = 'Get it on SubscribeStar';
export const TEXT_KAUF_TRENNER = 'Already have the file?';
export const TEXT_KNOPF_DATEI = 'Choose the pack file';
export const TEXT_DATEI_KEINE = 'No file chosen yet';
export const TEXT_KARTE_ERSETZEN = 'Update or replace the pack';
export const TEXT_KARTE_HILFE = 'How the pack works';
export const TEXT_BILDREIHE = 'A few of my pictures from your pack.';

// "Set me up" und die Frage nach der Werbung
export const TEXT_EINRICHTEN_TITEL = 'Set me up';
export const TEXT_EINRICHTEN_TEXT = 'Now that I’m in, tell me how far to go. Each answer saves right away, and you can change it later under Adult sites and Mia’s control.';
export const TEXT_EINRICHTEN_FERTIG = 'Done';
export const TEXT_EINRICHTEN_SPAETER = 'Skip';
export const TEXT_EINRICHTEN_SPAETER_HINWEIS = 'Skip keeps my defaults for anything you haven’t set. You can change it all later.';
export const TEXT_EINRICHTEN_WARNUNG = 'Flash words and my spiral move across your screen. Not for you if you have photosensitive epilepsy or are prone to seizures. Leave both off, or turn on Calm mode under Mia’s control.';
export const TEXT_EINRICHTEN_WARNUNG_OK = 'I understand';
export const TEXT_WERBUNG_TITEL = 'Show my ads?';
export const TEXT_WERBUNG_TEXT =
  'I can swap the ad spaces on other sites for my own little posters, always labeled “Mia’s ad” and linking only to my pages. Nothing about you leaves your browser. Change it any time in my settings, under Mia’s control.';
export const TEXT_WERBUNG_JA = 'Yes, show them';
export const TEXT_WERBUNG_NEIN = 'No ads';
