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

const config = ref({
  base_unit: 1,
  starting_hole: 1,
  active_holes: Array.from({ length: 18 }, (_, i) => i + 1),
  category: '固定老虎',
  compare_type: '比洞',
  tiger_id: '',
  participant_ids: [] as string[],
  pk_good: true,
  pk_bad: false,
  pk_avg: false,
  reward: '鸟2/鹰5/HIO(双鹰)10',
  tie_hole: '下洞不加分',
  collect_tie: '帕收1/鸟收2/鹰全收',
  handicap_receivers: [] as string[],
  is_landmine: false
});

const showModal = ref<string | null>(null);
const modalOptions = {
  category: ['固定老虎', '流动老虎'],
  compare_type: ['比洞', '比杆'],
  reward: [
    '鸟2/鹰5/HIO(双鹰)10',
    '鸟2/鹰10/HIO(双鹰)20',
    '鸟2/鹰4/HIO(双鹰)28',
    '鸟2/鹰16/HIO(双鹰)32'
  ],
  tie_hole: ['下洞不加分', '顶平过', '下洞加1分', '下洞加2分', '下洞加3分', '加倍（含奖励）', '加倍（不含奖励）', '连续翻倍'],
  collect_tie: [
    '赢洞全收',
    '帕收1/鸟收2/鹰全收',
    '帕收1/鸟收2/鹰收4',
    '赢收1/鸟收2/鹰全收',
    '不管赢多少只收1洞'
  ]
};

const selectOption = (key: string, val: string) => {
  (config.value as any)[key] = val;
  showModal.value = null;
};

const allPlayers = computed(() => matchStore.user_list);

const selectStartingHole = (n: number) => {
  config.value.starting_hole = n;
  showModal.value = null;
};

onMounted(() => {
  console.log('PKTiger mounted with params:', { matchId: matchId.value, ruleId: ruleId.value });
  if (ruleId.value) {
    const rule = matchStore.activeRules.find(r => r.id === ruleId.value);
    if (rule && rule.config) {
      config.value = { ...config.value, ...rule.config };
      config.value.base_unit = rule.base_score || 1;
      const sh = rule.starting_hole ?? rule.config?.starting_hole;
      if (sh != null && Number.isFinite(Number(sh))) {
        config.value.starting_hole = Math.min(18, Math.max(1, Math.round(Number(sh))));
      }
      if (rule.player_ids) {
        config.value.tiger_id = rule.player_ids[0];
        config.value.participant_ids = rule.player_ids.slice(1);
      }
      return;
    }
  }

  if (allPlayers.value.length >= 4) {
    config.value.tiger_id = allPlayers.value[0].id;
    config.value.participant_ids = allPlayers.value.slice(1, 4).map(p => p.id);
  }
});

const toggleTiger = (playerId: string) => {
  config.value.tiger_id = playerId;
  // If this player was a participant, remove them
  const pIdx = config.value.participant_ids.indexOf(playerId);
  if (pIdx > -1) {
    config.value.participant_ids.splice(pIdx, 1);
  }
};

