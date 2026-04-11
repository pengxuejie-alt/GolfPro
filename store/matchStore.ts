import { defineStore } from 'pinia';
import { MatchManager } from '../utils/match_manager';

export interface Player {
  id: string;
  nickname: string;
  handicap: number;
  avatar?: string;
  isPending?: boolean;
}

export interface HoleScore {
  scores: number[]; // [player1, player2, player3, player4]
  par: number;
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
  tie_type?: string; // 'add_one' | 'none'
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
  config?: any;
}

export const useMatchStore = defineStore('match', {
  state: () => ({
    match_id: '' as string,
    activeRules: [] as PKRule[],
    user_list: [] as Player[],
    holeScores: Array.from({ length: 18 }, () => ({
      scores: [0, 0, 0, 0],
      par: 4
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
        const startHole = (rule.starting_hole || 1) - 1;
        
        // Calculate 18 holes in order starting from starting_hole
        for (let i = 0; i < 18; i++) {
          const hIdx = (startHole + i) % 18;
          const { profits, nextCarryover } = this.calculateRuleProfitWithCarryover(hIdx, rule, carryover);
          
          for (let j = 0; j < this.user_list.length; j++) {
            totals[j] += profits[j] || 0;
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
      // Try to find a rule that has custom 8421 settings
      const ruleWith8421 = this.activeRules.find(r => r.config && r.config.player_8421);
      
      for (let i = 0; i < 18; i++) {
        const points = this.calculate8421Points(i, ruleWith8421);
        for (let j = 0; j < this.user_list.length; j++) {
          totals[j] += points[j] || 0;
        }
      }
      return totals;
    }
  },

  actions: {
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
        const startHole = (rule.starting_hole || 1) - 1;
        
        // For landlord rules, we need to track the landlord state across holes
        // but since it depends on scores, we can calculate it dynamically.
        
        for (let i = 0; i < 18; i++) {
          const hIdx = (startHole + i) % 18;
          const { profits, nextCarryover } = this.calculateRuleProfitWithCarryover(hIdx, rule, carryover);
          
          for (let j = 0; j < this.user_list.length; j++) {
            allHoleProfits[hIdx][j] += profits[j] || 0;
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
      baseScore: number
    ): { holeProfit: number, nextCarryover: number } {
      let nextCarryover = carryover;
      let finalHoleProfit = holeProfit;

      if (pkCount === 0) {
        if (config.tie_hole !== '顶平过') {
          nextCarryover = carryover + 1;
        }
      } else {
        let collectAmount = 0;
        
        if (config.collect_tie === '帕收1/鸟收2/鹰全收') {
          if (winnerRel === 0) collectAmount = Math.min(1, carryover);
          else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
          else if (winnerRel <= -2) collectAmount = carryover;
        } else if (config.collect_tie === '帕收1/鸟收2/鹰收4') {
          if (winnerRel === 0) collectAmount = Math.min(1, carryover);
          else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
          else if (winnerRel <= -2) collectAmount = Math.min(4, carryover);
        } else if (config.collect_tie === '赢收1/鸟收2/鹰全收') {
          if (winnerRel >= 0) collectAmount = Math.min(1, carryover);
          else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
          else if (winnerRel <= -2) collectAmount = carryover;
        } else if (config.collect_tie === '不管赢多少只收1洞') {
          collectAmount = Math.min(1, carryover);
        } else {
          collectAmount = carryover;
        }

        if (collectAmount > 0) {
          let tieBonus = 0;
          let tieMultiplier = 1;

          if (config.tie_hole === '下洞加1分') tieBonus = 1 * collectAmount;
          else if (config.tie_hole === '下洞加2分') tieBonus = 2 * collectAmount;
          else if (config.tie_hole === '下洞加3分') tieBonus = 3 * collectAmount;
          else if (config.tie_hole === '加倍（含奖励）') tieMultiplier = 2;
          else if (config.tie_hole === '加倍（不含奖励）') tieMultiplier = 2;
          else if (config.tie_hole === '连续翻倍') tieMultiplier = Math.pow(2, collectAmount);

          if (config.tie_hole === '加倍（不含奖励）') {
             const baseProfit = pkCount * baseScore;
             const extra = baseProfit * (tieMultiplier - 1);
             finalHoleProfit += extra;
          } else {
             finalHoleProfit *= tieMultiplier;
          }

          finalHoleProfit += (pkCount > 0 ? tieBonus : -tieBonus);
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

      // 流动地主
      if (holeIndex === 0) {
        // 第一个洞默认第一个人
        return this.user_list.findIndex(p => p.id === pIds[0]);
      }

      // 根据上一个洞的成绩决定
      const prevHole = this.holeScores[holeIndex - 1];
      if (!prevHole || prevHole.scores.every(s => s === 0)) {
        // If previous hole not played, keep same landlord or use first
        return this.getLandlordIndex(holeIndex - 1, rule);
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
        const prevTigerIdx = this.getLandlordIndex(holeIndex - 1, rule);
        if (tiedFirsts.some(p => p.idx === prevTigerIdx)) {
          return prevTigerIdx;
        } else {
          return tiedFirsts[holeIndex % tiedFirsts.length].idx;
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
        const combo = combinations[holeIndex % 3];
        return {
          teamA: [pIndices[combo[0][0]], pIndices[combo[0][1]]],
          teamB: [pIndices[combo[1][0]], pIndices[combo[1][1]]]
        };
      }

      // Default or "乱拉"
      if (holeIndex === 0) {
        // First hole: Random (1+4 vs 2+3 of the initial order)
        return { teamA: [pIndices[0], pIndices[3]], teamB: [pIndices[1], pIndices[2]] };
      }

      const prevHole = this.holeScores[holeIndex - 1];
      if (!prevHole || prevHole.scores.every(s => s === 0)) {
        // If no scores in previous hole, maintain previous grouping
        return this.getVegasGrouping(holeIndex - 1, rule);
      }

      // Get scores and sort
      const pScores = pIndices.map(idx => ({ idx, score: prevHole.scores[idx] || 0 }));
      pScores.sort((a, b) => a.score - b.score);

      const prevGrouping = this.getVegasGrouping(holeIndex - 1, rule);
      
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
      if (!hole || hole.scores.some(s => s === 0)) return new Array(this.user_list.length).fill(0);

      const totalProfits = new Array(this.user_list.length).fill(0);
      
      this.activeRules.forEach(rule => {
        const ruleProfits = this.calculateRuleProfit(holeIndex, rule);
        for (let i = 0; i < this.user_list.length; i++) {
          totalProfits[i] += ruleProfits[i] || 0;
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

      // Check if required players have scores
      const pIds = rule.player_ids || [];
      if (pIds.length === 0) return { profits, nextCarryover };
      
      const pIndices = pIds.map(id => this.user_list.findIndex(p => p.id === id)).filter(idx => idx !== -1);
      if (pIndices.some(idx => scores[idx] === 0)) return { profits, nextCarryover };

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
      } else if (rule.type === '8421_1v1') {
        if (pIndices.length < 2) return { profits, nextCarryover };
        if (rule.valid_holes && !rule.valid_holes.includes(holeIndex + 1)) return { profits, nextCarryover };

        const playerCount = pIndices.length;
        const allPoints = this.calculate8421Points(holeIndex);
        const pPoints = pIndices.map(idx => allPoints[idx]);
        
        const avgPoints = pPoints.reduce((a, b) => a + b, 0) / playerCount;
        let ruleProfits = pPoints.map(p => (p - avgPoints) * playerCount * (rule.base_score || 1));

        // Carryover (顶洞) - For 8421 point system, we check if top points are tied
        const sortedPoints = [...pPoints].sort((a, b) => b - a);
        const isTieForFirst = sortedPoints.length > 1 && sortedPoints[0] === sortedPoints[1];

        if (isTieForFirst && rule.tie_type === 'add_one') {
          nextCarryover = carryover + 1;
        } else if (!isTieForFirst && carryover > 0) {
          const winnerIdx = pPoints.indexOf(sortedPoints[0]);
          const winnerRel = scores[pIndices[winnerIdx]] - hole.par;
          let collectAmount = 0;
          
          if (rule.collect_tie_type === 'par_1_birdie_2_eagle_all') {
            if (winnerRel === 0) collectAmount = Math.min(1, carryover);
            else if (winnerRel === -1) collectAmount = Math.min(2, carryover);
            else if (winnerRel <= -2) collectAmount = carryover;
          } else {
            collectAmount = carryover; // Default collect all
          }
          
          if (collectAmount > 0) {
            const collectValue = collectAmount * (rule.base_score || 1);
            ruleProfits[winnerIdx] += collectValue * (playerCount - 1);
            for (let m = 0; m < playerCount; m++) {
              if (m !== winnerIdx) ruleProfits[m] -= collectValue;
            }
            nextCarryover = carryover - collectAmount;
          }
        }

        // Landmines
        if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
          ruleProfits = ruleProfits.map(p => p * (rule.landmines?.multiplier || 2));
        }

        for (let k = 0; k < playerCount; k++) {
          profits[pIndices[k]] = ruleProfits[k];
        }
        
        // Total Handicap (apply to first valid hole for simplicity)
        const firstValidHole = rule.valid_holes && rule.valid_holes.length > 0 ? rule.valid_holes[0] - 1 : 0;
        if (holeIndex === firstValidHole && rule.handicap_config && rule.handicap_config.value > 0) {
           const receiverIdx = rule.handicap_receiver_index || 0;
           const giverIdx = receiverIdx === 0 ? 1 : 0; // Assuming 1v1 for total handicap
           if (pIndices.length >= 2) {
             const hcpValue = rule.handicap_config.value * (rule.base_score || 1);
             profits[pIndices[receiverIdx]] += hcpValue;
             profits[pIndices[giverIdx]] -= hcpValue;
           }
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
        const carryoverResult = this.applyCarryover(holeProfit, pkCount, carryover, config, winnerRel, rule.base_score || 1);
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
          const teamAPoints = all8421Points[teamA[0]] + all8421Points[teamA[1]];
          const teamBPoints = all8421Points[teamB[0]] + all8421Points[teamB[1]];
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

        let holeProfit = pkPoints * (rule.base_score || 1);

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
        const carryoverResult = this.applyCarryover(holeProfit, pkPoints, carryover, config, winnerRel, rule.base_score || 1);
        holeProfit = carryoverResult.holeProfit;
        nextCarryover = carryoverResult.nextCarryover;

        // Landmines
        if (rule.landmines && rule.landmines.assignedHoles.includes(holeIndex + 1)) {
          holeProfit *= (rule.landmines.multiplier || 2);
        }

        // Initialize profits for team members
        profits[teamA[0]] = holeProfit;
        profits[teamA[1]] = holeProfit;
        profits[teamB[0]] = -holeProfit;
        profits[teamB[1]] = -holeProfit;

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
          if (rule.handicap_receiver_index === 0) {
            scoreA -= handicap;
          } else {
            scoreB -= handicap;
          }
        }

        let winA = 0;
        if (scoreA < scoreB) winA = 1;
        else if (scoreB < scoreA) winA = -1;
        else winA = 0;

        // Apply Handicap (让洞) - This usually means A wins if it's a tie and A has a hole handicap?
        // Actually the user said "让洞就是让几个洞". This is usually a total score adjustment.
        // But for per-hole calculation, we'll focus on strokes first.

        let holeValue = (rule.base_score || 1) + carryover;
        let diff = winA * holeValue;

        // Apply Rewards
        if (rule.reward_config && winA !== 0) {
          const rewardA = this.getRewardValue(relA, rule.reward_config);
          const rewardB = this.getRewardValue(relB, rule.reward_config);
          // Rewards are usually added to the winner's score for that hole
          if (winA > 0) diff += rewardA * (rule.base_score || 1);
          else diff -= rewardB * (rule.base_score || 1);
        }

        // Handle Tie Carryover
        if (winA === 0 && rule.tie_type === 'add_one') {
          nextCarryover = holeValue;
          diff = 0;
        } else {
          nextCarryover = 0;
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
      
      // Options:
      // 1: 鸟1鹰5HIO10
      // 2: 鸟1鹰10HIO20
      // 3: 鸟*2鹰*4HIO*8
      // 4: 鸟*2鹰*5HIO*10
      
      if (config === '1') {
        if (rel === -1) return 1;
        if (rel === -2) return 5;
        if (rel <= -3) return 10;
      } else if (config === '2') {
        if (rel === -1) return 1;
        if (rel === -2) return 10;
        if (rel <= -3) return 20;
      } else if (config === '3') {
        // Multiplier based? Usually this means multiplier on the base score or something.
        // But here it's listed as a reward value.
        if (rel === -1) return 2;
        if (rel === -2) return 4;
        if (rel <= -3) return 8;
      } else if (config === '4') {
        if (rel === -1) return 2;
        if (rel === -2) return 5;
        if (rel <= -3) return 10;
      }
      return 0;
    },

    calculate8421Points(holeIndex: number, rule?: PKRule): number[] {
      const hole = this.holeScores[holeIndex];
      if (!hole) return new Array(this.user_list.length).fill(0);
      
      const playerCount = this.user_list.length;
      const pPoints = new Array(playerCount).fill(0);
      
      for (let i = 0; i < playerCount; i++) {
        const score = hole.scores[i];
        if (score === 0) {
          pPoints[i] = 0;
          continue;
        }
        const rel = score - hole.par;
        
        let points = 0;
        if (rel <= -3) points = 32; // Albatross or better
        else if (rel === -2) points = 16; // Eagle
        else if (rel === -1) points = 8; // Birdie
        else if (rel === 0) points = 4; // Par
        else if (rel === 1) points = 2; // Bogey
        else if (rel === 2) points = 1; // Double Bogey
        else points = 0; // Triple Bogey or worse

        // Custom player-specific 8421 values
        if (rule && rule.config && rule.config.player_8421 && rule.config.player_8421[this.user_list[i].id]) {
          const customStr = rule.config.player_8421[this.user_list[i].id];
          // Index 0: Birdie (-1), 1: Par (0), 2: +1, 3: +2, 4: +3
          if (rel === -1 && customStr.length >= 1) points = parseInt(customStr[0]);
          else if (rel === 0 && customStr.length >= 2) points = parseInt(customStr[1]);
          else if (rel === 1 && customStr.length >= 3) points = parseInt(customStr[2]);
          else if (rel === 2 && customStr.length >= 4) points = parseInt(customStr[3]);
          else if (rel === 3 && customStr.length >= 5) points = parseInt(customStr[4]);
          else if (rel === -2) points = (parseInt(customStr[0]) || 8) * 2;
          else if (rel <= -3) points = (parseInt(customStr[0]) || 8) * 4;
          else if (rel > 3) points = 0;
        }

        // Deduction logic
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
            if (score >= hole.par * 2) d = 1;
          }
          points -= d;
        }
        
        pPoints[i] = points;
      }
      return pPoints;
    },

    addRule(rule: PKRule) {
      if (rule.id) {
        const idx = this.activeRules.findIndex(r => r.id === rule.id);
        if (idx !== -1) {
          this.activeRules[idx] = { ...rule };
          return;
        }
      }
      this.activeRules.push({ ...rule, id: Math.random().toString(36).substr(2, 9) });
    },

    removeRule(id: string) {
      this.activeRules = this.activeRules.filter(r => r.id !== id);
    },

    updateScore(holeIndex: number, playerIndex: number, score: number) {
      if (this.holeScores[holeIndex]) {
        this.holeScores[holeIndex].scores[playerIndex] = score;
      }
    },

    setPar(holeIndex: number, par: number) {
      if (this.holeScores[holeIndex]) {
        this.holeScores[holeIndex].par = par;
      }
    },

    initMatch(match: any) {
      this.match_id = match.match_id || '';
      this.user_list = match.user_list || [];
      this.activeRules = match.pk_rules || [];
      if (match.hole_scores && match.hole_scores.length === 18) {
        this.holeScores = match.hole_scores;
      } else {
        this.holeScores = Array.from({ length: 18 }, () => ({
          scores: new Array(this.user_list.length || 4).fill(0),
          par: 4
        }));
      }
    },

    addPlayer(player: Player) {
      const pendingIdx = this.user_list.findIndex(p => p.isPending);
      if (pendingIdx !== -1) {
        // Replace pending player
        this.user_list[pendingIdx] = { ...player, isPending: false };
      } else {
        // Add new player
        this.user_list.push(player);
        // Expand all hole scores
        this.holeScores.forEach(h => {
          if (h.scores.length < this.user_list.length) {
            h.scores.push(0);
          }
        });
      }
    },

    removePlayer(playerId: string) {
      const pIdx = this.user_list.findIndex(p => p.id === playerId);
      if (pIdx !== -1) {
        this.user_list.splice(pIdx, 1);
        this.holeScores.forEach(h => {
          h.scores.splice(pIdx, 1);
        });
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
