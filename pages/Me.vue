<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { 
  ChevronLeft, Settings, ChevronRight, User, Camera, 
  Calendar, MapPin, Trophy, BarChart3, History, Flag,
  TrendingUp, PieChart, Activity, Users, CreditCard, Share
} from 'lucide-vue-next';
import { MatchManager } from '../utils/match_manager';
import { useUserStore } from '../store/userStore';

const emit = defineEmits(['back', 'navigate']);

const userStore = useUserStore();
const profile = computed(() => userStore.profile);

const showEditProfile = ref(false);
const showShareOptions = ref<string | null>(null);
const statsRange = ref<number>(10); // 10, 20, 30, 999
const matches = ref<any[]>([]);

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

const completedMatches = computed(() => {
  return matches.value.filter(m => {
    const scoredHoles = (m.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0));
    return scoredHoles.length >= 18;
  });
});

const averageHandicap = computed(() => {
  if (completedMatches.value.length === 0) return 0;
  const total = completedMatches.value.reduce((acc, m) => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    return acc + (score - 72); // Simple handicap calculation
  }, 0);
  return (total / completedMatches.value.length).toFixed(1);
});

const last10Handicap = computed(() => {
  const last10 = completedMatches.value.slice(0, 10);
  if (last10.length === 0) return 0;
  const total = last10.reduce((acc, m) => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    return acc + (score - 72);
  }, 0);
  return (total / last10.length).toFixed(1);
});

const playedCourses = computed(() => {
  const courseMap = new Map<string, { name: string; count: number; best: number; city: string; totalScore: number; completedCount: number }>();
  matches.value.forEach(m => {
    const scoredHoles = (m.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0));
    const isCompleted = scoredHoles.length >= 18;
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    
    const existing = courseMap.get(m.course_name);
    if (existing) {
      existing.count++;
      if (isCompleted) {
        existing.best = existing.best === 0 ? score : Math.min(existing.best, score);
        existing.totalScore += score;
        existing.completedCount++;
      }
    } else {
      courseMap.set(m.course_name, {
        name: m.course_name,
        count: 1,
        best: isCompleted ? score : 0,
        totalScore: isCompleted ? score : 0,
        completedCount: isCompleted ? 1 : 0,
        city: '广东省 广州市'
      });
    }
  });
  return Array.from(courseMap.values()).map(c => ({
    ...c,
    avgHandicap: c.completedCount > 0 ? ((c.totalScore / c.completedCount) - 72).toFixed(1) : '-'
  })).sort((a, b) => b.count - a.count);
});

const scoreDistribution = computed(() => {
  const dist = [
    { label: '60+', count: 0, color: 'bg-lime-400' },
    { label: '70+', count: 0, color: 'bg-lime-500' },
    { label: '80+', count: 0, color: 'bg-blue-500' },
    { label: '90+', count: 0, color: 'bg-blue-600' },
    { label: '100+', count: 0, color: 'bg-slate-400' },
    { label: '110+', count: 0, color: 'bg-slate-600' }
  ];

  completedMatches.value.forEach(m => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    if (score < 70) dist[0].count++;
    else if (score < 80) dist[1].count++;
    else if (score < 90) dist[2].count++;
    else if (score < 100) dist[3].count++;
    else if (score < 110) dist[4].count++;
    else dist[5].count++;
  });

  return dist;
});

const recentScores = computed(() => {
  return completedMatches.value
    .slice(0, statsRange.value)
    .map(m => ({
      date: new Date(m.create_time).toLocaleDateString(),
      score: m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0) || 80
    }));
});

onMounted(async () => {
  matches.value = await MatchManager.getMatchList();
});

const currentSubPage = ref<'main' | 'history' | 'stats' | 'courses'>('main');

const handleNavigate = (page: 'main' | 'history' | 'stats' | 'courses') => {
  currentSubPage.value = page;
};

const editProfileData = ref({ ...userStore.profile });

