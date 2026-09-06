import { useEffect, useRef, useState } from 'react';
import { Compass, ShieldCheck } from 'lucide-react';
import { confirmEmailVerification } from './auth-api';

export default function VerifyEmail() {
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const started = useRef(false);

  useEffect(() => {
    document.title = 'Confirmation de votre adresse — Cekarna';
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (!token) {
      setState('error');
      return;
    }
    confirmEmailVerification(token)
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, []);

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-label="Confirmation de l’adresse email">
          <div className="auth-card-heading">
            <span className="auth-lock"><ShieldCheck size={19} /></span>
            <div>
              <h2>Confirmation de votre adresse</h2>
              <p aria-live="polite">
                {state === 'pending' && 'Vérification en cours…'}
                {state === 'ok' &&
                  'Votre adresse est confirmée. Merci ! Vous pouvez fermer cet onglet.'}
                {state === 'error' &&
                  'Ce lien est invalide, expiré ou déjà utilisé. Connectez-vous pour demander un nouveau lien.'}
              </p>
            </div>
          </div>
          <p className="auth-local-access">
            <a href="/connexion">Aller à la connexion</a>
          </p>
        </section>
      </main>
    </div>
  );
}
