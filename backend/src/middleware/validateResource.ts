import { Request, Response, NextFunction } from "express";
import { ValidationError } from "../utils/customErrors.js";

export const validateResource = (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors: Record<string, string[]> = {};

    // For create requests
    if (req.method === "POST") {
      if (!req.file) {
        errors.file = ["File is required"];
      }

      if (!req.body.title?.trim()) {
        errors.title = ["Title is required"];
      }

      if (!req.body.courseId) {
        errors.courseId = ["Course ID is required"];
      }
    }

    // For update requests
    if (req.method === "PUT") {
      if (!req.body.title?.trim() && !req.body.description?.trim() && req.body.isPublic === undefined) {
        errors.body = ["At least one field must be provided for update"];
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new ValidationError(errors);
    }

    next();
  } catch (error) {
    next(error);
  }
}; 