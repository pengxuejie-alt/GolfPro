<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
// lucide removed — use uni-icons for WeChat compatibility
import { db } from '@/utils/db';
import { MatchManager } from '@/utils/match_manager';
import { openRoute, goBack } from '@/utils/uniNav';

type GetProfilesResult = {
  success?: boolean;
  profiles?: Array<{ openId?: string; nickName?: string; avatarUrl?: string }>;
};

function callGetUserProfiles(openIds: string[]): Promise<GetProfilesResult | null> {
  return new Promise((resolve) => {
    try {
      // #ifdef MP-WEIXIN
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'getUserProfiles',
        data: { openIds },
        success: (r: { result?: unknown }) => resolve((r?.result as GetProfilesResult) ?? null),
        fail: () => resolve(null),
      });
      // #endif
      // #ifndef MP-WEIXIN
      resolve(null);
      // #endif
    } catch {
      resolve(null);
    }
  });
}

const matchId = ref('');
const fromPage = ref('');
const slotIndex = ref<number | undefined>(undefined);

onLoad((q) => {
  matchId.value = (q.match_id as string) || '';
  fromPage.value = (q.from as string) || '';
  if (q.slot_index !== undefined && q.slot_index !== '') {
    slotIndex.value = Number(q.slot_index);
  }
});

const T = {
  search_placeholder: '搜索球友姓名/手机号',
  invite_wechat: '邀请微信球友加入',
  common_players: '常用球友',
  add_manual: '手动新增',
  handicap: '差点',
  selected: '已选',
  confirm: '确定',
  quick_add: '快速录入球手',
  name: '姓名',
  input_name: '请输入姓名',
  gender: '性别',
  male: '男',
  female: '女',
  initial_handicap: '初始差点',
  cancel: '取消',
  no_matching: '未找到匹配球友'
};

const players = ref<any[]>([]);
const quickAddName = ref('');
const selectedCount = computed(() => players.value.filter(p => p.selected).length);
const showDialog = ref(false);
const tempPlayer = ref({
  nickname: '',
  gender: 1,
  handicap: 18.0
});

onMounted(async () => {
  await loadCommonPlayers();
  await enrichFromMatchRosterIfNeeded();
});

async function enrichFromMatchRosterIfNeeded() {
  if (!matchId.value) return;
  try {
    const m = await MatchManager.getMatch(matchId.value);
    if (!m) return;
    const roster = (m.user_list || m.players || []) as any[];
    const openIds: string[] = [];
    const byId = new Map<string, any>();
    for (const raw of roster) {
      if (!raw || typeof raw !== 'object') continue;
      const id = String(raw.uid || raw.openId || raw.id || '').trim();
      if (!id || id.startsWith('temp_') || id.startsWith('virtual_') || id.startsWith('anon_')) continue;
      openIds.push(id);
      byId.set(id, raw);
    }
    if (!openIds.length) return;
    const profRes = await callGetUserProfiles(openIds);
    const profMap = new Map<string, { nickName: string; avatarUrl: string }>();
    if (profRes?.profiles) {
      for (const row of profRes.profiles) {
        const oid = row.openId != null ? String(row.openId).trim() : '';
        if (!oid) continue;
        profMap.set(oid, {
          nickName: row.nickName != null && String(row.nickName).trim() !== '' ? String(row.nickName).trim() : '球友',
          avatarUrl: row.avatarUrl != null ? String(row.avatarUrl).trim() : '',
        });
      }
    }
    for (const oid of openIds) {
      const raw = byId.get(oid);
      const prof = profMap.get(oid);
      const nick =
        (prof?.nickName && prof.nickName.trim()) ||
        raw.nickname ||
        raw.nickName ||
        '球友';
      const av =
        (prof?.avatarUrl && prof.avatarUrl.trim()) ||
        raw.avatarUrl ||
        raw.avatar ||
        '';
      const entry = {
        id: oid,
        nickname: nick,
        avatar: av || '/static/tab/me.png',
        handicap: Number(raw.handicap) || 18,
        selected: false,
      };
      const idx = players.value.findIndex((p) => String(p.id) === oid);
      if (idx >= 0) {
        players.value.splice(idx, 1, { ...players.value[idx], ...entry });
      } else {
        players.value.unshift(entry);
      }
    }
  } catch (e) {
    console.warn('[SelectPlayer] enrichFromMatchRosterIfNeeded', e);
  }
}

