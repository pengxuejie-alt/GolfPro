import { defineStore } from 'pinia';
import { MatchManager } from '@/utils/match_manager';
import { normalizeMatchHoleScoresForClient } from '@/utils/matchHoleScoresNormalize';
import { resolvePlayerOpenId } from '@/utils/fetchUserProfilesForOpenIds';
import {
  applyTieHoleAdjustments,
  computeCarryoverCollectAmount,
  resolveTieHole,
} from '@/utils/pkTieHole';

/** 防止 cloud/表单混入 string 后 reduce/+= 退化成字符串拼接，避免出现一长串 9 */
function fin(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 消除 (x - round(x)) 在 1e-9 内的浮点尾差，避免 PK 累加后出现长小数 */
function snapNearInteger(x: number, eps = 1e-9): number {
  const v = fin(x);
  const r = Math.round(v);
  return Math.abs(v - r) < eps ? r : v;
}

/** 挂8421 洞分：(p - avg)*n 与 (p*n - sum) 代数等价，后者全整数运算，避免 n=3 时除法浮点误差链式放大 */
function scaled8421HoleProfits(pPoints: number[], playerCount: number, base: number): number[] {
  const n = Math.max(1, Math.floor(playerCount));
  const b = fin(base, 1) || 1;
  const sum = pPoints.reduce((a, x) => a + fin(x), 0);
  return pPoints.map((p) => (fin(p) * n - sum) * b);
}

/** 记分卡「8421」累加列、洞分换算：挂 8421 / type=8421 / 拉斯 8421 */
export function findActive8421PkRule(activeRules: PKRule[]): PKRule | undefined {
  return (
    activeRules.find((r) => r.type === '8421_1v1') ||
    activeRules.find((r) => r.type === '8421') ||
    activeRules.find((r) => r.type === 'vegas_4' && r.config?.scoring_mode === '8421')
  );
}

/** 兼容 player_8421 在 rule 顶层或 config 内（拉斯 / 挂8421） */
export function getRulePlayer8421Map(rule: PKRule | undefined): Record<string, string> | undefined {
  if (!rule) return undefined;
  const fromConfig =
    rule.config && typeof rule.config === 'object' && 'player_8421' in rule.config
      ? (rule.config as Record<string, unknown>).player_8421
      : undefined;
  const top = (rule as Record<string, unknown>).player_8421;
  const m = (fromConfig ?? top) as unknown;
  if (m && typeof m === 'object' && !Array.isArray(m)) return m as Record<string, string>;
  return undefined;
}

export interface Player {
  id: string;
  nickname: string;
  /** 数值为实际差点；null 表示未填写（如新虚拟球手） */
  handicap: number | null;
  avatar?: string;
  isPending?: boolean;
}

export interface HoleScore {
  scores: number[]; // [player1, player2, player3, player4]
  par: number;
  /** 每个球员该洞成绩最后写入的时间戳（ms），用于多端合并时「最后录入为准」 */
  scoreTs?: number[];
}

export interface PKRule {
  id: string;
  type: string; // 'strokes' | 'holes' | '8421_1v1' | 'landlord' | 'vegas_4' | 'vegas_big' | 'tiger'
  category: 'single' | 'multi';
  name: string;
  base_score: number;
  is_mon?: boolean;
  birdie_double?: boolean;
  // New fields for Strokes (比杆)
  landmines?: {
    front: number;
    back: number;
    multiplier: number;
    assignedHoles: number[];
  };
  participant_count?: number;
  player_ids?: string[];
  handicap_config?: {
    type: string;
    value: number;
  };
  reward_config?: string;
  valid_holes?: number[];
  // Match Play (比洞) specific
  win_condition?: string; // 'lower_strokes' | etc.
  tie_type?: string; // legacy: 'add_one' | 'none' | ...
  /** 顶洞规则中文选项，如 顶平过 / 下洞加1分 / 加倍（含奖励） */
  tie_hole?: string;
  collect_tie_type?: string; // 'standard' | etc.
  // New fields for Match Play
  handicap_type?: 'strokes' | 'holes';
  handicap_par_strokes?: Record<string, number>;
  handicap_holes_count?: number;
  handicap_receiver_index?: number;
  starting_hole?: number;
  
  // New fields for 8421
  deduction_type?: 'progressive' | 'single_plus4' | 'single_double_par' | 'none';
  deduction_par3_plus3?: boolean;
  /** 挂8421 / 拉斯 8421+：每人一条数字梯，如 8521、84321（鸟/帕/+1/+2/+3…） */
  player_8421?: Record<string, string>;
  config?: any;
}

function effectiveStartingHole(rule: PKRule | undefined): number {
  if (!rule) return 1;
  const raw = rule.starting_hole ?? rule.config?.starting_hole;
  const n = Number(raw ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(18, Math.max(1, Math.round(n)));
}

/** 避免 String(对象) → "[object Object]" 出现在昵称、头像 URL */
function pickDisplayString(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    const t = v.trim();
    return t || fallback;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const inner = o.nickName ?? o.nickname ?? o.name ?? o.text;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
    if (typeof inner === 'number' && Number.isFinite(inner)) return String(inner);
  }
  return fallback;
}

function pickAvatarString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t || undefined;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const url = o.url ?? o.fileID ?? o.tempFileURL ?? o.avatarUrl ?? o.avatar;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return undefined;
}

/** pk_rules.player_ids 偶发存整条 user 对象，统一落成 id 字符串 */
function coercePkPlayerId(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const s = String(raw).trim();
    return s || undefined;
  }
  if (typeof raw === 'object' && raw !== null && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    if (id != null && (typeof id === 'string' || typeof id === 'number')) {
      const s = String(id).trim();
      return s || undefined;
    }
  }
  return undefined;
}

export function normalizePkRulePlayerIds(rule: PKRule): PKRule {
  const arr = rule.player_ids;
  if (!Array.isArray(arr)) return rule;
  const next = arr.map(coercePkPlayerId).filter((id): id is string => !!id);
  const unchanged =
    next.length === arr.length && next.every((id, i) => id === (arr as unknown[])[i]);
  if (unchanged) return rule;
  return { ...rule, player_ids: next };
}

