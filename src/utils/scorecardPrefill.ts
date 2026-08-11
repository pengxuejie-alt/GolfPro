/**
 * 首页 → 计分页：带入已展示的球场名与同组头像，避免进页后闪回空白/未命名。
 */

import { resolvePlayerOpenId } from './fetchUserProfilesForOpenIds';
import { pickAvatarSrcForDisplay } from './mpAvatarSrc';
import { setCachedAvatarDisplay } from './avatarDisplayCache';

const KEY_PREFIX = 'sc_prefill_v1_';
const MAX_AGE_MS = 5 * 60 * 1000;

export interface ScorecardPrefillPayload {
  course_name?: string;
  courseName?: string;
  title?: string;
  avatarsByOpenId: Record<string, string>;
  openIds: string[];
  rosterCount: number;
}

export function stashScorecardPrefillFromIndex(
  match: Record<string, unknown>,
  matchAvatarDisplayMap: Record<string, string>,
): void {
  const mid = String(match.match_id ?? match.id ?? '').trim();
  if (!mid) return;

  const avatarsByOpenId: Record<string, string> = {};
  for (const roster of [match.user_list, match.players]) {
    if (!Array.isArray(roster)) continue;
    for (const p of roster) {
      const pid = resolvePlayerOpenId(p);
      if (!pid) continue;
      const fromMap = matchAvatarDisplayMap[`${mid}:${pid}`];
      const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      const raw = fromMap || String(o.avatar ?? o.avatarUrl ?? '').trim();
      const av = pickAvatarSrcForDisplay(raw);
      if (av) avatarsByOpenId[pid] = av;
    }
  }

  const openIds: string[] = [];
  for (const roster of [match.user_list, match.players]) {
    if (!Array.isArray(roster)) continue;
    for (const p of roster) {
      const pid = resolvePlayerOpenId(p);
      if (pid && !openIds.includes(pid)) openIds.push(pid);
    }
  }

  const course = String(match.course_name ?? match.courseName ?? '').trim();
  const payload = {
    course_name: course || undefined,
    courseName: course || undefined,
    title: match.title != null ? String(match.title).trim() : undefined,
    avatarsByOpenId,
    openIds,
    rosterCount: openIds.length,
    at: Date.now(),
  };

  try {
    uni.setStorageSync(`${KEY_PREFIX}${mid}`, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function consumeScorecardPrefill(mid: string): ScorecardPrefillPayload | null {
  const id = String(mid || '').trim();
  if (!id) return null;
  try {
    const raw = uni.getStorageSync(`${KEY_PREFIX}${id}`);
    uni.removeStorageSync(`${KEY_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    const at = Number((parsed as { at?: number }).at || 0);
    if (at > 0 && Date.now() - at > MAX_AGE_MS) return null;
    const avatarsByOpenId =
      (parsed as { avatarsByOpenId?: Record<string, string> }).avatarsByOpenId ?? {};
    return {
      course_name: (parsed as { course_name?: string }).course_name,
      courseName: (parsed as { courseName?: string }).courseName,
      title: (parsed as { title?: string }).title,
      avatarsByOpenId:
        avatarsByOpenId && typeof avatarsByOpenId === 'object' ? avatarsByOpenId : {},
      openIds: Array.isArray((parsed as { openIds?: string[] }).openIds)
        ? (parsed as { openIds: string[] }).openIds
        : [],
      rosterCount: Number((parsed as { rosterCount?: number }).rosterCount || 0),
    };
  } catch {
    return null;
  }
}

export function applyScorecardPrefillToDisplay(
  mid: string,
  prefill: ScorecardPrefillPayload,
  stickyCourse: Record<string, string>,
  mergeAvatarMaps: (
    base: Record<string, string>,
    patch: Record<string, string>,
  ) => Record<string, string>,
  rosterDisplay: { value: Record<string, string> },
): void {
  const course = String(prefill.course_name ?? prefill.courseName ?? '').trim();
  if (course) stickyCourse[mid] = course;

  const patch: Record<string, string> = {};
  for (const [oid, av] of Object.entries(prefill.avatarsByOpenId)) {
    const display = pickAvatarSrcForDisplay(av);
    if (oid && display) {
      patch[oid] = display;
      setCachedAvatarDisplay(oid, display);
    }
  }
  if (Object.keys(patch).length) {
    rosterDisplay.value = mergeAvatarMaps(rosterDisplay.value, patch);
  }
}
