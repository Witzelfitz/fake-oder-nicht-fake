import { test, expect } from '@playwright/test';

test('Redaktion: Entwurf, Freigabe, erneute Prüfung und unveränderliche Druckansicht', async ({page,request})=>{
  const headers={Authorization:'Bearer browser-test-key'};
  await page.goto('/admin');await page.getByLabel('Moderationsschlüssel').fill('browser-test-key');await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.getByLabel('Format',{exact:true}).selectOption('text');await page.locator('#q-axis').selectOption('claim');await page.locator('#q-answer').selectOption('open');
  await page.getByLabel('Fragetitel').fill('Redaktionsprüfung');await page.getByLabel('Leitfrage',{exact:true}).fill('Ist diese Angabe mit dem Material überprüfbar?');
  await page.getByLabel('Quiztext',{exact:true}).fill('Eine offene Unterrichtsfrage.');await page.getByLabel('Auflösung / Erklärung').fill('Eine belegte Mengenangabe fehlt.');
  await page.getByRole('button',{name:'Frage speichern',exact:true}).click();await expect(page.locator('.q-item').filter({hasText:'Redaktionsprüfung'})).toBeVisible();
  const rows=await(await request.get('/api/admin/questions',{headers})).json();const own=rows.questions.find(q=>q.title==='Redaktionsprüfung');
  try{
    await page.locator('#q-limitation').fill('Keine Grundgesamtheit angegeben.');await page.locator('#q-transfer').fill('Welche Zahl würde das klären?');
    await page.getByText('Quelle und Nutzungsangaben',{exact:true}).click();
    await page.locator('#q-credit').fill('Eigene Unterrichtssimulation');await page.locator('#q-license').fill('Projekteigene Übung');
    await page.getByRole('button',{name:'Quelle hinzufügen',exact:true}).click();
    const fields={title:'Lokale Aufgabenkarte',publisher:'Unterricht',reviewedAt:'2026-10-30',locator:'Aufgabenkarte, Satz 1',supports:'Enthält keine Mengenangabe.',limitation:'Keine reale Statistik.',rights:'Projekteigenes Übungsmaterial'};
    for(const [field,value] of Object.entries(fields))await page.locator(`[data-source-field="${field}"]`).fill(value);
    for(const id of ['sources','rights','didactics'])await page.locator(`#review-${id}`).check();await page.locator('#review-date').fill('2026-10-30');await page.locator('#review-by').fill('Browser-Qualitätsprüfung');
    await page.locator('#q-status').selectOption('published');await page.getByRole('button',{name:'Frage speichern',exact:true}).click();await expect(page.locator('#q-status')).toHaveValue('published');
    await page.getByRole('button',{name:'Quelle entfernen',exact:true}).click();await expect(page.locator('#q-status')).toHaveValue('draft');await expect(page.locator('#review-rights')).not.toBeChecked();
    await page.getByRole('button',{name:'Frage speichern',exact:true}).click();await expect(page.locator('#source-cards fieldset')).toHaveCount(0);
    await request.post('/api/admin/import/apply',{headers,data:{confirm:true}});
    await page.goto('/materials');await expect(page.getByRole('heading',{name:'Ein Inhalt. Die passenden Unterlagen.'})).toBeVisible();
    await page.getByRole('button',{name:'Inhaltsstand festhalten',exact:true}).click();await expect(page.locator('#publication-result')).toContainText('6 Fälle');
    const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'Fallblätter',exact:true}).click();const print=await popup;await print.waitForLoadState();
    await expect(print.locator('.sheet')).toHaveCount(6);await expect(print.locator('body')).toHaveAttribute('data-audience','participant');
    expect(await print.content()).not.toContain('Browser-Qualitätsprüfung');expect(print.url()).not.toContain('browser-test-key');
    await print.reload();await expect(print.locator('body')).toContainText('Druckansicht abgelaufen');await print.close();
  }finally{
    const current=await(await request.get('/api/admin/questions',{headers})).json();const row=current.questions.find(q=>q.id===own.id);if(row)await request.delete(`/api/admin/questions/${row.id}`,{headers,data:{version:row.version}});
  }
});
