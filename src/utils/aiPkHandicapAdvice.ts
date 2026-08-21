/**
 * 根据完赛成绩、PK 规则与 PK 得分，生成盘口/让杆参考意见（本地规则引擎，无需联网）。
 */

export interface AiHandicapPlayerInput {
  id: string;
  nickname: string;
  handicap: number | null;
}

export interface AiHandicapHoleInput {
  par: number;
  scores: number[];
}

export interface AiHandicapRuleInput {
  id: string;
  type: string;
  name: string;
  baseScore: number;
  playerIds: string[];
  summary: string;
  profitsByPlayerId: Record<string, number>;
}

export interface AiHandicapAdviceInput {
  players: AiHandicapPlayerInput[];
  holes: AiHandicapHoleInput[];
  rules: AiHandicapRuleInput[];
  isFinished: boolean;
}

export interface AiHandicapAdviceSection {
  title: string;
  lines: string[];
  tone?: 'win' | 'lose' | 'neutral' | 'tip';
}

export interface AiHandicapAdviceResult {
  ready: boolean;
  reason?: string;
  headline: string;
  sections: AiHandicapAdviceSection[];
}

function fin(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nick(players: AiHandicapPlayerInput[], id: string): string {
  return players.find((p) => p.id === id)?.nickname?.trim() || '球友';
}

function hcpLabel(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '未填';
  const n = Math.round(h * 10) / 10;
  return n > 0 ? `+${n}` : `${n}`;
}

function playedHolesForPlayer(holes: AiHandicapHoleInput[], pIdx: number): number {
  return holes.filter((h) => fin(h.scores[pIdx]) > 0).length;
}

function strokeStats(holes: AiHandicapHoleInput[], pIdx: number) {
  let strokes = 0;
  let par = 0;
  let front = 0;
  let back = 0;
  let frontPar = 0;
  let backPar = 0;
  holes.forEach((h, i) => {
    const s = fin(h.scores[pIdx]);
    if (s <= 0) return;
    const p = fin(h.par, 4) || 4;
    strokes += s;
    par += p;
    if (i < 9) {
      front += s;
      frontPar += p;
    } else {
      back += s;
      backPar += p;
    }
  });
  return {
    strokes,
    toPar: strokes - par,
    frontToPar: front - frontPar,
    backToPar: back - backPar,
    played: playedHolesForPlayer(holes, pIdx),
  };
}

function rankPlayersByProfit(
  players: AiHandicapPlayerInput[],
  profits: Record<string, number>
): { id: string; profit: number }[] {
  return players
    .map((p) => ({ id: p.id, profit: fin(profits[p.id]) }))
    .sort((a, b) => b.profit - a.profit);
}

/** 根据 PK 分差与底分，估算下次合理让杆/让洞幅度 */
function suggestHandicapAdjust(margin: number, baseScore: number, isHoles: boolean): string {
  const abs = Math.abs(margin);
  const base = Math.max(1, fin(baseScore, 1));
  if (abs < base * 0.5) return '维持平打即可';

  const unit = isHoles ? '洞' : '杆';
  let steps = Math.round(abs / (base * 2.5));
  steps = Math.min(5, Math.max(1, steps));

  if (margin > 0) return `下一场可考虑让 ${steps}${unit}，缩小差距`;
  return `下一场可考虑收 ${steps}${unit}，或维持现有让杆`;
}

function analyzeRule(
  rule: AiHandicapRuleInput,
  players: AiHandicapPlayerInput[]
): AiHandicapAdviceSection | null {
  const ranked = rankPlayersByProfit(
    players.filter((p) => rule.playerIds.length === 0 || rule.playerIds.includes(p.id)),
    rule.profitsByPlayerId
  );
  if (ranked.length === 0) return null;

  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const margin = top.profit - bottom.profit;
  const lines: string[] = [];

  if (rule.summary) lines.push(`规则：${rule.summary}`);

  if (ranked.length === 1) {
    lines.push(`${nick(players, top.id)} PK 得分 ${fmtProfit(top.profit)}`);
  } else if (ranked.length === 2) {
    const a = ranked[0];
    const b = ranked[1];
    lines.push(
      `${nick(players, a.id)} ${fmtProfit(a.profit)} vs ${nick(players, b.id)} ${fmtProfit(b.profit)}`
    );
    if (margin !== 0) {
      lines.push(
        `${nick(players, a.id)} 净赢 ${Math.abs(margin)} 点${margin >= baseThreshold(rule) ? '，优势明显' : ''}`
      );
    } else {
      lines.push('本场打平，盘口可维持不变');
    }
    if (rule.type === 'strokes' || rule.type === 'holes' || rule.type === '8421_1v1') {
      lines.push(suggestHandicapAdjust(a.profit, rule.baseScore, rule.type === 'holes'));
    }
  } else {
    const topNames = ranked.slice(0, 2).map((r) => `${nick(players, r.id)}(${fmtProfit(r.profit)})`);
    lines.push(`领先：${topNames.join('、')}`);
    if (bottom.profit < 0) {
      lines.push(`落后较多：${nick(players, bottom.id)} ${fmtProfit(bottom.profit)}`);
    }
    if (rule.type === 'landlord' || rule.type === 'tiger') {
      lines.push('多人局建议按个人累计得分差微调地主/老虎抽选权重或底分');
    }
  }

  const tone: AiHandicapAdviceSection['tone'] =
    margin >= baseThreshold(rule) ? 'win' : margin <= -baseThreshold(rule) ? 'lose' : 'neutral';

  return {
    title: rule.name || 'PK',
    lines,
    tone,
  };
}

function baseThreshold(rule: AiHandicapRuleInput): number {
  return Math.max(3, fin(rule.baseScore, 1) * 2);
}

function fmtProfit(n: number): string {
  const v = Math.round(n * 10) / 10;
  if (v > 0) return `+${v}`;
  return `${v}`;
}

function buildStrokeSection(
  players: AiHandicapPlayerInput[],
  holes: AiHandicapHoleInput[]
): AiHandicapAdviceSection {
  const stats = players.map((p, idx) => ({
    id: p.id,
    nickname: p.nickname,
    handicap: p.handicap,
    ...strokeStats(holes, idx),
  }));

  const withScores = stats.filter((s) => s.played > 0);
  const lines: string[] = [];

  if (withScores.length === 0) {
    return { title: '成绩概览', lines: ['暂无有效洞分'], tone: 'neutral' };
  }

  const byToPar = [...withScores].sort((a, b) => a.toPar - b.toPar);
  const best = byToPar[0];
  const worst = byToPar[byToPar.length - 1];
  lines.push(
    `总杆最佳：${best.nickname} ${best.toPar === 0 ? 'E' : best.toPar > 0 ? `+${best.toPar}` : best.toPar}（${best.played}洞）`
  );
  if (worst.id !== best.id && withScores.length > 1) {
    lines.push(
      `总杆落后：${worst.nickname} ${worst.toPar === 0 ? 'E' : worst.toPar > 0 ? `+${worst.toPar}` : worst.toPar}`
    );
  }

  const withHcp = withScores.filter((s) => s.handicap != null && Number.isFinite(s.handicap));
  if (withHcp.length >= 2) {
    const byNet = [...withHcp]
      .map((s) => ({ ...s, net: s.toPar - fin(s.handicap) }))
      .sort((a, b) => a.net - b.net);
    const netBest = byNet[0];
    const netWorst = byNet[byNet.length - 1];
    lines.push(
      `按差点推算净胜：${netBest.nickname} 约 ${netBest.net <= 0 ? netBest.net : `+${netBest.net}`} vs ${netWorst.nickname}`
    );
    if (netBest.id !== best.id) {
      lines.push(`说明：${best.nickname} 毛杆更好，但 ${netBest.nickname} 凭差点更占优，PK 让杆可参考此差距`);
    }
  }

  const momentum = withScores.filter((s) => s.played >= 9);
  for (const s of momentum) {
    const diff = s.backToPar - s.frontToPar;
    if (Math.abs(diff) >= 3) {
      lines.push(
        `${s.nickname} ${diff > 0 ? '后九明显走弱' : '后九明显走强'}（前九${fmtToPar(s.frontToPar)} → 后九${fmtToPar(s.backToPar)}）`
      );
    }
  }

  return { title: '成绩概览', lines, tone: 'neutral' };
}

function fmtToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

function buildOverallPkSection(
  players: AiHandicapPlayerInput[],
  rules: AiHandicapRuleInput[]
): AiHandicapAdviceSection {
  const totals: Record<string, number> = {};
  players.forEach((p) => {
    totals[p.id] = 0;
  });
  rules.forEach((r) => {
    Object.entries(r.profitsByPlayerId).forEach(([id, v]) => {
      totals[id] = fin(totals[id]) + fin(v);
    });
  });

  const ranked = rankPlayersByProfit(players, totals);
  const lines = ranked.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} ${nick(players, r.id)} 合计 ${fmtProfit(r.profit)}`;
  });

  const spread = ranked.length >= 2 ? ranked[0].profit - ranked[ranked.length - 1].profit : 0;
  if (spread >= 6) {
    lines.push(`全场 PK 分差 ${spread} 点，下一场可对落后方适当让杆或降低底分`);
  } else if (spread > 0 && spread < 3) {
    lines.push('全场 PK 咬得很紧，盘口维持现状较合理');
  }

  return { title: 'PK 总榜', lines, tone: ranked[0]?.profit > 0 ? 'win' : 'neutral' };
}

function buildTipSection(
  players: AiHandicapPlayerInput[],
  rules: AiHandicapRuleInput[],
  isFinished: boolean
): AiHandicapAdviceSection {
  const lines: string[] = [];
  if (!isFinished) {
    lines.push('球局尚未打完 18 洞，以下意见仅供中途参考');
  } else {
    lines.push('以下基于本场完赛数据生成，供下场 PK 让杆、底分调整参考');
  }

  const missingHcp = players.filter((p) => p.handicap == null).map((p) => p.nickname);
  if (missingHcp.length > 0) {
    lines.push(`差点未填：${missingHcp.join('、')}，建议补全后盘口更准确`);
  }

  const strokeRules = rules.filter((r) => r.type === 'strokes' || r.type === 'holes');
  if (strokeRules.length > 0) {
    lines.push('比杆/比洞局：优先按 PK 净胜点与总杆表现综合调整让杆');
  }
  const landlordRules = rules.filter((r) => r.type === 'landlord' || r.type === 'tiger');
  if (landlordRules.length > 0) {
    lines.push('斗地主/打老虎：可针对常胜方略提底分或减少其当地主频率');
  }

  return { title: '盘口建议', lines, tone: 'tip' };
}

export function buildAiPkHandicapAdvice(input: AiHandicapAdviceInput): AiHandicapAdviceResult {
  const { players, holes, rules, isFinished } = input;

  if (players.length < 2) {
    return {
      ready: false,
      reason: '至少需要 2 名球手',
      headline: '',
      sections: [],
    };
  }

  const anyScore = holes.some((h) => h.scores.some((s) => fin(s) > 0));
  if (!anyScore) {
    return {
      ready: false,
      reason: '暂无洞分，无法分析',
      headline: '',
      sections: [],
    };
  }

  if (rules.length === 0) {
    return {
      ready: false,
      reason: '请先设置 PK 规则',
      headline: '',
      sections: [],
    };
  }

  const minPlayed = Math.max(
    ...players.map((_, idx) => playedHolesForPlayer(holes, idx))
  );
  if (!isFinished && minPlayed < 9) {
    return {
      ready: false,
      reason: '至少完成前九后再看 AI 盘口',
      headline: '',
      sections: [],
    };
  }

  const sections: AiHandicapAdviceSection[] = [];
  sections.push(buildOverallPkSection(players, rules));
  sections.push(buildStrokeSection(players, holes));

  rules.forEach((rule) => {
    const sec = analyzeRule(rule, players);
    if (sec) sections.push(sec);
  });

  sections.push(buildTipSection(players, rules, isFinished));

  const ranked = rankPlayersByProfit(
    players,
    rules.reduce(
      (acc, r) => {
        Object.entries(r.profitsByPlayerId).forEach(([id, v]) => {
          acc[id] = fin(acc[id]) + fin(v);
        });
        return acc;
      },
      {} as Record<string, number>
    )
  );

  const leader = ranked[0];
  const headline = leader
    ? isFinished
      ? `本场 PK 领先：${nick(players, leader.id)}（${fmtProfit(leader.profit)}）`
      : `当前 PK 领先：${nick(players, leader.id)}（${fmtProfit(leader.profit)}）`
    : 'AI 盘口分析';

  return { ready: true, headline, sections };
}
