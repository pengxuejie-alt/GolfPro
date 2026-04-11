<script setup lang="ts">
import { ref, computed } from 'vue';
import { ChevronLeft, QrCode, Users, Calendar, MapPin, Settings, Lock, Flag, ChevronRight, Check, X } from 'lucide-vue-next';
import { Tab } from '../types';
import { useMatchStore } from '../store/matchStore';
import { MatchManager } from '../utils/match_manager';
import { gdMockCourses } from '../utils/mockData';
import { gdCourseData } from '../data/guangdongCourses';

const props = defineProps<{
  onBack: () => void;
  onNavigate: (tab: Tab, params?: any) => void;
}>();

const emit = defineEmits(['back', 'navigate']);

const matchStore = useMatchStore();

const now = new Date();
const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
};

const matchName = ref('Rocky的球局');
const matchType = ref('REGULAR');
const playerCount = ref(1);
const kickoffTime = ref(formatDate(now));
const isPrivate = ref(false);
const showPKRules = ref(false);
const showDateTimePicker = ref(false);
const showCoursePicker = ref(false);
const showSectionPicker = ref(false);
const searchKey = ref('');
const selectedCourse = ref<any>(null);
const selectedSections = ref<any[]>([]);

// Flatten gdCourseData for easier filtering
const allCourses = computed(() => {
  const courses: any[] = [];
  Object.entries(gdCourseData).forEach(([city, cityCourses]) => {
    cityCourses.forEach(c => {
      courses.push({
        ...c,
        id: c.name,
        city,
        tee_areas: c.sections ? `${c.sections.length / 2}场` : '18洞',
        logo_url: `https://picsum.photos/seed/${c.name}/100/100`,
        holes: c.holes_par ? c.holes_par.map((par: number, i: number) => ({ no: i + 1, par })) : []
      });
    });
  });
  return courses;
});

const filteredCourses = computed(() => {
  if (!searchKey.value) return allCourses.value;
  const key = searchKey.value.toLowerCase();
  return allCourses.value.filter(c => 
    c.name.toLowerCase().includes(key) || c.city.includes(key)
  );
});

const selectCourse = (course: any) => {
  if (course.sections) {
    selectedCourse.value = course;
    selectedSections.value = [];
    showSectionPicker.value = true;
    showCoursePicker.value = false;
  } else {
    selectedCourse.value = course;
    selectedSections.value = [];
    showCoursePicker.value = false;
  }
};

const toggleSection = (section: any) => {
  const idx = selectedSections.value.findIndex(s => s.name === section.name);
  if (idx > -1) {
    selectedSections.value.splice(idx, 1);
  } else {
    if (selectedSections.value.length < 2) {
      selectedSections.value.push(section);
    } else {
      // Replace the second one if already 2
      selectedSections.value[1] = section;
    }
  }
};

const confirmSections = () => {
  if (selectedSections.value.length === 2) {
    const combinedHoles = [
      ...selectedSections.value[0].holes_par.map((par: number, i: number) => ({ no: i + 1, par })),
      ...selectedSections.value[1].holes_par.map((par: number, i: number) => ({ no: i + 10, par }))
    ];
    selectedCourse.value = {
      ...selectedCourse.value,
      name: `${selectedCourse.value.name} (${selectedSections.value[0].name}+${selectedSections.value[1].name})`,
      holes: combinedHoles,
      total_par: selectedSections.value[0].holes_par.reduce((a: number, b: number) => a + b, 0) + 
                 selectedSections.value[1].holes_par.reduce((a: number, b: number) => a + b, 0)
    };
    showSectionPicker.value = false;
  }
};

const tempDate = ref(now.toISOString().split('T')[0]);
const tempTime = ref(now.toTimeString().split(' ')[0].slice(0, 5));

const confirmDateTime = () => {
  kickoffTime.value = `${tempDate.value} ${tempTime.value}`;
  showDateTimePicker.value = false;
};

const defaultPlayers = [
  { id: '1', nickname: 'Rocky', avatar: 'https://picsum.photos/100/100', role: '房主' },
];

const pkRules = [
  { id: 1, name: '拉斯 (Vegas)', desc: '2对2组合分比拼', type: 'lashi' },
  { id: 2, name: '8421', desc: '积分制，平分共享', type: '8421' },
  { id: 3, name: '打老虎 (Tiger)', desc: '1对3挑战模式', type: 'tiger' }
];

// Helper to handle potential object-based translations (prevents [object Object])
const t = (val: any) => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.zh || val.en || JSON.stringify(val);
  return val;
};

const selectPKRule = (id: number) => {
  matchStore.gameType = id;
  showPKRules.value = false;
};

const handleBack = () => {
  emit('back');
};

