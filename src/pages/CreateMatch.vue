<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { Tab } from '@/types';
import { useMatchStore } from '@/store/matchStore';
import { useUserStore } from '@/store/userStore';
import { MatchManager } from '@/utils/match_manager';
import { goBack, replaceRoute } from '@/utils/uniNav';
import {
  combinedHolesFromSections,
  courseBaseName,
  courseHalfOrderTitle,
  courseNeedsSectionCombo,
  formatCourseHalfOrderName,
  lookupCourseByIdOrName,
  resolveSelectedSections,
  sectionsForCoursePicker,
  splitStoredCourseHalfOrder,
} from '@/utils/courseSections';
import { ensureWxSessionForCloud } from '@/utils/auth';
import { db } from '@/utils/db';
import PrivacyPopup from '@/components/PrivacyPopup.vue';
import MpPrivacyGateModal from '@/components/MpPrivacyGateModal.vue';
import CreateMatchCoursePicker from '@/components/CreateMatchCoursePicker.vue';
import { useMpPrivacyGate } from '@/composables/useMpPrivacyGate';
import { coerceProfileHandicap } from '@/utils/simpleAverageHandicap';
import { stashScorecardPrefillFromIndex } from '@/utils/scorecardPrefill';

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
const kickoffTime = ref(formatDate(now));
const isPrivate = ref(false);
const showPKRules = ref(false);
const showDateTimePicker = ref(false);
const showCoursePicker = ref(false);
const showSectionPicker = ref(false);
const selectedCourse = ref<any>(null);
const selectedSections = ref<any[]>([]);
const isEditMode = computed(() => editingMatchId.value !== '');
const publishBtnLabel = computed(() => (isEditMode.value ? '保存修改' : '发布并开球'));
/** 防连点 / 异步发布过程中重复 handleStart */
const publishInFlight = ref(false);
const publishBtnText = computed(() => {
  if (publishInFlight.value) return isEditMode.value ? '保存中…' : '发布中…';
  return publishBtnLabel.value;
});

/** 半场组合弹层：多半场用 sections；标准 18 洞用合成的前 9 / 后 9 */
const createMatchSectionPickerList = computed(() => sectionsForCoursePicker(selectedCourse.value));

const showStandard18SectionHint = computed(() => {
  const c = selectedCourse.value;
  if (!c || Array.isArray(c.sections)) return false;
  return createMatchSectionPickerList.value.length === 2;
});

function isSameCourse(a: any, b: any) {
  if (!a || !b) return false;
  const aid = String(a.id || '').trim();
  const bid = String(b.id || '').trim();
  if (aid && bid && aid === bid) return true;
  return String(a.name || '') === String(b.name || '');
}

function remapSections(prev: any[], course: any) {
  const list = sectionsForCoursePicker(course);
  return prev
    .map((section) => list.find((item) => item.name === section?.name))
    .filter(Boolean);
}

/** 打开半场弹层前记下已确认的球场，取消时还原 */
let sectionPickerSnapshot: { course: any; sections: any[] } | null = null;

function beginSectionPicker(course: any, preset: any[]) {
  sectionPickerSnapshot = {
    course: selectedCourse.value,
    sections: [...selectedSections.value],
  };
  selectedCourse.value = course;
  selectedSections.value = preset;
  showSectionPicker.value = true;
  showCoursePicker.value = false;
}

function cancelSectionPicker() {
  if (sectionPickerSnapshot) {
    selectedCourse.value = sectionPickerSnapshot.course;
    selectedSections.value = sectionPickerSnapshot.sections;
  }
  sectionPickerSnapshot = null;
  showSectionPicker.value = false;
}

