import { readEnvironment } from './environment';

describe('environment', () => {
  it('defaults to local access without cross-origin permissions', () => {
    expect(readEnvironment({})).toEqual({
      port: 3000,
      host: '127.0.0.1',
      corsOrigins: [],
      cvImportMaxBytes: 5_000_000,
      cvImportRetentionSeconds: 900,
      cvImportMaxPages: 10,
      authIdentityUrl: 'http://127.0.0.1:8081/v1/auth/me',
      offersBaseUrl: 'http://127.0.0.1:8083',
      offersInternalToken: '',
    });
  });
  it.each(['', '0', '-1', '65536', '3.5', '3000abc'])(
    'rejects invalid port %s',
    (port) => {
      expect(() => readEnvironment({ PORT: port })).toThrow('PORT');
    },
  );
  it.each([
    '*',
    'null',
    'ftp://example.com',
    'https://example.com/path',
    'https://user:pass@example.com',
  ])('rejects invalid origin %s', (origin) => {
    expect(() => readEnvironment({ CORS_ORIGINS: origin })).toThrow(
      'CORS_ORIGINS',
    );
  });
  it.each(['file:///tmp/auth', 'ftp://example.com/auth'])(
    'rejects a non-HTTP identity endpoint %s',
    (endpoint) => {
      expect(() => readEnvironment({ AUTH_IDENTITY_URL: endpoint })).toThrow(
        'AUTH_IDENTITY_URL',
      );
    },
  );
  it('parses explicit configuration and removes duplicate origins', () => {
    expect(
      readEnvironment({
        PORT: '4000',
        HOST: '0.0.0.0',
        CORS_ORIGINS: 'http://localhost:3001, http://localhost:3001',
        CV_IMPORT_MAX_BYTES: '2000000',
        CV_IMPORT_RETENTION_SECONDS: '120',
      }),
    ).toEqual({
      port: 4000,
      host: '0.0.0.0',
      corsOrigins: ['http://localhost:3001'],
      cvImportMaxBytes: 2_000_000,
      cvImportRetentionSeconds: 120,
      cvImportMaxPages: 10,
      authIdentityUrl: 'http://127.0.0.1:8081/v1/auth/me',
      offersBaseUrl: 'http://127.0.0.1:8083',
      offersInternalToken: '',
    });
  });
  it.each(['0', '10000001', 'beaucoup'])(
    'rejects an invalid CV import size %s',
    (size) => {
      expect(() => readEnvironment({ CV_IMPORT_MAX_BYTES: size })).toThrow(
        'CV_IMPORT_MAX_BYTES',
      );
    },
  );
  it.each(['0', '59', '3601'])(
    'rejects an invalid CV retention delay %s',
    (delay) => {
      expect(() =>
        readEnvironment({ CV_IMPORT_RETENTION_SECONDS: delay }),
      ).toThrow('CV_IMPORT_RETENTION_SECONDS');
    },
  );
  it('rejects an empty host', () => {
    expect(() => readEnvironment({ HOST: ' ' })).toThrow('HOST');
  });
});
