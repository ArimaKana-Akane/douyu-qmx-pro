# 斗鱼星推荐红包 API 文档

> **发现日期**: 2026-01-05  
> **最近复核**: 2026-09-04
> **用途**: 查询直播间星推荐红包情况，查询领取结果  
> **来源**: 斗鱼前端代码与现网页面实测
> **边界**: 只把现网观察到的字段写成已确认契约；未实测错误码另行标注

---

## 0. 查询候选房间 API（`square/list`）

### 基本信息

- **接口地址**: `https://www.douyu.com/japi/livebiznc/web/anchorstardiscover/redbag/square/list`
- **请求方法**: `GET`
- **用途**: 发现当前有星推荐红包的候选直播间

### 请求示例

```http
GET /japi/livebiznc/web/anchorstardiscover/redbag/square/list?rid=6657 HTTP/1.1
Host: www.douyu.com
```

### 响应字段

`data.redBagList` 中当前确认包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| rbId | number | 本条候选对应的红包 ID |
| rid | number | 直播间房间号 |
| rbType | number | 红包类型（7/8 等），不能据此推导具体奖池数量 |
| roomShowType | number | 房间展示类型 |
| avatar | string | 主播头像 URL |

2026-08-29 现网复核时，`square/list` **不包含** `prizeList`、`num`、`ptype`、`waitSec` 或 `code`。因此它可以用于发现候选房间，但不能单独比较金币或星光棒奖池大小。按奖池排序时仍需对候选 `rid` 查询匿名 `room/list`，该过程不要求先打开直播间。

---

## 1. 查询指定房间红包明细 API（`room/list`）

### 基本信息

- **接口地址**: `https://www.douyu.com/japi/livebiznc/web/anchorstardiscover/redbag/room/list`
- **请求方法**: `GET`
- **Content-Type**: `application/json`

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| rid | string | 是 | 直播间房间号 |

### 请求示例

```http
GET /japi/livebiznc/web/anchorstardiscover/redbag/room/list?rid=12736152 HTTP/1.1
Host: www.douyu.com
Accept: application/json, text/plain, */*
```

该查询接口已验证可匿名调用，不要求登录 Cookie 或 `X-Requested-With`。

### 响应参数

#### 响应结构

```json
{
  "error": 0,
  "msg": "success",
  "data": {
    "cnt": 2,
    "rid": 12736152,
    "anchorName": "主播昵称",
    "anchorAvatar": "主播头像URL",
    "redBagList": [...]
  }
}
```

#### data 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| cnt | number | 当前 `status=0` 的红包数量，不等于 `redBagList.length` |
| rid | number | 房间号 |
| anchorName | string | 主播昵称 |
| anchorAvatar | string | 主播头像URL |
| redBagList | array | 红包列表，可能同时包含当前红包和历史红包 |

#### redBagList 元素结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 红包ID |
| code | string | 红包唯一标识码；当前观察为 32 位十六进制字符串，生成算法未确认 |
| rbType | number | 红包类型（7/8等） |
| status | number | 红包状态（0=等待中, 3=已结束） |
| waitSec | number | 前端从收到本次响应后使用的等待时长，不是绝对剩余秒数 |
| createTime | number | 服务端创建时间戳（Unix时间）；当前前端未用它校准倒计时 |
| prizeList | array | 奖品列表 |

#### prizeList 元素结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 奖品ID（可能为空） |
| img | string | 奖品图标URL |
| name | string/null | 奖品名称 |
| num | number | 奖品数量 |
| ptype | number | 奖品类型（2=星光棒, 9=金币） |

### 响应示例

