/**
 * 计分板 roster 行 → Player：openId 解析与 matchStore.normalizeMatchPlayer 一致。
 */

import { resolvePlayerOpenId } from './fetchUserProfilesForOpenIds';
import { GUEST_NICKNAME } from './guestNickname';

export interface RosterPlayerRow {
  id: string;
  nickname: string;
  avatar?: string;
  handicap: number | null;
}

export function rosterRowToPlayer(raw: unknown, index: number): RosterPlayerRow {
  if (!raw || typeof raw !== 'object') {
    return { id: `invalid_${index}`, nickname: '?', handicap: null };
  }
  const o = raw as Record<string, unknown>;
  const resolved = resolvePlayerOpenId(raw);
  const rawId = o.id ?? o.uid ?? o.openId ?? o.openid ?? o.player_uid;
  const id =
    resolved ||
    (rawId != null && String(rawId) !== '' ? String(rawId).trim() : '') ||
    `anon_${index}_${Math.random().toString(36).slice(2, 8)}`;
  const nick = o.nickname ?? o.nickName;
  const nickname = nick != null && String(nick).trim() !== '' ? String(nick).trim() : GUEST_NICKNAME;
  const avRaw = o.avatar ?? o.avatarUrl;
  const avatar = avRaw != null && String(avRaw).trim() !== '' ? String(avRaw).trim() : undefined;
  const rawHcp = o.handicap;
  let handicap: number | null = null;
  if (rawHcp !== '' && rawHcp !== undefined && rawHcp !== null) {
    const n = Number(rawHcp);
    handicap = Number.isFinite(n) ? n : null;
  }
  return { id, nickname, avatar, handicap };
}

export function collectOpenIdsFromRoster(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const set = new Set<string>();
  for (const p of list) {
    const id = resolvePlayerOpenId(p);
    if (id) set.add(id);
  }
  return [...set];
}

export function rosterIdsSignature(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((row, i) => rosterRowToPlayer(row, i).id)
    .filter(Boolean)
    .join('\u001f');
}
