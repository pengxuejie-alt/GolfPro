const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  if (!openId) {
    return { success: false, error: '无法获取 openId' };
  }

  const { nickName, avatarUrl, handicap, gender, city } = event;

  try {
    const snap = await db.collection('users').where({ _openid: openId }).limit(1).get();

    if (snap.data && snap.data.length > 0) {
      const update = { updated_at: db.serverDate() };
      if (nickName != null) update.nickName = String(nickName).trim();
      if (avatarUrl != null) update.avatarUrl = String(avatarUrl).trim();
      if (handicap != null) update.handicap = Number(handicap);
      if (gender != null) update.gender = Number(gender);
      if (city != null) update.city = String(city).trim();

      await db.collection('users').doc(snap.data[0]._id).update({ data: update });
    } else {
      await db.collection('users').add({
        data: {
          _openid: openId,
          openid: openId,
          nickName: nickName != null ? String(nickName).trim() : '',
          avatarUrl: avatarUrl != null ? String(avatarUrl).trim() : '',
          handicap: handicap != null ? Number(handicap) : 0,
          gender: gender != null ? Number(gender) : 0,
          city: city != null ? String(city).trim() : '',
          updated_at: db.serverDate(),
          created_at: db.serverDate(),
        },
      });
    }

    // 球友展示用：与 users 同步一份 player 资料（按 openId 一条）
    try {
      const pSnap = await db.collection('players').where({ _openid: openId }).limit(1).get();
      const pUpdate = { updated_at: db.serverDate() };
      if (nickName != null) pUpdate.nickName = String(nickName).trim();
      if (avatarUrl != null) pUpdate.avatarUrl = String(avatarUrl).trim();
      if (pSnap.data && pSnap.data.length > 0) {
        await db.collection('players').doc(pSnap.data[0]._id).update({ data: pUpdate });
      } else {
        await db.collection('players').add({
          data: {
            _openid: openId,
            openid: openId,
            nickName: nickName != null ? String(nickName).trim() : '',
            avatarUrl: avatarUrl != null ? String(avatarUrl).trim() : '',
            updated_at: db.serverDate(),
            created_at: db.serverDate(),
          },
        });
      }
    } catch (e) {
      console.warn('[updateUserProfile] players sync', e);
    }

    return { success: true, openId };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
};