```json
{
  "error": 0,
  "msg": "success",
  "data": {
    "cnt": 2,
    "rid": 12736152,
    "anchorName": "好姐妹秋月愛莉",
    "anchorAvatar": "https://apic.douyucdn.cn/upload/avatar_v3/202409/xxx_big.jpg",
    "redBagList": [
      {
        "id": 1333679,
        "code": "d69ca47cb3c5a020e914c69eaf91c63d",
        "rbType": 8,
        "status": 0,
        "waitSec": 600,
        "createTime": 1767628108,
        "prizeList": [
          {
            "id": "3567",
            "img": "https://sta-op.douyucdn.cn/dygev/2025/12/12/xxx.png",
            "name": null,
            "num": 500,
            "ptype": 2
          },
          {
            "id": "",
            "img": "",
            "name": null,
            "num": 2000,
            "ptype": 9
          }
        ]
      },
      {
        "id": 1333642,
        "code": "14725d0351f4fcfb1bfe7e321876dbeb",
        "rbType": 7,
        "status": 3,
        "waitSec": 90,
        "createTime": 1767626771,
        "prizeList": [
          {
            "id": "",
            "img": "https://sta-op.douyucdn.cn/dygev/2024/05/13/xxx.png",
            "name": null,
            "num": 200,
            "ptype": 9
          }
        ]
      }
    ]
  }
}
```

### 状态说明（现网已观察）

- **status = 0**: 红包等待中（倒计时状态）
- **status = 3**: 红包已结束（已领完或过期）

前端内部还使用其他数值表示本地 UI 状态，不能据此扩展服务端状态枚举。

### 红包类型说明

- **rbType = 8**: 已在星推荐活动房间现网确认
- **rbType = 7**: 历史响应样本中出现，本轮未重新确认其业务名称

---

## 2. 领取红包 API

### 基本信息

- **接口地址**: `https://www.douyu.com/japi/livebiznc/web/anchorstardiscover/redbag/snatch`
- **请求方法**: `POST`
- **Content-Type**: `application/x-www-form-urlencoded`

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| code | string | 是 | 红包唯一标识码（从列表API获取） |
| id | number | 是 | 红包ID（从列表API获取） |
| rid | number | 是 | 直播间房间号 |
| `$SYS.tn` 指定的字段名 | string | 是 | 值来自 `$SYS.tvk` 指定的 Cookie；字段名和 Cookie 名都不应硬编码 |

### 请求示例

```http
POST /japi/livebiznc/web/anchorstardiscover/redbag/snatch HTTP/1.1
Host: www.douyu.com
Content-Type: application/x-www-form-urlencoded
Accept: application/json, text/plain, */*
Cookie: [认证Cookie]

code=f075ce93bafd6dddb81fb3a810ae4af3&id=1333628&rid=12759376&<动态CSRF字段名>=<对应Cookie值>
```

当前公共请求层的 CSRF 处理流程：

1. `$SYS.tn` 提供表单字段名；实际 Cookie 名由 `$SYS.cookie_pre + $SYS.tvk` 组成。
2. 控制页可以缓存解析出的字段名与 Cookie 名，供自身路由变化后回退使用；缓存不保存 Cookie 值或 token。
3. 若对应 Cookie 不存在，先请求 `/wgapi/livenc/liveweb/csrfApi/getCsrfCookie`，由服务器设置 Cookie。
4. 发起领取时重新读取当前登录会话的 Cookie，并把动态字段和值加入 POST 表单。

2026-08-29 在新版控制室页面内嵌配置中解析到 `tn=ctn`、`tvk=ccn`、`cookie_pre=acf_`，因此实际 Cookie 名是 `acf_ccn`。页面没有直接暴露 `window.$SYS`，当前实现解析页面内嵌脚本文本，不再兼容旧的页面全局变量形式。早期工作页领取架构曾受部分直播间不下发这些字段影响；2026-08-30 起所有 `snatch` 均由控制页执行，短时工作页不读取或共享认证数据。字段名、前缀和 Cookie 键仍不在代码中硬编码。CSRF 只证明合法登录会话，不代表已经满足领取时间。

### 响应参数

#### 响应结构

```json
{
  "error": 0,
  "msg": "success",
  "data": {
    "id": 1333628,
    "rbType": 8,
    "prizeList": [...]
  }
}
```

#### data 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 红包ID |
| rbType | number | 红包类型 |
| prizeList | array | 领取到的奖品列表 |

#### prizeList 元素结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 奖品ID |
| img | string | 奖品图标URL |
| name | string/null | 奖品名称 |
| num | number | 领取到的奖品数量 |
| prizeType | number | 奖品类型 |

### 响应示例

#### 成功领取

