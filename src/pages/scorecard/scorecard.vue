<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch, getCurrentInstance } from 'vue';
import { onLoad, onShareAppMessage, onShareTimeline, onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { storeToRefs } from 'pinia';
import { Player, Tab } from '@/types';
import { useMatchStore, PKRule, normalizePkRulePlayerIds } from '@/store/matchStore';
import { useUserStore } from '@/store/userStore';
import { MatchManager } from '@/utils/match_manager';
import { db } from '@/utils/db';
import { courseCatalogData } from '@/data/courseCatalog';
import { courseNeedsSectionCombo, sectionsForCoursePicker } from '@/utils/courseSections';
import { openRoute, goBack, markScorecardReopenPkRulesModal, consumeScorecardReopenPkRulesModal } from '@/utils/uniNav';
import { savePackagedImageToAlbum, saveImageToPhotosAlbumSafe } from '@/utils/savePosterToAlbum';
import { signInWithWeChat } from '@/utils/auth';
import {
  requirePrivacyAuthorizeAsync,
  getPrivacyNeedAuthorizationAsync,
  detectScorecardInviteEntry,
} from '@/utils/mpPrivacyBridge';
import PrivacyPopup from '@/components/PrivacyPopup.vue';
import MpPrivacyGateModal from '@/components/MpPrivacyGateModal.vue';
import { useMpPrivacyGate } from '@/composables/useMpPrivacyGate';
import { mpAvatarImgSrcForDisplay, looksLikeExpiredProneTencentTempHttps } from '@/utils/mpAvatarSrc';
import { buildRosterAvatarDisplayMap, isLikelyWeChatOpenId } from '@/utils/rosterAvatarDisplay';
import {
  GUEST_NICKNAME,
  defaultGuestNickname,
  isGuestOrPlaceholderNickname,
} from '@/utils/guestNickname';
import {
  getCachedAvatarDisplay,
  mergeAvatarDisplayMaps,
  seedAvatarDisplayMapFromCache,
  setCachedAvatarDisplay,
} from '@/utils/avatarDisplayCache';
import { resolveCloudFileIdToHttps } from '@/utils/mpCloudFileUrl';
import { golfScoreCellMarkClasses, golfHoleMarkKind } from '@/utils/golfScoreShapes';
import { mpStaticAbsolute } from '@/utils/mpAssetPath';
import { formatMatchKickoffCn, shouldAutoEndByKickoffTtl } from '@/utils/matchKickoff';
import { strokeCountInHoleList } from '@/utils/matchHoleScoresNormalize';
import {
  acquireMpPosterCanvas2d,
  exportMpPosterCanvas2dTempPath,
  loadMpCanvas2dImage,
  paintPersonalScorePoster2d,
} from '@/utils/scorePosterMpCanvas2d';

/** 必须用 mpStaticAbsolute，勿手写 `'/static/...'`（构建器会改成 pages/scorecard/static/...） */
const SCORECARD_POSTER_BG_SRC = mpStaticAbsolute('share-card.png');
/** 海报顶部球场头图（勿手写 `/static/...`） */
const POSTER_HEADER_BG_SRC = mpStaticAbsolute('poster-header-bg.png');
/** 海报底部圆形小程序码（勿手写 `/static/...`） */
const POSTER_MINIAPP_QR_SRC = mpStaticAbsolute('poster-miniapp-qr.png');

const matchId = ref('');
const enteredViaInvite = ref(false);
const invitePromptShown = ref(false);
const isSpectatorMode = ref(false);
/** 本机最后一次成功 saveMatch 时间，用于无 scoreTs 的云端数据与本地冲突时比较「谁更新」 */
const lastLocalScoreCommitAt = ref(0);
/** 与 saveMatch 内指纹对齐，避免合并云端后误抬升 pk/meta 时间戳 */
let lastSavedPkRulesJson = '';
let lastSavedMatchMetaJson = '';
const showJoinChoiceModal = ref(false);
const joiningUser = ref<any>(null);
/** 分享落地时云端已删局：勿再弹加入/围观 */
const inviteMatchDeleted = ref(false);
/** 资料门控完成后直接 joinMatch（而非回到加入/围观弹层） */
const pendingJoinAfterProfile = ref(false);
/** join=受邀加入前；edit=已在局内/围观后补资料 */
const profileGateMode = ref<'join' | 'edit'>('join');

const matchStore = useMatchStore();
const userStore = useUserStore();
const { profile } = storeToRefs(userStore);
const currentMatch = ref<any>(null);

const {
  showPrivacyModal: showScorecardPrivacyModal,
  gatePrivacyBeforeCloud,
  shouldBlockCloudForPrivacy,
  onPrivacyModalAgree: onScorecardPrivacyAgree,
  onPrivacyModalDisagree: onScorecardPrivacyDisagree,
  openPrivacyContract: openScorecardPrivacyContract,
} = useMpPrivacyGate('[scorecard][privacy]');

const scorecardShareTitle = computed(() => {
  const n = (profile.value.nickname && String(profile.value.nickname).trim()) || GUEST_NICKNAME;
  return `${n}邀请你参加球局`;
});

/** 解析落地参数：部分机型/分享入口 onLoad 的 query 不全，需对齐 wx.getEnterOptionsSync().query */
function parseSceneMatchId(scene: unknown): string {
  if (scene == null || String(scene).trim() === '') return '';
  try {
    const raw = decodeURIComponent(String(scene));
    if (raw.startsWith('m')) return raw.slice(1).trim();
  } catch {
    if (String(scene).startsWith('m')) return String(scene).slice(1).trim();
  }
  return '';
}

function matchIdFromQueryObject(q: Record<string, unknown> | undefined | null): string {
  if (!q || typeof q !== 'object') return '';
  const raw =
    q.match_id ??
    q.id ??
    (q as { mid?: unknown }).mid;
  if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  const sid = parseSceneMatchId(q.scene);
  return sid || '';
}

onLoad((query) => {
  let q = (query || {}) as Record<string, unknown>;
  // #ifdef MP-WEIXIN
  try {
    const wxApi = typeof wx !== 'undefined' ? (wx as any) : null;
    const ent = wxApi?.getEnterOptionsSync?.();
    const entQ = ent && typeof ent.query === 'object' ? (ent.query as Record<string, unknown>) : null;
    if (entQ && Object.keys(entQ).length) {
      const merged = { ...entQ, ...q } as Record<string, unknown>;
      q = merged;
    }
  } catch {
    /* ignore */
  }
  // #endif

  let mid = matchIdFromQueryObject(q);
  if (!mid) {
    const sceneOnly = q.scene as string | undefined;
    mid = parseSceneMatchId(sceneOnly);
  }

  enteredViaInvite.value = detectScorecardInviteEntry(q, !!mid);
  /** 隐私 gate 后再 bootstrap；已加入名单的用户由 maybeRunInviteFlow 跳过加入弹层 */
  if (enteredViaInvite.value && mid) {
    // #ifdef MP-WEIXIN
    void (async () => {
      const need = await getPrivacyNeedAuthorizationAsync();
      if (need) {
        console.log('[scorecard][privacy] invite landing: show inline modal before cloud');
        const ok = await gatePrivacyBeforeCloud();
        if (!ok) return;
      }
      matchId.value = mid;
    })();
    return;
    // #endif
  }
  matchId.value = mid;
});

const scorecardSharePath = computed(() => {
  const mid =
    matchId.value ||
    currentMatch.value?.match_id ||
    matchStore.match_id ||
    '';
  const id = String(mid || '').trim();
  return id
    ? `pages/index/index?match_id=${encodeURIComponent(id)}&from=share`
    : 'pages/index/index?from=share';
});

const scorecardShareTimelineQuery = computed(() => {
  const mid =
    matchId.value ||
    currentMatch.value?.match_id ||
    matchStore.match_id ||
    '';
  const id = String(mid || '').trim();
  if (!id) return 'from=share';
  return `match_id=${encodeURIComponent(id)}&from=share`;
});

watch(
  () => matchStore.user_list.length,
  () => {
    matchStore.ensureEighteenHoles();
  },
);

async function finalizeMatchKickoffAutoEnd(match: any | null): Promise<any | null> {
  if (!match || typeof match !== 'object') return match;
  if (!shouldAutoEndByKickoffTtl(match)) return match;
  const ended = { ...match, status: 2 };
  await MatchManager.updateMatch(ended);
  return ended;
}

async function finalizeCurrentMatchKickoffAutoEnd() {
  const m = currentMatch.value;
  if (!m || typeof m !== 'object') return;
  const probe = { ...m, hole_scores: m.hole_scores ?? matchStore.holeScores };
  if (!shouldAutoEndByKickoffTtl(probe)) return;
  const ended = { ...probe, status: 2 };
  currentMatch.value = ended;
  await MatchManager.updateMatch(ended);
}

const scorecardCourseName = computed(() => {
  return (
    currentMatch.value?.courseName ||
    currentMatch.value?.course_name ||
    '未命名球场'
  );
});

/** 展示用临时 https（不写回云库，避免签名过期） */
const rosterAvatarDisplay = ref<Record<string, string>>({});
let avatarHydratedForMatchId = '';

function seedRosterAvatarDisplayFromCache(): void {
  const ids = matchStore.user_list.map((p) => p.id).filter(Boolean);
  const seeded = seedAvatarDisplayMapFromCache(ids);
  rosterAvatarDisplay.value = mergeAvatarDisplayMaps(rosterAvatarDisplay.value, seeded);
}

async function hydrateRosterAvatarDisplay(force = false): Promise<void> {
  const players = matchStore.user_list;
  if (!players.length) return;

  seedRosterAvatarDisplayFromCache();

  const mid = String(matchId.value || matchStore.match_id || '').trim();
  if (!force && mid && avatarHydratedForMatchId === mid) return;

  const ids = players.map((p) => p.id).filter(Boolean);
  const profileMap = await fetchUsersProfilesByOpenIds(ids);
  const profileHttps = new Map<string, string>();
  for (const [oid, prof] of profileMap) {
    const av = prof.avatarUrl?.trim();
    if (av) profileHttps.set(oid, av);
  }
  const built = await buildRosterAvatarDisplayMap(players, profileHttps);
  rosterAvatarDisplay.value = mergeAvatarDisplayMaps(rosterAvatarDisplay.value, built);
  if (mid) avatarHydratedForMatchId = mid;
}

function collectPlayerOpenIdsFromMatch(m: Record<string, unknown>): string[] {
  const roster = (m.user_list ?? m.players ?? []) as unknown[];
  if (!Array.isArray(roster)) return [];
  const set = new Set<string>();
  for (const p of roster) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const raw = o.openid ?? o.openId ?? o.player_uid ?? o.uid ?? o.id;
    if (raw == null || String(raw).trim() === '') continue;
    const s = String(raw).trim();
    if (s.startsWith('temp_') || s.startsWith('virtual') || s.startsWith('anon_')) continue;
    set.add(s);
  }
  return [...set];
}

/**
 * users 批量拉头像昵称（替代 getMatchTeammates）。
 * _.in() 单次条数受限，分页 chunk。
 */
async function fetchUsersProfilesByOpenIds(
  openIds: string[]
): Promise<Map<string, { nickName: string; avatarUrl: string }>> {
  const map = new Map<string, { nickName: string; avatarUrl: string }>();
  if (!openIds.length) return map;

  const cloudRes = await callWxCloudFn<{
    success?: boolean;
    profiles?: Array<{ openId?: string; nickName?: string; avatarUrl?: string }>;
  }>('getUserProfiles', { openIds });
  if (cloudRes?.success && Array.isArray(cloudRes.profiles)) {
    for (const row of cloudRes.profiles) {
      const oid = row.openId != null ? String(row.openId).trim() : '';
      if (!oid) continue;
      const nickName =
        row.nickName != null && String(row.nickName).trim() !== ''
          ? String(row.nickName).trim()
          : '球友';
      const avatarUrl =
        row.avatarUrl != null && String(row.avatarUrl).trim() !== ''
          ? String(row.avatarUrl).trim()
          : '';
      map.set(oid, { nickName, avatarUrl });
    }
    if (map.size > 0) return map;
  }

  // #ifdef MP-WEIXIN
  if (!openIds.length || typeof wx === 'undefined' || !wx.cloud?.database) return map;
  await db.waitForInit();
  const wxdb = wx.cloud.database();
  const _ = wxdb.command;
  const chunkSize = 20;
  for (let i = 0; i < openIds.length; i += chunkSize) {
    const chunk = openIds.slice(i, i + chunkSize);
    const snap = await wxdb.collection('users').where({ _openid: _.in(chunk) }).get();
    const rows = snap.data ?? [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const oid = r._openid != null ? String(r._openid).trim() : '';
      if (!oid) continue;
      const nickRaw = r.nickName ?? r.nickname;
      const avRaw = r.avatarUrl ?? r.avatar;
      const nickName =
        nickRaw != null && String(nickRaw).trim() !== '' ? String(nickRaw).trim() : '球友';
      const avatarUrl = avRaw != null ? String(avRaw).trim() : '';
      map.set(oid, { nickName, avatarUrl });
    }
  }
  // #endif
  return map;
}

/** 他机不可用的本机临时路径，避免占位阻塞从 users 拉云头像 */
function isShareableAvatarUrl(url: string | undefined): boolean {
  if (url == null || String(url).trim() === '') return false;
  const u = String(url).trim();
  if (u.startsWith('wxfile://')) return false;
  if (u.startsWith('file://')) return false;
  if (u.startsWith('http://tmp')) return false;
  return true;
}

/**
 * matches.players 里 avatar 常为空；且 cloud:// 在他人真机上直链常失败。
 * 已从 getUserProfiles 合并出 https 时，勿被空或 cloud:// 云端行冲掉。
 */
function mergeAvatarFromCloudRoster(cloudAv: string | undefined, localAv: string | undefined): string | undefined {
  const cTrim = cloudAv != null && String(cloudAv).trim() !== '' ? String(cloudAv).trim() : '';
  const lTrim = localAv != null && String(localAv).trim() !== '' ? String(localAv).trim() : '';
  const cCloud = cTrim.startsWith('cloud://');
  const lCloud = lTrim.startsWith('cloud://');
  const cBad = !!(cTrim && looksLikeExpiredProneTencentTempHttps(cTrim));
  const lBad = !!(lTrim && looksLikeExpiredProneTencentTempHttps(lTrim));
  /** 云库长期保存的签名链易 403；对侧 cloud fileID 更稳 */
  if (cCloud && lBad) return cTrim;
  if (lCloud && cBad) return lTrim;
  const cShare = !!(cTrim && isShareableAvatarUrl(cTrim));
  const lShare = !!(lTrim && isShareableAvatarUrl(lTrim));
  if (lShare && lTrim.startsWith('https://')) {
    if (!cTrim || !cShare || cTrim.startsWith('cloud://')) return lTrim;
  }
  if (cShare) return cTrim;
  if (lShare) return lTrim;
  if (cTrim) return cTrim;
  return undefined;
}

/**
 * 同步云 matches 名单行到本机：文档里头像常为历史 temp，勿盖掉本机刚 resolve 的链（否则闪一下后变默认图）。
 */
function mergeAvatarForCloudCosmeticSync(cloudRowAv: string | undefined, storeAv: string | undefined): string | undefined {
  const row = cloudRowAv != null && String(cloudRowAv).trim() !== '' ? String(cloudRowAv).trim() : '';
  const store = storeAv != null && String(storeAv).trim() !== '' ? String(storeAv).trim() : '';
  const rowBad = !!(row && looksLikeExpiredProneTencentTempHttps(row));
  const storeBad = !!(store && looksLikeExpiredProneTencentTempHttps(store));
  if (store.startsWith('cloud://') && rowBad) return store;
  if (row.startsWith('cloud://') && storeBad) return row;
  if (rowBad && storeBad && store) return store;
  if (rowBad && store && !storeBad) return store;
  if (storeBad && row && !rowBad) return row;
  return mergeAvatarFromCloudRoster(cloudRowAv, storeAv);
}

/** 受邀默认昵称 / openId 占位，users 有真实资料时应覆盖 */
function isPlaceholderJoinNickname(nick: string | undefined, playerId?: string): boolean {
  return isGuestOrPlaceholderNickname(nick, playerId);
}

/** 根据 openId 对齐 matchStore · currentMatch，完成计分卡展示闭环 */
function applyUsersProfilesToRoster(profileMap: Map<string, { nickName: string; avatarUrl: string }>): boolean {
  let modified = false;
  matchStore.user_list = matchStore.user_list.map((pl) => {
    const u = profileMap.get(pl.id);
    if (!u) {
      if (pl.avatar && !isShareableAvatarUrl(pl.avatar)) {
        modified = true;
        return { ...pl, avatar: undefined };
      }
      return pl;
    }
    const avCloudRaw = u.avatarUrl != null && String(u.avatarUrl).trim() !== '' ? String(u.avatarUrl).trim() : '';
    /** users 里易过期的 getTempFileURL 链不要盖过 roster 上的 cloud://（否则 <image> 空白） */
    const profileAvFiltered =
      avCloudRaw && looksLikeExpiredProneTencentTempHttps(avCloudRaw) ? undefined : avCloudRaw || undefined;
    const avatar = mergeAvatarFromCloudRoster(pl.avatar, profileAvFiltered);
    let nickname = (u.nickName && String(u.nickName).trim()) || pl.nickname;
    if (u.nickName && isPlaceholderJoinNickname(pl.nickname, pl.id)) {
      nickname = String(u.nickName).trim();
    }
    if (nickname !== pl.nickname || avatar !== pl.avatar) modified = true;
    return {
      ...pl,
      nickname,
      avatar,
    };
  });
  if (modified && currentMatch.value) {
    if (Array.isArray(currentMatch.value.user_list)) {
      currentMatch.value.user_list = matchStore.user_list as unknown[];
    }
    if (Array.isArray(currentMatch.value.players)) {
      currentMatch.value.players = matchStore.user_list as unknown[];
    }
  }
  return modified;
}

async function hydrateTeammatesFromUsersCollection(match: Record<string, unknown>): Promise<boolean> {
  let updated = false;
  try {
    const ids = collectPlayerOpenIdsFromMatch(match);
    if (ids.length) {
      const profiles = await fetchUsersProfilesByOpenIds(ids);
      updated = applyUsersProfilesToRoster(profiles);
      if (updated && profiles.size > 0) {
        console.info('[scorecard] users 聚合球友头像昵称', {
          queried: ids.length,
          merged: profiles.size,
        });
      }
    }
  } catch (e) {
    console.warn('[scorecard] hydrateTeammatesFromUsersCollection', e);
  }
  return updated;
}

const isWechatFriendShareReady = computed(() => {
  return userStore.authMode === 'wx' && !!userStore.openId;
});

function callWxCloudFn<T extends Record<string, unknown>>(name: string, data: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      // #ifdef MP-WEIXIN
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name,
        data,
        success: (r: { result?: T }) => resolve((r?.result as T) ?? null),
        fail: (e: unknown) => {
          console.warn(`[scorecard] cloud ${name}`, e);
          resolve(null);
        },
      });
      // #endif
      // #ifndef MP-WEIXIN
      resolve(null);
      // #endif
    } catch (e) {
      console.warn(`[scorecard] cloud ${name}`, e);
      resolve(null);
    }
  });
}

/** 与首页退赛一致：微信小程序调 leaveMatch，其它端仅清本机列表 */
async function callLeaveMatchCloud(
  matchId: string,
): Promise<{ success?: boolean; error?: string } | null> {
  // #ifdef MP-WEIXIN
  return callWxCloudFn<{ success?: boolean; error?: string }>('leaveMatch', { match_id: matchId });
  // #endif
  // #ifndef MP-WEIXIN
  return { success: true };
  // #endif
}

/** 开球时间：统一成可落库/展示的 number(ms) 或可 parse 的字符串，识别云 Date 序列化 */
function normalizeKickoffForStorage(v: unknown): number | string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && String(v).trim()) {
    const s = String(v).trim();
    const n = Number(s);
    if (Number.isFinite(n) && String(n) === s) return n;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    return s;
  }
  if (typeof v === 'object' && v !== null && '_seconds' in (v as object)) {
    const sec = Number((v as { _seconds?: number })._seconds);
    if (Number.isFinite(sec)) return sec * 1000;
  }
  return null;
}

/** 比较开球时间是否一致（忽略 string/number 毫秒差一） */
function coerceKickoffToMs(v: unknown): number {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(String(v).trim());
    if (!Number.isNaN(t)) return t;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 云上常见 created_at / date，补全客户端用的 create_time */
function enrichMatchKickoffFromDoc(m: Record<string, unknown> | undefined | null): Record<string, unknown> | null | undefined {
  if (!m || typeof m !== 'object') return m;
  const cur = normalizeKickoffForStorage(m.create_time);
  if (cur != null) return m;
  const fromCreated = normalizeKickoffForStorage(m.created_at ?? m.createdAt);
  if (fromCreated != null) return { ...m, create_time: fromCreated };
  const fromDate = normalizeKickoffForStorage(m.date);
  if (fromDate != null) return { ...m, create_time: fromDate };
  return m;
}

function canonicalKickoffSigPart(m: Record<string, unknown> | undefined | null): string {
  const e = enrichMatchKickoffFromDoc(m ?? undefined);
  const v = e ? normalizeKickoffForStorage(e.create_time) : null;
  return v == null ? '' : String(v);
}

/** upsert 后与 list 内已有局合并（保留本机 pk_rules），并返回合并后的比赛供 initMatch 使用 */
async function upsertLocalMatchFromCloudAndRefetch(matchId: string, cloudDoc: any): Promise<any> {
  await MatchManager.upsertLocalMatch(cloudDoc);
  return (await MatchManager.getMatch(matchId)) ?? cloudDoc;
}

async function purgeDeletedInviteMatch(mid: string) {
  inviteMatchDeleted.value = true;
  await MatchManager.removeMatchFromLocalList(mid);
  showJoinChoiceModal.value = false;
  joiningUser.value = null;
  uni.showToast({ title: '此比赛已被删除', icon: 'none', duration: 2800 });
}

function isCloudMatchNotFound(res: { success?: boolean; error?: string } | null | undefined): boolean {
  return res?.success === false && String(res.error || '').trim() === 'not_found';
}

async function loadMatchForScorecard(mid: string): Promise<any | null> {
  /** 未同意隐私：禁止 cloud，避免系统 toast 盖住加入/围观浮层 */
  const needPrivacy = await shouldBlockCloudForPrivacy();
  if (needPrivacy) {
    if (enteredViaInvite.value) return null;
    const cached = await MatchManager.getMatch(mid);
    if (cached) {
      return enrichMatchKickoffFromDoc(cached as Record<string, unknown>) as typeof cached;
    }
    return null;
  }

  /** 分享 / 扫码 / scene 进入：必须用云端覆盖本机缓存 */
  const preferCloudFirst = enteredViaInvite.value;

  const fetchCloud = () =>
    callWxCloudFn<{ success?: boolean; match?: any; error?: string }>('getMatch', { match_id: mid });

  let cloudMatch: any | null = null;
  if (preferCloudFirst) {
    const cloudRes = await fetchCloud();
    if (isCloudMatchNotFound(cloudRes)) {
      await purgeDeletedInviteMatch(mid);
      return null;
    }
    if (cloudRes?.success && cloudRes.match) {
      cloudMatch = enrichMatchKickoffFromDoc(cloudRes.match as Record<string, unknown>) as any;
      return upsertLocalMatchFromCloudAndRefetch(mid, cloudMatch);
    }
  }

  let match = await MatchManager.getMatch(mid);
  if (match) {
    match = enrichMatchKickoffFromDoc(match as Record<string, unknown>) as typeof match;
    /** 列表合并层可能给到「有局无分」快照；云端 getMatch 可从 scores 表回填 matches（需部署同名云函数最新版） */
    const embedded = (match as { hole_scores?: unknown; scores?: unknown }).hole_scores ?? (match as { scores?: unknown }).scores;
    if (strokeCountInHoleList(embedded) === 0) {
      const cloudRes = await fetchCloud();
      if (cloudRes?.success && cloudRes.match) {
        const cm = enrichMatchKickoffFromDoc(cloudRes.match as Record<string, unknown>) as typeof match;
        const cloudEmb = (cm as { hole_scores?: unknown; scores?: unknown }).hole_scores ?? (cm as { scores?: unknown }).scores;
        if (strokeCountInHoleList(cloudEmb) > 0) {
          return upsertLocalMatchFromCloudAndRefetch(mid, cm);
        }
      }
    }
    return match;
  }

  const cloudRes = await fetchCloud();
  if (isCloudMatchNotFound(cloudRes)) {
    await purgeDeletedInviteMatch(mid);
    return null;
  }
  if (cloudRes?.success && cloudRes.match) {
    cloudMatch = enrichMatchKickoffFromDoc(cloudRes.match as Record<string, unknown>) as any;
    return upsertLocalMatchFromCloudAndRefetch(mid, cloudMatch);
  }

  try {
    await db.waitForInit();
    const fromDb = await db.getMatch(mid);
    if (fromDb) {
      const enriched = enrichMatchKickoffFromDoc(fromDb as Record<string, unknown>) as any;
      return upsertLocalMatchFromCloudAndRefetch(mid, enriched);
    }
  } catch (e) {
    console.warn('[scorecard] db.getMatch fallback', e);
  }

  return null;
}

function isOpenIdInMatchRoster(m: any, openId: string): boolean {
  if (!m || !openId) return false;
  const roster = m.user_list || m.players || [];
  if (!Array.isArray(roster)) return false;
  return roster.some((p: any) => {
    const id = p?.uid ?? p?.id ?? p?.openId ?? p?.openid;
    return id != null && String(id).trim() === String(openId).trim();
  });
}

/** 受邀加入 / 跳过资料门控：无昵称时统一为游客 */
function defaultJoinNickname(_openId: string): string {
  return defaultGuestNickname();
}

function buildJoiningUserFromProfile(): {
  id: string;
  nickname: string;
  avatar: string;
  handicap: number;
} {
  const openId = userStore.openId || '';
  const nick = userStore.profile.nickname && String(userStore.profile.nickname).trim();
  return {
    id: openId,
    nickname: nick || defaultJoinNickname(openId),
    avatar: userStore.profile.avatar || '',
    handicap: userStore.profile.handicap ?? 0,
  };
}

function openJoinChoiceModal() {
  if (invitePromptShown.value) return;
  invitePromptShown.value = true;
  joiningUser.value = buildJoiningUserFromProfile();
  showJoinChoiceModal.value = true;
}

const showProfileGateModal = ref(false);
const gateNickname = ref('');
const gateAvatarLocal = ref('');
const gateAvatarCloud = ref('');
const gateProfileSaving = ref(false);

async function uploadGateAvatarToCloud(tempPath: string): Promise<string> {
  // #ifdef MP-WEIXIN
  if (!tempPath || typeof wx === 'undefined' || !wx.cloud?.uploadFile) return '';
  try {
    const ext = tempPath.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const openId = userStore.openId || `guest_${Date.now()}`;
    const cloudPath = `avatars/${openId}_${Date.now()}.${ext}`;
    const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
    return String((res as { fileID?: string })?.fileID || '');
  } catch (e) {
    console.warn('[scorecard] uploadGateAvatar', e);
    return '';
  }
  // #endif
  // #ifndef MP-WEIXIN
  return '';
  // #endif
}

async function onGateChooseAvatar(e: { detail?: { avatarUrl?: string } }) {
  const tempPath = String(e?.detail?.avatarUrl || '').trim();
  if (!tempPath) return;
  const ok = await requirePrivacyAuthorizeAsync();
  if (!ok) {
    uni.showToast({ title: '需同意隐私保护指引后才能选择头像', icon: 'none' });
    return;
  }
  uni.showLoading({ title: '上传头像…', mask: true });
  try {
    gateAvatarLocal.value = tempPath;
    const fid = await uploadGateAvatarToCloud(tempPath);
    gateAvatarCloud.value = fid;
    if (!fid) {
      uni.showToast({ title: '头像上传失败，可先填写昵称加入', icon: 'none' });
    }
  } finally {
    uni.hideLoading();
  }
}

async function dismissProfileGateModal() {
  showProfileGateModal.value = false;
  if (profileGateMode.value === 'edit') {
    profileGateMode.value = 'join';
    return;
  }
  if (!pendingJoinAfterProfile.value) return;
  pendingJoinAfterProfile.value = false;
  const nick = userStore.profile.nickname && String(userStore.profile.nickname).trim();
  if (!nick) {
    userStore.updateProfile({ nickname: GUEST_NICKNAME });
  }
  joiningUser.value = buildJoiningUserFromProfile();
  await executeJoinMatch();
}

function needsSelfProfileCompletion(): boolean {
  const nick = userStore.profile.nickname && String(userStore.profile.nickname).trim();
  const av = userStore.profile.avatar && String(userStore.profile.avatar).trim();
  return isGuestOrPlaceholderNickname(nick, userStore.openId) || !av;
}

function syncSelfProfileToMatchRoster(nick: string, avatar: string) {
  const oid = userStore.openId;
  if (!oid) return;
  const next = matchStore.user_list.map((pl) => {
    if (pl.id !== oid) return pl;
    return { ...pl, nickname: nick, avatar: avatar || pl.avatar };
  });
  matchStore.user_list = next;
  if (currentMatch.value) {
    currentMatch.value.user_list = next as unknown[];
    currentMatch.value.players = next as unknown[];
  }
}

async function applySelfProfileAfterEdit(nick: string, avatarRaw: string) {
  const oid = userStore.openId || '';
  let avatar = avatarRaw;
  if (avatar.startsWith('cloud://') && oid) {
    const https = await resolveCloudFileIdToHttps(avatar);
    if (https) {
      setCachedAvatarDisplay(oid, https, avatar);
      rosterAvatarDisplay.value = mergeAvatarDisplayMaps(rosterAvatarDisplay.value, { [oid]: https });
    }
  } else if (avatar.startsWith('https://') && oid) {
    setCachedAvatarDisplay(oid, avatar);
    rosterAvatarDisplay.value = mergeAvatarDisplayMaps(rosterAvatarDisplay.value, { [oid]: avatar });
  }
  syncSelfProfileToMatchRoster(nick, avatar);
  await saveMatch();
  await hydrateRosterAvatarDisplay(true);
}

/** 游客 / 缺资料：点自己的头像或昵称，与首页一致拉起资料浮层 */
async function openSelfProfileEditGate() {
  if (!enteredViaInvite.value) {
    const privacyOk = await ensurePrivacyForJoin();
    if (!privacyOk) return;
  }
  profileGateMode.value = 'edit';
  pendingJoinAfterProfile.value = false;
  const nick = userStore.profile.nickname && String(userStore.profile.nickname).trim();
  gateNickname.value =
    nick && !isGuestOrPlaceholderNickname(nick, userStore.openId) ? nick : '';
  gateAvatarLocal.value = '';
  gateAvatarCloud.value = '';
  const av = String(userStore.profile.avatar || '').trim();
  if (av.startsWith('cloud://')) {
    gateAvatarCloud.value = av;
  }
  showProfileGateModal.value = true;
}

async function confirmProfileGateAndContinue() {
  if (gateProfileSaving.value) return;
  const nick = gateNickname.value.trim();
  if (!nick) {
    uni.showToast({ title: '请填写昵称', icon: 'none' });
    return;
  }
  let avatarUrl = gateAvatarCloud.value || '';
  if (gateAvatarLocal.value && !gateAvatarCloud.value) {
    uni.showLoading({ title: '上传头像…', mask: true });
    try {
      avatarUrl = await uploadGateAvatarToCloud(gateAvatarLocal.value);
      gateAvatarCloud.value = avatarUrl;
    } finally {
      uni.hideLoading();
    }
  }
  gateProfileSaving.value = true;
  try {
    userStore.updateProfile({ nickname: nick, avatar: avatarUrl || userStore.profile.avatar || '' });
    // #ifdef MP-WEIXIN
    if (typeof wx !== 'undefined' && wx.cloud?.callFunction) {
      await new Promise<void>((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'updateUserProfile',
          data: { nickName: nick, avatarUrl: avatarUrl || undefined },
          success: () => resolve(),
          fail: (err: unknown) => reject(err),
        });
      });
    }
    // #endif
    showProfileGateModal.value = false;
    if (profileGateMode.value === 'edit') {
      await applySelfProfileAfterEdit(nick, avatarUrl || userStore.profile.avatar || '');
      profileGateMode.value = 'join';
      uni.showToast({ title: '资料已更新', icon: 'success' });
      return;
    }
    if (pendingJoinAfterProfile.value) {
      pendingJoinAfterProfile.value = false;
      joiningUser.value = {
        id: userStore.openId,
        nickname: nick,
        avatar: avatarUrl || userStore.profile.avatar || '',
        handicap: userStore.profile.handicap ?? 0,
      };
      await executeJoinMatch();
    } else {
      openJoinChoiceModal();
    }
  } catch (e) {
    console.warn('[scorecard] confirmProfileGate', e);
    uni.showToast({ title: '资料同步失败，请重试', icon: 'none' });
  } finally {
    gateProfileSaving.value = false;
  }
}

