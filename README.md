# Fake oder nicht fake?

Ein spielbarer MVP für **Stand 02 am Digimärt Alpnach, 4. November 2026**. Acht mitgelieferte Beispiele aus Fotografie, Text und Werbung zeigen, was generative KI erzeugen kann. Eigene Fragen lassen sich im kleinen Backend erstellen. Die Gruppe stimmt auf dem Handy ab; die Moderation steuert den gemeinsamen Ablauf. Das schlichte Layout stellt den jeweiligen Inhalt in den Mittelpunkt.

**Stack:** Node.js 24 LTS, Express 5, Socket.IO 4, SQLite (`node:sqlite`), Vanilla JavaScript. Kein Build-Schritt, keine laufenden KI-API-Kosten, keine externen Laufzeit-CDNs. Alle Beispielbilder und der QR-Generator sind enthalten.

## Schnell starten

Node.js **24.14 oder neuer innerhalb der 24er-LTS-Reihe** installieren. Die eingebaute SQLite-Schnittstelle ist in dieser Version noch als experimentell markiert; Node kann beim Start einen entsprechenden Hinweis ausgeben.

```powershell
git clone https://github.com/Witzelfitz/fake-oder-nicht-fake.git
cd fake-oder-nicht-fake
npm ci
npm start
```

1. `http://localhost:3000/host` öffnen.
2. Moderationsschlüssel aus dem Server-Terminal eingeben.
3. Bei **Adresse für die Handys** die erreichbare WLAN-/LAN-Adresse des Laptops auswählen, z. B. `http://192.168.1.42:3000`.
4. Spielraum erstellen und **Beamer öffnen** anklicken. Dort stehen QR-Code und sechsstelliger Spielcode.
5. Handys mit demselben Netz verbinden, QR scannen, Spitznamen wählen.
6. Quiz starten, abstimmen, auflösen, kurz diskutieren und weiterschalten.

Die Erstinstallation braucht Internet. Danach funktioniert der Betrieb im lokalen Netz ohne Internet. Externe Quellenlinks benötigen Internet, die eingebauten Auflösungen nicht. Gäste-WLANs mit Client-Isolation verhindern möglicherweise den Zugriff auf den Laptop. Die lokale Windows-Firewall muss eingehende Verbindungen zum gewählten Node-Port erlauben; vor dem Anlass mit einem zweiten Gerät testen.

## Ansichten

| Pfad | Zweck |
| --- | --- |
| `/` | Beitreten mit Spielcode und Spitzname; danach persönliche Abstimmung |
| `/host` | Geschützte Moderation, neue Gruppe, Start, Auflösung, nächste Frage |
| `/admin` | Geschützte Fragenverwaltung mit Bild-Upload, Texteingabe und Reihenfolge |
| `/screen?code=123456` | Beameransicht ohne Steuerrechte |
| `/leaderboard` | Gespeicherte Stand-Rangliste; aktualisiert sich alle zehn Sekunden |
| `/stand.html` | Druckbares Standplakat, Moderationskarte und Merkblatt |
| `/sources.html` | Bildnachweise, Lizenzen, Herkunftserklärungen und Speicherhinweise |

Die Moderation ist pro Raum über einen zufälligen Zugang geschützt. Der Host-Zugang bleibt im Session Storage dieses Browser-Tabs. Den Tab bis zum Ende geöffnet lassen. Nach einem Neuladen verbindet er sich wieder. Der globale Moderationsschlüssel wird bei jedem Start neu erzeugt, sofern `HOST_KEY` nicht gesetzt ist.

![Desktop-Vorschau](docs/start-desktop.png)

[Quizansicht](docs/quiz-desktop.png) · [Handyansicht](docs/quiz-mobile.png) · [Fragenverwaltung](docs/admin-desktop.png)

## Regeln und Ablauf

- Pro Gruppe ein neuer Raum, bis zu 100 Beitritte; ab dem Quizstart sind neue Beitritte gesperrt. Bereits angemeldete Geräte können sich wieder verbinden.
- Antwortzeit wählbar: 15, 20, 25, 30, 45 oder 60 Sekunden.
- Ein Tipp pro Frage; nur der Server entscheidet über Frist und Punkte. Antworten sind nach der Auswahl unveränderbar.
- Richtiger Tipp: **1’000 Basispunkte + bis zu 500 Tempopunkte + bis zu 400 Serienpunkte**. Falsch oder nicht abgestimmt: 0 Punkte und Unterbrechung der Trefferfolge.
- Zeitablauf öffnet automatisch die Auflösung. Die Moderation darf früher auflösen und schaltet danach selbst weiter.
- Antworten, Punkte und Spielphase werden in SQLite gespeichert. Auch ein Server-Neustart erhält die Runde; eine inzwischen abgelaufene Frage wird aufgelöst.
- Die Stand-Rangliste zählt nur beendete Runden, in denen die Person alle Fragen beantwortet hat. Sie vergleicht dasselbe Fragenset, dieselbe Antwortzeit und dieselbe Wertungsversion. In der separaten Ranglistenansicht lässt sich die Antwortzeit auswählen. Unvollständige Teilnahmen bleiben in der Gruppenrangliste sichtbar.
- Nach dem Ergebnis mit **Neue Gruppe** einen neuen Raum erstellen. Alte Ergebnisse bleiben erhalten.

