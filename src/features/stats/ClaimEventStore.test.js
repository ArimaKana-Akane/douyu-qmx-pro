import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '$') {
            return {
                url: new URL('../../test/GmApiMock.js', import.meta.url).href,
                shortCircuit: true,
            };
        }
        return nextResolve(specifier, context);
    },
});

const storage = new Map();
globalThis.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
globalThis.GM_setValue = (key, value) => storage.set(key, value);
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
    }
};

const { ClaimEventStore } = await import('./ClaimEventStore.js');

test('claim event store keeps recent events and summarizes attempts', () => {
    storage.clear();
    const now = Date.now();
    ClaimEventStore.record({ timestamp: now - 1000, roomId: '100', phase: 'claim', result: 'success', source: 'snatch' });
    ClaimEventStore.record({ timestamp: now - 500, roomId: '100', phase: 'claim', result: 'unknown', source: 'snatch' });
    ClaimEventStore.record({ timestamp: now - 40 * 86_400_000, roomId: 'old', phase: 'claim', result: 'success' });

    const summary = ClaimEventStore.summarize({ days: 7 });
    assert.equal(summary.attempts, 2);
    assert.equal(summary.success, 1);
    assert.equal(summary.successRate, 50);
    assert.deepEqual(summary.byResult, { success: 1, unknown: 1 });
    assert.deepEqual(summary.successBySource, { snatch: 1 });
});

test('counts multiple API responses for one bag as one attempt', () => {
    storage.clear();
    const now = Date.now();
    ClaimEventStore.record({
        timestamp: now - 1000,
        roomId: '100',
        bagId: 88,
        phase: 'claim',
        result: 'unknown',
        source: 'snatch',
    });
    ClaimEventStore.record({
        timestamp: now - 500,
        roomId: '100',
        bagId: 88,
        phase: 'claim',
        result: 'success',
        source: 'snatch',
    });

    const summary = ClaimEventStore.summarize({ days: 7 });
    assert.equal(summary.attempts, 1);
    assert.equal(summary.success, 1);
    assert.equal(summary.successRate, 100);
    assert.deepEqual(summary.successBySource, { snatch: 1 });
});

// ── 抽奖记录（2026-09-16 用户要求「每次抽奖的结果也写入数据统计」） ──────

test('抽奖事件被独立汇总，且不污染红包领取成功率', () => {
    storage.clear();
    const now = Date.now();
    // 一次失败的抽奖 + 一次成功的抽奖
    ClaimEventStore.record({
        timestamp: now - 1500, phase: 'lottery', result: 'unknown',
        source: 'lottery', roomId: '6657', reason: 'network down',
    });
    ClaimEventStore.record({
        timestamp: now - 1000, phase: 'lottery', result: 'success', source: 'lottery',
        roomId: '6657', cost: 100, drawCount: 10,
        rewards: { coins: 5, starlight: 770 },
    });
    // 一次成功的红包领取
    ClaimEventStore.record({
        timestamp: now - 500, roomId: '100', bagId: 9, phase: 'claim',
        result: 'success', source: 'snatch',
    });

    const summary = ClaimEventStore.summarize({ days: 7 });

    // 领取口径必须完全不受抽奖影响
    assert.equal(summary.attempts, 1, '抽奖不应算进领取尝试次数');
    assert.equal(summary.success, 1);
    assert.equal(summary.successRate, 100, '抽奖失败不能拉低领取成功率');
    assert.deepEqual(summary.successBySource, { snatch: 1 });

    // 抽奖口径独立统计
    assert.equal(summary.lottery.count, 2, '抽了 2 次');
    assert.equal(summary.lottery.success, 1);
    assert.equal(summary.lottery.failed, 1);
    assert.equal(summary.lottery.coins, 5);
    assert.equal(summary.lottery.starlight, 770);
    assert.equal(summary.lottery.spent, 100);
});

test('抽奖次数按「次」计数，不按奖品条目数（十连记 1 次）', () => {
    storage.clear();
    const now = Date.now();
    // 一次十连返回 10 条奖品，但只应记为 1 次抽奖
    ClaimEventStore.record({
        timestamp: now, phase: 'lottery', result: 'success', source: 'lottery',
        roomId: '6657', cost: 100, drawCount: 10,
        rewards: { coins: 0, starlight: 770 },
    });

    const summary = ClaimEventStore.summarize({ days: 7 });
    assert.equal(summary.lottery.count, 1, '一次十连是一“次”抽奖');
    assert.equal(summary.lottery.draws, 10, '抽取次数为 10');
});

test('抽奖事件不出现在成功来源统计里（那是红包专用口径）', () => {
    storage.clear();
    ClaimEventStore.record({
        timestamp: Date.now(), phase: 'lottery', result: 'success',
        source: 'lottery', roomId: '6657',
    });

    const summary = ClaimEventStore.summarize({ days: 7 });
    assert.equal(summary.successBySource.lottery, undefined, '抽奖不应进入红包成功来源');
    assert.equal(summary.attempts, 0, '没有红包领取时 attempts 应为 0');
});

test('无抽奖记录时 lottery 汇总为零值（UI 据此隐藏抽奖卡片）', () => {
    storage.clear();
    ClaimEventStore.record({
        timestamp: Date.now(), roomId: '100', phase: 'claim', result: 'success', source: 'snatch',
    });

    const summary = ClaimEventStore.summarize({ days: 7 });
    assert.equal(summary.lottery.count, 0);
    assert.equal(summary.lottery.spent, 0);
    assert.deepEqual(summary.lottery.events, []);
});
