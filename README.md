# Spielbericht-Prüfung PBVRW

Browser-App zur Prüfung der Spielberichte des PBVRW auf **billard-blmr.de**: Springer-Regelung (ab Saison 2026/2027) und weitere Bestimmungen der Sport- und Turnierordnung (STO, Fassung 05.10.2026).

**App:** https://he1nzharald-tu.github.io/spielbericht-pruefung/ – läuft am PC (Chrome, Edge, Firefox) und auf dem iPhone (Safari → Teilen → „Zum Home-Bildschirm“).

## So funktioniert es

```
billard-blmr.de ──(GitHub Actions, alle 3 Std.)──> docs/data/*.json ──(GitHub Pages)──> Browser-App
                                                                                   ├─ Prüfregeln (im Browser)
                                                                                   ├─ PDF-Bericht
                                                                                   └─ E-Mail über das Mailprogramm
```

* **Daten laden** – `scraper/scrape.py` liest Spielpläne, Kader und Spielberichte aller PBVRW-Ligen. Der Workflow „Daten aktualisieren“ läuft alle 3 Stunden, montags mit Vollabgleich, und lässt sich unter *Actions → Daten aktualisieren → Run workflow* sofort starten.
* **Nachträgliche Änderungen** – Spielpläne werden bei jedem Lauf neu geladen. Spielberichte werden neu geladen, wenn sie neu sind, das Ergebnis sich geändert hat oder das Spiel höchstens 6 Wochen zurückliegt; ältere rotierend mindestens einmal pro Woche und montags alle. Jeder Bericht hat einen Fingerabdruck; Abweichungen landen mit Vorher/Nachher in `changes.json` und im Reiter **Änderungen**. Kaderänderungen werden in `kader_history.json` protokolliert.
* **Ligen und Saison** – Die Saison ergibt sich aus dem Datum (Spielzeit 1.8.–31.7.). Die Ligen des PBVRW werden bei jedem Lauf aus der Spielbetriebsseite gelesen – auch Relegationen, die dort separat aufgeführt sind. `config/leagues.json` enthält nur noch Ausspielziele und optionale Korrekturen.
* **Abmeldungen** – Meldungen der Startseite („PBVRW <Liga>“ … „abgemeldet“) werden ausgewertet und der Mannschaft zugeordnet. Mannschaften und Begegnungen, die aus dem Spielplan verschwinden, bleiben mit Vermerk erhalten.
* **Prüfen** – `docs/js/rules.js` wertet die Daten im Browser aus. Bestätigte Namenszuordnungen fließen sofort ein.
* **Push-Nachrichten** – Nach jedem Lauf wertet `scripts/notify.mjs` dieselben Regeln aus und meldet nur *neue* Fälle über [ntfy](https://ntfy.sh) (kein zusätzlicher Abruf von billard-blmr.de). Einrichtung: ntfy-App installieren, einen geheimen Kanalnamen abonnieren und ihn als Repository-Secret `NTFY_TOPIC` hinterlegen. Optional Variable `NOTIFY_LEVEL=verstoss`, um nur Verstöße zu melden.
* **Bearbeiten** – Status (offen / erledigt / kein Verstoß), Notizen, E-Mail-Adressen, Namenszuordnungen und Textvorlagen werden nur auf dem jeweiligen Gerät gespeichert (Einstellungen → Exportieren/Importieren zum Übertragen zwischen PC und iPhone). E-Mail-Adressen landen dadurch nie im öffentlichen Repository.

## Geprüfte Regeln

| Code | Regel | Grundlage | Einstufung |
|---|---|---|---|
| R1/B4 | Springer nur aus unterklassiger Mannschaft; Einsatz in unterklassiger Mannschaft | Springer-Regelung, 10.6.2 | Hinweis |
| R2 | Nur eine Springer-Mannschaft je Saison | Springer-Regelung | Verstoß (10.2.7) |
| R3 | Beim 3. Einsatz in der Springer-Mannschaft festgespielt | Springer-Regelung | Info |
| R4 | Danach kein Einsatz mehr in der bisherigen Stammmannschaft | Springer-Regelung | Verstoß (10.2.7) |
| R5 | Gleiche Spieltagnummer nicht für zwei Mannschaften (alle Spieler, je Wettbewerb) | 10.2.6, Springer-Regelung | Verstoß (10.2.7) |
| R6 | Springer-Einsatz ohne Vermerk in der Beschreibung | Springer-Regelung | Verstoß (10.3.2) |
| R6F | Vermerk weicht vom Format „Springer = Vorname Nachname Passnummer“ ab | Springer-Regelung | Hinweis |
| R6X | Beschreibung nennt Springer, aber keiner erkannt | – | Hinweis |
| A1/A1R | Spieler > 2× je Begegnung bzw. > 1× je Durchgang | 11.x.6, 11.6.7, 11.7.6 | Verstoß |
| A2 | Senioren: gleiche Disziplin in beiden Durchgängen | 11.7.6 | Verstoß |
| A4 | Mannschaftsstärke / richtige Partien entfallen bei 3 (Senioren 2) Spielern | 11.x.3 | Verstoß / Hinweis |
| A4E | Leeres Spielerfeld (z. B. erster Springer-Einsatz) | Springer-Regelung | Hinweis |
| A6 | Spielbericht nicht bis 14:00 Uhr des Folgetags erfasst – maßgeblich ist der erste vom Tool gesehene Erfassungszeitpunkt, spätere Korrekturen werden im Verlauf gezeigt | 10.3.1/10.3.2 | Verstoß (Hinweis bei Erfassung durch Sportwart) |
| A7 | Endstand passt nicht zu den Einzelergebnissen | 10.3.2 | Verstoß |
| B7Z | Wertung ohne gespielte Partien – Hinweis mit Beschreibung/Protest, bei Nichtantreten mit 10.5.3/10.5.4 | 10.5.3, 10.5.4, 10.8.1 | Hinweis |
| P1/D1 | Eintrag im Protest-Feld bzw. sonstiger Vermerk in der Beschreibung | 10.4.4 | Hinweis |
| A7R/A7S | Ausspielziel nicht erreicht; Spielplan ≠ Spielbericht | 11.x.4, 10.7 | Hinweis |
| A8/A9/A10 | > 2 Mannschaften eines Vereins je Gruppe; > 10 Spieler im Kader; Spieler in zwei Kombi-Kadern | 11.8, 4.1.3, 4.1.4 | Hinweis |
| K1/K2 | Spieler in keinem Kader; Einsatz für anderen Verein | 10.2.1, 2.6.7, 2.7.1 | Hinweis |
| B1 | Nachverlegung > 4 Wochen, nach 31.12. (1. Kalenderjahr) oder ab 15. Spieltag | 10.5.6/10.5.8 | Hinweis |
| B2 | Vereinsduell: Rückspiel nicht vor Beginn der Rückrunde | 10.2.8 | Hinweis |
| WD | Mannschaft abgemeldet (aus den Meldungen der Startseite) | 10.8.1 (100 €) | Hinweis |
| B3 | Spieler einer abgemeldeten Mannschaft in den ersten drei Spieltagen danach in niedrigerer Mannschaft | 10.8.2 | Verstoß (10.2.7) |
| B7 | Dreimal ohne Einzelpartien gewertet (nicht angetreten?) | 10.8.1 | Hinweis |

**Stammmannschaft**: laut Kader (frühester Eintrag; bei mehreren die unterklassigste), sonst die unterklassigste Mannschaft mit Einsatz. **Rangfolge**: VL > LL > BL > KL > KK; bei gleicher Ligastufe entscheidet die Mannschaftsnummer. Senioren und Pokal bilden eigene Wettbewerbe ohne Springer-Prüfung.

## Grenzen

* Spieler sind auf billard-blmr.de nur über den Namen erkennbar (keine Passnummern). Schreibweisen werden tolerant abgeglichen; ähnliche Namen schlägt die App unter *Einstellungen → Namensabgleich* vor.
* Der Erfassungszeitpunkt wird beim ersten Lesen gespeichert. Wurde ein Bericht vor dem ersten Lesen schon korrigiert, ist der ursprüngliche Zeitpunkt nicht bekannt.
* Ob Verlegungen genehmigt oder dem Sportwart gemeldet wurden, ist nicht sichtbar – B1 ist deshalb nur ein Hinweis.
* Relegationen werden als eigene Wettbewerbe geführt: allgemeine Prüfungen ja, Springer-Prüfung nein.
* Mannschaften, die schon vor dem ersten Lauf des Tools aus dem Spielplan entfernt wurden (z. B. Eilendorf KL A 2026/2027), haben keine Kader- und Einsatzdaten mehr – die Sperre nach 10.8.2 kann für sie nicht geprüft werden.
* Senioren-Mannschaften haben auf billard-blmr.de keine Kaderseiten (offenes ToDo).
* Laut Springer-Regelung ersetzt sie STO 10.6.2, die STO-Fassung vom 05.10.2026 enthält 10.6.2 aber noch. B4 wird deshalb nur als Hinweis ausgegeben.

## Entwicklung

```bash
pip install -r scraper/requirements.txt
python scraper/scrape.py --leagues 571 --samples   # einzelne Liga, Roh-HTML nach debug/samples
node --test tests/rules.test.mjs                  # Regeltests
cd docs && python -m http.server 8000             # App lokal unter http://localhost:8000
```

Ligen und Ausspielziele je Saison: `config/leagues.json`.
