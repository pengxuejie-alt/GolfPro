/**
 * 微信云存储 fileID（cloud://...）须先 getTempFileURL 再绑 <image src>。
 * 他人头像 fileID 只能在云函数侧换链（客户端无存储读权限）。
 */

import { db } from './db.js';

export function isWxCloudFileId(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().startsWith('cloud://');
}

async function ensureCloudInited(): Promise<void> {
  // #ifdef MP-WEIXIN
  try {
    await db.waitForInit();
  } catch {
    /* ignore */
  }
  // #endif
}

async function resolveCloudFileIdsViaCloudFn(fileIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(fileIds.map((x) => String(x || '').trim()).filter(isWxCloudFileId))];
  if (!uniq.length) return map;

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.callFunction) return map;
  await ensureCloudInited();

  const chunkSize = 50;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    await new Promise<void>((resolve) => {
      wx.cloud.callFunction({
        name: 'resolveAvatarUrls',
        data: { fileIds: chunk },
        success: (r: unknown) => {
          const res = r as { result?: { success?: boolean; urls?: Record<string, string> } } | undefined;
          const urls = res?.result?.urls;
          if (urls && typeof urls === 'object') {
            for (const [fid, url] of Object.entries(urls)) {
              const u = String(url || '').trim();
              if (fid && u.startsWith('https://')) map.set(fid, u);
            }
          }
          resolve();
        },
        fail: (err: unknown) => {
          console.warn(
            '[mpCloudFileUrl] resolveAvatarUrls 云函数失败，请部署 cloudfunctions/resolveAvatarUrls',
            err,
          );
          resolve();
        },
      });
    });
  }
  // #endif

  return map;
}

async function resolveCloudFileIdsOnClient(fileIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(fileIds.map((x) => String(x || '').trim()).filter(isWxCloudFileId))];
  if (!uniq.length) return map;

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.getTempFileURL) return map;
  await ensureCloudInited();
  await new Promise<void>((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: uniq,
      success: (res) => {
        for (const item of res.fileList || []) {
          const fid = item.fileID != null ? String(item.fileID) : '';
          const status = item.status != null ? Number(item.status) : 0;
          const url = item.tempFileURL != null ? String(item.tempFileURL).trim() : '';
          if (fid && status === 0 && url.startsWith('https://')) map.set(fid, url);
        }
        resolve();
      },
      fail: () => resolve(),
    });
  });
  // #endif

  return map;
}

/** 单个 cloud fileID → 临时 https（失败返回空串） */
export async function resolveCloudFileIdToHttps(fileId: string): Promise<string> {
  const id = String(fileId || '').trim();
  if (!isWxCloudFileId(id)) return id.startsWith('https://') ? id : '';
  const map = await batchResolveCloudFileIds([id]);
  const url = map.get(id);
  return url && url.startsWith('https://') ? url : '';
}

/** cloudId -> tempFileURL；优先云函数（他人头像），再客户端补自己的 file */
export async function batchResolveCloudFileIds(fileIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(fileIds.map((x) => String(x || '').trim()).filter(isWxCloudFileId))];
  for (const id of uniq) map.set(id, '');

  if (!uniq.length) return map;

  const fromCloudFn = await resolveCloudFileIdsViaCloudFn(uniq);
  for (const [fid, url] of fromCloudFn) {
    if (url) map.set(fid, url);
  }

  const missing = uniq.filter((id) => !map.get(id));
  if (missing.length) {
    const fromClient = await resolveCloudFileIdsOnClient(missing);
    for (const [fid, url] of fromClient) {
      if (url) map.set(fid, url);
    }
  }

  return map;
}
