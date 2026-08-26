export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const ADMIN_TOKEN_KEY = 'funnel.admin_token';

export const getAdminToken = (): string => {
  try {
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

export const setAdminToken = (token: string): void => {
  try {
    if (token) window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* storage is unavailable, admin token simply will not persist */
  }
};

export const request = async <T>(
  path: string,
  options: { method?: string; body?: unknown; admin?: boolean } = {},
): Promise<T> => {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.admin) {
    const token = getAdminToken();
    if (token) headers['x-admin-token'] = token;
  }

  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Запрос завершился со статусом ${response.status}`;
    throw new ApiError(response.status, message, payload);
  }

  return payload as T;
};
