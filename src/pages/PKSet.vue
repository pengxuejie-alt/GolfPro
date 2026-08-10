<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
// lucide removed — use uni-icons for WeChat compatibility
import { db } from '@/utils/db';
import { useMatchStore } from '@/store/matchStore';
import { Tab } from '@/types';
import { onLoad } from '@dcloudio/uni-app';
import { openRoute, goBack } from '@/utils/uniNav';
import { useMpPkRuleHeaderPad } from '@/utils/mpPkRuleHeaderPad';

const { headerPadStyle } = useMpPkRuleHeaderPad();

const matchId = ref('');
const ruleId = ref('');

onLoad((q) => {
  matchId.value = (q.match_id as string) || '';
  ruleId.value = (q.rule_id as string) || '';
});

const matchStore = useMatchStore();

const modeNames = ["拉斯维加斯", "8421", "比杆/比洞", "打老虎", "斗地主"];

const ruleConfig = ref({
  pk_mode: 1, // 1:拉斯, 2:8421, 3:比杆, 4:打老虎, 5:斗地主
  players: [] as any[],
  base_score: 10,
  fz_style: 0, // 0:乱拉, 1:固拉
  is_mon: false,
  birdie_double: true,
  give_strokes: 0,
  strokes_type: 'total', // total: 总让, hole: 单洞让
  active_holes: [] as number[]
});

const holeList = ref<any[]>([]);

onMounted(async () => {
  // Initialize holes
  const holes = [];
  for (let i = 1; i <= 18; i++) {
    holes.push({ no: i, selected: true });
  }
  holeList.value = holes;
  ruleConfig.value.active_holes = holes.map(h => h.no);

  // Load from storage if exists
  const saved = await db.getItem('current_rule_config');
  if (saved) {
    try {
      ruleConfig.value = { ...ruleConfig.value, ...saved };
      if (saved.active_holes) {
        holeList.value.forEach(h => {
          h.selected = saved.active_holes.includes(h.no);
        });
      }
    } catch (e) {}
  }

  // Load current match players if available
  if (matchStore.user_list.length > 0) {
    ruleConfig.value.players = [...matchStore.user_list];
  }
});

const onSelectPlayer = (index: number) => {
  openRoute(Tab.SELECT_PLAYER, { 
    slot_index: index, 
    from: Tab.PK_SET, 
    match_id: matchId.value 
  });
};

const toggleHole = (index: number) => {
  holeList.value[index].selected = !holeList.value[index].selected;
  ruleConfig.value.active_holes = holeList.value.filter(h => h.selected).map(h => h.no);
};

const quickSelect = (type: string) => {
  holeList.value.forEach(h => {
    if (type === 'all') h.selected = true;
    if (type === 'front') h.selected = h.no <= 9;
    if (type === 'back') h.selected = h.no > 9;
  });
  ruleConfig.value.active_holes = holeList.value.filter(h => h.selected).map(h => h.no);
};

/** picker 索引 0..n-1 ↔ pk_mode 1..n */
const pkModePickerIndex = computed(() =>
  Math.min(modeNames.length - 1, Math.max(0, ruleConfig.value.pk_mode - 1))
);

const onPkModePickerChange = (e: { detail: { value: string } }) => {
  const idx = Number(e.detail.value);
  ruleConfig.value.pk_mode = idx + 1;
};

const saveAndStart = async () => {
  if (ruleConfig.value.pk_mode === 1) {
    openRoute(Tab.PK_LASHI, { match_id: matchId.value });
    return;
  }
  if (ruleConfig.value.pk_mode === 4) {
    openRoute(Tab.PK_TIGER, { match_id: matchId.value });
    return;
  }
  if (ruleConfig.value.pk_mode === 5) {
    openRoute(Tab.PK_DIZHU, { match_id: matchId.value });
    return;
  }

  await db.setItem('current_rule_config', ruleConfig.value);
  
  // Update store if needed
  matchStore.addRule({
    id: ruleId.value || Math.random().toString(36).substr(2, 9),
    type: ruleConfig.value.pk_mode === 1 ? 'vegas_4' : (ruleConfig.value.pk_mode === 2 ? '8421_1v1' : (ruleConfig.value.pk_mode === 3 ? 'holes' : 'strokes')),
    category: 'multi',
    name: modeNames[ruleConfig.value.pk_mode - 1],
    base_score: ruleConfig.value.base_score,
    is_mon: ruleConfig.value.is_mon,
    birdie_double: ruleConfig.value.birdie_double,
    player_ids: ruleConfig.value.players.filter(p => p).map(p => p.id),
    participant_count: ruleConfig.value.players.filter(p => p).length,
    handicap_config: {
      type: ruleConfig.value.strokes_type === 'hole' ? '单洞' : 'none',
      value: ruleConfig.value.give_strokes
    },
    config: { ...ruleConfig.value }
  });

  await matchStore.saveMatch();
  openRoute(Tab.SCORECARD, { match_id: matchId.value });
};
</script>

