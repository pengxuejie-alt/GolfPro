// utils/mockData.js
import { gdCourseData } from '../data/guangdongCourses';

// Flatten the grouped data into a single array for searching
export const gdMockCourses = Object.entries(gdCourseData).flatMap(([city, courses]) => 
  courses.map((course, index) => ({
    id: `${city}-${index}`,
    name: course.name,
    city: city.replace('/清远', ''), // Simplify city name for display
    tee_areas: "18洞",
    logo_url: "https://golfdate.oss-cn-shenzhen.aliyuncs.com/shops/1.jpg.jpg", // Default logo
    total_par: course.total_par,
    holes: course.holes_par ? course.holes_par.map((par, i) => ({ no: i + 1, par: par })) : []
  }))
);
