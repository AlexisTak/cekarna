import { describe, expect, it } from 'vitest';
import {
  compareJob,
  compareJobReport,
  emptyWorkspace,
  type CriterionStatus,
  type Job,
  type Profile,
} from './domain';

const offer = (overrides: Partial<Job> = {}): Job => ({
  id: 'held-out-offer',
  title: 'Développeuse React',
  company: 'Corpus',
  location: 'Paris',
  contract: 'CDI',
  remote: false,
  salary: '',
  url: '',
  description: 'Développer des interfaces en React.',
  status: 'saved',
  notes: '',
  updatedAt: '2026-09-07T10:00:00.000Z',
  ...overrides,
});
const profile = (overrides: Partial<Profile> = {}): Profile => ({
  ...emptyWorkspace().profile,
  city: 'Paris',
  contract: 'CDI',
  skills: 'React',
  ...overrides,
});

const annotatedCorpus: Array<{
  name: string;
  profile: Profile;
  job: Job;
  expected: Record<string, CriterionStatus>;
}> = [
  {
    name: 'trois concordances explicites',
    profile: profile(),
    job: offer(),
    expected: {
      location: 'satisfied',
      contract: 'satisfied',
      skills: 'satisfied',
    },
  },
  {
    name: 'préférences explicitement contradictoires',
    profile: profile({ city: 'Lyon', contract: 'CDD' }),
    job: offer(),
    expected: {
      location: 'not_satisfied',
      contract: 'not_satisfied',
      skills: 'satisfied',
    },
  },
  {
    name: 'profil vide',
    profile: profile({ city: '', contract: '', skills: '' }),
    job: offer(),
    expected: { location: 'unknown', contract: 'unknown', skills: 'unknown' },
  },
  {
    name: 'compétence sans preuve dans offre',
    profile: profile({ skills: 'Kubernetes' }),
    job: offer(),
    expected: {
      location: 'satisfied',
      contract: 'satisfied',
      skills: 'unknown',
    },
  },
];

describe('held-out annotated comparison corpus', () => {
  it.each(annotatedCorpus)('$name', ({ profile, job, expected }) => {
    const actual = Object.fromEntries(
      compareJob(job, profile).map((item) => [item.id, item.status]),
    );
    expect(actual).toEqual(expected);
  });

  it('versions only the professional fields used by the method', () => {
    const candidate = profile({ email: 'first@example.test' });
    const initial = compareJobReport(offer(), candidate);
    candidate.email = 'second@example.test';
    expect(compareJobReport(offer(), candidate).profileReference).toBe(
      initial.profileReference,
    );
    candidate.skills = 'React, TypeScript';
    expect(compareJobReport(offer(), candidate).profileReference).not.toBe(
      initial.profileReference,
    );
  });
});
