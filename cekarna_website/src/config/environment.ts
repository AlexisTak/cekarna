/** Jeton d'injection de la configuration lue au démarrage. */
export const ENVIRONMENT = 'ENVIRONMENT';

export interface Environment {
  port: number;
  host: string;
  corsOrigins: string[];
  /** Taille maximale acceptée pour un CV PDF importé, en octets. */
  cvImportMaxBytes: number;
  /** Durée de conservation en mémoire du texte extrait, en secondes. */
  cvImportRetentionSeconds: number;
  cvImportMaxPages: number;
  authIdentityUrl: string;
}

/** Plafond technique de l'interception multipart : la configuration ne peut pas le dépasser. */
export const CV_IMPORT_HARD_MAX_BYTES = 10_000_000;

function readInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const value = raw?.trim() ?? '';
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return Number(value);
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
  const authIdentityUrl =
    env.AUTH_IDENTITY_URL?.trim() ?? 'http://127.0.0.1:8081/v1/auth/me';
  try {
    new URL(authIdentityUrl);
  } catch {
    throw new Error('AUTH_IDENTITY_URL must be a valid HTTP(S) URL');
  }
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
    cvImportMaxBytes: readInteger(
      env.CV_IMPORT_MAX_BYTES,
      5_000_000,
      1_024,
      CV_IMPORT_HARD_MAX_BYTES,
      'CV_IMPORT_MAX_BYTES',
    ),
    cvImportRetentionSeconds: readInteger(
      env.CV_IMPORT_RETENTION_SECONDS,
      900,
      60,
      3_600,
      'CV_IMPORT_RETENTION_SECONDS',
    ),
    cvImportMaxPages: readInteger(
      env.CV_IMPORT_MAX_PAGES,
      10,
      1,
      50,
      'CV_IMPORT_MAX_PAGES',
    ),
    authIdentityUrl,
  };
}