async function maybeRunInviteFlow(match: any) {
  if (!enteredViaInvite.value || !matchId.value || inviteMatchDeleted.value) return;
  if (match && userStore.openId && isOpenIdInMatchRoster(match, userStore.openId)) {
    showJoinChoiceModal.value = false;
    joiningUser.value = null;
    return;
  }
  if (!invitePromptShown.value) {
    openJoinChoiceModal();
  }
}

async function ensureInviteSession(): Promise<boolean> {
  if (userStore.authMode === 'wx' && userStore.openId) return true;
  try {
    const session = await signInWithWeChat();
    userStore.applyAuthResult(session);
  } catch (e) {
    console.warn('[scorecard] invite signIn', e);
  }
  await nextTick();
  let waits = 0;
  while (waits < 35 && !userStore.openId) {
    await new Promise((r) => setTimeout(r, 100));
    waits++;
  }
  if (userStore.authMode !== 'wx' || !userStore.openId) {
    uni.showToast({ title: '请使用微信登录后加入球局', icon: 'none' });
    return false;
  }
  return true;
}

async function ensureInviteMatchLoaded(): Promise<boolean> {
  const routeMid = String(matchId.value || '').trim();
  if (!routeMid) return false;
  if (currentMatch.value) return true;
  uni.showLoading({ title: '加载球局…', mask: true });
  try {
    const cloudRes = await callWxCloudFn<{ success?: boolean; match?: any; error?: string }>('getMatch', {
      match_id: routeMid,
    });
    if (!cloudRes?.success || !cloudRes.match) {
      uni.showToast({ title: '未找到比赛，请确认链接有效', icon: 'none' });
      return false;
    }
    let match = enrichMatchKickoffFromDoc(cloudRes.match as Record<string, unknown>) as any;
    match = await finalizeMatchKickoffAutoEnd(match);
    match = await upsertLocalMatchFromCloudAndRefetch(routeMid, match);
    currentMatch.value = match;
    matchStore.initMatch(match);
    seedRosterAvatarDisplayFromCache();
    lastLocalScoreCommitAt.value = Date.now();
    refreshSavedRuleAndMetaFingerprints();
    await hydrateTeammatesFromUsersCollection(match as Record<string, unknown>);
    await hydrateRosterAvatarDisplay(true);
    matchStore.ensureEighteenHoles();
    return true;
  } catch (e) {
    console.warn('[scorecard] ensureInviteMatchLoaded', e);
    uni.showToast({ title: '加载球局失败', icon: 'none' });
    return false;
  } finally {
    uni.hideLoading();
  }
}

async function ensurePrivacyForJoin(): Promise<boolean> {
  const agreed = await gatePrivacyBeforeCloud();
  if (!agreed) {
    uni.showToast({ title: '需同意隐私指引后才能加入比赛', icon: 'none' });
  }
  return agreed;
}

/**
 * uni-app 路由复用时 onMounted 只执行一次：match_id 变化必须在 watch / 每次加载时重新拉局。
 */
let scorecardBootstrapSeq = 0;

async function bootstrapScorecardPage() {
  const seq = ++scorecardBootstrapSeq;
  const routeMid = String(matchId.value || '').trim();
  if (!routeMid) return;

  if (enteredViaInvite.value && (await shouldBlockCloudForPrivacy())) {
    matchStore.ensureEighteenHoles();
    await maybeRunInviteFlow(null);
    return;
  }

  let match = await loadMatchForScorecard(routeMid);
  if (seq !== scorecardBootstrapSeq) return;

  const rawFirst = match?.user_list?.[0] || match?.players?.[0];
  console.info('[scorecard:diag] loadMatchForScorecard', {
    match_id: match?.match_id,
    topKeys: match ? Object.keys(match) : [],
    user_list_len: match?.user_list?.length,
    players_len: match?.players?.length,
    firstRowKeys: rawFirst ? Object.keys(rawFirst as object) : [],
    firstRowSample: rawFirst,
    hole_scores_len: match?.hole_scores?.length,
    scores_len: (match as any)?.scores?.length,
    hole1_scores: match?.hole_scores?.[0]?.scores,
  });
  console.log('[scorecard] loaded match:', routeMid, 'user_list:', match?.user_list?.length, 'holes:', match?.hole_scores?.length);

  if (!match) {
    if (enteredViaInvite.value) {
      matchStore.ensureEighteenHoles();
      await maybeRunInviteFlow(null);
      return;
    }
    uni.showToast({ title: '未找到比赛，请确认已同步至云端', icon: 'none' });
    matchStore.ensureEighteenHoles();
    return;
  }

  const hasRoster =
    (Array.isArray(match.user_list) && match.user_list.length > 0) ||
    (Array.isArray(match.players) && match.players.length > 0);
  if (!hasRoster) {
    if (enteredViaInvite.value) {
      uni.showToast({ title: '球局尚未同步，请稍后重试或联系房主重发邀请', icon: 'none', duration: 2800 });
      return;
    }
    const me = {
      id: userStore.openId || `host_${Date.now()}`,
      nickname: userStore.profile.nickname || '我',
      avatar: userStore.profile.avatar || '',
      handicap: userStore.profile.handicap || 0,
      role: '房主',
    };
    match.user_list = [me];
    match.hole_scores = (match.hole_scores || match.scores || []).map((h: any) => ({
      ...h,
      scores: h.scores && h.scores.length > 0 ? h.scores : [0],
    }));
    await MatchManager.updateMatch(match);
    console.log('[scorecard] injected host player:', me.nickname);
  }
  match = await finalizeMatchKickoffAutoEnd(match);
  if (seq !== scorecardBootstrapSeq) return;
  currentMatch.value = match;
  matchStore.initMatch(match);
  seedRosterAvatarDisplayFromCache();
  lastLocalScoreCommitAt.value = Date.now();
  refreshSavedRuleAndMetaFingerprints();
  const inviteNeedPrivacy = enteredViaInvite.value ? await shouldBlockCloudForPrivacy() : false;
  if (!inviteNeedPrivacy) {
    await hydrateTeammatesFromUsersCollection(match as Record<string, unknown>);
    await hydrateRosterAvatarDisplay(true);
  }
  await maybeRunInviteFlow(match);

  matchStore.ensureEighteenHoles();

  if (seq !== scorecardBootstrapSeq) return;
  await nextTick();
  if (matchId.value && currentMatch.value && !inviteNeedPrivacy) {
    void syncMatchFromCloud('show');
  }
}

watch(
  matchId,
  () => {
    avatarHydratedForMatchId = '';
    const routeMid = String(matchId.value || '').trim();
    if (!routeMid) return;
    if (matchStore.match_id !== routeMid) {
      matchStore.prepareNavigateToMatch(routeMid);
      currentMatch.value = null;
    }
    void bootstrapScorecardPage();
  },
  { flush: 'sync' },
);

onMounted(async () => {
  if (!enteredViaInvite.value) {
    const allMatches = await MatchManager.getMatchList();
    const friendsMap = new Map();

    const selfId = userStore.openId || '';
    allMatches.forEach((m) => {
      const roster = m.user_list || m.players || [];
      roster.forEach((u: any) => {
        const uid = u.id || u.uid || u.openId;
        if (uid && uid !== selfId && !String(uid).startsWith('temp_') && !String(uid).startsWith('virtual')) {
          friendsMap.set(String(uid), { ...u, id: String(uid), nickname: u.nickname || u.nickName || '球友' });
        }
      });
    });

    historyFriends.value = Array.from(friendsMap.values());
  }

  /** 兜底：极少数环境下 watch 未及时触发首次加载 */
  await nextTick();
  if (String(matchId.value || '').trim()) {
    void bootstrapScorecardPage();
  }
});

// Selection State for Score Input Modal
const showScoreModal = ref(false);
const editingCell = ref<{ pid: string, holeIndex: number } | null>(null);
/** 浮层内草稿杆数，仅在确认/清除时写入 store，避免 +/- 触发保存与误关 */
const modalDraftStrokes = ref<number | null>(null);

/** 记分卡横滑：手势交给原生 scroll-view，分段跳转使用 scroll-into-view 锚点 */
const tableScrollIntoView = ref('');
const activeNineSection = ref<'front' | 'back'>('front');

const scrollToSection = (section: 'front' | 'back') => {
  activeNineSection.value = section;
  const targetId = section === 'front' ? 'hole-anchor-1' : 'hole-anchor-10';
  if (tableScrollIntoView.value === targetId) {
    tableScrollIntoView.value = '';
    nextTick(() => {
      tableScrollIntoView.value = targetId;
    });
    return;
  }
  tableScrollIntoView.value = targetId;
};

// PK Rules Modal State
const showRulesModal = ref(false);
/** 从「当前生效规则」打开全屏配置后，返回时回到规则列表弹层 */
const pkConfigReturnToRulesModal = ref(false);
const showAddRuleOptions = ref(false);
const showConfigModal = ref(false);
const showAddPlayerModal = ref(false);
const showVirtualPlayerPanel = ref(false);
const showSettingsModal = ref(false);
const showEditMatchModal = ref(false);
const showEditCoursePicker = ref(false);
const showEditSectionPicker = ref(false);
const editMatchTitle = ref('');
const editMatchTime = ref('');
const editMatchPrivacy = ref(false);
const editSelectedCourse = ref<any>(null);
const editSelectedSections = ref<any[]>([]);
const editSearchKey = ref('');
const quickAddName = ref('');

const filteredEditCourses = computed(() => {
  const all: any[] = [];
  Object.entries(courseCatalogData).forEach(([province, provinceCourses]) => {
    provinceCourses.forEach(c => {
      all.push({
        ...c,
        province,
        city: c.city || province,
        id: c.id || c.name
      });
    });
  });
  if (!editSearchKey.value) return all;
  const key = editSearchKey.value.toLowerCase();
  return all.filter(c => c.name.toLowerCase().includes(key) || c.city.toLowerCase().includes(key) || (c.province && c.province.toLowerCase().includes(key)));
});

const editSectionPickerList = computed(() => sectionsForCoursePicker(editSelectedCourse.value));

const showEditStandard18SectionHint = computed(() => {
  const c = editSelectedCourse.value;
  if (!c || Array.isArray(c.sections)) return false;
  return editSectionPickerList.value.length === 2;
});

const showPKScoreModal = ref(false);
const selectedPKRuleId = ref<string>('all');

const showHistoryFriendsModal = ref(false);
const showQRCodeModal = ref(false);
const qrImageSrc = ref('');

const showPlayerActionModal = ref(false);
const selectedPlayer = ref<any>(null);

const myId = computed(() => userStore.openId || '');

const isInitiator = computed(() => {
  if (!currentMatch.value) return true;
  const hostId = currentMatch.value.user_list?.[0]?.id || currentMatch.value.user_list?.[0]?.uid || '';
  return !myId.value || hostId === myId.value;
});

const isInteractionLocked = computed(
  () => currentMatch.value?.status === 2 || isSpectatorMode.value,
);

const onTapAddPlayer = () => {
  if (isInteractionLocked.value) {
    uni.showToast({ title: '本场为只读，无法添加球手', icon: 'none' });
    return;
  }
  showAddPlayerModal.value = true;
};

const onTapRules = () => {
  if (isInteractionLocked.value) {
    uni.showToast({ title: '本场为只读，无法修改规则', icon: 'none' });
    return;
  }
  showRulesModal.value = true;
};

const onTapSettings = () => {
  if (isSpectatorMode.value) {
    uni.showToast({ title: '围观模式仅可查看', icon: 'none' });
    return;
  }
  showSettingsModal.value = true;
};

const onTapPKScore = () => {
  if (isInteractionLocked.value) {
    uni.showToast({ title: '本场为只读', icon: 'none' });
    return;
  }
  showPKScoreModal.value = true;
};

const openPlayerActionModal = (player: any) => {
  if (player.isPending) {
    showAddPlayerModal.value = true;
    return;
  }
  const pid = String(player?.id ?? player?.uid ?? '').trim();
  if (pid && pid === myId.value && needsSelfProfileCompletion()) {
    void openSelfProfileEditGate();
    return;
  }
  selectedPlayer.value = player;
  showPlayerActionModal.value = true;
};

const handleViewProfile = () => {
  if (selectedPlayer.value) {
    openRoute(Tab.PLAYER_PROFILE, { 
      player_id: selectedPlayer.value.id,
      from: Tab.SCORECARD,
      match_id: matchId.value
    });
    showPlayerActionModal.value = false;
  }
};

const confirmDeletePlayer = () => {
  if (selectedPlayer.value) {
    handleRemovePlayer(selectedPlayer.value);
  }
};

const historyFriends = ref<any[]>([]);

const handleAddPlayerOption = (optId: string) => {
  if (optId === 'virtual') {
    showVirtualPlayerPanel.value = true;
    showAddPlayerModal.value = false;
  } else if (optId === 'history') {
    showHistoryFriendsModal.value = true;
    showAddPlayerModal.value = false;
  } else if (optId === 'wechat') {
    if (!isWechatFriendShareReady.value) {
      uni.showModal({
        title: '功能暂不可用',
        content: '由于小程序正在认证中，微信分享功能暂受限，请先使用手动添加功能。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }
    showAddPlayerModal.value = false;
  } else if (optId === 'qrcode') {
    showQRCodeModal.value = true;
    showAddPlayerModal.value = false;
  }
};

async function executeJoinMatch(): Promise<boolean> {
  if (!joiningUser.value || !matchId.value) return false;
  uni.showLoading({ title: '加入中…', mask: true });
  try {
    const res = await callWxCloudFn<{
      success?: boolean;
      match?: any;
      error?: string;
    }>('joinMatch', {
      match_id: matchId.value,
      nickName: joiningUser.value.nickname || defaultJoinNickname(userStore.openId || ''),
      avatarUrl: joiningUser.value.avatar || '',
      handicap: joiningUser.value.handicap ?? 0,
    });
    uni.hideLoading();
    if (!res?.success || !res.match) {
      uni.showToast({ title: (res as any)?.error ? String((res as any).error) : '加入失败', icon: 'none' });
      return false;
    }
    const m = await finalizeMatchKickoffAutoEnd(enrichMatchKickoffFromDoc(res.match as Record<string, unknown>) as any);
    currentMatch.value = m;
    matchStore.initMatch(m);
    refreshSavedRuleAndMetaFingerprints();
    await MatchManager.upsertLocalMatch(m);
    await hydrateTeammatesFromUsersCollection(m as Record<string, unknown>);
    showJoinChoiceModal.value = false;
    joiningUser.value = null;
    isSpectatorMode.value = false;
    uni.showToast({ title: '已加入比赛', icon: 'success' });
    return true;
  } catch (e) {
    uni.hideLoading();
    console.warn('[scorecard] joinMatch', e);
    uni.showToast({ title: '加入失败', icon: 'none' });
    return false;
  }
}

const handleJoinAsPlayer = async () => {
  if (!joiningUser.value || !matchId.value) return;
  const privacyOk = await ensurePrivacyForJoin();
  if (!privacyOk) return;
  const sessionOk = await ensureInviteSession();
  if (!sessionOk) return;
  const loaded = await ensureInviteMatchLoaded();
  if (!loaded) return;
  const hasNick = !!(userStore.profile.nickname && String(userStore.profile.nickname).trim());
  if (!hasNick) {
    pendingJoinAfterProfile.value = true;
    profileGateMode.value = 'join';
    gateNickname.value = '';
    gateAvatarLocal.value = '';
    gateAvatarCloud.value = '';
    showJoinChoiceModal.value = false;
    showProfileGateModal.value = true;
    return;
  }
  joiningUser.value = buildJoiningUserFromProfile();
  await executeJoinMatch();
};

const handleSpectate = async () => {
  const privacyOk = await ensurePrivacyForJoin();
  if (!privacyOk) return;
  const sessionOk = await ensureInviteSession();
  if (!sessionOk) return;
  const loaded = await ensureInviteMatchLoaded();
  if (!loaded) return;
  isSpectatorMode.value = true;
  showJoinChoiceModal.value = false;
  joiningUser.value = null;
  const nick = userStore.profile.nickname && String(userStore.profile.nickname).trim();
  if (!nick) {
    userStore.updateProfile({ nickname: GUEST_NICKNAME });
  }
  uni.showToast({ title: '已进入围观（只读）', icon: 'none' });
};

const addHistoryFriend = (friend: any) => {
  matchStore.addPlayer({ ...friend });
  if (currentMatch.value) {
    currentMatch.value.user_list = matchStore.user_list;
    saveMatch();
  }
  showHistoryFriendsModal.value = false;
};

const handleQuickAdd = () => {
  if (!quickAddName.value.trim()) return;

  const newPlayer = {
    id: `temp_${Date.now()}`,
    nickname: quickAddName.value.trim(),
    handicap: null,
    avatar: '',
  };

  // ① 直接 push 到 store（等价于 this.players.push(...)）
  matchStore.addPlayer(newPlayer);

  // ② 同步到本地 + 云端 matches 表
  if (currentMatch.value) {
    currentMatch.value.user_list = matchStore.user_list;
    currentMatch.value.hole_scores = matchStore.holeScores;
    void saveMatch();
  }

  quickAddName.value = '';
  showAddPlayerModal.value = false;
  showVirtualPlayerPanel.value = false;
};

// Sub-modals for Tiger configuration
const showTigerPlayerSelect = ref(false);
const tigerSelectMode = ref<'tiger' | 'participants' | 'handicap'>('tiger');
const showHandicapInput = ref(false);
const pendingHandicapPlayer = ref<Player | null>(null);
const handicapValue = ref(0);

// Sub-modals for Strokes configuration
const showLandmineModal = ref(false);
const showParticipantModal = ref(false);
const showHandicapModal = ref(false);
const showTotalHandicapModal = ref(false);
const showHandicapValueModal = ref(false);
const showRewardModal = ref(false);
const showWinConditionModal = ref(false);
const showTieModal = ref(false);
const showCollectTieModal = ref(false);
const showStrokesPlayerSelect = ref(false);
const showHoleSelectModal = ref(false);
const showParHandicapModal = ref(false);
const showHoleHandicapModal = ref(false);
const showStartingHoleModal = ref(false);
const strokesSelectIndex = ref(0);

const currentConfigRule = ref<any>(null);

const addPlayerOptions = [
  { id: 'history', name: '历史同组好友', uniType: 'staff', iconColor: '#60a5fa' },
  { id: 'wechat', name: '微信好友', uniType: 'chatbubble-filled', iconColor: '#4ade80' },
  { id: 'virtual', name: '添加虚拟球友', uniType: 'personadd', iconColor: '#fb923c' },
  { id: 'qrcode', name: '展示比赛二维码', uniType: 'scan', iconColor: '#c084fc' }
];

const settingsOptions = [
  { id: 'end', name: '结束比赛', uniType: 'medal-filled', iconColor: '#eab308', action: 'finish' },
  { id: 'edit', name: '修改比赛', uniType: 'compose', iconColor: '#3b82f6', action: 'edit' },
  { id: 'leave', name: '我要退赛', uniType: 'undo', iconColor: '#ef4444', action: 'leave' }
];

const handleSettingsAction = (action: string) => {
  showSettingsModal.value = false;
  if (action === 'finish') {
    if (!currentMatch.value) return;
    uni.showModal({
      title: '结束比赛',
      content: '结束后分数将不能修改，确定结束本场吗？',
      success: (res) => {
        if (!res.confirm || !currentMatch.value) return;
        currentMatch.value.status = 2;
        void saveMatch();
      },
    });
    return;
  }
  if (action === 'edit') {
    const mid = currentMatch.value?.match_id || matchId.value;
    if (!mid) return;
    openRoute(Tab.CREATE, { match_id: String(mid), mode: 'edit' });
    return;
  }
  if (action === 'leave') {
    const oid = myId.value;
    if (!oid) {
      uni.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    uni.showModal({
      title: '退赛',
      content: '确定从本场球局退赛？',
      success: (res) => {
        void (async () => {
          if (!res.confirm || !currentMatch.value) return;
          const mid = String(currentMatch.value.match_id || matchId.value || '').trim();
          if (!mid) {
            uni.showToast({ title: '缺少比赛信息', icon: 'none' });
            return;
          }
          try {
            uni.showLoading({ title: '处理中…', mask: true });
            const cloudRes = await callLeaveMatchCloud(mid);
            const err = cloudRes?.error || '';
            const cloudOk =
              cloudRes?.success === true || err === 'not_in_roster' || err === 'not_found';
            if (!cloudOk) {
              if (cloudRes == null) {
                uni.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
              } else {
                uni.showToast({ title: '退赛失败，请稍后重试', icon: 'none' });
              }
              return;
            }
            await MatchManager.removeMatchFromLocalList(mid);
            uni.showToast({ title: '已退赛', icon: 'success' });
            uni.navigateBack({
              fail: () => {
                try {
                  uni.switchTab({ url: '/pages/index/index' });
                } catch {
                  /* ignore */
                }
              },
            });
          } catch (e) {
            console.warn('[scorecard] leaveMatch flow', e);
            uni.showToast({ title: '操作失败', icon: 'none' });
          } finally {
            try {
              uni.hideLoading();
            } catch {
              /* ignore */
            }
          }
        })();
      },
    });
  }
};

const handleEditCourseSelect = (course: any) => {
  if (courseNeedsSectionCombo(course)) {
    editSelectedCourse.value = course;
    editSelectedSections.value = [];
    showEditSectionPicker.value = true;
    showEditCoursePicker.value = false;
  } else {
    editSelectedCourse.value = course;
    editSelectedSections.value = [];
    showEditCoursePicker.value = false;
  }
};

const toggleEditSection = (section: any) => {
  const idx = editSelectedSections.value.findIndex(s => s.name === section.name);
  if (idx > -1) {
    editSelectedSections.value.splice(idx, 1);
  } else {
    if (editSelectedSections.value.length < 2) {
      editSelectedSections.value.push(section);
    } else {
      editSelectedSections.value[1] = section;
    }
  }
};

const confirmEditSections = () => {
  if (editSelectedSections.value.length === 2) {
    const combinedHoles = [
      ...editSelectedSections.value[0].holes_par.map((par: number, i: number) => ({ no: i + 1, par })),
      ...editSelectedSections.value[1].holes_par.map((par: number, i: number) => ({ no: i + 10, par }))
    ];
    editSelectedCourse.value = {
      ...editSelectedCourse.value,
      name: `${editSelectedCourse.value.name} (${editSelectedSections.value[0].name}+${editSelectedSections.value[1].name})`,
      holes: combinedHoles,
      total_par: editSelectedSections.value[0].holes_par.reduce((a: number, b: number) => a + b, 0) + 
                 editSelectedSections.value[1].holes_par.reduce((a: number, b: number) => a + b, 0)
    };
    showEditSectionPicker.value = false;
  }
};

const saveMatchEdits = async () => {
  if (currentMatch.value) {
    currentMatch.value.title = editMatchTitle.value;
    currentMatch.value.create_time = editMatchTime.value ? new Date(editMatchTime.value).getTime() : Date.now();
    currentMatch.value.is_private = editMatchPrivacy.value;
    if (editSelectedCourse.value.holes) {
      currentMatch.value.course_name = editSelectedCourse.value.name;
      // Update hole pars but keep existing scores
      currentMatch.value.hole_scores = editSelectedCourse.value.holes.map((h: any, i: number) => {
        const existing = currentMatch.value.hole_scores[i] || { scores: new Array(matchStore.user_list.length).fill(0) };
        return {
          scores: existing.scores,
          par: h.par
        };
      });
      // Sync store
      matchStore.initMatch(currentMatch.value);
    }
    await saveMatch();
    showEditMatchModal.value = false;
  }
};

const singleHangRules = [
  { type: 'strokes', name: '挂杆', sub: '单挂/多人互挂' },
  { type: 'holes', name: '挂洞', sub: '单挂/多人互挂' },
  { type: '8421_1v1', name: '挂8421', sub: '8421+ 每人自定义梯' }
];

const multiPlayerRules = [
  { type: 'landlord', name: '斗地主', sub: '3分/8421等' },
  { type: 'vegas_4', name: '4人拉斯', sub: '4人拉斯游戏' },
  { type: 'tiger', name: '打老虎', sub: '最好成绩PK老虎' }
];

const selectRuleForConfig = (rule: any) => {
  pkConfigReturnToRulesModal.value = false;
  if (rule.type === 'tiger') {
    openRoute(Tab.PK_TIGER, { match_id: matchId.value });
    showAddRuleOptions.value = false;
    return;
  }
  if (rule.type === 'landlord') {
    openRoute(Tab.PK_DIZHU, { match_id: matchId.value });
    showAddRuleOptions.value = false;
    return;
  }
  if (rule.type === 'vegas_4') {
    openRoute(Tab.PK_LASHI, { match_id: matchId.value });
    showAddRuleOptions.value = false;
    return;
  }

  if (rule.type === 'strokes') {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      landmines: {
        front: 0,
        back: 0,
        multiplier: 2,
        assignedHoles: []
      },
      participant_count: 2,
      player_ids: [],
      handicap_config: {
        type: 'none',
        value: 0
      },
      reward_config: '1',
      valid_holes: Array.from({ length: 18 }, (_, i) => i + 1),
      win_condition: 'lower_strokes',
      tie_type: 'none',
      collect_tie_type: 'par_1_birdie_2_eagle_all',
      handicap_type: 'strokes', // 'strokes' or 'holes'
      handicap_par_strokes: { par3: 0, par4: 0, par5: 0 },
      handicap_holes_count: 0,
      starting_hole: 1
    };
  } else if (rule.type === 'holes') {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      landmines: {
        front: 0,
        back: 0,
        multiplier: 2,
        assignedHoles: []
      },
      participant_count: 2,
      player_ids: [],
      handicap_config: {
        type: 'none',
        value: 0
      },
      reward_config: '1',
      valid_holes: Array.from({ length: 18 }, (_, i) => i + 1),
      win_condition: 'lower_strokes',
      tie_type: 'none',
      collect_tie_type: 'par_1_birdie_2_eagle_all',
      handicap_type: 'strokes', // 'strokes' or 'holes'
      handicap_par_strokes: { par3: 0, par4: 0, par5: 0 },
      handicap_holes_count: 0,
      starting_hole: 1
    };
  } else if (rule.type === '8421_1v1') {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      landmines: {
        front: 0,
        back: 0,
        multiplier: 2,
        assignedHoles: []
      },
      participant_count: 2,
      player_ids: [],
      player_8421: { ...(rule.player_8421 || {}) },
      reward_config: '1',
      valid_holes: Array.from({ length: 18 }, (_, i) => i + 1),
      deduction_type: 'progressive',
      deduction_par3_plus3: false,
      tie_type: 'none',
      collect_tie_type: 'par_1_birdie_2_eagle_all',
      starting_hole: rule.starting_hole ?? 1,
    };
  } else {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      birdie_double: true,
      is_mon: false
    };
  }
  showAddRuleOptions.value = false;
  showConfigModal.value = true;
};

