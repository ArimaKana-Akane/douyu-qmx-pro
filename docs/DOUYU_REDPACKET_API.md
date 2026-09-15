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
- **阈值可配置**（`LOTTERY_DRAW_THRESHOLD`，2026-09-16 新增）：
  默认 **100 金币**（= 十连成本 `useGoldNum 10 × 10 次`），用户可在设置面板调高。
  **硬下限就是 100**——低于它会出现「金币够阈值却抽不动」：脚本按阈值判定可以抽，
  但发出的是十连请求，服务端直接返回 `12022 金币不足`，表现为永远抽不到。
  因此 100 是功能正确性边界而非偏好，旧存档/手改配置里的 0、50 一律被抬到 100。
- **开启后立即检查一次**，之后每 60 秒轮询。
  原先首次检查也要等满一个周期，用户点开开关后 60 秒内看不到任何动作，
  会误判成「开关没生效 / 功能坏了」——延迟本身不是故障，但会造成误判。
- 金币不足（12022）按「跳过」处理，不记为错误，**也不写入统计**——
  那不是一次真实抽奖，记为失败会污染抽奖成功率。
- 单次调度最多抽一轮，绝不循环猛抽。

### 4.6 抽奖结果写入数据统计（2026-09-16 新增）

抽奖结果与红包领取共用 `ClaimEventStore`，但**以 `phase` 严格分流**：

| phase | 用途 | 是否参与 `successRate` |
|---|---|---|
| `claim` | 红包领取 | ✅ 是（这是原有的「领取成功率」口径） |
| `lottery` | 抽奖 | ❌ 否 |

**为什么必须分流**：`successRate` 的语义是「红包领取成功率」。
若把抽奖事件混进 `claim`，一次抽奖失败就会把它拉低，统计口径被污染；
`successBySource` 同理（那是红包的按来源口径）。

抽奖事件的字段：

| 字段 | 说明 |
|---|---|
| `cost` | 本次消耗金币（十连固定 100），用于算净收益 |
| `drawCount` | 本次抽取次数（十连 = 10）。**注意不等于 prizeList 条目数** |
| `rewards.coins` / `rewards.starlight` | 按 `prizeType` 折算（9 = 金币，2 = 星光棒），口径与红包一致 |

统计页上的呈现：

- 汇总卡片追加两张（**仅在确有抽奖记录时**）：抽奖次数、抽奖净收益
  （净收益 = 抽到的星光棒 + 抽到的金币 − 消耗金币；负数说明这一轮亏了）。
- 「近期记录」合并展示领取与抽奖，按时间倒序 —— 这样「领到钱 → 去抽奖」
  的因果链一眼可见。抽奖行会显示成本：`−100 金币 → 星光棒 610`。
- 「异常日志」视图只保留**失败**抽奖：成功抽奖不是异常。

**计数口径**：抽奖按「次」计（一次十连 = 1 次），**不是**奖品条目数。
一次十连会返回多条 `prizeList`，用条目数会显示成 10 次。
这也与领取侧不同——领取要按 `bagKey` 把同一红包的多次尝试**归并**成一次，
而抽奖每次都是独立事件，不能归并。

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

### 6.3 三档 waitSec 全部验证通过（2026-09-16）

90 / 300 / 600 三档均实测领取成功，**且目标房间页全程保持打开**：

| 档位 | 尝试 | 结果 |
|---|---|---|
| 90s | +48s → `12006`；**+92s → `error=0`** | ✅ 金币 ×9 |
| 300s | **+204s → `error=0`** | ✅ 星光棒 ×1 + 金币 ×14 |
| 600s | +417s → `12006`；**+587s → `error=0`** | ✅ 星光棒 ×4 + 金币 ×1 |

对照组（同一时刻、**不打开**目标房间）三次全部 `12006`。

### 6.4 `waitSec` 的语义修正（重要）

早期记录写成「从本次响应时刻起再等 N 秒」，**这个说法不准确**，会误导实现。

