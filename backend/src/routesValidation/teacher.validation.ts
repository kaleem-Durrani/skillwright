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
  body("qualification")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Qualification is required"),
  body("specialization")
    .optional()
    .trim(),
];

const updateEnrollmentStatusValidation = [
  body("status")
    .trim()
    .notEmpty()
    .withMessage("Status is required")
    .isIn(["APPROVED", "REJECTED"])
    .withMessage("Invalid enrollment status"),
];

export {
  updateProfileValidation,
  updateEnrollmentStatusValidation,
}; 