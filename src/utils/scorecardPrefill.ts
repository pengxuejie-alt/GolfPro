/**
 * 首页 / 历史 → 计分页：带入已展示的球场名、同组头像与洞分，避免进页后空等云函数。
 */

import { resolvePlayerOpenId } from './fetchUserProfilesForOpenIds';
import { avatarUrlForDisplayOrEmpty } from './mpAvatarSrc';
import { setCachedAvatarDisplay } from './avatarDisplayCache';
import { coerceRosterHandicap } from './simpleAverageHandicap';

const KEY_PREFIX = 'sc_prefill_v1_';
const MAX_AGE_MS = 5 * 60 * 1000;

export interface PrefillRosterPlayer {
  id: string;
  nickname: string;
  avatar: string;
  handicap?: number | null;
}

export interface PrefillHoleScore {
  scores: number[];
  par: number;
  scoreTs: number[];
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
  /** 与 roster 列对齐的 18 洞杆数，进页立刻上屏 */
  hole_scores: PrefillHoleScore[];
  pk_rules?: unknown[];
  status?: number;
  create_time?: unknown;
  date?: unknown;
}

function pickRosterNickname(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '球友';
  const o = raw as Record<string, unknown>;
  const nick = o.nickname ?? o.nickName;
  return nick != null && String(nick).trim() !== '' ? String(nick).trim() : '球友';
}

function cloneJson<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return v;
  }
}

export function cloneHoleScoresForPrefill(raw: unknown): PrefillHoleScore[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 18).map((h) => {
    if (!h || typeof h !== 'object') return { scores: [], par: 4, scoreTs: [] };
    const o = h as Record<string, unknown>;
    const scores = Array.isArray(o.scores) ? o.scores.map((n) => Number(n) || 0) : [];
    const par = typeof o.par === 'number' && Number.isFinite(o.par) ? o.par : 4;
    const tsRaw = Array.isArray(o.scoreTs) ? o.scoreTs : Array.isArray(o.score_ts) ? o.score_ts : [];
    const scoreTs = tsRaw.map((n) => Number(n) || 0);
    while (scoreTs.length < scores.length) scoreTs.push(0);
    return { scores, par, scoreTs: scoreTs.slice(0, scores.length) };
  });
}

export function stashScorecardPrefillFromIndex(
  match: Record<string, unknown>,
  matchAvatarDisplayMap: Record<string, string> = {},
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
        handicap: coerceRosterHandicap(o.handicap),
      });
    }
  }

  const openIds = rosterPreview.map((r) => r.id);
  const course = String(match.course_name ?? match.courseName ?? '').trim();
  const holeRaw = match.hole_scores ?? match.scores;
  const pk = match.pk_rules ?? match.pk_results;
  const payload = {
    course_name: course || undefined,
    courseName: course || undefined,
    title: match.title != null ? String(match.title).trim() : undefined,
    avatarsByOpenId,
    openIds,
    rosterCount: openIds.length,
    rosterPreview,
    hole_scores: cloneHoleScoresForPrefill(holeRaw),
    pk_rules: Array.isArray(pk) ? cloneJson(pk) : undefined,
    status: match.status != null ? Number(match.status) : undefined,
    create_time: match.create_time ?? match.created_at ?? match.date,
    date: match.date,
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
            handicap: coerceRosterHandicap((row as PrefillRosterPlayer)?.handicap),
          }))
          .filter((row) => row.id)
      : [];
    const holeRaw = (parsed as { hole_scores?: unknown; scores?: unknown }).hole_scores
      ?? (parsed as { scores?: unknown }).scores;
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
      hole_scores: cloneHoleScoresForPrefill(holeRaw),
      pk_rules: Array.isArray((parsed as { pk_rules?: unknown[] }).pk_rules)
        ? (parsed as { pk_rules: unknown[] }).pk_rules
        : undefined,
      status: (parsed as { status?: number }).status,
      create_time: (parsed as { create_time?: unknown }).create_time,
      date: (parsed as { date?: unknown }).date,
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

/** 把 prefill 拼成可供 initMatch 的局对象（无本机缓存时） */
export function buildMatchStubFromPrefill(
  mid: string,
  prefill: ScorecardPrefillPayload,
): Record<string, unknown> {
  const course = String(prefill.course_name ?? prefill.courseName ?? '').trim();
  const user_list = (prefill.rosterPreview || []).map((row) => ({
    id: row.id,
    uid: row.id,
    openId: row.id,
    openid: row.id,
    nickname: row.nickname,
    nickName: row.nickname,
    avatar: row.avatar,
    avatarUrl: row.avatar,
    handicap: row.handicap ?? null,
  }));
  return {
    match_id: mid,
    course_name: course || undefined,
    courseName: course || undefined,
    title: prefill.title,
    user_list,
    players: user_list,
    hole_scores: cloneHoleScoresForPrefill(prefill.hole_scores),
    pk_rules: Array.isArray(prefill.pk_rules) ? cloneJson(prefill.pk_rules) : undefined,
    status: prefill.status,
    create_time: prefill.create_time ?? prefill.date,
    date: prefill.date,
  };
}
