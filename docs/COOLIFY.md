# Coolify-Betrieb

Live unter **https://ki.mmacodeclub.ch**. Ein einzelner Node-24-Alpine-Container mit Express, Socket.IO und SQLite. Keine zusätzliche Datenbank, kein Redis und keine Browser-/PDF-Werkzeuge im Laufzeitbetrieb.

## Ressource

- Projekt: **Fake oder nicht fake**, Umgebung **production**.
- Anwendung: `zegtndfpm5owvtqkf785djrm`.
- Server: **localhost / witzelfitz-coolify-01**, `91.99.71.154`. Die Domain zeigt direkt dorthin.
- Repository: `Witzelfitz/fake-oder-nicht-fake`, Branch `main`, Build Pack **Dockerfile**.
- Port `3000` nur intern; HTTPS und WebSockets über den vorhandenen Coolify-Proxy.
- Limit **256 MiB RAM**, **0.5 CPU**, kein zusätzlicher Container-Swap; Node-Heap maximal 128 MiB.
- **Consistent Container Name** einschalten. Beim Redeploy endet die alte Instanz zuerst, damit nie zwei Serverprozesse dieselbe SQLite-Datei öffnen.
- Automatische Deployments und Vorschau-Deployments sind aus. Updates bewusst über Coolify deployen. Zwei Imageversionen behalten.

## Laufzeitvariablen und Daten

| Variable | Wert |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | `3000` |
| `DB_PATH` | `/app/data/quiz.sqlite` |
| `PUBLIC_URL` | `https://ki.mmacodeclub.ch` |
| `NODE_OPTIONS` | `--max-old-space-size=128` |
| `HOST_KEY` | Bestehender geheimer Moderationsschlüssel in Coolify |

Das explizite benannte Volume unter `/app/data` enthält SQLite samt WAL und Uploads. Der Container läuft als `node` (UID/GID 1000). Die Variablen werden nur zur Laufzeit gesetzt, nicht in das Image gebaut.

Der Schlüssel bleibt derselbe und wurde beim ersten Deployment über @pawicobot an den privaten Owner-Chat gesendet. Er steht weder im Repository noch in dieser Dokumentation.

## Healthcheck

In Coolify 4.5.3 den zusätzlichen Dashboard-Healthcheck ausschalten. Der Container behält damit den im Dockerfile definierten Node-Check gegen `http://127.0.0.1:3000/api/health`. Das öffentliche Ergebnis muss `{"ok":true}` sein. Kein curl-Paket nötig.

## Medienquiz

Die sechs Bilder und vier sieben bis acht Sekunden kurzen Videos liegen im Image; zusammen ungefähr 5 MB. H.264-MP4 mit Faststart unterstützt Streaming und Byte-Range-Anfragen. Der Browser spielt die stummen Clips automatisch in Schleife; native Bedienelemente bleiben verfügbar. Eine Antwort zählt einen Treffer, ohne Tempo-/Serienboni.

Beim ersten Start dieser Version tauscht `server/media-pack.js` die alte Bibliothek in einer SQLite-Transaktion gegen die zehn Medienrunden. Die alten Fragen werden vollständig unter `quiz_meta.bank_archive_before_simple_20261030` archiviert; vorhandene Raum-Snapshots und Uploads bleiben erhalten. Der Marker `simple_media_pack_20261030` verhindert, dass spätere Neustarts eigene Änderungen oder eine absichtlich geleerte Bibliothek zurücksetzen. Vor der Live-Umstellung wird zusätzlich ein konsistentes SQLite-Backup im Anwendungsverzeichnis unter `backups/` angelegt.

Neue Gruppen immer unter **/host** erstellen. Alte Raumlinks führen nach dem Update zur neuen Moderation. Die neuen Medien lassen sich unter **/admin** verwalten. Werkstatt, Lernpaketimport, Quellenkarten und Publikations-APIs sind im normalen Betrieb deaktiviert. `/materials` und `/stand.html` leiten zur Moderation weiter. Alte Datenformate werden intern nur zur Kompatibilität erhalten.

## Prüfung und Abschalten

```sh
npm run verify
npm run test:e2e
```

Danach öffentlich Healthcheck, Anmeldung, QR, Bilder, alle vier MP4s und eine vollständige Runde mit WebSockets prüfen. Der Browser-Test prüft echte Video-Decodierung und dass Stimmabgaben anderer Personen laufende Clips nicht neu starten.

Nach dem Anlass nur diese Anwendung in Coolify stoppen; Datenvolume und Projekt erhalten. Es ist kein automatisches Abschaltdatum gesetzt.
