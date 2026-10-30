import { parseArgs } from 'node:util';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { renderDocument,DOCUMENTS } from '../documents/render.js';
import { sha256 } from '../server/publications.js';
const {values}=parseArgs({options:{snapshot:{type:'string'},out:{type:'string',default:'docs/materials'},only:{type:'string'}}});
if(!values.snapshot)throw new Error('Ein ausdrücklich aus SQLite exportierter Snapshot ist erforderlich: --snapshot DATEI.json');
const snapshot=JSON.parse(readFileSync(values.snapshot,'utf8'));
if(snapshot.schemaVersion!==3||!snapshot.id||!snapshot.cases?.length||snapshot.cases.some(q=>(q.type!=='text'&&!q.image)||(q.type==='text'&&!q.text)||(q.image&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(q.image))))throw new Error('Ungültiger Publikationssnapshot oder fehlendes Pflichtmedium.');
const out=path.resolve(values.out);mkdirSync(out,{recursive:true});
const assetDir=path.join(out,'assets');mkdirSync(assetDir,{recursive:true});
writeFileSync(path.join(assetDir,'fonts-license.txt'),readFileSync(new URL('../public/fonts/LICENSE.txt',import.meta.url)));
const browser=await chromium.launch({channel:process.env.PW_CHANNEL||undefined});
const manifest={schemaVersion:1,snapshot:snapshot.id,contentVersion:snapshot.contentVersion,contentSource:snapshot.contentSource,createdAt:new Date().toISOString(),author:'Benjamin Hanimann',language:'de-CH',renderer:`Chromium ${browser.version()}`,rendererSource:sha256(readFileSync(new URL('../documents/render.js',import.meta.url))),cases:snapshot.cases.map(q=>({id:q.id,revision:q.revision})),files:[]};
try{
  for(const [kind,config] of Object.entries(DOCUMENTS)){
    if(values.only&&values.only!==kind)continue;
    const workshop=snapshot.mode==='workshop-v1';
    if(!values.only && (workshop ? !['moderationsguide','loesungen','quellenregister','werkstattheft','stationskarten','gruppenreflexion','kreativauftrag'].includes(kind) : ['werkstattheft','stationskarten','gruppenreflexion','kreativauftrag'].includes(kind)))continue;
    const dir=path.join(out,config.audience==='participant'?'teilnehmende':'moderation');mkdirSync(dir,{recursive:true});
    const html=await renderDocument(snapshot,kind);
    const dimensions=config.format==='A3'?[297,420,16]:config.format==='A6'?[105,148,9]:[210,297,16];
    const page=await browser.newPage({viewport:{width:Math.round((dimensions[0]-2*dimensions[2])*96/25.4),height:Math.round(dimensions[1]*96/25.4)},reducedMotion:'reduce'});
    await page.route('**/*',route=>route.abort());
    await page.emulateMedia({media:'print'});await page.setContent(html,{waitUntil:'load'});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(img=>img.decode()));if(document.body.dataset.publicationReady!=='true')throw new Error('Publikation nicht bereit.');});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    if(overflow)throw new Error(`${kind}: Inhalt läuft horizontal über.`);
    const pdf=path.join(dir,`${kind}.pdf`);
    await page.pdf({path:pdf,format:config.format,preferCSSPageSize:true,printBackground:true,tagged:true,displayHeaderFooter:false});
    const accessible=html.replace(/data:(font\/ttf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/g,(_match,type,b64)=>{const data=Buffer.from(b64,'base64'),ext=type==='font/ttf'?'ttf':type.split('/')[1]==='jpeg'?'jpg':type.split('/')[1];const name=`${sha256(data).slice(0,20)}.${ext}`;const file=path.join(assetDir,name);if(!existsSync(file))writeFileSync(file,data);return `../assets/${name}`;});
    writeFileSync(path.join(dir,`${kind}.html`),accessible);
    manifest.files.push({kind,audience:config.audience,format:config.format,path:path.relative(out,pdf).replaceAll('\\','/'),sha256:null});
    await page.close();console.log(`${kind} → ${pdf}`);
  }
  const privateDir=path.join(out,'moderation');mkdirSync(privateDir,{recursive:true});writeFileSync(path.join(privateDir,'publication.json'),JSON.stringify(snapshot,null,2)+'\n');
}finally{await browser.close();}
writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const python=process.env.PDF_PYTHON||'python';
const qa=spawnSync(python,['scripts/pdf-tools.py','--dir',out,'--stamp'],{stdio:'inherit'});
if(qa.status!==0)throw new Error('PDF-Prüfung fehlgeschlagen. Siehe Bericht.');
