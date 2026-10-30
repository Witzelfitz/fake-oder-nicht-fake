import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { once } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicCase } from '../server/cases.js';
import { createQuizServer } from '../server/app.js';
import { applyImport } from '../server/imports.js';

const send = (s,event,payload) => new Promise((resolve,reject) => s.timeout(3000).emit(event,payload,(err,data) => err ? reject(err) : resolve(data)));
async function setup(t, mode = 'learning-v1',setId='stand-6') {
  const server = createQuizServer({ dbPath: ':memory:', hostKey: 'learning-test' });
  applyImport(server.db); await server.listen(0,'127.0.0.1');
  const base = `http://127.0.0.1:${server.http.address().port}`, sockets=[];
  t.after(async()=>{ for(const s of sockets)s.disconnect(); await server.close(); });
  const room = await (await fetch(`${base}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hostKey:'learning-test',mode,setId,duration:25})})).json();
  async function connect(){const s=io(base,{transports:['websocket'],reconnection:false});sockets.push(s);await once(s,'connect');return s;}
  const host=await connect(); await send(host,'watch',{room:room.room,hostToken:room.hostToken});
  const p=await connect(); const joined=await send(p,'join',{room:room.room,nickname:'Fuchs'});
  const viewer=await connect();
  const view=async()=> (await send(viewer,'watch',{room:room.room})).state;
  const command=async(action,more={})=>{const state=await view();return send(host,'host:action',{action,commandId:randomUUID(),expectedRevision:state.revision,expectedPhase:state.phase,expectedIndex:state.index,...more});};
  return {server,base,room,host,p,viewer,view,command,joined,connect};
}

test('Netzwerkfehler verhindert weder Konfiguration noch Serverstart',async t=>{
  const server=createQuizServer({dbPath:':memory:',networkReader:()=>{throw new Error('uv_interface_addresses');}});
  await server.listen(0,'127.0.0.1'); t.after(()=>server.close());
  const response=await fetch(`http://127.0.0.1:${server.http.address().port}/api/config`);
  assert.equal(response.status,200); const config=await response.json(); assert.ok(config.suggestedUrls.length>=1);
});

test('Alle zwölf Lernfälle sind spielbar; übersprungene Fälle werden im Abschluss nicht als bearbeitet gezählt',async t=>{
  const f=await setup(t,'learning-v1','bibliothek-12');await f.command('start');const seen=new Set();
  for(let i=0;i<12;i++){
    const s=await f.view();assert.equal(s.total,12);seen.add(s.question.id);assert.equal(s.question.options.length,3);assert.equal(s.reveal,null);assert.deepEqual(s.evidence,[]);
    assert.equal((await send(f.p,'answer',{questionId:s.question.id,promptId:'main',stage:'first',choice:s.question.options.at(-1).id})).ok,true);
    await f.command('reveal');const revealed=await f.view();assert.ok(revealed.reveal.explanation);assert.ok(revealed.reveal.sources.length);assert.ok(revealed.reveal.transfer);
    await f.command(i===0?'skip':'next');
  }
  const restored=await send(f.p,'join',{room:f.room.room,playerId:f.joined.playerId,playerToken:f.joined.playerToken});
  assert.equal(seen.size,12);assert.equal(restored.state.phase,'finished');assert.equal(restored.state.reflection.completed,11);assert.equal(restored.state.reflection.cases[0].skipped,true);
});
test('P0: drei Optionen, keine Lösung oder privaten Notizen vor Auflösung, keine Lernpunkte',async t=>{
  const f=await setup(t); assert.equal((await f.command('start')).ok,true);
  let state=await f.view(); assert.equal(state.phase,'first_vote'); assert.equal(state.total,6);
  assert.equal(state.question.options.length,3); assert.equal(state.reveal,null); assert.equal(state.hostNotes,null); assert.deepEqual(state.evidence,[]);
  assert.ok(!JSON.stringify(state).includes('privateNotes')); assert.ok(!Object.hasOwn(state.question,'answer'));
  assert.equal((await send(f.p,'answer',{questionId:state.question.id,promptId:'main',stage:'first',choice:'insufficient',confidence:1,points:999999})).ok,true);
  assert.equal((await send(f.p,'answer',{questionId:state.question.id,promptId:'main',stage:'first',choice:'ai'})).ok,false);
  assert.equal((await f.command('reveal')).ok,true); state=await f.view();
  assert.equal(state.reveal.answer,'human'); assert.ok(state.evidence.length); assert.deepEqual(state.leaderboard,[]);
  assert.equal(f.server.db.prepare('SELECT COUNT(*) AS n FROM answers').get().n,0);
  assert.equal(f.server.db.prepare('SELECT confidence FROM responses_v3').get().confidence,1);
});
test('Command-IDs sind idempotent; falsche Revisionen und fehlende Rechte werden abgelehnt',async t=>{
  const f=await setup(t); const state=await f.view();
  const command={action:'start',commandId:randomUUID(),expectedRevision:state.revision,expectedPhase:'lobby',expectedIndex:-1};
  assert.equal((await send(f.viewer,'host:action',command)).ok,false);
  const first=await send(f.host,'host:action',command); assert.equal(first.ok,true);
  assert.deepEqual(await send(f.host,'host:action',command),first);
  assert.equal((await f.view()).revision,1);
  assert.equal((await send(f.host,'host:action',{...command,action:'skip'})).ok,false);
  assert.equal((await f.command('reveal',{expectedRevision:0})).ok,false);
});
test('Zeitablauf schliesst nur Eingaben und überspringt im Lernmodus keine Quellenarbeit',async t=>{
  const f=await setup(t); await f.command('start');
  f.server.db.prepare('UPDATE rooms SET deadline=? WHERE id=?').run(Date.now()-1,f.room.room);
  const state=await f.view(); assert.equal(state.phase,'first_vote'); assert.equal(state.votingClosed,true);
  assert.equal((await send(f.p,'answer',{questionId:state.question.id,promptId:'main',stage:'first',choice:'human'})).ok,false);
  assert.equal((await f.command('reveal')).ok,true);
});
test('P1: Ersturteil, Quellenphase und Zweiturteil sind getrennt; Reconnect erhält den Stand',async t=>{
  const f=await setup(t,'workshop-v1'); await f.command('start'); let state=await f.view();
  const payload={questionId:state.question.id,promptId:'main',choice:'insufficient',stage:'first'};
  await send(f.p,'answer',payload); await f.command('evidence'); state=await f.view();
  assert.equal(state.phase,'evidence'); assert.ok(state.evidence.length); assert.equal(state.reveal,null);
  assert.ok(!JSON.stringify(state).includes('privateNotes'));
  const fresh=await f.connect(); const restored=await send(fresh,'join',{room:f.room.room,playerId:f.joined.playerId,playerToken:f.joined.playerToken});
  assert.equal(restored.state.me.firstAnswer.choice,'insufficient');
  await f.command('final_vote'); await send(fresh,'answer',{...payload,stage:'final',choice:'human',confidence:3});
  assert.equal(f.server.db.prepare('SELECT COUNT(*) AS n FROM responses_v3').get().n,2);
  await f.command('reveal'); const result=await send(fresh,'join',{room:f.room.room,playerId:f.joined.playerId,playerToken:f.joined.playerToken});
  assert.equal(result.state.me.answer.choice,'human'); assert.equal(result.state.me.firstAnswer.choice,'insufficient');
});
test('P1: Serverneustart erhält Quellenphase, Antworten, Raumrevision und Command-Ergebnis',async t=>{
  const folder=mkdtempSync(path.join(tmpdir(),'blick-restart-')),dbPath=path.join(folder,'quiz.sqlite');let server,sockets=[];
  async function start(){server=createQuizServer({dbPath,hostKey:'restart'});await server.listen(0,'127.0.0.1');return `http://127.0.0.1:${server.http.address().port}`;}
  async function connect(base){const s=io(base,{transports:['websocket'],reconnection:false});sockets.push(s);await once(s,'connect');return s;}
  t.after(async()=>{for(const s of sockets)s.disconnect();await server?.close();if(path.dirname(folder)===path.resolve(tmpdir())&&path.basename(folder).startsWith('blick-restart-'))rmSync(folder,{recursive:true,force:true});});
  let base=await start();applyImport(server.db);
  const room=await(await fetch(`${base}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hostKey:'restart',mode:'workshop-v1',setId:'werkstatt-4',duration:75})})).json();
  let host=await connect(base);await send(host,'watch',{room:room.room,hostToken:room.hostToken});
  let player=await connect(base);const joined=await send(player,'join',{room:room.room,nickname:'TeamFuchs'});
  const command={action:'start',commandId:randomUUID(),expectedRevision:0,expectedPhase:'lobby',expectedIndex:-1};await send(host,'host:action',command);
  let watched=await send(host,'watch',{room:room.room,hostToken:room.hostToken});
  await send(player,'answer',{questionId:watched.state.question.id,promptId:'main',stage:'first',choice:'open'});
  const evidenceCommand={action:'evidence',commandId:randomUUID(),expectedRevision:1,expectedPhase:'first_vote',expectedIndex:0};await send(host,'host:action',evidenceCommand);
  for(const s of sockets)s.disconnect();await server.close();server=null;sockets=[];
  base=await start();host=await connect(base);watched=await send(host,'watch',{room:room.room,hostToken:room.hostToken});assert.equal(watched.state.phase,'evidence');assert.equal(watched.state.revision,2);
  assert.equal((await send(host,'host:action',evidenceCommand)).ok,true);assert.equal(server.db.prepare('SELECT revision FROM rooms').get().revision,2);
  player=await connect(base);const restored=await send(player,'join',{room:room.room,playerId:joined.playerId,playerToken:joined.playerToken});assert.equal(restored.state.me.firstAnswer.choice,'open');
  await send(host,'host:action',{action:'final_vote',commandId:randomUUID(),expectedRevision:2,expectedPhase:'evidence',expectedIndex:0});
  assert.equal((await send(player,'answer',{questionId:watched.state.question.id,promptId:'main',stage:'final',choice:'refuted'})).ok,true);
  assert.equal(server.db.prepare('SELECT COUNT(*) AS n FROM responses_v3').get().n,2);
});
