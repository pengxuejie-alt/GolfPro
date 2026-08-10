const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid } = require('./matchCanonical');

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

function mapDocToClient(doc) {
  if (!doc) return null;
  const row = { ...doc };
  if (row.match_id == null && row._id) row.match_id = String(row._id);
  if (row.match_id != null) row.match_id = String(row.match_id).trim();
  if (row.user_list == null && row.players != null) row.user_list = row.players;
  if (row.hole_scores == null && row.scores != null) row.hole_scores = row.scores;
  if (row.pk_rules == null && row.pk_results != null) row.pk_rules = row.pk_results;
  if (row.course_name == null && row.courseName != null) row.course_name = row.courseName;
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

function playerKey(p) {
  if (!p || typeof p !== 'object') return '';
  return String(p.uid || p.id || p.openId || p.openid || '').trim();
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  if (!openId) {
    return { success: false, error: 'no OPENID' };
  }

  const matchId = event?.match_id != null ? String(event.match_id).trim() : '';
  const nickName = event?.nickName != null ? String(event.nickName).trim() : '球友';
  const avatarUrl = event?.avatarUrl != null ? String(event.avatarUrl).trim() : '';
  const handicap = event?.handicap != null ? Number(event.handicap) : 0;

  if (!matchId) {
    return { success: false, error: 'missing match_id' };
  }

  try {
    const { doc: docRef, duplicates } = await findMatchDocsByMid(db, matchId, { dedupe: true });

    if (!docRef) {
      return { success: false, error: 'not_found' };
    }
    if (duplicates.length > 0) {
      console.info('[joinMatch] deduped', matchId, duplicates.length, 'copies');
    }
    const docId = docRef._id;
    let players = [];
    if (Array.isArray(docRef.players) && docRef.players.length > 0) {
      players = [...docRef.players];
    } else if (Array.isArray(docRef.user_list) && docRef.user_list.length > 0) {
      players = [...docRef.user_list];
    }

    if (players.some((p) => playerKey(p) === openId)) {
      const updatedSnap = await db.collection('matches').doc(docId).get();
      return {
        success: true,
        already: true,
        match: mapDocToClient(updatedSnap.data),
      };
    }

    const prevLen = players.length;

    players.push({
      uid: openId,
      nickName: nickName || '球友',
      nickname: nickName || '球友',
      avatarUrl,
      avatar: avatarUrl,
      handicap: Number.isFinite(handicap) ? handicap : 0,
    });

    const scores = Array.isArray(docRef.scores) ? JSON.parse(JSON.stringify(docRef.scores)) : [];
    while (scores.length < 18) {
      scores.push({ scores: [], par: 4 });
    }
    for (let i = 0; i < scores.length; i++) {
      const hole = scores[i] || { scores: [], par: 4 };
      const arr = Array.isArray(hole.scores) ? [...hole.scores] : [];
      let ts = Array.isArray(hole.scoreTs) ? [...hole.scoreTs] : [];
      while (arr.length > prevLen) arr.pop();
      while (arr.length < prevLen) arr.push(0);
      while (ts.length > prevLen) ts.pop();
      while (ts.length < prevLen) ts.push(0);
      arr.push(0);
      ts.push(0);
      scores[i] = {
        par: hole.par != null ? Number(hole.par) : 4,
        scores: arr,
        scoreTs: ts,
      };
    }

    await db.collection('matches').doc(docId).update({
      data: {
        players,
        user_list: players,
        scores,
        updated_at: db.serverDate(),
      },
    });

    try {
      const uSnap = await db.collection('users').where({ _openid: openId }).limit(1).get();
      if (uSnap.data && uSnap.data.length > 0) {
        await db.collection('users').doc(uSnap.data[0]._id).update({
          data: {
            nickName: nickName || '球友',
            avatarUrl,
            updated_at: db.serverDate(),
          },
        });
      }
    } catch (e) {
      console.warn('[joinMatch] users update', e);
    }

    const updatedSnap = await db.collection('matches').doc(docId).get();
    return {
      success: true,
      already: false,
      match: mapDocToClient(updatedSnap.data),
    };
  } catch (e) {
    console.warn('[joinMatch]', e);
    return { success: false, error: e.message || String(e) };
  }
};
