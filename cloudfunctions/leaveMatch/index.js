const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid } = require('../common/matchCanonical');

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
  if (!matchId) {
    return { success: false, error: 'missing match_id' };
  }

  try {
    const { doc: docRef } = await findMatchDocsByMid(db, matchId, { dedupe: true });
    if (!docRef) {
      return { success: false, error: 'not_found' };
    }

    const docId = docRef._id;
    const roster =
      Array.isArray(docRef.players) && docRef.players.length
        ? [...docRef.players]
        : Array.isArray(docRef.user_list)
          ? [...docRef.user_list]
          : [];
    const players = roster;
    const idx = players.findIndex((p) => playerKey(p) === openId);
    if (idx < 0) {
      return { success: false, error: 'not_in_roster' };
    }

    players.splice(idx, 1);

    const rawScores = Array.isArray(docRef.scores) ? JSON.parse(JSON.stringify(docRef.scores)) : [];
    while (rawScores.length < 18) {
      rawScores.push({ scores: [], par: 4, scoreTs: [] });
    }
    for (let i = 0; i < rawScores.length; i++) {
      const hole = rawScores[i] || { scores: [], par: 4, scoreTs: [] };
      const arr = Array.isArray(hole.scores) ? [...hole.scores] : [];
      const ts = Array.isArray(hole.scoreTs) ? [...hole.scoreTs] : [];
      if (idx < arr.length) arr.splice(idx, 1);
      if (idx < ts.length) ts.splice(idx, 1);
      rawScores[i] = {
        par: hole.par != null ? Number(hole.par) : 4,
        scores: arr,
        scoreTs: ts,
      };
    }

    await db.collection('matches').doc(docId).update({
      data: {
        players,
        user_list: players,
        scores: rawScores,
        updated_at: db.serverDate(),
      },
    });

    try {
      const scoreSnap = await db
        .collection('scores')
        .where({ match_id: matchId, player_uid: openId })
        .limit(20)
        .get();
      if (scoreSnap.data && scoreSnap.data.length > 0) {
        const removes = scoreSnap.data.map((row) =>
          db.collection('scores').doc(row._id).remove(),
        );
        await Promise.allSettled(removes);
      }
    } catch (e) {
      console.warn('[leaveMatch] scores cleanup', e);
    }

    return { success: true, match_id: matchId };
  } catch (e) {
    console.warn('[leaveMatch]', e);
    return { success: false, error: e.message || String(e) };
  }
};
