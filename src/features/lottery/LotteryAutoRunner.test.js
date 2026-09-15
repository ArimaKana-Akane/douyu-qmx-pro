import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '$') {
            return {
                url: new URL('../../test/GmApiMock.js', import.meta.url).href,
                shortCircuit: true,
            };
        }
        if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
            return nextResolve(`${specifier}.js`, context);
        }
        return nextResolve(specifier, context);
    },
});

// ── 假 GM 存储（GmApiMock 会转发到这里） ────────────────────────────────
const storage = new Map();
globalThis.GM_getValue = (key, fallback) => (storage.has(key) ? storage.get(key) : fallback);
globalThis.GM_setValue = (key, value) => storage.set(key, value);
globalThis.GM_log = () => {};
globalThis.window = { dispatchEvent() {}, location: { href: 'https://www.douyu.com/6657' } };

const { LotteryAutoRunner, TEN_DRAW_COST } = await import('./LotteryAutoRunner.js');
const { DouyuAPI, LOTTERY_ERROR } = await import('../../utils/DouyuAPI.js');

/** 用可控的假实现替换 DouyuAPI 的两个方法 */
const withApi = async (impl, fn) => {
    const originInfo = DouyuAPI.getLotteryInfo;
    const originDraw = DouyuAPI.drawLottery;
    DouyuAPI.getLotteryInfo = impl.getLotteryInfo;
    DouyuAPI.drawLottery = impl.drawLottery;
    try {
        return await fn();
    } finally {
        DouyuAPI.getLotteryInfo = originInfo;
        DouyuAPI.drawLottery = originDraw;
    }
};

test('金币不足时不调用抽奖接口（避免无意义的失败请求）', async () => {
    let drawCalled = 0;
    const result = await withApi({
        getLotteryInfo: async () => ({ myCoin: 99, remainLotteryNum: 100 }),
        drawLottery: async () => { drawCalled += 1; return { prizeList: [] }; },
    }, () => LotteryAutoRunner.tick());

    assert.equal(result.action, 'skipped');
    assert.match(result.reason, /99\/100/);
    assert.equal(drawCalled, 0, '金币不足时不应发起抽奖请求');
});

test('金币达到 100 时按十连自动抽奖', async () => {
    let requested = null;
    const result = await withApi({
        getLotteryInfo: async () => ({ myCoin: 100, remainLotteryNum: 160 }),
        drawLottery: async (params) => {
            requested = params;
            return {
                prizeList: [{ prizeDesc: '星光棒', prizeNum: 20 }, { prizeDesc: '金币', prizeNum: 5 }],
            };
        },
    }, () => LotteryAutoRunner.tick());

    assert.equal(result.action, 'drawn');
    assert.equal(requested.num, 10, '必须是十连（num=10）');
    assert.match(result.prizeText, /星光棒×20/);
    assert.match(result.prizeText, /金币×5/);
});

test('金币充足但服务端返回 12022 时按「跳过」处理，不记为错误', async () => {
    const result = await withApi({
        getLotteryInfo: async () => ({ myCoin: 150, remainLotteryNum: 160 }),
        drawLottery: async () => {
            const err = new Error('金币不足');
            err.businessError = LOTTERY_ERROR.COIN_NOT_ENOUGH;
            throw err;
        },
    }, () => LotteryAutoRunner.tick());

    assert.equal(result.action, 'skipped', '12022 是可预期的状态，不应报警');
    assert.equal(LotteryAutoRunner.getState().lastError, '', '不应写入 lastError');
});

test('读取抽奖信息失败时记为错误但不抛出（不中断任务）', async () => {
    const result = await withApi({
        getLotteryInfo: async () => { throw new Error('network down'); },
        drawLottery: async () => ({ prizeList: [] }),
    }, () => LotteryAutoRunner.tick());

    assert.equal(result.action, 'error');
    assert.equal(result.reason, 'info-failed');
    assert.match(LotteryAutoRunner.getState().lastError, /network down/);
});

test('自动抽奖默认关闭；开关可持久化', () => {
    storage.clear();
    assert.equal(LotteryAutoRunner.isEnabled(), false, '默认必须是关闭的');

    LotteryAutoRunner.setEnabled(true);
    assert.equal(LotteryAutoRunner.isEnabled(), true);
    LotteryAutoRunner.stop(); // 不要在测试里留下真实定时器

    LotteryAutoRunner.setEnabled(false);
    assert.equal(LotteryAutoRunner.isEnabled(), false);
});

test('十连成本常量与用户要求一致（100 金币）', () => {
    assert.equal(TEN_DRAW_COST, 100);
});

// ── 可配置阈值（2026-09-16 用户要求「阈值可配置」） ──────────────────────

