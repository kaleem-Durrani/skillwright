import jwt, { JwtPayload } from "jsonwebtoken";
import asyncHandler from "./asyncHandler.js";
import prisma from "../db/prisma.js";
import { Request, Response, NextFunction } from "express";
import { Student } from "@prisma/client";

interface DecodedToken extends JwtPayload {
  userId: string;
}

declare module "express-serve-static-core" {
  interface Request {
    student?: Student;
  }
}

const protectStudentRoute = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.token;

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token");
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as DecodedToken;

  if (!decoded) {
    res.status(401);
    throw new Error("Not authorized, invalid token");
  }

  const student = await prisma.student.findUnique({
    where: {
      id: decoded.userId,
    },
  });

  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }

  req.student = student;
  next();
});

export { protectStudentRoute };
