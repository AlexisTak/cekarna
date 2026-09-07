import { describe, expect, it } from 'vitest';
import { emptyWorkspace, parseWorkspace } from './domain';
import {
  confirmedSources,
  editedSources,
  type ProfileSources,
} from './profile-sources';

const sources: ProfileSources = {
  city: {
    value: 'Paris',
    source: 'extracted',
    excerpts: [{ page: 2, line: 3, text: 'Ville : Paris', start: 8, end: 13 }],
  },
};

describe('durable profile evidence', () => {
  it('preserves evidence across JSON save and restore', () => {
    const workspace = emptyWorkspace();
    workspace.profile.city = 'Paris';
    workspace.profileSources = sources;
    expect(parseWorkspace(JSON.stringify(workspace))).toEqual(workspace);
  });
  it('keeps unchanged evidence but removes it when a field is edited or cleared', () => {
    const before = { ...emptyWorkspace().profile, city: 'Paris' };
    expect(
      editedSources(before, { ...before, title: 'Designer' }, sources).city,
    ).toEqual(sources.city);
    expect(
      editedSources(before, { ...before, city: 'Lyon' }, sources).city,
    ).toEqual({ value: 'Lyon', source: 'manual', excerpts: [] });
    expect(
      editedSources(before, { ...before, city: '' }, sources).city?.source,
    ).toBe('empty');
  });
  it('rejects stale evidence and invalid excerpt ranges on restore', () => {
    const workspace = { ...emptyWorkspace(), profileSources: sources };
    expect(parseWorkspace(JSON.stringify(workspace))).toBeNull();
    workspace.profile.city = 'Paris';
    const malformed = structuredClone(workspace);
    malformed.profileSources.city!.excerpts[0].end = 100;
    expect(parseWorkspace(JSON.stringify(malformed))).toBeNull();
  });
  it('does not claim evidence from older API responses without excerpts', () => {
    const profile = { ...emptyWorkspace().profile, city: 'Paris' };
    const provenance = {
      firstName: 'empty',
      lastName: 'empty',
      email: 'empty',
      phone: 'empty',
      city: 'extracted',
      title: 'empty',
      contract: 'empty',
      skills: 'empty',
      about: 'empty',
    } as const;
    expect(confirmedSources({ profile, provenance }).city).toBeUndefined();
    expect(
      confirmedSources({
        profile,
        provenance,
        excerpts: { city: sources.city!.excerpts },
      }).city,
    ).toEqual(sources.city);
  });
});
