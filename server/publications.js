import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveAsset } from './content.js';
import { validateCase, AXES } from './cases.js';
import { curatedPack } from './imports.js';
import { readSettings } from './settings.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const loopback = url => ['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(url.hostname) || /^127\./.test(url.hostname);
export function createPublication(db, bank, uploadRoot, input = {}) {
  const settings = readSettings(db);
  let room = null, deck;
  if (input.room) {
    room = db.prepare('SELECT * FROM rooms WHERE id=?').get(String(input.room));
    if (!room) throw new Error('Raum nicht gefunden.');
    if (!['learning-v1','workshop-v1'].includes(room.mode)) throw new Error('Für diesen Export bitte einen freigegebenen Lernfall-Snapshot wählen.');
    deck = JSON.parse(room.deck_json);
  } else {
    const set = curatedPack().sets.find(s=>s.id===(input.setId || settings.defaultSet));
    if(!set && input.setId && input.setId!=='custom')throw new Error('Unbekanntes Fallset.');
    deck = bank.learningDeck(input.caseIds ?? set?.caseIds ?? null);
  }
  if (!deck.questions.length) throw new Error('Keine freigegebenen Fälle ausgewählt.');
  const join = { kind: 'generic', url: null, roomCode: null };
  if (input.joinKind === 'room') {
    if (!room || room.phase !== 'lobby') throw new Error('Ein Sitzungsplakat braucht einen bestehenden Raum mit offenem Beitritt.');
    const url = new URL(`${room.join_base}/?code=${room.id}`);
    if (loopback(url)) throw new Error('Loopback-Adresse ist kein Beitrittsziel für andere Geräte.');
    if (input.targetChecked !== true) throw new Error('Beitrittsadresse zuerst mit einem zweiten Gerät prüfen und ausdrücklich bestätigen.');
    Object.assign(join,{kind:'room',url:url.href,roomCode:room.id});
  } else if (input.joinKind === 'stable') {
    if (!settings.stableJoinUrl || input.targetChecked !== true) throw new Error('Eine eingerichtete stabile HTTPS-Startadresse konfigurieren und ihren Zugriff bestätigen.');
    if(loopback(new URL(settings.stableJoinUrl)))throw new Error('Loopback-Adresse ist keine stabile Startadresse für andere Geräte.');
    Object.assign(join,{kind:'stable',url:settings.stableJoinUrl});
  }
  let bytesTotal = 0;
  const cases = deck.questions.map(q=>{
    validateCase(q,true);
    const out = {
      id:q.id, revision:q.revision||1, type:q.type, title:q.title, axis:q.axis,
      prompt:q.prompt, options:AXES[q.axis], text:q.type==='text'?q.text:null,
      alt:q.alt||'Fallmaterial zur gemeinsamen Prüfung', caption:q.caption||'',simulation:q.simulation===true,
      answer:q.answer, explanation:q.explanation, takeaway:q.takeaway,limitation:q.limitation,transfer:q.transfer,
      privateNotes:q.privateNotes||'', credit:q.credit,license:q.license,source:q.source,sources:q.sources,
      review:q.review
    };
    if(q.type!=='text'){
      const data=readFileSync(resolveAsset(q.asset,uploadRoot));bytesTotal+=data.length;
      if(bytesTotal>40*1024*1024)throw new Error('Bilddaten über 40 MB. Bitte kleinere Auswahl oder kleinere Originale verwenden.');
      const ext=q.asset.split('.').at(-1).toLowerCase();
      out.image=`data:image/${ext==='jpg'?'jpeg':ext};base64,${data.toString('base64')}`;out.assetHash=sha256(data);
    }
    return out;
  });
  const snapshot={schemaVersion:3,createdAt:new Date().toISOString(),language:'de-CH',author:'Benjamin Hanimann',
    title:'Fake oder nicht fake? · Der zweite Blick',mode:room?.mode || input.mode || 'learning-v1',
    contentSource:room?'room-snapshot':'sqlite-library',room:room?.id||null,
    setId:room?.set_id||input.setId||settings.defaultSet,contentVersion:deck.id,
    audience:input.audience||room?.audience||settings.audience,event:room?(deck.event||settings.event):settings.event,
    resourcesUrl:room?(deck.resourcesUrl??settings.resourcesUrl):settings.resourcesUrl,join,cases};
  snapshot.id=sha256(JSON.stringify(snapshot)).slice(0,20);
  db.prepare('INSERT INTO publication_snapshots (id,content_json,created_at) VALUES (?,?,?)').run(snapshot.id,JSON.stringify(snapshot),Date.now());
  return snapshot;
}

export function participantPublication(snapshot) {
  return {
    id:snapshot.id,createdAt:snapshot.createdAt,language:snapshot.language,author:snapshot.author,title:snapshot.title,
    mode:snapshot.mode,contentSource:snapshot.contentSource,contentVersion:snapshot.contentVersion,
    setId:snapshot.setId,audience:snapshot.audience,event:snapshot.event,resourcesUrl:snapshot.resourcesUrl,join:snapshot.join,
    cases:snapshot.cases.map(q=>({id:q.id,revision:q.revision,type:q.type,title:q.title,axis:q.axis,prompt:q.prompt,
      options:q.options,text:q.text,image:q.image,alt:q.alt,caption:q.caption,simulation:q.simulation,
      // Attribution is required for the visible material; no verdict, sources dossier or private notes.
      credit:q.credit,license:q.license,source:q.source}))
  };
}
