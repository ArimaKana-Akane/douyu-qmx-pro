import test from 'node:test';
import assert from 'node:assert/strict';

import { DouyuLayoutAdapter, DOUYU_SELECTORS } from './DouyuLayoutAdapter.js';

test('layout adapter detects the stable live theater slots', () => {
    const input = { id: 'input' };
    const sendButton = { id: 'send' };
    const composer = {
        querySelector(selector) {
            if (selector === DOUYU_SELECTORS.chatInput) return input;
            if (selector === DOUYU_SELECTORS.chatSendButton) return sendButton;
            return null;
        },
    };
    const nodes = new Map([
        [DOUYU_SELECTORS.playerMain, { id: 'player' }],
        [DOUYU_SELECTORS.giftSlot, { id: 'gift' }],
        [DOUYU_SELECTORS.asideTop, { id: 'aside' }],
        [DOUYU_SELECTORS.chatComposer, composer],
    ]);
    globalThis.document = {
        body: { classList: { contains: (name) => name === 'is-fullScreenPage' } },
        querySelector: (selector) => nodes.get(selector) || null,
    };

    const snapshot = DouyuLayoutAdapter.getSnapshot();
    assert.equal(snapshot.theater, true);
    assert.equal(snapshot.liveLayout, true);
    assert.equal(snapshot.giftSlot.id, 'gift');
    assert.equal(snapshot.asideSlot.id, 'aside');
    assert.deepEqual(snapshot.composer, { container: composer, input, sendButton });
});

// ── 全屏检测（2026-09-18）────────────────────────────────────────────

test('isWebFullscreen 认斗鱼网页全屏类名', () => {
    globalThis.document = { body: { classList: { contains: (name) => name === 'is-fullScreenPage' } } };
    globalThis.window = {};
    assert.equal(DouyuLayoutAdapter.isWebFullscreen(), true);
    assert.equal(DouyuLayoutAdapter.isFullscreen(), true);
});

test('网页全屏类名缺失时，退到浏览器全屏判据', () => {
    // 斗鱼改版后类名可能消失，此时若处于 F11 全屏，仍应判定为全屏
    globalThis.document = { body: { classList: { contains: () => false } }, fullscreenElement: { id: 'player' } };
    globalThis.window = {};
    assert.equal(DouyuLayoutAdapter.isWebFullscreen(), false);
    assert.equal(DouyuLayoutAdapter.isBrowserFullscreen(), true);
    assert.equal(DouyuLayoutAdapter.isFullscreen(), true, '任一形态命中即为全屏');
});

test('两种全屏都不成立时返回 false', () => {
    globalThis.document = {
        body: { classList: { contains: () => false } },
        fullscreenElement: null,
        webkitFullscreenElement: null,
    };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    assert.equal(DouyuLayoutAdapter.isFullscreen(), false);
});

test('getSnapshot 不携带 fullscreen（回归锁：防高频 matchMedia）', () => {
    // getSnapshot 挂在 MutationObserver / ResizeObserver 上，直播间 DOM 每秒变动
    // 多次都会触发它。若把全屏检测塞回快照，就会在每次 DOM 变动时新建
    // MediaQueryList —— 属于性能回退。全屏状态改由 ControlPage 的 1 秒轮询
    // 直接调用 isFullscreen() 获取。
    globalThis.document = {
        body: { classList: { contains: (name) => name === 'is-fullScreenPage' } },
        querySelector: () => null,
        fullscreenElement: null,
    };
    globalThis.window = {};
    const snapshot = DouyuLayoutAdapter.getSnapshot();
    assert.equal('fullscreen' in snapshot, false, '快照里不应有 fullscreen 字段');
    assert.equal(DouyuLayoutAdapter.isFullscreen(), true, '但仍可通过方法查询全屏');
});
