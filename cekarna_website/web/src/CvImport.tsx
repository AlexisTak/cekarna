import { confirmedSources, type ProfileSources } from './profile-sources';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CONTRACTS, type Profile } from './domain';
import {
  CvImportError,
  PROFILE_FIELDS,
  confirmProfile,
  describeFileProblem,
  extractCv,
  type ConfirmedField,
  type CvExtraction,
  type FieldCandidate,
  type FieldExtraction,
  type ProfileField,
  type SourceExcerpt,
} from './cv-import-api';

const LABELS: Record<ProfileField, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  email: 'Email de contact',
  phone: 'Téléphone',
  title: 'Poste recherché',
  city: 'Ville',
  contract: 'Contrat souhaité',
  skills: 'Compétences',
  about: 'Votre parcours',
};

type Mode = 'candidate' | 'manual' | 'empty';

interface FieldChoice {
  mode: Mode;
  candidate: number;
  manual: string;
}

type Choices = Record<ProfileField, FieldChoice>;

/**
 * État initial de la relecture : une proposition sourcée est présélectionnée
 * quand elle existe, sinon la valeur déjà saisie dans le profil est conservée
 * en saisie manuelle. Rien n'est ajouté à ce que le CV ou la personne ont dit.
 */
function initialChoices(fields: FieldExtraction[], current: Profile): Choices {
  const choices = {} as Choices;
  for (const field of PROFILE_FIELDS) {
    const extraction = fields.find((entry) => entry.field === field);
    const existing = current[field].trim();
    choices[field] = {
      mode: extraction?.candidates.length
        ? 'candidate'
        : existing
          ? 'manual'
          : 'empty',
      candidate: 0,
      manual: existing,
    };
  }
  return choices;
}

function valueOf(
  choice: FieldChoice,
  extraction: FieldExtraction | undefined,
): ConfirmedField | undefined {
  if (choice.mode === 'manual') {
    const value = choice.manual.trim();
    return value ? { value, source: 'manual' } : undefined;
  }
  if (choice.mode !== 'candidate') return undefined;
  const candidate = extraction?.candidates[choice.candidate];
  return candidate
    ? { value: candidate.value, source: 'extracted' }
    : undefined;
}

/** Affiche la ligne source en mettant en évidence le fragment retenu. */
function Excerpt({ excerpt }: { excerpt: SourceExcerpt }) {
  return (
    <li>
      <span className="excerpt-origin">
        page {excerpt.page}, ligne {excerpt.line}
      </span>
      <q className="excerpt-line">
        {excerpt.text.slice(0, excerpt.start)}
        <mark>{excerpt.text.slice(excerpt.start, excerpt.end)}</mark>
        {excerpt.text.slice(excerpt.end)}
      </q>
    </li>
  );
}

function CandidateOption({
  field,
  index,
  candidate,
  checked,
  onSelect,
}: {
  field: ProfileField;
  index: number;
  candidate: FieldCandidate;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <li className={checked ? 'cv-option selected' : 'cv-option'}>
      <label>
        <input
          type="radio"
          name={`cv-${field}`}
          checked={checked}
          onChange={onSelect}
        />
        <span className="cv-option-value">{candidate.value}</span>
      </label>
      <details>
        <summary>
          {candidate.excerpts.length > 1
            ? `${candidate.excerpts.length} extraits du CV`
            : 'Extrait du CV'}
        </summary>
        <ul className="excerpt-list">
          {candidate.excerpts.map((excerpt, position) => (
            <Excerpt key={`${index}-${position}`} excerpt={excerpt} />
          ))}
        </ul>
      </details>
    </li>
  );
}

