export const STATUSES = ['saved', 'applied', 'interview', 'closed'] as const;
export type Status = (typeof STATUSES)[number];
export const LABELS: Record<Status, string> = {
  saved: 'À préparer',
  applied: 'Envoyée',
  interview: 'Entretien',
  closed: 'Terminée',
};
export const CONTRACTS = [
  'CDI',
  'CDD',
  'Alternance',
  'Stage',
  'Freelance',
] as const;
export type Contract = (typeof CONTRACTS)[number];
export interface Profile {
  firstName: string;
  title: string;
  city: string;
  contract: string;
  skills: string;
  about: string;
}
export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  contract: Contract;
  remote: boolean;
  salary: string;
  url: string;
  description: string;
  status: Status;
  notes: string;
  updatedAt: string;
}
export interface Workspace {
  version: 1;
  demo: boolean;
  profile: Profile;
  jobs: Job[];
}
export const STORAGE_KEY = 'cekarna.candidats.v1';
export const emptyWorkspace = (): Workspace => ({
  version: 1,
  demo: false,
  profile: {
    firstName: '',
    title: '',
    city: '',
    contract: '',
    skills: '',
    about: '',
  },
  jobs: [],
});
export function demoWorkspace(): Workspace {
  const state = emptyWorkspace();
  state.demo = true;
  state.profile = {
    firstName: 'Camille',
    title: 'Product designer',
    city: 'Paris',
    contract: 'CDI',
    skills: 'Figma, UX, Design system',
    about: '',
  };
  const examples: [string, string, string, Contract, Status, string, string][] =
    [
      [
        'Product Designer',
        'Atelier Studio',
        'Paris',
        'CDI',
        'saved',
        '45–55 k€',
        'Concevoir des parcours UX et enrichir notre design system avec Figma.',
      ],
      [
        'UX/UI Designer',
        'Solstice',
        'Paris',
        'CDI',
        'saved',
        '42–50 k€',
        'Mener la recherche UX et créer des interfaces sur Figma.',
      ],
      [
        'Product Designer',
        'Maison Nova',
        'Lyon',
        'CDI',
        'applied',
        '45–52 k€',
        'Développer un design system et collaborer avec les équipes produit.',
      ],
      [
        'Designer d’interaction',
        'Forma',
        'Paris',
        'CDD',
        'applied',
        '40–48 k€',
        'Prototyper sur Figma et tester les parcours UX.',
      ],
      [
        'UX Designer',
        'Lumen',
        'Paris',
        'CDI',
        'interview',
        '46–54 k€',
        'Concevoir des parcours UX accessibles et améliorer le design system.',
      ],
      [
        'UI Designer',
        'Pollen',
        'Bordeaux',
        'CDI',
        'closed',
        '38–45 k€',
        'Décliner les interfaces et composants sur Figma.',
      ],
    ];
  state.jobs = examples.map(
    ([title, company, location, contract, status, salary, description], i) => ({
      id: `demo-${i}`,
      title,
      company,
      location,
      contract,
      status,
      salary,
      description,
      remote: i % 2 === 0,
      url: '',
      notes:
        status === 'interview'
          ? 'Préparer deux exemples de projets et les questions pour l’équipe.'
          : '',
      updatedAt: new Date().toISOString(),
    }),
  );
  return state;
}
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
export function safeUrl(value: string): string | null {
  if (!value.trim()) return '';
  try {
    const u = new URL(value.trim());
    return ['https:', 'http:'].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function profileProgress(profile: Profile): number {
  return Math.round(
    (Object.values(profile).filter((value) => value.trim()).length / 6) * 100,
  );
}
export function matches(job: Job, profile: Profile): string[] {
  const result: string[] = [];
  if (
    profile.city.trim() &&
    normalize(job.location) === normalize(profile.city)
  )
    result.push('Localisation souhaitée');
  if (profile.contract && profile.contract === job.contract)
    result.push('Contrat souhaité');
  const text = normalize(`${job.title} ${job.description}`);
  const skills = [
    ...new Set(profile.skills.split(',').map(normalize).filter(Boolean)),
  ];
  const found = skills.filter((skill) => text.includes(skill));
  if (found.length)
    result.push(
      `${found.length} compétence${found.length > 1 ? 's' : ''} mentionnée${found.length > 1 ? 's' : ''} : ${found.join(', ')}`,
    );
  return result;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseWorkspace(raw: string): Workspace | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.demo !== 'boolean' ||
      !isRecord(value.profile) ||
      !Array.isArray(value.jobs) ||
      value.jobs.length > 1000
    )
      return null;
    for (const key of Object.keys(emptyWorkspace().profile))
      if (
        typeof value.profile[key] !== 'string' ||
        value.profile[key].length > 10000
      )
        return null;
    const ids = new Set<string>();
    for (const job of value.jobs) {
      if (!isRecord(job)) return null;
      for (const key of [
        'id',
        'title',
        'company',
        'location',
        'salary',
        'url',
        'description',
        'notes',
        'updatedAt',
      ])
        if (typeof job[key] !== 'string' || job[key].length > 20000)
          return null;
      if (typeof job.id !== 'string' || !job.id || ids.has(job.id)) return null;
      ids.add(job.id);
      if (
        !STATUSES.includes(job.status as Status) ||
        !CONTRACTS.includes(job.contract as Contract) ||
        typeof job.remote !== 'boolean' ||
        safeUrl(job.url as string) === null ||
        Number.isNaN(Date.parse(job.updatedAt as string))
      )
        return null;
    }
    if (
      value.profile.contract !== '' &&
      !CONTRACTS.includes(value.profile.contract as Contract)
    )
      return null;
    const cleanProfile = emptyWorkspace().profile;
    for (const key of Object.keys(cleanProfile) as (keyof Profile)[])
      cleanProfile[key] = value.profile[key] as string;
    return {
      version: 1,
      demo: value.demo,
      profile: cleanProfile,
      jobs: value.jobs as Job[],
    };
  } catch {
    return null;
  }
}
export function exportWorkspace(workspace: Workspace): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(workspace, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cekarna-mon-espace.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
