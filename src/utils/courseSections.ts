import { flattenCoursesForPicker, type PickerCourseRow } from '@/data/courseCatalog';

/** 半场一条（与 guangdongCourses 中 sections 项结构一致） */
export type CourseNineSection = { name: string; holes_par: number[] };

export type CourseHalfOrderTitle = { base: string; suffix: string; full: string };

/** 标准 18 洞：拆成前 9 / 后 9，用于与多半场球场一致的「先打哪半边」组合 */
export function nineHoleSectionsFrom18(holes_par: number[]): CourseNineSection[] | null {
  if (!Array.isArray(holes_par) || holes_par.length !== 18) return null;
  return [
    { name: '前9', holes_par: holes_par.slice(0, 9) },
    { name: '后9', holes_par: holes_par.slice(9, 18) },
  ];
}

/** GolfLive 等数据源常把两半场都标成「半场」；选场 UI 用 name 作 key，须去重 */
function disambiguateSectionNames(sections: CourseNineSection[]): CourseNineSection[] {
  if (sections.length < 2) return sections;
  const names = sections.map((s) => s.name);
  if (new Set(names).size === names.length) return sections;

  if (sections.length === 2) {
    return sections.map((s, i) => ({
      ...s,
      name: i === 0 ? '前9' : '后9',
    }));
  }

  const seen = new Map<string, number>();
  return sections.map((s) => {
    const dupCount = names.filter((n) => n === s.name).length;
    if (dupCount <= 1) return s;
    const ord = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, ord);
    return { ...s, name: `${s.name}${ord}` };
  });
}

function parsFromHolesProp(holes: Array<{ par?: number } | undefined> | undefined): number[] | null {
  if (!Array.isArray(holes) || holes.length !== 18) return null;
  return holes.map((h) => Number(h?.par ?? 4));
}

/** 选球场后是否需要进入「两半场组合 / 顺序」步 */
export function courseNeedsSectionCombo(course: {
  id?: string;
  sections?: unknown[] | undefined;
  holes_par?: number[] | undefined;
  holes?: Array<{ par?: number }> | undefined;
} | null | undefined): boolean {
  if (!course) return false;
  if (course.id === 'custom-indoor') return false;
  if (Array.isArray(course.sections) && course.sections.length >= 2) return true;
  if (Array.isArray(course.holes_par) && course.holes_par.length === 18) return true;
  if (parsFromHolesProp(course.holes) != null) return true;
  return false;
}

/** 半场选择器展示列表：多 section 球场用数据自带；18 洞用合成前9/后9 */
export function sectionsForCoursePicker(course: {
  sections?: CourseNineSection[] | undefined;
  holes_par?: number[] | undefined;
  holes?: Array<{ par?: number }> | undefined;
} | null | undefined): CourseNineSection[] {
  if (!course) return [];
  if (Array.isArray(course.sections) && course.sections.length > 0) {
    return disambiguateSectionNames(course.sections);
  }
  const fromPar = nineHoleSectionsFrom18(course.holes_par ?? []);
  if (fromPar) return fromPar;
  const pars = parsFromHolesProp(course.holes);
  if (pars) {
    const n = nineHoleSectionsFrom18(pars);
    if (n) return n;
  }
  return [];
}

/** 标题展示：球场名紧接半场顺序，先打的在前。例：xxx球场B、A */
export function formatCourseHalfOrderName(baseName: string, firstName: string, secondName: string): string {
  const base = String(baseName || '').trim();
  const first = String(firstName || '').trim();
  const second = String(secondName || '').trim();
  if (!first || !second) return base;
  if (!base) return `${first}、${second}`;
  return `${base}${first}、${second}`;
}

const STORED_HALF_PAREN = /^(.*?)[(（]\s*([^()（）+＋、]+)\s*[+＋]\s*([^()（）+＋、]+)\s*[)）]\s*$/;

/** 旧数据形如「球场 (B+A)」；顿号形式留给名称匹配 */
export function splitStoredCourseHalfOrder(rawName: string): {
  baseName: string;
  halves: [string, string] | null;
} {
  const raw = String(rawName || '').trim();
  const matched = raw.match(STORED_HALF_PAREN);
  if (!matched) return { baseName: raw, halves: null };
  return {
    baseName: matched[1].trim(),
    halves: [matched[2].trim(), matched[3].trim()],
  };
}

function parsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((n, i) => Number(n) === Number(b[i]));
}

function findSectionsByNames(
  sections: CourseNineSection[],
  firstName: string,
  secondName: string,
): CourseNineSection[] {
  const first = sections.find((s) => s.name === firstName);
  if (!first) return [];
  const second =
    sections.find((s) => s !== first && s.name === secondName) ||
    sections.find((s) => s.name === secondName);
  if (!second || second === first) return [];
  return [first, second];
}