```json
{
  "error": 0,
  "msg": "success",
  "data": {
    "id": 1333628,
    "rbType": 8,
    "prizeList": [
      {
        "id": "3567",
        "img": "https://sta-op.douyucdn.cn/dygev/2025/12/12/xxx.png",
        "name": null,
        "num": 4,
        "prizeType": 2
      },
      {
        "id": "",
        "img": "",
        "prizeType": 9,
        "name": null,
        "num": 37
      }
    ]
  }
}
```

#### 空包（未中奖）

```json
{
  "error": 0,
  "msg": "success",
  "data": {
    "id": 1333628,
    "rbType": 8,
    "prizeList": []
  }
}
```

#### 尚未到领取时机（现网已确认）

```json
{
  "error": 12006,
  "msg": "稍等会儿才能抢哟",
  "data": null
}
```

`12006` 是可重试状态，不是鉴权失败。2026-08-29 实测中，脚本保持同一红包身份按 5 秒间隔重试，随后由同一 `snatch` 接口返回 `error=0`；该 5 秒频率只是实验参数。2026-09-04 起，插件按 `waitSec` 为每个红包最多安排 5 次请求，不再从开页后 30–50 秒开始持续轮询。

#### 其他业务错误码（前端静态代码）

| error | 官方前端处理 | 当前结论 |
|------:|--------------|----------|
| 12001 | 红包已派完状态 | 单次返回不能证明账号被风控 |
| 12002–12005 | 通用领取错误状态 | 尚无逐项现网样本，不能补写具体含义 |
| 12006 | 恢复为可再次点击状态 | 已现网确认可稍后重试 |
| 12007 | 通用领取错误状态 | 尚无现网样本 |

若 30 分钟内连续 3 个不同红包都在第一次 `snatch` 时直接返回 `12001`，插件只显示“疑似账户风控”。这是经验性提示，不是斗鱼公开的风控错误码，也不会自动停止领取。

#### 已达上限（历史记录，本轮未复测）

```json
{
  "error": -1,
  "msg": "已达到每日领取上限",
  "data": null
}
```

---

## 3. 认证与请求头

### 鉴权边界

- `room/list` 查询已验证可匿名 GET。
- `snatch` 领取需要浏览器登录态和动态 CSRF 字段。
- 不应复制或硬编码一组 Cookie 名；由同源浏览器会话发送认证 Cookie，并按 `$SYS.tn`、`$SYS.cookie_pre` 与 `$SYS.tvk` 解析 CSRF。
- 2026-08-29 已在页面相对倒计时结束前持续发送 `snatch`：先返回 `12006`，随后提前于本地预计结束时间返回成功。服务端响应必须作为能否领取的最终依据。

### 领取时机现网样本（2026-08-29）

- 房间 `12865305`，红包 `1663094`，首次 `room/list.waitSec=90`。
- `snatch` 在本地预计剩余 `90/85/80/.../50` 秒时均返回 `12006 / 稍等会儿才能抢哟`。
- 本地预计仍剩 `45` 秒时，`snatch` 返回 `error=0 / success`。
- 本轮更新后的最新四个工作房间均由统计面板记录为 `API · 领取成功`，没有出现新的 DOM 兼容领取事件。

该样本说明 `receivedAt + waitSec` 适合做粗略调度，但不是服务端真实可领时刻；插件不应为了等页面倒计时而推迟请求。

### 工作直播间与当前请求调度

- 完全不打开目标直播间的实验无法领取，说明服务端还需要由目标房间建立某种用户活动上下文；具体是页面登录、Socket 入组、`sd202404_uinfo`、`sd202404_rbinfo` 还是其他步骤，尚未最终确定。
- 已有 90 秒红包样本在工作直播间短时打开并关闭后，由控制页完成领取。因此当前架构只短暂打开工作直播间获取必要信息，不要求标签页常驻。
- 300 秒和 600 秒红包的短时开页实验多次经历 `12006` 后转为 `12001`，尚没有足够稳定的成功样本，不能承诺必然领取。
- 当前最多请求 5 次，按开页时间计算的偏移为：90 秒红包 `45/70/90/110/140` 秒，300 秒红包 `200/280/300/320/350` 秒，600 秒红包 `400/580/600/620/650` 秒。其他时长使用同一比例策略，相邻实际请求至少间隔 10 秒。

### 前端中发现的关联接口与消息

