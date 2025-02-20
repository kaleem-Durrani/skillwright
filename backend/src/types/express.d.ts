import { Admin, Teacher, Student } from "@prisma/client";

declare module "express-serve-static-core" {
  interface Request {
    admin?: Admin;
    teacher?: Teacher;
    student?: Student;
  }
} 