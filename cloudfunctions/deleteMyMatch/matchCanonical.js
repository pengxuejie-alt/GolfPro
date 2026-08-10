/**
 * 同一 match_id 在 matches 集合可能存在多条（客户端直连 add 与云函数写入竞态、参与者权限分裂等）。
 * 云函数侧统一：按 match_id 取 canonical 文档，合并后删除冗余副本。
 */

function rosterLen(doc) {
  if (!doc || typeof doc !== 'object') return 0;
  const p = doc.players;
  const u = doc.user_list;
  const pl = Array.isArray(p) ? p.length : 0;
  const ul = Array.isArray(u) ? u.length : 0;
  return Math.max(pl, ul);
}

function docTimeMs(doc) {
  if (!doc || typeof doc !== 'object') return 0;
  for (const key of ['updated_at', 'created_at', 'date', 'create_time']) {
    const v = doc[key];
    if (v == null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    if (typeof v === 'object' && v !== null && '_seconds' in v) {
      const sec = Number(v._seconds);
      if (Number.isFinite(sec)) return sec * 1000;
    }
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

/** 分数更完整、名单更长、更新时间更新的文档优先 */
function compareMatchDocPriority(a, b) {
  const sa = strokeCountInHoleList(a.scores || a.hole_scores);
  const sb = strokeCountInHoleList(b.scores || b.hole_scores);
  if (sb !== sa) return sb - sa;
  const ra = rosterLen(a);
  const rb = rosterLen(b);
  if (rb !== ra) return rb - ra;
  const ta = docTimeMs(a);
  const tb = docTimeMs(b);
  if (tb !== ta) return tb - ta;
  return String(a._id || '').localeCompare(String(b._id || ''));
}

/**
 * @param {import('wx-server-sdk').DB.Database} db
 * @param {string} matchId
 * @param {{ dedupe?: boolean }} [opts]
 * @returns {Promise<{ doc: object|null, duplicates: object[] }>}
 */
async function findMatchDocsByMid(db, matchId, opts = {}) {
  const mid = matchId != null ? String(matchId).trim() : '';
  if (!mid) return { doc: null, duplicates: [] };
  const dedupe = opts.dedupe !== false;
  let rows = [];
  try {
    const snap = await db.collection('matches').where({ match_id: mid }).limit(20).get();
    rows = snap.data || [];
  } catch (e) {
    console.warn('[matchCanonical] query', mid, e.message || String(e));
    return { doc: null, duplicates: [] };
  }
  if (rows.length === 0) return { doc: null, duplicates: [] };
  if (rows.length === 1) return { doc: rows[0], duplicates: [] };
  const sorted = [...rows].sort(compareMatchDocPriority);
  const doc = sorted[0];
  const duplicates = sorted.slice(1);
  if (dedupe && duplicates.length > 0) {
    await Promise.allSettled(
      duplicates.map((d) =>
        db
          .collection('matches')
          .doc(d._id)
          .remove()
          .catch((err) => {
            console.warn('[matchCanonical] remove dup', d._id, err.message || String(err));
          }),
      ),
    );
  }
  return { doc, duplicates };
}

function rosterHostUid(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const roster = doc.user_list || doc.players;
  if (!Array.isArray(roster) || roster.length === 0) return '';
  const first = roster[0];
  if (!first || typeof first !== 'object') return '';
  return String(first.uid ?? first.id ?? first.openId ?? first.openid ?? '').trim();
}

/** 与客户端 MatchManager.isUserHostOfMatch 一致：文档 _openid 或名单首位 */
function isOwnerOfMatchDoc(doc, openId) {
  const oid = openId != null ? String(openId).trim() : '';
  if (!oid || !doc || typeof doc !== 'object') return false;
  const docOpen = doc._openid;
  if (docOpen != null && String(docOpen).trim() === oid) return true;
  return rosterHostUid(doc) === oid;
}

module.exports = {
  findMatchDocsByMid,
  compareMatchDocPriority,
  rosterLen,
  docTimeMs,
  rosterHostUid,
  isOwnerOfMatchDoc,
};
