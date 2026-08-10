<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { onShow, onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app';
import { Tab } from '@/types';
import { MatchManager } from '@/utils/match_manager';
import { useUserStore } from '@/store/userStore';
import { openRoute } from '@/utils/uniNav';
import { db } from '@/utils/db';
import { signInWithWeChat } from '@/utils/auth';
import {
  onPrivacyContractAgreed,
  getPrivacyNeedAuthorizationAsync,
  emitPrivacyContractAgreed,
} from '@/utils/mpPrivacyBridge';
import { mpStaticAbsolute } from '@/utils/mpAssetPath';
import { hydratePlayerAvatarsInMatchList, mergeRosterAvatarFieldsIntoUserList, safeMpAvatarImgSrc, stripCloudAvatarsInMatchList, stripCloudAvatarFieldsInRoster } from '@/utils/mpAvatarSrc';
import { hydrateMatchListRostersFromUserProfiles } from '@/utils/mpMatchListRosterHydrate';
import { resolveCloudAvatarsInMatchList } from '@/utils/rosterAvatarDisplay';
import { resolveCloudFileIdToHttps, isWxCloudFileId } from '@/utils/mpCloudFileUrl';
import { formatMatchKickoffCn } from '@/utils/matchKickoff';
import { golfHoleMarkKind, type GolfHoleMarkKind } from '@/utils/golfScoreShapes';
const DEFAULT_AVATAR_URL = mpStaticAbsolute('tab/me.png');
const SHARE_CARD_POSTER_BG = mpStaticAbsolute('share-card.png');

const userStore = useUserStore();

/** 本机头像 cloud:// → 临时 https（勿直接绑 <image>） */
const selfAvatarDisplay = ref('');
const selfAvatarSrc = computed(() =>
  safeMpAvatarImgSrc(selfAvatarDisplay.value || userStore.profile.avatar, DEFAULT_AVATAR_URL),
);

async function refreshSelfAvatarDisplay() {
  const raw = String(userStore.profile.avatar || '').trim();
  if (!raw) {
    selfAvatarDisplay.value = '';
    return;
  }
  if (isWxCloudFileId(raw)) {
    selfAvatarDisplay.value = (await resolveCloudFileIdToHttps(raw)) || '';
  } else {
    selfAvatarDisplay.value = raw;
  }
}

async function hydrateIndexMatchAvatars(list: unknown[]) {
  if (!Array.isArray(list) || list.length === 0) return;
  await hydrateMatchListRostersFromUserProfiles(list);
  await hydratePlayerAvatarsInMatchList(list);
  await resolveCloudAvatarsInMatchList(list);
  stripCloudAvatarsInMatchList(list);
  await rebuildMatchAvatarDisplayMap(list);
}

/** 自定义导航页：内容从胶囊按钮下方开始，避免刘海/挖孔挡住问候语 */
const indexTopPad = ref('');
function syncIndexTopPadForMenu() {
  // #ifdef MP-WEIXIN
  try {
    const m = uni.getMenuButtonBoundingClientRect();
    if (m && typeof m.bottom === 'number' && m.bottom > 0) {
      indexTopPad.value = `${Math.ceil(m.bottom) + 8}px`;
      return;
    }
  } catch {
    /* ignore */
  }
  // #endif
  indexTopPad.value = '';
}
const matches = ref<any[]>([]);
/** 比赛列表 roster 头像 https 缓存（key: match_id:playerId） */
const matchAvatarDisplayMap = ref<Record<string, string>>({});

function rosterPlayerKey(p: unknown): string {
  if (!p || typeof p !== 'object') return '';
  const o = p as Record<string, unknown>;
  return String(o.uid ?? o.id ?? o.openId ?? o.openid ?? '').trim();
}

function rosterPlayerAvatarSrc(p: unknown, match: unknown): string {
  const pid = rosterPlayerKey(p);
  const mid =
    match && typeof match === 'object'
      ? String((match as Record<string, unknown>).match_id ?? (match as Record<string, unknown>).id ?? '').trim()
      : '';
  const cached = mid && pid ? matchAvatarDisplayMap.value[`${mid}:${pid}`] : '';
  if (cached && cached.startsWith('https://')) return cached;
  return DEFAULT_AVATAR_URL;
}

async function rebuildMatchAvatarDisplayMap(list: unknown[]) {
  const next: Record<string, string> = { ...matchAvatarDisplayMap.value };
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const mid = String(row.match_id ?? row.id ?? '').trim();
    if (!mid) continue;
    const roster = matchAvatarStripRoster(m);
    for (const p of roster) {
      const pid = rosterPlayerKey(p);
      if (!pid) continue;
      const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      const av = String(o.avatar ?? o.avatarUrl ?? '').trim();
      if (av.startsWith('https://') && !av.includes('cloud://')) {
        next[`${mid}:${pid}`] = av;
      }
    }
  }
  matchAvatarDisplayMap.value = next;
}

function buildHomeShareTitle(): string {
  const n = (userStore.profile.nickname && String(userStore.profile.nickname).trim()) || '球友';
  return `${n}邀请你使用Golfdate计分助手`;
}

/** 仅带 inviter，便于落地首页；不包含 match_id，避免无球局却显示「参加球局」 */
function buildHomeSharePath(): string {
  const uid = userStore.openId || '';
  if (!uid) return 'pages/index/index';
  return `pages/index/index?inviter=${encodeURIComponent(uid)}`;
}

function buildHomeShareTimelineQuery(): string {
  const uid = userStore.openId || '';
  if (!uid) return '';
  return `inviter=${encodeURIComponent(uid)}`;
}

/** 不传 imageUrl：微信使用当前页面截图作为分享卡片图（与常见小程序一致） */
onShareAppMessage(() => ({
  title: buildHomeShareTitle(),
  path: buildHomeSharePath(),
}));

onShareTimeline(() => ({
  title: buildHomeShareTitle(),
  query: buildHomeShareTimelineQuery(),
}));

/** 模拟器或未授权 / 未同意隐私协议时静默展示，不在 onLoad 调 getLocation */
/** 固定参考坐标（不使用设备定位）；label 为天气卡片展示的实际城市名 */
const MOCK_LOCATION = { latitude: 23.1291, longitude: 113.3239, label: 'Guangzhou · 广州' };
const MOCK_LOCATION_SH = { label: '上海·模拟' };

const weatherAreaLabel = ref(MOCK_LOCATION.label);
/**  errno 112 等场景下展示，不弹窗 */
const weatherLocationHint = ref('');
const weatherHigh = ref('27');
const weatherLow = ref('21');

function applyMockWeatherSilently() {
  try {
    weatherAreaLabel.value = MOCK_LOCATION.label;
    weatherHigh.value = '27';
    weatherLow.value = '21';
  } catch (e) {
    console.warn('[index] applyMockWeatherSilently', e);
  }
}

function applyShanghaiWeatherMock() {
  try {
    weatherAreaLabel.value = MOCK_LOCATION_SH.label;
    weatherHigh.value = '25';
    weatherLow.value = '19';
  } catch (e) {
    console.warn('[index] applyShanghaiWeatherMock', e);
  }
}

function getLocationFailErrno(err: unknown): number | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  const e = err as { errno?: number; errMsg?: string; message?: string };
  if (typeof e.errno === 'number') return e.errno;
  const msg = String(e.errMsg ?? e.message ?? '');
  const m = msg.match(/errno\s*[：:=]?\s*(\d+)/i);
  if (m) return Number(m[1]);
  return undefined;
}

/** errno 112/103/104：隐私未同意或未授权，严禁弹窗，仅 warn + Mock */
function applyLocationMockForErrno(errno: number | undefined) {
  if (errno === 112) {
    weatherLocationHint.value = '位置权限审核中，已显示默认天气';
    console.warn('[index] getLocation：隐私指引审核中或未同意（errno 112），使用广州·天河区模拟天气');
    applyMockWeatherSilently();
    return;
  }
  if (errno === 104) {
    weatherLocationHint.value = '请同意隐私指引后使用定位';
    console.warn('[index] getLocation：未同意隐私指引（errno 104），使用模拟天气');
    applyMockWeatherSilently();
    return;
  }
  if (errno === 103) {
    weatherLocationHint.value = '位置未授权，已显示默认天气';
    console.warn('[index] getLocation：权限未授权（errno 103），使用上海模拟天气');
    applyShanghaiWeatherMock();
    return;
  }
  weatherLocationHint.value = '';
  applyMockWeatherSilently();
}

