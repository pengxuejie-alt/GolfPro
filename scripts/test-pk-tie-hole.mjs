/**
 * 比洞顶洞规则单元测试（纯 Node，无测试框架）
 * 用法: node scripts/test-pk-tie-hole.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 与 src/utils/pkTieHole.ts 保持同步（Node 直跑 TS 需额外工具）
function tieHoleMultiplier(tieHole, collectAmount) {
  const th = String(tieHole || '').trim();
  const n = Math.max(0, Number(collectAmount) || 0);
  if (n <= 0) return 1;
  if (th === '连续翻倍') return Math.pow(2, n);
  if (th === '加倍（含奖励）' || th === '加倍（不含奖励）') return 1 + n;
  return 1;
}

function applyTieHoleAdjustments(signedProfit, pkCount, collectAmount, tieHole, baseScore) {
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
    result += pkCount * baseScore * (tieMultiplier - 1);
  } else if (!noTieBonus && tieMultiplier !== 1) {
    result *= tieMultiplier;
  }
  result += pkCount > 0 ? tieBonus : -tieBonus;
  return result;
}

function resolveTieHole(rule) {
  const th = rule?.tie_hole != null ? String(rule.tie_hole).trim() : '';
  if (th) return th;
  if (rule?.tie_type === 'add_one') return '下洞加1分';
  return '顶平过';
}

const failures = [];

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

// 顶平过若调用方已把顶洞本金算进本洞分，这里不再额外加分（挂洞结算本身不会把本金算进去）
assertEq(
  applyTieHoleAdjustments(2, 1, 1, '顶平过', 1),
  2,
  '顶平过 does not add a further bonus'
);

function isWashTieHole(tieHole) {
  const th = String(tieHole ?? '').trim();
  return th === '顶平过' || th === '下洞不加分';
}

function isMultiplierTieHole(tieHole) {
  const th = String(tieHole || '').trim();
  return th === '加倍（含奖励）' || th === '加倍（不含奖励）' || th === '连续翻倍';
}

/** 与 pkTieHole.settleMatchPlayHole 保持同步 */
function settleMatchPlayHole(input) {
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

// 挂洞顶平过：平洞后下洞只拿本洞 1 分，不再加 1
const washWin = settleMatchPlayHole({
  winSign: 1,
  carryover: 1,
  tieHole: '顶平过',
  baseScore: 1,
  holeWinVal: 1,
  collectAmount: 1,
});
assertEq(washWin.signedProfit, 1, '顶平过 next hole is base only');
assertEq(washWin.nextCarryover, 0, '顶平过 clears carry');
const washTie = settleMatchPlayHole({
  winSign: 0,
  carryover: 0,
  tieHole: '顶平过',
  baseScore: 1,
  holeWinVal: 1,
  collectAmount: 0,
});
assertEq(washTie.signedProfit, 0, '顶平过 tie scores 0');
assertEq(washTie.nextCarryover, 0, '顶平过 tie does not press');

// 下洞加1分：收 1 顶洞本金 + 再加 1
const addOne = settleMatchPlayHole({
  winSign: 1,
  carryover: 1,
  tieHole: '下洞加1分',
  baseScore: 1,
  holeWinVal: 1,
  collectAmount: 1,
});
assertEq(addOne.signedProfit, 3, '下洞加1分 collects stake and adds 1');
assertEq(addOne.nextCarryover, 0, '下洞加1分 consumes carry');

// 下洞加1分：收 1 顶洞 + 帕赢 1 → 2 + 1 bonus
assertEq(
  applyTieHoleAdjustments(2, 1, 1, '下洞加1分', 1),
  3,
  '下洞加1分 +1 after 1 collected tie'
);

// 下洞加2分
assertEq(
  applyTieHoleAdjustments(2, 1, 1, '下洞加2分', 1),
  4,
  '下洞加2分'
);

// 加倍（含奖励）：鸟赢 2 计入本洞分 3，收 1 顶 → ×(1+1)=×2 → 6
assertEq(
  applyTieHoleAdjustments(3, 1, 1, '加倍（含奖励）', 1),
  6,
  '加倍（含奖励） ×(1+1) after 1 tie'
);

// 加倍（含奖励）：顶两洞 → ×(1+2)=×3（GolfLive 斗地主）
assertEq(
  applyTieHoleAdjustments(13, 13, 2, '加倍（含奖励）', 1),
  39,
  '加倍（含奖励） ×(1+2) after 2 ties'
);

// 加倍（不含奖励）：鸟 2 + 收顶 1 = 本洞 3，再加 base×1 → 4
assertEq(
  applyTieHoleAdjustments(3, 1, 1, '加倍（不含奖励）', 1),
  4,
  '加倍（不含奖励） add base×collect after 1 tie'
);

// 加倍（不含奖励）：收 2 顶 → 追加 base×2
assertEq(
  applyTieHoleAdjustments(3, 1, 2, '加倍（不含奖励）', 1),
  5,
  '加倍（不含奖励） add base×2 after 2 ties'
);

// 连续翻倍：收 2 顶 → ×4
assertEq(
  applyTieHoleAdjustments(3, 1, 2, '连续翻倍', 1),
  12,
  '连续翻倍 2^2'
);

assertEq(tieHoleMultiplier('加倍（含奖励）', 2), 3, 'tieHoleMultiplier 含奖励 2 ties');
assertEq(tieHoleMultiplier('连续翻倍', 2), 4, 'tieHoleMultiplier 连续翻倍 2 ties');

// legacy tie_type
assertEq(resolveTieHole({ tie_type: 'add_one' }), '下洞加1分', 'resolve tie_type add_one');
assertEq(resolveTieHole({ tie_hole: '顶平过' }), '顶平过', 'resolve tie_hole');

// 源码应引用 pkTieHole / tieHoleMultiplier
const storeSrc = readFileSync(path.join(root, 'src/store/matchStore.ts'), 'utf-8');
if (!storeSrc.includes("from '@/utils/pkTieHole'")) {
  failures.push('matchStore.ts should import pkTieHole');
}
if (!storeSrc.includes('tieHoleMultiplier')) {
  failures.push('matchStore.ts should use tieHoleMultiplier for 挂8421');
}
if (!storeSrc.includes('settleMatchPlayHole') || !storeSrc.includes('isWashTieHole')) {
  failures.push('matchStore.ts should settle 挂洞 through settleMatchPlayHole / isWashTieHole');
}
const tieSrc = readFileSync(path.join(root, 'src/utils/pkTieHole.ts'), 'utf-8');
if (!tieSrc.includes('export function isWashTieHole') || !tieSrc.includes('export function settleMatchPlayHole')) {
  failures.push('pkTieHole.ts should export isWashTieHole and settleMatchPlayHole');
}
const scorecardSrc = readFileSync(path.join(root, 'src/pages/scorecard/scorecard.vue'), 'utf-8');
if (!scorecardSrc.includes('HOLES_TIE_HOLE_OPTIONS')) {
  failures.push('scorecard.vue should list HOLES_TIE_HOLE_OPTIONS');
}

if (failures.length) {
  console.error('[test-pk-tie-hole] FAILED');
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}

console.info('[test-pk-tie-hole] OK all cases passed');
