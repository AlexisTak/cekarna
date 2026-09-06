import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Compass, KeyRound } from 'lucide-react';
import { AuthError, confirmPasswordReset, describeAuthError } from './auth-api';

export default function PasswordReset() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? '' : 'Ce lien de récupération est incomplet.');

  useEffect(() => {
    document.title = 'Nouveau mot de passe — Cekarna';
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (password.length < 15) {
      setError('Utilisez au moins 15 caractères.');
      return;
    }
    setBusy(true);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof AuthError && err.status === 401
          ? 'Ce lien est expiré ou déjà utilisé. Demandez un nouveau lien.'
          : describeAuthError(err),
      );
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
        <section className="auth-card" aria-label="Nouveau mot de passe">
          <div className="auth-card-heading">
            <span className="auth-lock"><KeyRound size={19} /></span>
            <div>
              <h2>Choisir un nouveau mot de passe</h2>
              <p>Toutes vos sessions actives seront déconnectées.</p>
            </div>
          </div>
          {done ? (
            <div className="auth-feedback" role="status">
              <KeyRound size={18} />
              <span>
                Mot de passe enregistré.{' '}
                <a href="/connexion">Connectez-vous avec votre nouveau mot de passe.</a>
              </span>
            </div>
          ) : (
            <form className="auth-form" noValidate onSubmit={submit}>
              <label>
                Nouveau mot de passe
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={15}
                  maxLength={128}
                  placeholder="15 caractères minimum"
                />
              </label>
              <button className="auth-submit" type="submit" disabled={busy || !token}>
                {busy ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
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
