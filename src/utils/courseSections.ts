/** 半场一条（与 guangdongCourses 中 sections 项结构一致） */
export type CourseNineSection = { name: string; holes_par: number[] };

/** 标准 18 洞：拆成前 9 / 后 9，用于与多半场球场一致的「先打哪半边」组合 */
export function nineHoleSectionsFrom18(holes_par: number[]): CourseNineSection[] | null {
  if (!Array.isArray(holes_par) || holes_par.length !== 18) return null;
  return [
    { name: '前9', holes_par: holes_par.slice(0, 9) },
    { name: '后9', holes_par: holes_par.slice(9, 18) },
  ];
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
    return course.sections;
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
