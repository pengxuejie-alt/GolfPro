/**
 * utils/match_manager.js
 * 比赛管理核心逻辑
 */

import { db } from './db';
import { shouldAutoEndByKickoffTtl } from './matchKickoff';

/** 本会话已对某场次做过「开赛 48h 自动结束」写回；避免刷新/删局时反复 MatchManager.updateMatch 刷屏与打库 */
const kickoffTtlPersistedMids = new Set();

const MATCH_LIST_KEY = 'golf_match_list';
const MATCHES_QUICK_KEY = 'matches';

/** 云库/JSON 可能把 match_id 存成数字，与本地字符串严格相等失败时会插入重复条目 */
function normalizeMid(m) {
  if (m == null || m === '') return '';
  return String(m).trim();
}

function dedupeMatchListById(matchList) {
  const list = Array.isArray(matchList) ? matchList : [];
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const id = normalizeMid(m?.match_id ?? m?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(m?.match_id != null && String(m.match_id) !== id ? { ...m, match_id: id } : m);
  }
  return out;
}

async function persistMatchList(matchList) {
  const list = dedupeMatchListById(matchList);
  await db.setItem(MATCH_LIST_KEY, list);
  try {
    uni.setStorageSync(MATCHES_QUICK_KEY, list);
  } catch {
    /* ignore */
  }
}

/**
 * 云上 matches 常不写 pk_rules：全量 upsert 时不要冲掉本机已保存的玩法，否则计分卡「8421」等列永远为 0。
 */
function preservePkRulesFromPrevMatch(prev, incoming) {
  if (!incoming || typeof incoming !== 'object') return incoming;
  const prevPk = prev?.pk_rules ?? prev?.pk_results;
  const incPk = incoming.pk_rules ?? incoming.pk_results;
  const hasInc = Array.isArray(incPk) && incPk.length > 0;
  if (hasInc) return incoming;
  const hasPrev = Array.isArray(prevPk) && prevPk.length > 0;
  if (!hasPrev) return incoming;
  const prevTs = Number(prev?.pk_rules_sync_ts || 0);
  const incTs = Number(incoming.pk_rules_sync_ts || 0);
  return {
    ...incoming,
    pk_rules: prevPk,
    pk_results: prevPk,
    pk_rules_sync_ts: Math.max(prevTs, incTs),
  };
}

function callLeaveMatchCloud(matchId) {
  return new Promise((resolve) => {
    try {
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'leaveMatch',
        data: { match_id: matchId },
        success: (r) => resolve(r?.result ?? null),
        fail: () => resolve(null),
      });
    } catch {
      resolve(null);
    }
  });
}

function callDeleteMyMatchCloud(matchId) {
  return new Promise((resolve) => {
    try {
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'deleteMyMatch',
        data: { match_id: matchId },
        success: (r) => resolve(r?.result ?? null),
        fail: () => resolve(null),
      });
    } catch {
      resolve(null);
    }
  });
}

