/**
 * 小程序 verbose 日志门控：开发包默认开启；正式包需 storage 或 global 开关。
 * 重新开启：开发者工具 Console 执行 setMpDebugEnabled(true)，或
 * wx.setStorageSync('golfpro_debug', '1') 后重启小程序。
 */

let cachedEnabled: boolean | null = null;

function readStorageDebugFlag(): boolean {
  try {
    const w = (globalThis as Record<string, unknown>).wx as
      | { getStorageSync?: (key: string) => unknown }
      | undefined;
    if (w?.getStorageSync) {
      const v = w.getStorageSync('golfpro_debug');
      return v === '1' || v === true || v === 'true';
    }
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      const v = uni.getStorageSync('golfpro_debug');
      return v === '1' || v === true || v === 'true';
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function isMpDebugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV === true) {
      cachedEnabled = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  try {
    const g =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof window !== 'undefined'
          ? window
          : ({} as Record<string, unknown>);
    if ((g as Record<string, unknown>).__GOLFPRO_DEBUG__ === true) {
      cachedEnabled = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  cachedEnabled = readStorageDebugFlag();
  return cachedEnabled;
}

/** 运行时切换 verbose 日志（会写入 storage） */
export function setMpDebugEnabled(on: boolean): void {
  cachedEnabled = on;
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync('golfpro_debug', on ? '1' : '');
    }
  } catch {
    /* ignore */
  }
}

export function debugLog(...args: unknown[]): void {
  if (isMpDebugEnabled()) console.log(...args);
}

export function debugInfo(...args: unknown[]): void {
  if (isMpDebugEnabled()) console.info(...args);
}
