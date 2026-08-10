// utils/mockData.js
import { courseCatalogData } from '../data/courseCatalog';

// Flatten the grouped data into a single array for searching
export const gdMockCourses = Object.entries(courseCatalogData).flatMap(([province, courses]) => 
  courses.map((course) => ({
    id: course.id,
    name: course.name,
    city: course.city || province,
    province,
    tee_areas: course.sections ? `${course.sections.length}场` : '18洞',
    logo_url: "https://golfdate.oss-cn-shenzhen.aliyuncs.com/shops/1.jpg.jpg",
    total_par: course.total_par,
    holes: course.holes_par ? course.holes_par.map((par, i) => ({ no: i + 1, par: par })) : []
  }))
);
