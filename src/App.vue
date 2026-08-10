<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/userStore';
import { signInWithWeChat } from '@/utils/auth';
import { setupWxOnNeedPrivacyAuthorization } from '@/utils/mpPrivacyBridge';
import { db } from '@/utils/db';
import AppUniIcon from '@/components/AppUniIcon.vue';
import LucideIconByName from '@/components/LucideIconByName.vue';

onLaunch((options) => {
  // #ifdef MP-WEIXIN
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
  // #ifdef MP-WEIXIN
  /** 小程序端由首页 gateIndexPrivacyBeforeLogin / 计分加入流程负责登录，避免 onLaunch 抢先 callFunction 触发隐私 toast */
  // #endif
  // #ifndef MP-WEIXIN
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
  // #endif
});

onShow(() => {});

onHide(() => {});
</script>

<template>
  <!-- mp-weixin 下 App.vue template 不渲染；PrivacyPopup 在 scorecard/index 页面挂载 -->
  <!-- #ifdef MP-WEIXIN -->
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
