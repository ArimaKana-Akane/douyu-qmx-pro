declare const __BUILD_FLAVOR__: string;
declare const __BUILD_CHANNEL__: string;
declare const __ENABLE_DANMU_PRO__: boolean;
declare const __ENABLE_STAR_CORE__: boolean;
/**
 * 构建期注入的脚本版本号（与 userscript 元数据头 @version 同源）。
 *
 * 为什么需要它：「关于」页原先硬编码 `v2.1.0 Beta`，装上 2.1.2 后仍显示旧版本，
 * 会让用户误以为安装没生效 —— 而「装错版本」正是这个项目反复踩到的坑
 * （上游 v2.1.0-beta.1 是 Pre-release，releases/latest 实际指向 v2.0.9）。
 * 改为构建期注入后，界面显示的版本一定与元数据头一致。
 */
declare const __VERSION__: string;
