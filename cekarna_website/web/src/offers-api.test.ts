import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicOfferToJob, searchPublicOffers } from './offers-api';
describe('public offers API', () => {
  afterEach(() => vi.restoreAllMocks());
  it('encodes filters and reads a page', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ offers: [], next_cursor: null }), {
          status: 200,
        }),
      );
    await searchPublicOffers({ q: 'développeur web', location: 'Lyon' });
    expect(String(mock.mock.calls[0][0])).toContain(
      'q=d%C3%A9veloppeur+web&location=Lyon',
    );
  });
  it('does not invent an unknown contract', () => {
    const job = publicOfferToJob({
      id: '1',
      source_id: 'france-travail',
      title: 'Poste',
      company: '',
      location: '',
      contract: 'MYSTERY',
      description: '',
      salary: '35 000 €',
      skills: ['TypeScript'],
      accessible_th: true,
    });
    expect(job.contract).toBe('');
    expect(job.source).toBe('france-travail');
    expect(job.id).toBe('public:1');
    expect(job.salary).toBe('35 000 €');
    expect(job.skills).toEqual(['TypeScript']);
    expect(job.accessibleToDisabledPeople).toBe(true);
  });
});
