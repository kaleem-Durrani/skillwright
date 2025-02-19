import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import asyncHandler from "./asyncHandler.js";
import prisma from "../db/prisma.js";

interface DecodedToken extends JwtPayload {
  userId: string;
}

// declare global {
//   namespace Express {
//     interface Request {
//       admin?: any;
//     }
//   }
// }

const protectAdminRoute = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
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

  const admin = await prisma.admin.findUnique({
    where: {
      id: decoded.userId,
    },
  });

  if (!admin) {
    res.status(404);
    throw new Error("Admin not found");
  }

  if (!admin.isActive) {
    res.status(403);
    throw new Error("Your account has been deactivated");
  }

  req.admin = admin;
  next();
});

export { protectAdminRoute };
