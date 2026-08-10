<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { MatchManager } from '@/utils/match_manager';
import { formatMatchKickoffCn, matchListSortTimeMs } from '@/utils/matchKickoff';
import { useUserStore } from '@/store/userStore';
import { openRoute } from '@/utils/uniNav';
import { Tab } from '@/types';
import { mpStaticAbsolute } from '@/utils/mpAssetPath';
import { getMpMatchListNavShellStyle } from '@/utils/mpCapsuleSafeInset';
import { MP_BATCH_CHECK_OFF, MP_BATCH_CHECK_ON, MP_BATCH_CHECK_ICON_COLOR } from '@/utils/mpBatchCheckStyle';

const userStore = useUserStore();
const SHARE_CARD_POSTER_BG = mpStaticAbsolute('share-card.png');

/** all：全部场次；live：仅进行中 / 未开始 */
const listMode = ref<'all' | 'live'>('all');

const matches = ref<any[]>([]);
const headerShellStyle = ref<Record<string, string>>({});
const navRowHeightPx = ref(44);
const capsulePaddingRight = ref('16px');

function syncHeaderInset() {
  const r = getMpMatchListNavShellStyle();
  headerShellStyle.value = r.shellStyle;
  navRowHeightPx.value = r.navRowHeightPx;
  capsulePaddingRight.value = r.capsulePaddingRight;
}

const displayedMatches = computed(() => {
  const list = Array.isArray(matches.value) ? [...matches.value] : [];
  list.sort((a, b) => matchListSortTimeMs(b) - matchListSortTimeMs(a));
  if (listMode.value !== 'live') return list;
  return list.filter((m) => m && typeof m === 'object' && (m.status === 0 || m.status === 1));
});

const pageTitle = computed(() => (listMode.value === 'live' ? '当前比赛' : '历史比赛'));

onLoad((q?: Record<string, unknown>) => {
  const raw = q?.mode != null ? String(q.mode).toLowerCase() : '';
  listMode.value = raw === 'live' ? 'live' : 'all';
});

onShow(() => {
  syncHeaderInset();
  void reloadMatches();
});

async function reloadMatches() {
  matches.value = await MatchManager.getMatchList();
}

function normalizeMatchMid(m: unknown): string {
  if (!m || typeof m !== 'object') return '';
  const o = m as { match_id?: unknown; _id?: unknown; id?: unknown };
  const raw = o.match_id ?? o._id ?? o.id;
  return raw != null ? String(raw).trim() : '';
}

const showDeleteModal = ref(false);
const matchToDelete = ref<string | null>(null);
const pendingDeleteIsHost = ref(false);

const confirmDelete = (matchId: string) => {
  matchToDelete.value = matchId;
  const victim = matches.value.find(
    (x) =>
      normalizeMatchMid(x) === String(matchId).trim() ||
      (x?._id != null && String(x._id) === String(matchId)),
  );
  pendingDeleteIsHost.value = victim ? MatchManager.isUserHostOfMatch(victim, userStore.openId) : false;
  showDeleteModal.value = true;
};

