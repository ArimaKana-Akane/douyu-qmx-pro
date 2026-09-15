/**
 * @file    SettingsManager.js
 * @description 负责加载、合并和保存用户配置。
 */

import { CONFIG } from '../utils/CONFIG';
import { GM_deleteValue, GM_getValue, GM_setValue } from '$';
import { MIN_PREWARM_MS } from './PageLoader';

export { MIN_PREWARM_MS };

const USER_SETTING_KEYS = Object.freeze([
    'CONTROL_ROOM_ID',
    'TEMP_CONTROL_ROOM_RID',
    'CONTROL_ROOM_RESOLVED_FROM',
    'ROOM_PREWARM_DURATION',
    'DAILY_LIMIT_ACTION',
    'MODAL_DISPLAY_MODE',
    'LOTTERY_AUTO_ENABLED',
]);

const pickUserSettings = (value) => Object.fromEntries(
    USER_SETTING_KEYS
        .filter((key) => Object.hasOwn(value || {}, key))
        .map((key) => [key, value[key]]),
);

/**
 * 后台页存活时长的**硬下限**（复用 PageLoader 的常量，避免两处定义漂移）。
 *
 * 2026-09-15 现网实测：低于 12 秒，目标房间的用户级活动上下文来不及建立，
 * 关页后控制页的 snatch 恒返回 12006；12 秒起才能稳定成功。
 * 因此这不是「用户偏好」而是功能正确性边界 —— 旧存档里的 3000 会被自动抬到 12000，
 * 否则升级后旧用户依然无法领取。
 */
/** 上限：给慢网/慢机器留余量（原 15s 偏紧） */
export const MAX_PREWARM_MS = 30_000;

const normalizeUserSettings = (value) => {
    const settings = pickUserSettings(value);
    if (Object.hasOwn(settings, 'ROOM_PREWARM_DURATION')) {
        const duration = Number(settings.ROOM_PREWARM_DURATION);
        settings.ROOM_PREWARM_DURATION = Math.round(
            Math.min(MAX_PREWARM_MS, Math.max(MIN_PREWARM_MS, Number.isFinite(duration) ? duration : MIN_PREWARM_MS))
        );
    }
    return settings;
};

const normalizeRuntimePatch = (value) => {
    const settings = { ...(value || {}) };
    if (Object.hasOwn(settings, 'ROOM_PREWARM_DURATION')) {
        settings.ROOM_PREWARM_DURATION = normalizeUserSettings(settings).ROOM_PREWARM_DURATION;
    }
    return settings;
};

/**
 * =================================================================================
 * 模块：设置管理器 (SettingsManager)
 * ---------------------------------------------------------------------------------
 * 负责加载、合并和保存用户配置。
 * =================================================================================
 */
const SettingsManager = {
    STORAGE_KEY: 'douyu_qmx_user_settings',

    /**
     * 获取最终的运行时配置。
     * 它会加载用户保存的设置，并用其覆盖默认的 CONFIG。
     * @returns {object} - 合并后的配置对象。
     */
    get() {
        const storedSettings = GM_getValue(this.STORAGE_KEY, {});
        const userSettings = normalizeUserSettings(storedSettings);
        const storedKeys = Object.keys(storedSettings || {}).sort().join(',');
        const userKeys = Object.keys(userSettings).sort().join(',');
        if (storedKeys !== userKeys) {
            GM_setValue(this.STORAGE_KEY, userSettings);
        }
        const themeSetting = GM_getValue('douyu_qmx_theme',
            CONFIG.DEFAULT_THEME);

        const runtimeSettings = Object.assign({}, CONFIG, userSettings, {THEME: themeSetting});
        // 旧版本没有记录映射来源，首次保存时必须重新解析一次，不能误用默认值跳过迁移。
        if (!Object.hasOwn(userSettings, 'CONTROL_ROOM_RESOLVED_FROM')) {
            runtimeSettings.CONTROL_ROOM_RESOLVED_FROM = '';
        }
        return runtimeSettings;
    },

    /**
     * 保存用户的自定义设置。
     * @param {object} settingsToSave - 只包含用户修改过的设置的对象。
     */
    save(settingsToSave) {
        const normalized = { ...(settingsToSave || {}) };
        // 在保存时，将主题设置单独存储，因为它需要实时应用
        if (Object.hasOwn(normalized, 'THEME')) {
            const theme = normalized.THEME;
            GM_setValue('douyu_qmx_theme', theme);
            delete normalized.THEME;
        }
        GM_setValue(this.STORAGE_KEY, normalizeUserSettings(normalized));
    },

    /**
     * 更新并保存设置，同时更新内存中的 SETTINGS 对象
     * @param {object} newSettings - 新的设置对象
     */
    update(newSettings) {
        const normalizedSettings = normalizeRuntimePatch(newSettings);
        // 1. 更新内存中的 SETTINGS
        Object.assign(SETTINGS, normalizedSettings);
        
        // 2. 保存到存储
        // 获取当前存储的设置（避免覆盖未在 newSettings 中的项）
        const currentStored = GM_getValue(this.STORAGE_KEY, {});
        const mergedToSave = Object.assign({}, currentStored, normalizedSettings);
        
        this.save(mergedToSave);

        // 3. 派发设置更新事件
        window.dispatchEvent(new CustomEvent('qmx-settings-update', { detail: normalizedSettings }));
    },

    /**
     * 重置为默认设置。
     */
    reset() {
        GM_deleteValue(this.STORAGE_KEY);
        GM_deleteValue('douyu_qmx_theme'); // 重置主题设置
    },
};

/**
 * =================================================================================
 * 运行时配置 (SETTINGS)
 * ---------------------------------------------------------------------------------
 * 脚本实际使用的配置对象，合并用户设置。
 * =================================================================================
 */
const SETTINGS = SettingsManager.get();
SETTINGS.THEME = GM_getValue('douyu_qmx_theme', SETTINGS.DEFAULT_THEME);

export { SETTINGS, SettingsManager};
