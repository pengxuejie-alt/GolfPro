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
const RELEASE_MS = 120;

function runNav(action: () => void) {
  if (navBusy) return;
  navBusy = true;
  try {
    action();
  } catch {
    navBusy = false;
    return;
  }
  const release = () => {
    setTimeout(() => {
      navBusy = false;
    }, RELEASE_MS);
  };
  // 下一帧再释放，给原生层先挂上本次跳转
  setTimeout(release, 0);
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

/** uni-app 页面跳转：Tab 栏页面用 switchTab，其余用 navigateTo */
export function openRoute(tab: NavKey, params?: Record<string, any>) {
  const path = ROUTES[normalizeKey(tab)];
  if (!path) {
    console.warn('[openRoute] Unknown tab:', tab);
    return;
  }
  if (TABBAR_PATHS.has(path)) {
    uni.switchTab({ url: path });
    return;
  }
  runNav(() => {
    uni.navigateTo({ url: path + toQuery(params) });
  });
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
      uni.navigateBack({ delta: 1 });
    });
    return;
  }
  if (matchId) {
    markScorecardReopenPkRulesModal();
    runNav(() => {
      uni.redirectTo({
        url: `/pages/scorecard/scorecard?match_id=${encodeURIComponent(matchId)}`,
      });
    });
    return;
  }
  goBack();
}

export function goBack(fallbackReLaunchIndex = true) {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    runNav(() => uni.navigateBack({ delta: 1 }));
    return;
  }
  if (fallbackReLaunchIndex) {
    runNav(() => uni.reLaunch({ url: '/pages/index/index' }));
  }
}

/** 替换当前页（无历史栈时用于创建页直达计分板等） */
export function replaceRoute(tab: NavKey, params?: Record<string, any>) {
  const path = ROUTES[normalizeKey(tab)];
  if (!path) return;
  if (TABBAR_PATHS.has(path)) {
    uni.switchTab({ url: path });
    return;
  }
  runNav(() => {
    uni.redirectTo({ url: path + toQuery(params) });
  });
}
