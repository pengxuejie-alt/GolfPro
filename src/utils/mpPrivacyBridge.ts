/**
 * 微信小程序隐私：统一注册 wx.onNeedPrivacyAuthorization，由页面级 PrivacyPopup 挂载 UI。
 * 注意：uni-app 编译到 mp-weixin 时 App.vue 的 template 不生效，PrivacyPopup 须挂在具体页面。
 */

function getWxGlobal(): Record<string, unknown> | null {
  try {
    const g = globalThis as unknown as { wx?: Record<string, unknown> };
    return g.wx ?? null;
  } catch {
    return null;
  }
}

type PrivacyResolve = (opts: Record<string, string>) => void;

let showPrivacyAuthorization: ((resolve: PrivacyResolve) => void) | null = null;
/** UI 未就绪时暂存 resolve，禁止立即 disagree（否则会弹出系统 toast 且无按钮） */
let pendingPrivacyResolves: PrivacyResolve[] = [];
let privacyUiFlushInFlight = false;

function tryFlushPrivacyQueue(): void {
  if (!showPrivacyAuthorization || pendingPrivacyResolves.length === 0 || privacyUiFlushInFlight) return;
  privacyUiFlushInFlight = true;
  const batch = pendingPrivacyResolves.splice(0);
  try {
    showPrivacyAuthorization((opts) => {
      privacyUiFlushInFlight = false;
      for (const r of batch) {
        try {
          r(opts);
        } catch (e) {
          console.warn('[privacy] resolve callback', e);
        }
      }
      tryFlushPrivacyQueue();
    });
  } catch (e) {
    privacyUiFlushInFlight = false;
    pendingPrivacyResolves.unshift(...batch);
    console.warn('[privacy] tryFlushPrivacyQueue', e);
  }
}

function enqueuePrivacyAuthorization(resolve: PrivacyResolve): void {
  pendingPrivacyResolves.push(resolve);
  tryFlushPrivacyQueue();
  if (!showPrivacyAuthorization) {
    void waitForPrivacyUiReady(15000).then((ready) => {
      if (ready) tryFlushPrivacyQueue();
    });
  }
}

/** PrivacyPopup onMounted 时注册 */
export function registerPrivacyAuthorizationUi(handler: (resolve: PrivacyResolve) => void): void {
  showPrivacyAuthorization = handler;
  tryFlushPrivacyQueue();
}

/** PrivacyPopup 是否已挂载 */
export function isPrivacyAuthorizationUiReady(): boolean {
  return showPrivacyAuthorization != null;
}

/** 等待页面级 PrivacyPopup 注册，最多 maxMs 毫秒 */
export async function waitForPrivacyUiReady(maxMs = 4000): Promise<boolean> {
  if (showPrivacyAuthorization) return true;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    if (showPrivacyAuthorization) return true;
  }
  return showPrivacyAuthorization != null;
}

/**
 * 主动向用户展示与 onNeedPrivacyAuthorization 相同的自定义隐私弹窗（含官方 agreePrivacyAuthorization 按钮）。
 */
export async function requestPrivacyAgreementViaPopup(): Promise<boolean> {
  try {
    const ready = await waitForPrivacyUiReady(10000);
    if (!ready || !showPrivacyAuthorization) {
      console.warn('[privacy] PrivacyPopup 未挂载，无法展示隐私弹窗');
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      enqueuePrivacyAuthorization((opts) => {
        resolve(opts?.event === 'agree');
      });
    });
  } catch (e) {
    console.warn('[privacy] requestPrivacyAgreementViaPopup', e);
    return false;
  }
}

const agreedListeners: (() => void)[] = [];

/** 首页等在用户点击「同意」后尝试真实 getLocation */
export function onPrivacyContractAgreed(cb: () => void): void {
  agreedListeners.push(cb);
}

export function emitPrivacyContractAgreed(): void {
  const list = agreedListeners.slice();
  for (const fn of list) {
    try {
      fn();
    } catch (e) {
      console.warn('[privacy] agreed listener', e);
    }
  }
}

/** App onLaunch 尽早调用一次 */
export function setupWxOnNeedPrivacyAuthorization(): void {
  try {
    const w = getWxGlobal();
    if (!w || typeof w.onNeedPrivacyAuthorization !== 'function') return;
    (w.onNeedPrivacyAuthorization as (cb: (r: PrivacyResolve) => void) => void)((resolve: PrivacyResolve) => {
      try {
        enqueuePrivacyAuthorization(resolve);
      } catch (e) {
        console.warn('[privacy] onNeedPrivacyAuthorization', e);
      }
    });
  } catch (e) {
    console.warn('[privacy] setupWxOnNeedPrivacyAuthorization', e);
  }
}

