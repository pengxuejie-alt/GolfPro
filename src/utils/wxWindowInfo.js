/**
 * 窗口信息：微信侧优先 wx.getWindowInfo，避免 wx.getSystemInfoSync 弃用与同步阻塞。
 * 非微信环境返回 null，由调用方自行降级。
 */
export function getWxWindowInfo() {
  // #ifdef MP-WEIXIN
  try {
    if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo();
    }
  } catch (e) {
    console.warn('[wxWindowInfo] getWindowInfo', e);
  }
  // #endif
  return null;
}
