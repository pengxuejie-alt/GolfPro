import { onShow } from '@dcloudio/uni-app';

/** 与 pages.json tabBar.list 顺序一致：0 首页 / 1 球友 / 2 我的 */
export function useMpCustomTabBarIndex(index: number) {
  // #ifdef MP-WEIXIN
  onShow(() => {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1] as {
        getTabBar?: () => { setData?: (d: Record<string, unknown>) => void } | undefined;
      };
      const tab = cur?.getTabBar?.();
      tab?.setData?.({ selected: index });
    } catch (e) {
      console.warn('[mpTabBar] sync selected', e);
    }
  });
  // #endif
}
