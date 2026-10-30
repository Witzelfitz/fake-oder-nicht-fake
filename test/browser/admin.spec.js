import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('Bilder und Videos ohne Quellenformular oder Freigabeschritte verwalten', async ({ page, request }) => {
  const headers = { Authorization: 'Bearer browser-test-key' };
  try {
    await page.goto('/admin'); await page.getByLabel('Moderationsschlüssel').fill('browser-test-key');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Medien', exact: true })).toBeVisible();
    await expect(page.locator('#q-learning,#q-axis,#q-status,#source-cards')).toHaveCount(0);
    for (const [title, filename, format] of [['Testfoto', 'round-01.jpg', 'photo'], ['Testclip', 'round-04.mp4', 'video']]) {
      await page.getByRole('button', { name: 'Neues Medium', exact: true }).click();
      await page.getByLabel('Name für die Verwaltung').fill(title);
      await page.getByLabel('Richtige Antwort').selectOption(format === 'video' ? 'ai' : 'human');
      await page.getByLabel('Bild oder Video hochladen').setInputFiles(fileURLToPath(new URL(`../../content/assets/${filename}`, import.meta.url)));
      await expect(page.getByLabel('Format', { exact: true })).toHaveValue(format);
      await expect(page.locator('#preview > *')).toBeVisible();
      await page.getByRole('button', { name: 'Medium speichern', exact: true }).click();
      await expect(page.locator('.q-item').filter({ hasText: title })).toContainText('aktiv');
      await page.reload(); await page.locator('.question-select').filter({ hasText: title }).click();
      const media = page.locator('#preview > *');
      if (format === 'video') await expect.poll(() => media.evaluate(v => v.readyState >= 2 && v.videoWidth > 0)).toBeTruthy();
      else await expect.poll(() => media.evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
      await page.getByLabel('In neuen Runden verwenden').uncheck();
      await page.getByRole('button', { name: 'Medium speichern', exact: true }).click();
      await expect(page.locator('.q-item').filter({ hasText: title })).toContainText('inaktiv');
      await page.getByRole('button', { name: `Nach oben: ${title}`, exact: true }).click();
      await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
      await page.getByRole('button', { name: 'Medium entfernen', exact: true }).click();
      await expect(page.locator('.q-item').filter({ hasText: title })).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    const result = await (await request.get('/api/admin/questions', { headers })).json();
    for (const q of result.questions.filter(q => ['Testfoto', 'Testclip'].includes(q.title))) await request.delete(`/api/admin/questions/${q.id}`, { headers, data: { version: q.version } });
  }
});
