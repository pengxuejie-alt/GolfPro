/**
 * 首页 / 列表：比赛行里 roster 头像常为空，计分页会 hydrate users；此处对「多场比赛列表」批量拉 users 回填。
 */

import { looksLikeExpiredProneTencentTempHttps } from './mpAvatarSrc';
import { isGuestOrPlaceholderNickname } from './guestNickname';
import { setCachedAvatarDisplay } from './avatarDisplayCache';
import {
  fetchUserProfilesForOpenIds,
  resolvePlayerOpenId,
} from './fetchUserProfilesForOpenIds';

function rosterAvatarForMerge(raw: unknown): string {
  const s = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '';
  if (!s) return '';
  if (s.startsWith('cloud://')) return s;
  if (looksLikeExpiredProneTencentTempHttps(s)) return '';
  return s;
}

function collectOpenIdsFromMatches(matches: unknown[]): string[] {
  const set = new Set<string>();
  for (const m of matches) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const roster = row.user_list ?? row.players ?? [];
    if (!Array.isArray(roster)) continue;
    for (const p of roster) {
      const k = resolvePlayerOpenId(p);
      if (k) set.add(k);
    }
  }
  return [...set];
}

function isShareableHttpsAvatar(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('wxfile://') || u.startsWith('file://') || u.startsWith('http://tmp')) return false;
  return true;
}

function applyProfilesToRoster(
  roster: unknown,
  profiles: Map<string, { nickName: string; avatarUrl: string }>,
): void {
  if (!Array.isArray(roster)) return;
  for (const raw of roster) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const oid = resolvePlayerOpenId(raw);
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
      if (shouldNick) o.nickname = nick;
      const shouldNick2 =
        nick && (isGuestOrPlaceholderNickname(curNick2, oid) || (oid && curNick2 === oid));
      if (shouldNick2) o.nickName = nick;
    }
  }
}

export async function hydrateMatchListRostersFromUserProfiles(matches: unknown): Promise<void> {
  const list = Array.isArray(matches) ? matches : [];
  const ids = collectOpenIdsFromMatches(list);
  if (!ids.length) return;
  const profiles = await fetchUserProfilesForOpenIds(ids);
  if (profiles.size === 0) return;

  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    applyProfilesToRoster(row.user_list, profiles);
    applyProfilesToRoster(row.players, profiles);
  }
}