const loadCommonPlayers = async () => {
  const history = await db.getItem('history_players');
  const basePlayers = [
    { id: '101', nickname: 'Rocky', avatar: 'https://picsum.photos/seed/rocky/100/100', handicap: 12.5, selected: false },
    { id: '102', nickname: 'Tiger', avatar: 'https://picsum.photos/seed/tiger/100/100', handicap: 0.5, selected: false },
    { id: '103', nickname: 'Jacky', avatar: 'https://picsum.photos/seed/jacky/100/100', handicap: 15.2, selected: false },
    { id: '104', nickname: 'Rose', avatar: 'https://picsum.photos/seed/rose/100/100', handicap: 24.0, selected: false },
    { id: '105', nickname: 'Kevin', avatar: 'https://picsum.photos/seed/kevin/100/100', handicap: 18.8, selected: false }
  ];
  
  if (history) {
    try {
      players.value = [...history, ...basePlayers];
    } catch (e) {
      players.value = basePlayers;
    }
  } else {
    players.value = basePlayers;
  }
};

const saveToHistory = async (player: any) => {
  const history = await db.getItem('history_players');
  let list = [];
  if (history) {
    list = history;
  }
  list.unshift(player);
  // Keep only last 20
  list = list.slice(0, 20);
  await db.setItem('history_players', list);
};

const quickAddPlayer = async () => {
  if (!quickAddName.value.trim()) return;
  
  const names = quickAddName.value.split(/[,，]/).map(n => n.trim()).filter(n => n);
  
  if (names.length === 0) return;

  if (selectedCount.value + names.length > 4) {
    alert('每组最多4人');
    return;
  }

  for (const [index, name] of names.entries()) {
    const newPlayer = {
      id: 'temp_' + Date.now() + '_' + index,
      nickname: name,
      avatar: `https://picsum.photos/seed/${Date.now()}_${index}/100/100`,
      handicap: 18.0,
      gender: 1,
      is_temp: true,
      selected: true
    };

    players.value.unshift(newPlayer);
    await saveToHistory(newPlayer);
  }

  quickAddName.value = '';
};

const toggleSelect = (index: number) => {
  const player = players.value[index];
  if (!player.selected && selectedCount.value >= 4) {
    alert('每组最多4人');
    return;
  }
  player.selected = !player.selected;
};

const saveTempPlayer = async () => {
  if (!tempPlayer.value.nickname) {
    alert('请输入姓名');
    return;
  }

  if (selectedCount.value >= 4) {
    alert('每组最多4人');
    return;
  }

  const newPlayer = {
    id: 'temp_' + Date.now(),
    nickname: tempPlayer.value.nickname,
    avatar: 'https://picsum.photos/seed/temp/100/100',
    handicap: parseFloat(tempPlayer.value.handicap.toString()),
    gender: tempPlayer.value.gender,
    is_temp: true,
    selected: true
  };

  players.value.unshift(newPlayer);
  await saveToHistory(newPlayer);
  showDialog.value = false;
};

const confirmSelection = async () => {
  const selected = players.value.filter(p => p.selected);
  if (selected.length === 0) {
    alert('请至少选择一名球员');
    return;
  }
  
  if (slotIndex.value !== undefined) {
    const player = selected[0];
    // In a real app, we'd update the store or use a global event bus
    // For this prototype, we'll just log and go back
    console.log(`Updating slot ${slotIndex.value} with:`, player);
    
    // Mock updating the previous page's state
    const saved = await db.getItem('current_rule_config');
    if (saved) {
      const config = saved;
      if (!config.players) config.players = [];
      config.players[slotIndex.value] = {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        handicap: player.handicap,
        is_temp: player.is_temp || false
      };
      await db.setItem('current_rule_config', config);
    }
  } else {
    console.log('General selection:', selected);
  }
  
  if (fromPage.value) {
    openRoute(fromPage.value, { match_id: matchId.value });
  } else {
    goBack();
  }
};

