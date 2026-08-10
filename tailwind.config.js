/**
 * 小程序端通过 src/tailwind-mp.css 内的 @config 引用本文件。
 * 关闭 preflight，避免 * / ::before 等全局重置在微信 WXSS 中不兼容。
 * 其余平台（H5）仍使用 src/index.css 的完整 @import，不受此文件约束。
 */
export default {
  corePlugins: {
    preflight: false,
  },
};