const selectCourse = (course: any) => {
  if (courseNeedsSectionCombo(course)) {
    const preset = isSameCourse(selectedCourse.value, course)
      ? remapSections(selectedSections.value, course)
      : [];
    beginSectionPicker(course, preset);
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
  if (selectedSections.value.length !== 2) return;
  sectionPickerSnapshot = null;
  showSectionPicker.value = false;
};

const selectedCourseTitle = computed(() => {
  const course = selectedCourse.value;
  if (!course?.name) return { base: '', suffix: '', full: '' };
  if (selectedSections.value.length === 2) {
    const base = courseBaseName(course, sectionsForCoursePicker(course));
    const first = selectedSections.value[0].name;
    const second = selectedSections.value[1].name;
    return {
      base,
      suffix: `${first}、${second}`,
      full: formatCourseHalfOrderName(base, first, second),
    };
  }
  const pars = Array.isArray(course.holes) ? course.holes.map((h: any) => Number(h?.par)) : [];
  return courseHalfOrderTitle(String(course.name), sectionsForCoursePicker(course), pars);
});

const sectionOrderHint = computed(() => {
  const list = selectedSections.value;
  if (!list.length) return '';
  if (list.length === 1) return `当前选择：前九 ${list[0].name}`;
  return `当前选择：前九 ${list[0].name}、后九 ${list[1].name}`;
});

function holeParsFromMatch(match: any): number[] {
  const rows = Array.isArray(match?.hole_scores) ? match.hole_scores : [];
  return rows.map((h: any) => Number(h?.par));
}

function packedCourseForSave(): { course_name: string; course_id: string; holes: { no: number; par: number }[] } | null {
  const course = selectedCourse.value;
  if (!course) return null;
  if (selectedSections.value.length === 2) {
    const base = courseBaseName(course, sectionsForCoursePicker(course));
    return {
      course_name: formatCourseHalfOrderName(
        base,
        selectedSections.value[0].name,
        selectedSections.value[1].name,
      ),
      course_id: String(course.id || ''),
      holes: combinedHolesFromSections(selectedSections.value),
    };
  }
  if (courseNeedsSectionCombo(course)) return null;
  const holes = Array.isArray(course.holes) && course.holes.length
    ? course.holes.map((h: any, i: number) => ({ no: Number(h?.no || i + 1), par: Number(h?.par || 4) }))
    : [];
  if (!holes.length) return null;
  return {
    course_name: String(course.name || ''),
    course_id: String(course.id || ''),
    holes,
  };
}

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
  const hcp = coerceProfileHandicap(userStore.profile.handicap);
  return {
    id: openId || `host_${Date.now()}`,
    nickname: userStore.profile.nickname || '我',
    avatar: userStore.profile.avatar || '',
    handicap: hcp != null ? hcp : 0,
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
  const courseId = String(match?.course_id || '').trim();
  if (!rawName && !courseId) return null;
  const found = lookupCourseByIdOrName(courseId, rawName);
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
  const course = pickCourseByMatch(match);
  selectedCourse.value = course;
  const rawName = String(match?.course_name || match?.courseName || '').trim();
  const list = course ? sectionsForCoursePicker(course) : [];
  const resolved = course ? resolveSelectedSections(rawName, holeParsFromMatch(match), list) : [];
  const split = splitStoredCourseHalfOrder(rawName);
  const resolvedLabel = resolved.length === 2 ? `${resolved[0].name}、${resolved[1].name}` : '';
  const storedLabel = split.halves ? `${split.halves[0]}、${split.halves[1]}` : '';
  const storedNamesConflict =
    resolved.length === 2 &&
    !!split.halves &&
    split.halves[0] !== split.halves[1] &&
    storedLabel !== resolvedLabel;
  selectedSections.value = storedNamesConflict ? [] : resolved;
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
  goBack();
};

const handleStart = async () => {
  if (publishInFlight.value) return;
  publishInFlight.value = true;
  try {
    uni.showLoading({ title: isEditMode.value ? '保存中…' : '发布中…', mask: true });
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
      oldMatch.create_time = new Date(kickoffMsFromPicker()).toISOString();
      oldMatch.is_private = isPrivate.value;
      oldMatch.match_meta_sync_ts = Date.now();
      const packed = packedCourseForSave();
      if (packed) {
        oldMatch.course_name = packed.course_name;
        oldMatch.courseName = packed.course_name;
        oldMatch.course_id = packed.course_id;
        const existed = Array.isArray(oldMatch.hole_scores) ? oldMatch.hole_scores : [];
        const slotCount = Math.max(1, Array.isArray(oldMatch.user_list) ? oldMatch.user_list.length : 1);
        oldMatch.hole_scores = packed.holes.map((h, i) => ({
          scores: Array.isArray(existed[i]?.scores) ? existed[i].scores : Array.from({ length: slotCount }, () => 0),
          par: h.par,
        }));
      }
      await MatchManager.updateMatch(oldMatch);
      stashScorecardPrefillFromIndex(oldMatch as Record<string, unknown>, {});
      replaceRoute(Tab.SCORECARD, { match_id: oldMatch.match_id || editingMatchId.value });
      return;
    }

    const host = getHostPlayer();
    const userList = [host];
    const slotCount = userList.length;

    const newMatch = await MatchManager.createMatch(matchName.value, 1);
    const kickoffMs = kickoffMsFromPicker();
    newMatch.create_time = new Date(kickoffMs).toISOString();

    newMatch.user_list = userList;
    newMatch.is_private = isPrivate.value;

    const packed = packedCourseForSave();
    if (packed) {
      newMatch.course_name = packed.course_name;
      newMatch.courseName = packed.course_name;
      newMatch.course_id = packed.course_id;
      newMatch.hole_scores = packed.holes.map((h) => ({
        scores: Array.from({ length: slotCount }, () => 0),
        par: h.par,
      }));
      newMatch.holes = packed.holes.map((h) => ({
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

    /** 只走 updateMatch→saveMatch→createMatch 一次 upsert，避免连调两次云函数竞态叉开 */
    await MatchManager.updateMatch(newMatch);
    stashScorecardPrefillFromIndex(newMatch as Record<string, unknown>, {});

    replaceRoute(Tab.SCORECARD, { match_id: newMatch.match_id });
  } catch (e) {
    console.warn('[CreateMatch] handleStart', e);
    try {
      uni.showToast({ title: '发布失败，请重试', icon: 'none' });
    } catch {
      /* ignore */
    }
  } finally {
    try {
      uni.hideLoading();
    } catch {
      /* ignore */
    }
    publishInFlight.value = false;
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
        <uni-icons type="left" :size="22" color="#334155" />
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
              class="mp-safe-input-inline text-sm font-bold text-slate-900 bg-transparent border-none text-right focus:outline-none focus:ring-0 min-w-0 flex-1"
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
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-bold text-slate-900 flex items-center min-w-0 max-w-[200px]">
              <template v-if="selectedCourse">
                <span class="truncate">{{ selectedCourseTitle.base }}</span>
                <span v-if="selectedCourseTitle.suffix" class="shrink-0">{{ selectedCourseTitle.suffix }}</span>
              </template>
              <span v-else class="truncate">请选择球场</span>
            </span>
            <uni-icons type="right" :size="16" color="#cbd5e1" />
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
        type="button"
        :disabled="publishInFlight"
        @click="handleStart"
        class="w-full bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-600/30 active:scale-95 transition-all flex items-center justify-center disabled:opacity-60 disabled:active:scale-100"
      >
        {{ publishBtnText }}
      </button>
    </div>

    <CreateMatchCoursePicker
      :show="showCoursePicker"
      @close="showCoursePicker = false"
      @select="selectCourse"
    />

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
            <p v-if="sectionOrderHint" class="text-xs text-emerald-700 mt-1 font-medium">{{ sectionOrderHint }}</p>
            <p v-if="showStandard18SectionHint" class="text-xs text-slate-500 mt-0.5">18 洞球场：可先选后九再选前九，数字表示击球顺序</p>
          </div>
          <view @click="cancelSectionPicker" class="w-10 h-10 flex items-center justify-center rounded-full bg-slate-100">
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
