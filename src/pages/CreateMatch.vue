<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Tab } from '@/types';
import { useMatchStore } from '@/store/matchStore';
import { useUserStore } from '@/store/userStore';
import { MatchManager } from '@/utils/match_manager';
import { courseCatalogData, courseCatalogStats } from '@/data/courseCatalog';
import { goBack, replaceRoute } from '@/utils/uniNav';
import { courseNeedsSectionCombo, sectionsForCoursePicker } from '@/utils/courseSections';
import { sortCoursesForPicker } from '@/utils/coursePickerSort';
import { kickoffTimeMs, matchListSortTimeMs } from '@/utils/matchKickoff';
import { getPickerLocationSync, resolvePickerLocation } from '@/utils/deviceLocationCache';
import { ensureWxSessionForCloud } from '@/utils/auth';
import { db } from '@/utils/db';
import PrivacyPopup from '@/components/PrivacyPopup.vue';
import MpPrivacyGateModal from '@/components/MpPrivacyGateModal.vue';
import { useMpPrivacyGate } from '@/composables/useMpPrivacyGate';

const matchStore = useMatchStore();
const userStore = useUserStore();

const {
  showPrivacyModal: showCreateMatchPrivacyModal,
  gatePrivacyBeforeCloud,
  onPrivacyModalAgree: onCreateMatchPrivacyAgree,
  onPrivacyModalDisagree: onCreateMatchPrivacyDisagree,
  openPrivacyContract: openCreateMatchPrivacyContract,
} = useMpPrivacyGate('[CreateMatch][privacy]');

const now = new Date();
const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const mo = date.getMonth() + 1;
  const d = date.getDate();
  const h = date.getHours();
  const min = date.getMinutes();
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${y}年${mo}月${d}日 ${p(h)}时${p(min)}分`;
};

/** 默认标题：已登录用昵称；未登录用「球局 + 日期时间」 */
function buildDefaultMatchTitle(): string {
  const nick = String(userStore.profile.nickname || '').trim();
  if (nick) return `${nick}的球局`;
  return `球局 ${formatDate(new Date())}`;
}

const matchName = ref(buildDefaultMatchTitle());
/** 用户手动改过标题后，不再被登录昵称覆盖 */
const matchNameTouched = ref(false);
const editingMatchId = ref('');

function isDefaultUntitledName(name: string): boolean {
  return /^球局 \d{4}年/.test(String(name || '').trim());
}

function refreshDefaultTitleIfNeeded() {
  if (matchNameTouched.value || editingMatchId.value) return;
  const nick = String(userStore.profile.nickname || '').trim();
  if (nick) {
    matchName.value = `${nick}的球局`;
    return;
  }
  if (isDefaultUntitledName(matchName.value)) {
    matchName.value = buildDefaultMatchTitle();
  }
}

watch(
  () => userStore.profile.nickname,
  () => {
    refreshDefaultTitleIfNeeded();
  },
);

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
const isEditMode = computed(() => editingMatchId.value !== '');
/** 小程序 scroll-view 需明确高度（px），overflow-y 在 view 上常无效 */
const coursePickerScrollPx = ref(420);

function flattenCourseCatalog(): any[] {
  const courses: any[] = [];
  Object.entries(courseCatalogData).forEach(([province, provinceCourses]) => {
    provinceCourses.forEach((c) => {
      const name = String(c?.name || '').trim();
      if (!name) return;
      courses.push({
        ...c,
        id: c.id || name,
        name,
        province,
        city: String(c.city || province || '').trim() || province,
        logo_url: `https://picsum.photos/seed/${encodeURIComponent(name)}/100/100`,
        latitude: c.latitude,
        longitude: c.longitude,
        holes: c.holes_par ? c.holes_par.map((par: number, i: number) => ({ no: i + 1, par })) : [],
      });
    });
  });
  return courses;
}

/** 全国球场扁平列表（模块级缓存，避免弹层内重复 flatten） */
const allCoursesFlat = flattenCourseCatalog();

const catalogStats = courseCatalogStats();

function onCourseSearchInput(e: { detail?: { value?: string } }) {
  searchKey.value = String(e?.detail?.value ?? '');
}

function courseMatchesSearch(c: { name?: string; city?: string; province?: string }, key: string): boolean {
  if (!key) return true;
  const name = String(c.name || '').toLowerCase();
  const city = String(c.city || '').toLowerCase();
  const province = String(c.province || '').toLowerCase();
  return name.includes(key) || city.includes(key) || province.includes(key);
}

