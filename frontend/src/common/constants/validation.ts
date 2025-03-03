export const VALIDATION = {
  PASSWORD: {
    MIN_LENGTH: 6,
    REQUIRES_NUMBER: true,
    REQUIRES_UPPERCASE: true,
    PATTERN: /^(?=.*\d)(?=.*[A-Z]).{6,}$/,
    ERROR_MESSAGES: {
      MIN_LENGTH: 'Password must be at least 6 characters long',
      REQUIRES_NUMBER: 'Password must contain at least one number',
      REQUIRES_UPPERCASE: 'Password must contain at least one uppercase letter',
    },
  },
  NAME: {
    MIN_LENGTH: 2,
    MAX_LENGTH: 50,
    PATTERN: /^[a-zA-Z\s]+$/,
    ERROR_MESSAGES: {
      MIN_LENGTH: 'Name must be at least 2 characters long',
      MAX_LENGTH: 'Name cannot exceed 50 characters',
      PATTERN: 'Name can only contain letters and spaces',
    },
  },
  EMAIL: {
    PATTERN: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    ERROR_MESSAGES: {
      PATTERN: 'Please enter a valid email address',
    },
  },
  PHONE: {
    PATTERN: /^\+?[1-9]\d{1,14}$/,
    ERROR_MESSAGES: {
      PATTERN: 'Please enter a valid phone number',
    },
  },
  OTP: {
    LENGTH: 6,
    PATTERN: /^\d{6}$/,
    ERROR_MESSAGES: {
      PATTERN: 'OTP must be 6 digits',
    },
  },
} as const; 