test('阈值可调高：金币未达到自定义阈值时不抽奖', async () => {
    const { SETTINGS } = await import('../../modules/SettingsManager.js');
    const original = SETTINGS.LOTTERY_DRAW_THRESHOLD;
    SETTINGS.LOTTERY_DRAW_THRESHOLD = 500;
    try {
        let drawCalled = 0;
        const result = await withApi({
            getLotteryInfo: async () => ({ myCoin: 300, remainLotteryNum: 160 }),
            drawLottery: async () => { drawCalled += 1; return { prizeList: [] }; },
        }, () => LotteryAutoRunner.tick());

        assert.equal(result.action, 'skipped', '300 < 500 应跳过');
        assert.match(result.reason, /300\/500/, '提示里应出现自定义阈值');
        assert.equal(drawCalled, 0);
    } finally {
        SETTINGS.LOTTERY_DRAW_THRESHOLD = original;
    }
});

test('阈值可调高：金币达到自定义阈值时抽奖', async () => {
    const { SETTINGS } = await import('../../modules/SettingsManager.js');
    const original = SETTINGS.LOTTERY_DRAW_THRESHOLD;
    SETTINGS.LOTTERY_DRAW_THRESHOLD = 500;
    try {
        let requested = null;
        const result = await withApi({
            getLotteryInfo: async () => ({ myCoin: 520, remainLotteryNum: 160 }),
            drawLottery: async (params) => { requested = params; return { prizeList: [] }; },
        }, () => LotteryAutoRunner.tick());

        assert.equal(result.action, 'drawn', '520 ≥ 500 应抽奖');
        assert.equal(requested.num, 10, '抽的仍是十连');
    } finally {
        SETTINGS.LOTTERY_DRAW_THRESHOLD = original;
    }
});

test('阈值低于十连成本时被抬到 100（否则「够阈值却抽不动」）', async () => {
    const { SETTINGS } = await import('../../modules/SettingsManager.js');
    const original = SETTINGS.LOTTERY_DRAW_THRESHOLD;
    SETTINGS.LOTTERY_DRAW_THRESHOLD = 10;   // 模拟手改配置写坏
    try {
        let drawCalled = 0;
        const result = await withApi({
            getLotteryInfo: async () => ({ myCoin: 50, remainLotteryNum: 160 }),
            drawLottery: async () => { drawCalled += 1; return { prizeList: [] }; },
        }, () => LotteryAutoRunner.tick());

        // 50 金币若按 10 的坏阈值会去抽十连 → 服务端 12022 恒失败。
        // 抬到 100 后应当是「跳过」，不产生无意义请求。
        assert.equal(result.action, 'skipped');
        assert.match(result.reason, /50\/100/, '阈值应被抬到 100');
        assert.equal(drawCalled, 0, '不应发出必然失败的十连请求');
    } finally {
        SETTINGS.LOTTERY_DRAW_THRESHOLD = original;
    }
});

test('阈值写入抽奖状态，供 UI 排查「为什么没抽」', async () => {
    const { SETTINGS } = await import('../../modules/SettingsManager.js');
    const original = SETTINGS.LOTTERY_DRAW_THRESHOLD;
    SETTINGS.LOTTERY_DRAW_THRESHOLD = 200;
    try {
        await withApi({
            getLotteryInfo: async () => ({ myCoin: 120, remainLotteryNum: 160 }),
            drawLottery: async () => ({ prizeList: [] }),
        }, () => LotteryAutoRunner.tick());

        const state = LotteryAutoRunner.getState();
        assert.equal(state.myCoin, 120);
        assert.equal(state.threshold, 200, '状态里应记录本次判定用的阈值');
    } finally {
        SETTINGS.LOTTERY_DRAW_THRESHOLD = original;
    }
});

test('start() 立即检查一次，不等第一个轮询周期', async () => {
    storage.clear();
    storage.set('douyu_qmx_lottery_auto_enabled', true);

    let infoCalls = 0;
    const originalGetInfo = DouyuAPI.getLotteryInfo;
    const originalDraw = DouyuAPI.drawLottery;
    DouyuAPI.getLotteryInfo = async () => { infoCalls += 1; return { myCoin: 0, remainLotteryNum: 0 }; };
    DouyuAPI.drawLottery = async () => ({ prizeList: [] });
    try {
        LotteryAutoRunner.setEnabled(true);      // 内部会调用 start()
        // 立即执行是同步发起的，给一轮 microtask + 宏任务让 tick 完成
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.ok(infoCalls >= 1, `开启后应立即检查一次（实际 ${infoCalls} 次）`);
    } finally {
        LotteryAutoRunner.stop();
        LotteryAutoRunner.setEnabled(false);
        DouyuAPI.getLotteryInfo = originalGetInfo;
        DouyuAPI.drawLottery = originalDraw;
    }
});
