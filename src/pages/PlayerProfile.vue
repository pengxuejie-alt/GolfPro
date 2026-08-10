<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
// lucide removed — use uni-icons for WeChat compatibility
import { MatchManager } from '@/utils/match_manager';
import { Tab } from '@/types';
import { openRoute, goBack } from '@/utils/uniNav';

type GetProfilesResult = {
  success?: boolean;
  profiles?: Array<{ openId?: string; nickName?: string; nickname?: string; avatarUrl?: string }>;
};

const DEFAULT_AVATAR = '/static/tab/me.png';

function playerIdEquals(u: any, pid: string): boolean {
  if (!u || pid == null || String(pid) === '') return false;
  const p = String(pid);
  const keys = [u.id, u.openId, u.openid, u.uid, u.player_uid];
  return keys.some((x) => x != null && String(x) === p);
}

function pickLocalAvatar(u: any): string {
  const a = u?.avatar ?? u?.avatarUrl ?? u?.avatar_url;
  if (a != null && String(a).trim() !== '') return String(a).trim();
  return '';
}

function callGetUserProfiles(openIds: string[]): Promise<GetProfilesResult | null> {
  return new Promise((resolve) => {
    try {
      // #ifdef MP-WEIXIN
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'getUserProfiles',
        data: { openIds },
        success: (r: { result?: unknown }) => resolve((r?.result as GetProfilesResult) ?? null),
        fail: () => resolve(null),
      });
      // #endif
      // #ifndef MP-WEIXIN
      resolve(null);
      // #endif
    } catch {
      resolve(null);
    }
  });
}

const playerId = ref('1');
const fromPage = ref('');
const matchIdRef = ref('');

onLoad((q) => {
  playerId.value = (q.player_id as string) || '1';
  fromPage.value = (q.from as string) || '';
  matchIdRef.value = (q.match_id as string) || '';
});
const player = ref<any>({
  id: '1',
  nickname: '加载中...',
  avatar: DEFAULT_AVATAR,
  handicap: 18,
});
const historyMatches = ref<any[]>([]);

onMounted(async () => {
  const allMatches = await MatchManager.getMatchList();
  const pid = playerId.value;
  
  // Find player
  let foundPlayer = null;
  for (const m of allMatches) {
    const p = m.user_list.find((u: any) => u.id === pid);
    if (p) {
      foundPlayer = p;
      break;
    }
  }
  
  if (foundPlayer) {
    player.value = foundPlayer;
  } else {
    player.value = {
      id: pid,
      nickname: '未知球友',
      avatar: `https://picsum.photos/seed/${pid}/200/200`,
      handicap: 18
    };
  }

  if (pid && !String(pid).startsWith('virtual_') && !String(pid).startsWith('temp_')) {
    const cloud = await callGetUserProfiles([pid]);
    if (cloud?.success && Array.isArray(cloud.profiles) && cloud.profiles[0]) {
      const row = cloud.profiles[0];
      const av = row.avatarUrl != null ? String(row.avatarUrl).trim() : '';
      const nick = row.nickName != null ? String(row.nickName).trim() : '';
      player.value = {
        ...player.value,
        ...(nick ? { nickname: nick } : {}),
        ...(av ? { avatar: av } : {}),
      };
    }
  }

  // Filter history
  historyMatches.value = allMatches.filter(m => {
    const isParticipant = m.user_list.some((u: any) => u.id === pid);
    // Mock privacy: matches with "私密" in title are private
    const isPrivate = m.title && m.title.includes('私密');
    return isParticipant && !isPrivate;
  });
});

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

const viewMatch = (mid: string) => {
  openRoute(Tab.SCORECARD, { match_id: mid });
};

const onHeaderBack = () => {
  if (fromPage.value) {
    openRoute(fromPage.value, { match_id: matchIdRef.value });
  } else {
    goBack();
  }
};
</script>

<template>
  <div class="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col font-sans overflow-y-auto">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <view @click="onHeaderBack" class="p-2 -ml-2 rounded-full">
        <uni-icons type="left" :size="24" color="#94a3b8" />
      </view>
      <h1 class="text-base font-bold tracking-tight">球友档案</h1>
      <div class="w-10"></div>
    </header>

    <!-- Profile Info -->
    <div class="p-6 flex flex-col items-center bg-gradient-to-b from-slate-900 to-slate-950">
      <div class="relative">
        <image :src="player.avatar" mode="aspectFill" class="w-24 h-24 rounded-full border-4 border-slate-800 shadow-2xl mb-4" />
        <div class="absolute bottom-4 right-0 bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full border-2 border-slate-950">
          Lv.{{ Math.floor(player.handicap / 5) + 1 }}
        </div>
      </div>
      <h2 class="text-xl font-black text-white mb-1">{{ player.nickname }}</h2>
      <div class="flex items-center gap-4 mt-2">
        <div class="flex flex-col items-center">
          <span class="text-xs text-slate-500 uppercase tracking-wider">差点</span>
          <span class="text-lg font-black text-blue-400">{{ player.handicap }}</span>
        </div>
        <div class="w-px h-8 bg-slate-800"></div>
        <div class="flex flex-col items-center">
          <span class="text-xs text-slate-500 uppercase tracking-wider">场次</span>
          <span class="text-lg font-black text-white">{{ historyMatches.length }}</span>
        </div>
      </div>
    </div>

    <div class="px-4 py-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-slate-400 flex items-center gap-2">
          <uni-icons type="medal" :size="16" color="#eab308" />
          最近比赛成绩
        </h3>
        <span class="text-xs text-slate-600">仅展示公开比赛</span>
      </div>

      <div v-if="historyMatches.length === 0" class="flex flex-col items-center justify-center py-20 text-slate-600 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800">
        <uni-icons type="locked" :size="48" color="#94a3b8" class="mb-4 opacity-10" />
        <p class="text-sm">暂无公开比赛记录</p>
      </div>

      <div v-else class="space-y-3">
        <div v-for="match in historyMatches.slice(0, 5)" :key="match.match_id" 
             @click="viewMatch(match.match_id)"
             class="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 active:bg-slate-800 transition-all cursor-pointer">
          <div class="flex justify-between items-center">
            <div class="min-w-0 flex-1">
              <h4 class="text-sm font-bold text-white truncate">{{ match.title }}</h4>
              <div class="flex items-center gap-2 text-xs text-slate-500 mt-1">
                <uni-icons type="calendar" :size="12" color="#94a3b8" />
                <span>{{ formatDate(match.create_time) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <div class="text-right">
                <div class="text-lg font-black text-blue-400 leading-none">
                  {{ match.user_list.find(u => playerIdEquals(u, playerId))?.total_score || '--' }}
                </div>
                <div class="text-xs text-slate-600 font-bold uppercase mt-1">Total</div>
              </div>
              <uni-icons type="right" :size="16" color="#334155" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="p-8 text-center text-xs text-slate-700">
      <p>高尔夫球友档案系统 v1.0</p>
      <p class="mt-1">尊重隐私，仅展示公开数据</p>
    </div>
  </div>
</template>
