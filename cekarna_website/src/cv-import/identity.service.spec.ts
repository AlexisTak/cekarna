import { UnauthorizedException } from '@nestjs/common';
import { Environment } from '../config/environment';
import { IdentityService } from './identity.service';

const config: Environment = {
  port: 3000,
  host: '127.0.0.1',
  corsOrigins: [],
  cvImportMaxBytes: 5_000_000,
  cvImportRetentionSeconds: 900,
  cvImportMaxPages: 10,
  authIdentityUrl: 'http://127.0.0.1:8081/v1/auth/me',
  offersBaseUrl: 'http://127.0.0.1:8083',
  offersInternalToken: '',
};

describe('IdentityService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses an import without a bearer token', async () => {
    await expect(new IdentityService(config).userId()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('forwards the bearer token and returns the authenticated account id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'candidate-42' }), { status: 200 }),
      );

    await expect(
      new IdentityService(config).userId('Bearer access-token'),
    ).resolves.toBe('candidate-42');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(config.authIdentityUrl);
    expect(request?.headers).toEqual({ Authorization: 'Bearer access-token' });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not accept an unavailable or refused identity service', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    await expect(
      new IdentityService(config).userId('Bearer access-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
