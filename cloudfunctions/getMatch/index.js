const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid, rosterLen } = require('./matchCanonical');
const { enrichMatchRosterAvatars } = require('./rosterAvatarEnrich');

function parseUpdatedAtMs(v) {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === 'object' && v !== null && '_seconds' in v) {
    const sec = Number(v._seconds);
    return Number.isFinite(sec) ? sec * 1000 : 0;
  }
  return 0;
}

function rosterIdsSig(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const roster = doc.user_list || doc.players || [];
  if (!Array.isArray(roster)) return '';
  return roster
    .map((p) =>
      p && typeof p === 'object'
        ? String(p.uid || p.id || p.openId || p.openid || p.player_uid || '').trim()
        : '',
    )
    .filter(Boolean)
    .sort()
    .join('\u001f');
}

/** 轻量 revision：供记分卡轮询比对，避免每 5s 拉整份 scores 矩阵 */
async function buildMatchRevision(dbConn, rawDoc, matchId) {
  const embed = rawDoc.scores || rawDoc.hole_scores;
  const nEmbed = strokeCountInHoleList(embed);
  let legacyScoresMs = 0;
  let legacyScoresCount = 0;
  if (nEmbed === 0) {
    try {
      const legacySnap = await dbConn
        .collection('scores')
        .where({ match_id: matchId })
        .field({ updated_at: true })
        .limit(50)
        .get();
      const rows = legacySnap.data || [];
      legacyScoresCount = rows.length;
      for (const row of rows) {
        legacyScoresMs = Math.max(legacyScoresMs, parseUpdatedAtMs(row.updated_at));
      }
    } catch (e) {
      console.warn('[getMatch] revision legacy scores', e);
    }
  }
  return {
    match_id: matchId,
    updated_at_ms: parseUpdatedAtMs(rawDoc.updated_at),
    match_meta_sync_ts: Number(rawDoc.match_meta_sync_ts || 0),
    pk_rules_sync_ts: Number(rawDoc.pk_rules_sync_ts || 0),
    roster_sig: rosterIdsSig(rawDoc),
    roster_len: rosterLen(rawDoc),
    embed_strokes: nEmbed,
    legacy_scores_ms: legacyScoresMs,
    legacy_scores_count: legacyScoresCount,
  };
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

/** 就地：hole_scores 为空但 scores 有杆数时用 scores 铺满 hole_scores（与小程序 db 对齐） */
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

function rosterUidOrder(roster) {
  if (!Array.isArray(roster)) return [];
  return roster
    .map((p) =>
      p && typeof p === 'object'
        ? String(p.uid || p.id || p.openId || p.openid || p.player_uid || '').trim()
        : '',
    )
    .filter(Boolean);
}

/** scores 集合每行 hole_scores 为「每洞实际杆数」数组；总细胞数（>0 的洞次） */
function legacyTableStrokeCells(legacyRows) {
  let n = 0;
  for (const row of legacyRows) {
    const hs = row.hole_scores;
    if (!Array.isArray(hs)) continue;
    for (const s of hs) {
      if (Number(s) > 0) n++;
    }
  }
  return n;
}

/**
 * matches 内嵌分全丢/未写入时，用 scores 表按 roster 顺序还原 18 洞矩阵（与 updateScore 写入的 hole_scores 一致）
 */
function buildScoresMatrixFromLegacyRows(existingScores, roster, legacyRows) {
  const uidOrder = rosterUidOrder(roster);
  if (uidOrder.length === 0 || !Array.isArray(legacyRows) || legacyRows.length === 0) return null;

  const byUid = new Map();
  for (const row of legacyRows) {
    const uid = String(row.player_uid || '').trim();
    if (!uid) continue;
    const hs = row.hole_scores;
    if (!Array.isArray(hs)) continue;
    byUid.set(uid, hs.map((x) => Number(x || 0)));
  }

  let anyPositive = false;
  for (const uid of uidOrder) {
    const arr = byUid.get(uid);
    if (arr && arr.some((v) => v > 0)) {
      anyPositive = true;
      break;
    }
  }
  if (!anyPositive) return null;

  const existing = Array.isArray(existingScores) ? existingScores : [];
  const out = [];
  for (let h = 0; h < 18; h++) {
    const eHole = existing[h] && typeof existing[h] === 'object' ? existing[h] : {};
    const par = typeof eHole.par === 'number' ? eHole.par : 4;
    const scores = uidOrder.map((uid) => {
      const arr = byUid.get(uid);
      if (!arr || h >= arr.length) return 0;
      const v = Number(arr[h] || 0);
      return Number.isFinite(v) ? v : 0;
    });
    const prevTs = Array.isArray(eHole.scoreTs) ? eHole.scoreTs : [];
    const scoreTs = uidOrder.map((_, i) => Number(prevTs[i] || 0));
    out.push({ scores, par, scoreTs });
  }
  return out;
}

function mapDocToClient(doc) {
  if (!doc) return null;
  const row = { ...doc };
  if (row.match_id == null && row._id) row.match_id = String(row._id);
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
  // 云端 createMatch 写入的是 created_at；客户端/UI 多用 create_time
  if (row.create_time == null && row.created_at != null) {
    row.create_time = row.created_at;
  }
  if (row.create_time == null && row.date != null && String(row.date).trim()) {
    row.create_time = row.date;
  }
  normalizeMatchHoleScoresForClient(row);
  delete row._openid;
  return row;
}

exports.main = async (event) => {
  const matchId = event?.match_id != null ? String(event.match_id).trim() : '';
  const revisionOnly = event?.revision_only === true;
  if (!matchId) {
    return { success: false, error: 'missing match_id' };
  }
  try {
    const { doc: rawDoc, duplicates } = await findMatchDocsByMid(db, matchId, { dedupe: true });
    if (!rawDoc) {
      return { success: false, error: 'not_found' };
    }
    if (duplicates.length > 0) {
      console.info('[getMatch] deduped', matchId, duplicates.length, 'copies');
    }
    if (revisionOnly) {
      const revision = await buildMatchRevision(db, rawDoc, matchId);
      return { success: true, revision };
    }
    const row = mapDocToClient(rawDoc);
    const embed = row.scores || row.hole_scores;
    const nEmbed = strokeCountInHoleList(embed);

    let legacySnap;
    try {
      legacySnap = await db.collection('scores').where({ match_id: matchId }).limit(50).get();
    } catch (e) {
      console.warn('[getMatch] scores collection', e);
      legacySnap = { data: [] };
    }
    const legacyRows = legacySnap.data || [];
    const nLegacy = legacyTableStrokeCells(legacyRows);

    /** matches 内嵌成绩为空，但 scores 表仍有按人存的洞杆数 → 回填并写回 matches，避免用户以为成绩丢了 */
    if (nEmbed === 0 && nLegacy > 0 && row) {
      const roster = row.user_list || row.players || [];
      const rebuilt = buildScoresMatrixFromLegacyRows(embed, roster, legacyRows);
      if (rebuilt && strokeCountInHoleList(rebuilt) > 0) {
        row.scores = rebuilt;
        row.hole_scores = rebuilt;
        try {
          await db
            .collection('matches')
            .doc(rawDoc._id)
            .update({ data: { scores: rebuilt, updated_at: db.serverDate() } });
        } catch (e) {
          console.warn('[getMatch] writeBack scores from legacy table', e);
        }
      }
    }

    await enrichMatchRosterAvatars(cloud, db, row);
    const revision = await buildMatchRevision(db, row, matchId);
    return { success: true, match: row, revision };
  } catch (e) {
    console.warn('[getMatch]', e);
    return { success: false, error: e.message || String(e) };
  }
};
