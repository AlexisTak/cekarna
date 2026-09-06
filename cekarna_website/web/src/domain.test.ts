import { describe, it, expect } from 'vitest';
import {
  demoWorkspace,
  emptyWorkspace,
  matches,
  parseWorkspace,
  profileProgress,
  safeUrl,
} from './domain';
describe('workspace persistence', () => {
  it('round trips user data and example data', () => {
    for (const state of [emptyWorkspace(), demoWorkspace()])
      expect(parseWorkspace(JSON.stringify(state))).toEqual(state);
  });
  it.each(['bad json', '{}', '{"version":2}', 'null'])(
    'rejects invalid persisted data %s',
    (raw) => expect(parseWorkspace(raw)).toBeNull(),
  );
  it('rejects invalid states and duplicate IDs', () => {
    const state = demoWorkspace();
    state.jobs.push(state.jobs[0]);
    expect(parseWorkspace(JSON.stringify(state))).toBeNull();
  });
  it('discards unknown profile fields before rendering', () => {
    const state = {
      ...emptyWorkspace(),
      profile: { ...emptyWorkspace().profile, extra: { bad: true } },
    };
    expect(
      profileProgress(parseWorkspace(JSON.stringify(state))!.profile),
    ).toBe(0);
  });
  it('rejects links that could execute script', () => {
    const state = demoWorkspace();
    state.jobs[0].url = 'javascript:alert(1)';
    expect(parseWorkspace(JSON.stringify(state))).toBeNull();
  });
});
describe('manual criteria', () => {
  it('does not invent criteria for an empty profile', () =>
    expect(matches(demoWorkspace().jobs[0], emptyWorkspace().profile)).toEqual(
      [],
    ));
  it('normalizes accents and deduplicates skills', () => {
    const state = demoWorkspace();
    state.profile.skills = 'Fígma, figma';
    expect(matches(state.jobs[0], state.profile)).toContain(
      '1 compétence mentionnée : figma',
    );
  });
  it('ignores whitespace in completeness', () => {
    const p = emptyWorkspace().profile;
    p.firstName = ' ';
    expect(profileProgress(p)).toBe(0);
  });
});
describe('external links', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'https://user:pass@example.com',
    'bad',
  ])('rejects unsafe link %s', (value) => expect(safeUrl(value)).toBeNull());
  it('allows an optional or web link', () => {
    expect(safeUrl('')).toBe('');
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
  });
});