const randomizeLandmines = () => {
  if (!currentConfigRule.value?.landmines) return;
  const { front, back } = currentConfigRule.value.landmines;
  const frontHoles = Array.from({ length: 9 }, (_, i) => i + 1);
  const backHoles = Array.from({ length: 9 }, (_, i) => i + 10);
  
  const shuffle = (array: number[]) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  
  const selectedFront = shuffle(frontHoles).slice(0, front);
  const selectedBack = shuffle(backHoles).slice(0, back);
  
  currentConfigRule.value.landmines.assignedHoles = [...selectedFront, ...selectedBack].sort((a, b) => a - b);
};

const handleStrokesPlayerSelect = (player: Player) => {
  if (!currentConfigRule.value.player_ids) currentConfigRule.value.player_ids = [];
  
  // Check if player already selected in another slot
  const existingIdx = currentConfigRule.value.player_ids.indexOf(player.id);
  if (existingIdx !== -1 && existingIdx !== strokesSelectIndex.value) {
    // Swap or alert? Let's just swap
    currentConfigRule.value.player_ids[existingIdx] = currentConfigRule.value.player_ids[strokesSelectIndex.value];
  }
  
  currentConfigRule.value.player_ids[strokesSelectIndex.value] = player.id;
  showStrokesPlayerSelect.value = false;
};

function openStrokesPlayerPicker(slotIndex: number) {
  const n = Math.max(0, Math.floor(Number(slotIndex)) || 0);
  strokesSelectIndex.value = n;
  showStrokesPlayerSelect.value = true;
}

const getRewardText = (config: string) => {
  const options: Record<string, string> = {
    '1': '鸟*2/鹰*4/HIO（双鹰）*8',
    '2': '鸟*2/鹰*5/HIO（双鹰）*10',
    '3': '鸟*2/鹰*10/HIO（双鹰）*20',
    '4': '鸟*2/鹰*16/HIO（双鹰）*32'
  };
  return options[config] || config || '';
};

const getHandicapText = (config: any, isHoles: boolean = false) => {
  const unit = isHoles ? '洞' : '杆';
  if (!config || (config.type === 'none' && config.value === 0)) return '平打';
  if (config.type === 'none') return `总让 ${config.value}${unit}`;
  if (config.type === 'virtual') return '虚让';
  if (config.type === '单洞') return `单洞让${config.value}${unit}`;
  return `${config.type}让1`;
};

const getRuleSummary = (rule: PKRule) => {
  const parts = [];
  const conf = rule.config || {};

  const pushStartingHoleIfSet = () => {
    const raw = rule.starting_hole ?? conf.starting_hole;
    const sh = Number(raw);
    if (Number.isFinite(sh) && sh >= 1 && sh <= 18) parts.push(`出发洞${sh}`);
  };
  
  if (rule.type === 'vegas_4') {
    // Grouping
    parts.push(conf.grouping || '乱拉');
    pushStartingHoleIfSet();
    
    // Scoring Mode
    if (conf.scoring_mode === '8421') parts.push('8421');
    else if (conf.scoring_mode === 'points_3') parts.push('123分');
    else if (conf.scoring_mode === 'product') parts.push('公鸡母鸡');
    else if (conf.scoring_mode === 'sum') parts.push('杆数相加');
    
    // Deduction
    if (conf.double_par_plus_1 && conf.double_par_plus_1 !== '不扣分') {
      parts.push('扣分');
    } else {
      parts.push('不扣分');
    }
    
    // Tie Hole
    if (conf.tie_hole) {
      parts.push(conf.tie_hole);
    }
  } else if (rule.type === 'strokes' || rule.type === 'holes') {
    parts.push(`${rule.participant_count || 2}人单挂`);
    pushStartingHoleIfSet();
    
    // Handicap
    const hcpText = getHandicapText(rule.handicap_config, rule.type === 'holes');
    parts.push(hcpText);
    
    // Players
    if (rule.player_ids && rule.player_ids.length > 0) {
      const names = rule.player_ids.map(id => players.value.find(p => p.id === id)?.nickname || '未知').join(',');
      parts.push(names);
    }
    
    // Rewards
    if (rule.birdie_double) {
      parts.push('鸟1鹰5');
    }
    
    if (rule.reward_config === 'hio_10') {
      parts.push('HIO(双鹰)10');
    }
  } else if (rule.type === '8421_1v1') {
    parts.push(`${rule.participant_count || 2}人8421+`);
    pushStartingHoleIfSet();
    if (rule.deduction_type && rule.deduction_type !== 'none') {
      parts.push('扣分');
    }
  } else if (rule.type === 'landlord' || rule.type === 'tiger') {
    parts.push(rule.type === 'landlord' ? '斗地主' : '打老虎');
    parts.push(conf.landlord_type || '流动地主');
    pushStartingHoleIfSet();
    if (conf.tie_hole) parts.push(conf.tie_hole);
  }
  
  return parts.join('/');
};

// Tiger Logic Functions
const toggleHole = (holeNum: number) => {
  const index = currentConfigRule.value.valid_holes.indexOf(holeNum);
  if (index > -1) {
    currentConfigRule.value.valid_holes.splice(index, 1);
  } else {
    currentConfigRule.value.valid_holes.push(holeNum);
    currentConfigRule.value.valid_holes.sort((a: number, b: number) => a - b);
  }
};

const setHoleRange = (range: 'all' | 'front' | 'back') => {
  if (range === 'all') {
    currentConfigRule.value.valid_holes = Array.from({ length: 18 }, (_, i) => i + 1);
  } else if (range === 'front') {
    currentConfigRule.value.valid_holes = Array.from({ length: 9 }, (_, i) => i + 1);
  } else if (range === 'back') {
    currentConfigRule.value.valid_holes = Array.from({ length: 9 }, (_, i) => i + 10);
  }
};

const openPlayerSelect = (mode: 'tiger' | 'participants' | 'handicap') => {
  tigerSelectMode.value = mode;
  showTigerPlayerSelect.value = true;
};

const handleTigerPlayerSelect = (player: Player) => {
  if (tigerSelectMode.value === 'tiger') {
    currentConfigRule.value.tiger_user_id = player.id;
    // Remove from participants if it was there
    currentConfigRule.value.player_ids = currentConfigRule.value.player_ids.filter((id: string) => id !== player.id);
    showTigerPlayerSelect.value = false;
  } else if (tigerSelectMode.value === 'participants') {
    const index = currentConfigRule.value.player_ids.indexOf(player.id);
    if (index > -1) {
      currentConfigRule.value.player_ids.splice(index, 1);
    } else {
      // Cannot be tiger and participant
      if (player.id !== currentConfigRule.value.tiger_user_id) {
        currentConfigRule.value.player_ids.push(player.id);
      }
    }
  } else if (tigerSelectMode.value === 'handicap') {
    pendingHandicapPlayer.value = player;
    handicapValue.value = 0;
    showTigerPlayerSelect.value = false;
    showHandicapInput.value = true;
  }
};

const confirmHandicap = () => {
  if (pendingHandicapPlayer.value) {
    const existing = currentConfigRule.value.handicap_list.find((h: any) => h.playerId === pendingHandicapPlayer.value?.id);
    if (existing) {
      existing.strokes = handicapValue.value;
    } else {
      currentConfigRule.value.handicap_list.push({
        playerId: pendingHandicapPlayer.value.id,
        playerName: pendingHandicapPlayer.value.nickname,
        strokes: handicapValue.value
      });
    }
  }
  showHandicapInput.value = false;
  pendingHandicapPlayer.value = null;
};

const removeHandicap = (playerId: string) => {
  currentConfigRule.value.handicap_list = currentConfigRule.value.handicap_list.filter((h: any) => h.playerId !== playerId);
};

const confirmAddRule = () => {
  if (!currentConfigRule.value) return;
  
  const ruleData: any = {
    type: currentConfigRule.value.type,
    category: currentConfigRule.value.type.includes('vegas') || currentConfigRule.value.type === 'landlord' || currentConfigRule.value.type === 'tiger' ? 'multi' : 'single',
    name: currentConfigRule.value.name,
    base_score: currentConfigRule.value.base_score,
  };

  if (currentConfigRule.value.type === 'tiger') {
    Object.assign(ruleData, {
      bomb_value: currentConfigRule.value.bomb_value,
      valid_holes: currentConfigRule.value.valid_holes,
      tiger_user_id: currentConfigRule.value.tiger_user_id,
      player_ids: currentConfigRule.value.player_ids,
      handicap_list: currentConfigRule.value.handicap_list,
      compare_type: currentConfigRule.value.compare_type,
      reward_type: currentConfigRule.value.reward_type,
      tie_type: currentConfigRule.value.tie_type,
      collect_tie: currentConfigRule.value.collect_tie
    });
  } else if (currentConfigRule.value.type === '8421_1v1') {
    Object.assign(ruleData, {
      id: currentConfigRule.value.id,
      valid_holes: currentConfigRule.value.valid_holes,
      landmines: currentConfigRule.value.landmines,
      participant_count: currentConfigRule.value.participant_count,
      player_ids: (currentConfigRule.value.player_ids || []).slice(0, currentConfigRule.value.participant_count),
      reward_config: currentConfigRule.value.reward_config,
      tie_type: currentConfigRule.value.tie_type,
      collect_tie_type: currentConfigRule.value.collect_tie_type,
      deduction_type: currentConfigRule.value.deduction_type,
      deduction_par3_plus3: currentConfigRule.value.deduction_par3_plus3,
      starting_hole: currentConfigRule.value.starting_hole,
      player_8421: { ...(currentConfigRule.value.player_8421 || {}) },
    });
  } else if (currentConfigRule.value.type === 'strokes' || currentConfigRule.value.type === 'holes') {
    Object.assign(ruleData, {
      id: currentConfigRule.value.id, // Keep ID if editing
      valid_holes: currentConfigRule.value.valid_holes,
      landmines: currentConfigRule.value.landmines,
      participant_count: currentConfigRule.value.participant_count,
      player_ids: (currentConfigRule.value.player_ids || []).slice(0, currentConfigRule.value.participant_count),
      handicap_config: currentConfigRule.value.handicap_config,
      reward_config: currentConfigRule.value.reward_config,
      win_condition: currentConfigRule.value.win_condition,
      tie_type: currentConfigRule.value.tie_type,
      collect_tie_type: currentConfigRule.value.collect_tie_type,
      handicap_type: currentConfigRule.value.handicap_type,
      handicap_par_strokes: currentConfigRule.value.handicap_par_strokes,
      handicap_holes_count: currentConfigRule.value.handicap_holes_count,
      starting_hole: currentConfigRule.value.starting_hole,
      handicap_receiver_index: currentConfigRule.value.handicap_receiver_index,
      deduction_type: currentConfigRule.value.deduction_type,
      deduction_par3_plus3: currentConfigRule.value.deduction_par3_plus3
    });
  } else {
    Object.assign(ruleData, {
      is_mon: currentConfigRule.value.is_mon,
      birdie_double: currentConfigRule.value.birdie_double
    });
  }

  matchStore.addRule(ruleData);
  saveMatch();
  pkConfigReturnToRulesModal.value = false;
  showConfigModal.value = false;
};

const removeRule = (id: string) => {
  matchStore.removeRule(id);
  saveMatch();
};

/** 点击生效规则行：进入该规则编辑（子页返回后通过 storage 再打开规则列表） */
function onActiveRuleRowTap(rule: any) {
  showRulesModal.value = false;
  editRule(rule, { fromRulesList: true });
}

function closeConfigModal() {
  showConfigModal.value = false;
  if (pkConfigReturnToRulesModal.value) {
    pkConfigReturnToRulesModal.value = false;
    showRulesModal.value = true;
  }
}

const editRule = (rule: any, opts?: { fromRulesList?: boolean }) => {
  const fromList = !!opts?.fromRulesList;
  if (rule.type === 'tiger') {
    if (fromList) markScorecardReopenPkRulesModal();
    openRoute(Tab.PK_TIGER, { match_id: matchId.value, rule_id: rule.id });
    return;
  }
  if (rule.type === 'vegas_4') {
    if (fromList) markScorecardReopenPkRulesModal();
    openRoute(Tab.PK_LASHI, { match_id: matchId.value, rule_id: rule.id });
    return;
  }
  if (rule.type === 'landlord') {
    if (fromList) markScorecardReopenPkRulesModal();
    openRoute(Tab.PK_DIZHU, { match_id: matchId.value, rule_id: rule.id });
    return;
  }
  if (fromList) pkConfigReturnToRulesModal.value = true;
  else pkConfigReturnToRulesModal.value = false;
  currentConfigRule.value = normalizePkRulePlayerIds(JSON.parse(JSON.stringify(rule)) as PKRule);
  if (currentConfigRule.value.type === '8421_1v1' && !currentConfigRule.value.player_8421) {
    currentConfigRule.value.player_8421 = {};
  }
  const shRaw = currentConfigRule.value.starting_hole;
  const shNum = Number(shRaw);
  if (
    (currentConfigRule.value.type === 'strokes' ||
      currentConfigRule.value.type === 'holes' ||
      currentConfigRule.value.type === '8421_1v1') &&
    (!Number.isFinite(shNum) || shNum < 1 || shNum > 18)
  ) {
    currentConfigRule.value.starting_hole = 1;
  }
  showConfigModal.value = true;
};

let _cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;

function buildFullScoresPayloadForCloud() {
  return matchStore.holeScores.map((h) => {
    const scores = [...h.scores];
    const scoreTs = Array.isArray(h.scoreTs) ? [...h.scoreTs] : Array(scores.length).fill(0);
    while (scoreTs.length < scores.length) scoreTs.push(0);
    return {
      scores,
      par: typeof h.par === 'number' ? h.par : 4,
      scoreTs: scoreTs.slice(0, scores.length),
    };
  });
}

async function pushFullScoresToCloudOnce(mid: string): Promise<void> {
  // #ifdef MP-WEIXIN
  const full_scores = buildFullScoresPayloadForCloud();
  await new Promise<void>((resolve) => {
    try {
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve();
        return;
      }
      wx.cloud.callFunction({
        name: 'updateScore',
        data: { match_id: mid, full_scores },
        success: () => resolve(),
        fail: (e: unknown) => {
          console.warn('[scorecard] pushFullScoresToCloudOnce', e);
          resolve();
        },
      });
    } catch {
      resolve();
    }
  });
  // #endif
  // #ifndef MP-WEIXIN
  await Promise.resolve();
  // #endif
}

/** 成绩表 scores 集合：与个人页统计兼容 */
async function pushLegacyScoresTable(mid: string): Promise<void> {
  // #ifdef MP-WEIXIN
  const list = players.value;
  await Promise.all(
    list.map(
      (p, pIdx) =>
        new Promise<void>((resolve) => {
          try {
            if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
              resolve();
              return;
            }
            const holeScoresArr = matchStore.holeScores.map((h) => h.scores[pIdx] || 0);
            const total = holeScoresArr.reduce((a, b) => a + b, 0);
            wx.cloud.callFunction({
              name: 'updateScore',
              data: {
                match_id: mid,
                player_uid: p.id || '',
                player_name: p.nickname || '',
                hole_scores: holeScoresArr,
                total_score: total,
              },
              complete: () => resolve(),
            });
          } catch {
            resolve();
          }
        }),
    ),
  );
  // #endif
  // #ifndef MP-WEIXIN
  await Promise.resolve();
  // #endif
}

function queueCloudScoreSync() {
  if (_cloudSyncTimer) clearTimeout(_cloudSyncTimer);
  _cloudSyncTimer = setTimeout(() => {
    void flushCloudScoreSync();
  }, 400);
}

async function flushCloudScoreSync() {
  _cloudSyncTimer = null;
  const mid = currentMatch.value?.match_id;
  if (!mid) return;
  try {
    await pushFullScoresToCloudOnce(mid);
    await pushLegacyScoresTable(mid);
    await new Promise((r) => setTimeout(r, 120));
    let wait = 0;
    while (matchSyncInFlight && wait < 2500) {
      await new Promise((r) => setTimeout(r, 100));
      wait += 100;
    }
    await syncMatchFromCloud('show');
  } catch (e) {
    console.warn('[scorecard] flushCloudScoreSync', e);
  }
}

const saveMatch = async (opts?: { skipCloudPush?: boolean }) => {
  if (currentMatch.value) {
    const rulesJson = JSON.stringify(matchStore.activeRules);
    if (rulesJson !== lastSavedPkRulesJson) {
      currentMatch.value.pk_rules_sync_ts = Date.now();
      lastSavedPkRulesJson = rulesJson;
    }
    const metaSig = buildMatchMetaSig(currentMatch.value as Record<string, unknown>);
    if (metaSig !== lastSavedMatchMetaJson) {
      currentMatch.value.match_meta_sync_ts = Date.now();
      lastSavedMatchMetaJson = metaSig;
    }
    currentMatch.value.pk_rules = matchStore.activeRules;
    currentMatch.value.hole_scores = matchStore.holeScores;
    currentMatch.value.user_list = matchStore.user_list;
    await MatchManager.updateMatch(currentMatch.value, { skipCloudSave: opts?.skipCloudPush === true });
    lastLocalScoreCommitAt.value = Date.now();
    markScorecardPollActivity();
    if (!opts?.skipCloudPush) {
      queueCloudScoreSync();
    }
  }
};

/** 云侧 players 行 → 记分卡 Player（与 matchStore.normalizeMatchPlayer 对齐） */
function rosterRowToPlayer(raw: unknown, index: number): Player {
  if (!raw || typeof raw !== 'object') {
    return { id: `invalid_${index}`, nickname: '?', handicap: null };
  }
  const o = raw as Record<string, unknown>;
  const rawId = o.id ?? o.uid ?? o.openId ?? o.openid ?? o.player_uid;
  const id =
    rawId != null && String(rawId) !== ''
      ? String(rawId)
      : `anon_${index}_${Math.random().toString(36).slice(2, 8)}`;
  const nick = o.nickname ?? o.nickName;
  const nickname = nick != null && String(nick).trim() !== '' ? String(nick).trim() : GUEST_NICKNAME;
  const avatar = (o.avatar ?? o.avatarUrl) != null ? String(o.avatar ?? o.avatarUrl) : undefined;
  const rawHcp = o.handicap;
  let handicap: number | null = null;
  if (rawHcp !== '' && rawHcp !== undefined && rawHcp !== null) {
    const n = Number(rawHcp);
    handicap = Number.isFinite(n) ? n : null;
  }
  return { id, nickname, avatar: avatar || undefined, handicap };
}

/**
 * 与云端 players/user_list 对齐：退赛移除、新加入并入、顺序与云一致（permute 成绩列）。
 * 不在此处 saveMatch，由 syncMatchFromCloud 统一提交。
 */
function cloudRosterIdsSig(cloudMatch: any): string {
  const roster = (cloudMatch.user_list ?? cloudMatch.players) as unknown[];
  if (!Array.isArray(roster)) return '';
  return roster
    .map((raw, i) => rosterRowToPlayer(raw, i).id)
    .join('\u001f');
}

function localRosterIdsSig(): string {
  return matchStore.user_list.map((p) => p.id).join('\u001f');
}

function mergeCloudRosterIntoScorecard(cloudMatch: any): boolean {
  if (!cloudMatch || !currentMatch.value) return false;
  const roster = (cloudMatch.user_list ?? cloudMatch.players) as unknown[];
  if (!Array.isArray(roster) || roster.length === 0) return false;

  const cloudPlayers = roster.map((raw, i) => rosterRowToPlayer(raw, i));
  const cloudIds = cloudPlayers.map((p) => p.id);

  let changed = false;

  const toRemove = matchStore.user_list.filter((p) => !cloudIds.includes(p.id)).map((p) => p.id);
  for (const id of toRemove) {
    matchStore.removePlayer(id);
    changed = true;
  }

  const seen = new Set(matchStore.user_list.map((p) => p.id));
  for (const pl of cloudPlayers) {
    if (!seen.has(pl.id)) {
      matchStore.addPlayer(pl);
      seen.add(pl.id);
      changed = true;
    }
  }

  const curIds = matchStore.user_list.map((p) => p.id);
  const sameSet =
    curIds.length === cloudIds.length && cloudIds.every((id) => curIds.includes(id));
  if (sameSet && !cloudIds.every((id, i) => id === curIds[i])) {
    matchStore.reorderPlayersByIds(cloudIds);
    changed = true;
  }

  if (!changed) return false;

  matchStore.ensureEighteenHoles();
  currentMatch.value.user_list = matchStore.user_list as unknown[];
  currentMatch.value.hole_scores = matchStore.holeScores;
  if (Array.isArray(currentMatch.value.players)) {
    currentMatch.value.players = matchStore.user_list as unknown[];
  }
  return true;
}

/** 用云端 players 行的头像、昵称更新已在名单中的球友 */
function applyRosterCosmeticsFromCloud(cloudMatch: any): boolean {
  if (!cloudMatch || !matchStore.user_list.length) return false;
  const roster = (cloudMatch.user_list ?? cloudMatch.players) as unknown[];
  if (!Array.isArray(roster)) return false;
  let changed = false;
  const cloudPlayers = roster.map((raw, i) => rosterRowToPlayer(raw, i));
  for (const pl of cloudPlayers) {
    const idx = matchStore.user_list.findIndex((u) => u.id === pl.id);
    if (idx < 0) continue;
    const cur = matchStore.user_list[idx];
    const nick = pl.nickname && pl.nickname.trim() ? pl.nickname.trim() : cur.nickname;
    const avatar = mergeAvatarForCloudCosmeticSync(pl.avatar, cur.avatar);
    if (nick !== cur.nickname || avatar !== cur.avatar) {
      matchStore.user_list.splice(idx, 1, { ...cur, nickname: nick, avatar });
      changed = true;
    }
  }
  if (changed && currentMatch.value) {
    currentMatch.value.user_list = matchStore.user_list as unknown[];
    currentMatch.value.players = matchStore.user_list as unknown[];
  }
  return changed;
}

function parseCloudUpdatedAt(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === 'object' && v !== null && '_seconds' in (v as object)) {
    return Number((v as { _seconds?: number })._seconds) * 1000;
  }
  return 0;
}

type MatchCloudRevision = {
  match_id: string;
  updated_at_ms: number;
  match_meta_sync_ts: number;
  pk_rules_sync_ts: number;
  roster_sig: string;
  roster_len: number;
  embed_strokes: number;
  legacy_scores_ms: number;
  legacy_scores_count: number;
};

function matchRevisionSig(rev: MatchCloudRevision | null | undefined): string {
  if (!rev) return '';
  return JSON.stringify(rev);
}

function sortedRosterIdsSigFromMatch(m: Record<string, unknown> | null | undefined): string {
  if (!m) return '';
  const roster = (m.user_list ?? m.players) as unknown[];
  if (!Array.isArray(roster)) return '';
  return roster
    .map((raw, i) => rosterRowToPlayer(raw, i).id)
    .filter(Boolean)
    .sort()
    .join('\u001f');
}

function buildRevisionFromCloudMatch(cm: Record<string, unknown>): MatchCloudRevision {
  const embed = (cm.hole_scores ?? cm.scores) as unknown;
  const roster = (cm.user_list ?? cm.players) as unknown[];
  return {
    match_id: String(cm.match_id ?? ''),
    updated_at_ms: parseCloudUpdatedAt(cm.updated_at),
    match_meta_sync_ts: Number(cm.match_meta_sync_ts || 0),
    pk_rules_sync_ts: Number(cm.pk_rules_sync_ts || 0),
    roster_sig: sortedRosterIdsSigFromMatch(cm),
    roster_len: Array.isArray(roster) ? roster.length : 0,
    embed_strokes: strokeCountInHoleList(embed),
    legacy_scores_ms: 0,
    legacy_scores_count: 0,
  };
}

function buildMatchMetaSig(m: Record<string, unknown> | null | undefined): string {
  if (!m) return '';
  const em = enrichMatchKickoffFromDoc(m) ?? m;
  return JSON.stringify({
    t: em.title ?? '',
    cn: em.course_name ?? em.courseName ?? '',
    cid: em.course_id ?? '',
    bs: em.base_score ?? 1,
    st: em.status ?? 1,
    dt: em.date ?? '',
    ct: canonicalKickoffSigPart(em),
  });
}

function refreshSavedRuleAndMetaFingerprints() {
  lastSavedPkRulesJson = JSON.stringify(matchStore.activeRules);
  lastSavedMatchMetaJson = buildMatchMetaSig(currentMatch.value as Record<string, unknown> | undefined);
}

