import { Admin, Teacher, Student } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      admin?: Admin;
      teacher?: Teacher;
      student?: Student;
    }
  }
} 