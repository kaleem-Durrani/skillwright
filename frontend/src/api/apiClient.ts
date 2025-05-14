import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { API_BASE_URL } from '../common/constants';
import { ApiError, ApiResponse } from '../common/types';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  withCredentials: true, // Important for cookies
});

// Request interceptor for adding auth token
apiClient.interceptors.request.use(
  (config) => {
    // No need to manually add tokens since we're using HTTP-only cookies
    // The browser will automatically send cookies with requests
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for handling errors and token refresh
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Log the error for debugging
    console.log(`API Error: ${error.response?.status} - ${originalRequest.url}`);
    if (error.response?.data) {
      console.log('Error response data:', error.response.data);
    }

    // If error is 401 (Unauthorized) and we haven't retried yet
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      // Don't retry for auth endpoints (login, refresh, etc.)
      !originalRequest.url?.includes('/auth/')
    ) {
      originalRequest._retry = true;

      try {
        // Call refresh token endpoint
        const response = await axios.post<ApiResponse>(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        if (response.data.success) {
          // Retry the original request
          return apiClient(originalRequest);
        }
      } catch (refreshError) {
        // If refresh token fails, don't redirect - let the component handle it
        // This prevents the page reload issue
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

// Helper methods for common HTTP methods
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<ApiResponse<T>>(url, config),

  post: <T>(url: string, data?: any, config?: AxiosRequestConfig) =>
    apiClient.post<ApiResponse<T>>(url, data, config),

  put: <T>(url: string, data?: any, config?: AxiosRequestConfig) =>
    apiClient.put<ApiResponse<T>>(url, data, config),

  patch: <T>(url: string, data?: any, config?: AxiosRequestConfig) =>
    apiClient.patch<ApiResponse<T>>(url, data, config),

  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<ApiResponse<T>>(url, config),
};

export default apiClient;