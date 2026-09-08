import { accessTokenForService } from './auth-api';
import type { Education, Experience, Job, Profile } from './domain';
import type { PublicOffer } from './offers-api';
export interface AiFinding {
  criterion: string;
  status: 'satisfied' | 'not_satisfied' | 'unknown';
  evidence: string[];
}
export interface OfferRecommendation {
  offer: PublicOffer;
  assessment: 'high' | 'medium' | 'uncertain';
  evidence: { profile: string; offer: string }[];
}
export interface OfferRecommendations {
  model: string;
  method: 'hermes' | 'textual_fallback';
  cached: boolean;
  inspected_offers: number;
  analyzed_offers: number;
  recommendations: OfferRecommendation[];
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
    body: JSON.stringify({
      profile: {
        title: profile.title,
        city: profile.city,
        contract: profile.contract,
        skills: profile.skills,
      },
      job: {
        title: job.title,
        location: job.location,
        contract: job.contract,
        remote: job.remote,
        description: job.description,
        skills: job.skills ?? [],
        experience: job.experience ?? '',
        qualification: job.qualification ?? '',
      },
    }),
  });
  if (!response.ok) throw new Error('local_ai_unavailable');
  return response.json() as Promise<{ model: string; findings: AiFinding[] }>;
}

export async function recommendOffersWithLocalAi(
  profile: Profile,
  experiences: Experience[],
  education: Education[],
  filters: { q?: string; location?: string; contract?: string },
): Promise<OfferRecommendations> {
  const base =
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
      /\/$/,
      '',
    ) || 'http://127.0.0.1:3000';
  const response = await fetch(`${base}/v1/local-ai/recommend-offers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessTokenForService()}`,
    },
    body: JSON.stringify({
      profile: {
        title: profile.title,
        city: profile.city,
        contract: profile.contract,
        skills: profile.skills,
        about: profile.about,
      },
      experiences: experiences.map(({ role, employer, description }) => ({
        role,
        employer,
        description,
      })),
      education: education.map(({ degree, institution, description }) => ({
        degree,
        institution,
        description,
      })),
      filters,
    }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'offer_recommendations_quota'
        : 'offer_recommendations_unavailable',
    );
  return response.json() as Promise<OfferRecommendations>;
}