| 类型 | 名称 | 作用与证据边界 |
|------|------|----------------|
| GET | `/redbag/snatch/record?code=...&id=...&rid=...` | 官方红包结果页用于读取参与者和奖品记录；响应 `data` 可能是字符串化结构，插件当前未调用 |
| GET | `/wgapi/livenc/liveweb/csrfApi/getCsrfCookie` | 请求服务器补设动态 CSRF Cookie |
| GET | `/anchorstardiscover/coin/record/list` | 查询账户金币变动记录，当前统计页使用 |
| Socket | `sd202404_uinfo` | 星推荐用户信息消息；单独出现不能证明红包领取资格已建立 |
| Socket | `sd202404_actinfo` | 星推荐活动信息消息 |
| Socket | `sd202404_rbinfo` | 星推荐红包信息消息 |
| Socket | `sd202404_coininfo` | 星推荐金币信息消息 |

控制台日志、`GM_log` 和领取统计保存在浏览器或油猴本地；当前代码没有把这些日志上传到斗鱼或项目服务器。

### 参考请求头

```http
Accept: application/json, text/plain, */*
Accept-Language: zh-CN,zh;q=0.9
Referer: https://www.douyu.com/{房间号}
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36...
```

`X-Requested-With` 不是查询接口的必要请求头。

---
## 更新记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-09-04 | 1.5 | 补充 12001–12007 前端处理、关联接口与 Socket 消息、短时工作页边界及五次请求调度 |
| 2026-08-30 | 1.4 | 记录短时后台开页后的控制页领取架构、当前轮询范围及 DOM 降级移除状态 |
| 2026-08-29 | 1.3 | 现网验证 `12006` 与提前 `snatch` 成功时机，并补充新版工作页缺失内嵌 CSRF 配置时的共享映射方案 |
| 2026-08-29 | 1.2 | 补充 `square/list` 实际字段与奖池排序边界，明确奖池数量来自候选房间的 `room/list` |
| 2026-08-29 | 1.1 | 现网复核：修正 `cnt`、`waitSec`、`code`、匿名查询、动态 CSRF、状态与错误码边界 |
| 2026-01-05 | 1.0 | 初始版本，记录查询和领取API |

---

---

## 4. 新版活动：抽奖机（2026-09-15 起）

> **背景**：斗鱼已把全民星推荐红包改版为**抽奖机**（攒金币 → 抽奖）。
> 旧的「抢红包池 + DOM 点击弹窗」路径**整体失效**——v2.0.9 的 10 个 DOM 选择器
> 在当前页面命中数为 **0**（2026-09-15 现网实测）。
> 新界面是独立 H5 活动页：`/pages/new-anchor-support/rank?rid=<rid>`，
> 使用全新的 CSS Modules 类名（`Level-module__btn--NQJsM` 等）。
>
> 旧的 `redbag/square/list`、`redbag/room/list` 接口**仍然可用**，两套并存。

### 4.1 活动配置（抽奖成本与保底）

```http
GET /japi/livebiz/cdn/anchorstardiscover/config
```

可匿名同源 GET。关键字段：

| 字段 | 实测值 | 说明 |
|---|---|---|
| `data.treasureConfig.useGoldNum` | **10** | 每次抽奖消耗的金币数 |
| `data.treasureConfig.hitTime` | **166** | **保底阈值**：累计抽满 166 次触发保底奖励 |
| `data.treasureConfig.actId` | 126 | 活动 ID |
| `data.treasureConfig.treasureRewards[]` | 12 项 | 奖励表（`prob` 概率 / `guarantee` 保底标记 / `num` 数量） |
| `data.baseConfig.userRedPocketDayLimit` | 50 | 每日红包上限 |

> ⚠️ **易错点**：`user/lottery/info` 返回的 `remainLotteryNum` **不是「可用抽奖次数」**，
> 而是「**距离保底的剩余次数**」，与配置里的 `hitTime` 对应。
> 实测：抽奖后该值从 161 → 160（抽 1 次减 1）。

奖励表（`guarantee: 1` 为保底项）：

