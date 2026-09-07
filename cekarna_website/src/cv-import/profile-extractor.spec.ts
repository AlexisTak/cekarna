import { FieldExtraction, PageText, ProfileField } from './cv-import.types';
import { extractCareerFields, extractProfileFields } from './profile-extractor';

const CV: PageText[] = [
  {
    page: 1,
    lines: [
      'Marie Dupont',
      'Développeuse web',
      'marie.dupont@example.test',
      '+33 6 12 34 56 78',
      '12 rue des Lilas, 75011 Paris',
      'Recherche un CDI',
      'Compétences',
      'JavaScript, TypeScript',
      'Accessibilité web',
      'Profil',
      'Cinq ans de développement web en équipe produit.',
      'Expérience',
      'Studio Exemple — 2021 à 2026',
    ],
  },
];

function fieldOf(fields: FieldExtraction[], name: ProfileField) {
  const found = fields.find((field) => field.field === name);
  if (!found) throw new Error(`Champ absent : ${name}`);
  return found;
}

describe('extraction du profil', () => {
  const fields = extractProfileFields(CV);

  it('propose le prénom lu en tête de document', () => {
    expect(fieldOf(fields, 'firstName').candidates[0]).toMatchObject({
      value: 'Marie',
      rule: 'nom-en-tete',
    });
  });

  it('propose le nom et les coordonnées trouvés dans le document', () => {
    expect(fieldOf(fields, 'lastName').candidates[0].value).toBe('Dupont');
    expect(fieldOf(fields, 'email').candidates[0].value).toBe(
      'marie.dupont@example.test',
    );
    expect(fieldOf(fields, 'phone').candidates[0].value).toBe(
      '+33 6 12 34 56 78',
    );
  });

  it('propose le titre situé sous le nom', () => {
    expect(fieldOf(fields, 'title').candidates[0].value).toBe(
      'Développeuse web',
    );
  });

  it('propose la ville qui suit le code postal', () => {
    expect(fieldOf(fields, 'city').candidates[0]).toMatchObject({
      value: 'Paris',
      rule: 'ville-code-postal',
    });
  });

  it('ne retient qu’un contrat effectivement cité', () => {
    const contract = fieldOf(fields, 'contract');
    expect(contract.candidates.map((candidate) => candidate.value)).toEqual([
      'CDI',
    ]);
  });

  it('assemble les compétences de la section correspondante', () => {
    expect(fieldOf(fields, 'skills').candidates[0].value).toBe(
      'JavaScript, TypeScript, Accessibilité web',
    );
  });

  it('lit aussi une liste de compétences placée sur la ligne du titre', () => {
    const inline = extractProfileFields([
      {
        page: 1,
        lines: ['Compétences techniques : Rust; PostgreSQL | Docker'],
      },
    ]);
    expect(fieldOf(inline, 'skills').candidates[0]).toMatchObject({
      value: 'Rust, PostgreSQL, Docker',
      rule: 'competences-libelle',
    });
  });

  it('reconnaît les variantes courantes des titres de compétences', () => {
    for (const heading of [
      'MES COMPÉTENCES',
      '— COMPÉTENCES CLÉS —',
      'DOMAINES DE COMPÉTENCES',
    ]) {
      const fields = extractProfileFields([
        { page: 1, lines: [heading, 'Rust • PostgreSQL • Docker', 'Langues'] },
      ]);
      expect(fieldOf(fields, 'skills').candidates[0]).toMatchObject({
        value: 'Rust, PostgreSQL, Docker',
        rule: 'section-competences',
      });
    }
  });

  it('reconnaît une ville en capitales après un code postal', () => {
    const uppercase = extractProfileFields([
      { page: 1, lines: ['31000 TOULOUSE'] },
    ]);
    expect(fieldOf(uppercase, 'city').candidates[0].value).toBe('TOULOUSE');
  });

  it('reprend la présentation sans la reformuler', () => {
    expect(fieldOf(fields, 'about').candidates[0].value).toBe(
      'Cinq ans de développement web en équipe produit.',
    );
  });

  it('cite pour chaque valeur un extrait littéral du document', () => {
    for (const field of fields)
      for (const candidate of field.candidates)
        for (const excerpt of candidate.excerpts) {
          const line = CV[excerpt.page - 1].lines[excerpt.line - 1];
          expect(excerpt.text).toBe(line);
          expect(candidate.value.toLowerCase()).toContain(
            line.slice(excerpt.start, excerpt.end).toLowerCase(),
          );
        }
  });

  it('laisse un champ vide et explique pourquoi quand rien ne le justifie', () => {
    const empty = extractProfileFields([
      { page: 1, lines: ['Document sans structure exploitable'] },
    ]);
    const skills = fieldOf(empty, 'skills');
    expect(skills.candidates).toEqual([]);
    expect(skills.reason).toBe('Aucune section de compétences repérée.');
  });

  it('ne propose aucun contrat quand le CV n’en cite aucun', () => {
    const empty = extractProfileFields([
      { page: 1, lines: ['Marie Dupont', 'Développeuse web'] },
    ]);
    expect(fieldOf(empty, 'contract').candidates).toEqual([]);
  });

  it('propose les lignes des sections expériences et formations sans les réécrire', () => {
    const career = extractCareerFields([
      {
        page: 1,
        lines: [
          'Expériences',
          'Développeuse web — Studio Exemple — 2022 à 2025',
          'Formations',
          'Master informatique — Université Exemple — 2022',
        ],
      },
    ]);
    expect(career.experienceCandidates[0].value).toBe(
      'Développeuse web — Studio Exemple — 2022 à 2025',
    );
    expect(career.educationCandidates[0]).toMatchObject({
      value: 'Master informatique — Université Exemple — 2022',
      excerpts: [expect.objectContaining({ page: 1, line: 4 })],
    });
  });

  it('reconnaît un parcours professionnel comme section d’expérience', () => {
    const career = extractCareerFields([
      {
        page: 1,
        lines: [
          'PARCOURS PROFESSIONNEL',
          'Développeuse — Atelier Exemple — 2023 à 2026',
          'FORMATIONS ET DIPLÔMES',
          'Licence informatique — Université Exemple — 2023',
        ],
      },
    ]);
    expect(career.experienceCandidates[0].value).toBe(
      'Développeuse — Atelier Exemple — 2023 à 2026',
    );
    expect(career.educationCandidates[0].value).toBe(
      'Licence informatique — Université Exemple — 2023',
    );
  });
});
