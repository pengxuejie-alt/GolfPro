const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/** 替代已废弃的 getFriends / getFriendList，供前端 wx.cloud.callFunction({ name: 'getMatchTeammates' }) */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  return {
    success: true,
    openId: wxContext.OPENID,
    teammates: [],
    // 兼容旧 getFriends：仍返回 friends，新逻辑请读 teammates
    friends: [],
  };
};
