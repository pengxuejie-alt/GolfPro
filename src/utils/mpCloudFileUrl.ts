/**
 * 微信云存储 fileID（cloud://...）须先 getTempFileURL 再绑 <image src>；
 * 直接写 cloud:// 在开发者工具会变成 /pages/xxx/cloud://... 并 500。
 */

import { db } from './db.js';

export function isWxCloudFileId(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().startsWith('cloud://');
}

/** 单个 cloud fileID → 临时 https（失败返回空串） */
export async function resolveCloudFileIdToHttps(fileId: string): Promise<string> {
  const id = String(fileId || '').trim();
  if (!isWxCloudFileId(id)) return id.startsWith('https://') ? id : '';
  const map = await batchResolveCloudFileIds([id]);
  const url = map.get(id);
  return url && url.startsWith('https://') ? url : '';
}

/** cloudId -> tempFileURL（失败则回退为空，由 UI 显示占位图） */
export async function batchResolveCloudFileIds(fileIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(fileIds.map((x) => String(x || '').trim()).filter(isWxCloudFileId))];
  for (const id of uniq) map.set(id, '');

  if (!uniq.length) return map;

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.getTempFileURL) {
    return map;
  }
  try {
    await db.waitForInit();
  } catch {
    /* ignore */
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