const handleStart = async () => {
  const newMatch = await MatchManager.createMatch(matchName.value, 1);
  
  // Update match with current selections
  const initialUsers = [];
  // Add the host
  initialUsers.push({
    id: defaultPlayers[0].id,
    nickname: defaultPlayers[0].nickname,
    avatar: defaultPlayers[0].avatar,
    handicap: 12 + Math.floor(Math.random() * 10)
  });

  newMatch.user_list = initialUsers;
  newMatch.is_private = isPrivate.value;

  // Set course data if selected
  if (selectedCourse.value) {
    newMatch.course_name = selectedCourse.value.name;
    newMatch.course_id = selectedCourse.value.id;
    // Map holes to hole_scores for the scorecard
    newMatch.hole_scores = selectedCourse.value.holes.map((h: any) => ({
      scores: [0], // Only host initially
      par: h.par
    }));
    // Also keep holes for general info if needed
    newMatch.holes = selectedCourse.value.holes.map((h: any) => ({
      num: h.no,
      par: h.par
    }));
  }
  
  await MatchManager.updateMatch(newMatch);
  emit('navigate', Tab.SCORECARD, { match_id: newMatch.match_id });
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Header -->
    <div class="sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 px-4 py-3 flex items-center justify-between pr-[90px]">
      <button @click="handleBack" class="w-10 h-10 flex items-center justify-center rounded-full active:bg-slate-200">
        <ChevronLeft class="text-slate-800" />
      </button>
      <h1 class="text-lg font-bold text-slate-900">创建比赛</h1>
    </div>

    <div class="px-4 mt-2">
      <!-- Match Details Form -->
      <div class="bg-white rounded-3xl overflow-hidden shadow-sm mb-6">
        <div class="p-4 border-b border-slate-50 flex items-center justify-between active:bg-slate-50 transition-colors">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center">
              <Flag :size="16" />
            </div>
            <span class="text-sm font-medium text-slate-700">比赛名称</span>
          </div>
          <div class="flex items-center gap-2">
            <input 
              v-model="matchName"
              class="text-sm font-bold text-slate-900 bg-transparent border-none text-right focus:outline-none focus:ring-0 p-0"
              placeholder="请输入比赛名称"
            />
            <ChevronRight :size="16" class="text-slate-300" />
          </div>
        </div>

        <div 
          @click="showDateTimePicker = true"
          class="p-4 border-b border-slate-50 flex items-center justify-between active:bg-slate-50 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-purple-50 text-purple-500 flex items-center justify-center">
              <Calendar :size="16" />
            </div>
            <span class="text-sm font-medium text-slate-700">开球时间</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ kickoffTime }}</span>
            <ChevronRight :size="16" class="text-slate-300" />
          </div>
        </div>

        <div 
          @click="showCoursePicker = true"
          class="p-4 flex items-center justify-between active:bg-slate-50 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-green-50 text-green-500 flex items-center justify-center">
              <MapPin :size="16" />
            </div>
            <span class="text-sm font-medium text-slate-700">选择球场</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900 truncate max-w-[150px]">{{ selectedCourse?.name || '请选择球场' }}</span>
            <ChevronRight :size="16" class="text-slate-300" />
          </div>
        </div>
      </div>

      <!-- Privacy -->
      <div class="bg-white rounded-3xl p-4 shadow-sm flex items-center justify-between mb-8">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
              <Lock :size="16" />
            </div>
            <div>
              <span class="text-sm font-medium text-slate-700 block">私密比赛</span>
              <span class="text-xs text-slate-400 block">开启后仅参赛人可见，广场不展示</span>
            </div>
          </div>
          <button 
            @click="isPrivate = !isPrivate"
            class="w-12 h-7 rounded-full transition-colors relative"
            :class="isPrivate ? 'bg-lime-500' : 'bg-slate-200'"
          >
            <div class="w-5 h-5 bg-white rounded-full shadow-sm absolute top-1 transition-transform" :class="isPrivate ? 'left-6' : 'left-1'"></div>
          </button>
      </div>

      <button 
        @click="handleStart"
        class="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl shadow-lg shadow-slate-900/20 active:scale-95 transition-all"
      >
        立即开球
      </button>
    </div>

    <!-- Course Picker Modal -->
    <div v-if="showCoursePicker" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up h-[80vh] flex flex-col">
        <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6"></div>
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-bold text-slate-900">选择球场</h3>
          <button @click="showCoursePicker = false" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:text-slate-600">
            <X :size="20" />
          </button>
        </div>

        <div class="relative mb-4">
          <input 
            v-model="searchKey"
            class="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-lime-400 font-medium text-slate-900 pl-12"
            placeholder="输入球场名称或城市搜索..."
          />
          <MapPin class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" :size="20" />
        </div>

        <div class="flex-1 overflow-y-auto no-scrollbar space-y-2">
          <div 
            v-for="course in filteredCourses" 
            :key="course.id"
            @click="selectCourse(course)"
            class="flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 active:bg-slate-100 transition-colors"
          >
            <img :src="course.logo_url" class="w-12 h-12 rounded-xl object-cover shadow-sm" />
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-slate-900 truncate">{{ course.name }}</h4>
              <p class="text-xs text-slate-500">{{ course.city }} · {{ course.tee_areas }}场</p>
            </div>
            <ChevronRight :size="16" class="text-slate-300" />
          </div>
          
          <!-- Fallback Option -->
          <div 
            v-if="searchKey && filteredCourses.length === 0"
            @click="selectCourse({
              id: 'custom-indoor',
              name: searchKey + ' (室内练习场)',
              city: '自定义',
              tee_areas: '18洞',
              total_par: 72,
              holes: Array.from({length: 18}, (_, i) => ({ no: i + 1, par: 4 }))
            })"
            class="flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 active:bg-slate-100 transition-colors border border-dashed border-slate-300"
          >
            <div class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
              <MapPin :size="20" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-slate-900 truncate">使用 "{{ searchKey }}" 作为室内练习场</h4>
              <p class="text-xs text-slate-500">默认 18 洞全为 Par 4</p>
            </div>
            <ChevronRight :size="16" class="text-slate-300" />
          </div>
        </div>
      </div>
    </div>

    <!-- DateTime Picker Modal -->
    <div v-if="showDateTimePicker" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up">
        <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6"></div>
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-bold text-slate-900">选择开球时间</h3>
          <button @click="showDateTimePicker = false" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:text-slate-600">
            <X :size="20" />
          </button>
        </div>
        
        <div class="space-y-6">
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">日期</label>
            <input 
              type="date" 
              v-model="tempDate"
              class="w-full p-5 bg-slate-50 rounded-3xl border-2 border-slate-100 focus:border-lime-500 focus:bg-white transition-all font-bold text-slate-900 outline-none"
            />
          </div>
          
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">时间</label>
            <input 
              type="time" 
              v-model="tempTime"
              class="w-full p-5 bg-slate-50 rounded-3xl border-2 border-slate-100 focus:border-lime-500 focus:bg-white transition-all font-bold text-slate-900 outline-none"
            />
          </div>
          
          <button 
            @click="confirmDateTime"
            class="w-full py-5 bg-slate-900 text-white rounded-3xl font-bold shadow-xl shadow-slate-200 active:scale-95 transition-all mt-4"
          >
            确认选择
          </button>
        </div>
      </div>
    </div>

    <!-- Section Picker Modal -->
    <div v-if="showSectionPicker" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up">
        <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6"></div>
        <div class="flex justify-between items-center mb-6">
          <div>
            <h3 class="text-xl font-bold text-slate-900">选择半场</h3>
            <p class="text-xs text-slate-400 mt-1">请选择两个 9 洞半场进行组合</p>
          </div>
          <button @click="showSectionPicker = false" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:text-slate-600">
            <X :size="20" />
          </button>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-8">
          <div 
            v-for="section in selectedCourse?.sections" 
            :key="section.name"
            @click="toggleSection(section)"
            class="p-4 rounded-3xl border-2 transition-all flex flex-col items-center gap-2 cursor-pointer"
            :class="selectedSections.find(s => s.name === section.name) ? 'border-lime-500 bg-lime-50' : 'border-slate-100 bg-slate-50'"
          >
            <span class="font-bold text-slate-900">{{ section.name }}</span>
            <span class="text-xs text-slate-400">9 洞 / Par {{ section.holes_par.reduce((a, b) => a + b, 0) }}</span>
            <div v-if="selectedSections.findIndex(s => s.name === section.name) > -1" class="w-5 h-5 rounded-full bg-lime-500 flex items-center justify-center text-white text-xs font-bold">
              {{ selectedSections.findIndex(s => s.name === section.name) + 1 }}
            </div>
          </div>
        </div>

        <button 
          @click="confirmSections"
          :disabled="selectedSections.length !== 2"
          class="w-full py-5 rounded-3xl font-bold shadow-xl transition-all"
          :class="selectedSections.length === 2 ? 'bg-slate-900 text-white shadow-slate-200 active:scale-95' : 'bg-slate-100 text-slate-400 cursor-not-allowed'"
        >
          确认组合 ({{ selectedSections.length }}/2)
        </button>
      </div>
    </div>

    <!-- PK Rules Modal -->
    <div v-if="showPKRules" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up">
        <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6"></div>
        <h2 class="text-xl font-bold text-slate-900 mb-6 text-center">选择 PK 规则</h2>
        
        <div class="space-y-3">
          <div 
            v-for="rule in pkRules" 
            :key="rule.id"
            @click="selectPKRule(rule.id)"
            class="p-5 rounded-3xl border-2 transition-all flex items-center justify-between cursor-pointer"
            :class="matchStore.gameType === rule.id ? 'border-lime-500 bg-lime-50' : 'border-slate-100 bg-slate-50'"
          >
            <div>
              <h3 class="font-bold text-slate-900">{{ t(rule.name) }}</h3>
              <p class="text-xs text-slate-500 mt-1">{{ t(rule.desc) }}</p>
            </div>
            <div v-if="matchStore.gameType === rule.id" class="w-6 h-6 rounded-full bg-lime-500 flex items-center justify-center text-white">
              <Check :size="14" />
            </div>
          </div>
        </div>

        <button @click="showPKRules = false" class="w-full mt-8 py-4 text-slate-500 font-bold">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}
</style>