| index | 奖励 | 数量 | 概率(万分) | guarantee |
|---|---|---|---|---|
| 1 | 弹幕皮肤 | 1 | 3000 | 0 |
| 12 | 礼物横幅 | 1 | 3000 | 0 |
| 2 | 星光棒 | 66 | 30000 | 0 |
| 3 | 星光棒 | 500 | 5000 | 0 |
| 4 | 鉴星官后缀 | 1 | 50000 | 0 |
| 5 | 星光棒 | 100 | 25000 | 0 |
| 6 | 鉴星官勋章 | 1 | 210000 | 0 |
| 7 | 星光棒 | 50 | 50000 | 0 |
| 11 | 头像框 | 1 | 150000 | 0 |
| 8 | 星光棒 | 20 | 150000 | 0 |
| **9** | **星光棒** | **10** | **274000** | **1 ← 保底项** |
| 10 | 金币 | 5 | 50000 | 0 |

### 4.2 抽奖信息与中奖记录

```http
GET /japi/livebiznc/web/anchorstardiscover/user/lottery/info
GET /japi/livebiznc/web/anchorstardiscover/user/lottery/my/winrecord
```

`info` 响应（实测）：

```json
{ "error": 0, "msg": "success",
  "data": { "myCoin": 48, "remainLotteryNum": 166, "prizeList": [ ... ] } }
```

`my/winrecord` 响应：`data.prizeList[]` 含 `prizeDesc` / `prizeNum` / `prizeIcon` / `ts`。

### 4.3 执行抽奖

```http
POST /japi/livebiznc/web/anchorstardiscover/user/lottery/do?num=1
Content-Type: application/x-www-form-urlencoded;charset=UTF-8

rid=<rid>&<CSRF字段名>=<CSRF值>
```

**注意 `num` 走 query string，不在 body 里。**

实测成功响应（2026-09-15，消耗 10 金币）：

```json
{ "error": 0, "msg": "success",
  "data": { "prizeList": [
    { "prizeDesc": "星光棒", "prizeNum": 20, "sort": 10,
      "prizeIcon": "https://sta-op.douyucdn.cn/dygev/...",
      "ts": 1789471743 } ] } }
```

错误码（实测）：

| error | 含义 | 是否扣款 |
|---|---|---|
| 0 | 成功 | 是 |
| 1 | 参数错误（`num` < 1 时为「最小不能小于1」） | 否 |
| **12022** | **金币不足** | **否** |

CSRF 要求：

- **必须走 form-urlencoded**。实测用 JSON body 或把 csrf 放 header 均返回 `403 csrf auth failed`。
- 字段名与 Cookie 名来自页面内嵌 `$SYS`：实测 `tn=ctn`、`tvk=ccn`、`cookie_pre=acf_`
  → 实际 Cookie 名 `acf_ccn`（已存在于登录会话，通常无需再取）。
- 若 Cookie 不存在，新活动页用的是 `/curl/csrfNlApi/getCsrfCookie`（注意：与旧
  `snatch` 用的 `/wgapi/livenc/liveweb/csrfApi/getCsrfCookie` **不同**）。

### 4.4 标记候选已读

```http
POST /japi/livebiznc/web/anchorstardiscover/redbag/square/read
Content-Type: application/x-www-form-urlencoded;charset=UTF-8

rid=<rid>&rbId=<rbId>&<CSRF字段名>=<CSRF值>
```

成功：`{"error":0,"msg":"success","data":1}`

失败对照（均实测）：

| 变体 | 结果 |
|---|---|
| 空 body / JSON body / csrf 放 header | `403 csrf auth failed` |
| 缺 `rid` 或 `rbId` | `{"error":1,"msg":"rid不为空rbId不为空"}` |
| GET | `{"error":1,"msg":"非法请求"}` |

### 4.5 自动抽奖策略（本项目的实现）

`src/features/lottery/LotteryAutoRunner.js`：

- **仅控制页生效**——`main()` 会在每个 douyu.com 直播间页面运行，
  若不做限定，N 个直播间标签页会各抽一次、重复消耗金币。
- **默认关闭**——抽奖真实消耗金币，必须用户显式开启。
- 阈值 **100 金币**（= 十连成本 `useGoldNum 10 × 10 次`），达到即十连。
- 轮询间隔 60 秒（金币靠「用户任务」慢慢攒，实测每笔 +3/+10）。
- 金币不足（12022）按「跳过」处理，不记为错误。
- 单次调度最多抽一轮，绝不循环猛抽。

