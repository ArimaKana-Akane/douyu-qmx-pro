/**
 * @file LotteryAutoRunner.js
 * @description 新版活动「抽奖机」的自动抽奖调度。
 *
 * 背景（2026-09-15 现网实测）：斗鱼已把全民星推荐的红包改版为**抽奖机**——
 * 不再是「抢红包池」，而是「攒金币 → 抽奖」。原 `WorkerPage` 的 DOM 点击路径
 * 因此整体失效（选择器命中数为 0），本模块对接新接口。
 *
 * 与旧路径的关系：旧 `redbag/snatch` 接口仍可查询，但新活动页走 `user/lottery/*`。
 * 两者并存，本模块只负责抽奖侧。
 *
 * 默认策略（由用户指定）：**金币攒到 100（= 十连成本）才自动抽奖**。
 * 这样比攒够 10 就单抽更划算：十连有 `tenLotteryRewardType` 的额外奖励语义。
 *
 * 安全设计：
 * - 金币不足（error 12022）不视为失败，安静等待下次检查；
 * - 抽奖前先读 info 确认金币，不盲目调用（避免产生无意义的失败请求）；
 * - 单次调度最多抽一轮，绝不循环猛抽（防止配置错误导致金币被瞬间清空）；
 * - 任何请求异常都不中断任务，只记录并按间隔重试。
 */
import { Utils } from '../../utils/utils.js';
import { DouyuAPI, LOTTERY_ERROR } from '../../utils/DouyuAPI.js';
import { SETTINGS } from '../../modules/SettingsManager.js';
import { ClaimEventStore, LOTTERY_PHASE } from '../stats/ClaimEventStore.js';
import { GM_getValue, GM_setValue } from '$';

const ENABLED_KEY = 'douyu_qmx_lottery_auto_enabled';
const STATE_KEY = 'douyu_qmx_lottery_auto_state';

/**
 * 一次十连的金币成本（硬边界，不可配置）。
 *
 * 由活动配置 `treasureConfig.useGoldNum`（当前 10）决定：单抽 10 金币，十连 10 次。
 * 用户可调的是**触发阈值**（`SETTINGS.LOTTERY_DRAW_THRESHOLD`），不是这个成本。
 */
const TEN_DRAW_COST = 100;
/** 十连的次数参数 */
const TEN_DRAW_COUNT = 10;
/** 轮询间隔：金币靠「用户任务」慢慢攒（实测每笔 +2/+15），不需要高频检查 */
const CHECK_INTERVAL_MS = 60_000;

let timer = null;
let running = false;

/**
 * 读取当前生效的触发阈值。
 *
 * 为什么在 tick 时现读而不是启动时快照：`SettingsManager.update()` 会原地
 * `Object.assign` 到 `SETTINGS` 上，因此这里能拿到用户刚保存的新值，
 * 无需重载页面即可生效。同时做一次防御性夹取 —— 阈值低于十连成本时
 * 会陷入「够阈值却抽不动」的死循环（服务端恒返回 12022）。
 */
const readThreshold = () => {
    const raw = Number(SETTINGS?.LOTTERY_DRAW_THRESHOLD);
    if (!Number.isFinite(raw) || raw < TEN_DRAW_COST) return TEN_DRAW_COST;
    return Math.round(raw);
};

const readEnabled = () => {
    try {
        return GM_getValue(ENABLED_KEY, false) === true;
    } catch {
        return false;
    }
};

const writeEnabled = (value) => {
    try {
        GM_setValue(ENABLED_KEY, value === true);
    } catch { /* 忽略 */ }
};

const readState = () => {
    try {
        const s = GM_getValue(STATE_KEY, null);
        return s && typeof s === 'object' ? s : {};
    } catch {
        return {};
    }
};

const writeState = (patch) => {
    try {
        GM_setValue(STATE_KEY, { ...readState(), ...patch, updatedAt: Date.now() });
    } catch { /* 忽略 */ }
};

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/** 把中奖结果转成一行可读文本 */
const formatPrizes = (prizeList) => (Array.isArray(prizeList) ? prizeList : [])
    .map((p) => `${p?.prizeDesc || '未知奖品'}×${toNumber(p?.prizeNum)}`)
    .filter(Boolean)
    .join('、');

