import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  if (process.env.QA_OFFLINE_IMAGERY === '1') {
    const tile = fs.readFileSync(
      new URL(
        '../node_modules/cesium/Build/Cesium/Assets/Textures/NaturalEarthII/0/0/0.jpg',
        import.meta.url,
      ),
    );
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      const imagery =
        request.method() === 'GET' &&
        ((url.origin === 'https://services.arcgisonline.com' &&
          /^\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(
            url.pathname,
          )) ||
          (url.origin === 'https://tile.openstreetmap.org' &&
            /^\/\d+\/\d+\/\d+\.png$/.test(url.pathname)));
      if (imagery)
        request.respond({
          status: 200,
          contentType: 'image/jpeg',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: tile,
        });
      else request.continue();
    });
  }
  await page.goto(
    process.env.QA_BASE_URL || 'http://127.0.0.1:4198/?lang=en&welcome=0',
    {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    },
  );
  await page.waitForFunction(() => !!window.__godsEyeView, { timeout: 150000 });
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60000 },
  );
  await page.evaluate(async () => {
    const { t } = await import('/src/i18n/index.js');
    window.__localeProof = {
      identity: Math.random(),
      viewer: window.__godsEyeView.viewer,
      camera: window.__godsEyeView.viewer.camera.position.clone(),
      names: [...document.querySelectorAll('.data-name')].map(
        (e) => e.textContent,
      ),
    };
    const host = document.createElement('div');
    host.id = 'locale-proof';
    host.style.cssText =
      'position:fixed;top:10px;left:50%;z-index:99999;background:#101727;color:white';
    const text = document.createElement('span');
    text.id = 'locale-proof-text';
    text.textContent = t('Saved to {store}', { store: 'My private vault' });
    text.title = t('Change the interface language');
    host.append(text);
    const input = document.createElement('input');
    input.id = 'locale-proof-draft';
    input.value = 'Airports';
    host.append(input);
    const raw = document.createElement('span');
    raw.translate = false;
    raw.textContent = 'Airports';
    raw.id = 'locale-proof-raw';
    host.append(raw);
    document.body.append(host);
  });
  const results = [];
  for (const locale of ['zh-CN', 'ja', 'ko', 'ru', 'es', 'zh-TW', 'en']) {
    await page.click('#locale-picker .locale-picker-button');
    await page.waitForSelector(`#locale-picker [data-locale="${locale}"]`, {
      timeout: 3000,
    });
    await page.$eval(`#locale-picker [data-locale="${locale}"]`, (el) =>
      el.click(),
    );
    await page.waitForFunction(
      (l) => document.documentElement.lang === l,
      {},
      locale,
    );
    const result = await page.evaluate(async (locale) => {
      const { t, getLocale } = await import('/src/i18n/index.js');
      const p = window.__localeProof;
      const names = [...document.querySelectorAll('.data-name')];
      return {
        locale: getLocale(),
        names: names.length,
        nameFailures: names
          .map((el, i) => ({ actual: el.textContent, expected: t(p.names[i]) }))
          .filter((x) => x.actual !== x.expected),
        heading:
          document.querySelector('.locale-picker-heading').textContent ===
          t('Interface language'),
        runtime:
          document.querySelector('#locale-proof-text').textContent ===
          t('Saved to {store}', { store: 'My private vault' }),
        title:
          document.querySelector('#locale-proof-text').title ===
          t('Change the interface language'),
        draft:
          document.querySelector('#locale-proof-draft').value === 'Airports',
        raw:
          document.querySelector('#locale-proof-raw').textContent ===
          'Airports',
        viewer: p.viewer === window.__godsEyeView.viewer,
        camera: window.__godsEyeView.viewer.camera.position.equals(p.camera),
      };
    }, locale);
    console.log(JSON.stringify(result));
    assert.equal(result.locale, locale);
    assert.deepEqual(result.nameFailures, []);
    for (const key of [
      'heading',
      'runtime',
      'title',
      'draft',
      'raw',
      'viewer',
      'camera',
    ])
      assert.equal(result[key], true, `${locale} ${key}`);
    results.push(result);
  }
  await page.evaluate(() => document.querySelector('#locale-proof').remove());
  fs.mkdirSync('qa-artifacts/live-locale', { recursive: true });
  await page.screenshot({ path: 'qa-artifacts/live-locale/desktop.png' });
  await page.setViewport({ width: 390, height: 844 });
  await page.$eval('#locale-picker .locale-picker-button', (el) => el.click());
  await page.screenshot({ path: 'qa-artifacts/live-locale/mobile.png' });
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${results.length} locale switches; ${results[0].names} layer names each; no page errors`,
  );
} finally {
  await browser.close();
}
