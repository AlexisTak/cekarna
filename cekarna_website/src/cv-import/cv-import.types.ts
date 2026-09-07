export const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'title',
  'city',
  'contract',
  'skills',
  'about',
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number];

export const CONTRACTS = [
  'CDI',
  'CDD',
  'Alternance',
  'Stage',
  'Freelance',
] as const;

export type Contract = (typeof CONTRACTS)[number];

/** Position exacte d'un extrait dans le document importé. */
export interface SourceExcerpt {
  /** Numéro de page, à partir de 1. */
  page: number;
  /** Numéro de ligne dans la page, à partir de 1. */
  line: number;
  /** Texte intégral de la ligne, tel qu'il figure dans le PDF. */
  text: string;
  /** Bornes du fragment retenu à l'intérieur de `text`. */
  start: number;
  end: number;
}

/**
 * Valeur proposée pour un champ. `value` est toujours construite à partir des
 * extraits : aucune donnée n'est déduite, complétée ni reformulée.
 */
export interface FieldCandidate {
  value: string;
  excerpts: SourceExcerpt[];
  /** Identifiant de la règle appliquée, affichable pour expliquer la proposition. */
  rule: string;
}

export interface FieldExtraction {
  field: ProfileField;
  candidates: FieldCandidate[];
  /** Renseigné quand aucune proposition n'a pu être justifiée par le document. */
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
  experienceCandidates: FieldCandidate[];
  educationCandidates: FieldCandidate[];
}

export type FieldSource = 'extracted' | 'manual';

export interface ConfirmedField {
  value: string;
  source: FieldSource;
}

export interface ConfirmedProfile {
  profile: Record<ProfileField, string>;
  provenance: Record<ProfileField, FieldSource | 'empty'>;
  excerpts: Partial<Record<ProfileField, SourceExcerpt[]>>;
  experiences: FieldCandidate[];
  education: FieldCandidate[];
}