const executeDelete = async () => {
  if (!matchToDelete.value) return;
  const mid = matchToDelete.value;
  try {
    if (!userStore.openId) {
      uni.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (pendingDeleteIsHost.value) {
      const r = await MatchManager.deleteHostedMatch(mid, userStore.openId);
      if (!r.ok) {
        uni.showToast({ title: '操作失败', icon: 'none' });
        return;
      }
      uni.showToast({
        title: r.cloudDeleted ? '已删除' : '已从列表移除',
        icon: 'success',
      });
    } else {
      const r = await MatchManager.leaveParticipantMatch(mid);
      if (!r.ok) {
        uni.showToast({ title: '操作失败', icon: 'none' });
        return;
      }
      uni.showToast({
        title: r.localOnly ? '已从列表移除' : '已退赛',
        icon: 'success',
      });
    }
  } finally {
    await reloadMatches();
    showDeleteModal.value = false;
    matchToDelete.value = null;
    pendingDeleteIsHost.value = false;
  }
};

const historyBatchMode = ref(false);
const historySelectedMids = ref<string[]>([]);
const showBatchDeleteModal = ref(false);

function exitHistoryBatchMode() {
  historyBatchMode.value = false;
  historySelectedMids.value = [];
}

function toggleHistoryMidSelected(mid: string) {
  if (!mid) return;
  const i = historySelectedMids.value.indexOf(mid);
  if (i >= 0) historySelectedMids.value.splice(i, 1);
  else historySelectedMids.value.push(mid);
}

function isHistoryMidSelected(mid: string): boolean {
  return mid ? historySelectedMids.value.includes(mid) : false;
}

const historyListMids = computed(() =>
  displayedMatches.value.map((m) => normalizeMatchMid(m)).filter(Boolean),
);

const historyAllSelected = computed(() => {
  const ids = historyListMids.value;
  if (ids.length === 0) return false;
  const sel = new Set(historySelectedMids.value);
  return ids.every((id) => sel.has(id));
});

function toggleHistorySelectAll() {
  if (historyAllSelected.value) historySelectedMids.value = [];
  else historySelectedMids.value = [...historyListMids.value];
}

function confirmBatchDelete() {
  if (historySelectedMids.value.length === 0) {
    uni.showToast({ title: '请先选择比赛', icon: 'none' });
    return;
  }
  showBatchDeleteModal.value = true;
}

async function executeBatchDelete() {
  if (!userStore.openId) {
    uni.showToast({ title: '请先登录', icon: 'none' });
    showBatchDeleteModal.value = false;
    return;
  }
  const mids = [...new Set(historySelectedMids.value)].filter(Boolean);
  showBatchDeleteModal.value = false;
  if (mids.length === 0) return;

  uni.showLoading({ title: '处理中…', mask: true });
  let okCount = 0;
  let failCount = 0;
  try {
    for (const mid of mids) {
      const victim = matches.value.find((x) => normalizeMatchMid(x) === mid);
      const isHost = victim ? MatchManager.isUserHostOfMatch(victim, userStore.openId) : false;
      if (isHost) {
        const r = await MatchManager.deleteHostedMatch(mid, userStore.openId);
        if (r.ok) okCount++;
        else failCount++;
      } else {
        const r = await MatchManager.leaveParticipantMatch(mid);
        if (r.ok) okCount++;
        else failCount++;
      }
    }
  } finally {
    uni.hideLoading();
  }

  await reloadMatches();
  exitHistoryBatchMode();

  if (failCount === 0) uni.showToast({ title: `已处理 ${okCount} 场`, icon: 'success' });
  else uni.showToast({ title: `成功 ${okCount} 场，失败 ${failCount}`, icon: 'none', duration: 2500 });
}

function goBack() {
  exitHistoryBatchMode();
  try {
    const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (stack && stack.length > 1) {
      uni.navigateBack({ delta: 1 });
      return;
    }
  } catch {
    /* ignore */
  }
  uni.switchTab({ url: '/pages/index/index' });
}

function onHistoryRowTap(match: any) {
  const mid = normalizeMatchMid(match);
  if (!mid) return;
  if (historyBatchMode.value) {
    toggleHistoryMidSelected(mid);
    return;
  }
  const rawId = match?.match_id != null ? match.match_id : mid;
  openRoute(Tab.SCORECARD, { match_id: rawId });
}

function formatMatchWhen(m: any, dateOnly = false): string {
  return formatMatchKickoffCn(m, dateOnly);
}

function getMatchTotalStrokes(m: any): number {
  const holeScores = Array.isArray(m?.hole_scores) ? m.hole_scores : [];
  return holeScores.reduce((sum: number, h: any) => sum + Number(h?.scores?.[0] || 0), 0);
}
</script>

<template>
  <div class="min-h-screen bg-slate-50" :class="historyBatchMode ? 'pb-40' : 'pb-8'">
    <div
      class="sticky top-0 z-20 relative bg-slate-50 border-b border-slate-100"
      :style="headerShellStyle"
    >
      <!-- 第一行：与右上角胶囊同一高度带，右侧留白仅在本行 -->
      <div class="relative w-full" :style="{ height: `${navRowHeightPx}px`, paddingRight: capsulePaddingRight }">
        <view
          class="absolute left-0 top-0 bottom-0 z-20 flex items-center active:opacity-80 -ml-1"
          hover-class="opacity-80"
          @tap="goBack"
          @click="goBack"
        >
          <uni-icons type="left" :size="20" color="#0f172a" />
          <span class="text-sm font-bold text-slate-900">返回</span>
        </view>
        <h1
          class="absolute inset-0 z-10 flex items-center justify-center px-[100px] text-base font-black text-slate-900 tracking-tight line-clamp-1 pointer-events-none text-center"
        >
          {{ pageTitle }}
        </h1>
      </div>
      <!-- 第二行：贴页面最右（不与胶囊同行，仅需少量安全边距） -->
      <div class="flex justify-end items-center pt-1 pb-2.5 pr-3">
        <view
          v-if="!historyBatchMode"
          class="text-sm font-black text-[#07C160] py-1.5 active:opacity-70"
          @tap="historyBatchMode = true"
          @click="historyBatchMode = true"
        >
          管理
        </view>
        <view
          v-else
          class="text-sm font-black text-slate-700 py-1.5 active:opacity-70"
          @tap="exitHistoryBatchMode"
          @click="exitHistoryBatchMode"
        >
          完成
        </view>
      </div>
    </div>

    <div class="p-4 space-y-4">
      <div
        v-for="match in displayedMatches"
        :key="normalizeMatchMid(match)"
        @tap="onHistoryRowTap(match)"
        @click="onHistoryRowTap(match)"
        class="relative bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:opacity-90 overflow-hidden"
      >
        <image class="mh-poster-bg" :src="SHARE_CARD_POSTER_BG" mode="aspectFill" />
        <view class="mh-poster-mask" />
        <div class="flex items-start gap-2 relative z-[20]">
          <view v-if="historyBatchMode" class="shrink-0 pt-0.5" @tap.stop @click.stop>
            <view
              :style="
                isHistoryMidSelected(normalizeMatchMid(match)) ? MP_BATCH_CHECK_ON : MP_BATCH_CHECK_OFF
              "
              @tap.stop="toggleHistoryMidSelected(normalizeMatchMid(match))"
              @click.stop="toggleHistoryMidSelected(normalizeMatchMid(match))"
            >
              <uni-icons
                v-if="isHistoryMidSelected(normalizeMatchMid(match))"
                type="checkmarkempty"
                :size="14"
                :color="MP_BATCH_CHECK_ICON_COLOR"
              />
            </view>
          </view>
          <div class="flex-1 min-w-0 flex flex-col gap-1">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1 relative z-[1]">
                <h2 class="text-base font-black text-slate-900 truncate">{{ match.course_name || '未命名球场' }}</h2>
                <p class="text-xs text-slate-500 mt-1">{{ formatMatchWhen(match, true) }}</p>
              </div>
              <view
                v-if="!historyBatchMode"
                class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50/90 text-slate-400 relative z-[1] shrink-0 active:opacity-80"
                @tap.stop="confirmDelete(normalizeMatchMid(match))"
                @click.stop="confirmDelete(normalizeMatchMid(match))"
              >
                <uni-icons type="trash" :size="16" color="#94a3b8" />
              </view>
            </div>
            <div class="mt-3 pt-3 border-t border-slate-100/80 flex items-center justify-between relative z-[1]">
              <div class="text-xs text-slate-400">
                状态：{{ match.status === 2 ? '已完赛' : match.status === 1 ? '进行中' : '未开始' }}
              </div>
              <div class="text-right">
                <div class="text-xs text-slate-400">总杆</div>
                <div class="text-xl font-black text-[#07C160]">{{ getMatchTotalStrokes(match) || '--' }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <view
      v-if="historyBatchMode"
      class="fixed left-0 right-0 bottom-0 z-[100] bg-white/98 backdrop-blur-md border-t border-slate-100 flex items-stretch gap-3 px-4 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]"
      :style="{ paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))` }"
    >
      <button
        type="button"
        class="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-800 text-sm font-bold border-0 active:opacity-90"
        @tap="toggleHistorySelectAll"
        @click="toggleHistorySelectAll"
      >
        {{ historyAllSelected ? '取消全选' : '全选' }}
      </button>
      <button
        type="button"
        class="flex-1 py-3.5 rounded-2xl text-white text-sm font-bold border-0 active:opacity-90"
        :class="historySelectedMids.length === 0 ? 'bg-red-300' : 'bg-red-500'"
        :disabled="historySelectedMids.length === 0"
        @tap="confirmBatchDelete"
        @click="confirmBatchDelete"
      >
        删除（{{ historySelectedMids.length }}）
      </button>
    </view>

    <div v-if="showDeleteModal" class="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl">
        <h3 class="text-xl font-black text-slate-900 mb-2">{{ pendingDeleteIsHost ? '删除比赛' : '退赛' }}</h3>
        <p class="text-slate-500 text-sm mb-8">
          {{ pendingDeleteIsHost ? '将删除全场比赛与云端记分，他人无法再打开本场。确定继续？' : '将从本场名单移除你与成绩；比赛仍保留，其他球友可继续。' }}
        </p>
        <div class="flex gap-3">
          <button
            class="flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold border-0 active:scale-95"
            @tap="showDeleteModal = false"
            @click="showDeleteModal = false"
          >
            取消
          </button>
          <button
            class="flex-1 py-4 rounded-full bg-red-500 text-white font-bold border-0 shadow-lg active:scale-95"
            @tap="executeDelete"
            @click="executeDelete"
          >
            {{ pendingDeleteIsHost ? '删除' : '退赛' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showBatchDeleteModal" class="fixed inset-0 bg-slate-900/40 z-[210] flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl">
        <h3 class="text-xl font-black text-slate-900 mb-2">批量删除</h3>
        <p class="text-slate-500 text-sm mb-8">
          已选 {{ historySelectedMids.length }} 场比赛。房主将从云端删除整场比赛及记分；参与者将仅退出并从你的列表移除。确定继续？
        </p>
        <div class="flex gap-3">
          <button
            class="flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold border-0"
            @tap="showBatchDeleteModal = false"
            @click="showBatchDeleteModal = false"
          >
            取消
          </button>
          <button
            class="flex-1 py-4 rounded-full bg-red-500 text-white font-bold border-0 shadow-lg"
            @tap="executeBatchDelete"
            @click="executeBatchDelete"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mh-poster-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  opacity: 0.2;
}

.mh-poster-mask {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(100deg, rgba(248, 250, 252, 0.94) 8%, rgba(248, 250, 252, 0.8) 46%, rgba(236, 253, 245, 0.7) 100%);
}
</style>
