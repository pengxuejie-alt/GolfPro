<script setup lang="ts">
import { computed } from 'vue';
import {
  Users,
  MessageCircle,
  UserPlus,
  QrCode,
  Trophy,
  Edit2,
  LogOut,
} from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    name: string;
    /** 如 w-6 h-6；mp-weixin 构建时由 weapp-tailwindcss 将模板中的 Tailwind 尺寸类转为小程序可识别的选择器 */
    sizeClass?: string;
    colorClass?: string;
  }>(),
  {
    sizeClass: 'w-6 h-6',
    colorClass: '',
  }
);

const cls = computed(() => [props.sizeClass, props.colorClass].filter(Boolean));
</script>

<template>
  <Users v-if="name === 'Users'" :class="cls" />
  <MessageCircle v-else-if="name === 'MessageCircle'" :class="cls" />
  <UserPlus v-else-if="name === 'UserPlus'" :class="cls" />
  <QrCode v-else-if="name === 'QrCode'" :class="cls" />
  <Trophy v-else-if="name === 'Trophy'" :class="cls" />
  <Edit2 v-else-if="name === 'Edit2'" :class="cls" />
  <LogOut v-else-if="name === 'LogOut'" :class="cls" />
</template>