实测反例：`square/list` 里 26 个红包的 `createTime + waitSec` **都已经是过去时**
（delta 为 −16s ~ −431s），但直接 `snatch` 仍然一律 `12006 稍等会儿才能抢哟`。
若 `waitSec` 是「全局到点时刻」，这些红包早就该能领了。

正确语义：**`waitSec` 是「你进入该房间后需要等待的秒数」，按用户独立计时**。
证据是 6.3 的三次成功都精确落在「开页时刻 + waitSec」附近：

- 90s 档：开页 +92s 成功（+48s 时仍失败）
- 300s 档：开页 +204s 成功
- 600s 档：开页 +417s 失败 → +587s 成功

对实现的含义：计时起点必须是**打开目标房间页的时刻**（`PageLoader` 的 `openedAt`），
而不是 `snatch` 响应里读到的 `waitSec` 字段本身，也不能依赖 `createTime`。
`RedBagTaskController` 现在正是用 `openedAt + offset` 计时，与此吻合。

### 6.5 结论

- **原有领取功能没有失效**，只是被 CSRF 解析失效阻断（§5）。
- 旧 `snatch`（红包池）与新 `lottery/do`（抽奖机）**当前并存**。
- 计时基准是「开页时刻 + waitSec」，不是服务端绝对到点时间。

---

## 7. 抽奖是否需要打开 H5 活动页？（2026-09-16 实测：不需要）

用户提问：「100 金币自动抽奖不可用，必须打开那个 H5 界面才能实现吗？」

**结论：不需要。控制页上下文里的 `acf_ccn` 就足以调用 `user/lottery/do`。**

三项独立证据：

**① 控制页上下文、H5 未打开时，请求已通过 CSRF**

```
POST /user/lottery/do?num=0     body: rid=6657&ctn=<acf_ccn>
→ 200 {"error":1,"msg":"最小不能小于1"}
```

`num=0` 会被服务端**先过 CSRF、再校验参数**。返回的是参数错误而不是
`403 csrf auth failed`，说明请求已经进入业务逻辑层。
（对照：无 CSRF 或 JSON body → `403 csrf auth failed`。`num=0` 不扣款。）

**② 关闭 H5 后的真实十连成功**

```
关闭 /pages/new-anchor-support/rank 页面 → 确认 h5StillOpen: []
POST /user/lottery/do?num=10  →  {"error":0,"msg":"success"}
金币 108 → 8（扣 100）；保底 160 → 150
奖品：星光棒 ×500/×100/×50/×50/×20/×20/×10/×10/×10 + 鉴星官勋章 ×1
```

**③ 注入真实产物做端到端：调度器确实会发起十连**

拦截 fetch 记录到 `drawCalls: [{ url: "/user/lottery/do?num=10", body: "rid=6657&ctn=<redacted>" }]`。

### 7.1 那「不自动抽」的真实原因是什么

不是 H5，是**两个会让人误判的设计**，均已在 2.1.2 修复：

| 现象 | 真实原因 |
|---|---|
| 开启开关后一段时间内毫无动作 | 首次检查要等满 60 秒轮询周期 → 改为**开启即检查一次** |
| 金币看着够，却一直不抽 | 阈值写死 100；若账号金币长期低于 100（实测该账号 `myCoin` 在 9~92 波动），按设计就是跳过 → 改为**阈值可配置** |

另有一个真实约束：抽奖一次十连固定扣 **100 金币**，而红包每笔只加 2~15 金币，
因此「够 100」本身需要攒一段时间。这是活动设计，不是脚本缺陷。

### 7.2 顺带确认：`rid` 参数不被严格校验

用「必然失败」的参数探测（`myCoin < 100` 时 `num=10` 恒返回 12022 且**不扣款**）：

| rid | 结果 |
|---|---|
| `6657`（控制室靓号） | `12022 金币不足` |
| `6979222`（真实 RID） | `12022 金币不足` |
| `12873910`（其它活动房间） | `12022 金币不足` |
| `0` | `12022 金币不足` |
| `999999999999` | `error:1` NumberFormatException |

即：**任意合法整数 rid 都能通过校验**，服务端只在扣款阶段检查金币。
所以「传错 rid 导致抽不了」这个怀疑可以排除。
