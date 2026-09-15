import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === '$') {
            return {
                url: new URL('../test/GmApiMock.js', import.meta.url).href,
                shortCircuit: true,
            };
        }
        if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
            return nextResolve(`${specifier}.js`, context);
        }
        return nextResolve(specifier, context);
    },
});

const storage = new Map();
globalThis.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
globalThis.GM_setValue = (key, value) => storage.set(key, value);
globalThis.GM_log = () => {};
globalThis.GM_xmlhttpRequest = () => {};
globalThis.window = {
    document: { scripts: [], cookie: '' },
    location: { origin: 'https://www.douyu.com' },
    fetch() {},
};

const { DouyuAPI } = await import('./DouyuAPI.js');

test('resolves one editable control room number to its hidden real RID', async () => {
    const originalPageFetchText = DouyuAPI.pageFetchText;
    DouyuAPI.pageFetchText = async () => ({
        url: 'https://www.douyu.com/6979222',
        status: 200,
        text: `
            <link href="https://www.douyu.com/6657" rel="canonical">
            <script>window.room_id = 6979222;</script>
        `,
    });

    try {
        assert.deepEqual(await DouyuAPI.resolveRoomIdentity('6979222'), {
            controlRoomId: '6657',
            realRoomId: '6979222',
        });
    } finally {
        DouyuAPI.pageFetchText = originalPageFetchText;
    }
});

test('新版页面无 window.room_id 时仍能解析真实 RID（从 asrpic 路径兜底）', async () => {
    const original = DouyuAPI.pageFetchText;
    // 现网 6657 实测样本：无 window.room_id，真实 RID 只出现在 asrpic 资源路径里
    DouyuAPI.pageFetchText = async () => ({
        url: 'https://www.douyu.com/6657',
        status: 200,
        text: `
            <link href="https://rpic.douyucdn.cn/asrpic/260915/6979222_src_1946.avif/dy4" as="image">
            <link href="https://www.douyu.com/6657" rel="canonical">
        `,
    });
    try {
        assert.deepEqual(await DouyuAPI.resolveRoomIdentity('6657'), {
            controlRoomId: '6657',
            realRoomId: '6979222',
        });
    } finally {
        DouyuAPI.pageFetchText = original;
    }
});

test('旧版页面 window.room_id 仍优先解析', async () => {
    const original = DouyuAPI.pageFetchText;
    DouyuAPI.pageFetchText = async () => ({
        url: 'https://www.douyu.com/6657',
        status: 200,
        text: `
            <script>window.room_id = 6979222;</script>
            <link href="https://rpic.douyucdn.cn/asrpic/260915/9999999_src_1946.avif" as="image">
            <link href="https://www.douyu.com/6657" rel="canonical">
        `,
    });
    try {
        const result = await DouyuAPI.resolveRoomIdentity('6657');
        assert.equal(result.realRoomId, '6979222', 'window.room_id 应优先于 asrpic 兜底');
    } finally {
        DouyuAPI.pageFetchText = original;
    }
});

test('caches only dynamic csrf field mapping and never persists the token', async () => {
    storage.clear();
    globalThis.window.document = {
        scripts: [{
            textContent: 'self.__next_f.push([1,"var $SYS={\\"tn\\":\\"ctn\\",\\"tvk\\":\\"ccn\\",\\"cookie_pre\\":\\"acf_\\"}"])',
        }],
        cookie: '',
    };

    assert.equal(DouyuAPI.cachePageCsrfConfig(), true);
    assert.deepEqual(storage.get('douyu_qmx_csrf_config'), {
        fieldName: 'ctn',
        cookieName: 'acf_ccn',
    });

    globalThis.window.document = {
        scripts: [{ textContent: 'window.__ROOM_DATA__={rid:12869007}' }],
        cookie: 'acf_ccn=control-token',
    };
    const csrf = await DouyuAPI.getDynamicCsrf();
    assert.deepEqual({ fieldName: csrf.fieldName, token: csrf.token }, {
        fieldName: 'ctn',
        token: 'control-token',
    });
    // source 是新增的诊断字段，标识本次取值来自哪条路径（embedded/cache/cookie-derive）
    assert.ok(['embedded', 'cache', 'cookie-derive', 'cookie-derive-after-fetch'].includes(csrf.source));
    // 关键安全断言：token 值绝不能落盘
    assert.equal(JSON.stringify([...storage.values()]).includes('control-token'), false);
});

