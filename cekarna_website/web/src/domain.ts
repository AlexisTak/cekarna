import { parseProfileSources, type ProfileSources } from './profile-sources';
import type { SourceExcerpt } from './cv-import-api';
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
  lastName: string;
  email: string;
  phone: string;
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
  contract: Contract | '';
  remote: boolean;
  salary: string;
  url: string;
  description: string;
  status: Status;
  notes: string;
  updatedAt: string;
  source?: string;
  publishedAt?: string;
  workDuration?: string;
  experience?: string;
  qualification?: string;
  skills?: string[];
  accessibleToDisabledPeople?: boolean;
  reminderAt?: string;
}
export interface Experience {
  id: string;
  role: string;
  employer: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  evidence?: CareerEvidence;
}
export interface Education {
  id: string;
  degree: string;
  institution: string;
  startDate: string;
  endDate: string;
  description: string;
  evidence?: CareerEvidence;
}
export interface CareerEvidence {
  value: string;
  excerpts: SourceExcerpt[];
}
export interface Workspace {
  version: 1;
  demo: boolean;
  profile: Profile;
  jobs: Job[];
  experiences: Experience[];
  education: Education[];
  profileSources?: ProfileSources;
}
export const STORAGE_KEY = 'cekarna.candidats.v1';
export const emptyWorkspace = (): Workspace => ({
  version: 1,
  demo: false,
  profile: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    title: '',
    city: '',
    contract: '',
    skills: '',
    about: '',
  },
  jobs: [],
  experiences: [],
  education: [],
});
export function demoWorkspace(): Workspace {
  const state = emptyWorkspace();
  state.demo = true;
  state.profile = {
    firstName: 'Camille',
    lastName: 'Martin',
    email: '',
    phone: '',
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
export function createTestJobs(): Job[] {
  const now = new Date().toISOString();
  const rows: Array<[string, string, string, Contract, boolean, string]> = [
    [
      'Développeur React TypeScript',
      'Test — Nova Web',
      'Paris',
      'CDI',
      true,
      'Développer des interfaces React et TypeScript accessibles. Travail avec Git, tests automatisés et API REST.',
    ],
    [
      'Développeur backend Rust',
      'Test — Ferris Labs',
      'Lyon',
      'CDI',
      true,
      'Concevoir des microservices Rust, PostgreSQL et Docker. Une expérience des API HTTP est recherchée.',
    ],
    [
      'Chef de projet numérique',
      'Test — Horizon',
      'Bordeaux',
      'CDD',
      false,
      'Coordonner les équipes, suivre le planning et communiquer avec les parties prenantes. Maîtrise d’Excel appréciée.',
    ],
    [
      'Assistant support informatique',
      'Test — Atlas Services',
      'Paris',
      'Alternance',
      false,
      'Accompagner les utilisateurs, diagnostiquer les incidents Windows et documenter les solutions.',
    ],
    [
      'Product Designer',
      'Test — Studio Pixel',
      'Paris',
      'CDI',
      true,
      'Concevoir des parcours UX, des prototypes Figma et maintenir un design system accessible.',
    ],
  ];
  return rows.map(
    ([title, company, location, contract, remote, description]) => ({
      id: crypto.randomUUID(),
      title,
      company,
      location,
      contract,
      remote,
      salary: '',
      url: '',
      description,
      status: 'saved',
      notes: 'Offre fictive créée pour tester la comparaison profil–offre.',
      updatedAt: now,
    }),
  );
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
  const values = Object.values(profile);
  return Math.round(
    (values.filter((value) => value.trim()).length / values.length) * 100,
  );
}
export function matches(job: Job, profile: Profile): string[] {
  return compareJob(job, profile)
    .filter((criterion) => criterion.status === 'satisfied')
    .map((criterion) => criterion.label);
}
export type CriterionStatus = 'satisfied' | 'not_satisfied' | 'unknown';
export interface ComparisonCriterion {
  id: string;
  label: string;
  status: CriterionStatus;
  evidence: string[];
}
export interface ComparisonReport {
  methodVersion: 'text-rules-v2';
  profileReference: string;
  jobReference: string;
  criteria: ComparisonCriterion[];
}
function comparisonFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function compareJobReport(job: Job, profile: Profile): ComparisonReport {
  const relevantProfile = [
    profile.title,
    profile.city,
    profile.contract,
    profile.skills,
  ]
    .map(normalize)
    .join('\u0000');
  const relevantJob = [
    job.title,
    job.location,
    job.contract,
    job.description,
    ...(job.skills ?? []),
  ]
    .map(normalize)
    .join('\u0000');
  return {
    methodVersion: 'text-rules-v2',
    profileReference: comparisonFingerprint(relevantProfile),
    jobReference: `${job.id}:${comparisonFingerprint(`${job.updatedAt}\u0000${relevantJob}`)}`,
    criteria: compareJob(job, profile),
  };
}
/** Version 2 : règles déterministes, jamais un score ou une prédiction d’embauche. */
export function compareJob(job: Job, profile: Profile): ComparisonCriterion[] {
  const result: ComparisonCriterion[] = [];
  if (
    profile.city.trim() &&
    normalize(job.location) === normalize(profile.city)
  )
    result.push({
      id: 'location',
      label: 'Localisation souhaitée',
      status: 'satisfied',
      evidence: [profile.city, job.location],
    });
  else if (profile.city.trim() && job.location.trim())
    result.push({
      id: 'location',
      label: 'Localisation souhaitée',
      status: 'not_satisfied',
      evidence: [profile.city, job.location],
    });
  else
    result.push({
      id: 'location',
      label: 'Localisation souhaitée',
      status: 'unknown',
      evidence: [],
    });
  if (profile.contract && profile.contract === job.contract)
    result.push({
      id: 'contract',
      label: 'Contrat souhaité',
      status: 'satisfied',
      evidence: [profile.contract, job.contract],
    });
  else if (profile.contract && job.contract)
    result.push({
      id: 'contract',
      label: 'Contrat souhaité',
      status: 'not_satisfied',
      evidence: [profile.contract, job.contract],
    });
  else
    result.push({
      id: 'contract',
      label: 'Contrat souhaité',
      status: 'unknown',
      evidence: [],
    });
  const text = normalize(
    `${job.title} ${job.description} ${(job.skills ?? []).join(' ')}`,
  );
  const skills = [
    ...new Set(
      profile.skills
        .split(/[,;\n]/)
        .map(normalize)
        .filter(Boolean),
    ),
  ];
  const found = skills.filter((skill) => text.includes(skill));
  if (found.length)
    result.push({
      id: 'skills',
      label: `${found.length} compétence${found.length > 1 ? 's' : ''} mentionnée${found.length > 1 ? 's' : ''} : ${found.join(', ')}`,
      status: 'satisfied',
      evidence: found,
    });
  else
    result.push({
      id: 'skills',
      label: 'Compétences',
      status: 'unknown',
      evidence: [],
    });
  return result;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
function validMonth(value: unknown): boolean {
  return value === '' || (typeof value === 'string' && MONTH.test(value));
}
function validCareerItems(
  value: unknown,
  fields: readonly string[],
  hasCurrent: boolean,
  evidenceField: string,
): boolean {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) return false;
    for (const field of fields)
      if (typeof item[field] !== 'string' || item[field].length > 5000)
        return false;
    if (
      !item.id ||
      ids.has(item.id as string) ||
      !validMonth(item.startDate) ||
      !validMonth(item.endDate) ||
      (hasCurrent && typeof item.current !== 'boolean')
    )
      return false;
    if (hasCurrent && item.current && item.endDate !== '') return false;
    if (item.evidence !== undefined) {
      if (
        !isRecord(item.evidence) ||
        item.evidence.value !== item[evidenceField] ||
        !Array.isArray(item.evidence.excerpts) ||
        !item.evidence.excerpts.length ||
        item.evidence.excerpts.length > 50
      )
        return false;
      for (const excerpt of item.evidence.excerpts) {
        if (!isRecord(excerpt) || typeof excerpt.text !== 'string')
          return false;
        const { page, line, start, end, text } = excerpt;
        if (
          !Number.isSafeInteger(page) ||
          (page as number) < 1 ||
          !Number.isSafeInteger(line) ||
          (line as number) < 1 ||
          !Number.isSafeInteger(start) ||
          (start as number) < 0 ||
          !Number.isSafeInteger(end) ||
          (end as number) <= (start as number) ||
          (end as number) > text.length ||
          text.length > 10000
        )
          return false;
      }
    }
    ids.add(item.id as string);
  }
  return true;
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
    const legacyProfileFields = [
      'firstName',
      'title',
      'city',
      'contract',
      'skills',
      'about',
    ];
    for (const key of legacyProfileFields)
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
        (job.contract !== '' &&
          !CONTRACTS.includes(job.contract as Contract)) ||
        typeof job.remote !== 'boolean' ||
        safeUrl(job.url as string) === null ||
        Number.isNaN(Date.parse(job.updatedAt as string))
      )
        return null;
      for (const key of [
        'source',
        'publishedAt',
        'workDuration',
        'experience',
        'qualification',
        'reminderAt',
      ])
        if (
          job[key] !== undefined &&
          (typeof job[key] !== 'string' || job[key].length > 1000)
        )
          return null;
      if (
        job.publishedAt !== undefined &&
        Number.isNaN(Date.parse(job.publishedAt as string))
      )
        return null;
      if (
        job.reminderAt !== undefined &&
        Number.isNaN(Date.parse(job.reminderAt as string))
      )
        return null;
      if (
        job.accessibleToDisabledPeople !== undefined &&
        typeof job.accessibleToDisabledPeople !== 'boolean'
      )
        return null;
      if (
        job.skills !== undefined &&
        (!Array.isArray(job.skills) ||
          job.skills.length > 100 ||
          job.skills.some(
            (skill) => typeof skill !== 'string' || skill.length > 300,
          ))
      )
        return null;
    }
    if (
      value.profile.contract !== '' &&
      !CONTRACTS.includes(value.profile.contract as Contract)
    )
      return null;
    const experiences =
      value.experiences === undefined ? [] : value.experiences;
    const education = value.education === undefined ? [] : value.education;
    if (
      !validCareerItems(
        experiences,
        [
          'id',
          'role',
          'employer',
          'location',
          'startDate',
          'endDate',
          'description',
        ],
        true,
        'role',
      ) ||
      !validCareerItems(
        education,
        ['id', 'degree', 'institution', 'startDate', 'endDate', 'description'],
        false,
        'degree',
      )
    )
      return null;
    const cleanProfile = emptyWorkspace().profile;
    for (const key of Object.keys(cleanProfile) as (keyof Profile)[]) {
      const fieldValue = value.profile[key];
      if (fieldValue !== undefined && typeof fieldValue !== 'string')
        return null;
      if (typeof fieldValue === 'string' && fieldValue.length > 10000)
        return null;
      cleanProfile[key] = typeof fieldValue === 'string' ? fieldValue : '';
    }
    const profileSources = parseProfileSources(
      value.profileSources,
      cleanProfile,
    );
    if (profileSources === null) return null;
    return {
      ...(profileSources ? { profileSources } : {}),
      version: 1,
      demo: value.demo,
      profile: cleanProfile,
      jobs: value.jobs as Job[],
      experiences: experiences as Experience[],
      education: education as Education[],
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