### Tempo, Serie und Rang

Der Zeitbonus fällt linear von 500 auf 0 Punkte über die gesamte Antwortzeit: `round(500 × (1 − Antwortzeit / Zeitlimit))`. Die Antwortzeit misst der Server ab Fragenstart bis zum Eingang der Antwort; vom Handy übermittelte Zeiten oder Punkte werden ignoriert. Netzwerk- und Ladezeiten sind darin enthalten.

Ab dem zweiten richtigen Tipp in Folge gibt es 100 Serienpunkte, ab dem dritten 200, ab dem vierten 300 und ab dem fünften jeweils 400. Eine falsche oder ausgelassene Frage setzt die Folge zurück. Maximal sind 1’900 Punkte pro Frage möglich.

Beispiel bei 20 Sekunden Zeitlimit: Ein richtiger Tipp nach 5 Sekunden mit einer vorherigen Zweier-Serie ergibt `1’000 + 375 + 200 = 1’575` Punkte.

Sortiert wird nach Gesamtpunkten, dann richtigen Antworten und danach durchschnittlicher Zeit der richtigen Antworten (auf Millisekunden gerundet). Identische Werte teilen sich den Rang. Die Tabelle zeigt Treffer, Durchschnittszeit und längste Serie; in der Gruppe zusätzlich die Rangänderung zur vorherigen Auflösung. Die persönliche Auflösung zeigt die genaue Punkteaufteilung.

Bestehende Datenbanken werden beim Start automatisch migriert. Vorhandene Räume behalten die frühere 1’000-Punkte-Wertung und werden nicht mit neuen Ergebnissen vermischt.

## Didaktischer Rahmen

Die Antwortmöglichkeiten heissen **«Mit KI erzeugt»** und **«Ohne generative KI»**. «Fake» im Titel ist der Gesprächseinstieg. Das Quiz unterscheidet die Entstehung eines Beispiels von seinem Wahrheitsgehalt.

Vier Beispiele stammen aus dokumentierten menschlichen Quellen und vier wurden für das Quiz generiert. Das Fronalpstock-Panorama ist fotografiert und digital zusammengesetzt. Das historische Plakat ist gestaltet, nicht fotografisch realistisch. Der KI-Wolkentext ist sachlich zutreffend. Die historischen Texte sind bewusst ein leichter Einstieg und kein repräsentativer Blindtest moderner Alltagstexte.

**Kernbotschaft:** Quelle suchen, Kontext prüfen, zweite Quelle finden. Visuelle Fehler und Schreibstil sind Anhaltspunkte, aber kein sicherer KI-Nachweis. Das Quiz ist keine Erkennungssoftware und keine belastbare Messung der individuellen Medienkompetenz. Wiederholungen derselben Beispiele beeinflussen die Rangliste.

## Standunterlagen

- [Druckfertiges PDF](docs/standunterlagen.pdf): drei A4-Seiten mit Standplakat, Moderationskarte und Merkblatt.
- [Druckansicht](public/stand.html): läuft unter `/stand.html`. Über den Browser drucken oder als PDF speichern.
- Für ein Plakat **mit dem aktuellen Raum-QR-Code** den Link «Standplakat» in der Moderation öffnen. Der QR gilt nur für diesen Raum; pro neue Gruppe neu ausgeben. Der Beamer zeigt stets den passenden QR.

Empfohlen: Gruppen à 8–12 Minuten, Standardzeit 25 Sekunden plus kurze Diskussion pro Beispiel. Laptop, Beamer/Display, Strom und WLAN; ein Handy pro Person oder Team. Audio ist nicht nötig.

## Konfiguration

Optional `.env.example` nach `.env` kopieren. `.env`, Datenbanken, Protokolle und Testergebnisse sind von Git ausgeschlossen.

| Variable | Standard | Zweck |
| --- | --- | --- |
| `PORT` | `3000` | HTTP- und Socket.IO-Port |
| `HOST` | `0.0.0.0` | Netzwerkschnittstelle; `127.0.0.1` für nur lokalen Zugriff |
| `HOST_KEY` | zufällig beim Start | Schlüssel zum Erstellen neuer Spielräume |
| `DB_PATH` | `./data/quiz.sqlite` | Persistente SQLite-Datei |
| `PUBLIC_URL` | Adressauswahl in Moderation | Erreichbare HTTP(S)-Basisadresse für QR und Beitritt |

Öffentliches Hosting: ein Node-Prozess mit beschreibbarem dauerhaftem Datenträger, HTTPS und Reverse Proxy mit WebSocket-Unterstützung. Bei Docker Port 3000 veröffentlichen und `data/` als Volume einbinden. Dieser MVP unterstützt **eine Serverinstanz**; SQLite und Raum-Timer sind nicht für horizontale Replikation ausgelegt. Auf rein statischem Hosting oder GitHub Pages laufen weder Socket.IO noch SQLite. Ein GitHub-Upload ist noch kein Live-Deployment.

