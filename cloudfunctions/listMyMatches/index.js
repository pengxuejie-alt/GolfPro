const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { enrichMatchRosterAvatars } = require('./rosterAvatarEnrich');

const DEFAULT_LIMIT = 100;
/** 参与者侧 elemMatch + or 无法用 orderBy 稳定索引时尽量多捞，再在内存去重裁剪 */
const ROSTER_FETCH_MAX = 200;

function primitiveToMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return null;
  }
  if (typeof v === 'object' && v !== null && '_seconds' in v) {
    const sec = Number(v._seconds);
    return Number.isFinite(sec) ? sec * 1000 : null;
  }
  return null;
}

/** 合并去重排序：优先开球时间，与客户端 matchKickoff 一致；不回退到仅用 updated_at */
function parseTimeMs(doc) {
  if (doc == null || typeof doc !== 'object') return 0;
  for (const key of ['create_time', 'date', 'created_at', 'createdAt']) {
    const ms = primitiveToMs(doc[key]);
    if (ms != null && Number.isFinite(ms)) return ms;
  }
  const u = doc.updated_at;
  if (typeof u === 'number' && Number.isFinite(u)) return u;
  if (typeof u === 'string') {
    const d = Date.parse(u);
    return Number.isNaN(d) ? 0 : d;
  }
  if (typeof u === 'object' && '_seconds' in u) {
    const s = Number(u._seconds);
    return Number.isFinite(s) ? s * 1000 : 0;
  }
  return 0;
}

function strokeCountInHoleList(arr) {
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (const h of arr) {
    if (!h || typeof h !== 'object') continue;
    const scores = h.scores;
    if (!Array.isArray(scores)) continue;
    for (const s of scores) {
      if (Number(s) > 0) n++;
    }
  }
  return n;
}

/** listMyMatches / getMatch 一致：scores 与 hole_scores 二选一铺满，避免卡片有分、详情空 */
function normalizeMatchHoleScoresForClient(row) {
  if (!row || typeof row !== 'object') return;
  const hs = row.hole_scores;
  const sc = row.scores;
  const nHs = strokeCountInHoleList(hs);
  const nSc = strokeCountInHoleList(sc);
  if (nSc > nHs) {
    row.hole_scores = sc;
    return;
  }
  const hsLen = Array.isArray(hs) ? hs.length : 0;
  if (hsLen === 0 && Array.isArray(sc) && sc.length > 0) {
    row.hole_scores = sc;
  }
}

/** 列出比赛返回值与 getMatch 字段对齐（脱敏 _openid、补 hole_scores） */
function mapDocToClient(doc) {
  if (!doc) return null;
  const row = { ...doc };
  if (row.match_id == null && row._id) row.match_id = String(row._id);
  if (row.match_id != null) row.match_id = String(row.match_id).trim();
  if (row.user_list == null && row.players != null) row.user_list = row.players;
  if (
    Array.isArray(row.players) &&
    Array.isArray(row.user_list) &&
    row.players.length !== row.user_list.length
  ) {
    row.user_list = row.players;
  }
  if (row.hole_scores == null && row.scores != null) row.hole_scores = row.scores;
  if (row.pk_rules == null && row.pk_results != null) row.pk_rules = row.pk_results;
  if (row.course_name == null && row.courseName != null) row.course_name = row.courseName;
  if (row.create_time == null && row.created_at != null) row.create_time = row.created_at;
  if (row.create_time == null && row.date != null && String(row.date).trim()) {
    row.create_time = row.date;
  }
  normalizeMatchHoleScoresForClient(row);
  delete row._openid;
  return row;
}

function dedupeByMidDescending(docs, cap) {
  const byMid = new Map();
  for (const d of docs || []) {
    if (!d || typeof d !== 'object') continue;
    const mid =
      d.match_id != null
        ? String(d.match_id).trim()
        : d._id != null
          ? String(d._id).trim()
          : '';
    if (!mid) continue;
    const prev = byMid.get(mid);
    if (!prev || parseTimeMs(d) >= parseTimeMs(prev)) byMid.set(mid, d);
  }
  const sorted = [...byMid.values()].sort((a, b) => parseTimeMs(b) - parseTimeMs(a));
  return cap > 0 && sorted.length > cap ? sorted.slice(0, cap) : sorted;
}

exports.main = async (event) => {
  const openId = cloud.getWXContext().OPENID;
  if (!openId) return { success: false, matches: [], error: 'no OPENID' };

  let limit = Number(event && event.limit);
  if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
  limit = Math.min(Math.max(Math.floor(limit), 1), 200);

  /** 参与的局在云库无法用简单 orderBy 覆盖 or 全集，多取若干条再在内存合并去重 */
  const rosterFetchCap = Math.min(ROSTER_FETCH_MAX, Math.max(limit * 5, Math.min(limit, 80)));

  const safeGet = async (label, run) => {
    try {
      return await run();
    } catch (e) {
      console.warn('[listMyMatches]', label, e.message || String(e));
      return { data: [] };
    }
  };

  const hostSnap = await safeGet('asHost', () =>
    db
      .collection('matches')
      .where({ _openid: openId })
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .get(),
  );

  /** 名册项可能存 uid（云函数写入）或 id / openId / openid（客户端历史数据） */
  const rosterParticipantOr = _.or([
    { players: _.elemMatch({ uid: openId }) },
    { players: _.elemMatch({ id: openId }) },
    { players: _.elemMatch({ openId: openId }) },
    { players: _.elemMatch({ openid: openId }) },
    { user_list: _.elemMatch({ uid: openId }) },
    { user_list: _.elemMatch({ id: openId }) },
    { user_list: _.elemMatch({ openId: openId }) },
    { user_list: _.elemMatch({ openid: openId }) },
  ]);

  const rosterSnap = await safeGet('asParticipant', () =>
    db.collection('matches').where(rosterParticipantOr).limit(rosterFetchCap).get(),
  );

  const mergedRaw = dedupeByMidDescending(
    [...(hostSnap.data || []), ...(rosterSnap.data || [])],
    limit,
  );
  const merged = mergedRaw.map((d) => mapDocToClient(d)).filter(Boolean);
  for (const row of merged) {
    await enrichMatchRosterAvatars(cloud, db, row);
  }

  return { success: true, matches: merged };
};