/** 云端 pk_rules / 比赛标题球场等：按 sync 时间戳最后写入为准 */
function mergePkRulesAndMetaFromCloud(cloudMatch: any): { pk: boolean; meta: boolean } {
  const out = { pk: false, meta: false };
  if (!currentMatch.value || !cloudMatch) return out;
  const cloudPkTs = Number(cloudMatch.pk_rules_sync_ts || 0);
  const localPkTs = Number(currentMatch.value.pk_rules_sync_ts || 0);
  const cloudArr = cloudMatch.pk_rules ?? cloudMatch.pk_results;
  if (Array.isArray(cloudArr) && cloudArr.length > 0 && cloudPkTs > localPkTs) {
    const cloned = JSON.parse(JSON.stringify(cloudArr)) as PKRule[];
    matchStore.activeRules = cloned.map((r) => normalizePkRulePlayerIds(r));
    currentMatch.value.pk_rules = matchStore.activeRules as unknown as typeof currentMatch.value.pk_rules;
    currentMatch.value.pk_rules_sync_ts = cloudPkTs;
    lastSavedPkRulesJson = JSON.stringify(matchStore.activeRules);
    out.pk = true;
  }
  const cloudMetaTs = Number(cloudMatch.match_meta_sync_ts || 0);
  const localMetaTs = Number(currentMatch.value.match_meta_sync_ts || 0);
  if (cloudMetaTs > localMetaTs) {
    const cm = cloudMatch;
    if (cm.title != null) currentMatch.value.title = cm.title;
    if (cm.course_name != null) currentMatch.value.course_name = cm.course_name;
    if (cm.courseName != null) currentMatch.value.courseName = cm.courseName;
    if (cm.course_id != null) currentMatch.value.course_id = cm.course_id;
    if (cm.base_score != null) currentMatch.value.base_score = cm.base_score;
    if (cm.status != null) currentMatch.value.status = cm.status;
    if (cm.date != null) currentMatch.value.date = cm.date;
    if (cm.create_time != null) currentMatch.value.create_time = cm.create_time;
    currentMatch.value.match_meta_sync_ts = cloudMetaTs;
    lastSavedMatchMetaJson = buildMatchMetaSig(currentMatch.value as Record<string, unknown>);
    out.meta = true;
  }

  /** 开球时间与 match_meta_sync_ts 解耦：云 getMatch 里 created_at/date 映射后写回，避免本机抢了时间戳后轮询再也拉不到原始开球时刻 */
  const cmRec = enrichMatchKickoffFromDoc(cloudMatch as Record<string, unknown>);
  const cloudKick = cmRec ? normalizeKickoffForStorage(cmRec.create_time) : null;
  if (cloudKick != null) {
    const localEmb = enrichMatchKickoffFromDoc(currentMatch.value as Record<string, unknown>);
    const localKick = localEmb ? normalizeKickoffForStorage(localEmb.create_time) : null;
    const ck = coerceKickoffToMs(cloudKick);
    const lk = localKick != null ? coerceKickoffToMs(localKick) : NaN;
    if (!Number.isFinite(lk) || lk !== ck) {
      (currentMatch.value as Record<string, unknown>).create_time = cloudKick as never;
      lastSavedMatchMetaJson = buildMatchMetaSig(currentMatch.value as Record<string, unknown>);
      out.meta = true;
    }
  }
  return out;
}

/** 合并云端成绩：scoreTs 较大的一侧为准；均无时间戳时用比赛 updated_at 与 lastLocalScoreCommitAt 辅助判定 */
function mergeHoleScoresFromCloud(cloudMatch: any): boolean {
  if (!currentMatch.value || !matchStore.user_list.length) return false;
  const cloudHoles = (cloudMatch.hole_scores ?? cloudMatch.scores) as unknown[];
  if (!Array.isArray(cloudHoles) || cloudHoles.length === 0) return false;
  const docTime = parseCloudUpdatedAt(cloudMatch.updated_at);
  const nPlayers = matchStore.user_list.length;
  let changed = false;
  matchStore.ensureEighteenHoles();
  for (let h = 0; h < 18; h++) {
    const ch = cloudHoles[h] as Record<string, unknown> | undefined;
    const cScores = ch && Array.isArray(ch.scores) ? (ch.scores as number[]) : [];
    const cTs = ch && Array.isArray(ch.scoreTs) ? (ch.scoreTs as number[]) : [];
    const lh = matchStore.holeScores[h];
    if (!lh) continue;
    if (!Array.isArray(lh.scoreTs)) {
      lh.scoreTs = Array(lh.scores.length).fill(0);
    }
    while (lh.scoreTs.length < lh.scores.length) lh.scoreTs.push(0);
    for (let p = 0; p < nPlayers; p++) {
      const cv = Number(cScores[p] ?? 0);
      const cTraw = Number(cTs[p] ?? 0);
      const lv = Number(lh.scores[p] ?? 0);
      const lT = Number(lh.scoreTs[p] ?? 0);
      let takeCloud = false;
      if (cTraw > lT) takeCloud = true;
      else if (lT > cTraw) takeCloud = false;
      else if (cv !== lv) {
        if (cTraw === 0 && lT === 0) {
          takeCloud = docTime > lastLocalScoreCommitAt.value || (lv === 0 && cv > 0);
        }
      }
      if (takeCloud) {
        const newTs = cTraw > 0 ? cTraw : docTime > 0 ? docTime : 0;
        if (lv !== cv || lT !== newTs) {
          lh.scores[p] = cv;
          lh.scoreTs[p] = newTs;
          changed = true;
        }
      }
    }
  }
  if (changed && currentMatch.value) {
    currentMatch.value.hole_scores = matchStore.holeScores;
  }
  return changed;
}

let matchSyncInFlight = false;
let rosterPollTimer: ReturnType<typeof setInterval> | null = null;
/** 上次完整同步后云端 revision 指纹；轮询先比对，未变则跳过 getMatch 全量 */
let lastKnownCloudRevisionSig = '';
const POLL_INTERVAL_ACTIVE_MS = 5000;
const POLL_INTERVAL_IDLE_MS = 15000;
const POLL_ACTIVITY_WINDOW_MS = 120000;
let pollIntervalMs = POLL_INTERVAL_ACTIVE_MS;
let lastPollActivityAt = 0;

function markScorecardPollActivity() {
  lastPollActivityAt = Date.now();
  rescheduleScorecardPollTimer();
}

function computeScorecardPollIntervalMs(): number {
  if (lastPollActivityAt > 0 && Date.now() - lastPollActivityAt < POLL_ACTIVITY_WINDOW_MS) {
    return POLL_INTERVAL_ACTIVE_MS;
  }
  return POLL_INTERVAL_IDLE_MS;
}

function rescheduleScorecardPollTimer() {
  if (rosterPollTimer != null) {
    clearInterval(rosterPollTimer);
    rosterPollTimer = null;
  }
  pollIntervalMs = computeScorecardPollIntervalMs();
  rosterPollTimer = setInterval(() => {
    void syncMatchFromCloud('poll');
    const next = computeScorecardPollIntervalMs();
    if (next !== pollIntervalMs) {
      rescheduleScorecardPollTimer();
    }
  }, pollIntervalMs);
}

async function fetchMatchRevision(mid: string): Promise<MatchCloudRevision | null> {
  const res = await callWxCloudFn<{ success?: boolean; revision?: MatchCloudRevision }>('getMatch', {
    match_id: mid,
    revision_only: true,
  });
  if (!res?.success || !res.revision) return null;
  return res.revision;
}

function rememberCloudRevision(rev: MatchCloudRevision | null | undefined, cm?: Record<string, unknown>) {
  const sig = matchRevisionSig(rev ?? (cm ? buildRevisionFromCloudMatch(cm) : null));
  if (sig) lastKnownCloudRevisionSig = sig;
}

/** 从云端拉取：头像/昵称、新球友、成绩（最后录入为准） */
async function syncMatchFromCloud(source: 'show' | 'poll' | 'pull') {
  const mid = matchId.value;
  if (!mid || !currentMatch.value) return;
  if (enteredViaInvite.value && (await shouldBlockCloudForPrivacy())) return;
  if (matchSyncInFlight) return;
  matchSyncInFlight = true;
  try {
    if (source === 'poll') {
      const rev = await fetchMatchRevision(mid);
      if (rev) {
        const cloudSig = matchRevisionSig(rev);
        if (cloudSig && cloudSig === lastKnownCloudRevisionSig) {
          console.info('[scorecard] syncMatchFromCloud poll skip unchanged', { mid });
          return;
        }
      }
    }

    const cloudRes = await callWxCloudFn<{ success?: boolean; match?: any; revision?: MatchCloudRevision }>(
      'getMatch',
      { match_id: mid },
    );
    if (!cloudRes?.success || !cloudRes.match) return;
    const cm = cloudRes.match;
    rememberCloudRevision(cloudRes.revision, cm as Record<string, unknown>);
    let changed = false;
    let newPlayers = false;
    let scoreUpdate = false;
    const rulesMeta = mergePkRulesAndMetaFromCloud(cm);
    changed = rulesMeta.pk || rulesMeta.meta || changed;

    const rosterStable =
      source === 'poll' &&
      cloudRosterIdsSig(cm) === localRosterIdsSig() &&
      localRosterIdsSig().length > 0;

    if (!rosterStable) {
      changed = applyRosterCosmeticsFromCloud(cm) || changed;
      newPlayers = mergeCloudRosterIntoScorecard(cm) || newPlayers;
      changed = newPlayers || changed;
      changed = applyRosterCosmeticsFromCloud(cm) || changed;
    }
    scoreUpdate = mergeHoleScoresFromCloud(cm) || scoreUpdate;
    changed = scoreUpdate || changed;

    const needsAvatarHydrate = matchStore.user_list.some((p) => {
      const id = String(p.id || '');
      if (!id || id.startsWith('virtual_') || id.startsWith('temp_') || id.startsWith('anon_')) return false;
      const av = String(p.avatar || '').trim();
      if (!av) return true;
      if (av.startsWith('cloud://')) return true;
      return !isShareableAvatarUrl(av);
    });
    const shouldHydrateProfiles = needsAvatarHydrate || source !== 'poll' || !rosterStable;
    let hydratedProfiles = false;
    if (shouldHydrateProfiles) {
      hydratedProfiles = await hydrateTeammatesFromUsersCollection(cm as Record<string, unknown>);
    }

    const scoresOnlyPoll =
      source === 'poll' &&
      rosterStable &&
      scoreUpdate &&
      !newPlayers &&
      !rulesMeta.pk &&
      !rulesMeta.meta &&
      !hydratedProfiles;

    if (scoresOnlyPoll) {
      if (currentMatch.value) {
        currentMatch.value.hole_scores = matchStore.holeScores as unknown[];
      }
      await MatchManager.upsertLocalMatch(currentMatch.value);
      await saveMatch({ skipCloudPush: true });
    } else if (changed || hydratedProfiles) {
      currentMatch.value.user_list = matchStore.user_list as unknown[];
      currentMatch.value.hole_scores = matchStore.holeScores;
      if (Array.isArray(currentMatch.value.players)) {
        currentMatch.value.players = matchStore.user_list as unknown[];
      }
      await MatchManager.upsertLocalMatch(currentMatch.value);
      await saveMatch({ skipCloudPush: true });
    }
    if (!scoresOnlyPoll && (shouldHydrateProfiles || newPlayers)) {
      await hydrateRosterAvatarDisplay(!!newPlayers || source !== 'poll');
    }
    if (source === 'poll' || source === 'pull') {
      if (newPlayers || scoreUpdate || rulesMeta.pk || rulesMeta.meta) {
        const bits: string[] = [];
        if (newPlayers) bits.push('球友');
        if (scoreUpdate) bits.push('成绩');
        if (rulesMeta.pk || rulesMeta.meta) bits.push('规则/信息');
        uni.showToast({ title: `已同步${bits.join('、')}`, icon: 'none', duration: 1600 });
      } else if (source === 'pull') {
        uni.showToast({ title: '已刷新', icon: 'none', duration: 1200 });
      }
    }
    console.info('[scorecard] syncMatchFromCloud', {
      source,
      mid,
      newPlayers,
      scoreUpdate,
      rulesMeta,
      changed,
    });
    if (source === 'poll' && (newPlayers || scoreUpdate || rulesMeta.pk || rulesMeta.meta)) {
      markScorecardPollActivity();
    }
    await finalizeCurrentMatchKickoffAutoEnd();
  } catch (e) {
    console.warn('[scorecard] syncMatchFromCloud', e);
  } finally {
    matchSyncInFlight = false;
  }
}

onShow(() => {
  if (consumeScorecardReopenPkRulesModal()) {
    showRulesModal.value = true;
  }
  void syncMatchFromCloud('show');
});

onPullDownRefresh(async () => {
  try {
    await syncMatchFromCloud('pull');
  } catch (e) {
    console.warn('[scorecard] onPullDownRefresh', e);
  } finally {
    uni.stopPullDownRefresh();
  }
});

onMounted(() => {
  markScorecardPollActivity();
  rescheduleScorecardPollTimer();
});

onUnmounted(() => {
  if (rosterPollTimer != null) {
    clearInterval(rosterPollTimer);
    rosterPollTimer = null;
  }
});

async function fetchMatchQrImage() {
  qrImageSrc.value = '';
  const mid = matchId.value;
  if (!mid) return;
  // #ifdef MP-WEIXIN
  try {
    const res = await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'getMatchQr',
        data: { match_id: mid },
        success: (r: { result?: unknown }) => resolve((r?.result as Record<string, unknown>) ?? null),
        fail: reject,
      });
    });
    const b64 = res?.base64;
    if (typeof b64 === 'string' && b64.length > 0) {
      qrImageSrc.value = `data:image/png;base64,${b64}`;
    }
  } catch (e) {
    console.warn('[scorecard] getMatchQr', e);
  }
  // #endif
}

watch(showQRCodeModal, (v) => {
  if (v) void fetchMatchQrImage();
});

const players = computed(() => {
  if (matchStore.user_list.length > 0) return matchStore.user_list;
  return [{
    id: userStore.openId || 'self',
    nickname: userStore.profile.nickname || '我',
    avatar: userStore.profile.avatar || '',
    handicap: userStore.profile.handicap || 0,
  }];
});

const DEFAULT_RULE_SLOT_AVATAR = mpStaticAbsolute('tab/me.png');

function avatarOrDefault(p: { id?: string; avatar?: string } | null | undefined): string {
  const id = p?.id != null ? String(p.id).trim() : '';
  const resolved = id ? rosterAvatarDisplay.value[id] || getCachedAvatarDisplay(id) : '';
  const a = resolved || (p?.avatar != null ? String(p.avatar).trim() : '');
  return mpAvatarImgSrcForDisplay(a, DEFAULT_RULE_SLOT_AVATAR);
}

function playerForRuleSlot(slotIndex: number) {
  const id = currentConfigRule.value?.player_ids?.[slotIndex];
  if (!id) return null;
  return players.value.find((q) => q.id === id) ?? null;
}

const holes = computed(() => Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: matchStore.holeScores[i]?.par || 4,
  index: i
})));
const leadPlayer = computed(() => players.value[0] || null);
const leadPlayerTotal = computed(() => {
  if (!leadPlayer.value) return 0;
  return getTotalStrokes(leadPlayer.value.id);
});

// Score Helpers
const getScore = (pid: string, holeIndex: number) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1 || !matchStore.holeScores[holeIndex]) return 0;
  return matchStore.holeScores[holeIndex].scores[pIdx];
};

const getHoleProfit = (pid: string, holeIndex: number) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  // Use the new holeProfits getter which handles carryover correctly
  return matchStore.holeProfits[holeIndex][pIdx] || 0;
};

const getRuleDisplayName = (rule: any) => {
  const summary = getRuleSummary(rule);
  return `${rule.name}：${summary}`;
};

const pkRulePickerRange = computed(() => {
  const labels: string[] = ['得分汇总'];
  for (const r of matchStore.activeRules) {
    labels.push(getRuleDisplayName(r));
  }
  return labels;
});

const pkRulePickerValues = computed(() =>
  ['all', ...matchStore.activeRules.map((r: PKRule) => r.id)] as string[]
);

const pkRulePickerIndex = computed(() => {
  const i = pkRulePickerValues.value.indexOf(selectedPKRuleId.value);
  return i >= 0 ? i : 0;
});

const onPkRulePickerChange = (e: { detail: { value: string } }) => {
  const idx = Number(e.detail.value);
  const vals = pkRulePickerValues.value;
  selectedPKRuleId.value = vals[idx] ?? 'all';
};

const getScoreRelativeText = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  if (!score) return 'E';
  const par = matchStore.holeScores[holeIndex]?.par || 4;
  const diff = score - par;
  return diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getPKTotal = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  return matchStore.totalProfits[pIdx];
};

const currentPKProfits = computed(() => {
  if (selectedPKRuleId.value === 'all') {
    return matchStore.holeProfits;
  } else {
    return matchStore.getProfitsByRule(selectedPKRuleId.value);
  }
});

const getPKScoreTotal = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  
  let total = 0;
  for (let i = 0; i < 18; i++) {
    total += currentPKProfits.value[i][pIdx] || 0;
  }
  return total;
};

const getPKScoreHole = (pid: string, holeIndex: number) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  return currentPKProfits.value[holeIndex][pIdx] || 0;
};

/** 同一洞可同时进行打老虎+斗地主：虎固定左上、地固定右上，避免重叠 */
type RoleBadgesSplit = { showTiger: boolean; showLandlord: boolean };

const getRoleBadgesSplit = (pid: string, holeIndex: number): RoleBadgesSplit => {
  const out: RoleBadgesSplit = { showTiger: false, showLandlord: false };
  const landlordRules = matchStore.activeRules.filter((r) => r.type === 'landlord' || r.type === 'tiger');
  if (landlordRules.length === 0) return out;

  for (const rule of landlordRules) {
    const config = rule.config;
    if (config?.landlord_type === '流动地主' || config?.category === '流动老虎') {
      if (holeIndex > 0) {
        const prevHole = matchStore.holeScores[holeIndex - 1];
        if (!prevHole || prevHole.scores.every((s) => s === 0)) continue;
      }
    }

    const lIdx = matchStore.getLandlordIndex(holeIndex, rule);
    if (lIdx === -1) continue;
    const landlordId = matchStore.user_list[lIdx]?.id;
    if (landlordId !== pid) continue;
    if (rule.type === 'tiger') out.showTiger = true;
    if (rule.type === 'landlord') out.showLandlord = true;
  }
  return out;
};

const getVegasTeamColor = (pid: string, holeIndex: number) => {
  const vegasRule = matchStore.activeRules.find(r => r.type === 'vegas_4');
  if (!vegasRule) return null;

  const { teamA, teamB } = matchStore.getVegasGrouping(holeIndex, vegasRule);
  const pIdx = players.value.findIndex(p => p.id === pid);
  
  if (teamA.includes(pIdx)) return 'bg-red-500';
  if (teamB.includes(pIdx)) return 'bg-blue-500';
  return null;
};

const getTotalPar = () => {
  return matchStore.holeScores.reduce((sum, h) => sum + (h.par || 4), 0);
};

const getFront9 = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return '0';
  const playedHoles = matchStore.holeScores.slice(0, 9).filter(h => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return '0';
  
  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const par = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  const diff = strokes - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getBack9 = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return '0';
  const playedHoles = matchStore.holeScores.slice(9, 18).filter(h => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return '0';

  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const par = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  const diff = strokes - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

/** 海报用：前九/后九已打洞的杆数与相对标准杆差（未打满该半区也可统计） */
const getPosterNineHoleStats = (pid: string, startHole: 0 | 9) => {
  const pIdx = players.value.findIndex((p) => p.id === pid);
  if (pIdx < 0) return { strokes: 0, diff: null as number | null, played: 0 };
  const slice = matchStore.holeScores.slice(startHole, startHole + 9);
  const playedHoles = slice.filter((h) => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return { strokes: 0, diff: null, played: 0 };
  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const parSum = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  return { strokes, diff: strokes - parSum, played: playedHoles.length };
};

const getTotalDiff = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return '0';
  const playedHoles = matchStore.holeScores.filter(h => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return '0';

  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const par = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  const diff = strokes - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getTotalStrokes = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  return matchStore.holeScores.reduce((sum, h) => sum + (h.scores[pIdx] || 0), 0);
};

const get8421Points = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  return Math.round(matchStore.total8421Points[pIdx]);
};

const saveScore = () => {
  if (!editingCell.value || modalDraftStrokes.value == null) return;
  const pIdx = players.value.findIndex(p => p.id === editingCell.value!.pid);
  const hIdx = editingCell.value!.holeIndex;
  let v = modalDraftStrokes.value;
  if (v <= 0) v = matchStore.holeScores[hIdx].par;
  matchStore.updateScore(hIdx, pIdx, v);
  showScoreModal.value = false;
  modalDraftStrokes.value = null;
  void saveMatch();
};

const closeScoreModalDiscard = () => {
  showScoreModal.value = false;
  modalDraftStrokes.value = null;
};

// Modal Actions
const openScoreModal = (pid: string, holeIndex: number) => {
  if (isInteractionLocked.value) return;
  editingCell.value = { pid, holeIndex };
  const pIdx = players.value.findIndex(p => p.id === pid);
  const raw = matchStore.holeScores[holeIndex]?.scores[pIdx] || 0;
  const par = matchStore.holeScores[holeIndex]?.par || 4;
  modalDraftStrokes.value = raw > 0 ? raw : par;
  showScoreModal.value = true;
};

const updateModalScoreDelta = (delta: number) => {
  if (!editingCell.value || modalDraftStrokes.value == null) return;
  modalDraftStrokes.value = Math.max(1, modalDraftStrokes.value + delta);
};

const getModalRelativeText = (): string => {
  if (!editingCell.value || modalDraftStrokes.value == null) return 'E';
  const hIdx = editingCell.value.holeIndex;
  const par = matchStore.holeScores[hIdx]?.par || 4;
  const diff = modalDraftStrokes.value - par;
  return diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const clearScore = () => {
  if (!editingCell.value) return;
  const pIdx = players.value.findIndex(p => p.id === editingCell.value!.pid);
  matchStore.updateScore(editingCell.value!.holeIndex, pIdx, 0);
  showScoreModal.value = false;
  modalDraftStrokes.value = null;
  void saveMatch();
};

const handleRemovePlayer = (player: Player) => {
  const hostId = currentMatch.value?.user_list?.[0]?.id || myId.value;
  if (player.id === hostId) {
    uni.showToast({ title: '不可删除发起人', icon: 'none' });
    return;
  }
  uni.showModal({
    title: '删除参赛者',
    content: `确定删除 ${player.nickname} 及其成绩？`,
    success: (res) => {
      if (!res.confirm) return;
      matchStore.removePlayer(player.id);
      if (currentMatch.value) {
        currentMatch.value.user_list = matchStore.user_list;
        currentMatch.value.hole_scores = matchStore.holeScores;
        void saveMatch();
      }
      showPlayerActionModal.value = false;
    },
  });
};

const addRule = () => {
  matchStore.addRule({
    type: newRuleType.value,
    base_score: newRuleBase.value,
    is_mon: false,
    birdie_double: true
  });
};

const showShareModal = ref(false);
const sharePlayerId = ref('');

function openSharePosterModal() {
  showShareModal.value = true;
  sharePlayerId.value = leadPlayer.value?.id || players.value[0]?.id || '';
}

const handleShare = (type: 'friend' | 'moments') => {
  openSharePosterModal();
};

async function saveShareCardPoster() {
  try {
    await savePackagedImageToAlbum(SCORECARD_POSTER_BG_SRC);
    showShareModal.value = false;
  } catch (e) {
    console.warn('[scorecard] saveShareCardPoster', e);
  }
}

const getPlayerTotalPar = (pid: string) => {
  const pIdx = players.value.findIndex((p) => p.id === pid);
  if (pIdx < 0) return 0;
  return matchStore.holeScores.reduce((sum, h) => (h.scores[pIdx] > 0 ? sum + (h.par || 4) : sum), 0);
};

const getPlayerStatCounts = (pid: string) => {
  const pIdx = players.value.findIndex((p) => p.id === pid);
  if (pIdx < 0) return { birdie: 0, eagleOrBetter: 0, par: 0, bogeyPlus: 0 };
  let birdie = 0;
  let eagleOrBetter = 0;
  let par = 0;
  let bogeyPlus = 0;
  for (const h of matchStore.holeScores) {
    const sc = Number(h.scores[pIdx] || 0);
    if (sc <= 0) continue;
    const diff = sc - Number(h.par || 4);
    if (diff <= -2) eagleOrBetter++;
    else if (diff === -1) birdie++;
    else if (diff === 0) par++;
    else bogeyPlus++;
  }
  return { birdie, eagleOrBetter, par, bogeyPlus };
};

async function posterResolveImageForCanvas(sources: string[], label: string): Promise<string> {
  const seen = new Set<string>();
  for (const src of sources) {
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const path = await new Promise<string>((resolve) => {
      uni.getImageInfo({
        src,
        success: (r) => resolve((r as { path?: string }).path || ''),
        fail: () => resolve(''),
      });
    });
    if (path) {
      console.info(`[scorecard] poster ${label} ok`, src, '->', path);
      return path;
    }
    console.warn(`[scorecard] poster ${label} getImageInfo fail`, src);
  }
  return '';
}

async function posterGetPackagedImg(
  src: string,
): Promise<{ path: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    uni.getImageInfo({
      src,
      success: (r) => {
        const path = (r as { path?: string }).path || '';
        const width = Number((r as { width?: number }).width) || 0;
        const height = Number((r as { height?: number }).height) || 0;
        if (path) resolve({ path, width, height });
        else resolve(null);
      },
      fail: () => resolve(null),
    });
  });
}

async function savePersonalScorePoster() {
  const pid = sharePlayerId.value || leadPlayer.value?.id || '';
  if (!pid) {
    uni.showToast({ title: '请先选择球手', icon: 'none' });
    return;
  }
  const player = players.value.find((p) => p.id === pid);
  if (!player) {
    uni.showToast({ title: '未找到该球手', icon: 'none' });
    return;
  }
  /** Canvas 2D：必须在首个 await 之前取实例；await 后继体里 getCurrentInstance() 常为空，不传 .in() 时真机取不到 #scorePosterCanvas2d。 */
  const posterWxCompProxy = getCurrentInstance()?.proxy;
  let posterWatchdog: ReturnType<typeof setTimeout> | null = null;
  const clearPosterWatchdog = () => {
    if (posterWatchdog != null) {
      clearTimeout(posterWatchdog);
      posterWatchdog = null;
    }
  };
  const endPosterLoading = () => {
    try {
      uni.hideLoading();
    } catch {
      /* ignore */
    }
    clearPosterWatchdog();
  };
  try {
    /** mask 为 true 时部分基础库下与离屏 canvas 合成冲突，易导致 draw 回调不返回 */
    uni.showLoading({ title: '生成中…', mask: false });
    posterWatchdog = setTimeout(() => {
      posterWatchdog = null;
      endPosterLoading();
      uni.showToast({ title: '生成超时，请重试', icon: 'none' });
    }, 45000);
    let headerImg = await posterGetPackagedImg(POSTER_HEADER_BG_SRC);
    if (!headerImg) headerImg = await posterGetPackagedImg(SCORECARD_POSTER_BG_SRC);

    const avatarPath = await new Promise<string>((resolve) => {
      const src = player.avatar || '';
      if (!src) {
        resolve('');
        return;
      }
      uni.getImageInfo({
        src,
        success: (r) => resolve(r.path),
        fail: () => resolve(''),
      });
    });
    const qrPack = await posterGetPackagedImg(POSTER_MINIAPP_QR_SRC);
    let qrDrawPath =
      (qrPack?.path ? qrPack.path : '') ||
      (await posterResolveImageForCanvas([POSTER_MINIAPP_QR_SRC], 'qr')) ||
      POSTER_MINIAPP_QR_SRC;

    /** 海报：微信小程序 Canvas 2D（仅此生成路径） */
    await nextTick();
    await nextTick();

    const total = getTotalStrokes(player.id);
    const totalParPlayed = getPlayerTotalPar(player.id);
    const diff = totalParPlayed > 0 ? total - totalParPlayed : 0;
    const frontNine = getPosterNineHoleStats(player.id, 0);
    const backNine = getPosterNineHoleStats(player.id, 9);
    const stat = getPlayerStatCounts(player.id);

    const { canvas: posterCanvasNode, ctx: posterCtx2d, dpr } =
      await acquireMpPosterCanvas2d(posterWxCompProxy as never);

    let headerBmp = null as Awaited<ReturnType<typeof loadMpCanvas2dImage>> | null;
    try {
      headerBmp = await loadMpCanvas2dImage(posterCanvasNode, POSTER_HEADER_BG_SRC, [
        ...(headerImg?.path ? [headerImg.path] : []),
        SCORECARD_POSTER_BG_SRC,
      ]);
    } catch (e) {
      console.warn('[scorecard] poster2d header', e);
    }

    let avatarBmp = null as Awaited<ReturnType<typeof loadMpCanvas2dImage>> | null;
    if (avatarPath || player.avatar) {
      try {
        avatarBmp = await loadMpCanvas2dImage(posterCanvasNode, avatarPath || '', [
          ...(player.avatar && player.avatar !== avatarPath ? [player.avatar] : []),
        ]);
      } catch (e) {
        console.warn('[scorecard] poster2d avatar', e);
      }
    }

    const qrBmp = await loadMpCanvas2dImage(posterCanvasNode, POSTER_MINIAPP_QR_SRC, [qrDrawPath].filter(Boolean));

    paintPersonalScorePoster2d(
      posterCtx2d,
      { header: headerBmp, qr: qrBmp, avatar: avatarBmp },
      {
        courseName: scorecardCourseName.value,
        dateStr: formatMatchKickoffCn(currentMatch.value),
        nickname: player.nickname || '我自己',
        total,
        diff,
        frontNine,
        backNine,
        stat,
        getScore: (hi) => getScore(player.id, hi),
        getPar: (hi) => matchStore.holeScores[hi]?.par || 4,
      },
    );

    const tmpPath = await exportMpPosterCanvas2dTempPath(posterCanvasNode, dpr, posterWxCompProxy as never);

    endPosterLoading();
    posterPreviewSrc.value = tmpPath;
    showShareModal.value = false;
    showPosterPreviewModal.value = true;

  } catch (e) {
    endPosterLoading();
    const detail = typeof e === 'object' && e && 'errMsg' in e ? (e as { errMsg?: string }).errMsg : String(e);
    console.warn('[scorecard] savePersonalScorePoster', e, detail);
    uni.showToast({ title: '海报生成失败', icon: 'none' });
  }
}

async function savePosterFromPreview() {
  if (!posterPreviewSrc.value) return;
  await saveImageToPhotosAlbumSafe(posterPreviewSrc.value);
  showPosterPreviewModal.value = false;
}

/** 格内杆差：0 / +n / -n（与海报、各洞展示一致）；无成绩洞不调用 */
const getScoreDiffText = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  if (!score || !matchStore.holeScores[holeIndex]) return '';
  const par = matchStore.holeScores[holeIndex].par;
  const diff = score - par;
  return diff === 0 ? '0' : diff > 0 ? `+${diff}` : `${diff}`;
};

