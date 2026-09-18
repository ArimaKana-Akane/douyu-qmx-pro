import { GM_getValue, GM_setValue } from '$';

const STORAGE_KEY = 'douyu_qmx_claim_events_v1';
const LOCK_KEY = 'douyu_qmx_claim_events_lock';
const MAX_EVENTS = 2000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const readEvents = () => {
    const value = GM_getValue(STORAGE_KEY, []);
    return Array.isArray(value) ? value : [];
};

const prune = (events, now = Date.now()) => events
    .filter((event) => Number(event.timestamp) >= now - RETENTION_MS)
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
    .slice(0, MAX_EVENTS);

const getAttemptKey = (event) => {
    if (event.bagKey) return String(event.bagKey);
    if (event.bagId !== undefined && event.bagId !== null && event.bagId !== '') {
        return `${String(event.roomId || 'unknown')}:${String(event.bagId)}`;
    }
    return String(event.id || `legacy-${event.timestamp}-${Math.random()}`);
};

/**
 * 抽奖事件（新版活动：抽奖机）的 phase 标记。
 *
 * 必须与领取事件（`phase: 'claim'`）分开：领取的 `successRate` 是
 * 「红包领取成功率」，抽奖的成败与它无关。若混在一起，
 * 一次抽奖失败就会拉低领取成功率，统计口径被污染。
 */
export const LOTTERY_PHASE = 'lottery';

/**
 * 汇总抽奖事件。
 *
 * 与 `summarize()` 里领取部分的关键区别：这里**不做去重合并**。
 * 领取一次红包会产生多条 `phase:'claim'` 事件（同一 bagKey 多次尝试），
 * 所以领取要按 bagKey 归并成「一次尝试」；而抽奖是**每次一条独立事件**，
 * 一次十连就是一次，不存在同一目标的重复尝试，归并反而会把两次抽奖算成一次。
 */
const summarizeLottery = (events) => {
    const draws = events.filter((event) => event.phase === LOTTERY_PHASE);
    const succeeded = draws.filter((event) => event.result === 'success');
    const totals = succeeded.reduce((acc, event) => {
        acc.coins += Number(event.rewards?.coins) || 0;
        acc.starlight += Number(event.rewards?.starlight) || 0;
        acc.spent += Number(event.cost) || 0;
        acc.draws += Number(event.drawCount) || 0;
        return acc;
    }, { coins: 0, starlight: 0, spent: 0, draws: 0 });

    return {
        events: draws,
        /** 抽奖**次数**（一次十连记 1 次），不是抽取的奖品数 */
        count: draws.length,
        success: succeeded.length,
        failed: draws.length - succeeded.length,
        ...totals,
    };
};

/**
 * 星光棒总计：**领取所得 + 抽奖所得**。
 *
 * 为什么单独汇总，而不是在 UI 里把两张卡的数相加：
 * 领取侧的成功事件需要按「成功」过滤后再累加，抽奖侧还要区分 phase，
 * 这套过滤规则如果散在 UI 层，任何一处漏掉 phase 判断就会把两类数字
 * 混在一起（这正是历史上出现过的口径污染）。放在这里只有一个来源，
 * 且可被单测覆盖 —— `StatsInfo.ts` 依赖 DOM，无法测试。
 *
 * 口径约定：
 * - 只统计 `result === "success"` 的事件（失败的领取/抽奖没有星光棒入账）；
 * - **不扣抽奖成本**：抽奖消耗的是金币，与星光棒不是同一种货币，
 *   从星光棒总量里减去金币没有意义。需要看收支关系看 `lottery.spent` 与净收益。
 *
 * @param {Array} events 已按时间范围过滤过的事件列表
 * @returns {{ total: number, fromClaim: number, fromLottery: number }}
 */
const summarizeStarlight = (events) => {
    const starlightOf = (event) => {
        const value = Number(event.rewards?.starlight);
        return Number.isFinite(value) ? value : 0;
    };
    const succeeded = events.filter((event) => event.result === 'success');
    const fromClaim = succeeded
        .filter((event) => event.phase !== LOTTERY_PHASE)
        .reduce((sum, event) => sum + starlightOf(event), 0);
    const fromLottery = succeeded
        .filter((event) => event.phase === LOTTERY_PHASE)
        .reduce((sum, event) => sum + starlightOf(event), 0);
    return { total: fromClaim + fromLottery, fromClaim, fromLottery };
};

export const ClaimEventStore = {
    record(event) {
        const payload = {
            id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            result: 'unknown',
            ...event,
        };

        const commit = () => {
            if (GM_getValue(LOCK_KEY, false)) {
                setTimeout(commit, 40);
                return;
            }
            GM_setValue(LOCK_KEY, true);
            try {
                GM_setValue(STORAGE_KEY, prune([payload, ...readEvents()]));
            } finally {
                GM_setValue(LOCK_KEY, false);
            }
            window.dispatchEvent(new CustomEvent('qmx-claim-event', { detail: payload }));
        };

        commit();
        return payload;
    },

    list({ days = 30 } = {}) {
        const threshold = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
        return prune(readEvents()).filter((event) => Number(event.timestamp) >= threshold);
    },

    summarize({ days = 7 } = {}) {
        const events = this.list({ days });
        const attemptMap = events
            .filter((event) => event.phase === 'claim')
            .reduce((map, event) => {
                const key = getAttemptKey(event);
                const attempt = map.get(key) || { key, events: [] };
                attempt.events.push(event);
                map.set(key, attempt);
                return map;
            }, new Map());
        const attemptList = Array.from(attemptMap.values());
        const successfulAttempts = attemptList.filter((attempt) =>
            attempt.events.some((event) => event.result === 'success')
        );
        const success = successfulAttempts.length;
        const attempts = attemptList.length;
        const byResult = events.reduce((acc, event) => {
            acc[event.result] = (acc[event.result] || 0) + 1;
            return acc;
        }, {});
        const successBySource = successfulAttempts.reduce((acc, attempt) => {
            const successEvent = attempt.events.find((event) => event.result === 'success');
            const source = String(successEvent?.source || 'legacy');
            acc[source] = (acc[source] || 0) + 1;
            return acc;
        }, {});

        return {
            events,
            success,
            attempts,
            successRate: attempts ? Math.round((success / attempts) * 100) : 0,
            byResult,
            successBySource,
            /** 抽奖统计（独立口径，不参与上面的领取成功率） */
            lottery: summarizeLottery(events),
            /** 星光棒总计（领取 + 抽奖），口径见 summarizeStarlight */
            starlight: summarizeStarlight(events),
        };
    },
};
