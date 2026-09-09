import { useEffect, useState } from 'react';
import type { Education, Experience, Job, Profile } from './domain';
import {
  generateApplicationDraftWithLocalAi,
  type AiApplicationDraft,
} from './local-ai-api';

export interface ApplicationDraftValue {
  subject: string;
  body: string;
}

export function buildApplicationDraft(
  profile: Profile,
  job: Job,
): ApplicationDraftValue {
  const role = job.title.trim() || '[intitulé du poste à compléter]';
  const company = job.company.trim() || '[entreprise à compléter]';
  const identity = [profile.firstName.trim(), profile.lastName.trim()]
    .filter(Boolean)
    .join(' ');
  const lines = [
    'Bonjour,',
    '',
    `Je vous adresse ma candidature au poste de ${role} chez ${company}.`,
    profile.title.trim()
      ? `Mon profil professionnel confirmé : ${profile.title.trim()}.`
      : '[Ajoutez votre titre professionnel.]',
    profile.skills.trim()
      ? `Compétences confirmées dans mon profil : ${profile.skills.trim()}.`
      : '[Ajoutez les compétences pertinentes que vous souhaitez présenter.]',
    '',
    'Je reste disponible pour échanger au sujet de cette candidature.',
    '',
    'Cordialement,',
    identity || '[Ajoutez votre nom.]',
  ];
  return { subject: `Candidature — ${role}`, body: lines.join('\n') };
}

export function ApplicationDraft({
  profile,
  job,
  experiences,
  education,
  authenticated,
}: {
  profile: Profile;
  job: Job;
  experiences: Experience[];
  education: Education[];
  authenticated: boolean;
}) {
  const [draft, setDraft] = useState<ApplicationDraftValue | null>(null);
  const [aiMeta, setAiMeta] = useState<AiApplicationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(null);
    setAiMeta(null);
    setError('');
  }, [job.id, job.updatedAt]);

  async function generateWithHermes() {
    setBusy(true);
    setError('');
    try {
      const generated = await generateApplicationDraftWithLocalAi(
        profile,
        experiences,
        education,
        job,
      );
      setAiMeta(generated);
      const identity = [profile.firstName.trim(), profile.lastName.trim()]
        .filter(Boolean)
        .join(' ');
      setDraft({
        subject: generated.subject,
        body: generated.body.replace(
          '[Ajoutez votre nom.]',
          identity || '[Ajoutez votre nom.]',
        ),
      });
    } catch (reason) {
      setError(
        reason instanceof Error &&
          reason.message === 'application_draft_session'
          ? 'Votre session a expiré. Reconnectez-vous avant de relancer Hermes.'
          : 'Hermes est indisponible. Vous pouvez préparer le brouillon local.',
      );
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([`${draft.subject}\n\n${draft.body}`], {
        type: 'text/plain;charset=utf-8',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `candidature-${job.id}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="criteria-box application-draft">
      <h3>Brouillon de candidature</h3>
      <p>
        Créé uniquement avec les informations confirmées de votre profil.
        Relisez et complétez les passages entre crochets.
      </p>
      {!draft ? (
        <div className="form-actions">
          <button
            className="button primary"
            type="button"
            disabled={!authenticated || busy}
            onClick={() => void generateWithHermes()}
          >
            {busy ? 'Hermes prépare le brouillon…' : 'Générer avec Hermes'}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setAiMeta(null);
              setDraft(buildApplicationDraft(profile, job));
            }}
          >
            Préparer sans IA
          </button>
        </div>
      ) : (
        <>
          <label>
            Objet
            <input
              value={draft.subject}
              onChange={(event) =>
                setDraft({ ...draft, subject: event.target.value })
              }
            />
          </label>
          <label>
            Message
            <textarea
              rows={12}
              value={draft.body}
              onChange={(event) =>
                setDraft({ ...draft, body: event.target.value })
              }
            />
          </label>
          <div className="form-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => setDraft(buildApplicationDraft(profile, job))}
            >
              Repartir des informations confirmées
            </button>
            <button className="button primary" type="button" onClick={download}>
              Exporter en .txt
            </button>
          </div>
          <small>
            Cekarna n’envoie jamais ce brouillon. L’export reste une action
            explicite.
          </small>
          {aiMeta && (
            <small>
              {aiMeta.method === 'hermes_evidence'
                ? `Hermes ${aiMeta.model} a sélectionné ${aiMeta.evidence.length} rapprochement(s) vérifié(s).`
                : 'Brouillon de repli construit avec des rapprochements textuels vérifiés.'}
            </small>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
