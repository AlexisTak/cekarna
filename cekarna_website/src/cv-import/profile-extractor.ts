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

const HEADING_WORDS = [
  'competence',
  'competences',
  'skill',
  'skills',
  'savoir-faire',
  'experience',
  'experiences',
  'parcours',
  'formation',
  'formations',
  'education',
  'diplome',
  'diplomes',
  'langue',
  'langues',
  'projet',
  'projets',
  'certification',
  'certifications',
  'interet',
  'interets',
  'loisir',
  'loisirs',
  'reference',
  'references',
  'contact',
  'profil',
  'a propos',
  'resume',
  'objectif',
  'presentation',
];

const ABOUT_HEADINGS = [
  'profil',
  'a propos',
  'resume',
  'objectif',
  'presentation',
];

const SKILL_HEADINGS = [
  'competence',
  'competences',
  'skill',
  'skills',
  'savoir-faire',
];

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

function headingLabel(text: string): string | undefined {
  const folded = fold(text).replace(/:\s*$/, '');
  if (!folded || folded.length > 40) return undefined;
  return HEADING_WORDS.find(
    (word) => folded === word || folded.startsWith(`${word} `),
  );
}

function isHeading(text: string): boolean {
  return headingLabel(text) !== undefined;
}

function looksLikeContact(text: string): boolean {
  return /@|https?:\/\/|\+\d|\d{2}[\s.]?\d{2}[\s.]?\d{2}/.test(text);
}

/** Ligne de nom : uniquement des mots commencant par une majuscule, sans chiffre. */
function nameCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 60) return undefined;
  if (looksLikeContact(trimmed) || /\d/.test(trimmed)) return undefined;
  if (isHeading(trimmed)) return undefined;
  const words = trimmed.split(/\s+/);
  if (words.length < 1 || words.length > 4) return undefined;
  const shape = /^\p{Lu}[\p{L}’'-]*$/u;
  if (!words.every((word) => shape.test(word))) return undefined;
  return words[0];
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
    /^\s*(ville|localisation|adresse)\s*:\s*(.+)$/iu,
    'ville-libelle',
  );

  const postal =
    /\b\d{5}\b[\s,-]*(\p{Lu}[\p{L}’'-]*(?:[\s-]\p{L}[\p{L}’'-]*)*)/u;
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
  headings: string[],
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
  const body = sectionBody(lines, SKILL_HEADINGS);
  if (!body) return [];
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
  return [{ value: items.join(', '), excerpts, rule: 'section-competences' }];
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
  title: extractTitle,
  city: extractCity,
  contract: extractContract,
  skills: extractSkills,
  about: extractAbout,
};

const EMPTY_REASONS: Record<ProfileField, string> = {
  firstName: 'Aucun nom identifiable en tête de document.',
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
