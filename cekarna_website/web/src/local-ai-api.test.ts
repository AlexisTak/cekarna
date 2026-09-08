import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace } from './domain';
import { recommendOffersWithLocalAi } from './local-ai-api';

vi.mock('./auth-api', async (original) => ({
  ...(await original<typeof import('./auth-api')>()),
  accessTokenForService: vi.fn().mockResolvedValue('candidate-token'),
}));

describe('Hermes offer recommendations API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends only compact professional profile data', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'hermes3:3b',
          cached: false,
          inspected_offers: 0,
          analyzed_offers: 0,
          recommendations: [],
        }),
        { status: 200 },
      ),
    );
    const workspace = emptyWorkspace();
    workspace.profile = {
      ...workspace.profile,
      firstName: 'Camille',
      email: 'camille@example.test',
      phone: '0600000000',
      title: 'Développeuse',
      city: 'Lyon',
      contract: 'CDI',
      skills: 'React',
      about: 'Applications web',
    };
    workspace.experiences.push({
      id: 'private-id',
      role: 'Développeuse',
      employer: 'Atelier',
      location: 'Lyon',
      startDate: '2024-01',
      endDate: '',
      current: true,
      description: 'Interfaces React',
    });
    await recommendOffersWithLocalAi(
      workspace.profile,
      workspace.experiences,
      workspace.education,
      { location: 'Lyon' },
    );
    const request = mock.mock.calls[0][1] as RequestInit;
    const body = String(request.body);
    expect(body).toContain('Interfaces React');
    expect(body).not.toContain('camille@example.test');
    expect(body).not.toContain('0600000000');
    expect(body).not.toContain('private-id');
    expect(request.headers).toMatchObject({
      Authorization: 'Bearer candidate-token',
    });
  });

  it('exposes the temporary quota separately', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 429 }),
    );
    const workspace = emptyWorkspace();
    await expect(
      recommendOffersWithLocalAi(
        workspace.profile,
        workspace.experiences,
        workspace.education,
        {},
      ),
    ).rejects.toThrow('offer_recommendations_quota');
  });
});
