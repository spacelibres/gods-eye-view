# Japanese (`ja`)

Catalog: `src/i18n/locales/ja.json`. General rules: [TRANSLATORS.md](../TRANSLATORS.md).

## Style

- です・ます調を基本に、ボタンや操作は簡潔な体言止めまたは「〜してください」で書く。
- 一文を短く保つ。英語の長い一文は二文に分けてよいが、意味は落とさない。
- 全角と半角の間に空白は入れない（日本語の組版に従う）。ただし英字コードの前後は読みやすさを優先して半角スペースを入れてよい。
- 中黒 `·`、ダッシュ `—`、矢印 `→` `↗`、省略記号 `…` は原形を保つ。
- 短いラベル、チップ、HUD の読み取り値は短く保つ。折り返すより標準的な略語を選ぶ。
- HUD コード HDG、BRG、CRS、FOV、DEST、SPD、RANGE、ALT は英語のまま（航空計器の慣習）。文中の語は翻訳する: heading → 方位、range → 距離。
- キーボードキーは英語のまま: Space、Esc、Enter、Tab、Shift、H、1–9。
- 単位は SI 表記: km、m、km/h、kn（ノット）、ft、h、min、s。`°` と `%` はそのまま。
- 全大文字の英語は、強調として読める日本語にする。「LIVE」→「ライブ」、「UNAVAILABLE」→「利用不可」、「LOADING」→「読み込み中」。

## Plurals

日本語に複数形はなく、`Intl.PluralRules('ja')` は `other` のみ返す。`tn()` の項目は `other` 一つだけ書く。

## Numbers and dates

数字は算用数字。桁区切りは言語設定に任せ、ここで固定しない。日時は `formatDate` と `formatRelativeTime` を使う。

## Glossary

| English | 日本語 |
| --- | --- |
| layer / data layer | レイヤー / データレイヤー |
| feed | フィード |
| source / data source | ソース / データソース |
| LIVE (status) / live data | ライブ / ライブデータ |
| SIMULATED | シミュレーション |
| stale / degraded / unavailable | 古い / 低下 / 利用不可 |
| retry / retrying | 再試行 / 再試行中 |
| key (API key) / POWER UP / POWERED UP | キー / パワーアップ / パワーアップ済み |
| Provider Settings | プロバイダー設定 |
| ON / OFF (state chips) | オン / オフ |
| enable / disable | 有効化 / 無効化 |
| globe / map / map source | 地球儀 / 地図 / 地図ソース |
| aircraft, plane / flight / military flights | 航空機 / フライト / 軍用機 |
| vessel, ship / vessels | 船舶 |
| satellite / shell (Starlink) | 衛星 / シェル |
| launch (rocket) / launch site / space mission | 打ち上げ / 射場 / スペースミッション |
| ascent / replay / payload / stage | 上昇 / リプレイ / ペイロード / 段 |
| contact / tracking | コンタクト / 追跡 |
| installation / site | 施設 / 地点 |
| mapped / observed | 地図上の / 観測済み |
| camera / CCTV camera | カメラ / CCTV カメラ |
| earthquake / active fire | 地震 / 発生中の火災 |
| radio station | ラジオ局 |
| road / flow (traffic) | 道路 / 交通量 |
| scene / shot / scene recipe | シーン / ショット / シーンレシピ |
| briefing / panel / dock | ブリーフィング / パネル / ドック |
| cockpit | コックピット |
| preset / visual preset | プリセット / ビジュアルプリセット |
| annotation / whiteboard | 注釈 / ホワイトボード |
| detection overlay | 検出オーバーレイ |
| terrain / elevation | 地形 / 標高 |
| weather / forecast / radar | 気象 / 予報 / レーダー |
| lightning | 落雷 |
| cyclone / hurricane / typhoon | サイクロン / ハリケーン / 台風 |
| air quality | 大気質 |
| bikeshare / dock (bike) | シェアサイクル / 駐輪場 |
| transit / route / stop | 公共交通 / 路線 / 停留所 |
| submarine cable / landing | 海底ケーブル / 陸揚げ点 |
| street level / street view | ストリートレベル / ストリートビュー |
| share link | 共有リンク |
| Director | ディレクターモード |
| voice / microphone | 音声 / マイク |
| hold / press / click / select | 押したまま / 押す / クリック / 選択 |
| zoom in / zoom out | 拡大 / 縮小 |
| tilt / north up / reset | 傾ける / 北が上 / リセット |
| save / cancel / close | 保存 / キャンセル / 閉じる |
| loading / loaded | 読み込み中 / 読み込み済み |
| error / warning / failed | エラー / 警告 / 失敗 |
| connected / disconnected | 接続済み / 切断 |
| updated | 更新済み |
