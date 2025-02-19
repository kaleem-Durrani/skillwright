import { Result, ValidationError as ExpressValidationError } from "express-validator";
import { ValidationError } from "./customErrors.js";

export const parseValidationErrors = (errors: Result<ExpressValidationError>): ValidationError => {
  const formattedErrors = errors.array().reduce((acc: { [key: string]: string[] }, error) => {
    const key = error.type === 'field' ? error.path : '_error';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(error.msg);
    return acc;
  }, {});

  return new ValidationError(formattedErrors);
}; 