/** 微信公众平台审核通过仍需客户端 consent；半屏 Modal + agreePrivacyAuthorization 闭环 */
const showPrivacyModal = ref(false);
/** 本场已点过「同意」（避免 getPrivacySetting 未及时更新时反复卡死） */
const indexPrivacyUserAgreedFlag = ref(false);
let privacyModalResolve: ((ok: boolean) => void) | null = null;
let privacyGateInFlight: Promise<boolean> | null = null;

function getPrivacySettingWxLogged(): Promise<{ needAuthorization: boolean }> {
  console.log('[index][privacy] getPrivacySetting: step=before_call');
  // #ifdef MP-WEIXIN
  return new Promise((resolve) => {
    try {
      const gw = wx as unknown as {
        getPrivacySetting?: (o: {
          success?: (r: { needAuthorization?: boolean }) => void;
          fail?: (err: unknown) => void;
          complete?: () => void;
        }) => void;
      };
      if (!gw?.getPrivacySetting) {
        console.log('[index][privacy] getPrivacySetting: unsupported → no need');
        resolve({ needAuthorization: false });
        return;
      }
      gw.getPrivacySetting({
        success: (res) => {
          console.log('[index][privacy] getPrivacySetting: success_cb', JSON.stringify(res));
          resolve({ needAuthorization: !!res?.needAuthorization });
        },
        fail: (err) => {
          console.log('[index][privacy] getPrivacySetting: fail_cb', err);
          resolve({ needAuthorization: true });
        },
        complete: () => {
          console.log('[index][privacy] getPrivacySetting: complete_cb');
        },
      });
    } catch (e) {
      console.log('[index][privacy] getPrivacySetting: exception', e);
      resolve({ needAuthorization: true });
    }
  });
  // #endif
  // #ifndef MP-WEIXIN
  return Promise.resolve({ needAuthorization: false });
  // #endif
}

/** await：未同意则 showPrivacyModal，仅 @agreeprivacyauthorization 后继续 */
async function gateIndexPrivacyBeforeLogin(): Promise<boolean> {
  // #ifndef MP-WEIXIN
  return true;
  // #endif
  // #ifdef MP-WEIXIN
  if (privacyGateInFlight) {
    console.log('[index][privacy] gate: reuse in-flight');
    return privacyGateInFlight;
  }
  console.log('[index][privacy] gate: start');
  const { needAuthorization } = await getPrivacySettingWxLogged();
  if (!needAuthorization) {
    console.log('[index][privacy] gate: needAuthorization=false');
    return true;
  }
  if (indexPrivacyUserAgreedFlag.value) {
    console.log('[index][privacy] gate: session flag already agreed');
    return true;
  }
  privacyGateInFlight = new Promise<boolean>((resolve) => {
    privacyModalResolve = (ok: boolean) => {
      console.log('[index][privacy] gate: resolve ok=', ok);
      showPrivacyModal.value = false;
      privacyModalResolve = null;
      privacyGateInFlight = null;
      if (ok) indexPrivacyUserAgreedFlag.value = true;
      resolve(ok);
    };
    console.log('[index][privacy] gate: showPrivacyModal=true');
    showPrivacyModal.value = true;
  });
  return privacyGateInFlight;
  // #endif
}

function onIndexPrivacyModalAgree(e?: { detail?: { errMsg?: string } }) {
  console.log('[index][privacy] @agreeprivacyauthorization', JSON.stringify(e?.detail ?? {}));
  const msg = e?.detail?.errMsg ?? '';
  if (msg && !String(msg).includes('ok')) {
    console.log('[index][privacy] agree: non-ok msg, treat as fail');
    privacyModalResolve?.(false);
    return;
  }
  try {
    emitPrivacyContractAgreed();
  } catch (err) {
    console.log('[index][privacy] emitPrivacyContractAgreed fail', err);
  }
  privacyModalResolve?.(true);
}

function onIndexPrivacyModalDisagree() {
  console.log('[index][privacy] disagree tap');
  privacyModalResolve?.(false);
}

const authDraftNickname = ref('');
const authDraftAvatarLocal = ref('');
const authDraftAvatarCloud = ref('');
const authSaving = ref(false);
/** 半屏「同步资料」浮层（仅点「登录/同步资料」时显示） */
const profileSyncSheetOpen = ref(false);
/** 昵称聚焦时滚到底部按钮，避免键盘/微信昵称条遮挡 */
const profileSyncScrollInto = ref<string | undefined>(undefined);

function scrollProfileSheetToSubmit() {
  profileSyncScrollInto.value = undefined;
  nextTick(() => {
    profileSyncScrollInto.value = 'profile-sync-submit-anchor';
    setTimeout(() => {
      profileSyncScrollInto.value = undefined;
    }, 480);
  });
}

/** 打开微信官方《小程序隐私保护指引》全文 */
function openPrivacyContractForIndex() {
  // #ifdef MP-WEIXIN
  try {
    const gw = wx as unknown as { openPrivacyContract?: (o?: { success?: () => void; fail?: (e: unknown) => void }) => void };
    if (typeof gw.openPrivacyContract === 'function') {
      gw.openPrivacyContract({});
    } else {
      uni.showToast({ title: '当前基础库暂不支持打开指引', icon: 'none' });
    }
  } catch {
    uni.showToast({ title: '无法打开隐私指引', icon: 'none' });
  }
  // #endif
}

async function openProfileSyncSheet() {
  try {
    console.log('[index] openProfileSyncSheet step=enter');
    await Promise.race([
      db.waitForInit(),
      new Promise<void>((r) => setTimeout(r, 5000)),
    ]);
    console.log('[index] openProfileSyncSheet step=after_db_wait');
    // #ifdef MP-WEIXIN
    const gateOk = await gateIndexPrivacyBeforeLogin();
    console.log('[index] openProfileSyncSheet step=after_gate', gateOk);
    if (!gateOk) {
      uni.showToast({ title: '需同意隐私指引后再同步资料', icon: 'none' });
      return;
    }
    if (!userStore.openId) {
      console.log('[index] openProfileSyncSheet step=before_signIn');
      try {
        const auth = await signInWithWeChat();
        userStore.applyAuthResult(auth);
        console.log('[index] openProfileSyncSheet step=after_signIn', !!(auth?.openId ?? auth));
      } catch (e) {
        console.warn('[index] openProfileSyncSheet login', e);
      }
    }
    if (!userStore.openId) {
      uni.showToast({ title: '请先完成微信登录', icon: 'none' });
      return;
    }
    // #endif
    authDraftNickname.value = userStore.profile.nickname || '';
    authDraftAvatarLocal.value = userStore.profile.avatar || DEFAULT_AVATAR_URL;
    authDraftAvatarCloud.value = '';
    const av = String(userStore.profile.avatar || '').trim();
    if (av.startsWith('cloud://')) {
      authDraftAvatarCloud.value = av;
    }
    profileSyncSheetOpen.value = true;
  } catch (e) {
    console.warn('[index] openProfileSyncSheet', e);
    uni.showToast({ title: '暂时无法打开，请稍后重试', icon: 'none' });
  }
}

function closeProfileSyncSheet() {
  profileSyncSheetOpen.value = false;
}

/**
 * 解析或创建 users 文档 _id（与云控制台 doc().update 一致）
 */
async function ensureCloudUserDocumentId(): Promise<string> {
  // #ifdef MP-WEIXIN
  if (!userStore.openId || typeof wx === 'undefined' || !wx.cloud?.database) return '';
  if (userStore.cloudUserDocId) return userStore.cloudUserDocId;
  const wxdb = wx.cloud.database();
  const snap = await wxdb.collection('users').where({ _openid: userStore.openId }).limit(1).get();
  const id0 = snap.data?.[0]?._id;
  if (id0 != null && String(id0).trim() !== '') {
    const id = String(id0);
    userStore.setCloudUserDocId(id);
    return id;
  }
  const addRes = (await wxdb.collection('users').add({
    data: {
      _openid: userStore.openId,
      openid: userStore.openId,
      nickName: '',
      avatarUrl: '',
      handicap: 0,
      gender: 0,
      city: '',
      updated_at: wxdb.serverDate(),
      created_at: wxdb.serverDate(),
    },
  })) as { _id?: string };
  const newId = addRes._id ? String(addRes._id) : '';
  if (newId) userStore.setCloudUserDocId(newId);
  return newId;
  // #endif
  // #ifndef MP-WEIXIN
  return '';
  // #endif
}

/**
 * 仅更新 users（无 players 等其他集合）。
 * 等价：wx.cloud.database().collection('users').doc(userStore.uid).update(...)
 */
