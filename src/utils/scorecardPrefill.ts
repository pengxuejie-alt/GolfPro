/**
 * 首页 → 计分页：带入已展示的球场名与同组头像，避免进页后闪回空白/未命名。
 */

import { resolvePlayerOpenId } from './fetchUserProfilesForOpenIds';
import { avatarUrlForDisplayOrEmpty } from './mpAvatarSrc';
import { setCachedAvatarDisplay } from './avatarDisplayCache';

const KEY_PREFIX = 'sc_prefill_v1_';
const MAX_AGE_MS = 5 * 60 * 1000;

export interface PrefillRosterPlayer {
  id: string;
  nickname: string;
  avatar: string;
}

export interface ScorecardPrefillPayload {
  course_name?: string;
  courseName?: string;
  title?: string;
  avatarsByOpenId: Record<string, string>;
  openIds: string[];
  rosterCount: number;
  /** 首页已展示的完整 roster，进计分页首帧即可渲染 */
  rosterPreview: PrefillRosterPlayer[];
}

function pickRosterNickname(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '球友';
  const o = raw as Record<string, unknown>;
  const nick = o.nickname ?? o.nickName;
  return nick != null && String(nick).trim() !== '' ? String(nick).trim() : '球友';
}

export function stashScorecardPrefillFromIndex(
  match: Record<string, unknown>,
  matchAvatarDisplayMap: Record<string, string>,
): void {
  const mid = String(match.match_id ?? match.id ?? '').trim();
  if (!mid) return;

  const avatarsByOpenId: Record<string, string> = {};
  const rosterPreview: PrefillRosterPlayer[] = [];
  const seen = new Set<string>();

  for (const roster of [match.user_list, match.players]) {
    if (!Array.isArray(roster)) continue;
    for (const p of roster) {
      const pid = resolvePlayerOpenId(p);
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const fromMap = matchAvatarDisplayMap[`${mid}:${pid}`];
      const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
      const raw = fromMap || String(o.avatar ?? o.avatarUrl ?? '').trim();
      const av = avatarUrlForDisplayOrEmpty(raw);
      if (av) avatarsByOpenId[pid] = av;
      rosterPreview.push({
        id: pid,
        nickname: pickRosterNickname(p),
        avatar: av || avatarUrlForDisplayOrEmpty(o.avatar ?? o.avatarUrl),
      });
    }
  }

  const openIds = rosterPreview.map((r) => r.id);
  const course = String(match.course_name ?? match.courseName ?? '').trim();
  const payload = {
    course_name: course || undefined,
    courseName: course || undefined,
    title: match.title != null ? String(match.title).trim() : undefined,
    avatarsByOpenId,
    openIds,
    rosterCount: openIds.length,
    rosterPreview,
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
    const rosterPreviewRaw = (parsed as { rosterPreview?: PrefillRosterPlayer[] }).rosterPreview;
    const rosterPreview = Array.isArray(rosterPreviewRaw)
      ? rosterPreviewRaw
          .map((row) => ({
            id: String(row?.id ?? '').trim(),
            nickname: String(row?.nickname ?? '球友').trim() || '球友',
            avatar: avatarUrlForDisplayOrEmpty(row?.avatar),
          }))
          .filter((row) => row.id)
      : [];
    return {
      course_name: (parsed as { course_name?: string }).course_name,
      courseName: (parsed as { courseName?: string }).courseName,
      title: (parsed as { title?: string }).title,
      avatarsByOpenId:
        avatarsByOpenId && typeof avatarsByOpenId === 'object' ? avatarsByOpenId : {},
      openIds: Array.isArray((parsed as { openIds?: string[] }).openIds)
        ? (parsed as { openIds: string[] }).openIds
        : rosterPreview.map((r) => r.id),
      rosterCount: Number((parsed as { rosterCount?: number }).rosterCount || rosterPreview.length),
      rosterPreview,
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
    const display = avatarUrlForDisplayOrEmpty(av);
    if (oid && display) {
      patch[oid] = display;
      setCachedAvatarDisplay(oid, display);
    }
  }
  for (const row of prefill.rosterPreview ?? []) {
    const display = avatarUrlForDisplayOrEmpty(row.avatar);
    if (row.id && display && !patch[row.id]) {
      patch[row.id] = display;
      setCachedAvatarDisplay(row.id, display);
    }
  }
  if (Object.keys(patch).length) {
    rosterDisplay.value = mergeAvatarMaps(rosterDisplay.value, patch);
  }
}
