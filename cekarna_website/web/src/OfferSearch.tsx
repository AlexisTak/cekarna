import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { CONTRACTS, safeUrl, type Job } from './domain';
import {
  publicOfferToJob,
  searchPublicOffers,
  type PublicOffer,
} from './offers-api';
export function OfferSearch({
  tracked,
  onAdd,
}: {
  tracked: Set<string>;
  onAdd: (job: Job) => void;
}) {
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [contract, setContract] = useState('');
  const [offers, setOffers] = useState<PublicOffer[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  return (
    <section className="public-offers">
      <div>
        <h2>Rechercher des offres collectées</h2>
        <p>Les annonces gardent leur source et leur lien original.</p>
      </div>
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
            onChange={(e) => setQ(e.target.value)}
            placeholder="Métier ou mot-clé"
          />
        </div>
        <select
          aria-label="Type de contrat"
          value={contract}
          onChange={(event) => setContract(event.target.value)}
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
            onChange={(e) => setLocation(e.target.value)}
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
