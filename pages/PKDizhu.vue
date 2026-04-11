<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { ChevronLeft, Bomb, Info, Check, ChevronRight, Minus, Plus } from 'lucide-vue-next';
import { useMatchStore } from '../store/matchStore';

const props = defineProps<{
  params?: { match_id: string, rule_id?: string };
}>();

const emit = defineEmits(['back', 'navigate']);
const matchStore = useMatchStore();

const config = ref({
  base_unit: 1,
  active_holes: Array.from({ length: 18 }, (_, i) => i + 1),
  category: '斗第二名',
  landlord_type: '流动地主',
  scoring_type: '1/2/3分',
  pk_good: false,
  pk_bad: false,
  pk_avg: true,
  fixed_landlord_id: '',
  selected_player_ids: [] as string[],
  reward: '鸟2/鹰5/HIO(双鹰)10',
  tie_hole: '下洞加1分',
  collect_tie: '赢洞全收',
  is_landmine: false
});

const showModal = ref<string | null>(null);
const modalOptions = {
  category: ['斗第二名', '斗第一名'],
  landlord_type: ['流动地主', '固定地主'],
  reward: [
    '鸟2/鹰5/HIO(双鹰)10',
    '鸟2/鹰10/HIO(双鹰)20',
    '鸟2/鹰4/HIO(双鹰)28',
    '鸟2/鹰16/HIO(双鹰)32'
  ],
  tie_hole: ['顶平过', '下洞加1分', '下洞加2分', '下洞加3分', '加倍（含奖励）', '加倍（不含奖励）', '连续翻倍'],
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
const selectedPlayers = computed(() => {
  return allPlayers.value.filter(p => config.value.selected_player_ids.includes(p.id));
});

onMounted(() => {
  if (props.params?.rule_id) {
    const rule = matchStore.activeRules.find(r => r.id === props.params?.rule_id);
    if (rule && rule.config) {
      config.value = { ...config.value, ...rule.config };
      config.value.base_unit = rule.base_score || 1;
      return;
    }
  }

  // Auto-select first 3 players if none selected
  if (config.value.selected_player_ids.length === 0) {
    config.value.selected_player_ids = allPlayers.value.slice(0, 3).map(p => p.id);
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
      // Replace last one or just do nothing? Let's replace last one to keep it at 3
      config.value.selected_player_ids.shift();
      config.value.selected_player_ids.push(playerId);
    }
  }
};

const handleSave = async () => {
  if (config.value.selected_player_ids.length !== 3) {
    alert('请选择3位参赛者进行斗地主');
    return;
  }
  if (config.value.landlord_type === '固定地主' && !config.value.fixed_landlord_id) {
    alert('请指定固定地主');
    return;
  }

  matchStore.addRule({
    id: props.params?.rule_id || 'dizhu_' + Date.now(),
    type: 'landlord',
    category: 'multi',
    name: '斗地主',
    base_score: config.value.base_unit,
    player_ids: config.value.selected_player_ids,
    config: { ...config.value }
  });
  await matchStore.saveMatch();
  emit('navigate', 'SCORECARD', { match_id: props.params?.match_id });
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

</script>

<template>
  <div class="fixed inset-0 bg-black text-white flex flex-col font-sans overflow-y-auto pb-32">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-4 sticky top-0 bg-black z-50">
      <button @click="emit('navigate', 'SCORECARD', { match_id: props.params?.match_id })" class="p-2 -ml-2 hover:bg-white/10 rounded-full transition-colors z-10">
        <ChevronLeft class="w-6 h-6" />
      </button>
      <h1 class="absolute inset-x-0 flex justify-center text-2xl font-black tracking-tight pointer-events-none">斗地主</h1>
      <div class="flex gap-3 z-10">
        <button @click="config.is_landmine = !config.is_landmine" 
                class="flex flex-col items-center justify-center w-14 h-14 bg-[#1a1a1a] rounded-2xl border transition-all"
                :class="config.is_landmine ? 'border-red-500 bg-red-500/10' : 'border-white/5'">
          <Bomb class="w-6 h-6" :class="config.is_landmine ? 'text-red-500' : 'text-slate-500'" />
          <span class="text-[8px] mt-1 font-bold" :class="config.is_landmine ? 'text-red-400' : 'text-slate-400'">埋地雷</span>
        </button>
        <div class="flex flex-col items-center justify-center w-14 h-14 bg-[#1a1a1a] rounded-2xl border border-white/5 relative">
          <span class="text-xl font-black text-white font-mono">{{ config.base_unit }}</span>
          <span class="text-[8px] mt-0.5 text-slate-400 font-bold">基本单位</span>
          <div class="absolute -bottom-2 flex gap-1">
            <button @click="config.base_unit = Math.max(1, config.base_unit - 1)" class="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700"><Minus class="w-2 h-2" /></button>
            <button @click="config.base_unit++" class="w-4 h-4 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700"><Plus class="w-2 h-2" /></button>
          </div>
        </div>
      </div>
    </header>

    <div class="px-4 space-y-1">
      <!-- Settings List -->
      <div class="space-y-0.5">
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

        <div @click="showModal = 'category'" class="flex items-center justify-between py-4 border-b border-white/5 group active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-300">分类</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.category }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>

        <div @click="showModal = 'landlord_type'" class="flex items-center justify-between py-4 border-b border-white/5 group active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-300">选地主</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.landlord_type }}</span>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>
      </div>

      <!-- Player Card -->
      <div class="my-6 bg-[#111] rounded-[32px] p-6 border border-white/5 shadow-2xl">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-sm font-bold text-slate-400">选择参赛者 (3人)</h3>
          <span class="text-xs font-bold" :class="config.selected_player_ids.length === 3 ? 'text-green-500' : 'text-orange-500'">
            {{ config.selected_player_ids.length }} / 3
          </span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div v-for="player in allPlayers" :key="player.id" 
               @click="togglePlayerSelection(player.id)"
               class="flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer"
               :class="config.selected_player_ids.includes(player.id) ? 'bg-white/10 border-white/20' : 'bg-transparent border-white/5 opacity-50'">
            <img :src="player.avatar" class="w-8 h-8 rounded-lg object-cover" />
            <span class="text-xs font-bold text-white truncate">{{ player.nickname }}</span>
            <Check v-if="config.selected_player_ids.includes(player.id)" class="w-3 h-3 text-orange-500 ml-auto" />
          </div>
        </div>
      </div>

      <!-- Fixed Landlord Selection -->
      <div v-if="config.landlord_type === '固定地主'" class="bg-[#111] rounded-[32px] p-6 border border-white/5 mb-6 animate-in fade-in slide-in-from-top-2">
        <h3 class="text-sm font-bold text-slate-400 mb-4">指定固定地主</h3>
        <div class="flex gap-4">
          <div v-for="player in selectedPlayers" :key="player.id" 
               @click="config.fixed_landlord_id = player.id"
               class="flex flex-col items-center gap-2 cursor-pointer group">
            <div class="relative">
              <img :src="player.avatar" class="w-12 h-12 rounded-full border-2 transition-all"
                   :class="config.fixed_landlord_id === player.id ? 'border-orange-500 scale-110' : 'border-transparent opacity-50'" />
              <div v-if="config.fixed_landlord_id === player.id" class="absolute -top-1 -right-1 bg-orange-500 rounded-full p-0.5">
                <Check class="w-3 h-3 text-white" />
              </div>
            </div>
            <span class="text-[10px] font-bold" :class="config.fixed_landlord_id === player.id ? 'text-white' : 'text-slate-500'">{{ player.nickname }}</span>
          </div>
        </div>
      </div>

      <!-- Scoring Section -->
      <div class="bg-[#111] rounded-[32px] p-6 border border-white/5 mb-6">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold text-slate-500">Σ</span>
            <span class="text-sm font-bold text-slate-300">计分 (1/2/3分)</span>
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
              <div class="px-3 py-0.5 rounded text-[10px] font-black ml-auto transition-colors"
                   :class="config.pk_good ? 'bg-red-600 text-white' : 'bg-[#222] text-slate-500'">+1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-white/20 flex items-center justify-center transition-colors"
                   :class="config.pk_bad ? 'bg-white border-white' : 'bg-transparent'">
                <Check v-if="config.pk_bad" class="w-3.5 h-3.5 text-black font-black" />
              </div>
              <input type="checkbox" v-model="config.pk_bad" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-white">较差成绩PK</span>
              <div class="px-3 py-0.5 rounded text-[10px] font-black ml-auto transition-colors"
                   :class="config.pk_bad ? 'bg-red-600 text-white' : 'bg-[#222] text-slate-500'">+1</div>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
              <div class="w-5 h-5 rounded border border-white/20 flex items-center justify-center transition-colors"
                   :class="config.pk_avg ? 'bg-white border-white' : 'bg-transparent'">
                <Check v-if="config.pk_avg" class="w-3.5 h-3.5 text-black font-black" />
              </div>
              <input type="checkbox" v-model="config.pk_avg" class="hidden" />
              <span class="text-xs font-bold text-slate-400 group-active:text-white">平均成绩PK</span>
              <div class="px-3 py-0.5 rounded text-[10px] font-black ml-auto transition-colors"
                   :class="config.pk_avg ? 'bg-red-600 text-white' : 'bg-[#222] text-slate-500'">+1</div>
            </label>
          </div>

          <div class="w-24 flex flex-col items-center justify-center border-l border-white/5 ml-6">
            <span class="text-6xl font-black text-white/20 font-mono">{{ (config.pk_good ? 1 : 0) + (config.pk_bad ? 1 : 0) + (config.pk_avg ? 1 : 0) }}</span>
          </div>
        </div>
      </div>

      <!-- More Settings -->
      <div class="space-y-0.5">
        <div @click="showModal = 'reward'" class="flex items-center justify-between py-4 border-b border-white/5 active:bg-white/5 px-2 rounded-xl transition-colors cursor-pointer">
          <div class="flex items-center gap-3">
            <Trophy class="w-4 h-4 text-yellow-500" />
            <span class="text-sm font-bold text-slate-300">奖励</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-100">{{ config.reward }}</span>
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
                      class="aspect-square rounded-full flex items-center justify-center text-xs font-bold border transition-all font-mono"
                      :class="config.active_holes.includes(i) ? 'bg-orange-500 border-orange-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'">
                {{ i }}
              </button>
            </div>
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
    <div class="fixed bottom-0 left-0 right-0 p-6 bg-black/80 backdrop-blur-md">
      <button @click="handleSave" class="w-full py-5 bg-red-700 text-white rounded-full font-black text-lg shadow-2xl shadow-red-900/40 active:scale-95 transition-all">
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
