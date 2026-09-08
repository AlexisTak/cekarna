import { ServiceUnavailableException } from '@nestjs/common';
import type { Environment } from '../config/environment';
import { OffersService } from './offers.service';
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
describe('OffersService', () => {
  afterEach(() => jest.restoreAllMocks());
  it('forwards filters and the internal token', async () => {
    const mock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ offers: [], next_cursor: null }), {
        status: 200,
      }),
    );
    await new OffersService(config).list({ location: 'Lyon' });
    expect(mock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8083/v1/offers?location=Lyon',
    );
    expect(
      (mock.mock.calls[0][1]?.headers as Record<string, string>).Authorization,
    ).toBe(`Bearer ${config.offersInternalToken}`);
  });
  it('fails closed without configuration', async () => {
    await expect(
      new OffersService({ ...config, offersInternalToken: '' }).list({}),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('hides network failures', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('secret network detail'));
    await expect(new OffersService(config).list({})).rejects.toThrow(
      'Le service d’offres est injoignable.',
    );
  });
});
