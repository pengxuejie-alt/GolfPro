/**
 * 微信云存储 fileID（cloud://...）在部分基础库 / 端上对 <image> 直接绑定不够稳，
 * 尤其展示「他人」资源时，宜先 getTempFileURL 再使用返回的 https 临时链（有效期数小时，失效后需再解析）。
 */

export function isWxCloudFileId(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().startsWith('cloud://');
}

/** cloudId -> tempFileURL（失败则回退为原 fileID） */
export async function batchResolveCloudFileIds(fileIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(fileIds.map((x) => String(x || '').trim()).filter(isWxCloudFileId))];
  for (const id of uniq) map.set(id, id);

  if (!uniq.length) return map;

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.getTempFileURL) {
    return map;
  }
  await new Promise<void>((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: uniq,
      success: (res) => {
        for (const item of res.fileList || []) {
          const fid = item.fileID != null ? String(item.fileID) : '';
          const url = item.tempFileURL != null ? String(item.tempFileURL).trim() : '';
          if (fid && url) map.set(fid, url);
        }
        resolve();
      },
      fail: () => resolve(),
    });
  });
  // #endif

  return map;
}
