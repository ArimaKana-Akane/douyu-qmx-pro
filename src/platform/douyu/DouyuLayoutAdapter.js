/**
 * 新版斗鱼页面布局适配层。
 *
 * 业务模块只通过这里访问斗鱼 DOM，避免散落哈希类名和重复的重挂载逻辑。
 */
export const DOUYU_SELECTORS = Object.freeze({
    playerMain: '#js-player-main',
    playerVideo: '#js-player-video-case',
    playerToolbar: '#js-player-toolbar',
    giftSlot: '#js-giftList-area',
    aside: '#js-player-asideMain',
    asideTop: '.layout-Player-asideMainTop',
    rank: '.layout-Player-rank',
    chat: '.layout-Player-chat',
    chatComposer: '.ChatSend',
    chatInput: '.ChatSend-txt[contenteditable="true"], textarea.ChatSend-txt, input.ChatSend-txt, .ChatSend-txt',
    chatSendButton: '.ChatSend-button',
});

const query = (selector, root = document) => root?.querySelector?.(selector) || null;

export const DouyuLayoutAdapter = {
    observer: null,
    resizeObserver: null,
    callbacks: new Set(),
    scheduled: false,

    getPlayerMain() {
        return query(DOUYU_SELECTORS.playerMain);
    },

    getAsideSlot() {
        return query(DOUYU_SELECTORS.asideTop);
    },

    getGiftSlot() {
        return query(DOUYU_SELECTORS.giftSlot);
    },

    getChatComposer() {
        const container = query(DOUYU_SELECTORS.chatComposer) || query(DOUYU_SELECTORS.chat);
        if (!container) return null;

        const input = query(DOUYU_SELECTORS.chatInput, container);
        const sendButton = query(DOUYU_SELECTORS.chatSendButton, container);
        return input ? { container, input, sendButton } : null;
    },

    isTheaterMode() {
        return Boolean(
            document.body?.classList.contains('is-fullScreenPage') &&
            this.getPlayerMain() &&
            this.getGiftSlot()
        );
    },

    isLiveLayout() {
        return Boolean(this.getPlayerMain() && this.getChatComposer());
    },

    /**
     * 是否处于「网页全屏」或浏览器全屏。
     *
     * 为什么要多重判据，而不是只查一个类名：
     * 斗鱼的全屏类名在改版时变过 —— `InputDetector` 的注释明确记着
     * 「新版网页全屏仍使用右侧 ChatSend 输入区，因此不再依赖带构建哈希的
     * 全屏类名」。只认 `is-fullScreenPage` 一旦失效就会静默返回 false，
     * 表现为「全屏后插件该隐藏却没隐藏」，且不会有任何报错。
     *
     * 已排除的判据：不能用 `document.fullscreenElement` 代替本方法 ——
     * 斗鱼的「网页全屏」是它自己改布局（不调用 Fullscreen API），
     * 而 F11 全屏属于浏览器行为；两者事件不同，故分开判断。
     */
    isWebFullscreen() {
        return Boolean(document.body?.classList?.contains?.('is-fullScreenPage'));
    },

    /**
     * 浏览器全屏（F11 / Fullscreen API）。与斗鱼「网页全屏」是两回事。
     *
     * `matchMedia` 的结果缓存在实例上：MediaQueryList 每次调用都会新建对象，
     * 而本方法会被 1 秒轮询反复调用。DOM 的类名变化无法被 matchMedia 感知，
     * 但 display-mode 只在浏览器自身全屏状态变化时改变 —— 而那同时必然
     * 触发 `fullscreenchange`，所以缓存不会导致状态过期。
     */
    isBrowserFullscreen() {
        if (document.fullscreenElement || document.webkitFullscreenElement) return true;
        if (this._displayModeQuery === undefined) {
            this._displayModeQuery = typeof window.matchMedia === 'function'
                ? window.matchMedia('(display-mode: fullscreen)')
                : null;
        }
        return Boolean(this._displayModeQuery?.matches);
    },

    /** 任一全屏形态。用于决定插件 UI 是否让位。 */
    isFullscreen() {
        return this.isWebFullscreen() || this.isBrowserFullscreen();
    },

    getSnapshot() {
        const composer = this.getChatComposer();
        return {
            theater: this.isTheaterMode(),
            liveLayout: this.isLiveLayout(),
            playerMain: this.getPlayerMain(),
            asideSlot: this.getAsideSlot(),
            giftSlot: this.getGiftSlot(),
            composer,
        };
    },

    scheduleNotify() {
        if (this.scheduled) return;
        this.scheduled = true;
        requestAnimationFrame(() => {
            this.scheduled = false;
            const snapshot = this.getSnapshot();
            this.callbacks.forEach((callback) => callback(snapshot));
            this.refreshResizeTargets(snapshot);
        });
    },

    refreshResizeTargets(snapshot = this.getSnapshot()) {
        if (typeof ResizeObserver === 'undefined') return;
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => this.scheduleNotify());
        }
        this.resizeObserver.disconnect();
        [snapshot.playerMain, snapshot.asideSlot, snapshot.giftSlot]
            .filter(Boolean)
            .forEach((element) => this.resizeObserver.observe(element));
    },

    ensureObserver() {
        if (this.observer || typeof MutationObserver === 'undefined') return;
        this.observer = new MutationObserver(() => this.scheduleNotify());
        this.observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        this.refreshResizeTargets();
    },

    observe(callback, { immediate = true } = {}) {
        if (typeof callback !== 'function') return () => {};
        this.callbacks.add(callback);
        this.ensureObserver();
        if (immediate) callback(this.getSnapshot());

        return () => {
            this.callbacks.delete(callback);
            if (this.callbacks.size === 0) {
                this.observer?.disconnect();
                this.resizeObserver?.disconnect();
                this.observer = null;
                this.resizeObserver = null;
            }
        };
    },
};
