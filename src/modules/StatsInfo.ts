/**
 * 控制中心统计页。
 * 金币数据以斗鱼账户记录为准，星光棒与异常日志来自本地 ClaimEventStore。
 */
import { SETTINGS } from './SettingsManager.js';
import { Utils } from '../utils/utils.js';
import { DouyuAPI } from '../utils/DouyuAPI.js';
import { ClaimEventStore } from '../features/stats/ClaimEventStore.js';
import { GM_getValue, GM_setValue } from '$';

type DailyReward = { receivedCount: number; total: number; avg: number };
type RewardHistory = Record<string, DailyReward>;
type RuntimeSettings = { STATS_INFO_STORAGE_KEY: string };
type CoinRecord = { createTime: number | string; balanceDiff: number | string };
type RewardTotals = { coins: number; starlight: number };
type ClaimEvent = {
    id?: string;
    timestamp: number;
    result: string;
    phase?: string;
    roomId?: string;
    roomName?: string;
    bagId?: number | string;
    bagKey?: string;
    source?: string;
    reason?: string;
    rewardText?: string;
    rewards?: Partial<RewardTotals>;
    error?: number;
    attemptCount?: number;
    /** 抽奖事件专用：本次消耗的金币 */
    cost?: number;
    /** 抽奖事件专用：本次抽取次数（十连 = 10） */
    drawCount?: number;
};
type LotterySummary = {
    events: ClaimEvent[];
    count: number;
    success: number;
    failed: number;
    coins: number;
    starlight: number;
    spent: number;
    draws: number;
};
/** 星光棒总计（领取 + 抽奖），由 ClaimEventStore.summarizeStarlight 计算 */
type StarlightSummary = {
    total: number;
    fromClaim: number;
    fromLottery: number;
};
type ClaimSummary = {
    events: ClaimEvent[];
    success: number;
    successRate: number;
    attempts: number;
    lottery?: LotterySummary;
    /** 星光棒总计（领取 + 抽奖） */
    starlight?: StarlightSummary;
};

const runtimeSettings = SETTINGS as RuntimeSettings;
const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const RESULT_META: Record<string, { label: string; tone: string }> = {
    success: { label: '领取成功', tone: 'success' },
    empty_or_failed: { label: '空包或失败', tone: 'warning' },
    open_failed: { label: '打开失败', tone: 'error' },
    exhausted: { label: '红包已派完', tone: 'idle' },
    already_claimed: { label: '已经领取', tone: 'idle' },
    auth_failed: { label: '鉴权失败', tone: 'error' },
    daily_limit: { label: '达到上限', tone: 'idle' },
    risk_suspected: { label: '疑似风控', tone: 'error' },
    unknown: { label: '其他', tone: 'idle' },
};

/**
 * 抽奖记录的状态文案。
 *
 * 与领取分开两套：抽奖的 `success` 显示「抽奖成功」而不是「领取成功」，
 * 否则统计页里两种记录长得一样，无法区分。
 */
const LOTTERY_RESULT_META: Record<string, { label: string; tone: string }> = {
    success: { label: '抽奖成功', tone: 'success' },
    unknown: { label: '抽奖失败', tone: 'error' },
};

const EXCEPTION_LOG_RESULTS = new Set([
    'empty_or_failed',
    'open_failed',
    'auth_failed',
    'risk_suspected',
    'unknown',
]);

const state = {
    initialized: false,
    days: 7,
    period: 'daily' as 'daily' | 'weekly',
    logMode: 'all' as 'all' | 'exceptions',
    claimHandler: null as EventListener | null,
    visibilityHandler: null as EventListener | null,
    remoteRefreshPromise: null as Promise<void> | null,
    postClaimRefreshTimer: null as number | null,
};

const escapeHtml = (value: unknown) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const getRewardHistory = (): RewardHistory => {
    const history = GM_getValue(runtimeSettings.STATS_INFO_STORAGE_KEY, {});
    return history && typeof history === 'object' ? history as RewardHistory : {};
};

const formatTime = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
}).format(new Date(timestamp));

const formatNumber = (value: number) => new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
}).format(Number(value) || 0);

