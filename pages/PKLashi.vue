<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { ChevronLeft, Bomb, Info, Check, ChevronRight, Minus, Plus, Trophy, Users, Settings } from 'lucide-vue-next';
import { useMatchStore, Player } from '../store/matchStore';

const props = defineProps<{
  params?: { match_id: string, rule_id?: string };
}>();

const emit = defineEmits(['back', 'navigate']);
const matchStore = useMatchStore();

const activeTab = ref('北方3分');
const tabs = ['公鸡母鸡', '北方3分', '南方8421', '贵阳8421'];

const updateDefaults = (tab: string) => {
  if (tab === '北方3分') {
    config.value.pk_good = true;
    config.value.pk_bad = true;
    config.value.pk_total = true;
    config.value.reward_amount = '鸟2/鹰5/HIO(双鹰)10';
    config.value.deduction_type = 'none';
  } else if (tab === '南方8421') {
    config.value.pk_good = true;
    config.value.pk_bad = true;
    config.value.pk_total = false;
    config.value.deduction_type = 'progressive';
    config.value.deduction_par3_plus3 = true;
  } else if (tab === '贵阳8421') {
    config.value.pk_good = true;
    config.value.pk_bad = true;
    config.value.pk_total = false;
    config.value.deduction_type = 'single_plus4';
  }
};

const handleTabClick = (tab: string) => {
  activeTab.value = tab;
  updateDefaults(tab);
};

const config = ref({
  base_unit: 1,
  active_holes: Array.from({ length: 18 }, (_, i) => i + 1),
  grouping: '固拉',
  pro_limit: '不限制',
  pk_good: true,
  pk_bad: true,
  pk_total: true,
  reward_type: '单项pk时奖励',
  reward_amount: '鸟2/鹰5/HIO(双鹰)10',
  hole_guarantee: '不包洞',
  double_par_plus_1: '不扣分',
  is_landmine: false,
  tie_hole: '下洞加1分',
  collect_tie: '赢洞全收',
  team_a: [] as string[],
  deduction_type: 'none',
  deduction_par3_plus3: false
});

const showModal = ref<string | null>(null);
const modalOptions = {
  grouping: ['固拉', '乱拉', '每洞随机分组'],
  pro_limit: ['不限制', '高手不见面', '高手带新手'],
  reward_type: ['单项pk时奖励', '总项pk时奖励'],
  reward_amount: [
    '鸟2/鹰5/HIO(双鹰)10',
    '鸟2/鹰10/HIO(双鹰)20',
    '鸟2/鹰4/HIO(双鹰)28',
    '鸟2/鹰16/HIO(双鹰)32'
  ],
  hole_guarantee: ['不包洞', 'double par包洞', 'double par+1包洞'],
  double_par_plus_1: ['不扣分', '扣1分', '扣2分'],
  tie_hole: ['顶平过', '下洞加1分', '下洞加2分', '下洞加3分', '加倍（含奖励）', '加倍（不含奖励）', '连续翻倍'],
  collect_tie: [
    '赢洞全收',
    '帕收1/鸟收2/鹰全收',
    '帕收1/鸟收2/鹰收4',
    '赢收1/鸟收2/鹰全收',
    '不管赢多少只收1洞'
  ],
  deduction_type: ['none', 'progressive', 'single_plus4', 'single_double_par']
};

const deductionNames: Record<string, string> = {
  'none': '不扣分',
  'progressive': '累进扣分',
  'single_plus4': '+4扣1分',
  'single_double_par': 'Double Par扣1分'
};

const selectOption = (key: string, val: string) => {
  (config.value as any)[key] = val;
  showModal.value = null;
};

onMounted(() => {
  if (props.params?.rule_id) {
    const rule = matchStore.activeRules.find(r => r.id === props.params?.rule_id);
    if (rule && rule.config) {
      config.value = { ...config.value, ...rule.config };
      config.value.base_unit = rule.base_score || 1;
      if (rule.config.tab) {
        activeTab.value = rule.config.tab;
      }
    }
  }
});

const allPlayers = computed(() => matchStore.user_list);
const selectedPlayers = computed(() => {
  return allPlayers.value.slice(0, 4);
});

