/**
 * @file GmApiMock.js
 * @description 单元测试用的油猴 API mock。
 *
 * 为什么需要这个文件：`package.json` 的 test 脚本用 `node --test` 直接跑源码，
 * 而源码里有 `import { GM_getValue, ... } from '$'`（vite-plugin-monkey 的虚拟模块）。
 * Node 解析不到 `$`，各测试文件都用 `registerHooks` 把它重定向到本文件。
 *
 * 关键设计：**转发到 globalThis**，而不是自己维护一份存储。
 * 各测试文件都在 `await import('./被测模块.js')` 之前设置
 * `globalThis.GM_getValue = (key, fallback) => storage.has(key) ? ... : fallback`，
 * 用来注入各自的假存储（含初始数据、断言写入）。
 * 如果本模块自己持有一份 store，测试注入就会被绕过，
 * 于是出现「预期 '777'、实际拿到默认值 '6657'」这类失败。
 *
 * 因此：每次调用都**延迟解析** globalThis 上的实现；仅当测试未注入时才退回内部 store，
 * 保证「被 import 时不报错、默认行为无害」。
 */
const fallbackStore = new Map();

/** 取出当前生效的实现：优先用测试注入到 globalThis 的那个。 */
const resolve = (name) => {
    const injected = globalThis[name];
    // 注意：不要把本模块导出的函数误当成「已注入」，否则会自递归。
    if (typeof injected === 'function' && injected !== exports_[name]) return injected;
    return null;
};

// 保存自身实现，供 resolve() 做身份比较，避免自递归。
const exports_ = {};

const define = (name, impl) => {
    exports_[name] = impl;
    return impl;
};

export const GM_getValue = define('GM_getValue', (key, fallbackValue) => {
    const injected = resolve('GM_getValue');
    if (injected) return injected(key, fallbackValue);
    return fallbackStore.has(key) ? fallbackStore.get(key) : fallbackValue;
});

export const GM_setValue = define('GM_setValue', (key, value) => {
    const injected = resolve('GM_setValue');
    if (injected) return injected(key, value);
    fallbackStore.set(key, value);
});

export const GM_deleteValue = define('GM_deleteValue', (key) => {
    const injected = resolve('GM_deleteValue');
    if (injected) return injected(key);
    fallbackStore.delete(key);
});

export const GM_listValues = define('GM_listValues', () => {
    const injected = resolve('GM_listValues');
    if (injected) return injected();
    return Array.from(fallbackStore.keys());
});

export const GM_log = define('GM_log', (message) => {
    const injected = resolve('GM_log');
    if (injected) return injected(message);
});

/** 返回一个可关闭的句柄，与真实 GM_openInTab 的用法保持一致。 */
export const GM_openInTab = define('GM_openInTab', (url, options) => {
    const injected = resolve('GM_openInTab');
    if (injected) return injected(url, options);
    return { close: () => {} };
});

export const GM_addStyle = define('GM_addStyle', () => ({ remove: () => {} }));

export const GM_addValueChangeListener = define('GM_addValueChangeListener', () => ({ disconnect: () => {} }));

export const GM_removeValueChangeListener = define('GM_removeValueChangeListener', () => {});

export const GM_setClipboard = define('GM_setClipboard', () => {});

/**
 * 用 fetch 近似实现，保留 onload / onerror / ontimeout 回调形状。
 * 测试若注入 globalThis.GM_xmlhttpRequest 则优先用注入版。
 */
export const GM_xmlhttpRequest = define('GM_xmlhttpRequest', (options = {}) => {
    const injected = resolve('GM_xmlhttpRequest');
    if (injected) return injected(options);
    const handle = { abort: () => {} };
    if (typeof fetch !== 'function' || !options.url) return handle;
    fetch(options.url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.data,
        credentials: 'include',
    })
        .then(async (response) => {
            const text = await response.text();
            options.onload?.({
                status: response.status,
                responseText: text,
                response: options.responseType === 'json' ? JSON.parse(text) : text,
                readyState: 4,
            });
        })
        .catch((error) => {
            options.onerror?.({ error: String(error), status: 0 });
        });
    return handle;
});

/**
 * 测试环境下的 unsafeWindow。
 *
 * 必须转发到 `globalThis.window`（测试用它注入假 document / cookie / location），
 * 而不能直接返回 `globalThis`：被测代码的 `getPageWindow()` 形如
 *   `if (unsafeWindow?.fetch) return unsafeWindow; return window;`
 * 若 unsafeWindow 指向 Node 的 globalThis，它在部分环境下有 fetch，
 * 就会绕过测试注入的 `window.document`，导致 CSRF 测试失败。
 * 这里用 getter 延迟解析，保证测试在 import 之后替换 window 也能生效。
 */
export const unsafeWindow = new Proxy({}, {
    get(_target, prop) {
        const w = globalThis.window || globalThis;
        const value = w[prop];
        return typeof value === 'function' ? value.bind(w) : value;
    },
    has(_target, prop) {
        return prop in (globalThis.window || globalThis);
    },
});
