<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// lucide removed — use uni-icons for WeChat compatibility
import { useMatchStore } from '@/store/matchStore';
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
  category: '斗第二名',
  landlord_type: '抽地主',
  scoring_type: '1/2/3分',
  pk_good: false,
  pk_bad: false,
  pk_avg: true,
  fixed_landlord_id: '',
  drawn_landlord_id: '',
  selected_player_ids: [] as string[],
  reward: '鸟2/鹰5/HIO(双鹰)10',
  tie_hole: '下洞不加分',
  collect_tie: '帕收1/鸟收2/鹰全收',
  is_landmine: false
});

const showModal = ref<string | null>(null);
const modalOptions = {
  category: ['斗第二名', '斗第一名'],
  landlord_type: ['抽地主', '指定地主'],
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

const isDesignateLandlord = computed(
  () => config.value.landlord_type === '指定地主' || config.value.landlord_type === '固定地主'
);

const drawLandlord = () => {
  const ids = config.value.selected_player_ids;
  if (ids.length !== 3) {
    uni.showToast({ title: '请先选满3位参赛者', icon: 'none' });
    return;
  }
  const pick = ids[Math.floor(Math.random() * ids.length)];
  config.value.drawn_landlord_id = pick;
};

const selectOption = (key: string, val: string) => {
  (config.value as any)[key] = val;
  showModal.value = null;
  if (key === 'landlord_type' && val === '抽地主' && config.value.selected_player_ids.length === 3 && !config.value.drawn_landlord_id) {
    drawLandlord();
  }
};

const allPlayers = computed(() => matchStore.user_list);
const selectedPlayers = computed(() => {
  return allPlayers.value.filter(p => config.value.selected_player_ids.includes(p.id));
});

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
      const t = String(config.value.landlord_type || '');
      if (t === '固定地主') {
        config.value.landlord_type = '指定地主';
      } else if (t === '流动地主' || t === '' || t === '抽地主') {
        config.value.landlord_type = '抽地主';
        if (!config.value.drawn_landlord_id) {
          config.value.drawn_landlord_id =
            config.value.drawn_landlord_id ||
            rule.player_ids?.[0] ||
            config.value.selected_player_ids[0] ||
            '';
        }
      }
      return;
    }
  }

  // Auto-select first 3 players if none selected
  if (config.value.selected_player_ids.length === 0) {
    config.value.selected_player_ids = allPlayers.value.slice(0, 3).map(p => p.id);
  }
  if (
    !isDesignateLandlord.value &&
    config.value.selected_player_ids.length === 3 &&
    !config.value.drawn_landlord_id
  ) {
    drawLandlord();
  }
});

const togglePlayerSelection = (playerId: string) => {
  const idx = config.value.selected_player_ids.indexOf(playerId);
  if (idx > -1) {
    config.value.selected_player_ids.splice(idx, 1);
  } else {
    if (config.value.selected_player_ids.length < 3) {
      config.value.selected_player_ids.push(playerId);
    } else {
      config.value.selected_player_ids.shift();
      config.value.selected_player_ids.push(playerId);
    }
  }
  if (!config.value.selected_player_ids.includes(config.value.drawn_landlord_id)) {
    config.value.drawn_landlord_id = '';
  }
  if (!config.value.selected_player_ids.includes(config.value.fixed_landlord_id)) {
    config.value.fixed_landlord_id = '';
  }
  if (
    !isDesignateLandlord.value &&
    config.value.selected_player_ids.length === 3 &&
    !config.value.drawn_landlord_id
  ) {
    drawLandlord();
  }
};

