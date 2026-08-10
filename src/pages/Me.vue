<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { onShow } from '@dcloudio/uni-app';
// lucide removed — use uni-icons for WeChat compatibility
import { MatchManager } from '@/utils/match_manager';
import { formatMatchKickoffCn, kickoffTimeMs, matchListSortTimeMs } from '@/utils/matchKickoff';
import { formatMsToZhDate, formatMsToZhMonthDay } from '@/utils/formatDateZh';
import { useUserStore } from '@/store/userStore';
import { openRoute } from '@/utils/uniNav';
import { requirePrivacyAuthorizeAsync } from '@/utils/mpPrivacyBridge';
import { mpStaticAbsolute } from '@/utils/mpAssetPath';
import { safeMpAvatarImgSrc } from '@/utils/mpAvatarSrc';
import { getMpMatchListNavShellStyle } from '@/utils/mpCapsuleSafeInset';
import { MP_BATCH_CHECK_OFF, MP_BATCH_CHECK_ON, MP_BATCH_CHECK_ICON_COLOR } from '@/utils/mpBatchCheckStyle';
const userStore = useUserStore();
const profile = computed(() => userStore.profile);
const DEFAULT_AVATAR_URL = mpStaticAbsolute('tab/me.png');
const SHARE_CARD_POSTER_BG = mpStaticAbsolute('share-card.png');

const showEditProfile = ref(false);
const statsRange = ref<number>(10); // 10, 20, 30, 999
const matches = ref<any[]>([]);

const showDeleteModal = ref(false);
const matchToDelete = ref<string | null>(null);
const pendingMeDeleteIsHost = ref(false);

/** 与「打过的球场」聚合、筛选一致：有 course_id 时按 id，否则按名称 */
function matchCourseKey(m: any): string {
  const id = m?.course_id != null && String(m.course_id).trim() !== '' ? String(m.course_id).trim() : '';
  if (id) return `id:${id}`;
  const name = String(m?.course_name ?? m?.courseName ?? '').trim();
  if (name) return `name:${name}`;
  return 'name:__unknown';
}

function matchCourseDisplayName(m: any): string {
  const n = String(m?.course_name ?? m?.courseName ?? '').trim();
  return n || '未命名球场';
}

const confirmDelete = (matchId: string) => {
  matchToDelete.value = matchId;
  const victim = matches.value.find(
    (x) =>
      (x?.match_id != null && String(x.match_id) === String(matchId)) ||
      (x?._id != null && String(x._id) === String(matchId)),
  );
  pendingMeDeleteIsHost.value = victim ? MatchManager.isUserHostOfMatch(victim, userStore.openId) : false;
  showDeleteModal.value = true;
};

const executeDelete = async () => {
  if (!matchToDelete.value) return;
  const mid = matchToDelete.value;
  const victim = matches.value.find(
    (x) =>
      (x?.match_id != null && String(x.match_id) === String(mid)) ||
      (x?._id != null && String(x._id) === String(mid)),
  );
  const delKey = victim ? matchCourseKey(victim) : null;
  try {
    if (!userStore.openId) {
      uni.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    const isHost = pendingMeDeleteIsHost.value;
    if (isHost) {
      const r = await MatchManager.deleteHostedMatch(mid, userStore.openId);
      if (!r.ok) {
        uni.showToast({ title: '操作失败', icon: 'none' });
        return;
      }
      uni.showToast({
        title: r.cloudDeleted ? '已删除' : '已从列表移除',
        icon: 'success',
      });
    } else {
      const r = await MatchManager.leaveParticipantMatch(mid);
      if (!r.ok) {
        uni.showToast({ title: '操作失败', icon: 'none' });
        return;
      }
      uni.showToast({
        title: r.localOnly ? '已从列表移除' : '已退赛',
        icon: 'success',
      });
    }
  } finally {
    matches.value = await MatchManager.getMatchList();
    showDeleteModal.value = false;
    matchToDelete.value = null;
    pendingMeDeleteIsHost.value = false;
    if (delKey && selectedCourseKey.value === delKey) {
      const left = matches.value.filter((m) => matchCourseKey(m) === delKey).length;
      if (left === 0) selectedCourseKey.value = null;
    }
  }
};

const completedMatches = computed(() => {
  return matches.value.filter(m => {
    const scoredHoles = (m.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0));
    return scoredHoles.length >= 18;
  });
});

const averageHandicap = computed(() => {
  if (completedMatches.value.length === 0) return 0;
  const total = completedMatches.value.reduce((acc, m) => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    return acc + (score - 72); // Simple handicap calculation
  }, 0);
  return (total / completedMatches.value.length).toFixed(1);
});

const last10Handicap = computed(() => {
  const last10 = completedMatches.value.slice(0, 10);
  if (last10.length === 0) return 0;
  const total = last10.reduce((acc, m) => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    return acc + (score - 72);
  }, 0);
  return (total / last10.length).toFixed(1);
});

const playedCourses = computed(() => {
  const courseMap = new Map<
    string,
    { key: string; name: string; count: number; best: number; city: string; totalScore: number; completedCount: number }
  >();
  matches.value.forEach((m) => {
    const key = matchCourseKey(m);
    const displayName = matchCourseDisplayName(m);
    const scoredHoles = (m.hole_scores || []).filter((h) => (h.scores || []).some((s) => s > 0));
    const isCompleted = scoredHoles.length >= 18;
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);

    const existing = courseMap.get(key);
    if (existing) {
      existing.count++;
      if (isCompleted) {
        existing.best = existing.best === 0 ? score : Math.min(existing.best, score);
        existing.totalScore += score;
        existing.completedCount++;
      }
    } else {
      courseMap.set(key, {
        key,
        name: displayName,
        count: 1,
        best: isCompleted ? score : 0,
        totalScore: isCompleted ? score : 0,
        completedCount: isCompleted ? 1 : 0,
        city: '广东省 广州市',
      });
    }
  });
  return Array.from(courseMap.values())
    .map((c) => ({
      ...c,
      avgHandicap: c.completedCount > 0 ? ((c.totalScore / c.completedCount) - 72).toFixed(1) : '-',
    }))
    .sort((a, b) => b.count - a.count);
});

