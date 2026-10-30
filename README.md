# Fake oder nicht fake?

Ein einfaches Gruppenquiz für etwa zehn Minuten: **sechs Bilder, vier kurze Videos, zwei Antworten – Echt oder KI?** Fünf Beispiele sind echte Aufnahmen, fünf stammen aus generativer KI.

Nach jeder Auflösung kurz miteinander reden: Was hat euch überzeugt, was hat euch getäuscht? Keine Textaufgaben, Quellenkarten, Recherchephasen, Zielgruppenwahl oder Druckunterlagen. Ein richtiger Tipp zählt einen Treffer; es gibt keine Tempo- oder Serienboni.

## Spielen

1. [Moderation öffnen](https://ki.mmacodeclub.ch/host), Moderationsschlüssel eingeben und Spielraum erstellen.
2. Beamer öffnen. Mit dem Handy den QR scannen und einen Spitznamen eingeben.
3. Quiz starten. Pro Runde bleiben 25 Sekunden zum Tippen. Die Moderation kann vorher auflösen.
4. Auflösen, kurz reden, nächste Runde. Am Schluss stehen die Treffer der Gruppe.

Der Moderationsschlüssel bleibt derselbe wie beim ersten Deployment und liegt im privaten Telegram-Chat von @pawicobot. Unter [/admin](https://ki.mmacodeclub.ch/admin) lassen sich Bilder und MP4-Clips hinzufügen, ordnen, deaktivieren und entfernen. Weitere Pflichtfelder sind nur ein interner Name und die richtige Antwort.

## Medien

Echte Fotos von Unsplash, echte Videos von Pexels. KI-Bilder und -Clips aus den vom Projektinhaber bereitgestellten Gemini- und ChatGPT-Downloads. Alle zehn Medien zusammen sind ungefähr 5 MB gross und werden lokal ausgeliefert. Die Clips sind stumm, sieben bis acht Sekunden kurz und laufen automatisch in einer Schleife; native Bedienelemente erlauben Pausieren und erneutes Abspielen.

Mediennachweise: [ASSETS.md](ASSETS.md). Prüfsummen und Herkunftsprotokoll: [content/provenance.json](content/provenance.json). Die Angaben erscheinen nicht als Aufgaben oder Belege im Spiel.

## Lokal starten

Node.js 24 LTS (mindestens 24.14), dann:

```sh
npm ci
npm start
```

`http://localhost:3000/host` öffnen. Ohne `HOST_KEY` wird ein zufälliger Moderationsschlüssel ausgegeben. Optionale Einstellungen stehen in [.env.example](.env.example).

## Betrieb und Tests

Ein Node-Prozess mit Express, Socket.IO und SQLite. Keine zusätzliche Datenbank, keine externen Laufzeit-CDNs, keine KI-API-Kosten. Die Live-Instanz ist auf 256 MiB RAM und 0.5 CPU begrenzt; SQLite und Uploads liegen dauerhaft unter `/app/data`.

```sh
npm run verify
npm run test:e2e
```

Die Browserprüfung spielt alle zehn Runden mit Moderation, Beamer und zwei Handy-Kontexten und prüft echte Videowiedergabe, Wiederverbinden und Medienverwaltung. Frühere SQLite-Daten und Formate bleiben intern lesbar; Werkstatt- und Publikationsfunktionen sind im normalen Serverbetrieb deaktiviert.

[Coolify-Betrieb](docs/COOLIFY.md). Software: [MIT](LICENSE). Fremde Medien behalten ihre eigenen Lizenzen.
