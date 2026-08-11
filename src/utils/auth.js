/**
 * 微信小程序登录：uni.login 取 code → 云函数 login 换 openId；失败则 mock，保证 UI 可用。
 * 所有 wx / uni 异步调用均带 fail，避免模拟器未处理 rejection。
 */

import { db } from './db.js';
import { getPrivacyNeedAuthorizationAsync, requestPrivacyAgreementViaPopup } from './mpPrivacyBridge';

export const MOCK_USER = {
  openId: 'mock_golfpro_user',
  nickname: 'GolfPro 体验用户',
  avatar: 'https://picsum.photos/seed/golfpro-mock/200/200',
};

/** 与 cloudfunctions/login 目录名一致；部署：微信开发者工具 → 右键 cloudfunctions/login → 上传并部署 */
const LOGIN_FN_NAME = 'login';

const LOGIN_DEPLOY_HINT =
  '请确保已在微信开发者工具中右键上传并部署 cloudfunctions/login';

function hasWxCloudCallFunction() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callFunction === 'function';
}

/**
 * @param {string} code
 * @returns {Promise<Record<string, unknown>|null>}
 */
export function callLoginCloudFunction(code) {
  return new Promise((resolve) => {
    if (!hasWxCloudCallFunction()) {
      resolve(null);
      return;
    }
    try {
      wx.cloud.callFunction({
        name: LOGIN_FN_NAME,
        data: { code },
        success: (res) => resolve(res?.result ?? null),
        fail: (err) => {
          const msg = String(err?.errMsg ?? err?.message ?? err ?? '');
          const msgL = msg.toLowerCase();
          if (
            msg.includes('FUNCTION_NOT_FOUND') ||
            msg.includes('-501000') ||
            msg.includes('501000') ||
            (msgL.includes('functionname') && msgL.includes('not found'))
          ) {
            console.warn(
              '[运维提醒] 请右键部署 cloudfunctions/login（云函数 login 未找到 / FUNCTION_NOT_FOUND）',
              err
            );
          } else {
            console.warn(`[auth] 云函数「${LOGIN_FN_NAME}」调用失败。${LOGIN_DEPLOY_HINT}`, err);
          }
          resolve(null);
        },
      });
    } catch (e) {
      console.warn('[auth] callFunction 异常', e);
      resolve(null);
    }
  });
}

/**
 * @returns {Promise<{ code?: string; errMsg?: string }>}
 */
export function wxLoginCode() {
  return new Promise((resolve) => {
    try {
      uni.login({
        provider: 'weixin',
        success: (res) => {
          if (res && res.code) resolve({ code: res.code });
          else resolve({ errMsg: res?.errMsg || 'no code' });
        },
        fail: (err) => {
          console.warn('[auth] uni.login fail', err);
          resolve({ errMsg: err?.errMsg || String(err) });
        },
      });
    } catch (e) {
      console.warn('[auth] uni.login 异常', e);
      resolve({ errMsg: String(e) });
    }
  });
}

function pickOpenId(result) {
  if (!result || typeof result !== 'object') return '';
  const o =
    result.openId ||
    result.openid ||
    result.OPENID ||
    result.userInfo?.openId ||
    result.userInfo?.openid ||
    '';
  return o ? String(o) : '';
}

/**
 * 云写入前确保隐私已同意且拿到真实 wx openId（非 mock / 非 host_ 占位）。
 * @param {{ gatePrivacyBeforeCloud?: () => Promise<boolean> }} [options]
 * @returns {Promise<{ ok: boolean; step?: string; error?: string; session?: Awaited<ReturnType<typeof signInWithWeChat>> }>}
 */
export async function ensureWxSessionForCloud(options = {}) {
  const { gatePrivacyBeforeCloud } = options;
  await db.waitForInit();

  if (typeof wx !== 'undefined') {
    if (typeof gatePrivacyBeforeCloud === 'function') {
      const privacyOk = await gatePrivacyBeforeCloud();
      if (!privacyOk) {
        return { ok: false, step: 'privacy', error: 'privacy_denied' };
      }
    } else {
      const needAuth = await getPrivacyNeedAuthorizationAsync();
      if (needAuth) {
        const agreed = await requestPrivacyAgreementViaPopup();
        if (!agreed) {
          return { ok: false, step: 'privacy', error: 'privacy_denied' };
        }
      }
    }
  }

  const session = await signInWithWeChat();
  const openId = pickOpenId(session);
  if (!openId || session.mode !== 'wx') {
    return {
      ok: false,
      step: 'login',
      error: session.mode === 'mock' ? 'login_degraded_mock' : 'no_openId',
      session,
    };
  }
  return { ok: true, session };
}

/**
 * 执行登录链路；任意环节失败返回 mode: mock，不抛错。
 * @returns {Promise<{ mode: 'wx'|'mock'; openId: string; nickname?: string; avatar?: string; code?: string }>}
 */
export async function signInWithWeChat() {
  if (typeof uni === 'undefined') {
    return { mode: 'mock', openId: MOCK_USER.openId, nickname: MOCK_USER.nickname, avatar: MOCK_USER.avatar };
  }

  const platform = (() => {
    // #ifdef MP-WEIXIN
    return 'mp-weixin';
    // #endif
    // #ifndef MP-WEIXIN
    try {
      return uni.getSystemInfoSync()?.uniPlatform || '';
    } catch {
      return '';
    }
    // #endif
  })();

  if (platform !== 'mp-weixin' && typeof wx === 'undefined') {
    return { mode: 'mock', openId: MOCK_USER.openId, nickname: MOCK_USER.nickname, avatar: MOCK_USER.avatar };
  }

  const loginRes = await wxLoginCode();
  if (!loginRes.code) {
    console.warn('[auth] 无 code，降级 mock', loginRes.errMsg);
    return { mode: 'mock', openId: MOCK_USER.openId, nickname: MOCK_USER.nickname, avatar: MOCK_USER.avatar };
  }

  await db.waitForInit();

  const cloud = await callLoginCloudFunction(loginRes.code);
  const openId = pickOpenId(cloud);
  if (!openId) {
    console.warn(`[auth] 云函数「${LOGIN_FN_NAME}」未返回 openId，已降级本地体验。${LOGIN_DEPLOY_HINT}`);
    return {
      mode: 'mock',
      openId: MOCK_USER.openId,
      nickname: MOCK_USER.nickname,
      avatar: MOCK_USER.avatar,
      code: loginRes.code,
    };
  }

  const nickname =
    (cloud && (cloud.nickName || cloud.nickname)) != null ? String(cloud.nickName || cloud.nickname) : undefined;
  const avatar =
    (cloud && (cloud.avatarUrl || cloud.avatar)) != null ? String(cloud.avatarUrl || cloud.avatar) : undefined;

  return {
    mode: 'wx',
    openId,
    nickname,
    avatar,
    code: loginRes.code,
  };
}
