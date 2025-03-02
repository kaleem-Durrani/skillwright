import { body } from "express-validator";

const createConversationValidation = [
  body("title")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Title cannot exceed 100 characters"),
  body("participants")
    .isArray({ min: 1 })
    .withMessage("At least one participant is required"),
  body("participants.*.adminId")
    .optional()
    .isString()
    .withMessage("Admin ID must be a string"),
  body("participants.*.teacherId")
    .optional()
    .isString()
    .withMessage("Teacher ID must be a string"),
  body("participants.*.studentId")
    .optional()
    .isString()
    .withMessage("Student ID must be a string"),
  body("initialMessage")
    .optional()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message must be between 1 and 1000 characters"),
];

const sendMessageValidation = [
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Message content is required")
    .isLength({ max: 1000 })
    .withMessage("Message cannot exceed 1000 characters"),
];

export {
  createConversationValidation,
  sendMessageValidation,
}; 