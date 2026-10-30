# Mit Coolify veröffentlichen

Das Repository enthält das vollständige Dockerfile. Die Anwendung benötigt eine einzelne Node-Instanz mit dauerhaftem SQLite-/Upload-Verzeichnis. Eine zusätzliche Datenbank-Ressource ist nicht nötig.

## GitHub und Anwendung

In Coolify eine Anwendung mit Zugriff auf das private Repository `Witzelfitz/fake-oder-nicht-fake` verbinden, etwa über die GitHub App oder einen Deploy Key. Branch: **main**. Als Build Pack / Build Strategy **Dockerfile** wählen. Base Directory ist das Repository-Wurzelverzeichnis (`/`); Dockerfile Location ist `Dockerfile` in diesem Verzeichnis. Start- und Installationsbefehl übernimmt das Dockerfile.

**Ports Exposes: `3000`**. Die öffentliche HTTPS-Domain auf diese Anwendung richten. Der Prozess lauscht über `HOST=0.0.0.0` auf dem Containerport. Eine öffentliche direkte Portfreigabe auf dem Host ist für den Zugriff über den Coolify-Proxy nicht nötig.

Offizielle Anleitung: [Dockerfile-Anwendungen](https://coolify.io/docs/applications/builds/dockerfile).

## Laufzeitvariablen

In Coolify als Runtime Environment Variables hinterlegen, ohne sie ins Repository zu schreiben:

| Variable | Wert |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `3000` |
| `DB_PATH` | `/app/data/quiz.sqlite` |
| `HOST_KEY` | Ein eigener langer zufälliger Moderationsschlüssel |
| `PUBLIC_URL` | Deine tatsächliche HTTPS-Domain, ohne abschliessenden Slash |

`HOST_KEY` bleibt so bei Neustarts gleich. Er schützt Moderation, Fragenverwaltung und Publikationen. `PUBLIC_URL` wird für die Beitrittslinks und QR-Codes verwendet; hier die wirkliche Adresse eintragen. Diese Variablen werden erst beim Start benötigt, nicht als Build-Argumente.

## Daten dauerhaft speichern

Vor dem ersten Deploy unter **Persistent Storage** einen benannten **Volume Mount** einrichten, beispielsweise `fake-quiz-data`, mit **Destination Path `/app/data`**. Darin liegen SQLite inklusive ihrer WAL-Dateien, Fragen, Antworten, Publikationssnapshots und `uploads/`. Das `VOLUME` im Dockerfile ersetzt diese ausdrückliche Coolify-Konfiguration nicht.

Der Container läuft als Benutzer `node` (UID/GID 1000). Das Volume muss für diesen Benutzer beschreibbar sein; bei selbst verwalteten Bind Mounts die Eigentumsrechte entsprechend einrichten. Das gesamte Datenverzeichnis mounten, nicht nur die einzelne SQLite-Datei.

Eine Instanz betreiben. Bei Aktualisierungen laufende Gruppen vorher abschliessen und einen Austausch des Containers mit kurzer Unterbrechung einplanen. Zwei gleichzeitig aktive Instanzen auf derselben SQLite-Datei werden von dieser Anwendung nicht unterstützt. Preview-Deployments brauchen ein separates Datenvolume.

Ein Volume ist kein Backup. SQLite und Uploads zusammen sichern: entweder bei gestoppter Anwendung oder SQLite über die Backup-Schnittstelle konsistent sichern und die Uploads dazu kopieren. Nach einem Redeploy prüfen, dass eine eigene Testfrage noch vorhanden ist. Siehe [Coolify: Persistente Speicherung](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview).

## Erster Start und Inhalte

Nach dem Deploy zuerst `https://DEINE-DOMAIN/api/health` öffnen; die Antwort lautet `{"ok":true}`. Unter `/admin` mit deinem `HOST_KEY` anmelden. **Lernpaket importieren** zeigt die zwölf neuen Lernfälle in einer Vorschau; anschliessend die neuen IDs ergänzen. Ein frisches Volume enthält zunächst nur die bisherige Bibliothek. Lokal erstellte eigene Fragen und Uploads werden nicht über GitHub übertragen. Falls du diese übernehmen möchtest, das gemeinsam gesicherte Datenverzeichnis vor dem ersten produktiven Start in das Volume übertragen und passende Dateirechte setzen.

Danach unter `/host` eine Stand-Challenge mit `stand-6` erstellen. Mit zwei Geräten über die öffentliche Domain beitreten, auf «Live verbunden» achten und eine Abstimmung samt Auflösung testen. In `/materials` Anlass und Ressourcen prüfen. Allgemeine Druckplakate können sofort verwendet werden; ein Raumplakat erst nach Prüfung des tatsächlichen QR-Ziels ausgeben.

Der Docker-Healthcheck nutzt das bereits vorhandene Node.js und `GET /api/health`. Er benötigt weder curl noch wget. Coolify verwendet bei Dockerfile-Anwendungen diesen im Image definierten Check anstelle eines zusätzlich konfigurierten Dashboard-Checks. Details: [Coolify: Health Checks](https://coolify.io/docs/applications/configuration/health-checks).

Die geschützten Druckansichten unter `/materials` funktionieren im Produktionscontainer; dort kannst du im Browser als PDF speichern. Der automatisierte PDF-Dateisatz-Build mit Chromium/Python bleibt ein separates lokales Werkzeug und wird nicht im schlanken Produktionsimage installiert. Die fertigen Dateisätze stehen im GitHub-Repository unter `docs/materials/`.

## Prüfstand

Die Anwendung wurde mit 31 Serverchecks und sechs Browserabläufen geprüft. Der Healthcheck-Befehl wird lokal gegen den laufenden Server sowie mit nicht erreichbarem Ziel geprüft. Ein Docker-Image-Build und eine echte Coolify-Bereitstellung wurden hier nicht ausgeführt: Der lokale Docker-Dienst war nicht gestartet; die Veröffentlichung erfolgt anschliessend durch Benjamin.
