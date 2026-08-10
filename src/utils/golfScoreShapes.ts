/**
 * 计分格杆差符号（与气氛海报 canvas 一致）：
 * 低于标准杆（任意负杆差）：红实心圆 + 白字；Par 无框黑字；+1 单方框；+2 及以上双方框（嵌套正方形）。
 */
export type GolfHoleMarkKind =
  | 'empty'
  | 'under_two' // ≤ -2
  | 'birdie' // -1
  | 'par'
  | 'bogey' // +1
  | 'over_two'; // +2 及以上

export function golfHoleMarkKind(score: number, par: number): GolfHoleMarkKind {
  if (score == null || !Number.isFinite(score) || score <= 0) return 'empty';
  const d = score - Number(par ?? 4);
  if (d <= -2) return 'under_two';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  return 'over_two';
}

/** 计分格 class（负杆差实心圆、+2+ 双方框由模板处理，此处不包含 birdie / under_two / over_two） */
export function golfScoreCellMarkClasses(score: number, par: number): string {
  const k = golfHoleMarkKind(score, par);
  if (k === 'empty') return 'sc-mark-empty';
  if (k === 'under_two' || k === 'birdie' || k === 'over_two') return '';
  return `sc-mark sc-mark-${k}`;
}
