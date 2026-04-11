<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { ChevronLeft, Search, Trash2, EyeOff, ArrowUpDown, User } from 'lucide-vue-next';
import { MatchManager } from '../utils/match_manager';

const emit = defineEmits(['back']);

interface Friend {
  id: string;
  nickname: string;
  avatar: string;
  handicap: number;
  matchCount: number;
  isHidden: boolean;
}

const friends = ref<Friend[]>([]);
const searchQuery = ref('');
const sortBy = ref<'count' | 'handicap' | 'name'>('count');

const currentTab = ref<'friends'>('friends');

onMounted(async () => {
  await loadFriends();
});

const loadFriends = async () => {
  const matches = await MatchManager.getMatchList();
  const friendMap = new Map<string, Friend>();

  matches.forEach(match => {
    match.user_list.forEach((player: any) => {
      // Skip host (id '1') and virtual players (id starts with 'temp' or 'pending')
      if (player.id === '1' || player.id.startsWith('temp') || player.id.startsWith('pending') || player.isPending || player.id.startsWith('virtual')) {
        return;
      }

      if (friendMap.has(player.id)) {
        const friend = friendMap.get(player.id)!;
        friend.matchCount += 1;
      } else {
        friendMap.set(player.id, {
          id: player.id,
          nickname: player.nickname,
          avatar: player.avatar,
          handicap: player.handicap || 18,
          matchCount: 1,
          isHidden: false
        });
      }
    });
  });

  friends.value = Array.from(friendMap.values());
};

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
      return a.handicap - b.handicap;
    } else {
      return a.nickname.localeCompare(b.nickname, 'zh-CN');
    }
  });
});

const viewProfile = (friendId: string) => {
  emit('navigate', 'PLAYER_PROFILE', { player_id: friendId, from: 'PLAYERS' });
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Header -->
    <div class="sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 border-b border-slate-100">
      <div class="px-4 py-3 flex items-center justify-between">
        <button @click="emit('back')" class="w-10 h-10 flex items-center justify-center rounded-full active:bg-slate-200 transition-colors">
          <ChevronLeft class="text-slate-800" />
        </button>
        <h1 class="text-base font-bold text-slate-900">球友</h1>
        <div class="w-10"></div> <!-- Spacer -->
      </div>
    </div>

    <div class="px-4 mt-4">
      <!-- Friends Tab Content -->
      <div>
        <!-- Search -->
        <div class="relative mb-6">
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" :size="18" />
          <input 
            v-model="searchQuery"
            type="text"
            placeholder="搜索球友..."
            class="w-full pl-12 pr-4 py-3 bg-white rounded-2xl border-none shadow-sm focus:ring-2 focus:ring-lime-500 text-sm font-medium"
          />
        </div>

        <!-- Sorting Info -->
        <div class="flex items-center justify-between mb-4 px-1">
          <div class="flex gap-4">
            <button @click="sortBy = 'count'" 
                    class="text-xs font-bold uppercase tracking-wider transition-colors"
                    :class="sortBy === 'count' ? 'text-lime-600' : 'text-slate-400'">同组次数</button>
            <button @click="sortBy = 'name'" 
                    class="text-xs font-bold uppercase tracking-wider transition-colors"
                    :class="sortBy === 'name' ? 'text-lime-600' : 'text-slate-400'">昵称</button>
            <button @click="sortBy = 'handicap'" 
                    class="text-xs font-bold uppercase tracking-wider transition-colors"
                    :class="sortBy === 'handicap' ? 'text-lime-600' : 'text-slate-400'">差点</button>
          </div>
          <span class="text-xs text-slate-400">{{ filteredFriends.length }} 位球友</span>
        </div>

        <!-- Friend List -->
        <div v-if="filteredFriends.length > 0" class="space-y-3">
          <div 
            v-for="friend in filteredFriends" 
            :key="friend.id"
            @click="viewProfile(friend.id)"
            class="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4 group active:bg-slate-50 transition-colors cursor-pointer"
          >
            <div class="w-12 h-12 rounded-full bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
              <img v-if="friend.avatar" :src="friend.avatar" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-slate-400">
                <User :size="24" />
              </div>
            </div>
            
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-slate-900 truncate">{{ friend.nickname }}</h3>
              </div>
              <div class="flex items-center gap-3 mt-1">
                <span class="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">同组: {{ friend.matchCount }}次</span>
                <span class="text-xs font-bold text-lime-600 bg-lime-50 px-2 py-0.5 rounded-full">差点: {{ friend.handicap }}</span>
              </div>
            </div>

            <ChevronRight class="w-4 h-4 text-slate-300 group-active:text-slate-500" />
          </div>
        </div>
        
        <div v-else class="py-20 text-center">
          <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <User class="text-slate-300" :size="32" />
          </div>
          <p class="text-slate-400 text-sm">{{ searchQuery ? '未找到匹配球友' : '暂无球友记录' }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
