<template>
  <!-- #ifdef MP-WEIXIN -->
  <view v-if="visible" class="privacy-mask" @click.stop>
    <view class="privacy-panel" @click.stop>
      <view class="privacy-title">高球有伴（GolfPro）隐私保护指引</view>
      <view class="privacy-sub">为向您提供服务，我们需要在您同意后处理以下信息：</view>
      <scroll-view scroll-y class="privacy-scroll">
        <view class="privacy-item">1. 微信昵称、头像：在您同意后用于展示附近球局中的球员身份。</view>
        <view class="privacy-item">2. 您发布的内容：用于发布球局信息和照片。</view>
        <view class="privacy-item">3. 相册（仅写入）权限：用于保存计分卡截图。</view>
        <view class="privacy-item">4. 您选中的照片或视频：用于发布打球照片或视频。</view>
        <view class="privacy-item">5. 位置信息：用于展示附近球局及本地天气。</view>
      </scroll-view>
      <view class="privacy-actions">
        <button class="privacy-btn disagree" @click="onDisagree">不同意</button>
        <button
          id="privacy-agree-btn"
          class="privacy-btn agree"
          open-type="agreePrivacyAuthorization"
          @agreeprivacyauthorization="onAgreeNative"
        >
          同意
        </button>
      </view>
    </view>
  </view>
  <!-- #endif -->
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import {
  registerPrivacyAuthorizationUi,
  emitPrivacyContractAgreed,
} from '@/utils/mpPrivacyBridge';

const visible = ref(false);
/** 微信注入的 resolve，用于在用户操作后结束隐私等待 */
let pendingResolve: ((opts: Record<string, string>) => void) | null = null;

function clearPending() {
  pendingResolve = null;
  visible.value = false;
}

function onAgreeNative(e?: { detail?: { errMsg?: string } }) {
  try {
    const err = e?.detail?.errMsg;
    if (err && !err.includes('ok')) {
      console.warn('[PrivacyPopup] agreePrivacyAuthorization', err);
    }
    if (pendingResolve) {
      pendingResolve({ event: 'agree', buttonId: 'privacy-agree-btn' });
    }
    emitPrivacyContractAgreed();
  } catch (err) {
    console.warn('[PrivacyPopup] agree native', err);
  } finally {
    clearPending();
  }
}

function onDisagree() {
  try {
    if (pendingResolve) {
      pendingResolve({ event: 'disagree', buttonId: 'privacy-disagree' });
    }
  } catch (e) {
    console.warn('[PrivacyPopup] disagree', e);
  } finally {
    clearPending();
  }
}

onMounted(() => {
  // #ifdef MP-WEIXIN
  try {
    registerPrivacyAuthorizationUi((resolve) => {
      pendingResolve = resolve;
      visible.value = true;
    });
  } catch (e) {
    console.warn('[PrivacyPopup] registerPrivacyAuthorizationUi', e);
  }
  // #endif
});

onBeforeUnmount(() => {
  clearPending();
});
</script>

<style scoped>
.privacy-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 100000;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}
.privacy-panel {
  width: 100%;
  max-width: 640rpx;
  max-height: 80vh;
  background: #fff;
  border-radius: 24rpx;
  padding: 32rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.privacy-title {
  font-size: 34rpx;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 16rpx;
}
.privacy-sub {
  font-size: 26rpx;
  color: #64748b;
  margin-bottom: 24rpx;
  line-height: 1.5;
}
.privacy-scroll {
  flex: 1;
  max-height: 420rpx;
  margin-bottom: 24rpx;
}
.privacy-item {
  font-size: 28rpx;
  color: #334155;
  line-height: 1.55;
  margin-bottom: 20rpx;
}
.privacy-actions {
  display: flex;
  gap: 24rpx;
}
.privacy-btn {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  border-radius: 16rpx;
  padding: 20rpx 0;
  line-height: 1.4;
}
.privacy-btn.disagree {
  background: #f1f5f9;
  color: #475569;
}
.privacy-btn.agree {
  background: #0f172a;
  color: #fff;
}
.privacy-btn::after {
  border: none;
}
</style>
