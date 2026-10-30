import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const deck = JSON.parse(readFileSync(new URL('../../content/questions.json', import.meta.url), 'utf8'));

test('zehn Medienrunden mit zwei Handys und Beamer, abspielbaren Videos und einfachem Ergebnis', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext({ baseURL: 'http://127.0.0.1:3199' }),
    browser.newContext({ baseURL: 'http://127.0.0.1:3199', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
    browser.newContext({ baseURL: 'http://127.0.0.1:3199', viewport: { width: 375, height: 812 }, isMobile: true }),
    browser.newContext({ baseURL: 'http://127.0.0.1:3199', viewport: { width: 1920, height: 1080 } })
  ]);
  const errors = [];
  try {
    const [host, player, second, screen] = await Promise.all(contexts.map(c => c.newPage()));
    for (const page of [host, player, second, screen]) page.on('pageerror', error => errors.push(error.message));
    await host.goto('/host');
    await expect(host.getByLabel('Modus', { exact: true })).toHaveCount(0);
    await expect(host.getByLabel('Zielgruppe')).toHaveCount(0);
    await host.getByLabel('Moderationsschlüssel').fill('browser-test-key');
    await host.getByRole('button', { name: 'Spielraum erstellen' }).click();
    await expect(host.locator('.game-code')).toHaveText(/\d{6}/);
    const code = await host.locator('.game-code').innerText();
    await screen.goto(`/screen?code=${code}`); await expect(screen.locator('.qr')).toBeVisible();
    await expect.poll(() => screen.locator('.qr').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
    for (const [page, name] of [[player, 'Bergfuchs'], [second, 'Seestern']]) {
      await page.goto(`/?code=${code}`); await page.getByLabel('Dein Spitzname').fill(name);
      await expect(page.locator('#connection')).toHaveText('Live verbunden');
      await page.getByRole('button', { name: 'Ich rate mit' }).click();
      await expect(page.getByText('Dein Platz ist reserviert.')).toBeVisible();
    }
    await host.getByRole('button', { name: 'Quiz starten', exact: true }).click();
    for (const [index, q] of deck.questions.entries()) {
      await expect(player.getByRole('heading', { name: 'Echt oder KI?', exact: true })).toBeVisible();
      await expect(player.locator('.eyebrow').first()).toContainText(`RUNDE ${index + 1} / 10`);
      if (q.type === 'video') {
        const video = player.locator('.quiz-media video');
        await expect(video).toBeVisible();
        await expect.poll(() => video.evaluate(v => v.readyState >= 2 && v.videoWidth > 0 && v.currentTime > .1 && !v.paused)).toBeTruthy();
        // State broadcasts from another voter must preserve the current video element.
        await video.evaluate(v => { v.dataset.marker = 'keep-playing'; });
        await second.locator(`[data-choice="${q.answer}"]`).click();
        await expect(host.locator('[data-live-count]')).toContainText('1 Antworten');
        await expect(video).toHaveAttribute('data-marker', 'keep-playing');
        await expect.poll(() => screen.locator('.quiz-media video').evaluate(v => v.readyState >= 2 && v.currentTime > .1)).toBeTruthy();
        if (index === 3) {
          await player.screenshot({ path: 'output/simple-video-mobile.png', fullPage: true });
          await screen.screenshot({ path: 'output/simple-video-screen.png', fullPage: true });
        }
      } else {
        await expect.poll(() => player.locator('.quiz-media img').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
        await second.locator(`[data-choice="${index === 0 ? 'ai' : q.answer}"]`).click();
      }
      await player.locator(`[data-choice="${q.answer}"]`).click();
      await expect(host.locator('[data-live-count]')).toHaveText('2 Personen · 2 Antworten');
      if (!index) {
        await player.reload(); await expect(player.locator('.answer-button.selected')).toBeDisabled();
        await expect(player.locator('#answer-status')).toHaveText('Deine Antwort ist gespeichert.');
        await player.screenshot({ path: 'output/simple-image-mobile.png', fullPage: true });
      }
      await host.getByRole('button', { name: 'Auflösen', exact: true }).click();
      await expect(player.locator('.simple-reveal')).toBeVisible();
      await expect(player.locator('.reveal-answer')).toHaveText(q.answer === 'ai' ? 'KI-generiert.' : 'Echt aufgenommen.');
      await expect(player.locator('.source-card,.source-credit,.score-breakdown,.learning-case')).toHaveCount(0);
      await expect(player.getByText('Richtig getippt!', { exact: true })).toBeVisible();
      if (!index) await screen.screenshot({ path: 'output/simple-reveal-screen.png', fullPage: true });
      for (const page of [player, screen]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await host.getByRole('button', { name: index === 9 ? 'Ergebnis zeigen' : 'Nächste Runde', exact: true }).click();
    }
    await expect(player.locator('.personal-result')).toHaveText('10 von 10 richtig.');
    await expect(second.locator('.personal-result')).toHaveText('9 von 10 richtig.');
    await expect(screen.getByRole('heading', { name: 'Eure Treffer' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});

test('schmales Handy, kurze Anmeldung und alte Unterlagenlinks führen zur einfachen Moderation', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const route of ['/', '/sources.html', '/stand.html', '/admin']) {
    await page.goto(route); await expect(page.locator('h1').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.getByText('Lernpaket importieren')).toHaveCount(0);
  await page.goto('/'); await page.screenshot({ path: 'output/simple-landing-mobile.png', fullPage: true });
  await page.getByLabel('Spielcode').fill('999999'); await page.getByLabel('Dein Spitzname').fill('Testgast');
  await expect(page.locator('#connection')).toHaveText('Live verbunden');
  await page.getByRole('button', { name: 'Ich rate mit' }).click();
  await expect(page.locator('#form-error')).toHaveText('Dieser Spielcode existiert nicht.');
});
