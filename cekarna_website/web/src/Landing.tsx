import { useEffect } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Compass,
  FileText,
  LayoutDashboard,
  LockKeyhole,
  MapPin,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Gardez les offres utiles',
    description:
      'Une opportunité repérée dans un email, sur un site ou par votre réseau reste accessible au même endroit.',
  },
  {
    number: '02',
    title: 'Préparez chaque démarche',
    description:
      'Ajoutez vos repères, une note ou un lien. Vous retrouvez le contexte au bon moment.',
  },
  {
    number: '03',
    title: 'Suivez la suite',
    description:
      'Visualisez les candidatures à préparer, envoyées ou en attente d’un entretien.',
  },
] as const;

const features = [
  {
    icon: Search,
    title: 'Vos offres, retrouvées',
    description:
      'Recherchez un poste, une entreprise ou une ville sans fouiller vos onglets et vos messages.',
  },
  {
    icon: Send,
    title: 'Un suivi lisible',
    description:
      'Un statut simple suffit pour savoir quelle démarche mérite votre attention.',
  },
  {
    icon: FileText,
    title: 'Vos notes avec vous',
    description:
      'Gardez une relance, une préparation d’entretien ou une idée à reprendre plus tard.',
  },
] as const;

export default function Landing() {
  useEffect(() => {
    document.title = 'Cekarna — Votre recherche d’emploi, à votre rythme';
  }, []);

  return (
    <div className="landing-page">
      <a className="skip-link" href="#landing-main">
        Aller au contenu
      </a>
      <header className="landing-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
        <nav aria-label="Navigation de la page d’accueil">
          <a href="#fonctionnement">Comment ça marche</a>
          <a href="#donnees">Vos données</a>
        </nav>
        <a className="landing-login" href="/connexion">
          Se connecter <ArrowUpRight size={15} />
        </a>
      </header>

      <main id="landing-main">
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="landing-kicker">
              <span /> POUR LES PERSONNES EN RECHERCHE D’EMPLOI
            </p>
            <h1>
              Chercher un emploi,
              <br /> sans perdre le fil.
            </h1>
            <p className="hero-lead">
              Cekarna réunit vos offres, vos candidatures et vos notes dans un
              espace calme pour avancer, une étape après l’autre.
            </p>
            <div className="hero-actions">
              <a className="landing-button primary" href="/inscription">
                Créer mon compte <ArrowRight size={17} />
              </a>
              <a className="landing-button quiet" href="#fonctionnement">
                Voir comment ça marche
              </a>
            </div>
            <p className="hero-note">
              <LockKeyhole size={14} /> Aujourd’hui, vos données restent dans
              votre navigateur.
            </p>
          </div>

          <div
            className="hero-product"
            aria-label="Aperçu de l’espace candidat"
          >
            <div className="product-topbar">
              <span className="product-mini-brand">cekarna.</span>
              <span className="product-status">
                <i /> Sur cet appareil
              </span>
              <span className="product-avatar">M</span>
            </div>
            <div className="product-body">
              <aside className="product-side">
                <span className="product-side-title">MON ESPACE</span>
                <span className="product-nav active">
                  <LayoutDashboard size={14} /> Tableau de bord
                </span>
                <span className="product-nav">
                  <Search size={14} /> Mes offres
                </span>
                <span className="product-nav">
                  <Send size={14} /> Mes candidatures
                </span>
              </aside>
              <div className="product-workspace">
                <p className="product-breadcrumb">
                  MON ESPACE / TABLEAU DE BORD
                </p>
                <h2>Bonjour Camille</h2>
                <p className="product-subtitle">
                  Voici ce qui mérite votre attention.
                </p>
                <div className="product-stats">
                  <span>
                    <strong>02</strong> Offres à préparer
                  </span>
                  <span>
                    <strong>01</strong> Entretien en cours
                  </span>
                </div>
                <article className="product-job">
                  <span className="product-company">A</span>
                  <div>
                    <small>ATELIER STUDIO</small>
                    <strong>Product Designer</strong>
                    <p>
                      <MapPin size={11} /> Paris · CDI · Télétravail
                    </p>
                  </div>
                  <span className="product-tag">À préparer</span>
                </article>
              </div>
            </div>
            <div className="product-float float-one">
              <CheckCircle2 size={17} /> Une piste gardée
            </div>
            <div className="product-float float-two">
              <Sparkles size={16} /> Une étape à la fois
            </div>
          </div>
        </section>

        <section className="landing-proof" aria-label="Principes de l’espace">
          <p>
            <Check size={16} /> Une seule vue pour vos démarches
          </p>
          <p>
            <Check size={16} /> Aucun envoi automatique
          </p>
          <p>
            <Check size={16} /> Export de vos données disponible
          </p>
        </section>

        <section className="landing-section steps-section" id="fonctionnement">
          <div className="section-intro">
            <p className="landing-kicker">LE POINT DE DÉPART</p>
            <h2>Retrouver de la place pour la recherche qui compte.</h2>
            <p>
              Quand les opportunités s’accumulent, l’essentiel est de savoir
              quoi faire maintenant — pas de tout optimiser d’un coup.
            </p>
          </div>
          <div className="steps-list">
            {steps.map((step) => (
              <article className="landing-step" key={step.number}>
                <span>{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
                <ArrowRight size={19} />
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section features-section">
          <div className="section-intro compact">
            <p className="landing-kicker">DANS L’ESPACE CANDIDAT</p>
            <h2>Ce que vous pouvez faire dès maintenant.</h2>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-icon">
                  <feature.icon size={21} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="data-section" id="donnees">
          <div>
            <p className="landing-kicker">VOTRE ESPACE, VOS REPÈRES</p>
            <h2>Commencez simplement, sur votre appareil.</h2>
            <p>
              Cette première version conserve votre profil, vos offres et vos
              notes dans le navigateur que vous utilisez. Vous pouvez exporter
              une sauvegarde quand vous le souhaitez.
            </p>
            <a
              className="landing-button dark"
              href="/?workspace=candidate#profile"
            >
              Découvrir mon espace <ArrowRight size={17} />
            </a>
          </div>
          <div className="data-checklist">
            <p>
              <span>
                <Check size={16} />
              </span>
              Pas de compte à créer pour commencer
            </p>
            <p>
              <span>
                <Check size={16} />
              </span>
              Sauvegarde et restauration JSON
            </p>
            <p>
              <span>
                <Check size={16} />
              </span>
              Vous choisissez chaque candidature
            </p>
          </div>
        </section>

        <section className="landing-faq" aria-labelledby="faq-title">
          <div className="section-intro compact">
            <p className="landing-kicker">QUESTIONS SIMPLES</p>
            <h2 id="faq-title">Avant de commencer</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>
                Est-ce que Cekarna envoie des candidatures à ma place ?
                <ChevronDown size={18} />
              </summary>
              <p>
                Non. Vous gardez la main sur chaque démarche. L’espace vous aide
                à organiser et suivre votre recherche, sans envoyer de
                candidature.
              </p>
            </details>
            <details>
              <summary>
                Est-ce que je peux importer mon CV ?<ChevronDown size={18} />
              </summary>
              <p>
                Pas encore. La première version commence avec un profil saisi
                manuellement afin de rendre le parcours utile tout de suite.
              </p>
            </details>
            <details>
              <summary>
                Est-ce que mes données sont synchronisées ?
                <ChevronDown size={18} />
              </summary>
              <p>
                Pas dans cette version. Vos données sont conservées dans ce
                navigateur ; l’export permet de garder une copie de votre
                espace.
              </p>
            </details>
          </div>
        </section>

        <section className="landing-cta">
          <div>
            <p className="landing-kicker">PRENEZ VOTRE TEMPS</p>
            <h2>La prochaine étape peut être toute petite.</h2>
          </div>
          <a className="landing-button primary" href="/inscription">
            Créer mon compte <ArrowRight size={17} />
          </a>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/">
          <span className="landing-brand-icon">
            <Compass size={18} />
          </span>
          cekarna<span>.</span>
        </a>
        <span>Un espace pour votre recherche d’emploi.</span>
        <nav className="legal-links" aria-label="Informations légales">
          <a href="/mentions-legales">Mentions légales</a>
          <a href="/confidentialite">Confidentialité</a>
          <a href="/cookies">Cookies</a>
          <a href="/cgu">CGU</a>
        </nav>
        <a href="/connexion">Se connecter</a>
      </footer>
    </div>
  );
}
