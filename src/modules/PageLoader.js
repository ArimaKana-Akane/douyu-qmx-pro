/**
 * @file PageLoader.js
 * @description 管理领取任务所需的短时后台开页。
 *
 * ⚠️ 关键实测结论（2026-09-15，控制室 6657 发起，隔离 profile + 真实登录态）：
 * 目标房间的后台页**只是打开还不够** —— 它必须存活到「用户级活动上下文」建立完成，
 * 关闭后控制页才能 snatch 成功。否则 snatch 恒返回 12006「稍等会儿才能抢哟」。
 *
 * 实测数据（同一账号 / 同一控制页 / 同样 waitSec=90 的红包，唯一变量是关页时机）：
 *
 * | 后台页存活时长 | 关闭后 snatch |
 * |---|---|
 * | 3 秒（原默认） | ❌ 12006 |
 * | 8 秒 | ❌ 12006 |
 * | **12 秒** | ✅ error=0 成功 |
 * | 一直保持打开 | ✅ error=0 成功 |
 *
 * 与上游研究记录吻合：红包组件前端初始化含约 3 秒固定延迟，部分路径再加 0~3 秒随机延迟，
 * 红包入口实测在加载后 5.3~8.1 秒才出现（见 docs/DOUYU_STARDISCOVER_RESEARCH_2026-08-29.md）。
 * 原来的 3 秒默认值**低于组件就绪时间**，属于必然失败。
 */

import { Utils } from '../utils/utils';
import { GM_openInTab } from '$';

/**
 * 后台页最短存活时长（12 秒）。
 * 这不是「用户偏好」而是功能正确性边界 —— 低于此值关页后必然领不到。
 * 导出给 RedBagTaskController 做运行时兜底（旧存档可能绕过设置层的夹取）。
 */
export const MIN_PREWARM_MS = 12_000;

const closeTabHandle = (tab) => {
    try {
        tab?.close?.();
    } catch (error) {
        Utils.log(`[PageLoader] 关闭短时工作页失败: ${String(error?.message || error)}`);
    }
};

export const PageLoader = {
    /**
     * 后台打开一个短时工作页。调用方负责在初始化窗口结束后关闭。
     *
     * 注意：调用方必须**至少**等待 `MIN_PREWARM_MS` 再 close()。
     * 建议直接使用 `RedBagTaskController` 里的统一等待逻辑（含运行时下限保护）。
     *
     * @param {string} url
     * @returns {{url: string, roomId: string|null, openedAt: number, close: () => void}}
     */
    openPrewarmTab(url) {
        if (!url || typeof url !== 'string') {
            throw new Error('短时工作页 URL 无效');
        }

        const targetUrl = new URL(url, 'https://www.douyu.com');
        targetUrl.searchParams.set('qmxPrewarm', '1');
        const tab = GM_openInTab(targetUrl.href, { active: false, setParent: true });
        const openedAt = Date.now();
        const roomId = url.match(/\/(\d+)/)?.[1] || null;
        let closed = false;

        Utils.log(`[PageLoader] 已后台打开短时工作页: ${url}（需存活 ≥ ${MIN_PREWARM_MS / 1000}s）`);
        return {
            url: targetUrl.href,
            roomId,
            openedAt,
            close() {
                if (closed) return;
                closed = true;
                closeTabHandle(tab);
                Utils.log(`[PageLoader] 已关闭短时工作页: ${url}`);
            },
        };
    },
};