const scoreDistribution = computed(() => {
  const dist = [
    { label: '60+', count: 0, color: 'bg-lime-400' },
    { label: '70+', count: 0, color: 'bg-lime-500' },
    { label: '80+', count: 0, color: 'bg-blue-500' },
    { label: '90+', count: 0, color: 'bg-blue-600' },
    { label: '100+', count: 0, color: 'bg-slate-400' },
    { label: '110+', count: 0, color: 'bg-slate-600' }
  ];

  completedMatches.value.forEach(m => {
    const score = m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0);
    if (score < 70) dist[0].count++;
    else if (score < 80) dist[1].count++;
    else if (score < 90) dist[2].count++;
    else if (score < 100) dist[3].count++;
    else if (score < 110) dist[4].count++;
    else dist[5].count++;
  });

  return dist;
});

const matchesByKickoffDesc = computed(() => {
  const list = matches.value;
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => matchListSortTimeMs(b) - matchListSortTimeMs(a));
});

const recentScores = computed(() => {
  return completedMatches.value.slice(0, statsRange.value).map((m) => {
    const ms = kickoffTimeMs(m);
    return {
      date: ms != null && Number.isFinite(ms) ? formatMsToZhDate(ms) : '—',
      dateShort: ms != null && Number.isFinite(ms) ? formatMsToZhMonthDay(ms) : '—',
      score: m.hole_scores.reduce((sum: number, h: any) => sum + (h.scores[0] || 0), 0) || 80,
    };
  });
});

onMounted(async () => {
  matches.value = await MatchManager.getMatchList();
});

const currentSubPage = ref<'main' | 'history' | 'stats' | 'courses'>('main');

/** 在「打过的球场」内：选中的聚合键，非空时展示该球场下比赛列表 */
const selectedCourseKey = ref<string | null>(null);

const historyHeaderShell = ref<Record<string, string>>({});
const historyNavRowHeightPx = ref(44);
const historyCapsulePaddingRight = ref('16px');

onShow(() => {
  const r = getMpMatchListNavShellStyle();
  historyHeaderShell.value = r.shellStyle;
  historyNavRowHeightPx.value = r.navRowHeightPx;
  historyCapsulePaddingRight.value = r.capsulePaddingRight;
});

const selectedCourseTitle = computed(() => {
  if (!selectedCourseKey.value) return '';
  const row = playedCourses.value.find((c) => c.key === selectedCourseKey.value);
  return row?.name ?? '球场';
});

const matchesForSelectedCourse = computed(() => {
  if (!selectedCourseKey.value) return [];
  const k = selectedCourseKey.value;
  return matches.value
    .filter((m) => matchCourseKey(m) === k)
    .sort((a, b) => matchListSortTimeMs(b) - matchListSortTimeMs(a));
});

function openCourseMatches(courseKey: string) {
  selectedCourseKey.value = courseKey;
}

function closeCourseMatches() {
  selectedCourseKey.value = null;
}

function leaveCoursesPage() {
  selectedCourseKey.value = null;
  currentSubPage.value = 'main';
}

const handleNavigate = (page: 'main' | 'history' | 'stats' | 'courses') => {
  if (page === 'courses') selectedCourseKey.value = null;
  if (page === 'history') exitHistoryBatchMode();
  currentSubPage.value = page;
};

function normalizeMatchMid(m: unknown): string {
  if (!m || typeof m !== 'object') return '';
  const o = m as { match_id?: unknown; _id?: unknown; id?: unknown };
  const raw = o.match_id ?? o._id ?? o.id;
  return raw != null ? String(raw).trim() : '';
}

const historyBatchMode = ref(false);
const historySelectedMids = ref<string[]>([]);
const showBatchDeleteModal = ref(false);

function exitHistoryBatchMode() {
  historyBatchMode.value = false;
  historySelectedMids.value = [];
}

function toggleHistoryMidSelected(mid: string) {
  if (!mid) return;
  const i = historySelectedMids.value.indexOf(mid);
  if (i >= 0) historySelectedMids.value.splice(i, 1);
  else historySelectedMids.value.push(mid);
}

function isHistoryMidSelected(mid: string): boolean {
  return mid ? historySelectedMids.value.includes(mid) : false;
}

const historyListMids = computed(() =>
  matchesByKickoffDesc.value.map((m) => normalizeMatchMid(m)).filter(Boolean),
);

const historyAllSelected = computed(() => {
  const ids = historyListMids.value;
  if (ids.length === 0) return false;
  const sel = new Set(historySelectedMids.value);
  return ids.every((id) => sel.has(id));
});

function toggleHistorySelectAll() {
  if (historyAllSelected.value) {
    historySelectedMids.value = [];
  } else {
    historySelectedMids.value = [...historyListMids.value];
  }
}

function confirmBatchDelete() {
  if (historySelectedMids.value.length === 0) {
    uni.showToast({ title: '请先选择比赛', icon: 'none' });
    return;
  }
  showBatchDeleteModal.value = true;
}

