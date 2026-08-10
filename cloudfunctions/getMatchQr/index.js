const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * scene 最长 32 字符；page 须为已发布小程序页面路径（无开头 /）
 */
exports.main = async (event) => {
  const matchId = event?.match_id != null ? String(event.match_id) : '';
  if (!matchId) {
    return { success: false, error: 'missing match_id' };
  }
  const scene = `m${matchId}`.slice(0, 32);
  try {
    const resp = await cloud.openapi.wxacode.getUnlimited({
      scene,
      page: 'pages/scorecard/scorecard',
      width: 280,
      checkPath: false,
      envVersion: 'release',
    });
    const buf = resp.buffer;
    if (!buf) {
      return { success: false, error: 'empty buffer' };
    }
    return {
      success: true,
      base64: Buffer.from(buf).toString('base64'),
      scene,
    };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
};