async function syncUsersProfileToCloudDb(partial: { nickName?: string; avatarUrl?: string }) {
  // #ifdef MP-WEIXIN
  await db.waitForInit();
  if (!userStore.openId || typeof wx === 'undefined' || !wx.cloud?.database) return;
  const docId = await ensureCloudUserDocumentId();
  if (!docId) {
    console.warn('[index] syncUsersProfileToCloudDb: no users doc id');
    return;
  }
  const wxdb = wx.cloud.database();
  const data: Record<string, unknown> = { updated_at: wxdb.serverDate() };
  if (partial.nickName != null) data.nickName = String(partial.nickName).trim();
  if (partial.avatarUrl != null) data.avatarUrl = String(partial.avatarUrl).trim();
  await wxdb.collection('users').doc(docId).update({ data });
  // #endif
}

function onNicknameInput(e: { detail?: { value?: string } }) {
  authDraftNickname.value = String(e.detail?.value ?? '');
}

async function uploadAvatarToCloud(tempPath: string): Promise<string> {
  // #ifdef MP-WEIXIN
  if (!tempPath || typeof wx === 'undefined' || !wx.cloud?.uploadFile) return '';
  try {
    if (typeof wx.cloud.init === 'function') {
      try {
        wx.cloud.init();
      } catch {
        /* 已在 App onLaunch db.init */
      }
    }
    const ext = tempPath.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const openId = userStore.openId || `guest_${Date.now()}`;
    const cloudPath = `avatars/${openId}_${Date.now()}.${ext}`;
    const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
    return String((res as { fileID?: string })?.fileID || '');
  } catch (e) {
    console.warn('[index] upload avatar fail', e);
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
    console.warn('[index] onChooseAvatar: empty avatarUrl, event=', e);
    return;
  }
  // #ifdef MP-WEIXIN
  console.log('[index] onChooseAvatar step=gating');
  const gateOk = await gateIndexPrivacyBeforeLogin();
  if (!gateOk) {
    console.log('[index] onChooseAvatar blocked by gate');
    uni.showToast({ title: '请先同意隐私指引', icon: 'none' });
    return;
  }
  console.log('[index] onChooseAvatar step=start_upload');
  // #endif
  uni.showLoading({ title: '上传头像中…', mask: true });
  try {
    authDraftAvatarLocal.value = tempPath;
    const fileId = await uploadAvatarToCloud(tempPath);
    if (fileId) {
      authDraftAvatarCloud.value = fileId;
      userStore.updateProfile({ avatar: fileId });
      void refreshSelfAvatarDisplay();
      // #ifdef MP-WEIXIN
      try {
        await syncUsersProfileToCloudDb({ avatarUrl: fileId });
      } catch (e) {
        console.warn('[index] onChooseAvatar users update', e);
        uni.showToast({ title: '数据库更新失败', icon: 'none' });
        return;
      }
      // #endif
      uni.showToast({ title: '头像已保存', icon: 'success', duration: 1600 });
    } else {
      uni.showToast({ title: '云上传失败，请检查云开发配置', icon: 'none', duration: 2500 });
    }
  } finally {
    uni.hideLoading();
  }
}

async function onProfileChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
  const tempPath = String(e?.detail?.avatarUrl || '').trim();
  if (!tempPath) {
    console.warn('[index] onProfileChooseAvatar: empty avatarUrl');
    return;
  }
  // #ifdef MP-WEIXIN
  console.log('[index] onProfileChooseAvatar step=gating');
  const gateOk = await gateIndexPrivacyBeforeLogin();
  if (!gateOk) {
    console.log('[index] onProfileChooseAvatar blocked');
    uni.showToast({ title: '请先同意隐私指引后再换头像', icon: 'none' });
    return;
  }
  console.log('[index] onProfileChooseAvatar step=start_upload');
  // #endif
  uni.showLoading({ title: '上传头像中…', mask: true });
  try {
    const fileId = await uploadAvatarToCloud(tempPath);
    const finalAvatar = fileId || tempPath;
    userStore.updateProfile({ avatar: finalAvatar });
    void refreshSelfAvatarDisplay();
    if (!fileId) {
      uni.showToast({ title: '云上传失败，头像可能无法在真机长期保存', icon: 'none', duration: 2500 });
      return;
    }
    uni.showToast({ title: '头像已保存', icon: 'success', duration: 1400 });
    // #ifdef MP-WEIXIN
    try {
      await syncUsersProfileToCloudDb({ avatarUrl: fileId });
    } catch (e) {
      console.warn('[index] onProfileChooseAvatar db', e);
      uni.showToast({ title: '云端保存失败', icon: 'none' });
    }
    // #endif
  } finally {
    uni.hideLoading();
  }
}

async function onNicknameFocus() {
  // #ifdef MP-WEIXIN
  console.log('[index] onNicknameFocus step=gating');
  const ok = await gateIndexPrivacyBeforeLogin();
  if (!ok) {
    console.log('[index] onNicknameFocus blocked');
  }
  scrollProfileSheetToSubmit();
  // #endif
}

async function onNicknameBlur(e: { detail?: { value?: string } }) {
  const v = String(e.detail?.value ?? '').trim();
  authDraftNickname.value = v;
  if (!v) return;
  // #ifdef MP-WEIXIN
  userStore.updateProfile({ nickname: v });
  try {
    await syncUsersProfileToCloudDb({ nickName: v });
  } catch (err) {
    console.warn('[index] onNicknameBlur users update', err);
    uni.showToast({ title: '昵称同步失败', icon: 'none' });
  }
  // #endif
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
    void refreshSelfAvatarDisplay();
    // #ifdef MP-WEIXIN
    await syncUsersProfileToCloudDb({ nickName, avatarUrl: avatarUrl || undefined });
    // #endif
    uni.showToast({ title: '资料已更新', icon: 'success' });
    profileSyncSheetOpen.value = false;
  } catch (e) {
    console.warn('[index] confirmProfileAuth sync', e);
    uni.showToast({ title: '云端同步失败，请稍后重试', icon: 'none' });
  } finally {
    authSaving.value = false;
    uni.hideLoading();
  }
}

/** 小程序：已有微信昵称则视为资料就绪（不用手动输入昵称） */
const hasMpWechatProfile = computed(() => {
  const n = userStore.profile.nickname;
  return n != null && String(n).trim() !== '';
});

async function refreshLocationWeather() {
  /** 不使用设备定位；展示固定参考城市名称（与坐标一致），避免暴露用户位置 */
  weatherLocationHint.value = '';
  weatherAreaLabel.value = MOCK_LOCATION.label;
  const lat = MOCK_LOCATION.latitude;
  const lng = MOCK_LOCATION.longitude;
  const ok = await fetchOpenMeteoWeather(lat, lng);
  if (!ok) {
    applyMockWeatherSilently();
  }
}
/** 云端/存储刷新进行中，computed 可跳过重计算 */
const matchListLoading = ref(false);

/** 与 MatchManager / db 一致：历史键 golf_match_list；列表快照 matches */
const MATCH_LIST_STORAGE_KEY = 'golf_match_list';
const MATCHES_QUICK_KEY = 'matches';

/** 顶部轻量提示 */
const offlineBannerText = ref('');
const showOfflineBanner = computed(() => offlineBannerText.value.length > 0);

function readMatchesFromStorage(): any[] {
  try {
    const quick = uni.getStorageSync(MATCHES_QUICK_KEY);
    if (Array.isArray(quick)) return db.filterHiddenFromMatchRows(quick);
    const raw = uni.getStorageSync(MATCH_LIST_STORAGE_KEY);
    if (Array.isArray(raw)) return db.filterHiddenFromMatchRows(raw);
  } catch (e) {
    console.warn('[index] 读取本地缓存失败', e);
  }
  return [];
}

function matchAvatarStripRoster(m: any): any[] {
  if (!m || typeof m !== 'object') return [];
  mergeRosterAvatarFieldsIntoUserList(m as Record<string, unknown>);
  const ul = Array.isArray(m.user_list) ? m.user_list : [];
  const pl = Array.isArray(m.players) ? m.players : [];
  const roster = ul.length > 0 ? ul : pl.length > 0 ? pl : [];
  stripCloudAvatarFieldsInRoster(roster);
  return roster;
}

/** 开赛/设定开球时间（非最后编辑） */
function formatMatchWhen(m: any, dateOnly = false): string {
  return formatMatchKickoffCn(m, dateOnly);
}

async function fetchOpenMeteoWeather(lat: number, lng: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      uni.request({
        url: `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=Asia%2FShanghai`,
        method: 'GET',
        success: (res) => {
          const data = res.data as Record<string, unknown> | null;
          const cur = data?.current as Record<string, unknown> | undefined;
          const daily = data?.daily as Record<string, unknown> | undefined;
          const t = cur?.temperature_2m;
          const tmax = daily?.temperature_2m_max;
          const tmin = daily?.temperature_2m_min;
          if (typeof t === 'number') {
            weatherHigh.value = String(Math.round(t));
            weatherLow.value =
              Array.isArray(tmin) && typeof tmin[0] === 'number'
                ? String(Math.round(tmin[0]))
                : String(Math.max(0, Math.round(t) - 6));
            if (Array.isArray(tmax) && typeof tmax[0] === 'number') {
              weatherHigh.value = String(Math.round(tmax[0]));
            }
            resolve(true);
            return;
          }
          resolve(false);
        },
        fail: () => resolve(false),
      });
    } catch {
      resolve(false);
    }
  });
}

