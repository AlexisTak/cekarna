import type { Profile } from './domain';
import type { ProfileSources } from './profile-sources';

const labels: Record<keyof Profile, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  email: 'Email de contact',
  phone: 'Téléphone',
  title: 'Poste recherché',
  city: 'Ville',
  contract: 'Contrat souhaité',
  skills: 'Compétences',
  about: 'Parcours',
};

export function ProfileEvidence({
  profile,
  sources,
}: {
  profile: Profile;
  sources?: ProfileSources;
}) {
  return (
    <details className="panel">
      <summary>Origine des informations du profil</summary>
      <p>
        Les extraits retenus sont conservés avec votre profil, y compris dans
        les exports. L’origine des anciens profils peut être inconnue.
      </p>
      {Object.entries(labels).map(([key, label]) => {
        const field = key as keyof Profile;
        const evidence = sources?.[field];
        const current =
          evidence?.value === profile[field] ? evidence : undefined;
        return (
          <section key={field}>
            <h3>{label}</h3>
            <p>
              {!profile[field]
                ? 'Non renseigné'
                : current?.source === 'extracted'
                  ? 'Extrait du CV confirmé'
                  : current?.source === 'manual'
                    ? 'Saisie manuelle'
                    : 'Origine non conservée'}
            </p>
            {current?.source === 'extracted' &&
              current.excerpts.map((excerpt, index) => (
                <blockquote key={index}>
                  <p>
                    {excerpt.text.slice(0, excerpt.start)}
                    <mark>
                      {excerpt.text.slice(excerpt.start, excerpt.end)}
                    </mark>
                    {excerpt.text.slice(excerpt.end)}
                  </p>
                  <small>
                    Page {excerpt.page}, ligne {excerpt.line}
                  </small>
                </blockquote>
              ))}
          </section>
        );
      })}
    </details>
  );
}
