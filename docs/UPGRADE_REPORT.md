# Lieferung und Prüfung · 30. Oktober 2026

Grundlage: `00_START_HIER.md`, das vollständige Upgradepaket und beide achtseitigen PDF-Referenzen. Die beiden Referenz-PDFs sind binär verschieden, enthalten aber denselben extrahierten Text. Alle Referenzseiten wurden gerendert und betrachtet. Die im Paket nur erwähnten sechs ursprünglichen Unterrichtsunterlagen lagen nicht als Volltexte vor; ihre vollständige Prüfung wird nicht behauptet.

## Git und bestehender Betrieb

Ausgangspunkt des Pakets: `777506264f91f9ce844d789c9c8f21229fe1dd78`. Animations-PR [#1](https://github.com/Witzelfitz/fake-oder-nicht-fake/pull/1) wurde nach erfolgreicher Prüfung unter ausschliesslicher Autorenschaft von Benjamin Hanimann integriert: `88e9c17ac421022b3b74bfa50cb1252bde4ffc73`. Der ungemergte Commit und der PR-Text wurden von den unerwünschten KI-Autorenvermerken bereinigt. Fremde Bildurheber und Schriftlizenzen bleiben korrekt genannt.

Das weitere Upgrade liegt auf `feature/der-zweite-blick` als eigener Review-PR. Den konkreten Liefercommit nennt der PR; lokal zeigt ihn `git log -1`. Keine produktive Bereitstellung oder Serverumstellung durchgeführt.

Vor den Änderungen wurden SQLite über die SQLite-Backup-Schnittstelle und Uploads gemeinsam nach `output/backups/20261030-163723/` gesichert. Arbeiten und PDF-Publikationen verwenden die separate Kopie `output/review-data/`. Der abschliessende Vergleich bestätigt unveränderte ursprüngliche Fragen, Räume, Teilnehmende und Antworten. Bei diesem Vergleich wurden vier von unseren Browserläufen erzeugte, unreferenzierte JPEG-Testkopien im bisherigen Uploadziel erkannt, separat gesichert und entfernt. In-Memory-Testserver nutzen jetzt ein isoliertes temporäres Uploadverzeichnis. Die ursprünglichen drei Uploads stimmen wieder vollständig mit der Sicherung überein.

## Umgesetzte Pakete

| Paket | Gelieferter Stand |
| --- | --- |
| A · Start | Netzwerkinterface-Ausfall abgefangen; Konfiguration/Start mit Fallback getestet. |
| B/C · Gestaltung und Bedienung | Eigene Papier-/Kobalt-Identität, zwei lokale Schriftfamilien, grosse Materialien, Bildzoom, getrennte Handy-/Host-/Beameraufgaben. Kleine Live-Updates erhalten Fokus, Zoom und Sicherheit. |
| D/E · Stand-Challenge | Sechs kuratierte Fälle, drei Antworten je Prüfachse, optionale Sicherheit, moderierte Quellen-/Urteils-/Transferaufdeckung. Keine Tempo-/Serienpunkte und keine globale Lernrangliste. Vollständiges Stand-PDF-Set. |
| F · Quellenwerkstatt | Vier Fälle mit dauerhaft getrennten Erst-/Zweiturteilen; Quellenphase, Teamrollen, Wiederverbindung und Serverneustart. Plan für 45 Minuten und kontrollierter Ausbau auf 90 Minuten. |
| G · Redaktion | Entwürfe, drei Prüfachsen, Quellenkarten, private Notizen, dokumentiertes Quellen-/Rechte-/Didaktikgate. Änderungen im Editor setzen eine Freigabe zurück. Importvorschau ergänzt ausschliesslich neue IDs. |
| H · Bibliothek | Zwölf neue Lernfälle in vier Sets. Sek-I-, Sek-II- und Erwachsenen-Voreinstellungen. Fiktive Fälle explizit markiert; Kreativauftrag mit Gegencheck als zweitseitiges Arbeitsblatt. Alle zwölf Fälle serverseitig durchgespielt. |
| I · Wiederverwendung | Zentrale Anlass-/Ressourcenkonfiguration, speicherbare Anlassprofile, ausdrücklich aktivierbare Löschfrist für alte abgeschlossene Räume. Anonyme Reflexion als Papierblatt; kein zusätzlicher anonymer Datenexport. |

Das frühere Quiz samt Wertung und Rangliste bleibt separat erhalten. Migrationen ergänzen neue Tabellen/Felder transaktional. Bestehende Raum-Snapshots und Wertungsmodelle werden nicht neu berechnet. Neue Lernantworten stehen in `responses_v3`; Ersturteil wird nie vom Zweiturteil überschrieben. Übergänge prüfen Command-ID, erwartete Revision, Phase und Fallposition; wiederholte Commands ändern nichts doppelt. Antwortfristen bleiben serverseitig.

Der Timer des Lernmodus endet ohne automatische Quellenaufdeckung. Übersprungene Fälle werden im Abschluss als übersprungen ausgewiesen und nicht als bearbeitet gezählt. Ein Bearbeitungszähler ist ausdrücklich keine validierte Medienkompetenzmessung.

## Inhalte und Quellen

Herstellung, Behauptung und Kontext werden getrennt geprüft. Das Fronalpstock-Foto und das Cardinaux-Plakat haben dokumentierte menschliche Herkunft. Commons-Beschreibung, Dateihistorie und Nutzungsangaben wurden am Original geprüft. Der Wolkenfall nutzt zusätzlich MeteoSchweiz, «Typische Wetterlagen im Alpenraum», Seite 9. Dieses PDF wurde gelesen und knapp zusammengefasst, nicht als eigenes Werk nachgedruckt. Der belegte Sachinhalt und die dokumentierte KI-Herstellung des Quiztextes bleiben getrennt.

Repair-Café Nebenan, Mia Keller, ihre Zahlen/Zitate und die Portalbeispiele sind Unterrichtssimulationen. Es werden keine realen Statistiken, Interviews oder Institutionen vorgetäuscht. Die Freigabeakte benennt eine Entwicklungsprüfung; sie behauptet keine persönliche Prüfung durch Benjamin oder eine zweite Unterrichtsperson. Bildnachweise auf Papier können die Herkunft verraten; die Druckfälle sind deshalb keine verblindete Erkennungsprüfung.

## Tatsächlich erzeugte PDFs

Übersicht und Direktlinks: [Druckunterlagen](materials/README.md). Ersetzt werden das frühere statische Dreiseiten-PDF und die statische Druckvorlage; `/stand.html` bleibt als kompatibler Einstieg zur neuen Publikationsansicht erhalten.

| Dateisatz | Dokumente | Seiten | Snapshot |
| --- | --- | --- | --- |
| Stand `stand-6` | 8 | 24 | `f219218392ef23cf5e59` |
| Werkstatt `werkstatt-4` | 7 | 21 | `522c24ca0179802feb81` |

Zusätzlich liegen zwei Kontaktbogen-PDFs und ihre PNG-Vorschauen bei. Kontaktbögen enthalten auch Moderationslösungen. Teilnehmerdateien nutzen eine explizite Feldprojektion ohne Lösung, Erklärung oder private Notiz. Die vollständigen Publikations-JSONs liegen nur unter `moderation/`. Fall-IDs, Revisionen und Snapshotkennungen stehen in den Dokumenten. Bilder sind im Snapshot eingefroren; spätere Bibliotheks- oder Medienänderungen verändern ihn nicht.

Renderer: von Playwright 1.64.1 verwalteter Chromium 156.0.8078.4. Lokale Schriften sind eingebettet, Sprache `de-CH`, PDF-Autor Benjamin Hanimann. Alle 45 gelieferten Seiten wurden bei 150 dpi gerendert und einzeln visuell betrachtet. Graustufenproben von Standplakat und Werkstattheft wurden ebenfalls geprüft. Strukturelle Prüfung: keine fehlenden Bilder, Schriften unter 9 pt, Texte ausserhalb der Seite oder Bilder unter 150 ppi. Manifestdateien enthalten SHA-256 der final gestempelten PDFs. Keine PDF/UA-/PDF/X-Zertifizierung.

Die ausgelieferten Plakate sind allgemeine Plakate ohne Sitzungscode. Der echte QR-Pfad wurde separat geprüft: Lobby mit erreichbarer LAN-Adresse, zwei voneinander getrennte Browser-Kontexte, A4-PDF, QR-Dekodierung aus dem finalen 150-dpi-Rendering und exakter Zielvergleich. Dieses kurzlebige Testplakat wird nicht als gültiger Veranstaltungszugang mitgeliefert. Auch QR-Codes in App-Screenshots dokumentieren nur die damalige Testlobby.

## Ausgeführte Checks

| Prüfung | Ergebnis |
| --- | --- |
| Ursprünglicher Stand inklusive Animations-PR | 17 Server-/Scoring-/Adminchecks und 3 Browserchecks erfolgreich. |
| Erweiterte Serverprüfungen | 31 erfolgreiche Tests insgesamt: bisherige Regressionen, Lernabläufe, Quellenpayload, Idempotenz, Rechte, Fristen, Restart, Importkonflikte, SQLite-Publikation, Profile, Löschfrist und Drucktickets. |
| Browser | 6 erfolgreich: altes Quiz mit zwei Mobilkontexten und Beamer, Admin-CRUD, P0 sechs Fälle, P1 vier Fälle, Redaktion/Freigabe/Druckticket und schmale Ansichten. P0 zusätzlich reduzierte Bewegung und 1920×1080-Beamer. |
| QR | `npm run pdf:qr:test` erfolgreich, ein A4-Blatt, Ziel aus finalem PDF dekodiert; zwei getrennte LAN-Browser-Kontexte erreichen die Lobby. |
| Lange Texte | `npm run pdf:fixtures`: neun explizite QA-Fälle, 11 PDF-Seiten ohne strukturelle Probleme; automatischer Umbruch statt Schriftverkleinerung. Kontaktbögen und die drei langen Fortsetzungsseiten betrachtet. Fehlendes Pflichtbild wird blockiert. |
| Gelieferte PDFs | 15 Dokumente / 45 Seiten, keine strukturellen Probleme oder Bildauflösungswarnungen; vollständige Einzel-Sichtprüfung abgeschlossen. |

Ein erster neuer Browsercheck lief in einen Timeout, weil der Test ein Feld im geschlossenen Quellen-Detailbereich ausfüllen wollte. Nach Öffnen dieses Bereichs funktioniert der Ablauf; der komplette Browserdurchlauf ist erfolgreich. In-Memory-Testuploads wurden zusätzlich vom tatsächlichen Datenverzeichnis getrennt. Keine Fehler durch höheres Timeout oder deaktivierte Prüfung verdeckt.

## Vor dem Anlass noch offen

- Tatsächlicher Papierdruck in Farbe/Graustufen und A6-Kartendruck.
- Lesbarkeit aus der letzten Reihe mit dem realen Beamer; Browser-Screenshots ersetzen diese Prüfung nicht.
- Physische Handys im Veranstaltungs-WLAN sowie Hardware-Scan eines frisch erzeugten Raumplakats. Bisher wurden getrennte Browser-Kontexte verwendet.
- Verständlichkeit der Fälle mit einer zweiten Person und tatsächliche Standdauer inklusive Gespräch. 8–12 Minuten sind die Moderationsplanung, kein bereits gemessener Publikumstest.
- Dauerhafte öffentliche Ressourcen-/Startadresse, sofern gewünscht. Bis dahin allgemeine Plakate und den aktuellen Beamer-QR verwenden.

Das Upgrade verändert keine produktive Installation. Nach Review müssen der neue Code bewusst übernommen, der Server mit bestehendem dauerhaftem Datenverzeichnis gestartet und die zwölf Lernfälle explizit über die Importvorschau ergänzt werden. Ein Rollback des Codes benötigt bei bereits migrierter SQLite weiterhin eine zur Version passende Sicherung; die ursprüngliche Sicherung bleibt lokal erhalten. GitHub Actions ist weiterhin nur als Vorlage vorhanden, da dem verfügbaren Zugang die `workflow`-Berechtigung fehlt.