const pickerLocation = ref<{ lat: number; lng: number }>(getPickerLocationSync());
const coursePlayCounts = ref<Record<string, number>>({});
const courseLastPlayedMs = ref<Record<string, number>>({});

async function loadCoursePlayCounts() {
  try {
    const list = await MatchManager.getMatchList();
    const counts: Record<string, number> = {};
    const lastMs: Record<string, number> = {};
    for (const m of Array.isArray(list) ? list : []) {
      const id = String(m?.course_id || '').trim();
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
      const t = kickoffTimeMs(m) ?? matchListSortTimeMs(m);
      if (t > 0) lastMs[id] = Math.max(lastMs[id] || 0, t);
    }
    coursePlayCounts.value = counts;
    courseLastPlayedMs.value = lastMs;
  } catch {
    coursePlayCounts.value = {};
    courseLastPlayedMs.value = {};
  }
}

watch(showCoursePicker, (open) => {
  if (!open) return;
  searchKey.value = '';
  try {
    const sys = uni.getSystemInfoSync();
    const winH = Number(sys.windowHeight) || 667;
    coursePickerScrollPx.value = Math.max(280, Math.floor(winH * 0.8 - 200));
  } catch {
    coursePickerScrollPx.value = 420;
  }
  pickerLocation.value = getPickerLocationSync();
  void resolvePickerLocation().then((loc) => {
    pickerLocation.value = loc;
  });
  void loadCoursePlayCounts();
});