const toggleTeamA = (playerId: string) => {
  const idx = config.value.team_a.indexOf(playerId);
  if (idx > -1) {
    config.value.team_a.splice(idx, 1);
  } else {
    if (config.value.team_a.length < 2) {
      config.value.team_a.push(playerId);
    } else {
      config.value.team_a.shift();
      config.value.team_a.push(playerId);
    }
  }
};

const toggleHole = (hole: number) => {
  const idx = config.value.active_holes.indexOf(hole);
  if (idx > -1) {
    config.value.active_holes.splice(idx, 1);
  } else {
    config.value.active_holes.push(hole);
    config.value.active_holes.sort((a, b) => a - b);
  }
};

const handleSave = async () => {
  if (config.value.grouping === '固拉' && config.value.team_a.length !== 2) {
    alert('请为队伍A选择2名球员');
    return;
  }
  matchStore.addRule({
    id: props.params?.rule_id || 'vegas_' + Date.now(),
    type: 'vegas_4',
    category: 'multi',
    name: '4人拉斯',
    base_score: config.value.base_unit,
    player_ids: matchStore.user_list.slice(0, 4).map(p => p.id),
    config: { ...config.value, tab: activeTab.value }
  });
  await matchStore.saveMatch();
  emit('navigate', 'SCORECARD', { match_id: props.params?.match_id });
};

</script>

