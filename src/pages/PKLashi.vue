<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// lucide removed — use uni-icons for WeChat compatibility
import { useMatchStore, Player } from '@/store/matchStore';
import { onLoad } from '@dcloudio/uni-app';
import { openRoute, goBackFromPkRulePage } from '@/utils/uniNav';
import { useMpPkRuleHeaderPad } from '@/utils/mpPkRuleHeaderPad';

const { headerPadStyle } = useMpPkRuleHeaderPad();

const matchId = ref('');
const ruleId = ref('');

onLoad((q) => {
  matchId.value = (q.match_id as string) || '';
  ruleId.value = (q.rule_id as string) || '';
});

const matchStore = useMatchStore();

const activeTab = ref('北方3分');
const tabs = ['公鸡母鸡', '北方3分', '南方8421', '贵阳8421'];

const updateDefaults = (tab: string) => {
  if (tab === '北方3分') {
    config.value.scoring_mode = 'points_3';
    config.value.pk_good = true;
    config.value.pk_bad = true;
    config.value.pk_total = true;
    config.value.reward_amount = '鸟2/鹰5/HIO(双鹰)10';
    config.value.deduction_type = 'none';
  } else if (tab === '南方8421') {
    config.value.scoring_mode = '8421';
    config.value.pk_good = true;
    config.value.pk_bad = true;
    config.value.pk_total = false;
    config.value.deduction_type = 'progressive';
    config.value.deduction_par3_plus3 = true;
  } else if (tab === '贵阳8421') {
    config.value.scoring_mode = '8421';
    config.value.pk_good = true;
    config.value.pk_bad = true;
    config.value.pk_total = false;
    config.value.deduction_type = 'single_plus4';
  } else if (tab === '公鸡母鸡') {
    config.value.scoring_mode = 'product';
  }
};

const handleTabClick = (tab: string) => {
  activeTab.value = tab;
  updateDefaults(tab);
};

const config = ref({
  base_unit: 1,
  starting_hole: 1,
  active_holes: Array.from({ length: 18 }, (_, i) => i + 1),
  grouping: '乱拉',
  pro_limit: '不限制',
  scoring_mode: 'points_3', // points_3, 8421, sum, product
  pk_good: true,
  pk_bad: true,
  pk_total: true,
  reward_type: '单项pk时奖励',
  reward_amount: '鸟2/鹰5/HIO(双鹰)10',
  hole_guarantee: '不包洞',
  double_par_plus_1: '不扣分',
  is_landmine: false,
  tie_hole: '下洞不加分',
  collect_tie: '帕收1/鸟收2/鹰全收',
  team_a: [] as string[],
  deduction_type: 'none',
  deduction_par3_plus3: false,
  player_8421: {} as Record<string, string>
});

const scoringModes = [
  { id: 'points_3', name: '1/2/3分' },
  { id: '8421', name: '8421+' },
  { id: 'sum', name: '杆数相加' },
  { id: 'product', name: '杆数相乘' }
];

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
  tie_hole: ['下洞不加分', '顶平过', '下洞加1分', '下洞加2分', '下洞加3分', '加倍（含奖励）', '加倍（不含奖励）', '连续翻倍'],
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

const selectStartingHole = (n: number) => {
  config.value.starting_hole = n;
  showModal.value = null;
};

