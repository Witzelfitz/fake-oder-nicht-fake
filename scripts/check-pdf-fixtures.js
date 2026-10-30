import { createQuizServer } from '../server/app.js';
import { applyImport } from '../server/imports.js';
import { questionBank } from '../server/questions.js';
import { loadDeck } from '../server/content.js';
import { createPublication } from '../server/publications.js';
import { mkdirSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const server=createQuizServer({dbPath:':memory:'});
try{
  applyImport(server.db);const bank=questionBank(server.db,loadDeck());
  const ids=bank.learningDeck().questions.slice(0,9).map(q=>q.id);
  const snapshot=createPublication(server.db,bank,null,{caseIds:ids});
  snapshot.id='qa-langtext-neun';snapshot.contentSource='explicit-qa-fixture';
  const q=snapshot.cases[0];q.title=('Eine lange Titelzeile für die dokumentierte Layoutprüfung mit neun Fällen ').repeat(3).slice(0,160);
  q.type='text';q.image=null;q.text=('Dieser synthetische Text dient ausschliesslich der Layoutprüfung. Er enthält keine geprüfte Behauptung über reale Ereignisse. ').repeat(15);
  q.simulation=true;q.credit='QA-Fixture · synthetischer Übungstext';q.license='Projekteigene Layoutprüfung';q.explanation=('Diese ausführliche Auflösung prüft automatische Seitenumbrüche bei unveränderter Schriftgrösse. ').repeat(35);
  q.privateNotes='PRIVATE_QA_NOTIZ_NICHT_IN_TEILNEHMERDATEIEN';
  q.sources[0].title=('Ausführlich beschriftete Quellenkarte für den automatisierten Test der Satzbreite ').repeat(3);
  const folder=path.resolve('output/qa-pdf-fixtures');mkdirSync(folder,{recursive:true});const file=path.join(folder,'snapshot.json');writeFileSync(file,JSON.stringify(snapshot));
  const run=spawnSync(process.execPath,['scripts/build-pdfs.js','--snapshot',file,'--out',folder,'--only','loesungen'],{stdio:'inherit'});if(run.status!==0)throw new Error('Langtextprüfung fehlgeschlagen.');
  const broken=structuredClone(snapshot);broken.cases[0].type='photo';delete broken.cases[0].image;const bad=path.join(folder,'missing-image.json');writeFileSync(bad,JSON.stringify(broken));
  const blocked=spawnSync(process.execPath,['scripts/build-pdfs.js','--snapshot',bad,'--out',path.join(folder,'blocked')],{encoding:'utf8'});if(blocked.status===0||!blocked.stderr.includes('fehlendes Pflichtmedium'))throw new Error('Fehlendes Bild wurde nicht geblockt.');
  console.log('Neun Fälle und lange Titel/Auflösung geprüft; fehlendes Pflichtmedium blockiert. QA-Fixtures nicht als Unterrichtsmaterial verteilen.');
}finally{await server.close();}
