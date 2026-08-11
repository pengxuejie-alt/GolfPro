const cloud = require('wx-server-sdk');
/** 与 joinMatch / listMyMatches / 小程序 wx.cloud.init 当前环境一致，勿写死 env，否则会「写入 A 库、列表读 B 库」 */
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid } = require('./matchCanonical');

const EMPTY_18 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

function playerUid(p) {
  if (!p || typeof p !== 'object') return '';
  return String(p.uid || p.id || p.openId || p.openid || '').trim();
}

/** 客户端未登录时用 host_/virtual_/mock 占位，云侧应归一为真实 OPENID */
function isPlaceholderHostUid(uid) {
  const id = String(uid || '').trim();
  if (!id) return true;
  if (id.startsWith('virtual')) return true;
  if (id.startsWith('host_')) return true;
  if (id === 'mock_golfpro_user') return true;
  return false;
}

function mapPlayersForCloud(playerList) {
  return playerList.map((p) => ({
    uid: p.uid || p.id || p.openId || '',
    nickName: p.nickName || p.nickname || '',
    avatarUrl: p.avatarUrl || p.avatar || '',
    handicap: Number(p.handicap) || 0,
  }));
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;

  const {
    match_id,
    title,
    courseName,
    course_id,
    players,
    date,
    is_private,
    hole_scores,
    status: statusIn,
    pk_results,
    pk_rules,
  } = event;

  const mid = match_id || `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const playerList = Array.isArray(players) ? players : [];
  const matchStatus = statusIn != null && statusIn !== '' ? Number(statusIn) : 1;
  const pkPayload = Array.isArray(pk_results)
    ? pk_results
    : Array.isArray(pk_rules)
      ? pk_rules
      : null;

  const matchPayload = {
    _openid: openId,
    match_id: mid,
    title: title || '我的球局',
    courseName: courseName || '',
    course_name: courseName || '',
    course_id: course_id || '',
    players: mapPlayersForCloud(playerList),
    user_list: mapPlayersForCloud(playerList),
    scores: hole_scores || Array.from({ length: 18 }, () => ({ scores: [0], par: 4 })),
    date: date || new Date().toISOString(),
    status: Number.isFinite(matchStatus) ? matchStatus : 1,
    is_private: is_private || false,
    updated_at: db.serverDate(),
    created_at: db.serverDate(),
  };

  if (pkPayload && pkPayload.length > 0) {
    matchPayload.pk_results = pkPayload;
  }

  const result = { matchOk: false, scoresOk: 0, friendsOk: 0, userOk: false, upsert: 'add', deduped: 0 };

  try {
    const { doc: existing, duplicates } = await findMatchDocsByMid(db, mid, { dedupe: true });
    result.deduped = duplicates.length;

    if (existing) {
      const docId = existing._id;
      const updateData = {
        title: matchPayload.title,
        courseName: matchPayload.courseName,
        course_name: matchPayload.course_name,
        course_id: matchPayload.course_id,
        players: matchPayload.players,
        user_list: matchPayload.user_list,
        scores: matchPayload.scores,
        date: matchPayload.date,
        status: matchPayload.status,
        is_private: matchPayload.is_private,
        updated_at: db.serverDate(),
      };
      if (pkPayload && pkPayload.length > 0) {
        updateData.pk_results = pkPayload;
      }
      await db.collection('matches').doc(docId).update({ data: updateData });
      result.matchOk = true;
      result._id = docId;
      result.match_id = mid;
      result.upsert = 'update';
    } else {
      if (playerList.length > 0) {
        const hostUidRaw = playerUid(playerList[0]);
        if (isPlaceholderHostUid(hostUidRaw) && openId) {
          playerList[0] = {
            ...playerList[0],
            uid: openId,
            id: openId,
            openId,
            openid: openId,
          };
          matchPayload.players = mapPlayersForCloud(playerList);
          matchPayload.user_list = mapPlayersForCloud(playerList);
        }
        const hostUid = playerUid(playerList[0]);
        const callerInRoster = playerList.some((p) => playerUid(p) === openId);
        const hostIsVirtual = isPlaceholderHostUid(hostUid);
        if (!callerInRoster && hostUid !== openId && !hostIsVirtual) {
          return { success: false, step: 'matches', error: 'not_found', match_id: mid };
        }
      }
      const matchRes = await db.collection('matches').add({ data: matchPayload });
      result.matchOk = true;
      result._id = matchRes._id;
      result.match_id = mid;
      result.upsert = 'add';
    }
  } catch (e) {
    return { success: false, step: 'matches', error: e.message || String(e) };
  }

  if (result.upsert === 'add') {
    try {
      const scoreOps = playerList.map((p) => {
        const pUid = p.uid || p.id || p.openId || '';
        const pName = p.nickName || p.nickname || '';
        return db.collection('scores').add({
          data: {
            _openid: openId,
            match_id: mid,
            player_uid: pUid,
            player_name: pName,
            hole_scores: EMPTY_18.slice(),
            total_score: 0,
            updated_at: db.serverDate(),
            created_at: db.serverDate(),
          },
        });
      });
      const scoreResults = await Promise.allSettled(scoreOps);
      result.scoresOk = scoreResults.filter((r) => r.status === 'fulfilled').length;
    } catch (e) {
      console.warn('[createMatch] scores cascade error', e);
    }
  }

  if (result.upsert === 'add') {
    try {
      const friendOps = playerList
        .filter((p) => {
          const fId = p.uid || p.id || p.openId || '';
          return fId && fId !== openId;
        })
        .map((p) => {
          return db.collection('friends').add({
            data: {
              _openid: openId,
              my_openid: openId,
              friend_openid: p.uid || p.id || p.openId || '',
              nickName: p.nickName || p.nickname || '',
              avatarUrl: p.avatarUrl || p.avatar || '',
              last_match_id: mid,
              last_match_at: db.serverDate(),
              updated_at: db.serverDate(),
              created_at: db.serverDate(),
            },
          });
        });
      const friendResults = await Promise.allSettled(friendOps);
      result.friendsOk = friendResults.filter((r) => r.status === 'fulfilled').length;
    } catch (e) {
      console.warn('[createMatch] friends cascade error', e);
    }
  }

  try {
    const userSnap = await db.collection('users').where({ _openid: openId }).limit(1).get();
    if (!userSnap.data || userSnap.data.length === 0) {
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
      result.userOk = true;
    } else {
      result.userOk = true;
    }
  } catch (e) {
    console.warn('[createMatch] users upsert error', e);
  }

  return { success: true, ...result };
};
