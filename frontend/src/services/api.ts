import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

// Flag to prevent multiple logout events and refresh attempts
let isLoggingOut = false;
let isRefreshing = false;
let failedQueue: Array<{ resolve: Function; reject: Function }> = [];

// Process failed queue after refresh
const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token);
    }
  });

  failedQueue = [];
};

// Listen for manual logout events to reset the flags
window.addEventListener("auth:manualLogout", () => {
  isLoggingOut = false;
  isRefreshing = false;
});

// Create axios instance with base configuration
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Important for HTTP-only cookies
});

// Request interceptor to handle FormData
apiClient.interceptors.request.use(
  (config) => {
    // If data is FormData, remove Content-Type header to let axios set it automatically
    // This is crucial for file uploads to work properly
    if (config.data instanceof FormData) {
      delete config.headers["Content-Type"];
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle common errors and token refresh
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle 401 errors with token refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Skip refresh for auth endpoints to prevent infinite loops
      if (originalRequest.url?.includes('/auth/')) {
        // For auth endpoints, just trigger logout
        if (!isLoggingOut) {
          isLoggingOut = true;
          window.dispatchEvent(new CustomEvent("auth:forceLogout"));
        }
        return Promise.reject(error);
      }

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => {
          return apiClient(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Try to refresh the token
        await apiClient.post('/auth/refresh');

        // If refresh succeeds, process the queue and retry original request
        processQueue(null);
        isRefreshing = false;

        return apiClient(originalRequest);
      } catch (refreshError) {
        // If refresh fails, logout and reject all queued requests
        processQueue(refreshError);
        isRefreshing = false;

        if (!isLoggingOut) {
          isLoggingOut = true;
          window.dispatchEvent(new CustomEvent("auth:forceLogout"));
        }

        return Promise.reject(refreshError);
      }
    }

    // Log the full error response for debugging
    console.log("API Error Response:", error.response?.data);
    console.log("API Error Status:", error.response?.status);
    console.log("API Error Headers:", error.response?.headers);

    // DON'T transform the error - preserve the original axios error structure
    // This allows our error handling utilities to access the full response
    return Promise.reject(error);
  }
);

// Generic API methods
export const api = {
  // GET request
  get: async <T = any>(url: string, config: AxiosRequestConfig = {}): Promise<T> => {
    try {
      const response: AxiosResponse<T> = await apiClient.get(url, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // POST request
  post: async <T = any>(url: string, data: any = {}, config: AxiosRequestConfig = {}): Promise<T> => {
    try {
      const response: AxiosResponse<T> = await apiClient.post(url, data, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // PUT request
  put: async <T = any>(url: string, data: any = {}, config: AxiosRequestConfig = {}): Promise<T> => {
    try {
      const response: AxiosResponse<T> = await apiClient.put(url, data, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // DELETE request
  delete: async <T = any>(url: string, config: AxiosRequestConfig = {}): Promise<T> => {
    try {
      const response: AxiosResponse<T> = await apiClient.delete(url, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // PATCH request
  patch: async <T = any>(url: string, data: any = {}, config: AxiosRequestConfig = {}): Promise<T> => {
    try {
      const response: AxiosResponse<T> = await apiClient.patch(url, data, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// Re-export services from individual files
export { authService } from "./authService";
export { adminService } from "./adminService";
export { teacherService } from "./teacherService";
export { studentService } from "./studentService";
export { departmentService } from "./departmentService";
export { courseService } from "./courseService";
export { newsService } from "./newsService";
export { resourceService } from "./resourceService";
export { conversationService } from "./conversationService";

export default apiClient;
