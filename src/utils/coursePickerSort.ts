/** 选场列表：常打置顶（按最近开打），其余按与用户距离升序 */

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type SortableCourse = {
  id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
};

function compareByName(a: SortableCourse, b: SortableCourse): number {
  const na = String(a.name || '');
  const nb = String(b.name || '');
  try {
    return na.localeCompare(nb, 'zh-CN');
  } catch {
    return na.localeCompare(nb);
  }
}

function courseIdOf(c: SortableCourse): string {
  return String(c.id || '').trim();
}

function isRecentlyPlayed(
  id: string,
  playCountById: Record<string, number>,
  lastPlayedMsById: Record<string, number>,
): boolean {
  return (playCountById[id] || 0) > 0 || (lastPlayedMsById[id] || 0) > 0;
}

export function sortCoursesForPicker<T extends SortableCourse>(
  courses: T[],
  opts: {
    lat?: number;
    lng?: number;
    playCountById?: Record<string, number>;
    lastPlayedMsById?: Record<string, number>;
  },
): T[] {
  const { lat, lng, playCountById = {}, lastPlayedMsById = {} } = opts;
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);

  return [...courses].sort((a, b) => {
    const idA = courseIdOf(a);
    const idB = courseIdOf(b);
    const aRecent = isRecentlyPlayed(idA, playCountById, lastPlayedMsById);
    const bRecent = isRecentlyPlayed(idB, playCountById, lastPlayedMsById);
    if (aRecent !== bRecent) return aRecent ? -1 : 1;

    if (aRecent) {
      const ra = lastPlayedMsById[idA] || 0;
      const rb = lastPlayedMsById[idB] || 0;
      if (ra !== rb) return rb - ra;
      const pa = playCountById[idA] || 0;
      const pb = playCountById[idB] || 0;
      if (pa !== pb) return pb - pa;
      return compareByName(a, b);
    }

    if (hasLoc) {
      const aHas = Number.isFinite(a.latitude) && Number.isFinite(a.longitude);
      const bHas = Number.isFinite(b.latitude) && Number.isFinite(b.longitude);
      if (aHas && bHas) {
        const da = haversineKm(lat!, lng!, a.latitude!, a.longitude!);
        const db = haversineKm(lat!, lng!, b.latitude!, b.longitude!);
        if (da !== db) return da - db;
      } else if (aHas !== bHas) {
        return aHas ? -1 : 1;
      }
    }

    return compareByName(a, b);
  });
}
