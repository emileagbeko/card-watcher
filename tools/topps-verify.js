#!/usr/bin/env node
// One-time helper for when the Topps watch logs a Cloudflare challenge.
// Opens the watcher's own Chrome profile VISIBLY on uk.topps.com so a human
// can click the "Verify you are human" checkbox. The clearance cookie sticks
// to the persistent profile, so subsequent offscreen watcher runs sail
// through. Safe to run any time; closes itself once products render.

const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const context = await chromium.launchPersistentContext(
    path.join(__dirname, '..', '.chrome-profile'),
    {
      channel: 'chrome',
      headless: false,
      viewport: null,
      locale: 'en-GB',
      args: ['--window-position=120,80', '--window-size=1200,850'],
    }
  );
  const page = context.pages()[0] || (await context.newPage());
  await page
    .goto('https://uk.topps.com/collections/premier-league', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    .catch(() => {});
  console.log('A Chrome window is open. If it shows "Verify you are human", click the checkbox.');
  console.log('Waiting up to 3 minutes for the page to clear…');

  const deadline = Date.now() + 3 * 60 * 1000;
  let cleared = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000).catch(() => {});
    if (page.isClosed()) break;
    const links = await page
      .locator('a[href*="/products/"]')
      .count()
      .catch(() => 0);
    if (links > 0) {
      cleared = true;
      break;
    }
  }
  console.log(
    cleared
      ? '✅ Cleared — the clearance is saved to the watcher\'s profile. Runs will work again.'
      : '❌ Still blocked. Cloudflare sometimes refuses clicks from automated windows; ' +
          'wait a few hours (the block cools off) and try again.'
  );
  await context.close().catch(() => {});
})();