async function executeBatchDelete() {
  if (!userStore.openId) {
    uni.showToast({ title: '请先登录', icon: 'none' });
    showBatchDeleteModal.value = false;
    return;
  }
  const mids = [...new Set(historySelectedMids.value)].filter(Boolean);
  showBatchDeleteModal.value = false;
  if (mids.length === 0) return;

  uni.showLoading({ title: '处理中…', mask: true });
  let okCount = 0;
  let failCount = 0;
  try {
    for (const mid of mids) {
      const victim = matches.value.find((x) => normalizeMatchMid(x) === mid);
      const isHost = victim ? MatchManager.isUserHostOfMatch(victim, userStore.openId) : false;
      if (isHost) {
        const r = await MatchManager.deleteHostedMatch(mid, userStore.openId);
        if (r.ok) okCount++;
        else failCount++;
      } else {
        const r = await MatchManager.leaveParticipantMatch(mid);
        if (r.ok) okCount++;
        else failCount++;
      }
    }
  } finally {
    uni.hideLoading();
  }

  matches.value = await MatchManager.getMatchList();
  exitHistoryBatchMode();

  if (selectedCourseKey.value) {
    const left = matches.value.filter((m) => matchCourseKey(m) === selectedCourseKey.value).length;
    if (left === 0) selectedCourseKey.value = null;
  }

  if (failCount === 0) {
    uni.showToast({ title: `已处理 ${okCount} 场`, icon: 'success' });
  } else {
    uni.showToast({ title: `成功 ${okCount} 场，失败 ${failCount}`, icon: 'none', duration: 2500 });
  }
}

function backFromHistoryPage() {
  exitHistoryBatchMode();
  currentSubPage.value = 'main';
}

/** 记分页跳转；管理模式下行点击为勾选 */
function onHistoryRowTap(match: any) {
  const mid = normalizeMatchMid(match);
  if (!mid) return;
  if (historyBatchMode.value) {
    toggleHistoryMidSelected(mid);
    return;
  }
  const rawId = match?.match_id != null ? match.match_id : mid;
  openRoute('SCORECARD', { match_id: rawId });
}

const editProfileData = ref({ ...userStore.profile });

const updateProfile = () => {
  userStore.updateProfile(editProfileData.value);
  showEditProfile.value = false;
};

const authDraftNickname = ref('');
const authDraftAvatarLocal = ref('');
const authDraftAvatarCloud = ref('');
const authSaving = ref(false);
const authReminderAccepted = ref(false);

const hasMpWechatProfile = computed(() => {
  const n = userStore.profile.nickname;
  return n != null && String(n).trim() !== '';
});

function openAuthReminder() {
  uni.showModal({
    title: '授权提醒',
    content: '我们需要获取您的公开信息以同步球局记录与好友资料。',
    confirmText: '继续',
    cancelText: '暂不',
    success: (res) => {
      void (async () => {
        if (!res.confirm) return;
        uni.showLoading({ title: '校验隐私指引…', mask: true });
        const okPrivacy = await requirePrivacyAuthorizeAsync();
        uni.hideLoading();
        if (!okPrivacy) {
          uni.showToast({ title: '需同意隐私保护指引后方可选用头像与昵称', icon: 'none', duration: 2800 });
          return;
        }
        authReminderAccepted.value = true;
        authDraftNickname.value = userStore.profile.nickname || '';
        authDraftAvatarLocal.value = userStore.profile.avatar || DEFAULT_AVATAR_URL;
        authDraftAvatarCloud.value = '';
      })();
    },
  });
}

function onNicknameInput(e: { detail?: { value?: string } }) {
  authDraftNickname.value = String(e.detail?.value ?? '');
}

async function onNicknameFocus() {
  // #ifdef MP-WEIXIN
  await requirePrivacyAuthorizeAsync();
  // #endif
}

async function uploadAvatarToCloud(tempPath: string): Promise<string> {
  // #ifdef MP-WEIXIN
  if (!tempPath || typeof wx === 'undefined' || !wx.cloud?.uploadFile) return '';
  try {
    if (typeof wx.cloud.init === 'function') {
      try {
        wx.cloud.init();
      } catch {
        /* App onLaunch db.init */
      }
    }
    const ext = tempPath.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const openId = userStore.openId || `guest_${Date.now()}`;
    const cloudPath = `avatars/${openId}_${Date.now()}.${ext}`;
    const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
    return String((res as { fileID?: string })?.fileID || '');
  } catch (e) {
    console.warn('[me] upload avatar fail', e);
    return '';
  }
  // #endif
  // #ifndef MP-WEIXIN
  return '';
  // #endif
}

async function onChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
  const tempPath = String(e?.detail?.avatarUrl || '').trim();
  if (!tempPath) {
    console.warn('[me] onChooseAvatar: empty avatarUrl');
    return;
  }
  // #ifdef MP-WEIXIN
  const ok = await requirePrivacyAuthorizeAsync();
  if (!ok) {
    uni.showToast({ title: '需同意隐私保护指引后才能选择头像', icon: 'none' });
    return;
  }
  // #endif
  uni.showLoading({ title: '上传头像中…', mask: true });
  try {
    authDraftAvatarLocal.value = tempPath;
    const fileId = await uploadAvatarToCloud(tempPath);
    if (fileId) {
      authDraftAvatarCloud.value = fileId;
      uni.showToast({ title: '头像已上传到云端', icon: 'success', duration: 1200 });
    } else {
      uni.showToast({ title: '云上传失败，请检查云开发配置后重试', icon: 'none', duration: 2500 });
    }
  } finally {
    uni.hideLoading();
  }
}