function FieldReview({
  field,
  extraction,
  choice,
  onChange,
}: {
  field: ProfileField;
  extraction: FieldExtraction | undefined;
  choice: FieldChoice;
  onChange: (next: FieldChoice) => void;
}) {
  const candidates = extraction?.candidates ?? [];
  const manualId = `cv-manual-${field}`;
  return (
    <fieldset className="cv-field">
      <legend>{LABELS[field]}</legend>
      {candidates.length ? (
        <ul className="cv-options">
          {candidates.map((candidate, index) => (
            <CandidateOption
              key={`${candidate.rule}-${index}`}
              field={field}
              index={index}
              candidate={candidate}
              checked={
                choice.mode === 'candidate' && choice.candidate === index
              }
              onSelect={() =>
                onChange({ ...choice, mode: 'candidate', candidate: index })
              }
            />
          ))}
        </ul>
      ) : (
        <p className="cv-nothing">
          {extraction?.reason ?? 'Rien à proposer pour ce champ.'} Saisissez la
          valeur vous-même si vous le souhaitez.
        </p>
      )}
      <div className="cv-fallbacks">
        <label className="cv-radio">
          <input
            type="radio"
            name={`cv-${field}`}
            checked={choice.mode === 'manual'}
            onChange={() => onChange({ ...choice, mode: 'manual' })}
          />
          Je saisis moi-même
        </label>
        <label className="cv-radio">
          <input
            type="radio"
            name={`cv-${field}`}
            checked={choice.mode === 'empty'}
            onChange={() => onChange({ ...choice, mode: 'empty' })}
          />
          Laisser vide
        </label>
      </div>
      {choice.mode === 'manual' &&
        (field === 'contract' ? (
          <select
            id={manualId}
            aria-label={`${LABELS[field]} — saisie manuelle`}
            value={choice.manual}
            onChange={(event) =>
              onChange({ ...choice, manual: event.target.value })
            }
          >
            <option value="">Tous les contrats</option>
            {CONTRACTS.map((contract) => (
              <option key={contract}>{contract}</option>
            ))}
          </select>
        ) : field === 'about' ? (
          <textarea
            id={manualId}
            aria-label={`${LABELS[field]} — saisie manuelle`}
            rows={4}
            maxLength={2000}
            value={choice.manual}
            onChange={(event) =>
              onChange({ ...choice, manual: event.target.value })
            }
          />
        ) : (
          <input
            id={manualId}
            aria-label={`${LABELS[field]} — saisie manuelle`}
            maxLength={1000}
            value={choice.manual}
            onChange={(event) =>
              onChange({ ...choice, manual: event.target.value })
            }
          />
        ))}
    </fieldset>
  );
}

