<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { MatchManager } from '@/utils/match_manager';
import { useUserStore } from '@/store/userStore';
import { openRoute } from '@/utils/uniNav';
import { matchListSortTimeMs } from '@/utils/matchKickoff';
import { mpStaticAbsolute } from '@/utils/mpAssetPath';
import { mpAvatarImgSrcForDisplay } from '@/utils/mpAvatarSrc';
import { buildRosterAvatarDisplayMap, hydrateMatchListAvatarsForDisplay } from '@/utils/rosterAvatarDisplay';

const DEFAULT_AVATAR_URL = mpStaticAbsolute('tab/me.png');
const userStore = useUserStore();

interface Friend {
  id: string;
  nickname: string;
  avatar: string;
  handicap: number | null;
  matchCount: number;
  lastMatchTime: number;
  isHidden: boolean;
}

const friends = ref<Friend[]>([]);
const friendAvatarDisplayMap = ref<Record<string, string>>({});
const searchQuery = ref('');
const sortBy = ref<'count' | 'handicap' | 'name'>('count');

const currentTab = ref<'friends'>('friends');

onMounted(async () => {
  await loadFriends();
});

const loadFriends = async () => {
  const rawMatches = await MatchManager.getMatchList();
  await hydrateMatchListAvatarsForDisplay(rawMatches);
  const friendMap = new Map<string, Friend>();

  rawMatches.forEach(match => {
    const matchTs = matchListSortTimeMs(match) || Date.now();
    match.user_list.forEach((player: any) => {
      const selfId = userStore.openId || '';
      if (player.id === selfId || player.id.startsWith('temp') || player.id.startsWith('pending') || player.isPending || player.id.startsWith('virtual') || player.id.startsWith('host_')) {
        return;
      }

      if (friendMap.has(player.id)) {
        const friend = friendMap.get(player.id)!;
        friend.matchCount += 1;
        friend.lastMatchTime = Math.max(friend.lastMatchTime, matchTs);
      } else {
        friendMap.set(player.id, {
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          handicap: player.handicap ?? null,
          matchCount: 1,
          lastMatchTime: matchTs,
          isHidden: false
        });
      }
    });
  });

  friends.value = Array.from(friendMap.values());
  friendAvatarDisplayMap.value = await buildRosterAvatarDisplayMap(
    friends.value.map((f) => ({ id: f.id, avatar: f.avatar })),
  );
};

function friendAvatarSrc(friend: Friend): string {
  const cached = friendAvatarDisplayMap.value[friend.id];
  return mpAvatarImgSrcForDisplay(cached || friend.avatar, DEFAULT_AVATAR_URL);
}

const filteredFriends = computed(() => {
  let list = friends.value;
  
  // Filter by search
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(f => f.nickname.toLowerCase().includes(q));
  }

  // Sort
  return [...list].sort((a, b) => {
    if (sortBy.value === 'count') {
      return b.matchCount - a.matchCount;
    } else if (sortBy.value === 'handicap') {
      return (a.handicap ?? 999) - (b.handicap ?? 999);
    } else {
      return a.nickname.localeCompare(b.nickname, 'zh-CN');
    }
  });
});

const viewProfile = (friendId: string) => {
  openRoute('PLAYER_PROFILE', { player_id: friendId, from: 'PLAYERS' });
};

const formatRecentMatch = (ts: number) => {
  if (!ts || Number.isNaN(ts)) return '最近约球：暂无记录';
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `最近约球：${y}年${mo}月${day}日`;
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Header -->
    <div class="sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 border-b border-slate-100">
      <div class="players-page-pad py-3 flex items-center justify-center">
        <h1 class="text-base font-bold text-slate-900">球友</h1>
      </div>
    </div>

    <div class="players-page-pad pt-4">
      <!-- Friends Tab Content -->
      <div>
        <!-- Search -->
        <div class="sticky top-[92rpx] z-10 pb-3 mb-4 bg-slate-50">
          <div class="relative">
          <uni-icons type="search" :size="18" color="#94a3b8" class="absolute left-4 top-1/2 -translate-y-1/2 z-[2]" />
          <input 
            v-model="searchQuery"
            type="text"
            placeholder="搜索球友..."
            class="mp-safe-input-full players-input w-full pl-12 pr-4 bg-white border border-slate-200 focus:ring-2 focus:ring-[#07C160] text-sm font-medium"
          />
          </div>
        </div>

        <!-- Sorting Info -->
        <div class="flex items-center justify-between mb-4 px-1 pt-1">
          <div class="flex gap-4">
            <button @click="sortBy = 'count'" 
                    class="text-xs font-bold uppercase tracking-wider transition-colors"
                    :class="sortBy === 'count' ? 'text-[#07C160]' : 'text-slate-400'">同组次数</button>
            <button @click="sortBy = 'name'" 
                    class="text-xs font-bold uppercase tracking-wider transition-colors"
                    :class="sortBy === 'name' ? 'text-[#07C160]' : 'text-slate-400'">昵称</button>
            <button @click="sortBy = 'handicap'" 
                    class="text-xs font-bold uppercase tracking-wider transition-colors"
                    :class="sortBy === 'handicap' ? 'text-[#07C160]' : 'text-slate-400'">差点</button>
          </div>
          <span class="text-xs text-slate-400">{{ filteredFriends.length }} 位球友</span>
        </div>

        <!-- Friend List -->
        <div v-if="filteredFriends.length > 0" class="space-y-3">
          <div 
            v-for="friend in filteredFriends" 
            :key="friend.id"
            @click="viewProfile(friend.id)"
            class="players-card bg-white p-4 border border-slate-100 flex items-center gap-4 group active:bg-slate-50 transition-colors cursor-pointer"
          >
            <div class="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
              <image :src="friendAvatarSrc(friend)" mode="aspectFill" class="w-full h-full" />
            </div>
            
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-slate-900 truncate">{{ friend.nickname }}</h3>
              </div>
              <div class="flex items-center gap-3 mt-1">
                <span class="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">同组: {{ friend.matchCount }}次</span>
                <span v-if="friend.handicap != null" class="text-xs font-bold text-[#07C160] bg-emerald-50 px-2 py-0.5 rounded-full">差点: {{ friend.handicap }}</span>
              </div>
              <div class="text-xs text-slate-400 mt-1">{{ formatRecentMatch(friend.lastMatchTime) }}</div>
            </div>

            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </div>
        </div>
        
        <div v-else class="py-20 text-center">
          <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <uni-icons type="personadd" :size="32" color="#cbd5e1" />
          </div>
          <p class="text-slate-400 text-sm">{{ searchQuery ? '未找到匹配球友' : '暂无球友记录' }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.players-page-pad {
  padding-left: 30rpx;
  padding-right: 30rpx;
}

.players-card,
.players-input {
  border-radius: 16rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.05);
}
</style>
