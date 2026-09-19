import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { setup, fixture, origin } from './helpers.ts';

const zeros = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
const unknown = { critical: null, high: null, medium: null, low: null, info: null };

test('browser: operational table, filters, races, pagination, polling and private reports', { timeout: 120_000 }, async t => {
  const app = await setup(); t.after(() => app.mf.dispose());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  context.setDefaultTimeout(10_000);
  const token = await app.token();
  const browserErrors = [];
  let catalogRequests = 0;
  let intercept: null | ((route: any) => Promise<boolean>) = null;
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.url().startsWith(origin + '/api/v1/reports')) {
      catalogRequests++;
      if (intercept && await intercept(route)) return;
    }
    if (!request.url().startsWith(origin + '/')) {
      assert.equal(request.url(), 'https://reports.example/private/scan.html');
      assert.equal(request.headers().referer, undefined);
      return route.fulfill({ contentType: 'text/html', body: '<h1>Client-hosted report</h1>' });
    }
    const response = await app.mf.dispatchFetch(request.url(), { method: request.method(), headers: { ...request.headers(), 'Cf-Access-Jwt-Assertion': token } });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const hostile = '<img src=x onerror="window.pwned=1">';
  for (const severity of Object.keys(zeros)) await app.request('/api/v1/upload', 'POST', fixture({ repository: `yearn/${severity}`, severity_counts: { ...zeros, [severity]: 2 } }));
  await app.request('/api/v1/upload', 'POST', fixture({ repository: 'yearn/clear', severity_counts: zeros }));
  await app.request('/api/v1/upload', 'POST', fixture({ repository: 'yearn/unknown', severity_counts: unknown, finished_at: null, report_url: null }));
  const failed = fixture({ repository: 'yearn/failed', status: 'failed', pr_title: hostile, pr_number: 42, pr_url: 'https://github.com/yearn/failed/pull/42', scanner: { name: hostile, version: 'SECRET-VERSION' }, ai_model: 'SECRET-MODEL' });
  await app.request('/api/v1/upload', 'POST', failed);
  const running = fixture({ repository: 'yearn/running', status: 'running', finished_at: null, report_url: null, severity_counts: unknown });
  const { id: runningId } = await (await app.request('/api/v1/upload', 'POST', running)).json();
  await app.request('/api/v1/upload', 'POST', fixture({ repository: 'yearn/yearn-vaults-v3', scan_type: 'smart-contract', severity_counts: { critical: 1, high: 3, medium: 7, low: 12, info: 4 } }));
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  const first = await page.goto(origin);
  const initialHtml = await first.text();
  assert.ok(initialHtml.includes('yearn/running'));
  assert.ok(initialHtml.includes('skeleton-row'), 'initial streaming fallback uses matching skeleton rows');
  await page.getByRole('status').filter({ hasText: '10 scans' }).waitFor();
  // Wait for hydration before exercising controls.
  await page.waitForFunction(() => document.querySelector('select') !== null);
  assert.equal(catalogRequests, 0);
  assert.deepEqual(await page.locator('th').allTextContents(), ['repo', 'scan', 'client', 'time', 'findings', 'status', 'report']);
  for (const state of [...Object.keys(zeros), 'clear', 'unknown', 'failed', 'running']) assert.equal(await page.locator(`.status-${state}`).count(), state === 'critical' ? 2 : 1, state);
  assert.equal(await page.locator('.count.unavailable').first().innerText(), '—');
  assert.equal(await page.locator('.severity-critical').filter({ hasText: /^0$/ }).count() > 0, true);
  assert.equal(await page.locator('tbody img, tbody script').count(), 0);
  assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
  assert.equal((await page.locator('tbody').innerText()).includes(hostile), true);
  assert.doesNotMatch(await page.locator('tbody').innerText(), /SECRET-VERSION|SECRET-MODEL/);
  assert.equal(await page.getByRole('button', { name: /Refresh|Apply/ }).count(), 0);
  assert.equal(await page.getByRole('navigation', { name: 'Result pages' }).count(), 0);
  assert.equal(await page.locator('.brand img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), true);
  assert.deepEqual(await page.getByLabel('Status', { exact: true }).locator('option').allTextContents(),
    ['all statuses', 'running', 'failed', 'critical', 'high', 'medium', 'low', 'info', 'no findings']);
  assert.equal(await page.locator('.report-row-critical').count(), 2);
  const criticalColors = await page.locator('.report-row-critical').first().locator('.repository, .owner, .client-column, time, .report-link').evaluateAll(elements => elements.map(el => getComputedStyle(el).color));
  assert.ok(criticalColors.every(color => color === 'rgb(255, 122, 139)'));
  const rows = await page.locator('.report-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  assert.ok(rows.every(height => height === 120), JSON.stringify(rows));
  assert.equal(await page.locator('header').evaluate(header => header.getBoundingClientRect().height), 76);
  await mkdir('/tmp/yearn-scan-screenshots', { recursive: true });
  await page.screenshot({ path: '/tmp/yearn-scan-screenshots/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 1000, height: 900 });
  assert.equal(await page.locator('th.client-column').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('.table-scroll').evaluate(el => el.scrollWidth > el.clientWidth), true);
  await page.screenshot({ path: '/tmp/yearn-scan-screenshots/mobile.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.setViewportSize({ width: 1440, height: 1100 });

  const reportLink = page.getByRole('link', { name: 'Open AI repository review report for yearn/failed' });
  assert.equal(await reportLink.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await reportLink.getAttribute('referrerpolicy'), 'no-referrer');
  const popupPromise = context.waitForEvent('page');
  await reportLink.click();
  const popup = await popupPromise; await popup.waitForLoadState();
  assert.equal(await popup.evaluate(() => window.opener), null);
  assert.equal(await popup.locator('h1').innerText(), 'Client-hosted report');
  await popup.close();

  for (const [filter, indicator, count] of [['critical', 'critical', 2], ['high', 'high', 1], ['medium', 'medium', 1], ['low', 'low', 1], ['info', 'info', 1], ['no-findings', 'clear', 1]] as const) {
    await page.getByLabel('Status', { exact: true }).selectOption(filter);
    await page.getByRole('status').filter({ hasText: `${count} scans` }).waitFor();
    await page.waitForFunction(({ indicator, count }) => document.querySelectorAll(`.status-${indicator}`).length === count, { indicator, count });
    assert.equal(await page.locator('.report-row').count(), count);
    assert.ok(page.url().includes(`status=${filter}`));
  }

  // A slow superseded request must not replace a newer filter result.
  let release: () => void;
  let intercepted: () => void;
  const seen = new Promise<void>(resolve => { intercepted = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  intercept = async route => {
    if (new URL(route.request().url()).searchParams.get('status') !== 'failed') return false;
    intercepted(); await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schema_version: 1, repositories: [], reports: [], next_cursor: null }) }).catch(() => {});
    return true;
  };
  await page.getByLabel('Status', { exact: true }).selectOption('failed'); await seen;
  await page.locator('.skeleton-row').first().waitFor();
  assert.ok(page.url().includes('status=failed'));
  await page.getByLabel('Status', { exact: true }).selectOption('high');
  await page.getByRole('status').filter({ hasText: '1 scans' }).waitFor();
  release(); intercept = null;
  await page.getByLabel('Repository', { exact: true }).selectOption('yearn/failed');
  await page.getByText('No scans match these filters.').waitFor();
  assert.equal(await page.locator('th').count(), 7);
  assert.equal(await page.getByLabel('Repository', { exact: true }).locator('option').count(), 11);
  await page.getByLabel('Status', { exact: true }).selectOption('failed');
  await page.locator('.status-failed').waitFor();
  assert.ok(page.url().includes('q=yearn%2Ffailed'));

  // HTTP and session failures keep the headings and an in-table recovery link.
  intercept = async route => { await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }); return true; };
  await page.getByLabel('Status', { exact: true }).selectOption('running');
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /session has expired/);
  assert.equal(await page.locator('th').count(), 7);
  assert.equal(await page.getByRole('link', { name: 'Reload', exact: true }).count(), 1);
  intercept = null;

  // Hidden scan-type and page-size URL parameters survive immediate filtering.
  for (let i = 0; i < 5; i++) await app.request('/api/v1/upload', 'POST', fixture({ repository: `yearn/older-${i}`, scan_type: 'custom-analysis' }));
  await page.goto(`${origin}/?scan_type=custom-analysis&limit=2`);
  await page.getByRole('status').filter({ hasText: '2 scans' }).waitFor();
  assert.match(await page.locator('tbody').innerText(), /custom analysis/);
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.getByRole('status').filter({ hasText: '2 scans' }).waitFor();
  assert.ok(page.url().includes('cursor='));
  await page.getByRole('button', { name: 'Next →' }).click();
  await page.getByRole('status').filter({ hasText: '1 scans' }).waitFor();
  await page.getByRole('button', { name: '← Previous' }).click();
  await page.getByRole('status').filter({ hasText: '2 scans' }).waitFor();
  await page.getByLabel('Status', { exact: true }).selectOption('high');
  await page.getByRole('status').filter({ hasText: '2 scans' }).waitFor();
  assert.ok(!page.url().includes('cursor='));
  assert.ok(page.url().includes('scan_type=custom-analysis'));
  assert.ok(page.url().includes('limit=2'));

  // Poll only visible running results; background requests retain existing rows.
  await page.goto(`${origin}/?q=yearn%2Frunning`);
  await page.locator('.status-running').waitFor();
  await page.clock.install();
  assert.equal(await page.locator('time').getAttribute('datetime'), '2026-09-16T10:00:00.000Z');
  assert.equal(await page.locator('time').getAttribute('title'), '2026-09-16T10:00:00.000Z');
  const before = catalogRequests;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(30_000);
  assert.equal(catalogRequests, before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  let releasePoll: () => void;
  const pollGate = new Promise<void>(resolve => { releasePoll = resolve; });
  let pollSeen: () => void;
  const pollStarted = new Promise<void>(resolve => { pollSeen = resolve; });
  intercept = async () => { pollSeen(); await pollGate; return false; };
  await app.request(`/api/v1/upload/${runningId}`, 'PUT', { ...running, status: 'completed', severity_counts: zeros });
  await page.clock.fastForward(15_000); await pollStarted;
  assert.equal(await page.locator('.status-running').count(), 1);
  assert.equal(await page.locator('.skeleton-row').count(), 0);
  releasePoll(); intercept = null;
  await page.locator('.status-clear').waitFor();
  const updated = await app.db.prepare('SELECT updated_at FROM reports WHERE id = ?').bind(runningId).first();
  assert.equal(await page.locator('time').getAttribute('datetime'), new Date(updated.updated_at).toISOString());
  const after = catalogRequests;
  await page.clock.fastForward(45_000);
  assert.equal(catalogRequests, after);
  assert.equal(app.outbound(), 1, 'only Access certificate requests leave the Worker');
  // Corrupt stored URLs remain inert even if validation was bypassed outside the API.
  await app.db.prepare("UPDATE reports SET payload = json_set(payload, '$.report_url', 'javascript:alert(1)', '$.pr_url', 'https://user:password@example.com', '$.pr_title', ?) WHERE repository = 'yearn/failed'").bind(hostile).run();
  await page.goto(`${origin}/?q=yearn%2Ffailed`);
  await page.locator('.status-failed').waitFor();
  assert.equal(await page.locator('tbody .report-link, tbody .pr-metadata a').count(), 0);
  assert.equal(await page.locator('tbody img, tbody script').count(), 0);
  assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
  await page.goto(`${origin}/?status=invalid`);
  await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('th').count(), 7);
  assert.equal(await page.getByRole('link', { name: 'Reload and clear filters' }).getAttribute('href'), '/');
  assert.deepEqual(browserErrors, []);
});