/**
 * 把奖池折算成「金币 / 星光棒」两类总量。
 *
 * 类型编码与红包共用：9 = 金币，2 = 星光棒，其余（弹幕皮肤/头像框/勋章等）
 * 不计入数值统计。口径必须与 RedBagState.summarizePrizePool 一致，
 * 否则「收益趋势」会把同一类奖励算成两种东西。
 *
 * ⚠️ 关键：抽奖响应**不含 `prizeType`/`ptype`**，只有 `prizeDesc`/`prizeNum`。
 * 实测自本文档 §4.3 记录的真实响应：
 *   { "prizeDesc": "星光棒", "prizeNum": 20, "sort": 10, "prizeIcon": "...", "ts": ... }
 * 而红包响应才有 `ptype`。旧实现只读数字类型字段，于是
 *   Number(undefined) === NaN → 两个分支都不进 → 全部奖品折算成 0。
 * 后果：抽奖赢到的星光棒从未进入统计，「星光棒总计」长期偏低，
 * 而「抽奖净收益」显示成「只有成本没有收入」的负数。
 *
 * 因此这里用**数字类型优先、文本名称兜底**：
 * - 数字类型存在且可识别时以它为准（红包路径不受影响）；
 * - 缺失时按 `prizeDesc` 文本判断。文本是服务端下发的展示名，
 *   比「猜一个数字编码」可靠，且抽奖奖励表只有星光棒与金币两类数值奖励。
 * - 认不出来的一律不计入（宁可漏计也不错计成另一种货币）。
 */
const PRIZE_TYPE_COIN = 9;
const PRIZE_TYPE_STARLIGHT = 2;

/** 从奖品描述文本判断数值类型；认不出返回 null（不计入）。 */
const classifyPrizeByText = (desc) => {
    const text = String(desc || '');
    if (!text) return null;
    // 星光棒在不同位置也叫「荧光棒」，两者都认。
    if (text.includes('星光棒') || text.includes('荧光棒')) return PRIZE_TYPE_STARLIGHT;
    if (text.includes('金币')) return PRIZE_TYPE_COIN;
    return null;
};

export const summarizeDrawPrizes = (prizeList) => (Array.isArray(prizeList) ? prizeList : [])
    .reduce((acc, prize) => {
        const amount = toNumber(prize?.prizeNum ?? prize?.num);
        if (amount <= 0) return acc;

        // 数字类型优先；缺失或无法识别时退回文本判据。
        const rawType = prize?.prizeType ?? prize?.ptype;
        const numericType = Number(rawType);
        const prizeType = Number.isFinite(numericType) && rawType !== undefined && rawType !== null
            ? numericType
            : classifyPrizeByText(prize?.prizeDesc ?? prize?.name);

        if (prizeType === PRIZE_TYPE_COIN) acc.coins += amount;
        else if (prizeType === PRIZE_TYPE_STARLIGHT) acc.starlight += amount;
        return acc;
    }, { coins: 0, starlight: 0 });

