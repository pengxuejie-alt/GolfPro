/**
 * 批量拉 users 头像昵称：优先云函数 getUserProfiles（服务端 getTempFileURL），
 * 失败再降级客户端查 users；最后客户端解析剩余 cloud://。
 */

import { db } from './db.js';
import { pickAvatarUrlFromUserRow } from './selfAvatarResolve';
import { batchResolveCloudFileIds, isWxCloudFileId } from './mpCloudFileUrl';
import { avatarUrlForDisplayOrEmpty, isAvatarUrlDisplayable, pickAvatarSrcForDisplay } from './mpAvatarSrc';
import { debugInfo } from './mpDebugLog';

export function isLikelyWeChatOpenId(s: unknown): boolean {
  const t = String(s ?? '').trim();
  return /^o[A-Za-z0-9_-]{10,}$/.test(t);
}

export interface UserProfileRow {
  nickName: string;
  avatarUrl: string;
}

const SKIP_ID_PREFIXES = ['temp_', 'virtual', 'anon_', 'host_', 'mock_'];

export function resolvePlayerOpenId(p: unknown): string {
  if (!p || typeof p !== 'object') return '';
  const o = p as Record<string, unknown>;
  const keys = ['openid', 'openId', 'uid', 'player_uid', 'id'];
  let fallback = '';
  for (const key of keys) {
    const raw = o[key];
    if (raw == null || String(raw).trim() === '') continue;
    const s = String(raw).trim();
    if (SKIP_ID_PREFIXES.some((pre) => s.startsWith(pre))) {
      if (!fallback) fallback = s;
      continue;
    }
    if (isLikelyWeChatOpenId(s)) return s;
    if (!fallback) fallback = s;
  }
  return fallback;
}

function isFetchableOpenId(id: string): boolean {
  const s = String(id || '').trim();
  if (!s) return false;
  if (SKIP_ID_PREFIXES.some((pre) => s.startsWith(pre))) return false;
  return isLikelyWeChatOpenId(s) || s.length >= 8;
}

