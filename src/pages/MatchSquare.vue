<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
// lucide removed — use uni-icons for WeChat compatibility
import { Tab } from '@/types';
import { MatchManager } from '@/utils/match_manager';
import { useUserStore } from '@/store/userStore';
import { formatMatchKickoffCn } from '@/utils/matchKickoff';
import { mpStaticAbsolute } from '@/utils/mpAssetPath';
import { mpAvatarImgSrcForDisplay } from '@/utils/mpAvatarSrc';
import { hydrateMatchListAvatarsForDisplay } from '@/utils/rosterAvatarDisplay';

const DEFAULT_AVATAR_URL = mpStaticAbsolute('tab/me.png');

const userStore = useUserStore();
const matches = ref<any[]>([]);
const activeSquareTab = ref<'all' | 'friends'>('all');

onMounted(async () => {
  try {
    const list = (await MatchManager.getMatchList()) || [];
    await hydrateMatchListAvatarsForDisplay(list);
    matches.value = list;
  } catch (e) {
    console.warn('[MatchSquare] getMatchList', e);
    matches.value = [];
  }
});

function rosterPlayerAvatarSrc(p: unknown): string {
  if (!p || typeof p !== 'object') return DEFAULT_AVATAR_URL;
  const o = p as Record<string, unknown>;
  return mpAvatarImgSrcForDisplay(o.avatar ?? o.avatarUrl, DEFAULT_AVATAR_URL);
}

const filteredMatches = computed(() => {
  if (activeSquareTab.value === 'all') return matches.value;
  return matches.value.filter((m) => Array.isArray(m.user_list) && m.user_list.length > 1);
});

const handleNavigate = (tab: Tab, params?: Record<string, any>) => {
  openRoute(tab, params);
};

const showDeleteModal = ref(false);
const matchToDelete = ref<string | null>(null);
const pendingSquareDeleteIsHost = ref(false);

const confirmDelete = (matchId: string) => {
  matchToDelete.value = matchId;
  const victim = matches.value.find((m) => String(m?.match_id ?? '') === String(matchId));
  pendingSquareDeleteIsHost.value = victim ? MatchManager.isUserHostOfMatch(victim, userStore.openId) : false;
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
    if (pendingSquareDeleteIsHost.value) {
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
    try {
      const list = (await MatchManager.getMatchList()) || [];
      await hydrateMatchListAvatarsForDisplay(list);
      matches.value = list;
    } catch (e) {
      console.warn('[MatchSquare] getMatchList after delete', e);
    }
    showDeleteModal.value = false;
    matchToDelete.value = null;
    pendingSquareDeleteIsHost.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Header -->
    <div class="sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 border-b border-slate-100">
      <div class="px-4 py-3 flex items-center justify-between">
        <view @click="goBack()" class="w-10 h-10 flex items-center justify-center rounded-full">
          <uni-icons type="left" :size="24" color="#1e293b" />
        </view>
        <h1 class="text-base font-bold text-slate-900">赛事广场</h1>
        <div class="w-10"></div>
      </div>
      
      <!-- Square Tags -->
      <div class="flex gap-4 px-4 border-t border-slate-100">
        <button 
          @click="activeSquareTab = 'all'"
          class="py-3 px-1 text-sm font-bold transition-all relative"
          :class="activeSquareTab === 'all' ? 'text-lime-600' : 'text-slate-400'"
        >
          全部比赛
          <div v-if="activeSquareTab === 'all'" class="absolute bottom-0 left-0 right-0 h-0.5 bg-lime-600"></div>
        </button>
        <button 
          @click="activeSquareTab = 'friends'"
          class="py-3 px-1 text-sm font-bold transition-all relative"
          :class="activeSquareTab === 'friends' ? 'text-lime-600' : 'text-slate-400'"
        >
          好友比赛
          <div v-if="activeSquareTab === 'friends'" class="absolute bottom-0 left-0 right-0 h-0.5 bg-lime-600"></div>
        </button>
      </div>
    </div>

    <div class="p-4 space-y-4">
      <div v-if="filteredMatches.length > 0" class="space-y-4">
        <div 
          v-for="match in filteredMatches"
          :key="match.match_id"
          @click="handleNavigate(Tab.SCORECARD, { match_id: match.match_id })"
          class="bg-white rounded-3xl p-6 shadow-md border border-slate-100 relative overflow-hidden group active:scale-[0.98] transition-all cursor-pointer"
        >
          <div class="absolute right-0 top-0 z-10 flex items-center">
            <div class="bg-lime-400 text-lime-950 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">
              {{ match.status === 2 ? '已结束' : (match.status === 1 ? '进行中' : '未开始') }}
            </div>
            <view @click.stop="confirmDelete(match.match_id)" class="p-2">
              <uni-icons type="trash" :size="16" color="#cbd5e1" />
            </view>
          </div>
          
          <div class="flex gap-5">
            <div class="w-20 h-20 rounded-2xl bg-slate-100 overflow-hidden shrink-0 shadow-inner">
               <image src="https://picsum.photos/200/200" mode="aspectFill" class="w-full h-full" />
            </div>
            <div class="flex-1">
              <h3 class="font-bold text-slate-900 text-lg mb-1 leading-tight">{{ match.title }}</h3>
              <p class="text-xs text-slate-600 flex items-center gap-1.5 mb-2 font-medium">
                <uni-icons type="location" :size="14" color="#94a3b8" /> {{ match.course_name || '未知球场' }}
              </p>
              <p class="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
                <uni-icons type="calendar" :size="14" color="#cbd5e1" /> {{ formatMatchKickoffCn(match) }}
              </p>
            </div>
          </div>

          <div class="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between">
            <div class="flex -space-x-2.5">
              <div
                v-for="(p, i) in (match.user_list || [])"
                :key="String((p && (p.openId ?? p.id ?? p.uid)) ?? i)"
                class="w-9 h-9 rounded-full border-2 border-white overflow-hidden relative shadow-sm"
                :style="{ zIndex: 4 - i }"
              >
                <image :src="rosterPlayerAvatarSrc(p)" mode="aspectFill" class="w-full h-full" />
              </div>
              <div v-if="!(match.user_list && match.user_list.length)" class="w-9 h-9 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-xs text-slate-600 font-bold shadow-sm">
                +0
              </div>
            </div>
            <button class="bg-slate-900 text-white text-sm px-6 py-2.5 rounded-full font-bold shadow-lg shadow-slate-900/10 active:bg-slate-800 transition-colors">
              进入记分
            </button>
          </div>
        </div>
      </div>
      <div v-else class="bg-white rounded-3xl p-10 text-center border border-dashed border-slate-200">
        <p class="text-slate-400 text-sm">暂无比赛</p>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
        <h3 class="text-lg font-bold text-slate-900 mb-2">{{ pendingSquareDeleteIsHost ? '删除比赛' : '退赛' }}</h3>
        <p class="text-slate-500 text-sm mb-6">{{ pendingSquareDeleteIsHost ? '将删除全场比赛与云端记分，他人无法再打开本场。' : '将从本场移除你与成绩；比赛仍保留给其他球友。' }}</p>
        <div class="flex gap-3">
          <button @click="showDeleteModal = false" class="flex-1 py-3 rounded-full bg-slate-100 text-slate-700 font-bold active:bg-slate-200 transition-colors">取消</button>
          <button @click="executeDelete" class="flex-1 py-3 rounded-full bg-red-500 text-white font-bold active:bg-red-600 transition-colors">{{ pendingSquareDeleteIsHost ? '删除' : '退赛' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
