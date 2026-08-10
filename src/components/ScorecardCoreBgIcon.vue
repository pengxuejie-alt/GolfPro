<script setup lang="ts">
import { computed } from 'vue';
import type { ScorecardCoreSvgKey } from '@/utils/scorecardCoreSvg';
import { SCORECARD_CORE_SVG } from '@/utils/scorecardCoreSvg';

const props = withDefaults(
  defineProps<{
    name: ScorecardCoreSvgKey;
    /** 占位容器宽高（rpx），与加载与否无关 */
    sizeRpx?: number;
  }>(),
  { sizeRpx: 48 }
);

const uri = computed(() => SCORECARD_CORE_SVG[props.name]);

const boxStyle = computed(() => ({
  width: `${props.sizeRpx}rpx`,
  height: `${props.sizeRpx}rpx`,
  backgroundImage: `url(${uri.value})`,
  backgroundSize: 'contain',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center',
}));
</script>

<template>
  <view class="scorecard-core-bg-icon" :style="boxStyle" />
</template>

<style scoped>
.scorecard-core-bg-icon {
  flex-shrink: 0;
  background-color: transparent;
  box-sizing: border-box;
}
</style>
