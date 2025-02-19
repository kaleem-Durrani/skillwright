class ValidationError extends Error {
  statusCode: number;
  errors: { [key: string]: string[] };

  constructor(errors: { [key: string]: string[] }) {
    super("Validation Error");
    this.statusCode = 400;
    this.errors = errors;
  }
}

class AuthenticationError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.statusCode = 401;
  }
}

class ForbiddenError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.statusCode = 403;
  }
}

class NotFoundError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}

export { ValidationError, AuthenticationError, ForbiddenError, NotFoundError }; 