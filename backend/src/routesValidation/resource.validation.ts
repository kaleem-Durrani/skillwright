import { body } from "express-validator";
import { ResourceType } from "@prisma/client";

const createResourceValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Resource title is required")
    .isLength({ min: 2, max: 200 })
    .withMessage("Title must be between 2 and 200 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Description cannot exceed 1000 characters"),
  body("type")
    .trim()
    .notEmpty()
    .withMessage("Resource type is required")
    .isIn(Object.values(ResourceType))
    .withMessage("Invalid resource type"),
  body("url")
    .trim()
    .notEmpty()
    .withMessage("Resource URL is required")
    .isURL()
    .withMessage("Must be a valid URL"),
  body("courseId")
    .trim()
    .notEmpty()
    .withMessage("Course ID is required"),
  body("isPublic")
    .optional()
    .isBoolean()
    .withMessage("isPublic must be a boolean value"),
];

const updateResourceValidation = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage("Title must be between 2 and 200 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Description cannot exceed 1000 characters"),
  body("type")
    .optional()
    .trim()
    .isIn(Object.values(ResourceType))
    .withMessage("Invalid resource type"),
  body("url")
    .optional()
    .trim()
    .isURL()
    .withMessage("Must be a valid URL"),
  body("isPublic")
    .optional()
    .isBoolean()
    .withMessage("isPublic must be a boolean value"),
];

export { createResourceValidation, updateResourceValidation }; 