/** 首次 onShow 紧跟 onLoad，跳过重复拉取 */
let isFirstShow = true;

let loadMatchesBusy = false;
const loadMatches = async (opts?: { showLoading?: boolean }) => {
  if (loadMatchesBusy) return;
  loadMatchesBusy = true;
  const showLoading = opts?.showLoading === true;
  matchListLoading.value = showLoading;
  if (showLoading) {
    try { uni.showLoading({ title: '加载中…', mask: false }); } catch { /* */ }
  }
  offlineBannerText.value = '';
  try {
    const list = await MatchManager.getMatchList();
    const deduped = Array.isArray(list) ? list : [];
    await hydrateIndexMatchAvatars(deduped);
    matches.value = [...deduped];
    console.info('[index] loadMatches 完成，共', matches.value.length, '条');
    if (matches.value.length === 0) {
      offlineBannerText.value = '暂无比赛 · 可创建新局';
    }
  } catch (e) {
    console.warn('[index] loadMatches 异常', e);
    matches.value = readMatchesFromStorage();
    await hydrateIndexMatchAvatars(matches.value);
    matches.value = [...matches.value];
    offlineBannerText.value = '加载异常 · 已显示本机缓存';
  } finally {
    matchListLoading.value = false;
    loadMatchesBusy = false;
    if (showLoading) {
      try { uni.hideLoading(); } catch { /* */ }
    }
  }
};

onLoad((options?: Record<string, string | undefined>) => {
  syncIndexTopPadForMenu();
  /** ① 同步播种基础 UI（首行逻辑）：列表占位 + 默认天气，严禁 await 云数据库 */
  try {
    const cached = readMatchesFromStorage();
    stripCloudAvatarsInMatchList(cached);
    matches.value = cached;
    void hydrateIndexMatchAvatars(matches.value).then(() => {
      matches.value = [...matches.value];
    });
  } catch {
    matches.value = [];
  }
  applyMockWeatherSilently();

  try {
    const inviter = options?.inviter;
    const matchId = options?.match_id;
    if (inviter || matchId) {
      uni.setStorageSync('share_invite', {
        inviter: inviter ? String(inviter) : '',
        match_id: matchId ? String(matchId) : '',
      });
    }
  } catch (e) {
    console.warn('[index] share_invite 写入失败', e);
  }

  /** 隐私仅注册回调；errno 112 等只在 getLocation fail 内处理，不中断页面生命周期 */
  onPrivacyContractAgreed(() => {
    try {
      void refreshLocationWeather();
    } catch (e) {
      console.warn('[index] refresh after privacy agree', e);
    }
  });

  /** ④ 登录 → 身份诊断 → users 静默拓荒 → 拉列表（signIn 前必须经过 gateIndexPrivacyBeforeLogin） */
  void nextTick(async () => {
    // #ifdef MP-WEIXIN
    await db.waitForInit();
    console.log('[index][privacy] onLoad bootstrap before gate');
    const gated = await gateIndexPrivacyBeforeLogin();
    console.log('[index][privacy] onLoad bootstrap after gate', gated);
    if (!gated) {
      console.log('[index][privacy] onLoad: deferred signIn until privacy agreed');
      return;
    }
    // #endif
    // ── Step 1: 调用 login 云函数拿 openId ──
    let myOpenId = userStore.openId || '';
    if (!myOpenId) {
      console.log('[index] onLoad calling signInWithWeChat');
      try {
        const auth = await signInWithWeChat();
        userStore.applyAuthResult(auth);
        myOpenId = auth?.openId || '';
      } catch (e) {
        console.warn('[index] signInWithWeChat', e);
      }
      console.log('[index] onLoad signIn finished openId=', myOpenId || '(empty)');
    }
    console.log('[身份诊断] 当前 OpenID:', myOpenId || '(空，降级 mock 模式)');

    // #ifdef MP-WEIXIN
    if (myOpenId) {
      try {
        const wxdb = wx.cloud.database();
        const userSnap = await wxdb.collection('users').where({ _openid: myOpenId }).limit(1).get();
        if (!userSnap.data || userSnap.data.length === 0) {
          console.log('[拓荒] users 表无此用户，自动写入...');
          const addRet = (await wxdb.collection('users').add({
            data: {
              _openid: myOpenId, openid: myOpenId,
              nickName: '', avatarUrl: '', handicap: 0,
              gender: 0, city: '',
              updated_at: wxdb.serverDate(), created_at: wxdb.serverDate(),
            },
          })) as { _id?: string };
          if (addRet._id) userStore.setCloudUserDocId(String(addRet._id));
          console.log('[拓荒] ✅ users 写入成功');
        } else {
          const row = userSnap.data[0] as Record<string, unknown>;
          const rid = row._id != null ? String(row._id) : '';
          if (rid) userStore.setCloudUserDocId(rid);
          const nn = row.nickName ?? row.nickname;
          const av = row.avatarUrl ?? row.avatar;
          if (nn != null && String(nn).trim() !== '') {
            userStore.updateProfile({ nickname: String(nn).trim() });
          }
          if (av != null && String(av).trim() !== '') {
            userStore.updateProfile({ avatar: String(av).trim() });
          }
          void refreshSelfAvatarDisplay();
          console.log('[诊断] users OK, nickName:', row.nickName || '(未设置)');
        }
      } catch (e: any) {
        console.warn('[拓荒] users 操作失败', e?.errMsg || e);
      }
    }
    // #endif

    void loadMatches({ showLoading: false });
  });
});

/** 从子页返回、切回 Tab 时刷新；首屏由 onLoad 负责 */
onShow(() => {
  syncIndexTopPadForMenu();
  greetingI18n.value = getTimeGreeting();
  void getPrivacyNeedAuthorizationAsync()
    .then((needAuth) => {
      if (!needAuth) {
        try {
          void refreshLocationWeather();
        } catch (e) {
          console.warn('[index] refreshLocation onShow', e);
        }
      }
    })
    .catch((e) => console.warn('[index] getPrivacyNeedAuthorizationAsync', e));

  if (isFirstShow) {
    isFirstShow = false;
    return;
  }
  void loadMatches({ showLoading: false });
});

/** 列表项稳定 key：优先 match_id，避免 undefined 重复 */
function matchRowKey(m: any, index: number): string {
  const id = m?.match_id ?? m?._id ?? m?.id;
  if (id != null && String(id) !== '') return String(id);
  return `match-row-${index}`;
}

/** 首页「当前比赛 / 历史比赛」区块各只展示条数；有条目时显示「全部」进入全列表页 */
const HOME_MATCH_SECTION_LIMIT = 5;

const HOLE_IDX_RANGE = Array.from({ length: 18 }, (_, i) => i);

