import type { Contract, Job } from './domain';
export interface PublicOffer {
  id: string;
  source_id: string;
  external_id?: string;
  title: string;
  company: string;
  location: string;
  contract?: string;
  url?: string;
  description: string;
  published_at?: string;
  salary?: string;
  work_duration?: string;
  experience?: string;
  qualification?: string;
  skills?: string[];
  accessible_th?: boolean;
}
export interface PublicOfferPage {
  offers: PublicOffer[];
  next_cursor: string | null;
}
const base = () =>
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    '',
  ) || 'http://127.0.0.1:3000';
export async function searchPublicOffers(filters: {
  q?: string;
  location?: string;
  contract?: string;
  cursor?: string;
}): Promise<PublicOfferPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value);
  const response = await fetch(`${base()}/v1/offers?${params}`);
  if (!response.ok) throw new Error('offers_unavailable');
  return response.json() as Promise<PublicOfferPage>;
}
export function publicOfferToJob(offer: PublicOffer): Job {
  const known = ['CDI', 'CDD', 'Alternance', 'Stage', 'Freelance'].includes(
    offer.contract ?? '',
  )
    ? (offer.contract as Contract)
    : '';
  return {
    id: `public:${offer.id}`,
    title: offer.title,
    company: offer.company,
    location: offer.location,
    contract: known,
    remote: false,
    salary: offer.salary ?? '',
    url: offer.url ?? '',
    description: offer.description,
    status: 'saved',
    notes: '',
    updatedAt: new Date().toISOString(),
    source: offer.source_id,
    publishedAt: offer.published_at,
    workDuration: offer.work_duration,
    experience: offer.experience,
    qualification: offer.qualification,
    skills: offer.skills,
    accessibleToDisabledPeople: offer.accessible_th,
  };
}
