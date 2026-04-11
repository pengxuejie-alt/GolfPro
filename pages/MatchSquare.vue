<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { ChevronLeft, MapPin, Calendar, Trash2, ChevronRight } from 'lucide-vue-next';
import { Tab } from '../types';
import { MatchManager } from '../utils/match_manager';

const props = defineProps<{
  onNavigate?: (tab: Tab, params?: any) => void;
}>();

const emit = defineEmits(['navigate', 'back']);

const matches = ref<any[]>([]);
const activeSquareTab = ref<'all' | 'friends'>('all');

onMounted(async () => {
  matches.value = await MatchManager.getMatchList();
});

const filteredMatches = computed(() => {
  if (activeSquareTab.value === 'all') return matches.value;
  return matches.value.filter(m => m.user_list.length > 1);
});

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
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Header -->
    <div class="sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 border-b border-slate-100">
      <div class="px-4 py-3 flex items-center justify-between">
        <button @click="emit('back')" class="w-10 h-10 flex items-center justify-center rounded-full active:bg-slate-200 transition-colors">
          <ChevronLeft class="text-slate-800" />
        </button>
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