const handleSave = async () => {
  if (config.value.selected_player_ids.length !== 3) {
    alert('请选择3位参赛者进行斗地主');
    return;
  }
  if (isDesignateLandlord.value && !config.value.fixed_landlord_id) {
    alert('请指定地主');
    return;
  }
  if (!isDesignateLandlord.value) {
    if (!config.value.drawn_landlord_id) {
      if (config.value.selected_player_ids.length === 3) {
        drawLandlord();
      } else {
        alert('请先抽地主');
        return;
      }
    }
  }
  if (!config.value.pk_good && !config.value.pk_bad && !config.value.pk_avg) {
    alert('请至少选择一项计分维度');
    return;
  }

  matchStore.addRule({
    id: ruleId.value || 'dizhu_' + Date.now(),
    type: 'landlord',
    category: 'multi',
    name: '斗地主',
    base_score: config.value.base_unit,
    starting_hole: config.value.starting_hole ?? 1,
    player_ids: config.value.selected_player_ids,
    config: { ...config.value }
  });
  await matchStore.saveMatch();
  openRoute('SCORECARD', { match_id: matchId.value });
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

const togglePkDim = (key: 'pk_good' | 'pk_bad' | 'pk_avg') => {
  config.value[key] = !config.value[key];
};

const pkDimCount = computed(
  () => (config.value.pk_good ? 1 : 0) + (config.value.pk_bad ? 1 : 0) + (config.value.pk_avg ? 1 : 0)
);

</script>

<template>
  <div class="fixed inset-0 bg-[#f3f7fb] text-slate-900 flex flex-col font-sans overflow-y-auto pb-24">
    <!-- Header -->
    <header
      class="flex items-center justify-between px-4 pb-2.5 sticky top-0 bg-white border-b-2 border-[#15803d] shadow-sm z-50"
      :style="headerPadStyle"
    >
      <view @click="goBackFromPkRulePage(matchId)" class="p-2 -ml-2 rounded-full z-10">
        <uni-icons type="left" :size="22" color="#64748b" />
      </view>
      <h1 class="absolute inset-x-0 flex justify-center items-center text-xl font-black tracking-tight pointer-events-none pt-1">斗地主</h1>
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
        <div @click="showModal = 'active_holes'" class="flex items-center justify-between py-2.5 border-b border-slate-100 group active:bg-emerald-50/50 px-2 transition-colors cursor-pointer">
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

        <div @click="showModal = 'category'" class="flex items-center justify-between py-2.5 border-b border-slate-100 group active:bg-emerald-50/50 px-2 transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-600">分类</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.category }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>

        <div @click="showModal = 'landlord_type'" class="flex items-center justify-between py-2.5 border-b border-slate-100 group active:bg-emerald-50/50 px-2 rounded-b-2xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-600">选地主</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ config.landlord_type }}</span>
            <uni-icons type="right" :size="16" color="#475569" />
          </div>
        </div>
      </div>

      <!-- Player Card -->
      <div class="bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-xs font-bold text-slate-500">选择参赛者 (3人)</h3>
          <span class="text-xs font-bold" :class="config.selected_player_ids.length === 3 ? 'text-[#15803d]' : 'text-amber-600'">
            {{ config.selected_player_ids.length }} / 3
          </span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div v-for="player in allPlayers" :key="player.id" 
               @click="togglePlayerSelection(player.id)"
               class="flex items-center gap-2 p-2 rounded-xl border transition-all cursor-pointer"
               :class="config.selected_player_ids.includes(player.id) ? 'bg-emerald-50 border-[#15803d]/40' : 'bg-transparent border-slate-200 opacity-50'">
            <image :src="player.avatar" mode="aspectFill" class="w-7 h-7 rounded-lg" />
            <span class="text-xs font-bold text-slate-900 truncate">{{ player.nickname }}</span>
            <uni-icons v-if="config.selected_player_ids.includes(player.id)" type="checkmarkempty" :size="12" color="#15803d" class="ml-auto" />
          </div>
        </div>
      </div>

      <!-- 抽地主 / 指定地主 -->
      <div v-if="!isDesignateLandlord" class="bg-white border border-slate-100 rounded-2xl p-3 mb-2 shadow-sm">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-xs font-bold text-slate-500">抽地主（第一洞地主，之后按成绩流动）</h3>
          <button
            type="button"
            @click="drawLandlord"
            class="px-3 py-1 rounded-full text-xs font-bold bg-[#15803d] text-white active:opacity-80"
          >
            抽一下
          </button>
        </div>
        <div class="flex gap-3">
          <div v-for="player in selectedPlayers" :key="'draw-'+player.id"
               class="flex flex-col items-center gap-1">
            <div class="relative">
              <image :src="player.avatar" mode="aspectFill" class="w-10 h-10 rounded-full border-2 transition-all"
                   :class="config.drawn_landlord_id === player.id ? 'border-[#dc2626] scale-105' : 'border-transparent opacity-50'" />
              <div v-if="config.drawn_landlord_id === player.id" class="absolute -top-1 -right-1 bg-[#dc2626] rounded-sm px-0.5">
                <text class="text-[9px] font-black text-white leading-none">地</text>
              </div>
            </div>
            <span class="text-xs font-bold" :class="config.drawn_landlord_id === player.id ? 'text-slate-900' : 'text-slate-500'">{{ player.nickname }}</span>
          </div>
        </div>
        <p v-if="!config.drawn_landlord_id" class="text-[11px] text-amber-600 mt-2">请点「抽一下」随机选定第一洞地主</p>
      </div>

      <div v-if="isDesignateLandlord" class="bg-white border border-slate-100 rounded-2xl p-3 mb-2 shadow-sm animate-in fade-in slide-in-from-top-2">
        <h3 class="text-xs font-bold text-slate-500 mb-2">指定地主（整场不换人）</h3>
        <div class="flex gap-3">
          <div v-for="player in selectedPlayers" :key="player.id" 
               @click="config.fixed_landlord_id = player.id"
               class="flex flex-col items-center gap-1 cursor-pointer group">
            <div class="relative">
              <image :src="player.avatar" mode="aspectFill" class="w-10 h-10 rounded-full border-2 transition-all"
                   :class="config.fixed_landlord_id === player.id ? 'border-[#15803d] scale-105' : 'border-transparent opacity-50'" />
              <div v-if="config.fixed_landlord_id === player.id" class="absolute -top-1 -right-1 bg-[#15803d] rounded-full p-0.5">
                <uni-icons type="checkmarkempty" :size="12" color="#ffffff" />
              </div>
            </div>
            <span class="text-xs font-bold" :class="config.fixed_landlord_id === player.id ? 'text-slate-900' : 'text-slate-500'">{{ player.nickname }}</span>
          </div>
        </div>
      </div>

      <!-- Scoring Section -->
      <div class="bg-white border border-slate-100 rounded-2xl p-3 mb-2 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-base font-bold text-slate-500">Σ</span>
            <span class="text-xs font-bold text-slate-600">计分 (1/2/3分)</span>
          </div>
        </div>

        <div class="flex justify-between items-center">
          <div class="space-y-2 flex-1">
            <view class="flex items-center gap-3 active:opacity-80" @click="togglePkDim('pk_good')">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_good ? 'bg-[#15803d] border-[#15803d]' : 'bg-transparent'">
                <uni-icons v-if="config.pk_good" type="checkmarkempty" :size="14" color="#ffffff" />
              </div>
              <span class="text-xs font-bold text-slate-600">较好成绩PK</span>
              <div class="px-2 py-0.5 rounded text-xs font-black ml-auto transition-colors"
                   :class="config.pk_good ? 'bg-[#15803d] text-white' : 'bg-slate-200 text-slate-600'">+1</div>
            </view>

            <view class="flex items-center gap-3 active:opacity-80" @click="togglePkDim('pk_bad')">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_bad ? 'bg-[#15803d] border-[#15803d]' : 'bg-transparent'">
                <uni-icons v-if="config.pk_bad" type="checkmarkempty" :size="14" color="#ffffff" />
              </div>
              <span class="text-xs font-bold text-slate-600">较差成绩PK</span>
              <div class="px-3 py-0.5 rounded text-xs font-black ml-auto transition-colors"
                   :class="config.pk_bad ? 'bg-[#15803d] text-white' : 'bg-slate-200 text-slate-600'">+1</div>
            </view>

            <view class="flex items-center gap-3 active:opacity-80" @click="togglePkDim('pk_avg')">
              <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                   :class="config.pk_avg ? 'bg-[#15803d] border-[#15803d]' : 'bg-transparent'">
                <uni-icons v-if="config.pk_avg" type="checkmarkempty" :size="14" color="#ffffff" />
              </div>
              <span class="text-xs font-bold text-slate-600">平均成绩PK</span>
              <div class="px-3 py-0.5 rounded text-xs font-black ml-auto transition-colors"
                   :class="config.pk_avg ? 'bg-[#15803d] text-white' : 'bg-slate-200 text-slate-600'">+1</div>
            </view>
          </div>

          <div class="w-16 flex flex-col items-center justify-center border-l border-slate-200 ml-3">
            <span class="text-4xl font-black text-slate-200 font-mono">{{ pkDimCount }}</span>
          </div>
        </div>
      </div>

      <!-- More Settings -->
      <div class="space-y-0.5 rounded-2xl bg-white border border-slate-100 shadow-sm px-2">
        <div @click="showModal = 'reward'" class="flex items-center justify-between py-2.5 border-b border-slate-100 active:bg-emerald-50/50 px-2 rounded-t-2xl transition-colors cursor-pointer">
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
              <button v-for="i in 18" :key="i" 
                      type="button"
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
              <button v-for="i in 18" :key="'s'+i"
                      type="button"
                      @click="selectStartingHole(i)"
                      class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all font-mono"
                      :class="config.starting_hole === i ? 'bg-[#15803d] border-[#15803d] text-white' : 'bg-slate-50 border-slate-200 text-slate-800'">
                {{ i }}
              </button>
            </div>
          </template>
          <template v-else>
            <button v-for="opt in (modalOptions as any)[showModal]" :key="opt"
                    type="button"
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

<style scoped>
.font-sans {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
</style>
