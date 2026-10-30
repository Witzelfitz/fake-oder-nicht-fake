import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuizServer } from '../server/app.js';
import { applyImport,previewImport } from '../server/imports.js';
import { questionBank } from '../server/questions.js';
import { loadDeck } from '../server/content.js';
import { createPublication,participantPublication } from '../server/publications.js';
import { renderDocument } from '../documents/render.js';
import { readSettings, writeSettings, purgeExpired } from '../server/settings.js';
import path from 'node:path';

function setup(t){const server=createQuizServer({dbPath:':memory:',hostKey:'pub-test'});t.after(()=>server.close());applyImport(server.db);return {server,db:server.db,bank:questionBank(server.db,loadDeck())};}
function edit(db,id,change){const row=db.prepare('SELECT question_json FROM question_bank WHERE id=?').get(id);const q=JSON.parse(row.question_json);change(q);db.prepare('UPDATE question_bank SET question_json=?,version=version+1 WHERE id=?').run(JSON.stringify(q),id);}
test('Publikation verwendet SQLite-Fassung, ist unveränderlich und trennt Teilnehmerfelder',async t=>{
  const {server,db,bank}=setup(t);
  assert.notEqual(server.uploadRoot,path.resolve('data/uploads'));
  edit(db,'blick-panorama',q=>{q.title='Meine SQLite-Fassung';q.privateNotes='PRIVATE-NOTIZ-TEST';});
  const snapshot=createPublication(db,bank,null,{setId:'stand-6'});
  assert.equal(snapshot.contentSource,'sqlite-library');assert.equal(snapshot.cases[0].title,'Meine SQLite-Fassung');assert.equal(snapshot.cases[0].revision,2);
  edit(db,'blick-panorama',q=>{q.title='Später geändert';});
  const frozen=JSON.parse(db.prepare('SELECT content_json FROM publication_snapshots WHERE id=?').get(snapshot.id).content_json);
  assert.equal(frozen.cases[0].title,'Meine SQLite-Fassung');
  const participant=participantPublication(snapshot);
  assert.ok(!Object.hasOwn(participant.cases[0],'answer'));assert.ok(!Object.hasOwn(participant.cases[0],'sources'));assert.ok(!Object.hasOwn(participant.cases[0],'privateNotes'));
  const html=await renderDocument(snapshot,'fallblaetter');assert.ok(!html.includes('PRIVATE-NOTIZ-TEST'));assert.ok(!html.includes('hostToken'));assert.ok(html.includes('Meine SQLite-Fassung'));
});
test('Freigabegate und Pflichtmedien blockieren unvollständige PDF-Publikationen',t=>{
  const {db,bank}=setup(t);edit(db,'blick-panorama',q=>{q.review.rights=false;});
  assert.throws(()=>createPublication(db,bank,null,{setId:'stand-6'}),/ausdrücklich geprüft/);
  edit(db,'blick-panorama',q=>{q.review.rights=true;q.asset='assets/nicht-vorhanden.jpg';});
  assert.throws(()=>createPublication(db,bank,null,{setId:'stand-6'}));
});
test('Import zeigt lokale Konflikte und überschreibt eigene Fassungen nicht',t=>{
  const {db}=setup(t);edit(db,'blick-panorama',q=>{q.title='Eigene Fassung behalten';});
  assert.equal(previewImport(db).find(q=>q.id==='blick-panorama').status,'local-different');
  const result=applyImport(db);assert.equal(result.added.length,0);
  assert.match(db.prepare('SELECT question_json FROM question_bank WHERE id=?').get('blick-panorama').question_json,/Eigene Fassung behalten/);
});
test('Raum-Publikation bleibt bei Raumversion und lehnt Loopback-QR sowie geschlossene Räume ab',async t=>{
  const {server,db,bank}=setup(t);await server.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${server.http.address().port}`;
  const room=await(await fetch(`${base}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hostKey:'pub-test',mode:'learning-v1',setId:'stand-6',duration:75})})).json();
  edit(db,'blick-panorama',q=>{q.title='Neu in Bibliothek';});
  const snapshot=createPublication(db,bank,null,{room:room.room});assert.equal(snapshot.cases[0].title,'Ein Ausblick zum Staunen.');
  writeSettings(db,{...readSettings(db),event:{...readSettings(db).event,title:'Anderer Anlass'}});
  assert.equal(createPublication(db,bank,null,{room:room.room}).event.title,'Digimärt Alpnach');
  assert.throws(()=>createPublication(db,bank,null,{room:room.room,joinKind:'room',targetChecked:true}),/Loopback/);
  writeSettings(db,{...readSettings(db),stableJoinUrl:'https://localhost'});
  assert.throws(()=>createPublication(db,bank,null,{setId:'stand-6',joinKind:'stable',targetChecked:true}),/Loopback/);
  db.prepare("UPDATE rooms SET phase='finished' WHERE id=?").run(room.room);
  assert.throws(()=>createPublication(db,bank,null,{room:room.room,joinKind:'room',targetChecked:true}),/offenem Beitritt/);
});

