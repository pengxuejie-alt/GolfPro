<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ChevronLeft, Calendar, MapPin, Trophy, Lock, ChevronRight } from 'lucide-vue-next';
import { MatchManager } from '../utils/match_manager';
import { Tab } from '../types';

const props = defineProps<{
  params?: { 
    player_id: string;
    from?: string;
    match_id?: string;
  };
}>();

const emit = defineEmits(['back', 'navigate']);

const playerId = computed(() => props.params?.player_id || '1');
const player = ref<any>({
  id: playerId.value,
  nickname: '加载中...',
  avatar: `https://picsum.photos/seed/${playerId.value}/200/200`,
  handicap: 18
});
const historyMatches = ref<any[]>([]);

onMounted(async () => {
  const allMatches = await MatchManager.getMatchList();
  
  // Find player
  let foundPlayer = null;
  for (const m of allMatches) {
    const p = m.user_list.find((u: any) => u.id === playerId.value);
    if (p) {
      foundPlayer = p;
      break;
    }
  }
  
  if (foundPlayer) {
    player.value = foundPlayer;
  } else {
    player.value = {
      id: playerId.value,
      nickname: '未知球友',
      avatar: `https://picsum.photos/seed/${playerId.value}/200/200`,
      handicap: 18
    };
  }

  // Filter history
  historyMatches.value = allMatches.filter(m => {
    const isParticipant = m.user_list.some((u: any) => u.id === playerId.value);
    // Mock privacy: matches with "私密" in title are private
    const isPrivate = m.title && m.title.includes('私密');
    return isParticipant && !isPrivate;
  });
});

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
};

const viewMatch = (matchId: string) => {
  emit('navigate', Tab.SCORECARD, { match_id: matchId });
};
</script>

<template>
  <div class="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col font-sans overflow-y-auto">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <button @click="props.params?.from ? emit('navigate', props.params.from, { match_id: props.params.match_id }) : emit('back')" class="p-2 -ml-2 hover:bg-slate-800 rounded-full transition-colors">
        <ChevronLeft class="w-6 h-6" />
      </button>
      <h1 class="text-base font-bold tracking-tight">球友档案</h1>
      <div class="w-10"></div>
    </header>

    <!-- Profile Info -->
    <div class="p-6 flex flex-col items-center bg-gradient-to-b from-slate-900 to-slate-950">
      <div class="relative">
        <img :src="player.avatar" class="w-24 h-24 rounded-full border-4 border-slate-800 shadow-2xl mb-4 object-cover" />
        <div class="absolute bottom-4 right-0 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full border-2 border-slate-950">
          Lv.{{ Math.floor(player.handicap / 5) + 1 }}
        </div>
      </div>
      <h2 class="text-xl font-black text-white mb-1">{{ player.nickname }}</h2>
      <div class="flex items-center gap-4 mt-2">
        <div class="flex flex-col items-center">
          <span class="text-[10px] text-slate-500 uppercase tracking-wider">差点</span>
          <span class="text-lg font-black text-blue-400">{{ player.handicap }}</span>
        </div>
        <div class="w-px h-8 bg-slate-800"></div>
        <div class="flex flex-col items-center">
          <span class="text-[10px] text-slate-500 uppercase tracking-wider">场次</span>
          <span class="text-lg font-black text-white">{{ historyMatches.length }}</span>
        </div>
      </div>
    </div>

    <div class="px-4 py-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-bold text-slate-400 flex items-center gap-2">
          <Trophy class="w-4 h-4 text-yellow-500" />
          最近比赛成绩
        </h3>
        <span class="text-[10px] text-slate-600">仅展示公开比赛</span>
      </div>

      <div v-if="historyMatches.length === 0" class="flex flex-col items-center justify-center py-20 text-slate-600 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800">
        <Lock class="w-12 h-12 mb-4 opacity-10" />
        <p class="text-sm">暂无公开比赛记录</p>
      </div>

      <div v-else class="space-y-3">
        <div v-for="match in historyMatches.slice(0, 5)" :key="match.match_id" 
             @click="viewMatch(match.match_id)"
             class="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 active:bg-slate-800 transition-all cursor-pointer">
          <div class="flex justify-between items-center">
            <div class="min-w-0 flex-1">
              <h4 class="text-sm font-bold text-white truncate">{{ match.title }}</h4>
              <div class="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                <Calendar class="w-3 h-3" />
                <span>{{ formatDate(match.create_time) }}</span>
              </div>
            </div>
            <div class="flex items-center gap-3 ml-4">
              <div class="text-right">
                <div class="text-lg font-black text-blue-400 leading-none">
                  {{ match.user_list.find(u => u.id === playerId)?.total_score || '--' }}
                </div>
                <div class="text-[8px] text-slate-600 font-bold uppercase mt-1">Total</div>
              </div>
              <ChevronRight class="w-4 h-4 text-slate-700" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="p-8 text-center text-[10px] text-slate-700">
      <p>高尔夫球友档案系统 v1.0</p>
      <p class="mt-1">尊重隐私，仅展示公开数据</p>
    </div>
  </div>
</template>
