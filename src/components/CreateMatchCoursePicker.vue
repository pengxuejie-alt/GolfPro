<script setup lang="ts">
/**
 * 选场弹层独立组件：避免与 CreateMatch 页内「发布按钮」等渲染槽位冲突，
 * 导致 uni-app 编译后搜索框 value 误绑 #1e293b（表现为自动出现 e10、列表为空）。
 */
import { ref, computed, watch } from 'vue';
import {
  courseCatalogStats,
  flattenCoursesForPicker,
  type PickerCourseRow,
} from '@/data/courseCatalog';
import { sortCoursesForPicker } from '@/utils/coursePickerSort';
import { getPickerLocationSync, resolvePickerLocation } from '@/utils/deviceLocationCache';
import { MatchManager } from '@/utils/match_manager';
import { kickoffTimeMs, matchListSortTimeMs } from '@/utils/matchKickoff';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  close: [];
  select: [course: PickerCourseRow | Record<string, unknown>];
}>();

const courseSearchQuery = ref('');
const coursePickerScrollPx = ref(420);
const pickerLocation = ref(getPickerLocationSync());
const coursePlayCounts = ref<Record<string, number>>({});
const courseLastPlayedMs = ref<Record<string, number>>({});

const allCoursesFlat = flattenCoursesForPicker();
const catalogStats = courseCatalogStats();

function onCourseSearchInput(e: { detail?: { value?: string } }) {
  courseSearchQuery.value = String(e?.detail?.value ?? '');
}

function courseMatchesSearch(c: PickerCourseRow, key: string): boolean {
  if (!key) return true;
  const name = String(c.name || '').toLowerCase();
  const city = String(c.city || '').toLowerCase();
  const province = String(c.province || '').toLowerCase();
  return name.includes(key) || city.includes(key) || province.includes(key);
}

async function loadCoursePlayCounts() {
  try {
    const list = await MatchManager.getMatchList();
    const counts: Record<string, number> = {};
    const lastMs: Record<string, number> = {};
    for (const m of Array.isArray(list) ? list : []) {
      const id = String(m?.course_id || '').trim();
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
      const t = kickoffTimeMs(m) ?? matchListSortTimeMs(m);
      if (t > 0) lastMs[id] = Math.max(lastMs[id] || 0, t);
    }
    coursePlayCounts.value = counts;
    courseLastPlayedMs.value = lastMs;
  } catch {
    coursePlayCounts.value = {};
    courseLastPlayedMs.value = {};
  }
}

watch(
  () => props.show,
  (open) => {
    if (!open) return;
    courseSearchQuery.value = '';
    try {
      const sys = uni.getSystemInfoSync();
      const winH = Number(sys.windowHeight) || 667;
      coursePickerScrollPx.value = Math.max(280, Math.floor(winH * 0.8 - 200));
    } catch {
      coursePickerScrollPx.value = 420;
    }
    pickerLocation.value = getPickerLocationSync();
    void resolvePickerLocation().then((loc) => {
      pickerLocation.value = loc;
    });
    void loadCoursePlayCounts();
  },
);

const filteredCourses = computed(() => {
  const key = courseSearchQuery.value.trim().toLowerCase();
  const base = key
    ? allCoursesFlat.filter((c) => courseMatchesSearch(c, key))
    : allCoursesFlat;
  let sorted: PickerCourseRow[];
  try {
    sorted = sortCoursesForPicker(base, {
      lat: pickerLocation.value?.lat,
      lng: pickerLocation.value?.lng,
      playCountById: coursePlayCounts.value,
      lastPlayedMsById: courseLastPlayedMs.value,
    });
  } catch (e) {
    console.warn('[CreateMatchCoursePicker] sortCoursesForPicker', e);
    sorted = [...base].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  if (!key) return sorted.slice(0, 100);
  return sorted;
});

const courseListHint = computed(() => {
  const total = catalogStats.courses;
  if (courseSearchQuery.value.trim()) {
    return `共 ${total} 座 · 匹配 ${filteredCourses.value.length} 条`;
  }
  return total > 100
    ? `全国 ${total} 座 · 显示前 100 条，请搜索省份/城市/球场名`
    : `全国 ${total} 座球场`;
});

function pickCustomIndoor() {
  const q = courseSearchQuery.value.trim();
  if (!q) return;
  emit('select', {
    id: 'custom-indoor',
    name: `${q} (室内练习场)`,
    city: '自定义',
    total_par: 72,
    holes: Array.from({ length: 18 }, (_, i) => ({ no: i + 1, par: 4 })),
  });
}
</script>

<template>
  <view
    v-if="show"
    class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
  >
    <view class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up h-[80vh] flex flex-col">
      <view class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
      <view class="flex justify-between items-center mb-6">
        <text class="text-xl font-bold text-slate-900">选择球场</text>
        <view class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100" @tap="emit('close')">
          <uni-icons type="closeempty" :size="20" color="#94a3b8" />
        </view>
      </view>

      <view class="relative mb-2">
        <input
          type="text"
          :value="courseSearchQuery"
          confirm-type="search"
          adjust-position
          class="mp-safe-input-full w-full pl-12 pr-4 bg-slate-50 rounded-2xl border border-transparent font-medium text-slate-900"
          placeholder="搜索省份、城市或球场名"
          @input="onCourseSearchInput"
        />
        <view class="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
          <uni-icons type="search" :size="20" color="#94a3b8" />
        </view>
      </view>
      <text class="text-xs text-slate-400 mb-4 px-1 block">{{ courseListHint }}</text>

      <scroll-view scroll-y enable-flex class="no-scrollbar" :style="{ height: coursePickerScrollPx + 'px' }">
        <view class="space-y-2 pb-2">
          <view
            v-for="course in filteredCourses"
            :key="course.id"
            class="flex items-center gap-4 p-3 rounded-2xl active:bg-slate-100"
            @tap="emit('select', course)"
          >
            <image :src="course.logo_url" class="w-12 h-12 rounded-xl object-cover shadow-sm" mode="aspectFill" />
            <view class="flex-1 min-w-0">
              <text class="font-bold text-slate-900 truncate block">{{ course.name }}</text>
              <text class="text-xs text-slate-500 block">{{ course.province }} · {{ course.city }}</text>
            </view>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </view>

          <view v-if="!courseSearchQuery && filteredCourses.length === 0" class="py-8 text-center text-sm text-slate-400">
            球场列表加载异常，请重启小程序后重试
          </view>

          <view
            v-if="courseSearchQuery && filteredCourses.length === 0"
            class="flex items-center gap-4 p-3 rounded-2xl border border-dashed border-slate-300 active:bg-slate-100"
            @tap="pickCustomIndoor"
          >
            <view class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <uni-icons type="search" :size="20" color="#94a3b8" />
            </view>
            <view class="flex-1 min-w-0">
              <text class="font-bold text-slate-900 truncate block">使用 "{{ courseSearchQuery }}" 作为室内练习场</text>
              <text class="text-xs text-slate-500 block">默认 18 洞全为 Par 4</text>
            </view>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>
