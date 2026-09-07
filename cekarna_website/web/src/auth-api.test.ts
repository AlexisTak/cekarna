import { beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const empty = (status: number) => new Response(null, { status });

async function loadApi() {
  return import('./auth-api');
}

describe('auth-api', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('logs in with CSRF then fetches the account with the bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'at-1',
          token_type: 'Bearer',
          expires_in: 300,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'u1',
          email: 'a@b.test',
          first_name: 'Camille',
          email_verified: false,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    const account = await api.login('a@b.test', 'une longue phrase');
    expect(account.first_name).toBe('Camille');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const loginHeaders = new Headers(
      (fetchMock.mock.calls[1][1] as RequestInit).headers,
    );
    expect(loginHeaders.get('X-CSRF-Token')).toBe('csrf-1');
    const meHeaders = new Headers(
      (fetchMock.mock.calls[2][1] as RequestInit).headers,
    );
    expect(meHeaders.get('Authorization')).toBe('Bearer at-1');
  });

  it('rejects a refused login with status 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(
        jsonResponse(401, { error: 'invalid_credentials' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await expect(api.login('a@b.test', 'x'.repeat(15))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('renews CSRF once on 403 and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(403, { error: 'csrf_expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-2' }))
      .mockResolvedValueOnce(empty(204));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.confirmEmailVerification('tok');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const lastInit = fetchMock.mock.calls[3][1] as RequestInit;
    expect(new Headers(lastInit.headers).get('X-CSRF-Token')).toBe('csrf-2');
  });

  it('shares one in-flight refresh between concurrent bootstraps', async () => {
    let resolveRefresh: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    const first = api.bootstrapAuth();
    const second = api.bootstrapAuth();
    // Wait until the refresh request is actually in flight, otherwise
    // resolveRefresh is still the placeholder and the refresh would hang.
    await vi.waitUntil(() => fetchMock.mock.calls.length === 2);
    resolveRefresh(jsonResponse(401, { error: 'invalid_session' }));
    await Promise.all([first, second]);
    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('refreshes an expired access token once and retries a bearer call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'at-old',
          token_type: 'Bearer',
          expires_in: 300,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'u1',
          email: 'a@b.test',
          first_name: 'Camille',
          email_verified: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_token' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'at-new',
          token_type: 'Bearer',
          expires_in: 300,
        }),
      )
      .mockResolvedValueOnce(empty(202));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.login('a@b.test', 'une longue phrase');
    await api.requestVerificationEmail();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const retryCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/auth/verify/request'),
    );
    expect(retryCalls).toHaveLength(2);
    const firstHeaders = new Headers((retryCalls[0][1] as RequestInit).headers);
    expect(firstHeaders.get('Authorization')).toBe('Bearer at-old');
    const retryHeaders = new Headers((retryCalls[1][1] as RequestInit).headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer at-new');
    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('surfaces the 401 without retrying when the refresh yields no token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          access_token: 'at-old',
          token_type: 'Bearer',
          expires_in: 300,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'u1',
          email: 'a@b.test',
          first_name: 'Camille',
          email_verified: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_token' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_session' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.login('a@b.test', 'une longue phrase');
    await expect(api.requestVerificationEmail()).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
    const endpointCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/auth/verify/request'),
    );
    expect(endpointCalls).toHaveLength(1);
    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it('does not refresh or retry a non-bearer mutation on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_token' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await expect(api.confirmEmailVerification('tok')).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith('/v1/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(0);
  });

  it('maps errors to French user-facing copy', async () => {
    const api = await loadApi();
    expect(
      api.describeAuthError(new api.AuthError(429, 'too_many_attempts')),
    ).toContain('Trop de tentatives');
    expect(
      api.describeAuthError(new api.AuthError(400, 'invalid_input')),
    ).toContain('Vérifiez vos informations');
    expect(api.describeAuthError(new Error('network'))).toContain(
      'indisponible',
    );
  });

  it('reports a refused logout instead of claiming success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
        .mockResolvedValueOnce(jsonResponse(503, { error: 'unavailable' })),
    );
    const api = await loadApi();
    await expect(api.logout()).rejects.toMatchObject({ status: 503 });
  });

  it('keeps the session when account deletion is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1' }))
        .mockResolvedValueOnce(
          jsonResponse(401, { error: 'invalid_credentials' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-2' }))
        .mockResolvedValueOnce(
          jsonResponse(401, { error: 'invalid_credentials' }),
        ),
    );
    const api = await loadApi();
    await api.bootstrapAuth();
    await expect(api.deleteAccount('wrong')).rejects.toMatchObject({
      status: 401,
    });
    expect(api.hasSession()).toBe(true);
  });

  it('loads and saves the private candidate workspace with bearer and CSRF', async () => {
    const workspace = { version: 1, demo: false, profile: {}, jobs: [] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { workspace, revision: 1 }))
      .mockResolvedValueOnce(
        jsonResponse(200, { updated_at: '2026-09-06T12:01:00Z', revision: 2 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.bootstrapAuth();
    await expect(api.fetchCandidateWorkspace()).resolves.toEqual({
      workspace,
      revision: 1,
    });
    await api.saveCandidateWorkspace(workspace, 1);
    const save = fetchMock.mock.calls[3];
    expect((save[1] as RequestInit).method).toBe('PUT');
    const headers = new Headers((save[1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer at-1');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-1');
  });

  it('surfaces a workspace conflict without retrying or overwriting it', async () => {
    const workspace = { version: 1, demo: false, profile: {}, jobs: [] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1' }))
      .mockResolvedValueOnce(
        jsonResponse(409, { error: 'workspace_conflict' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.bootstrapAuth();
    await expect(
      api.saveCandidateWorkspace(workspace, 2),
    ).rejects.toMatchObject({
      status: 409,
      code: 'workspace_conflict',
    });
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).endsWith('/v1/candidate/workspace'),
      ),
    ).toHaveLength(1);
  });

  it('sends protected logout-all and account deletion requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-1' }))
      .mockResolvedValueOnce(empty(204))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'at-2' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'u1',
          email: 'a@b.test',
          first_name: 'Camille',
          email_verified: true,
        }),
      )
      .mockResolvedValueOnce(empty(204));
    vi.stubGlobal('fetch', fetchMock);
    const api = await loadApi();
    await api.bootstrapAuth();
    await api.logoutAll();
    await api.login('a@b.test', 'une longue phrase');
    await api.deleteAccount('une longue phrase');
    const methods = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(methods.some((url) => url.endsWith('/v1/auth/logout-all'))).toBe(
      true,
    );
    expect(methods.some((url) => url.endsWith('/v1/auth/delete'))).toBe(true);
  });
});
