/**
 * 设备定位会话缓存：首页天气与创建球局选场共用，避免 onShow / 弹层重复 uni.getLocation。
 */

export const DEFAULT_FALLBACK_LOCATION = { latitude: 23.1291, longitude: 113.3239 };

const LOCATION_TTL_MS = 20 * 60 * 1000;

interface CachedLocation {
  latitude: number;
  longitude: number;
  fetchedAt: number;
}

let memory: CachedLocation | null = null;
let locationInFlight: Promise<{ latitude: number; longitude: number } | null> | null = null;
let weatherRefreshedThisSession = false;

function getLocationFailErrno(err: unknown): number | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  const e = err as { errno?: number; errMsg?: string; message?: string };
  if (typeof e.errno === 'number') return e.errno;
  const msg = String(e.errMsg ?? e.message ?? '');
  const m = msg.match(/errno\s*[：:=]?\s*(\d+)/i);
  if (m) return Number(m[1]);
  return undefined;
}

export function getCachedDeviceLocation(
  maxAgeMs = LOCATION_TTL_MS,
): { latitude: number; longitude: number } | null {
  if (!memory) return null;
  if (Date.now() - memory.fetchedAt > maxAgeMs) return null;
  return { latitude: memory.latitude, longitude: memory.longitude };
}

export function setCachedDeviceLocation(lat: number, lng: number): void {
  memory = { latitude: lat, longitude: lng, fetchedAt: Date.now() };
}

export function hasWeatherRefreshedThisSession(): boolean {
  return weatherRefreshedThisSession;
}

export function markWeatherRefreshedThisSession(): void {
  weatherRefreshedThisSession = true;
}

export type RequestDeviceLocationOptions = {
  /** 忽略 TTL，强制重新 getLocation */
  force?: boolean;
  onFail?: (errno: number | undefined) => void;
};

/** 优先返回 TTL 内缓存；并发请求合并为单次 getLocation */
export function requestDeviceLocationCached(
  opts?: RequestDeviceLocationOptions,
): Promise<{ latitude: number; longitude: number } | null> {
  const force = opts?.force === true;
  if (!force) {
    const cached = getCachedDeviceLocation();
    if (cached) return Promise.resolve(cached);
  }
  if (locationInFlight) return locationInFlight;

  locationInFlight = new Promise((resolve) => {
    try {
      uni.getLocation({
        type: 'gcj02',
        isHighAccuracy: false,
        success: (res) => {
          const lat = Number(res.latitude);
          const lng = Number(res.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            resolve(getCachedDeviceLocation(LOCATION_TTL_MS * 2));
            return;
          }
          setCachedDeviceLocation(lat, lng);
          resolve({ latitude: lat, longitude: lng });
        },
        fail: (err) => {
          opts?.onFail?.(getLocationFailErrno(err));
          resolve(getCachedDeviceLocation(LOCATION_TTL_MS * 2));
        },
        complete: () => {
          locationInFlight = null;
        },
      });
    } catch {
      locationInFlight = null;
      resolve(getCachedDeviceLocation());
    }
  });
  return locationInFlight;
}

/** 选场排序：同步读缓存或默认 fallback，不触发 getLocation */
export function getPickerLocationSync(): { lat: number; lng: number } {
  const cached = getCachedDeviceLocation();
  if (cached) return { lat: cached.latitude, lng: cached.longitude };
  return {
    lat: DEFAULT_FALLBACK_LOCATION.latitude,
    lng: DEFAULT_FALLBACK_LOCATION.longitude,
  };
}

/** 选场打开：复用缓存，仅在无缓存时请求一次定位 */
export async function resolvePickerLocation(): Promise<{ lat: number; lng: number }> {
  const loc = await requestDeviceLocationCached();
  if (loc) return { lat: loc.latitude, lng: loc.longitude };
  return getPickerLocationSync();
}
