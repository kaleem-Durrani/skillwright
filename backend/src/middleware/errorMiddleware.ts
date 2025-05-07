import { Request, Response, NextFunction } from "express";
import { ValidationError, AuthenticationError, ForbiddenError, NotFoundError } from "../utils/customErrors.js";

const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  let response: any = {
    success: false,
    message: err.message,
  };

  // Add stack trace in development
  if (process.env.NODE_ENV !== "production") {
    response.stack = err.stack;
  }

  // Handle custom errors
  if (err instanceof ValidationError) {
    statusCode = err.statusCode;
    response.errors = err.errors;
  } else if (
    err instanceof AuthenticationError ||
    err instanceof ForbiddenError ||
    err instanceof NotFoundError
  ) {
    statusCode = err.statusCode;
    response.errors = {
      _error: [err.message],
    };
  }

  console.log(statusCode)
  console.log(response);

  res.status(statusCode).json(response);
};

export { notFound, errorHandler };