async function onProfileChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
  const tempPath = String(e?.detail?.avatarUrl || '').trim();
  if (!tempPath) {
    console.warn('[me] onProfileChooseAvatar: empty avatarUrl');
    return;
  }
  // #ifdef MP-WEIXIN
  const okPriv = await requirePrivacyAuthorizeAsync();
  if (!okPriv) {
    uni.showToast({ title: '需同意隐私保护指引后才能选择头像', icon: 'none' });
    return;
  }
  // #endif
  uni.showLoading({ title: '上传头像中…', mask: true });
  try {
    userStore.updateProfile({ avatar: tempPath });
    const fileId = await uploadAvatarToCloud(tempPath);
    const finalAvatar = fileId || tempPath;
    userStore.updateProfile({ avatar: finalAvatar });
    if (!fileId) {
      uni.showToast({ title: '云上传未成功，头像可能无法在真机长期保存', icon: 'none', duration: 2500 });
    } else {
      uni.showToast({ title: '头像已更新', icon: 'success', duration: 1500 });
    }
    // #ifdef MP-WEIXIN
    try {
      if (typeof wx !== 'undefined' && wx.cloud?.callFunction) {
        await new Promise<void>((resolve, reject) => {
          wx.cloud.callFunction({
            name: 'updateUserProfile',
            data: {
              nickName: userStore.profile.nickname || undefined,
              avatarUrl: fileId || finalAvatar,
            },
            success: () => resolve(),
            fail: (err: unknown) => reject(err),
          });
        });
      }
    } catch (e) {
      console.warn('[me] onProfileChooseAvatar cloud', e);
    }
    // #endif
  } finally {
    uni.hideLoading();
  }
}

async function confirmProfileAuth() {
  if (authSaving.value) return;
  const nickName = authDraftNickname.value.trim();
  if (!nickName) {
    uni.showToast({ title: '请先填写昵称', icon: 'none' });
    return;
  }
  let avatarUrl = '';
  // #ifdef MP-WEIXIN
  avatarUrl = authDraftAvatarCloud.value || '';
  if (authDraftAvatarLocal.value && !authDraftAvatarCloud.value) {
    uni.showLoading({ title: '正在上传头像…', mask: true });
    const fid = await uploadAvatarToCloud(authDraftAvatarLocal.value);
    uni.hideLoading();
    if (!fid) {
      uni.showToast({ title: '头像需上传至云存储后才能保存', icon: 'none' });
      return;
    }
    authDraftAvatarCloud.value = fid;
    avatarUrl = fid;
  } else if (!avatarUrl) {
    avatarUrl = userStore.profile.avatar || '';
  }
  // #endif
  // #ifndef MP-WEIXIN
  avatarUrl = authDraftAvatarCloud.value || authDraftAvatarLocal.value || userStore.profile.avatar || '';
  // #endif
  authSaving.value = true;
  uni.showLoading({ title: '同步资料…', mask: true });
  try {
    userStore.updateProfile({ nickname: nickName, avatar: avatarUrl });
    // #ifdef MP-WEIXIN
    if (typeof wx !== 'undefined' && wx.cloud?.callFunction) {
      await new Promise<void>((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'updateUserProfile',
          data: { nickName, avatarUrl: avatarUrl || undefined },
          success: () => resolve(),
          fail: (err: unknown) => reject(err),
        });
      });
    }
    // #endif
    uni.showToast({ title: '资料已更新', icon: 'success' });
  } catch (e) {
    console.warn('[me] confirmProfileAuth', e);
    uni.showToast({ title: '云端同步失败，请稍后重试', icon: 'none' });
  } finally {
    authSaving.value = false;
    uni.hideLoading();
  }
}

function formatMatchWhen(m: any, dateOnly = false): string {
  return formatMatchKickoffCn(m, dateOnly);
}

function getMatchTotalStrokes(m: any): number {
  const holeScores = Array.isArray(m?.hole_scores) ? m.hole_scores : [];
  return holeScores.reduce((sum: number, h: any) => sum + Number(h?.scores?.[0] || 0), 0);
}

</script>

