import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import asyncHandler from "./asyncHandler.js";
import prisma from "../db/prisma.js";

interface DecodedToken extends JwtPayload {
	userId: string;
}

declare global {
  namespace Express {
    interface Request {
      teacher?: any;
    }
  }
}

const protectTeacherRoute = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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

  const teacher = await prisma.teacher.findUnique({
    where: {
      id: decoded.userId,
    },
  });

  if (!teacher) {
    res.status(404);
    throw new Error("Teacher not found");
  }

  if (teacher.isBanned) {
    res.status(403);
    throw new Error("Your account has been banned");
  }

  req.teacher = teacher;
  next();
});

export { protectTeacherRoute };