const filteredCourses = computed(() => {
  const key = searchKey.value.trim().toLowerCase();
  const base = key ? allCoursesFlat.filter((c) => courseMatchesSearch(c, key)) : allCoursesFlat;
  let sorted: typeof allCoursesFlat;
  try {
    sorted = sortCoursesForPicker(base, {
      lat: pickerLocation.value?.lat,
      lng: pickerLocation.value?.lng,
      playCountById: coursePlayCounts.value,
      lastPlayedMsById: courseLastPlayedMs.value,
    });
  } catch (e) {
    console.warn('[CreateMatch] sortCoursesForPicker', e);
    sorted = [...base].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  if (!key) return sorted.slice(0, 100);
  return sorted;
});

const courseListHint = computed(() => {
  const total = catalogStats.courses;
  if (searchKey.value.trim()) {
    return `共 ${total} 座 · 匹配 ${filteredCourses.value.length} 条`;
  }
  return total > 100 ? `全国 ${total} 座 · 显示前 100 条，请搜索省份/城市/球场名` : `全国 ${total} 座球场`;
});

/** 半场组合弹层：多半场用 sections；标准 18 洞用合成的前 9 / 后 9 */
const createMatchSectionPickerList = computed(() => sectionsForCoursePicker(selectedCourse.value));

const showStandard18SectionHint = computed(() => {
  const c = selectedCourse.value;
  if (!c || Array.isArray(c.sections)) return false;
  return createMatchSectionPickerList.value.length === 2;
});

const selectCourse = (course: any) => {
  if (courseNeedsSectionCombo(course)) {
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
const minDate = '2020-01-01';
const maxDate = '2099-12-31';

function kickoffMsFromPicker(): number {
  const d = new Date(`${tempDate.value}T${tempTime.value}:00`);
  return Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
}

const onPickDate = (e: { detail?: { value?: string } }) => {
  const v = e.detail?.value;
  if (typeof v === 'string' && v) tempDate.value = v;
};

const onPickTime = (e: { detail?: { value?: string } }) => {
  const v = e.detail?.value;
  if (typeof v === 'string' && v) tempTime.value = v;
};

const confirmDateTime = () => {
  const d = new Date(`${tempDate.value}T${tempTime.value}:00`);
  kickoffTime.value = Number.isNaN(d.getTime()) ? formatDate(new Date()) : formatDate(d);
  showDateTimePicker.value = false;
};

const getHostPlayer = () => {
  const openId = String(userStore.openId || '').trim();
  return {
    id: openId || `host_${Date.now()}`,
    nickname: userStore.profile.nickname || '我',
    avatar: userStore.profile.avatar || '',
    handicap: userStore.profile.handicap || 0,
    role: '房主',
  };
};

function formatCloudSyncError(res: { step?: string; error?: string } | null): string {
  const step = String(res?.step || 'cloud').trim();
  const err = String(res?.error || 'unknown').trim();
  if (err === 'not_found') {
    return '登录未完成，请重试（errno:not_found）';
  }
  if (err === 'privacy_denied') {
    return '需同意隐私指引后再发布';
  }
  if (err === 'login_degraded_mock' || err === 'no_openId') {
    return '微信登录失败，请重启小程序（errno:login）';
  }
  return `云端同步失败（${step}:${err}）`;
}

const pickCourseByMatch = (match: any) => {
  const rawName = String(match?.course_name || match?.courseName || '').trim();
  if (!rawName) return null;
  const all = allCoursesFlat;
  const found = all.find((c) => rawName === c.name || rawName.startsWith(c.name));
  if (found) return found;
  const holes = Array.isArray(match?.hole_scores)
    ? match.hole_scores.map((h: any, idx: number) => ({ no: idx + 1, par: Number(h?.par || 4) }))
    : Array.from({ length: 18 }, (_, i) => ({ no: i + 1, par: 4 }));
  return {
    id: match?.course_id || rawName,
    name: rawName,
    city: '自定义',
    holes,
  };
};

const fillFromMatch = (match: any) => {
  matchName.value = String(match?.title || match?.course_name || '我的球局');
  const tm = match?.create_time ? new Date(match.create_time) : new Date();
  if (!Number.isNaN(tm.getTime())) {
    kickoffTime.value = formatDate(tm);
    tempDate.value = tm.toISOString().split('T')[0];
    tempTime.value = tm.toTimeString().split(' ')[0].slice(0, 5);
  }
  isPrivate.value = !!(match?.is_private === true || match?.is_private === 1);
  const roster = Array.isArray(match?.user_list) ? match.user_list : [];
  playerCount.value = Math.max(1, Math.min(8, roster.length || 1));
  selectedCourse.value = pickCourseByMatch(match);
};

onLoad((query) => {
  userStore.hydrateAuthFromStorage();
  void (async () => {
    try {
      await db.waitForInit();
      const session = await ensureWxSessionForCloud({ gatePrivacyBeforeCloud });
      if (session.ok && session.session) {
        userStore.applyAuthResult(session.session);
      }
      refreshDefaultTitleIfNeeded();
    } catch (e) {
      console.warn('[CreateMatch] onLoad session', e);
    }
  })();

  const mid = String(query?.match_id || '').trim();
  const mode = String(query?.mode || '').trim();
  if (!mid || mode !== 'edit') return;
  editingMatchId.value = mid;
  void MatchManager.getMatch(mid).then((match) => {
    if (match) fillFromMatch(match);
  });
});

/** 发布时本地注入虚拟球友（不依赖 getMatchTeammates 云拉取），与 GolfLive CreateGame 注入 players 思路一致 */
function buildVirtualPlayers(extraCount: number) {
  const n = Math.max(0, Math.min(7, Math.floor(extraCount)));
  const t = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `virtual_${t}_${i}`,
    nickname: `球友${i + 1}`,
    avatar: '',
    handicap: null as number | null,
  }));
}

const bumpPlayerCount = (delta: number) => {
  playerCount.value = Math.max(1, Math.min(8, playerCount.value + delta));
};

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

/** 发布球局：先云函数 upsert matches（保证好友 getMatch/joinMatch 可查），再本地 + db.saveMatch 对齐 */
function callCreateMatchCloud(data: Record<string, unknown>): Promise<{ success?: boolean; error?: string; upsert?: string } | null> {
  return new Promise((resolve) => {
    try {
      // #ifdef MP-WEIXIN
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'createMatch',
        data,
        success: (r: any) => resolve((r?.result as { success?: boolean; error?: string; upsert?: string }) ?? null),
        fail: (e: any) => {
          console.warn('[CreateMatch] cloud createMatch fail', e);
          resolve({ success: false, error: String(e?.errMsg || e || '') });
        },
      });
      // #endif
      // #ifndef MP-WEIXIN
      resolve(null);
      // #endif
    } catch (e) {
      console.warn('[CreateMatch] callCreateMatchCloud', e);
      resolve({ success: false, error: String(e) });
    }
  });
}

const handleBack = () => {
  goBack();
};