export const MatchManager = {
  /**
   * 创建新比赛
   */
  createMatch: async function(title, baseScore = 1) {
    const ts = Date.now();
    const newMatch = {
      match_id: `m_${ts}_${Math.random().toString(36).slice(2, 8)}`,
      title: title || '新比赛',
      base_score: baseScore,
      status: 1,
      user_list: [],
      pk_rules: [],
      hole_scores: Array.from({ length: 18 }, () => ({
        scores: [],
        par: 4,
      })),
      create_time: new Date().toISOString(),
      /** 与云端合并：.pk_rules 与比赛信息 最后写入时间戳（ms） */
      pk_rules_sync_ts: ts,
      match_meta_sync_ts: ts,
    };

    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    matchList.unshift(newMatch);
    await persistMatchList(matchList);
    return newMatch;
  },

  /**
   * 获取所有比赛（与首页一致：云端 listMyMatches 合并宿主+参与者，再与本机缓存 merge，避免「我的」页只读到旧 Storage）
   */
  getMatchList: async function() {
    const list = await db.getMatches();
    const arr = dedupeMatchListById(Array.isArray(list) ? list : []);
    await applyKickoffTtlToList(arr);
    return arr;
  },

  /**
   * 获取单个比赛
   */
  getMatch: async function(matchId) {
    const want = normalizeMid(matchId);
    if (!want) return undefined;
    const matchList = await this.getMatchList();
    return matchList.find((m) => normalizeMid(m?.match_id ?? m?.id) === want);
  },

  /** 是否房主：优先 matches 文档 _openid；否则名单首位 uid 与本人一致 */
  isUserHostOfMatch(match, openId) {
    const oid = openId != null ? String(openId).trim() : '';
    if (!oid || !match || typeof match !== 'object') return false;
    const docOpen = match._openid;
    if (docOpen != null && String(docOpen) === oid) return true;
    const roster = match.user_list || match.players;
    if (!Array.isArray(roster) || roster.length === 0) return false;
    const first = roster[0];
    if (!first || typeof first !== 'object') return false;
    const hid = first.uid ?? first.id ?? first.openId ?? first.openid;
    return hid != null && String(hid) === oid;
  },

  /**
   * 房主：云函数删除 matches 及关联 scores，再清本机列表（并取消「隐藏」记录）
   */
  deleteHostedMatch: async function (matchId) {
    const want = normalizeMid(matchId);
    if (!want) return { ok: false, error: 'bad_id' };
    const res = await callDeleteMyMatchCloud(want);
    if (res == null) return { ok: false, error: 'no_cloud' };
    if (res.success === true) {
      db.revealMatchForMyList(want);
      let matchList = await db.getItem(MATCH_LIST_KEY) || [];
      matchList = matchList.filter((m) => normalizeMid(m?.match_id ?? m?.id) !== want);
      await persistMatchList(matchList);
      return { ok: true };
    }
    return { ok: false, error: res.error || 'cloud_failed' };
  },

  /**
   * 参与者：云函数 leaveMatch（不从云端删整场）+ 从本机列表隐藏
   */
  leaveParticipantMatch: async function (matchId) {
    const want = normalizeMid(matchId);
    if (!want) return { ok: false, error: 'bad_id' };
    const res = await callLeaveMatchCloud(want);
    const err = res?.error || '';
    const cloudOk = res?.success === true || err === 'not_in_roster' || err === 'not_found';
    if (!cloudOk) {
      if (res == null) {
        await this.removeMatchFromLocalList(want);
        return { ok: true, localOnly: true };
      }
      return { ok: false, error: err || 'leave_failed' };
    }
    await this.removeMatchFromLocalList(want);
    return { ok: true };
  },

  /**
   * 从本机比赛列表移除（不退云、不删文档；用于退赛后在当前用户首页消失）
   */
  removeMatchFromLocalList: async function (matchId) {
    const want = normalizeMid(matchId);
    if (!want) return;
    db.concealMatchFromMyList(want);
    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    matchList = matchList.filter((m) => normalizeMid(m?.match_id ?? m?.id) !== want);
    await persistMatchList(matchList);
  },

  /**
   * 本地比赛列表 upsert（受邀从云端拉回、不经过创建页时使用）
   */
  upsertLocalMatch: async function(matchData) {
    const mid = normalizeMid(matchData?.match_id ?? matchData?.id);
    if (!matchData || !mid) return;
    db.revealMatchForMyList(mid);
    const normalized = matchData.match_id != null && String(matchData.match_id) === mid ? matchData : { ...matchData, match_id: mid };
    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    const idx = matchList.findIndex((m) => normalizeMid(m?.match_id ?? m?.id) === mid);
    const merged =
      idx !== -1 ? preservePkRulesFromPrevMatch(matchList[idx], normalized) : normalized;
    if (idx !== -1) matchList[idx] = merged;
    else matchList.unshift(merged);
    await persistMatchList(matchList);
  },

  updateMatch: async function(matchData, opts = {}) {
    const skipReveal = !!(opts && opts.skipReveal === true);
    const skipCloudSave = !!(opts && opts.skipCloudSave === true);
    const mid = normalizeMid(matchData?.match_id ?? matchData?.id);
    if (!mid) {
      console.warn('[MatchManager.updateMatch] missing match_id');
      return;
    }
    const normalized = matchData.match_id != null && String(matchData.match_id) === mid ? matchData : { ...matchData, match_id: mid };
    /** TTL 等非用户打开球局场景的写入不应 reveal，否则已从列表隐藏的场次会被拉回 */
    if (!skipReveal) {
      db.revealMatchForMyList(mid);
    }
    /** 用户已退赛隐藏：仍可把状态同步到云，但不要写回本机列表（避免条目复活） */
    if (skipReveal && db.isMatchHiddenForMyList(mid)) {
      if (!skipCloudSave) {
        try {
          await db.saveMatch(normalized);
        } catch (e) {
          console.warn('[MatchManager.updateMatch] skipReveal hidden saveMatch', e);
        }
      }
      return;
    }
    try {
      const ul = normalized.user_list || normalized.players || [];
      const hs = normalized.hole_scores || normalized.scores || [];
      console.info('[MatchManager.updateMatch]', mid, {
        userOrPlayers: Array.isArray(ul) ? ul.length : 0,
        holes: Array.isArray(hs) ? hs.length : 0,
        firstHoleScoreSlots: hs[0]?.scores?.length,
        firstPlayerKeys: ul[0] ? Object.keys(ul[0]) : [],
      });
    } catch (e) {
      console.warn('[MatchManager.updateMatch] diag', e);
    }
    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    const index = matchList.findIndex((m) => normalizeMid(m?.match_id ?? m?.id) === mid);
    if (index !== -1) {
      matchList[index] = normalized;
    } else {
      matchList.unshift(normalized);
    }
    await persistMatchList(matchList);
    if (skipCloudSave) return;
    try {
      await db.saveMatch(normalized);
    } catch (e) {
      console.warn('[MatchManager.updateMatch] db.saveMatch', e);
    }
  },
};

/**
 * 开赛起 48h 自动结束（进行中/已开分待开始）：写回本地与云端。
 */
async function applyKickoffTtlToList(list) {
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!shouldAutoEndByKickoffTtl(row)) continue;
    const mid = normalizeMid(row?.match_id ?? row?.id);
    if (!mid) continue;
    if (kickoffTtlPersistedMids.has(mid)) {
      if (row.status !== 2) list[i] = { ...row, status: 2 };
      continue;
    }
    const next = { ...row, status: 2 };
    try {
      await MatchManager.updateMatch(next, { skipReveal: true });
      kickoffTtlPersistedMids.add(mid);
      list[i] = next;
    } catch (e) {
      console.warn('[match_manager] kickoff TTL write', mid, e);
    }
  }
}