test('页面无 $SYS 时从 Cookie 反推 CSRF（新版页面的唯一可用路径）', async () => {
    storage.clear();
    // 现网实况：页面不输出 $SYS，但登录会话里有 acf_ccn（32 位 hex）
    const token = '10bc94a7bd1234567890abcdef123456';
    globalThis.window.document = {
        scripts: [{ textContent: 'window.__ROOM_DATA__={rid:6979222}' }],
        cookie: `dy_did=aaa; acf_ccn=${token}; guid=bbb`,
    };

    const csrf = await DouyuAPI.getDynamicCsrf();
    assert.equal(csrf.fieldName, 'ctn');
    assert.equal(csrf.token, token);
    assert.equal(csrf.source, 'cookie-derive', '应从 Cookie 反推得到');
    // 反推结果会写入缓存供后续复用，但同样不得含 token
    assert.equal(JSON.stringify([...storage.values()]).includes(token), false);
});

test('页面无 $SYS 且 Cookie 里没有已知 CSRF token 时明确报错', async () => {
    storage.clear();
    globalThis.window.document = {
        scripts: [{ textContent: 'window.__ROOM_DATA__={rid:6979222}' }],
        cookie: 'dy_did=aaa; guid=bbb',
    };
    await assert.rejects(() => DouyuAPI.getDynamicCsrf(), /CSRF 配置不可用/);
});

test('candidate rooms are ordered by active prize pool and failed probes remain as fallback', async () => {
    const originalGetRoomRedBags = DouyuAPI.getRoomRedBags;
    const roomData = {
        100: {
            redBagList: [{
                id: 10,
                code: 'small',
                status: 0,
                waitSec: 10,
                prizeList: [{ ptype: 9, num: 100 }],
            }],
        },
        200: {
            redBagList: [{
                id: 20,
                code: 'large',
                status: 0,
                waitSec: 300,
                prizeList: [{ ptype: 9, num: 6000 }, { ptype: 2, num: 1000 }],
            }],
        },
        300: {
            redBagList: [{ id: 30, code: 'ended', status: 3, waitSec: 0, prizeList: [] }],
        },
    };

    DouyuAPI.getRoomRedBags = async (rid) => {
        if (rid === '400') throw new Error('probe failed');
        return roomData[rid];
    };

    try {
        const rooms = await DouyuAPI.rankSquareCandidates([
            { rid: '100', rbId: 10, sourceIndex: 0 },
            { rid: '200', rbId: 20, sourceIndex: 1 },
            { rid: '300', rbId: 30, sourceIndex: 2 },
            { rid: '400', rbId: 40, sourceIndex: 3 },
        ]);

        assert.deepEqual(rooms, [
            'https://www.douyu.com/200',
            'https://www.douyu.com/100',
            'https://www.douyu.com/400',
        ]);
    } finally {
        DouyuAPI.getRoomRedBags = originalGetRoomRedBags;
    }
});

test('coin records use the logged-in page session and keep only received red bags', async () => {
    let request;
    globalThis.window.fetch = async (url, options) => {
        request = { url, options };
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                error: 0,
                data: {
                    list: [
                        { opDirection: 1, remark: '全民星推荐-红包', balanceDiff: 12, createTime: 1788026309 },
                        { opDirection: 2, remark: '全民星推荐-红包', balanceDiff: 10, createTime: 1788026200 },
                        { opDirection: 1, remark: '全民星推荐-用户任务', balanceDiff: 10, createTime: 1788026100 },
                    ],
                },
            }),
        };
    };

    const records = await DouyuAPI.getCoinRecord(1, 100, 0);
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('current'), '1');
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.equal(url.searchParams.has('rid'), false);
    assert.equal(request.options.credentials, 'include');
    assert.equal(request.options.method, 'GET');
    assert.deepEqual(records.map((item) => item.balanceDiff), [12]);
});

test('coin record authentication failures are reported without retrying', async () => {
    let requestCount = 0;
    globalThis.window.fetch = async () => {
        requestCount += 1;
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ error: -9, msg: '请登录', data: null }),
        };
    };

    await assert.rejects(
        DouyuAPI.getCoinRecord(1, 20, 3),
        (error) => error.kind === 'auth' && error.businessError === -9 && error.message === '请登录',
    );
    assert.equal(requestCount, 1);
});