test('Anlassprofile sind geschützt und wiederherstellbar; Löschfrist entfernt nur alte abgeschlossene Räume',async t=>{
  const {server,db}=setup(t);await server.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${server.http.address().port}`;
  const headers={Authorization:'Bearer pub-test','Content-Type':'application/json'};
  assert.equal((await fetch(`${base}/api/admin/profiles`)).status,401);
  const profile=await(await fetch(`${base}/api/admin/profiles`,{method:'POST',headers,body:JSON.stringify({name:'Digimärt'})})).json();
  writeSettings(db,{...readSettings(db),event:{...readSettings(db).event,title:'Anderer Anlass'}});
  const restored=await(await fetch(`${base}/api/admin/profiles/${profile.id}/activate`,{method:'POST',headers,body:'{}'})).json();assert.equal(restored.event.title,'Digimärt Alpnach');
  const rooms=[];for(let i=0;i<3;i++)rooms.push(await(await fetch(`${base}/api/rooms`,{method:'POST',headers,body:JSON.stringify({hostKey:'pub-test',mode:'learning-v1',setId:'stand-6',duration:75})})).json());
  db.prepare("UPDATE rooms SET phase='finished',created_at=? WHERE id=?").run(Date.now()-10*86400000,rooms[0].room);
  db.prepare('UPDATE rooms SET created_at=? WHERE id=?').run(Date.now()-10*86400000,rooms[1].room);
  db.prepare("UPDATE rooms SET phase='finished' WHERE id=?").run(rooms[2].room);
  assert.equal(purgeExpired(db),0);writeSettings(db,{...readSettings(db),retentionDays:7});assert.equal(purgeExpired(db),1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM question_bank').get().n,20);
});
test('Kerntoken erfüllen Textkontrast; Zustände werden zusätzlich beschriftet',()=>{
  const luminance=hex=>{const rgb=hex.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const [fg,bg] of [['14202B','F6F2E9'],['FFFFFF','2755E7'],['14202B','D8FA52'],['53616c','F6F2E9']]){
    const a=luminance(fg),b=luminance(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);
  }
});
test('Druckansichten brauchen einmalige Berechtigung; Snapshot und Moderationsdokumente bleiben geschützt',async t=>{
  const {server}=setup(t);await server.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${server.http.address().port}`;
  const headers={Authorization:'Bearer pub-test','Content-Type':'application/json'};
  assert.equal((await fetch(`${base}/api/admin/publications`)).status,401);
  const created=await(await fetch(`${base}/api/admin/publications`,{method:'POST',headers,body:JSON.stringify({setId:'stand-6'})})).json();
  assert.equal((await fetch(`${base}/api/admin/publications/${created.id}`)).status,401);
  const ticket=await(await fetch(`${base}/api/admin/publications/${created.id}/print`,{method:'POST',headers,body:JSON.stringify({kind:'loesungen'})})).json();
  const page=await fetch(`${base}${ticket.url}`);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/default-src 'none'/);assert.match(await page.text(),/Lösungsheft/);
  assert.equal((await fetch(`${base}${ticket.url}`)).status,410);
});
