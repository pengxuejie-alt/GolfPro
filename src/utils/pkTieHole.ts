/** 比洞赛顶洞规则选项（与 PKTiger / 挂洞配置一致） */
export const HOLES_TIE_HOLE_OPTIONS = [
  '顶平过',
  '下洞加1分',
  '下洞加2分',
  '下洞加3分',
  '加倍（含奖励）',
  '加倍（不含奖励）',
  '连续翻倍',
] as const;

export type TieHoleOption = (typeof HOLES_TIE_HOLE_OPTIONS)[number];

export function tieHoleLabel(rule: { tie_hole?: string; tie_type?: string } | null | undefined): string {
  return resolveTieHole(rule);
}

/** 兼容旧 tie_type 字段 */
export function resolveTieHole(rule: { tie_hole?: string; tie_type?: string } | null | undefined): string {
  const th = rule?.tie_hole != null ? String(rule.tie_hole).trim() : '';
  if (th) return th;
  const tt = rule?.tie_type;
  if (tt === 'add_one') return '下洞加1分';
  if (tt === 'add_two') return '下洞加2分';
  if (tt === 'add_three') return '下洞加3分';
  if (tt === 'double_with_reward') return '加倍（含奖励）';
  if (tt === 'double_no_reward') return '加倍（不含奖励）';
  if (tt === 'consecutive_double') return '连续翻倍';
  return '顶平过';
}

/** 加倍类顶洞：对本洞得分做倍数，不要先把挂平本金加进去再乘 */
export function isMultiplierTieHole(tieHole: string | null | undefined): boolean {
  const th = String(tieHole || '').trim();
  return th === '加倍（含奖励）' || th === '加倍（不含奖励）' || th === '连续翻倍';
}

export function computeCarryoverCollectAmount(
  carryover: number,
  winnerRel: number,
  collectTieType: string | undefined,
  skipCollect: boolean
): number {
  if (skipCollect || carryover <= 0) return 0;
  if (collectTieType === 'par_1_birdie_2_eagle_all') {
    if (winnerRel === 0) return Math.min(1, carryover);
    if (winnerRel === -1) return Math.min(2, carryover);
    if (winnerRel <= -2) return carryover;
    return carryover;
  }
  return carryover;
}

/**
 * 收顶洞后应用顶洞规则（下洞加分 / 加倍 / 连续翻倍）。
 * 下洞加 N 分：signedProfit 须已含本洞赢分 + 已收顶洞×基数。
 * 加倍（含奖励）：signedProfit 只含本洞赢分（含鸟鹰奖励），再 ×2，不要先加顶洞基数。
 */
export function applyTieHoleAdjustments(
  signedProfit: number,
  pkCount: number,
  collectAmount: number,
  tieHole: string,
  baseScore: number
): number {
  if (collectAmount <= 0 || pkCount === 0) return signedProfit;

  const th = tieHole.trim();
  const noTieBonus = th === '下洞不加分' || th === '顶平过';

  let tieBonus = 0;
  let tieMultiplier = 1;

  if (!noTieBonus && th === '下洞加1分') tieBonus = 1 * collectAmount;
  else if (!noTieBonus && th === '下洞加2分') tieBonus = 2 * collectAmount;
  else if (!noTieBonus && th === '下洞加3分') tieBonus = 3 * collectAmount;
  else if (!noTieBonus && th === '加倍（含奖励）') tieMultiplier = 2;
  else if (!noTieBonus && th === '加倍（不含奖励）') tieMultiplier = 2;
  else if (!noTieBonus && th === '连续翻倍') tieMultiplier = Math.pow(2, collectAmount);

  let result = signedProfit;
  if (!noTieBonus && th === '加倍（不含奖励）') {
    const baseProfit = pkCount * baseScore;
    result += baseProfit * (tieMultiplier - 1);
  } else if (!noTieBonus && tieMultiplier !== 1) {
    result *= tieMultiplier;
  }

  result += pkCount > 0 ? tieBonus : -tieBonus;
  return result;
}
