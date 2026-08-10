/**
 * 自定义导航栏页顶栏留白：下移内容避开状态栏与右上角胶囊，
 * 避免「返回 / 管理」与小程序原生按钮重叠。
 */
export function getMpCapsuleSafeHeaderStyle(): Record<string, string> {
  let paddingTop = '48px';
  let paddingRight = '16px';

  // #ifdef MP-WEIXIN
  try {
    const sys = uni.getSystemInfoSync();
    const w = Number(sys.windowWidth ?? sys.screenWidth ?? 375);
    const m = uni.getMenuButtonBoundingClientRect();
    if (m && typeof m.bottom === 'number' && m.bottom > 0) {
      paddingTop = `${Math.ceil(m.bottom + 8)}px`;
      if (typeof m.left === 'number' && m.left > 0) {
        paddingRight = `${Math.ceil(Math.max(16, w - m.left + 12))}px`;
      }
    } else if (typeof sys.statusBarHeight === 'number') {
      paddingTop = `${Math.ceil(sys.statusBarHeight + 44)}px`;
    }
  } catch {
    /* ignore */
  }
  // #endif

  return {
    paddingTop,
    paddingRight,
    paddingLeft: '24px',
    boxSizing: 'border-box',
  };
}

/**
 * 「全部」比赛列表顶栏：第一行与右上角胶囊同一高度带（标题与原生按钮齐平），
 * 第二行再放操作按钮；内容整体仍在左右安全区内，不与胶囊重叠。
 */
export function getMpMatchListNavShellStyle(): {
  shellStyle: Record<string, string>;
  navRowHeightPx: number;
  /** 仅第一行需要避开右上角胶囊 */
  capsulePaddingRight: string;
} {
  let statusBarPx = 24;
  let navRowHeightPx = 44;
  let capsulePaddingRight = '16px';

  // #ifdef MP-WEIXIN
  try {
    const sys = uni.getSystemInfoSync();
    statusBarPx = Math.ceil(Number((sys as { statusBarHeight?: number }).statusBarHeight) || 24);
    const w = Number(sys.windowWidth ?? sys.screenWidth ?? 375);
    const m = uni.getMenuButtonBoundingClientRect();
    if (m && typeof m.height === 'number' && m.height > 0 && typeof m.top === 'number') {
      const gap = Math.max(0, m.top - statusBarPx);
      navRowHeightPx = Math.ceil(gap * 2 + m.height);
      if (typeof m.left === 'number' && m.left > 0) {
        capsulePaddingRight = `${Math.ceil(Math.max(16, w - m.left + 8))}px`;
      }
    }
  } catch {
    /* ignore */
  }
  // #endif

  const shellStyle: Record<string, string> = {
    paddingTop: `${statusBarPx}px`,
    /** 整块不加 paddingRight：第二行「管理」贴页面最右侧；胶囊留白只包第一行 */
    paddingLeft: '24px',
    boxSizing: 'border-box',
  };

  return { shellStyle, navRowHeightPx, capsulePaddingRight };
}
