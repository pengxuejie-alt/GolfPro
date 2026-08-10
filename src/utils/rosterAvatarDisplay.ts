/**
 * 球局 roster 头像展示：cloud:// 在他人真机上常无法直接渲染，需 getTempFileURL 换临时 https（仅内存，不写回云库）。
 */

import { batchResolveCloudFileIds, isWxCloudFileId } from './mpCloudFileUrl';
import { looksLikeExpiredProneTencentTempHttps } from './mpAvatarSrc';

export function isLikelyWeChatOpenId(s: unknown): boolean {
  const t = String(s ?? '').trim();
  return /^o[A-Za-z0-9_-]{10,}$/.test(t);
}

function pickShareableHttps(raw: unknown): string {
  const s = raw != null ? String(raw).trim() : '';
  if (!s || !s.startsWith('https://')) return '';
  if (looksLikeExpiredProneTencentTempHttps(s)) return '';
  return s;
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
    const fromProfile = profileHttps?.get(id);
    const profUrl = pickShareableHttps(fromProfile);
    if (profUrl) {
      out[id] = profUrl;
      continue;
    }
    const av = String(p.avatar ?? '').trim();
    const direct = pickShareableHttps(av);
    if (direct) {
      out[id] = direct;
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
    const https = pickShareableHttps(url);
    if (https) out[id] = https;
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
        const https = pickShareableHttps(resolved.get(av));
        if (https) {
          o.avatar = https;
          o.avatarUrl = https;
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
