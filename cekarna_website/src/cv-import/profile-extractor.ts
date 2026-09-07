import {
  CONTRACTS,
  FieldCandidate,
  FieldExtraction,
  PageText,
  ProfileField,
  SourceExcerpt,
} from './cv-import.types';

interface LocatedLine {
  page: number;
  line: number;
  text: string;
}

type HeadingKind = 'about' | 'skills' | 'experience' | 'education' | 'other';

/** Titres courants de CV, ramenés à une catégorie sans interpréter leur contenu. */
const HEADING_ALIASES: Record<string, HeadingKind> = {
  profil: 'about',
  'profil professionnel': 'about',
  'a propos': 'about',
  'a propos de moi': 'about',
  resume: 'about',
  'resume professionnel': 'about',
  objectif: 'about',
  'objectif professionnel': 'about',
  presentation: 'about',
  competence: 'skills',
  competences: 'skills',
  'mes competences': 'skills',
  'competences cles': 'skills',
  'competences techniques': 'skills',
  'competences professionnelles': 'skills',
  'competences et outils': 'skills',
  'domaines de competences': 'skills',
  expertise: 'skills',
  expertises: 'skills',
  outils: 'skills',
  technologies: 'skills',
  skill: 'skills',
  skills: 'skills',
  'hard skills': 'skills',
  'soft skills': 'skills',
  'savoir faire': 'skills',
  experience: 'experience',
  experiences: 'experience',
  'experience professionnelle': 'experience',
  'experiences professionnelles': 'experience',
  parcours: 'experience',
  'mon parcours': 'experience',
  'parcours professionnel': 'experience',
  carriere: 'experience',
  formation: 'education',
  formations: 'education',
  education: 'education',
  diplome: 'education',
  diplomes: 'education',
  'formation et diplomes': 'education',
  'formations et diplomes': 'education',
  'parcours academique': 'education',
  langue: 'other',
  langues: 'other',
  projet: 'other',
  projets: 'other',
  certification: 'other',
  certifications: 'other',
  interet: 'other',
  interets: 'other',
  'centres d interet': 'other',
  loisir: 'other',
  loisirs: 'other',
  reference: 'other',
  references: 'other',
  contact: 'other',
};

const ABOUT_HEADINGS: HeadingKind[] = ['about'];
const SKILL_HEADINGS: HeadingKind[] = ['skills'];
const EXPERIENCE_HEADINGS: HeadingKind[] = ['experience'];
const EDUCATION_HEADINGS: HeadingKind[] = ['education'];

const BULLET = /^[\s•·*\-–—>+]+/;
const MAX_HEADER_LINES = 8;
const MAX_TITLE_LENGTH = 80;
const MAX_SECTION_LINES = 12;
const MAX_CANDIDATES = 5;

/** Retire les diacritiques pour comparer des mots-cles, sans modifier la valeur retenue. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function flatten(pages: PageText[]): LocatedLine[] {
  const lines: LocatedLine[] = [];
  for (const page of pages)
    page.lines.forEach((text, index) =>
      lines.push({ page: page.page, line: index + 1, text }),
    );
  return lines;
}

function excerptOf(
  line: LocatedLine,
  fragment: string,
  from = 0,
): SourceExcerpt {
  const start = line.text.indexOf(fragment, from);
  if (start < 0)
    throw new Error('Un extrait doit être un fragment littéral de la ligne');
  return {
    page: line.page,
    line: line.line,
    text: line.text,
    start,
    end: start + fragment.length,
  };
}

function headingLabel(text: string): HeadingKind | undefined {
  const folded = fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!folded || folded.length > 60) return undefined;
  return HEADING_ALIASES[folded];
}

function isHeading(text: string): boolean {
  return headingLabel(text) !== undefined;
}

function looksLikeContact(text: string): boolean {
  return /@|https?:\/\/|\+\d|\d{2}[\s.]?\d{2}[\s.]?\d{2}/.test(text);
}

/** Ligne de nom : uniquement des mots commencant par une majuscule, sans chiffre. */
function nameParts(text: string): string[] | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return undefined;
  if (looksLikeContact(trimmed) || /\d/.test(trimmed)) return undefined;
  if (isHeading(trimmed)) return undefined;
  const words = trimmed.split(/\s+/);
  if (words.length < 1 || words.length > 4) return undefined;
  const shape = /^\p{Lu}[\p{L}’'-]*$/u;
  if (!words.every((word) => shape.test(word))) return undefined;
  return words;
}

function nameCandidate(text: string): string | undefined {
  return nameParts(text)?.[0];
}

function labelledValue(
  lines: LocatedLine[],
  pattern: RegExp,
  rule: string,
): FieldCandidate[] {
  const found: FieldCandidate[] = [];
  for (const line of lines) {
    const match = pattern.exec(line.text);
    if (!match) continue;
    const value = match[match.length - 1].trim();
    if (!value) continue;
    found.push({ value, excerpts: [excerptOf(line, value)], rule });
  }
  return found;
}

