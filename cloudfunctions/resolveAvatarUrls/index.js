const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 小程序端对他人 cloud:// 文件 getTempFileURL 常失败（存储权限仅创建者可读）。
 * 云函数侧批量换临时 https，供 roster / 列表 <image> 展示。
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  if (!wxContext.OPENID) {
    return { success: false, error: 'no OPENID', urls: {} };
  }

  const raw = event?.fileIds ?? event?.fileList ?? [];
  const fileIds = [
    ...new Set(
      (Array.isArray(raw) ? raw : [])
        .map((x) => String(x || '').trim())
        .filter((s) => s.startsWith('cloud://')),
    ),
  ].slice(0, 50);

  if (!fileIds.length) {
    return { success: true, urls: {} };
  }

  const urls = {};
  const chunkSize = 50;
  for (let i = 0; i < fileIds.length; i += chunkSize) {
    const chunk = fileIds.slice(i, i + chunkSize);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await cloud.getTempFileURL({ fileList: chunk });
        for (const item of res.fileList || []) {
          const fid = item.fileID != null ? String(item.fileID).trim() : '';
          const status = item.status != null ? Number(item.status) : 0;
          const url = item.tempFileURL != null ? String(item.tempFileURL).trim() : '';
          if (fid && status === 0 && url.startsWith('https://')) {
            urls[fid] = url;
          } else if (fid && status !== 0) {
            console.warn('[resolveAvatarUrls] file fail', fid, item.errMsg || status);
          }
        }
        break;
      } catch (e) {
        console.warn('[resolveAvatarUrls] getTempFileURL attempt', attempt + 1, e);
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  return { success: true, urls, count: Object.keys(urls).length };
};
