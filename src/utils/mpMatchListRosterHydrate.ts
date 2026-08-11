/**
 * 首页 / 列表：比赛行里 roster 头像常为空，计分页会 hydrate users；此处对「多场比赛列表」批量拉 users 回填。
 */

import { looksLikeExpiredProneTencentTempHttps } from './mpAvatarSrc';
import { isGuestOrPlaceholderNickname } from './guestNickname';
import { setCachedAvatarDisplay } from './avatarDisplayCache';
import { db } from './db.js';
import { pickAvatarUrlFromUserRow } from './selfAvatarResolve';

/** 可合并进 roster 的头像：保留 cloud://，丢弃已过期的 COS 临时链 */
function rosterAvatarForMerge(raw: unknown): string {
  const s = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '';
  if (!s) return '';
  if (s.startsWith('cloud://')) return s;
  if (looksLikeExpiredProneTencentTempHttps(s)) return '';
  return s;
}

function rosterPlayerKey(p: unknown): string {
  if (!p || typeof p !== 'object') return '';
  const o = p as Record<string, unknown>;
  const raw = o.openid ?? o.openId ?? o.player_uid ?? o.uid ?? o.id;
  if (raw == null || String(raw).trim() === '') return '';
  return String(raw).trim();
}

function collectOpenIdsFromMatches(matches: unknown[]): string[] {
  const set = new Set<string>();
  for (const m of matches) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const roster = row.user_list ?? row.players ?? [];
    if (!Array.isArray(roster)) continue;
    for (const p of roster) {
      const k = rosterPlayerKey(p);
      if (k.startsWith('temp_') || k.startsWith('virtual') || k.startsWith('anon_')) continue;
      set.add(k);
    }
  }
  return [...set];
}

/** 不可用头像 URL（与本机缓存路径）：他人机型无法加载 */
function isShareableHttpsAvatar(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('wxfile://') || u.startsWith('file://') || u.startsWith('http://tmp')) return false;
  return true;
}

async function fetchUserProfilesFromUsersDb(
  openIds: string[],
): Promise<Map<string, { nickName: string; avatarUrl: string }>> {
  const map = new Map<string, { nickName: string; avatarUrl: string }>();
  if (!openIds.length) return map;

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.database) return map;
  try {
    await db.waitForInit();
    const wxdb = wx.cloud.database();
    const _ = wxdb.command;
    const chunkSize = 20;
    for (let i = 0; i < openIds.length; i += chunkSize) {
      const chunk = openIds.slice(i, i + chunkSize);
      const snap = await wxdb.collection('users').where({ _openid: _.in(chunk) }).get();
      for (const row of snap.data ?? []) {
        const r = row as Record<string, unknown>;
        const oid = r._openid != null ? String(r._openid).trim() : '';
        if (!oid) continue;
        const nickRaw = r.nickName ?? r.nickname;
        const nickName =
          nickRaw != null && String(nickRaw).trim() !== '' ? String(nickRaw).trim() : '球友';
        const avatarUrl = pickAvatarUrlFromUserRow(r);
        map.set(oid, { nickName, avatarUrl });
      }
    }
  } catch (e) {
    console.warn('[mpMatchListRosterHydrate] users db fallback', e);
  }
  // #endif

  return map;
}

