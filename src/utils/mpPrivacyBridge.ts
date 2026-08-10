/**
 * 微信小程序隐私：统一注册 wx.onNeedPrivacyAuthorization，由 PrivacyPopup 挂载 UI。
 * 避免 App 与组件重复注册；未挂载 UI 前对 resolve disagree，防止 errno 112 卡死。
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

/** PrivacyPopup onMounted 时注册（须挂在具体页面；App.vue template 在 mp-weixin 不生效） */
export function registerPrivacyAuthorizationUi(handler: (resolve: PrivacyResolve) => void): void {
  showPrivacyAuthorization = handler;
  tryFlushPrivacyQueue();
}

/** PrivacyPopup 是否已挂载（避免分享直进子页时 UI 未就绪就 fallback 导致 toast 闪一下） */
export function isPrivacyAuthorizationUiReady(): boolean {
  return showPrivacyAuthorization != null;
}

/** 等待 App 级 PrivacyPopup 注册，最多 maxMs 毫秒 */
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
 * wx.requirePrivacyAuthorize 单独调用在多数机型上不弹窗，需走此路径完成闭环。
 * @returns 用户点击「同意」为 true，不同意或组件未挂载为 false（未挂载时再尝试 requirePrivacyAuthorize）
 */
export async function requestPrivacyAgreementViaPopup(): Promise<boolean> {
  try {
    const ready = await waitForPrivacyUiReady();
    if (!ready || !showPrivacyAuthorization) {
      console.warn('[privacy] PrivacyPopup 未挂载，跳过 requirePrivacyAuthorize fallback（避免无 UI toast 闪现）');
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

/** 分享/扫码进入计分页 */
export function isShareInviteLaunchQuery(q: Record<string, unknown> | undefined | null): boolean {
  if (!q || typeof q !== 'object') return false;
  const fromShare = q.from === 'share' || q.from === 'timeline';
  const hasScene = q.scene != null && String(q.scene).trim() !== '';
  return fromShare || hasScene;
}

export function isWxShareOrScanEntryScene(scene: unknown): boolean {
  const n = Number(scene);
  if (!Number.isFinite(n)) return false;
  return new Set([1007, 1008, 1011, 1012, 1013, 1036, 1044, 1047, 1048, 1049, 1154, 1155]).has(n);
}

/** 真机有时丢失 from=share，用 scene + match_id 补判 */
export function detectScorecardInviteEntry(q: Record<string, unknown>, hasMatchId: boolean): boolean {
  if (!hasMatchId) return false;
  if (isShareInviteLaunchQuery(q)) return true;
  try {
    const ent = (wx as Record<string, unknown>).getEnterOptionsSync as
      | (() => { scene?: number }) | undefined;
    if (ent?.() && isWxShareOrScanEntryScene(ent().scene)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function getLaunchContextFromOptions(options: unknown): {
  path: string;
  query: Record<string, unknown>;
} {
  let path = String((options as { path?: string })?.path || '');
  let query = ((options as { query?: Record<string, unknown> })?.query || {}) as Record<string, unknown>;
  try {
    const ent = (wx as Record<string, unknown>).getEnterOptionsSync as
      | (() => { path?: string; query?: Record<string, unknown> }) | undefined;
    const snap = ent?.();
    if (snap?.path) path = String(snap.path);
    if (snap?.query && typeof snap.query === 'object') query = { ...snap.query, ...query };
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
 * 头像 chooseAvatar、昵称 nickname 输入前建议先调用，否则可能只表现为普通 input、不弹官方隐私窗。
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
