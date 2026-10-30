import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test.afterEach(async ({ request }) => {
  const headers = { Authorization: 'Bearer browser-test-key' };
  const result = await (await request.get('/api/admin/questions', { headers })).json();
  for (const q of result.questions.filter(q => ['Eigener Quiztext', 'Eigenes Foto'].includes(q.title))) {
    await request.delete(`/api/admin/questions/${q.id}`, { headers, data: { version: q.version } });
  }
});

test('eigene Texte und Bilder erstellen, bearbeiten, sortieren, deaktivieren und löschen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await page.getByLabel('Moderationsschlüssel').fill('browser-test-key');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fragen', exact: true })).toBeVisible();
  await page.getByLabel('Format', { exact: true }).selectOption('text');
  await page.getByLabel('Richtige Herkunft').selectOption('human');
  await page.getByLabel('Fragetitel').fill('Eigener Quiztext');
  await page.getByLabel('Quiztext', { exact: true }).fill('Dieses eigene Material soll im Quiz erscheinen.');
  await page.getByLabel('Auflösung / Erklärung').fill('Für den Stand selbst geschrieben.');
  await page.getByRole('button', { name: 'Frage speichern', exact: true }).click();
  await expect(page.locator('.q-item').filter({ hasText: 'Eigener Quiztext' })).toContainText('aktiv');
  await page.reload();
  await page.locator('.question-select').filter({ hasText: 'Eigener Quiztext' }).click();
  await expect(page.getByLabel('Quiztext', { exact: true })).toHaveValue('Dieses eigene Material soll im Quiz erscheinen.');
  await page.getByLabel('Quiztext', { exact: true }).fill('Überarbeiteter eigener Text.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
  await expect(page.getByLabel('Quiztext', { exact: true })).toHaveValue('Überarbeiteter eigener Text.');
  await page.getByLabel('In neuen Runden verwenden').uncheck();
  await page.getByRole('button', { name: 'Frage speichern', exact: true }).click();
  await expect(page.locator('.q-item').filter({ hasText: 'Eigener Quiztext' })).toContainText('inaktiv');
  await page.getByRole('button', { name: 'Nach oben: Eigener Quiztext', exact: true }).click();
  await expect(page.locator('.q-item').nth(7)).toContainText('Eigener Quiztext');
  await page.getByRole('button', { name: 'Neue Frage', exact: true }).click();
  await page.getByLabel('Richtige Herkunft').selectOption('human');
  await page.getByLabel('Fragetitel').fill('Eigenes Foto');
  await page.getByLabel('Bild hochladen').setInputFiles(fileURLToPath(new URL('../../content/assets/mountain.jpg', import.meta.url)));
  await expect(page.locator('#image-preview')).toBeVisible();
  await expect.poll(() => page.locator('#image-preview').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
  await page.getByLabel('Auflösung / Erklärung').fill('Hochgeladenes Fotobeispiel.');
  await page.getByRole('button', { name: 'Frage speichern', exact: true }).click();
  await expect(page.locator('.q-item').filter({ hasText: 'Eigenes Foto' })).toBeVisible();
  await page.reload();
  await page.locator('.question-select').filter({ hasText: 'Eigenes Foto' }).click();
  await expect.poll(() => page.locator('#image-preview').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
  for (const title of ['Eigenes Foto', 'Eigener Quiztext']) {
    await page.locator('.question-select').filter({ hasText: title }).click();
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await page.getByRole('button', { name: 'Frage endgültig löschen', exact: true }).click();
    await expect(page.locator('.q-item').filter({ hasText: title })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
