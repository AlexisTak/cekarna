import { FormEvent, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
} from 'lucide-react';
import {
  AuthError,
  beginPasskeyLogin,
  describeAuthError,
  finishPasskeyLogin,
  login,
  registerAccount,
} from './auth-api';
import { getPasskey, supportsPasskeys } from './webauthn';

type AuthMode = 'signup' | 'login';

interface FieldErrors {
  firstName?: string;
  email?: string;
  password?: string;
  terms?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function passwordError(password: string): string | undefined {
  if (password.length < 15) return 'Utilisez au moins 15 caractères.';
  return undefined;
}

export default function Auth({ mode }: { mode: AuthMode }) {
  const isSignup = mode === 'signup';
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [signedUp, setSignedUp] = useState(false);
  const [serverError, setServerError] = useState('');
  const [mfaToken, setMfaToken] = useState('');

  useEffect(() => {
    document.title = isSignup
      ? 'Créer mon compte — Cekarna'
      : 'Se connecter — Cekarna';
  }, [isSignup]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError('');
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const nextErrors: FieldErrors = {};

    if (isSignup && firstName.length < 2)
      nextErrors.firstName = 'Indiquez votre prénom.';
    if (!emailPattern.test(email))
      nextErrors.email = 'Saisissez une adresse email valide.';
    if (isSignup) nextErrors.password = passwordError(password);
    else if (!password) nextErrors.password = 'Saisissez votre mot de passe.';
    if (isSignup && form.get('terms') !== 'accepted')
      nextErrors.terms = 'Votre accord est nécessaire pour créer le compte.';

    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setBusy(true);
    try {
      if (isSignup) {
        await registerAccount(email, password, firstName);
        setSignedUp(true);
      } else {
        const result = await login(email, password);
        if (result.kind === 'mfa') setMfaToken(result.token);
        else window.location.assign('/app');
      }
    } catch (error) {
      if (error instanceof AuthError && error.status === 401 && !isSignup) {
        setServerError('Adresse ou mot de passe incorrect.');
      } else {
        setServerError(describeAuthError(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmPasskey() {
    setBusy(true);
    setServerError('');
    try {
      const ceremony = await beginPasskeyLogin(mfaToken);
      const credential = await getPasskey(ceremony.options);
      if (!credential) return;
      await finishPasskeyLogin(mfaToken, ceremony.challenge_id, credential);
      window.location.assign('/app');
    } catch (error) {
      if (
        error instanceof AuthError &&
        (error.status === 401 || error.code === 'passkey_rejected')
      ) {
        setMfaToken('');
        setServerError(
          'La vérification a expiré ou a été refusée. Saisissez à nouveau votre mot de passe.',
        );
      } else {
        setServerError('La passkey n’a pas été reconnue. Réessayez.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (signedUp) {
    return (
      <div className="auth-page">
        <main className="auth-main">
          <section className="auth-card" aria-label="Inscription">
            <div className="auth-card-heading">
              <span className="auth-lock"><Check size={19} /></span>
              <div>
                <h2>Consultez votre boîte email</h2>
                <p>
                  Si l’adresse est disponible, votre compte a été créé et un email
                  de vérification a été demandé. Vous pouvez vous connecter ;
                  suivez le lien reçu pour confirmer votre adresse.
                </p>
              </div>
            </div>
            <div className="auth-local-access">
              <a href="/connexion">Aller à la connexion</a>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (mfaToken) {
    return (
      <div className="auth-page">
        <main className="auth-main">
          <section className="auth-card" aria-label="Second facteur">
            <div className="auth-card-heading">
              <span className="auth-lock"><KeyRound size={19} /></span>
              <div><h2>Confirmez avec votre passkey</h2><p>Utilisez Windows Hello, votre téléphone ou votre clé de sécurité.</p></div>
            </div>
            {!supportsPasskeys() ? (
              <p className="auth-feedback error">Ce navigateur ne prend pas en charge les passkeys. Utilisez la récupération du mot de passe pour retirer les passkeys du compte.</p>
            ) : (
              <button className="auth-submit" onClick={confirmPasskey} disabled={busy}>{busy ? 'Vérification…' : 'Utiliser ma passkey'} <ArrowRight size={18} /></button>
            )}
            <button className="button secondary" onClick={() => { setMfaToken(''); setServerError(''); }} disabled={busy}>Annuler</button>
            {serverError && <div className="auth-feedback error" role="alert">{serverError}</div>}
            <a className="forgot-link" href="/mot-de-passe-oublie">Passkey perdue ? Récupérer mon compte</a>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <a className="skip-link" href="#auth-form">
        Aller au formulaire
      </a>
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon">
            <Compass size={22} strokeWidth={2.3} />
          </span>
          cekarna<span>.</span>
        </a>
        <a className="auth-back" href="/">
          <ArrowLeft size={16} /> Retour à l’accueil
        </a>
      </header>

      <main className="auth-main">
        <section className="auth-context" aria-labelledby="auth-title">
          <p className="landing-kicker">
            <span /> VOTRE ESPACE CANDIDAT
          </p>
          <h1 id="auth-title">
            {isSignup
              ? 'Un espace clair pour garder votre élan.'
              : 'Retrouvez votre recherche là où vous l’avez laissée.'}
          </h1>
          <p>
            {isSignup
              ? 'Rassemblez vos offres, vos candidatures et vos notes dans un seul espace.'
              : 'Connectez-vous pour reprendre vos démarches et vos prochaines étapes.'}
          </p>
          <div className="auth-benefits">
            <p><Check size={17} /> Vos candidatures réunies au même endroit</p>
            <p><Check size={17} /> Aucun envoi effectué sans votre action</p>
            <p><Check size={17} /> Une sauvegarde exportable à tout moment</p>
          </div>
        </section>

        <section className="auth-card" aria-label={isSignup ? 'Inscription' : 'Connexion'}>
          <div className="auth-card-heading">
            <span className="auth-lock"><LockKeyhole size={19} /></span>
            <div>
              <h2>{isSignup ? 'Créer mon compte' : 'Se connecter'}</h2>
              <p>
                {isSignup ? 'Déjà inscrit ?' : 'Vous découvrez Cekarna ?'}{' '}
                <a href={isSignup ? '/connexion' : '/inscription'}>
                  {isSignup ? 'Se connecter' : 'Créer un compte'}
                </a>
              </p>
            </div>
          </div>

          <form id="auth-form" className="auth-form" noValidate onSubmit={submit}>
            {isSignup && (
              <label>
                Prénom
                <input
                  name="firstName"
                  autoComplete="given-name"
                  maxLength={60}
                  aria-invalid={Boolean(errors.firstName)}
                  aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                  onChange={() => setErrors((current) => ({ ...current, firstName: undefined }))}
                  placeholder="Votre prénom"
                />
                {errors.firstName && <span className="field-error" id="firstName-error">{errors.firstName}</span>}
              </label>
            )}

            <label>
              Adresse email
              <input
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={254}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onChange={() => setErrors((current) => ({ ...current, email: undefined }))}
                placeholder="vous@exemple.fr"
              />
              {errors.email && <span className="field-error" id="email-error">{errors.email}</span>}
            </label>

            <label>
              Mot de passe
              <span className="password-field">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  minLength={isSignup ? 15 : undefined}
                  maxLength={128}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  onChange={() => setErrors((current) => ({ ...current, password: undefined }))}
                  placeholder={isSignup ? '15 caractères minimum' : 'Votre mot de passe'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
              {errors.password && <span className="field-error" id="password-error">{errors.password}</span>}
            </label>

            {!isSignup && (
              <a className="forgot-link" href="/mot-de-passe-oublie">
                Mot de passe oublié ?
              </a>
            )}

            {isSignup && (
              <label className="terms-field">
                <input
                  name="terms"
                  type="checkbox"
                  value="accepted"
                  onChange={() => setErrors((current) => ({ ...current, terms: undefined }))}
                />
                <span>
                  J’accepte les conditions d’utilisation et la politique de confidentialité.
                </span>
                {errors.terms && <span className="field-error">{errors.terms}</span>}
              </label>
            )}

            <button className="auth-submit" type="submit" disabled={busy}>
              {isSignup
                ? busy
                  ? 'Création…'
                  : 'Créer mon compte'
                : busy
                  ? 'Connexion…'
                  : 'Me connecter'}{' '}
              <ArrowRight size={18} />
            </button>

            {serverError && (
              <div className="auth-feedback error" role="alert">
                <span>{serverError}</span>
              </div>
            )}
          </form>

          <div className="auth-local-access">
            <span>Vous voulez explorer avant de créer un compte ?</span>
            <a href="/?workspace=candidate">Ouvrir la version locale</a>
          </div>
        </section>
      </main>
    </div>
  );
}