<template>
  <div class="min-h-screen bg-slate-50 pb-24 safe-top">
    <!-- Main Profile Page -->
    <div v-if="currentSubPage === 'main'">
      <!-- Header / Profile Card -->
      <div class="bg-white px-6 pt-12 pb-8 rounded-b-[40px] shadow-sm relative overflow-hidden">
        <div class="absolute top-0 right-0 w-32 h-32 bg-lime-400/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
        
        <!-- #ifdef MP-WEIXIN -->
        <div class="flex items-center justify-between mb-8 pr-[90px]" v-if="!hasMpWechatProfile">
          <div class="flex items-center gap-4 w-full">
            <view v-if="!authReminderAccepted" class="flex-1">
              <h1 class="text-2xl font-black text-slate-900">未登录</h1>
              <button type="button" class="mt-2 text-sm px-4 py-2 rounded-full bg-[#07C160] text-white inline-flex" @tap="openAuthReminder">
                获取头像昵称
              </button>
            </view>
            <template v-else>
              <button plain hover-class="none" class="mp-choose-avatar-btn w-20 h-20 rounded-3xl border-2 border-dashed border-slate-300 p-0.5 shrink-0" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
                <image :src="authDraftAvatarLocal || DEFAULT_AVATAR_URL" mode="aspectFill" class="mp-choose-avatar-img w-full h-full rounded-3xl bg-slate-100" />
              </button>
              <view class="flex-1 flex flex-col gap-2">
                <h1 class="text-xl font-black text-slate-900">完善资料</h1>
                <input
                  type="nickname"
                  :value="authDraftNickname"
                  @input="onNicknameInput"
                  @change="onNicknameInput"
                  @focus="onNicknameFocus"
                  placeholder="填写昵称（可选微信昵称）"
                  class="me-input-native mp-nickname-input w-full bg-white border border-slate-200 rounded-xl text-sm text-slate-800"
                />
                <button type="button" class="me-btn-flex me-btn-confirm-inline text-xs px-3 py-1.5 rounded-full bg-[#07C160] text-white self-start" :disabled="authSaving" @tap="confirmProfileAuth">
                  {{ authSaving ? '提交中...' : '确认' }}
                </button>
              </view>
            </template>
          </div>
        </div>
        <div class="flex items-center justify-between mb-8 pr-[90px]" v-else>
          <div class="flex items-center gap-4">
            <div class="relative">
              <button plain hover-class="none" class="mp-choose-avatar-btn w-20 h-20 rounded-3xl border-2 border-white p-0" open-type="chooseAvatar" @chooseavatar="onProfileChooseAvatar">
                <image :src="safeMpAvatarImgSrc(profile.avatar, DEFAULT_AVATAR_URL)" mode="aspectFill" class="mp-choose-avatar-img w-20 h-20 rounded-3xl shadow-lg" />
              </button>
              <view @click="showEditProfile = true" class="absolute -bottom-1 -right-1 w-7 h-7 bg-slate-900 text-white rounded-full flex items-center justify-center border-2 border-white">
                <uni-icons type="gear" :size="14" color="#ffffff" />
              </view>
            </div>
            <div>
              <h1 class="text-2xl font-black text-slate-900">{{ profile.nickname }}</h1>
              <p class="text-xs text-slate-400 font-medium mt-1 flex items-center gap-1">
                <uni-icons type="wallet" :size="12" color="#94a3b8" /> ID: 50856
              </p>
            </div>
          </div>
        </div>
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <div class="flex items-center justify-between mb-8 pr-[90px]">
          <div class="flex items-center gap-4">
            <div class="relative">
              <image :src="safeMpAvatarImgSrc(profile.avatar, DEFAULT_AVATAR_URL)" mode="aspectFill" class="w-20 h-20 rounded-3xl border-4 border-white shadow-lg" />
              <view @click="showEditProfile = true" class="absolute -bottom-1 -right-1 w-7 h-7 bg-slate-900 text-white rounded-full flex items-center justify-center border-2 border-white">
                <uni-icons type="gear" :size="14" color="#ffffff" />
              </view>
            </div>
            <div>
              <h1 class="text-2xl font-black text-slate-900">{{ profile.nickname || 'Golfdate' }}</h1>
            </div>
          </div>
        </div>
        <!-- #endif -->
      </div>

      <!-- Stats Grid -->
      <div class="px-6 mt-8 grid grid-cols-4 gap-2 relative z-10">
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-xs font-bold text-slate-400 uppercase mb-1">场次</p>
          <p class="text-lg font-black text-slate-900">{{ matches?.filter(m => (m.hole_scores || []).filter(h => (h.scores || []).some(s => s > 0)).length >= 9).length || 0 }}</p>
        </div>
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-xs font-bold text-slate-400 uppercase mb-1">平均差点</p>
          <p class="text-lg font-black text-lime-600">{{ averageHandicap }}</p>
        </div>
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-xs font-bold text-slate-400 uppercase mb-1">近10场</p>
          <p class="text-lg font-black text-blue-600">{{ last10Handicap }}</p>
        </div>
        <div class="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 text-center">
          <p class="text-xs font-bold text-slate-400 uppercase mb-1">球场</p>
          <p class="text-lg font-black text-slate-900">{{ playedCourses.length }}</p>
        </div>
      </div>

      <!-- Menu List -->
      <div class="px-6 mt-8 space-y-3">
        <div @click="handleNavigate('history')" class="bg-white p-5 rounded-3xl flex items-center justify-between shadow-sm border border-slate-100 active:scale-[0.98] transition-all cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center">
              <uni-icons type="refreshempty" :size="24" color="#3b82f6" />
            </div>
            <div>
              <p class="font-bold text-slate-900">历史比赛</p>
              <p class="text-xs text-slate-400 font-medium">查看过往记分卡</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-300">{{ matches.length }}</span>
            <uni-icons type="right" :size="20" color="#e2e8f0" />
          </div>
        </div>

        <div @click="handleNavigate('stats')" class="bg-white p-5 rounded-3xl flex items-center justify-between shadow-sm border border-slate-100 active:scale-[0.98] transition-all cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-lime-50 rounded-2xl flex items-center justify-center">
              <uni-icons type="up" :size="24" color="#65a30d" />
            </div>
            <div>
              <p class="font-bold text-slate-900">最近成绩</p>
              <p class="text-xs text-slate-400 font-medium">分析近期发挥水平</p>
            </div>
          </div>
          <uni-icons type="right" :size="20" color="#e2e8f0" />
        </div>

        <div @click="handleNavigate('courses')" class="bg-white p-5 rounded-3xl flex items-center justify-between shadow-sm border border-slate-100 active:scale-[0.98] transition-all cursor-pointer">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center">
              <uni-icons type="location" :size="24" color="#a855f7" />
            </div>
            <div>
              <p class="font-bold text-slate-900">打过的球场</p>
              <p class="text-xs text-slate-400 font-medium">足迹遍布 {{ playedCourses.length }} 个球场</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-slate-300">{{ playedCourses.length }}</span>
            <uni-icons type="right" :size="20" color="#e2e8f0" />
          </div>
        </div>

      </div>
    </div>

    <!-- History Page (Info Cards) -->
    <div v-else-if="currentSubPage === 'history'" :class="historyBatchMode ? 'pb-40' : 'pb-24'">
      <div class="sticky top-0 relative bg-slate-50 z-20 border-b border-slate-100" :style="historyHeaderShell">
        <div class="relative w-full" :style="{ height: `${historyNavRowHeightPx}px`, paddingRight: historyCapsulePaddingRight }">
          <view
            class="absolute left-0 top-0 bottom-0 z-20 flex items-center active:opacity-80 -ml-1"
            hover-class="opacity-80"
            @tap="backFromHistoryPage"
            @click="backFromHistoryPage"
          >
            <uni-icons type="left" :size="20" color="#0f172a" />
            <span class="text-sm font-bold text-slate-900">返回</span>
          </view>
          <h1
            class="absolute inset-0 z-10 flex items-center justify-center px-[100px] text-base font-black text-slate-900 tracking-tight line-clamp-1 pointer-events-none text-center"
          >
            历史比赛
          </h1>
        </div>
        <div class="flex justify-end items-center pt-1 pb-2.5 pr-3">
          <view
            v-if="!historyBatchMode"
            class="text-sm font-black text-[#07C160] py-1.5 active:opacity-70"
            @tap="historyBatchMode = true"
            @click="historyBatchMode = true"
          >
            管理
          </view>
          <view
            v-else
            class="text-sm font-black text-slate-700 py-1.5 active:opacity-70"
            @tap="exitHistoryBatchMode"
            @click="exitHistoryBatchMode"
          >
            完成
          </view>
        </div>
      </div>

      <div class="p-4 space-y-4">
        <div
          v-for="match in matchesByKickoffDesc"
          :key="normalizeMatchMid(match)"
          @tap="onHistoryRowTap(match)"
          @click="onHistoryRowTap(match)"
          class="relative bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:opacity-90 overflow-hidden"
        >
          <image class="me-history-poster-bg" :src="SHARE_CARD_POSTER_BG" mode="aspectFill" />
          <view class="me-history-poster-mask" />
          <div class="flex items-start gap-2 relative z-[20]">
            <view
              v-if="historyBatchMode"
              class="shrink-0 pt-0.5"
              @tap.stop
              @click.stop
            >
              <view
                :style="
                  isHistoryMidSelected(normalizeMatchMid(match)) ? MP_BATCH_CHECK_ON : MP_BATCH_CHECK_OFF
                "
                @tap.stop="toggleHistoryMidSelected(normalizeMatchMid(match))"
                @click.stop="toggleHistoryMidSelected(normalizeMatchMid(match))"
              >
                <uni-icons
                  v-if="isHistoryMidSelected(normalizeMatchMid(match))"
                  type="checkmarkempty"
                  :size="14"
                  :color="MP_BATCH_CHECK_ICON_COLOR"
                />
              </view>
            </view>
            <div class="flex-1 min-w-0 flex flex-col gap-1">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1 relative z-[1]">
                  <h2 class="text-base font-black text-slate-900 truncate">{{ match.course_name || '未命名球场' }}</h2>
                  <p class="text-xs text-slate-500 mt-1">{{ formatMatchWhen(match, true) }}</p>
                </div>
                <view
                  v-if="!historyBatchMode"
                  class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50/90 text-slate-400 relative z-[1] shrink-0 active:opacity-80"
                  @tap.stop="confirmDelete(normalizeMatchMid(match))"
                  @click.stop="confirmDelete(normalizeMatchMid(match))"
                >
                  <uni-icons type="trash" :size="16" color="#94a3b8" />
                </view>
              </div>
              <div class="mt-3 pt-3 border-t border-slate-100/80 flex items-center justify-between relative z-[1]">
                <div class="text-xs text-slate-400">状态：{{ match.status === 2 ? '已完赛' : (match.status === 1 ? '进行中' : '未开始') }}</div>
                <div class="text-right">
                  <div class="text-xs text-slate-400">总杆</div>
                  <div class="text-xl font-black text-[#07C160]">{{ getMatchTotalStrokes(match) || '--' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <view
        v-if="historyBatchMode"
        class="fixed left-0 right-0 bottom-0 z-[100] bg-white/98 backdrop-blur-md border-t border-slate-100 flex items-stretch gap-3 px-4 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]"
        :style="{ paddingBottom: `calc(12px + env(safe-area-inset-bottom, 0px))` }"
      >
        <button
          type="button"
          class="flex-1 py-3.5 rounded-2xl bg-slate-100 text-slate-800 text-sm font-bold border-0 active:opacity-90"
          @tap="toggleHistorySelectAll"
          @click="toggleHistorySelectAll"
        >
          {{ historyAllSelected ? '取消全选' : '全选' }}
        </button>
        <button
          type="button"
          class="flex-1 py-3.5 rounded-2xl text-white text-sm font-bold border-0 active:opacity-90"
          :class="historySelectedMids.length === 0 ? 'bg-red-300' : 'bg-red-500'"
          :disabled="historySelectedMids.length === 0"
          @tap="confirmBatchDelete"
          @click="confirmBatchDelete"
        >
          删除（{{ historySelectedMids.length }}）
        </button>
      </view>
    </div>

    <!-- Stats Page -->
    <div v-else-if="currentSubPage === 'stats'" class="pb-24">
      <div class="sticky top-0 bg-white/90 backdrop-blur-xl z-20 px-6 py-4 flex items-center justify-between border-b border-slate-100">
        <view @click="currentSubPage = 'main'" class="flex items-center gap-1 text-slate-900 font-bold">
          <uni-icons type="left" :size="20" color="#0f172a" />
          <span>返回</span>
        </view>
        <h1 class="text-lg font-black text-slate-900 tracking-tight">成绩分析</h1>
        <div class="w-10"></div>
      </div>

      <div class="p-6 space-y-8">
        <!-- Range Selector -->
        <div class="flex bg-slate-100 p-1 rounded-2xl">
          <button v-for="r in [10, 20, 30, 'all']" :key="r"
                  @click="statsRange = r === 'all' ? 999 : r"
                  class="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                  :class="(statsRange === r || (r === 'all' && statsRange === 999)) ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'">
            {{ r === 'all' ? '全部' : r + '场' }}
          </button>
        </div>

        <!-- Score Chart -->
        <div class="bg-white rounded-[40px] p-8 shadow-sm border border-slate-100">
          <div class="flex items-center justify-between mb-10">
            <div>
              <h3 class="font-black text-slate-900 text-lg">总杆波动</h3>
              <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">成绩趋势</p>
            </div>
            <div class="w-12 h-12 bg-lime-50 rounded-2xl flex items-center justify-center">
              <uni-icons type="up" :size="24" color="#65a30d" />
            </div>
          </div>
          
          <div class="overflow-x-auto pb-6 -mx-2 scrollbar-hide">
            <div class="relative min-w-max px-8 h-56">
              <!-- SVG Line Chart -->
              <svg class="absolute inset-0 w-full h-full px-8 pointer-events-none" preserveAspectRatio="none">
                <path 
                  :d="recentScores.length > 1 ? `M ${recentScores.map((s, i) => `${i * 80 + 40},${180 - ((s.score - 60) / 60) * 140}`).join(' L ')}` : ''"
                  fill="none" 
                  stroke="url(#lineGradient)" 
                  stroke-width="3" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"
                  class="drop-shadow-[0_4px_8px_rgba(59,130,246,0.3)]"
                />
                <defs>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#a3e635;stop-opacity:1" />
                  </linearGradient>
                </defs>
              </svg>

              <div class="flex items-end h-full">
                <div v-for="(s, i) in recentScores" :key="i" class="flex flex-col items-center group relative z-10" style="width: 80px;">
                  <div class="relative flex flex-col items-center" :style="{ height: `${((s.score - 60) / 60) * 140 + 20}px` }">
                    <div class="absolute -top-10 bg-slate-900 text-white text-xs font-black px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20">
                      {{ s.score }} 杆
                    </div>
                    <!-- Dot -->
                    <div class="w-4 h-4 rounded-full border-4 border-white shadow-md transition-all group-hover:scale-125 group-hover:bg-lime-400"
                         :class="i === recentScores.length - 1 ? 'bg-lime-400' : 'bg-blue-500'">
                    </div>
                  </div>
                  <div class="flex flex-col items-center mt-4">
                    <span class="text-xs font-black text-slate-900">{{ s.score }}</span>
                    <span class="text-xs font-bold text-slate-300 mt-1">{{ s.dateShort }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Distribution -->
        <div class="bg-white rounded-[40px] p-8 shadow-sm border border-slate-100">
          <div class="flex items-center justify-between mb-10">
            <div>
              <h3 class="font-black text-slate-900 text-lg">杆数分布</h3>
              <p class="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">成绩分布</p>
            </div>
            <div class="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
              <uni-icons type="circle" :size="24" color="#2563eb" />
            </div>
          </div>

          <div class="space-y-6">
            <div v-for="item in scoreDistribution" :key="item.label" class="space-y-2">
              <div class="flex justify-between items-end">
                <span class="text-xs font-black text-slate-900">{{ item.label }}</span>
                <span class="text-xs font-black text-slate-400">{{ item.count }} 场</span>
              </div>
              <div class="h-3 bg-slate-50 rounded-full overflow-hidden">
                <div :class="['h-full rounded-full transition-all duration-1000', item.color]" 
                     :style="{ width: `${completedMatches.length > 0 ? (item.count / completedMatches.length) * 100 : 0}%` }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Courses Page -->
    <div v-else-if="currentSubPage === 'courses'" class="animate-in fade-in slide-in-from-right duration-300 pb-24">
      <div class="sticky top-0 bg-white/80 backdrop-blur-md z-20 px-4 py-3 flex items-center justify-between border-b border-slate-100">
        <view
          @click="selectedCourseKey ? closeCourseMatches() : leaveCoursesPage()"
          class="w-10 h-10 flex items-center justify-center rounded-full"
        >
          <uni-icons type="left" :size="24" color="#1e293b" />
        </view>
        <div class="min-w-0 flex-1 text-center px-2">
          <h1 class="text-lg font-bold text-slate-900 truncate">{{ selectedCourseKey ? selectedCourseTitle : '打过的球场' }}</h1>
          <p v-if="selectedCourseKey" class="text-xs text-slate-400 font-medium mt-0.5">{{ matchesForSelectedCourse.length }} 场比赛</p>
        </div>
        <div class="w-10"></div>
      </div>

      <div v-if="!selectedCourseKey" class="p-6 space-y-4">
        <div
          v-for="course in playedCourses"
          :key="course.key"
          class="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4 active:scale-[0.98] transition-all cursor-pointer"
          @click="openCourseMatches(course.key)"
        >
          <div class="w-16 h-16 bg-slate-100 rounded-2xl flex flex-col items-center justify-center shrink-0 border border-slate-200">
            <span class="text-xl font-black text-slate-900">{{ course.count }}</span>
            <span class="text-xs font-bold text-slate-400 uppercase">场次</span>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-bold text-slate-900 truncate text-sm">{{ course.name }}</h3>
            <p class="text-xs text-slate-400 mt-0.5">{{ course.city }}</p>
            <div class="flex items-center gap-3 mt-2">
              <span class="text-xs font-bold text-lime-600 bg-lime-50 px-2 py-0.5 rounded-full">最佳: {{ course.best || '-' }}</span>
              <span class="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">平均差点: {{ course.avgHandicap }}</span>
            </div>
          </div>
          <uni-icons type="right" :size="16" color="#e2e8f0" />
        </div>
      </div>

      <div v-else class="p-4 space-y-4">
        <div
          v-for="match in matchesForSelectedCourse"
          :key="match.match_id || match._id"
          @click="openRoute('SCORECARD', { match_id: match.match_id || match._id })"
          class="relative bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:opacity-90 overflow-hidden"
        >
          <image class="me-history-poster-bg" :src="SHARE_CARD_POSTER_BG" mode="aspectFill" />
          <view class="me-history-poster-mask" />
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1 relative z-[1]">
              <h2 class="text-base font-black text-slate-900 truncate">{{ match.title || match.course_name || '未命名球场' }}</h2>
              <p class="text-xs text-slate-500 mt-1">{{ formatMatchWhen(match, true) }}</p>
            </div>
            <view
              @click.stop="confirmDelete(match.match_id || match._id)"
              class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50/90 text-slate-400 relative z-[1]"
            >
              <uni-icons type="trash" :size="16" color="#94a3b8" />
            </view>
          </div>
          <div class="mt-3 pt-3 border-t border-slate-100/80 flex items-center justify-between relative z-[1]">
            <div class="text-xs text-slate-400">状态：{{ match.status === 2 ? '已完赛' : (match.status === 1 ? '进行中' : '未开始') }}</div>
            <div class="text-right">
              <div class="text-xs text-slate-400">总杆</div>
              <div class="text-xl font-black text-[#07C160]">{{ getMatchTotalStrokes(match) || '--' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Profile Modal -->
    <div v-if="showEditProfile" class="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="showEditProfile = false"></div>
      <div class="relative w-full max-w-sm bg-white rounded-[40px] p-8 shadow-2xl animate-in zoom-in duration-200">
        <h3 class="text-xl font-black text-center mb-8">编辑个人资料</h3>
        
        <div class="space-y-6">
          <div class="flex flex-col items-center mb-4">
            <div class="relative group">
              <image :src="safeMpAvatarImgSrc(profile.avatar, DEFAULT_AVATAR_URL)" mode="aspectFill" class="w-24 h-24 rounded-[32px] shadow-xl" />
              <div class="absolute inset-0 bg-black/20 rounded-[32px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <uni-icons type="camera" :size="24" color="#ffffff" />
              </div>
            </div>
            <p class="text-xs font-bold text-slate-400 mt-3 uppercase tracking-widest">点击更换头像</p>
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">昵称</label>
            <input v-model="editProfileData.nickname" type="text" class="me-input-native w-full bg-slate-50 rounded-2xl border-2 border-transparent focus:border-lime-500 focus:bg-white outline-none font-bold transition-all" />
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">性别</label>
            <div class="me-gender-segment flex bg-slate-50 p-1 rounded-2xl">
              <button @click="editProfileData.gender = 'male'" 
                      class="me-gender-btn flex-1 py-3 rounded-xl text-xs font-bold transition-all"
                      :class="editProfileData.gender === 'male' ? 'bg-white text-blue-500 shadow-sm' : 'text-slate-400'">男</button>
              <button @click="editProfileData.gender = 'female'" 
                      class="me-gender-btn flex-1 py-3 rounded-xl text-xs font-bold transition-all"
                      :class="editProfileData.gender === 'female' ? 'bg-white text-pink-500 shadow-sm' : 'text-slate-400'">女</button>
            </div>
          </div>
        </div>

        <div class="me-modal-action-row flex gap-3 mt-10">
          <button @click="showEditProfile = false" class="me-btn-flex flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold active:scale-95 transition-all">取消</button>
          <button @click="updateProfile" class="me-btn-flex flex-1 py-4 rounded-full bg-slate-900 text-white font-bold shadow-xl shadow-slate-200 active:scale-95 transition-all">保存</button>
        </div>
      </div>
    </div>
    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="fixed inset-0 bg-slate-900/40 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl">
        <h3 class="text-xl font-black text-slate-900 mb-2">{{ pendingMeDeleteIsHost ? '删除比赛' : '退赛' }}</h3>
        <p class="text-slate-500 text-sm mb-8">{{ pendingMeDeleteIsHost ? '将删除全场比赛与云端记分，他人无法再打开本场。确定继续？' : '将从本场名单移除你与成绩；比赛仍保留，其他球友可继续。' }}</p>
        <div class="me-modal-action-row flex gap-3">
          <button @click="showDeleteModal = false" class="me-btn-flex flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold active:scale-95 transition-all">取消</button>
          <button @click="executeDelete" class="me-btn-flex flex-1 py-4 rounded-full bg-red-500 text-white font-bold shadow-xl shadow-red-200 active:scale-95 transition-all">{{ pendingMeDeleteIsHost ? '删除' : '退赛' }}</button>
        </div>
      </div>
    </div>
    <!-- Batch delete confirmation -->
    <div v-if="showBatchDeleteModal" class="fixed inset-0 bg-slate-900/40 z-[210] flex items-center justify-center p-4 backdrop-blur-sm">
      <div class="bg-white rounded-[40px] p-8 w-full max-w-sm shadow-2xl">
        <h3 class="text-xl font-black text-slate-900 mb-2">批量删除</h3>
        <p class="text-slate-500 text-sm mb-8">
          已选 {{ historySelectedMids.length }} 场比赛。房主将从云端删除整场比赛及记分；参与者将仅退出并从你的列表移除。确定继续？
        </p>
        <div class="me-modal-action-row flex gap-3">
          <button @click="showBatchDeleteModal = false" class="me-btn-flex flex-1 py-4 rounded-full bg-slate-100 text-slate-500 font-bold active:scale-95 transition-all">取消</button>
          <button @click="executeBatchDelete" class="me-btn-flex flex-1 py-4 rounded-full bg-red-500 text-white font-bold shadow-xl shadow-red-200 active:scale-95 transition-all">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/** 真机：避免固定 height=line-height 与字重/系统字体叠加时裁切 */
.me-input-native {
  box-sizing: border-box;
  min-height: 90rpx;
  line-height: 48rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
}

.me-gender-segment {
  box-sizing: border-box;
  display: flex;
  justify-content: center;
  align-items: center;
}

.me-gender-segment .me-gender-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}

.me-modal-action-row {
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}

.me-btn-flex {
  display: flex;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}

.me-btn-confirm-inline::after {
  border: none !important;
}

.me-history-poster-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  opacity: 0.2;
}

.me-history-poster-mask {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(100deg, rgba(248, 250, 252, 0.94) 8%, rgba(248, 250, 252, 0.8) 46%, rgba(236, 253, 245, 0.7) 100%);
}
</style>
