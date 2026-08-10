import oklabFunction from '@csstools/postcss-oklab-function';
import remToRpx from 'postcss-rem-to-responsive-pixel';

const isMpWeixin = process.env.UNI_PLATFORM === 'mp-weixin';

/**
 * 仅微信小程序构建启用：降级 Tailwind 4 常见现代颜色语法，并把 rem 转为 rpx。
 * H5 不加载这些插件，避免改变桌面端样式与单位。
 *
 * rootValue: 32 与 postcss-rem-to-responsive-pixel + Tailwind 官方示例一致（配合 rpx 设计稿）。
 * weapp-tailwindcss 的 rem2rpx 仍保留，处理其流水线内剩余 rem；此处负责 PostCSS 阶段的通用 CSS。
 */
const mpPlugins = [
  oklabFunction({
    preserve: false,
    enableProgressiveCustomProperties: false,
    /** 不生成 display-p3 / color-gamut 分支，便于 WXSS 只保留 sRGB（多为 rgb / #） */
    subFeatures: { displayP3: false },
  }),
  remToRpx({
    rootValue: 32,
    propList: ['*'],
    transformUnit: 'rpx',
    exclude: /node_modules/i,
  }),
];

export default isMpWeixin ? { plugins: mpPlugins } : {};
