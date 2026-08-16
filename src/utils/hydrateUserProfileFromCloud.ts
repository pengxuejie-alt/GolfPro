/**
 * 从云数据库 users 按 openId 恢复昵称/头像，清缓存后无需重新 chooseAvatar。
 */

import { useUserStore } from '@/store/userStore';
import { db } from './db.js';
import {
  pickAvatarUrlFromUserRow,
  resolveAndCacheSelfAvatarDisplay,
} from './selfAvatarResolve';

export interface HydrateUserProfileResult {
  found: boolean;
  docId?: string;
  nickname?: string;
  avatarUrl?: string;
  /** 已解析、可展示的头像 https */
  displayHttps?: string;
  created?: boolean;
}

/** 云库是否已有完整资料（昵称 + 头像） */
export function isCloudProfileComplete(result: HydrateUserProfileResult): boolean {
  const n = result.nickname != null && String(result.nickname).trim() !== '';
  const a = result.avatarUrl != null && String(result.avatarUrl).trim() !== '';
  return n && a;
}

/**
 * 按 openId 查询 users，写入 userStore；可选创建空文档。
 * resolveAvatarHttps：cloud:// 时预拉临时 https 供 <image> 展示。
 */
export async function hydrateUserProfileFromCloud(
  openId: string,
  options?: {
    createIfMissing?: boolean;
    resolveAvatarHttps?: boolean;
    /** 上传头像进行中时不覆盖本地已选图 */
    skipAvatarOverwrite?: boolean;
  },
): Promise<HydrateUserProfileResult> {
  const oid = String(openId || '').trim();
  if (!oid) return { found: false };

  // #ifndef MP-WEIXIN
  return { found: false };
  // #endif

  // #ifdef MP-WEIXIN
  if (typeof wx === 'undefined' || !wx.cloud?.database) return { found: false };

  await db.waitForInit();
  const userStore = useUserStore();
  const wxdb = wx.cloud.database();
  const createIfMissing = options?.createIfMissing !== false;
  const resolveAvatar = options?.resolveAvatarHttps !== false;

  try {
    const snap = await wxdb.collection('users').where({ _openid: oid }).limit(1).get();
    if (!snap.data?.length) {
      if (!createIfMissing) return { found: false };
      const addRet = (await wxdb.collection('users').add({
        data: {
          _openid: oid,
          openid: oid,
          nickName: '',
          avatarUrl: '',
          handicap: 0,
          gender: 0,
          city: '',
          updated_at: wxdb.serverDate(),
          created_at: wxdb.serverDate(),
        },
      })) as { _id?: string };
      const newId = addRet._id != null ? String(addRet._id) : '';
      if (newId) userStore.setCloudUserDocId(newId);
      return { found: false, created: true, docId: newId || undefined };
    }

    const row = snap.data[0] as Record<string, unknown>;
    const docId = row._id != null ? String(row._id) : '';
    if (docId) userStore.setCloudUserDocId(docId);

    const nn = row.nickName ?? row.nickname;
    const nickname = nn != null && String(nn).trim() !== '' ? String(nn).trim() : '';
    const avatarUrl = pickAvatarUrlFromUserRow(row);

    if (nickname) userStore.updateProfile({ nickname });
    if (avatarUrl && !options?.skipAvatarOverwrite) {
      userStore.updateProfile({ avatar: avatarUrl });
    }
    // 云库默认 handicap:0 表示未填；非 0/非旧占位 12.5 才写入（完赛均值由首页同步）
    const rawHcp = row.handicap;
    if (rawHcp != null && Number.isFinite(Number(rawHcp))) {
      const n = Number(rawHcp);
      if (n !== 0 && n !== 12.5) {
        userStore.updateProfile({ handicap: n });
      }
    }

    let displayHttps = '';
    if (avatarUrl && resolveAvatar) {
      displayHttps = await resolveAndCacheSelfAvatarDisplay(oid, avatarUrl);
    }

    return {
      found: !!(nickname || avatarUrl),
      docId: docId || undefined,
      nickname: nickname || undefined,
      avatarUrl: avatarUrl || undefined,
      displayHttps: displayHttps || undefined,
    };
  } catch (e) {
    console.warn('[hydrateUserProfileFromCloud]', e);
    return { found: false };
  }
  // #endif
}
