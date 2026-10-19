# Chinese, Simplified (`zh-CN`)

Catalog: `src/i18n/locales/zh-CN.json`. General rules: [TRANSLATORS.md](../TRANSLATORS.md).

## Style

- 简体中文，面向中国大陆用户。用「你」称呼用户，不使用「您」，保持简洁一致的界面语气。
- 陈述句和祈使句使用动词原形：添加、开启、关闭、重试、粘贴、选择。
- 不要使用书名号或引号包裹按钮文字；界面元素名直接书写。
- 专有名词不加空格。中英文混排时，中文与拉丁字母、数字之间加一个半角空格：「加载 Google 3D Tiles」「放大 3 倍」。
- 短标签、状态条和 HUD 读数必须短。优先用缩写而不是换行：方向、距、高、速、时。
- HUD 代码 HDG、BRG、CRS、FOV、DEST、SPD、RANGE、ALT 保持英文，与飞机仪表一致。句子中的词语仍然翻译：heading → 航向，range → 距离。
- 键盘按键保持英文：Space、Esc、Enter、Tab、Shift、H、1–9（「按住 Space 说话」）。
- 全大写英文保持全大写：「LIVE」→「实时」，「NO DATA」→「无数据」，但若原文有视觉强调，使用中文加粗语气词或保持简洁：「UNAVAILABLE」→「不可用」，「LOADING」→「加载中」。
- 单位：km、m、km/h、kn（节）、ft（英尺）、h、min、s；全大写文本中为 KM、M、KM/H、KN、FT、MIN、H。MW 保持 MW。`°` 和 `%` 保留。
- 数字使用阿拉伯数字，千分位不加逗号：「5000」而不是「5,000」。
- 破折号和分隔符 `·`、`—`、`→`、`↗`、`…` 保留原样。

## Plurals

中文没有复数变化，`Intl.PluralRules('zh-CN')` 只返回 `other`，因此所有 `tn()` 条目只写 `other` 一种形式，并与英文 `other` 原文结构一致：

```json
{
  "{count} cameras": {
    "other": "{count} 个摄像头"
  }
}
```

## Glossary

| English                                       | 简体中文                                       |
| --------------------------------------------- | ---------------------------------------------- |
| layer / data layer                            | 图层 / 数据图层                                |
| feed / source / data source                   | 数据流 / 来源 / 数据源                         |
| LIVE (status) / live data                     | 实时 / 实时数据                                |
| SIMULATED                                     | 模拟                                           |
| stale / degraded / unavailable                | 数据陈旧 / 降级 / 不可用                       |
| retry / retrying                              | 重试 / 正在重试                                |
| key (API key) / POWER UP / POWERED UP         | 密钥 / 启动增强 / 已增强                       |
| Provider Settings                             | 提供商设置                                     |
| ON / OFF (state chips)                        | 开 / 关                                        |
| enable / disable                              | 启用 / 禁用                                    |
| globe / map / map source / map stack          | 地球 / 地图 / 地图源 / 地图图层组              |
| aircraft, plane / flight / military flights   | 飞机 / 航班 / 军机                             |
| vessel, ship                                  | 船舶                                           |
| satellite / shell (Starlink) / DENSE          | 卫星 / 轨道层 / 密集                           |
| launch (rocket) / launch site / space mission | 发射 / 发射场 / 太空任务                       |
| ascent / replay / payload / stage             | 上升段 / 回放 / 载荷 / 级                      |
| contact / tracking                            | 目标 / 跟踪                                    |
| installation / site                           | 设施 / 地点                                    |
| mapped / observed                             | 已测绘 / 已观测                                |
| camera / CCTV camera                          | 摄像头 / CCTV 摄像头                           |
| earthquake / active fire                      | 地震 / 活跃火点                                |
| radio station                                 | 电台                                           |
| road / flow (traffic)                         | 道路 / 车流                                    |
| scene / shot / scene recipe                   | 场景 / 镜头 / 场景配方                         |
| briefing / panel / dock                       | 简报 / 面板 / 停靠栏                           |
| cockpit                                       | 驾驶舱                                         |
| preset / visual preset                        | 预设 / 视觉预设                                |
| annotation / whiteboard                       | 标注 / 白板                                    |
| detection overlay                             | 检测叠加层                                     |
| terrain / elevation                           | 地形 / 高程                                    |
| turbulence                                    | 湍流                                           |
| weather / forecast / radar                    | 天气 / 预报 / 雷达                             |
| lightning                                     | 闪电                                           |
| cyclone / hurricane / typhoon                 | 气旋 / 飓风 / 台风                             |
| air quality                                   | 空气质量                                       |
| bikeshare / dock (bike)                       | 共享单车 / 停车桩                              |
| transit / route / stop                        | 公共交通 / 线路 / 站点                         |
| submarine cable / landing                     | 海底光缆 / 登陆点                              |
| street level / street view                    | 街景 / 街景视图                                |
| share link                                    | 分享链接                                       |
| Director                                      | 导演模式                                       |
| voice / microphone                            | 语音 / 麦克风                                  |
| hold / press / click / select                 | 按住 / 按下 / 点击 / 选择                      |
| search                                        | 搜索                                           |
| zoom in / zoom out                            | 放大 / 缩小                                    |
| tilt / north up / reset                       | 倾斜 / 正北朝上 / 重置                         |
| save / cancel / close                         | 保存 / 取消 / 关闭                             |
| loading / loaded                              | 加载中 / 已加载                                |
| error / warning / failed                      | 错误 / 警告 / 失败                             |
| connected / disconnected                      | 已连接 / 已断开                                |
| time (age) / updated                          | 时间 / 已更新                                  |
