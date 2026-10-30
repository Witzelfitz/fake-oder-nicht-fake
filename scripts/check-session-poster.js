import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { createQuizServer } from '../server/app.js';
import { applyImport } from '../server/imports.js';
import { questionBank } from '../server/questions.js';
import { loadDeck } from '../server/content.js';
import { createPublication } from '../server/publications.js';
import { localAddresses } from '../server/network.js';
const server=createQuizServer({dbPath:':memory:',hostKey:'qr-check'});applyImport(server.db);await server.listen(0,'0.0.0.0');
let browser;
try{
  const base=localAddresses(server.http.address().port)[0];if(!base)throw new Error('Erreichbares LAN für den QR-Test erforderlich.');
  const room=await(await fetch(`${base}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hostKey:'qr-check',mode:'learning-v1',setId:'stand-6',duration:75,joinBase:base})})).json();
  browser=await chromium.launch({channel:process.env.PW_CHANNEL||undefined});
  for(const name of ['QR-Test-A','QR-Test-B']){
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    await page.goto(`${base}/?code=${room.room}`);await page.getByLabel('Dein Spitzname').fill(name);await page.waitForFunction(()=>document.querySelector('#connection')?.classList.contains('connected'));await page.getByRole('button',{name:'Ich rate mit'}).click();await page.getByRole('heading',{name:'Dein Platz ist reserviert.'}).waitFor();
  }
  const snapshot=createPublication(server.db,questionBank(server.db,loadDeck()),null,{room:room.room,joinKind:'room',targetChecked:true});
  const folder=path.resolve('output/qa-session-poster');mkdirSync(folder,{recursive:true});const file=path.join(folder,'snapshot.json');writeFileSync(file,JSON.stringify(snapshot));
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/build-pdfs.js','--snapshot',file,'--out',folder,'--only','standplakat-a4'],{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Sitzungsplakat-Prüfung fehlgeschlagen.')));});
  const manifest=JSON.parse(readFileSync(path.join(folder,'manifest.json'),'utf8'));if(manifest.qa.qr[0]?.matched!==true)throw new Error('QR-Ziel nicht dekodiert.');
  console.log('QR aus finalem PDF bei 150 dpi dekodiert; Ziel stimmt. Zwei getrennte Browser-Kontexte haben die LAN-Sitzung erreicht. Kein Papierdruck-/Hardware-Scan-Test.');
}finally{await browser?.close();await server.close();}
