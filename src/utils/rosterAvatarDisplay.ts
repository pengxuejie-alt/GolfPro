/**
 * 球局 roster 头像展示：cloud:// 在他人真机上常无法直接渲染，需 getTempFileURL 换临时 https（仅内存，不写回云库）。
 */

import { batchResolveCloudFileIds, isWxCloudFileId } from './mpCloudFileUrl';
import { hydratePlayerAvatarsInMatchList, avatarUrlForDisplayOrEmpty, pickAvatarSrcForDisplay } from './mpAvatarSrc';
import { hydrateMatchListRostersFromUserProfiles } from './mpMatchListRosterHydrate';
import { getCachedAvatarDisplay, setCachedAvatarDisplay } from './avatarDisplayCache';
import {
  fetchUserProfilesForOpenIds,
  profileMapToAvatarHttps,
  resolvePlayerOpenId,
} from './fetchUserProfilesForOpenIds';

export {
  isLikelyWeChatOpenId,
  resolvePlayerOpenId,
  resolvePlayerOpenId as rosterOpenIdFromPlayer,
} from './fetchUserProfilesForOpenIds';

function collectOpenIdsFromMatchList(list: unknown[]): string[] {
  const set = new Set<string>();
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    for (const roster of [row.user_list, row.players]) {
      if (!Array.isArray(roster)) continue;
      for (const p of roster) {
        const k = resolvePlayerOpenId(p);
        if (!k || k.startsWith('temp_') || k.startsWith('virtual') || k.startsWith('anon_')) continue;
        set.add(k);
      }
    }
  }
  return [...set];
}

/** 从比赛 roster 已有 avatar（含 getMatch/listMyMatches 服务端回填的 https）种子化展示 map */
export function seedMatchListAvatarDisplayFromRosters(list: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(list)) return out;
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const mid = String(row.match_id ?? row.id ?? '').trim();
    if (!mid) continue;
    for (const roster of [row.user_list, row.players]) {
      if (!Array.isArray(roster)) continue;
      for (const p of roster) {
        const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        const pid = resolvePlayerOpenId(p);
        const av = pickAvatarSrcForDisplay(o.avatar ?? o.avatarUrl);
        if (pid && av) {
          out[`${mid}:${pid}`] = av;
          setCachedAvatarDisplay(pid, av);
        }
      }
    }
  }
  return out;
}

/**
 * 返回 key=`match_id:openId` → 可展示 https（与计分页 hydrateRosterAvatarDisplay 同链路）。
 */
export async function buildMatchListAvatarDisplayMap(list: unknown[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!Array.isArray(list) || !list.length) return out;

  const openIds = collectOpenIdsFromMatchList(list);
  const profiles = openIds.length ? await fetchUserProfilesForOpenIds(openIds) : new Map();
  const profileHttps = profileMapToAvatarHttps(profiles);

  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    const mid = String(row.match_id ?? row.id ?? '').trim();
    if (!mid) continue;
    const roster = Array.isArray(row.user_list) && row.user_list.length
      ? row.user_list
      : Array.isArray(row.players)
        ? row.players
        : [];
    const players = roster
      .map((p) => {
        const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        return {
          id: resolvePlayerOpenId(p),
          avatar: String(o.avatar ?? o.avatarUrl ?? '').trim(),
        };
      })
      .filter((p) => p.id);
    if (!players.length) continue;
    const built = await buildRosterAvatarDisplayMap(players, profileHttps);
    for (const pl of players) {
      const https = built[pl.id];
      if (https) out[`${mid}:${pl.id}`] = https;
    }
  }
  return out;
}

/** 展示层：https（含 getTempFileURL 临时链）可用；cloud:// 需先 resolve */
function pickDisplayAvatarSrc(raw: unknown): string {
  return avatarUrlForDisplayOrEmpty(raw) || pickAvatarSrcForDisplay(raw);
}

