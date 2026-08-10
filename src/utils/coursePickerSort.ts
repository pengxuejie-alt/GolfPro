/** 选场列表：常打优先，其次按与用户距离升序 */

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

export function sortCoursesForPicker<T extends SortableCourse>(
  courses: T[],
  opts: {
    lat?: number;
    lng?: number;
    playCountById?: Record<string, number>;
  },
): T[] {
  const { lat, lng, playCountById = {} } = opts;
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng);

  return [...courses].sort((a, b) => {
    const pa = playCountById[String(a.id || '').trim()] || 0;
    const pb = playCountById[String(b.id || '').trim()] || 0;
    if (pa !== pb) return pb - pa;

    if (hasLoc) {
      const aHas = Number.isFinite(a.latitude) && Number.isFinite(a.longitude);
      const bHas = Number.isFinite(b.latitude) && Number.isFinite(b.longitude);
      if (aHas && bHas) {
        return (
          haversineKm(lat!, lng!, a.latitude!, a.longitude!) -
          haversineKm(lat!, lng!, b.latitude!, b.longitude!)
        );
      }
      if (aHas !== bHas) return aHas ? -1 : 1;
    }

    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
  });
}