const handleStart = async () => {
  try {
    // #ifdef MP-WEIXIN
    const session = await ensureWxSessionForCloud({ gatePrivacyBeforeCloud });
    if (!session.ok) {
      uni.showToast({
        title: formatCloudSyncError(session),
        icon: 'none',
        duration: 2800,
      });
      console.warn('[CreateMatch] ensureWxSessionForCloud', session);
      return;
    }
    if (session.session) {
      userStore.applyAuthResult(session.session);
      refreshDefaultTitleIfNeeded();
    }
    // #endif

    if (isEditMode.value) {
      const oldMatch = await MatchManager.getMatch(editingMatchId.value);
      if (!oldMatch) {
        uni.showToast({ title: '比赛不存在', icon: 'none' });
        return;
      }
      oldMatch.title = matchName.value;
      oldMatch.create_time = kickoffMsFromPicker();
      oldMatch.is_private = isPrivate.value;
      oldMatch.match_meta_sync_ts = Date.now();
      if (selectedCourse.value) {
        oldMatch.course_name = selectedCourse.value.name;
        oldMatch.course_id = selectedCourse.value.id;
        const existed = Array.isArray(oldMatch.hole_scores) ? oldMatch.hole_scores : [];
        const holeTemplate = Array.isArray(selectedCourse.value.holes) ? selectedCourse.value.holes : [];
        oldMatch.hole_scores = holeTemplate.map((h: any, i: number) => ({
          scores: Array.isArray(existed[i]?.scores) ? existed[i].scores : Array.from({ length: playerCount.value }, () => 0),
          par: h.par,
        }));
      }
      await MatchManager.updateMatch(oldMatch);
      replaceRoute(Tab.SCORECARD, { match_id: oldMatch.match_id || editingMatchId.value });
      return;
    }

    const host = getHostPlayer();
    const virtuals = buildVirtualPlayers(playerCount.value - 1);
    const userList = [host, ...virtuals];
    const slotCount = userList.length;

    const newMatch = await MatchManager.createMatch(matchName.value, 1);
    newMatch.create_time = kickoffMsFromPicker();

    newMatch.user_list = userList;
    newMatch.is_private = isPrivate.value;

    if (selectedCourse.value) {
      newMatch.course_name = selectedCourse.value.name;
      newMatch.course_id = selectedCourse.value.id;
      newMatch.hole_scores = selectedCourse.value.holes.map((h: any) => ({
        scores: Array.from({ length: slotCount }, () => 0),
        par: h.par,
      }));
      newMatch.holes = selectedCourse.value.holes.map((h: any) => ({
        num: h.no,
        par: h.par,
      }));
    } else {
      newMatch.hole_scores = Array.from({ length: 18 }, () => ({
        scores: Array.from({ length: slotCount }, () => 0),
        par: 4,
      }));
    }
    newMatch.pk_rules_sync_ts = newMatch.pk_rules_sync_ts || Date.now();
    newMatch.match_meta_sync_ts = newMatch.match_meta_sync_ts || Date.now();

    const cloudPlayers = userList.map((p: { id: string; nickname: string; avatar?: string; handicap?: number }) => ({
      uid: p.id,
      nickName: p.nickname,
      avatarUrl: p.avatar || '',
      handicap: p.handicap ?? 0,
    }));

    // #ifdef MP-WEIXIN
    try {
      const cloudRes = await callCreateMatchCloud({
        match_id: newMatch.match_id,
        title: matchName.value || '我的球局',
        courseName: selectedCourse.value?.name || '',
        course_id: selectedCourse.value?.id || '',
        players: cloudPlayers,
        date: kickoffTime.value,
        is_private: isPrivate.value,
        hole_scores: newMatch.hole_scores,
        status: newMatch.status,
      });
      if (cloudRes && cloudRes.success === false) {
        uni.showToast({
          title: formatCloudSyncError(cloudRes),
          icon: 'none',
          duration: 3200,
        });
        console.warn('[CreateMatch] cloud createMatch', cloudRes);
      } else if (cloudRes?.success) {
        console.info('[CreateMatch] cloud createMatch ok', cloudRes);
      }
    } catch (e) {
      console.warn('[CreateMatch] cloud sync', e);
      uni.showToast({ title: '云端同步异常', icon: 'none' });
    }
    // #endif

    await MatchManager.updateMatch(newMatch);

    replaceRoute(Tab.SCORECARD, { match_id: newMatch.match_id });
  } catch (e) {
    console.warn('[CreateMatch] handleStart', e);
    try {
      uni.showToast({ title: '发布失败，请重试', icon: 'none' });
    } catch {
      /* ignore */
    }
  }
};
</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- #ifdef MP-WEIXIN -->
    <MpPrivacyGateModal
      :show="showCreateMatchPrivacyModal"
      @agree="onCreateMatchPrivacyAgree"
      @disagree="onCreateMatchPrivacyDisagree"
      @open-contract="openCreateMatchPrivacyContract"
    />
    <PrivacyPopup />
    <!-- #endif -->
    <!-- Header -->
    <div class="sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 px-4 py-3 flex items-center justify-between">
      <view @click="handleBack" class="w-10 h-10 flex items-center justify-center rounded-full active:bg-slate-200">
        <uni-icons type="left" :size="22" color="#1e293b" />
      </view>
      <h1 class="text-lg font-bold text-slate-900">{{ isEditMode ? '修改比赛' : '发布球局' }}</h1>
      <div class="w-10"></div>
    </div>

    <div class="px-4 mt-2">
      <!-- Match Details Form -->
      <div class="bg-white rounded-3xl overflow-hidden shadow-sm mb-6">
        <div class="p-4 border-b border-slate-50 flex items-center justify-between active:bg-slate-50 transition-colors">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <uni-icons type="flag" :size="16" color="#3b82f6" />
            </div>
            <span class="text-sm font-medium text-slate-700">比赛名称</span>
          </div>
          <div class="flex items-center gap-2">
            <input 
              v-model="matchName"
              type="text"
              class="mp-safe-input-inline text-sm font-bold text-slate-900 bg-transparent border-none text-right focus:outline-none focus:ring-0 py-1 min-w-0 flex-1"
              placeholder="请输入比赛名称"
              @input="matchNameTouched = true"
            />
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </div>
        </div>

        <div 
          @click="showDateTimePicker = true"
          class="p-4 border-b border-slate-50 flex items-center justify-between active:bg-slate-50 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center">
              <uni-icons type="calendar" :size="16" color="#a855f7" />
            </div>
            <span class="text-sm font-medium text-slate-700">开球时间</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900">{{ kickoffTime }}</span>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </div>
        </div>

        <div 
          @click="showCoursePicker = true"
          class="p-4 flex items-center justify-between active:bg-slate-50 transition-colors cursor-pointer"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
              <uni-icons type="location" :size="16" color="#22c55e" />
            </div>
            <span class="text-sm font-medium text-slate-700">选择球场</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-900 truncate max-w-[150px]">{{ selectedCourse?.name || '请选择球场' }}</span>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </div>
        </div>
      </div>

      <!-- 人数（含房主）：本地注入虚拟球友，无需拉取好友云函数 -->
      <div class="bg-white rounded-3xl p-4 shadow-sm mb-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
              <uni-icons type="person" :size="16" color="#d97706" />
            </div>
            <div>
              <span class="text-sm font-medium text-slate-700 block">球局人数</span>
              <span class="text-xs text-slate-400">除你外自动添加虚拟球友，记分卡可对位录入</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold active:bg-slate-200"
              @click="bumpPlayerCount(-1)"
            >−</button>
            <span class="text-lg font-black text-slate-900 w-8 text-center">{{ playerCount }}</span>
            <button
              type="button"
              class="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold active:bg-slate-200"
              @click="bumpPlayerCount(1)"
            >+</button>
          </div>
        </div>
      </div>

      <!-- Privacy -->
      <div class="bg-white rounded-3xl p-4 shadow-sm flex items-center justify-between mb-8">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
              <uni-icons type="locked" :size="16" color="#64748b" />
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
        class="w-full bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-600/30 active:scale-95 transition-all flex items-center justify-center"
      >
        {{ isEditMode ? '保存修改' : '发布并开球' }}
      </button>
    </div>

    <!-- Course Picker Modal -->
    <div v-if="showCoursePicker" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up h-[80vh] flex flex-col">
        <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6"></div>
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-bold text-slate-900">选择球场</h3>
          <view @click="showCoursePicker = false" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100">
            <uni-icons type="closeempty" :size="20" color="#94a3b8" />
          </view>
        </div>

        <div class="relative mb-2">
            <input
              type="text"
              :value="searchKey"
              confirm-type="search"
              adjust-position
              class="mp-safe-input-full w-full pl-12 pr-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-lime-400 font-medium text-slate-900"
              placeholder="搜索省份、城市或球场名"
              @input="onCourseSearchInput"
            />
          <view class="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
            <uni-icons type="search" :size="20" color="#94a3b8" />
          </view>
        </div>
        <p class="text-xs text-slate-400 mb-4 px-1">{{ courseListHint }}</p>

        <scroll-view
          scroll-y
          enable-flex
          class="no-scrollbar"
          :style="{ height: coursePickerScrollPx + 'px' }"
        >
          <view class="space-y-2 pb-2">
          <view
            v-for="course in filteredCourses"
            :key="course.id"
            @click="selectCourse(course)"
            class="flex items-center gap-4 p-3 rounded-2xl active:bg-slate-100 transition-colors"
          >
            <image :src="course.logo_url" class="w-12 h-12 rounded-xl object-cover shadow-sm" mode="aspectFill" />
            <view class="flex-1 min-w-0">
              <text class="font-bold text-slate-900 truncate block">{{ course.name }}</text>
              <text class="text-xs text-slate-500 block">{{ course.province }} · {{ course.city }}</text>
            </view>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </view>

          <view
            v-if="!searchKey && filteredCourses.length === 0"
            class="py-8 text-center text-sm text-slate-400"
          >
            球场列表加载异常，请重启小程序后重试
          </view>

          <!-- Fallback Option -->
          <view
            v-if="searchKey && filteredCourses.length === 0"
            @click="selectCourse({
              id: 'custom-indoor',
              name: searchKey + ' (室内练习场)',
              city: '自定义',
              total_par: 72,
              holes: Array.from({length: 18}, (_, i) => ({ no: i + 1, par: 4 }))
            })"
            class="flex items-center gap-4 p-3 rounded-2xl active:bg-slate-100 transition-colors border border-dashed border-slate-300"
          >
            <view class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <uni-icons type="search" :size="20" color="#94a3b8" />
            </view>
            <view class="flex-1 min-w-0">
              <text class="font-bold text-slate-900 truncate block">使用 "{{ searchKey }}" 作为室内练习场</text>
              <text class="text-xs text-slate-500 block">默认 18 洞全为 Par 4</text>
            </view>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
          </view>
          </view>
        </scroll-view>
      </div>
    </div>

    <!-- DateTime Picker Modal -->
    <div v-if="showDateTimePicker" class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div class="w-full max-w-md bg-white rounded-t-[40px] p-6 pb-10 animate-slide-up">
        <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6"></div>
        <div class="flex justify-between items-center mb-6">
          <h3 class="text-xl font-bold text-slate-900">选择开球时间</h3>
          <view @click="showDateTimePicker = false" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100">
            <uni-icons type="closeempty" :size="20" color="#94a3b8" />
          </view>
        </div>
        
        <div class="space-y-6">
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">日期</label>
            <picker mode="date" :value="tempDate" :start="minDate" :end="maxDate" @change="onPickDate">
              <view class="w-full p-5 bg-slate-50 rounded-3xl border-2 border-slate-100 font-bold text-slate-900">
                {{ tempDate }}
              </view>
            </picker>
          </div>
          
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">时间</label>
            <picker mode="time" :value="tempTime" start="00:00" end="23:59" @change="onPickTime">
              <view class="w-full p-5 bg-slate-50 rounded-3xl border-2 border-slate-100 font-bold text-slate-900">
                {{ tempTime }}
              </view>
            </picker>
          </div>
          
          <button 
            @click="confirmDateTime"
            class="w-full py-5 bg-slate-900 text-white rounded-3xl font-bold shadow-xl shadow-slate-200 active:scale-95 transition-all mt-4 flex items-center justify-center"
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
            <p v-if="showStandard18SectionHint" class="text-xs text-slate-500 mt-0.5">18 洞球场：可先选后九再选前九，数字表示击球顺序</p>
          </div>
          <view @click="showSectionPicker = false" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100">
            <uni-icons type="closeempty" :size="20" color="#94a3b8" />
          </view>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-8">
          <div 
            v-for="section in createMatchSectionPickerList" 
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
          class="w-full py-5 rounded-3xl font-bold shadow-xl transition-all flex items-center justify-center"
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
            <div v-if="matchStore.gameType === rule.id" class="w-6 h-6 rounded-full bg-lime-500 flex items-center justify-center">
              <uni-icons type="checkmarkempty" :size="14" color="#ffffff" />
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