```sh
docker build -t fake-quiz .
docker run --rm -p 3000:3000 --env-file .env -v fake-quiz-data:/app/data fake-quiz
```

## Eigene Fragen im Backend

1. `/admin` öffnen und mit dem **Moderationsschlüssel aus dem Terminal** anmelden.
2. **Neue Frage** wählen, Format und richtige Herkunft festlegen, Titel eingeben.
3. Foto/Plakat als **PNG, JPEG oder WebP bis 12 MB** hochladen oder einen Text einfügen.
4. Eine Erklärung zur Auflösung eintragen. Merksatz, Quellenlink, Urheber und Nutzungsangaben lassen sich ergänzen.
5. **In neuen Runden verwenden** wählen und speichern. Über die Pfeile in der Liste die Reihenfolge anpassen.

Bestehende Fragen können bearbeitet, deaktiviert und gelöscht werden. Löschen verlangt eine zweite Bestätigung. Gleichzeitige Änderungen an einer Frage werden erkannt, statt gespeicherte Fassungen still zu überschreiben. Ein Neustart nach Änderungen ist nicht nötig; die aktuelle aktive Bibliothek wird beim Erstellen einer neuen Runde übernommen. Mindestens eine aktive Frage ist erforderlich.

Beim ersten Start wird die Bibliothek einmalig aus `content/questions.json` in SQLite übernommen. Danach ist die **SQLite-Bibliothek** massgeblich; Änderungen an der Seed-Datei überschreiben eigene Inhalte nicht. Nach dem Löschen aller Fragen wird die Bibliothek beim Neustart nicht erneut befüllt.

Eigene Fragen liegen in derselben SQLite-Datei wie die Ergebnisse. Uploads liegen in `uploads/` neben der Datenbank, standardmässig also `data/uploads/`. Für ein Backup den Server stoppen und Datenbank **und** Upload-Ordner zusammen sichern. Eigene Materialien werden durch `.gitignore` vom GitHub-Upload ausgeschlossen. Beim Docker-Betrieb beide über das `data/`-Volume sichern.

Jeder Raum erhält einen unveränderlichen Schnappschuss seines Fragensets. Bearbeiten oder Löschen einer Frage verändert laufende Räume nicht. Deshalb bleiben auch nicht mehr verwendete Upload-Dateien auf der Festplatte erhalten; eine automatische Medienbereinigung ist nicht eingebaut. Ein geändertes Fragenset erhält eine neue Kennung für die Stand-Rangliste.

Der Admin-Schlüssel wird für diesen Browser-Tab im Session Storage gespeichert. Abmelden entfernt ihn dort. Schreibzugriffe und Bildvorschauen sind serverseitig geschützt. Vor der Auflösung überträgt der Spielserver weder Lösung, Erklärung noch Bonuswerte der aktuellen Antwort. Die Quellenansicht und ein zugängliches Repository können dennoch Hinweise geben; das ist kein prüfungssicheres System.

## Tests

```sh
npm run verify
npx playwright install chromium
npm run test:e2e
```

Alternativ mit vorhandenem Chrome unter PowerShell: `$env:PW_CHANNEL='chrome'; npm run test:e2e`.

Die Tests prüfen Moderationsrechte, Antwortfristen, serverseitige Punkte, Tempo- und Serienboni, Rangfolgen, Wiederverbindung, Neustarts und die Migration vorhandener Daten. Die Fragenverwaltung wird inklusive Upload, Versionierung, Reihenfolge, Deaktivierung und Löschung getestet. Browser-Tests spielen acht Fragen mit Moderation, Beamer und zwei getrennten Handy-Kontexten und bearbeiten eigene Texte und Bilder im Backend. Eine GitHub-Actions-Vorlage unter `docs/github-actions-workflow.yml.example` führt die Tests unter Node 24 aus. Sie ist noch nicht aktiviert: Dem für den Upload verfügbaren GitHub-Zugang fehlt die `workflow`-Berechtigung.

## Daten löschen

Nur Spitznamen verwenden. Nach dem Anlass den Server beenden und **alle Räume, Antworten und Ranglisten** entfernen:

```sh
npm run db:reset -- --confirm
```

Ohne `--confirm` verweigert das Skript das Löschen. **Eigene Fragen und Uploads bleiben erhalten.** Browserdaten bei Bedarf separat löschen. Der MVP hat keine automatische Löschfrist, keinen CSV-Export und keine Einzelpersonen-Löschoberfläche. Näheres unter `/sources.html`.

## Dateien und Rechte

Software: [MIT](LICENSE). Die fremden Bilddateien behalten ihre jeweiligen Rechte: [ASSETS.md](ASSETS.md). Vollständige Bildprompts und Prüfsummen: [content/provenance.json](content/provenance.json). Generierte Inhalte sind für das Quiz erstellt und ausdrücklich als solche dokumentiert.
