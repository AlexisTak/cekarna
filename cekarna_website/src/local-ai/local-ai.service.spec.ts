import { LocalAiService } from './local-ai.service';

describe('LocalAiService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('excludes unrelated personal fields and rejects unsupported findings', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              findings: [
                {
                  criterion: 'React',
                  status: 'satisfied',
                  evidence: ['React'],
                },
                {
                  criterion: 'Âge',
                  status: 'not_satisfied',
                  evidence: ['42 ans'],
                },
                { criterion: 'Docker', status: 'not_satisfied', evidence: [] },
              ],
            }),
          },
        }),
        { status: 200 },
      ),
    );
    const result = await new LocalAiService().compare(
      {
        title: 'Développeuse',
        skills: 'React',
        email: 'secret@example.test',
        phone: '0600000000',
      },
      { title: 'Poste React', description: 'React', notes: 'note privée' },
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    if (typeof request.body !== 'string') throw new Error('missing JSON body');
    const sent = request.body;
    expect(sent).toContain('React');
    expect(sent).not.toContain('secret@example.test');
    expect(sent).not.toContain('0600000000');
    expect(sent).not.toContain('note privée');
    expect(result.findings).toEqual([
      { criterion: 'React', status: 'satisfied', evidence: ['React'] },
      { criterion: 'Docker', status: 'unknown', evidence: [] },
    ]);
  });
});