/** openId -> 可展示的 https 头像（不写回 matches / users） */
export async function buildRosterAvatarDisplayMap(
  players: Array<{ id?: string; avatar?: string }>,
  profileHttps?: Map<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const cloudIds: string[] = [];

  for (const p of players) {
    const id = String(p.id ?? '').trim();
    if (!id) continue;
    const cached = getCachedAvatarDisplay(id);
    if (cached) {
      out[id] = cached;
      continue;
    }
    const fromProfile = profileHttps?.get(id);
    const profCloud = fromProfile != null ? String(fromProfile).trim() : '';
    const profUrl = pickDisplayAvatarSrc(fromProfile);
    if (profUrl) {
      out[id] = profUrl;
      setCachedAvatarDisplay(id, profUrl, isWxCloudFileId(profCloud) ? profCloud : undefined);
      continue;
    }
    if (isWxCloudFileId(profCloud)) {
      cloudIds.push(profCloud);
    }
    const av = String(p.avatar ?? '').trim();
    const direct = pickDisplayAvatarSrc(av);
    if (direct) {
      out[id] = direct;
      setCachedAvatarDisplay(id, direct);
    } else if (isWxCloudFileId(av)) {
      cloudIds.push(av);
    }
  }

  if (!cloudIds.length) return out;

  const resolved = await batchResolveCloudFileIds(cloudIds);
  for (const p of players) {
    const id = String(p.id ?? '').trim();
    if (!id || out[id]) continue;
    const av = String(p.avatar ?? '').trim();
    if (!isWxCloudFileId(av)) continue;
    const url = resolved.get(av);
    const https = pickDisplayAvatarSrc(url);
    if (https) {
      out[id] = https;
      setCachedAvatarDisplay(id, https, av);
    } else {
      // resolve 失败时真机可直绑 cloud://
      out[id] = av;
    }
  }

  // profile 来源的 cloud://
  for (const p of players) {
    const id = String(p.id ?? '').trim();
    if (!id || out[id]) continue;
    const fromProfile = profileHttps?.get(id);
    const profCloud = fromProfile != null ? String(fromProfile).trim() : '';
    if (!isWxCloudFileId(profCloud)) continue;
    const url = resolved.get(profCloud);
    const https = pickDisplayAvatarSrc(url);
    if (https) {
      out[id] = https;
      setCachedAvatarDisplay(id, https, profCloud);
    } else {
      out[id] = profCloud;
    }
  }

  return out;
}

/** 首页比赛列表：就地解析 roster 上 cloud:// → 临时 https（仅当前会话内存） */
export async function resolveCloudAvatarsInMatchList(matches: unknown): Promise<void> {
  const list = Array.isArray(matches) ? matches : [];
  const cloudIds = new Set<string>();

  function scan(roster: unknown) {
    if (!Array.isArray(roster)) return;
    for (const raw of roster) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      for (const key of ['avatar', 'avatarUrl']) {
        const av = o[key] != null ? String(o[key]).trim() : '';
        if (isWxCloudFileId(av)) cloudIds.add(av);
      }
    }
  }

  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    scan(row.user_list);
    scan(row.players);
  }

  if (!cloudIds.size) return;

  const resolved = await batchResolveCloudFileIds([...cloudIds]);

  function apply(roster: unknown) {
    if (!Array.isArray(roster)) return;
    for (const raw of roster) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      for (const key of ['avatar', 'avatarUrl']) {
        const av = o[key] != null ? String(o[key]).trim() : '';
        if (!isWxCloudFileId(av)) continue;
        const https = pickDisplayAvatarSrc(resolved.get(av));
        if (https) {
          o.avatar = https;
          o.avatarUrl = https;
          const oid = String(
            (o as Record<string, unknown>).openid ??
              (o as Record<string, unknown>).openId ??
              (o as Record<string, unknown>).player_uid ??
              (o as Record<string, unknown>).uid ??
              (o as Record<string, unknown>).id ??
              '',
          ).trim();
          if (oid) setCachedAvatarDisplay(oid, https, av);
        }
      }
    }
  }

  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const row = m as Record<string, unknown>;
    apply(row.user_list);
    apply(row.players);
  }
}

/**
 * 比赛列表展示前：users 回填 → 去掉 DB 里已过期的 COS 链 → cloud:// 换临时 https（仅内存）。
 * 不写缓存；勿在此 strip cloud://（resolve 失败时由 mpAvatarImgSrcForDisplay 回退占位图）。
 */
export async function hydrateMatchListAvatarsForDisplay(matches: unknown): Promise<void> {
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) return;
  await hydrateMatchListRostersFromUserProfiles(list);
  await hydratePlayerAvatarsInMatchList(list);
  await resolveCloudAvatarsInMatchList(list);
}
