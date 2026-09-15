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
import { GM_getValue, GM_setValue } from '$';

const ENABLED_KEY = 'douyu_qmx_lottery_auto_enabled';
const STATE_KEY = 'douyu_qmx_lottery_auto_state';

/** 十连所需的金币数（单抽 10 × 10 次）。用户明确要求「攒到 100 金币自动抽奖」。 */
const TEN_DRAW_COST = 100;
/** 十连的次数参数 */
const TEN_DRAW_COUNT = 10;
/** 轮询间隔：金币靠「用户任务」慢慢攒（实测每笔 +3/+10），不需要高频检查 */
const CHECK_INTERVAL_MS = 60_000;

let timer = null;
let running = false;

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
        writeState({ myCoin: coin, remainLotteryNum: remain });

        if (coin < TEN_DRAW_COST) {
            return { action: 'skipped', reason: `金币不足（${coin}/${TEN_DRAW_COST}）` };
        }

        try {
            const result = await DouyuAPI.drawLottery({ rid, num: TEN_DRAW_COUNT });
            const prizeText = formatPrizes(result.prizeList);
            writeState({
                lastDrawAt: Date.now(),
                lastPrizes: prizeText,
                lastError: '',
                drawCount: toNumber(readState().drawCount) + 1,
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
                // 预期内：金币在读取与调用之间被消耗（例如用户手动抽了）
                return { action: 'skipped', reason: '金币不足' };
            }
            writeState({ lastError: String(error?.message || error) });
            Utils.claimLog('LOTTERY', '自动抽奖失败', {
                roomId: String(rid),
                result: 'unknown',
                error: code || undefined,
                reason: String(error?.message || error).slice(0, 120),
            });
            return { action: 'error', reason: String(error?.message || error) };
        }
    },

    /** 启动轮询（幂等） */
    start() {
        if (timer) return;
        if (!readEnabled()) return;
        timer = setInterval(() => {
            if (running) return;          // 防重入：上一轮未结束就跳过
            running = true;
            this.tick()
                .catch(() => { /* tick 内部已处理 */ })
                .finally(() => { running = false; });
        }, CHECK_INTERVAL_MS);
        Utils.log(`[抽奖] 自动抽奖轮询已启动（每 ${CHECK_INTERVAL_MS / 1000} 秒检查一次）。`);
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
