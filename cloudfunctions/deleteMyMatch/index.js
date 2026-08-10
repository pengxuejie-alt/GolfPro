const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid } = require('../common/matchCanonical');

exports.main = async (event) => {
  const openId = cloud.getWXContext().OPENID;
  if (!openId) return { success: false, error: 'no_OPENID' };

  const mid = event?.match_id != null ? String(event.match_id).trim() : '';
  if (!mid) return { success: false, error: 'missing_match_id' };

  try {
    const { doc } = await findMatchDocsByMid(db, mid, { dedupe: true });
    if (!doc) {
      return { success: true, deleted: false, reason: 'not_found' };
    }

    if (doc._openid !== openId) {
      return { success: false, error: 'not_owner' };
    }

    const allSnap = await db.collection('matches').where({ match_id: mid }).limit(20).get();
    const allDocs = allSnap.data || [doc];
    await Promise.allSettled(allDocs.map((row) => db.collection('matches').doc(row._id).remove()));

    try {
      const scoreSnap = await db.collection('scores').where({ match_id: mid }).limit(500).get();
      if (scoreSnap.data && scoreSnap.data.length > 0) {
        await Promise.allSettled(
          scoreSnap.data.map((row) => db.collection('scores').doc(row._id).remove()),
        );
      }
    } catch (e) {
      console.warn('[deleteMyMatch] scores cleanup', e);
    }

    return { success: true, deleted: true, match_id: mid };
  } catch (e) {
    console.warn('[deleteMyMatch]', e);
    return { success: false, error: e.message || String(e) };
  }
};
