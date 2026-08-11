/**
 * 将 profile.avatar（cloud:// / https / 本地临时路径）解析为可绑 <image> 的 https，并写入展示缓存。
 */

import {
  getCachedAvatarCloudFileId,
  getCachedSelfAvatarDisplay,
  setCachedSelfAvatarDisplay,
} from './avatarDisplayCache';
import { isWxCloudFileId, resolveCloudFileIdToHttps } from './mpCloudFileUrl';
import { looksLikeExpiredProneTencentTempHttps, pickAvatarSrcForDisplay } from './mpAvatarSrc';

function isLocalTempAvatarPath(s: unknown): boolean {
  const v = String(s ?? '').trim();
  if (!v) return false;
  return (
    v.startsWith('wxfile://') ||
    v.startsWith('file://') ||
    v.startsWith('http://tmp') ||
    v.startsWith('https://tmp')
  );
}

async function resolveCloudIdWithRetry(fileId: string): Promise<string> {
  let https = await resolveCloudFileIdToHttps(fileId);
  if (https) return https;
  await new Promise<void>((r) => setTimeout(r, 450));
  https = await resolveCloudFileIdToHttps(fileId);
  return https;
}

/** 从 users 文档字段中尽可能取出头像 fileID / URL */
export function pickAvatarUrlFromUserRow(row: Record<string, unknown>): string {
  const keys = [
    'avatarUrl',
    'avatar',
    'avatar_url',
    'avatarFileId',
    'avatar_file_id',
    'headImgUrl',
    'headimgurl',
  ];
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** 当前 openId 是否仍需把 cloud:// 解析为 https 才能展示 */
export function needsSelfAvatarDisplayResolve(openId: string, profileAvatar: unknown): boolean {
  const oid = String(openId || '').trim();
  const raw = String(profileAvatar || '').trim();
  if (!oid || !raw) return !!oid && !raw;
  const display = getCachedSelfAvatarDisplay(oid);
  if (display && pickAvatarSrcForDisplay(display)) return false;
  if (isWxCloudFileId(raw)) return true;
  if (looksLikeExpiredProneTencentTempHttps(raw)) return true;
  return !pickAvatarSrcForDisplay(raw);
}

/**
 * 解析并缓存本机头像展示 URL；返回可绑 image 的 https（失败返回空串）。
 */
export async function resolveAndCacheSelfAvatarDisplay(
  openId: string,
  profileAvatar: unknown,
): Promise<string> {
  const oid = String(openId || '').trim();
  const raw = String(profileAvatar || '').trim();
  if (!raw) return '';

  if (isWxCloudFileId(raw)) {
    const https = await resolveCloudIdWithRetry(raw);
    if (https && oid) setCachedSelfAvatarDisplay(oid, https, raw);
    return https;
  }

  if (looksLikeExpiredProneTencentTempHttps(raw) && oid) {
    const cfid = getCachedAvatarCloudFileId(oid);
    if (cfid && isWxCloudFileId(cfid)) {
      const https = await resolveCloudIdWithRetry(cfid);
      if (https) {
        setCachedSelfAvatarDisplay(oid, https, cfid);
        return https;
      }
    }
    return '';
  }

  if (isLocalTempAvatarPath(raw)) return raw;

  const display = pickAvatarSrcForDisplay(raw);
  if (display && oid) setCachedSelfAvatarDisplay(oid, display);
  return display;
}
