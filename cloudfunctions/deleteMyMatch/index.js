const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { isOwnerOfMatchDoc } = require('./matchCanonical');

exports.main = async (event) => {
  const openId = cloud.getWXContext().OPENID;
  if (!openId) return { success: false, error: 'no_OPENID' };

  const mid = event?.match_id != null ? String(event.match_id).trim() : '';
  if (!mid) return { success: false, error: 'missing_match_id' };

  try {
    const allSnap = await db.collection('matches').where({ match_id: mid }).limit(20).get();
    const allDocs = allSnap.data || [];
    if (allDocs.length === 0) {
      return { success: true, deleted: false, reason: 'not_found' };
    }

    /** 与客户端一致：任一副本 _openid 或名单首位匹配即可删（兼容 upsert 未改 _openid、多副本） */
    const canDelete = allDocs.some((row) => isOwnerOfMatchDoc(row, openId));
    if (!canDelete) {
      return { success: false, error: 'not_owner' };
    }

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