/** 从已保存的球场名还原两个半场（先前后） */
export function matchSectionsFromStoredName(
  rawName: string,
  sections: CourseNineSection[],
): CourseNineSection[] {
  const raw = String(rawName || '').trim();
  if (!raw || sections.length < 2) return [];
  const split = splitStoredCourseHalfOrder(raw);
  if (split.halves) {
    const byParen = findSectionsByNames(sections, split.halves[0], split.halves[1]);
    if (byParen.length === 2) return byParen;
  }
  const names = [...new Set(sections.map((s) => s.name).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const first of names) {
    for (const second of names) {
      const suffix = `${first}、${second}`;
      if (raw.length <= suffix.length || !raw.endsWith(suffix)) continue;
      const hit = findSectionsByNames(sections, first, second);
      if (hit.length === 2) return hit;
    }
  }
  return [];
}

/**
 * 用 1–9 / 10–18 的标准杆对上半场。
 * 两半场标准杆无法唯一区分时返回空，避免把顺序标反。
 */
export function matchSectionsFromHolePars(
  pars: number[],
  sections: CourseNineSection[],
): CourseNineSection[] {
  if (!Array.isArray(pars) || pars.length < 18 || sections.length < 2) return [];
  const front = pars.slice(0, 9).map((n) => Number(n));
  const back = pars.slice(9, 18).map((n) => Number(n));
  const frontHits = sections.filter((s) => parsEqual(s.holes_par.map((n) => Number(n)), front));
  if (frontHits.length !== 1) return [];
  const backs = sections.filter(
    (s) => s !== frontHits[0] && parsEqual(s.holes_par.map((n) => Number(n)), back),
  );
  if (backs.length !== 1) return [];
  return [frontHits[0], backs[0]];
}

export function resolveSelectedSections(
  rawName: string,
  holePars: number[] | undefined,
  sections: CourseNineSection[],
): CourseNineSection[] {
  const byName = matchSectionsFromStoredName(rawName, sections);
  if (byName.length === 2) return byName;
  return matchSectionsFromHolePars(holePars || [], sections);
}

export function courseBaseName(
  course: { name?: string } | null | undefined,
  sections?: CourseNineSection[],
): string {
  const name = String(course?.name || '').trim();
  if (!name) return '';
  const split = splitStoredCourseHalfOrder(name);
  if (split.halves) return split.baseName;
  if (sections?.length) {
    const hit = matchSectionsFromStoredName(name, sections);
    if (hit.length === 2) {
      const suffix = `${hit[0].name}、${hit[1].name}`;
      if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
    }
  }
  return name;
}

export function courseHalfOrderTitle(
  rawName: string,
  sections?: CourseNineSection[] | null,
  holePars?: number[] | null,
): CourseHalfOrderTitle {
  const raw = String(rawName || '').trim();
  const plain = { base: raw, suffix: '', full: raw };
  if (!raw) return plain;
  const split = splitStoredCourseHalfOrder(raw);
  const named = sections?.length ? matchSectionsFromStoredName(raw, sections) : [];
  if (named.length === 2) {
    let base = split.halves ? split.baseName : raw;
    const suffix = `${named[0].name}、${named[1].name}`;
    if (!split.halves && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
    return {
      base,
      suffix,
      full: formatCourseHalfOrderName(base, named[0].name, named[1].name),
    };
  }
  const distinctParen = !!(split.halves && split.halves[0] !== split.halves[1]);
  if (distinctParen && split.halves) {
    const suffix = `${split.halves[0]}、${split.halves[1]}`;
    return {
      base: split.baseName,
      suffix,
      full: formatCourseHalfOrderName(split.baseName, split.halves[0], split.halves[1]),
    };
  }
  const byPars = sections?.length ? matchSectionsFromHolePars(holePars || [], sections) : [];
  if (byPars.length === 2) {
    const suffix = `${byPars[0].name}、${byPars[1].name}`;
    const base = split.halves ? split.baseName : raw;
    return {
      base,
      suffix,
      full: formatCourseHalfOrderName(base, byPars[0].name, byPars[1].name),
    };
  }
  if (split.halves) {
    const suffix = `${split.halves[0]}、${split.halves[1]}`;
    return {
      base: split.baseName,
      suffix,
      full: formatCourseHalfOrderName(split.baseName, split.halves[0], split.halves[1]),
    };
  }
  return plain;
}

export function combinedHolesFromSections(sections: { holes_par: number[] }[]): { no: number; par: number }[] {
  if (sections.length < 2) return [];
  return [
    ...sections[0].holes_par.map((par, i) => ({ no: i + 1, par })),
    ...sections[1].holes_par.map((par, i) => ({ no: i + 10, par })),
  ];
}

let pickerCoursesCache: PickerCourseRow[] | null = null;

function pickerCourses(): PickerCourseRow[] {
  if (!pickerCoursesCache) pickerCoursesCache = flattenCoursesForPicker();
  return pickerCoursesCache;
}

/** 按球场 id，或「球场名 + 半场后缀」里最长的球场名前缀查找 */
export function lookupCourseByIdOrName(
  courseId: string | undefined,
  rawName: string | undefined,
): PickerCourseRow | null {
  const courses = pickerCourses();
  const id = String(courseId || '').trim();
  if (id) {
    const byId = courses.find((c) => c.id === id);
    if (byId) return byId;
  }
  const raw = String(rawName || '').trim();
  if (!raw) return null;
  const { baseName } = splitStoredCourseHalfOrder(raw);
  const ranked = courses
    .filter((c) => {
      const name = String(c.name || '');
      if (!name) return false;
      return (
        raw === name ||
        raw.startsWith(name) ||
        baseName === name ||
        (baseName !== raw && baseName.startsWith(name))
      );
    })
    .sort((a, b) => String(b.name).length - String(a.name).length);
  for (const course of ranked) {
    if (matchSectionsFromStoredName(raw, sectionsForCoursePicker(course)).length === 2) return course;
  }
  return ranked[0] ?? null;
}

export function presentCourseHalfOrderTitle(
  rawName: string,
  courseId?: string,
  holePars?: number[],
): CourseHalfOrderTitle {
  const raw = String(rawName || '').trim();
  if (!raw) return { base: '', suffix: '', full: '' };
  const course = lookupCourseByIdOrName(courseId, raw);
  return courseHalfOrderTitle(raw, sectionsForCoursePicker(course), holePars || []);
}
