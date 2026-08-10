const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid } = require('../common/matchCanonical');

const EMPTY_18 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function playerKey(p) {
  if (!p || typeof p !== 'object') return '';
  return String(p.uid || p.id || p.openId || p.openid || '').trim();
}

/** 按洞、按人合并 scoreTs 较大者优先；无 ts 时保留已有非零杆数，避免互踢 */
function mergeScoresMatrices(existing, incoming) {
  const maxH = 18;
  const out = [];
  for (let h = 0; h < maxH; h++) {
    const eH = existing[h] || { scores: [], par: 4, scoreTs: [] };
    const iH = incoming[h] || { scores: [], par: 4, scoreTs: [] };
    const eScores = Array.isArray(eH.scores) ? [...eH.scores] : [];
    const iScores = Array.isArray(iH.scores) ? [...iH.scores] : [];
    const eTs = Array.isArray(eH.scoreTs) ? [...eH.scoreTs] : [];
    const iTs = Array.isArray(iH.scoreTs) ? [...iH.scoreTs] : [];
    const n = Math.max(eScores.length, iScores.length, 1);
    while (eScores.length < n) eScores.push(0);
    while (iScores.length < n) iScores.push(0);
    while (eTs.length < n) eTs.push(0);
    while (iTs.length < n) iTs.push(0);
    const scores = [];
    const scoreTs = [];
    for (let p = 0; p < n; p++) {
      const ev = Number(eScores[p] || 0);
      const iv = Number(iScores[p] || 0);
      const eT = Number(eTs[p] || 0);
      const iT = Number(iTs[p] || 0);
      if (iT > eT) {
        scores[p] = iv;
        scoreTs[p] = iT;
      } else if (eT > iT) {
        scores[p] = ev;
        scoreTs[p] = eT;
      } else if (iv !== ev) {
        if (iT > 0 || eT > 0) {
          scores[p] = iT >= eT ? iv : ev;
          scoreTs[p] = Math.max(iT, eT);
        } else {
          scores[p] = ev !== 0 ? ev : iv;
          scoreTs[p] = 0;
        }
      } else {
        scores[p] = ev;
        scoreTs[p] = Math.max(eT, iT);
      }
    }
    const par =
      typeof iH.par === 'number'
        ? iH.par
        : typeof eH.par === 'number'
          ? eH.par
          : 4;
    out.push({ scores, par, scoreTs });
  }
  return out;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  const {
    match_id,
    player_uid,
    player_name,
    hole_scores,
    total_score,
    holeIndex,
    playerIndex,
    score,
    editedAt,
  } = event;

  if (!match_id) {
    return { success: false, error: '缺少 match_id' };
  }

  const result = { scoresTableOk: false, matchesTableOk: false, fullScoresOk: false };

  // ───────── ⓪ 整块 matches.scores 合并（在册球手均可写，解决非房主客户端无法改 matches 文档的问题） ─────────
  if (Array.isArray(event.full_scores) && event.full_scores.length > 0 && match_id) {
    try {
      const { doc } = await findMatchDocsByMid(db, match_id, { dedupe: true });

      if (doc) {
        const players =
          Array.isArray(doc.players) && doc.players.length
            ? doc.players
            : Array.isArray(doc.user_list)
              ? doc.user_list
              : [];
        const inRoster = players.some((p) => playerKey(p) === openId);
        if (inRoster) {
          const existing = Array.isArray(doc.scores) ? doc.scores : [];
          const merged = mergeScoresMatrices(existing, event.full_scores);
          await db.collection('matches').doc(doc._id).update({
            data: { scores: merged, updated_at: db.serverDate() },
          });
          result.fullScoresOk = true;
          result.matchesTableOk = true;
        }
      }
    } catch (e) {
      console.warn('[updateScore] full_scores merge error', e);
    }
  }

  // ───────── ① upsert scores 集合 ─────────
  if (player_uid) {
    try {
      const scoreArray = Array.isArray(hole_scores) ? hole_scores : EMPTY_18.slice();
      const total = total_score != null
        ? Number(total_score)
        : scoreArray.reduce((a, b) => a + Number(b || 0), 0);

      const snap = await db
        .collection('scores')
        .where({ match_id, player_uid })
        .limit(1)
        .get();

      const payload = {
        match_id,
        player_uid,
        player_name: player_name || '',
        hole_scores: scoreArray,
        total_score: total,
        updated_at: db.serverDate(),
      };

      if (snap.data && snap.data.length > 0) {
        await db.collection('scores').doc(snap.data[0]._id).update({ data: payload });
      } else {
        payload._openid = openId;
        payload.created_at = db.serverDate();
        await db.collection('scores').add({ data: payload });
      }
      result.scoresTableOk = true;
    } catch (e) {
      console.warn('[updateScore] scores upsert error', e);
    }
  }

  // ───────── ② 同步更新 matches 集合内嵌分数 ─────────
  if (holeIndex != null && playerIndex != null && score != null) {
    try {
      const { doc } = await findMatchDocsByMid(db, match_id, { dedupe: true });

      if (doc) {
        const scores = doc.scores || [];

        if (!scores[holeIndex]) {
          scores[holeIndex] = { scores: [], par: 4 };
        }
        if (!Array.isArray(scores[holeIndex].scores)) {
          scores[holeIndex].scores = [];
        }
        while (scores[holeIndex].scores.length <= playerIndex) {
          scores[holeIndex].scores.push(0);
        }
        scores[holeIndex].scores[playerIndex] = Number(score);
        if (!Array.isArray(scores[holeIndex].scoreTs)) {
          scores[holeIndex].scoreTs = Array(scores[holeIndex].scores.length).fill(0);
        }
        while (scores[holeIndex].scoreTs.length < scores[holeIndex].scores.length) {
          scores[holeIndex].scoreTs.push(0);
        }
        const tsVal =
          editedAt != null && Number.isFinite(Number(editedAt))
            ? Number(editedAt)
            : Date.now();
        scores[holeIndex].scoreTs[playerIndex] = tsVal;

        await db.collection('matches').doc(doc._id).update({
          data: { scores, updated_at: db.serverDate() },
        });
        result.matchesTableOk = true;
      }
    } catch (e) {
      console.warn('[updateScore] matches update error', e);
    }
  }

  return { success: true, match_id, ...result };
};
