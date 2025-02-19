import { body } from "express-validator";

const createCourseValidation = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Course name is required")
    .isLength({ min: 2, max: 100 })
    .withMessage("Course name must be between 2 and 100 characters"),
  body("code")
    .trim()
    .notEmpty()
    .withMessage("Course code is required")
    .matches(/^[A-Z0-9-]+$/)
    .withMessage("Course code must contain only uppercase letters, numbers, and hyphens"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Description cannot exceed 1000 characters"),
  body("duration")
    .trim()
    .notEmpty()
    .withMessage("Course duration is required"),
  body("capacity")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Capacity must be a positive number"),
  body("departmentId")
    .trim()
    .notEmpty()
    .withMessage("Department ID is required"),
  body("syllabus")
    .optional()
    .trim()
    .isURL()
    .withMessage("Syllabus must be a valid URL"),
  body("startDate")
    .optional()
    .isISO8601()
    .withMessage("Start date must be a valid date"),
  body("endDate")
    .optional()
    .isISO8601()
    .withMessage("End date must be a valid date")
    .custom((value, { req }) => {
      if (value && req.body.startDate && new Date(value) <= new Date(req.body.startDate)) {
        throw new Error("End date must be after start date");
      }
      return true;
    }),
];

const updateCourseValidation = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Course name must be between 2 and 100 characters"),
  body("code")
    .optional()
    .trim()
    .matches(/^[A-Z0-9-]+$/)
    .withMessage("Course code must contain only uppercase letters, numbers, and hyphens"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Description cannot exceed 1000 characters"),
  body("duration")
    .optional()
    .trim(),
  body("capacity")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Capacity must be a positive number"),
  body("syllabus")
    .optional()
    .trim()
    .isURL()
    .withMessage("Syllabus must be a valid URL"),
  body("startDate")
    .optional()
    .isISO8601()
    .withMessage("Start date must be a valid date"),
  body("endDate")
    .optional()
    .isISO8601()
    .withMessage("End date must be a valid date")
    .custom((value, { req }) => {
      if (value && req.body.startDate && new Date(value) <= new Date(req.body.startDate)) {
        throw new Error("End date must be after start date");
      }
      return true;
    }),
];

export { createCourseValidation, updateCourseValidation }; 