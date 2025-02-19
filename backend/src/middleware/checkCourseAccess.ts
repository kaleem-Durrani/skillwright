import { Request, Response, NextFunction } from "express";
import prisma from "../db/prisma.js";
import { ForbiddenError } from "../utils/customErrors.js";

export const checkCourseAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const studentId = req.student?.id;
    const courseId = req.params.courseId;

    if (!studentId || !courseId) {
      throw new ForbiddenError("Access denied");
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId,
        status: "APPROVED",
      },
    });

    if (!enrollment) {
      throw new ForbiddenError("You don't have access to this course");
    }

    next();
  } catch (error) {
    next(error);
  }
}; 