export const LotteryAutoRunner = {
    /** 自动抽奖是否已开启 */
    isEnabled() {
        return readEnabled();
    },

    /** 读取最近一次抽奖结果（供 UI 展示） */
    getState() {
        return readState();
    },

    setEnabled(enabled) {
        writeEnabled(enabled);
        if (enabled) {
            Utils.log('[抽奖] 已开启自动抽奖（金币达到 100 时自动十连）。');
            this.start();
        } else {
            Utils.log('[抽奖] 已关闭自动抽奖。');
            this.stop();
        }
    },

    /**
     * 单次检查并按需抽奖。
     *
     * @returns {Promise<{action: string, reason?: string, prizeText?: string}>}
     *   action: 'drawn' 已抽奖 | 'skipped' 条件不满足 | 'no-room' 无房间号 | 'error'
     */
    async tick() {
        const rid = Utils.getCurrentRoomId();
        if (!rid) return { action: 'no-room' };

        let info;
        try {
            info = await DouyuAPI.getLotteryInfo();
        } catch (error) {
            writeState({ lastError: String(error?.message || error) });
            Utils.log(`[抽奖] 读取抽奖信息失败：${error?.message || error}`);
            return { action: 'error', reason: 'info-failed' };
        }

        const coin = toNumber(info?.myCoin);
        const remain = toNumber(info?.remainLotteryNum);
        const threshold = readThreshold();
        writeState({ myCoin: coin, remainLotteryNum: remain, threshold });

        if (coin < threshold) {
            return { action: 'skipped', reason: `金币不足（${coin}/${threshold}）` };
        }

        try {
            const result = await DouyuAPI.drawLottery({ rid, num: TEN_DRAW_COUNT });
            const prizeText = formatPrizes(result.prizeList);
            const rewards = summarizeDrawPrizes(result.prizeList);
            writeState({
                lastDrawAt: Date.now(),
                lastPrizes: prizeText,
                lastError: '',
                drawCount: toNumber(readState().drawCount) + 1,
            });
            /**
             * 写入数据统计（与红包领取共用 ClaimEventStore）。
             *
             * phase 必须是 'lottery' 而非 'claim'：领取成功率只应由红包决定，
             * 抽奖失败混进去会把它拉低，统计口径就错了。
             */
            ClaimEventStore.record({
                phase: LOTTERY_PHASE,
                result: 'success',
                source: 'lottery',
                roomId: String(rid),
                rewardText: prizeText || '未获得奖励',
                rewards,
                /** 本次实际消耗的金币（十连成本），用于统计页展示净收支 */
                cost: TEN_DRAW_COST,
                /** 本次抽奖的抽取次数（十连 = 10），奖品条目数不等于抽取次数 */
                drawCount: TEN_DRAW_COUNT,
            });
            Utils.claimLog('LOTTERY', '自动十连抽奖成功', {
                roomId: String(rid),
                result: 'success',
                rewardText: prizeText || '未获得奖励',
            });
            return { action: 'drawn', prizeText };
        } catch (error) {
            const code = Number(error?.businessError);
            if (code === LOTTERY_ERROR.COIN_NOT_ENOUGH) {
                // 预期内：金币在读取与调用之间被消耗（例如用户手动抽了）。
                // 不计入统计 —— 这不是一次真实抽奖，记为失败会污染成功率口径。
                return { action: 'skipped', reason: '金币不足' };
            }
            writeState({ lastError: String(error?.message || error) });
            ClaimEventStore.record({
                phase: LOTTERY_PHASE,
                result: 'unknown',
                source: 'lottery',
                roomId: String(rid),
                error: code || undefined,
                reason: String(error?.message || error).slice(0, 160),
            });
            Utils.claimLog('LOTTERY', '自动抽奖失败', {
                roomId: String(rid),
                result: 'unknown',
                error: code || undefined,
                reason: String(error?.message || error).slice(0, 120),
            });
            return { action: 'error', reason: String(error?.message || error) };
        }
    },

    /**
     * 立即执行一次检查（带防重入）。
     *
     * 抽出来是为了让首次检查与轮询走**同一条**代码路径，
     * 避免「首次立即执行」这段逻辑被单独写一遍而产生行为漂移。
     */
    runOnce() {
        if (running) return Promise.resolve({ action: 'busy' });   // 上一轮未结束
        running = true;
        return this.tick()
            .catch(() => ({ action: 'error', reason: 'uncaught' }))  // tick 内部已处理，兜底防断链
            .finally(() => { running = false; });
    },

    /**
     * 启动轮询（幂等）。
     *
     * **首次检查立即执行**，不等到第一个轮询周期。
     *
     * 为什么：轮询间隔是 60 秒，若首次检查也等 60 秒，用户点开开关后
     * 在控制台看不到任何动作，会以为「开关没生效 / 功能坏了」——
     * 这正是 2026-09-16 用户反馈「100 金币不能自动抽奖」的成因之一：
     * 实际只是还没到第一次检查时刻，并非链路不通。
     */
    start() {
        if (timer) return;
        if (!readEnabled()) return;
        Utils.log(`[抽奖] 自动抽奖已启动：立即检查一次，之后每 ${CHECK_INTERVAL_MS / 1000} 秒检查一次。`);
        void this.runOnce();
        timer = setInterval(() => { void this.runOnce(); }, CHECK_INTERVAL_MS);
    },

    stop() {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
        Utils.log('[抽奖] 自动抽奖轮询已停止。');
    },

    dispose() {
        this.stop();
    },
};

export { TEN_DRAW_COST, CHECK_INTERVAL_MS };
