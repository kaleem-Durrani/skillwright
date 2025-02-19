import { Result, ValidationError } from "express-validator";

interface FormattedError {
  field: string;
  message: string;
}

interface ErrorResponse {
  success: boolean;
  errors: {
    [key: string]: string[];
  };
}

const parseValidatorErrors = (errors: Result<ValidationError>): ErrorResponse => {
  const formattedErrors: { [key: string]: string[] } = {};

  errors.array().forEach((error: ValidationError) => {
    // Handle only field validation errors
    if (!('path' in error)) return;
    
    const field = String(error.path);
    const message = String(error.msg);

    if (!formattedErrors[field]) {
      formattedErrors[field] = [];
    }
    formattedErrors[field].push(message);
  });

  return {
    success: false,
    errors: formattedErrors,
  };
};

export { parseValidatorErrors, type ErrorResponse, type FormattedError };
