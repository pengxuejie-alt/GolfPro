/**
 * 比洞顶洞规则单元测试（纯 Node，无测试框架）
 * 用法: node scripts/test-pk-tie-hole.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 与 src/utils/pkTieHole.ts 保持同步（Node 直跑 TS 需额外工具）
function applyTieHoleAdjustments(signedProfit, pkCount, collectAmount, tieHole, baseScore) {
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

// 顶平过：1 洞顶 + 帕赢 → 2 洞分，无额外加分
assertEq(
  applyTieHoleAdjustments(2, 1, 1, '顶平过', 1),
  2,
  '顶平过 par win after 1 tie'
);

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

// 加倍（含奖励）：鸟赢 2 + 收 1 顶 = 3 → ×2 = 6
assertEq(
  applyTieHoleAdjustments(3, 1, 1, '加倍（含奖励）', 1),
  6,
  '加倍（含奖励） doubles all'
);

// 加倍（不含奖励）：鸟 2 + 收顶 1 = 3，再加 base×1
assertEq(
  applyTieHoleAdjustments(3, 1, 1, '加倍（不含奖励）', 1),
  4,
  '加倍（不含奖励） doubles base only'
);

// 连续翻倍：收 2 顶 → ×4
assertEq(
  applyTieHoleAdjustments(3, 1, 2, '连续翻倍', 1),
  12,
  '连续翻倍 2^2'
);

// legacy tie_type
assertEq(resolveTieHole({ tie_type: 'add_one' }), '下洞加1分', 'resolve tie_type add_one');
assertEq(resolveTieHole({ tie_hole: '顶平过' }), '顶平过', 'resolve tie_hole');

// 源码应引用 pkTieHole
const storeSrc = readFileSync(path.join(root, 'src/store/matchStore.ts'), 'utf-8');
if (!storeSrc.includes("from '@/utils/pkTieHole'")) {
  failures.push('matchStore.ts should import pkTieHole');
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

console.info('[test-pk-tie-hole] OK', failures.length === 0 ? 'all cases passed' : '');