/** 分享/扫码进入计分页（非首页点进），与 scorecard enteredViaInvite 对齐 */
export function isShareInviteLaunchQuery(q: Record<string, unknown> | undefined | null): boolean {
  if (!q || typeof q !== 'object') return false;
  const fromShare = q.from === 'share' || q.from === 'timeline';
  const hasScene = q.scene != null && String(q.scene).trim() !== '';
  return fromShare || hasScene;
}

/** 微信冷启动场景：分享卡片 / 扫码 / 朋友圈等（非 App 内 navigateTo） */
export function isWxShareOrScanEntryScene(scene: unknown): boolean {
  const n = Number(scene);
  if (!Number.isFinite(n)) return false;
  /** 1007/1008 单聊群聊卡片；1044 小程序消息；1011–1013/1047–1049 扫码；1154/1155 朋友圈 */
  const SHARE_OR_SCAN = new Set([
    1007, 1008, 1011, 1012, 1013, 1036, 1044, 1047, 1048, 1049, 1154, 1155,
  ]);
  return SHARE_OR_SCAN.has(n);
}

/**
 * 计分页受邀落地：query 带 from=share/scene，或冷启动为分享/扫码场景且带 match_id。
 * 真机上 from 参数有时丢失，需结合 getEnterOptionsSync().scene 判断。
 */
export function detectScorecardInviteEntry(
  q: Record<string, unknown>,
  hasMatchId: boolean,
): boolean {
  if (!hasMatchId) return false;
  if (isShareInviteLaunchQuery(q)) return true;
  try {
    const wxApi = typeof wx !== 'undefined' ? (wx as Record<string, unknown>) : null;
    const entFn = wxApi?.getEnterOptionsSync as
      | (() => { scene?: number; query?: Record<string, unknown> }) | undefined;
    const ent = entFn?.();
    if (ent && isWxShareOrScanEntryScene(ent.scene)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** App.onLaunch options 在真机上 query 可能不全，对齐 wx.getEnterOptionsSync */
export function getLaunchContextFromOptions(options: unknown): {
  path: string;
  query: Record<string, unknown>;
} {
  let path = String((options as { path?: string })?.path || '');
  let query = ((options as { query?: Record<string, unknown> })?.query || {}) as Record<string, unknown>;
  try {
    const wxApi = typeof wx !== 'undefined' ? (wx as Record<string, unknown>) : null;
    const ent = wxApi?.getEnterOptionsSync as (() => { path?: string; query?: Record<string, unknown> }) | undefined;
    const snap = ent?.();
    if (snap?.path) path = String(snap.path);
    if (snap?.query && typeof snap.query === 'object') {
      query = { ...snap.query, ...query };
    }
  } catch {
    /* ignore */
  }
  return { path, query };
}

/** 是否仍需用户同意隐私协议（未同意则勿调 getLocation 等） */
export function getPrivacyNeedAuthorizationAsync(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const w = getWxGlobal() as Record<string, unknown> | null;
      if (!w || typeof w.getPrivacySetting !== 'function') {
        resolve(false);
        return;
      }
      (w.getPrivacySetting as (o: {
        success: (res: { needAuthorization?: boolean }) => void;
        fail: () => void;
      }) => void)({
        success: (res: { needAuthorization?: boolean }) => {
          resolve(!!res.needAuthorization);
        },
        fail: () => resolve(true),
      });
    } catch {
      resolve(true);
    }
  });
}

/**
 * 主动触发隐私授权（基础库 2.32.3+）。
 * @returns 用户完成授权为 true，拒绝/失败为 false
 */
export function requirePrivacyAuthorizeAsync(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const w = getWxGlobal() as Record<string, unknown> | null;
      if (!w || typeof w.requirePrivacyAuthorize !== 'function') {
        resolve(true);
        return;
      }
      (w.requirePrivacyAuthorize as (o: { success?: () => void; fail?: (e?: unknown) => void }) => void)({
        success: () => resolve(true),
        fail: (e?: unknown) => {
          console.warn('[privacy] requirePrivacyAuthorize fail', e);
          resolve(false);
        },
      });
    } catch (e) {
      console.warn('[privacy] requirePrivacyAuthorize', e);
      resolve(false);
    }
  });
}
