import { SETTINGS } from '../modules/SettingsManager';
import { Utils } from './utils';
import { GM_getValue, GM_setValue, GM_xmlhttpRequest, unsafeWindow } from '$';
import { extractDouyuCsrfConfig } from '../platform/douyu/CsrfConfig.js';
import {
  compareRedBagPrizeValue,
  selectActiveRedBag,
  summarizeRedBagPrizePool,
} from '../features/redbag/RedBagState.js';

const ROOM_POOL_KEY = "douyu_qmx_room_pool";
const ROOM_POOL_LOCK_KEY = "douyu_qmx_room_pool_lock";
const CSRF_CONFIG_KEY = "douyu_qmx_csrf_config";
const RED_BAG_ROOM_LIST_PATH = '/japi/livebiznc/web/anchorstardiscover/redbag/room/list';
const RED_BAG_SNATCH_PATH = '/japi/livebiznc/web/anchorstardiscover/redbag/snatch';
const CSRF_COOKIE_PATH = '/wgapi/livenc/liveweb/csrfApi/getCsrfCookie';

// ── 新版活动（抽奖机）接口 ──────────────────────────────────────────────────
// 2026-09-15 现网实测确认的契约（隔离 profile + 真实登录态 + 一次授权真实抽奖）。
// 与旧 redbag/snatch 是并行的两套：旧接口仍可查询，新活动页走 lottery。
const LOTTERY_INFO_PATH = '/japi/livebiznc/web/anchorstardiscover/user/lottery/info';
const LOTTERY_DO_PATH = '/japi/livebiznc/web/anchorstardiscover/user/lottery/do';
const LOTTERY_WIN_RECORD_PATH = '/japi/livebiznc/web/anchorstardiscover/user/lottery/my/winrecord';
const RED_BAG_SQUARE_READ_PATH = '/japi/livebiznc/web/anchorstardiscover/redbag/square/read';
const ACTIVITY_CONFIG_PATH = '/japi/livebiz/cdn/anchorstardiscover/config';

/** 抽奖业务码：12022 = 金币不足（实测；活动页 bundle 中该分支会走「金币不足」提示） */
export const LOTTERY_ERROR = Object.freeze({
  COIN_NOT_ENOUGH: 12022,
});

/**
 * CSRF 兜底候选（按实测可靠性排序）。
 *
 * 为什么需要兜底：新版斗鱼页面不再输出 `$SYS`，`getDynamicCsrf` 的
 * 「解析页面配置」路径恒为空（2026-09-15 现网实测：控制室/活动页/任务中心 iframe
 * 三种上下文的 `window.$SYS` 均为 undefined，服务端 HTML 里也没有该配置）。
 *
 * 实测依据：
 *  - 活动页 bundle 内嵌 dev 配置为 `tn:"ctn", tvk:"ccn", cookie_pre:"acf_"`
 *    → Cookie 名 = cookie_pre + tvk = `acf_ccn`
 *  - 字段名：仅 `ctn` 通过；`csrf_test_name` / `csrf_cookie_name` / `token` / `csrfToken`
 *    一律 403
 *  - Cookie：`acf_ccn` 通过；同为 32 位 hex 的 `dy_did` / `acf_did` / `guid` 一律 403
 */
