<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/userStore';
import { signInWithWeChat } from '@/utils/auth';
import { setupWxOnNeedPrivacyAuthorization, isShareInviteLaunchQuery, getLaunchContextFromOptions } from '@/utils/mpPrivacyBridge';
import { db } from '@/utils/db';
import AppUniIcon from '@/components/AppUniIcon.vue';
import LucideIconByName from '@/components/LucideIconByName.vue';

onLaunch((options) => {
  // #ifdef MP-WEIXIN
  /** 云开发 init 须在 onLaunch 尽早执行，勿在 main.ts 模块顶；可减轻开发者工具内 wx.cloud.init 内部 timeout 日志 */
  try {
    db.init();
  } catch (e) {
    console.warn('[App] db.init', e);
  }
  try {
    setupWxOnNeedPrivacyAuthorization();
  } catch (e) {
    console.warn('[App] setupWxOnNeedPrivacyAuthorization', e);
  }
  // #endif
  const userStore = useUserStore();
  userStore.hydrateAuthFromStorage();
  /** 分享直进计分页：勿在 PrivacyPopup 就绪前调 login 云函数，否则会弹出「需同意隐私指引后继续使用」且无按钮 */
  const { path: launchPath, query: launchQuery } = getLaunchContextFromOptions(options);
  const hasScorecardMatch =
    launchQuery.match_id != null && String(launchQuery.match_id).trim() !== '';
  const deferSignInForInvite =
    launchPath.includes('scorecard') &&
    (isShareInviteLaunchQuery(launchQuery) || hasScorecardMatch);
  if (!deferSignInForInvite) {
    void signInWithWeChat()
      .then((session) => {
        userStore.applyAuthResult(session);
      })
      .catch((e) => {
        console.warn('[App] signInWithWeChat', e);
        userStore.applyAuthResult({
          mode: 'mock',
          openId: 'mock_golfpro_user',
          nickname: userStore.profile.nickname,
          avatar: userStore.profile.avatar,
        });
      });
  }
});

onShow(() => {});

onHide(() => {});
</script>

<template>
  <!-- App.vue 的 template 编译到 mp-weixin 时不生效；PrivacyPopup 须挂在 index/scorecard 等页面 -->
  <!-- #ifndef MP-WEIXIN -->
  <view style="display: none;" />
  <!-- #endif -->
  <!-- #ifdef MP-WEIXIN -->
  <!-- 兜底：强制产出历史组件文件，避免微信工具缓存旧依赖时报 ENOENT -->
  <view style="display: none;">
    <AppUniIcon name="Plus" :size="12" color="#ffffff" />
    <LucideIconByName name="Users" />
  </view>
  <!-- #endif -->
</template>

<style>
/* #ifdef H5 */
@import './index.css';
/* #endif */
/* #ifndef H5 */
/* app-mp.css 内含 tailwind-mp.css（构建期展开为工具类）+ 小程序安全区 / Lucide 占位等 */
@import './app-mp.css';

/** 原生 TabBar 由系统绘制；勿写 uni-tabbar { display:none } 等调试样式 */
.uni-tabbar .uni-tabbar__icon {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
}
/* #endif */
</style>