export async function fetchUserProfilesMerged(
  openIds: string[],
): Promise<Map<string, { nickName: string; avatarUrl: string }>> {
  const map = new Map<string, { nickName: string; avatarUrl: string }>();
  if (!openIds.length) return map;

  const uniq = [...new Set(openIds.map((x) => String(x || '').trim()).filter(Boolean))];
  const MAX = 78;
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += MAX) chunks.push(uniq.slice(i, i + MAX));

  // #ifdef MP-WEIXIN
  try {
    await db.waitForInit();
    for (const chunk of chunks) {
      if (!chunk.length) continue;
      await new Promise<void>((resolve) => {
        try {
          if (typeof wx === 'undefined' || !wx.cloud?.callFunction) {
            resolve();
            return;
          }
          wx.cloud.callFunction({
            name: 'getUserProfiles',
            data: { openIds: chunk },
            success: (r: unknown) => {
              const res = r as { result?: { success?: boolean; profiles?: unknown[] } } | undefined;
              const profiles = Array.isArray(res?.result?.profiles) ? res?.result?.profiles : [];
              for (const raw of profiles) {
                const row = raw as Record<string, unknown>;
                const oid = row.openId != null ? String(row.openId).trim() : '';
                if (!oid) continue;
                const nickRaw = row.nickName ?? row.nickname;
                const nickName =
                  nickRaw != null && String(nickRaw).trim() !== '' ? String(nickRaw).trim() : '球友';
                const avRaw = row.avatarUrl ?? row.avatar;
                const avatarUrl =
                  avRaw != null && String(avRaw).trim() !== '' ? String(avRaw).trim() : '';
                map.set(oid, { nickName, avatarUrl });
              }
              resolve();
            },
            fail: () => resolve(),
          });
        } catch {
          resolve();
        }
      });
    }
  } catch {
    /* ignore */
  }

  const needDb = uniq.filter((id) => {
    const p = map.get(id);
    return !p || !String(p.avatarUrl || '').trim();
  });
  if (needDb.length) {
    const dbMap = await fetchUserProfilesFromUsersDb(needDb);
    for (const [oid, prof] of dbMap) {
      const cur = map.get(oid);
      if (!cur) {
        map.set(oid, prof);
      } else if (!String(cur.avatarUrl || '').trim() && prof.avatarUrl) {
        map.set(oid, { nickName: cur.nickName || prof.nickName, avatarUrl: prof.avatarUrl });
      }
    }
  }
  // #endif

  return map;
}

function applyProfilesToRoster(
  roster: unknown,
  profiles: Map<string, { nickName: string; avatarUrl: string }>,
): void {
  if (!Array.isArray(roster)) return;
  for (const raw of roster) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const oid = rosterPlayerKey(o);
    if (!oid) continue;
    const prof = profiles.get(oid);
    if (!prof) continue;

    const curA = String(o.avatar ?? '').trim();
    const curU = String(o.avatarUrl ?? '').trim();
    const curBest = curA || curU;
    const incoming = rosterAvatarForMerge(prof.avatarUrl);
    const curExpiredCos = !!(curBest && looksLikeExpiredProneTencentTempHttps(curBest));
    const curIsCloud = curBest.startsWith('cloud://');
    const incomingHttps =
      incoming.startsWith('https://') && !looksLikeExpiredProneTencentTempHttps(incoming);
    const incomingCloud = incoming.startsWith('cloud://');

    const needAvatar =
      !curBest ||
      curExpiredCos ||
      curIsCloud ||
      incomingCloud ||
      (incomingHttps && (!curBest || curExpiredCos || curIsCloud)) ||
      (!isShareableHttpsAvatar(curBest) && !!incoming);
    const useIncoming = !!(incoming && (needAvatar || !curBest));

    if (useIncoming) {
      if (incomingCloud) {
        o.avatarUrl = incoming;
        o.avatar = incoming;
      } else if (incomingHttps) {
        o.avatarUrl = incoming;
        o.avatar = incoming;
        setCachedAvatarDisplay(oid, incoming);
      }
    }
    if (prof.nickName) {
      const nick = String(prof.nickName).trim();
      const curNick = typeof o.nickname === 'string' ? o.nickname.trim() : '';
      const curNick2 = typeof o.nickName === 'string' ? o.nickName.trim() : '';
      const shouldNick =
        nick && (isGuestOrPlaceholderNickname(curNick, oid) || (oid && curNick === oid));
      if (shouldNick) {
        o.nickname = nick;
      }
      const shouldNick2 =
        nick && (isGuestOrPlaceholderNickname(curNick2, oid) || (oid && curNick2 === oid));
      if (shouldNick2) {
        o.nickName = nick;
      }
    }
  }
}

/**
 * 就地：为多场比赛的球员行补 avatar/avatarUrl（来自 users / getUserProfiles）。
 */
export async function hydrateMatchListRostersFromUserProfiles(matches: unknown): Promise<void> {
  const list = Array.isArray(matches) ? matches : [];
  const ids = collectOpenIdsFromMatches(list);
  if (!ids.length) return;
  const profiles = await fetchUserProfilesMerged(ids);
  if (profiles.size === 0) return;

  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    applyProfilesToRoster(row.user_list, profiles);
    applyProfilesToRoster(row.players, profiles);
  }
}
