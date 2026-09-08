import { useEffect, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import {
  CONTRACTS,
  safeUrl,
  type Education,
  type Experience,
  type Job,
  type Profile,
} from './domain';
import {
  recommendOffersWithLocalAi,
  type OfferRecommendations,
} from './local-ai-api';
import {
  publicOfferToJob,
  searchPublicOffers,
  type PublicOffer,
} from './offers-api';
export function OfferSearch({
  tracked,
  onAdd,
  profile,
  experiences,
  education,
  authenticated,
}: {
  tracked: Set<string>;
  onAdd: (job: Job) => void;
  profile: Profile;
  experiences: Experience[];
  education: Education[];
  authenticated: boolean;
}) {
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [contract, setContract] = useState('');
  const [offers, setOffers] = useState<PublicOffer[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recommendations, setRecommendations] =
    useState<OfferRecommendations | null>(null);
  const [recommendationError, setRecommendationError] = useState('');
  const [recommending, setRecommending] = useState(false);
  async function run(cursor?: string) {
    setBusy(true);
    setError('');
    try {
      const page = await searchPublicOffers({ q, location, contract, cursor });
      setOffers(cursor ? [...offers, ...page.offers] : page.offers);
      setNext(page.next_cursor);
    } catch {
      setError('La recherche d’offres est momentanément indisponible.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run();
  }, []);
  async function recommend() {
    setRecommending(true);
    setRecommendationError('');
    try {
      setRecommendations(
        await recommendOffersWithLocalAi(profile, experiences, education, {
          q,
          location: location || profile.city,
          contract: contract || profile.contract,
        }),
      );
    } catch (error) {
      setRecommendationError(
        error instanceof Error &&
          error.message === 'offer_recommendations_quota'
          ? 'La limite temporaire d’analyses est atteinte. Réessayez dans quelques minutes.'
          : 'Les recommandations sont indisponibles. Vérifiez les services d’offres, l’API et Hermes local.',
      );
    } finally {
      setRecommending(false);
    }
  }
  const profileReady = Boolean(
    profile.title.trim() ||
    profile.skills.trim() ||
    profile.about.trim() ||
    experiences.length ||
    education.length,
  );
  return (
    <section className="public-offers">
      <div>
        <h2>Rechercher des offres collectées</h2>
        <p>Les annonces gardent leur source et leur lien original.</p>
      </div>
      <section
        className="recommendation-panel"
        aria-labelledby="recommend-title"
      >
        <div>
          <Sparkles size={21} />
          <div>
            <h3 id="recommend-title">Offres adaptées à votre profil</h3>
            <p>
              Un préfiltre rapide examine les offres, puis Hermes compare un
              petit lot avec les informations professionnelles confirmées de
              votre profil.
            </p>
          </div>
        </div>
        <button
          className="button primary"
          type="button"
          disabled={recommending || !profileReady || !authenticated}
          onClick={() => void recommend()}
        >
          <Sparkles size={16} />
          {recommending ? 'Analyse en cours…' : 'Trouver mes offres'}
        </button>
        {!authenticated ? (
          <small>
            Connectez-vous pour utiliser Hermes avec votre dossier privé.
          </small>
        ) : !profileReady ? (
          <small>
            Complétez d’abord votre poste, vos compétences ou votre parcours.
          </small>
        ) : null}
      </section>
      {recommendationError && (
        <p role="alert" className="form-error">
          {recommendationError}
        </p>
      )}
      {recommendations && (
        <section className="recommendation-results" aria-live="polite">
          <div className="recommendation-summary">
            <strong>
              {recommendations.method === 'hermes'
                ? `Suggestions expliquées par ${recommendations.model}`
                : 'Suggestions textuelles à vérifier'}
            </strong>
            <span>
              {recommendations.inspected_offers} offres préfiltrées,{' '}
              {recommendations.analyzed_offers} analysées par Hermes
              {recommendations.cached ? ' · résultat réutilisé' : ''}
            </span>
          </div>
          {recommendations.recommendations.length ? (
            recommendations.recommendations.map((recommendation) => {
              const offer = recommendation.offer;
              return (
                <article
                  className="job-card recommendation-card"
                  key={offer.id}
                >
                  <div className="job-main">
                    <div className="recommendation-heading">
                      <span
                        className={`fit-badge ${recommendation.assessment}`}
                      >
                        {recommendation.assessment === 'high'
                          ? 'Correspondance forte'
                          : recommendation.assessment === 'medium'
                            ? 'Correspondance possible'
                            : 'À vérifier'}
                      </span>
                      <span>Source : {offer.source_id}</span>
                    </div>
                    <p className="company-name">
                      {offer.company || 'Entreprise non communiquée'}
                    </p>
                    <strong>{offer.title}</strong>
                    <div className="job-meta">
                      <span>{offer.location || 'Lieu non communiqué'}</span>
                      {offer.contract && <span>{offer.contract}</span>}
                      {offer.salary && <span>{offer.salary}</span>}
                    </div>
                    <ul className="recommendation-evidence">
                      {recommendation.evidence.map((evidence, index) => (
                        <li key={`${offer.id}-evidence-${index}`}>
                          <span>Votre profil : « {evidence.profile} »</span>
                          <span>L’offre : « {evidence.offer} »</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {safeUrl(offer.url ?? '') && (
                    <a
                      className="button secondary"
                      href={safeUrl(offer.url ?? '') || undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Voir l’annonce
                    </a>
                  )}
                  <button
                    className="button secondary"
                    disabled={tracked.has(`public:${offer.id}`)}
                    onClick={() => onAdd(publicOfferToJob(offer))}
                  >
                    {tracked.has(`public:${offer.id}`)
                      ? 'Déjà suivie'
                      : 'Ajouter à mon suivi'}
                  </button>
                </article>
              );
            })
          ) : (
            <p>
              Hermes n’a trouvé aucune correspondance accompagnée de preuves
              vérifiables dans ce lot.
            </p>
          )}
          <small>
            Ces suggestions ne sont ni une probabilité d’embauche ni une
            décision. Relisez toujours l’annonce complète.
          </small>
        </section>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="list-toolbar"
      >
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Métier ou mot-clé"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setRecommendations(null);
            }}
            placeholder="Métier ou mot-clé"
          />
        </div>
        <select
          aria-label="Type de contrat"
          value={contract}
          onChange={(event) => {
            setContract(event.target.value);
            setRecommendations(null);
          }}
        >
          <option value="">Tous les contrats</option>
          {CONTRACTS.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <div className="search-field">
          <input
            aria-label="Lieu de recherche"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setRecommendations(null);
            }}
            placeholder="Ville ou département"
          />
        </div>
        <button className="button primary" disabled={busy}>
          {busy ? 'Recherche…' : 'Rechercher'}
        </button>
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="public-offer-results">
        {offers.map((offer) => (
          <article className="job-card" key={offer.id}>
            <div className="job-main">
              <p className="company-name">
                {offer.company || 'Entreprise non communiquée'}
              </p>
              <strong>{offer.title}</strong>
              <div className="job-meta">
                <span>{offer.location || 'Lieu non communiqué'}</span>
                {offer.contract && <span>{offer.contract}</span>}
                <span>Source : {offer.source_id}</span>
                {offer.published_at && (
                  <span>
                    Publiée le{' '}
                    {new Intl.DateTimeFormat('fr-FR').format(
                      new Date(offer.published_at),
                    )}
                  </span>
                )}
                {offer.salary && <span>{offer.salary}</span>}
                {offer.work_duration && <span>{offer.work_duration}</span>}
                {offer.experience && <span>{offer.experience}</span>}
                {offer.qualification && <span>{offer.qualification}</span>}
                {offer.accessible_th && <span>Accessible TH</span>}
              </div>
              {!!offer.skills?.length && (
                <p className="job-skills">
                  {offer.skills.slice(0, 4).join(' · ')}
                  {offer.skills.length > 4 ? ' · …' : ''}
                </p>
              )}
            </div>
            {safeUrl(offer.url ?? '') && (
              <a
                className="button secondary"
                href={safeUrl(offer.url ?? '') || undefined}
                target="_blank"
                rel="noreferrer"
              >
                Voir l’annonce
              </a>
            )}
            <button
              className="button secondary"
              disabled={tracked.has(`public:${offer.id}`)}
              onClick={() => onAdd(publicOfferToJob(offer))}
            >
              {tracked.has(`public:${offer.id}`)
                ? 'Déjà suivie'
                : 'Ajouter à mon suivi'}
            </button>
          </article>
        ))}
      </div>
      {next && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void run(next)}
        >
          Afficher plus
        </button>
      )}
    </section>
  );
}
