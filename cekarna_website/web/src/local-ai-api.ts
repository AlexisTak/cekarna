import { accessTokenForService } from './auth-api';
import type { Job, Profile } from './domain';
export interface AiFinding {
  criterion: string;
  status: 'satisfied' | 'missing' | 'unknown';
  evidence: string[];
}
export async function compareWithLocalAi(
  profile: Profile,
  job: Job,
): Promise<{ model: string; findings: AiFinding[] }> {
  const base =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
      /\/$/,
      '',
    ) || 'http://127.0.0.1:3000';
  const response = await fetch(`${base}/v1/local-ai/compare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessTokenForService()}`,
    },
    body: JSON.stringify({ profile, job }),
  });
  if (!response.ok) throw new Error('local_ai_unavailable');
  return response.json() as Promise<{ model: string; findings: AiFinding[] }>;
}