---

## 5. CSRF 解析：新版页面已移除 `$SYS`（2026-09-15 实测）

### 5.1 问题

脚本原有的 `getDynamicCsrf()` 依赖两级来源，**在现网两级全空**：

| 来源 | 实测结果 |
|---|---|
| 页面内嵌配置（`window.$SYS`） | 控制室 / 活动页 / 任务中心 iframe **三种上下文均为 `undefined`** |
| 服务端返回的 HTML | **不含**该配置（活动页仅 991 字节 SPA 壳） |
| GM 缓存 | 空（因为从没成功解析过） |

→ `getDynamicCsrf()` 抛「当前页及共享缓存中没有动态 CSRF 配置」
→ **所有 POST 接口（`snatch` / `redbag/square/read` / `lottery/do`）全部无法调用**。

这是「基础功能用不了」的直接原因。

### 5.2 实测出来的正确参数

用「哪些组合能通过」的方式逐个实测（403 = 该组合不对）：

**字段名**（Cookie 固定用 `acf_ccn`）：

| 字段名 | 结果 |
|---|---|
| **`ctn`** | ✅ **通过** |
| `csrf_test_name` / `csrf_cookie_name` / `token` / `csrfToken` | ❌ 403 |

**Cookie**（字段名固定 `ctn`）：

| Cookie | 值形态 | 结果 |
|---|---|---|
| **`acf_ccn`** | 32 位 hex | ✅ **通过** |
| `dy_did` / `acf_did` / `guid` | 同为 32 位 hex | ❌ 403 |

> 注意最后一行：**同为 32 位 hex 的其他 Cookie 一律被拒**，
> 所以不能靠「像 CSRF」来猜，必须用实测确认的那一个。

这个组合也与活动页 bundle 里的内嵌 dev 配置一致：
`tn:"ctn", tvk:"ccn", cookie_pre:"acf_"` → Cookie 名 = `cookie_pre + tvk` = `acf_ccn`。

### 5.3 实现的降级顺序

`DouyuAPI.getDynamicCsrf()` 现在按四级降级，并返回 `source` 标明实际来源：

1. `embedded` — 页面内嵌配置（兼容旧版页面，现网恒空）
2. `cache` — GM 缓存（跨页面/跨会话复用）
3. `cookie-derive` — **从 Cookie 反推**（现网唯一可用路径）
4. `cookie-derive-after-fetch` — 请求服务端补设 Cookie 后再反推

另外新增 `postWithCsrf()` 统一三个写接口的 POST：
CSRF 一律走 **form-urlencoded**（实测 JSON body / header 放字段一律 403），
且 **403 时清缓存并重试一次**（应对字段名轮换）。

---

## 6. 领取链路实测：`snatch` 仍然可用（2026-09-15）

**背景**：新版活动页是抽奖机，容易误判「旧的红包领取已下线」。实测证明**两套并存**。

### 6.1 成功样本

控制室 6657 发起，目标房间 `12892604`，红包 `id=1683745`，`waitSec=90`：

| 时刻 | 结果 |
|---|---|
| +45s | `12006` 稍等会儿才能抢哟 |
| **+90s** | **`error=0` success，领到金币 ×2** |

金币流水确认：`12:12:16  +2  全民星推荐-红包`

这与 `getSnatchAttemptOffsets()` 的既有策略（45s / 70s / 90s / 110s / 140s）**完全吻合**。

### 6.2 对照实验：目标房间上下文是必需的

同一红包、同样等到 +90s，但**不打开目标房间**：

| 条件 | 结果 |
|---|---|
| 开目标房间上下文 + 等 waitSec | ✅ `error=0` |
| **不开**目标房间 + 等 waitSec | ❌ 恒 `12006` |

→ 证实 `PageLoader.openPrewarmTab()` 的「短时开页」是**必需环节**，不是冗余设计。
（6.1 的样本中，我在控制室用同源 iframe 打开目标房间建立了上下文。）

### 6.3 结论

- **原有领取功能没有失效**，只是被 CSRF 解析失效阻断（§5）。
- 旧 `snatch`（红包池）与新 `lottery/do`（抽奖机）**当前并存**。
- `waitSec` 是「从本次响应时刻起再等 N 秒」，用它计时可行。
