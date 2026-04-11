// utils/db.js
const DB_MODE = 'local'; // 以后移植到本地后手动改为 'supabase'

/**
 * 数据库适配器
 * 支持本地存储 (Local) 和云端存储 (Supabase)
 */
export const db = {
  // 通用保存接口
  async setItem(key, data) {
    if (DB_MODE === 'local') {
      try {
        localStorage.setItem(key, JSON.stringify(data));
        return { success: true };
      } catch (e) {
        console.error('[LocalDB] 保存失败:', e);
        return { success: false, msg: e.message };
      }
    } else {
      // 这里预留 Supabase 逻辑位置
      // const { error } = await supabase.from('app_data').upsert({ key, data });
      // return { success: !error };
      return { success: false, msg: 'Supabase 模式尚未在本地配置' };
    }
  },

  // 通用读取接口
  async getItem(key) {
    if (DB_MODE === 'local') {
      try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : null;
      } catch (e) {
        console.error('[LocalDB] 读取失败:', e);
        return null;
      }
    } else {
      // 这里预留 Supabase 逻辑位置
      // const { data, error } = await supabase.from('app_data').select('data').eq('key', key).single();
      // return data ? data.data : null;
      return null;
    }
  },

  // 保存比赛（适配本地与云端）
  async saveMatch(matchData) {
    console.log('[LocalDB] 模拟保存数据:', matchData);
    return this.setItem('match_cache', matchData);
  },

  // 读取比赛
  async getMatch() {
    return this.getItem('match_cache');
  }
};