const toggleParticipant = (playerId: string) => {
  if (playerId === config.value.tiger_id) return;
  const idx = config.value.participant_ids.indexOf(playerId);
  if (idx > -1) {
    config.value.participant_ids.splice(idx, 1);
  } else {
    if (config.value.participant_ids.length < 3) {
      config.value.participant_ids.push(playerId);
    } else {
      config.value.participant_ids.shift();
      config.value.participant_ids.push(playerId);
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
  if (!config.value.tiger_id || config.value.participant_ids.length < 2) {
    alert('请选择老虎和至少两位参与者');
    return;
  }

  matchStore.addRule({
    id: ruleId.value || 'tiger_' + Date.now(),
    type: 'tiger',
    category: 'multi',
    name: '打老虎',
    base_score: config.value.base_unit,
    starting_hole: config.value.starting_hole ?? 1,
    player_ids: [config.value.tiger_id, ...config.value.participant_ids],
    config: { 
      ...config.value,
      landlord_type: config.value.category === '固定老虎' ? '固定地主' : '流动地主',
      fixed_landlord_id: config.value.tiger_id
    }
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
      <h1 class="absolute inset-x-0 flex justify-center items-center text-xl font-black tracking-tight pointer-events-none pt-1">打老虎</h1>
      <div class="flex z-10 justify-end min-w-[3rem]">
        <button type="button" @click="config.is_landmine = !config.is_landmine"
                class="flex flex-col items-center justify-center w-11 h-11 bg-white border border-slate-200 rounded-xl transition-all"
                :class="config.is_landmine ? 'border-red-500 bg-red-500/10' : 'border-slate-200'">
          <text class="text-sm">💣</text>
          <span class="text-[7px] mt-0.5 font-bold" :class="config.is_landmine ? 'text-red-500' : 'text-slate-400'">地雷</span>
        </button>
      </div>
    </header>

    <div class="px-3 pt-2 space-y-2">
      <!-- Settings List -->
      <div class="space-y-0.5 rounded-2xl bg-white border border-slate-100 shadow-sm px-2">
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
        <div @click="showModal = 'active_holes'" class="flex items-center justify-between py-4 border-b border-slate-100 group active:bg-emerald-50/50 px-2 transition-colors cursor-pointer">
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

        <div @click="showModal = 'category'" class="flex items-center justify-between py-4 border-b border-slate-100 group active:bg-emerald-50/50 px-2 rounded-b-2xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-600">分类</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.category }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>
      </div>

      <!-- Selection Area -->
      <div class="flex gap-3 items-stretch min-h-[11rem] max-h-[13rem]">
        <!-- Tiger Circle -->
        <div class="flex-1 bg-white border border-slate-100 rounded-3xl flex flex-col items-center justify-center p-3 relative overflow-hidden group">
          <div class="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <span class="text-xs font-black text-slate-600 mb-2 z-10 uppercase tracking-widest">老虎</span>
          <div class="grid grid-cols-2 gap-1.5 z-10">
            <div v-for="player in allPlayers" :key="player.id" 
                 @click="toggleTiger(player.id)"
                 class="relative cursor-pointer">
              <image :src="player.avatar" mode="aspectFill" class="w-9 h-9 rounded-full border-2 transition-all"
                   :class="config.tiger_id === player.id ? 'border-[#15803d] scale-105 shadow-md shadow-emerald-200' : 'border-transparent opacity-30'" />
              <div v-if="config.tiger_id === player.id" class="absolute -top-0.5 -right-0.5 bg-[#15803d] rounded-full p-0.5 shadow-sm">
                <uni-icons type="checkmarkempty" :size="8" color="#ffffff" />
              </div>
            </div>
          </div>
        </div>

        <!-- Participants Rectangle -->
        <div class="flex-[1.5] bg-white border border-slate-100 rounded-3xl flex flex-col items-center justify-center p-4 relative overflow-hidden group">
          <div class="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <span class="text-xs font-black text-slate-600 mb-2 z-10 uppercase tracking-widest">参与者</span>
          <div class="grid grid-cols-3 gap-2 z-10">
            <div v-for="player in allPlayers" :key="player.id" 
                 @click="toggleParticipant(player.id)"
                 class="relative cursor-pointer"
                 :class="{ 'pointer-events-none opacity-10': player.id === config.tiger_id }">
              <image :src="player.avatar" mode="aspectFill" class="w-9 h-9 rounded-xl border-2 transition-all"
                   :class="config.participant_ids.includes(player.id) ? 'border-emerald-600 scale-105 shadow-md shadow-emerald-100' : 'border-transparent opacity-30'" />
              <div v-if="config.participant_ids.includes(player.id)" class="absolute -top-0.5 -right-0.5 bg-emerald-600 rounded-full p-0.5 shadow-sm">
                <uni-icons type="checkmarkempty" :size="8" color="#ffffff" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Scoring Section (Dou Dizhu Style) -->
      <div class="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-base font-bold text-slate-500">Σ</span>
            <span class="text-xs font-bold text-slate-600">计分规则</span>
          </div>
        </div>

        <div class="flex justify-between items-center">
          <div class="space-y-2 flex-1">
            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_good ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.pk_good" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="checkbox" v-model="config.pk_good" class="hidden" />
              <span class="text-xs font-bold text-slate-600 group-active:text-slate-900">较好成绩PK</span>
              <div class="px-2 py-0.5 rounded text-xs font-black ml-auto transition-colors"
                   :class="config.pk_good ? 'bg-[#15803d] text-white' : 'bg-slate-200 text-slate-600'">+1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_bad ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.pk_bad" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="checkbox" v-model="config.pk_bad" class="hidden" />
              <span class="text-xs font-bold text-slate-600 group-active:text-slate-900">较差成绩PK</span>
              <div class="px-2 py-0.5 rounded text-xs font-black ml-auto transition-colors"
                   :class="config.pk_bad ? 'bg-[#15803d] text-white' : 'bg-slate-200 text-slate-600'">+1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_avg ? 'bg-white border-slate-800' : 'bg-transparent'">
                <uni-icons v-if="config.pk_avg" type="checkmarkempty" :size="14" color="#0f172a" />
              </div>
              <input type="checkbox" v-model="config.pk_avg" class="hidden" />
              <span class="text-xs font-bold text-slate-600 group-active:text-slate-900">平均成绩PK</span>
              <div class="px-2 py-0.5 rounded text-xs font-black ml-auto transition-colors"
                   :class="config.pk_avg ? 'bg-[#15803d] text-white' : 'bg-slate-200 text-slate-600'">+1</div>
            </label>
          </div>

          <div class="w-16 flex flex-col items-center justify-center border-l border-slate-200 ml-3">
            <span class="text-4xl font-black text-slate-200 font-mono">{{ (config.pk_good ? 1 : 0) + (config.pk_bad ? 1 : 0) + (config.pk_avg ? 1 : 0) }}</span>
          </div>
        </div>
      </div>

      <!-- More Settings -->
      <div class="space-y-1 rounded-2xl bg-white border border-slate-100 shadow-sm px-1">
        <div @click="showModal = 'compare_type'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/50 px-2 rounded-t-2xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-base font-bold text-slate-500">Σ</span>
            <span class="text-xs font-bold text-slate-600">比什么</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.compare_type }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'reward'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/50 px-2 transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <uni-icons type="medal" :size="16" color="#15803d" />
            <span class="text-sm font-bold text-slate-600">奖励</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.reward }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'tie_hole'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/50 px-2 transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full border border-slate-400"></div>
            <span class="text-sm font-bold text-slate-600">顶洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.tie_hole }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'collect_tie'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/50 px-2 rounded-b-2xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full border border-slate-400"></div>
            <span class="text-sm font-bold text-slate-600">收顶洞</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.collect_tie }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <button type="button" class="w-full mt-2 py-2.5 px-4 bg-white border border-slate-200 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
          <uni-icons type="plusempty" :size="18" color="#15803d" />
          <span class="text-xs font-bold text-slate-800">受让杆球手</span>
        </button>
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
            <div class="flex gap-2 p-1">
              <button type="button" @click="config.active_holes = Array.from({length: 18}, (_, i) => i + 1)" class="flex-1 py-2.5 bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold">全选</button>
              <button type="button" @click="config.active_holes = Array.from({length: 9}, (_, i) => i + 1)" class="flex-1 py-2.5 bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold">前九</button>
              <button type="button" @click="config.active_holes = Array.from({length: 9}, (_, i) => i + 10)" class="flex-1 py-2.5 bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold">后九</button>
            </div>
          </template>
          <template v-else-if="showModal === 'starting_hole'">
            <p class="text-xs text-slate-600 px-2 pb-2 leading-relaxed">收顶洞、顶洞等按从出发洞起的环形洞序计算。所选为物理洞号（1–18）。</p>
            <div class="grid grid-cols-6 gap-2 p-1">
              <button v-for="i in 18" :key="'st'+i" type="button"
                      @click="selectStartingHole(i)"
                      class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all font-mono"
                      :class="config.starting_hole === i ? 'bg-[#15803d] border-[#15803d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'">
                {{ i }}
              </button>
            </div>
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
