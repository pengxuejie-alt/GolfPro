/**
 * 应用内头像展示缓存：openId → 可绑 <image> 的 https（会话级，冷启动可恢复）。
 * 不写云库；临时链过期后可凭 cloudFileId 重新 getTempFileURL。
 */

import { pickAvatarSrcForDisplay } from './mpAvatarSrc';
import { isWxCloudFileId } from './mpCloudFileUrl';

const STORAGE_KEY = 'avatar_display_cache_v1';
const MAX_ENTRIES = 200;
/** 临时 https 在内存/本地缓存中的建议有效期（小时级，过期仍可用 cloudFileId 重拉） */
const STALE_MS = 4 * 60 * 60 * 1000;

export interface AvatarDisplayCacheEntry {
  httpsUrl: string;
  cloudFileId?: string;
  fetchedAt: number;
}

const memory = new Map<string, AvatarDisplayCacheEntry>();
let selfOpenId = '';
let selfDisplayUrl = '';
let storageHydrated = false;

function ensureHydrated(): void {
  if (storageHydrated) return;
  storageHydrated = true;
  try {
    const raw = uni.getStorageSync(STORAGE_KEY) as
      | { entries?: Record<string, AvatarDisplayCacheEntry>; selfOpenId?: string; selfDisplayUrl?: string }
      | undefined;
    if (raw && typeof raw === 'object') {
      const entries = raw.entries;
      if (entries && typeof entries === 'object') {
        for (const [k, v] of Object.entries(entries)) {
          if (v?.httpsUrl) memory.set(k, v);
        }
      }
      selfOpenId = String(raw.selfOpenId || '').trim();
      selfDisplayUrl = pickAvatarSrcForDisplay(raw.selfDisplayUrl);
    }
  } catch {
    /* ignore */
  }
}

function persist(): void {
  try {
    const now = Date.now();
    const entries: Record<string, AvatarDisplayCacheEntry> = {};
    const sorted = [...memory.entries()]
      .filter(([, v]) => v.httpsUrl && now - v.fetchedAt < STALE_MS * 6)
      .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
      .slice(0, MAX_ENTRIES);
    for (const [k, v] of sorted) entries[k] = v;
    uni.setStorageSync(STORAGE_KEY, { entries, selfOpenId, selfDisplayUrl });
  } catch {
    /* ignore */
  }
}

/** 同步读取：已有 https 则立即返回，否则空串（由 UI 走占位或异步 resolve） */
export function getCachedAvatarDisplay(openId: string): string {
  ensureHydrated();
  const id = String(openId || '').trim();
  if (!id) return '';
  const entry = memory.get(id);
  if (!entry) return '';
  return pickAvatarSrcForDisplay(entry.httpsUrl);
}

export function getCachedAvatarCloudFileId(openId: string): string {
  ensureHydrated();
  const id = String(openId || '').trim();
  if (!id) return '';
  return memory.get(id)?.cloudFileId || '';
}

/** resolve / chooseAvatar 成功后写入 */
export function setCachedAvatarDisplay(openId: string, url: string, cloudFileId?: string): void {
  ensureHydrated();
  const id = String(openId || '').trim();
  const https = pickAvatarSrcForDisplay(url);
  if (!id || !https) return;
  const cfid =
    cloudFileId && isWxCloudFileId(cloudFileId)
      ? cloudFileId
      : isWxCloudFileId(url)
        ? String(url).trim()
        : undefined;
  memory.set(id, { httpsUrl: https, cloudFileId: cfid, fetchedAt: Date.now() });
  if (id === selfOpenId) selfDisplayUrl = https;
  persist();
}

export function getCachedSelfAvatarDisplay(openId?: string): string {
  ensureHydrated();
  const oid = String(openId || selfOpenId || '').trim();
  if (oid) {
    const fromMap = getCachedAvatarDisplay(oid);
    if (fromMap) return fromMap;
  }
  return selfDisplayUrl;
}

export function setCachedSelfAvatarDisplay(openId: string, url: string, cloudFileId?: string): void {
  ensureHydrated();
  const oid = String(openId || '').trim();
  if (oid) selfOpenId = oid;
  setCachedAvatarDisplay(oid || selfOpenId, url, cloudFileId);
  const https = pickAvatarSrcForDisplay(url);
  if (https) {
    selfDisplayUrl = https;
    persist();
  }
}

/** 批量从缓存种子化展示 map（merge-only，不覆盖已有非空项） */
export function seedAvatarDisplayMapFromCache(openIds: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of openIds) {
    const id = String(raw || '').trim();
    if (!id) continue;
    const url = getCachedAvatarDisplay(id);
    if (url) out[id] = url;
  }
  return out;
}

/** 合并展示 map：patch 中非空值写入，永不写入空串覆盖已有 */
export function mergeAvatarDisplayMaps(
  base: Record<string, string>,
  patch: Record<string, string>,
): Record<string, string> {
  if (!patch || !Object.keys(patch).length) return base;
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const url = pickAvatarSrcForDisplay(v);
    if (url) next[k] = url;
  }
  return next;
}
