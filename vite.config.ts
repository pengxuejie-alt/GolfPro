import path from 'path';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';
import dcloudioUni from '@dcloudio/vite-plugin-uni';
import tailwindcss from '@tailwindcss/vite';
import { UnifiedViteWeappTailwindcssPlugin } from 'weapp-tailwindcss/vite';

const uni =
  typeof dcloudioUni === 'function'
    ? dcloudioUni
    : (dcloudioUni as { default: typeof dcloudioUni }).default;

/**
 * 懒加载会导致 custom-tab-bar / 首帧 Tab 注入偏晚，底部导航易「消失」。
 * 构建后从 app.json 移除 lazyCodeLoading，保证原生 TabBar 与首屏组件稳定注入。
 */
function stripLazyCodeLoadingFromAppJson(wxRoot: string): void {
  const appJsonPath = path.join(wxRoot, 'app.json');
  if (!existsSync(appJsonPath)) return;
  try {
    const json = JSON.parse(readFileSync(appJsonPath, 'utf-8')) as Record<string, unknown>;
    let changed = false;
    if ('lazyCodeLoading' in json) { delete json.lazyCodeLoading; changed = true; }
    if ('cloudEnvId' in json) { delete json.cloudEnvId; changed = true; }
    if (!changed) return;
    writeFileSync(appJsonPath, `${JSON.stringify(json, null, 2)}\n`, 'utf-8');
  } catch {
    /* ignore malformed app.json */
  }
}

/** 根目录 cloudfunctions → 小程序包根，便于微信开发者工具打开 dist/dev|build/mp-weixin 时识别云函数目录 */
function copyCloudfunctionsToWxRoot(wxRoot: string): void {
  const srcCloud = path.resolve(__dirname, 'cloudfunctions');
  if (!existsSync(srcCloud)) return;
  const dest = path.join(wxRoot, 'cloudfunctions');
  cpSync(srcCloud, dest, { recursive: true });
}

/** 确保 project.config.json 含 cloudfunctionRoot，与 manifest 及工具「云开发」面板一致 */
function ensureProjectConfigMpWeixin(wxRoot: string): void {
  const projectConfigPath = path.join(wxRoot, 'project.config.json');
  if (!existsSync(projectConfigPath)) return;
  try {
    const raw = readFileSync(projectConfigPath, 'utf-8');
    const j = JSON.parse(raw) as Record<string, unknown>;
    /** 产物目录即小程序根目录，显式写入避免工具误判子目录 */
    j.miniprogramRoot = './';
    j.cloudfunctionRoot = 'cloudfunctions/';
    j.projectname = 'GolfPro';
    writeFileSync(projectConfigPath, `${JSON.stringify(j, null, 2)}\n`, 'utf-8');
  } catch {
    /* ignore malformed project.config.json */
  }
}

const TAB_ICON_NAMES = [
  'home.png',
  'home-active.png',
  'players.png',
  'players-active.png',
  'me.png',
  'me-active.png',
];

/** TabBar 图标：再次显式同步，避免 publicDir 与包根目录映射不一致导致 static/tab 缺失；cpSync 为二进制原样拷贝、不经压缩 */
function ensureTabBarPngsOnWxRoot(wxRoot: string): void {
  const tabSrc = path.resolve(__dirname, 'src/static/tab');
  const tabDest = path.join(wxRoot, 'static', 'tab');
  if (!existsSync(tabSrc)) return;
  cpSync(tabSrc, tabDest, { recursive: true });
  for (const name of TAB_ICON_NAMES) {
    const p = path.join(tabDest, name);
    if (!existsSync(p)) {
      console.warn(`[vite mp-weixin] TabBar 图标缺失: ${path.relative(wxRoot, p)}`);
    }
  }
}

/**
 * uni 将 publicDir（src/static）内容拷到包根时，子目录可能与 app.json 中 static/tab/ 不一致。
 * 每次 mp 写入产物时：
 * - src/static → static/（完整目录树，二进制原样）
 * - 再强制同步 src/static/tab → static/tab（双保险）
 */
function postProcessMpWeixinOutput(): void {
  if (process.env.UNI_PLATFORM !== 'mp-weixin') return;
  const srcStatic = path.resolve(__dirname, 'src/static');
  for (const sub of ['dist/dev/mp-weixin', 'dist/build/mp-weixin']) {
    const wxRoot = path.resolve(__dirname, sub);
    if (!existsSync(wxRoot)) continue;
    stripLazyCodeLoadingFromAppJson(wxRoot);
    if (existsSync(srcStatic)) {
      const dest = path.join(wxRoot, 'static');
      cpSync(srcStatic, dest, { recursive: true });
    }
    ensureTabBarPngsOnWxRoot(wxRoot);
    copyCloudfunctionsToWxRoot(wxRoot);
    ensureProjectConfigMpWeixin(wxRoot);
  }
}

/** uni 可能在同一阶段末尾再次写入 app.json，延后再剥 lazyCodeLoading；异步 await 保证 build 退出前已执行 */
async function postProcessMpWeixinOutputDeferred(): Promise<void> {
  postProcessMpWeixinOutput();
  if (process.env.UNI_PLATFORM !== 'mp-weixin') return;
  await new Promise<void>((r) => setTimeout(r, 0));
  postProcessMpWeixinOutput();
  await new Promise<void>((r) => setTimeout(r, 150));
  postProcessMpWeixinOutput();
}

const mpStaticSyncPlugin: Plugin = {
  name: 'uni-mp-weixin-sync-static-cloudfunctions',
  /** 开发模式每次产出写入 dist/dev/mp-weixin 时同步，避免仅 closeBundle 不触发导致看不到云函数 */
  writeBundle: postProcessMpWeixinOutputDeferred,
  closeBundle: postProcessMpWeixinOutputDeferred,
};

/** 与 weapp-tailwindcss 的 cssEntries 一致（须为含 Tailwind 的纯 CSS 绝对路径） */
const tailwindCssEntries = [
  path.resolve(__dirname, 'src/tailwind-mp.css'),
  path.resolve(__dirname, 'src/index.css'),
];

const isMpWeixin = process.env.UNI_PLATFORM === 'mp-weixin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const wxCloudEnvId = String(env.VITE_WX_CLOUD_ENV_ID ?? '').trim();

  return {
    publicDir: path.resolve(__dirname, 'src/static'),

    plugins: [
      ...uni(),
      tailwindcss(),
      ...(isMpWeixin
        ? [
            UnifiedViteWeappTailwindcssPlugin({
              rem2rpx: true,
              cssEntries: tailwindCssEntries,
            }),
          ]
        : []),
      mpStaticSyncPlugin,
    ],

    define: {
      'process.env.API_KEY': JSON.stringify(String(env.GEMINI_API_KEY ?? '').trim()),
      'process.env.GEMINI_API_KEY': JSON.stringify(String(env.GEMINI_API_KEY ?? '').trim()),
      'process.env.VITE_WX_CLOUD_ENV_ID': JSON.stringify(wxCloudEnvId),
    },
    resolve: {
      alias: {
        /** UNI_INPUT_DIR=src 时业务与 @ 均以 src 为根 */
        '@': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      assetsInlineLimit: 0,
    },
  };
});