/** 云函数/历史数据常用 uid、nickName；记分卡与 UI 统一用 id、nickname */
function normalizeMatchPlayer(p: unknown, index: number): Player {
  if (!p || typeof p !== 'object') {
    return { id: `invalid_${index}`, nickname: '?', handicap: null };
  }
  const o = p as Record<string, unknown>;
  const id = resolvePlayerOpenId(p) || (() => {
    const rawId = o.id ?? o.uid ?? o.openId ?? o.openid ?? o.player_uid;
    return rawId != null && String(rawId) !== '' ? String(rawId) : '';
  })();
  const finalId =
    id ||
    `anon_${index}_${Math.random().toString(36).slice(2, 8)}`;
  const nickname = pickDisplayString(o.nickname ?? o.nickName, '球友');
  const avatar = pickAvatarString(o.avatar ?? o.avatarUrl);
  const rawHcp = (o as Record<string, unknown>).handicap;
  let handicap: number | null = null;
  if (rawHcp !== '' && rawHcp !== undefined && rawHcp !== null) {
    const n = Number(rawHcp);
    handicap = Number.isFinite(n) ? n : null;
  }
  return {
    id: finalId,
    nickname,
    avatar: avatar || undefined,
    handicap,
    isPending: !!o.isPending,
  };
}

