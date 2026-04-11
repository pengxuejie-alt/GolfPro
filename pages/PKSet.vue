<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ChevronLeft, Plus, Minus, Info } from 'lucide-vue-next';
import { db } from '../utils/db';

import { Tab } from '../types';

const props = defineProps<{
  params?: { match_id: string };
}>();

const emit = defineEmits(['back', 'navigate']);
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
  emit('navigate', Tab.SELECT_PLAYER, { 
    slot_index: index, 
    from: Tab.PK_SET, 
    match_id: props.params?.match_id 
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

const saveAndStart = async () => {
  if (ruleConfig.value.pk_mode === 1) {
    emit('navigate', Tab.PK_LASHI, { match_id: props.params?.match_id });
    return;
  }
  if (ruleConfig.value.pk_mode === 4) {
    emit('navigate', Tab.PK_TIGER, { match_id: props.params?.match_id });
    return;
  }
  if (ruleConfig.value.pk_mode === 5) {
    emit('navigate', Tab.PK_DIZHU, { match_id: props.params?.match_id });
    return;
  }

  await db.setItem('current_rule_config', ruleConfig.value);
  
  // Update store if needed
  matchStore.addRule({
    id: Math.random().toString(36).substr(2, 9),
    type: ruleConfig.value.pk_mode === 1 ? 'vegas_4' : (ruleConfig.value.pk_mode === 2 ? '8421_1v1' : 'strokes'),
    category: 'multi',
    name: modeNames[ruleConfig.value.pk_mode - 1],
    base_score: ruleConfig.value.base_score,
    is_mon: ruleConfig.value.is_mon,
    birdie_double: ruleConfig.value.birdie_double,
    player_ids: ruleConfig.value.players.filter(p => p).map(p => p.id)
  });

  await matchStore.saveMatch();
  emit('navigate', Tab.SCORECARD, { match_id: props.params?.match_id });
};
</script>

<template>
  <div class="fixed inset-0 bg-[#1a1a1a] text-white flex flex-col overflow-auto pb-32">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-[#333] bg-[#1a1a1a] sticky top-0 z-50">
      <button @click="emit('navigate', 'SCORECARD', { match_id: props.params?.match_id })" class="p-2 -ml-2 hover:bg-[#262626] rounded-full transition-colors">
        <ChevronLeft class="w-6 h-6" />
      </button>
      <h1 class="text-base font-bold">PK 规则设置</h1>
      <div class="w-10"></div>
    </header>

    <div class="p-4 space-y-6">
      <!-- Players -->
      <section>
        <h2 class="text-xs text-slate-500 mb-3 uppercase tracking-wider font-bold">参与球员</h2>
        <div class="flex justify-between">
          <div v-for="i in 4" :key="i" class="flex flex-col items-center gap-2 w-1/5" @click="onSelectPlayer(i-1)">
            <div class="w-14 h-14 rounded-full border-2 border-dashed border-[#444] bg-[#262626] flex items-center justify-center overflow-hidden"
                 :class="ruleConfig.players[i-1] ? 'border-red-500 border-solid' : ''">
              <img v-if="ruleConfig.players[i-1]" :src="ruleConfig.players[i-1].avatar || `https://picsum.photos/seed/${ruleConfig.players[i-1].id}/100/100`" class="w-full h-full object-cover" />
              <Plus v-else class="w-6 h-6 text-slate-600" />
            </div>
            <span class="text-[10px] text-slate-400 truncate w-full text-center">{{ ruleConfig.players[i-1]?.nickname || '待选择' }}</span>
          </div>
        </div>
      </section>

      <!-- Mode -->
      <div class="bg-[#262626] rounded-2xl border border-[#333] overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-[#333]">
          <span class="text-sm font-medium">当前玩法</span>
          <select v-model="ruleConfig.pk_mode" class="bg-transparent text-red-500 text-sm font-bold outline-none">
            <option v-for="(name, idx) in modeNames" :key="idx" :value="idx + 1">{{ name }}</option>
          </select>
        </div>
      </div>

      <!-- Config -->
      <div class="bg-[#262626] rounded-2xl border border-[#333] overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-[#333]">
          <span class="text-sm font-medium">底分</span>
          <div class="flex items-center gap-4 bg-[#1a1a1a] rounded-lg p-1">
            <button @click="ruleConfig.base_score = Math.max(1, ruleConfig.base_score - 1)" class="w-8 h-8 flex items-center justify-center text-red-500"><Minus class="w-4 h-4" /></button>
            <input type="number" v-model="ruleConfig.base_score" class="w-12 text-center bg-transparent text-sm font-bold" />
            <button @click="ruleConfig.base_score += 1" class="w-8 h-8 flex items-center justify-center text-red-500"><Plus class="w-4 h-4" /></button>
          </div>
        </div>

        <div v-if="ruleConfig.pk_mode === 1" class="p-4 flex items-center justify-between border-b border-[#333]">
          <span class="text-sm font-medium">分组方式</span>
          <div class="flex bg-[#1a1a1a] rounded-lg p-1">
            <button @click="ruleConfig.fz_style = 0" 
                    class="px-4 py-1.5 text-xs rounded-md transition-all"
                    :class="ruleConfig.fz_style === 0 ? 'bg-red-500 text-white shadow-lg' : 'text-slate-500'">乱拉</button>
            <button @click="ruleConfig.fz_style = 1" 
                    class="px-4 py-1.5 text-xs rounded-md transition-all"
                    :class="ruleConfig.fz_style === 1 ? 'bg-red-500 text-white shadow-lg' : 'text-slate-500'">固拉</button>
          </div>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[#333]">
          <span class="text-sm font-medium">闷分 (Mon)</span>
          <input type="checkbox" v-model="ruleConfig.is_mon" class="accent-red-500 w-5 h-5" />
        </div>

        <div class="p-4 flex items-center justify-between border-b border-[#333]">
          <span class="text-sm font-medium">小鸟翻倍</span>
          <input type="checkbox" v-model="ruleConfig.birdie_double" class="accent-red-500 w-5 h-5" />
        </div>

        <div class="p-4 flex items-center justify-between">
          <span class="text-sm font-medium">让杆设置</span>
          <div class="flex items-center gap-2 text-red-500 text-sm font-bold">
            <span>{{ ruleConfig.give_strokes > 0 ? (ruleConfig.strokes_type === 'hole' ? '单洞让 ' : '总让 ') + ruleConfig.give_strokes + ' 杆' : '不让杆' }}</span>
            <ChevronLeft class="w-4 h-4 rotate-180" />
          </div>
        </div>
      </div>

      <!-- Holes -->
      <section class="bg-[#262626] rounded-2xl border border-[#333] p-4">
        <div class="flex items-center justify-between mb-4">
          <span class="text-sm font-medium">有效洞 ({{ ruleConfig.active_holes.length }})</span>
          <div class="flex gap-3">
            <button @click="quickSelect('all')" class="text-[10px] text-red-500 font-bold">全选</button>
            <button @click="quickSelect('front')" class="text-[10px] text-red-500 font-bold">前九</button>
            <button @click="quickSelect('back')" class="text-[10px] text-red-500 font-bold">后九</button>
          </div>
        </div>
        <div class="grid grid-cols-6 gap-3">
          <div v-for="(hole, idx) in holeList" :key="idx" 
               @click="toggleHole(idx)"
               class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all"
               :class="hole.selected ? 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-[#1a1a1a] border-[#333] text-slate-500'">
            {{ hole.no }}
          </div>
        </div>
      </section>
    </div>

    <!-- Footer -->
    <div class="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#1a1a1a] via-[#1a1a1a] to-transparent">
      <button @click="saveAndStart" class="w-full py-4 bg-red-500 text-white rounded-full font-bold shadow-xl shadow-red-500/20 active:scale-95 transition-all">
        保存并开始
      </button>
    </div>
  </div>
</template>

<style scoped>
select {
  -webkit-appearance: none;
  appearance: none;
}
</style>