const getEventDate = (event: ClaimEvent) => Utils.formatDateAsBeijing(new Date(event.timestamp));

const getDateRange = (days: number) => Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - (days - index - 1) * 86_400_000);
    return Utils.formatDateAsBeijing(date);
});

const getSuccessfulClaimCount = (events: ClaimEvent[]) => {
    const keys = new Set<string>();
    events.filter((event) => event.result === 'success').forEach((event) => {
        const key = event.bagKey || (
            event.bagId !== undefined
                ? `${event.roomId || 'unknown'}:${event.bagId}`
                : event.id || `legacy:${event.timestamp}`
        );
        keys.add(String(key));
    });
    return keys.size;
};

const getRewardTotals = (events: ClaimEvent[]) => events.reduce((totals, event) => {
    if (event.result !== 'success' || !event.rewards) return totals;
    const coins = Number(event.rewards.coins);
    const starlight = Number(event.rewards.starlight);
    if (Number.isFinite(coins)) totals.coins += coins;
    if (Number.isFinite(starlight)) totals.starlight += starlight;
    totals.coveredClaims += 1;
    return totals;
}, { coins: 0, starlight: 0, coveredClaims: 0 });

const getRewardText = (event: ClaimEvent) => {
    const coins = Number(event.rewards?.coins) || 0;
    const starlight = Number(event.rewards?.starlight) || 0;
    const parts = [
        coins > 0 ? `金币 ${formatNumber(coins)}` : '',
        starlight > 0 ? `星光棒 ${formatNumber(starlight)}` : '',
    ].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    if (event.rewardText) return event.rewardText;
    return '未记录奖励详情';
};

/**
 * 抽奖记录的一行摘要：把**成本**也显示出来。
 *
 * 抽奖是支出行为（十连固定扣 100 金币），只显示「抽到星光棒 770」
 * 会让人误以为这一笔是纯收入。用 `−100 → 星光棒 770` 的形式同时给出
 * 成本与所得，收支关系一目了然。
 */
const getLotteryText = (event: ClaimEvent) => {
    const cost = Number(event.cost) || 0;
    const gained = getRewardText(event);
    if (cost > 0) return `−${formatNumber(cost)} 金币 → ${gained}`;
    return gained;
};

