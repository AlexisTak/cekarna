import { BriefcaseBusiness, GraduationCap, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Education, Experience } from './domain';

function itemId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function emptyExperience(): Experience {
  return {
    id: itemId('experience'),
    role: '',
    employer: '',
    location: '',
    startDate: '',
    endDate: '',
    current: false,
    description: '',
  };
}

function emptyEducation(): Education {
  return {
    id: itemId('education'),
    degree: '',
    institution: '',
    startDate: '',
    endDate: '',
    description: '',
  };
}

function hasExperienceContent(item: Experience): boolean {
  return [item.role, item.employer, item.location, item.description].some(
    (value) => value.trim(),
  );
}

function hasEducationContent(item: Education): boolean {
  return [item.degree, item.institution, item.description].some((value) =>
    value.trim(),
  );
}

export function CareerHistory({
  experiences: initialExperiences,
  education: initialEducation,
  onSave,
}: {
  experiences: Experience[];
  education: Education[];
  onSave: (experiences: Experience[], education: Education[]) => void;
}) {
  const [experiences, setExperiences] = useState(initialExperiences);
  const [education, setEducation] = useState(initialEducation);
  const [error, setError] = useState('');

  function save(): void {
    const savedExperiences = experiences
      .filter(hasExperienceContent)
      .map((item) =>
        item.evidence?.value === item.role
          ? item
          : { ...item, evidence: undefined },
      );
    const savedEducation = education
      .filter(hasEducationContent)
      .map((item) =>
        item.evidence?.value === item.degree
          ? item
          : { ...item, evidence: undefined },
      );
    if (
      savedExperiences.some((item) => !item.role.trim()) ||
      savedEducation.some((item) => !item.degree.trim())
    ) {
      setError(
        'Ajoutez un intitulé à chaque expérience ou formation renseignée.',
      );
      return;
    }
    setError('');
    onSave(savedExperiences, savedEducation);
  }

  return (
    <section className="career-history">
      <div className="section-heading">
        <div>
          <h2>Mon parcours</h2>
          <p>
            Ajoutez les expériences et formations que vous souhaitez utiliser
            dans votre recherche.
          </p>
        </div>
      </div>
      <div className="career-heading">
        <h3>
          <BriefcaseBusiness size={18} /> Expériences
        </h3>
        <button
          className="button secondary"
          type="button"
          onClick={() => setExperiences([...experiences, emptyExperience()])}
        >
          <Plus size={16} /> Ajouter une expérience
        </button>
      </div>
      {!experiences.length && (
        <p className="muted">Aucune expérience ajoutée pour le moment.</p>
      )}
      {experiences.map((experience, index) => (
        <fieldset className="career-item" key={experience.id}>
          <legend>Expérience {index + 1}</legend>
          <button
            className="icon-button career-remove"
            type="button"
            aria-label={`Supprimer l’expérience ${index + 1}`}
            onClick={() =>
              setExperiences(
                experiences.filter((item) => item.id !== experience.id),
              )
            }
          >
            <Trash2 size={16} />
          </button>
          <div className="form-row">
            <label>
              Intitulé du poste
              <input
                value={experience.role}
                maxLength={160}
                onChange={(event) =>
                  setExperiences(
                    experiences.map((item) =>
                      item.id === experience.id
                        ? { ...item, role: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              Employeur
              <input
                value={experience.employer}
                maxLength={160}
                onChange={(event) =>
                  setExperiences(
                    experiences.map((item) =>
                      item.id === experience.id
                        ? { ...item, employer: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Début
              <input
                type="month"
                value={experience.startDate}
                onChange={(event) =>
                  setExperiences(
                    experiences.map((item) =>
                      item.id === experience.id
                        ? { ...item, startDate: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              Fin
              <input
                type="month"
                value={experience.endDate}
                disabled={experience.current}
                onChange={(event) =>
                  setExperiences(
                    experiences.map((item) =>
                      item.id === experience.id
                        ? { ...item, endDate: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={experience.current}
              onChange={(event) =>
                setExperiences(
                  experiences.map((item) =>
                    item.id === experience.id
                      ? {
                          ...item,
                          current: event.target.checked,
                          endDate: event.target.checked ? '' : item.endDate,
                        }
                      : item,
                  ),
                )
              }
            />
            J’occupe encore ce poste
          </label>
          <label>
            Missions ou réalisations
            <textarea
              value={experience.description}
              rows={3}
              maxLength={5000}
              onChange={(event) =>
                setExperiences(
                  experiences.map((item) =>
                    item.id === experience.id
                      ? { ...item, description: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          {experience.evidence && (
            <p className="field-hint">
              Importé du CV — page {experience.evidence.excerpts[0].page}, ligne{' '}
              {experience.evidence.excerpts[0].line}
            </p>
          )}
        </fieldset>
      ))}
      <div className="career-heading">
        <h3>
          <GraduationCap size={18} /> Formations
        </h3>
        <button
          className="button secondary"
          type="button"
          onClick={() => setEducation([...education, emptyEducation()])}
        >
          <Plus size={16} /> Ajouter une formation
        </button>
      </div>
      {!education.length && (
        <p className="muted">Aucune formation ajoutée pour le moment.</p>
      )}
      {education.map((item, index) => (
        <fieldset className="career-item" key={item.id}>
          <legend>Formation {index + 1}</legend>
          <button
            className="icon-button career-remove"
            type="button"
            aria-label={`Supprimer la formation ${index + 1}`}
            onClick={() =>
              setEducation(education.filter((entry) => entry.id !== item.id))
            }
          >
            <Trash2 size={16} />
          </button>
          <div className="form-row">
            <label>
              Diplôme ou formation
              <input
                value={item.degree}
                maxLength={160}
                onChange={(event) =>
                  setEducation(
                    education.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, degree: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
            </label>
            <label>
              Établissement
              <input
                value={item.institution}
                maxLength={160}
                onChange={(event) =>
                  setEducation(
                    education.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, institution: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Début
              <input
                type="month"
                value={item.startDate}
                onChange={(event) =>
                  setEducation(
                    education.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, startDate: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
            </label>
            <label>
              Fin
              <input
                type="month"
                value={item.endDate}
                onChange={(event) =>
                  setEducation(
                    education.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, endDate: event.target.value }
                        : entry,
                    ),
                  )
                }
              />
            </label>
          </div>
          <label>
            Informations complémentaires
            <textarea
              value={item.description}
              rows={3}
              maxLength={5000}
              onChange={(event) =>
                setEducation(
                  education.map((entry) =>
                    entry.id === item.id
                      ? { ...entry, description: event.target.value }
                      : entry,
                  ),
                )
              }
            />
          </label>
          {item.evidence && (
            <p className="field-hint">
              Importé du CV — page {item.evidence.excerpts[0].page}, ligne{' '}
              {item.evidence.excerpts[0].line}
            </p>
          )}
        </fieldset>
      ))}
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="button primary" type="button" onClick={save}>
          Enregistrer mon parcours
        </button>
      </div>
    </section>
  );
}