/** 历史卡片总杆差：相对标准杆之和（仅统计已记杆洞） */
function getMatchTotalParDiffDisplay(m: any): string {
  const holeScores = Array.isArray(m?.hole_scores) ? m.hole_scores : [];
  let diff = 0;
  let hasAny = false;
  for (let i = 0; i < holeScores.length; i++) {
    const h = holeScores[i];
    const score = Number(h?.scores?.[0] || 0);
    const par = Number(h?.par ?? 4);
    if (score > 0) {
      hasAny = true;
      diff += score - par;
    }
  }
  if (!hasAny) return '—';
  if (diff === 0) return '0';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/** 首页历史条 Strip：每洞样式与 scorecard 「杆差格」同一套记号（颜色/外形） */
type HoleMiniCell = { kind: GolfHoleMarkKind; text: string };

function getHoleMiniDisplay(m: any, holeIndex: number): HoleMiniCell {
  const hs = Array.isArray(m?.hole_scores) ? m.hole_scores : [];
  const hole = hs[holeIndex];
  if (!hole) return { kind: 'empty', text: '-' };
  const score = Number(hole?.scores?.[0] || 0);
  const par = Number(hole?.par ?? 4);
  const kind = golfHoleMarkKind(score, par);
  if (kind === 'empty') return { kind, text: '-' };
  const d = score - par;
  const text = d === 0 ? '0' : d > 0 ? `+${d}` : `${d}`;
  return { kind, text };
}

function getHistoryHoleStrip(m: any): HoleMiniCell[] {
  return HOLE_IDX_RANGE.map((i) => getHoleMiniDisplay(m, i));
}

const ongoingMatches = computed(() => {
  const list = Array.isArray(matches.value) ? matches.value : [];
  if (list.length === 0) return [];
  return list.filter((m) => m && typeof m === 'object' && (m.status === 1 || m.status === 0));
});

const historyMatches = computed(() => {
  const list = Array.isArray(matches.value) ? matches.value : [];
  if (list.length === 0) return [];
  return list.filter((m) => m && typeof m === 'object' && m.status === 2);
});

const ongoingMatchesPreview = computed(() =>
  ongoingMatches.value.slice(0, HOME_MATCH_SECTION_LIMIT),
);

const historyMatchesPreview = computed(() =>
  historyMatches.value.slice(0, HOME_MATCH_SECTION_LIMIT),
);

/** 加载中或空列表不做嵌套洞/杆遍历，限制考察条数降低开销 */
const HCP_SCAN_MAX = 24;

const averageHandicap = computed(() => {
  if (!Array.isArray(matches.value) || matches.value.length === 0) return '—';
  if (matchListLoading.value) return '—';
  const list = matches.value;

  const slice = list.slice(0, HCP_SCAN_MAX);
  const completed = slice.filter((m) => {
    if (!m || typeof m !== 'object') return false;
    const holeScores = Array.isArray(m.hole_scores) ? m.hole_scores : [];
    if (holeScores.length < 18) return false;
    let ok = 0;
    for (let i = 0; i < 18; i++) {
      const h = holeScores[i];
      if (!h || !Array.isArray(h.scores)) continue;
      if (h.scores.some((s) => Number(s) > 0)) ok++;
    }
    return ok >= 18;
  });
  if (completed.length === 0) return '—';

  let total = 0;
  for (const m of completed) {
    const holeScores = Array.isArray(m.hole_scores) ? m.hole_scores : [];
    let sum = 0;
    for (let i = 0; i < holeScores.length; i++) {
      const h = holeScores[i];
      sum += h?.scores?.[0] != null ? Number(h.scores[0]) : 0;
    }
    total += sum - 72;
  }
  return (total / completed.length).toFixed(1);
});

// Helper to handle potential object-based translations (prevents [object Object])
const t = (val: any) => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.zh || val.en || JSON.stringify(val);
  return val;
};

/** 本地时段：5–12 早安，12–18 午安，其余 晚安 */
function getTimeGreeting(): { zh: string; en: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { zh: '早安', en: 'Good Morning' };
  if (h >= 12 && h < 18) return { zh: '午安', en: 'Good Afternoon' };
  return { zh: '晚安', en: 'Good Evening' };
}

const greetingI18n = ref(getTimeGreeting());

// Global translation object as requested
const T = {
  hcp: { zh: '差点', en: 'HCP' },
  weather: { zh: '多云 · 适宜击球', en: 'Cloudy · Good for Golf' },
  wind: { zh: '风力 0-3级', en: 'Wind 0-3' },
  uv: { zh: '紫外线: 弱', en: 'UV: Low' },
  createMatch: { zh: '创建比赛', en: 'Create Match' },
  startNewRound: { zh: '开始新的一轮', en: 'Start new round' },
  matchSquare: { zh: '赛事广场', en: 'Match Square' },
  viewNearby: { zh: '查看附近赛事', en: 'View nearby' },
  ongoingMatch: { zh: '当前比赛', en: 'Current rounds' },
  historyMatch: { zh: '历史比赛', en: 'History' },
  viewAll: { zh: '全部', en: 'All' },
  live: { zh: '正在进行', en: 'LIVE' },
  finished: { zh: '已结束', en: 'FINISHED' },
  enterScore: { zh: '进入记分', en: 'Enter Score' },
  viewResult: { zh: '查看成绩', en: 'View Result' }
};

const handleNavigate = (tab: Tab, params?: Record<string, any>) => {
  openRoute(tab, params);
};

/** 独立列表页：不走「我的」Tab */
function openCurrentRoundsFullList() {
  handleNavigate(Tab.MATCH_HISTORY_LIST, { mode: 'live' });
}

function openHistoryRoundsFullList() {
  handleNavigate(Tab.MATCH_HISTORY_LIST);
}

const showDeleteModal = ref(false);
const matchToDelete = ref<string | null>(null);
const pendingDeleteIsHost = ref(false);

function isMatchHostRow(match: Record<string, unknown> | null | undefined): boolean {
  return MatchManager.isUserHostOfMatch(match, userStore.openId);
}

const confirmDeleteMatch = (match: Record<string, unknown>) => {
  matchToDelete.value = (match.match_id as string) ?? null;
  pendingDeleteIsHost.value = isMatchHostRow(match);
  showDeleteModal.value = true;
};

