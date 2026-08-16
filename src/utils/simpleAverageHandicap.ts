/**
 * 简易平均差点：完赛场次 (总杆 - 72) 的均值。
 * 与首页 / 我的页统计一致；写入 profile 后供计分卡展示。
 */

export type MatchLikeForHandicap = {
  hole_scores?: Array<{ scores?: unknown[] } | null> | null;
  scores?: Array<{ scores?: unknown[] } | null> | null;
};

/** roster/云库系统默认 0、旧版占位 12.5 → null（未填写） */
export function coerceRosterHandicap(h: unknown): number | null {
  if (h === null || h === undefined) return null;
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  if (n === 0 || n === 12.5) return null;
  return n;
}

/**
 * profile 中已同步的差点（完赛均值），允许真实 0。
 * null / 12.5 仍视为未知。
 */
export function coerceProfileHandicap(h: unknown): number | null {
  if (h === null || h === undefined) return null;
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  if (n === 12.5) return null;
  return n;
}

/**
 * @returns 有完赛场次时返回数值（可含 0）；否则 null
 */
export function computeSimpleAverageHandicap(
  matches: MatchLikeForHandicap[] | null | undefined,
  options?: { maxScan?: number },
): number | null {
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const maxScan = options?.maxScan != null && options.maxScan > 0 ? options.maxScan : matches.length;
  const slice = matches.slice(0, maxScan);

  const completed: MatchLikeForHandicap[] = [];
  for (const m of slice) {
    if (!m || typeof m !== 'object') continue;
    const holeScores = Array.isArray(m.hole_scores)
      ? m.hole_scores
      : Array.isArray(m.scores)
        ? m.scores
        : [];
    if (holeScores.length < 18) continue;
    let ok = 0;
    for (let i = 0; i < 18; i++) {
      const h = holeScores[i];
      if (!h || !Array.isArray(h.scores)) continue;
      if (h.scores.some((s) => Number(s) > 0)) ok++;
    }
    if (ok >= 18) completed.push(m);
  }
  if (completed.length === 0) return null;

  let total = 0;
  for (const m of completed) {
    const holeScores = Array.isArray(m.hole_scores)
      ? m.hole_scores
      : Array.isArray(m.scores)
        ? m.scores
        : [];
    let sum = 0;
    for (let i = 0; i < holeScores.length; i++) {
      const h = holeScores[i];
      sum += h?.scores?.[0] != null ? Number(h.scores[0]) : 0;
    }
    total += sum - 72;
  }
  const avg = total / completed.length;
  return Math.round(avg * 10) / 10;
}

/** 将完赛均值写入本地 profile（含真实 0） */
export function syncProfileHandicapFromMatches(
  updateProfile: (partial: { handicap: number | null }) => void,
  matches: MatchLikeForHandicap[] | null | undefined,
  options?: { maxScan?: number },
): number | null {
  const avg = computeSimpleAverageHandicap(matches, options);
  if (avg == null) return null;
  updateProfile({ handicap: avg });
  return avg;
}

/** 计分卡球员列文案；传入已解析的有效差点 */
export function formatHandicapLabel(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(Number(h))) return '差点：未知';
  if (h === 12.5) return '差点：未知';
  return String(h);
}