function CareerCandidates({
  title,
  candidates,
  selected,
  onChange,
}: {
  title: string;
  candidates: FieldCandidate[];
  selected: number[];
  onChange: (indexes: number[]) => void;
}) {
  if (!candidates.length) return null;
  return (
    <fieldset className="cv-field">
      <legend>{title}</legend>
      <p className="cv-nothing">
        Sélectionnez uniquement les lignes que vous souhaitez ajouter à votre
        parcours. Vous pourrez ensuite les corriger dans « Mon profil ».
      </p>
      <ul className="cv-options">
        {candidates.map((candidate, index) => (
          <li className="cv-option" key={`${candidate.rule}-${index}`}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(index)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, index]
                      : selected.filter((entry) => entry !== index),
                  )
                }
              />
              <span className="cv-option-value">{candidate.value}</span>
            </label>
            <ul className="excerpt-list">
              {candidate.excerpts.map((excerpt, position) => (
                <Excerpt key={position} excerpt={excerpt} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export default function CvImport({
  current,
  onApply,
  onCancel,
}: {
  current: Profile;
  onApply: (
    profile: Profile,
    sources: ProfileSources,
    experiences: FieldCandidate[],
    education: FieldCandidate[],
  ) => void;
  onCancel: () => void;
}) {
  const [extraction, setExtraction] = useState<CvExtraction | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedExperiences, setSelectedExperiences] = useState<number[]>([]);
  const [selectedEducation, setSelectedEducation] = useState<number[]>([]);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // L'écran remplace le formulaire de profil : ramener la vue et le focus en
  // haut pour annoncer le changement de contexte.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, []);

  async function onFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = describeFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await extractCv(file);
      setExtraction(result);
      setChoices(initialChoices(result.fields, current));
      setSelectedExperiences(
        (result.experienceCandidates ?? []).map((_, index) => index),
      );
      setSelectedEducation(
        (result.educationCandidates ?? []).map((_, index) => index),
      );
    } catch (failure) {
      setError(
        failure instanceof CvImportError
          ? failure.message
          : 'Le service d’import est injoignable.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(): Promise<void> {
    if (!extraction || !choices) return;
    const fields: Partial<Record<ProfileField, ConfirmedField>> = {};
    for (const field of PROFILE_FIELDS) {
      const value = valueOf(
        choices[field],
        extraction.fields.find((entry) => entry.field === field),
      );
      if (value) fields[field] = value;
    }
    setBusy(true);
    setError('');
    try {
      const confirmed = await confirmProfile(extraction.documentId, fields, {
        experiences: selectedExperiences,
        education: selectedEducation,
      });
      onApply(
        confirmed.profile,
        confirmedSources(confirmed),
        confirmed.experiences ?? [],
        confirmed.education ?? [],
      );
    } catch (failure) {
      setError(
        failure instanceof CvImportError
          ? failure.message
          : 'La validation a échoué. Réessayez.',
      );
      setBusy(false);
    }
  }

  return (
    <section className="panel cv-import">
      <div className="section-heading">
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            Importer mon CV
          </h2>
          <p>
            Nous lisons le texte du PDF et vous montrons d’où vient chaque
            proposition. Rien n’est ajouté à ce que votre CV contient, et rien
            n’est enregistré tant que vous n’avez pas validé.
          </p>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {!extraction || !choices ? (
        <div className="cv-dropzone">
          <p className="muted">
            PDF texte uniquement, 5 Mo maximum. Un CV scanné en image ne peut
            pas être lu : aucune valeur ne sera devinée.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Choisir un CV au format PDF"
            onChange={(event) => void onFile(event)}
            disabled={busy}
          />
          <div className="form-actions">
            <button
              className="button secondary"
              type="button"
              onClick={onCancel}
            >
              Annuler
            </button>
          </div>
          {busy && <p aria-live="polite">Lecture du CV en cours…</p>}
        </div>
      ) : (
        <>
          <p className="cv-summary" aria-live="polite">
            {extraction.pageCount} page{extraction.pageCount > 1 ? 's' : ''} lue
            {extraction.pageCount > 1 ? 's' : ''}. Vérifiez chaque proposition
            avant d’enregistrer.
          </p>
          <div className="cv-fields">
            {PROFILE_FIELDS.map((field) => (
              <FieldReview
                key={field}
                field={field}
                extraction={extraction.fields.find(
                  (entry) => entry.field === field,
                )}
                choice={choices[field]}
                onChange={(next) =>
                  setChoices((previous) =>
                    previous ? { ...previous, [field]: next } : previous,
                  )
                }
              />
            ))}
          </div>
          <CareerCandidates
            title="Expériences repérées"
            candidates={extraction.experienceCandidates ?? []}
            selected={selectedExperiences}
            onChange={setSelectedExperiences}
          />
          <CareerCandidates
            title="Diplômes et formations repérés"
            candidates={extraction.educationCandidates ?? []}
            selected={selectedEducation}
            onChange={setSelectedEducation}
          />
          <details className="cv-source">
            <summary>Voir le texte lu dans le PDF</summary>
            {extraction.pages.map((page) => (
              <div key={page.page}>
                <h3>Page {page.page}</h3>
                <ol className="cv-source-lines">
                  {page.lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
              </div>
            ))}
          </details>
          <div className="form-actions">
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? 'Validation…' : 'Enregistrer ce profil'}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={onCancel}
            >
              Annuler
            </button>
          </div>
        </>
      )}
    </section>
  );
}
