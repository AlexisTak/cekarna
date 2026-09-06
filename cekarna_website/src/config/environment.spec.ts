import { readEnvironment } from './environment';

describe('environment', () => {
  it('defaults to local access without cross-origin permissions', () => {
    expect(readEnvironment({})).toEqual({
      port: 3000,
      host: '127.0.0.1',
      corsOrigins: [],
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
  it('parses explicit configuration and removes duplicate origins', () => {
    expect(
      readEnvironment({
        PORT: '4000',
        HOST: '0.0.0.0',
        CORS_ORIGINS: 'http://localhost:3001, http://localhost:3001',
      }),
    ).toEqual({
      port: 4000,
      host: '0.0.0.0',
      corsOrigins: ['http://localhost:3001'],
    });
  });
  it('rejects an empty host', () => {
    expect(() => readEnvironment({ HOST: ' ' })).toThrow('HOST');
  });
});
