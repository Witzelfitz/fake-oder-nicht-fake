import { test, expect } from '@playwright/test';
test('P0: sechs Fälle, zwei Handys, Beamer, stabile Interaktion und moderierte Quellenaufdeckung',async({browser,request})=>{
  await request.post('/api/admin/import/apply',{headers:{Authorization:'Bearer browser-test-key'},data:{confirm:true}});
  const contexts=await Promise.all([
    browser.newContext({baseURL:'http://127.0.0.1:3199'}),
    browser.newContext({baseURL:'http://127.0.0.1:3199',viewport:{width:390,height:844},isMobile:true}),
    browser.newContext({baseURL:'http://127.0.0.1:3199',viewport:{width:390,height:844},isMobile:true}),
    browser.newContext({baseURL:'http://127.0.0.1:3199',viewport:{width:1920,height:1080},reducedMotion:'reduce'})
  ]);
  try{
    const [host,p1,p2,screen]=await Promise.all(contexts.map(c=>c.newPage()));
    await host.goto('/host');await host.getByLabel('Modus',{exact:true}).selectOption('learning-v1');
    await host.getByLabel('Moderationsschlüssel').fill('browser-test-key');await host.getByLabel('Adresse für die Handys').fill('http://127.0.0.1:3199');
    await host.getByRole('button',{name:'Spielraum erstellen'}).click();await expect(host.locator('.game-code')).toBeVisible();
    const code=await host.locator('.game-code').innerText();
    await screen.goto(`/screen?code=${code}`);
    for(const [p,name] of [[p1,'ErsterBlick'],[p2,'ZweiterBlick']]){await p.goto(`/?code=${code}`);await p.getByLabel('Dein Spitzname').fill(name);await expect(p.locator('#connection')).toHaveText('Live verbunden');await p.getByRole('button',{name:'Ich rate mit'}).click();await expect(p.getByRole('heading',{name:'Dein Platz ist reserviert.'})).toBeVisible();}
    await host.getByRole('button',{name:'Challenge starten'}).click();
    for(let i=0;i<6;i++){
      await expect(p1.locator('.learning-choices button')).toHaveCount(3);
      expect(await p1.evaluate(()=>Object.hasOwn(state.question,'answer'))).toBe(false);
      expect(await p1.evaluate(()=>state.hostNotes)).toBeNull();
      if(i===0){
        await p1.locator('[data-zoom]').click();await p1.getByLabel('Wie sicher bist du? (optional)').selectOption('2');await p1.locator('#confidence').focus();
        await p2.locator('[data-choice]').last().click();await expect(host.locator('[data-live-count]')).toHaveText('2 Personen · 1 Antworten');
        await expect(p1.locator('#confidence')).toBeFocused();await expect(p1.locator('#confidence')).toHaveValue('2');await expect(p1.locator('.media-zoom')).toHaveClass(/zoomed/);
      }else await p2.locator('[data-choice]').last().click();
      await p1.locator('[data-choice]').last().click();await expect(host.locator('[data-live-count]')).toHaveText('2 Personen · 2 Antworten');
      if(i===0){await p1.reload();await expect(p1.locator('.answer-button.selected')).toBeDisabled();}
      await host.getByRole('button',{name:'Gemeinsam auflösen'}).click();await expect(screen.getByRole('heading',{name:'Unser erster Eindruck'})).toBeVisible();
      await host.getByRole('button',{name:'Beleg zeigen'}).click();await expect(screen.locator('.source-card').first()).toBeVisible();
      await host.getByRole('button',{name:'Urteil zeigen'}).click();await expect(p1.locator('.verdict-card')).toBeVisible();
      await host.getByRole('button',{name:'Transfer zeigen'}).click();await expect(p1.locator('.transfer-card')).toBeVisible();
      await host.getByRole('button',{name:i===5?'Abschluss zeigen':'Nächster Fall'}).click();
    }
    await expect(p1.getByText('6 von 6 Fällen bearbeitet.')).toBeVisible();await expect(p1.locator('.leaderboard-table')).toHaveCount(0);
    for(const p of [p1,p2,screen])expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{for(const c of contexts)await c.close();}
});

test('P1: Quellenwerkstatt mit Erst- und Zweiturteil, Reload und tatsächlicher Reflexion',async({browser,request})=>{
  await request.post('/api/admin/import/apply',{headers:{Authorization:'Bearer browser-test-key'},data:{confirm:true}});
  const a=await browser.newContext({baseURL:'http://127.0.0.1:3199'}),b=await browser.newContext({baseURL:'http://127.0.0.1:3199',viewport:{width:390,height:844}});
  try{
    const host=await a.newPage(),p=await b.newPage();await host.goto('/host');await host.getByLabel('Modus',{exact:true}).selectOption('workshop-v1');await host.locator('#case-set').selectOption('werkstatt-4');
    await host.getByLabel('Moderationsschlüssel').fill('browser-test-key');await host.getByLabel('Adresse für die Handys').fill('http://127.0.0.1:3199');await host.getByRole('button',{name:'Spielraum erstellen'}).click();
    const code=await host.locator('.game-code').innerText();await p.goto(`/?code=${code}`);await p.getByLabel('Dein Spitzname').fill('Rechercheteam');await expect(p.locator('#connection')).toHaveText('Live verbunden');await p.getByRole('button',{name:'Ich rate mit'}).click();await expect(p.getByRole('heading',{name:'Dein Platz ist reserviert.'})).toBeVisible();await host.getByRole('button',{name:'Challenge starten'}).click();
    for(let i=0;i<4;i++){
      await p.locator('[data-choice]').last().click();await host.getByRole('button',{name:'Quellen öffnen'}).click();await expect(p.locator('.source-card').first()).toBeVisible();
      if(i===0){await p.reload();await expect(p.locator('.source-card').first()).toBeVisible();expect(await p.evaluate(()=>state.me.firstAnswer.choice)).toBe('open');}
      await host.getByRole('button',{name:'Zweiturteil starten'}).click();await p.locator('[data-choice]').first().click();await host.getByRole('button',{name:'Gemeinsam auflösen'}).click();
      for(const label of ['Beleg zeigen','Urteil zeigen','Transfer zeigen'])await host.getByRole('button',{name:label}).click();
      await host.getByRole('button',{name:i===3?'Abschluss zeigen':'Nächster Fall'}).click();
    }
    await expect(p.getByText('4 von 4 Fällen bearbeitet.')).toBeVisible();await expect(p.getByText('Urteil geändert · nur tatsächlich abgegebene Antworten')).toHaveCount(4);
    await expect(p.locator('.leaderboard-table')).toHaveCount(0);
  }finally{await a.close();await b.close();}
});
