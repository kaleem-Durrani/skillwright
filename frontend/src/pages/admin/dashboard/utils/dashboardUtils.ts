import { Teacher, Student, Department, NewsEvent } from '@/common/types';

/**
 * Calculate statistics for the admin dashboard
 */
export const calculateStatistics = (
  teachers: Teacher[],
  students: Student[],
  departments: Department[]
) => {
  // Count active and banned teachers
  const activeTeachers = teachers.filter(teacher => !teacher.isBanned).length;
  const bannedTeachers = teachers.filter(teacher => teacher.isBanned).length;
  
  // Count active and banned students
  const activeStudents = students.filter(student => !student.isBanned).length;
  const bannedStudents = students.filter(student => student.isBanned).length;
  
  // Count departments with teachers and students
  const departmentsWithTeachers = departments.filter(dept => 
    dept._count && dept._count.teachers > 0
  ).length;
  
  const departmentsWithStudents = departments.filter(dept => 
    dept._count && dept._count.students > 0
  ).length;
  
  return {
    totalTeachers: teachers.length,
    activeTeachers,
    bannedTeachers,
    totalStudents: students.length,
    activeStudents,
    bannedStudents,
    totalDepartments: departments.length,
    departmentsWithTeachers,
    departmentsWithStudents
  };
};

/**
 * Sort news events by date (newest first)
 */
export const sortNewsByDate = (newsEvents: NewsEvent[]) => {
  return [...newsEvents].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );
};