const onHeaderBack = () => {
  if (fromPage.value) {
    openRoute(fromPage.value, { match_id: matchId.value });
  } else {
    goBack();
  }
};

const onScanCode = () => {
  alert('正在调用摄像头扫码...');
};

const onShare = () => {
  alert('已生成分享卡片：⛳️ 三缺一！点我加入本场计分卡');
};
</script>

<template>
  <div class="fixed inset-0 bg-white text-slate-900 flex flex-col z-[60]">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-10">
      <view @click="onHeaderBack" class="p-2 -ml-2 rounded-full">
        <uni-icons type="closeempty" :size="24" color="#94a3b8" />
      </view>
      <h1 class="text-base font-bold">选择球友</h1>
      <div class="w-10"></div>
    </header>

    <!-- Search Section -->
    <div class="p-4 bg-white">
      <div class="flex items-center gap-3 bg-slate-100 rounded-full px-4 min-h-[112rpx] py-1">
        <uni-icons type="search" :size="16" color="#94a3b8" />
        <input type="text" :placeholder="T.search_placeholder" class="mp-safe-input-flex flex-1 min-w-0 bg-transparent text-sm outline-none" />
        <view @click="onScanCode" class="p-1 rounded-full shrink-0">
          <uni-icons type="scan" :size="20" color="#64748b" />
        </view>
      </div>
    </div>

    <!-- Invite Button -->
    <div class="px-4 mb-4">
      <button @click="onShare" class="w-full h-11 bg-[#07c160] text-white rounded-full font-medium flex items-center justify-center gap-2 active:scale-95 transition-all">
        <uni-icons type="paperplane" :size="20" color="#ffffff" />
        {{ T.invite_wechat }}
      </button>
    </div>

    <!-- Quick Add Panel -->
    <div class="px-4 py-3 border-b border-slate-100 bg-slate-50">
      <div class="flex items-center gap-2">
        <div class="flex-1 bg-white rounded-xl border border-slate-200 px-3 min-h-[112rpx] flex items-center shadow-sm focus-within:border-red-500 transition-colors">
          <uni-icons type="personadd" :size="16" color="#94a3b8" class="mr-2 shrink-0" />
          <input v-model="quickAddName" type="text" placeholder="快速添加虚拟球友(支持逗号分隔多个)" 
                 class="mp-safe-input-flex flex-1 min-w-0 bg-transparent text-sm outline-none" 
                 @keyup.enter="quickAddPlayer" />
        </div>
        <button @click="quickAddPlayer" 
                class="min-h-[112rpx] h-auto px-5 bg-red-500 text-white rounded-xl text-sm font-bold active:scale-95 transition-all shadow-lg shadow-red-500/20 flex items-center justify-center">
          添加
        </button>
      </div>
    </div>

    <!-- List Title -->
    <div class="flex items-center justify-between px-4 py-2 bg-slate-50 text-xs font-bold text-slate-400 uppercase tracking-wider">
      <span>{{ T.common_players }}</span>
      <button @click="showDialog = true" class="text-red-500 hover:text-red-600 transition-colors">
        {{ T.add_manual }}
      </button>
    </div>

    <!-- Player List -->
    <div class="flex-1 overflow-auto pb-32">
      <div v-for="(player, idx) in players" :key="player.id" 
           @click="toggleSelect(idx)"
           class="flex items-center gap-4 px-4 h-[60px] border-b border-slate-50 active:bg-slate-50 transition-colors">
        <div class="relative w-10 h-10">
          <image :src="player.avatar" mode="aspectFill" class="w-full h-full rounded-full bg-slate-100" />
          <div v-if="player.selected" class="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full border-2 border-white flex items-center justify-center">
            <uni-icons type="checkmarkempty" :size="10" color="#ffffff" />
          </div>
        </div>
        <div class="flex-1">
          <div class="text-sm font-bold text-slate-800">{{ player.nickname }}</div>
          <div class="text-xs text-slate-400 font-medium">{{ T.handicap }}: {{ player.handicap }}</div>
        </div>
        <div class="w-5 h-5 rounded-full border-2 transition-all flex items-center justify-center"
             :class="player.selected ? 'bg-red-500 border-red-500' : 'border-slate-200'">
          <uni-icons v-if="player.selected" type="checkmarkempty" :size="12" color="#ffffff" />
        </div>
      </div>

      <div v-if="players.length === 0" class="py-20 text-center text-slate-300 text-sm">
        {{ T.no_matching }}
      </div>
    </div>

    <!-- Bottom Bar -->
    <div class="fixed bottom-0 left-0 right-0 h-20 bg-white border-t border-slate-100 px-4 flex items-center justify-between shadow-[0_-4px_16px_rgba(0,0,0,0.05)]">
      <div class="text-sm text-slate-500">
        {{ T.selected }}: <span class="text-red-500 font-bold">{{ selectedCount }}</span>/4
      </div>
      <button @click="confirmSelection" 
              :disabled="selectedCount === 0"
              class="px-10 h-11 rounded-full font-bold transition-all active:scale-95"
              :class="selectedCount > 0 ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-slate-200 text-slate-400 cursor-not-allowed'">
        {{ T.confirm }}
      </button>
    </div>

    <!-- Quick Add Dialog -->
    <div v-if="showDialog" class="fixed inset-0 z-[70] flex items-center justify-center p-6">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="showDialog = false"></div>
      <div class="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
        <h3 class="text-lg font-bold text-center mb-6">{{ T.quick_add }}</h3>
        
        <div class="space-y-4">
          <div>
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{{ T.name }}</label>
            <input v-model="tempPlayer.nickname" type="text" :placeholder="T.input_name" 
                   class="mp-safe-input-full w-full px-4 bg-slate-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-red-500/20 transition-all" />
          </div>

          <div>
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">{{ T.gender }}</label>
            <div class="flex bg-slate-50 rounded-xl p-1">
              <button @click="tempPlayer.gender = 1" 
                      class="flex-1 h-9 rounded-lg text-xs font-bold transition-all"
                      :class="tempPlayer.gender === 1 ? 'bg-white text-red-500 shadow-sm' : 'text-slate-400'">{{ T.male }}</button>
              <button @click="tempPlayer.gender = 2" 
                      class="flex-1 h-9 rounded-lg text-xs font-bold transition-all"
                      :class="tempPlayer.gender === 2 ? 'bg-white text-red-500 shadow-sm' : 'text-slate-400'">{{ T.female }}</button>
            </div>
          </div>

          <div>
            <div class="flex justify-between items-center mb-1.5">
              <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">{{ T.initial_handicap }}</label>
              <span class="text-sm font-bold text-red-500">{{ tempPlayer.handicap }}</span>
            </div>
            <input v-model="tempPlayer.handicap" type="range" min="0" max="54" step="0.1" 
                   class="w-full accent-red-500" />
          </div>
        </div>

        <div class="flex gap-3 mt-8">
          <button @click="showDialog = false" class="flex-1 h-11 rounded-full bg-slate-100 text-slate-500 text-sm font-bold active:scale-95 transition-all">
            {{ T.cancel }}
          </button>
          <button @click="saveTempPlayer" class="flex-1 h-11 rounded-full bg-red-500 text-white text-sm font-bold shadow-lg shadow-red-500/20 active:scale-95 transition-all">
            {{ T.confirm }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
input[type="range"] {
  -webkit-appearance: none;
  height: 4px;
  background: #f1f5f9;
  border-radius: 2px;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  background: #ef4444;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
}
</style>