const executeDeleteOrQuit = async () => {
  const mid = matchToDelete.value;
  if (!mid) return;
  try {
    const oid = userStore.openId;
    if (!oid) {
      uni.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (pendingDeleteIsHost.value) {
      const r = await MatchManager.deleteHostedMatch(mid);
      if (!r.ok) {
        if (r.error === 'no_cloud') {
          uni.showToast({ title: '请使用真机/开放云能力后重试', icon: 'none' });
        } else if (r.error === 'not_owner') {
          uni.showToast({ title: '仅房主可删除全场比赛', icon: 'none' });
        } else {
          uni.showToast({ title: '删除失败，请稍后重试', icon: 'none' });
        }
        return;
      }
      uni.showToast({ title: '已删除', icon: 'success' });
    } else {
      const r = await MatchManager.leaveParticipantMatch(mid);
      if (!r.ok) {
        uni.showToast({ title: '退赛失败，请稍后重试', icon: 'none' });
        return;
      }
      if (r.localOnly) {
        uni.showToast({ title: '已退出本机列表', icon: 'none' });
      } else {
        uni.showToast({ title: '已退赛', icon: 'success' });
      }
    }
    await loadMatches({ showLoading: false });
  } catch (e) {
    console.error('[index] executeDeleteOrQuit', e);
    uni.showToast({ title: '操作失败', icon: 'none' });
  } finally {
    showDeleteModal.value = false;
    matchToDelete.value = null;
    pendingDeleteIsHost.value = false;
  }
};
</script>

<template>
  <view
    class="index-page-shell min-h-screen px-4 bg-slate-50 index-page-safe-top"
    :style="{
      display: 'flex',
      flexDirection: 'column',
      flex: '1 1 auto',
      minHeight: '100vh',
      width: '100%',
      boxSizing: 'border-box',
      paddingLeft: '30rpx',
      paddingRight: '30rpx',
      background: '#f8fafc',
      overflow: 'hidden',
      ...(indexTopPad ? { paddingTop: indexTopPad } : {}),
    }"
  >
    <view
      v-if="showOfflineBanner"
      class="mb-3 -mx-4 px-4 py-2 bg-amber-50 border-b-amber-soft text-amber-900 text-xs font-medium text-center"
      role="status"
    >
      {{ offlineBannerText }}
    </view>
    <!-- #ifdef MP-WEIXIN -->
    <view v-if="showPrivacyModal" class="index-privacy-modal-mask" catchtouchmove="">
      <view class="index-privacy-modal-panel" @tap.stop>
        <text class="index-privacy-modal-title">用户隐私保护提示</text>
        <view class="index-privacy-modal-body">
          <text class="index-privacy-modal-line">在你使用 Golfdate计分 服务之前，请仔细阅读</text>
          <text class="index-privacy-link" @tap.stop="openPrivacyContractForIndex">《Golfdate计分小程序隐私保护指引》</text>
          <text class="index-privacy-modal-line">如你同意该指引，请点击「同意」开始使用本小程序。</text>
        </view>
        <view class="index-privacy-modal-actions">
          <button
            type="default"
            plain
            class="index-privacy-btn-refuse"
            hover-class="index-privacy-btn-hover"
            @tap="onIndexPrivacyModalDisagree"
          >
            拒绝
          </button>
          <button
            id="index-privacy-agree-btn"
            type="default"
            plain
            class="index-privacy-btn-agree"
            hover-class="index-privacy-btn-hover"
            open-type="agreePrivacyAuthorization"
            @agreeprivacyauthorization="onIndexPrivacyModalAgree"
          >
            同意
          </button>
        </view>
      </view>
    </view>
    <!-- #endif -->
    <!-- Header（自定义导航安全区由 index-page-safe-top 处理） -->
    <view class="flex flex-col mb-5 pt-1">
      <view class="flex justify-between items-center mb-4 pr-wx-capsule">
        <view class="flex items-center gap-3 min-w-0">
          <!-- #ifdef MP-WEIXIN -->
          <view
            v-if="!hasMpWechatProfile"
            class="flex items-center gap-3 min-w-0 flex-1"
          >
            <view class="min-w-0 flex-1">
              <text class="text-lg font-bold text-slate-900 block">未登录</text>
              <view
                class="mt-1 text-sm px-3 py-1.5 rounded-full bg-[#07C160] text-white inline-flex items-center justify-center font-medium"
                role="button"
                hover-class="opacity-90"
                @tap.stop="openProfileSyncSheet"
              >
                登录 / 同步资料
              </view>
            </view>
          </view>
          <template v-else>
            <button
              plain
              hover-class="none"
              class="mp-choose-avatar-btn w-12 h-12 rounded-full border-2 border-green-500 p-0.5 shrink-0"
              open-type="chooseAvatar"
              @chooseavatar="onProfileChooseAvatar"
            >
              <image
                :src="selfAvatarSrc"
                mode="aspectFill"
                class="mp-choose-avatar-img w-full h-full rounded-full"
                style="width: 96rpx; height: 96rpx; display: block"
              />
            </button>
            <view class="min-w-0 flex-1">
              <view class="flex flex-wrap items-center gap-1 text-lg font-bold text-slate-900">
                <text>{{ t(greetingI18n) }},</text>
                <text class="truncate max-w-[200px]">{{ userStore.profile.nickname }}</text>
                <text>👋</text>
              </view>
              <view class="text-sm text-slate-500 font-medium">{{ t(T.hcp) }}: <text class="font-mono font-bold">{{ averageHandicap }}</text></view>
            </view>
          </template>
          <!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->
          <image
            :src="selfAvatarSrc"
            mode="aspectFill"
            class="w-12 h-12 rounded-full border-2 border-green-500 shrink-0"
          />
          <view class="min-w-0 flex-1">
            <view class="flex flex-wrap items-center gap-1 text-lg font-bold text-slate-900">
              <text>{{ t(greetingI18n) }},</text>
              <text>{{ userStore.profile.nickname || 'GolfPro' }}</text>
              <text>👋</text>
            </view>
            <view class="text-sm text-slate-500 font-medium">{{ t(T.hcp) }}: <text class="font-mono font-bold">{{ averageHandicap }}</text></view>
          </view>
          <!-- #endif -->
        </view>
      </view>
    </view>

    <!-- Weather Widget（略缩小） -->
    <div class="mb-5">
      <div class="gp-card bg-white p-3 border border-slate-100 gp-shadow flex justify-between items-center">
        <div class="flex flex-col min-w-0 flex-1 pr-2">
          <div class="flex items-center gap-1.5 text-slate-500 text-sm font-medium mb-1">
            <text class="mp-emoji mp-emoji-14 text-slate-400">📍</text>
            {{ weatherAreaLabel }}
          </div>
          <div class="flex items-baseline gap-1.5 mb-0.5">
            <div class="text-2xl font-bold text-slate-900 font-mono leading-none">{{ weatherHigh }}°C</div>
            <div class="text-sm text-slate-400 font-medium font-mono">/ {{ weatherLow }}°C</div>
          </div>
          <text
            v-if="weatherLocationHint"
            class="text-sm text-amber-800 font-medium mt-1 leading-snug"
          >{{ weatherLocationHint }}</text>
        </div>

        <div class="flex flex-col items-end shrink-0">
          <div class="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center mb-1">
            <text class="mp-emoji mp-emoji-20 text-orange-500">☀</text>
          </div>
          <div class="flex flex-col gap-0.5 text-sm text-slate-500 items-end font-semibold">
            <div class="flex items-center gap-1">
              <text class="mp-emoji mp-emoji-12 text-slate-500">〰</text>
              {{ t(T.wind) }}
            </div>
            <div class="flex items-center gap-1">
              <text class="mp-emoji mp-emoji-12 text-slate-500">☀</text>
              {{ t(T.uv) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="grid grid-cols-2 gap-3 mb-5">
      <div 
        @click="handleNavigate(Tab.CREATE)"
        class="gp-card bg-white p-3 gp-shadow border border-slate-100 active:scale-95 transition-transform cursor-pointer flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-[#07C160]/10 text-[#07C160] flex items-center justify-center shrink-0">
          <text class="mp-emoji mp-emoji-20 text-[#07C160]">⛳</text>
        </div>
        <div class="min-w-0">
          <h3 class="font-bold text-slate-800 text-lg leading-tight truncate">{{ T.createMatch.zh || T.createMatch }}</h3>
          <p class="text-sm text-slate-400 truncate leading-snug">{{ T.startNewRound.zh || T.startNewRound }}</p>
        </div>
      </div>
      <div 
        @click="handleNavigate(Tab.MATCH_SQUARE)"
        class="gp-card bg-white p-3 gp-shadow border border-slate-100 active:scale-95 transition-transform cursor-pointer flex items-center gap-3"
      >
        <div class="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
          <text class="mp-emoji mp-emoji-20 text-orange-600">🏆</text>
        </div>
        <div class="min-w-0">
          <h3 class="font-bold text-slate-800 text-lg leading-tight truncate">{{ T.matchSquare.zh || T.matchSquare }}</h3>
          <p class="text-sm text-slate-400 truncate leading-snug">{{ T.viewNearby.zh || T.viewNearby }}</p>
        </div>
      </div>
    </div>

    <!-- 当前球局 -->
    <div class="mb-4 flex items-center justify-between px-1">
      <h2 class="text-lg font-bold text-slate-800">{{ T.ongoingMatch.zh || T.ongoingMatch }} ({{ ongoingMatches.length }})</h2>
      <span
        v-if="ongoingMatches.length > 0"
        @click="openCurrentRoundsFullList"
        class="text-xs text-slate-400 flex items-center cursor-pointer active:opacity-70"
        >{{ T.viewAll.zh || T.viewAll }}
        <text class="mp-emoji mp-emoji-12 text-slate-400">›</text></span
      >
    </div>

    <div class="mb-8">
      <div v-show="ongoingMatches.length > 0" class="space-y-4">
      <div 
        v-for="(match, mi) in ongoingMatchesPreview"
        :key="matchRowKey(match, mi)"
        @click="handleNavigate(Tab.SCORECARD, { match_id: match.match_id })"
        class="gp-card bg-white p-4 gp-shadow border border-slate-100 relative overflow-hidden group active:scale-95 transition-all cursor-pointer"
      >
        <div class="absolute right-0 top-0 z-10 flex items-center">
          <div class="bg-lime-400 text-lime-950 text-xs font-black px-2.5 py-1 rounded-bl-xl shadow-sm">
            {{ match.status === 2 ? '已结束' : (match.status === 1 ? '进行中' : '未开始') }}
          </div>
          <view @click.stop="confirmDeleteMatch(match)" class="p-1.5 text-slate-300 transition-colors">
            <text class="mp-emoji mp-emoji-16 text-slate-400">✕</text>
          </view>
        </div>
        
        <div class="flex gap-3">
          <div class="w-16 h-16 rounded-xl bg-slate-100 overflow-hidden shrink-0 shadow-inner">
             <image src="https://picsum.photos/200/200" mode="aspectFill" class="w-full h-full" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-bold text-slate-900 text-base mb-0.5 leading-tight truncate">{{ match.title }}</h3>
            <div class="text-xs text-slate-600 flex items-center gap-1.5 mb-1 font-medium truncate">
              <text class="mp-emoji mp-emoji-14 text-slate-400 shrink-0">📍</text>
              {{ match.course_name || '未知球场' }}
            </div>
            <div class="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
              <text class="mp-emoji mp-emoji-14 text-slate-300 shrink-0">📅</text>
              {{ formatMatchWhen(match) }}
            </div>
          </div>
        </div>

        <div class="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
          <div class="flex -space-x-2">
            <div
              v-for="(p, i) in matchAvatarStripRoster(match)"
              :key="'ar-' + matchRowKey(match, mi) + '-' + i + '-' + (p.uid ?? p.id ?? p.openId ?? p.openid ?? '')"
              class="w-8 h-8 rounded-full border-2 border-white overflow-hidden relative shadow-sm"
              :style="{ zIndex: 4 - i }"
            >
              <image
                :key="'av-' + (p.uid ?? p.id ?? p.openId ?? p.openid ?? i) + '-' + rosterPlayerAvatarSrc(p, match)"
                :src="rosterPlayerAvatarSrc(p, match)"
                mode="aspectFill"
                class="w-full h-full"
              />
            </div>
            <div v-if="!matchAvatarStripRoster(match).length" class="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-xs text-slate-600 font-bold shadow-sm">
              +0
            </div>
          </div>
          <view class="bg-[#07C160] text-white text-xs px-5 py-2 rounded-full font-bold gp-shadow transition-colors">
            {{ T.enterScore.zh || T.enterScore }}
          </view>
        </div>
      </div>
      </div>
      <div v-show="ongoingMatches.length === 0" class="gp-card bg-white p-10 text-center border border-dashed border-slate-200">
        <p class="text-slate-400 text-sm">暂无当前比赛</p>
      </div>
    </div>

    <!-- 历史比赛 -->
    <div class="mb-4 flex items-center justify-between px-1">
      <h2 class="text-lg font-bold text-slate-800">{{ T.historyMatch.zh || T.historyMatch }} ({{ historyMatches.length }})</h2>
      <span
        v-if="historyMatches.length > 0"
        @click="openHistoryRoundsFullList"
        class="text-xs text-slate-400 flex items-center cursor-pointer active:opacity-70"
        >{{ T.viewAll.zh || T.viewAll }}
        <text class="mp-emoji mp-emoji-12 text-slate-400">›</text></span
      >
    </div>

    <div>
      <div v-show="historyMatches.length > 0" class="space-y-4">
      <div
        v-for="(match, hi) in historyMatchesPreview"
        :key="matchRowKey(match, hi)"
        @click="handleNavigate(Tab.SCORECARD, { match_id: match.match_id })"
        class="relative gp-card p-5 border border-slate-200 history-mini-card active:opacity-90 transition-colors cursor-pointer overflow-hidden"
      >
        <image class="history-poster-bg" :src="SHARE_CARD_POSTER_BG" mode="aspectFill" />
        <view class="history-poster-mask" />
        <!-- 与「当前球局」右上角一致：状态角标 + ✕ -->
        <view class="absolute right-0 top-0 z-10 flex items-center">
          <view class="bg-lime-400 text-lime-950 text-xs font-black px-2.5 py-1 rounded-bl-xl shadow-sm">
            已完赛
          </view>
          <view
            @tap.stop="confirmDeleteMatch(match)"
            @click.stop="confirmDeleteMatch(match)"
            class="p-1.5 text-slate-300 transition-colors"
          >
            <text class="mp-emoji mp-emoji-16 text-slate-400">✕</text>
          </view>
        </view>

        <view class="history-mini-inner relative z-[1]">
          <div class="flex items-start gap-3">
            <div class="w-[192rpx] shrink-0">
              <div class="text-[24px] font-black text-slate-900 leading-none tracking-tight">
                {{ getMatchTotalParDiffDisplay(match) }}
              </div>
              <div class="text-xs font-semibold text-slate-600 mt-1">杆差</div>
            </div>
            <div class="flex-1 min-w-0 overflow-x-auto no-scrollbar history-mini-chip-scroll">
              <div class="inline-flex gap-1.5 min-w-max pb-1">
                <view
                  v-for="(cell, idx) in getHistoryHoleStrip(match)"
                  :key="`${matchRowKey(match, hi)}-${idx}`"
                  class="history-hole-chip"
                >
                  <text class="history-hole-chip-num">{{ idx + 1 }}</text>
                  <view class="history-hole-diff-area">
                    <text v-if="cell.kind === 'empty'" class="history-chip-val history-chip-val--empty">{{ cell.text }}</text>
                    <view
                      v-else-if="cell.kind === 'under_two' || cell.kind === 'birdie'"
                      class="history-sc-under-par-fill flex items-center justify-center"
                    >
                      <text class="history-chip-val history-chip-val--under-par">{{ cell.text }}</text>
                    </view>
                    <view v-else-if="cell.kind === 'over_two'" class="history-sc-dbl-sq-outer flex items-center justify-center">
                      <view class="history-sc-dbl-sq-inner flex items-center justify-center">
                        <text class="history-chip-val">{{ cell.text }}</text>
                      </view>
                    </view>
                    <view
                      v-else-if="cell.kind === 'bogey'"
                      class="history-sc-mark-bogey flex items-center justify-center"
                    >
                      <text class="history-chip-val">{{ cell.text }}</text>
                    </view>
                    <view v-else class="history-sc-mark-par flex items-center justify-center">
                      <text class="history-chip-val">{{ cell.text }}</text>
                    </view>
                  </view>
                </view>
              </div>
            </div>
          </div>
          <div
            class="mt-2.5 text-[13px] leading-snug font-bold text-slate-800 history-course-name"
          >
            {{ match.course_name || '未命名球场' }}
          </div>
          <div class="text-xs text-slate-600 mt-1">{{ formatMatchWhen(match, true) }}</div>
        </view>
      </div>
      </div>
      <div v-show="historyMatches.length === 0" class="gp-card bg-white p-6 text-center border border-dashed border-slate-200">
        <p class="text-slate-400 text-sm">暂无历史比赛</p>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <!-- #ifdef MP-WEIXIN -->
    <view
      v-if="profileSyncSheetOpen"
      class="profile-sync-mask"
      @touchmove.stop.prevent
      @tap="closeProfileSyncSheet"
    >
      <view class="profile-sync-panel" @tap.stop>
        <view class="profile-sync-sheet-head">
          <view class="profile-sync-handle-slot">
            <view class="profile-sync-handle" />
          </view>
          <view class="profile-sync-close-hit" hover-class="profile-sync-close-hover" @tap.stop="closeProfileSyncSheet">
            <text class="profile-sync-close-icon">×</text>
          </view>
        </view>
        <text class="profile-sync-title">登录后可体验更多功能</text>
        <scroll-view
          scroll-y
          :scroll-into-view="profileSyncScrollInto ?? ''"
          scroll-with-animation
          :enhanced="true"
          :show-scrollbar="false"
          class="profile-sync-scroll"
        >
          <text class="profile-sync-intro">建议使用微信头像与昵称，在社区与记分卡中展示你的身份。</text>
          <view class="flex flex-row gap-4 items-start mb-5 mt-4">
            <view class="shrink-0 relative">
              <button
                plain
                hover-class="profile-sync-avatar-hover"
                class="mp-choose-avatar-btn profile-sync-avatar-btn border-2 border-slate-200 p-0.5 bg-slate-50"
                open-type="chooseAvatar"
                @chooseavatar="onChooseAvatar"
              >
                <image
                  :src="safeMpAvatarImgSrc(authDraftAvatarCloud || authDraftAvatarLocal, DEFAULT_AVATAR_URL)"
                  mode="aspectFill"
                  class="mp-choose-avatar-img profile-sync-avatar-img bg-slate-100"
                />
              </button>
              <text class="profile-sync-avatar-camera mp-emoji" aria-hidden="true">📷</text>
            </view>
            <view class="flex-1 min-w-0 flex flex-col gap-3 pt-0.5">
              <text class="text-sm font-bold text-slate-800">昵称</text>
              <input
                type="nickname"
                :value="authDraftNickname"
                :adjust-position="true"
                :cursor-spacing="140"
                @input="onNicknameInput"
                @change="onNicknameInput"
                @blur="onNicknameBlur"
                @focus="onNicknameFocus"
                placeholder="请输入昵称"
                class="profile-sync-nickname-input"
              />
            </view>
          </view>
          <view class="profile-sync-tip-box">
            <text class="profile-sync-tip-text">多数用户使用微信头像与昵称，便于球友辨认与场次记录对齐。</text>
          </view>
          <view id="profile-sync-submit-anchor" class="profile-sync-submit-row">
            <button
              type="button"
              class="profile-sync-submit"
              hover-class="profile-sync-submit-hover"
              :disabled="authSaving"
              @tap="confirmProfileAuth"
            >
              {{ authSaving ? '同步中…' : '立即登录' }}
            </button>
          </view>
          <view class="profile-sync-keyboard-pad" />
        </scroll-view>
      </view>
    </view>
    <!-- #endif -->
    <div v-if="showDeleteModal" class="fixed inset-0 bg-modal-mask z-50 flex items-center justify-center p-4 backdrop-blur-sm fixed-safe">
      <div class="gp-card bg-white p-6 w-full max-w-sm shadow-xl">
        <h3 class="text-lg font-bold text-slate-900 mb-2">{{ pendingDeleteIsHost ? '删除比赛' : '退赛' }}</h3>
        <p class="text-slate-500 text-sm mb-6">{{ pendingDeleteIsHost ? '确定要删除这场比赛吗？此操作不可恢复。' : '将从本场名单中移除你与本轮记分，其他球友的记录保留。' }}</p>
        <div class="flex gap-3">
          <view @click="showDeleteModal = false" class="flex-1 py-3 rounded-full bg-slate-100 text-slate-700 font-bold transition-colors text-center">取消</view>
          <view @click="executeDeleteOrQuit" class="flex-1 py-3 rounded-full bg-red-500 text-white font-bold transition-colors text-center">{{ pendingDeleteIsHost ? '删除' : '退赛' }}</view>
        </div>
      </div>
    </div>
  </view>
</template>

<style scoped>
.gp-card {
  border-radius: 16rpx;
}

.gp-shadow {
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.05);
}

.history-mini-card {
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 55%, #ecfdf5 100%);
  min-height: 300rpx;
}

/** 为右上角「已结束+✕」预留高度，洞分横滑不致与标签挤叠 */
.history-mini-inner {
  padding-top: 8rpx;
  padding-right: 4rpx;
}

.history-mini-chip-scroll {
  padding-top: 4rpx;
  max-width: 100%;
}

.history-poster-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.2;
}

