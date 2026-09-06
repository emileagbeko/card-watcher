#!/usr/bin/env node
// Re-extracts George's public Algolia search key from their homepage and
// writes it into config.json. Run this if the watcher reports the key was
// rejected (sites rotate these occasionally).

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  await page.goto('https://direct.asda.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  const html = await page.content();
  await browser.close();

  const keyMatch = html.match(/algoliaApiKey"\s*:\s*"([a-f0-9]{16,64})"/i);
  const appMatch = html.match(/algoliaAppId"\s*:\s*"([A-Z0-9]{6,14})"/i);
  if (!keyMatch) {
    console.error('Could not find an Algolia key on the page — site layout may have changed.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  config.adapters = config.adapters || {};
  config.adapters['asda-george'] = {
    ...(config.adapters['asda-george'] || {}),
    apiKey: keyMatch[1],
    ...(appMatch ? { appId: appMatch[1] } : {}),
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`Updated config.json with key ${keyMatch[1].slice(0, 8)}…` + (appMatch ? ` (app ${appMatch[1]})` : ''));
})();
