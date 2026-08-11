/**
 * 微信云开发数据库适配 + 无 wx.cloud 时 uni 存储降级（H5 / 未开通云时不阻塞首屏）
 */

import { matchListSortTimeMs } from './matchKickoff';
import { normalizeMatchHoleScoresForClient } from './matchHoleScoresNormalize';

/** 写入/单条查询等非列表接口的超时（毫秒） */
const CLOUD_TIMEOUT_MS = 15000;
/** matches 列表最多等待云端返回的时间 */
const GET_MATCHES_CLOUD_MS = 15000;
/** matches 列表单次从云端拉取的条数上限（仅查询「我创建的」文档时；见下 merge 说明） */
const MATCHES_LIST_LIMIT = 100;
/** 与缓存合并后写入本机、返回给首页的最大条数，避免 Storage 无限膨胀 */
const MATCHES_LIST_MERGE_CAP = 200;
const MATCH_LIST_KEY = 'golf_match_list';
/** 与指令一致：列表快照缓存键，便于超时秒开 */
const MATCHES_QUICK_CACHE_KEY = 'matches';
/** 用户在列表中删除/退赛的 match_id（云端仍存在时合并仍会拉回，需在合并后剔除） */
const MATCH_LIST_HIDDEN_MIDS_KEY = 'match_list_hidden_mids';

/**
 * 云环境 ID（Vite define 注入，见 vite.config）。
 * - 请勿在本地/开发打包与正式包共用同一个生产环境 ID，否则同一微信账号的真机开发与线上会读写同一套 matches 集合，表现为「开发球局冲掉正式数据」。
 * - 做法：在云开发控制台另建「测试环境」，本机建 .env.development 写 VITE_WX_CLOUD_ENV_ID=测试环境ID；提审/发版用 .env.production 写正式环境 ID。
 */
const _ENV_CLOUD = typeof process !== 'undefined' && process.env && process.env.VITE_WX_CLOUD_ENV_ID;
const CLOUD_ENV_ID =
  typeof _ENV_CLOUD === 'string' && _ENV_CLOUD.trim() ? _ENV_CLOUD.trim() : 'cloud1-d8g0wzexa9311e1d5';

/** 开发者工具/vConsole 首帧常闪现 `Error: timeout`（堆栈 WAServiceMainContext），多为 init 与用户追踪竞态；开发包关 traceUser 可略减刷屏 */
function cloudInitTraceUser() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * 云 init：在 App onLaunch 调用 db.init() 注册；此处 ensure 只保证已调用且微任务后可用。
 * 微信部分基础库里 success/fail 长期不回调，若死等会卡 20s；底层仍会异步连环境。
 * 若控制台出现裸 `Error: timeout`（无业务前缀、栈在 WAServiceMainContext）：属微信工具或基础库内部定时器，
 * 与业务 `withCloudTimeout`（会带「[云数据库] …超时」前缀）无关，一般不影响真机连云。
 */
let cloudInitPromise = null;
let cloudInitCalled = false;

/** 微信部分基础库无 queueMicrotask；仅用 Promise 微任务，避免 ReferenceError */
function deferMicrotask(fn) {
  Promise.resolve().then(fn).catch(() => {
    try {
      if (typeof setTimeout === 'function') setTimeout(fn, 0);
    } catch {
      /* ignore */
    }
  });
}

