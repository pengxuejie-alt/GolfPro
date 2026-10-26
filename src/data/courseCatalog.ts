/**
 * 应用球场库（全国 GolfLive + 广东手工校对覆盖）
 * CreateMatch / 记分卡选场统一使用本模块。
 */
import { nationalCourseData, type NationalCourse } from './nationalCourses';
import { gdCourseData } from './guangdongCourses';
import { courseGeoCoords } from './courseGeoCoords';

export type { NationalCourse };

export type CatalogCourse = NationalCourse & {
  latitude?: number;
  longitude?: number;
};

/** 应用内显示名 / 半场名等校对（GolfLive 导入后覆盖） */
const COURSE_CATALOG_OVERRIDES: Record<string, Partial<CatalogCourse>> = {
  '12500-BA0C-0331': {
    name: '广州华美麓湖高尔夫',
  },
  '12400-363F-474D': {
    name: '广州仙村国际高尔夫',
  },
};

function attachGeo(c: NationalCourse): CatalogCourse {
  const g = courseGeoCoords[c.id];
  if (!g) return { ...c };
  return { ...c, latitude: g.lat, longitude: g.lng };
}

function applyCatalogOverrides(c: NationalCourse): CatalogCourse {
  const ov = COURSE_CATALOG_OVERRIDES[c.id];
  const base = attachGeo(c);
  if (!ov) return base;
  return {
    ...base,
    ...ov,
    sections: ov.sections ?? base.sections,
    holes_par: ov.holes_par ?? base.holes_par,
  };
}

function normCourseKey(name: string): string {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .replace(/(国际|乡村|度假|俱乐部|球会|球场|高尔夫)/g, '')
    .trim();
}

const CITY_PREFIX =
  /^(广州|深圳|东莞|惠州|佛山|珠海|清远|中山|肇庆|阳江|汕头|揭阳|汕尾|韶关|湛江|梅州|潮州|江门|番禺|顺德|南海|四会|惠阳)/;

function coreCourseKey(name: string): string {
  return normCourseKey(name).replace(CITY_PREFIX, '');
}

function formerNameKeys(name: string): string[] {
  const keys: string[] = [];
  const re = /[（(]原([^)）]+)[)）]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name))) {
    const key = coreCourseKey(m[1]);
    if (key.length >= 2) keys.push(key);
  }
  return keys;
}

function scoreNameKeys(left: string, right: string, minLen: number): number {
  if (!left || !right) return 0;
  if (left === right && left.length >= minLen) return 100;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length >= minLen && longer.includes(shorter)) {
    return Math.round((shorter.length / longer.length) * 100);
  }
  let i = 0;
  const n = Math.min(left.length, right.length);
  while (i < n && left[i] === right[i]) i += 1;
  if (i >= minLen) return Math.round((i / Math.min(left.length, right.length)) * 100);
  return 0;
}

/**
 * 0–100。80 分及以上才当成同一球场；
 * 40–79 分只跳过，避免把标准杆写到别的球场，或再追加一条重复记录。
 */
function courseMatchScore(a: string, b: string): number {
  const ca = coreCourseKey(a);
  const cb = coreCourseKey(b);
  let score = 0;
  if (ca.length >= 3 && cb.length >= 3) score = scoreNameKeys(ca, cb, 3);
  if (!score) score = scoreNameKeys(normCourseKey(a), normCourseKey(b), 4);
  for (const extra of [...formerNameKeys(a), ...formerNameKeys(b)]) {
    const other = formerNameKeys(a).includes(extra) ? cb : ca;
    if (extra.length >= 2 && (other === extra || other.endsWith(extra))) score = Math.max(score, 85);
  }
  return score;
}

function bestGuangdongMatch(name: string, courses: { name: string }[]): { index: number; score: number } {
  let index = -1;
  let score = 0;
  courses.forEach((c, i) => {
    const s = courseMatchScore(name, c.name);
    if (s > score) {
      score = s;
      index = i;
    }
  });
  return { index, score };
}

function completeNineCount(course: { sections?: { holes_par: number[] }[]; holes_par?: number[] }): number {
  const fromSections = (course.sections ?? []).filter((s) => s.holes_par?.length === 9).length;
  if (fromSections >= 2) return fromSections;
  return course.holes_par?.length === 18 ? 2 : fromSections;
}

/** 广东手工库 → 全国库条目（全国库无同名时追加） */
function patchGuangdongCourse(gd: (typeof gdCourseData)[string][number], city: string): NationalCourse {
  return {
    id: `gd-${normCourseKey(gd.name)}`,
    name: gd.name,
    city,
    total_par: gd.total_par,
    holes_par: gd.holes_par,
    sections: gd.sections,
  };
}

