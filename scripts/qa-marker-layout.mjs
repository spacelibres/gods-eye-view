import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4198';
const file = '.gev-marker-layout-fixture.html';
fs.writeFileSync(
  file,
  `<!doctype html><html><head><link rel="stylesheet" href="/node_modules/cesium/Build/Cesium/Widgets/widgets.css"><style>html,body,#globe{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="globe"></div><script type="module">
import * as C from 'cesium';
import {createTargetMarkerLayout,visitTargetSprites} from '/src/overlays/markerLayout.js';
import {airportSymbol} from '/src/layers/airports/symbols.js';
const v=new C.Viewer('globe',{baseLayer:false,timeline:false,animation:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,selectionIndicator:false,infoBox:false,skyBox:false});
v.scene.globe.baseColor=C.Color.fromCssColorString('#10243b');
v.scene.backgroundColor=C.Color.fromCssColorString('#10243b');
v.camera.setView({destination:C.Cartesian3.fromDegrees(20,10,150000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
const bb=v.scene.primitives.add(new C.BillboardCollection());
const pts=v.scene.primitives.add(new C.PointPrimitiveCollection());
const position=C.Cartesian3.fromDegrees(20.65,9.7,1000);
const groupPosition=i=>C.Cartesian3.fromDegrees(19.55+(i%3)*.4,9.8+Math.floor(i/3)*.4,1000);
for(let i=0;i<18;i++)bb.add({id:'target-'+i,position:groupPosition(i%6),image:airportSymbol({type:i%3===0?'heliport':'large_airport'},i%2?'civil':'military').image,width:28,height:28,color:C.Color.fromHsl(i/18,.8,.65),disableDepthTestDistance:Infinity});
for(let i=0;i<6;i++)pts.add({id:'point-'+i,position:C.Cartesian3.fromDegrees(19.6+i*.2,10.45,1000),pixelSize:18,color:C.Color.fromHsl(i/6,.8,.65),disableDepthTestDistance:Infinity});
const ds=new C.CustomDataSource('qa-entities');await v.dataSources.add(ds);
const entity=ds.entities.add({id:'entity-airport',position,billboard:{image:airportSymbol({type:'large_airport'},'civil').image,width:28,height:28,disableDepthTestDistance:Infinity}});
let selected='target-0';
// Real scene regression: boolean lifecycle flags are legal on custom primitives.
const custom=v.scene.primitives.add({show:true,isDestroyed(){return false;},update(){},length:1,get(){return {show:true,isDestroyed:false};}});
const dispose=createTargetMarkerLayout(v,{getObstacles:()=>[],getSelectedId:()=>selected});
window.qa={v,bb,pts,ds,entity,dispose,visitTargetSprites,select(id){selected=id;v.scene.requestRender();},read(){const rects=[];visitTargetSprites(v.scene.primitives,(s,c,point)=>{if(point||!s.show||!s.clusterShow||(s.translucencyByDistance?.nearValue===0&&s.translucencyByDistance?.farValue===0))return;const p=s.computeScreenSpacePosition(v.scene);rects.push({id:s.id?.id||s.id,x:p.x,y:p.y,size:Math.max(s.width||32,s.height||32)*s.scale});});return rects;},move(){v.camera.setView({destination:C.Cartesian3.fromDegrees(20,10.15,200000),orientation:{heading:.2,pitch:-1.5,roll:0}});}};
</script></body></html>`,
);
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const settle = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const v = window.qa.v;
        v.resize();
        let frames = 0;
        const remove = v.scene.postRender.addEventListener(() => {
          if (++frames >= 2) {
            remove();
            resolve();
          } else v.scene.requestRender();
        });
        v.scene.requestRender();
      }),
  );
const check = async (label) => {
  await page.waitForFunction(
    () => window.qa?.read().length >= 8 && window.qa?.read().length <= 13,
    {
      timeout: 30000,
    },
  );
  const rects = await page.evaluate(() => qa.read());
  for (const [i, a] of rects.entries())
    for (const b of rects.slice(i + 1))
      assert.ok(
        Math.abs(a.x - b.x) >= (a.size + b.size) / 2 - 0.5 ||
          Math.abs(a.y - b.y) >= (a.size + b.size) / 2 - 0.5,
        JSON.stringify({ a, b }),
      );
  console.log('[PASS]', label, rects.length);
};
try {
  await page.setViewport({ width: 1000, height: 750 });
  await page.goto(base + '/' + file);
  await check('25 source targets thin to spatially separated representatives');
  assert.ok(
    await page.evaluate(
      () =>
        Number(
          document.querySelector('.target-marker-leaders').dataset
            .displacedCount,
        ) >= 1,
    ),
  );
  await page.waitForFunction(() => {
    let ready = true;
    qa.visitTargetSprites(qa.v.scene.primitives, (s, c) => {
      if (c.ready === false) ready = false;
    });
    qa.v.scene.requestRender();
    return ready;
  });
  const picks = await page.evaluate(() => {
    const v = qa.v;
    return ['target-0', 'target-1', 'point-0', 'entity-airport'].map((id) => {
      const p = qa.read().find((p) => p.id === id);
      for (let x = -8; x <= 8; x += 2)
        for (let y = -8; y <= 8; y += 2) {
          const pick = v.scene.pick({ x: p.x + x, y: p.y + y });
          if ((pick?.id?.id || pick?.id) === id) return id;
        }
      return null;
    });
  });
  console.log('Pick results:', picks);
  assert.equal(picks.filter(Boolean).length, 4);
  console.log(
    '[PASS] displaced native entity and point targets retain pick identity',
    picks,
  );
  fs.mkdirSync('qa-shots/markers', { recursive: true });
  await page.screenshot({ path: 'qa-shots/markers/desktop.png' });
  await page.evaluate(() => qa.move());
  await settle();
  await check('camera orbit and zoom recompute collision layout');
  await page.setViewport({ width: 390, height: 844 });
  await settle();
  await check('mobile targets remain separated');
  await page.screenshot({ path: 'qa-shots/markers/mobile.png' });
  await page.evaluate(() => {
    qa.v.scene.primitives.remove(qa.pts);
    qa.v.scene.requestRender();
  });
  await page.waitForFunction(
    () =>
      qa.read().length <= 7 &&
      qa.read().every((p) => !String(p.id).startsWith('point-')),
  );
  console.log('[PASS] destroying point source removes every pickable proxy');
  await page.evaluate(() => {
    qa.bb.show = false;
    qa.ds.show = false;
    qa.v.scene.requestRender();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.target-marker-leaders').dataset.visibleCount ===
      '0',
  );
  console.log('[PASS] disabling sources removes target proxies and leaders');
  await page.evaluate(() => qa.dispose());
  assert.equal(await page.$('.target-marker-leaders'), null);
  assert.deepEqual(errors, []);
  console.log(
    '[PASS] teardown removes leader canvas and no JavaScript exceptions',
  );
} catch (error) {
  console.log(
    'QA diagnostics:',
    await page.evaluate(() => ({
      ready: !!window.qa,
      rects: window.qa?.read(),
      canvas: document.querySelector('.target-marker-leaders')?.dataset,
      errors: document.querySelector('.cesium-widget-errorPanel')?.textContent,
    })),
  );
  await page.screenshot({ path: 'qa-shots/markers/failure.png' });
  throw error;
} finally {
  await browser.close();
  fs.unlinkSync(file);
}
