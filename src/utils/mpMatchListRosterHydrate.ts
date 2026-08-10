/**
 * 首页 / 列表：比赛行里 roster 头像常为空，计分页会 hydrate users；此处对「多场比赛列表」批量拉 users 回填。
 */

import { looksLikeExpiredProneTencentTempHttps } from './mpAvatarSrc';
import { GUEST_NICKNAME, isGuestOrPlaceholderNickname } from './guestNickname';
import { setCachedAvatarDisplay } from './avatarDisplayCache';

function rosterAvatarForMerge(raw: unknown): string {
  const s = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '';
  if (!s || s.startsWith('cloud://')) return '';
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

async function fetchUserProfilesMerged(openIds: string[]): Promise<Map<string, { nickName: string; avatarUrl: string }>> {
  const map = new Map<string, { nickName: string; avatarUrl: string }>();
  if (!openIds.length) return map;

  const uniq = [...new Set(openIds.map((x) => String(x || '').trim()).filter(Boolean))];
  const MAX = 78;
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += MAX) chunks.push(uniq.slice(i, i + MAX));

  // #ifdef MP-WEIXIN
  try {
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
  // #endif

  return map;
}

function applyProfilesToRoster(roster: unknown, profiles: Map<string, { nickName: string; avatarUrl: string }>): void {
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
    /** users 里也常存已过期的 COS 临时链；勿用它盖住 cloud:// */
    const incoming = rosterAvatarForMerge(prof.avatarUrl);
    const curExpiredCos = !!(curBest && looksLikeExpiredProneTencentTempHttps(curBest));
    const curIsCloud = curBest.startsWith('cloud://');
    const incomingHttps = incoming.startsWith('https://') && !looksLikeExpiredProneTencentTempHttps(incoming);

    const needAvatar =
      !curBest ||
      curExpiredCos ||
      (curIsCloud && incomingHttps) ||
      (!isShareableHttpsAvatar(curBest) &&
        incoming &&
        (incoming.startsWith('https://') || incoming.startsWith('cloud://')));
    const useIncoming = !!(incoming && (needAvatar || !curBest));

    if (useIncoming) {
      const incomingSafe =
        incoming.startsWith('https://') && !looksLikeExpiredProneTencentTempHttps(incoming) ? incoming : '';
      if (incomingSafe) {
        o.avatarUrl = incomingSafe;
        o.avatar = incomingSafe;
        if (oid) setCachedAvatarDisplay(oid, incomingSafe);
      }
    }
    if (prof.nickName) {
      const nick = String(prof.nickName).trim();
      const curNick = typeof o.nickname === 'string' ? o.nickname.trim() : '';
      const curNick2 = typeof o.nickName === 'string' ? o.nickName.trim() : '';
      const oid = rosterPlayerKey(o);
      const shouldNick =
        nick &&
        (isGuestOrPlaceholderNickname(curNick, oid) || (oid && curNick === oid));
      if (shouldNick) {
        o.nickname = nick;
      }
      const shouldNick2 =
        nick &&
        (isGuestOrPlaceholderNickname(curNick2, oid) || (oid && curNick2 === oid));
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
