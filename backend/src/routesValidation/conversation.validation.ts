import { body } from "express-validator";

/**
 * Validation for creating/getting a conversation
 * Only requires the participant ID (teacher or student)
 */
const createConversationValidation = [
  body("participantId")
    .notEmpty()
    .withMessage("Participant ID is required")
    .isString()
    .withMessage("Participant ID must be a string")
    .isLength({ min: 1 })
    .withMessage("Participant ID cannot be empty"),
];

/**
 * Validation for sending a message
 */
const sendMessageValidation = [
  body("content")
    .trim()
    .notEmpty()
    .withMessage("Message content is required")
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message must be between 1 and 1000 characters"),
];

export {
  createConversationValidation,
  sendMessageValidation,
};