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
      const key = normCourseKey(gc.name);
      const idx = out['广东省'].findIndex((c) => {
        const nk = normCourseKey(c.name);
        return nk === key || nk.includes(key.slice(0, 4)) || key.includes(nk.slice(0, 4));
      });
      if (idx >= 0) {
        out['广东省'][idx] = {
          ...out['广东省'][idx],
          name: gc.name,
          total_par: gc.total_par,
          holes_par: gc.holes_par ?? out['广东省'][idx].holes_par,
          sections: gc.sections ?? out['广东省'][idx].sections,
        };
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
