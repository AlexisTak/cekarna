import type { Profile } from './domain';

export type ProfileField = keyof Profile;

export const PROFILE_FIELDS: ProfileField[] = [
  'firstName',
  'title',
  'city',
  'contract',
  'skills',
  'about',
];

/** Position exacte d'un extrait dans le CV importé. */
export interface SourceExcerpt {
  page: number;
  line: number;
  text: string;
  start: number;
  end: number;
}

export interface FieldCandidate {
  value: string;
  excerpts: SourceExcerpt[];
  rule: string;
}

export interface FieldExtraction {
  field: ProfileField;
  candidates: FieldCandidate[];
  reason?: string;
}

export interface PageText {
  page: number;
  lines: string[];
}

export interface CvExtraction {
  documentId: string;
  expiresAt: string;
  pageCount: number;
  pages: PageText[];
  fields: FieldExtraction[];
}

export type FieldSource = 'extracted' | 'manual';

export interface ConfirmedField {
  value: string;
  source: FieldSource;
}

export interface ConfirmedProfile {
  profile: Profile;
  provenance: Record<ProfileField, FieldSource | 'empty'>;
}

export class CvImportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'CvImportError';
    this.status = status;
  }
}

const BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    '',
  ) || 'http://127.0.0.1:3000';

/** Taille refusée côté navigateur pour éviter un envoi inutile. */
export const MAX_UPLOAD_BYTES = 5_000_000;

async function toError(response: Response): Promise<CvImportError> {
  let message = 'L’import a échoué. Réessayez dans un instant.';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message) message = body.message;
    else if (Array.isArray(body.message) && typeof body.message[0] === 'string')
      message = body.message[0];
  } catch {
    // corps non JSON : on garde le message générique
  }
  return new CvImportError(response.status, message);
}

/** Refuse localement ce qui sera de toute façon refusé par l'API. */
export function describeFileProblem(file: File): string | undefined {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Choisissez un fichier PDF.';
  if (!file.size) return 'Ce fichier est vide.';
  if (file.size > MAX_UPLOAD_BYTES)
    return `Ce PDF dépasse ${Math.floor(MAX_UPLOAD_BYTES / 1_000_000)} Mo.`;
  return undefined;
}

export async function extractCv(
  file: File,
  signal?: AbortSignal,
): Promise<CvExtraction> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${BASE}/v1/cv-import/extraction`, {
    method: 'POST',
    body,
    signal,
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as CvExtraction;
}

export async function confirmProfile(
  documentId: string,
  fields: Partial<Record<ProfileField, ConfirmedField>>,
  signal?: AbortSignal,
): Promise<ConfirmedProfile> {
  const response = await fetch(`${BASE}/v1/cv-import/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, fields }),
    signal,
  });
  if (!response.ok) throw await toError(response);
  return (await response.json()) as ConfirmedProfile;
}
