# Chinese, Traditional — Taiwan (`zh-TW`)

Catalog: `src/i18n/locales/zh-TW.json`. General rules: [TRANSLATORS.md](../TRANSLATORS.md).

## Style

- 繁體中文，以台灣用語為準。用「你」稱呼使用者，與簡體中文保持一致。
- 專有名詞不加空格。中文與拉丁字母、數字之間加一個半形空格：「載入 Google 3D Tiles」「放大 3 倍」。
- 短標籤、狀態列與 HUD 讀數必須簡短。優先用縮寫而不是換行。
- HUD 代碼 HDG、BRG、CRS、FOV、DEST、SPD、RANGE、ALT 保持英文，與飛機儀表一致。
- 鍵盤按鍵保持英文：Space、Esc、Enter、Tab、Shift、H、1–9（「按住 Space 說話」）。
- 單位：km、m、km/h、kn（節）、ft（英呎）、h、min、s；全大寫文本中為 KM、M、KM/H、KN、FT、MIN、H。MW 保持 MW。`°` 和 `%` 保留。
- 分隔符號 `·`、`—`、`→`、`↗`、`…` 保留原樣。

## Plurals

中文沒有複數變化，`Intl.PluralRules('zh-TW')` 只回傳 `other`，因此所有 `tn()` 條目只寫 `other` 一種形式。

## Vocabulary

台灣與大陸用語不同。以下是本目錄採用的對照：

| English | 中国大陆 | 台灣 |
| --- | --- | --- |
| camera / CCTV camera | 摄像头 | 攝影機 |
| data / data source / data layer | 数据 / 数据源 / 数据图层 | 資料 / 資料來源 / 資料圖層 |
| network | 网络 | 網路 |
| software / hardware | 软件 / 硬件 | 軟體 / 硬體 |
| information | 信息 | 資訊 |
| default / settings | 默认 / 配置 | 預設 / 設定 |
| menu / interface | 菜单 / 界面 | 選單 / 介面 |
| mouse | 鼠标 | 滑鼠 |
| print | 打印 | 列印 |
| program / code | 程序 / 代码 | 程式 / 程式碼 |
| file / folder | 文件 / 文件夹 | 檔案 / 資料夾 |
| refresh | 刷新 | 重新整理 |
| search | 搜索 | 搜尋 |
| load / save / storage | 加载 / 保存 / 存储 | 載入 / 儲存 / 儲存 |
| paste / copy | 粘贴 / 复制 | 貼上 / 複製 |
| server | 服务器 | 伺服器 |
| screen | 屏幕 | 螢幕 |
| resolution | 分辨率 | 解析度 |
| video | 视频 | 影片 |
| live (status) | 实时 | 即時 |
| click / drag | 点击 / 拖动 | 點擊 / 拖曳 |
| metro / subway | 地铁 | 捷運 |
| bicycle | 自行车 | 腳踏車 |
| aerospace | 航天 | 航太 |
| laser | 激光 | 雷射 |
| filter | 筛选 | 篩選 |

## Glossary

| English | 繁體中文 |
| --- | --- |
| layer / data layer | 圖層 / 資料圖層 |
| feed | 資料流 |
| source | 來源 |
| LIVE (status) / live data | 即時 / 即時資料 |
| SIMULATED | 模擬 |
| stale / degraded / unavailable | 資料陳舊 / 降級 / 不可用 |
| retry / retrying | 重試 / 正在重試 |
| key (API key) / POWER UP / POWERED UP | 金鑰 / 啟動增強 / 已增強 |
| Provider Settings | 供應商設定 |
| ON / OFF (state chips) | 開 / 關 |
| enable / disable | 啟用 / 停用 |
| globe / map / map source | 地球 / 地圖 / 地圖來源 |
| aircraft, plane / flight / military flights | 飛機 / 航班 / 軍機 |
| vessel, ship | 船舶 |
| satellite / shell (Starlink) | 衛星 / 軌道層 |
| launch (rocket) / launch site / space mission | 發射 / 發射場 / 太空任務 |
| contact / tracking | 目標 / 追蹤 |
| installation / site | 設施 / 地點 |
| mapped / observed | 已測繪 / 已觀測 |
| earthquake / active fire | 地震 / 活躍火點 |
| radio station | 電台 |
| road / flow (traffic) | 道路 / 車流 |
| scene / shot / scene recipe | 場景 / 鏡頭 / 場景配方 |
| briefing / panel / dock | 簡報 / 面板 / 停駐列 |
| cockpit | 駕駛艙 |
| preset / visual preset | 預設 / 視覺預設 |
| annotation / whiteboard | 標註 / 白板 |
| detection overlay | 偵測疊加層 |
| terrain / elevation | 地形 / 高程 |
| weather / forecast / radar | 天氣 / 預報 / 雷達 |
| lightning | 閃電 |
| cyclone / hurricane / typhoon | 氣旋 / 颶風 / 颱風 |
| air quality | 空氣品質 |
| bikeshare / dock (bike) | 共享單車 / 停車樁 |
| transit / route / stop | 大眾運輸 / 路線 / 站點 |
| submarine cable / landing | 海底電纜 / 登陸點 |
| street level / street view | 街景 / 街景檢視 |
| share link | 分享連結 |
| Director | 導演模式 |
| voice / microphone | 語音 / 麥克風 |
| hold / press / click / select | 按住 / 按下 / 點擊 / 選取 |
| zoom in / zoom out | 放大 / 縮小 |
| tilt / north up / reset | 傾斜 / 正北朝上 / 重設 |
| save / cancel / close | 儲存 / 取消 / 關閉 |
| loading / loaded | 載入中 / 已載入 |
| error / warning / failed | 錯誤 / 警告 / 失敗 |
| connected / disconnected | 已連線 / 已中斷 |
| updated | 已更新 |

## Drafting

`scripts/i18n-zh-tw-draft.mjs` regenerates this catalogue from `zh-CN.json`
through the vocabulary above and the character table in
`scripts/i18n-han-traditional.mjs`. Re-run it after a large change to the
simplified catalogue, then read the diff before committing.