/** 计分格展示：有杆数时一律显示杆差（已完赛回看与进行中相同） */
const getScoreCellDisplayText = (pid: string, holeIndex: number) => {
  const gross = getScore(pid, holeIndex);
  if (!matchStore.holeScores[holeIndex]) return '—';
  if (!gross) return '-';
  return getScoreDiffText(pid, holeIndex);
};

const getHoleMarkKind = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  const par = matchStore.holeScores[holeIndex]?.par ?? 4;
  return golfHoleMarkKind(score, par);
};

/** 杆差符号：双圈/双方框为模板嵌套 view；其馀见 golfScoreShapes */
const getScoreShapeClasses = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  const par = matchStore.holeScores[holeIndex]?.par ?? 4;
  return golfScoreCellMarkClasses(score, par);
};

const formatPlayerHandicapDisplay = (h: number | null | undefined) =>
  h === null || h === undefined ? '' : String(h);

const isLandmineExploded = (holeIndex: number) => {
  const holeNum = holeIndex + 1;
  const strokesRule = matchStore.activeRules.find(r => r.type === 'strokes' && r.landmines?.assignedHoles.includes(holeNum));
  if (!strokesRule) return false;
  
  const hole = matchStore.holeScores[holeIndex];
  return hole && !hole.scores.some(s => s === 0);
};

// 统计某球员已打完的洞数
const getCompletedHolesCount = (pid: string) => {
  const pIdx = players.value.findIndex((p) => p.id === pid);
  if (pIdx < 0) return 0;
  return matchStore.holeScores.filter((h) => h.scores[pIdx] > 0).length;
};

// 总杆展示列：完赛显示总杆，未完赛显示"已完成x洞 +n"
const getPlayerTotalDisplay = (pid: string) => {
  const completed = getCompletedHolesCount(pid);
  if (completed === 0) return '-';
  const total = getTotalStrokes(pid);
  const isFinished = currentMatch.value?.status === 2 || completed >= 18;
  if (isFinished) return `${total || '-'}`;
  // 计算与已打洞标准杆的差值
  const pIdx = players.value.findIndex((p) => p.id === pid);
  const completedPar = pIdx >= 0
    ? matchStore.holeScores
        .filter((h) => h.scores[pIdx] > 0)
        .reduce((sum, h) => sum + (h.par || 4), 0)
    : 0;
  const diff = (total || 0) - completedPar;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff}`;
};

/** 不传 imageUrl：微信使用当前计分页截图作为分享卡片图；必须有 match_id 才能邀请进正确球局 */
onShareAppMessage(() => {
  const path = scorecardSharePath.value;
  const hasMid = /[?&]match_id=/.test(path);
  if (!hasMid) {
    uni.showToast({ title: '球局尚未加载，请稍后再分享', icon: 'none' });
  }
  return {
    title: scorecardShareTitle.value,
    path: hasMid ? path : 'pages/index/index',
  };
});

onShareTimeline(() => {
  const q = scorecardShareTimelineQuery.value;
  const hasMid = q.includes('match_id=');
  return {
    title: scorecardShareTitle.value,
    query: hasMid ? q : 'from=share',
  };
});

// 信息条右侧：显示主球手进度
const leadPlayerSummaryLabel = computed(() => {
  if (!leadPlayer.value) return '总杆';
  const completed = getCompletedHolesCount(leadPlayer.value.id);
  if (completed === 0) return '待开球';
  const isFinished = currentMatch.value?.status === 2 || completed >= 18;
  if (isFinished) return '总杆';
  return `已完成 ${completed} 洞`;
});

const leadPlayerSummaryScore = computed(() => {
  if (!leadPlayer.value) return '--';
  const completed = getCompletedHolesCount(leadPlayer.value.id);
  if (completed === 0) return '--';
  const total = getTotalStrokes(leadPlayer.value.id);
  const isFinished = currentMatch.value?.status === 2 || completed >= 18;
  if (isFinished) return `${total || '--'}`;
  const pIdx = players.value.findIndex((p) => p.id === leadPlayer.value!.id);
  const completedPar = pIdx >= 0
    ? matchStore.holeScores
        .filter((h) => h.scores[pIdx] > 0)
        .reduce((sum, h) => sum + (h.par || 4), 0)
    : 0;
  const diff = (total || 0) - completedPar;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff}`;
});

// 海报预览
const showPosterPreviewModal = ref(false);
const posterPreviewSrc = ref('');
</script>