.history-poster-mask {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(248, 250, 252, 0.94) 10%, rgba(248, 250, 252, 0.82) 45%, rgba(236, 253, 245, 0.72) 100%);
}

.history-course-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-all;
}

.history-hole-chip {
  min-width: 64rpx;
  width: 64rpx;
  height: 90rpx;
  border-radius: 12rpx;
  border: 1rpx solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 6rpx;
  padding-bottom: 6rpx;
  box-sizing: border-box;
  flex-shrink: 0;
}

.history-hole-chip-num {
  font-size: 22rpx;
  line-height: 1;
  color: #64748b;
  font-weight: 700;
}

/** 下部杆差展示区（与 scorecard.vue 同色同形，略缩小以适配卡片条） */
.history-hole-diff-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 4rpx;
  min-height: 44rpx;
}

.history-chip-val {
  font-size: 22rpx;
  line-height: 1;
  font-weight: 700;
  color: #0f172a;
}

.history-chip-val--empty {
  color: #94a3b8;
  font-weight: 600;
}

/** 低于标准杆：红实心圆 + 白字（同 .sc-under-par-fill） */
.history-sc-under-par-fill {
  width: 36rpx;
  height: 36rpx;
  min-width: 36rpx;
  min-height: 36rpx;
  border-radius: 999rpx;
  background: #dc2626;
  box-sizing: border-box;
}