export const StatsInfo = {
    init() {
        if (state.initialized || !document.getElementById('qmx-stats-page')) return;
        state.initialized = true;
        this.bindEvents();
        this.removeExpiredData();
        this.refresh();
    },

    bindEvents() {
        document.querySelectorAll<HTMLButtonElement>('.qmx-stats-range [data-period]').forEach((button) => {
            button.onclick = () => {
                state.period = button.dataset.period === 'weekly' ? 'weekly' : 'daily';
                state.days = state.period === 'weekly' ? 28 : 7;
                document.querySelectorAll('.qmx-stats-range [data-period]').forEach((item) => {
                    item.classList.toggle('active', item === button);
                });
                this.refresh();
            };
        });

        document.querySelectorAll<HTMLButtonElement>('.qmx-stats-log-range [data-log-mode]').forEach((button) => {
            button.onclick = () => {
                state.logMode = button.dataset.logMode === 'exceptions' ? 'exceptions' : 'all';
                document.querySelectorAll('.qmx-stats-log-range [data-log-mode]').forEach((item) => {
                    item.classList.toggle('active', item === button);
                });
                this.refresh();
            };
        });

        const refreshButton = document.querySelector<HTMLButtonElement>('.qmx-stats-refresh');
        if (refreshButton) {
            refreshButton.onclick = async () => {
                refreshButton.classList.remove('rotating');
                void refreshButton.offsetWidth;
                refreshButton.classList.add('rotating');
                await this.refreshFromSources();
                window.setTimeout(() => refreshButton.classList.remove('rotating'), 900);
            };
        }

        state.claimHandler = ((event: Event) => {
            this.refresh();
            const claimEvent = (event as CustomEvent<ClaimEvent>).detail;
            if (claimEvent?.result !== 'success') return;
            if (state.postClaimRefreshTimer) window.clearTimeout(state.postClaimRefreshTimer);
            state.postClaimRefreshTimer = window.setTimeout(() => {
                state.postClaimRefreshTimer = null;
                void this.refreshFromSources();
            }, 2_000);
        }) as EventListener;
        state.visibilityHandler = (() => {
            if (document.visibilityState === 'visible') this.refresh();
        }) as EventListener;
        window.addEventListener('qmx-claim-event', state.claimHandler);
        document.addEventListener('visibilitychange', state.visibilityHandler);
    },

    destroy() {
        if (state.claimHandler) window.removeEventListener('qmx-claim-event', state.claimHandler);
        if (state.visibilityHandler) document.removeEventListener('visibilitychange', state.visibilityHandler);
        state.claimHandler = null;
        state.visibilityHandler = null;
        state.remoteRefreshPromise = null;
        if (state.postClaimRefreshTimer) window.clearTimeout(state.postClaimRefreshTimer);
        state.postClaimRefreshTimer = null;
        state.initialized = false;
    },

    async refreshFromSources() {
        if (!state.initialized) return;
        if (state.remoteRefreshPromise) return state.remoteRefreshPromise;
        state.remoteRefreshPromise = (async () => {
            await this.getCoinListUpdate();
            this.refresh();
        })().finally(() => {
            state.remoteRefreshPromise = null;
        });
        return state.remoteRefreshPromise;
    },

    async getCoinListUpdate() {
        try {
            const coinList = await DouyuAPI.getCoinRecord(1, 100, 3) as CoinRecord[];
            if (!Array.isArray(coinList)) return;
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const todayRecords = coinList.filter((item) => Number(item.createTime) > startOfToday.getTime() / 1000);
            const total = todayRecords.reduce((sum, item) => sum + (Number(item.balanceDiff) || 0), 0);
            const today = Utils.formatDateAsBeijing(new Date());
            const history = getRewardHistory();
            history[today] = {
                receivedCount: todayRecords.length,
                total,
                avg: todayRecords.length ? Number((total / todayRecords.length).toFixed(2)) : 0,
            };
            GM_setValue(runtimeSettings.STATS_INFO_STORAGE_KEY, history);
        } catch (error: unknown) {
            Utils.log(`[数据统计] 金币记录刷新失败: ${getErrorMessage(error)}`);
        }
    },

    refresh() {
        if (!state.initialized) return;
        const summary = ClaimEventStore.summarize({ days: state.days }) as ClaimSummary;
        const history = getRewardHistory();
        /**
         * 领取事件（红包）与抽奖事件分流。
         *
         * **为什么必须分流**：`getRewardTotals()` 只按 `result === 'success'` 过滤，
         * 不带 phase 判断。若把抽奖事件一起传进去，抽奖赢到的星光棒会被算进
         * 「今日星光棒」，而这张卡原本的语义是「红包收益」；同时抽奖支出的 100 金币
         * 也不在这个口径里，收支会显示成只有收入没有成本。
         * 因此既有卡片一律只看领取事件，抽奖结果单独成卡。
         */
        const claimEvents = summary.events.filter((event) => event.phase !== 'lottery');

        this.renderSummary(summary, history, claimEvents);
        this.renderTrend(claimEvents, history);
        this.renderLogs(summary.events);
    },

    renderSummary(summary: ClaimSummary, history: RewardHistory, claimEvents: ClaimEvent[]) {
        const container = document.getElementById('qmx-stats-summary');
        if (!container) return;
        const today = Utils.formatDateAsBeijing(new Date());
        const todayEvents = claimEvents.filter((event) => getEventDate(event) === today);
        const localRewards = getRewardTotals(todayEvents);
        const accountReward = history[today] || { receivedCount: 0, total: 0, avg: 0 };
        const todayClaims = Math.max(getSuccessfulClaimCount(todayEvents), accountReward.receivedCount);
        const lottery = summary.lottery;
        const cards: Array<{ value: string | number; label: string; tone: string }> = [
            { value: todayClaims, label: '今日领取', tone: 'success' },
            { value: formatNumber(Math.max(accountReward.total, localRewards.coins)), label: '今日金币', tone: 'coin' },
            { value: formatNumber(localRewards.starlight), label: '今日星光棒', tone: 'starlight' },
            {
                /**
                 * 星光棒**总计** = 领取所得 + 抽奖所得。
                 *
                 * 这两笔原本分散在不同卡里（「今日星光棒」只含领取；抽奖所得混在
                 * 「抽奖净收益」的金币口径里），看不出真实的星光棒收入。
                 *
                 * 汇总口径由 ClaimEventStore 提供（可单测），这里只负责展示 ——
                 * 过滤规则散在 UI 层正是历史上口径污染的原因。
                 *
                 * 注意：**不扣抽奖成本**。成本扣的是金币，与星光棒不是同一种货币，
                 * 从星光棒总量里减金币没有意义。要看收支关系看「抽奖净收益」。
                 */
                value: formatNumber(summary.starlight?.total || 0),
                label: state.period === 'weekly' ? '4周星光棒总计' : '7天星光棒总计',
                tone: 'starlight',
            },
            {
                value: `${summary.successRate}%`,
                label: state.period === 'weekly' ? '4周成功率' : '7天成功率',
                tone: summary.successRate >= 60 ? 'success' : 'warning',
            },
        ];
        /**
         * 抽奖次数卡。
         *
         * 用**抽奖次数**而不是奖品条目数：一次十连会返回多条 prizeList，
         * 用条目数会显示成 10 次，与「抽了 1 次十连」的直觉不符。
         *
         * 已移除「抽奖净收益」卡（用户要求）：它把**金币成本**与
         * **星光棒收益**放在同一个数字里相减，两种货币不可通约，
         * 结果是一个既不是金币也不是星光棒的混合量。要看星光棒收入
         * 请看「星光棒总计」（已包含抽奖所得）；要看金币支出请看日志。
         *
         * 只在确实有抽奖记录时才追加：没有记录的账号不该看到 0 卡片。
         */
        if (lottery && lottery.count > 0) {
            cards.push({
                value: lottery.count,
                label: state.period === 'weekly' ? '4周抽奖次数' : '7天抽奖次数',
                tone: 'success',
            });
        }
        container.innerHTML = cards.map((card) => `
            <div class="qmx-stat-card" data-tone="${card.tone}">
                <strong>${escapeHtml(card.value)}</strong>
                <span>${escapeHtml(card.label)}</span>
            </div>
        `).join('');
    },

    renderTrend(events: ClaimEvent[], history: RewardHistory) {
        const container = document.getElementById('qmx-stats-trend');
        if (!container) return;
        const dates = getDateRange(state.days);
        const dateGroups = state.period === 'weekly'
            ? Array.from({ length: 4 }, (_, index) => dates.slice(index * 7, index * 7 + 7))
            : dates.map((date) => [date]);
        const values = dateGroups.map((group) => {
            const dateSet = new Set(group);
            const rewards = getRewardTotals(events.filter((event) => dateSet.has(getEventDate(event))));
            const accountCoins = group.reduce((sum, date) => sum + (Number(history[date]?.total) || 0), 0);
            return {
                coins: Math.max(accountCoins, rewards.coins),
                starlight: rewards.starlight,
            };
        });
        const max = Math.max(1, ...values.flatMap((reward) => [reward.coins, reward.starlight]));
        const getHeight = (value: number) => value > 0
            ? Math.max(4, Math.round((value / max) * 72))
            : 0;
        container.classList.toggle('is-weekly', state.period === 'weekly');
        container.innerHTML = dateGroups.map((group, index) => {
            const reward = values[index];
            const firstDate = group[0];
            const lastDate = group[group.length - 1];
            const label = state.period === 'weekly'
                ? `${firstDate.slice(5).replace('-', '/')}–${lastDate.slice(5).replace('-', '/')}`
                : firstDate.slice(5);
            const title = state.period === 'weekly' ? `${firstDate} 至 ${lastDate}` : firstDate;
            return `
            <div class="qmx-trend-column has-label"
                 title="${title}：金币 ${reward.coins}，星光棒 ${reward.starlight}">
                <span class="qmx-trend-values">
                    <b data-reward="coin">${formatNumber(reward.coins)}</b>
                    <b data-reward="starlight">${formatNumber(reward.starlight)}</b>
                </span>
                <span class="qmx-trend-bars">
                    <i data-reward="coin" style="height:${getHeight(reward.coins)}px"></i>
                    <i data-reward="starlight" style="height:${getHeight(reward.starlight)}px"></i>
                </span>
                <small>${label}</small>
            </div>
        `;
        }).join('');
    },

    renderLogs(events: ClaimEvent[]) {
        const container = document.getElementById('qmx-stats-timeline');
        const details = document.getElementById('qmx-stats-diagnostics');
        const count = document.getElementById('qmx-stats-diagnostic-count');
        const label = document.getElementById('qmx-stats-log-label');
        if (!container || !details || !count || !label) return;
        const claimEvents = events.filter((event) => event.phase === 'claim');
        const lotteryEvents = events.filter((event) => event.phase === 'lottery');
        /**
         * 抽奖记录与领取记录一并展示（用户要求「把每次抽奖的结果也写入数据统计」）。
         *
         * 完整视图下两者混排按时间倒序，这样「领到钱 → 去抽奖」的因果链一眼可见；
         * 异常视图下只保留失败抽奖 —— 成功抽奖不是异常，不该出现在异常列表里。
         */
        const logs = state.logMode === 'exceptions'
            ? [
                ...claimEvents.filter((event) => EXCEPTION_LOG_RESULTS.has(event.result)),
                ...lotteryEvents.filter((event) => event.result !== 'success'),
            ].sort((a, b) => Number(b.timestamp) - Number(a.timestamp))
            : [...claimEvents, ...lotteryEvents]
                .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        const hasExceptions = logs.some((event) =>
            event.phase === 'lottery'
                ? event.result !== 'success'
                : EXCEPTION_LOG_RESULTS.has(event.result)
        );
        details.dataset.tone = hasExceptions ? 'warning' : 'stable';
        label.textContent = state.logMode === 'exceptions' ? '异常记录' : '领取与抽奖记录';
        count.textContent = String(logs.length);
        if (logs.length === 0) {
            container.innerHTML = '<div class="qmx-stats-empty"><i></i></div>';
            return;
        }
        container.innerHTML = logs.slice(0, 12).map((event) => {
            const isLottery = event.phase === 'lottery';
            const meta = isLottery
                ? (LOTTERY_RESULT_META[event.result] || LOTTERY_RESULT_META.unknown)
                : (RESULT_META[event.result] || RESULT_META.unknown);
            const roomLabel = isLottery
                ? `抽奖机${event.roomId ? ` · ${event.roomId}` : ''}`
                : event.roomName
                    ? `${event.roomName}${event.roomId ? ` · ${event.roomId}` : ''}`
                    : event.roomId ? `房间 ${event.roomId}` : '未知直播间';
            const context = event.result === 'success'
                ? (isLottery ? getLotteryText(event) : getRewardText(event))
                : event.reason || meta.label;
            return `
                <div class="qmx-timeline-row" data-tone="${meta.tone}">
                    <i></i>
                    <time datetime="${new Date(event.timestamp).toISOString()}">${formatTime(event.timestamp)}</time>
                    <span>
                        <b title="${escapeHtml(roomLabel)}">${escapeHtml(roomLabel)}</b>
                        <small title="${escapeHtml(context)}">${escapeHtml(context)}</small>
                    </span>
                    <em>${escapeHtml(meta.label)}</em>
                </div>
            `;
        }).join('');
    },

    removeExpiredData() {
        const history = getRewardHistory();
        const cutoff = Date.now() - 30 * 86_400_000;
        const retained = Object.fromEntries(Object.entries(history).filter(([date]) => {
            const timestamp = new Date(`${date}T00:00:00+08:00`).getTime();
            return Number.isFinite(timestamp) && timestamp >= cutoff;
        }));
        GM_setValue(runtimeSettings.STATS_INFO_STORAGE_KEY, retained);
    },
};
