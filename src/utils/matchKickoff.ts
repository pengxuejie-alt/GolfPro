/**
 * 比赛「开球/设定开赛时间」与列表策略：展示与排序均以开球时刻为准，不用最后编辑时间。
 */

export const MATCH_KICKOFF_AUTO_END_MS = 48 * 60 * 60 * 1000;

function primitiveToMs(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return null;
  }
  if (typeof v === 'object' && v !== null && '_seconds' in (v as object)) {
    const sec = Number((v as { _seconds?: number })._seconds);
    return Number.isFinite(sec) ? sec * 1000 : null;
  }
  return null;
}

/**
 * 开球时刻（ms）。优先级：创建页写入的 create_time → 云上 date → created_at，
 * 不含 updated_at（避免「最后改分」被当成开赛时间）。
 */
export function kickoffTimeMs(match: unknown): number | null {
  if (match == null || typeof match !== 'object') return null;
  const m = match as Record<string, unknown>;
  for (const key of ['create_time', 'date', 'created_at', 'createdAt'] as const) {
    const ms = primitiveToMs(m[key]);
    if (ms != null && Number.isFinite(ms)) return ms;
  }
  return null;
}

/** 列表合并排序：优先开球；没有则退回 updated_at/create_time（与旧逻辑兼容） */
export function matchListSortTimeMs(match: unknown): number {
  const k = kickoffTimeMs(match);
  if (k != null && Number.isFinite(k)) return k;
  if (match == null || typeof match !== 'object') return 0;
  const doc = match as Record<string, unknown>;
  const u = doc.updated_at ?? doc.updatedAt;
  const ums = primitiveToMs(u);
  if (ums != null) return ums;
  const ct = primitiveToMs(doc.create_time ?? doc.created_at ?? doc.date);
  if (ct != null) return ct;
  return 0;
}

export function formatMatchKickoffCn(match: unknown, dateOnly = false): string {
  const ms = kickoffTimeMs(match);
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  if (dateOnly) return `${y}年${mo}月${day}日`;
  const h = d.getHours();
  const mi = d.getMinutes();
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${y}年${mo}月${day}日 ${pad(h)}时${pad(mi)}分`;
}

function matchHasPositiveStroke(match: unknown): boolean {
  if (match == null || typeof match !== 'object') return false;
  const hs = (match as { hole_scores?: unknown; scores?: unknown }).hole_scores;
  const scores = Array.isArray(hs) ? hs : [];
  const alt = (match as { scores?: unknown[] }).scores;
  const list = scores.length ? scores : Array.isArray(alt) ? alt : [];
  for (const hole of list) {
    const arr = (hole as { scores?: unknown[] })?.scores;
    if (!Array.isArray(arr)) continue;
    if (arr.some((s) => Number(s) > 0)) return true;
  }
  return false;
}

/**
 * 进行中/待开始球局：自开球时刻起已满 48h 视为自动结束。
 * 「已开始」：status===1（进行中），或 status===0 但已有任一洞有效杆数。
 */
export function shouldAutoEndByKickoffTtl(match: unknown): boolean {
  if (match == null || typeof match !== 'object') return false;
  const m = match as Record<string, unknown>;
  const st = Number(m.status ?? 1);
  if (st === 2) return false;
  const k = kickoffTimeMs(match);
  if (k == null || !Number.isFinite(k)) return false;
  if (Date.now() < k + MATCH_KICKOFF_AUTO_END_MS) return false;
  if (st === 1) return true;
  if (st === 0 && matchHasPositiveStroke(match)) return true;
  return false;
}
