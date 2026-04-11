/**
 * utils/match_manager.js
 * 比赛管理核心逻辑
 */

import { db } from './db';

const MATCH_LIST_KEY = 'golf_match_list';

export const MatchManager = {
  /**
   * 创建新比赛
   */
  createMatch: async function(title, baseScore = 1) {
    const newMatch = {
      match_id: Date.now().toString(),
      title: title || '新比赛',
      base_score: baseScore,
      status: 1, // 1: 进行中, 2: 已结束
      user_list: [
        { id: '1', nickname: '我', handicap: 12, avatar: 'https://picsum.photos/100/100' },
        { id: '2', nickname: 'Rocky', handicap: 18, avatar: 'https://picsum.photos/101/101' },
        { id: '3', nickname: 'Alex', handicap: 24, avatar: 'https://picsum.photos/102/102' },
        { id: '4', nickname: 'Tony', handicap: 8, avatar: 'https://picsum.photos/103/103' }
      ],
      pk_rules: [],
      hole_scores: Array.from({ length: 18 }, () => ({
        scores: [0, 0, 0, 0],
        par: 4
      })),
      create_time: new Date().toISOString()
    };

    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    matchList.unshift(newMatch);
    await db.setItem(MATCH_LIST_KEY, matchList);
    return newMatch;
  },

  /**
   * 获取所有比赛
   */
  getMatchList: async function() {
    return await db.getItem(MATCH_LIST_KEY) || [];
  },

  /**
   * 获取单个比赛
   */
  getMatch: async function(matchId) {
    const matchList = await this.getMatchList();
    return matchList.find(m => m.match_id === matchId);
  },

  /**
   * 删除比赛
   */
  deleteMatch: async function(matchId) {
    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    matchList = matchList.filter(m => m.match_id !== matchId);
    await db.setItem(MATCH_LIST_KEY, matchList);
  },

  /**
   * 更新比赛数据
   */
  updateMatch: async function(matchData) {
    let matchList = await db.getItem(MATCH_LIST_KEY) || [];
    const index = matchList.findIndex(m => m.match_id === matchData.match_id);
    if (index !== -1) {
      matchList[index] = matchData;
      await db.setItem(MATCH_LIST_KEY, matchList);
    }
  }
};
