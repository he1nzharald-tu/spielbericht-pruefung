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
* **Prüfen** – `docs/js/rules.js` wertet die Daten im Browser aus. Bestätigte Namenszuordnungen fließen sofort ein.
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
| A6 | Spielbericht nicht bis 14:00 Uhr des Folgetags erfasst | 10.3.1/10.3.2 | Verstoß (Hinweis bei Erfassung durch Sportwart) |
| A7 | Endstand passt nicht zu den Einzelergebnissen | 10.3.2 | Verstoß |
| B7Z | Wertung ohne gespielte Partien – Hinweis mit Beschreibung/Protest, bei Nichtantreten mit 10.5.3/10.5.4 | 10.5.3, 10.5.4, 10.8.1 | Hinweis |
| P1/D1 | Eintrag im Protest-Feld bzw. sonstiger Vermerk in der Beschreibung | 10.4.4 | Hinweis |
| A7R/A7S | Ausspielziel nicht erreicht; Spielplan ≠ Spielbericht | 11.x.4, 10.7 | Hinweis |
| A8/A9/A10 | > 2 Mannschaften eines Vereins je Gruppe; > 10 Spieler im Kader; Spieler in zwei Kombi-Kadern | 11.8, 4.1.3, 4.1.4 | Hinweis |
| K1/K2 | Spieler in keinem Kader; Einsatz für anderen Verein | 10.2.1, 2.6.7, 2.7.1 | Hinweis |
| B1 | Nachverlegung > 4 Wochen, nach 31.12. (1. Kalenderjahr) oder ab 15. Spieltag | 10.5.6/10.5.8 | Hinweis |
| B2 | Vereinsduell: Rückspiel nicht vor Beginn der Rückrunde | 10.2.8 | Hinweis |
| B3 | Spieler abgemeldeter Mannschaft in unterklassiger Mannschaft | 10.8.2 | Hinweis |
| B7 | Dreimal ohne Einzelpartien gewertet (nicht angetreten?) | 10.8.1 | Hinweis |

**Stammmannschaft**: laut Kader (frühester Eintrag; bei mehreren die unterklassigste), sonst die unterklassigste Mannschaft mit Einsatz. **Rangfolge**: VL > LL > BL > KL > KK; bei gleicher Ligastufe entscheidet die Mannschaftsnummer. Senioren und Pokal bilden eigene Wettbewerbe ohne Springer-Prüfung.

## Grenzen

* Spieler sind auf billard-blmr.de nur über den Namen erkennbar (keine Passnummern). Schreibweisen werden tolerant abgeglichen; ähnliche Namen schlägt die App unter *Einstellungen → Namensabgleich* vor.
* Der Erfassungszeitpunkt im Spielbericht ist der der **letzten** Erfassung – nach einer Korrektur durch den Sportwart kann die Fristprüfung (A6) nicht mehr den ursprünglichen Zeitpunkt sehen.
* Ob Verlegungen genehmigt oder dem Sportwart gemeldet wurden, ist nicht sichtbar – B1 ist deshalb nur ein Hinweis.
* Relegationsspiele sind im Spielplan nicht gekennzeichnet; die Springer-Regelung gilt dafür nicht.
* Laut Springer-Regelung ersetzt sie STO 10.6.2, die STO-Fassung vom 05.10.2026 enthält 10.6.2 aber noch. B4 wird deshalb nur als Hinweis ausgegeben.

## Entwicklung

```bash
pip install -r scraper/requirements.txt
python scraper/scrape.py --leagues 571 --samples   # einzelne Liga, Roh-HTML nach debug/samples
node --test tests/rules.test.mjs                  # Regeltests
cd docs && python -m http.server 8000             # App lokal unter http://localhost:8000
```

Ligen und Ausspielziele je Saison: `config/leagues.json`.
