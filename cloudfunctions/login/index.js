const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  // ───────── 确保 users 表有该用户的完整字段记录 ─────────
  try {
    const snap = await db.collection('users').where({ _openid: openId }).limit(1).get();
    if (!snap.data || snap.data.length === 0) {
      await db.collection('users').add({
        data: {
          _openid: openId,
          openid: openId,
          nickName: '',
          avatarUrl: '',
          handicap: 0,
          gender: 0,
          city: '',
          updated_at: db.serverDate(),
          created_at: db.serverDate(),
        },
      });
    }
  } catch (e) {
    console.warn('[login] users seed error', e);
  }

  return {
    openId,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};
