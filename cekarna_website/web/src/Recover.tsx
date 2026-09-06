import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Compass, MailCheck } from 'lucide-react';
import { describeAuthError, requestPasswordReset } from './auth-api';

export default function Recover() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Mot de passe oublié — Cekarna';
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Saisissez une adresse email valide.');
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
        <a className="auth-back" href="/connexion">
          <ArrowLeft size={16} /> Retour à la connexion
        </a>
      </header>
      <main className="auth-main">
        <section className="auth-card" aria-label="Récupération du compte">
          <div className="auth-card-heading">
            <span className="auth-lock"><MailCheck size={19} /></span>
            <div>
              <h2>Récupérer l’accès</h2>
              <p>Nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
            </div>
          </div>
          {sent ? (
            <div className="auth-feedback" role="status">
              <MailCheck size={18} />
              <span>
                Si un compte existe pour cette adresse, un email de récupération
                a été envoyé. Le lien expire dans 30 minutes.
              </span>
            </div>
          ) : (
            <form className="auth-form" noValidate onSubmit={submit}>
              <label>
                Adresse email
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  placeholder="vous@exemple.fr"
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy}>
                {busy ? 'Envoi…' : 'Envoyer le lien'}
              </button>
              {error && (
                <div className="auth-feedback error" role="alert">
                  <span>{error}</span>
                </div>
              )}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
