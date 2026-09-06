export interface Environment {
  port: number;
  host: string;
  corsOrigins: string[];
}

export function readEnvironment(env: NodeJS.ProcessEnv): Environment {
  const rawPort = env.PORT ?? '3000';
  if (
    !/^\d+$/.test(rawPort) ||
    Number(rawPort) < 1 ||
    Number(rawPort) > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const host = env.HOST?.trim() ?? '127.0.0.1';
  if (!host) throw new Error('HOST must not be empty');
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain HTTP(S) origins');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(
        'CORS_ORIGINS must contain origins without paths or credentials',
      );
    }
  }
  return {
    port: Number(rawPort),
    host,
    corsOrigins: [...new Set(corsOrigins)],
  };
}