const CSRF_FALLBACK_CANDIDATES = Object.freeze([
  { fieldName: 'ctn', cookieName: 'acf_ccn' },
]);

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(items.length, Math.max(1, Number(concurrency) || 1));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const normalizeSquareCandidates = (items, limit) => {
  const seenRoomIds = new Set();
  const candidates = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rid = String(item?.rid || '');
    if (!/^\d+$/.test(rid) || seenRoomIds.has(rid)) continue;
    seenRoomIds.add(rid);
    candidates.push({
      rid,
      rbId: Number(item?.rbId) || 0,
      rbType: Number(item?.rbType) || 0,
      sourceIndex: candidates.length,
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
};

const createRequestError = (message, kind = 'transport', details = {}) => Object.assign(
  new Error(message),
  { kind, ...details },
);

const readDocumentCookie = (pageWindow, cookieName) => {
  const cookieText = String(pageWindow?.document?.cookie || '');
  const item = cookieText.split(';').map((part) => part.trim()).find((part) =>
    part.startsWith(`${cookieName}=`)
  );
  if (!item) return '';
  const value = item.slice(cookieName.length + 1);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const readEmbeddedCsrfConfig = (pageWindow) => {
  const scripts = Array.from(pageWindow?.document?.scripts || []);
  const source = scripts
    .map((script) => script.textContent || '')
    .filter((text) => /(?:cookie_pre|["']?tvk["']?\s*:|["']?tn["']?\s*:)/.test(text))
    .join('\n');
  return extractDouyuCsrfConfig(source);
};

const isCompleteCsrfConfig = (config) => Boolean(config?.fieldName && config?.cookieName);

/**
 * =================================================================================
 * 模块：斗鱼 API 客户端 (DouyuAPI)
 * ---------------------------------------------------------------------------------
 * 负责所有与斗鱼服务器的 API 通信。
 * =================================================================================
 */
export const DouyuAPI = {
  getPageWindow() {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.fetch) return unsafeWindow;
    return window;
  },

  async pageFetchJson(path, options = {}) {
    const pageWindow = this.getPageWindow();
    const { timeout = 10_000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await pageWindow.fetch.call(pageWindow, path, {
        credentials: 'include',
        ...fetchOptions,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw createRequestError('斗鱼接口返回了非 JSON 响应', 'protocol', {
          httpStatus: response.status,
        });
      }
      if (!response.ok) {
        throw createRequestError(`斗鱼接口 HTTP ${response.status}`, 'transport', {
          httpStatus: response.status,
          payload,
        });
      }
      return payload;
    } catch (error) {
      if (error?.kind) throw error;
      const message = error?.name === 'AbortError' ? '斗鱼接口请求超时' : String(error?.message || error);
      throw createRequestError(message, 'transport');
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async pageFetchText(path, options = {}) {
    const pageWindow = this.getPageWindow();
    const { timeout = 15_000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await pageWindow.fetch.call(pageWindow, path, {
        credentials: 'include',
        ...fetchOptions,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw createRequestError(`斗鱼页面 HTTP ${response.status}`, 'transport', {
          httpStatus: response.status,
        });
      }
      return { text, url: response.url || String(path), status: response.status };
    } catch (error) {
      if (error?.kind) throw error;
      const message = error?.name === 'AbortError' ? '斗鱼页面请求超时' : String(error?.message || error);
      throw createRequestError(message, 'transport');
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async resolveRoomIdentity(roomId) {
    const inputRoomId = String(roomId || '').trim();
    if (!/^\d+$/.test(inputRoomId)) {
      throw createRequestError('控制室房间号必须是纯数字', 'protocol');
    }

    const { text, url } = await this.pageFetchText(`/${inputRoomId}`, { method: 'GET' });

    /**
     * 解析真实 RID。
     *
     * 修复（2026-09-15）：新版斗鱼直播间页面**不再输出** `window.room_id`，
     * 原有单一来源因此恒为空 → `resolveRoomIdentity` 抛错 →
     * `SettingsPanel.save()` 在写设置之前就中止，**导致所有设置都无法保存**
     * （现网实测：控制室 6657 页面 `/6657` 的 HTML 中无 `window.room_id`）。
     *
     * 因此改为多来源依次尝试，任一命中即可（按可靠性排序）：
     *   1. `window.room_id = <数字>`（旧版页面）
     *   2. `"room_id":<数字>` / `room_id = <数字>`（JSON 内嵌形式）
     *   3. og:image 等资源 URL 里的 asrpic 路径：`/asrpic/<日期>/<真实RID>_src_...`
     *      ——现网 6657 实测可稳定取到 `6979222`
     *   4. og:url / canonical 里的数字路径
     *
     * 注意：这里的「真实 RID」是斗鱼内部房间号（可能不同于用户输入的靓号），
     * 用于 wss 连接与活动接口，必须准确。
     */
    const pickRoomIdFromText = (html) => {
      const patterns = [
        /window\.room_id\s*=\s*["']?(\d+)/,
        /"room_id"\s*:\s*["']?(\d+)/,
        /room_id\s*=\s*["']?(\d+)/,
        // 主播资源图路径：…/asrpic/<日期>/<真实RID>_src_…
        // 日期实测为 6 位 yymmdd（如 260915），放宽到 6–8 位以防格式变化。
        /\/asrpic\/\d{6,8}\/(\d+)_/,
        /"rid"\s*:\s*["']?(\d+)/,
      ];
      for (const re of patterns) {
        const hit = html.match(re)?.[1];
        if (hit) return hit;
      }
      return '';
    };

    const realRoomId = pickRoomIdFromText(text);
    const canonicalTag = text.match(/<link\b[^>]*\brel=["'][^"']*canonical[^"']*["'][^>]*>/i)?.[0] || '';
    const canonicalUrl = canonicalTag.match(/\bhref=["']([^"']+)/i)?.[1] || '';
    const getPathRoomId = (value) => {
      try {
        return new URL(value, window.location.origin).pathname.match(/^\/(\d+)\/?$/)?.[1] || '';
      } catch {
        return '';
      }
    };
    const controlRoomId = getPathRoomId(canonicalUrl) || getPathRoomId(url) || inputRoomId;
    if (!realRoomId) {
      throw createRequestError('未能从直播间页面解析真实 RID', 'protocol');
    }

    return { controlRoomId, realRoomId };
  },

  async getDynamicCsrf() {
    const pageWindow = this.getPageWindow();

    // ── 来源 1：页面内嵌配置（$SYS / 脚本内嵌） ───────────────────────────
    // 注意：2026-09-15 现网实测，新版斗鱼页面**已不再输出** $SYS，
    // 控制室、活动页、任务中心 iframe 三种上下文均为 undefined，
    // 且服务端返回的 HTML 里也没有该配置（活动页仅 991 字节 SPA 壳）。
    // 因此这条路径目前恒为空，保留是为了兼容旧版页面。
    const embedded = readEmbeddedCsrfConfig(pageWindow);
    if (isCompleteCsrfConfig(embedded)) {
      GM_setValue(CSRF_CONFIG_KEY, embedded);
      const token = readDocumentCookie(pageWindow, embedded.cookieName);
      if (token) return { fieldName: embedded.fieldName, token, source: 'embedded' };
    }

    // ── 来源 2：GM 缓存（跨页面/跨会话复用已解析结果） ─────────────────────
    const cached = GM_getValue(CSRF_CONFIG_KEY, {});
    if (isCompleteCsrfConfig(cached)) {
      const token = readDocumentCookie(pageWindow, cached.cookieName);
      if (token) return { fieldName: cached.fieldName, token, source: 'cache' };
    }

    // ── 来源 3：从 Cookie 反推（实测兜底，当前唯一可用路径） ───────────────
    // 依据（2026-09-15 现网实测 + 活动页 bundle 静态分析）：
    //   活动页配置常量 `tn:"ctn", tvk:"ccn", cookie_pre:"acf_"`（bundle 内嵌 dev 配置）
    //   → Cookie 名 = cookie_pre + tvk = `acf_ccn`
    //   实测：`acf_ccn` 是唯一 32 位 hex 且能被服务端接受的 CSRF token
    //        （`dy_did` / `acf_did` / `guid` 同为 32 位 hex 但一律 403）
    //        字段名仅 `ctn` 通过，`csrf_test_name`/`csrf_cookie_name`/`token`/`csrfToken` 均 403
    // 这里把「已实测通过」的组合列为候选，逐个尝试；命中后写入缓存。
    for (const candidate of CSRF_FALLBACK_CANDIDATES) {
      const token = readDocumentCookie(pageWindow, candidate.cookieName);
      if (!token) continue;
      GM_setValue(CSRF_CONFIG_KEY, { fieldName: candidate.fieldName, cookieName: candidate.cookieName });
      return { fieldName: candidate.fieldName, token, source: 'cookie-derive' };
    }

    // ── 来源 4：请求服务端补设 Cookie，再重新反推 ─────────────────────────
    try {
      await this.pageFetchJson(CSRF_COOKIE_PATH, { method: 'GET' });
    } catch { /* 端点不可用则继续 */ }
    for (const candidate of CSRF_FALLBACK_CANDIDATES) {
      const token = readDocumentCookie(pageWindow, candidate.cookieName);
      if (!token) continue;
      GM_setValue(CSRF_CONFIG_KEY, { fieldName: candidate.fieldName, cookieName: candidate.cookieName });
      return { fieldName: candidate.fieldName, token, source: 'cookie-derive-after-fetch' };
    }

    throw createRequestError(
      'CSRF 配置不可用（页面未输出 $SYS，且 Cookie 中未找到已知的 CSRF token）',
      'auth',
    );
  },

  /** 清空缓存的 CSRF 配置，用于收到 403 后强制重新推导 */
  invalidateCsrfConfig() {
    try {
      GM_setValue(CSRF_CONFIG_KEY, {});
    } catch { /* 忽略 */ }
  },

  /**
   * 带 CSRF 的 POST 请求（三个写接口共用）。
   *
   * 统一处理两件事：
   *  1. CSRF 必须走 **form-urlencoded** —— 实测用 JSON body 或把字段放 header 一律 403；
   *  2. 收到 **403 时清缓存并重试一次** —— 若站点轮换了 CSRF 字段名/Cookie 名，
   *     第一次用旧缓存会 403，重试时 `getDynamicCsrf()` 会重新推导。
   */
  async postWithCsrf(path, buildParams, options = {}) {
    const attempt = async () => {
      const { fieldName, token } = await this.getDynamicCsrf();
      const body = new URLSearchParams({ ...buildParams(), [fieldName]: token });
      return this.pageFetchJson(path, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: body.toString(),
        timeout: options.timeout,
      });
    };

    try {
      return await attempt();
    } catch (error) {
      // 403 且是 CSRF 相关 → 清缓存重试一次（应对字段名轮换）
      const status = Number(error?.httpStatus);
      const looksLikeCsrf = /csrf/i.test(String(error?.message || ''))
        || /csrf/i.test(JSON.stringify(error?.payload || {}));
      if (status === 403 || looksLikeCsrf) {
        this.invalidateCsrfConfig();
        Utils.log('[CSRF] 收到 403，已清缓存并重试一次（可能是字段名轮换）。');
        return attempt();
      }
      throw error;
    }
  },

  cachePageCsrfConfig() {
    const embedded = readEmbeddedCsrfConfig(this.getPageWindow());
    if (!isCompleteCsrfConfig(embedded)) return false;
    GM_setValue(CSRF_CONFIG_KEY, embedded);
    return true;
  },

  async getRoomRedBags(rid, options = {}) {
    const payload = await this.pageFetchJson(
      `${RED_BAG_ROOM_LIST_PATH}?rid=${encodeURIComponent(rid)}`,
      { method: 'GET', timeout: options.timeout },
    );
    if (Number(payload?.error) !== 0 || !Array.isArray(payload?.data?.redBagList)) {
      throw createRequestError(
        String(payload?.msg || '红包列表响应结构异常'),
        'protocol',
        { businessError: payload?.error },
      );
    }
    return { ...payload.data, receivedAt: Date.now() };
  },

  async rankSquareCandidates(candidates) {
    const probes = await mapWithConcurrency(
      candidates,
      SETTINGS.API_ROOM_PROBE_CONCURRENCY,
      async (candidate) => {
        try {
          const roomData = await this.getRoomRedBags(candidate.rid, {
            timeout: SETTINGS.API_ROOM_PROBE_TIMEOUT,
          });
          const bag = selectActiveRedBag({
            redBagList: roomData.redBagList,
            roomId: candidate.rid,
          });
          if (!bag) return { candidate, state: 'stale', bag: null };
          return { candidate, state: 'ranked', bag };
        } catch (error) {
          return { candidate, state: 'unverified', bag: null, error };
        }
      },
    );

    const ranked = probes.filter((probe) => probe.state === 'ranked');
    ranked.sort((left, right) => {
      const prizeOrder = compareRedBagPrizeValue(left.bag, right.bag);
      if (prizeOrder !== 0) return prizeOrder;
      if (left.bag.waitSec !== right.bag.waitSec) return left.bag.waitSec - right.bag.waitSec;
      return left.candidate.sourceIndex - right.candidate.sourceIndex;
    });
    const unverified = probes.filter((probe) => probe.state === 'unverified');
    const staleCount = probes.length - ranked.length - unverified.length;

    Utils.log(
      `[房间优选] 已探测 ${probes.length} 个候选：有效 ${ranked.length}，` +
      `已失效 ${staleCount}，查询失败 ${unverified.length}。`
    );
    if (ranked[0]) {
      const pool = summarizeRedBagPrizePool(ranked[0].bag);
      Utils.log(
        `[房间优选] 当前最高奖池房间 ${ranked[0].candidate.rid}：` +
        `金币 ${pool.coins}，星光棒 ${pool.starlight}，总量 ${pool.total}，` +
        `等待 ${ranked[0].bag.waitSec} 秒。`
      );
    }

    return [...ranked, ...unverified]
      .map((probe) => `https://www.douyu.com/${probe.candidate.rid}`);
  },

  async snatchRedBag({ rid, id, code }) {
    if (!rid || !id || !code) {
      throw createRequestError('红包身份参数不完整', 'protocol');
    }
    return this.postWithCsrf(RED_BAG_SNATCH_PATH, () => ({
      code: String(code),
      id: String(id),
      rid: String(rid),
    }));
  },

  // ── 新版活动：抽奖机 ────────────────────────────────────────────────────
  /**
   * 读取活动配置（含抽奖成本与保底阈值）。
   *
   * 实测（2026-09-15）返回结构：
   *   data.treasureConfig.useGoldNum  —— 每次抽奖消耗的金币数（当前 10）
   *   data.treasureConfig.hitTime     —— 保底阈值（当前 166，累计抽满即触发保底奖励）
   *   data.treasureConfig.treasureRewards[] —— 奖励表（prob / guarantee / num）
   *
   * 该接口可匿名同源 GET，返回 error=0。
   */
  async getActivityConfig() {
    const payload = await this.pageFetchJson(ACTIVITY_CONFIG_PATH, { method: 'GET' });
    if (Number(payload?.error) !== 0 || !payload?.data) {
      throw createRequestError(
        String(payload?.msg || '活动配置响应结构异常'),
        'protocol',
        { businessError: payload?.error },
      );
    }
    return payload.data;
  },

  /**
   * 读取抽奖信息。
   *
   * 实测返回：
   *   data.myCoin            —— 当前金币
   *   data.remainLotteryNum  —— **距离保底的剩余次数**（不是可用抽奖次数；
   *                             对应配置里的 treasureConfig.hitTime）
   *   data.prizeList[]       —— 奖池（prizeDesc / prizeIdentity / prizeIcon / isStock）
   */
  async getLotteryInfo() {
    const payload = await this.pageFetchJson(LOTTERY_INFO_PATH, { method: 'GET' });
    if (Number(payload?.error) !== 0 || !payload?.data) {
      throw createRequestError(
        String(payload?.msg || '抽奖信息响应结构异常'),
        'protocol',
        { businessError: payload?.error },
      );
    }
    return payload.data;
  },

  /** 读取我的中奖记录（data.prizeList[]：prizeDesc / prizeNum / prizeIcon / ts） */
  async getLotteryWinRecords() {
    const payload = await this.pageFetchJson(LOTTERY_WIN_RECORD_PATH, { method: 'GET' });
    if (Number(payload?.error) !== 0 || !payload?.data) {
      throw createRequestError(
        String(payload?.msg || '中奖记录响应结构异常'),
        'protocol',
        { businessError: payload?.error },
      );
    }
    return Array.isArray(payload.data.prizeList) ? payload.data.prizeList : [];
  },

  /**
   * 执行抽奖。
   *
   * 实测契约（2026-09-15 真实抽奖验证，消耗 10 金币）：
   *   POST /user/lottery/do?num=1      ← num 走 query string
   *   Content-Type: x-www-form-urlencoded
   *   body: rid=<rid>&<csrfFieldName>=<token>
   *   响应: {error:0, msg:"success", data:{prizeList:[{prizeDesc, prizeNum, prizeIcon, ts, sort}]}}
   *
   * 注意：
   *  - CSRF **必须走 form-urlencoded**；用 JSON body 会返回 403 csrf auth failed（实测）。
   *  - num 最小为 1，传 0 会得到 {"error":1,"msg":"最小不能小于1"}。
   *  - 金币不足返回 {"error":12022,"msg":"金币不足"}，**不会扣款**。
   *
   * @param {object} params
   * @param {string} params.rid  活动房间号
   * @param {number} [params.num=1] 抽奖次数（活动页单抽 1、十连 10）
   * @returns {Promise<{prizeList: Array, raw: object}>}
   */
  async drawLottery({ rid, num = 1 } = {}) {
    const count = Math.max(1, Math.floor(Number(num) || 1));
    if (!rid) throw createRequestError('抽奖需要房间号', 'protocol');

    const payload = await this.postWithCsrf(
      `${LOTTERY_DO_PATH}?num=${count}`,
      () => ({ rid: String(rid) }),
    );

    if (Number(payload?.error) !== 0) {
      const code = Number(payload?.error);
      throw createRequestError(
        String(payload?.msg || '抽奖失败'),
        code === LOTTERY_ERROR.COIN_NOT_ENOUGH ? 'business' : 'protocol',
        { businessError: code },
      );
    }
    return {
      prizeList: Array.isArray(payload?.data?.prizeList) ? payload.data.prizeList : [],
      raw: payload,
    };
  },

  /**
   * 标记候选红包已读（新版活动页调用）。
   *
   * 实测：该接口**只接受 form-urlencoded**，且必须带 rid + rbId + csrf 字段：
   *   POST /redbag/square/read       body: rid=<rid>&rbId=<rbId>&<csrf>=<token>
   *   → {"error":0,"msg":"success","data":1}
   *
   * 失败对照（均为实测）：
   *   - 空 body / JSON body / 把 csrf 放 header → 403 csrf auth failed
   *   - 缺 rid 或 rbId → {"error":1,"msg":"rid不为空rbId不为空"}
   *   - GET          → {"error":1,"msg":"非法请求"}
   */
  async markSquareBagRead({ rid, rbId }) {
    if (!rid || !rbId) throw createRequestError('标记已读需要 rid 与 rbId', 'protocol');
    return this.postWithCsrf(RED_BAG_SQUARE_READ_PATH, () => ({
      rid: String(rid),
      rbId: String(rbId),
    }));
  },

  /**
   * 获取共享URL池。
   * @returns {string[]}
   */
  getRoomPool() {
    const pool = GM_getValue(ROOM_POOL_KEY, []);
    return Array.isArray(pool) ? pool : [];
  },

  /**
   * 保存共享URL池。
   * @param {string[]} pool
   */
  setRoomPool(pool) {
    GM_setValue(ROOM_POOL_KEY, Array.isArray(pool) ? pool : []);
  },

  /**
   * 获取URL对应的房间ID。
   * @param {string} url
   * @returns {string|null}
   */
  getRoomIdFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    return url.match(/\/(\d+)/)?.[1] || null;
  },

  /**
   * 加锁（用于池读写的原子化）。
   */
  async acquireRoomPoolLock() {
    while (GM_getValue(ROOM_POOL_LOCK_KEY, false)) {
      await Utils.sleep(20);
    }
    GM_setValue(ROOM_POOL_LOCK_KEY, true);
  },

  /**
   * 释放锁。
   */
  releaseRoomPoolLock() {
    GM_setValue(ROOM_POOL_LOCK_KEY, false);
  },

  /**
   * 从池中消费一个可用URL（池空时自动调用 getRooms 补池）。
   * @param {number} count - 期望获取的房间数量。
   * @param {string} rid - 当前房间ID。
   * @param {number} [retries=SETTINGS.API_RETRY_COUNT] - 重试次数。
   * @returns {Promise<string|null>} - 单个可用URL。
   */
  async getRoom(count, rid, retries = SETTINGS.API_RETRY_COUNT) {
    // 缓存动态字段映射作为控制页路由变化时的回退，不保存 Cookie/token。
    this.cachePageCsrfConfig();

    const consumeFromPool = () => {
      const uniquePool = Array.from(new Set(this.getRoomPool()));
      if (uniquePool.length === 0) {
        this.setRoomPool(uniquePool);
        return null;
      }

      const [url] = uniquePool.splice(0, 1);
      this.setRoomPool(uniquePool);
      return url || null;
    };

    // 1) 优先消费现有池
    await this.acquireRoomPoolLock();
    try {
      const cachedUrl = consumeFromPool();
      if (cachedUrl) {
        Utils.log(`[房间池] 命中缓存URL: ${cachedUrl}`);
        return cachedUrl;
      }
    } finally {
      this.releaseRoomPoolLock();
    }

    // 2) 池空则拉取
    const fetchedRooms = await this.getRooms(count, rid, retries);

    // 3) 合并新池并消费
    await this.acquireRoomPoolLock();
    try {
      const mergedPool = Array.from(
        new Set([...this.getRoomPool(), ...fetchedRooms]),
      );
      this.setRoomPool(mergedPool);

      const nextUrl = consumeFromPool();
      if (nextUrl) {
        Utils.log(`[房间池] 拉取后消费URL: ${nextUrl}`);
        return nextUrl;
      }

      Utils.log("[房间池] 拉取后仍无可用URL。");
      return null;
    } finally {
      this.releaseRoomPoolLock();
    }
  },

  /**
   * 通过 API 获取可领取红包的房间列表。
   * @param {number} count - 期望获取的房间数量。
   * @param {string} rid - 当前房间的ID。
   * @param {number} [retries=SETTINGS.API_RETRY_COUNT] - 重试次数。
   * @returns {Promise<string[]>} - 房间链接数组。
   */
  getRooms(count, rid, retries = SETTINGS.API_RETRY_COUNT) {
    return new Promise((resolve, reject) => {
      const attempt = (remainingTries) => {
                Utils.log(`开始调用 API 获取房间列表... (剩余重试次数: ${remainingTries})`);
        GM_xmlhttpRequest({
                    method: 'GET',
          url: `${SETTINGS.API_URL}?rid=${rid}`,
          headers: {
                        Referer: 'https://www.douyu.com/',
                        'User-Agent': navigator.userAgent,
          },
                    responseType: 'json',
          timeout: 10000,
          onload: (response) => {
            if (
              response.status === 200 &&
              response.response?.error === 0 &&
              Array.isArray(response.response.data?.redBagList)
            ) {
              const candidates = normalizeSquareCandidates(
                response.response.data.redBagList,
                count * 2,
              );
              this.rankSquareCandidates(candidates)
                .then((rooms) => {
                  Utils.log(`API 成功返回并排序 ${rooms.length} 个房间URL。`);
                  resolve(rooms);
                })
                .catch((error) => {
                  Utils.log(`候选房间奖池排序失败，保留 square/list 原顺序: ${error.message}`);
                  resolve(candidates.map((item) => `https://www.douyu.com/${item.rid}`));
                });
            } else {
              const errorMsg = `API 数据格式错误或失败: ${
                                response.response?.msg || '未知错误'
              }`;
              Utils.log(errorMsg);
              if (remainingTries > 0) retry(remainingTries - 1, errorMsg);
              else reject(new Error(errorMsg));
            }
          },
          onerror: (error) => {
                        const errorMsg = `API 请求网络错误: ${error.statusText || '未知'}`;
            Utils.log(errorMsg);
            if (remainingTries > 0) retry(remainingTries - 1, errorMsg);
            else reject(new Error(errorMsg));
          },
          ontimeout: () => {
                        const errorMsg = 'API 请求超时';
            Utils.log(errorMsg);
            if (remainingTries > 0) retry(remainingTries - 1, errorMsg);
            else reject(new Error(errorMsg));
          },
        });
      };

      const retry = (remainingTries, reason) => {
                Utils.log(`${reason}，将在 ${SETTINGS.API_RETRY_DELAY / 1000} 秒后重试...`);
        setTimeout(() => attempt(remainingTries), SETTINGS.API_RETRY_DELAY);
      };

      attempt(retries);
    });
  },

  /**
   * 返回用户的金币历史列表
   * @param current - 当前页码
   * @param count - 返回数量单次获取不超过100
   * @param retries - 重试次数
   * @returns {Promise<Array<{
   *  balanceDiff: number,
   *  createTime: number,
   *  opDirection: number,
   *  remark: string
   * }>>}
   */
  async getCoinRecord(current, count, retries = SETTINGS.API_RETRY_COUNT) {
    const query = new URLSearchParams({
      current: String(Math.max(1, Number(current) || 1)),
      pageSize: String(Math.min(100, Math.max(10, Number(count) || 20))),
    });
    const requestUrl = `${SETTINGS.COIN_LIST_URL}?${query.toString()}`;
    const retryCount = Math.max(0, Number(retries) || 0);

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const remainingTries = retryCount - attempt;
      Utils.log(`开始调用 API 获取金币历史列表... (剩余重试次数: ${remainingTries})`);
      try {
        // 与斗鱼官方活动页保持一致：同源请求自动携带完整登录会话。
        const payload = await this.pageFetchJson(requestUrl, { method: 'GET' });
        const businessError = Number(payload?.error);
        if (businessError !== 0) {
          throw createRequestError(
            String(payload?.msg || '金币记录接口返回失败'),
            businessError === -9 ? 'auth' : 'business',
            { businessError },
          );
        }
        if (!Array.isArray(payload?.data?.list)) {
          throw createRequestError('金币记录响应结构异常', 'protocol');
        }

        const coinListData = payload.data.list.filter((item) =>
          Number(item?.opDirection) === 1 && String(item?.remark || '').includes('红包')
        );
        Utils.log(`API 成功返回 ${coinListData.length} 个红包记录。`);
        return coinListData;
      } catch (error) {
        if (error?.kind !== 'transport' || remainingTries === 0) throw error;
        Utils.log(
          `${error.message}，将在 ${SETTINGS.API_RETRY_DELAY / 1000} 秒后重试...`
        );
        await Utils.sleep(SETTINGS.API_RETRY_DELAY);
      }
    }

    return [];
  },
};