async function callGetUserProfilesCloud(
  openIds: string[],
): Promise<Map<string, UserProfileRow>> {
  const map = new Map<string, UserProfileRow>();
  if (!openIds.length) return map;

  // #ifdef MP-WEIXIN
  await db.waitForInit();
  if (typeof wx === 'undefined' || !wx.cloud?.callFunction) return map;

  const MAX = 78;
  for (let i = 0; i < openIds.length; i += MAX) {
    const chunk = openIds.slice(i, i + MAX);
    await new Promise<void>((resolve) => {
      wx.cloud.callFunction({
        name: 'getUserProfiles',
        data: { openIds: chunk },
        success: (r: unknown) => {
          const res = r as {
            result?: {
              success?: boolean;
              profiles?: unknown[];
              meta?: { requested?: number; found?: number; httpsAvatars?: number };
              error?: string;
            };
          };
          const body = res?.result;
          if (body?.success === false) {
            console.warn('[fetchUserProfiles] getUserProfiles 返回失败:', body.error || body);
          } else if (body?.meta) {
            debugInfo('[fetchUserProfiles] getUserProfiles meta', body.meta);
          }
          const profiles = Array.isArray(body?.profiles) ? body.profiles : [];
          for (const raw of profiles) {
            const row = raw as Record<string, unknown>;
            const oid = String(row.openId ?? row.openid ?? row._openid ?? '').trim();
            if (!oid) continue;
            const nickRaw = row.nickName ?? row.nickname;
            const nickName =
              nickRaw != null && String(nickRaw).trim() !== '' ? String(nickRaw).trim() : '球友';
            const avRaw = row.avatarUrl ?? row.avatar;
            const avatarUrl =
              avRaw != null && String(avRaw).trim() !== '' ? String(avRaw).trim() : '';
            map.set(oid, { nickName, avatarUrl });
          }
          resolve();
        },
        fail: (err: unknown) => {
          console.warn(
            '[fetchUserProfiles] getUserProfiles 云函数失败，请部署 cloudfunctions/getUserProfiles',
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

async function fetchFromUsersDb(openIds: string[]): Promise<Map<string, UserProfileRow>> {
  const map = new Map<string, UserProfileRow>();
  if (!openIds.length) return map;

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.database) return map;
  try {
    await db.waitForInit();
    const wxdb = wx.cloud.database();
    const _ = wxdb.command;
    const chunkSize = 20;
    for (let i = 0; i < openIds.length; i += chunkSize) {
      const chunk = openIds.slice(i, i + chunkSize);
      const snap = await wxdb.collection('users').where({ _openid: _.in(chunk) }).get();
      for (const row of snap.data ?? []) {
        const r = row as Record<string, unknown>;
        const oid = r._openid != null ? String(r._openid).trim() : '';
        if (!oid) continue;
        const nickRaw = r.nickName ?? r.nickname;
        const nickName =
          nickRaw != null && String(nickRaw).trim() !== '' ? String(nickRaw).trim() : '球友';
        map.set(oid, { nickName, avatarUrl: pickAvatarUrlFromUserRow(r) });
      }
    }
  } catch (e) {
    console.warn('[fetchUserProfiles] users db', e);
  }
  // #endif

  return map;
}

async function resolveProfileMapAvatarsForDisplay(map: Map<string, UserProfileRow>): Promise<void> {
  const cloudIds = new Set<string>();
  for (const [, prof] of map) {
    const av = String(prof.avatarUrl || '').trim();
    if (!av) continue;
    if (isWxCloudFileId(av)) cloudIds.add(av);
    // 会话内 getUserProfiles 刚换出的 tcb 临时 https 可直接展示，勿在此处 strip
  }
  if (!cloudIds.size) return;

  const resolved = await batchResolveCloudFileIds([...cloudIds]);
  for (const [, prof] of map) {
    const av = String(prof.avatarUrl || '').trim();
    if (!isWxCloudFileId(av)) continue;
    const https = avatarUrlForDisplayOrEmpty(resolved.get(av));
    if (https) prof.avatarUrl = https;
  }
}

const FETCH_DEDUPE_MS = 2000;
let lastFetchKey = '';
let lastFetchAt = 0;
let lastFetchPromise: Promise<Map<string, UserProfileRow>> | null = null;
let lastFetchResult: Map<string, UserProfileRow> | null = null;

async function fetchUserProfilesForOpenIdsInner(
  uniq: string[],
): Promise<Map<string, UserProfileRow>> {
  const map = new Map<string, UserProfileRow>();
  if (!uniq.length) return map;

  const fromCloud = await callGetUserProfilesCloud(uniq);
  for (const [k, v] of fromCloud) map.set(k, v);

  const needDb = uniq.filter((id) => {
    const p = map.get(id);
    return !p || !String(p.avatarUrl || '').trim();
  });
  if (needDb.length) {
    const fromDb = await fetchFromUsersDb(needDb);
    for (const [oid, prof] of fromDb) {
      const cur = map.get(oid);
      if (!cur) {
        map.set(oid, prof);
      } else if (!String(cur.avatarUrl || '').trim() && prof.avatarUrl) {
        map.set(oid, { nickName: cur.nickName || prof.nickName, avatarUrl: prof.avatarUrl });
      }
    }
  }

  await resolveProfileMapAvatarsForDisplay(map);

  const stillMissing = uniq.filter((id) => {
    const av = map.get(id)?.avatarUrl;
    return !isAvatarUrlDisplayable(av);
  });
  if (stillMissing.length > 0) {
    console.warn(
      '[fetchUserProfiles] 以下 openId 仍无可用头像（请部署 getUserProfiles 或检查 users.avatarUrl）:',
      stillMissing.slice(0, 5).join(', '),
      stillMissing.length > 5 ? `…共${stillMissing.length}人` : '',
    );
  }

  return map;
}

export async function fetchUserProfilesForOpenIds(
  openIds: string[],
): Promise<Map<string, UserProfileRow>> {
  const uniq = [...new Set(openIds.map((x) => String(x || '').trim()).filter(isFetchableOpenId))].sort();
  if (!uniq.length) return new Map();

  const key = uniq.join('\0');
  const now = Date.now();
  if (key === lastFetchKey && now - lastFetchAt < FETCH_DEDUPE_MS) {
    if (lastFetchPromise) {
      const cached = await lastFetchPromise;
      return new Map(cached);
    }
    if (lastFetchResult) return new Map(lastFetchResult);
  }

  lastFetchKey = key;
  lastFetchAt = now;
  lastFetchResult = null;
  lastFetchPromise = fetchUserProfilesForOpenIdsInner(uniq)
    .then((map) => {
      lastFetchResult = map;
      return map;
    })
    .finally(() => {
      lastFetchPromise = null;
    });
  const map = await lastFetchPromise;
  return new Map(map);
}

export function profileMapToAvatarHttps(map: Map<string, UserProfileRow>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [oid, prof] of map) {
    const av = String(prof.avatarUrl || '').trim();
    if (av) out.set(oid, av);
  }
  return out;
}
