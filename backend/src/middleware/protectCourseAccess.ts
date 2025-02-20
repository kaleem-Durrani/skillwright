import { Request, Response, NextFunction } from "express";
import prisma from "../db/prisma.js";
import { ValidationError } from "../utils/customErrors.js";

export const protectCourseAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resourceId = req.params.id;

    // Get the resource and its course
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: {
        courseId: true,
        isPublic: true,
        course: {
          select: {
            teacherId: true,
            enrollments: {
              select: {
                studentId: true
              }
            }
          }
        }
      }
    });

    if (!resource) {
      throw new ValidationError({ resource: ["Resource not found"] });
    }

    // If resource is public, allow access
    if (resource.isPublic) {
      return next();
    }

    // Check if user is a teacher
    if (req.teacher) {
      // Allow if teacher owns the course
      if (resource.course.teacherId === req.teacher.id) {
        return next();
      }
    }

    // Check if user is a student
    if (req.student) {
      // Allow if student is enrolled in the course
      const isEnrolled = resource.course.enrollments.some(
        enrollment => enrollment.studentId === req.student!.id
      );

      if (isEnrolled) {
        return next();
      }
    }

    // If none of the above conditions are met, deny access
    throw new ValidationError({ auth: ["You do not have access to this resource"] });

  } catch (error) {
    next(error);
  }
}; 