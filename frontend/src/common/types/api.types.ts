export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T | null;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> extends ApiResponse<{
  items: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}> {}

export interface ValidationError {
  [key: string]: string[];
}

export interface ApiError {
  success: false;
  message: string;
  errors?: ValidationError;
}

export interface QueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  [key: string]: any;
} 