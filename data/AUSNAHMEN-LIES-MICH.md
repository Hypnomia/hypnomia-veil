# Standard-Ausnahmeliste (Entwurf Phase 0)

Zweck: `ausnahmen-standard.json` nennt Seiten, auf denen der Schleier nie erscheint (Banken, Bezahldienste, Captchas, Anmeldungen, Behoerden, E-Mail, Videokonferenzen, Gesundheit, Arbeit, Kassen).
Hostname-Muster (z. B. `paypal.com`) gelten per Suffix-Match: sie decken den Host selbst und alle Subdomains ab, nicht aber Hosts, die nur aehnlich enden.
Pfad-Muster (z. B. `amazon.de/gp/buy`) gelten per Praefix-Match auf den Pfad, der Host wird wie oben per Suffix verglichen.
Alle Muster sind klein geschrieben, ohne Protokoll und ohne Sternchen. Eintraege mit `"unsicher": true` sind nicht belegt und werden zuerst geprueft.
Eigene Ausnahmen: In Phase 2 ergaenzen Nutzer eigene Muster in den Einstellungen (gleiche Schreibweise), sie liegen getrennt von dieser Liste und ueberschreiben sie nicht.
Die Liste ist ein Entwurf: In Phase 2 wird jeder Eintrag im Browser getestet (Chromium und Firefox), danach wird `stand` angehoben.
Fehlende oder falsche Hosts werden dort bereinigt, erst danach gilt die Liste als Standard.