<template>
  <div class="fixed inset-0 bg-black text-white flex flex-col font-sans overflow-y-auto pb-32">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-4 sticky top-0 bg-black z-50">
      <button @click="emit('navigate', 'SCORECARD', { match_id: props.params?.match_id })" class="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors">
        <ChevronLeft class="w-6 h-6" />
      </button>
      <h1 class="text-2xl font-black tracking-tight">4人拉斯</h1>
      <div class="flex gap-3">
        <button @click="config.is_landmine = !config.is_landmine" 
                class="flex flex-col items-center justify-center w-14 h-14 bg-[#1a1a1a] rounded-2xl border transition-all"
                :class="config.is_landmine ? 'border-red-500 bg-red-500/10' : 'border-white/5'">
          <Bomb class="w-6 h-6" :class="config.is_landmine ? 'text-red-500' : 'text-slate-500'" />
          <span class="text-[8px] mt-1 font-bold" :class="config.is_landmine ? 'text-red-400' : 'text-slate-400'">埋地雷</span>
        </button>
        <div class="flex flex-col items-center justify-center w-14 h-14 bg-[#1a1a1a] rounded-2xl border border-white/5 relative">
          <span class="text-xl font-black text-white">{{ config.base_unit }}</span>
          <span class="text-[8px] mt-0.5 text-slate-400 font-bold">基本单位</span>
          <div class="absolute -bottom-2 flex gap-1">
            <button @click="config.base_unit = Math.max(1, config.base_unit - 1)" class="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700"><Minus class="w-2 h-2" /></button>
            <button @click="config.base_unit++" class="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700"><Plus class="w-2 h-2" /></button>
          </div>
        </div>
      </div>
    </header>

    <!-- Tabs -->
    <div class="flex px-4 gap-4 border-b border-white/5 mb-4 overflow-x-auto no-scrollbar">
      <button v-for="tab in tabs" :key="tab"
              @click="handleTabClick(tab)"
              class="py-3 px-1 text-xs font-bold whitespace-nowrap transition-all relative"
              :class="activeTab === tab ? 'text-white' : 'text-slate-500'">
        {{ tab }}
        <div v-if="activeTab === tab" class="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600"></div>
      </button>
    </div>

    <div class="px-4 space-y-1">
      <!-- Valid Holes -->
      <div @click="showModal = 'active_holes'" class="flex items-center justify-between py-4 border-b border-white/5 group active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
        <div class="flex items-center gap-3">
          <div class="w-1.5 h-1.5 rounded-full border border-white/40"></div>
          <span class="text-sm font-bold text-slate-300">有效洞</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex gap-0.5">
            <div v-for="i in 18" :key="i" 
                 class="w-1.5 h-1.5 rounded-sm"
                 :class="config.active_holes.includes(i) ? 'bg-orange-500' : 'bg-slate-800'"></div>
          </div>
          <ChevronRight class="w-4 h-4 text-slate-600" />
        </div>
      </div>

      <!-- Grouping -->
      <div @click="showModal = 'grouping'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
        <div class="flex items-center gap-3">
          <Users class="w-4 h-4 text-slate-500" />
          <span class="text-sm font-bold text-slate-300">分组</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-slate-100">{{ config.grouping }}</span>
          <ChevronRight class="w-4 h-4 text-slate-600" />
        </div>
      </div>

      <div v-if="config.grouping === '固拉'" class="py-4 border-b border-white/5 px-2">
        <span class="text-sm font-bold text-slate-300 mb-3 block">选择队伍A的2名球员</span>
        <div class="flex gap-4">
          <div v-for="player in selectedPlayers" :key="player.id"
               @click="toggleTeamA(player.id)"
               class="relative cursor-pointer flex flex-col items-center gap-2">
            <img :src="player.avatar" class="w-12 h-12 rounded-full border-2 transition-all"
                 :class="config.team_a.includes(player.id) ? 'border-blue-500 scale-110' : 'border-transparent opacity-50'" />
            <span class="text-[10px] font-bold text-slate-400">{{ player.name }}</span>
            <div v-if="config.team_a.includes(player.id)" class="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center border-2 border-black">
              <Check class="w-2 h-2 text-white" />
            </div>
          </div>
        </div>
      </div>

      <!-- Pro Limit -->
      <div @click="showModal = 'pro_limit'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
        <div class="flex items-center gap-3">
          <Users class="w-4 h-4 text-slate-500" />
          <span class="text-sm font-bold text-slate-300">高手不见面</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-slate-100">{{ config.pro_limit }}</span>
          <ChevronRight class="w-4 h-4 text-slate-600" />
        </div>
      </div>

      <!-- Scoring Card -->
      <div v-if="!activeTab.includes('8421')" class="my-6 bg-[#111] rounded-[32px] p-6 border border-white/5">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-300">计分 <span class="text-orange-500 ml-2">点这里设8421</span></span>
          </div>
          <div class="bg-indigo-900/50 text-indigo-400 px-3 py-1 rounded-lg text-[10px] font-black border border-indigo-500/20">
            1/2/3分
          </div>
        </div>

        <div class="flex justify-between items-center">
          <div class="space-y-3 flex-1">
            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-white/20 flex items-center justify-center transition-colors"
                   :class="config.pk_good ? 'bg-white border-white' : 'bg-transparent'">
                <Check v-if="config.pk_good" class="w-3.5 h-3.5 text-black font-black" />
              </div>
              <input type="checkbox" v-model="config.pk_good" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-white">较好成绩PK</span>
              <div class="bg-red-900/40 px-3 py-0.5 rounded text-[10px] font-black text-red-500 ml-auto">1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-white/20 flex items-center justify-center transition-colors"
                   :class="config.pk_bad ? 'bg-white border-white' : 'bg-transparent'">
                <Check v-if="config.pk_bad" class="w-3.5 h-3.5 text-black font-black" />
              </div>
              <input type="checkbox" v-model="config.pk_bad" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-white">较差成绩PK</span>
              <div class="bg-red-900/40 px-3 py-0.5 rounded text-[10px] font-black text-red-500 ml-auto">1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-white/20 flex items-center justify-center transition-colors"
                   :class="config.pk_total ? 'bg-white border-white' : 'bg-transparent'">
                <Check v-if="config.pk_total" class="w-3.5 h-3.5 text-black font-black" />
              </div>
              <input type="checkbox" v-model="config.pk_total" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-white">双方总杆PK</span>
              <div class="bg-red-900/40 px-3 py-0.5 rounded text-[10px] font-black text-red-500 ml-auto">1</div>
            </label>
          </div>

          <div class="w-24 flex flex-col items-center justify-center border-l border-white/5 ml-6">
            <span class="text-7xl font-black text-white/20">{{ (config.pk_good ? 1 : 0) + (config.pk_bad ? 1 : 0) + (config.pk_total ? 1 : 0) }}</span>
          </div>
        </div>
      </div>

      <!-- 8421 Deductions -->
      <div v-if="activeTab.includes('8421')" class="my-6 bg-[#111] rounded-[32px] p-6 border border-white/5 space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-300">8421 扣分设置</span>
          </div>
        </div>

        <div @click="showModal = 'deduction_type'" class="flex items-center justify-between py-2 cursor-pointer">
          <span class="text-xs font-bold text-slate-400">扣分类型</span>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-white">{{ deductionNames[config.deduction_type] }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div v-if="config.deduction_type === 'progressive'" class="flex items-center justify-between py-2">
          <span class="text-xs font-bold text-slate-400">三杆洞+3起扣</span>
          <div @click="config.deduction_par3_plus3 = !config.deduction_par3_plus3" 
               class="w-10 h-5 rounded-full relative transition-colors"
               :class="config.deduction_par3_plus3 ? 'bg-orange-500' : 'bg-slate-800'">
            <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform"
                 :class="config.deduction_par3_plus3 ? 'translate-x-5' : ''"></div>
          </div>
        </div>
      </div>

      <!-- More Settings -->
      <div class="space-y-0.5">
        <div @click="showModal = 'reward_type'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <Trophy class="w-4 h-4 text-slate-500" />
            <span class="text-sm font-bold text-slate-300">鸟鹰奖励</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.reward_type }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div @click="showModal = 'reward_amount'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <Trophy class="w-4 h-4 text-slate-500" />
            <span class="text-sm font-bold text-slate-300">奖励多少</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.reward_amount }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div @click="showModal = 'hole_guarantee'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-full border border-white/40 flex items-center justify-center text-[8px] font-bold">!</div>
            <span class="text-sm font-bold text-slate-300">包洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.hole_guarantee }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div @click="showModal = 'double_par_plus_1'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-full border border-white/40 flex items-center justify-center text-[8px] font-bold">!</div>
            <span class="text-sm font-bold text-slate-300">爆洞(双标准杆+1)</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.double_par_plus_1 }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div @click="showModal = 'tie_hole'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full border border-white/40"></div>
            <span class="text-sm font-bold text-slate-300">顶洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.tie_hole }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div @click="showModal = 'collect_tie'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full border border-white/40"></div>
            <span class="text-sm font-bold text-slate-300">收顶洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.collect_tie }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>
      </div>
    </div>

    <!-- Option Selection Modal -->
    <div v-if="showModal" class="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showModal = null">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-6 border-b border-slate-800 flex justify-between items-center">
          <h3 class="text-lg font-bold text-white">选择设置</h3>
          <button @click="showModal = null" class="text-slate-400">关闭</button>
        </div>
        <div class="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          <template v-if="showModal === 'active_holes'">
            <div class="grid grid-cols-6 gap-3 p-2">
              <button v-for="i in 18" :key="i" 
                      @click="toggleHole(i)"
                      class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all"
                      :class="config.active_holes.includes(i) ? 'bg-orange-500 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'">
                {{ i }}
              </button>
            </div>
          </template>
          <template v-else-if="showModal === 'deduction_type'">
            <button v-for="opt in modalOptions.deduction_type" :key="opt"
                    @click="selectOption('deduction_type', opt)"
                    class="w-full py-4 px-6 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold flex items-center justify-between transition-colors">
              <span>{{ deductionNames[opt] }}</span>
              <Check v-if="config.deduction_type === opt" class="w-5 h-5 text-orange-500" />
            </button>
          </template>
          <template v-else>
            <button v-for="opt in (modalOptions as any)[showModal]" :key="opt"
                    @click="selectOption(showModal!, opt)"
                    class="w-full py-4 px-6 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold flex items-center justify-between transition-colors">
              <span>{{ opt }}</span>
              <Check v-if="(config as any)[showModal!] === opt" class="w-5 h-5 text-orange-500" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="fixed bottom-0 left-0 right-0 p-6 bg-black/80 backdrop-blur-md flex gap-4">
      <button class="flex-1 py-5 bg-[#1a1a1a] text-white rounded-full font-bold text-lg border border-white/5 active:scale-95 transition-all">
        常用设置
      </button>
      <button @click="handleSave" class="flex-[2] py-5 bg-red-700 text-white rounded-full font-black text-lg shadow-2xl shadow-red-900/40 active:scale-95 transition-all">
        确认并返回
      </button>
    </div>
  </div>
</template>
