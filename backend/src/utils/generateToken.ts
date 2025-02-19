import jwt from "jsonwebtoken";
import { Response } from "express";

const generateToken = (res: Response, userId: string): string => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: "15d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "strict",
    maxAge: 15 * 24 * 60 * 60 * 1000,
  });

  return token;
};

export { generateToken };