const updateProfile = () => {
  userStore.updateProfile(editProfileData.value);
  showEditProfile.value = false;
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Main Profile Page -->
    <div v-if="currentSubPage === 'main'">
      <!-- Header / Profile Card -->
      <div class="bg-white px-6 pt-12 pb-8 rounded-b-[40px] shadow-sm relative overflow-hidden">
        <div class="absolute top-0 right-0 w-32 h-32 bg-lime-400/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
        
        <div class="flex items-center justify-between mb-8 pr-[90px]">
          <div class="flex items-center gap-4">
            <div class="relative">
              <img :src="profile.avatar" class="w-20 h-20 rounded-3xl object-cover border-4 border-white shadow-lg" />
              <button @click="showEditProfile = true" class="absolute -bottom-1 -right-1 w-7 h-7 bg-slate-900 text-white rounded-full flex items-center justify-center border-2 border-white">
                <Settings :size="14" />
              </button>
            </div>
            <div>
              <h1 class="text-2xl font-black text-slate-900">{{ profile.nickname }}</h1>
              <p class="text-xs text-slate-400 font-medium mt-1 flex items-center gap-1">
                <CreditCard :size="12" /> ID: 50856
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="px-6 mt-8 grid grid-cols-4 gap-2 relative z-10">
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">场次</p>
          <p class="text-lg font-black text-slate-900">{{ matches?.filter(m => (m.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0)).length >= 9).length || 0 }}</p>
        </div>
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">平均差点</p>
          <p class="text-lg font-black text-lime-600">{{ averageHandicap }}</p>
        </div>
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">近10场</p>
          <p class="text-lg font-black text-blue-600">{{ last10Handicap }}</p>
        </div>
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-[10px] font-bold text-slate-400 uppercase mb-1">球场</p>
          <p class="text-lg font-black text-slate-900">{{ playedCourses.length }}</p>
        </div>
      </div>

      <!-- Menu List -->
      <div class="px-6 mt-8 space-y-3">
        <div @click="handleNavigate('history')" class="bg-white p-5 rounded-3xl flex items-center justify-between shadow-sm border border-slate-100 active:scale-[0.98] transition-all cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center">
              <History :size="24" />
            </div>
            <div>
              <p class="font-bold text-slate-900">历史比赛</p>
              <p class="text-xs text-slate-400 font-medium">查看过往记分卡</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-300">{{ matches.length }}</span>
            <ChevronRight class="text-slate-200" :size="20" />
          </div>
        </div>

        <div @click="handleNavigate('stats')" class="bg-white p-5 rounded-3xl flex items-center justify-between shadow-sm border border-slate-100 active:scale-[0.98] transition-all cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-lime-50 text-lime-600 rounded-2xl flex items-center justify-center">
              <TrendingUp :size="24" />
            </div>
            <div>
              <p class="font-bold text-slate-900">最近成绩</p>
              <p class="text-xs text-slate-400 font-medium">分析近期发挥水平</p>
            </div>
          </div>
          <ChevronRight class="text-slate-200" :size="20" />
        </div>

        <div @click="handleNavigate('courses')" class="bg-white p-5 rounded-3xl flex items-center justify-between shadow-sm border border-slate-100 active:scale-[0.98] transition-all cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center">
              <MapPin :size="24" />
            </div>
            <div>
              <p class="font-bold text-slate-900">打过的球场</p>
              <p class="text-xs text-slate-400 font-medium">足迹遍布 {{ playedCourses.length }} 个球场</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-300">{{ playedCourses.length }}</span>
            <ChevronRight class="text-slate-200" :size="20" />
          </div>
        </div>
      </div>
    </div>

    <!-- History Page (Horizontal Poster Style Cards) -->
    <div v-else-if="currentSubPage === 'history'" class="pb-24">
      <div class="sticky top-0 bg-slate-50 z-20 px-6 py-4 flex items-center justify-between border-b border-slate-100">
        <button @click="currentSubPage = 'main'" class="flex items-center gap-1 text-slate-900 font-bold w-20">
          <ChevronLeft :size="20" />
          <span>返回</span>
        </button>
        <h1 class="text-lg font-black text-slate-900 tracking-tight">历史比赛</h1>
        <div class="w-20"></div>
      </div>

      <div class="p-4 space-y-6">
        <div v-for="match in matches" :key="match.match_id" 
             class="relative">
          <!-- New Vertical Scorecard Card -->
          <div class="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 p-5 space-y-4">
            <!-- Header -->
            <div class="flex justify-between items-start">
              <div @click="emit('navigate', 'SCORECARD', { match_id: match.match_id })" class="cursor-pointer flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <h2 class="text-xl font-black text-blue-600 leading-tight">{{ match.course_name }}</h2>
                  <!-- Status Tag -->
                  <span v-if="match.status === 0" class="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded">未开始</span>
                  <span v-else-if="match.status === 1" class="px-2 py-0.5 bg-lime-100 text-lime-600 text-[10px] font-bold rounded">进行中</span>
                  <span v-else-if="match.status === 2 && (match.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0)).length < 18" 
                        class="px-2 py-0.5 bg-orange-100 text-orange-600 text-[10px] font-bold rounded whitespace-nowrap">已结束未打完18洞</span>
                  <span v-else class="px-2 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded">已结束</span>
                </div>
                <p class="text-xs font-bold text-slate-900">中国 广州</p>
                <p class="text-[10px] text-slate-400 mt-1">{{ new Date(match.create_time).toLocaleString() }}</p>
              </div>
              <div class="flex items-center gap-1">
                <button @click.stop="showShareOptions = match.match_id" class="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                  <Share :size="18" />
                </button>
                <button @click.stop="confirmDelete(match.match_id)" class="p-2 text-slate-300 hover:text-red-500 transition-colors">
                  <Trash2 :size="18" />
                </button>
              </div>
            </div>

            <!-- Player Summary -->
            <div class="flex items-center justify-between py-3 border-t border-slate-50">
              <div class="flex items-center gap-3">
                <img :src="profile.avatar" class="w-10 h-10 rounded-full object-cover border border-slate-100 shadow-sm" />
                <span class="text-sm font-black text-slate-800">{{ profile.nickname }}</span>
              </div>
              <div class="flex items-center gap-6">
                <div class="text-center">
                  <p class="text-[10px] font-bold text-slate-400 uppercase mb-0.5">总杆</p>
                  <p class="text-base font-black text-slate-900">{{ (match.hole_scores || []).reduce((acc, h) => acc + (h.scores?.[0] || 0), 0) || '-' }}</p>
                </div>
                <div class="text-center">
                  <p class="text-[10px] font-bold text-slate-400 uppercase mb-0.5">+/-</p>
                  <p class="text-base font-black text-slate-900">{{ ((match.hole_scores || []).reduce((acc, h) => acc + (h.scores?.[0] || 0), 0) || 72) - 72 > 0 ? '+' : '' }}{{ ((match.hole_scores || []).reduce((acc, h) => acc + (h.scores?.[0] || 0), 0) || 72) - 72 }}</p>
                </div>
                <div class="text-center">
                  <p class="text-[10px] font-bold text-slate-400 uppercase mb-0.5">洞数</p>
                  <p class="text-base font-black text-slate-900">18</p>
                </div>
              </div>
            </div>

            <!-- Scorecard Grid -->
            <div class="space-y-2">
              <!-- Front 9 -->
              <div class="overflow-hidden rounded-xl border border-slate-100">
                <table class="w-full text-center border-collapse table-fixed">
                  <tbody>
                    <tr class="bg-slate-900 text-white text-[9px] font-black">
                      <th class="p-1 border-r border-white/10 w-8">Hole</th>
                      <th v-for="i in 9" :key="i" class="p-1 border-r border-white/10">{{ i }}</th>
                      <th class="p-1 w-8">OUT</th>
                    </tr>
                    <tr class="text-[9px] font-bold text-slate-400 bg-slate-50/50">
                      <td class="p-1 border-r border-slate-100">Par</td>
                      <td v-for="i in 9" :key="i" class="p-1 border-r border-slate-100">4</td>
                      <td class="p-1 font-black text-slate-600">36</td>
                    </tr>
                    <tr class="text-[10px] font-black text-slate-900">
                      <td class="p-1 border-r border-slate-100">Score</td>
                      <td v-for="i in 9" :key="i" class="p-1 border-r border-slate-100">
                        <div class="w-5 h-5 flex items-center justify-center mx-auto rounded-full font-black text-[10px]" 
                             :class="match.hole_scores?.[i-1]?.scores?.[0] > 4 ? 'bg-slate-100 text-slate-900' : (match.hole_scores?.[i-1]?.scores?.[0] < 4 && match.hole_scores?.[i-1]?.scores?.[0] > 0 ? 'bg-red-500 text-white' : (match.hole_scores?.[i-1]?.scores?.[0] === 0 ? 'text-slate-200' : ''))">
                          {{ match.hole_scores?.[i-1]?.scores?.[0] || '-' }}
                        </div>
                      </td>
                      <td class="p-1 text-blue-600">{{ (match.hole_scores || []).slice(0, 9).reduce((acc, h) => acc + (h.scores?.[0] || 0), 0) || '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Back 9 -->
              <div class="overflow-hidden rounded-xl border border-slate-100">
                <table class="w-full text-center border-collapse table-fixed">
                  <tbody>
                    <tr class="bg-slate-900 text-white text-[9px] font-black">
                      <th class="p-1 border-r border-white/10 w-8">Hole</th>
                      <th v-for="i in [10,11,12,13,14,15,16,17,18]" :key="i" class="p-1 border-r border-white/10">{{ i }}</th>
                      <th class="p-1 w-8">IN</th>
                    </tr>
                    <tr class="text-[9px] font-bold text-slate-400 bg-slate-50/50">
                      <td class="p-1 border-r border-slate-100">Par</td>
                      <td v-for="i in 9" :key="i" class="p-1 border-r border-slate-100">4</td>
                      <td class="p-1 font-black text-slate-600">36</td>
                    </tr>
                    <tr class="text-[10px] font-black text-slate-900">
                      <td class="p-1 border-r border-slate-100">Score</td>
                      <td v-for="i in [10,11,12,13,14,15,16,17,18]" :key="i" class="p-1 border-r border-slate-100">
                        <div class="w-5 h-5 flex items-center justify-center mx-auto rounded-full font-black text-[10px]" 
                             :class="match.hole_scores?.[i-1]?.scores?.[0] > 4 ? 'bg-slate-100 text-slate-900' : (match.hole_scores?.[i-1]?.scores?.[0] < 4 && match.hole_scores?.[i-1]?.scores?.[0] > 0 ? 'bg-red-500 text-white' : (match.hole_scores?.[i-1]?.scores?.[0] === 0 ? 'text-slate-200' : ''))">
                          {{ match.hole_scores?.[i-1]?.scores?.[0] || '-' }}
                        </div>
                      </td>
                      <td class="p-1 text-blue-600">{{ (match.hole_scores || []).slice(9, 18).reduce((acc, h) => acc + (h.scores?.[0] || 0), 0) || '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          <!-- Share Options Overlay -->
          <div v-if="showShareOptions === match.match_id" 
               class="absolute inset-0 z-20 bg-slate-900/95 backdrop-blur-xl rounded-[2.5rem] flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
            <div class="w-20 h-20 bg-lime-400 rounded-[2rem] flex items-center justify-center text-slate-900 mb-8 shadow-2xl shadow-lime-400/20">
              <Share :size="32" />
            </div>
            <h4 class="text-white font-black mb-12 tracking-[0.3em] uppercase text-sm">分享海报</h4>
            <div class="grid grid-cols-2 gap-8 w-full max-w-[240px]">
              <button @click="showShareOptions = null" class="flex flex-col items-center gap-4 group">
                <div class="w-20 h-20 bg-white/5 rounded-[2rem] flex items-center justify-center text-white group-active:scale-90 transition-all border border-white/10 hover:bg-white/10">
                  <Users :size="32" />
                </div>
                <span class="text-xs font-bold text-white/60">朋友圈</span>
              </button>
              <button @click="showShareOptions = null" class="flex flex-col items-center gap-4 group">
                <div class="w-20 h-20 bg-white/5 rounded-[2rem] flex items-center justify-center text-white group-active:scale-90 transition-all border border-white/10 hover:bg-white/10">
                  <Camera :size="32" />
                </div>
                <span class="text-xs font-bold text-white/60">保存相册</span>
              </button>
            </div>
            <button @click="showShareOptions = null" class="mt-16 text-white/30 text-[10px] font-black uppercase tracking-[0.4em] border-b border-white/10 pb-1">取消分享</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Page -->
    <div v-else-if="currentSubPage === 'stats'" class="pb-24">
      <div class="sticky top-0 bg-white/90 backdrop-blur-xl z-20 px-6 py-4 flex items-center justify-between border-b border-slate-100">
        <button @click="currentSubPage = 'main'" class="flex items-center gap-1 text-slate-900 font-bold">
          <ChevronLeft :size="20" />
          <span>返回</span>
        </button>
        <h1 class="text-lg font-black text-slate-900 tracking-tight">成绩分析</h1>
        <div class="w-10"></div>
      </div>

      <div class="p-6 space-y-8">
        <!-- Range Selector -->
        <div class="flex bg-slate-100 p-1 rounded-2xl">
          <button v-for="r in [10, 20, 30, 'all']" :key="r"
                  @click="statsRange = r === 'all' ? 999 : r"
                  class="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                  :class="(statsRange === r || (r === 'all' && statsRange === 999)) ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'">
            {{ r === 'all' ? '全部' : r + '场' }}
          </button>
        </div>

        <!-- Score Chart -->
        <div class="bg-white rounded-[40px] p-8 shadow-sm border border-slate-100">
          <div class="flex items-center justify-between mb-10">
            <div>
              <h3 class="font-black text-slate-900 text-lg">总杆波动</h3>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">成绩趋势</p>
            </div>
            <div class="w-12 h-12 bg-lime-50 rounded-2xl flex items-center justify-center text-lime-600">
              <TrendingUp :size="24" />
            </div>
          </div>
          
          <div class="overflow-x-auto pb-6 -mx-2 scrollbar-hide">
            <div class="relative min-w-max px-8 h-56">
              <!-- SVG Line Chart -->
              <svg class="absolute inset-0 w-full h-full px-8 pointer-events-none" preserveAspectRatio="none">
                <path 
                  :d="recentScores.length > 1 ? `M ${recentScores.map((s, i) => `${i * 80 + 40},${180 - ((s.score - 60) / 60) * 140}`).join(' L ')}` : ''"
                  fill="none" 
                  stroke="url(#lineGradient)" 
                  stroke-width="3" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"
                  class="drop-shadow-[0_4px_8px_rgba(59,130,246,0.3)]"
                />
                <defs>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#a3e635;stop-opacity:1" />
                  </linearGradient>
                </defs>
              </svg>

              <div class="flex items-end h-full">
                <div v-for="(s, i) in recentScores" :key="i" class="flex flex-col items-center group relative z-10" style="width: 80px;">
                  <div class="relative flex flex-col items-center" :style="{ height: `${((s.score - 60) / 60) * 140 + 20}px` }">
                    <div class="absolute -top-10 bg-slate-900 text-white text-[10px] font-black px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20">
                      {{ s.score }} 杆
                    </div>
                    <!-- Dot -->
                    <div class="w-4 h-4 rounded-full border-4 border-white shadow-md transition-all group-hover:scale-125 group-hover:bg-lime-400"
                         :class="i === recentScores.length - 1 ? 'bg-lime-400' : 'bg-blue-500'">
                    </div>
                  </div>
                  <div class="flex flex-col items-center mt-4">
                    <span class="text-[10px] font-black text-slate-900">{{ s.score }}</span>
                    <span class="text-[8px] font-bold text-slate-300 uppercase mt-1">{{ s.date.split('/')[1] }}/{{ s.date.split('/')[2] }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Distribution -->
        <div class="bg-white rounded-[40px] p-8 shadow-sm border border-slate-100">
          <div class="flex items-center justify-between mb-10">
            <div>
              <h3 class="font-black text-slate-900 text-lg">杆数分布</h3>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">成绩分布</p>
            </div>
            <div class="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
              <PieChart :size="24" />
            </div>
          </div>

          <div class="space-y-6">
            <div v-for="item in scoreDistribution" :key="item.label" class="space-y-2">
              <div class="flex justify-between items-end">
                <span class="text-xs font-black text-slate-900">{{ item.label }}</span>
                <span class="text-[10px] font-black text-slate-400">{{ item.count }} 场</span>
              </div>
              <div class="h-3 bg-slate-50 rounded-full overflow-hidden">
                <div :class="['h-full rounded-full transition-all duration-1000', item.color]" 
                     :style="{ width: `${completedMatches.length > 0 ? (item.count / completedMatches.length) * 100 : 0}%` }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Courses Page -->
    <div v-else-if="currentSubPage === 'courses'" class="animate-in fade-in slide-in-from-right duration-300">
      <div class="sticky top-0 bg-white/80 backdrop-blur-md z-20 px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <button @click="currentSubPage = 'main'" class="w-10 h-10 flex items-center justify-center rounded-full active:bg-slate-100">
          <ChevronLeft class="text-slate-800" />
        </button>
        <h1 class="text-lg font-bold text-slate-900">打过的球场</h1>
        <div class="w-10"></div>
      </div>

      <div class="p-6 space-y-4">
        <div v-for="course in playedCourses" :key="course.name" 
             class="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex flex-col items-center justify-center shrink-0 border border-slate-200">
            <span class="text-xl font-black text-slate-900">{{ course.count }}</span>
            <span class="text-[10px] font-bold text-slate-400 uppercase">场次</span>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-bold text-slate-900 truncate text-sm">{{ course.name }}</h3>
            <p class="text-xs text-slate-400 mt-0.5">{{ course.city }}</p>
            <div class="flex items-center gap-3 mt-2">
              <span class="text-xs font-bold text-lime-600 bg-lime-50 px-2 py-0.5 rounded-full">最佳: {{ course.best || '-' }}</span>
              <span class="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">平均差点: {{ course.avgHandicap }}</span>
            </div>
          </div>
          <ChevronRight class="text-slate-200" :size="16" />
        </div>
      </div>
    </div>

    <!-- Edit Profile Modal -->
    <div v-if="showEditProfile" class="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="showEditProfile = false"></div>
      <div class="relative w-full max-w-sm bg-white rounded-[40px] p-8 shadow-2xl animate-in zoom-in duration-200">
        <h3 class="text-xl font-black text-center mb-8">编辑个人资料</h3>
        
        <div class="space-y-6">
          <div class="flex flex-col items-center mb-4">
            <div class="relative group">
              <img :src="profile.avatar" class="w-24 h-24 rounded-[32px] object-cover shadow-xl" />
              <div class="absolute inset-0 bg-black/20 rounded-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera class="text-white" />
              </div>
            </div>
            <p class="text-[10px] font-bold text-slate-400 mt-3 uppercase tracking-widest">点击更换头像</p>
          </div>

          <div class="space-y-2">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">昵称</label>
            <input v-model="editProfileData.nickname" type="text" class="w-full p-4 bg-slate-50 rounded-2xl border-2 border-transparent focus:border-lime-500 focus:bg-white outline-none font-bold transition-all" />
          </div>

          <div class="space-y-2">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">性别</label>
            <div class="flex bg-slate-50 p-1 rounded-2xl">
              <button @click="editProfileData.gender = 'male'" 
                      class="flex-1 py-3 rounded-xl text-xs font-bold transition-all"
                      :class="editProfileData.gender === 'male' ? 'bg-white text-blue-500 shadow-sm' : 'text-slate-400'">男</button>
              <button @click="editProfileData.gender = 'female'" 
                      class="flex-1 py-3 rounded-xl text-xs font-bold transition-all"
                      :class="editProfileData.gender === 'female' ? 'bg-white text-pink-500 shadow-sm' : 'text-slate-400'">女</button>
            </div>
          </div>
        </div>

        <div class="flex gap-3 mt-10">
          <button @click="showEditProfile = false" class="flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold active:scale-95 transition-all">取消</button>
          <button @click="updateProfile" class="flex-1 py-4 rounded-full bg-slate-900 text-white font-bold shadow-xl shadow-slate-200 active:scale-95 transition-all">保存</button>
        </div>
      </div>
    </div>
    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl">
        <h3 class="text-xl font-black text-slate-900 mb-2">删除比赛</h3>
        <p class="text-slate-500 text-sm mb-8">确定要删除这场比赛吗？此操作不可恢复。</p>
        <div class="flex gap-3">
          <button @click="showDeleteModal = false" class="flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold active:scale-95 transition-all">取消</button>
          <button @click="executeDelete" class="flex-1 py-4 rounded-full bg-red-500 text-white font-bold shadow-xl shadow-red-200 active:scale-95 transition-all">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>
