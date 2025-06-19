import { body } from "express-validator";

const updateProfileValidation = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters long"),
  body("phoneNumber")
    .optional()
    .trim()
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage("Please enter a valid phone number"),
  body("designation")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Designation is required"),
];

const createTeacherValidation = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Please enter a valid email address"),
  body("password")
    .trim()
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters long"),
  body("qualification")
    .trim()
    .notEmpty()
    .withMessage("Qualification is required")
    .isLength({ min: 2, max: 200 })
    .withMessage("Qualification must be between 2 and 200 characters"),
  body("specialization")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Specialization cannot exceed 200 characters"),
  body("departmentId")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Department ID cannot be empty if provided"),
  body("phoneNumber")
    .optional()
    .trim()
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage("Please enter a valid phone number"),
];

const createNewsEventValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ min: 2, max: 200 })
    .withMessage("Title must be between 2 and 200 characters"),
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Content is required")
    .isLength({ max: 5000 })
    .withMessage("Content cannot exceed 5000 characters"),
  body("type")
    .trim()
    .notEmpty()
    .withMessage("Type is required")
    .isIn(["NEWS", "EVENT", "ANNOUNCEMENT"])
    .withMessage("Invalid type"),
  body("date")
    .trim()
    .notEmpty()
    .withMessage("Date is required")
    .isISO8601()
    .withMessage("Invalid date format"),
  body("isPublished")
    .optional()
    .isBoolean()
    .withMessage("isPublished must be a boolean value"),
];

const updateNewsEventValidation = [
  body("title")
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage("Title must be between 2 and 200 characters"),
  body("content")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Content cannot exceed 5000 characters"),
  body("type")
    .optional()
    .trim()
    .isIn(["NEWS", "EVENT", "ANNOUNCEMENT"])
    .withMessage("Invalid type"),
  body("date")
    .optional()
    .trim()
    .isISO8601()
    .withMessage("Invalid date format"),
  body("isPublished")
    .optional()
    .isBoolean()
    .withMessage("isPublished must be a boolean value"),
];

export {
  updateProfileValidation,
  createTeacherValidation,
  createNewsEventValidation,
  updateNewsEventValidation,
};