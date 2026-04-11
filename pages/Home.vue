<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { MapPin, Calendar, ChevronRight, Wind, Sun, Flag, Trophy, Trash2 } from 'lucide-vue-next';
import { Match, Tab } from '../types';
import { MatchManager } from '../utils/match_manager';
import { useUserStore } from '../store/userStore';

const props = defineProps<{
  onNavigate?: (tab: Tab, params?: any) => void;
}>();

const emit = defineEmits(['navigate']);

const userStore = useUserStore();
const matches = ref<any[]>([]);

onMounted(async () => {
  matches.value = await MatchManager.getMatchList();
});

const todayMatches = computed(() => {
  return matches.value.filter(m => m.status === 1 || m.status === 0);
});

const historyMatches = computed(() => {
  return matches.value.filter(m => m.status === 2);
});

const averageHandicap = computed(() => {
  const completed = matches.value.filter(m => {
    const scoredHoles = (m.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0));
    return scoredHoles.length >= 18;
  });
  if (completed.length === 0) return '未知';
  const total = completed.reduce((acc, m) => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    return acc + (score - 72);
  }, 0);
  return (total / completed.length).toFixed(1);
});

// Helper to handle potential object-based translations (prevents [object Object])
const t = (val: any) => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.zh || val.en || JSON.stringify(val);
  return val;
};

// Global translation object as requested
const T = {
  greeting: { zh: '早安', en: 'Good Morning' },
  hcp: { zh: '差点', en: 'HCP' },
  weather: { zh: '多云 · 适宜击球', en: 'Cloudy · Good for Golf' },
  wind: { zh: '风力 0-3级', en: 'Wind 0-3' },
  uv: { zh: '紫外线: 弱', en: 'UV: Low' },
  createMatch: { zh: '创建比赛', en: 'Create Match' },
  startNewRound: { zh: '开始新的一轮', en: 'Start new round' },
  matchSquare: { zh: '赛事广场', en: 'Match Square' },
  viewNearby: { zh: '查看附近赛事', en: 'View nearby' },
  todayMatch: { zh: '今日比赛', en: 'Today\'s Match' },
  historyMatch: { zh: '历史比赛', en: 'History' },
  viewAll: { zh: '全部', en: 'All' },
  live: { zh: '正在进行', en: 'LIVE' },
  finished: { zh: '已结束', en: 'FINISHED' },
  enterScore: { zh: '进入记分', en: 'Enter Score' },
  viewResult: { zh: '查看成绩', en: 'View Result' }
};

const handleNavigate = (tab: Tab, params?: any) => {
  emit('navigate', tab, params);
};

const showDeleteModal = ref(false);
const matchToDelete = ref<string | null>(null);

const confirmDelete = (matchId: string) => {
  matchToDelete.value = matchId;
  showDeleteModal.value = true;
};

const executeDelete = async () => {
  if (matchToDelete.value) {
    await MatchManager.deleteMatch(matchToDelete.value);
    matches.value = await MatchManager.getMatchList();
    showDeleteModal.value = false;
    matchToDelete.value = null;
  }
};
</script>

