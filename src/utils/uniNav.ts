import { Tab } from '@/types';

type NavKey = Tab | string;

const ROUTES: Record<string, string> = {
  HOME: '/pages/index/index',
  CREATE: '/pages/CreateMatch',
  SCORECARD: '/pages/scorecard/scorecard',
  PK_SET: '/pages/PKSet',
  SELECT_PLAYER: '/pages/SelectPlayer',
  PLAYERS: '/pages/Players',
  ME: '/pages/Me',
  PLAYER_PROFILE: '/pages/PlayerProfile',
  PK_DIZHU: '/pages/PKDizhu',
  PK_TIGER: '/pages/PKTiger',
  PK_LASHI: '/pages/PKLashi',
  MATCH_SQUARE: '/pages/MatchSquare',
  MATCH_HISTORY_LIST: '/pages/MatchHistoryList',
};

const TABBAR_PATHS = new Set([
  '/pages/index/index',
  '/pages/Players',
  '/pages/Me',
]);

/** 避免连续调用路由 API（易触发 webviewId / routeDone 类系统错误，尤其在模拟器热重载时） */
let navBusy = false;
const RELEASE_MS = 200;

function releaseNavSoon() {
  setTimeout(() => {
    navBusy = false;
  }, RELEASE_MS);
}

function runNav(action: () => void) {
  if (navBusy) {
    console.warn('[uniNav] skipped: busy');
    return;
  }
  navBusy = true;
  try {
    action();
  } catch (e) {
    console.warn('[uniNav] sync throw', e);
    navBusy = false;
  }
}

function normalizeKey(key: NavKey): string {
  return typeof key === 'string' ? key : String(key);
}

function toQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

function toastNavFail() {
  try {
    uni.showToast({
      title: '页面打开失败，请清缓存后重新编译',
      icon: 'none',
      duration: 2500,
    });
  } catch {
    /* ignore */
  }
}

/** navigateTo 失败时（常见于模拟器 routeDone/webviewId）改用 redirectTo */
function navigateOrRedirect(url: string) {
  runNav(() => {
    uni.navigateTo({
      url,
      success: () => releaseNavSoon(),
      fail: (err) => {
        console.warn('[openRoute] navigateTo fail', url, err);
        uni.redirectTo({
          url,
          success: () => releaseNavSoon(),
          fail: (err2) => {
            console.warn('[openRoute] redirectTo fail', url, err2);
            toastNavFail();
            navBusy = false;
          },
        });
      },
    });
  });
}

/** uni-app 页面跳转：Tab 栏页面用 switchTab，其余用 navigateTo */
export function openRoute(tab: NavKey, params?: Record<string, any>) {
  const path = ROUTES[normalizeKey(tab)];
  if (!path) {
    console.warn('[openRoute] Unknown tab:', tab);
    return;
  }
  if (TABBAR_PATHS.has(path)) {
    uni.switchTab({
      url: path,
      fail: (err) => console.warn('[openRoute] switchTab fail', path, err),
    });
    return;
  }
  navigateOrRedirect(path + toQuery(params));
}

/** 从计分板「当前生效规则」进入打老虎/拉斯/斗地主子页后，返回时重新打开 PK 规则弹层 */
const STORAGE_REOPEN_SCORECARD_PK_RULES = '__scorecard_reopen_pk_rules_modal';

export function markScorecardReopenPkRulesModal() {
  try {
    uni.setStorageSync(STORAGE_REOPEN_SCORECARD_PK_RULES, '1');
  } catch {
    /* ignore */
  }
}

export function consumeScorecardReopenPkRulesModal(): boolean {
  try {
    const v = uni.getStorageSync(STORAGE_REOPEN_SCORECARD_PK_RULES);
    if (v === '1' || v === true) {
      uni.removeStorageSync(STORAGE_REOPEN_SCORECARD_PK_RULES);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * PK 规则子页返回：优先 navigateBack；若栈中只有当前页则回计分板（避免 reLaunch 首页）
 * 从规则列表进入时请先 markScorecardReopenPkRulesModal()，以便计分板 onShow 重新打开规则弹层
 */
export function goBackFromPkRulePage(matchId: string) {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    runNav(() => {
      uni.navigateBack({
        delta: 1,
        success: () => releaseNavSoon(),
        fail: () => {
          navBusy = false;
        },
      });
    });
    return;
  }
  if (matchId) {
    markScorecardReopenPkRulesModal();
    runNav(() => {
      uni.redirectTo({
        url: `/pages/scorecard/scorecard?match_id=${encodeURIComponent(matchId)}`,
        success: () => releaseNavSoon(),
        fail: () => {
          toastNavFail();
          navBusy = false;
        },
      });
    });
    return;
  }
  goBack();
}

export function goBack(fallbackReLaunchIndex = true) {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    runNav(() =>
      uni.navigateBack({
        delta: 1,
        success: () => releaseNavSoon(),
        fail: () => {
          navBusy = false;
        },
      }),
    );
    return;
  }
  if (fallbackReLaunchIndex) {
    runNav(() =>
      uni.reLaunch({
        url: '/pages/index/index',
        success: () => releaseNavSoon(),
        fail: () => {
          navBusy = false;
        },
      }),
    );
  }
}

/** 替换当前页（无历史栈时用于创建页直达计分板等） */
export function replaceRoute(tab: NavKey, params?: Record<string, any>) {
  const path = ROUTES[normalizeKey(tab)];
  if (!path) return;
  if (TABBAR_PATHS.has(path)) {
    uni.switchTab({
      url: path,
      fail: (err) => console.warn('[replaceRoute] switchTab fail', path, err),
    });
    return;
  }
  runNav(() => {
    uni.redirectTo({
      url: path + toQuery(params),
      success: () => releaseNavSoon(),
      fail: (err) => {
        console.warn('[replaceRoute] redirectTo fail', path, err);
        toastNavFail();
        navBusy = false;
      },
    });
  });
}
