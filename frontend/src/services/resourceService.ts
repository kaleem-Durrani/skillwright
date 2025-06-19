import { api } from './api';
import {
  Resource,
  ResourceComment,
  ApiResponse,
  ResourceUpdateData,
  QueryParams,
  PaginatedResponse
} from '../common/types';

export const resourceService = {
  // Public routes
  getAllPublicResources: (params?: QueryParams): Promise<ApiResponse<PaginatedResponse<Resource>>> =>
    api.get('/resource/public', { params }),

  getResourceById: (id: string): Promise<ApiResponse<Resource>> =>
    api.get(`/resource/public/${id}`),

  // Teacher-only resource management routes
  createResource: (data: FormData): Promise<ApiResponse<Resource>> =>
    api.post('/resource', data),

  createVideoResource: (data: FormData): Promise<ApiResponse<Resource>> =>
    api.post('/resource/video', data),

  updateResource: (id: string, data: FormData): Promise<ApiResponse<Resource>> =>
    api.put(`/resource/${id}`, data),

  deleteResource: (id: string): Promise<ApiResponse<{ message: string }>> =>
    api.delete(`/resource/${id}`),

  // Protected routes (requires course access)
  getResource: (id: string): Promise<ApiResponse<Resource>> =>
    api.get(`/resource/${id}`),

  getResourceComments: (id: string): Promise<ApiResponse<ResourceComment[]>> =>
    api.get(`/resource/${id}/comments`),
};
