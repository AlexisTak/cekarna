import type { Profile } from './domain';
import type { ConfirmedProfile, SourceExcerpt } from './cv-import-api';

export type ProfileSources = Partial<
  Record<
    keyof Profile,
    {
      value: string;
      source: 'extracted' | 'manual' | 'empty';
      excerpts: SourceExcerpt[];
    }
  >
>;

export function confirmedSources(confirmed: ConfirmedProfile): ProfileSources {
  const sources: ProfileSources = {};
  for (const field of Object.keys(confirmed.profile) as (keyof Profile)[]) {
    const excerpts = confirmed.excerpts?.[field] ?? [];
    // Older API responses have no durable evidence: do not label them as verified excerpts.
    if (confirmed.provenance[field] === 'extracted' && !excerpts.length)
      continue;
    sources[field] = {
      value: confirmed.profile[field],
      source: confirmed.provenance[field],
      excerpts,
    };
  }
  return sources;
}

export function editedSources(
  before: Profile,
  after: Profile,
  existing?: ProfileSources,
): ProfileSources {
  const sources = { ...existing };
  for (const field of Object.keys(after) as (keyof Profile)[]) {
    if (before[field] !== after[field]) {
      sources[field] = {
        value: after[field],
        source: after[field] ? 'manual' : 'empty',
        excerpts: [],
      };
    }
  }
  return sources;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProfileSources(
  value: unknown,
  profile: Profile,
): ProfileSources | undefined | null {
  if (value === undefined) return undefined;
  if (!record(value)) return null;
  const result: ProfileSources = {};
  for (const field of Object.keys(profile) as (keyof Profile)[]) {
    const entry = value[field];
    if (entry === undefined) continue;
    if (
      !record(entry) ||
      entry.value !== profile[field] ||
      !['extracted', 'manual', 'empty'].includes(String(entry.source)) ||
      !Array.isArray(entry.excerpts) ||
      entry.excerpts.length > 1000
    )
      return null;
    const excerpts: SourceExcerpt[] = [];
    for (const excerpt of entry.excerpts) {
      if (
        !record(excerpt) ||
        typeof excerpt.text !== 'string' ||
        excerpt.text.length > 10000
      )
        return null;
      const { page, line, start, end, text } = excerpt;
      if (
        typeof page !== 'number' ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        typeof line !== 'number' ||
        !Number.isSafeInteger(line) ||
        line < 1 ||
        typeof start !== 'number' ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        typeof end !== 'number' ||
        !Number.isSafeInteger(end) ||
        end <= start ||
        end > text.length
      )
        return null;
      excerpts.push({ page, line, start, end, text });
    }
    if (
      entry.source === 'extracted'
        ? !excerpts.length || !entry.value
        : excerpts.length > 0
    )
      return null;
    if (entry.source === 'empty' && entry.value !== '') return null;
    result[field] = {
      value: profile[field],
      source: entry.source as 'extracted' | 'manual' | 'empty',
      excerpts,
    };
  }
  return result;
}
