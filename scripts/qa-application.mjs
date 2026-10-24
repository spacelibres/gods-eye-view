#!/usr/bin/env node
/** Prove startup, hidden credits in all layouts/modes, and terminal teardown.
 * Run against npm run dev: node scripts/qa-application.mjs --url http://localhost:4173
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const url = urlIndex >= 0 ? args[urlIndex + 1] : 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  const externalFonts = [];
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) {
      externalFonts.push(request.url());
      void request.abort();
    } else {
      void request.continue();
    }
  });
  const errors = [];
  page.on('console', (message) => {
    if (
      message.type() === 'warn' &&
      /^\[Data\].*(?:destroy|disable) error:/.test(message.text())
    ) {
      console.log(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  await page.goto(`${url}/?welcome=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__godsEyeView?.voiceCommands, {
    timeout: 60_000,
  });
  const before = await page.evaluate(async () => {
    const entry = [...document.scripts].find((script) =>
      /\/src\/main\.js(?:\?|$)/.test(script.src),
    );
    const { application } = await import(entry.src);
    window.__qaApplication = application;
    const app = window.__godsEyeView;
    window.__qaComponents = app;
    await application.start();
    await app.styleManager.initialRestorePromise;
    const enabled = await app.dataManager.setEnabled('local-datacenters', true);
    const annotation = await app.annotations.annotate([
      {
        type: 'pin',
        longitude: -97.74,
        latitude: 30.27,
        label: 'Lifecycle check',
      },
    ]);
    return {
      status: application.getState().status,
      enabled,
      layers: app.dataManager.layers.size,
      annotationCount: annotation.drawn,
      viewerAlive: !app.viewer.isDestroyed(),
      credits: Boolean(document.querySelector('#cesium-credits')),
    };
  });
  assert.equal(before.status, 'ready');
  assert.equal(before.enabled, true);
  assert.ok(before.layers >= 16);
  assert.equal(before.annotationCount, 1);
  assert.equal(before.viewerAlive, true);
  assert.equal(before.credits, true);
  console.log(
    'PASS: startup, data registration, annotations and retained credit inventory',
  );

  const fonts = await page.evaluate(async () => {
    const families = ['Inter', 'JetBrains Mono', 'Material Symbols Outlined'];
    const loaded = await Promise.all(
      families.map(async (family) => {
        const faces = await document.fonts.load(
          `24px "${family}"`,
          family.startsWith('Material') ? 'radar' : 'Hello',
        );
        return (
          faces.length > 0 && faces.every((face) => face.status === 'loaded')
        );
      }),
    );
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = '24px "Material Symbols Outlined"';
    return { loaded, iconWidth: context.measureText('radar').width };
  });
  assert.deepEqual(fonts.loaded, [true, true, true]);
  assert.ok(
    fonts.iconWidth <= 26,
    'radar must form one icon instead of five letters',
  );
  assert.deepEqual(externalFonts, []);
  console.log(
    'PASS: all UI font families and icon ligatures load with Google font hosts blocked',
  );

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewport(viewport);
    for (const mode of ['', 'ui-clean-view', 'recording-mode']) {
      const creditState = await page.evaluate((mode) => {
        document.body.classList.toggle(
          'ui-clean-view',
          mode === 'ui-clean-view',
        );
        document.body.classList.toggle(
          'recording-mode',
          mode === 'recording-mode',
        );
        const credits = document.getElementById('cesium-credits');
        return {
          mounted: Boolean(credits),
          display: getComputedStyle(credits).display,
          rectangles: credits.getClientRects().length,
          visibleChildren: [...credits.querySelectorAll('a, img')].filter(
            (node) => node.getClientRects().length > 0,
          ).length,
        };
      }, mode);
      assert.deepEqual(creditState, {
        mounted: true,
        display: 'none',
        rectangles: 0,
        visibleChildren: 0,
      });
      console.log(
        `PASS: hidden credits ${viewport.width}px ${mode || 'normal'}`,
      );
    }
  }
  await page.evaluate(() => {
    document.body.classList.remove('ui-clean-view', 'recording-mode');
  });

  const after = await page.evaluate(async () => {
    const application = window.__qaApplication;
    const app = window.__qaComponents;
    const first = application.destroy();
    const samePromise = first === application.destroy();
    await first.catch((error) => {
      const describe = (failure) =>
        failure.errors?.map(describe).join('; ') || failure.message;
      throw new Error(describe(error));
    });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('resize'));
    app.requestRender('after-destroy');
    await new Promise((resolve) => setTimeout(resolve, 1400));
    return {
      status: application.getState().status,
      samePromise,
      viewerDestroyed: app.viewer.isDestroyed(),
      layers: app.dataManager.layers.size,
      annotations: app.annotations.count(),
      governor: app.getRenderGovernorDiagnostics(),
      handlesRemoved:
        !window.__godsEyeView &&
        !window.__gevVoiceCommands &&
        !window.__gevAnnotations,
      creditsRemoved: !document.querySelector('#cesium-credits'),
      welcomeHidden: !document.querySelector('#first-run-launcher.visible'),
      settingsRemoved: !document.querySelector('#key-setup'),
    };
  });
  assert.equal(after.status, 'destroyed');
  assert.equal(after.samePromise, true);
  assert.equal(after.viewerDestroyed, true);
  assert.equal(after.layers, 0);
  assert.equal(after.annotations, 0);
  assert.equal(after.governor.installed, false);
  assert.deepEqual(after.governor.holds, []);
  assert.equal(after.handlesRemoved, true);
  assert.equal(after.creditsRemoved, true);
  assert.equal(after.welcomeHidden, true);
  assert.equal(after.settingsRemoved, true);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: terminal teardown releases runtime owners without late browser errors',
  );
} finally {
  await browser.close();
}
