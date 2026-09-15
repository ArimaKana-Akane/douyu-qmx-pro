import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig(() => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    // ── 构建维度 ────────────────────────────────────────────────────────────
    // 修复（2026-09-15）：此前 buildFlavor 被硬编码为 'star-only'，
    // 导致 BUILD_FLAVOR 环境变量被完全忽略 —— release.yml 里的 full / star-only /
    // danmu-only 三种构建产出完全相同的内容，且因输出同名而互相覆盖。
    // 现在恢复为从环境变量读取，并按 flavor 决定启用哪部分功能。
    const buildFlavor = (process.env.BUILD_FLAVOR || 'full').trim(); // full | star-only | danmu-only
    const buildChannel = (process.env.BUILD_CHANNEL || 'beta').trim(); // beta | release
    const versionBase = (process.env.VERSION_SUFFIX || '2.1.0').trim();

    if (!['full', 'star-only', 'danmu-only'].includes(buildFlavor)) {
        throw new Error(`未知的 BUILD_FLAVOR: ${buildFlavor}（可选 full | star-only | danmu-only）`);
    }

    const channelSuffix = buildChannel === 'beta' ? '-beta' : '';
    const flavorSuffix = buildFlavor === 'full' ? '' : `-${buildFlavor}`;
    // beta 通道带 .1 后缀；release 通道使用纯版本号
    const metadataVersion = buildChannel === 'beta' ? `${versionBase}-beta.1` : versionBase;

    // 文件名包含 flavor，避免三种 flavor 互相覆盖（原实现固定为 星推荐v2-beta.user.js）
    const fileName = `星推荐v2${flavorSuffix}${channelSuffix}.user.js`;

    let scriptName;
    let description;
    if (buildFlavor === 'danmu-only') {
        scriptName = `斗鱼弹幕助手${channelSuffix}`;
        description = '斗鱼弹幕智能补全助手 - 弹幕模板自动补全、全键盘操作';
    } else if (buildFlavor === 'star-only') {
        scriptName = `斗鱼全民星推荐助手${channelSuffix}`;
        description = '斗鱼全民星推荐自动领取脚本 - 控制页服务端领取、收益统计与可视化任务面板';
    } else {
        scriptName = `斗鱼全民星推荐助手+弹幕助手${channelSuffix}`;
        description = '斗鱼全民星推荐自动领取 + 弹幕智能助手 - 集成红包领取与弹幕补全的完整版';
    }

    const enableDanmu = buildFlavor !== 'star-only';
    const enableStar = buildFlavor !== 'danmu-only';

    return {
        resolve: {
            alias: {
                // flexsearch 由 DanmukuDB 使用，仅弹幕侧需要。
                ...(enableDanmu ? {
                    flexsearch: path.resolve(__dirname, 'node_modules/flexsearch/dist/flexsearch.bundle.min.js'),
                } : {}),
                // star-only：把弹幕助手替换为空实现（可摇树移除）
                ...(buildFlavor === 'star-only' ? {
                    './modules/danmu/DanmuPro': path.resolve(__dirname, 'src/utils/empty.js'),
                    './danmu/DanmuPro': path.resolve(__dirname, 'src/utils/empty.js'),
                } : {}),
                // danmu-only：把星推荐侧替换为空实现
                ...(buildFlavor === 'danmu-only' ? {
                    './modules/ControlPage': path.resolve(__dirname, 'src/utils/empty.js'),
                    './modules/GlobalState': path.resolve(__dirname, 'src/utils/empty.js'),
                } : {}),
            },
        },
        build: {
            // 重要：release.yml 会连续构建三种 flavor，必须保留彼此产物，
            // 因此不能设为 true（否则后一次构建会清空前一次）。
            emptyOutDir: false,
        },
        plugins: [
            monkey({
                systemjs: false, // 显式禁用 SystemJS
                entry: 'src/main.js',
                userscript: {
                    name: scriptName,
                    namespace: 'http://tampermonkey.net/',
                    description: description,
                    version: metadataVersion,
                    author: 'ienone&Truthss',
                    match: [
                        '*://www.douyu.com/*',
                    ],
                    connect: [
                        'www.douyu.com',
                    ],
                    'run-at': 'document-idle',
                    license: 'MIT',
                    noframes: true,
                    // 更新地址指向本 fork 的 Release 资产。
                    // 用 ASCII 资产名，避免中文文件名在 URL 中被编码后取不到。
                    updateURL: 'https://github.com/ArimaKana-Akane/douyu-qmx-pro/releases/latest/download/douyu-qmx-star.user.js',
                    downloadURL: 'https://github.com/ArimaKana-Akane/douyu-qmx-pro/releases/latest/download/douyu-qmx-star.user.js',
                    $extra: [['original-author', 'ysl-ovo (https://greasyfork.org/zh-CN/users/1453821-ysl-ovo)']],
                },
                build: {
                    fileName,
                    sourcemap: false,
                    autoGrant: true,
                },
            }),
        ],
        define: {
            __BUILD_FLAVOR__: JSON.stringify(buildFlavor),
            __BUILD_CHANNEL__: JSON.stringify(buildChannel),
            __ENABLE_DANMU_PRO__: JSON.stringify(enableDanmu),
            __ENABLE_STAR_CORE__: JSON.stringify(enableStar),
        },
    };
});
