export interface Account {
  id: string;
  email: string;
  first_name: string;
  email_verified: boolean;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

const BASE: string =
  (import.meta.env.VITE_AUTH_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8081';

let csrfToken = '';
let accessToken = '';
let ongoingRefresh: Promise<void> | null = null;

async function toError(response: Response): Promise<AuthError> {
  let code = 'request_failed';
  try {
    const body = (await response.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error) code = body.error;
  } catch {
    // non-JSON error body: keep the generic code
  }
  return new AuthError(response.status, code);
}

async function ensureCsrf(force: boolean): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const response = await fetch(`${BASE}/v1/auth/csrf`, { credentials: 'include' });
  if (!response.ok) throw await toError(response);
  const body = (await response.json()) as { csrf_token?: string };
  if (typeof body.csrf_token !== 'string' || !body.csrf_token)
    throw new AuthError(503, 'csrf_unavailable');
  csrfToken = body.csrf_token;
  return csrfToken;
}

async function mutate(
  path: string,
  body: unknown,
  bearer: boolean,
  method = 'POST',
): Promise<Response> {
  let bearerRefreshed = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': await ensureCsrf(attempt > 0),
    };
    if (bearer) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
    });
    if (response.status === 403 && attempt === 0) continue;
    // Bearer call with an expired access token: refresh once via the shared
    // bootstrap promise, then retry once with the fresh token. bootstrapAuth
    // swallows refresh failures by design; if no token came back, surface
    // the original 401.
    if (response.status === 401 && bearer && !bearerRefreshed) {
      bearerRefreshed = true;
      await bootstrapAuth();
      if (!accessToken) return response;
      return fetch(`${BASE}${path}`, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
    }
    return response;
  }
  throw new AuthError(0, 'unreachable');
}

async function bearerGet(path: string, refreshed = false): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 && !refreshed) {
    await bootstrapAuth();
    if (accessToken) return bearerGet(path, true);
  }
  return response;
}

async function storeAccessToken(response: Response): Promise<void> {
  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new AuthError(503, 'token_missing');
  accessToken = body.access_token;
}

export async function registerAccount(
  email: string,
  password: string,
  firstName: string,
): Promise<void> {
  const response = await mutate(
    '/v1/auth/register',
    { email, password, first_name: firstName },
    false,
  );
  if (response.status !== 202) throw await toError(response);
}

export async function fetchAccount(): Promise<Account> {
  const response = await bearerGet('/v1/auth/me');
  if (!response.ok) throw await toError(response);
  return (await response.json()) as Account;
}

export async function fetchCandidateWorkspace(): Promise<unknown | null> {
  const response = await bearerGet('/v1/candidate/workspace');
  if (response.status === 204) return null;
  if (!response.ok) throw await toError(response);
  const body = (await response.json()) as { workspace?: unknown };
  if (body.workspace === undefined) throw new AuthError(503, 'workspace_missing');
  return body.workspace;
}

export async function saveCandidateWorkspace(workspace: unknown): Promise<void> {
  const response = await mutate(
    '/v1/candidate/workspace',
    { workspace },
    true,
    'PUT',
  );
  if (!response.ok) throw await toError(response);
}

export async function login(email: string, password: string): Promise<Account> {
  const response = await mutate('/v1/auth/login', { email, password }, false);
  if (!response.ok) throw await toError(response);
  await storeAccessToken(response);
  return fetchAccount();
}

// bootstrapAuth shares a single in-flight refresh: replaying a lost refresh
// would revoke the whole session family server-side.
export function bootstrapAuth(): Promise<void> {
  ongoingRefresh ??= (async () => {
    const response = await mutate('/v1/auth/refresh', {}, false);
    if (!response.ok) {
      accessToken = '';
      return;
    }
    await storeAccessToken(response);
  })().finally(() => {
    ongoingRefresh = null;
  });
  return ongoingRefresh;
}

export function hasSession(): boolean {
  return accessToken !== '';
}

export async function logout(): Promise<void> {
  try {
    await mutate('/v1/auth/logout', {}, false);
  } finally {
    accessToken = '';
  }
}

export async function requestVerificationEmail(): Promise<void> {
  const response = await mutate('/v1/auth/verify/request', {}, true);
  if (response.status !== 202) throw await toError(response);
}

export async function confirmEmailVerification(token: string): Promise<void> {
  const response = await mutate('/v1/auth/verify/confirm', { token }, false);
  if (response.status !== 204) throw await toError(response);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await mutate('/v1/auth/reset/request', { email }, false);
  if (response.status !== 202) throw await toError(response);
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  const response = await mutate(
    '/v1/auth/reset/confirm',
    { token, new_password: newPassword },
    false,
  );
  if (response.status !== 204) throw await toError(response);
}

export function describeAuthError(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.status === 400) return 'Vérifiez vos informations et réessayez.';
    if (error.status === 429)
      return 'Trop de tentatives. Réessayez dans quelques minutes.';
  }
  return 'Le service d’identité est indisponible. Réessayez dans un instant.';
}