function extractFirstName(lines: LocatedLine[]): FieldCandidate[] {
  const candidates = labelledValue(
    lines,
    /^\s*(pr[ée]nom)\s*:\s*(.+)$/iu,
    'prenom-libelle',
  );
  for (const line of lines.slice(0, MAX_HEADER_LINES)) {
    if (line.page !== 1) break;
    const first = nameCandidate(line.text);
    if (!first) continue;
    candidates.push({
      value: first,
      excerpts: [excerptOf(line, first)],
      rule: 'nom-en-tete',
    });
    break;
  }
  return candidates;
}

function extractLastName(lines: LocatedLine[]): FieldCandidate[] {
  const candidates = labelledValue(
    lines,
    /^\s*(nom)\s*:\s*(.+)$/iu,
    'nom-libelle',
  );
  for (const line of lines.slice(0, MAX_HEADER_LINES)) {
    if (line.page !== 1) break;
    const words = nameParts(line.text);
    if (!words || words.length < 2) continue;
    const value = words.slice(1).join(' ');
    candidates.push({
      value,
      excerpts: [excerptOf(line, value)],
      rule: 'nom-en-tete',
    });
    break;
  }
  return candidates;
}

function extractEmail(lines: LocatedLine[]): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  const pattern =
    /[\p{L}\d.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/iu;
  for (const line of lines) {
    const match = pattern.exec(line.text);
    if (!match) continue;
    candidates.push({
      value: match[0],
      excerpts: [excerptOf(line, match[0], match.index)],
      rule: 'email',
    });
  }
  return candidates;
}

function extractPhone(lines: LocatedLine[]): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  const pattern = /(?:\+\d{1,3}[ .-]?)?(?:\(?\d{1,3}\)?[ .-]?){3,6}\d{2,4}/u;
  for (const line of lines) {
    const match = pattern.exec(line.text);
    if (!match || match[0].replace(/\D/g, '').length < 10) continue;
    const value = match[0].trim();
    candidates.push({
      value,
      excerpts: [excerptOf(line, value, match.index)],
      rule: 'telephone',
    });
  }
  return candidates;
}

function extractTitle(lines: LocatedLine[]): FieldCandidate[] {
  const candidates = labelledValue(
    lines,
    /^\s*(titre|poste|intitul[ée])\s*:\s*(.+)$/iu,
    'titre-libelle',
  );

  const nameIndex = lines
    .slice(0, MAX_HEADER_LINES)
    .findIndex((line) => line.page === 1 && nameCandidate(line.text));
  if (nameIndex >= 0) {
    for (const line of lines.slice(nameIndex + 1, nameIndex + 4)) {
      const text = line.text.trim();
      if (!text) continue;
      if (
        looksLikeContact(text) ||
        isHeading(text) ||
        text.length > MAX_TITLE_LENGTH
      )
        break;
      candidates.push({
        value: text,
        excerpts: [excerptOf(line, text)],
        rule: 'titre-sous-le-nom',
      });
      break;
    }
  }
  return candidates;
}

function extractCity(lines: LocatedLine[]): FieldCandidate[] {
  const candidates = labelledValue(
    lines,
    /^\s*(ville|localisation)\s*:\s*(.+)$/iu,
    'ville-libelle',
  );

  const postal =
    /\b\d{5}\b[\s,;-]*(\p{L}[\p{L}’'-]*(?:[ -]\p{L}[\p{L}’'-]*){0,3})/iu;
  for (const line of lines) {
    const match = postal.exec(line.text);
    if (!match) continue;
    const value = match[1].trim();
    if (!value) continue;
    candidates.push({
      value,
      excerpts: [excerptOf(line, value, match.index)],
      rule: 'ville-code-postal',
    });
  }
  return candidates;
}

function extractContract(lines: LocatedLine[]): FieldCandidate[] {
  const candidates: FieldCandidate[] = [];
  for (const line of lines) {
    for (const contract of CONTRACTS) {
      if (candidates.some((candidate) => candidate.value === contract))
        continue;
      const pattern = new RegExp(`(?<!\\p{L})${contract}(?!\\p{L})`, 'iu');
      const match = pattern.exec(line.text);
      if (!match) continue;
      candidates.push({
        value: contract,
        excerpts: [excerptOf(line, match[0], match.index)],
        rule: 'contrat-mot-cle',
      });
    }
  }
  return candidates;
}

