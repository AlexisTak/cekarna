import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface LocalFinding {
  criterion: string;
  status: 'satisfied' | 'missing' | 'unknown';
  evidence: string[];
}

@Injectable()
export class LocalAiService {
  async compare(
    profile: unknown,
    job: unknown,
  ): Promise<{ model: string; findings: LocalFinding[] }> {
    const model = process.env.LOCAL_LLM_MODEL?.trim() || 'hermes3:3b';
    const base = (
      process.env.LOCAL_LLM_BASE_URL?.trim() || 'http://127.0.0.1:11434'
    ).replace(/\/$/, '');
    const source = JSON.stringify({ profile, job });
    const prompt = `Compare ce profil et cette offre. Réponds uniquement en JSON {"findings":[{"criterion":"...","status":"satisfied|missing|unknown","evidence":["extrait littéral"]}]}. Chaque preuve doit être un extrait littéral exact du JSON fourni. Une absence de preuve donne unknown, jamais missing. Données: ${source}`;
    let response: Response;
    try {
      response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Le modèle Hermes local est indisponible.',
      );
    }
    if (!response.ok)
      throw new ServiceUnavailableException(
        'Le modèle Hermes local est indisponible.',
      );
    const envelope = (await response.json()) as {
      message?: { content?: string };
    };
    let parsed: { findings?: unknown };
    try {
      parsed = JSON.parse(envelope.message?.content || '{}') as {
        findings?: unknown;
      };
    } catch {
      throw new ServiceUnavailableException(
        'Hermes a renvoyé une réponse illisible.',
      );
    }
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings.flatMap((value): LocalFinding[] => {
          if (!value || typeof value !== 'object') return [];
          const item = value as Record<string, unknown>;
          if (
            typeof item.criterion !== 'string' ||
            !['satisfied', 'missing', 'unknown'].includes(
              String(item.status),
            ) ||
            !Array.isArray(item.evidence)
          )
            return [];
          const evidence = item.evidence.filter(
            (entry): entry is string =>
              typeof entry === 'string' &&
              entry.length > 0 &&
              source.includes(entry),
          );
          const status =
            item.status === 'missing' && evidence.length === 0
              ? 'unknown'
              : (item.status as LocalFinding['status']);
          return [
            {
              criterion: item.criterion.slice(0, 120),
              status,
              evidence: evidence.slice(0, 5),
            },
          ];
        })
      : [];
    return { model, findings: findings.slice(0, 12) };
  }
}