function ensureCloudInitDeferred() {
  if (cloudInitPromise != null) return cloudInitPromise;
  cloudInitPromise = new Promise((resolve) => {
    // #ifdef MP-WEIXIN
    const finish = () => deferMicrotask(() => resolve());

    function callCloudInit() {
      try {
        if (hasWxCloud() && !cloudInitCalled) {
          cloudInitCalled = true;
          const trace = cloudInitTraceUser();
          console.info('[db.init] wx.cloud.init', CLOUD_ENV_ID, trace ? '(traceUser)' : '(traceUser off DEV)');
          wx.cloud.init({
            env: CLOUD_ENV_ID,
            traceUser: trace,
            success: () => {
              console.info('[db.init] wx.cloud.init ok', CLOUD_ENV_ID);
            },
            fail: (err) => {
              console.warn('[db.init] wx.cloud.init fail', err);
            },
          });
        }
      } catch (e) {
        console.warn('[db.init] 异常', e);
      }
      finish();
    }

    /** 延后到本轮 onLaunch/macrotask 之后，减轻与宿主注入 cloud SDK 竞态引发的内部 timeout 日志（仍可能比 success 先打） */
    const runDeferred = () => {
      try {
        if (typeof setTimeout !== 'undefined') setTimeout(callCloudInit, 0);
        else callCloudInit();
      } catch {
        callCloudInit();
      }
    };
    runDeferred();
    // #endif
    // #ifndef MP-WEIXIN
    resolve();
    // #endif
  });
  return cloudInitPromise;
}

function hasWxCloud() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.init === 'function';
}

function getWxDatabase() {
  try {
    if (hasWxCloud() && typeof wx.cloud.database === 'function') {
      return wx.cloud.database();
    }
  } catch {
    /* ignore */
  }
  return null;
}

function withCloudTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[云数据库] ${label} 超时 ${CLOUD_TIMEOUT_MS}ms`)), CLOUD_TIMEOUT_MS)
    ),
  ]);
}

/** 云函数聚合：我创建的 + user_list/players 含本人 uid（参与者）；未部署云函数或未登录时返回 null → 再走直连客户端查询 */
function callListMyMatchesCloud(limit) {
  return new Promise((resolve) => {
    try {
      if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'listMyMatches',
        data: { limit },
        success: (res) => {
          const r = res?.result;
          /** 仅有 success:false 或未部署时才降级直连；success:true 时 matches 省略视为 []，避免误判为失败 */
          if (!r || r.success !== true) {
            resolve(null);
            return;
          }
          resolve(Array.isArray(r.matches) ? r.matches : []);
        },
        fail: (err) => {
          console.warn('[db] listMyMatches fail', err);
          resolve(null);
        },
      });
    } catch (e) {
      console.warn('[db] listMyMatches', e);
      resolve(null);
    }
  });
}

/** 优先云函数列出「宿主 + 参与者」球局，失败则降级为仅限 _openid 的直连查询 */
async function fetchMatchesListFromCloud(wxdb) {
  const viaFn = await callListMyMatchesCloud(MATCHES_LIST_LIMIT);
  if (viaFn !== null) {
    console.info('[db] listMyMatches', viaFn.length, '条（含参与者）');
    return { data: viaFn, listFnOk: true };
  }
  console.info('[db] 直连 matches _openid+updated_at (limit', MATCHES_LIST_LIMIT, ')');
  const direct = await wxdb
    .collection('matches')
    .where({ _openid: '{openid}' })
    .orderBy('updated_at', 'desc')
    .limit(MATCHES_LIST_LIMIT)
    .get();
  return { ...direct, listFnOk: false };
}

function readStoredOpenId() {
  try {
    const oid = uni.getStorageSync('golfpro_openid');
    return oid != null ? String(oid).trim() : '';
  } catch {
    return '';
  }
}

/** 本机独有、尚未上云的局：保留在 listMyMatches 成功但云端无该 match_id 时的合并结果 */
function isLikelyLocalHostDraft(row, openId) {
  if (!row || typeof row !== 'object') return false;
  const oid = openId != null ? String(openId).trim() : readStoredOpenId();
  if (!oid) return false;
  const docOpen = row._openid;
  if (docOpen != null && String(docOpen) === oid) return true;
  const roster = row.user_list || row.players;
  if (!Array.isArray(roster) || roster.length === 0) return true;
  const first = roster[0];
  if (!first || typeof first !== 'object') return false;
  const hid = first.uid ?? first.id ?? first.openId ?? first.openid;
  return hid != null && String(hid) === oid;
}

function normalizeMidList(row) {
  if (row == null || typeof row !== 'object') return '';
  const raw = row.match_id != null ? row.match_id : row.id;
  return raw != null ? String(raw).trim() : '';
}

/** 先去重再将「云端」与「本机缓存」合并：同 match_id 以云端条目为准（先写 cloud Map） */
function dedupeMatchesByMid(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const id = normalizeMidList(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

function mergeMatchesCloudWithLocalCache(cloudRows, cacheRows, opts = {}) {
  const cloudAuthoritative = opts.cloudAuthoritative === true;
  const openId = opts.openId != null ? String(opts.openId).trim() : readStoredOpenId();
  const cloud = dedupeMatchesByMid(cloudRows);
  const cache = dedupeMatchesByMid(cacheRows);
  const byId = new Map();
  for (const r of cloud) {
    const id = normalizeMidList(r);
    if (id) byId.set(id, r);
  }
  for (const r of cache) {
    const id = normalizeMidList(r);
    if (!id || byId.has(id)) continue;
    if (cloudAuthoritative && !isLikelyLocalHostDraft(r, openId)) continue;
    const copy = { ...r };
    normalizeMatchHoleScoresForClient(copy);
    byId.set(id, copy);
  }
  const merged = [...byId.values()].sort((a, b) => matchListSortTimeMs(b) - matchListSortTimeMs(a));
  if (merged.length <= MATCHES_LIST_MERGE_CAP) return merged;
  return merged.slice(0, MATCHES_LIST_MERGE_CAP);
}

const MAX_HIDDEN_MATCH_MIDS = 500;

function readHiddenMatchMidsSet() {
  try {
    const raw = uni.getStorageSync(MATCH_LIST_HIDDEN_MIDS_KEY);
    if (!Array.isArray(raw)) return new Set();
    return new Set(
      raw
        .map((x) => String(x ?? '').trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function persistHiddenMatchMidsSet(set) {
  let arr = [...set];
  if (arr.length > MAX_HIDDEN_MATCH_MIDS) {
    arr = arr.slice(arr.length - MAX_HIDDEN_MATCH_MIDS);
  }
  try {
    uni.setStorageSync(MATCH_LIST_HIDDEN_MIDS_KEY, arr);
  } catch {
    /* ignore */
  }
}

/** 列表展示：剔除用户在本机删除/退赛但云端仍存在的球局 */
function filterExcludedFromMyMatchesList(rows) {
  const hidden = readHiddenMatchMidsSet();
  if (hidden.size === 0) return Array.isArray(rows) ? rows : [];
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => !hidden.has(normalizeMidList(r)));
}

function readLocalMatchList() {
  try {
    const raw = uni.getStorageSync(MATCH_LIST_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/** 优先读 matches，兼容历史 golf_match_list */
function readQuickMatchesCache() {
  try {
    const quick = uni.getStorageSync(MATCHES_QUICK_CACHE_KEY);
    if (Array.isArray(quick)) return quick;
  } catch {
    /* ignore */
  }
  return readLocalMatchList();
}

function persistMatchListCache(rows) {
  const list = Array.isArray(rows) ? rows : [];
  try {
    uni.setStorageSync(MATCHES_QUICK_CACHE_KEY, list);
  } catch {
    /* ignore */
  }
  try {
    uni.setStorageSync(MATCH_LIST_KEY, list);
  } catch {
    /* ignore */
  }
}

function mapCloudDocToMatchRow(doc) {
  if (!doc) return null;
  const row = { ...doc };
  if (row.match_id == null && row._id) row.match_id = String(row._id);
  if (row.match_id != null) row.match_id = String(row.match_id).trim();
  if (row.user_list == null && row.players != null) row.user_list = row.players;
  if (row.hole_scores == null && row.scores != null) row.hole_scores = row.scores;
  if (row.pk_rules == null && row.pk_results != null) row.pk_rules = row.pk_results;
  if (row.is_private == null && row.private != null) row.is_private = row.private;
  /** 云库可能 scores 有数据、hole_scores 为空数组，避免计分页读空 */
  normalizeMatchHoleScoresForClient(row);
  return row;
}

function mapMatchToCloudPayload(matchData) {
  const mid = matchData.match_id || matchData.id;
  return {
    match_id: String(mid),
    course_name: matchData.course_name,
    course_id: matchData.course_id,
    players: matchData.user_list || matchData.players,
    scores: matchData.hole_scores || matchData.scores,
    pk_results: matchData.pk_rules || matchData.pk_results,
    status: matchData.status ?? 1,
    title: matchData.title,
    is_private: !!(matchData.is_private === true || matchData.is_private === 1),
    pk_rules_sync_ts: matchData.pk_rules_sync_ts ?? 0,
    match_meta_sync_ts: matchData.match_meta_sync_ts ?? 0,
    updated_at: new Date().toISOString(),
  };
}

/** 将本地比赛对象转为 createMatch 云函数入参（云函数有管理员权限，避免客户端直连 add 产生重复副本） */
function mapMatchToCreateMatchEvent(matchData) {
  const roster = matchData.user_list || matchData.players || [];
  const players = (Array.isArray(roster) ? roster : []).map((p) => ({
    uid: p.uid || p.id || p.openId || p.openid || '',
    nickName: p.nickName || p.nickname || '',
    avatarUrl: p.avatarUrl || p.avatar || '',
    handicap: Number(p.handicap) || 0,
  }));
  const holeScores = matchData.hole_scores || matchData.scores;
  const pk = matchData.pk_rules || matchData.pk_results;
  return {
    match_id: String(matchData.match_id || matchData.id || '').trim(),
    title: matchData.title || '我的球局',
    courseName: matchData.course_name || matchData.courseName || '',
    course_id: matchData.course_id || '',
    players,
    date: matchData.create_time || matchData.date || new Date().toISOString(),
    is_private: !!(matchData.is_private === true || matchData.is_private === 1),
    hole_scores: Array.isArray(holeScores) ? holeScores : undefined,
    status: matchData.status ?? 1,
    pk_rules: Array.isArray(pk) && pk.length > 0 ? pk : undefined,
    pk_results: Array.isArray(pk) && pk.length > 0 ? pk : undefined,
  };
}

function callCreateMatchCloudFn(event) {
  return new Promise((resolve) => {
    try {
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'createMatch',
        data: event,
        success: (res) => resolve(res?.result ?? null),
        fail: (err) => {
          console.warn('[db] createMatch cloud fail', err);
          resolve({ success: false, error: String(err?.errMsg || err || '') });
        },
      });
    } catch (e) {
      console.warn('[db] callCreateMatchCloudFn', e);
      resolve({ success: false, error: String(e?.message || e) });
    }
  });
}

/** 单条查询：走 getMatch 云函数（管理员 dedupe），避免直连 limit(1) 命中重复副本 */
function callGetMatchCloud(matchId) {
  return new Promise((resolve) => {
    try {
      if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
        resolve(null);
        return;
      }
      wx.cloud.callFunction({
        name: 'getMatch',
        data: { match_id: matchId },
        success: (res) => {
          const r = res?.result;
          if (!r || r.success !== true || !r.match) {
            resolve(null);
            return;
          }
          resolve(r.match);
        },
        fail: (err) => {
          console.warn('[db] getMatch cloud fail', err);
          resolve(null);
        },
      });
    } catch (e) {
      console.warn('[db] callGetMatchCloud', e);
      resolve(null);
    }
  });
}

class DocRef {
  constructor(coll, docId) {
    this.coll = coll;
    this.docId = docId;
  }

  async get() {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) return { data: null };
    try {
      return await database.collection(this.coll).doc(this.docId).get();
    } catch (e) {
      console.warn('[db.doc.get]', this.coll, this.docId, e);
      return { data: null };
    }
  }

  async update(payload) {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) throw new Error('wx.cloud.database 不可用');
    return database.collection(this.coll).doc(this.docId).update(payload);
  }

  async set(payload) {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) throw new Error('wx.cloud.database 不可用');
    return database.collection(this.coll).doc(this.docId).set(payload);
  }

  async remove() {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) throw new Error('wx.cloud.database 不可用');
    return database.collection(this.coll).doc(this.docId).remove();
  }
}

class QueryBuilder {
  constructor(coll) {
    this.coll = coll;
    this.whereObj = {};
    this._orderField = null;
    this._orderDir = 'asc';
    this._limitVal = null;
  }

  where(cond) {
    if (cond && typeof cond === 'object') Object.assign(this.whereObj, cond);
    return this;
  }

  doc(docId) {
    return new DocRef(this.coll, docId);
  }

  orderBy(field, dir) {
    this._orderField = field;
    this._orderDir = dir === 'desc' ? 'desc' : 'asc';
    return this;
  }

  limit(n) {
    this._limitVal = n;
    return this;
  }

  async get() {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) return { data: [] };
    try {
      let q = database.collection(this.coll);
      if (Object.keys(this.whereObj).length) q = q.where(this.whereObj);
      if (this._orderField) q = q.orderBy(this._orderField, this._orderDir);
      if (this._limitVal != null) {
        q = q.limit(this._limitVal);
      } else if (this.coll === 'matches') {
        q = q.limit(MATCHES_LIST_LIMIT);
      }
      return await q.get();
    } catch (e) {
      console.warn('[db.collection.get]', this.coll, e);
      return { data: [] };
    }
  }

  async add(body) {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) throw new Error('wx.cloud.database 不可用');
    const data = body && body.data != null ? body.data : body;
    return database.collection(this.coll).add({ data });
  }

  async count() {
    await ensureCloudInitDeferred();
    const database = getWxDatabase();
    if (!database) return { total: 0 };
    try {
      let q = database.collection(this.coll);
      if (Object.keys(this.whereObj).length) q = q.where(this.whereObj);
      return await q.count();
    } catch (e) {
      console.warn('[db.collection.count]', this.coll, e);
      return { total: 0 };
    }
  }
}

export const db = {
  /**
   * 仅在微信小程序环境调用 wx.cloud.init（可重复调用，内部防抖）
   */
  init() {
    void ensureCloudInitDeferred();
  },

  /** 任意 wx.cloud.database() / 直连 wxdb 前 await，避免 init 未完成导致 timeout */
  waitForInit() {
    return ensureCloudInitDeferred();
  },

  /**
   * 云库 matches：优先调用云函数 listMyMatches，合并「我创建的」与「players/user_list 中含本人 uid 的参与局」，再与本机 Storage 按 match_id 合并；
   * 云函数未部署或失败时降级为直连 where({ _openid })（仅宿主侧文档）。
   */
  async getMatches() {
    await ensureCloudInitDeferred();
    const fallback = () => {
      const cache = readQuickMatchesCache();
      const patched = dedupeMatchesByMid(
        (Array.isArray(cache) ? cache : []).map((r) => {
          if (!r || typeof r !== 'object') return r;
          const o = { ...r };
          normalizeMatchHoleScoresForClient(o);
          return o;
        }),
      );
      return filterExcludedFromMyMatchesList(patched);
    };
    if (!hasWxCloud()) return fallback();
    const wxdb = getWxDatabase();
    if (!wxdb) return fallback();
    try {
      const cacheBeforeFetch = dedupeMatchesByMid(
        (readQuickMatchesCache() || []).map((r) => {
          if (!r || typeof r !== 'object') return r;
          const o = { ...r };
          normalizeMatchHoleScoresForClient(o);
          return o;
        }),
      );
      const res = await withCloudTimeout(fetchMatchesListFromCloud(wxdb), 'getMatches.fetchList');
      const listFnOk = res?.listFnOk === true;
      const cloudRows = (res.data || []).map(mapCloudDocToMatchRow).filter(Boolean);
      let mergedRaw;
      if (listFnOk) {
        mergedRaw = mergeMatchesCloudWithLocalCache(cloudRows, cacheBeforeFetch, { cloudAuthoritative: true });
      } else if (cloudRows.length > 0) {
        mergedRaw = mergeMatchesCloudWithLocalCache(cloudRows, cacheBeforeFetch);
      } else {
        mergedRaw = cacheBeforeFetch;
      }
      const merged = filterExcludedFromMyMatchesList(mergedRaw);
      if (listFnOk || cloudRows.length > 0) {
        persistMatchListCache(merged);
        console.info(
          '[db.getMatches] 云端',
          cloudRows.length,
          '条 + 缓存合并 →',
          merged.length,
          '条（match_id 去重）',
        );
        return merged;
      }
      return fallback();
    } catch (e) {
      console.warn('[db.getMatches] 云端失败，走本地缓存', e?.message || e);
      return fallback();
    }
  },

  /**
   * 向 matches 新增一条；无云则写入本机列表
   */
  async addMatch(data) {
    await ensureCloudInitDeferred();
    const payload = mapMatchToCloudPayload(data);
    const wxdb = getWxDatabase();
    if (!wxdb) {
      const list = readQuickMatchesCache();
      list.unshift({ ...data, ...payload });
      persistMatchListCache(list);
      return { _id: `local_${payload.match_id}`, errMsg: 'local' };
    }
    try {
      const cloudRes = await withCloudTimeout(
        callCreateMatchCloudFn(mapMatchToCreateMatchEvent(data)),
        'addMatch.createMatch',
      );
      if (cloudRes && cloudRes.success === true) {
        return { _id: cloudRes._id || payload.match_id, errMsg: 'cloud-fn' };
      }
      throw new Error(cloudRes?.error || 'createMatch failed');
    } catch (e) {
      console.warn('[db.addMatch] 云新增失败，写入本机', e?.message || e);
      const list = readQuickMatchesCache();
      list.unshift({ ...data, ...payload });
      persistMatchListCache(list);
      return { _id: `local_${payload.match_id}`, errMsg: String(e?.message || e) };
    }
  },

  /** 是否在本机标记为隐藏（退赛等）；与其它读缓存分支共用 */
  isMatchHiddenForMyList(matchId) {
    const mid = String(matchId ?? '').trim();
    if (!mid) return false;
    return readHiddenMatchMidsSet().has(mid);
  },

  /** 与本机「退赛隐藏」一致：非 getMatches 入口读缓存时请过滤，避免出现已退场场次 */
  filterHiddenFromMatchRows(rows) {
    return filterExcludedFromMyMatchesList(rows);
  },

  /** 从「我的球局」列表隐藏（删除/退赛）；云端记录仍保留，合并拉取时不再展示 */
  concealMatchFromMyList(matchId) {
    const mid = String(matchId ?? '').trim();
    if (!mid) return;
    const s = readHiddenMatchMidsSet();
    s.add(mid);
    persistHiddenMatchMidsSet(s);
  },

  /** 再次参与/打开该球局时恢复列表展示 */
  revealMatchForMyList(matchId) {
    const mid = String(matchId ?? '').trim();
    if (!mid) return;
    const s = readHiddenMatchMidsSet();
    if (!s.has(mid)) return;
    s.delete(mid);
    persistHiddenMatchMidsSet(s);
  },

  /**
   * 从本机所有比赛相关 Storage 移除并标记隐藏，防止换云环境后缓存/云合并再次展示。
   * 覆盖 golf_match_list、matches、last_match_cache、match_list_hidden_mids。
   */
  purgeMatchFromLocalStorage(matchId) {
    const mid = String(matchId ?? '').trim();
    if (!mid) return;
    this.concealMatchFromMyList(mid);
    const withoutMid = (rows) =>
      (Array.isArray(rows) ? rows : []).filter((r) => normalizeMidList(r) !== mid);
    try {
      const quick = uni.getStorageSync(MATCHES_QUICK_CACHE_KEY);
      if (Array.isArray(quick)) {
        uni.setStorageSync(MATCHES_QUICK_CACHE_KEY, withoutMid(quick));
      }
    } catch {
      /* ignore */
    }
    try {
      const raw = uni.getStorageSync(MATCH_LIST_KEY);
      if (Array.isArray(raw)) {
        uni.setStorageSync(MATCH_LIST_KEY, withoutMid(raw));
      }
    } catch {
      /* ignore */
    }
    try {
      const last = uni.getStorageSync('last_match_cache');
      if (last && typeof last === 'object' && normalizeMidList(last) === mid) {
        uni.removeStorageSync('last_match_cache');
      }
    } catch {
      /* ignore */
    }
  },

  async getItem(key) {
    try {
      const v = uni.getStorageSync(key);
      if (v === '' || v === undefined) return null;
      return v;
    } catch (e) {
      console.warn('[db.getItem]', key, e);
      return null;
    }
  },

  async setItem(key, value) {
    try {
      uni.setStorageSync(key, value);
    } catch (e) {
      console.error('[db.setItem]', key, e);
      throw e;
    }
  },

  collection(name) {
    return new QueryBuilder(name);
  },

  async saveMatch(matchData) {
    await ensureCloudInitDeferred();
    try {
      uni.setStorageSync('last_match_cache', matchData);
    } catch (e) {
      console.error('[Storage] 本地缓存失败:', e);
    }

    const wxdb = getWxDatabase();
    if (!wxdb) {
      return { success: true, mode: 'local-cache' };
    }

    const mid = String(matchData.match_id || matchData.id || '').trim();
    if (!mid) {
      return { success: false, mode: 'local-cache', msg: 'missing match_id' };
    }

    try {
      /** 禁止客户端 coll.add：参与者权限下查不到房主文档时会新建副本，导致邀请进错局 */
      const cloudRes = await withCloudTimeout(
        callCreateMatchCloudFn(mapMatchToCreateMatchEvent(matchData)),
        'saveMatch.createMatch',
      );
      if (cloudRes && cloudRes.success === true) {
        return { success: true, mode: 'cloud-fn', upsert: cloudRes.upsert, deduped: cloudRes.deduped || 0 };
      }
      const errMsg = cloudRes?.error || 'createMatch failed';
      console.warn('[db.saveMatch] 云函数 upsert 失败', errMsg);
      return { success: true, mode: 'local-cache', msg: errMsg };
    } catch (e) {
      console.warn('[db.saveMatch] 云同步失败', e?.message || e);
      return { success: true, mode: 'local-cache', msg: e?.message || String(e) };
    }
  },

  async getMatch(id) {
    await ensureCloudInitDeferred();
    const mid = String(id ?? '').trim();
    if (!mid) return null;

    const fromCloudFn = await withCloudTimeout(callGetMatchCloud(mid), 'getMatch.cloudFn');
    if (fromCloudFn) return mapCloudDocToMatchRow(fromCloudFn);

    const wxdb = getWxDatabase();
    if (wxdb) {
      try {
        const snap = await withCloudTimeout(
          wxdb.collection('matches').where({ match_id: mid }).limit(1).get(),
          'getMatch.fallback',
        );
        if (snap.data && snap.data[0]) return mapCloudDocToMatchRow(snap.data[0]);
      } catch (e) {
        console.warn('[db.getMatch] 云端失败', e?.message || e);
      }
    }

    const localVal = uni.getStorageSync('last_match_cache');
    if (localVal && (localVal.id === mid || localVal.match_id === mid)) {
      return localVal;
    }
    return null;
  },

  async getMatchList() {
    return this.getMatches();
  },
};