/** Lignes d'une section, jusqu'au titre suivant ou a la fin du bloc. */
function sectionBody(
  lines: LocatedLine[],
  headings: HeadingKind[],
): LocatedLine[] | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const label = headingLabel(lines[index].text);
    if (!label || !headings.includes(label)) continue;
    const body: LocatedLine[] = [];
    for (const line of lines.slice(index + 1, index + 1 + MAX_SECTION_LINES)) {
      if (isHeading(line.text)) break;
      if (line.text.trim()) body.push(line);
      else if (body.length) break;
    }
    if (body.length) return body;
  }
  return undefined;
}

function extractSkills(lines: LocatedLine[]): FieldCandidate[] {
  const labelled: FieldCandidate[] = [];
  const labelledPattern =
    /^\s*(comp[ée]tences?(?:\s+techniques?)?|skills?|technologies?|outils)\s*[:|-]\s*(.+)$/iu;
  for (const line of lines) {
    const match = labelledPattern.exec(line.text);
    if (!match) continue;
    const items = match[2]
      .split(/\s*[,;•·|]\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!items.length) continue;
    labelled.push({
      value: items.join(', '),
      excerpts: items.map((item) => excerptOf(line, item)),
      rule: 'competences-libelle',
    });
  }
  const body = sectionBody(lines, SKILL_HEADINGS);
  if (!body) return labelled;
  const items: string[] = [];
  const excerpts: SourceExcerpt[] = [];
  for (const line of body) {
    const cleaned = line.text.replace(BULLET, '').trim();
    if (!cleaned) continue;
    for (const part of cleaned.split(/\s*[,;•·|]\s*/)) {
      const item = part.trim();
      if (!item || items.includes(item)) continue;
      items.push(item);
      excerpts.push(excerptOf(line, item));
    }
  }
  if (!items.length) return [];
  return [
    ...labelled,
    { value: items.join(', '), excerpts, rule: 'section-competences' },
  ];
}

function extractAbout(lines: LocatedLine[]): FieldCandidate[] {
  const body = sectionBody(lines, ABOUT_HEADINGS);
  if (!body) return [];
  const excerpts = body.map((line) => excerptOf(line, line.text.trim()));
  const value = body.map((line) => line.text.trim()).join(' ');
  if (!value) return [];
  return [{ value, excerpts, rule: 'section-profil' }];
}

const EXTRACTORS: Record<
  ProfileField,
  (lines: LocatedLine[]) => FieldCandidate[]
> = {
  firstName: extractFirstName,
  lastName: extractLastName,
  email: extractEmail,
  phone: extractPhone,
  title: extractTitle,
  city: extractCity,
  contract: extractContract,
  skills: extractSkills,
  about: extractAbout,
};

const EMPTY_REASONS: Record<ProfileField, string> = {
  firstName: 'Aucun nom identifiable en tête de document.',
  lastName: 'Aucun nom de famille identifiable en tête de document.',
  email: 'Aucune adresse email repérée dans le document.',
  phone: 'Aucun numéro de téléphone repéré dans le document.',
  title: 'Aucun intitulé de poste repéré sous le nom ni après un libellé.',
  city: 'Aucune ville repérée après un code postal ni après un libellé.',
  contract: 'Aucun type de contrat connu cité dans le document.',
  skills: 'Aucune section de compétences repérée.',
  about: 'Aucune section de présentation repérée.',
};

/**
 * Propose des valeurs de profil à partir du texte du CV. Chaque proposition
 * cite ses extraits ; un champ sans preuve reste vide et explique pourquoi.
 */
export function extractProfileFields(pages: PageText[]): FieldExtraction[] {
  const lines = flatten(pages);
  return (Object.keys(EXTRACTORS) as ProfileField[]).map((field) => {
    const candidates = EXTRACTORS[field](lines).slice(0, MAX_CANDIDATES);
    return candidates.length
      ? { field, candidates }
      : { field, candidates, reason: EMPTY_REASONS[field] };
  });
}

function careerCandidates(
  lines: LocatedLine[],
  headings: HeadingKind[],
  rule: string,
): FieldCandidate[] {
  const body = sectionBody(lines, headings);
  if (!body) return [];
  const candidates: FieldCandidate[] = [];
  for (const line of body) {
    const value = line.text.replace(BULLET, '').trim();
    if (!value || value.length > 300 || looksLikeContact(value)) continue;
    if (candidates.some((candidate) => candidate.value === value)) continue;
    candidates.push({
      value,
      excerpts: [excerptOf(line, value)],
      rule,
    });
  }
  return candidates.slice(0, 20);
}

export function extractCareerFields(pages: PageText[]): {
  experienceCandidates: FieldCandidate[];
  educationCandidates: FieldCandidate[];
} {
  const lines = flatten(pages);
  return {
    experienceCandidates: careerCandidates(
      lines,
      EXPERIENCE_HEADINGS,
      'section-experiences',
    ),
    educationCandidates: careerCandidates(
      lines,
      EDUCATION_HEADINGS,
      'section-formations',
    ),
  };
}
