import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const deck = JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8'));

test('Moderation, Beamer und zwei Handys spielen acht Runden inklusive Reload und Rangliste', async ({ browser }) => {
  const baseURL = 'http://127.0.0.1:3199';
  const hostContext = await browser.newContext({ baseURL });
  const mobileContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const secondContext = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const screenContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const contexts = [hostContext, mobileContext, secondContext, screenContext];
  const errors = [];
  try {
    const host = await hostContext.newPage(), player = await mobileContext.newPage(), second = await secondContext.newPage(), screen = await screenContext.newPage();
    for (const page of [host, player, second, screen]) page.on('pageerror', error => errors.push(error.message));
    await host.goto('/host');
    await host.getByLabel('Moderationsschlüssel').fill('browser-test-key');
    await host.getByLabel('Adresse für die Handys').fill('http://127.0.0.1:3199');
    await host.getByRole('button', { name: /Spielraum erstellen/ }).click();
    await expect(host.locator('.game-code')).toHaveText(/\d{6}/);
    const code = await host.locator('.game-code').innerText();
    await screen.goto(`/screen?code=${code}`);
    await expect(screen.locator('.game-code')).toHaveText(code);
    await expect(screen.locator('.qr')).toBeVisible();
    expect(await screen.locator('.qr').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
    for (const [page, name] of [[player, 'Bergfuchs'], [second, 'Seestern']]) {
      await page.goto(`/?code=${code}`);
      await page.getByLabel('Dein Spitzname').fill(name);
      await expect(page.locator('#connection')).toHaveText('Live verbunden');
      await page.getByRole('button', { name: /Ich rate mit/ }).click();
      await expect(page.getByText('Dein Platz ist reserviert.')).toBeVisible();
    }
    await host.getByRole('button', { name: /Quiz starten/ }).click();
    for (const [index, q] of deck.questions.entries()) {
      await expect(player.getByRole('heading', { name: q.title })).toBeVisible();
      await expect(screen.getByRole('heading', { name: q.title })).toBeVisible();
      if (q.type !== 'text') {
        await expect(player.locator('.image-example img')).toBeVisible();
        expect(await player.locator('.image-example img').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
      }
      await player.locator(`[data-choice="${q.answer}"]`).click();
      await second.locator(`[data-choice="${index === 0 ? (q.answer === 'ai' ? 'human' : 'ai') : q.answer}"]`).click();
      await expect(host.getByText('2 Personen · 2 Antworten')).toBeVisible();
      if (index === 0) {
        await player.reload();
        await expect(player.locator('.answer-button.selected')).toBeDisabled();
      await expect(player.getByText('Deine Antwort ist gespeichert', { exact: true })).toBeVisible();
      }
      await host.getByRole('button', { name: /Jetzt auflösen/ }).click();
      await expect(player.locator('.result-pill')).toHaveText(/\+ [\d'’]+ Punkte/);
      await expect(player.locator('.score-breakdown')).toContainText('Tempo');
      await expect(screen.locator('.reveal-block')).toBeVisible();
      await host.getByRole('button', { name: /Nächste Frage|Ergebnis zeigen/ }).click();
    }
    await expect(player.locator('.personal-result')).toHaveText(/8 von 8 erkannt\. [\d'’]+ Punkte\. Rang 1\./);
    await expect(player.locator('.my-row').first()).toContainText('Bergfuchs');
    await expect(screen.locator('.overall')).toContainText('Seestern');
    for (const page of [host, player, second, screen]) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});

test('Startseite, Quellen und Standunterlagen sind auch auf einem schmalen Handy lesbar', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3199', viewport: { width: 360, height: 780 }, isMobile: true });
  try {
    const page = await context.newPage();
    for (const route of ['/', '/sources.html', '/stand.html', '/leaderboard']) {
      await page.goto(route);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
    await page.goto('/');
    await page.getByLabel('Spielcode').fill('999999'); await page.getByLabel('Dein Spitzname').fill('Testgast');
    await expect(page.locator('#connection')).toHaveText('Live verbunden');
    await page.getByRole('button', { name: /Ich rate mit/ }).click();
    await expect(page.locator('#form-error')).toHaveText('Dieser Spielcode existiert nicht.');
  } finally { await context.close(); }
});
