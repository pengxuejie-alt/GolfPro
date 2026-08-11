const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 云函数侧换取临时 HTTPS，避免小程序端对他人 cloud:// 文件 getTempFileURL 失败导致头像白屏 */
async function resolveAvatarFileIdsToHttps(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  const fileIds = [
    ...new Set(
      list
        .map((p) => (p && p.avatarUrl ? String(p.avatarUrl).trim() : ''))
        .filter((s) => s.startsWith('cloud://')),
    ),
  ];
  if (!fileIds.length) return list;

  const idToUrl = new Map();
  const chunkSize = 50;
  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const chunk = fileIds.slice(i, i + chunkSize);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await cloud.getTempFileURL({ fileList: chunk });
        for (const item of res.fileList || []) {
          const fid = item.fileID != null ? String(item.fileID).trim() : '';
          const status = item.status != null ? Number(item.status) : 0;
          const url = item.tempFileURL != null ? String(item.tempFileURL).trim() : '';
          if (fid && status === 0 && url) idToUrl.set(fid, url);
          else if (fid && status !== 0) {
            console.warn('[getUserProfiles] tempURL fail', fid, item.errMsg || status);
          }
        }
        break;
      } catch (e) {
        console.warn('[getUserProfiles] getTempFileURL attempt', attempt + 1, e);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  return list.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const av = p.avatarUrl != null ? String(p.avatarUrl).trim() : '';
    if (!av.startsWith('cloud://')) return p;
    const t = idToUrl.get(av);
    return t ? { ...p, avatarUrl: t } : p;
  });
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const caller = wxContext.OPENID;
  if (!caller) {
    return { success: false, error: 'no OPENID', profiles: [] };
  }

  const raw = event?.openIds ?? event?.openids ?? [];
  const openIds = Array.isArray(raw)
    ? raw
        .map((x) => String(x || '').trim())
        .filter(
          (x) =>
            x &&
            !x.startsWith('temp_') &&
            !x.startsWith('virtual') &&
            !x.startsWith('host_') &&
            !x.startsWith('mock_'),
        )
    : [];
  const uniq = [...new Set(openIds)].slice(0, 80);
  if (!uniq.length) {
    return { success: true, profiles: [] };
  }

  const _ = db.command;
  const byOpen = new Map();
  const chunkSize = 20;

  function rowOpenId(row) {
    if (!row || typeof row !== 'object') return '';
    return String(row._openid || row.openid || row.openId || '').trim();
  }

  function mergeRows(rows) {
    for (const row of rows || []) {
      if (!row || typeof row !== 'object') continue;
      const oid = rowOpenId(row);
      if (!oid) continue;
      const nickRaw = row.nickName ?? row.nickname;
      const nickName =
        nickRaw != null && String(nickRaw).trim() !== ''
          ? String(nickRaw).trim()
          : '球友';
      const avRaw = row.avatarUrl ?? row.avatar;
      const avatarUrl =
        avRaw != null && String(avRaw).trim() !== '' ? String(avRaw).trim() : '';
      if (!byOpen.has(oid)) {
        byOpen.set(oid, { openId: oid, nickName, avatarUrl });
      } else if (avatarUrl) {
        const cur = byOpen.get(oid);
        if (cur && (!cur.avatarUrl || cur.avatarUrl.length < avatarUrl.length)) {
          byOpen.set(oid, { ...cur, nickName: nickName || cur.nickName, avatarUrl });
        }
      }
    }
  }

  try {
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const chunk = uniq.slice(i, i + chunkSize);
      const snap = await db
        .collection('users')
        .where(
          _.or([{ _openid: _.in(chunk) }, { openid: _.in(chunk) }]),
        )
        .limit(50)
        .get();
      mergeRows(snap.data);
    }

    const missing = uniq.filter((id) => !byOpen.has(id));
    if (missing.length) {
      for (let i = 0; i < missing.length; i += chunkSize) {
        const chunk = missing.slice(i, i + chunkSize);
        const snap = await db
          .collection('players')
          .where(_.or([{ _openid: _.in(chunk) }, { openid: _.in(chunk) }]))
          .limit(50)
          .get();
        mergeRows(snap.data);
      }
    }

    const profiles = await resolveAvatarFileIdsToHttps([...byOpen.values()]);
    const withAvatar = profiles.filter((p) => p && p.avatarUrl && String(p.avatarUrl).startsWith('https://')).length;
    console.info('[getUserProfiles]', {
      requested: uniq.length,
      found: byOpen.size,
      httpsAvatars: withAvatar,
    });
    return { success: true, profiles, meta: { requested: uniq.length, found: byOpen.size, httpsAvatars: withAvatar } };
  } catch (e) {
    console.warn('[getUserProfiles]', e);
    return { success: false, error: e.message || String(e), profiles: [] };
  }
};
