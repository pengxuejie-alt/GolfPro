/**
 * 服务端为比赛 roster 回填 users/players 头像并换 cloud:// → https。
 * 客户端无法批量读他人 users 文档时，仍可从 getMatch/listMyMatches 拿到可展示头像。
 */

function isWxOpenId(s) {
  return /^o[A-Za-z0-9_-]{10,}$/.test(String(s || '').trim());
}

function playerOpenId(p) {
  if (!p || typeof p !== 'object') return '';
  const keys = ['openid', 'openId', 'uid', 'id', 'player_uid'];
  let fallback = '';
  for (const key of keys) {
    const s = String(p[key] || '').trim();
    if (!s || s.startsWith('temp_') || s.startsWith('virtual') || s.startsWith('host_')) continue;
    if (isWxOpenId(s)) return s;
    if (!fallback) fallback = s;
  }
  return fallback;
}

function pickAvatar(row) {
  if (!row || typeof row !== 'object') return '';
  for (const k of ['avatarUrl', 'avatar', 'avatar_url']) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function isExpiredTempHttps(url) {
  const s = String(url || '').trim();
  if (!s.startsWith('https://') || !/[?&]sign=/i.test(s)) return false;
  return /\.tcb\.qcloud\.la\b/i.test(s) || /\.myqcloud\.com\b/i.test(s);
}

async function resolveCloudIds(cloud, fileIds) {
  const map = new Map();
  const uniq = [...new Set(fileIds.filter((s) => String(s).startsWith('cloud://')))];
  if (!uniq.length) return map;
  const chunkSize = 50;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await cloud.getTempFileURL({ fileList: chunk });
        for (const item of res.fileList || []) {
          const fid = item.fileID != null ? String(item.fileID).trim() : '';
          const status = item.status != null ? Number(item.status) : 0;
          const url = item.tempFileURL != null ? String(item.tempFileURL).trim() : '';
          if (fid && status === 0 && url.startsWith('https://')) map.set(fid, url);
        }
        break;
      } catch (e) {
        console.warn('[rosterAvatarEnrich] getTempFileURL', attempt + 1, e);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  return map;
}

async function fetchProfilesByOpenIds(db, openIds) {
  const byOpen = new Map();
  if (!openIds.length) return byOpen;
  const _ = db.command;
  const chunkSize = 20;

  async function mergeFromCollection(name, ids) {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      try {
        const snap = await db
          .collection(name)
          .where(_.or([{ _openid: _.in(chunk) }, { openid: _.in(chunk) }, { openId: _.in(chunk) }]))
          .limit(50)
          .get();
        for (const row of snap.data || []) {
          const oid = String(row._openid || row.openid || row.openId || '').trim();
          if (!oid) continue;
          const nickRaw = row.nickName ?? row.nickname;
          const nickName =
            nickRaw != null && String(nickRaw).trim() ? String(nickRaw).trim() : '球友';
          const avatarUrl = pickAvatar(row);
          const cur = byOpen.get(oid);
          if (!cur) {
            byOpen.set(oid, { nickName, avatarUrl });
          } else if (avatarUrl && (!cur.avatarUrl || cur.avatarUrl.startsWith('cloud://'))) {
            byOpen.set(oid, { nickName: nickName || cur.nickName, avatarUrl });
          }
        }
      } catch (e) {
        console.warn('[rosterAvatarEnrich] query', name, e);
      }
    }
  }

  await mergeFromCollection('users', openIds);
  const missing = openIds.filter((id) => {
    const p = byOpen.get(id);
    return !p || !pickAvatar(p);
  });
  if (missing.length) await mergeFromCollection('players', missing);
  return byOpen;
}

function pickBestAvatar(curAv, profAv) {
  const cur = String(curAv || '').trim();
  const prof = String(profAv || '').trim();
  if (prof && prof.startsWith('https://') && !isExpiredTempHttps(prof)) return prof;
  if (cur && cur.startsWith('https://') && !isExpiredTempHttps(cur)) return cur;
  if (prof && prof.startsWith('cloud://')) return prof;
  if (cur && cur.startsWith('cloud://')) return cur;
  if (prof) return prof;
  return cur;
}

/**
 * @param {object} cloud wx-server-sdk 实例
 * @param {object} db database
 * @param {object} matchRow 比赛文档（mapDocToClient 之后）
 */
async function enrichMatchRosterAvatars(cloud, db, matchRow) {
  if (!matchRow || typeof matchRow !== 'object') return matchRow;
  const roster = matchRow.user_list || matchRow.players;
  if (!Array.isArray(roster) || !roster.length) return matchRow;

  const openIds = [...new Set(roster.map(playerOpenId).filter(Boolean))];
  if (!openIds.length) return matchRow;

  const profiles = await fetchProfilesByOpenIds(db, openIds);
  const cloudIds = [];
  for (const [, prof] of profiles) {
    const av = pickAvatar(prof);
    if (av.startsWith('cloud://')) cloudIds.push(av);
  }
  for (const p of roster) {
    const av = pickAvatar(p);
    if (av.startsWith('cloud://')) cloudIds.push(av);
  }
  const resolved = await resolveCloudIds(cloud, cloudIds);

  function toDisplayUrl(av) {
    const s = String(av || '').trim();
    if (!s) return '';
    if (s.startsWith('cloud://')) {
      const https = resolved.get(s);
      return https || s;
    }
    if (isExpiredTempHttps(s)) return '';
    return s;
  }

  const enriched = roster.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const oid = playerOpenId(p);
    const prof = oid ? profiles.get(oid) : null;
    const mergedRaw = pickBestAvatar(pickAvatar(p), prof ? pickAvatar(prof) : '');
    const displayAv = toDisplayUrl(mergedRaw);
    const nick =
      (prof && prof.nickName) ||
      (p.nickName && String(p.nickName).trim()) ||
      (p.nickname && String(p.nickname).trim()) ||
      '球友';
    return {
      ...p,
      uid: oid || p.uid,
      id: oid || p.id,
      openId: oid || p.openId,
      openid: oid || p.openid,
      nickName: nick,
      nickname: nick,
      avatar: displayAv || pickAvatar(p),
      avatarUrl: displayAv || pickAvatar(p),
    };
  });

  matchRow.user_list = enriched;
  matchRow.players = enriched;
  return matchRow;
}

module.exports = {
  enrichMatchRosterAvatars,
  playerOpenId,
};
