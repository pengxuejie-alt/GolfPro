/**
 * AI 盘口：近三场差点 / 本场结果两种模式，输出单挂、打老虎、斗地主建议。
 */

export type AiHandicapMode = 'recent3' | 'current';

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

/** 某球员近几场完赛的 (总杆 - 72) */
export interface AiPlayerRecentHandicap {
  avg: number | null;
  sampleCount: number;
  values: number[];
  source: 'recent' | 'roster' | 'none';
}

export interface AiHandicapAdviceInput {
  mode: AiHandicapMode;
  players: AiHandicapPlayerInput[];
  holes: AiHandicapHoleInput[];
  rules: AiHandicapRuleInput[];
  isFinished: boolean;
  recentHandicaps?: Record<string, AiPlayerRecentHandicap>;
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

export type MatchLikeForRecentHcp = {
  match_id?: string | number;
  _id?: string | number;
  id?: string | number;
  status?: number;
  kickoff_time?: string | number;
  updated_at?: string | number;
  created_at?: string | number;
  user_list?: Array<{ id?: string; uid?: string; openId?: string; handicap?: number | null } | null> | null;
  hole_scores?: Array<{ scores?: unknown[]; par?: number } | null> | null;
  scores?: Array<{ scores?: unknown[]; par?: number } | null> | null;
};

function fin(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nick(players: AiHandicapPlayerInput[], id: string): string {
  return players.find((p) => p.id === id)?.nickname?.trim() || '球友';
}

function hcpLabel(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '未知';
  const n = Math.round(h * 10) / 10;
  return n > 0 ? `+${n}` : `${n}`;
}

function matchIdOf(m: MatchLikeForRecentHcp): string {
  const raw = m.match_id ?? m._id ?? m.id;
  return raw != null ? String(raw).trim() : '';
}

function playerIdOf(u: { id?: string; uid?: string; openId?: string } | null | undefined): string {
  if (!u) return '';
  return String(u.id ?? u.uid ?? u.openId ?? '').trim();
}

function isCompletedMatch(m: MatchLikeForRecentHcp): boolean {
  if (m.status === 2) return true;
  const holeScores = Array.isArray(m.hole_scores)
    ? m.hole_scores
    : Array.isArray(m.scores)
      ? m.scores
      : [];
  if (holeScores.length < 18) return false;
  let ok = 0;
  for (let i = 0; i < 18; i++) {
    const h = holeScores[i];
    if (!h || !Array.isArray(h.scores)) continue;
    if (h.scores.some((s) => fin(s) > 0)) ok++;
  }
  return ok >= 18;
}

function matchSortTs(m: MatchLikeForRecentHcp): number {
  const raw = m.kickoff_time ?? m.updated_at ?? m.created_at;
  const t = raw != null ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function strokesMinus72ForPlayer(m: MatchLikeForRecentHcp, playerId: string): number | null {
  const roster = Array.isArray(m.user_list) ? m.user_list : [];
  const pIdx = roster.findIndex((u) => playerIdOf(u) === playerId);
  if (pIdx < 0) return null;
  const holeScores = Array.isArray(m.hole_scores)
    ? m.hole_scores
    : Array.isArray(m.scores)
      ? m.scores
      : [];
  if (holeScores.length < 18) return null;
  let sum = 0;
  let played = 0;
  for (let i = 0; i < 18; i++) {
    const h = holeScores[i];
    const s = fin(h?.scores?.[pIdx]);
    if (s <= 0) return null;
    sum += s;
    played++;
  }
  if (played < 18) return null;
  return Math.round((sum - 72) * 10) / 10;
}

/** 从比赛列表提取各球员近 N 场完赛差点（总杆-72 均值） */
export function computeRecentHandicapsForPlayers(
  matches: MatchLikeForRecentHcp[] | null | undefined,
  players: AiHandicapPlayerInput[],
  options?: { maxMatches?: number; excludeMatchId?: string },
): Record<string, AiPlayerRecentHandicap> {
  const maxN = options?.maxMatches ?? 3;
  const exclude = options?.excludeMatchId?.trim() || '';
  const list = Array.isArray(matches) ? matches : [];
  const completed = list
    .filter((m) => isCompletedMatch(m))
    .filter((m) => !exclude || matchIdOf(m) !== exclude)
    .sort((a, b) => matchSortTs(b) - matchSortTs(a));

  const out: Record<string, AiPlayerRecentHandicap> = {};
  for (const p of players) {
    const values: number[] = [];
    for (const m of completed) {
      if (values.length >= maxN) break;
      const roster = Array.isArray(m.user_list) ? m.user_list : [];
      if (!roster.some((u) => playerIdOf(u) === p.id)) continue;
      const v = strokesMinus72ForPlayer(m, p.id);
      if (v != null) values.push(v);
    }

    let avg: number | null = null;
    let source: AiPlayerRecentHandicap['source'] = 'none';
    if (values.length > 0) {
      avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
      source = 'recent';
    } else if (p.handicap != null && Number.isFinite(p.handicap)) {
      avg = p.handicap;
      source = 'roster';
    }

    out[p.id] = { avg, sampleCount: values.length, values, source };
  }
  return out;
}

function effectiveHcp(
  p: AiHandicapPlayerInput,
  recent?: Record<string, AiPlayerRecentHandicap>,
): number | null {
  const r = recent?.[p.id];
  if (r?.avg != null && Number.isFinite(r.avg)) return r.avg;
  if (p.handicap != null && Number.isFinite(p.handicap)) return p.handicap;
  return null;
}

function rankByHcp(
  players: AiHandicapPlayerInput[],
  recent?: Record<string, AiPlayerRecentHandicap>,
): Array<{ id: string; nickname: string; hcp: number }> {
  return players
    .map((p) => ({ id: p.id, nickname: p.nickname, hcp: effectiveHcp(p, recent) }))
    .filter((x): x is { id: string; nickname: string; hcp: number } => x.hcp != null)
    .sort((a, b) => a.hcp - b.hcp);
}

function strokeLetBetween(betterHcp: number, worseHcp: number): number {
  const diff = worseHcp - betterHcp;
  if (diff <= 0.5) return 0;
  return Math.min(18, Math.max(1, Math.round(diff / 2)));
}

function playedHolesForPlayer(holes: AiHandicapHoleInput[], pIdx: number): number {
  return holes.filter((h) => fin(h.scores[pIdx]) > 0).length;
}

function strokeStats(holes: AiHandicapHoleInput[], pIdx: number) {
  let strokes = 0;
  let par = 0;
  holes.forEach((h) => {
    const s = fin(h.scores[pIdx]);
    if (s <= 0) return;
    strokes += s;
    par += fin(h.par, 4) || 4;
  });
  return { strokes, toPar: strokes - par, played: playedHolesForPlayer(holes, pIdx) };
}

function rankPlayersByProfit(
  players: AiHandicapPlayerInput[],
  profits: Record<string, number>,
): { id: string; profit: number }[] {
  return players
    .map((p) => ({ id: p.id, profit: fin(profits[p.id]) }))
    .sort((a, b) => b.profit - a.profit);
}

function fmtProfit(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : `${v}`;
}

function fmtToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

function ruleProfitsForType(rules: AiHandicapRuleInput[], type: string): Record<string, number> {
  const totals: Record<string, number> = {};
  rules
    .filter((r) => r.type === type)
    .forEach((r) => {
      Object.entries(r.profitsByPlayerId).forEach(([id, v]) => {
        totals[id] = fin(totals[id]) + fin(v);
      });
    });
  return totals;
}

function buildHandicapRefSection(
  mode: AiHandicapMode,
  players: AiHandicapPlayerInput[],
  recent?: Record<string, AiPlayerRecentHandicap>,
): AiHandicapAdviceSection {
  const lines: string[] = [];
  if (mode === 'recent3') {
    lines.push('参考各球手近三场完赛差点（总杆−72 均值，不足三场用 roster 差点补）');
    for (const p of players) {
      const r = recent?.[p.id];
      if (r?.source === 'recent' && r.sampleCount > 0) {
        const vals = r.values.map((v) => hcpLabel(v)).join('、');
        lines.push(`${p.nickname}：近${r.sampleCount}场 ${vals}，均值 ${hcpLabel(r.avg)}`);
      } else if (r?.avg != null) {
        lines.push(`${p.nickname}：暂无近三场，用 roster 差点 ${hcpLabel(r.avg)}`);
      } else {
        lines.push(`${p.nickname}：差点未知，建议补全`);
      }
    }
  } else {
    lines.push('参考本场总杆相对标准杆表现（结合 roster 差点）');
    players.forEach((p, idx) => {
      lines.push(`${p.nickname}：roster 差点 ${hcpLabel(p.handicap)}`);
    });
  }
  return { title: mode === 'recent3' ? '差点参考' : '球员参考', lines, tone: 'neutral' };
}

/** 单挂：比杆 1v1 让杆建议 */
function buildDanGuaSection(
  mode: AiHandicapMode,
  players: AiHandicapPlayerInput[],
  holes: AiHandicapHoleInput[],
  rules: AiHandicapRuleInput[],
  recent?: Record<string, AiPlayerRecentHandicap>,
): AiHandicapAdviceSection {
  const lines: string[] = [];
  const strokeRules = rules.filter((r) => r.type === 'strokes' || r.type === '8421_1v1');

  if (mode === 'recent3') {
    const ranked = rankByHcp(players, recent);
    if (ranked.length < 2) {
      return { title: '单挂', lines: ['至少两名球手有有效差点，才能设计单挂盘口'], tone: 'tip' };
    }

    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const a = ranked[i];
        const b = ranked[j];
        const letStrokes = strokeLetBetween(a.hcp, b.hcp);
        if (letStrokes === 0) {
          lines.push(`${a.nickname} vs ${b.nickname}：差点接近（${hcpLabel(a.hcp)} / ${hcpLabel(b.hcp)}），建议平打`);
        } else {
          lines.push(
            `${a.nickname} vs ${b.nickname}：${a.nickname} 让 ${b.nickname} ${letStrokes} 杆（差点 ${hcpLabel(a.hcp)} vs ${hcpLabel(b.hcp)}）`
          );
        }
      }
    }

    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    if (ranked.length >= 3) {
      lines.push(`多人局优先拆对：最强 ${best.nickname} 对最弱 ${worst.nickname} 拉开让杆，中间档互挂`);
    }
  } else {
    const danGuaProfits = ruleProfitsForType(rules, 'strokes');
    const hasStrokeRule = strokeRules.length > 0;

    players.forEach((p, idx) => {
      const st = strokeStats(holes, idx);
      if (st.played === 0) return;
      const net = st.toPar - fin(effectiveHcp(p, recent));
      lines.push(`${p.nickname}：本场 ${fmtToPar(st.toPar)}，折算净表现约 ${fmtToPar(Math.round(net))}`);
    });

    if (hasStrokeRule) {
      strokeRules.forEach((rule) => {
        const ids = rule.playerIds.length >= 2 ? rule.playerIds : players.map((p) => p.id).slice(0, 2);
        if (ids.length < 2) return;
        const ranked = rankPlayersByProfit(players, rule.profitsByPlayerId).filter((r) => ids.includes(r.id));
        if (ranked.length < 2) return;
        const winner = ranked[0];
        const loser = ranked[ranked.length - 1];
        const margin = winner.profit - loser.profit;
        const letStrokes = margin <= 0 ? 0 : Math.min(5, Math.max(1, Math.round(margin / Math.max(1, rule.baseScore * 2))));
        if (margin === 0) {
          lines.push(`${nick(players, ids[0])} vs ${nick(players, ids[1])}：本场单挂打平，下场维持平打`);
        } else {
          lines.push(
            `${nick(players, winner.id)} vs ${nick(players, loser.id)}：本场 ${nick(players, winner.id)} 赢 ${Math.abs(margin)} 点 → 下场 ${letStrokes > 0 ? `${nick(players, loser.id)} 可少让 ${letStrokes} 杆或维持` : '维持平打'}`
          );
        }
      });
    } else {
      const byToPar = players
        .map((p, idx) => ({ id: p.id, nickname: p.nickname, ...strokeStats(holes, idx) }))
        .filter((s) => s.played > 0)
        .sort((a, b) => a.toPar - b.toPar);
      if (byToPar.length >= 2) {
        const a = byToPar[0];
        const b = byToPar[byToPar.length - 1];
        const hcpA = effectiveHcp(players.find((p) => p.id === a.id)!, recent);
        const hcpB = effectiveHcp(players.find((p) => p.id === b.id)!, recent);
        if (hcpA != null && hcpB != null) {
          const adj = strokeLetBetween(hcpA, hcpB);
          const better = hcpA <= hcpB ? a : b;
          const worse = hcpA <= hcpB ? b : a;
          lines.push(
            adj === 0
              ? `${better.nickname} vs ${worse.nickname}：本场与差点均接近，建议平打单挂`
              : `${better.nickname} vs ${worse.nickname}：建议 ${better.nickname} 让 ${worse.nickname} ${adj} 杆`
          );
        }
      }
    }
  }

  if (lines.length === 0) {
    lines.push('暂无足够数据，请先完成洞分或补全差点');
  }

  return { title: '单挂', lines, tone: 'tip' };
}

/** 打老虎：最好成绩 PK 老虎 */
function buildTigerSection(
  mode: AiHandicapMode,
  players: AiHandicapPlayerInput[],
  holes: AiHandicapHoleInput[],
  rules: AiHandicapRuleInput[],
  recent?: Record<string, AiPlayerRecentHandicap>,
): AiHandicapAdviceSection {
  const lines: string[] = [];
  const tigerRules = rules.filter((r) => r.type === 'tiger');
  const tigerProfits = ruleProfitsForType(rules, 'tiger');

  if (mode === 'recent3') {
    const ranked = rankByHcp(players, recent);
    if (ranked.length === 0) {
      return { title: '打老虎', lines: ['暂无有效差点，无法设计老虎盘口'], tone: 'tip' };
    }
    const tiger = ranked[0];
    const weak = ranked[ranked.length - 1];
    lines.push(`${tiger.nickname} 近三场表现最好（${hcpLabel(tiger.hcp)}），适合作「老虎」基准`);
    if (ranked.length >= 2) {
      const letStrokes = strokeLetBetween(tiger.hcp, weak.hcp);
      if (letStrokes > 0) {
        lines.push(`老虎 ${tiger.nickname} 对 ${weak.nickname} 可让 ${letStrokes} 杆，其余球友按差点差折让`);
      } else {
        lines.push('各球手差点接近，老虎局建议平打比最好成绩');
      }
    }
    lines.push('建议底分 1 分；老虎赢洞收分，输洞不追收时可设顶平过');
  } else {
    if (Object.keys(tigerProfits).some((k) => fin(tigerProfits[k]) !== 0)) {
      const ranked = rankPlayersByProfit(players, tigerProfits);
      const best = ranked[0];
      const worst = ranked[ranked.length - 1];
      lines.push(`本场打老虎：${nick(players, best.id)} 累计 ${fmtProfit(best.profit)} 领先`);
      if (worst.profit < 0) {
        lines.push(`${nick(players, worst.id)} 落后 ${fmtProfit(worst.profit)}，下场可减少其当老虎频率或略提底分`);
      }
      if (best.profit - worst.profit >= 4) {
        lines.push('分差偏大，下场老虎位建议轮换给中游球友，避免一家独大');
      }
    } else {
      const byToPar = players
        .map((p, idx) => ({ id: p.id, nickname: p.nickname, ...strokeStats(holes, idx) }))
        .filter((s) => s.played > 0)
        .sort((a, b) => a.toPar - b.toPar);
      if (byToPar.length > 0) {
        lines.push(`本场总杆最佳 ${byToPar[0].nickname}（${fmtToPar(byToPar[0].toPar)}），适合作下场老虎`);
        if (byToPar.length >= 2) {
          lines.push(`${byToPar[byToPar.length - 1].nickname} 总杆偏慢，打老虎时可让 1–2 杆或降低底分`);
        }
      }
    }
    tigerRules.forEach((rule) => {
      if (rule.summary) lines.push(`当前规则：${rule.summary}`);
    });
    if (lines.length === 0) {
      lines.push('本场暂无打老虎规则或洞分，可参考总杆最佳者作老虎');
    }
  }

  return { title: '打老虎', lines, tone: 'tip' };
}

/** 斗地主：地主 vs 农民 */
function buildLandlordSection(
  mode: AiHandicapMode,
  players: AiHandicapPlayerInput[],
  holes: AiHandicapHoleInput[],
  rules: AiHandicapRuleInput[],
  recent?: Record<string, AiPlayerRecentHandicap>,
): AiHandicapAdviceSection {
  const lines: string[] = [];
  const landlordRules = rules.filter((r) => r.type === 'landlord');
  const landlordProfits = ruleProfitsForType(rules, 'landlord');

  if (mode === 'recent3') {
    const ranked = rankByHcp(players, recent);
    if (ranked.length < 2) {
      return { title: '斗地主', lines: ['至少两名球手有有效差点'], tone: 'tip' };
    }
    const best = ranked[0];
    const mid = ranked[Math.floor(ranked.length / 2)];
    const weak = ranked[ranked.length - 1];

    lines.push(`${weak.nickname} 差点最高（${hcpLabel(weak.hcp)}），当地主时农民平打或让 1 分较公平`);
    lines.push(`${best.nickname} 状态最好（${hcpLabel(best.hcp)}），当地主时建议农民让 1–2 分或底分 ×2`);
    if (ranked.length >= 3) {
      lines.push(`${mid.nickname} 居中（${hcpLabel(mid.hcp)}），作地主时底分 1 分、顶平过即可`);
    }
    lines.push('多人局建议出发洞抽取地主，避免固定地主造成盘口失衡');
  } else {
    if (Object.keys(landlordProfits).some((k) => fin(landlordProfits[k]) !== 0)) {
      const ranked = rankPlayersByProfit(players, landlordProfits);
      lines.push(`本场斗地主：${nick(players, ranked[0].id)} 赢 ${fmtProfit(ranked[0].profit)} 最多`);
      if (ranked.length >= 2 && ranked[0].profit > 0 && ranked[ranked.length - 1].profit < 0) {
        const w = ranked[0];
        const l = ranked[ranked.length - 1];
        lines.push(`${nick(players, w.id)} 当地主胜率偏高，下场农民可对其让 1 分或提高收分`);
        lines.push(`${nick(players, l.id)} 累计 ${fmtProfit(l.profit)}，当地主时可降底分或优先抽地主`);
      }
    } else {
      const byToPar = players
        .map((p, idx) => ({ id: p.id, nickname: p.nickname, ...strokeStats(holes, idx) }))
        .filter((s) => s.played > 0)
        .sort((a, b) => a.toPar - b.toPar);
      if (byToPar.length >= 2) {
        lines.push(`本场杆数 ${byToPar[0].nickname} 最好，当地主时可适当提高底分`);
        lines.push(`${byToPar[byToPar.length - 1].nickname} 杆数偏慢，当地主时农民可平打`);
      }
    }
    landlordRules.forEach((rule) => {
      if (rule.summary) lines.push(`当前规则：${rule.summary}`);
    });
    if (lines.length === 0) {
      lines.push('本场暂无斗地主得分，可参考总杆差距设计地主让分');
    }
  }

  return { title: '斗地主', lines, tone: 'tip' };
}

function checkRecent3Ready(
  players: AiHandicapPlayerInput[],
  recent?: Record<string, AiPlayerRecentHandicap>,
): { ok: boolean; reason?: string } {
  if (players.length < 2) return { ok: false, reason: '至少需要 2 名球手' };
  const withHcp = players.filter((p) => effectiveHcp(p, recent) != null);
  if (withHcp.length < 2) return { ok: false, reason: '至少两名球手需有近三场或 roster 差点' };
  return { ok: true };
}

function checkCurrentReady(
  players: AiHandicapPlayerInput[],
  holes: AiHandicapHoleInput[],
  isFinished: boolean,
): { ok: boolean; reason?: string } {
  if (players.length < 2) return { ok: false, reason: '至少需要 2 名球手' };
  const anyScore = holes.some((h) => h.scores.some((s) => fin(s) > 0));
  if (!anyScore) return { ok: false, reason: '暂无洞分，无法分析' };
  const minPlayed = Math.max(...players.map((_, idx) => playedHolesForPlayer(holes, idx)));
  if (!isFinished && minPlayed < 9) return { ok: false, reason: '至少完成前九后再看 AI 盘口' };
  return { ok: true };
}

export function buildAiPkHandicapAdvice(input: AiHandicapAdviceInput): AiHandicapAdviceResult {
  const { mode, players, holes, rules, isFinished, recentHandicaps } = input;

  const gate =
    mode === 'recent3'
      ? checkRecent3Ready(players, recentHandicaps)
      : checkCurrentReady(players, holes, isFinished);

  if (!gate.ok) {
    return { ready: false, reason: gate.reason, headline: '', sections: [] };
  }

  const sections: AiHandicapAdviceSection[] = [];
  sections.push(buildHandicapRefSection(mode, players, recentHandicaps));
  sections.push(buildDanGuaSection(mode, players, holes, rules, recentHandicaps));
  sections.push(buildTigerSection(mode, players, holes, rules, recentHandicaps));
  sections.push(buildLandlordSection(mode, players, holes, rules, recentHandicaps));

  let headline = '';
  if (mode === 'recent3') {
    const ranked = rankByHcp(players, recentHandicaps);
    headline =
      ranked.length >= 2
        ? `近三场盘口：${ranked[0].nickname}（${hcpLabel(ranked[0].hcp)}）相对最强`
        : '近三场差点盘口';
  } else {
    const totals: Record<string, number> = {};
    rules.forEach((r) => {
      Object.entries(r.profitsByPlayerId).forEach(([id, v]) => {
        totals[id] = fin(totals[id]) + fin(v);
      });
    });
    const pkRank = rankPlayersByProfit(players, totals);
    if (pkRank.length > 0 && Object.values(totals).some((v) => v !== 0)) {
      headline = isFinished
        ? `本场盘口：${nick(players, pkRank[0].id)} PK 合计 ${fmtProfit(pkRank[0].profit)}`
        : `当前盘口：${nick(players, pkRank[0].id)} PK 合计 ${fmtProfit(pkRank[0].profit)}`;
    } else {
      const byToPar = players
        .map((p, idx) => ({ nickname: p.nickname, ...strokeStats(holes, idx) }))
        .filter((s) => s.played > 0)
        .sort((a, b) => a.toPar - b.toPar);
      headline =
        byToPar.length > 0
          ? `本场杆数：${byToPar[0].nickname} ${fmtToPar(byToPar[0].toPar)} 最佳`
          : '本场结果盘口';
    }
  }

  return { ready: true, headline, sections };
}
