const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { findMatchDocsByMid } = require('./matchCanonical');
const { enrichMatchRosterAvatars } = require('./rosterAvatarEnrich');

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

function isPlaceholderNick(nick) {
  const n = String(nick || '').trim();
  if (!n || n === '游客') return true;
  if (n === '球友') return true;
  if (/^球友[a-zA-Z0-9_-]{1,8}$/.test(n)) return true;
  if (/^o[A-Za-z0-9_-]{10,}$/.test(n)) return true;
  return false;
}

function defaultJoinNickName(openId, nickName) {
  const nick = String(nickName || '').trim();
  if (nick && !isPlaceholderNick(nick)) return nick;
  return '游客';
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openId = wxContext.OPENID;
  if (!openId) {
    return { success: false, error: 'no OPENID' };
  }

  const matchId = event?.match_id != null ? String(event.match_id).trim() : '';
  const nickNameRaw = event?.nickName != null ? String(event.nickName).trim() : '';
  const avatarUrl = event?.avatarUrl != null ? String(event.avatarUrl).trim() : '';
  const handicapRaw = event?.handicap;
  const handicap =
    handicapRaw != null && handicapRaw !== '' && Number.isFinite(Number(handicapRaw))
      ? Number(handicapRaw)
      : null;

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
      const match = mapDocToClient(updatedSnap.data);
      await enrichMatchRosterAvatars(cloud, db, match);
      return {
        success: true,
        already: true,
        match,
      };
    }

    const prevLen = players.length;
    const nickName = defaultJoinNickName(openId, nickNameRaw);

    players.push({
      uid: openId,
      id: openId,
      openId,
      nickName,
      nickname: nickName,
      avatarUrl,
      avatar: avatarUrl,
      handicap: handicap != null && Number.isFinite(handicap) ? handicap : null,
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
      const userPayload = { updated_at: db.serverDate() };
      if (uSnap.data && uSnap.data.length > 0) {
        const existing = uSnap.data[0];
        const exNick = String(existing.nickName || '').trim();
        const exAv = String(existing.avatarUrl || '').trim();
        if (!exNick || isPlaceholderNick(exNick)) {
          userPayload.nickName = nickName;
        }
        if (avatarUrl && !exAv) {
          userPayload.avatarUrl = avatarUrl;
        }
        await db.collection('users').doc(existing._id).update({ data: userPayload });
      } else {
        await db.collection('users').add({
          data: {
            _openid: openId,
            openid: openId,
            nickName,
            avatarUrl,
            handicap: handicap != null && Number.isFinite(handicap) ? handicap : null,
            gender: 0,
            city: '',
            updated_at: db.serverDate(),
            created_at: db.serverDate(),
          },
        });
      }
    } catch (e) {
      console.warn('[joinMatch] users upsert', e);
    }

    // 加入即写入历史同组（friends），不等到完赛
    try {
      const mid = docRef.match_id != null ? String(docRef.match_id).trim() : matchId;
      const friendOps = [];
      for (const p of players) {
        const fId = playerKey(p);
        if (!fId || fId === openId) continue;
        friendOps.push(
          db.collection('friends').add({
            data: {
              _openid: openId,
              my_openid: openId,
              friend_openid: fId,
              nickName: p.nickName || p.nickname || '',
              avatarUrl: p.avatarUrl || p.avatar || '',
              last_match_id: mid,
              last_match_at: db.serverDate(),
              updated_at: db.serverDate(),
              created_at: db.serverDate(),
            },
          }),
        );
        friendOps.push(
          db.collection('friends').add({
            data: {
              _openid: fId,
              my_openid: fId,
              friend_openid: openId,
              nickName: nickName,
              avatarUrl: avatarUrl,
              last_match_id: mid,
              last_match_at: db.serverDate(),
              updated_at: db.serverDate(),
              created_at: db.serverDate(),
            },
          }),
        );
      }
      if (friendOps.length) {
        await Promise.allSettled(friendOps);
      }
    } catch (e) {
      console.warn('[joinMatch] friends cascade', e);
    }

    const updatedSnap = await db.collection('matches').doc(docId).get();
    const match = mapDocToClient(updatedSnap.data);
    await enrichMatchRosterAvatars(cloud, db, match);
    return {
      success: true,
      already: false,
      match,
    };
  } catch (e) {
    console.warn('[joinMatch]', e);
    return { success: false, error: e.message || String(e) };
  }
};
