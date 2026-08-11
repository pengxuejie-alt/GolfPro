<template>
  <!-- #ifdef MP-WEIXIN -->
  <view v-if="show" class="mp-privacy-modal-mask" catchtouchmove="">
    <view class="mp-privacy-modal-panel" @tap.stop>
      <text class="mp-privacy-modal-title">用户隐私保护提示</text>
      <view class="mp-privacy-modal-body">
        <text class="mp-privacy-modal-line">在你使用 Golfdate计分 服务之前，请仔细阅读</text>
        <text class="mp-privacy-link" @tap.stop="$emit('open-contract')">《Golfdate计分小程序隐私保护指引》</text>
        <text class="mp-privacy-modal-line">如你同意该指引，请点击「同意」开始使用本小程序。</text>
      </view>
      <view class="mp-privacy-modal-actions">
        <button
          type="default"
          plain
          class="mp-privacy-btn-refuse"
          hover-class="mp-privacy-btn-hover"
          @tap="$emit('disagree')"
        >
          拒绝
        </button>
        <button
          id="mp-privacy-agree-btn"
          type="default"
          plain
          class="mp-privacy-btn-agree"
          hover-class="mp-privacy-btn-hover"
          open-type="agreePrivacyAuthorization"
          @agreeprivacyauthorization="$emit('agree', $event)"
        >
          同意
        </button>
      </view>
    </view>
  </view>
  <!-- #endif -->
</template>

<script setup lang="ts">
defineProps<{ show: boolean }>();
defineEmits<{
  agree: [e?: { detail?: { errMsg?: string } }];
  disagree: [];
  'open-contract': [];
}>();
</script>

<style scoped>
.mp-privacy-modal-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 100001;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}
.mp-privacy-modal-panel {
  width: 100%;
  max-width: 640rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx 36rpx 32rpx;
  box-sizing: border-box;
}
.mp-privacy-modal-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: #0f172a;
  text-align: center;
  margin-bottom: 28rpx;
}
.mp-privacy-modal-body {
  margin-bottom: 36rpx;
}
.mp-privacy-modal-line {
  display: block;
  font-size: 28rpx;
  color: #334155;
  line-height: 1.6;
  margin-bottom: 8rpx;
}
.mp-privacy-link {
  display: inline;
  font-size: 28rpx;
  color: #2563eb;
  line-height: 1.6;
}
.mp-privacy-modal-actions {
  display: flex;
  gap: 24rpx;
}
.mp-privacy-btn-refuse,
.mp-privacy-btn-agree {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  border-radius: 16rpx;
  padding: 20rpx 0;
  line-height: 1.4;
  margin: 0;
}
.mp-privacy-btn-refuse::after,
.mp-privacy-btn-agree::after {
  border: none;
}
.mp-privacy-btn-refuse {
  background: #f1f5f9;
  color: #475569;
  border: none;
}
.mp-privacy-btn-agree {
  background: #0f172a;
  color: #fff;
  border: none;
}
.mp-privacy-btn-hover {
  opacity: 0.88;
}
</style>