const GUANGDONG_REMOVE_IDS = new Set([
  /** 合并为「广州风神高尔夫」四场 */
  '12800-AE75-3008',
  '11588-7965-9191',
]);

const GD_CITY_MAP: Record<string, string> = {
  广州: '广州市',
  深圳: '深圳市',
  东莞: '东莞市',
  惠州: '惠州市',
  '佛山/清远': '佛山市',
  珠海: '珠海市',
  其他城市: '广东省',
};

function buildCourseCatalog(): Record<string, CatalogCourse[]> {
  const out: Record<string, CatalogCourse[]> = {};
  for (const [prov, list] of Object.entries(nationalCourseData)) {
    out[prov] = list.map((c) => ({
      ...c,
      sections: c.sections?.map((s) => ({ ...s, holes_par: [...s.holes_par] })),
      holes_par: c.holes_par ? [...c.holes_par] : undefined,
    }));
  }

  if (!out['广东省']) out['广东省'] = [];
  out['广东省'] = out['广东省'].filter((c) => !GUANGDONG_REMOVE_IDS.has(c.id));

  const gdNansha = gdCourseData['广州']?.find((c) => c.name.includes('南沙'));
  const nanshaIdx = out['广东省'].findIndex((c) => c.id === '12200-97F6-2382');
  if (nanshaIdx >= 0 && gdNansha?.sections) {
    out['广东省'][nanshaIdx] = {
      ...out['广东省'][nanshaIdx],
      name: gdNansha.name,
      sections: gdNansha.sections.map((s) => ({ ...s, holes_par: [...s.holes_par] })),
      total_par: gdNansha.total_par,
    };
  }

  const gdFengshen = gdCourseData['广州']?.find((c) => c.name.includes('风神'));
  if (gdFengshen?.sections) {
    out['广东省'].push({
      id: 'gd-gz-fengshen',
      name: gdFengshen.name,
      city: '广州市',
      total_par: gdFengshen.total_par,
      sections: gdFengshen.sections.map((s) => ({ ...s, holes_par: [...s.holes_par] })),
    });
  }

  for (const [gdCity, cityCourses] of Object.entries(gdCourseData)) {
    const cityLabel = GD_CITY_MAP[gdCity] ?? gdCity;
    for (const gc of cityCourses) {
      if (gc.name.includes('南沙') || gc.name.includes('风神')) continue;
      const { index, score } = bestGuangdongMatch(gc.name, out['广东省']);
      if (score >= 80 && index >= 0) {
        const current = out['广东省'][index];
        if (completeNineCount(current) >= 2) continue;
        out['广东省'][index] = {
          ...current,
          name: gc.name,
          total_par: gc.total_par,
          holes_par: gc.holes_par ?? current.holes_par,
          sections: gc.sections ?? current.sections,
        };
      } else if (score >= 40) {
        continue;
      } else if (gc.holes_par?.length === 18 || (gc.sections && gc.sections.length >= 2)) {
        out['广东省'].push(patchGuangdongCourse(gc, cityLabel));
      }
    }
  }

  for (const prov of Object.keys(out)) {
    out[prov] = out[prov].map((c) => applyCatalogOverrides(c));
    out[prov].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  return out;
}

/** 全国 + 广东覆盖后的正式球场库 */
export const courseCatalogData = buildCourseCatalog();

export function courseCatalogStats() {
  const provinces = Object.keys(courseCatalogData).length;
  const courses = Object.values(courseCatalogData).reduce((n, arr) => n + arr.length, 0);
  return { provinces, courses };
}

export type PickerCourseRow = CatalogCourse & {
  id: string;
  name: string;
  province: string;
  city: string;
  logo_url: string;
  holes: { no: number; par: number }[];
};

export function flattenCoursesForPicker(): PickerCourseRow[] {
  const courses: PickerCourseRow[] = [];
  Object.entries(courseCatalogData).forEach(([province, provinceCourses]) => {
    provinceCourses.forEach((c) => {
      const name = String(c?.name || '').trim();
      if (!name) return;
      courses.push({
        ...c,
        id: c.id || name,
        name,
        province,
        city: String(c.city || province || '').trim() || province,
        logo_url: `https://picsum.photos/seed/${encodeURIComponent(name)}/100/100`,
        holes: c.holes_par ? c.holes_par.map((par, i) => ({ no: i + 1, par })) : [],
      });
    });
  });
  return courses;
}
