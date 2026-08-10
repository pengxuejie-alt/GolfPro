import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';

/** PK 子页（custom 导航）顶栏：与记分卡/首页一致，内容从微信胶囊下缘再下移 8px，便于点返回 */
export function useMpPkRuleHeaderPad() {
  const padTopPx = ref('');

  function sync() {
    padTopPx.value = '';
    // #ifdef MP-WEIXIN
    try {
      const m = uni.getMenuButtonBoundingClientRect();
      if (m && typeof m.bottom === 'number' && m.bottom > 0) {
        padTopPx.value = `${Math.ceil(m.bottom) + 8}px`;
        return;
      }
    } catch {
      /* ignore */
    }
    // #endif
  }

  onMounted(sync);
  onShow(sync);

  const headerPadStyle = computed(() => {
    if (padTopPx.value) return { paddingTop: padTopPx.value };
    return { paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))' };
  });

  return { headerPadStyle };
}
