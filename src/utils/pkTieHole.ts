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

/**
 * 顶平过 / 下洞不加分：平洞作废，不把本洞分数滚进下洞。
 * 挂洞若仍按「收顶洞本金」结算，平洞后的下一洞会多出 1 分，表现成下洞加 1 分。
 */
export function isWashTieHole(tieHole: string | null | undefined): boolean {
  const th = String(tieHole ?? '').trim();
  return th === '顶平过' || th === '下洞不加分';
}

/** 加倍类顶洞：对本洞得分做倍数，不要先把挂平本金加进去再乘 */
export function isMultiplierTieHole(tieHole: string | null | undefined): boolean {
  const th = String(tieHole || '').trim();
  return th === '加倍（含奖励）' || th === '加倍（不含奖励）' || th === '连续翻倍';
}

/**
 * 加倍/连续翻倍的倍率（斗地主 / 打老虎 / 挂8421 / 比洞 共用，避免分叉）。
 * - 加倍（含/不含奖励）：本洞 1 倍 + 每收 1 顶洞再加 1 倍 → (1 + collectAmount)
 * - 连续翻倍：2^collectAmount
 */
export function tieHoleMultiplier(tieHole: string | null | undefined, collectAmount: number): number {
  const th = String(tieHole || '').trim();
  const n = Math.max(0, Number(collectAmount) || 0);
  if (n <= 0) return 1;
  if (th === '连续翻倍') return Math.pow(2, n);
  if (th === '加倍（含奖励）' || th === '加倍（不含奖励）') return 1 + n;
  return 1;
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
 * 加倍（含奖励）：对本洞得分（含鸟鹰）× tieHoleMultiplier。
 * 加倍（不含奖励）：只对基数部分按 (倍率−1) 追加。
 * 连续翻倍：×2^collectAmount。
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
  if (!noTieBonus && th === '下洞加1分') tieBonus = 1 * collectAmount;
  else if (!noTieBonus && th === '下洞加2分') tieBonus = 2 * collectAmount;
  else if (!noTieBonus && th === '下洞加3分') tieBonus = 3 * collectAmount;

  const tieMultiplier = noTieBonus ? 1 : tieHoleMultiplier(th, collectAmount);

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

/**
 * 挂洞（比洞 1v1）单洞输赢分。
 * - 顶平过：平洞 0 分，下洞只计本洞赢分
 * - 下洞加 N：平洞滚入 1 个顶洞，赢洞时收走本金并再加 N
 * winSign：1 甲方赢，-1 乙方赢，0 平
 */
export function settleMatchPlayHole(input: {
  winSign: number;
  carryover: number;
  tieHole: string;
  baseScore: number;
  holeWinVal: number;
  collectAmount: number;
}): { signedProfit: number; nextCarryover: number } {
  const wash = isWashTieHole(input.tieHole);
  const winSign = input.winSign === 0 ? 0 : input.winSign > 0 ? 1 : -1;
  if (winSign === 0) {
    return { signedProfit: 0, nextCarryover: wash ? 0 : input.carryover + 1 };
  }
  if (wash) {
    return { signedProfit: winSign * input.holeWinVal, nextCarryover: 0 };
  }
  const collectAmount = Math.max(0, input.collectAmount);
  const th = String(input.tieHole || '').trim();
  const addCollectedBase = !isMultiplierTieHole(th);
  let signedProfit =
    winSign * input.holeWinVal + (addCollectedBase ? winSign * collectAmount * input.baseScore : 0);
  if (collectAmount > 0) {
    signedProfit = applyTieHoleAdjustments(signedProfit, winSign, collectAmount, th, input.baseScore);
  }
  return { signedProfit, nextCarryover: input.carryover - collectAmount };
}
