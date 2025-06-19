import { useState, useEffect, useCallback } from 'react';
import { handleApiError, ERROR_DISPLAY_TYPES, ErrorHandlerOptions } from '../utils/errorHandler';

export interface UseApiOptions extends ErrorHandlerOptions {
  immediate?: boolean; // Whether to fetch immediately on mount
  dependencies?: any[]; // Dependencies to trigger refetch
}

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: any;
}

export interface UseApiReturn<T> extends UseApiState<T> {
  refetch: () => Promise<void>;
  reset: () => void;
}

/**
 * Custom hook for API calls with loading, error, and data state management
 */
export function useApi<T>(
  apiFunction: () => Promise<T>,
  options: UseApiOptions = {}
): UseApiReturn<T> {
  const {
    immediate = true,
    dependencies = [],
    displayType = ERROR_DISPLAY_TYPES.MESSAGE,
    ...errorOptions
  } = options;

  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await apiFunction();
      setState({
        data: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error,
      }));

      // Handle error display
      handleApiError(error, {
        displayType,
        ...errorOptions,
      });
    }
  }, [apiFunction, displayType, errorOptions]);

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
    });
  }, []);

  // Fetch data on mount if immediate is true
  useEffect(() => {
    if (immediate) {
      fetchData();
    }
  }, [immediate]);

  // Refetch when dependencies change
  useEffect(() => {
    if (dependencies.length > 0 && immediate) {
      fetchData();
    }
  }, dependencies);

  return {
    ...state,
    refetch: fetchData,
    reset,
  };
}

/**
 * Hook for API mutations (POST, PUT, DELETE operations)
 */
export interface UseMutationOptions extends ErrorHandlerOptions {
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
}

export interface UseMutationReturn<TData, TVariables> {
  mutate: (variables: TVariables) => Promise<TData>;
  mutateAsync: (variables: TVariables) => Promise<TData>;
  loading: boolean;
  error: any;
  data: TData | null;
  reset: () => void;
}

export function useMutation<TData = any, TVariables = any>(
  mutationFunction: (variables: TVariables) => Promise<TData>,
  options: UseMutationOptions = {}
): UseMutationReturn<TData, TVariables> {
  const {
    onSuccess,
    onError,
    displayType = ERROR_DISPLAY_TYPES.MESSAGE,
    ...errorOptions
  } = options;

  const [state, setState] = useState({
    data: null as TData | null,
    loading: false,
    error: null as any,
  });

  const mutateAsync = useCallback(async (variables: TVariables): Promise<TData> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await mutationFunction(variables);
      setState({
        data: result,
        loading: false,
        error: null,
      });

      if (onSuccess) {
        onSuccess(result);
      }

      return result;
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error,
      }));

      // Handle error display
      handleApiError(error, {
        displayType,
        ...errorOptions,
      });

      if (onError) {
        onError(error);
      }

      throw error;
    }
  }, [mutationFunction, onSuccess, onError, displayType, errorOptions]);

  const mutate = useCallback(async (variables: TVariables): Promise<TData> => {
    try {
      return await mutateAsync(variables);
    } catch (error) {
      // Error is already handled in mutateAsync
      return Promise.reject(error);
    }
  }, [mutateAsync]);

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
    });
  }, []);

  return {
    mutate,
    mutateAsync,
    ...state,
    reset,
  };
}

/**
 * Hook for paginated API calls
 */
export interface UsePaginatedApiOptions extends UseApiOptions {
  initialPage?: number;
  initialLimit?: number;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface UsePaginatedApiReturn<T> extends UseApiState<PaginatedData<T>> {
  refetch: () => Promise<void>;
  reset: () => void;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  page: number;
  limit: number;
}

export function usePaginatedApi<T>(
  apiFunction: (page: number, limit: number) => Promise<PaginatedData<T>>,
  options: UsePaginatedApiOptions = {}
): UsePaginatedApiReturn<T> {
  const {
    initialPage = 1,
    initialLimit = 10,
    immediate = true,
    dependencies = [],
    displayType = ERROR_DISPLAY_TYPES.MESSAGE,
    ...errorOptions
  } = options;

  const [page, setPage] = useState(initialPage);
  const [limit, setLimit] = useState(initialLimit);

  const [state, setState] = useState<UseApiState<PaginatedData<T>>>({
    data: null,
    loading: false,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const result = await apiFunction(page, limit);
      setState({
        data: result,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error,
      }));

      handleApiError(error, {
        displayType,
        ...errorOptions,
      });
    }
  }, [apiFunction, page, limit, displayType, errorOptions]);

  const reset = useCallback(() => {
    setState({
      data: null,
      loading: false,
      error: null,
    });
    setPage(initialPage);
    setLimit(initialLimit);
  }, [initialPage, initialLimit]);

  const nextPage = useCallback(() => {
    if (state.data?.hasMore) {
      setPage(prev => prev + 1);
    }
  }, [state.data?.hasMore]);

  const prevPage = useCallback(() => {
    if (page > 1) {
      setPage(prev => prev - 1);
    }
  }, [page]);

  // Fetch data when page or limit changes
  useEffect(() => {
    if (immediate) {
      fetchData();
    }
  }, [page, limit, immediate]);

  // Refetch when dependencies change
  useEffect(() => {
    if (dependencies.length > 0 && immediate) {
      fetchData();
    }
  }, dependencies);

  return {
    ...state,
    refetch: fetchData,
    reset,
    setPage,
    setLimit,
    nextPage,
    prevPage,
    page,
    limit,
  };
}
