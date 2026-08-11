import { ref } from 'vue';
import { getPrivacyNeedAuthorizationAsync, emitPrivacyContractAgreed } from '@/utils/mpPrivacyBridge';

/** 首页 / 计分页共用的半屏隐私 Modal（agreePrivacyAuthorization 闭环） */
export function useMpPrivacyGate(logTag = '[privacy]') {
  const showPrivacyModal = ref(false);
  const sessionAgreed = ref(false);
  let privacyModalResolve: ((ok: boolean) => void) | null = null;
  let privacyGateInFlight: Promise<boolean> | null = null;

  async function gatePrivacyBeforeCloud(): Promise<boolean> {
    // #ifndef MP-WEIXIN
    return true;
    // #endif
    // #ifdef MP-WEIXIN
    if (privacyGateInFlight) return privacyGateInFlight;
    const needAuth = await getPrivacyNeedAuthorizationAsync();
    if (!needAuth) return true;
    if (sessionAgreed.value) return true;
    privacyGateInFlight = new Promise<boolean>((resolve) => {
      privacyModalResolve = (ok: boolean) => {
        showPrivacyModal.value = false;
        privacyModalResolve = null;
        privacyGateInFlight = null;
        if (ok) sessionAgreed.value = true;
        resolve(ok);
      };
      console.log(`${logTag} gate: showPrivacyModal=true`);
      showPrivacyModal.value = true;
    });
    return privacyGateInFlight;
    // #endif
  }

  function onPrivacyModalAgree(e?: { detail?: { errMsg?: string } }) {
    const msg = e?.detail?.errMsg ?? '';
    if (msg && !String(msg).includes('ok')) {
      privacyModalResolve?.(false);
      return;
    }
    try {
      emitPrivacyContractAgreed();
    } catch (err) {
      console.warn(`${logTag} emitPrivacyContractAgreed`, err);
    }
    privacyModalResolve?.(true);
  }

  function onPrivacyModalDisagree() {
    privacyModalResolve?.(false);
  }

  function openPrivacyContract() {
    try {
      const w = wx as unknown as { openPrivacyContract?: (o: object) => void };
      if (typeof w?.openPrivacyContract === 'function') {
        w.openPrivacyContract({});
      } else {
        uni.showToast({ title: '当前环境暂不支持打开指引', icon: 'none' });
      }
    } catch {
      uni.showToast({ title: '无法打开隐私指引', icon: 'none' });
    }
  }

  /** 本场已通过内联 Modal 点「同意」（getPrivacySetting 可能滞后） */
  async function shouldBlockCloudForPrivacy(): Promise<boolean> {
    const needAuth = await getPrivacyNeedAuthorizationAsync();
    if (!needAuth) return false;
    return !sessionAgreed.value;
  }

  return {
    showPrivacyModal,
    sessionAgreed,
    gatePrivacyBeforeCloud,
    shouldBlockCloudForPrivacy,
    onPrivacyModalAgree,
    onPrivacyModalDisagree,
    openPrivacyContract,
  };
}