<template>
  <div class="fixed inset-0 bg-slate-100 text-slate-900 flex flex-col overflow-auto pb-32">
    <!-- Header -->
    <header
      class="flex items-center justify-between px-4 pb-3 border-b border-slate-200 bg-white sticky top-0 z-50"
      :style="headerPadStyle"
    >
      <view @click="goBack()" class="p-2 -ml-2 rounded-full">
        <uni-icons type="left" :size="24" color="#94a3b8" />
      </view>
      <h1 class="text-base font-bold">PK 规则设置</h1>
      <div class="w-10"></div>
    </header>

    <div class="p-4 space-y-6">
      <!-- Players -->
      <section>
        <h2 class="text-xs text-slate-500 mb-3 uppercase tracking-wider font-bold">参与球员</h2>
        <div class="flex justify-between">
          <div v-for="i in 4" :key="i" class="flex flex-col items-center gap-2 w-1/5" @click="onSelectPlayer(i-1)">
            <div class="w-14 h-14 rounded-full border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden"
                 :class="ruleConfig.players[i-1] ? 'border-red-500 border-solid' : ''">
              <image v-if="ruleConfig.players[i-1]" :src="ruleConfig.players[i-1].avatar || `https://picsum.photos/seed/${ruleConfig.players[i-1].id}/100/100`" mode="aspectFill" class="w-full h-full" />
              <uni-icons v-else type="plusempty" :size="24" color="#475569" />
            </div>
            <text class="text-xs text-slate-400 truncate w-full text-center block">{{ ruleConfig.players[i-1]?.nickname || '待选择' }}</text>
          </div>
        </div>
      </section>

      <!-- Mode -->
      <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-slate-200">
          <text class="text-sm font-medium">当前玩法</text>
          <picker
            mode="selector"
            :range="modeNames"
            :value="pkModePickerIndex"
            @change="onPkModePickerChange"
          >
            <view class="bg-transparent text-red-500 text-sm font-bold flex items-center justify-end min-w-[120px]">
              <text class="text-red-500 text-sm font-bold">{{ modeNames[pkModePickerIndex] }}</text>
            </view>
          </picker>
        </div>
      </div>

      <!-- Config -->
      <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-slate-200">
          <text class="text-sm font-medium">底分</text>
          <div class="flex items-center gap-4 bg-slate-100 rounded-lg p-1">
            <view @click="ruleConfig.base_score = Math.max(1, ruleConfig.base_score - 1)" class="w-8 h-8 flex items-center justify-center"><uni-icons type="minus" :size="16" color="#ef4444" /></view>
            <input type="number" v-model="ruleConfig.base_score" class="w-12 text-center bg-transparent text-sm font-bold font-mono" />
            <view @click="ruleConfig.base_score += 1" class="w-8 h-8 flex items-center justify-center"><uni-icons type="plusempty" :size="16" color="#ef4444" /></view>
          </div>
        </div>

        <div v-if="ruleConfig.pk_mode === 1" class="p-4 flex items-center justify-between border-b border-slate-200">
          <text class="text-sm font-medium">分组方式</text>
          <div class="flex bg-slate-100 rounded-lg p-1">
            <button @click="ruleConfig.fz_style = 0" 
                    class="px-4 py-1.5 text-xs rounded-md transition-all"
                    :class="ruleConfig.fz_style === 0 ? 'bg-red-500 text-white shadow-lg' : 'text-slate-500'">乱拉</button>
            <button @click="ruleConfig.fz_style = 1" 
                    class="px-4 py-1.5 text-xs rounded-md transition-all"
                    :class="ruleConfig.fz_style === 1 ? 'bg-red-500 text-white shadow-lg' : 'text-slate-500'">固拉</button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-slate-200">
          <text class="text-sm font-medium">闷分 (Mon)</text>
          <input type="checkbox" v-model="ruleConfig.is_mon" class="accent-red-500 w-5 h-5" />
        </div>

        <div class="p-4 flex items-center justify-between border-b border-slate-200">
          <text class="text-sm font-medium">小鸟翻倍</text>
          <input type="checkbox" v-model="ruleConfig.birdie_double" class="accent-red-500 w-5 h-5" />
        </div>

        <div class="p-4 flex items-center justify-between">
          <text class="text-sm font-medium">让杆设置</text>
          <div class="flex items-center gap-2 text-red-500 text-sm font-bold">
            <text class="text-sm font-bold text-red-500">{{ ruleConfig.give_strokes > 0 ? (ruleConfig.strokes_type === 'hole' ? '单洞让 ' : '总让 ') + ruleConfig.give_strokes + ' 杆' : '不让杆' }}</text>
            <uni-icons type="right" :size="16" color="#ef4444" />
          </div>
        </div>
      </div>

      <!-- Holes -->
      <section class="bg-white rounded-2xl border border-slate-200 p-4">
        <div class="flex items-center justify-between mb-4">
          <text class="text-sm font-medium">有效洞 ({{ ruleConfig.active_holes.length }})</text>
          <div class="flex gap-3">
            <button @click="quickSelect('all')" class="text-xs text-red-500 font-bold">全选</button>
            <button @click="quickSelect('front')" class="text-xs text-red-500 font-bold">前九</button>
            <button @click="quickSelect('back')" class="text-xs text-red-500 font-bold">后九</button>
          </div>
        </div>
        <div class="grid grid-cols-6 gap-3">
          <div v-for="(hole, idx) in holeList" :key="idx" 
               @click="toggleHole(idx)"
               class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all font-mono"
               :class="hole.selected ? 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-slate-100 border-slate-200 text-slate-600'">
            {{ hole.no }}
          </div>
        </div>
      </section>
    </div>

    <!-- Footer -->
    <div class="fixed bottom-0 left-0 right-0 p-6 bg-white/95 backdrop-blur-md border-t border-slate-200">
      <button @click="saveAndStart" class="w-full py-4 bg-red-500 text-white rounded-full font-bold shadow-xl shadow-red-500/20 active:scale-95 transition-all">
        保存并开始
      </button>
    </div>
  </div>
</template>

