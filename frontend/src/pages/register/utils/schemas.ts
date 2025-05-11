import { z } from "zod";

// Define base schema for validation
export const baseSchema = {
  name: z.string().min(3, "Name must be at least 3 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .regex(/\d/, "Password must contain at least one number")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter"),
  confirmPassword: z.string(),
  departmentId: z.string().min(1, "Please select a department"),
  phoneNumber: z.string().optional(),
};

// Student schema
export const studentSchema = z
  .object({
    ...baseSchema,
    enrollmentNo: z.string().min(1, "Enrollment number is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Teacher schema
export const teacherSchema = z
  .object({
    ...baseSchema,
    qualification: z.string().min(1, "Qualification is required"),
    specialization: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Type for user type
export type UserType = "student" | "teacher";

// Function to get the appropriate schema based on user type
export const getSchemaByUserType = (userType: UserType) => {
  return userType === "student" ? studentSchema : teacherSchema;
};
