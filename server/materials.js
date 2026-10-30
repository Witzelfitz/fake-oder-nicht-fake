import { randomBytes } from 'node:crypto';
import { createPublication } from './publications.js';
import { renderDocument, DOCUMENTS } from '../documents/render.js';

export function installMaterials(app,{db,bank,uploadRoot,authenticate}){
  const tickets=new Map();
  app.get('/merkkarte.html',async(_req,res)=>{
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; frame-ancestors 'none'; base-uri 'none'");
    res.type('html').send(await renderDocument({id:'pruefschritte-v1',createdAt:'2026-10-30',language:'de-CH',author:'Benjamin Hanimann',title:'Der zweite Blick',mode:'learning-v1',contentSource:'method-reference',contentVersion:'1',setId:'method-reference',audience:'all',event:{},resourcesUrl:'',join:{kind:'generic',url:null},cases:[]},'merkkarte-a6'));
  });
  app.get('/api/admin/publications',authenticate,(_req,res)=>res.json(db.prepare('SELECT id,created_at FROM publication_snapshots ORDER BY created_at DESC LIMIT 30').all()));
  app.post('/api/admin/publications',authenticate,(req,res)=>{
    try{const snapshot=createPublication(db,bank,uploadRoot,req.body||{});res.status(201).json({id:snapshot.id,contentVersion:snapshot.contentVersion,caseCount:snapshot.cases.length,documents:DOCUMENTS});}
    catch(error){res.status(400).json({error:error.message});}
  });
  app.get('/api/admin/publications/:id',authenticate,(req,res)=>{
    const row=db.prepare('SELECT content_json FROM publication_snapshots WHERE id=?').get(req.params.id);
    if(!row)return res.status(404).json({error:'Snapshot nicht gefunden.'});
    res.type('json').send(row.content_json);
  });
  app.post('/api/admin/publications/:id/print',authenticate,(req,res)=>{
    const row=db.prepare('SELECT content_json FROM publication_snapshots WHERE id=?').get(req.params.id);
    if(!row||!DOCUMENTS[req.body?.kind])return res.status(400).json({error:'Snapshot oder Dokument nicht gefunden.'});
    for(const [key,value] of tickets)if(value.until<Date.now())tickets.delete(key);
    const ticket=randomBytes(24).toString('hex');tickets.set(ticket,{snapshot:JSON.parse(row.content_json),kind:req.body.kind,until:Date.now()+300000});
    res.json({url:`/print/${ticket}`});
  });
  app.get('/print/:ticket',async(req,res)=>{
    const ticket=tickets.get(req.params.ticket);if(!ticket||ticket.until<Date.now())return res.status(410).send('Druckansicht abgelaufen. Bitte erneut über Unterlagen öffnen.');
    tickets.delete(req.params.ticket);
    res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.type('html').send(await renderDocument(ticket.snapshot,ticket.kind));
  });
}