<template>
  <div class="scorecard-root fixed inset-0 bg-slate-950 text-slate-100 flex flex-col font-sans select-none safe-top">
    <!-- #ifdef MP-WEIXIN -->
    <MpPrivacyGateModal
      :show="showScorecardPrivacyModal"
      @agree="onScorecardPrivacyAgree"
      @disagree="onScorecardPrivacyDisagree"
      @open-contract="openScorecardPrivacyContract"
    />
    <PrivacyPopup />
    <!-- #endif -->
    <!-- Header -->
    <header class="flex shrink-0 items-center justify-between px-4 py-3 border-b border-slate-100 bg-white sticky top-0 z-50">
      <div class="flex items-center gap-1">
        <button @click="goBack()" class="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <view class="scorecard-uni-ico-slot">
            <uni-icons type="left" :size="24" color="#334155" />
          </view>
        </button>
        <!-- #ifdef MP-WEIXIN -->
        <button
          v-if="isWechatFriendShareReady"
          type="button"
          open-type="share"
          class="p-2 hover:bg-slate-100 rounded-full transition-colors border-0 bg-transparent leading-none"
        >
          <view class="scorecard-uni-ico-slot">
            <uni-icons type="paperplane" :size="22" color="#334155" />
          </view>
        </button>
        <button
          v-else
          type="button"
          @click="openSharePosterModal"
          class="p-2 hover:bg-slate-100 rounded-full transition-colors border-0 bg-transparent leading-none"
        >
          <view class="scorecard-uni-ico-slot">
            <uni-icons type="image-filled" :size="22" color="#334155" />
          </view>
        </button>
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <button type="button" @click="openSharePosterModal" class="p-2 hover:bg-slate-100 rounded-full transition-colors border-0 bg-transparent leading-none">
          <view class="scorecard-uni-ico-slot">
            <uni-icons type="image-filled" :size="22" color="#334155" />
          </view>
        </button>
        <!-- #endif -->
      </div>
      <div class="flex flex-col items-center">
        <h1 class="text-base font-bold tracking-tight truncate max-w-[180px] text-slate-900">{{ scorecardCourseName }}</h1>
        <div class="text-xs text-slate-500">{{ formatMatchKickoffCn(currentMatch) }}</div>
      </div>
      <div class="w-20 flex justify-end items-center">
        <view
          v-if="isSpectatorMode && needsSelfProfileCompletion()"
          class="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 max-w-[5rem]"
          @click="openSelfProfileEditGate"
        >
          <image
            :src="mpAvatarImgSrcForDisplay(profile.avatar, DEFAULT_RULE_SLOT_AVATAR)"
            class="w-6 h-6 rounded-full shrink-0"
            mode="aspectFill"
          />
          <text class="text-[10px] text-slate-600 truncate">{{ profile.nickname || GUEST_NICKNAME }}</text>
        </view>
      </div>
    </header>

    <!-- Quick Navigation Toggle -->
    <div class="flex shrink-0 items-center justify-center gap-2 p-2 bg-white border-b border-slate-100 flex-wrap">
      <button type="button" @click="scrollToSection('front')" class="scorecard-seg-btn px-4 py-1.5 text-xs font-bold active:opacity-80" :class="activeNineSection === 'front' ? 'bg-[#07C160] text-white' : 'bg-slate-100 text-slate-600'">
        前九 (1-9)
      </button>
      <button type="button" @click="scrollToSection('back')" class="scorecard-seg-btn px-4 py-1.5 text-xs font-bold active:opacity-80" :class="activeNineSection === 'back' ? 'bg-[#07C160] text-white' : 'bg-slate-100 text-slate-600'">
        后九 (10-18)
      </button>
      <button
        type="button"
        @click="openSharePosterModal"
        class="scorecard-seg-btn px-3 py-1.5 border border-slate-200 bg-white text-xs font-bold text-slate-700 active:opacity-80"
      >
        生成海报
      </button>
    </div>

    <!-- 比赛信息条（轻量替代旧海报区） -->
    <view class="sc-info-bar shrink-0">
      <view class="sc-info-bar-left">
        <text class="sc-info-bar-course">{{ scorecardCourseName }}</text>
        <text class="sc-info-bar-date">{{ formatMatchKickoffCn(currentMatch) }}</text>
      </view>
      <view class="sc-info-bar-right">
        <text class="sc-info-bar-label">{{ leadPlayerSummaryLabel }}</text>
        <text class="sc-info-bar-score">{{ leadPlayerSummaryScore }}</text>
      </view>
    </view>

    <!-- ════════════════════════════════════════════════════════
         GolfLive 架构：固定球员列 + scroll-view 仅含洞格
         两列行高精确对齐，scroll-view 无手势干扰，丝滑惯性
         ════════════════════════════════════════════════════════ -->
    <view class="scorecard-table-outer flex-1 min-h-0">

      <!-- ① 固定球员列：在 scroll-view 之外，不参与横向滚动 -->
      <view class="sc-fixed-col">
        <view class="sc-fixed-hdr">
          <view class="sc-hdr-inner">
            <text class="text-xs font-bold text-white">球员</text>
            <text class="sc-sub-text" style="color:rgba(255,255,255,0.75)">差点</text>
          </view>
        </view>
        <view
          v-for="player in players"
          :key="'fp-'+player.id"
          class="sc-fixed-player"
        >
          <view @click="openPlayerActionModal(player)" class="sc-fixed-player-inner flex items-center gap-1.5 w-full h-full">
            <view v-if="player.isPending" class="scorecard-pending-avatar-slot rounded bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center flex-shrink-0">
              <uni-icons type="personadd" :size="16" color="#94a3b8" />
            </view>
            <image v-else :src="avatarOrDefault(player)" class="sc-avatar flex-shrink-0" mode="aspectFill" />
            <view class="flex flex-col min-w-0 flex-1">
              <text class="text-xs font-bold truncate leading-tight text-slate-900" >{{ player.nickname }}</text>
              <text class="sc-sub-text text-slate-500">{{ formatPlayerHandicapDisplay(player.handicap) }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ② 横向滚动区：仅含洞格 + 汇总列，无 sc-col-player -->
      <!-- enable-flex + enhanced = 原生惯性，无手势竞争 -->
      <scroll-view
        scroll-x
        enable-flex
        enhanced
        class="score-scroll-view scorecard-scroll-view"
        :scroll-into-view="tableScrollIntoView"
        scroll-with-animation
        :show-scrollbar="false"
      >
        <!-- hole-track：scroll-view 直接子元素，width:max-content 撑开 -->
        <view class="hole-track scorecard-table-inner">

          <!-- Header Row -->
          <view class="hole-row sc-header">
            <template v-for="(h, idx) in holes" :key="'hdr-'+h.number">
              <view
                class="sc-cell sc-col-hole hole-item sc-border-rb"
                :id="h.number === 1 ? 'hole-anchor-1' : (h.number === 10 ? 'hole-anchor-10' : '')"
              >
                <view class="sc-hdr-inner">
                  <view class="scorecard-hole-num text-xs font-bold" style="background:#0f172a;color:#fff;">{{ h.number }}</view>
                  <text class="sc-sub-text" style="color:rgba(255,255,255,0.8)">{{ h.par }}</text>
                </view>
              </view>
              <view v-if="idx === 8" class="sc-cell sc-col-f9 sc-border-rb sc-bg-dim">
                <text class="text-xs font-bold text-white">前9</text>
              </view>
            </template>
            <view class="sc-cell sc-col-par sc-border-rb sc-bg-dim"><text class="text-xs font-bold text-white">标准杆</text></view>
            <view class="sc-cell sc-col-sum sc-border-rb sc-bg-dim"><text class="text-xs font-bold text-white">后9</text></view>
            <view class="sc-cell sc-col-sum sc-border-rb sc-bg-dim"><text class="text-xs font-bold text-white">总差</text></view>
            <view class="sc-cell sc-col-sum sc-border-rb sc-bg-dim"><text class="text-xs font-bold text-white">总杆</text></view>
            <view class="sc-cell sc-col-pk sc-border-rb sc-bg-dim"><text class="text-xs font-bold text-yellow-200">PK</text></view>
            <view class="sc-cell sc-col-pk sc-border-b sc-bg-dim"><text class="text-xs font-bold text-white">8421</text></view>
          </view>

          <!-- Player Score Rows -->
          <view v-for="player in players" :key="player.id" class="hole-row">
            <template v-for="(h, idx) in holes" :key="'sc-'+player.id+'-'+h.number">
              <view
                @click="openScoreModal(player.id, h.index)"
                class="sc-cell sc-col-hole hole-item sc-border-rb sc-score-cell"
              >
                <template
                  v-for="rb in [getRoleBadgesSplit(player.id, h.index)]"
                  :key="'rb-' + player.id + '-' + h.number"
                >
                  <view
                    class="sc-score-stack"
                    :class="{
                      'sc-score-stack--with-badge': rb.showTiger || rb.showLandlord,
                      'sc-score-stack--two-badges': rb.showTiger && rb.showLandlord,
                    }"
                  >
                    <view v-if="rb.showTiger" class="sc-role-badge sc-role-badge--tiger">
                      <text class="sc-role-badge-text">虎</text>
                    </view>
                    <view v-if="rb.showLandlord" class="sc-role-badge sc-role-badge--landlord">
                      <text class="sc-role-badge-text">地</text>
                    </view>
                    <view class="scorecard-score-cell-inner sc-scorecell-mark-root flex items-center justify-center relative">
                      <template
                        v-if="
                          getHoleMarkKind(player.id, h.index) === 'under_two' ||
                          getHoleMarkKind(player.id, h.index) === 'birdie'
                        "
                      >
                        <view class="sc-under-par-fill flex items-center justify-center">
                          <text class="scorecard-score-value sc-under-par-fill-text">{{
                            getScoreCellDisplayText(player.id, h.index) || '—'
                          }}</text>
                        </view>
                      </template>
                      <template v-else-if="getHoleMarkKind(player.id, h.index) === 'over_two'">
                        <view class="sc-dbl-sq-outer flex items-center justify-center">
                          <view class="sc-dbl-sq-inner flex items-center justify-center">
                            <text class="scorecard-score-value">{{ getScoreCellDisplayText(player.id, h.index) || '—' }}</text>
                          </view>
                        </view>
                      </template>
                      <template v-else>
                        <view class="flex items-center justify-center" :class="getScoreShapeClasses(player.id, h.index)">
                          <text class="scorecard-score-value">{{ getScoreCellDisplayText(player.id, h.index) || '-' }}</text>
                        </view>
                      </template>
                    </view>
                    <text v-if="getScore(player.id, h.index) && matchStore.activeRules.length > 0" class="sc-profit-text" :class="getHoleProfit(player.id, h.index) >= 0 ? 'text-red-400' : 'text-green-400'">
                      {{ getHoleProfit(player.id, h.index) > 0 ? '+' : '' }}{{ getHoleProfit(player.id, h.index) }}
                    </text>
                  </view>
                </template>
                <view v-if="isLandmineExploded(h.index)" class="scorecard-landmine-wrap">
                  <uni-icons type="fire-filled" :size="13" color="#ef4444" />
                </view>
              </view>
              <view v-if="idx === 8" class="sc-cell sc-col-f9 sc-border-rb sc-bg-dim sc-summary-val">
                <text class="text-xs font-bold text-slate-700">{{ getFront9(player.id) }}</text>
              </view>
            </template>
            <view class="sc-cell sc-col-par sc-border-rb sc-bg-dim sc-summary-val"><text class="text-xs text-slate-500">{{ getTotalPar() }}</text></view>
            <view class="sc-cell sc-col-sum sc-border-rb sc-bg-dim sc-summary-val"><text class="text-xs font-bold text-slate-700">{{ getBack9(player.id) }}</text></view>
            <view class="sc-cell sc-col-sum sc-border-rb sc-bg-dim sc-summary-val"><text class="text-xs font-bold text-slate-700">{{ getTotalDiff(player.id) }}</text></view>
            <view class="sc-cell sc-col-sum sc-border-rb sc-bg-dim sc-summary-val"><text class="text-sm font-black text-[#07C160]">{{ getPlayerTotalDisplay(player.id) }}</text></view>
            <view class="sc-cell sc-col-pk sc-border-rb sc-bg-dim sc-summary-val">
              <text class="text-sm font-bold" :class="getPKTotal(player.id) >= 0 ? 'text-red-500' : 'text-[#07C160]'">{{ getPKTotal(player.id) > 0 ? '+' : '' }}{{ getPKTotal(player.id) }}</text>
            </view>
            <view class="sc-cell sc-col-pk sc-border-b sc-bg-dim sc-summary-val"><text class="text-xs font-bold text-amber-600">{{ (get8421Points(player.id) || 0).toFixed(1) }}</text></view>
          </view>

        </view>
      </scroll-view>
    </view>

    <!-- 底部操作栏：与 slate-950 主色统一，轻渐变 + 描边图标位 -->
    <div class="scorecard-bottom-bar flex items-center justify-around gap-1">
      <button type="button" @click="onTapAddPlayer" class="scorecard-bottom-item flex flex-col items-center gap-1.5 bg-transparent border-0 p-0 m-0">
        <view class="scorecard-bottom-circle scorecard-bottom-circle--add">
          <uni-icons type="personadd-filled" :size="24" color="#7dd3fc" />
        </view>
        <span class="scorecard-bottom-label">球手</span>
      </button>

      <button type="button" @click="onTapRules" class="scorecard-bottom-item flex flex-col items-center gap-1.5 bg-transparent border-0 p-0 m-0">
        <view class="scorecard-bottom-circle scorecard-bottom-circle--pk">
          <uni-icons type="flag" :size="24" color="#fca5a5" />
        </view>
        <span class="scorecard-bottom-label">PK规则</span>
      </button>

      <button
        v-if="matchStore.activeRules.length > 0"
        type="button"
        @click="onTapPKScore"
        class="scorecard-bottom-item flex flex-col items-center gap-1.5 bg-transparent border-0 p-0 m-0"
      >
        <view class="scorecard-bottom-circle scorecard-bottom-circle--score">
          <uni-icons type="medal-filled" :size="24" color="#fde68a" />
        </view>
        <span class="scorecard-bottom-label">PK得分</span>
      </button>

      <button type="button" @click="onTapSettings" class="scorecard-bottom-item flex flex-col items-center gap-1.5 bg-transparent border-0 p-0 m-0">
        <view class="scorecard-bottom-circle scorecard-bottom-circle--gear">
          <uni-icons type="gear-filled" :size="24" color="#cbd5e1" />
        </view>
        <span class="scorecard-bottom-label">设置</span>
      </button>
    </div>

    <!-- Score Input Modal (Bottom Sheet) -->
    <div v-if="showScoreModal" class="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity" @click.self="closeScoreModalDiscard">
      <view class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300" @tap.stop>
        <div class="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div class="flex items-center gap-3">
            <image
              :src="avatarOrDefault(players.find((p) => p.id === editingCell?.pid) ?? undefined)"
              class="w-10 h-10 rounded-full border-2 border-white shadow-sm"
              mode="aspectFill"
            />
            <div>
              <div class="text-sm font-bold text-slate-900">{{ players.find(p => p.id === editingCell?.pid)?.nickname || '未知球手' }}</div>
              <div class="text-xs text-slate-500">第 {{ (editingCell?.holeIndex || 0) + 1 }} 洞 / Par {{ matchStore.holeScores[editingCell?.holeIndex || 0]?.par || 4 }}</div>
            </div>
          </div>
          <button type="button" @tap.stop="closeScoreModalDiscard" class="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot">
              <uni-icons type="closeempty" :size="22" color="#94a3b8" />
            </view>
          </button>
        </div>

        <div class="p-8 flex flex-col items-center gap-8" @tap.stop>
          <div class="flex items-center gap-8">
            <button type="button" @tap.stop="updateModalScoreDelta(-1)" class="scorecard-score-step-btn rounded-full border-2 border-slate-200 flex items-center justify-center hover:bg-slate-50 active:scale-90 transition-all">
              <uni-icons type="minus-filled" :size="26" color="#64748b" />
            </button>
            <div class="text-5xl font-black text-slate-900 w-24 text-center font-mono">
              {{ getModalRelativeText() }}
            </div>
            <button type="button" @tap.stop="updateModalScoreDelta(1)" class="scorecard-score-step-btn rounded-full border-2 border-slate-200 flex items-center justify-center hover:bg-slate-50 active:scale-90 transition-all">
              <uni-icons type="plus-filled" :size="26" color="#64748b" />
            </button>
          </div>

          <div class="w-full flex gap-4">
            <button type="button" @tap.stop="clearScore" class="flex-1 py-4 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 active:scale-95 transition-all flex items-center justify-center text-center">
              清除
            </button>
            <button type="button" @tap.stop="saveScore" class="flex-[1.35] py-4 rounded-xl bg-green-500 text-white font-bold shadow-lg shadow-green-200 hover:bg-green-600 active:scale-95 transition-all flex items-center justify-center text-center">
              确认
            </button>
          </div>
        </div>
      </view>
    </div>

    <!-- PK Rules Modal -->
    <div v-if="showRulesModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" @click.self="showRulesModal = false">
      <div class="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-xl flex flex-col max-h-[80vh]">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <h2 class="text-base font-bold text-slate-900">PK 规则设置</h2>
          <button @click="showRulesModal = false" class="p-1 hover:bg-slate-100 rounded-full">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- Active Rules List -->
          <div v-if="matchStore.activeRules.length > 0" class="space-y-3">
            <h3 class="text-xs font-bold text-slate-400 uppercase tracking-wider">当前生效规则</h3>
            <div
              v-for="rule in matchStore.activeRules"
              :key="rule.id"
              class="p-3 bg-slate-50 rounded-xl flex items-center justify-between border border-slate-100 active:opacity-90"
              @click="onActiveRuleRowTap(rule)"
            >
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs shrink-0">
                  {{ rule.name }}
                </div>
                <div class="flex flex-col min-w-0">
                  <span class="text-sm font-medium text-slate-800 truncate">{{ rule.name }}</span>
                  <span class="text-xs text-slate-500 truncate">{{ getRuleSummary(rule) }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0" @click.stop>
                <button type="button" @click="removeRule(rule.id)" class="p-2 hover:bg-red-50 rounded-lg transition-colors">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="trash" :size="18" color="#ef4444" /></view>
                </button>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
            <view class="scorecard-uni-ico-slot"><uni-icons type="medal-filled" :size="24" color="#cbd5e1" /></view>
            <span class="text-sm">暂无生效规则</span>
          </div>
        </div>

        <div class="p-4 bg-white border-t border-slate-100">
          <button @click="showAddRuleOptions = true; showRulesModal = false" class="w-full py-3 bg-[#07C160] text-white rounded-xl font-bold active:scale-95 transition-all flex items-center justify-center gap-2">
            <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#ffffff" /></view>
            新建 PK 规则
          </button>
        </div>
      </div>
    </div>

    <!-- Add Rule Options Modal (Grid Layout) -->
    <div v-if="showAddRuleOptions" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-white overflow-y-auto" @click.self="showAddRuleOptions = false">
      <div class="w-full max-w-md flex flex-col gap-6">
        <div class="flex items-center justify-between pt-2">
          <button @click="showAddRuleOptions = false" class="p-2 hover:bg-slate-100 rounded-full">
            <view class="scorecard-uni-ico-slot"><uni-icons type="left" :size="24" color="#334155" /></view>
          </button>
          <h2 class="text-base font-bold text-slate-900">选择 PK 玩法</h2>
          <div class="w-10"></div>
        </div>

        <!-- Single Hang Section -->
        <div class="space-y-4">
          <div class="flex items-center justify-center">
            <div class="px-6 py-1.5 rounded-full bg-slate-100 text-xs font-bold text-slate-500 border border-slate-200">
              单挂 (1对1)
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <button v-for="rule in singleHangRules" :key="rule.type" 
                    @click="selectRuleForConfig(rule)"
                    class="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-all shadow-sm">
              <span class="text-base font-bold text-slate-900">{{ rule.name }}</span>
              <span class="text-xs text-slate-500 text-center leading-tight h-6 flex items-center">{{ rule.sub }}</span>
            </button>
          </div>
        </div>

        <!-- Multi-player Section -->
        <div class="space-y-4">
          <div class="flex items-center justify-center">
            <div class="px-6 py-1.5 rounded-full bg-slate-100 text-xs font-bold text-slate-500 border border-slate-200">
              3人以上游戏
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <button v-for="rule in multiPlayerRules" :key="rule.type" 
                    @click="selectRuleForConfig(rule)"
                    class="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center gap-2 active:scale-95 transition-all shadow-sm">
              <span class="text-base font-bold text-slate-900">{{ rule.name }}</span>
              <span class="text-xs text-slate-500 text-center leading-tight h-6 flex items-center">{{ rule.sub }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- Rule Configuration Modal -->
    <div v-if="showConfigModal" class="fixed inset-0 z-[120] flex flex-col bg-white overflow-hidden animate-in slide-in-from-bottom duration-300">
      <!-- Header -->
      <header class="flex items-center justify-between px-4 pt-4 pb-2.5 border-b border-slate-100 bg-white sticky top-0 z-50">
        <button type="button" @click="closeConfigModal" class="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <view class="scorecard-uni-ico-slot"><uni-icons type="left" :size="24" color="#334155" /></view>
        </button>
        <h1 class="text-base font-bold text-slate-900 pt-0.5">{{ currentConfigRule?.name }}</h1>
        <div class="flex items-center gap-2">
          <button class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="more" :size="24" color="#334155" /></view>
          </button>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto bg-white">
        <!-- Match Play Configuration (比洞) -->
        <template v-if="currentConfigRule?.type === 'holes'">
          <div class="p-3 space-y-3">
            <!-- Header: 仅埋地雷 -->
            <div class="flex justify-end mb-1">
              <button type="button" @click="showLandmineModal = true" 
                      class="flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-all"
                      :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'bg-red-600 border border-red-400' : 'bg-red-50 border border-red-200'">
                <view class="scorecard-config-bomb-sm">
                  <uni-icons type="fire-filled" :size="16" :color="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? '#ffffff' : '#ef4444'" />
                </view>
                <span class="text-[7px]" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-500'">地雷</span>
              </button>
            </div>

            <!-- Settings List -->
            <div class="space-y-0.5">
              <!-- Starting Hole -->
              <div @click="showStartingHoleModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">出发洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.starting_hole ?? 1 }}号洞</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <!-- Valid Holes -->
              <div @click="showHoleSelectModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">有效洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex gap-0.5 max-w-[100px] flex-wrap justify-end">
                    <div v-for="i in 18" :key="i" class="w-1.5 h-1.5 rounded-full" :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-emerald-600' : 'bg-slate-300'"></div>
                  </div>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <!-- Fixed Participants for Match Play -->
              <div class="flex items-center justify-between py-2.5 px-3 bg-slate-50 border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">参与人数</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">2-人单挂</span>
                </div>
              </div>
            </div>

            <!-- Player Selection Circles -->
            <div class="flex items-center justify-center gap-2 py-2">
              <div v-for="i in 2" :key="i" 
                   @click="openStrokesPlayerPicker(i - 1)"
                   class="w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden flex-shrink-0 relative"
                   :class="currentConfigRule?.player_ids?.[i-1] ? (currentConfigRule.handicap_receiver_index === i-1 ? 'border-[#15803d] bg-emerald-50' : 'border-slate-200 bg-slate-50') : 'border-dashed border-slate-300 bg-slate-50'">
                <!-- Handicap Receiver Badge -->
                <div v-if="currentConfigRule.handicap_receiver_index === i-1" 
                     class="absolute top-1 right-1 bg-[#15803d] text-white text-[7px] px-1 py-0.5 rounded-full font-bold">
                  受让方
                </div>
                
                <template v-if="currentConfigRule?.player_ids?.[i-1]">
                  <div class="w-9 h-9 rounded-full mb-0.5 border-2 border-white bg-slate-200 overflow-hidden shrink-0">
                    <image :src="avatarOrDefault(playerForRuleSlot(i - 1))" mode="aspectFill" class="w-full h-full block" />
                  </div>
                  <span class="text-xs font-bold truncate max-w-[4.5rem] text-center">{{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname || '未知' }}</span>
                  <span class="text-xs opacity-60">选手{{ i }}</span>
                </template>
                <template v-else>
                  <view class="scorecard-uni-ico-slot"><uni-icons type="personadd" :size="20" color="#cbd5e1" /></view>
                  <span class="text-xs font-bold text-slate-500">选手{{ i }}</span>
                </template>
              </div>
            </div>

            <!-- Handicap Selection (让杆/让洞) -->
            <div class="flex flex-col gap-2 px-2">
              <div class="flex gap-2">
                <button type="button" @click="currentConfigRule.handicap_type = 'strokes'; showParHandicapModal = true"
                        class="flex-1 py-2 rounded-xl border flex flex-col items-center gap-0.5 transition-all"
                        :class="currentConfigRule.handicap_type === 'strokes' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-100 border-slate-200 text-slate-500'">
                  <span class="text-sm font-bold">让杆</span>
                  <span class="text-xs opacity-60">
                    {{ currentConfigRule.handicap_par_strokes.par3 }}/{{ currentConfigRule.handicap_par_strokes.par4 }}/{{ currentConfigRule.handicap_par_strokes.par5 }}
                  </span>
                </button>
                <button type="button" @click="currentConfigRule.handicap_type = 'holes'; showHoleHandicapModal = true"
                        class="flex-1 py-2 rounded-xl border flex flex-col items-center gap-0.5 transition-all"
                        :class="currentConfigRule.handicap_type === 'holes' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-100 border-slate-200 text-slate-500'">
                  <span class="text-sm font-bold">让洞</span>
                  <span class="text-xs opacity-60">让 {{ currentConfigRule.handicap_holes_count }} 洞</span>
                </button>
              </div>
              
              <!-- Receiver Toggle -->
              <div class="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-200">
                <span class="text-xs text-slate-600">受让方</span>
                <div class="flex bg-slate-200 rounded-lg p-0.5">
                  <button v-for="i in 2" :key="i"
                          type="button"
                          @click="currentConfigRule.handicap_receiver_index = i-1"
                          class="px-3 py-0.5 rounded-md text-xs font-bold transition-all"
                          :class="currentConfigRule.handicap_receiver_index === i-1 ? 'bg-[#15803d] text-white shadow-sm' : 'text-slate-500'">
                    选手{{ i }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Bottom Settings -->
            <div class="space-y-0.5">
              <div @click="showRewardModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="medal" :size="20" color="#15803d" /></view>
                  <span class="text-sm">奖励</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700 truncate max-w-[150px]">{{ getRewardText(currentConfigRule?.reward_config || '1') }}</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <div @click="showWinConditionModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">赢洞条件</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.win_condition === 'lower_strokes' ? '杆数少者算赢' : '其他' }}</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <div @click="showTieModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">顶洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.tie_type === 'add_one' ? '下洞加1分' : '下洞不加分' }}</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <div @click="showCollectTieModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">收顶洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all' ? '帕收1/鸟收2/鹰全收' : '赢洞全收' }}</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>
            </div>

            <!-- Action Button -->
            <div class="pt-2 pb-1">
              <button type="button" @click="confirmAddRule" class="w-full py-3 bg-[#15803d] text-white rounded-full font-bold text-sm shadow-md shadow-emerald-900/15 active:scale-[0.98] transition-all flex items-center justify-center text-center">
                确认并返回
              </button>
            </div>
          </div>
        </template>

        <!-- Strokes Configuration (比杆) -->
        <template v-else-if="currentConfigRule?.type === 'strokes'">
          <div class="p-3 space-y-3">
            <!-- Header: 仅埋地雷 -->
            <div class="flex justify-end mb-0.5">
              <button type="button" @click="showLandmineModal = true" 
                      class="flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-all"
                      :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'bg-red-600 border border-red-400' : 'bg-red-50 border border-red-200'">
                <view class="scorecard-config-bomb-sm">
                  <uni-icons type="fire-filled" :size="16" :color="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? '#ffffff' : '#ef4444'" />
                </view>
                <span class="text-[7px]" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-500'">地雷</span>
              </button>
            </div>

            <!-- Settings List -->
            <div class="space-y-0.5">
              <!-- Starting Hole（与比洞一致：收顶洞/顶洞按出发洞环形序） -->
              <div @click="showStartingHoleModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">出发洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.starting_hole ?? 1 }}号洞</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <!-- Valid Holes -->
              <div @click="showHoleSelectModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">有效洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex gap-0.5 max-w-[100px] flex-wrap justify-end">
                    <div v-for="i in 18" :key="i" class="w-1.5 h-1.5 rounded-full" :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-emerald-600' : 'bg-slate-300'"></div>
                  </div>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <!-- Participants -->
              <div @click="showParticipantModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm">参与人数</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.participant_count || 2 }}-人单挂</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>
            </div>

            <!-- Player Selection Circles -->
            <div class="flex items-center justify-center gap-2 py-2 overflow-x-auto no-scrollbar">
              <div v-for="i in (currentConfigRule?.participant_count || 0)" :key="i" 
                   @click="openStrokesPlayerPicker(i - 1)"
                   class="w-[4.25rem] h-[4.25rem] rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden flex-shrink-0"
                   :class="currentConfigRule?.player_ids?.[i-1] ? 'border-[#15803d] bg-emerald-50' : 'border-dashed border-slate-300 bg-slate-50'">
                <template v-if="currentConfigRule?.player_ids?.[i-1]">
                  <div class="w-9 h-9 rounded-full mb-0.5 border-2 border-white bg-slate-200 overflow-hidden shrink-0">
                    <image :src="avatarOrDefault(playerForRuleSlot(i - 1))" mode="aspectFill" class="w-full h-full block" />
                  </div>
                  <span class="text-xs font-bold truncate w-[4rem] text-center text-slate-800">{{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname || '未知' }}</span>
                  <span class="text-[7px] text-slate-500">选手{{ i }}</span>
                </template>
                <template v-else>
                  <view class="scorecard-uni-ico-slot"><uni-icons type="personadd" :size="18" color="#cbd5e1" /></view>
                  <span class="text-xs font-bold text-slate-500">选手{{ i }}</span>
                </template>
              </div>
            </div>

            <!-- Bottom Settings -->
            <div class="space-y-0.5">
              <div @click="showHandicapModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="flag" :size="20" color="#15803d" /></view>
                  <span class="text-sm">单让</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ getHandicapText(currentConfigRule?.handicap_config) }}</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <div @click="showRewardModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/70 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="medal" :size="20" color="#15803d" /></view>
                  <span class="text-sm">奖励</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700 truncate max-w-[150px]">{{ getRewardText(currentConfigRule?.reward_config || '1') }}</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>
            </div>

            <!-- Action Button -->
            <div class="pt-2 pb-1">
              <button type="button" @click="confirmAddRule" class="w-full py-3 bg-[#15803d] text-white rounded-full font-bold text-sm shadow-md shadow-emerald-900/15 active:scale-[0.98] transition-all flex items-center justify-center text-center">
                确认并返回
              </button>
            </div>
          </div>
        </template>

        <!-- 8421 Configuration (挂8421) -->
        <template v-else-if="currentConfigRule?.type === '8421_1v1'">
          <div class="p-3 space-y-3 bg-[#f8fafc] min-h-[50vh]">
            <!-- Header: 仅埋地雷 -->
            <div class="flex justify-end mb-0.5">
              <button type="button" @click="showLandmineModal = true" 
                      class="flex flex-col items-center justify-center w-11 h-11 rounded-xl transition-all"
                      :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'bg-red-600 border border-red-400' : 'bg-red-50 border border-red-200'">
                <view class="scorecard-config-bomb-sm">
                  <uni-icons type="fire-filled" :size="16" :color="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? '#ffffff' : '#ef4444'" />
                </view>
                <span class="text-[7px]" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-500'">地雷</span>
              </button>
            </div>

            <!-- Settings List -->
            <div class="space-y-0.5 rounded-xl overflow-hidden border border-slate-200 bg-white">
              <!-- Starting Hole（与比洞一致） -->
              <div @click="showStartingHoleModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/60 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm font-medium">出发洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.starting_hole ?? 1 }}号洞</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <!-- Valid Holes -->
              <div @click="showHoleSelectModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/60 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm font-medium">有效洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex gap-0.5 max-w-[120px] flex-wrap justify-end">
                    <div v-for="i in 18" :key="i" class="w-1.5 h-1.5 rounded-full" :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-emerald-600' : 'bg-slate-300'"></div>
                  </div>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>

              <!-- Participants -->
              <div @click="showParticipantModal = true" class="flex items-center justify-between py-2.5 px-3 bg-white hover:bg-emerald-50/60 transition-colors cursor-pointer border-b border-slate-100">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm font-medium">参与人数</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-700">{{ currentConfigRule?.participant_count || 2 }}-人单挂</span>
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                </div>
              </div>
            </div>

            <!-- Player Selection Circles -->
            <div class="flex items-center justify-center gap-2 py-2 overflow-x-auto no-scrollbar px-1">
              <div v-for="i in (currentConfigRule?.participant_count || 2)" :key="i" 
                   @click="openStrokesPlayerPicker(i - 1)"
                   class="w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden flex-shrink-0"
                   :class="currentConfigRule?.player_ids?.[i-1] ? 'border-[#15803d] bg-emerald-50' : 'border-dashed border-slate-300 bg-slate-50'">
                <template v-if="currentConfigRule?.player_ids?.[i-1]">
                  <div class="w-9 h-9 rounded-full mb-0.5 border-2 border-white bg-slate-200 overflow-hidden shrink-0 shadow-sm">
                    <image :src="avatarOrDefault(playerForRuleSlot(i - 1))" mode="aspectFill" class="w-full h-full block" />
                  </div>
                  <span class="text-xs font-bold text-slate-800 truncate max-w-[4.5rem] text-center">{{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname || '未知' }}</span>
                  <span class="text-xs text-slate-500 mt-0.5">选手{{ i }}</span>
                </template>
                <template v-else>
                  <view class="scorecard-uni-ico-slot"><uni-icons type="personadd" :size="18" color="#cbd5e1" /></view>
                  <span class="text-xs font-bold text-slate-500">选手{{ i }}</span>
                </template>
              </div>
            </div>

            <!-- 8421+：每位选手自定义分数梯（鸟/帕/+1/+2/+3…，位数可多于 4，如 84321） -->
            <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-2">
              <div class="flex items-center gap-2 mb-1">
                <div class="bg-[#15803d] px-2 py-0.5 rounded text-xs font-black text-white shrink-0">8421+</div>
                <span class="text-xs text-slate-600 leading-snug">每位选手一条数字，从左到右对应 鸟、帕、+1、+2…（例：8521、84321）</span>
              </div>
              <div v-for="i in (currentConfigRule?.participant_count || 2)" :key="'8421p-' + i" class="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0">
                <template v-if="currentConfigRule?.player_ids?.[i - 1]">
                  <div class="flex items-center gap-2 min-w-0 flex-1">
                    <image :src="avatarOrDefault(playerForRuleSlot(i - 1))" mode="aspectFill" class="w-8 h-8 rounded-full border border-slate-200 shrink-0" />
                    <span class="text-xs font-bold text-slate-800 truncate">{{ players.find(p => p.id === currentConfigRule.player_ids[i - 1])?.nickname || '选手' + i }}</span>
                  </div>
                  <input
                    v-model="currentConfigRule.player_8421[currentConfigRule.player_ids[i - 1]]"
                    type="text"
                    inputmode="numeric"
                    maxlength="12"
                    class="w-[5.5rem] bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 text-center text-xs font-black text-[#15803d] tabular-nums"
                    placeholder="8421"
                  />
                </template>
                <template v-else>
                  <span class="text-xs text-slate-400">先选择选手{{ i }}再填分数梯</span>
                </template>
              </div>
            </div>

            <!-- Bottom Settings -->
            <div class="space-y-2">
              <!-- Deductions Panel -->
              <div class="p-3 bg-white rounded-2xl border border-slate-200 space-y-2">
                <div class="flex items-center gap-3 mb-0.5">
                  <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                  </div>
                  <span class="text-sm font-medium text-slate-800">扣分</span>
                </div>
                
                <div class="space-y-2 pl-0.5">
                  <div class="flex flex-col gap-2">
                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'progressive' ? 'bg-[#15803d] border-[#15803d]' : 'bg-slate-100'">
                        <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--xs"><uni-icons type="checkmarkempty" :size="14" color="#ffffff" /></view>
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="progressive" class="hidden">
                      <span class="text-sm text-slate-700 group-hover:text-emerald-900 transition-colors">扣分 (+4扣1分 +5扣2分...以此类推)</span>
                    </label>
                    
                    <div class="pl-8" v-if="currentConfigRule.deduction_type === 'progressive'">
                      <label class="flex items-center gap-3 cursor-pointer group">
                        <div class="w-4 h-4 rounded border border-slate-300 flex items-center justify-center transition-colors"
                             :class="currentConfigRule.deduction_par3_plus3 ? 'bg-[#15803d] border-[#15803d]' : 'bg-slate-100'">
                          <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--xs"><uni-icons type="checkmarkempty" :size="16" color="#ffffff" /></view>
                        </div>
                        <input type="checkbox" v-model="currentConfigRule.deduction_par3_plus3" class="hidden">
                        <span class="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">3杆洞从+3开始扣分</span>
                      </label>
                    </div>

                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'single_plus4' ? 'bg-[#15803d] border-[#15803d]' : 'bg-slate-100'">
                        <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--xs"><uni-icons type="checkmarkempty" :size="14" color="#ffffff" /></view>
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="single_plus4" class="hidden">
                      <span class="text-sm text-slate-700 group-hover:text-emerald-900 transition-colors">只扣1分 (+4及以上)</span>
                    </label>

                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'single_double_par' ? 'bg-[#15803d] border-[#15803d]' : 'bg-slate-100'">
                        <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--xs"><uni-icons type="checkmarkempty" :size="14" color="#ffffff" /></view>
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="single_double_par" class="hidden">
                      <span class="text-sm text-slate-700 group-hover:text-emerald-900 transition-colors">只扣1分 (双帕及以上)</span>
                    </label>

                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-300 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'none' ? 'bg-[#15803d] border-[#15803d]' : 'bg-slate-100'">
                        <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--xs"><uni-icons type="checkmarkempty" :size="14" color="#ffffff" /></view>
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="none" class="hidden">
                      <span class="text-sm text-slate-700 group-hover:text-emerald-900 transition-colors">不扣分</span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Carryover Settings -->
              <div class="rounded-xl overflow-hidden border border-slate-200 bg-white">
                <div @click="showTieModal = true" class="flex items-center justify-between py-2.5 px-3 hover:bg-emerald-50/60 transition-colors cursor-pointer border-b border-slate-100">
                  <div class="flex items-center gap-3">
                    <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                      <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                    </div>
                    <span class="text-sm font-medium text-slate-800">顶洞</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-slate-700">{{ currentConfigRule?.tie_type === 'add_one' ? '下洞加1分' : '不加分' }}</span>
                    <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                  </div>
                </div>

                <div @click="showCollectTieModal = true" class="flex items-center justify-between py-2.5 px-3 hover:bg-emerald-50/60 transition-colors cursor-pointer">
                  <div class="flex items-center gap-3">
                    <div class="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center">
                      <div class="w-2 h-2 rounded-full bg-slate-400"></div>
                    </div>
                    <span class="text-sm font-medium text-slate-800">收顶洞</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-slate-700">
                      {{ currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all' ? '帕收1/鸟收2/鹰全收' : '全收' }}
                    </span>
                    <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#475569" /></view>
                  </div>
                </div>
              </div>
            </div>

            <!-- Action Button -->
            <div class="pt-1 pb-4">
              <button type="button" @click="confirmAddRule" class="w-full py-3 bg-[#15803d] text-white rounded-full font-bold text-sm shadow-md shadow-emerald-900/15 active:scale-[0.98] transition-all flex items-center justify-center text-center">
                确认并返回
              </button>
            </div>
          </div>
        </template>

        <!-- Generic Configuration (for other rules) -->
        <template v-else>
          <div class="p-6 space-y-6 pb-12">
            <!-- Base Score -->
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-700">基数 (分/杆)</span>
              <div class="flex items-center gap-4">
                <button @click="currentConfigRule && (currentConfigRule.base_score = Math.max(1, currentConfigRule.base_score - 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="minus" :size="20" color="#cbd5e1" /></view>
                </button>
                <span class="text-lg font-bold w-8 text-center">{{ currentConfigRule?.base_score || 1 }}</span>
                <button @click="currentConfigRule && (currentConfigRule.base_score++)" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#cbd5e1" /></view>
                </button>
              </div>
            </div>

            <!-- Birdie Double -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-sm font-medium text-slate-700">鸟鹰翻倍</span>
                <span class="text-xs text-slate-500">抓鸟/抓鹰得分翻倍</span>
              </div>
              <button @click="currentConfigRule && (currentConfigRule.birdie_double = !currentConfigRule.birdie_double)" 
                      class="w-12 h-6 rounded-full transition-colors relative"
                      :class="currentConfigRule?.birdie_double ? 'bg-red-600' : 'bg-slate-700'">
                <div class="absolute top-1 w-4 h-4 bg-white rounded-full transition-all"
                     :class="currentConfigRule?.birdie_double ? 'left-7' : 'left-1'"></div>
              </button>
            </div>

            <!-- Vegas Specific -->
            <template v-if="currentConfigRule?.type === 'vegas_4'">
              <div class="flex items-center justify-between">
                <div class="flex flex-col">
                  <span class="text-sm font-medium text-slate-700">高手不见面</span>
                  <span class="text-xs text-slate-500">防止最强两名选手同组</span>
                </div>
                <button @click="currentConfigRule && (currentConfigRule.is_mon = !currentConfigRule.is_mon)" 
                        class="w-12 h-6 rounded-full transition-colors relative"
                        :class="currentConfigRule?.is_mon ? 'bg-red-600' : 'bg-slate-700'">
                  <div class="absolute top-1 w-4 h-4 bg-white rounded-full transition-all"
                       :class="currentConfigRule?.is_mon ? 'left-7' : 'left-1'"></div>
                </button>
              </div>
            </template>

            <button type="button" @click="confirmAddRule" class="w-full py-4 bg-[#15803d] text-white rounded-xl font-bold shadow-lg shadow-emerald-900/15 active:scale-95 transition-all mt-4 flex items-center justify-center text-center">
              确认添加
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Tiger Player Selection Modal -->
    <div v-if="showTigerPlayerSelect" class="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showTigerPlayerSelect = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">
            {{ tigerSelectMode === 'tiger' ? '选择老虎' : tigerSelectMode === 'participants' ? '选择参与者' : '选择受让球手' }}
          </h2>
          <button @click="showTigerPlayerSelect = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-4 max-h-[60vh] overflow-y-auto">
          <div class="grid grid-cols-4 gap-4">
            <button v-for="player in players" :key="player.id" 
                    @click="handleTigerPlayerSelect(player)"
                    class="flex flex-col items-center gap-1.5 p-1.5 rounded-xl transition-all"
                    :class="[
                      tigerSelectMode === 'tiger' && currentConfigRule.tiger_user_id === player.id ? 'bg-emerald-50 ring-1 ring-[#15803d]' : 
                      tigerSelectMode === 'participants' && currentConfigRule.player_ids.includes(player.id) ? 'bg-blue-100 ring-1 ring-blue-500' : 
                      'bg-slate-50'
                    ]">
              <div class="w-10 h-10 rounded-full border-2 border-slate-200 bg-slate-100 overflow-hidden shrink-0">
                <image :src="avatarOrDefault(player)" mode="aspectFill" class="w-full h-full block" />
              </div>
              <span class="text-xs font-medium truncate w-full text-center text-slate-700">{{ player.nickname }}</span>
            </button>
          </div>
        </div>
        <div class="p-4 border-t border-slate-100">
          <button @click="showTigerPlayerSelect = false" class="w-full py-3 bg-[#07C160] text-white rounded-xl font-bold">
            完成
          </button>
        </div>
      </div>
    </div>

    <!-- Handicap Input Modal -->
    <div v-if="showHandicapInput" class="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-white rounded-3xl overflow-hidden shadow-xl">
        <div class="p-6 text-center">
          <div class="w-14 h-14 rounded-full mx-auto mb-3 border-2 border-emerald-300 bg-emerald-50 overflow-hidden">
            <image :src="avatarOrDefault(pendingHandicapPlayer)" mode="aspectFill" class="w-full h-full block" />
          </div>
          <h3 class="text-lg font-bold mb-1 text-slate-900">{{ pendingHandicapPlayer?.nickname || '未知' }}</h3>
          <p class="text-xs text-slate-500 mb-6">设置相对于老虎的受让杆数</p>
          
          <div class="flex items-center justify-center gap-6 mb-8">
            <button @click="handicapValue = Math.max(0, handicapValue - 1)" class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
              <view class="scorecard-uni-ico-slot"><uni-icons type="minus" :size="24" color="#334155" /></view>
            </button>
            <span class="text-4xl font-black text-[#15803d]">{{ handicapValue }}</span>
            <button @click="handicapValue++" class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
              <view class="scorecard-uni-ico-slot"><uni-icons type="plus" :size="24" color="#334155" /></view>
            </button>
          </div>

          <div class="flex gap-3">
            <button @click="showHandicapInput = false" class="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold">取消</button>
            <button @click="confirmHandicap" class="flex-1 py-3 bg-[#15803d] text-white rounded-xl font-bold">确定</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Player Modal（z 高于修改比赛浮层，避免「添加球员」被挡住） -->
    <div v-if="showAddPlayerModal" class="fixed inset-0 z-[200] flex items-end justify-center">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="showAddPlayerModal = false"></div>
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden relative z-10">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">添加球手</h2>
          <button @click="showAddPlayerModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>

        <!-- Quick Add Panel -->
        <div class="p-4 bg-slate-50 border-b border-slate-100">
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-white rounded-xl border border-slate-200 px-3 min-h-[104rpx] flex items-center focus-within:border-[#07C160] transition-colors">
              <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="personadd" :size="18" color="#94a3b8" /></view>
              <input v-model="quickAddName" type="text" placeholder="输入昵称快速添加虚拟球手" 
                     class="mp-safe-input-flex flex-1 bg-transparent outline-none text-slate-800 text-sm" 
                     @keyup.enter="handleQuickAdd" />
            </div>
            <button @click="handleQuickAdd"
                    class="min-h-[104rpx] h-auto px-5 bg-[#07C160] text-white rounded-xl text-sm font-bold active:scale-95 transition-all shadow-lg shadow-green-900/10 flex items-center justify-center">
              添加
            </button>
          </div>
        </div>
        
        <div class="p-4 grid grid-cols-2 gap-3 pb-10">
          <template v-for="opt in addPlayerOptions" :key="opt.id">
            <!-- #ifdef MP-WEIXIN -->
            <button
              v-if="opt.id === 'wechat' && isWechatFriendShareReady"
              type="button"
              open-type="share"
              class="flex flex-col items-center justify-center gap-3 p-6 bg-slate-50 rounded-2xl border border-slate-100 active:scale-95 transition-all"
              @tap="showAddPlayerModal = false"
            >
              <div class="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-slate-100">
                <view class="scorecard-uni-ico-slot"><uni-icons :type="opt.uniType" :size="28" :color="opt.iconColor" /></view>
              </div>
              <span class="text-xs font-medium text-slate-700">{{ opt.name }}</span>
            </button>
            <button
              v-else
              type="button"
              @click="handleAddPlayerOption(opt.id)"
              class="flex flex-col items-center justify-center gap-3 p-6 bg-slate-50 rounded-2xl border border-slate-100 active:scale-95 transition-all"
            >
              <div class="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-slate-100">
                <view class="scorecard-uni-ico-slot"><uni-icons :type="opt.uniType" :size="28" :color="opt.iconColor" /></view>
              </div>
              <span class="text-xs font-medium text-slate-700">{{ opt.name }}</span>
            </button>
            <!-- #endif -->
            <!-- #ifndef MP-WEIXIN -->
            <button
              type="button"
              @click="handleAddPlayerOption(opt.id)"
              class="flex flex-col items-center justify-center gap-3 p-6 bg-slate-50 rounded-2xl border border-slate-100 active:scale-95 transition-all"
            >
              <div class="w-12 h-12 rounded-2xl bg-white flex items-center justify-center shadow-sm border border-slate-100">
                <view class="scorecard-uni-ico-slot"><uni-icons :type="opt.uniType" :size="28" :color="opt.iconColor" /></view>
              </div>
              <span class="text-xs font-medium text-slate-700">{{ opt.name }}</span>
            </button>
            <!-- #endif -->
          </template>
        </div>
      </div>
    </div>

    <!-- History Friends Modal -->
    <div v-if="showHistoryFriendsModal" class="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showHistoryFriendsModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 h-[70vh] flex flex-col">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">历史同组好友</h2>
          <button @click="showHistoryFriendsModal = false" class="p-2 hover:bg-slate-100 rounded-full">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-if="historyFriends.length === 0" class="flex flex-col items-center justify-center py-20 text-slate-400">
            <view class="scorecard-uni-ico-slot"><uni-icons type="staff" :size="22" color="#94a3b8" /></view>
            <p class="text-sm">暂无历史同组好友</p>
          </div>
          <div v-for="friend in historyFriends" :key="friend.id" 
               @click="addHistoryFriend(friend)"
               class="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 active:bg-slate-100 transition-all cursor-pointer">
            <div class="flex items-center gap-3">
              <img :src="friend.avatar" class="w-10 h-10 rounded-full border border-slate-200" />
              <div>
                <div class="text-sm font-bold text-slate-900">{{ friend.nickname }}</div>
                <div v-if="friend.handicap != null" class="text-xs text-slate-500 mt-0.5">差点 {{ friend.handicap }}</div>
              </div>
            </div>
            <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#07C160" /></view>
          </div>
        </div>
      </div>
    </div>

    <!-- QR Code Modal -->
    <div v-if="showQRCodeModal" class="fixed inset-0 z-[135] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" @click.self="showQRCodeModal = false">
      <div class="w-full max-w-xs bg-white rounded-[40px] p-8 flex flex-col items-center gap-6 animate-in zoom-in duration-300">
        <div class="text-center">
          <h3 class="text-lg font-black text-slate-900">比赛二维码</h3>
          <p class="text-xs text-slate-500 mt-1">微信扫码进入本局；好友可选围观或加入</p>
        </div>
        
        <div class="w-full aspect-square bg-slate-100 rounded-3xl flex items-center justify-center relative overflow-hidden p-3">
          <image
            v-if="qrImageSrc"
            :src="qrImageSrc"
            mode="aspectFit"
            class="w-full h-full rounded-2xl"
            show-menu-by-longpress
          />
          <view v-else class="flex flex-col items-center justify-center gap-2 px-4 py-8">
            <view class="scorecard-uni-ico-slot"><uni-icons type="scan" :size="32" color="#64748b" /></view>
            <text class="text-xs text-slate-500 text-center leading-relaxed">请部署云函数 getMatchQr 后重试；page 需为已发布页面 pages/scorecard/scorecard</text>
          </view>
        </div>

        <div class="w-full space-y-3">
          <button type="button" @click="showQRCodeModal = false" class="w-full py-4 text-slate-400 font-bold text-sm flex items-center justify-center text-center">
            关闭
          </button>
        </div>
      </div>
    </div>

    <!-- Profile gate：受邀且需完善资料 -->
    <div v-if="showProfileGateModal" class="fixed inset-0 z-[205] flex items-center justify-center bg-black/70 backdrop-blur-md p-5">
      <div class="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-white rounded-3xl p-6 shadow-xl box-border">
        <h3 class="text-base font-bold text-slate-900 mb-1 text-center">
          {{ profileGateMode === 'edit' ? '完善资料' : '完善资料后加入' }}
        </h3>
        <p class="text-xs text-slate-500 mb-5 text-center leading-relaxed px-1">
          {{ profileGateMode === 'edit' ? '选择头像与昵称，便于同组识别' : '填写昵称并选择头像，便于同组识别' }}
        </p>
        <div class="flex gap-4 mb-5 items-start">
          <!-- #ifdef MP-WEIXIN -->
          <button
            type="button"
            plain
            hover-class="none"
            open-type="chooseAvatar"
            class="mp-choose-avatar-btn w-[72px] h-[72px] shrink-0 rounded-2xl border-2 border-dashed border-slate-200 p-0 overflow-hidden flex items-center justify-center bg-slate-50"
            @chooseavatar="onGateChooseAvatar"
          >
            <image
              :src="mpAvatarImgSrcForDisplay(gateAvatarLocal || gateAvatarCloud || profile.avatar, DEFAULT_RULE_SLOT_AVATAR)"
              mode="aspectFill"
              class="w-full h-full"
            />
          </button>
          <!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->
          <image
            :src="mpAvatarImgSrcForDisplay(gateAvatarLocal || profile.avatar, DEFAULT_RULE_SLOT_AVATAR)"
            class="w-[72px] h-[72px] rounded-2xl border border-slate-200 shrink-0"
            mode="aspectFill"
          />
          <!-- #endif -->
          <view class="flex-1 min-w-0 flex flex-col gap-2">
            <text class="text-xs text-slate-500 font-medium">昵称</text>
            <view class="min-h-[48px] flex items-center rounded-xl border border-slate-200 bg-white px-3 box-border">
              <input
                v-model="gateNickname"
                type="nickname"
                :maxlength="24"
                placeholder="点击输入或选用微信昵称"
                placeholder-class="text-slate-400"
                style="flex: 1; min-height: 44px; padding: 10px 0; line-height: 22px; font-size: 15px; color: #0f172a;"
              />
            </view>
          </view>
        </div>
        <button
          type="button"
          :disabled="gateProfileSaving"
          class="w-full min-h-12 rounded-2xl bg-[#07C160] text-white text-[15px] font-bold disabled:opacity-60 px-4 box-border flex flex-row items-center justify-center text-center leading-normal"
          @click="confirmProfileGateAndContinue"
        >
          {{ gateProfileSaving ? '提交中…' : profileGateMode === 'edit' ? '保存' : '下一步' }}
        </button>
        <button
          v-if="profileGateMode === 'join'"
          type="button"
          class="w-full min-h-11 mt-3 rounded-xl text-slate-400 text-sm flex flex-row items-center justify-center text-center"
          @click="dismissProfileGateModal"
        >
          稍后再说
        </button>
        <button
          v-else
          type="button"
          class="w-full min-h-11 mt-3 rounded-xl text-slate-400 text-sm flex flex-row items-center justify-center text-center"
          @click="dismissProfileGateModal"
        >
          取消
        </button>
      </div>
    </div>

    <!-- Join/Spectate Choice Modal -->
    <div v-if="showJoinChoiceModal" class="fixed inset-0 z-[99990] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6">
      <div class="w-full max-w-sm bg-slate-900 rounded-[40px] p-8 border border-slate-800 shadow-2xl flex flex-col items-center text-center animate-in zoom-in duration-300">
        <div class="w-20 h-20 rounded-full border-4 border-blue-500/30 p-1 mb-6">
          <img
            :src="joiningUser?.avatar || (joiningUser?.id ? `https://picsum.photos/seed/${joiningUser.id}/200/200` : 'https://picsum.photos/seed/join/200/200')"
            class="w-full h-full rounded-full object-cover"
          />
        </div>
        
        <h3 class="text-xl font-black text-white mb-2">{{ joiningUser?.nickname }}</h3>
        <p class="text-slate-400 text-sm mb-8">邀请你参与这场高尔夫球赛</p>
        
        <div class="w-full space-y-3">
          <button @click="handleJoinAsPlayer" class="w-full py-4 bg-blue-600 text-white rounded-full font-bold shadow-xl shadow-blue-900/20 active:scale-95 transition-all flex items-center justify-center gap-2">
            <view class="scorecard-uni-ico-slot"><uni-icons type="personadd" :size="20" color="#cbd5e1" /></view>
            加入比赛
          </button>
          <button @click="handleSpectate" class="w-full py-4 bg-slate-800 text-slate-300 rounded-full font-bold active:scale-95 transition-all flex items-center justify-center gap-2">
            <view class="scorecard-uni-ico-slot"><uni-icons type="eye" :size="20" color="#cbd5e1" /></view>
            仅围观
          </button>
        </div>
      </div>
    </div>
    <!-- Player Action Modal -->
    <div v-if="showPlayerActionModal" class="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showPlayerActionModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-6 flex flex-col items-center border-b border-slate-100">
          <image :src="avatarOrDefault(selectedPlayer ?? undefined)" class="w-16 h-16 rounded-full border-2 border-slate-200 mb-3" mode="aspectFill" />
          <h3 class="text-lg font-bold text-slate-900">{{ selectedPlayer?.nickname }}</h3>
          <p v-if="selectedPlayer?.handicap != null" class="text-xs text-slate-500 mt-1">差点: {{ selectedPlayer.handicap }}</p>
        </div>
        
        <div class="p-4 space-y-3">
          <button @click="handleViewProfile" class="w-full py-4 bg-slate-50 text-slate-800 rounded-2xl font-bold flex items-center justify-center gap-3 transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="person" :size="20" color="#2563eb" /></view>
            查看档案
          </button>
          
          <button v-if="isInitiator && selectedPlayer?.id !== (currentMatch?.user_list?.[0]?.id || myId)" 
                  @click="confirmDeletePlayer" 
                  class="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold flex items-center justify-center gap-3 transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="trash" :size="20" color="#ef4444" /></view>
            删除参赛者
          </button>
          
          <button @click="showPlayerActionModal = false" class="w-full py-4 text-slate-400 font-bold text-sm">
            取消
          </button>
        </div>
      </div>
    </div>

    <div v-if="showVirtualPlayerPanel" class="fixed inset-0 z-[150] bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
        <button @click="showVirtualPlayerPanel = false" class="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <view class="scorecard-uni-ico-slot"><uni-icons type="left" :size="24" color="#334155" /></view>
        </button>
        <h1 class="text-base font-bold text-slate-900">添加虚拟球友</h1>
        <div class="w-10"></div>
      </header>
      
      <div class="p-6 space-y-8">
        <div class="flex flex-col items-center gap-4 py-8">
          <div class="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center text-3xl font-bold text-slate-500">
            {{ quickAddName ? quickAddName.charAt(0) : '?' }}
          </div>
          <p class="text-xs text-slate-500">设置一个好记的昵称</p>
        </div>

        <div class="space-y-2">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">球友昵称</label>
          <div class="bg-slate-50 rounded-2xl border border-slate-200 p-1 focus-within:border-[#07C160] transition-colors">
            <input 
              v-model="quickAddName" 
              type="text" 
              placeholder="请输入球友昵称" 
              class="w-full h-12 bg-transparent px-4 text-base outline-none text-slate-900"
              autofocus
              @keyup.enter="handleQuickAdd"
            />
          </div>
        </div>

        <div class="pt-8">
          <button 
            @click="handleQuickAdd"
            :disabled="!quickAddName.trim()"
            class="w-full py-4 rounded-full font-bold text-base transition-all active:scale-95 shadow-xl flex items-center justify-center"
            :class="quickAddName.trim() ? 'bg-[#07C160] text-white shadow-green-900/10' : 'bg-slate-100 text-slate-400 cursor-not-allowed'"
          >
            确认并添加
          </button>
          <button @click="showVirtualPlayerPanel = false" class="w-full py-4 mt-4 text-slate-400 font-medium text-sm">
            取消
          </button>
        </div>
      </div>
    </div>
    <!-- Settings Modal -->
    <div v-if="showSettingsModal" class="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showSettingsModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">比赛设置</h2>
          <button @click="showSettingsModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        
        <div class="p-4 space-y-3 pb-10">
          <button v-for="opt in settingsOptions" :key="opt.id" 
                  @click="handleSettingsAction(opt.action || '')"
                  class="w-full flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 active:scale-95 transition-all">
            <div class="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm border border-slate-100">
              <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons :type="opt.uniType" :size="22" :color="opt.iconColor" /></view>
            </div>
            <span class="text-sm font-medium text-slate-800">{{ opt.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Match Modal -->
    <div v-if="showEditMatchModal" class="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 h-[80vh] flex flex-col">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">修改比赛</h2>
          <button @click="showEditMatchModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">比赛名称</label>
            <input v-model="editMatchTitle" type="text" class="mp-safe-input-full w-full px-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#07C160] outline-none text-slate-900 font-bold text-base" />
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">比赛时间</label>
            <input v-model="editMatchTime" type="datetime-local" class="mp-safe-input-full w-full px-4 bg-slate-50 rounded-2xl border border-slate-200 focus:border-[#07C160] outline-none text-slate-900 font-bold text-base" />
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">球场</label>
            <div @click="showEditCoursePicker = true" class="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between cursor-pointer active:bg-slate-100">
              <span class="text-slate-900 font-bold">{{ editSelectedCourse?.name }}</span>
              <view class="scorecard-uni-ico-slot"><uni-icons type="right" :size="20" color="#64748b" /></view>
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">参与球员</label>
            <div class="space-y-2">
              <div v-for="player in matchStore.user_list" :key="player.id" class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div class="flex items-center gap-3">
                  <img :src="avatarOrDefault(player)" class="w-8 h-8 rounded-full" />
                  <span class="text-sm font-bold text-slate-900">{{ player.nickname }}</span>
                </div>
                <button @click="handleRemovePlayer(player)" class="p-2 hover:bg-red-50 rounded-lg">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="trash" :size="18" color="#ef4444" /></view>
                </button>
              </div>
              <button @click="showAddPlayerModal = true" class="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center gap-2 text-slate-400 active:bg-slate-50 transition-all">
                <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#94a3b8" /></view>
                <span class="text-xs font-bold">添加球员</span>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div class="flex flex-col">
              <span class="text-sm font-bold text-slate-900">私密比赛</span>
              <span class="text-xs text-slate-500">开启后仅参与球员可见</span>
            </div>
            <switch :checked="editMatchPrivacy" color="#07C160" @change="(e: { detail?: { value?: boolean } }) => { editMatchPrivacy = !!(e.detail?.value); }" />
          </div>
        </div>

        <div class="p-6 border-t border-slate-100">
          <button type="button" @click="saveMatchEdits" class="w-full py-4 bg-[#07C160] text-white rounded-full font-bold shadow-lg shadow-green-900/10 active:scale-95 transition-all flex items-center justify-center text-center">
            保存修改
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Course Picker -->
    <div v-if="showEditCoursePicker" class="fixed inset-0 z-[140] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 h-[80vh] flex flex-col">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">选择球场</h2>
          <button @click="showEditCoursePicker = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-4">
          <div class="relative flex items-center">
            <view class="scorecard-uni-ico-slot absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none"><uni-icons type="search" :size="22" color="#94a3b8" /></view>
            <input v-model="editSearchKey" type="text" placeholder="搜索球场..." class="mp-safe-input-full w-full pl-11 pr-4 bg-slate-50 rounded-2xl border border-slate-200 outline-none text-slate-900 text-base box-border" />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-2">
          <div v-for="course in filteredEditCourses" :key="course.name" @click="handleEditCourseSelect(course)" class="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between cursor-pointer active:bg-slate-100">
            <div>
              <div class="text-slate-900 font-bold">{{ course.name }}</div>
              <div class="text-xs text-slate-500">{{ course.city }} · {{ course.sections ? course.sections.length / 2 + '场' : '18洞' }}</div>
            </div>
            <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="right" :size="18" color="#64748b" /></view>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Section Picker -->
    <div v-if="showEditSectionPicker" class="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 class="text-base font-bold text-slate-900">选择半场</h2>
            <p class="text-xs text-slate-500 mt-0.5">请选择两个 9 洞半场进行组合</p>
            <p v-if="showEditStandard18SectionHint" class="text-xs text-slate-500 mt-0.5">18 洞球场：可先选后九再选前九，数字表示击球顺序</p>
          </div>
          <button @click="showEditSectionPicker = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-6 space-y-6">
          <div class="grid grid-cols-2 gap-3">
            <div v-for="section in editSectionPickerList" :key="section.name" @click="toggleEditSection(section)" class="p-4 rounded-2xl border-2 flex flex-col items-center gap-2 cursor-pointer transition-all" :class="editSelectedSections.find(s => s.name === section.name) ? 'border-[#07C160] bg-green-50' : 'border-slate-200 bg-slate-50'">
              <span class="font-bold text-slate-900">{{ section.name }}</span>
              <span class="text-xs text-slate-500">Par {{ section.holes_par.reduce((a, b) => a + b, 0) }}</span>
              <div v-if="editSelectedSections.findIndex(s => s.name === section.name) > -1" class="w-5 h-5 rounded-full bg-[#07C160] flex items-center justify-center text-white text-xs font-bold">
                {{ editSelectedSections.findIndex(s => s.name === section.name) + 1 }}
              </div>
            </div>
          </div>
          <button @click="confirmEditSections" :disabled="editSelectedSections.length !== 2" class="w-full py-4 rounded-full font-bold transition-all" :class="editSelectedSections.length === 2 ? 'bg-[#07C160] text-white active:scale-95' : 'bg-slate-100 text-slate-400 cursor-not-allowed'">
            确认组合 ({{ editSelectedSections.length }}/2)
          </button>
        </div>
      </div>
    </div>

    <!-- Landmine Modal -->
    <div v-if="showLandmineModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showLandmineModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">埋地雷设置</h2>
          <button type="button" @click="showLandmineModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-5 space-y-6 pb-10">
          <div class="space-y-3 text-slate-800">
            <div class="flex items-center justify-between">
              <span class="text-sm">前九地雷数</span>
              <div class="flex items-center gap-4">
                <button type="button" @click="currentConfigRule?.landmines && (currentConfigRule.landmines.front = Math.max(0, currentConfigRule.landmines.front - 1))" class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center"><view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="minus" :size="20" color="#334155" /></view></button>
                <span class="text-lg font-bold w-4 text-center tabular-nums">{{ currentConfigRule?.landmines?.front || 0 }}</span>
                <button type="button" @click="currentConfigRule?.landmines && (currentConfigRule.landmines.front = Math.min(9, currentConfigRule.landmines.front + 1))" class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center"><view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#334155" /></view></button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm">后九地雷数</span>
              <div class="flex items-center gap-4">
                <button type="button" @click="currentConfigRule?.landmines && (currentConfigRule.landmines.back = Math.max(0, currentConfigRule.landmines.back - 1))" class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center"><view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="minus" :size="20" color="#334155" /></view></button>
                <span class="text-lg font-bold w-4 text-center tabular-nums">{{ currentConfigRule?.landmines?.back || 0 }}</span>
                <button type="button" @click="currentConfigRule?.landmines && (currentConfigRule.landmines.back = Math.min(9, currentConfigRule.landmines.back + 1))" class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center"><view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#334155" /></view></button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm">地雷翻倍数</span>
              <div class="flex items-center gap-4">
                <button type="button" @click="currentConfigRule?.landmines && (currentConfigRule.landmines.multiplier = Math.max(2, currentConfigRule.landmines.multiplier - 1))" class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center"><view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="minus" :size="20" color="#334155" /></view></button>
                <span class="text-lg font-bold w-4 text-center tabular-nums">{{ currentConfigRule?.landmines?.multiplier || 2 }}</span>
                <button type="button" @click="currentConfigRule?.landmines && (currentConfigRule.landmines.multiplier++)" class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center"><view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#334155" /></view></button>
              </div>
            </div>
          </div>
          <button type="button" @click="randomizeLandmines(); showLandmineModal = false" class="w-full py-3.5 bg-red-600 text-white rounded-full font-bold shadow-md shadow-red-900/10 active:scale-[0.98] transition-all">
            随机分配地雷并确认
          </button>
        </div>
      </div>
    </div>

    <!-- Participant Modal -->
    <div v-if="showParticipantModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showParticipantModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">选择参与人数</h2>
          <button type="button" @click="showParticipantModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-3 space-y-2 pb-10">
          <button v-for="n in [2, 3, 4]" :key="n" 
                  type="button"
                  @click="currentConfigRule && (currentConfigRule.participant_count = n); showParticipantModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.participant_count === n ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">{{ n }}人单挂</span>
            <div v-if="currentConfigRule?.participant_count === n" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Handicap Modal -->
    <div v-if="showHandicapModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showHandicapModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">单让规则设置</h2>
          <button type="button" @click="showHandicapModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-3 space-y-2 pb-10 max-h-[60vh] overflow-y-auto">
          <button v-for="opt in ['none', '2', '3', '4', '5', 'virtual']" :key="opt" 
                  type="button"
                  @click="currentConfigRule?.handicap_config && (currentConfigRule.handicap_config.type = opt); showHandicapModal = false; if(opt === 'none') showHandicapValueModal = true"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.handicap_config?.type === opt ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">{{ opt === 'none' ? '总分让杆' : opt === 'virtual' ? '虚让' : opt + '让1' }}</span>
            <div v-if="currentConfigRule?.handicap_config?.type === opt" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Total Handicap Modal (for 8421) -->
    <div v-if="showTotalHandicapModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-xl">
        <div class="p-5">
          <h3 class="text-lg font-bold mb-5 text-center text-slate-900">设置总分让分</h3>
          <div class="flex items-center justify-center gap-6 mb-6">
            <button type="button" @click="currentConfigRule && currentConfigRule.handicap_config && (currentConfigRule.handicap_config.value = Math.max(0, currentConfigRule.handicap_config.value - 1))" 
                    class="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center active:scale-95 transition-all">
              <view class="scorecard-uni-ico-slot"><uni-icons type="minus" :size="24" color="#334155" /></view>
            </button>
            <span class="text-3xl font-black w-16 text-center text-[#15803d] tabular-nums">{{ currentConfigRule?.handicap_config?.value || 0 }}</span>
            <button type="button" @click="currentConfigRule && currentConfigRule.handicap_config && (currentConfigRule.handicap_config.value += 1)" 
                    class="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center active:scale-95 transition-all">
              <view class="scorecard-uni-ico-slot"><uni-icons type="plus" :size="24" color="#334155" /></view>
            </button>
          </div>
          <button type="button" @click="showTotalHandicapModal = false" class="w-full py-3 bg-[#15803d] text-white rounded-xl font-bold">
            确定
          </button>
        </div>
      </div>
    </div>

    <!-- Par-specific Handicap Modal -->
    <div v-if="showParHandicapModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 backdrop-blur-sm px-6" @click.self="showParHandicapModal = false">
      <div class="w-full max-w-xs bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-xl">
        <div class="p-5">
          <div class="flex items-center justify-between mb-5">
            <h3 class="text-lg font-bold text-slate-900">设置让杆</h3>
            <button type="button" @click="showParHandicapModal = false" class="p-2 -mr-2 rounded-full hover:bg-slate-100 transition-colors">
              <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
            </button>
          </div>
          <div class="space-y-4">
            <div v-for="par in [3, 4, 5]" :key="par" class="flex items-center justify-between text-slate-900">
              <span class="text-sm font-bold">Par {{ par }} 让杆</span>
              <div class="flex items-center gap-3">
                <button type="button" @click="currentConfigRule.handicap_par_strokes[`par${par}`] = Math.max(0, currentConfigRule.handicap_par_strokes[`par${par}`] - 0.5)" 
                        class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="minus" :size="20" color="#334155" /></view>
                </button>
                <span class="text-lg font-bold w-10 text-center text-[#15803d] tabular-nums">{{ currentConfigRule.handicap_par_strokes[`par${par}`] }}</span>
                <button type="button" @click="currentConfigRule.handicap_par_strokes[`par${par}`] += 0.5" 
                        class="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <view class="scorecard-uni-ico-slot scorecard-uni-ico-slot--sm"><uni-icons type="plus" :size="20" color="#334155" /></view>
                </button>
              </div>
            </div>
          </div>
          <button type="button" @click="showParHandicapModal = false" class="w-full py-3 bg-[#15803d] text-white rounded-xl font-bold mt-6 shadow-md shadow-emerald-900/10">确定</button>
        </div>
      </div>
    </div>

    <!-- Starting Hole Modal（与拉斯/斗地主/打老虎说明一致） -->
    <div v-if="showStartingHoleModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-xl">
        <div class="p-5">
          <h3 class="text-lg font-bold mb-2 text-center text-slate-900">选择出发洞</h3>
          <p class="text-xs text-slate-600 mb-4 text-center leading-relaxed px-1">收顶洞、顶洞等按从出发洞起的环形洞序计算。所选为物理洞号（1–18）。</p>
          <div class="grid grid-cols-6 gap-2">
            <button v-for="i in 18" :key="i"
                    type="button"
                    @click="currentConfigRule.starting_hole = i; showStartingHoleModal = false"
                    class="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all border"
                    :class="currentConfigRule.starting_hole === i ? 'bg-[#15803d] text-white border-[#15803d]' : 'bg-slate-50 text-slate-700 border-slate-200'">
              {{ i }}
            </button>
          </div>
          <button type="button" @click="showStartingHoleModal = false" class="w-full py-3 bg-slate-100 text-slate-800 border border-slate-200 rounded-xl font-bold mt-5">取消</button>
        </div>
      </div>
    </div>

    <!-- Hole-based Handicap Modal -->
    <div v-if="showHoleHandicapModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 backdrop-blur-sm px-6" @click.self="showHoleHandicapModal = false">
      <div class="w-full max-w-xs bg-white rounded-3xl overflow-hidden border border-slate-200 shadow-xl">
        <div class="p-5 text-center">
          <div class="flex items-start justify-between gap-3 mb-1 text-left">
            <h3 class="text-lg font-bold text-slate-900 leading-snug">设置让洞</h3>
            <button type="button" @click="showHoleHandicapModal = false" class="p-2 -mr-2 -mt-1 rounded-full hover:bg-slate-100 transition-colors shrink-0">
              <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
            </button>
          </div>
          <p class="text-xs text-slate-600 mb-5 text-left">输入让洞数量</p>
          
          <div class="flex items-center justify-center gap-6 mb-6">
            <button type="button" @click="currentConfigRule.handicap_holes_count = Math.max(0, currentConfigRule.handicap_holes_count - 1)" class="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
              <view class="scorecard-uni-ico-slot"><uni-icons type="minus" :size="24" color="#334155" /></view>
            </button>
            <span class="text-4xl font-black text-[#15803d] tabular-nums">{{ currentConfigRule.handicap_holes_count }}</span>
            <button type="button" @click="currentConfigRule.handicap_holes_count++" class="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
              <view class="scorecard-uni-ico-slot"><uni-icons type="plus" :size="24" color="#334155" /></view>
            </button>
          </div>

          <button type="button" @click="showHoleHandicapModal = false" class="w-full py-3 bg-[#15803d] text-white rounded-xl font-bold">确定</button>
        </div>
      </div>
    </div>

    <!-- Reward Modal -->
    <div v-if="showRewardModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showRewardModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">奖励规则设置</h2>
          <button type="button" @click="showRewardModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-3 space-y-2 pb-10">
          <button v-for="opt in ['1', '2', '3', '4']" :key="opt" 
                  type="button"
                  @click="currentConfigRule && (currentConfigRule.reward_config = opt); showRewardModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.reward_config === opt ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-sm text-slate-900">{{ getRewardText(opt) }}</span>
            <div v-if="currentConfigRule?.reward_config === opt" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Strokes Player Selection Modal -->
    <div v-if="showStrokesPlayerSelect" class="fixed inset-0 z-[170] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showStrokesPlayerSelect = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">选择选手 {{ strokesSelectIndex + 1 }}</h2>
          <button type="button" @click="showStrokesPlayerSelect = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-4 max-h-[60vh] overflow-y-auto">
          <div class="grid grid-cols-4 gap-3">
            <button v-for="player in players" :key="player.id" 
                    type="button"
                    @click="handleStrokesPlayerSelect(player)"
                    class="flex flex-col items-center gap-1.5 p-1.5 rounded-xl transition-all border"
                    :class="currentConfigRule?.player_ids?.[strokesSelectIndex] === player.id ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'">
              <div class="w-10 h-10 rounded-full border-2 border-white bg-slate-200 overflow-hidden shrink-0">
                <image :src="avatarOrDefault(player)" mode="aspectFill" class="w-full h-full block" />
              </div>
              <span class="text-xs font-medium truncate w-full text-center text-slate-800">{{ player.nickname }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Win Condition Modal -->
    <div v-if="showWinConditionModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showWinConditionModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">选择赢洞条件</h2>
          <button type="button" @click="showWinConditionModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-3 space-y-2 pb-10">
          <button type="button" @click="currentConfigRule && (currentConfigRule.win_condition = 'lower_strokes'); showWinConditionModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.win_condition === 'lower_strokes' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">杆数少者算赢</span>
            <div v-if="currentConfigRule?.win_condition === 'lower_strokes'" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Tie Modal -->
    <div v-if="showTieModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showTieModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">顶洞规则</h2>
          <button type="button" @click="showTieModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-3 space-y-2 pb-10">
          <button type="button" @click="currentConfigRule && (currentConfigRule.tie_type = 'add_one'); showTieModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.tie_type === 'add_one' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">下洞加1分</span>
            <div v-if="currentConfigRule?.tie_type === 'add_one'" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
          <button type="button" @click="currentConfigRule && (currentConfigRule.tie_type = 'none'); showTieModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.tie_type === 'none' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">不加分</span>
            <div v-if="currentConfigRule?.tie_type === 'none'" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Collect Tie Modal -->
    <div v-if="showCollectTieModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showCollectTieModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 class="text-base font-bold text-slate-900">收顶洞规则</h2>
          <button type="button" @click="showCollectTieModal = false" class="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#64748b" /></view>
          </button>
        </div>
        <div class="p-3 space-y-2 pb-10">
          <button type="button" @click="currentConfigRule && (currentConfigRule.collect_tie_type = 'par_1_birdie_2_eagle_all'); showCollectTieModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">帕收1/鸟收2/鹰全收</span>
            <div v-if="currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all'" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
          <button type="button" @click="currentConfigRule && (currentConfigRule.collect_tie_type = 'all'); showCollectTieModal = false"
                  class="w-full py-3 px-4 rounded-2xl flex items-center justify-between transition-all border"
                  :class="currentConfigRule?.collect_tie_type === 'all' ? 'bg-emerald-50 border-[#15803d]' : 'bg-slate-50 border-slate-200'">
            <span class="font-bold text-slate-900">全收</span>
            <div v-if="currentConfigRule?.collect_tie_type === 'all'" class="w-2 h-2 rounded-full bg-[#15803d]"></div>
          </button>
        </div>
      </div>
    </div>
    <!-- Hole Select Modal -->
    <div v-if="showHoleSelectModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/40 backdrop-blur-sm" @click.self="showHoleSelectModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <h2 class="text-base font-bold text-slate-900 shrink-0">选择有效洞</h2>
          <div class="flex gap-1.5 flex-wrap justify-end">
            <button type="button" @click="setHoleRange('front')" class="text-xs px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-medium">前九</button>
            <button type="button" @click="setHoleRange('back')" class="text-xs px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-medium">后九</button>
            <button type="button" @click="setHoleRange('all')" class="text-xs px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-medium">全选</button>
          </div>
        </div>
        <div class="p-5 pb-10">
          <div class="grid grid-cols-6 gap-2.5">
            <button v-for="i in 18" :key="i" 
                    type="button"
                    @click="toggleHole(i)"
                    class="aspect-square rounded-xl flex items-center justify-center text-sm font-bold transition-colors border"
                    :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-[#15803d] text-white border-[#15803d]' : 'bg-slate-50 text-slate-600 border-slate-200'">
              {{ i }}
            </button>
          </div>
          <button type="button" @click="showHoleSelectModal = false" class="w-full py-3.5 bg-[#15803d] text-white rounded-full font-bold mt-6">
            完成
          </button>
        </div>
      </div>
    </div>

    <!-- PK Score Modal -->
    <div v-if="showPKScoreModal" class="scorecard-pk-modal-root fixed inset-0 z-[160] flex flex-col bg-white animate-in slide-in-from-bottom duration-300">
      <!-- Header：左侧返回，右侧留给规则选择器，避免与胶囊冲突 -->
      <div class="px-3 py-3 border-b border-slate-100 flex items-center gap-2 bg-white sticky top-0 z-50 shrink-0">
        <button
          type="button"
          @click="showPKScoreModal = false"
          class="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-slate-100 active:bg-slate-200"
          aria-label="返回"
        >
          <view class="scorecard-uni-ico-slot"><uni-icons type="left" :size="22" color="#334155" /></view>
        </button>
        <div class="flex-1 min-w-0 relative">
          <picker
            mode="selector"
            :range="pkRulePickerRange"
            :value="pkRulePickerIndex"
            @change="onPkRulePickerChange"
          >
            <view class="w-full bg-[#07C160] text-white font-bold py-2.5 px-3 rounded-full text-center text-[15px] shadow-md shadow-green-900/10 flex items-center justify-center pr-9 box-border">
              <text class="text-white font-bold text-[15px] text-center truncate">{{ pkRulePickerRange[pkRulePickerIndex] }}</text>
            </view>
          </picker>
          <view class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-white">
            <svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
          </view>
        </div>
      </div>

      <!-- Score Table (view-based for WeChat）头像行勿用 sticky，易与 scroll-view 裁剪冲突 -->
      <scroll-view scroll-y class="flex-1 bg-slate-50 min-h-0 sc-pk-scroll" :show-scrollbar="false">
        <!-- Header: 累计 + players -->
        <view class="sc-row sc-pk-row--avatars bg-white sc-pk-avatar-row sc-border-b">
          <view class="sc-pk-cell-label sc-border-rb" style="background:#f8fafc;"><text class="sc-pk-label-text text-slate-500">累计</text></view>
          <view v-for="player in players" :key="player.id" class="sc-pk-cell sc-border-rb bg-white sc-pk-cell--avatar">
            <view class="sc-pk-avatar-inner">
              <view class="sc-pk-avatar-wrap">
                <image :src="avatarOrDefault(player)" class="sc-pk-avatar" mode="aspectFill" />
              </view>
              <text class="sc-pk-nick-text font-bold text-slate-800 sc-pk-nick">{{ player.nickname }}</text>
            </view>
          </view>
        </view>
        <!-- Header: 总分 -->
        <view class="sc-row sc-pk-row--data" style="background:#f0f9f4;border-bottom:1rpx solid #e2e8f0;">
          <view class="sc-pk-cell-label sc-border-rb" style="background:#f0f9f4;"><text class="sc-pk-label-text text-slate-500">总分</text></view>
          <view v-for="player in players" :key="'total-'+player.id" class="sc-pk-cell sc-border-rb">
            <text class="sc-pk-total-text font-bold" :class="getPKScoreTotal(player.id) >= 0 ? 'text-red-500' : 'text-[#07C160]'">
              {{ getPKScoreTotal(player.id) > 0 ? '+' : '' }}{{ getPKScoreTotal(player.id) }}
            </text>
          </view>
        </view>
        <!-- Hole rows -->
        <view v-for="i in 18" :key="i" class="sc-row sc-pk-row--data" style="border-bottom:1rpx solid #f1f5f9;">
          <view class="sc-pk-cell-label sc-border-rb" style="background:#f8fafc;"><text class="sc-pk-hole-num text-slate-600">{{ i }}</text></view>
          <view v-for="player in players" :key="player.id" class="sc-pk-cell sc-border-rb">
            <text v-if="getPKScoreHole(player.id, i-1) !== 0" class="sc-pk-score-text" :class="getPKScoreHole(player.id, i-1) > 0 ? 'text-red-500' : 'text-[#07C160]'">
              {{ getPKScoreHole(player.id, i-1) > 0 ? '+' : '' }}{{ getPKScoreHole(player.id, i-1) }}
            </text>
            <text v-else class="sc-pk-score-text sc-pk-score-zero">0</text>
          </view>
        </view>
      </scroll-view>
    </div>
    <!-- Share Modal -->
    <div v-if="showShareModal" class="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showShareModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-100">
          <div class="text-sm font-bold text-slate-800 mb-2">选择要生成海报的球手</div>
          <div class="flex gap-2 overflow-x-auto no-scrollbar">
            <button
              v-for="p in players"
              :key="'share-player-'+p.id"
              type="button"
              hover-class="none"
              @tap.stop="sharePlayerId = p.id"
              @click.stop="sharePlayerId = p.id"
              class="px-3 py-1.5 rounded-full text-xs border transition-colors"
              :class="sharePlayerId === p.id ? 'bg-[#07C160] border-[#07C160] text-white' : 'bg-white border-slate-200 text-slate-700'"
            >
              {{ p.nickname }}
            </button>
          </div>
        </div>
        <!-- #ifdef MP-WEIXIN -->
        <div class="p-6">
          <button
            type="button"
            hover-class="opacity-90"
            @tap.stop="savePersonalScorePoster"
            class="w-full py-4 bg-[#07C160] text-white rounded-2xl font-bold text-base flex items-center justify-center gap-3 shadow-lg shadow-green-900/10 active:scale-95 transition-all border-0"
          >
            <view class="scorecard-uni-ico-slot"><uni-icons type="image-filled" :size="24" color="#ffffff" /></view>
            生成完整计分海报
          </button>
          <p class="text-center text-xs text-slate-400 mt-2">将生成包含18洞成绩的完整海报</p>
        </div>
        <!-- #endif -->
        <div class="p-4 border-t border-slate-100">
          <button @click="showShareModal = false" class="w-full py-3 text-slate-400 font-bold text-sm">取消</button>
        </div>
      </div>
    </div>

    <!-- Poster Preview Modal -->
    <div v-if="showPosterPreviewModal" class="fixed inset-0 z-[210] flex flex-col bg-black/90 backdrop-blur-sm">
      <div class="safe-top flex shrink-0 items-center justify-between px-4 pt-2 pb-2">
        <button @click="showPosterPreviewModal = false" class="p-2 rounded-full bg-white/10">
          <view class="scorecard-uni-ico-slot"><uni-icons type="closeempty" :size="22" color="#ffffff" /></view>
        </button>
        <span class="text-white font-bold">计分海报</span>
        <view class="w-10 h-10 shrink-0" />
      </div>
      <scroll-view scroll-y class="flex-1 flex items-center justify-center p-4 min-h-0">
        <image
          v-if="posterPreviewSrc"
          :src="posterPreviewSrc"
          mode="widthFix"
          class="w-full rounded-2xl shadow-2xl"
          show-menu-by-longpress
        />
        <view v-else class="flex flex-col items-center justify-center py-20 text-white/60 gap-3">
          <view class="scorecard-uni-ico-slot"><uni-icons type="image" :size="40" color="rgba(255,255,255,0.4)" /></view>
          <text class="text-sm">海报生成中...</text>
        </view>
      </scroll-view>
      <div class="shrink-0 px-4 pt-2 pb-6 pb-safe">
        <button
          type="button"
          @click="savePosterFromPreview"
          class="w-full py-3.5 rounded-full bg-[#07C160] text-white text-base font-bold flex items-center justify-center"
        >
          保存相册
        </button>
      </div>
    </div>

    <!-- 计分海报：仅微信小程序走 Canvas 2D（见 savePersonalScorePoster） -->
    <!-- #ifdef MP-WEIXIN -->
    <canvas
      type="2d"
      id="scorePosterCanvas2d"
      style="position: fixed; left: -9999px; top: -9999px; width: 750px; height: 1334px;"
    />
    <!-- #endif -->
    <!-- #ifndef MP-WEIXIN -->
    <canvas
      id="scorePosterCanvasLegacy"
      style="position: fixed; left: -9999px; top: -9999px; width: 750px; height: 1334px;"
    />
    <!-- #endif -->
  </div>
</template>

<style scoped>
.animate-in {
  animation: animate-in 0.3s ease-out;
}

@keyframes animate-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.slide-in-from-bottom {
  animation: slide-in-from-bottom 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-in-from-bottom {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

/* —— 微信小程序 / iOS WebView：固定视口与 vh —— */
.scorecard-root {
  height: 100vh;
  min-height: 100vh;
  max-height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  background: #f3f7fb !important;
  color: #0f172a !important;
}

/* 规则配置面板内：保证浅色行上的文字可读 */
.scorecard-config-row-label {
  color: #0f172a;
  font-size: 28rpx;
}
.scorecard-config-row-value {
  color: #334155;
  font-size: 28rpx;
  font-weight: 600;
}
.scorecard-config-row {
  background-color: #f8fafc;
  border-bottom: 1rpx solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 24rpx;
  cursor: pointer;
}
.scorecard-config-row:active {
  background-color: #f1f5f9;
}

.scorecard-seg-btn {
  border-radius: 999rpx;
  line-height: 1.35;
}

/* ─── 得分卡信息条（替代旧 poster-hero）─── */
.sc-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 24rpx;
  background: #ffffff;
  border-bottom: 1rpx solid #e8f0fe;
  flex-shrink: 0;
}
.sc-info-bar-left {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  min-width: 0;
}
.sc-info-bar-course {
  font-size: 28rpx;
  font-weight: 800;
  color: #0f172a;
  line-height: 1.2;
}
.sc-info-bar-date {
  font-size: 20rpx;
  color: #64748b;
}
.sc-info-bar-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}
.sc-info-bar-label {
  font-size: 18rpx;
  color: #64748b;
  line-height: 1;
}
.sc-info-bar-score {
  font-size: 52rpx;
  font-weight: 900;
  color: #07C160;
  line-height: 1;
}
.sc-info-bar-progress {
  font-size: 18rpx;
  color: #475569;
  margin-top: 2rpx;
}

.scorecard-table-outer {
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

/* ═══════════════════════════════════════════════════════
   GolfLive 架构：固定球员列 + scroll-view 仅含洞格
   行高精确对齐，enable-flex + enhanced = 原生丝滑惯性
   ═══════════════════════════════════════════════════════ */

/* 外层容器：flex row，固定列 + 滚动列并排 */
.scorecard-table-outer {
  display: flex !important;
  flex-direction: row !important;
  align-items: stretch !important;
  width: 100%;
  overflow: hidden;
  min-width: 0;
}

/* 固定球员列：不参与横向滚动 */
.sc-fixed-col {
  flex-shrink: 0 !important;
  width: 178rpx !important;
  min-width: 178rpx !important;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background-color: #ffffff !important;
}

/* 固定列 - 表头单元格（绿色底，与参考设计对齐） */
.sc-fixed-hdr {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 80rpx !important;
  box-sizing: border-box !important;
  border-bottom: 1rpx solid rgba(22, 163, 74, 0.3);
  border-right: 1rpx solid rgba(22, 163, 74, 0.3);
  position: sticky;
  top: 0;
  z-index: 41;
  background-color: #16a34a;
}

/* 固定列球员行内边距：与右侧洞格垂直对齐 */
.sc-fixed-player-inner {
  box-sizing: border-box;
  padding: 4rpx 10rpx;
}

/* 固定列 - 球员单元格 */
.sc-fixed-player {
  display: flex !important;
  align-items: center !important;
  height: 80rpx !important;
  box-sizing: border-box !important;
  border-bottom: 1rpx solid #e2e8f0;
  border-right: 1rpx solid #e2e8f0;
  overflow: hidden;
  background-color: #ffffff;
}

/* scroll-view：flex:1 占剩余宽度，enhanced 开启原生惯性 */
.score-scroll-view,
.scorecard-table-scroll {
  flex: 1 !important;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
}

/* hole-track：scroll-view 直接子元素 */
.hole-track {
  display: inline-block !important;
  vertical-align: top;
  width: 2660rpx !important;
  min-width: 2660rpx !important;
}

/* hole-row：flex 行，与左侧固定列对齐，避免 inline-block 错位 */
.hole-row {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: stretch !important;
  width: 2660rpx !important;
  min-width: 2660rpx !important;
  min-height: 80rpx !important;
  height: 80rpx !important;
  box-sizing: border-box !important;
}

.hole-row.sc-header {
  height: 80rpx !important;
  min-height: 80rpx !important;
}

.hole-row:not(.sc-header) {
  height: 80rpx !important;
  min-height: 80rpx !important;
}

/* sc-cell：flex 列，撑满行高 */
.sc-cell {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  flex-shrink: 0 !important;
  height: 100% !important;
  min-height: 80rpx !important;
  box-sizing: border-box !important;
  overflow: hidden;
}

/* 洞格双圈/双方框依赖 ::before 外扩，勿裁切 */
.sc-cell.sc-col-hole.sc-score-cell {
  overflow: visible !important;
}

/* 每一洞格：彻底锁定 110rpx */
.sc-cell.sc-col-hole,
.sc-col-hole.hole-item,
.hole-item.sc-col-hole {
  width: 110rpx !important;
  min-width: 110rpx !important;
  max-width: 110rpx !important;
  box-sizing: border-box !important;
}

.sc-col-hole .sc-hdr-inner,
.sc-col-hole .sc-score-stack {
  width: 110rpx !important;
  max-width: 110rpx !important;
  box-sizing: border-box;
}

.scorecard-pk-modal-root {
  padding-top: calc(16px + constant(safe-area-inset-top));
  padding-top: calc(16px + env(safe-area-inset-top));
}

/* PK 得分弹窗：每行必须为横向 flex（原先仅写了 class 未定义样式，会导致整列竖排错乱） */
.sc-row {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: stretch !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
.sc-pk-scroll {
  padding-top: 24rpx;
  box-sizing: border-box;
}
.sc-pk-row--avatars {
  min-height: 0 !important;
  align-items: flex-start !important;
}
.sc-pk-avatar-row {
  overflow: visible !important;
  padding-top: 20rpx !important;
  padding-bottom: 20rpx !important;
}
.sc-pk-avatar-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 12rpx 8rpx 8rpx;
}
.sc-pk-avatar-wrap {
  width: 84rpx;
  height: 84rpx;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1rpx solid #e2e8f0;
  box-sizing: border-box;
  background-color: #f1f5f9;
}
.sc-pk-row--data {
  min-height: 92rpx !important;
  align-items: center !important;
}
.sc-pk-nick {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.sc-header {
  position: sticky;
  top: 0;
  z-index: 40;
  background-color: #16a34a !important;
}

.sc-col-player {
  width: 180rpx !important;
  min-width: 180rpx !important;
  max-width: 180rpx !important;
  box-sizing: border-box !important;
}
.sc-col-f9  { width: 90rpx !important; min-width: 90rpx !important; max-width: 90rpx !important; box-sizing: border-box !important; }
.sc-col-par { width: 80rpx !important; min-width: 80rpx !important; max-width: 80rpx !important; box-sizing: border-box !important; }
.sc-col-sum { width: 96rpx !important; min-width: 96rpx !important; max-width: 96rpx !important; box-sizing: border-box !important; }
.sc-col-pk  { width: 110rpx !important; min-width: 110rpx !important; max-width: 110rpx !important; box-sizing: border-box !important; }

.sc-border-rb { border-right: 1rpx solid #e2e8f0; border-bottom: 1rpx solid #e2e8f0; }
.sc-border-b  { border-bottom: 1rpx solid #e2e8f0; }
.sc-bg-dim    { background-color: #f0f9f4; }

/* 表头行内的总结格子（前9/后9/总差等）继承绿色 */
.sc-header .sc-bg-dim {
  background-color: #15803d !important;
}

.sc-hdr-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 80rpx;
  width: 100%;
  box-sizing: border-box;
}

.sc-sub-text { font-size: 22rpx; line-height: 1.2; }

.sc-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 8rpx;
  border: 1rpx solid #e2e8f0;
  flex-shrink: 0;
}

.sc-score-cell {
  position: relative;
  padding: 8rpx 4rpx 10rpx;
  box-sizing: border-box;
}

.sc-score-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  width: 100%;
  padding-top: 4rpx;
  box-sizing: border-box;
  position: relative;
  overflow: visible;
}

/** 斗地主「地」/ 打老虎「虎」角标：格口左上角，与杆数圆错开（「地」略宽，留白略增） */
.sc-score-stack--with-badge {
  padding-top: 10rpx;
  padding-left: 6rpx;
  align-items: flex-start;
}

.sc-score-stack--with-badge .scorecard-score-cell-inner {
  align-self: center;
  margin-top: 8rpx;
}

.sc-score-stack--with-badge .sc-profit-text {
  align-self: center;
}

/** 虎+地同时使用：左右留出角标区 */
.sc-score-stack--two-badges {
  padding-right: 6rpx;
}

.sc-summary-val {
  line-height: 1.25;
}

.sc-profit-text {
  font-size: 22rpx;
  line-height: 1;
  margin-top: 2rpx;
}

.sc-role-badge {
  position: absolute;
  top: 2rpx;
  min-width: 28rpx;
  height: 26rpx;
  padding: 0 5rpx;
  box-sizing: border-box;
  border-radius: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  pointer-events: none;
}
.sc-role-badge--tiger {
  left: 4rpx;
  background-color: #ea580c;
}
.sc-role-badge--landlord {
  right: 4rpx;
  background-color: #dc2626;
}
.sc-role-badge-text {
  font-size: 15rpx;
  font-weight: 900;
  color: #fff;
  line-height: 1;
  white-space: nowrap;
}

/* PK 得分弹窗表格 */
.sc-pk-cell-label {
  width: 128rpx;
  min-width: 128rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16rpx 8rpx;
  box-sizing: border-box;
}
.sc-pk-cell {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16rpx 8rpx;
  box-sizing: border-box;
}
/* 头像列：须覆盖 .sc-pk-cell 的垂直居中，避免 scroll-view 内头像顶边被裁 */
.sc-pk-cell.sc-pk-cell--avatar {
  align-items: flex-start !important;
  justify-content: center !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
.sc-pk-avatar {
  width: 100% !important;
  height: 100% !important;
  display: block !important;
}
.sc-pk-label-text {
  font-size: 26rpx;
  line-height: 1.35;
}
.sc-pk-nick-text {
  font-size: 24rpx;
  line-height: 1.3;
  margin-top: 10rpx;
}
.sc-pk-total-text {
  font-size: 34rpx;
  line-height: 1.2;
}
.sc-pk-hole-num {
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.25;
}
.sc-pk-score-text {
  font-size: 30rpx;
  line-height: 1.25;
  font-weight: 600;
}
.sc-pk-score-zero {
  color: #cbd5e1 !important;
  font-weight: 500;
}
.sc-tiny-text {
  font-size: 20rpx;
  line-height: 1.2;
}

.scorecard-landmine-wrap {
  position: absolute;
  top: 12rpx;
  right: 12rpx;
  width: 32rpx;
  height: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
}

.scorecard-stepper-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.scorecard-stepper-btn {
  margin-right: 8rpx;
}

.scorecard-stepper-row > button:last-child {
  margin-right: 0;
}

.scorecard-config-bomb-sm {
  margin-bottom: 4rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scorecard-config-bomb-lg {
  margin-bottom: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scorecard-uni-ico-slot {
  width: 48rpx;
  height: 48rpx;
  min-width: 48rpx;
  min-height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background-color: transparent;
  box-sizing: border-box;
}

.scorecard-uni-ico-slot--sm {
  width: 40rpx;
  height: 40rpx;
  min-width: 40rpx;
  min-height: 40rpx;
}

.scorecard-uni-ico-slot--xs {
  width: 32rpx;
  height: 32rpx;
  min-width: 32rpx;
  min-height: 32rpx;
}

.scorecard-pending-avatar-slot {
  width: 64rpx;
  height: 64rpx;
  min-width: 64rpx;
  min-height: 64rpx;
  box-sizing: border-box;
  flex-shrink: 0;
}

.scorecard-score-step-btn {
  width: 112rpx;
  height: 112rpx;
  min-width: 112rpx;
  min-height: 112rpx;
  box-sizing: border-box;
  flex-shrink: 0;
}

.scorecard-hole-num {
  width: 40rpx;
  height: 40rpx;
  min-width: 40rpx;
  min-height: 40rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
}

.scorecard-score-cell-inner {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44rpx;
  min-height: 44rpx;
  padding: 0 10rpx;
  box-sizing: border-box;
  flex-shrink: 0;
}

.scorecard-score-value {
  font-size: 26rpx;
  line-height: 1;
  font-weight: 700;
}

/* 杆差符号：负杆差红实心圆白字；帕无框；+1 橙单方框；+2+ 橙双方框 */
.sc-mark-empty {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.sc-mark-empty .scorecard-score-value {
  color: #94a3b8 !important;
}

.sc-mark {
  position: relative;
  background: transparent !important;
  box-sizing: border-box;
}
.sc-mark .scorecard-score-value {
  position: relative;
  z-index: 1;
  color: #0f172a !important;
}

.sc-mark-par {
  border: none !important;
  box-shadow: none !important;
}
.sc-mark-par .scorecard-score-value {
  color: #0f172a !important;
  font-weight: 700 !important;
}

/* 低于标准杆：红实心圆 + 白字 */
.sc-under-par-fill {
  width: 48rpx;
  height: 48rpx;
  min-width: 48rpx;
  min-height: 48rpx;
  border-radius: 999rpx;
  background: #dc2626;
  box-sizing: border-box;
  flex-shrink: 0;
}
.sc-under-par-fill-text {
  color: #ffffff !important;
  font-weight: 800 !important;
}

/* +2+：嵌套双方框 */
.sc-dbl-sq-outer {
  width: 56rpx;
  height: 56rpx;
  border: 2rpx solid #ea580c;
  box-sizing: border-box;
  flex-shrink: 0;
  background: transparent;
}
.sc-dbl-sq-inner {
  width: 42rpx;
  height: 42rpx;
  border: 2rpx solid #ea580c;
  box-sizing: border-box;
  flex-shrink: 0;
}
.sc-dbl-sq-inner .scorecard-score-value {
  color: #0f172a !important;
}

.sc-scorecell-mark-root {
  overflow: visible;
}

/* 兼容：历史 class，当前负杆差由 .sc-under-par-fill 渲染 */
.sc-mark-birdie {
  border-radius: 999rpx;
  border: 2rpx solid #dc2626 !important;
  padding: 0 !important;
  min-width: 44rpx !important;
  min-height: 44rpx !important;
  width: 44rpx !important;
  height: 44rpx !important;
}

/* +1：单方框 */
.sc-mark-bogey {
  border-radius: 0 !important;
  border: 2rpx solid #ea580c !important;
  padding: 0 !important;
  width: 44rpx !important;
  height: 44rpx !important;
  min-width: 44rpx !important;
  min-height: 44rpx !important;
  max-width: 44rpx !important;
  max-height: 44rpx !important;
  aspect-ratio: 1;
}

.scorecard-bottom-bar {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(241, 245, 249, 0.98) 55%, #f8fafc 100%);
  border-top: 1rpx solid rgba(148, 163, 184, 0.3);
  box-shadow: 0 -6rpx 20rpx rgba(0, 0, 0, 0.05);
  border-radius: 28rpx 28rpx 0 0;
  padding: 28rpx 12rpx 0;
  padding-bottom: calc(28rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(28rpx + env(safe-area-inset-bottom));
  flex-shrink: 0;
  box-sizing: border-box;
}

.scorecard-bottom-label {
  font-size: 22rpx;
  font-weight: 600;
  color: #334155;
  letter-spacing: 0.02em;
}

.scorecard-bottom-item {
  background: transparent !important;
  line-height: normal;
}

.scorecard-bottom-item::after {
  display: none !important;
  border: none !important;
}

.scorecard-bottom-circle {
  width: 88rpx;
  height: 88rpx;
  min-width: 88rpx;
  min-height: 88rpx;
  max-width: 88rpx;
  max-height: 88rpx;
  border-radius: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex-shrink: 0;
  overflow: hidden;
  border: 1rpx solid rgba(148, 163, 184, 0.22);
  box-shadow:
    0 4rpx 12rpx rgba(0, 0, 0, 0.25),
    inset 0 1rpx 0 rgba(255, 255, 255, 0.06);
}

.scorecard-bottom-circle--add {
  background: linear-gradient(155deg, #e0f2fe 0%, #f8fafc 100%);
  border-color: rgba(56, 189, 248, 0.45);
}

.scorecard-bottom-circle--pk {
  background: linear-gradient(155deg, #fee2e2 0%, #fff1f2 100%);
  border-color: rgba(248, 113, 113, 0.45);
}

.scorecard-bottom-circle--score {
  background: linear-gradient(155deg, #fef3c7 0%, #fffbeb 100%);
  border-color: rgba(250, 204, 21, 0.45);
}

.scorecard-bottom-circle--gear {
  background: linear-gradient(155deg, #e2e8f0 0%, #f8fafc 100%);
  border-color: rgba(148, 163, 184, 0.35);
}

.scorecard-bottom-icon-slot {
  width: 48rpx;
  height: 48rpx;
  min-width: 48rpx;
  min-height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent !important;
  flex-shrink: 0;
  box-sizing: border-box;
}
</style>
