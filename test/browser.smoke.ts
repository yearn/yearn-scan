import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { setup, fixture, origin } from './helpers.ts';

test('browser: create → private table → update → external report', { timeout: 120_000 }, async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10_000);
  const token = await app.token();
  const browserErrors = [];
  let catalogRequests = 0;
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url().startsWith(origin + '/api/v1/reports')) catalogRequests++;
    if (!request.url().startsWith(origin + '/')) {
      assert.equal(request.url(), 'https://reports.example/private/scan.html');
      assert.equal(request.headers().referer, undefined);
      return route.fulfill({ contentType: 'text/html', body: '<h1>Client-hosted report</h1>' });
    }
    const response = await app.mf.dispatchFetch(request.url(), {
      method: request.method(), headers: { ...request.headers(), 'Cf-Access-Jwt-Assertion': token },
    });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const input = fixture({ repository: 'yearn/tokenized-strategy', scanner: { name: '<img src=x onerror="window.pwned=1">', version: '1.0' }, ai_model: '<script>window.pwned=1</script>' });
  const created = await (await app.request('/api/v1/upload', 'POST', input)).json();
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  const firstResponse = await page.goto(origin);
  const initialHtml = await firstResponse.text();
  assert.ok(initialHtml.includes('yearn/tokenized-strategy'), 'first response includes D1 data');
  await page.getByRole('status').filter({ hasText: '1 scan on this page' }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.equal(catalogRequests, 0, 'initial hydration needs no catalog fetch');
  assert.ok((await page.locator('tbody').innerText()).includes(input.scanner.name));
  assert.equal(await page.locator('tbody img, tbody script').count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('.count.unavailable').innerText(), '—');
  assert.equal(await page.locator('.count').first().innerText(), '0');
  await app.request(`/api/v1/upload/${created.id}`, 'PUT', { ...input, status: 'partial', scanner: { name: 'Repository review', version: '2.0' } });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.locator('.status-partial').waitFor();
  assert.ok((await page.locator('tbody').innerText()).includes('Repository review 2.0'));
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Open ai-repo report for yearn/tokenized-strategy' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(popup.url(), input.report_url);
  assert.equal(await popup.evaluate(() => window.opener), null);
  assert.equal(await popup.locator('h1').innerText(), 'Client-hosted report');
  assert.equal(app.outbound(), 1, 'the Worker fetches only Access certificates');
  for (let i = 0; i < 51; i++) await app.request('/api/v1/upload', 'POST', fixture({ repository: `yearn/repository-${i}`, scan_type: i % 2 ? 'secrets' : 'dependency' }));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByRole('status').filter({ hasText: '50 scans' }).waitFor();
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.getByRole('status').filter({ hasText: '2 scans' }).waitFor();
  assert.equal(await page.locator('#page').innerText(), 'Page 2');
  await page.getByRole('button', { name: '← Previous' }).click();
  await page.getByRole('status').filter({ hasText: '50 scans' }).waitFor();
  await page.getByRole('searchbox', { name: 'Repository' }).fill('tokenized');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.getByRole('status').filter({ hasText: '1 scan' }).waitFor();
  assert.ok(page.url().includes('q=tokenized'));
  await page.getByLabel('Status', { exact: true }).selectOption('completed');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.getByText('No scans match these filters.').waitFor();
  await page.getByLabel('Status', { exact: true }).selectOption('partial');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await page.locator('.status-partial').waitFor();
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(browserErrors, []);
});
