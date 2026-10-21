import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4198';
const file = '.gev-moving-targets-fixture.html';
fs.writeFileSync(
  file,
  `<!doctype html><html><head><link rel="stylesheet" href="/node_modules/cesium/Build/Cesium/Widgets/widgets.css"><link rel="stylesheet" href="/src/ui/styles/foundation.css"><style>html,body,#globe{width:100%;height:100%;margin:0;overflow:hidden}</style></head><body><div id="globe"></div><script type="module">
import * as C from 'cesium';
import {aircraftIcon} from '/src/data/aircraftIcons.js';
import {createTargetMarkerLayout} from '/src/overlays/markerLayout.js';
import {registerMovingTarget,getMovingTargetPresentation} from '/src/overlays/movingTargetPresentation.js';
import {initWorldOverlay} from '/src/overlays/worldOverlay.js';
import {initDetection,setMode,getDetectionDiagnostics} from '/src/data/detection.js';
const v=new C.Viewer('globe',{baseLayer:false,timeline:false,animation:false,baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,selectionIndicator:false,infoBox:false,skyBox:false});
v.scene.globe.baseColor=C.Color.fromCssColorString('#10243b');
const bb=v.scene.primitives.add(new C.BillboardCollection());
const pts=v.scene.primitives.add(new C.PointPrimitiveCollection());
const objects=[];
for(let i=0;i<48;i++){
 const type=i<32?'AIR':'SAT';
 const position=C.Cartesian3.fromDegrees(20+(i%8-3.5)*.03,10+(Math.floor(i/8)-2.5)*.03,11000);
 const sprite=type==='AIR'?bb.add({id:'air-'+i,position,image:aircraftIcon('airliner'),width:20,height:20,color:C.Color.CYAN,disableDepthTestDistance:Infinity}):pts.add({id:40000+i,position,pixelSize:8,color:C.Color.YELLOW,disableDepthTestDistance:Infinity});
 registerMovingTarget(sprite,type);
 const obj={position,sourceId:sprite.id,id:type+' '+i,type,movingKind:type};
 obj[type==='AIR'?'billboard':'pointPrimitive']=sprite;objects.push(obj);
}
let selected;
const dispose=createTargetMarkerLayout(v,{getObstacles:()=>[],getSelectedId:()=>selected});
initWorldOverlay(v);initDetection(v,[{id:'flights',getDetectableObjects:()=>objects.filter(o=>o.type==='AIR')},{id:'satellites',getDetectableObjects:()=>objects.filter(o=>o.type==='SAT')}],()=>{});setMode('DENSE');
function zoom(height){v.camera.setView({destination:C.Cartesian3.fromDegrees(20,10,height),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});v.scene.requestRender();}
zoom(50000000);
window.qa={v,objects,zoom,getDetectionDiagnostics,select(id){selected=id;v.scene.requestRender();},read(){return objects.map(o=>{const frame=getMovingTargetPresentation(o.billboard||o.pointPrimitive).frame;return {id:o.sourceId,type:o.type,visible:frame.visible,level:frame.level,width:frame.visual?.width,selected:frame.selected,show:frame.visual?.show};});},pick(){const sprite=getMovingTargetPresentation(objects[0].billboard).frame.visual;const p=sprite.computeScreenSpacePosition(v.scene);for(let x=-12;x<=12;x+=2)for(let y=-12;y<=12;y+=2){if(v.scene.pick({x:p.x+x,y:p.y+y})?.id==='air-0')return 'air-0';}return null;},dispose};
</script></body></html>`,
);
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  const errors = [],
    requests = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('PAGE ERROR', e.message);
  });
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(r.url());
  });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(base + '/' + file, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.qa?.read().every((o) => o.visible));
  async function check(height, airLevel, satLevel, label) {
    await page.evaluate((h) => qa.zoom(h), height);
    await page.waitForFunction(
      ([a, s]) => {
        const rows = qa.read();
        return (
          rows.length === 48 &&
          rows.every((o) => o.visible && o.show) &&
          rows.some((o) => o.type === 'AIR' && o.level === a) &&
          rows.some((o) => o.type === 'SAT' && o.level === s)
        );
      },
      { timeout: 30000 },
      [airLevel, satLevel],
    );
    console.log(
      '[PASS]',
      label,
      JSON.stringify(
        await page.evaluate(() =>
          qa
            .read()
            .reduce(
              (n, o) => (
                (n[o.type + o.level] = (n[o.type + o.level] || 0) + 1),
                n
              ),
              {},
            ),
        ),
      ),
    );
  }
  fs.mkdirSync('qa-shots/moving-targets', { recursive: true });
  await check(50000000, 0, 0, 'global overview retains all targets as points');
  await page.screenshot({ path: 'qa-shots/moving-targets/overview.png' });
  await check(7000000, 0, 1, 'orbital overview reveals compact satellites');
  await check(
    700000,
    1,
    0,
    'regional view reveals aircraft icons while crowded satellites remain points',
  );
  await check(
    70000,
    2,
    2,
    'close view reveals detailed aircraft and satellites',
  );
  await page.waitForFunction(
    () => qa.getDetectionDiagnostics()?.calloutRects.length > 0,
  );
  assert.equal(
    await page.evaluate(() => qa.getDetectionDiagnostics().visibleCount),
    0,
    'ordinary targets do not all get selection brackets',
  );
  await page.screenshot({ path: 'qa-shots/moving-targets/detail.png' });
  await check(50000000, 0, 0, 'zooming back out preserves every record');
  await page.waitForFunction(
    () => qa.getDetectionDiagnostics()?.calloutRects.length === 0,
  );
  await page.evaluate(() => qa.select('air-0'));
  await page.waitForFunction(
    () =>
      qa.read()[0].selected &&
      qa.read()[0].level === 2 &&
      qa.getDetectionDiagnostics()?.visibleCount === 1,
  );
  assert.equal(
    await page.evaluate(() => qa.pick()),
    'air-0',
    'selected overview point keeps native identity',
  );
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await check(
    70000,
    2,
    2,
    'high-DPI compact viewport preserves target coverage',
  );
  await page.screenshot({ path: 'qa-shots/moving-targets/mobile.png' });
  assert.deepEqual(requests, [], 'zoom causes no feed requests');
  assert.deepEqual(errors, []);
  console.log(
    '[PASS] selected highlight, native picking, stale-label cleanup, zero feed requests and no JavaScript exceptions',
  );
} finally {
  await browser.close();
  fs.unlinkSync(file);
}
