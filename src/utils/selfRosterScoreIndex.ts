import { resolvePlayerOpenId } from './fetchUserProfilesForOpenIds';

/** 当前用户在这场名单中的成绩列。不在名单里返回 -1，避免误用第一人的杆数。 */
export function selfRosterScoreIndex(match: unknown, openId: unknown): number {
  const oid = String(openId ?? '').trim();
  if (!oid || !match || typeof match !== 'object') return -1;
  const m = match as Record<string, unknown>;
  const roster = Array.isArray(m.user_list)
    ? m.user_list
    : Array.isArray(m.players)
      ? m.players
      : [];
  return roster.findIndex((p) => {
    if (!p || typeof p !== 'object') return false;
    const resolved = resolvePlayerOpenId(p);
    const id = String((p as { id?: unknown }).id ?? '').trim();
    return (resolved !== '' && resolved === oid) || id === oid;
  });
}