export const useMatchStore = defineStore('match', {
  state: () => ({
    match_id: '' as string,
    activeRules: [] as PKRule[],
    user_list: [] as Player[],
    holeScores: Array.from({ length: 18 }, () => ({
      scores: [0, 0, 0, 0],
      par: 4,
      scoreTs: [0, 0, 0, 0],
    })) as HoleScore[],
  }),

  getters: {
    /**
     * Calculate total profits for each player across all holes and all active rules
     */
    totalProfits(): number[] {
      const totals = new Array(this.user_list.length).fill(0);
      
      // We need to calculate rule by rule to handle carryover correctly
      this.activeRules.forEach(rule => {
        let carryover = 0;
        const startHole = effectiveStartingHole(rule) - 1;

        // Calculate 18 holes in order starting from starting_hole
        for (let i = 0; i < 18; i++) {
          const hIdx = (startHole + i) % 18;
          const { profits, nextCarryover } = this.calculateRuleProfitWithCarryover(hIdx, rule, carryover);
          
          for (let j = 0; j < this.user_list.length; j++) {
            totals[j] += fin(profits[j]);
          }
          carryover = nextCarryover;
        }
      });
      
      return totals;
    },

    /**
     * Get profits for a specific hole (for UI display in scorecard cells)
     */
    holeProfits(): number[][] {
      return this.getProfitsByRule();
    },

    /**
     * Get 8421 specific points for summary
     */
    total8421Points(): number[] {
      const totals = new Array(this.user_list.length).fill(0);
      const ruleForCol = findActive8421PkRule(this.activeRules);
      if (!ruleForCol) return totals;

      for (let i = 0; i < 18; i++) {
        const points = this.calculate8421Points(i, ruleForCol);
        for (let j = 0; j < this.user_list.length; j++) {
          totals[j] += fin(points[j]);
        }
      }
      return totals;
    }
  },

  actions: {
    /** 0..17 洞号在「从出发洞起」的游玩顺序中的位置（0 = 本轮第一洞） */
    playOrderPosition(rule: PKRule | undefined, holeIndex: number): number {
      const start = (effectiveStartingHole(rule) - 1 + 18) % 18;
      return (holeIndex - start + 18) % 18;
    },
    /** 游玩顺序中的上一洞的物理洞下标（0..17） */
    prevHoleInPlayOrder(rule: PKRule | undefined, holeIndex: number): number {
      const start = (effectiveStartingHole(rule) - 1 + 18) % 18;
      const pos = (holeIndex - start + 18) % 18;
      const prevPos = (pos - 1 + 18) % 18;
      return (start + prevPos) % 18;
    },
    isRoundStartHole(rule: PKRule | undefined, holeIndex: number): boolean {
      return this.playOrderPosition(rule, holeIndex) === 0;
    },
    /**
     * Get profits per hole for a specific rule, or all rules if ruleId is not provided
     */
    getProfitsByRule(ruleId?: string): number[][] {
      const allHoleProfits = Array.from({ length: 18 }, () => new Array(this.user_list.length).fill(0));
      
      const rulesToProcess = ruleId 
        ? this.activeRules.filter(r => r.id === ruleId)
        : this.activeRules;

      rulesToProcess.forEach(rule => {
        let carryover = 0;
        const startHole = effectiveStartingHole(rule) - 1;

        // For landlord rules, we need to track the landlord state across holes
        // but since it depends on scores, we can calculate it dynamically.
        
        for (let i = 0; i < 18; i++) {
          const hIdx = (startHole + i) % 18;
          const { profits, nextCarryover } = this.calculateRuleProfitWithCarryover(hIdx, rule, carryover);
          
          for (let j = 0; j < this.user_list.length; j++) {
            allHoleProfits[hIdx][j] += fin(profits[j]);
          }
          carryover = nextCarryover;
        }
      });
      
      return allHoleProfits;
    },

    applyCarryover(
      holeProfit: number,
      pkCount: number,
      carryover: number,
      config: any,
      winnerRel: number,
      baseScore: number,
      opts?: { skipCollect?: boolean }
    ): { holeProfit: number; nextCarryover: number } {
      let nextCarryover = carryover;
      let finalHoleProfit = holeProfit;
      const skipCollect = opts?.skipCollect === true;
      const ctRaw =
        config?.collect_tie != null ? String(config.collect_tie).trim().replace(/\／/g, '/').replace(/\s+/g, '') : '';
      const isParBirdEagleAll =
        ctRaw === '帕收1/鸟收2/鹰全收' ||
        /^帕收1.*鸟收2.*鹰全收$/.test(ctRaw) ||
        (ctRaw.includes('帕收1') && ctRaw.includes('鸟收2') && ctRaw.includes('鹰全收'));
      const isParBirdEagle4 =
        ctRaw === '帕收1/鸟收2/鹰收4' ||
        (ctRaw.includes('帕收1') && ctRaw.includes('鸟收2') && ctRaw.includes('鹰收4'));
      const isWinBirdEagleAll =
        ctRaw === '赢收1/鸟收2/鹰全收' ||
        (ctRaw.includes('赢收1') && ctRaw.includes('鸟收2') && ctRaw.includes('鹰全收'));
      const isOneCap =
        ctRaw === '不管赢多少只收1洞' || ctRaw.includes('只收1洞');

      if (pkCount === 0) {
        nextCarryover = carryover + 1;
      } else {
        let collectAmount = 0;

        if (!skipCollect) {
          if (isParBirdEagleAll) {
            if (winnerRel === 0) collectAmount = Math.min(1, carryover);
            else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
            else if (winnerRel <= -2) collectAmount = carryover;
          } else if (isParBirdEagle4) {
            if (winnerRel === 0) collectAmount = Math.min(1, carryover);
            else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
            else if (winnerRel <= -2) collectAmount = Math.min(4, carryover);
          } else if (isWinBirdEagleAll) {
            if (winnerRel >= 0) collectAmount = Math.min(1, carryover);
            else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
            else if (winnerRel <= -2) collectAmount = carryover;
          } else if (isOneCap) {
            collectAmount = Math.min(1, carryover);
          } else {
            collectAmount = carryover;
          }
        }

        if (collectAmount > 0) {
          finalHoleProfit = applyTieHoleAdjustments(
            finalHoleProfit,
            pkCount,
            collectAmount,
            resolveTieHole(config),
            baseScore
          );
        }
        nextCarryover = carryover - collectAmount;
      }

      return { holeProfit: finalHoleProfit, nextCarryover };
    },

    getLandlordIndex(holeIndex: number, rule: PKRule): number {
      const config = rule.config;
      if (!config) return -1;
      
      const pIds = rule.player_ids || [];
      if (pIds.length === 0) return -1;

      if (config.landlord_type === '固定地主') {
        return this.user_list.findIndex(p => p.id === config.fixed_landlord_id);
      }

      // 流动地主：本轮第一洞（按「出发洞」计）默认球手列表第一位为地主
      if (this.playOrderPosition(rule, holeIndex) === 0) {
        return this.user_list.findIndex(p => p.id === pIds[0]);
      }

      const prevIdx = this.prevHoleInPlayOrder(rule, holeIndex);
      const prevHole = this.holeScores[prevIdx];
      if (!prevHole || prevHole.scores.every(s => s === 0)) {
        return this.getLandlordIndex(prevIdx, rule);
      }

      const pIndices = pIds.map(id => this.user_list.findIndex(p => p.id === id)).filter(idx => idx !== -1);
      const playerScores = pIndices.map(idx => ({
        idx,
        score: prevHole.scores[idx] || 999
      }));

      // Sort by score ascending (lower is better)
      playerScores.sort((a, b) => a.score - b.score);

      const bestScore = playerScores[0].score;
      const tiedFirsts = playerScores.filter(p => p.score === bestScore);
      
      if (rule.type === 'tiger') {
        const prevTigerIdx = this.getLandlordIndex(prevIdx, rule);
        if (tiedFirsts.some(p => p.idx === prevTigerIdx)) {
          return prevTigerIdx;
        } else {
          const pick = this.playOrderPosition(rule, holeIndex) % tiedFirsts.length;
          return tiedFirsts[pick].idx;
        }
      } else if (rule.type === 'landlord') {
         if (config.category === '斗第一名') {
           return playerScores[0].idx;
         } else {
           return playerScores[1]?.idx ?? playerScores[0].idx;
         }
      }

      return playerScores[0].idx;
    },

    getVegasGrouping(holeIndex: number, rule: PKRule): { teamA: number[], teamB: number[] } {
      const pIds = rule.player_ids || [];
      const pIndices = pIds.map(id => this.user_list.findIndex(p => p.id === id)).filter(idx => idx !== -1);
      
      if (pIndices.length < 4) return { teamA: [], teamB: [] };

      const config = rule.config || {};
      
      if (config.grouping === '固拉') {
        const teamAIds = config.team_a || [];
        const teamA = teamAIds.map((id: string) => this.user_list.findIndex(p => p.id === id)).filter((idx: number) => idx !== -1);
        const teamB = pIndices.filter(idx => !teamA.includes(idx));
        if (teamA.length === 2 && teamB.length === 2) {
          return { teamA, teamB };
        }
        return { teamA: [pIndices[0], pIndices[1]], teamB: [pIndices[2], pIndices[3]] };
      }

      if (config.grouping === '每洞随机分组') {
        const combinations = [
          [[0, 1], [2, 3]],
          [[0, 2], [1, 3]],
          [[0, 3], [1, 2]]
        ];
        const combo = combinations[this.playOrderPosition(rule, holeIndex) % 3];
        return {
          teamA: [pIndices[combo[0][0]], pIndices[combo[0][1]]],
          teamB: [pIndices[combo[1][0]], pIndices[combo[1][1]]]
        };
      }

      // Default or "乱拉"
      if (this.playOrderPosition(rule, holeIndex) === 0) {
        return { teamA: [pIndices[0], pIndices[3]], teamB: [pIndices[1], pIndices[2]] };
      }

      const prevHoleIdx = this.prevHoleInPlayOrder(rule, holeIndex);
      const prevHole = this.holeScores[prevHoleIdx];
      if (!prevHole || prevHole.scores.every(s => s === 0)) {
        return this.getVegasGrouping(prevHoleIdx, rule);
      }

      // Get scores and sort
      const pScores = pIndices.map(idx => ({ idx, score: prevHole.scores[idx] || 0 }));
      pScores.sort((a, b) => a.score - b.score);

      const prevGrouping = this.getVegasGrouping(prevHoleIdx, rule);
      
      // Grouping logic: 1+4 vs 2+3
      // If there are ties, we choose the one that maintains the previous grouping
      const score1 = pScores[0].score;
      const score2 = pScores[1].score;
      const score3 = pScores[2].score;
      const score4 = pScores[3].score;

      // Simpler approach:
      // Just take the sorted pScores and check if swapping tied players helps maintain grouping.
      let teamA = [pScores[0].idx, pScores[3].idx];
      let teamB = [pScores[1].idx, pScores[2].idx];

      const areTeamsSame = (g1: {teamA: number[], teamB: number[]}, g2: {teamA: number[], teamB: number[]}) => {
        const check = (t1: number[], t2: number[]) => t1.every(v => t2.includes(v)) && t2.every(v => t1.includes(v));
        return (check(g1.teamA, g2.teamA) && check(g1.teamB, g2.teamB)) ||
               (check(g1.teamA, g2.teamB) && check(g1.teamB, g2.teamA));
      };

      // If already same as previous, great
      if (areTeamsSame({ teamA, teamB }, prevGrouping)) return { teamA, teamB };

      // Try all permutations of tied players
      // We only care about those that preserve the 1,2,3,4 score order
      // Actually, we just need to see if any combination of {1,4} and {2,3} matches previous grouping
      // where 1 is any player with score1, 2 is any player with score2, etc.
      
      const pairings = [
        { a: [pScores[0].idx, pScores[1].idx], b: [pScores[2].idx, pScores[3].idx] },
        { a: [pScores[0].idx, pScores[2].idx], b: [pScores[1].idx, pScores[3].idx] },
        { a: [pScores[0].idx, pScores[3].idx], b: [pScores[1].idx, pScores[2].idx] }
      ];

      // Filter pairings that satisfy 1+4 vs 2+3
      const validPairings = pairings.filter(p => {
        const sA = [prevHole.scores[p.a[0]], prevHole.scores[p.a[1]]].sort((a,b) => a-b);
        const sB = [prevHole.scores[p.b[0]], prevHole.scores[p.b[1]]].sort((a,b) => a-b);
        const targetA = [score1, score4].sort((a,b) => a-b);
        const targetB = [score2, score3].sort((a,b) => a-b);
        
        return (sA[0] === targetA[0] && sA[1] === targetA[1] && sB[0] === targetB[0] && sB[1] === targetB[1]) ||
               (sA[0] === targetB[0] && sA[1] === targetB[1] && sB[0] === targetA[0] && sB[1] === targetA[1]);
      });

      if (validPairings.length > 0) {
        // Check if any valid pairing matches previous grouping
        for (const p of validPairings) {
          if (areTeamsSame({ teamA: p.a, teamB: p.b }, prevGrouping)) {
            return { teamA: p.a, teamB: p.b };
          }
        }
        // If none match, just return the first valid one (which is usually 1+4 vs 2+3)
        return { teamA: validPairings[0].a, teamB: validPairings[0].b };
      }

      return { teamA, teamB };
    },

    getMultiplier(rel: number, rewardConfig: string): number {
      if (rel >= 0) return 1;
      if (rewardConfig === '鸟2/鹰5/HIO(双鹰)10') {
        if (rel === -1) return 2;
        if (rel === -2) return 5;
        if (rel <= -3) return 10;
      } else if (rewardConfig === '鸟2/鹰10/HIO(双鹰)20') {
        if (rel === -1) return 2;
        if (rel === -2) return 10;
        if (rel <= -3) return 20;
      } else if (rewardConfig === '鸟2/鹰4/HIO(双鹰)28') {
        if (rel === -1) return 2;
        if (rel === -2) return 4;
        if (rel <= -3) return 28;
      } else if (rewardConfig === '鸟2/鹰16/HIO(双鹰)32') {
        if (rel === -1) return 2;
        if (rel === -2) return 16;
        if (rel <= -3) return 32;
      }
      return 1;
    },

    /**
     * Core algorithm for calculating profits for a single hole across all rules
     */
    calculateHole(holeIndex: number): number[] {
      const hole = this.holeScores[holeIndex];
      if (
        !hole ||
        hole.scores.some((s) => {
          const n = Number(s);
          return !Number.isFinite(n) || n === 0;
        })
      )
        return new Array(this.user_list.length).fill(0);

      const totalProfits = new Array(this.user_list.length).fill(0);
      
      this.activeRules.forEach(rule => {
        const ruleProfits = this.calculateRuleProfit(holeIndex, rule);
        for (let i = 0; i < this.user_list.length; i++) {
          totalProfits[i] += fin(ruleProfits[i]);
        }
      });

      return totalProfits;
    },

    /**
     * Calculate profit for a specific rule on a specific hole, considering carryover
     */
    calculateRuleProfitWithCarryover(holeIndex: number, rule: PKRule, carryover: number): { profits: number[], nextCarryover: number } {
      const hole = this.holeScores[holeIndex];
      const profits = new Array(this.user_list.length).fill(0);
      let nextCarryover = 0;

      if (!hole) return { profits, nextCarryover };
      
      const { scores, par } = hole;
      const relScores = scores.map(s => s - par);

      const hang8421Like = rule.type === '8421_1v1' || rule.type === '8421';
      const pIdsRaw = rule.player_ids || [];
      let pIndices = pIdsRaw.map(id => this.user_list.findIndex(p => p.id === id)).filter(idx => idx !== -1);

      if (!hang8421Like && pIdsRaw.length === 0) return { profits, nextCarryover };
      if (hang8421Like && pIndices.length === 0 && this.user_list.length > 0) {
        pIndices = this.user_list.map((_, idx) => idx);
      }
      if (pIndices.length === 0) return { profits, nextCarryover };

      if (
        pIndices.some((idx) => {
          const n = Number(scores[idx]);
          return !Number.isFinite(n) || n === 0;
        })
      )
        return { profits, nextCarryover };

      if (rule.type === 'vegas_big') {
        if (scores.length < 4 || this.user_list.length < 4) return { profits, nextCarryover };
        const s1 = relScores[0], s2 = relScores[1], s3 = relScores[2], s4 = relScores[3];
        
        const scoreA = (s1 <= 0 || s2 <= 0) ? (Math.min(s1, s2) * 10 + Math.max(s1, s2)) : (Math.max(s1, s2) * 10 + Math.min(s1, s2));
        const scoreB = (s3 <= 0 || s4 <= 0) ? (Math.min(s3, s4) * 10 + Math.max(s3, s4)) : (Math.max(s3, s4) * 10 + Math.min(s3, s4));
        let diff = (scoreA - scoreB) * (rule.base_score || 1);
        if (rule.birdie_double && (s1 < 0 || s2 < 0 || s3 < 0 || s4 < 0)) diff *= 2;
        if (rule.is_mon) {
          if (scoreA > scoreB && s3 > 0 && s4 > 0) diff *= 2;
          else if (scoreB > scoreA && s1 > 0 && s2 > 0) diff *= 2;
        }
        profits[0] = -diff;
        profits[1] = -diff;
        profits[2] = diff;
        profits[3] = diff;
      } else if (rule.type === '8421_1v1' || rule.type === '8421') {
        if (rule.valid_holes && !rule.valid_holes.includes(holeIndex + 1)) return { profits, nextCarryover };

        const playerCount = pIndices.length;
        const allPoints = this.calculate8421Points(holeIndex, rule);
        const pPoints = pIndices.map((idx) => fin(allPoints[idx]));
        const base = fin(rule.base_score, 1) || 1;

        /** 多人：零和分配；单人：无法用「对他人差分」，洞分 = base × 本洞 8421 梯分 */
        let ruleProfits: number[];
        if (playerCount < 2) {
          ruleProfits = [fin(pPoints[0]) * base];
          nextCarryover = 0;
        } else {
          ruleProfits = scaled8421HoleProfits(pPoints, playerCount, base);

          // Carryover (顶洞)
          const sortedPoints = [...pPoints].sort((a, b) => b - a);
          const isTieForFirst = sortedPoints.length > 1 && sortedPoints[0] === sortedPoints[1];

          if (isTieForFirst) {
            nextCarryover = carryover + 1;
          } else if (!isTieForFirst && carryover > 0) {
            const skip8421Collect = this.isRoundStartHole(rule, holeIndex) && carryover > 0;
            const winnerIdx = pPoints.indexOf(sortedPoints[0]);
            const winnerRel = scores[pIndices[winnerIdx]] - hole.par;
            let collectAmount = 0;

            if (!skip8421Collect) {
              if (rule.collect_tie_type === 'par_1_birdie_2_eagle_all') {
                if (winnerRel === 0) collectAmount = Math.min(1, carryover);
                else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
                else if (winnerRel <= -2) collectAmount = carryover;
              } else {
                collectAmount = carryover;
              }
            }

            if (collectAmount > 0) {
              const collectValue = collectAmount * base;
              ruleProfits[winnerIdx] += collectValue * (playerCount - 1);
              for (let m = 0; m < playerCount; m++) {
                if (m !== winnerIdx) ruleProfits[m] -= collectValue;
              }
              nextCarryover = carryover - collectAmount;
            } else {
              nextCarryover = carryover;
            }
          }
        }

        // Landmines
        if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
          const mult = fin(rule.landmines?.multiplier, 2);
          ruleProfits = ruleProfits.map((p) => fin(p) * mult);
        }

        for (let k = 0; k < playerCount; k++) {
          profits[pIndices[k]] = fin(ruleProfits[k]);
        }

      } else if (rule.type === 'landlord' || rule.type === 'tiger') {
        const config = rule.config;
        if (!config) return { profits, nextCarryover };

        const landlordIdx = this.getLandlordIndex(holeIndex, rule);
        if (landlordIdx === -1) return { profits, nextCarryover };

        const pIds = rule.player_ids || [];
        const pIndices = pIds.map(id => this.user_list.findIndex(p => p.id === id)).filter(idx => idx !== -1);
        const peasantIndices = pIndices.filter(idx => idx !== landlordIdx);

        if (peasantIndices.length < 2) return { profits, nextCarryover };

        const lScore = scores[landlordIdx];
        const pScores = peasantIndices.map(idx => scores[idx]);

        if (lScore === 0 || pScores.some(s => s === 0)) return { profits, nextCarryover };

        let pkCount = 0;
        if (rule.type === 'landlord') {
          if (config.pk_avg) {
            const avg = pScores.reduce((a, b) => a + b, 0) / pScores.length;
            if (lScore < avg) pkCount++;
            else if (lScore > avg) pkCount--;
          }
          if (config.pk_good) {
            const best = Math.min(...pScores);
            if (lScore < best) pkCount++;
            else if (lScore > best) pkCount--;
          }
          if (config.pk_bad) {
            const worst = Math.max(...pScores);
            if (lScore < worst) pkCount++;
            else if (lScore > worst) pkCount--;
          }
        } else {
          // Tiger logic
          if (config.compare_type === '比洞') {
            const bestPeasant = Math.min(...pScores);
            if (lScore < bestPeasant) pkCount = 1;
            else if (lScore > bestPeasant) pkCount = -1;
            else pkCount = 0;
          } else {
            // 比杆
            const avgPeasant = pScores.reduce((a, b) => a + b, 0) / pScores.length;
            pkCount = avgPeasant - lScore; // Positive if Tiger wins
          }
        }

        let holeProfit = pkCount * (rule.base_score || 1);
        
        // Rewards (Multipliers)
        const lRel = lScore - par;
        const pRels = pScores.map(s => s - par);
        const rewardConfig = config.reward;

        let multiplier = 1;
        if (pkCount > 0) {
          multiplier = this.getMultiplier(lRel, rewardConfig);
        } else if (pkCount < 0) {
          const bestPRel = Math.min(...pRels);
          multiplier = this.getMultiplier(bestPRel, rewardConfig);
        }

        holeProfit *= multiplier;

        // Tie-hole (Carryover)
        const winnerRel = pkCount > 0 ? lRel : Math.min(...pRels);
        const skipCollect = this.isRoundStartHole(rule, holeIndex) && carryover > 0 && pkCount !== 0;
        const carryoverResult = this.applyCarryover(
          holeProfit,
          pkCount,
          carryover,
          config,
          winnerRel,
          rule.base_score || 1,
          { skipCollect }
        );
        holeProfit = carryoverResult.holeProfit;
        nextCarryover = carryoverResult.nextCarryover;

        // Landmines for Tiger (if applicable)
        if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
          holeProfit *= (rule.landmines.multiplier || 2);
        }

        // Final distribution
        profits[landlordIdx] = holeProfit * pScores.length;
        peasantIndices.forEach(idx => profits[idx] = -holeProfit);
      } else if (rule.type === 'vegas_4') {
        const config = rule.config;
        if (!config) return { profits, nextCarryover };

        const { teamA, teamB } = this.getVegasGrouping(holeIndex, rule);
        if (teamA.length < 2 || teamB.length < 2) return { profits, nextCarryover };

        const sA = teamA.map(idx => scores[idx]);
        const sB = teamB.map(idx => scores[idx]);

        if (sA.some(s => s === 0) || sB.some(s => s === 0)) return { profits, nextCarryover };

        const relA = teamA.map(idx => relScores[idx]);
        const relB = teamB.map(idx => relScores[idx]);

        let pkPoints = 0;
        const scoringMode = config.scoring_mode || (config.tab === '公鸡母鸡' ? 'product' : (config.tab?.includes('8421') ? '8421' : 'points_3'));
        const is8421 = scoringMode === '8421';
        const isStandard = scoringMode === 'product';
        const isSum = scoringMode === 'sum';

        if (isStandard) {
          const s1 = relA[0], s2 = relA[1], s3 = relB[0], s4 = relB[1];
          const scoreA = (s1 <= 0 || s2 <= 0) ? (Math.min(s1, s2) * 10 + Math.max(s1, s2)) : (Math.max(s1, s2) * 10 + Math.min(s1, s2));
          const scoreB = (s3 <= 0 || s4 <= 0) ? (Math.min(s3, s4) * 10 + Math.max(s3, s4)) : (Math.max(s3, s4) * 10 + Math.min(s3, s4));
          pkPoints = scoreB - scoreA;
          
          // Birdie Double for Standard Vegas
          if (rule.birdie_double && (s1 < 0 || s2 < 0 || s3 < 0 || s4 < 0)) pkPoints *= 2;
          // Mon logic
          if (rule.is_mon) {
            if (scoreA < scoreB && s3 > 0 && s4 > 0) pkPoints *= 2;
            else if (scoreB < scoreA && s1 > 0 && s2 > 0) pkPoints *= 2;
          }
        } else if (isSum) {
          const totalA = sA.reduce((a, b) => a + b, 0);
          const totalB = sB.reduce((a, b) => a + b, 0);
          pkPoints = totalB - totalA;
        } else if (is8421) {
          const all8421Points = this.calculate8421Points(holeIndex, rule);
          const pA0 = fin(all8421Points[teamA[0]]);
          const pA1 = fin(all8421Points[teamA[1]]);
          const pB0 = fin(all8421Points[teamB[0]]);
          const pB1 = fin(all8421Points[teamB[1]]);
          const teamAPoints = pA0 + pA1;
          const teamBPoints = pB0 + pB1;
          pkPoints = teamAPoints - teamBPoints;
        } else {
          if (config.pk_good) {
            const bestA = Math.min(...sA);
            const bestB = Math.min(...sB);
            if (bestA < bestB) pkPoints += 1;
            else if (bestA > bestB) pkPoints -= 1;
          }
          if (config.pk_bad) {
            const worstA = Math.max(...sA);
            const worstB = Math.max(...sB);
            if (worstA < worstB) pkPoints += 1;
            else if (worstA > worstB) pkPoints -= 1;
          }
          if (config.pk_total) {
            const totalA = sA.reduce((a, b) => a + b, 0);
            const totalB = sB.reduce((a, b) => a + b, 0);
            if (totalA < totalB) pkPoints += 1;
            else if (totalA > totalB) pkPoints -= 1;
          }
        }

        const baseVegas = fin(rule.base_score, 1) || 1;
        let holeProfit = fin(pkPoints) * baseVegas;

        // Rewards (Multipliers) - Apply to Northern 3 Points mode only
        // To be consistent with 2-player 8421, 8421 modes don't use these multipliers
        if (!isStandard && !is8421) {
          const rewardConfig = config.reward_amount;
          let multiplier = 1;
          if (pkPoints > 0) {
            const bestA = Math.min(...relA);
            multiplier = this.getMultiplier(bestA, rewardConfig);
          } else if (pkPoints < 0) {
            const bestB = Math.min(...relB);
            multiplier = this.getMultiplier(bestB, rewardConfig);
          }
          holeProfit *= multiplier;
        }

        // Carryover
        const winnerRel = pkPoints > 0 ? Math.min(...relA) : Math.min(...relB);
        const skipCollectVegas = this.isRoundStartHole(rule, holeIndex) && carryover > 0 && pkPoints !== 0;
        const carryoverResult = this.applyCarryover(
          holeProfit,
          fin(pkPoints),
          carryover,
          config,
          winnerRel,
          baseVegas,
          { skipCollect: skipCollectVegas }
        );
        holeProfit = carryoverResult.holeProfit;
        nextCarryover = fin(carryoverResult.nextCarryover);

        // Landmines
        if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
          holeProfit = fin(holeProfit) * fin(rule.landmines?.multiplier, 2);
        }

        if (is8421) {
          holeProfit = snapNearInteger(holeProfit);
        }

        // Initialize profits for team members
        const hp = holeProfit;
        profits[teamA[0]] = hp;
        profits[teamA[1]] = hp;
        profits[teamB[0]] = -hp;
        profits[teamB[1]] = -hp;

        // Blowup Hole (包洞) - Only for non-8421 and non-standard
        if (!is8421 && !isStandard) {
          const threshold = config.hole_guarantee === 'double par包洞' ? par * 2 : (config.hole_guarantee === 'double par+1包洞' ? par * 2 + 1 : 999);
          
          if (holeProfit > 0) {
             // Team B loses
             const b0Blowup = sB[0] >= threshold;
             const b1Blowup = sB[1] >= threshold;
             if (b0Blowup && !b1Blowup) {
                profits[teamB[0]] = -holeProfit * 2;
                profits[teamB[1]] = 0;
             } else if (!b0Blowup && b1Blowup) {
                profits[teamB[0]] = 0;
                profits[teamB[1]] = -holeProfit * 2;
             }
          } else if (holeProfit < 0) {
             // Team A loses
             const a0Blowup = sA[0] >= threshold;
             const a1Blowup = sA[1] >= threshold;
             if (a0Blowup && !a1Blowup) {
                profits[teamA[0]] = holeProfit * 2; // holeProfit is negative
                profits[teamA[1]] = 0;
             } else if (!a0Blowup && a1Blowup) {
                profits[teamA[0]] = 0;
                profits[teamA[1]] = holeProfit * 2;
             }
          }
        }
      } else if (rule.type === 'strokes') {
        if (pIndices.length < 2) return { profits, nextCarryover };
        if (rule.valid_holes && !rule.valid_holes.includes(holeIndex + 1)) return { profits, nextCarryover };

        for (let i = 0; i < pIndices.length; i++) {
          for (let j = i + 1; j < pIndices.length; j++) {
            const idxA = pIndices[i];
            const idxB = pIndices[j];
            const scoreA = scores[idxA];
            const scoreB = scores[idxB];
            const relA = relScores[idxA];
            const relB = relScores[idxB];

            let diff = scoreB - scoreA;

            // Apply Handicap
            if (rule.handicap_config && rule.handicap_config.type !== 'none') {
              const n = parseInt(rule.handicap_config.type.charAt(0));
              if (!isNaN(n)) {
                if (diff > 0) diff = Math.max(0, diff - (n - 1));
                else if (diff < 0) diff = -Math.max(0, -diff - (n - 1));
              }
            }

            if (rule.reward_config) {
              diff += this.getRewardValue(relA, rule.reward_config) - this.getRewardValue(relB, rule.reward_config);
            }

            if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
              diff *= (rule.landmines.multiplier || 2);
            }

            const finalDiff = diff * (rule.base_score || 1);
            profits[idxA] += finalDiff;
            profits[idxB] -= finalDiff;
          }
        }
      } else if (rule.type === 'holes') {
        if (pIndices.length < 2) return { profits, nextCarryover };
        if (rule.valid_holes && !rule.valid_holes.includes(holeIndex + 1)) return { profits, nextCarryover };

        // Match Play is typically 1v1 in this app's current config
        const idxA = pIndices[0];
        const idxB = pIndices[1];
        let scoreA = scores[idxA];
        let scoreB = scores[idxB];
        const relA = relScores[idxA];
        const relB = relScores[idxB];

        // Apply Handicap (让杆)
        if (rule.handicap_type === 'strokes' && rule.handicap_par_strokes) {
          const parKey = `par${par}`;
          const handicap = rule.handicap_par_strokes[parKey] || 0;
          if (handicap !== 0) {
            const ri = rule.handicap_receiver_index;
            if (ri === 0) {
              scoreA -= handicap;
            } else if (ri === 1) {
              scoreB -= handicap;
            }
          }
        }

        let winA = 0;
        if (scoreA < scoreB) winA = 1;
        else if (scoreB < scoreA) winA = -1;
        else winA = 0;

        const baseVal = rule.base_score || 1;
        const roundStart = this.isRoundStartHole(rule, holeIndex);
        let diff = 0;

        if (winA === 0) {
          nextCarryover = carryover + 1;
          diff = 0;
        } else {
          const winnerRel = winA > 0 ? relA : relB;
          const skipCollect = roundStart && carryover > 0;
          const collectAmount = computeCarryoverCollectAmount(
            carryover,
            winnerRel,
            rule.collect_tie_type,
            skipCollect
          );
          nextCarryover = carryover - collectAmount;
          // 奖励分（鸟/鹰/HIO）为赢洞总分，不再叠加 baseVal，避免 +1
          let holeWinVal = baseVal;
          if (rule.reward_config) {
            const reward = this.getRewardValue(winnerRel, rule.reward_config);
            if (reward > 0) holeWinVal = reward;
          }
          let signedProfit = winA * holeWinVal + winA * collectAmount * baseVal;
          if (collectAmount > 0) {
            signedProfit = applyTieHoleAdjustments(
              signedProfit,
              winA,
              collectAmount,
              resolveTieHole(rule),
              baseVal
            );
          }
          diff = signedProfit;
        }

        if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
          diff *= (rule.landmines.multiplier || 2);
        }

        profits[idxA] = diff;
        profits[idxB] = -diff;
      }

      return { profits, nextCarryover };
    },

    getRewardValue(rel: number, config: string): number {
      if (rel >= 0) return 0;

      // 与 scorecard 奖励弹窗一致：'1' 默认，鸟 -1 / 鹰 -2 / HIO 及以下 -3
      if (config === '1') {
        if (rel === -1) return 2;
        if (rel === -2) return 4;
        if (rel <= -3) return 8;
      } else if (config === '2') {
        if (rel === -1) return 2;
        if (rel === -2) return 5;
        if (rel <= -3) return 10;
      } else if (config === '3') {
        if (rel === -1) return 2;
        if (rel === -2) return 10;
        if (rel <= -3) return 20;
      } else if (config === '4') {
        if (rel === -1) return 2;
        if (rel === -2) return 16;
        if (rel <= -3) return 32;
      }
      return 0;
    },

    calculate8421Points(holeIndex: number, rule?: PKRule): number[] {
      const hole = this.holeScores[holeIndex];
      if (!hole) return new Array(this.user_list.length).fill(0);

      const playerCount = this.user_list.length;
      const pPoints = new Array(playerCount).fill(0);

      for (let i = 0; i < playerCount; i++) {
        const scoreRaw = hole.scores[i];
        const scoreN = Number(scoreRaw);
        if (!Number.isFinite(scoreN) || scoreN === 0) {
          pPoints[i] = 0;
          continue;
        }
        const rel = scoreN - hole.par;

        let points = 0;
        if (rel <= -3) points = 32; // Albatross or better
        else if (rel === -2) points = 16; // Eagle
        else if (rel === -1) points = 8; // Birdie
        else if (rel === 0) points = 4; // Par
        else if (rel === 1) points = 2; // Bogey
        else if (rel === 2) points = 1; // Double Bogey
        else points = 0; // Triple Bogey or worse

        const map = getRulePlayer8421Map(rule);
        const raw8421 = map?.[this.user_list[i].id];
        if (raw8421 != null && String(raw8421).trim() !== '') {
          const digits = String(raw8421).replace(/\D/g, '');
          let custom: number | null = null;
          if (rel === -2) {
            custom = ((digits.length ? parseInt(digits[0], 10) : NaN) || 8) * 2;
          } else if (rel <= -3) {
            custom = ((digits.length ? parseInt(digits[0], 10) : NaN) || 8) * 4;
          } else if (rel >= -1) {
            const idx = rel + 1;
            if (idx >= 0 && idx < digits.length) {
              custom = parseInt(digits.charAt(idx), 10);
            }
          }
          if (custom !== null && Number.isFinite(custom)) points = custom;
        }

        const deductionType = rule?.config?.deduction_type || rule?.deduction_type;
        const deductionPar3 = rule?.config?.deduction_par3_plus3 || rule?.deduction_par3_plus3;

        if (deductionType && deductionType !== 'none') {
          let d = 0;
          if (deductionType === 'progressive') {
            let threshold = 4;
            if (deductionPar3 && hole.par === 3) threshold = 3;
            if (rel >= threshold) d = rel - threshold + 1;
          } else if (deductionType === 'single_plus4') {
            if (rel >= 4) d = 1;
          } else if (deductionType === 'single_double_par') {
            if (scoreN >= hole.par * 2) d = 1;
          }
          points -= d;
        }

        pPoints[i] = fin(points);
      }
      return pPoints;
    },

    addRule(rule: PKRule) {
      const r = normalizePkRulePlayerIds({ ...rule });
      if (r.id) {
        const idx = this.activeRules.findIndex(x => x.id === r.id);
        if (idx !== -1) {
          this.activeRules[idx] = r;
          return;
        }
      }
      this.activeRules.push({ ...r, id: Math.random().toString(36).substr(2, 9) });
    },

    removeRule(id: string) {
      this.activeRules = this.activeRules.filter(r => r.id !== id);
    },

    updateScore(holeIndex: number, playerIndex: number, score: number) {
      if (this.holeScores[holeIndex]) {
        const hole = this.holeScores[holeIndex];
        const now = Date.now();
        if (!Array.isArray(hole.scoreTs)) {
          hole.scoreTs = Array(hole.scores.length).fill(0);
        }
        while (hole.scoreTs.length < hole.scores.length) {
          hole.scoreTs.push(0);
        }
        hole.scores[playerIndex] = score;
        hole.scoreTs[playerIndex] = now;
      }
    },

    setPar(holeIndex: number, par: number) {
      if (this.holeScores[holeIndex]) {
        this.holeScores[holeIndex].par = par;
      }
    },

    /** 强制 18 洞：云库超时、hole_scores 缺洞、人数变化时仍对齐 */
    ensureEighteenHoles() {
      const pc = Math.max(1, this.user_list.length || 4);
      const next: HoleScore[] = [];
      for (let i = 0; i < 18; i++) {
        const src = this.holeScores[i];
        let scores: number[] = src && Array.isArray(src.scores) ? [...src.scores] : [];
        let scoreTs: number[] =
          src && Array.isArray(src.scoreTs)
            ? [...src.scoreTs]
            : [];
        const par = src && typeof src.par === 'number' ? src.par : 4;
        while (scores.length < pc) scores.push(0);
        scores = scores.slice(0, pc);
        while (scoreTs.length < scores.length) scoreTs.push(0);
        scoreTs = scoreTs.slice(0, scores.length);
        next.push({ scores, par, scoreTs });
      }
      this.holeScores = next;
    },

    /**
     * Tab 计分页路由复用：match_id 切换时先清空内场，避免上一场洞分在拉局完成前闪一帧。
     */
    prepareNavigateToMatch(mid: string) {
      const id = typeof mid === 'string' ? mid.trim() : String(mid || '').trim();
      if (!id) return;
      if (this.match_id === id) return;
      this.match_id = id;
      this.user_list = [];
      this.activeRules = [];
      this.holeScores = Array.from({ length: 18 }, () => ({
        scores: [0],
        par: 4,
        scoreTs: [0],
      }));
    },

    initMatch(match: any) {
      if (match && typeof match === 'object') {
        normalizeMatchHoleScoresForClient(match as Record<string, unknown>);
      }
      this.match_id = match.match_id || '';
      const rawPlayers = match.user_list ?? match.players ?? [];
      const arr = Array.isArray(rawPlayers) ? rawPlayers : [];
      this.user_list = arr.map((p, i) => normalizeMatchPlayer(p, i));
      const rulesRaw = match.pk_rules || match.pk_results || [];
      this.activeRules = Array.isArray(rulesRaw)
        ? (rulesRaw as PKRule[]).map((r) => normalizePkRulePlayerIds(JSON.parse(JSON.stringify(r)) as PKRule))
        : [];
      const hs = match.hole_scores ?? match.scores;
      if (hs && Array.isArray(hs) && hs.length > 0) {
        this.holeScores = hs.slice(0, 18).map((h: any) => {
          const scores = Array.isArray(h.scores) ? [...h.scores] : [];
          const par = typeof h.par === 'number' ? h.par : 4;
          const scoreTs = Array.isArray(h.scoreTs)
            ? [...h.scoreTs]
            : Array.isArray(h.score_ts)
              ? [...h.score_ts]
              : [];
          return { scores, par, scoreTs };
        });
      } else {
        this.holeScores = [];
      }
      this.ensureEighteenHoles();
      try {
        const h0 = this.holeScores[0];
        console.info('[matchStore.initMatch]', {
          match_id: this.match_id,
          rawPlayersLen: arr.length,
          normalizedUsers: this.user_list.map((u) => ({ id: u.id, nickname: u.nickname })),
          holeCount: this.holeScores.length,
          scoresLenHole1: h0?.scores?.length,
          sampleHole1: h0?.scores,
        });
      } catch {
        /* ignore */
      }
    },

    addPlayer(player: Player) {
      const normalized = normalizeMatchPlayer(player, this.user_list.length);
      const pendingIdx = this.user_list.findIndex(p => p.isPending);
      if (pendingIdx !== -1) {
        // Replace pending player
        this.user_list[pendingIdx] = { ...normalized, isPending: false };
      } else {
        // Add new player
        this.user_list.push(normalized);
        // Expand all hole scores
        this.holeScores.forEach(h => {
          if (!Array.isArray(h.scoreTs)) {
            h.scoreTs = Array(h.scores.length).fill(0);
          }
          while (h.scoreTs.length < h.scores.length) {
            h.scoreTs.push(0);
          }
          while (h.scores.length < this.user_list.length) {
            h.scores.push(0);
            h.scoreTs!.push(0);
          }
        });
      }
      console.info('[matchStore.addPlayer]', {
        id: normalized.id,
        nickname: normalized.nickname,
        userCount: this.user_list.length,
        scoresLens: this.holeScores.slice(0, 3).map((h) => h.scores.length),
      });
    },

    removePlayer(playerId: string) {
      const pIdx = this.user_list.findIndex(p => p.id === playerId);
      if (pIdx !== -1) {
        this.user_list.splice(pIdx, 1);
        this.holeScores.forEach(h => {
          h.scores.splice(pIdx, 1);
          if (Array.isArray(h.scoreTs) && h.scoreTs.length > pIdx) {
            h.scoreTs.splice(pIdx, 1);
          }
        });
      }
    },

    /** 与云端 players 顺序对齐；permute 各洞 scores / scoreTs 列 */
    reorderPlayersByIds(orderedIds: string[]) {
      const cur = this.user_list.map((p) => p.id);
      if (orderedIds.length !== cur.length) return;
      const curSet = new Set(cur);
      for (const id of orderedIds) {
        if (!curSet.has(id)) return;
      }
      if (orderedIds.every((id, i) => id === cur[i])) return;

      const idToIdx = new Map(cur.map((id, i) => [id, i]));
      const perm = orderedIds.map((id) => idToIdx.get(id)!);
      this.user_list = orderedIds.map((id) => this.user_list.find((p) => p.id === id)!);

      for (const h of this.holeScores) {
        h.scores = perm.map((i) => Number(h.scores[i] ?? 0));
        if (Array.isArray(h.scoreTs)) {
          h.scoreTs = perm.map((i) => Number(h.scoreTs![i] ?? 0));
        }
      }
    },
    
    async saveMatch() {
      if (!this.match_id) return;
      const match = await MatchManager.getMatch(this.match_id);
      if (match) {
        match.pk_rules = this.activeRules;
        match.hole_scores = this.holeScores;
        match.user_list = this.user_list;
        await MatchManager.updateMatch(match);
      }
    }
  }
});