<template>
  <div class="min-h-screen pb-24 px-4 pt-4 bg-slate-50 safe-top">
    <!-- Header -->
    <header class="flex flex-col mb-6 pt-2">
      <div class="flex justify-between items-center mb-4 pr-[90px]">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-full border-2 border-green-500 p-0.5">
            <img 
              :src="userStore.profile.avatar" 
              :alt="userStore.profile.nickname" 
              class="w-full h-full rounded-full object-cover" 
            />
          </div>
          <div>
            <h1 class="text-lg font-bold text-slate-900">{{ t(T.greeting) }}, {{ userStore.profile.nickname }}! 👋</h1>
            <p class="text-xs text-slate-500 font-medium">{{ t(T.hcp) }}: <span class="font-mono font-bold">{{ averageHandicap }}</span></p>
          </div>
        </div>
      </div>
    </header>

    <!-- Weather Widget -->
    <div class="mb-6">
      <div class="bg-white rounded-[32px] p-5 border-2 border-slate-100 shadow-sm flex justify-between items-center">
        <div class="flex flex-col">
          <div class="flex items-center gap-2 text-slate-500 text-sm font-medium mb-1.5">
            <MapPin :size="16" class="text-slate-400" /> 广州·天河区
          </div>
          <div class="flex items-baseline gap-2 mb-0.5">
            <div class="text-3xl font-bold text-slate-900 font-mono">26°C</div>
            <div class="text-base text-slate-400 font-medium font-mono">/ 20°C</div>
          </div>
          <div class="text-sm text-slate-800 font-bold">晴 · 优</div>
        </div>
        
        <div class="flex flex-col items-end">
          <div class="w-16 h-16 rounded-2xl bg-orange-50 flex items-center justify-center mb-2">
            <Sun class="text-orange-500" :size="32" />
          </div>
          <div class="flex flex-col gap-1 text-xs text-slate-500 items-end font-bold">
            <div class="flex items-center gap-1.5">
              <Wind :size="14" /> {{ t(T.wind) }}
            </div>
            <div class="flex items-center gap-1.5">
              <Sun :size="14" /> {{ t(T.uv) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="grid grid-cols-2 gap-3 mb-5">
      <div 
        @click="handleNavigate(Tab.CREATE)"
        class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 active:scale-95 transition-transform cursor-pointer flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-lime-100 text-lime-600 flex items-center justify-center shrink-0">
          <Flag :size="20" fill="currentColor" />
        </div>
        <div class="min-w-0">
          <h3 class="font-bold text-slate-800 text-sm truncate">{{ T.createMatch.zh || T.createMatch }}</h3>
          <p class="text-[10px] text-slate-400 truncate">{{ T.startNewRound.zh || T.startNewRound }}</p>
        </div>
      </div>
      <div 
        @click="handleNavigate(Tab.MATCH_SQUARE)"
        class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 active:scale-95 transition-transform cursor-pointer flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
          <Trophy :size="20" />
        </div>
        <div class="min-w-0">
          <h3 class="font-bold text-slate-800 text-sm truncate">{{ T.matchSquare.zh || T.matchSquare }}</h3>
          <p class="text-[10px] text-slate-400 truncate">{{ T.viewNearby.zh || T.viewNearby }}</p>
        </div>
      </div>
    </div>

    <!-- Today's Match Section -->
    <div class="mb-4 flex items-center justify-between px-1">
      <h2 class="text-lg font-bold text-slate-800">{{ T.todayMatch.zh || T.todayMatch }} ({{ todayMatches.length }})</h2>
      <span @click="handleNavigate(Tab.MATCH_SQUARE)" class="text-xs text-slate-400 flex items-center cursor-pointer active:opacity-70">{{ T.viewAll.zh || T.viewAll }} <ChevronRight :size="12" /></span>
    </div>

    <div v-if="todayMatches.length > 0" class="space-y-4 mb-8">
      <div 
        v-for="match in todayMatches"
        :key="match.match_id"
        @click="handleNavigate(Tab.SCORECARD, { match_id: match.match_id })"
        class="bg-white rounded-3xl p-6 shadow-md border border-slate-100 relative overflow-hidden group active:scale-[0.98] transition-all cursor-pointer"
      >
        <div class="absolute right-0 top-0 z-10 flex items-center">
          <div class="bg-lime-400 text-lime-950 text-xs font-black px-3 py-1.5 rounded-bl-xl shadow-sm">
            {{ match.status === 2 ? '已结束' : (match.status === 1 ? '进行中' : '未开始') }}
          </div>
          <button @click.stop="confirmDelete(match.match_id)" class="p-2 text-slate-300 hover:text-red-500 transition-colors">
            <Trash2 :size="16" />
          </button>
        </div>
        
        <div class="flex gap-5">
          <div class="w-20 h-20 rounded-2xl bg-slate-100 overflow-hidden shrink-0 shadow-inner">
             <img src="https://picsum.photos/200/200" class="w-full h-full object-cover" alt="Course" />
          </div>
          <div class="flex-1">
            <h3 class="font-bold text-slate-900 text-lg mb-1 leading-tight">{{ match.title }}</h3>
            <p class="text-xs text-slate-600 flex items-center gap-1.5 mb-2 font-medium">
              <MapPin :size="14" class="text-slate-400" /> {{ match.course_name || '未知球场' }}
            </p>
            <p class="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <Calendar :size="14" class="text-slate-300" /> {{ new Date(match.create_time).toLocaleString() }}
            </p>
          </div>
        </div>

        <div class="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between">
          <div class="flex -space-x-2.5">
            <div v-for="(p, i) in match.user_list" :key="p.openId" class="w-9 h-9 rounded-full border-2 border-white overflow-hidden relative shadow-sm" :style="{ zIndex: 4 - i }">
              <img :src="p.avatar || 'https://picsum.photos/100/100'" :alt="p.name" class="w-full h-full object-cover" />
            </div>
            <div v-if="match.user_list.length === 0" class="w-9 h-9 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[11px] text-slate-600 font-bold shadow-sm">
              +0
            </div>
          </div>
          <button class="bg-slate-900 text-white text-sm px-6 py-2.5 rounded-full font-bold shadow-lg shadow-slate-900/10 active:bg-slate-800 transition-colors">
            {{ T.enterScore.zh || T.enterScore }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="bg-white rounded-3xl p-10 text-center border border-dashed border-slate-200 mb-8">
      <p class="text-slate-400 text-sm">今日暂无比赛</p>
    </div>

    <!-- History Section -->
    <div class="mb-4 flex items-center justify-between px-1">
      <h2 class="text-lg font-bold text-slate-800">{{ T.historyMatch.zh || T.historyMatch }} ({{ historyMatches.length }})</h2>
      <span @click="handleNavigate(Tab.MATCH_SQUARE)" class="text-xs text-slate-400 flex items-center cursor-pointer active:opacity-70">{{ T.viewAll.zh || T.viewAll }} <ChevronRight :size="12" /></span>
    </div>

    <div v-if="historyMatches.length > 0" class="space-y-4">
      <div 
        v-for="match in historyMatches"
        :key="match.match_id"
        @click="handleNavigate(Tab.SCORECARD, { match_id: match.match_id })"
        class="bg-white rounded-3xl p-4 shadow-sm border border-slate-100 flex items-center gap-4 active:bg-slate-50 transition-colors cursor-pointer"
      >
        <div class="w-14 h-14 rounded-2xl bg-slate-100 overflow-hidden shrink-0">
           <img src="https://picsum.photos/150/150" class="w-full h-full object-cover" alt="Course" />
        </div>
        <div class="flex-1">
          <h3 class="font-bold text-slate-800 text-sm">{{ match.title }}</h3>
          <p class="text-xs text-slate-400 mt-1">{{ new Date(match.create_time).toLocaleDateString() }}</p>
        </div>
        <div class="text-right flex flex-col items-end gap-2">
          <div class="flex items-center gap-2">
            <div class="text-xs font-bold text-slate-900">已结束</div>
            <button @click.stop="confirmDelete(match.match_id)" class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-red-500 transition-colors">
              <Trash2 :size="14" />
            </button>
          </div>
          <ChevronRight :size="16" class="text-slate-300" />
        </div>
      </div>
    </div>
    <div v-else class="bg-white rounded-3xl p-6 text-center border border-dashed border-slate-200">
      <p class="text-slate-400 text-sm">暂无历史记录</p>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
        <h3 class="text-lg font-bold text-slate-900 mb-2">删除比赛</h3>
        <p class="text-slate-500 text-sm mb-6">确定要删除这场比赛吗？此操作不可恢复。</p>
        <div class="flex gap-3">
          <button @click="showDeleteModal = false" class="flex-1 py-3 rounded-full bg-slate-100 text-slate-700 font-bold active:bg-slate-200 transition-colors">取消</button>
          <button @click="executeDelete" class="flex-1 py-3 rounded-full bg-red-500 text-white font-bold active:bg-red-600 transition-colors">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>
