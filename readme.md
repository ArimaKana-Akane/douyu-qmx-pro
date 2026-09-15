# 斗鱼全民星推荐助手（修复版）

[![版本](https://img.shields.io/badge/Version-2.1.2-blue.svg)](https://github.com/ArimaKana-Akane/douyu-qmx-pro/releases/latest)
[![许可证](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![原作者](https://img.shields.io/badge/Original-ysl--ovo-orange.svg)](https://greasyfork.org/zh-CN/users/1453821-ysl-ovo)

用于自动领取斗鱼【全民星推荐】活动红包的油猴脚本。

本仓库是 [ienone/douyu-qmx-pro](https://github.com/ienone/douyu-qmx-pro) 的 **fork**，
在上游基础上修复了导致「基础功能完全不可用」的问题，并补充了抽奖相关能力。
脚本本身基于 [ysl-ovo 的原版脚本](https://greasyfork.org/zh-CN/scripts/532514-%E6%96%97%E9%B1%BC%E5%85%A8%E6%B0%91%E6%98%9F%E6%8E%A8%E8%8D%90%E8%87%AA%E5%8A%A8%E9%A2%86%E5%8F%96) 二次开发。

> [!WARNING]
> 自动领取存在风控风险，即使数量不多也可能触发限制。脚本只能提示疑似风控，
> **不会自动停止领取**，也无法保证账号安全。请自行判断是否使用。

> [!IMPORTANT]
> **如果你从上游仓库安装，装到的是有问题的版本。** 详见下方「为什么需要这个 fork」。

---

## 安装

**一键安装（始终指向本 fork 的最新 Release）**：

```
https://github.com/ArimaKana-Akane/douyu-qmx-pro/releases/latest/download/douyu-qmx-star.user.js
```

或者打开 [Releases 页面](https://github.com/ArimaKana-Akane/douyu-qmx-pro/releases/latest) 手动下载 `.user.js` 文件。

脚本声明了 `@updateURL`，安装后会从本 fork 自动更新，不会被上游拉回旧版本。

---

## 为什么需要这个 fork

上游 `v2.1.0-beta.1` 在 2025 年上线后，斗鱼改版导致脚本的核心功能**全部失效**。
本 fork 修复了这些问题（共四轮）。

### 一个版本陷阱

上游的发布状态容易让人装错版本：

| 版本 | 发布类型 | `releases/latest` 是否指向它 |
|---|---|---|
| `v2.0.9` | Latest | ✅ 是 |
| `v2.1.0-beta.1` | Pre-release | ❌ 否 |

因此从 `releases/latest` 安装会拿到 **v2.0.9 旧版**，比 `v2.1.0` 还老。
本 fork 的版本号从 `2.1.1` 起，就是为了避开这个坑
（沿用 `2.1.0` 会被篡改猴判为降级而拒绝安装）。

### 修复清单

| 轮次 | 问题 | 影响 |
|---|---|---|
| 1 | **CSRF 解析失效** | 斗鱼新版页面不再输出 `window.$SYS`，`getDynamicCsrf()` 抛错 → **所有 POST 接口不可用**（`snatch` / `square/read` / `lottery/do`）。改为四级降级，从 Cookie 反推 |
| 1 | **设置完全无法保存** | `resolveRoomIdentity` 依赖已消失的 `window.room_id`，解析失败时 `save()` 提前返回，**所有设置都存不下**。改为多来源解析 |
| 1 | **`BUILD_FLAVOR` 失效** | 被硬编码为 `star-only`，三种构建互相覆盖、产物相同 |
| 2 | **后台页过早关闭** | 默认 3 秒就关页，但服务端活动上下文需要更久才建立 → `snatch` **恒返回 12006，且静默失败**（只表现为「领不到」，不报错）。改为保持打开直到本次领取有结果 |
| 3 | 缺少更新地址 | 补 `@updateURL` / `@downloadURL`，版本升至 `2.1.1` |
| 4 | 抽奖体验问题 | 首次检查要干等 60 秒才执行；阈值写死 100 不可调。见下方「自动抽奖」 |

修复依据均为现网实测，完整过程与证据见
[`docs/DOUYU_REDPACKET_API.md`](docs/DOUYU_REDPACKET_API.md)。

---

## 红包领取链路

脚本采用**服务端状态机领取**，不使用 DOM 点击：

1. `square/list` 发现候选房间，再有限并发查询候选的 `room/list`，
   按金币与星光棒奖池总量从高到低建立房间队列。
2. 通过 `room/list` 锁定奖池最大的 `rid/id/code`，
   在**后台打开目标直播间并保持打开**，直到本次领取有结论才关闭。
3. 根据 `waitSec` 安排最多 5 次 `snatch`。
   首次尝试时机：90 秒档约在开页后 45 秒，300/600 秒档约在 2/3 处
   （即 200 / 400 秒），后续集中在标称结束时间附近，相邻尝试至少间隔 10 秒。
4. `waitSec` 只用于粗略调度，真正可领状态以 `snatch` 响应为准。
5. 错误码：`12006` 尚未开放、`error=0` 成功、`12001` 或 `status=3` 按已派完处理。
   若 30 分钟内连续 3 个不同红包首次请求都返回 `12001`，只显示「疑似账户风控」，不停止领取。

DevTools 日志统一使用前缀 `[领取路径:SNATCH]`，统计页以 `API` 标记领取来源。
**日志不会输出红包 `code`、Cookie 或 CSRF token。**

### 三档 `waitSec` 均已验证

| 档位 | 成功时刻（开页后） |
|---|---|
| 90 秒 | +92s |
| 300 秒（5 分钟） | +204s |
| 600 秒（10 分钟） | +587s |

对照组（同一时刻**不打开**目标房间页）三次全部返回 `12006`，
印证「后台页必须保持打开」。

> **计时口径**：`waitSec` 是「**进入该房间后需要等待的秒数**」，按用户独立计时，
> 不是全局到点的绝对时间。因此计时起点是打开目标房间页的时刻，
> 不能依赖云端返回的 `createTime`。

---

## 用户界面

![主面板](assets/menu.png)
![设置界面](assets/setting.png)
![演示](assets/demo.gif)

控制中心提供两块页面：

- **任务页**：显示正在运行的领取任务，实时状态、倒计时与奖品预览。
- **统计页**：收益趋势、领取记录、异常日志与抽奖记录。

---

## ⚙️ 设置详解

点击控制面板顶部栏的【设置】按钮打开。

### 星推荐

| 设置项 | 说明 |
| :--- | :--- |
| 控制室房间号 | 插件 UI 的入口点，支持靓号与普通房间号。保存时自动解析并存储隐藏的真实 RID，无需手动维护第二个房间号。 |
| 后台页面最短停留 | 后台页的**安全下限**（12~30 秒）。后台页实际会一直保持到本次领取有结论，此项只是兜底。**不建议低于 12 秒**——实测 8 秒仍会导致 `snatch` 返回 `12006`。 |
| 达到上限后的行为 | `停止所有任务` 或 `休眠并等待次日恢复`。 |
| 控制中心显示方式 | `浮动窗口` 可拖拽独立窗口；`屏幕居中` 固定居中模态框；`侧栏模式` 使用直播间右侧完整上半区，保留底部官方弹幕输入。 |
| 自动十连抽奖 | 开关。默认**关闭**——抽奖会真实消耗金币。仅在控制页生效。 |
| 触发金币数 | 金币达到该值时自动抽一次十连，默认 100，可调高。 |

### 自动抽奖

斗鱼已把红包改版为「抽奖机」：领红包**赚**金币，抽奖**花**金币。
单抽消耗 10 金币，十连消耗 100 金币。

- **默认关闭**，需要手动开启。
- **仅在控制页执行**。这不是优化而是硬约束：`main()` 会在每个斗鱼直播间页面运行，
  若不做限定，同时开着 N 个直播间就会各抽一次，金币被重复消耗。
- **开启后立即检查一次**，之后每 60 秒轮询。
- **触发金币数下限固定为 100**（= 一次十连成本）。低于 100 会出现
  「金币够阈值却抽不动」——脚本发的是十连请求，服务端直接返回金币不足。
- 单次调度最多抽一轮，不会循环猛抽。

> **常见疑问：需要打开那个 H5 活动页吗？**
> **不需要。** 已实测确认：H5 页面关闭状态下，控制页可直接完成真实十连。
> 详见 [`docs/DOUYU_REDPACKET_API.md`](docs/DOUYU_REDPACKET_API.md) §7。
>
> 如果感觉「开了开关没反应」，通常是这两个原因：① 首次检查过去要等满 60 秒
> （现已改为开启即检查）；② 金币尚未攒到阈值。注意红包每笔只加 2~15 金币，
> 攒到 100 本身需要一段时间。

### 关于

显示版本号与项目链接。日夜切换与设置入口位于控制中心顶部栏。

领取轮询间隔、候选数量、API 重试次数等属于内部策略，不在设置页暴露。

---

## 数据统计

统计页的数据来源**分成两条**，避免口径混淆：

| 数据 | 来源 |
|---|---|
| 金币 | 斗鱼账户记录（`coin/record/list`，只统计「红包」收入项） |
| 星光棒 | 本地 `ClaimEventStore`（按 `prizeType` 折算，与红包同口径） |
| 领取记录 / 异常日志 | 本地 `ClaimEventStore` |
| 抽奖记录 | 本地 `ClaimEventStore`，`phase:'lottery'` |

### 抽奖记录

每次抽奖都会写入统计，与领取记录**分开统计**：

- 汇总卡片显示「抽奖次数」与「抽奖净收益」
  （净收益 = 抽到的星光棒 + 抽到的金币 − 消耗的金币，负数表示这轮亏了）。
- 「近期记录」合并展示领取与抽奖，抽奖行带成本，例如
  `−100 金币 → 星光棒 610`。
- 「异常日志」只保留**失败**的抽奖——成功抽奖不是异常。

**抽奖失败不会拉低红包领取成功率**，两者口径独立。
抽奖按「次」计数（一次十连记 1 次），不按奖品条目数。

> 已知局限：「净收益」把金币与星光棒按 1:1 相加，只是一个便于比较的近似值，
> 两者真实价值并不相等。

---

## 🔨 开发者

脚本使用 Vite 构建，通过 [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey/blob/main/README_zh.md)
生成 userscript。

```bash
npm install          # 安装依赖

npm run dev          # 开发模式
npm test             # 单元测试（46 项）
npm run check        # lint + typecheck + test + build，提交前跑这个
```

### 构建

脚本支持三种构建形态，通过环境变量 `BUILD_FLAVOR` 选择。
文件名格式为 `星推荐v2{flavor后缀}{channel后缀}.user.js`：

| `BUILD_FLAVOR` | 产物文件名 | 内容 |
| :--- | :--- | :--- |
| `full`（默认） | `星推荐v2-beta.user.js` | 星推荐 + 弹幕助手 |
| `star-only` | `星推荐v2-star-only-beta.user.js` | 仅星推荐 |
| `danmu-only` | `星推荐v2-danmu-only-beta.user.js` | 仅弹幕助手 |

频道后缀由 `BUILD_CHANNEL` 决定：`beta`（默认）产生 `-beta` 后缀且版本号带 `-beta.1`；
`release` 则无后缀、使用纯版本号。

```bash
# 构建发布用的 star-only 版本
BUILD_FLAVOR=star-only BUILD_CHANNEL=release VERSION_SUFFIX=2.1.2 npm run build
# → dist/星推荐v2-star-only.user.js
```

- 脚本头部注释（名称、描述、更新地址等）在 `vite.config.js` 中配置。
- 构建保留彼此产物（`emptyOutDir: false`），因此三种 flavor 可连续构建、互不覆盖。

### 目录结构

```
src/
├── main.js                     入口：判断页面类型并初始化对应模块
├── modules/
│   ├── ControlPage.js          控制中心 UI 与事件
│   ├── SettingsManager.js      配置加载、合并、保存与夹取
│   ├── SettingsPanel.js        设置面板 UI
│   ├── StatsInfo.ts            统计页
│   └── PageLoader.js           短时后台开页
├── features/
│   ├── redbag/                 红包领取（任务控制器、状态机）
│   ├── lottery/                抽奖调度
│   └── stats/                  ClaimEventStore：领取与抽奖事件存储
├── platform/douyu/             斗鱼平台适配（CSRF 解析、布局适配）
└── utils/                      CONFIG / DouyuAPI / 工具函数
```

### 提交前检查

```bash
npm run check     # 必须全绿
```

---

## 📖 关于

### 致谢

- 原脚本：[ysl-ovo](https://greasyfork.org/zh-CN/users/1453821-ysl-ovo) 的
  [《斗鱼全民星推荐自动领取》](https://greasyfork.org/zh-CN/scripts/532514-%E6%96%97%E9%B1%BC%E5%85%A8%E6%B0%91%E6%98%9F%E6%8E%A8%E8%8D%90%E8%87%AA%E5%8A%A8%E9%A2%86%E5%8F%96)
- 上游仓库作者：[ienone](https://github.com/ienone/douyu-qmx-pro)
- v2.0.5 的「适配新版 UI」由 [@Truthss](https://github.com/Truthss) 在
  [#5](https://github.com/ienone/douyu-qmx-pro/pull/5) 中贡献

均遵循 MIT 许可证开源。

### 一些 Tips

- 页面倒计时不参与领取决策，真正状态以 `snatch` 的服务端返回为准。
- 领取成功后直接用响应里的奖品列表更新任务状态。
- 自动领取存在明显风控风险；疑似风控提示**不会**代替你停止任务。
- 每天大约 1000 金币到上限。
- 晚上 `100 / 50 / 20` 星光棒的奖池项可能已空（对应项变灰），
  此时攒金币过了 12 点再抽，性价比更高。
- 抽奖前建议先把金币攒到 100 以上，十连比单抽更划算。

### 反馈

- 源码：[ArimaKana-Akane/douyu-qmx-pro](https://github.com/ArimaKana-Akane/douyu-qmx-pro)
- 问题与建议：[Issues](https://github.com/ArimaKana-Akane/douyu-qmx-pro/issues)
- 上游项目：[ienone/douyu-qmx-pro](https://github.com/ienone/douyu-qmx-pro)

> 如果问题与**上游原有功能**有关，也可以到[上游仓库](https://github.com/ienone/douyu-qmx-pro/issues)反馈。

## 📄 License

[MIT License](https://opensource.org/licenses/MIT)
