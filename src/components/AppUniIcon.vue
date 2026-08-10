<script setup lang="ts">
import { computed } from 'vue';
import { lucideNameToUniType } from '@/utils/uniIconAliases';

const props = withDefaults(
  defineProps<{
    /** Lucide 组件名，如 ChevronLeft */
    name: string;
    size?: number;
    color?: string;
    /** 为 false 时不包 48rpx 占位（用于极小图标） */
    wrap?: boolean;
  }>(),
  {
    size: 22,
    color: '#cbd5e1',
    wrap: true,
  }
);

const uniType = computed(() => lucideNameToUniType(props.name));
</script>

<template>
  <view v-if="wrap" class="mp-icon-slot-48">
    <uni-icons :type="uniType" :size="size" :color="color" />
  </view>
  <uni-icons v-else :type="uniType" :size="size" :color="color" />
</template>

<style scoped>
.mp-icon-slot-48 {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background-color: transparent;
}
</style>
