import { ApiError, isProblem, transportProblem, type Problem } from './problem.js';

/**
 * Same-origin in production; the Vite proxy recreates that in dev. There is no
 * cross-origin mode, which is why `credentials: 'include'` is enough and no CORS
 * preflight ever happens on a GET.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

export interface RequestOptions {
  /** Query string values. `undefined` and `null` entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Bypass JSON encoding — used only by the direct-to-object-store upload PUT. */
  raw?: boolean;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function readProblem(response: Response): Promise<Problem> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (isProblem(body)) return body;
  return {
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
    code: response.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
    requestId: response.headers.get('x-request-id') ?? 'unknown',
  };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const init: RequestInit = {
    method,
    // The session lives in the __Host-sw_session cookie. Nothing is ever read
    // from JS, so this flag is the entire auth mechanism on the client.
    credentials: 'include',
    headers: {
      Accept: 'application/json, application/problem+json',
      ...(body !== undefined && !options.raw ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...(options.signal ? { signal: options.signal } : {}),
  };

  if (body !== undefined) {
    init.body = options.raw ? (body as BodyInit) : JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      transportProblem(cause instanceof Error ? cause.message : 'The request could not be sent.'),
    );
  }

  if (!response.ok) {
    throw new ApiError(await readProblem(response));
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    return (await response.text()) as unknown as T;
  }

  return (await response.json()) as T;
}

/** The only way this app talks to the server. */
export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, body, options),
  del: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
};

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}
