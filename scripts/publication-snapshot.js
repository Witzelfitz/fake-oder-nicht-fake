import { parseArgs } from 'node:util';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../server/database.js';
import { questionBank } from '../server/questions.js';
import { loadDeck } from '../server/content.js';
import { createPublication } from '../server/publications.js';
const {values}=parseArgs({options:{set:{type:'string',default:'stand-6'},mode:{type:'string',default:'learning-v1'},room:{type:'string'},out:{type:'string',default:'output/publication.json'}}});
const file=process.env.DB_PATH||'./data/quiz.sqlite',db=openDatabase(file);
try{
  const bank=questionBank(db,loadDeck());
  const snapshot=createPublication(db,bank,path.join(path.dirname(path.resolve(file)),'uploads'),{setId:values.set,room:values.room,mode:values.mode});
  mkdirSync(path.dirname(path.resolve(values.out)),{recursive:true});writeFileSync(values.out,JSON.stringify(snapshot,null,2)+'\n');
  console.log(`${snapshot.id} · ${snapshot.cases.length} Fälle · ${snapshot.contentSource} → ${values.out}`);
}finally{db.close();}
