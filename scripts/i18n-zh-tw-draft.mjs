// Draft zh-TW from the finished zh-CN catalogue.
//
//   node scripts/i18n-zh-tw-draft.mjs
//
// Two passes: Taiwan vocabulary first (longest term wins), then the
// character table in i18n-han-traditional.mjs, which covers every Han
// character the simplified catalogue uses. The output is a draft:
// `npm run i18n` decides whether it ships, and docs/translations/zh-TW.md
// lists the vocabulary.
import { readFileSync, writeFileSync } from 'node:fs';
import { HAN_TO_TRADITIONAL } from './i18n-han-traditional.mjs';

const SOURCE = 'src/i18n/locales/zh-CN.json';
const TARGET = 'src/i18n/locales/zh-TW.json';

/* Mainland term → the term readers in Taiwan expect. */
const VOCABULARY = [
  ['摄像头', '攝影機'],
  ['摄像机', '攝影機'],
  ['视频', '影片'],
  ['录像', '錄影'],
  ['数据', '資料'],
  ['数据库', '資料庫'],
  ['网络', '網路'],
  ['软件', '軟體'],
  ['硬件', '硬體'],
  ['信息', '資訊'],
  ['默认', '預設'],
  ['配置', '設定'],
  ['菜单', '選單'],
  ['界面', '介面'],
  ['鼠标', '滑鼠'],
  ['打印', '列印'],
  ['程序', '程式'],
  ['代码', '程式碼'],
  ['文件', '檔案'],
  ['文件夾', '资料夾'],
  ['数据源', '資料來源'],
  ['数据流', '資料流'],
  ['数据图层', '資料圖層'],
  ['绘制', '繪製'],
  ['刷新', '重新整理'],
  ['加载', '載入'],
  ['保存', '儲存'],
  ['存储', '儲存'],
  ['粘贴', '貼上'],
  ['复制', '複製'],
  ['质量', '品質'],
  ['噪声', '雜訊'],
  ['公交', '公車'],
  ['地铁', '捷運'],
  ['自行车', '腳踏車'],
  ['航天', '航太'],
  ['宇航', '太空'],
  ['激光', '雷射'],
  ['情报', '情報'],
  ['移动', '行動'],
  ['拖动', '拖曳'],
  ['拖拽', '拖曳'],
  ['点击', '點擊'],
  ['键盘', '鍵盤'],
  ['实时', '即時'],
  ['在线', '線上'],
  ['离线', '離線'],
  ['服务器', '伺服器'],
  ['云', '雲'],
  ['屏幕', '螢幕'],
  ['分辨率', '解析度'],
  ['高清', '高畫質'],
  ['带宽', '頻寬'],
  ['频道', '頻道'],
  ['无线', '無線'],
  ['过滤器', '篩選器'],
  ['筛选', '篩選'],
];

const toTaiwan = (text) => {
  let out = text;
  for (const [from, to] of [...VOCABULARY].sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    out = out.split(from).join(to);
  }
  return [...out].map((char) => HAN_TO_TRADITIONAL[char] ?? char).join('');
};

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const draft = {};

for (const [key, value] of Object.entries(source)) {
  draft[key] =
    typeof value === 'string'
      ? toTaiwan(value)
      : Object.fromEntries(
          Object.entries(value).map(([form, text]) => [form, toTaiwan(text)]),
        );
}

writeFileSync(TARGET, `${JSON.stringify(draft, null, 2)}\n`);
console.log(`zh-TW draft: ${Object.keys(draft).length} entries`);