onMounted(() => {
  if (ruleId.value) {
    const rule = matchStore.activeRules.find(r => r.id === ruleId.value);
    if (rule && rule.config) {
      config.value = { ...config.value, ...rule.config };
      config.value.base_unit = rule.base_score || 1;
      const sh = rule.starting_hole ?? rule.config?.starting_hole;
      if (sh != null && Number.isFinite(Number(sh))) {
        config.value.starting_hole = Math.min(18, Math.max(1, Math.round(Number(sh))));
      }
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
    id: ruleId.value || 'vegas_' + Date.now(),
    type: 'vegas_4',
    category: 'multi',
    name: '4人拉斯',
    base_score: config.value.base_unit,
    starting_hole: config.value.starting_hole ?? 1,
    player_ids: matchStore.user_list.slice(0, 4).map(p => p.id),
    config: { ...config.value, tab: activeTab.value }
  });
  await matchStore.saveMatch();
  openRoute('SCORECARD', { match_id: matchId.value });
};

</script>

<template>
  <div class="fixed inset-0 bg-[#f3f7fb] text-slate-900 flex flex-col font-sans overflow-y-auto pb-24">
    <!-- Header -->
    <header
      class="flex items-center justify-between px-4 pb-2 sticky top-0 bg-white border-b-2 border-[#15803d] shadow-sm z-50"
      :style="headerPadStyle"
    >
      <view @click="goBackFromPkRulePage(matchId)" class="p-2 -ml-2 rounded-full z-10">
        <uni-icons type="left" :size="22" color="#64748b" />
      </view>
      <h1 class="absolute inset-x-0 flex justify-center items-center text-xl font-black tracking-tight pointer-events-none pt-1">4人拉斯</h1>
      <div class="flex z-10 justify-end min-w-[3rem]">
        <button type="button" @click="config.is_landmine = !config.is_landmine"
                class="flex flex-col items-center justify-center w-11 h-11 bg-white border border-slate-200 rounded-xl transition-all"
                :class="config.is_landmine ? 'border-red-500 bg-red-500/10' : 'border-slate-200'">
          <text class="text-sm">💣</text>
          <span class="text-[7px] mt-0.5 font-bold" :class="config.is_landmine ? 'text-red-500' : 'text-slate-400'">地雷</span>
        </button>
      </div>
    </header>

    <!-- Tabs -->
    <div class="flex px-3 gap-3 border-b border-slate-200 mb-2 overflow-x-auto no-scrollbar">
      <button v-for="tab in tabs" :key="tab"
              type="button"
              @click="handleTabClick(tab)"
              class="py-2 px-1 text-xs font-bold whitespace-nowrap transition-all relative"
              :class="activeTab === tab ? 'text-slate-900' : 'text-slate-500'">
        {{ tab }}
        <div v-if="activeTab === tab" class="absolute bottom-0 left-0 right-0 h-0.5 bg-[#15803d]"></div>
      </button>
    </div>

    <div class="px-3 pt-2 space-y-2">
      <!-- Valid Holes + 出发洞 -->
      <div class="rounded-2xl bg-white border border-slate-100 shadow-sm px-2">
        <div @click="showModal = 'starting_hole'" class="flex items-center justify-between py-2.5 border-b border-slate-100 group active:bg-emerald-50/50 px-2 rounded-t-2xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-2 h-2 rounded-full bg-[#15803d]/80" />
            <span class="text-sm font-bold text-slate-700">出发洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.starting_hole }} 号洞</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>
      <div @click="showModal = 'active_holes'" class="flex items-center justify-between py-4 group active:bg-emerald-50/50 px-2 rounded-b-2xl transition-colors cursor-pointer">
        <div class="flex items-center gap-3">
          <div class="w-1.5 h-1.5 rounded-full border border-slate-400"></div>
          <span class="text-sm font-bold text-slate-600">有效洞</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex gap-0.5">
            <div v-for="i in 18" :key="i" 
                 class="w-1.5 h-1.5 rounded-sm"
                 :class="config.active_holes.includes(i) ? 'bg-emerald-600' : 'bg-slate-200'"></div>
          </div>
          <uni-icons type="right" :size="16" color="#475569" />
        </div>
      </div>
    </div>

      <!-- Grouping -->
      <div @click="showModal = 'grouping'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
        <div class="flex items-center gap-3">
          <uni-icons type="staff" :size="16" color="#64748b" />
          <span class="text-sm font-bold text-slate-600">分组</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-slate-900">{{ config.grouping }}</span>
          <uni-icons type="right" :size="16" color="#475569" />
        </div>
      </div>

      <div v-if="config.grouping === '固拉'" class="py-2 border-b border-slate-100 px-2 bg-white rounded-xl border border-slate-100 shadow-sm">
        <span class="text-xs font-bold text-slate-600 mb-2 block">队伍A（2人）</span>
        <div class="flex gap-4">
          <div v-for="player in selectedPlayers" :key="player.id"
               @click="toggleTeamA(player.id)"
               class="relative cursor-pointer flex flex-col items-center gap-2">
            <image :src="player.avatar" mode="aspectFill" class="w-12 h-12 rounded-full border-2 transition-all"
                 :class="config.team_a.includes(player.id) ? 'border-blue-500 scale-110' : 'border-transparent opacity-50'" />
            <span class="text-xs font-bold text-slate-400">{{ player.nickname }}</span>
            <div v-if="config.team_a.includes(player.id)" class="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center border-2 border-black">
              <uni-icons type="checkmarkempty" :size="8" color="#ffffff" />
            </div>
          </div>
        </div>
      </div>

      <!-- Pro Limit -->
      <div v-if="config.grouping !== '固拉'" @click="showModal = 'pro_limit'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
        <div class="flex items-center gap-3">
          <uni-icons type="staff" :size="16" color="#64748b" />
          <span class="text-sm font-bold text-slate-600">高手不见面</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold text-slate-900">{{ config.pro_limit }}</span>
          <uni-icons type="right" :size="16" color="#475569" />
        </div>
      </div>

      <!-- Scoring Card -->
      <div class="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-base font-bold text-slate-500">Σ</span>
            <span class="text-xs font-bold text-slate-600">计分</span>
          </div>
          <div @click="showModal = 'scoring_mode'" class="bg-emerald-50 text-[#15803d] px-2 py-0.5 rounded-lg text-xs font-black border border-emerald-200 cursor-pointer flex items-center gap-1">
            {{ scoringModes.find(m => m.id === config.scoring_mode)?.name }}
            <uni-icons type="right" :size="12" color="#94a3b8" />
          </div>
        </div>

        <!-- 3 Points Mode -->
        <div v-if="config.scoring_mode === 'points_3'" class="flex justify-between items-center">
          <div class="space-y-2 flex-1">
            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_good ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.pk_good" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="checkbox" v-model="config.pk_good" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">较好成绩PK</span>
              <div class="bg-emerald-100 px-2 py-0.5 rounded text-xs font-black text-[#15803d] ml-auto">1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_bad ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.pk_bad" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="checkbox" v-model="config.pk_bad" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">较差成绩PK</span>
              <div class="bg-emerald-100 px-2 py-0.5 rounded text-xs font-black text-[#15803d] ml-auto">1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_total ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.pk_total" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="checkbox" v-model="config.pk_total" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">双方总杆PK</span>
              <div class="bg-emerald-100 px-2 py-0.5 rounded text-xs font-black text-[#15803d] ml-auto">1</div>
            </label>
          </div>

          <div class="w-20 flex flex-col items-center justify-center border-l border-slate-200 ml-4">
            <span class="text-5xl font-black text-slate-200 font-mono">{{ (config.pk_good ? 1 : 0) + (config.pk_bad ? 1 : 0) + (config.pk_total ? 1 : 0) }}</span>
          </div>
        </div>

        <!-- 8421 Mode -->
        <div v-else-if="config.scoring_mode === '8421'" class="space-y-4">
          <div class="space-y-3">
            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.deduction_type === 'progressive' ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.deduction_type === 'progressive'" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="radio" v-model="config.deduction_type" value="progressive" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">一直扣 (+4扣1分+5扣2分...以此类推)</span>
            </label>
            <div v-if="config.deduction_type === 'progressive'" class="pl-8">
              <label class="flex items-center gap-3 cursor-pointer group">
                <div class="w-4 h-4 rounded border border-slate-300 flex items-center justify-center transition-colors"
                     :class="config.deduction_par3_plus3 ? 'bg-white border-slate-800' : 'bg-transparent'">
                  <uni-icons v-if="config.deduction_par3_plus3" type="checkmarkempty" :size="12" color="#0f172a" />
                </div>
                <input type="checkbox" v-model="config.deduction_par3_plus3" class="hidden" />
                <span class="text-xs font-bold text-slate-500 group-active:text-slate-900">3杆洞从+3开始扣分</span>
              </label>
            </div>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.deduction_type === 'single_plus4' ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.deduction_type === 'single_plus4'" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="radio" v-model="config.deduction_type" value="single_plus4" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">最多扣1分 (+4开始扣)</span>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.deduction_type === 'single_double_par' ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.deduction_type === 'single_double_par'" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="radio" v-model="config.deduction_type" value="single_double_par" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">最多扣1分 (双帕开始扣)</span>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.deduction_type === 'none' ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.deduction_type === 'none'" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="radio" v-model="config.deduction_type" value="none" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-slate-900">不扣分</span>
            </label>
          </div>

          <div class="space-y-3 pt-4 border-t border-slate-200">
            <div v-for="player in selectedPlayers" :key="player.id" class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <image :src="player.avatar" mode="aspectFill" class="w-8 h-8 rounded-full border border-slate-200" />
                <span class="text-xs font-bold text-slate-600">{{ player.nickname }}</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="bg-[#15803d] px-2 py-0.5 rounded text-xs font-black text-white">8421</div>
                <input v-model="config.player_8421[player.id]" 
                       class="w-16 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5 text-xs font-black text-[#15803d] text-center"
                       placeholder="8421" />
              </div>
            </div>
          </div>
        </div>

        <!-- Other Modes -->
        <div v-else class="flex flex-col items-center justify-center py-4 text-slate-500">
          <span class="text-sm font-bold">{{ scoringModes.find(m => m.id === config.scoring_mode)?.name }} 已启用</span>
          <span class="text-xs mt-1 opacity-60">按杆数差额计算得分</span>
        </div>
      </div>

      <!-- More Settings -->
      <div class="space-y-0.5">
        <div @click="showModal = 'reward_type'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
          <div class="flex items-center gap-3">
            <uni-icons type="medal" :size="16" color="#64748b" />
            <span class="text-sm font-bold text-slate-600">鸟鹰奖励</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.reward_type }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'reward_amount'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
          <div class="flex items-center gap-3">
            <uni-icons type="medal" :size="16" color="#64748b" />
            <span class="text-sm font-bold text-slate-600">奖励多少</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.reward_amount }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'hole_guarantee'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-full border border-slate-400 flex items-center justify-center text-xs font-bold">!</div>
            <span class="text-sm font-bold text-slate-600">包洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.hole_guarantee }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'double_par_plus_1'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 rounded-full border border-slate-400 flex items-center justify-center text-xs font-bold">!</div>
            <span class="text-sm font-bold text-slate-600">爆洞(双标准杆+1)</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.double_par_plus_1 }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'tie_hole'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full border border-slate-400"></div>
            <span class="text-sm font-bold text-slate-600">顶洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.tie_hole }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'collect_tie'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/40 px-2 rounded-xl transition-colors cursor-pointer bg-white border border-slate-100 shadow-sm">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full border border-slate-400"></div>
            <span class="text-sm font-bold text-slate-600">收顶洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.collect_tie }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>
      </div>
    </div>

    <!-- Option Selection Modal -->
    <div v-if="showModal" class="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showModal = null">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 shadow-2xl border-t border-slate-200">
        <div class="p-4 border-b border-slate-100 flex justify-between items-center">
          <h3 class="text-base font-bold text-slate-900">选择设置</h3>
          <button type="button" @click="showModal = null" class="text-sm font-medium text-slate-600">关闭</button>
        </div>
        <div class="p-3 space-y-1.5 max-h-[55vh] overflow-y-auto">
          <template v-if="showModal === 'active_holes'">
            <div class="grid grid-cols-6 gap-2 p-1">
              <button v-for="i in 18" :key="i" type="button"
                      @click="toggleHole(i)"
                      class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all font-mono"
                      :class="config.active_holes.includes(i) ? 'bg-[#15803d] border-[#15803d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'">
                {{ i }}
              </button>
            </div>
          </template>
          <template v-else-if="showModal === 'starting_hole'">
            <p class="text-xs text-slate-600 px-2 pb-2 leading-relaxed">收顶洞、顶洞等按从出发洞起的环形洞序计算。所选为物理洞号（1–18）。</p>
            <div class="grid grid-cols-6 gap-3 p-2">
              <button v-for="i in 18" :key="'s'+i" type="button"
                      @click="selectStartingHole(i)"
                      class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all font-mono"
                      :class="config.starting_hole === i ? 'bg-[#15803d] border-[#15803d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'">
                {{ i }}
              </button>
            </div>
          </template>
          <template v-else-if="showModal === 'scoring_mode'">
            <button v-for="opt in scoringModes" :key="opt.id" type="button"
                    @click="selectOption('scoring_mode', opt.id)"
                    class="w-full py-3 px-4 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl font-bold flex items-center justify-between transition-colors active:bg-emerald-50">
              <span class="text-sm">{{ opt.name }}</span>
              <uni-icons v-if="config.scoring_mode === opt.id" type="checkmarkempty" :size="20" color="#15803d" />
            </button>
          </template>
          <template v-else>
            <button v-for="opt in (modalOptions as any)[showModal]" :key="opt" type="button"
                    @click="selectOption(showModal!, opt)"
                    class="w-full py-3 px-4 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl font-bold flex items-center justify-between transition-colors active:bg-emerald-50">
              <span class="text-left text-sm leading-snug">{{ opt }}</span>
              <uni-icons v-if="(config as any)[showModal!] === opt" type="checkmarkempty" :size="20" color="#15803d" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="fixed bottom-0 left-0 right-0 p-3 pt-2 bg-white/95 backdrop-blur-md border-t border-slate-200">
      <button type="button" @click="handleSave" class="w-full py-3.5 bg-[#15803d] text-white rounded-full font-bold text-base shadow-md shadow-emerald-900/15 active:scale-[0.98] transition-all">
        确认并返回
      </button>
    </div>
  </div>
</template>
