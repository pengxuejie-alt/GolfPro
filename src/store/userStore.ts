import { defineStore } from 'pinia';

export interface UserProfile {
  nickname: string;
  avatar: string;
  gender: 'male' | 'female';
  /** null = 尚无完赛/差点记录，计分卡展示 -- */
  handicap: number | null;
}

export interface AuthResult {
  mode: 'wx' | 'mock';
  openId: string;
  nickname?: string;
  avatar?: string;
}

const STORAGE_OPENID = 'golfpro_openid';
const STORAGE_AUTH_MODE = 'golfpro_auth_mode';
const STORAGE_CLOUD_USER_DOC_ID = 'golfpro_cloud_user_doc_id';
/** 昵称/头像本地缓存：清微信缓存后仍可由云库恢复，此处加速首屏 */
const STORAGE_PROFILE = 'golfpro_profile_cache_v1';

export const useUserStore = defineStore('user', {
  state: () => ({
    profile: {
      nickname: '',
      avatar: '',
      gender: 'male' as const,
      handicap: null,
    } as UserProfile,
    openId: '' as string,
    /** users 文档 _id，对应 db.collection('users').doc(...) */
    cloudUserDocId: '' as string,
    authMode: 'mock' as 'wx' | 'mock',
  }),
  getters: {
    /** 与云端 users 文档 _id 一致，等价 cloudUserDocId */
    uid: (state): string => state.cloudUserDocId,
  },
  actions: {
    updateProfile(newProfile: Partial<UserProfile>) {
      this.profile = { ...this.profile, ...newProfile };
      try {
        uni.setStorageSync(STORAGE_PROFILE, {
          nickname: this.profile.nickname,
          avatar: this.profile.avatar,
          gender: this.profile.gender,
          handicap: this.profile.handicap,
        });
      } catch {
        /* ignore */
      }
    },

    setCloudUserDocId(docId: string) {
      const id = docId != null && String(docId).trim() !== '' ? String(docId).trim() : '';
      this.cloudUserDocId = id;
      try {
        if (id) uni.setStorageSync(STORAGE_CLOUD_USER_DOC_ID, id);
        else uni.removeStorageSync(STORAGE_CLOUD_USER_DOC_ID);
      } catch {
        /* ignore */
      }
    },

    /** 登录结果写入；云端未带头像昵称时不覆盖用户已填的 chooseAvatar / nickname */
    applyAuthResult(result: AuthResult) {
      const nextOpen = result.openId || '';
      if (this.openId && nextOpen && this.openId !== nextOpen) {
        this.setCloudUserDocId('');
      }
      this.authMode = result.mode;
      this.openId = nextOpen;
      try {
        if (this.openId) uni.setStorageSync(STORAGE_OPENID, this.openId);
        uni.setStorageSync(STORAGE_AUTH_MODE, this.authMode);
      } catch {
        /* ignore */
      }
      if (result.nickname && String(result.nickname).trim()) {
        this.updateProfile({ nickname: String(result.nickname).trim() });
      }
      if (result.avatar && String(result.avatar).trim()) {
        this.updateProfile({ avatar: String(result.avatar).trim() });
      }
    },

    hydrateAuthFromStorage() {
      try {
        const oid = uni.getStorageSync(STORAGE_OPENID);
        if (oid != null && String(oid).trim() !== '') this.openId = String(oid).trim();
        const m = uni.getStorageSync(STORAGE_AUTH_MODE);
        if (m === 'wx' || m === 'mock') this.authMode = m;
        const did = uni.getStorageSync(STORAGE_CLOUD_USER_DOC_ID);
        if (did != null && String(did).trim() !== '') this.cloudUserDocId = String(did).trim();
        const cached = uni.getStorageSync(STORAGE_PROFILE) as Partial<UserProfile> | undefined;
        if (cached && typeof cached === 'object') {
          if (cached.nickname != null && String(cached.nickname).trim() !== '') {
            this.profile.nickname = String(cached.nickname).trim();
          }
          if (cached.avatar != null && String(cached.avatar).trim() !== '') {
            this.profile.avatar = String(cached.avatar).trim();
          }
          if (cached.gender === 'male' || cached.gender === 'female') {
            this.profile.gender = cached.gender;
          }
          if (typeof cached.handicap === 'number' && Number.isFinite(cached.handicap)) {
            this.profile.handicap = cached.handicap;
          }
        }
      } catch {
        /* ignore */
      }
    },
  },
});