.history-chip-val--under-par {
  color: #ffffff !important;
  font-weight: 800 !important;
  font-size: 20rpx !important;
}

/** +1：橙单方框（同 .sc-mark-bogey） */
.history-sc-mark-bogey {
  width: 34rpx;
  height: 34rpx;
  min-width: 34rpx;
  min-height: 34rpx;
  border: 2rpx solid #ea580c !important;
  box-sizing: border-box;
}

/** +2+：嵌套双方框（同 .sc-dbl-sq-*） */
.history-sc-dbl-sq-outer {
  width: 40rpx;
  height: 40rpx;
  border: 2rpx solid #ea580c;
  box-sizing: border-box;
  background: transparent;
}

.history-sc-dbl-sq-inner {
  width: 30rpx;
  height: 30rpx;
  border: 2rpx solid #ea580c;
  box-sizing: border-box;
}

/** Par：仅黑字无外框（同 .sc-mark-par） */
.history-sc-mark-par {
  border: none;
  background: transparent;
}

.profile-sync-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.profile-sync-panel {
  width: 100%;
  max-height: 92vh;
  background: #fff;
  border-radius: 28rpx 28rpx 0 0;
  padding: 20rpx 32rpx 0;
  padding-bottom: calc(env(safe-area-inset-bottom) + 12rpx);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.profile-sync-sheet-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  position: relative;
  flex-shrink: 0;
  min-height: 40rpx;
  margin-bottom: 8rpx;
}

.profile-sync-handle-slot {
  flex: 1;
  display: flex;
  justify-content: center;
}

.profile-sync-handle-slot .profile-sync-handle {
  margin: 0 auto 16rpx;
}

.profile-sync-handle {
  width: 72rpx;
  height: 8rpx;
  border-radius: 8rpx;
  background: #e2e8f0;
}

.profile-sync-close-hit {
  position: absolute;
  right: -8rpx;
  top: -4rpx;
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-sync-close-hover {
  opacity: 0.72;
}

.profile-sync-close-icon {
  font-size: 46rpx;
  line-height: 1;
  color: #94a3b8;
  font-weight: 300;
}

.profile-sync-title {
  display: block;
  flex-shrink: 0;
  font-size: 36rpx;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 8rpx;
  letter-spacing: 0.02em;
}

.profile-sync-scroll {
  width: 100%;
  box-sizing: border-box;
  min-height: 360rpx;
  max-height: 72vh;
  height: 62vh;
  padding-bottom: 8rpx;
}

.profile-sync-intro {
  display: block;
  flex-shrink: 0;
  font-size: 24rpx;
  line-height: 1.6;
  color: #64748b;
}

.profile-sync-tip-box {
  margin-top: 20rpx;
  padding: 20rpx 22rpx;
  background: #f8fafc;
  border-radius: 16rpx;
  border: 1rpx solid #e2e8f0;
}

.profile-sync-tip-text {
  font-size: 24rpx;
  line-height: 1.58;
  color: #475569;
}

.profile-sync-submit-row {
  margin-top: 28rpx;
  width: 100%;
}

.profile-sync-submit {
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  width: 100%;
  box-sizing: border-box;
  border-radius: 999rpx !important;
  background: #07c160 !important;
  color: #fff !important;
  font-weight: 700 !important;
  font-size: 34rpx !important;
  padding: 24rpx 24rpx !important;
  line-height: 1.35 !important;
  margin: 0 !important;
  border: none !important;
}

.profile-sync-submit::after {
  border: none !important;
}

.profile-sync-submit-hover {
  opacity: 0.92;
}

.profile-sync-submit:disabled {
  opacity: 0.65 !important;
}

.profile-sync-keyboard-pad {
  height: 300rpx;
  width: 100%;
}

.profile-sync-avatar-hover {
  opacity: 0.92;
}

.profile-sync-panel .profile-sync-avatar-btn {
  border-radius: 50% !important;
  overflow: hidden;
  margin: 0 !important;
  width: 176rpx !important;
  height: 176rpx !important;
  min-width: 176rpx !important;
  min-height: 176rpx !important;
}

.profile-sync-avatar-img {
  display: block;
  width: 176rpx !important;
  height: 176rpx !important;
  border-radius: 50% !important;
}

.profile-sync-avatar-camera {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 4rpx 12rpx rgba(15, 23, 42, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  line-height: 1;
  pointer-events: none;
}

.profile-sync-scroll input {
  box-sizing: border-box;
}

.profile-sync-nickname-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 90rpx;
  line-height: 48rpx;
  padding: 20rpx 12rpx;
  font-size: 30rpx;
  color: #0f172a;
  border: none;
  border-bottom: 2rpx solid #e2e8f0;
  border-radius: 0;
  background: transparent;
}

/* MP privacy：中置白卡片，对齐微信官方引导（附件一） */
.index-privacy-modal-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 120;
  background: rgba(15, 23, 42, 0.52);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx 40rpx;
  box-sizing: border-box;
}

.index-privacy-modal-panel {
  width: 100%;
  max-width: 640rpx;
  margin: 0 auto;
  box-sizing: border-box;
  background: #fff;
  border-radius: 24rpx;
  padding: 36rpx 32rpx 32rpx;
  box-shadow: 0 12rpx 48rpx rgba(15, 23, 42, 0.18);
}

.index-privacy-modal-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: #181818;
  margin-bottom: 24rpx;
  text-align: left;
}

.index-privacy-modal-body {
  display: block;
  margin-bottom: 4rpx;
}

.index-privacy-modal-line {
  display: inline;
  font-size: 28rpx;
  line-height: 1.65;
  color: #353535;
  word-break: break-all;
}

.index-privacy-link {
  display: inline;
  font-size: 28rpx;
  line-height: 1.65;
  color: #576b95;
}

.index-privacy-modal-actions {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 24rpx;
  margin-top: 36rpx;
}

.index-privacy-btn-refuse,
.index-privacy-btn-agree {
  display: flex !important;
  justify-content: center !important;
  align-items: center !important;
  box-sizing: border-box !important;
  flex: 1;
  margin: 0 !important;
  padding: 22rpx 24rpx !important;
  font-size: 32rpx !important;
  line-height: 1.35 !important;
  border-radius: 16rpx !important;
}

.index-privacy-btn-refuse::after,
.index-privacy-btn-agree::after {
  border: none !important;
}

.index-privacy-btn-refuse {
  background: #f2f2f2 !important;
  color: #000 !important;
  border: none !important;
}

.index-privacy-btn-agree {
  background: #07c160 !important;
  color: #fff !important;
  border: none !important;
}

.index-privacy-btn-hover {
  opacity: 0.88;
}

</style>