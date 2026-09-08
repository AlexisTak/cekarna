import type { Environment } from './config/environment';
import { ReadinessService } from './readiness.service';

const config: Environment = {
  port: 3000,
  host: '127.0.0.1',
  corsOrigins: [],
  cvImportMaxBytes: 5_000_000,
  cvImportRetentionSeconds: 900,
  cvImportMaxPages: 10,
  authIdentityUrl: 'http://127.0.0.1:8081/v1/auth/me',
  offersBaseUrl: 'http://127.0.0.1:8083',
  offersInternalToken: '0123456789abcdef0123456789abcdef',
};

describe('ReadinessService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LOCAL_LLM_BASE_URL;
    delete process.env.LOCAL_LLM_MODEL;
  });

  it('reports ready only when identity, offers and the configured model respond', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'hermes3:3b' }] }), {
          status: 200,
        }),
      );
    const result = await new ReadinessService(config).check();
    expect(result.status).toBe('ready');
    expect(result.dependencies).toMatchObject({
      identity: { status: 'up' },
      offers: { status: 'up' },
      hermes: { status: 'up', model: 'hermes3:3b' },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8081/health/ready',
      'http://127.0.0.1:8083/health/ready',
      'http://127.0.0.1:11434/api/tags',
    ]);
  });

  it('distinguishes missing configuration, unreachable identity and missing model', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('private network detail'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [{ name: 'another:latest' }] }), {
          status: 200,
        }),
      );
    const result = await new ReadinessService({
      ...config,
      offersInternalToken: '',
    }).check();
    expect(result).toMatchObject({
      status: 'degraded',
      dependencies: {
        identity: { status: 'down', detail: 'unreachable' },
        offers: { status: 'not_configured', latency_ms: 0 },
        hermes: {
          status: 'down',
          detail: 'model_missing',
          model: 'hermes3:3b',
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('private network detail');
  });
});
